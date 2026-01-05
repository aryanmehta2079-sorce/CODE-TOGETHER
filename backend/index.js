import express from "express";
import http from "http";
import { Server } from "socket.io";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

/* ===============================
   Keep-alive
================================ */
const url = "https://code-editor-93m0.onrender.com";
setInterval(() => axios.get(url).catch(() => {}), 30000);

/* ===============================
   Utils
================================ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

/* ===============================
   State
================================ */
const rooms = new Map();
const writePermissions = new Map();
const socketUser = new Map();

/* ===============================
   Compiler Config
================================ */
const LANGUAGE_VERSIONS = {
  javascript: "18.15.0",
  python: "3.10.0",
  java: "15.0.2",
  cpp: "10.2.0"
};

const JDOODLE_LANG_MAP = {
  javascript: { language: "nodejs", versionIndex: "4" },
  python: { language: "python3", versionIndex: "4" },
  java: { language: "java", versionIndex: "4" },
  cpp: { language: "cpp17", versionIndex: "1" }
};

/* ===============================
   Compiler Helpers
================================ */
async function runWithPiston(code, language) {
  return axios.post(
    "https://emkc.org/api/v2/piston/execute",
    {
      language,
      version: LANGUAGE_VERSIONS[language] || "*",
      files: [{ content: code }]
    },
    { timeout: 5000 }
  );
}

async function runWithJDoodle(code, language) {
  const map = JDOODLE_LANG_MAP[language];
  if (!map) throw new Error("JDoodle language not supported");

  return axios.post(
    "https://api.jdoodle.com/v1/execute",
    {
      clientId: process.env.JDOODLE_ID,
      clientSecret: process.env.JDOODLE_SECRET,
      script: code,
      language: map.language,
      versionIndex: map.versionIndex
    },
    { timeout: 5000 }
  );
}

async function executeWithFallback(code, language) {
  try {
    return await runWithPiston(code, language);
  } catch {
    console.warn("⚠️ Piston failed, switching to JDoodle");
    return await runWithJDoodle(code, language);
  }
}

/* ===============================
   Socket Logic
================================ */
io.on("connection", (socket) => {

  /* -------- JOIN ROOM -------- */
  socket.on("join", ({ roomId, userName, password }) => {
    if (!roomId || !userName) return;

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        users: new Map(),
        code: "// start coding from here",
        language: "javascript",
        password: null
      });
      writePermissions.set(roomId, new Map());
    }

    const room = rooms.get(roomId);
    const perms = writePermissions.get(roomId);
    const normalizedName = userName.trim().toLowerCase();

    if (!room.password) room.password = password;
    else if (room.password !== password) {
      socket.emit("joinError", "Incorrect room password.");
      return;
    }

    if (room.users.has(normalizedName)) {
      socket.emit("joinError", "This name already exists in the room.");
      return;
    }

    socketUser.set(socket.id, { roomId, normalizedName });
    socket.join(roomId);

    room.users.set(normalizedName, {
      name: userName,
      joinedAt: Date.now()
    });

    if (perms.size === 0) perms.set(normalizedName, true);
    else perms.set(normalizedName, false);

    io.to(roomId).emit("userJoined", formatUsers(room));
    io.to(roomId).emit("permissionUpdate", serializePermissions(room, perms));

    socket.emit("codeUpdate", room.code);
    socket.emit("languageUpdate", room.language);
  });

  /* -------- CODE CHANGE -------- */
  socket.on("codeChange", ({ roomId, code }) => {
    const user = socketUser.get(socket.id);
    if (!user) return;

    const perms = writePermissions.get(roomId);
    if (!perms?.get(user.normalizedName)) return;

    const room = rooms.get(roomId);
    if (!room) return;

    room.code = code;
    socket.to(roomId).emit("codeUpdate", code);
  });

  /* -------- WRITE PERMISSION (FIXED) -------- */
  socket.on("setWritePermission", ({ roomId, targetUser, canWrite }) => {
    const user = socketUser.get(socket.id);
    if (!user) return;

    const room = rooms.get(roomId);
    const perms = writePermissions.get(roomId);
    if (!room || !perms) return;

    const admin = Array.from(perms.entries()).find(([, v]) => v === true)?.[0];
    if (user.normalizedName !== admin) return;

    const targetNormalized = [...room.users.entries()]
      .find(([, u]) => u.name === targetUser)?.[0];

    if (!targetNormalized) return;

    perms.set(targetNormalized, canWrite);

    io.to(roomId).emit(
      "permissionUpdate",
      serializePermissions(room, perms)
    );
  });

  /* -------- TYPING -------- */
  socket.on("typing", ({ roomId, userName }) => {
    socket.to(roomId).emit("userTyping", userName);
  });

  /* -------- LANGUAGE -------- */
  socket.on("languageChange", ({ roomId, language }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    room.language = language;
    io.to(roomId).emit("languageUpdate", language);
  });

  /* -------- COMPILE -------- */
  socket.on("compileCode", async ({ code, roomId, language }) => {
    try {
      const response = await executeWithFallback(code, language);
      const data = response.data;

      if (data.output !== undefined) {
        io.to(roomId).emit("codeResponse", {
          run: { stdout: data.output }
        });
      } else {
        io.to(roomId).emit("codeResponse", data);
      }
    } catch {
      io.to(roomId).emit("codeResponse", {
        run: { stderr: "❌ All compilers are currently unavailable." }
      });
    }
  });

  /* -------- END ROOM -------- */
  socket.on("endRoom", ({ roomId }) => {
    const user = socketUser.get(socket.id);
    if (!user) return;

    const perms = writePermissions.get(roomId);
    if (!perms) return;

    const admin = Array.from(perms.keys())[0];
    if (user.normalizedName !== admin) return;

    io.to(roomId).emit("roomEnded");
    rooms.delete(roomId);
    writePermissions.delete(roomId);
    io.in(roomId).socketsLeave(roomId);
  });

  socket.on("leaveRoom", () => cleanup(socket));
  socket.on("disconnect", () => cleanup(socket));

  function cleanup(socket) {
    const data = socketUser.get(socket.id);
    if (!data) return;

    const { roomId, normalizedName } = data;
    const room = rooms.get(roomId);
    const perms = writePermissions.get(roomId);
    if (!room || !perms) return;

    const wasAdmin = perms.get(normalizedName);

    room.users.delete(normalizedName);
    perms.delete(normalizedName);
    socketUser.delete(socket.id);

    if (room.users.size === 0) {
      rooms.delete(roomId);
      writePermissions.delete(roomId);
      return;
    }

    if (wasAdmin) {
      perms.clear();
      perms.set(getOldestUser(room.users), true);
    }

    io.to(roomId).emit("userJoined", formatUsers(room));
    io.to(roomId).emit("permissionUpdate", serializePermissions(room, perms));
  }
});

/* ===============================
   Helpers
================================ */
function formatUsers(room) {
  return Array.from(room.users.values());
}

function serializePermissions(room, perms) {
  const result = {};
  for (const [key, val] of perms.entries()) {
    const name = room.users.get(key)?.name;
    if (name) result[name] = val;
  }
  return result;
}

function getOldestUser(usersMap) {
  let oldest = null;
  let time = Infinity;
  for (const [key, val] of usersMap.entries()) {
    if (val.joinedAt < time) {
      time = val.joinedAt;
      oldest = key;
    }
  }
  return oldest;
}

/* ===============================
   Serve Frontend
================================ */
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(rootDir, "frontend", "dist")));
  app.get("/", (_req, res) =>
    res.sendFile(path.join(rootDir, "frontend", "dist", "index.html"))
  );
}

server.listen(process.env.PORT || 5000, () =>
  console.log("Server running on port 5000")
);
