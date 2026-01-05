import { useEffect, useRef, useState } from "react";
import "./App.css";
import { io } from "socket.io-client";
import Editor from "@monaco-editor/react";
import jsPDF from "jspdf";

const socket = io("https://code-together-b401.onrender.com");

const App = () => {
  const [joined, setJoined] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [userName, setUserName] = useState("");
  const [roomPassword, setRoomPassword] = useState("");
  const [language, setLanguage] = useState("javascript");
  const [code, setCode] = useState("// start code from here");
  const [users, setUsers] = useState([]);
  const [typing, setTyping] = useState("");
  const [outPut, setOutPut] = useState("");
  const [copySuccess, setCopySuccess] = useState("");

  const [permissions, setPermissions] = useState({});
  const [canWrite, setCanWrite] = useState(false);

  const typingTimeout = useRef(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // ✅ IMPORTANT FIX FLAG
  const hasLeftRef = useRef(false);

  /* ===============================
     SOCKET LISTENERS
  =============================== */
  useEffect(() => {
    socket.on("userJoined", (users) => {
      // 🔒 BLOCK re-join after leaving
      if (hasLeftRef.current) return;

      setUsers(users);
      setJoined(true);

      const admin = users[0]?.name;
      if (userName === admin) setCanWrite(true);
    });

    socket.on("joinError", (message) => {
      alert(message);
      setJoined(false);
    });

    socket.on("permissionUpdate", (perms) => {
      setPermissions(perms);
      setCanWrite(!!perms[userName]);
    });

    socket.on("codeUpdate", (newCode) => {
      if (typeof newCode === "string") setCode(newCode);
    });

    socket.on("userTyping", (user) => {
      setTyping(`${user.slice(0, 8)}... is typing`);
      clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => setTyping(""), 1500);
    });

    socket.on("languageUpdate", setLanguage);

    socket.on("codeResponse", (response) => {
      const output =
        response?.run?.stdout ||
        response?.run?.stderr ||
        response?.compile?.stderr ||
        "No output";
      setOutPut(output);
    });

    socket.on("roomEnded", () => {
      alert("Room has been ended by the admin.");

      hasLeftRef.current = true;

      setJoined(false);
      setRoomId("");
      setUserName("");
      setRoomPassword("");
      setCode("// start coding from here");
      setLanguage("javascript");
      setOutPut("");
      setUsers([]);
      setPermissions({});
      setCanWrite(false);
      setSidebarOpen(true);
    });

    return () => {
      socket.off("userJoined");
      socket.off("joinError");
      socket.off("permissionUpdate");
      socket.off("codeUpdate");
      socket.off("userTyping");
      socket.off("languageUpdate");
      socket.off("codeResponse");
      socket.off("roomEnded");
    };
  }, [userName]);

  /* ===============================
     LIVE TIMER
  =============================== */
  useEffect(() => {
    const interval = setInterval(() => {
      setUsers((u) => [...u]);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (joinedAt) => {
    const diff = Date.now() - joinedAt;
    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return `${m}m ${s}s`;
  };

  /* ===============================
     ACTIONS
  =============================== */
  const joinRoom = () => {
    if (!roomId || !userName) return;

    hasLeftRef.current = false; // ✅ RESET
    socket.emit("join", { roomId, userName, password: roomPassword });
  };

  const leaveRoom = () => {
    hasLeftRef.current = true; // ✅ KEY FIX

    socket.emit("leaveRoom");
    setJoined(false);
    setRoomId("");
    setUserName("");
    setRoomPassword("");
    setCode("// start coding from here");
    setLanguage("javascript");
    setOutPut("");
    setUsers([]);
    setPermissions({});
    setCanWrite(false);
  };

  const endRoomForAll = () => {
    if (!window.confirm("This will end the room for everyone. Continue?"))
      return;
    socket.emit("endRoom", { roomId });
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopySuccess("Copied!");
    setTimeout(() => setCopySuccess(""), 2000);
  };

  const handleCodeChange = (newCode = "") => {
    if (!canWrite) return;
    setCode(newCode);
    socket.emit("codeChange", { roomId, code: newCode });
    socket.emit("typing", { roomId, userName });
  };

  const handleLanguageChange = (e) => {
    const newLanguage = e.target.value;
    setLanguage(newLanguage);
    socket.emit("languageChange", { roomId, language: newLanguage });
  };

  const runCode = () => {
    if (!joined || !code.trim()) return;
    setOutPut("⏳ Running...");
    socket.emit("compileCode", { code, roomId, language });
  };

  const toggleWritePermission = (targetUser) => {
    socket.emit("setWritePermission", {
      roomId,
      targetUser,
      canWrite: !permissions[targetUser]
    });
  };

  /* ===============================
     PDF EXPORT
  =============================== */
  const exportToPDF = () => {
    if (!code.trim()) return;

    const pdf = new jsPDF("p", "mm", "a4");
    pdf.setFont("Courier", "bold");
    pdf.setFontSize(16);
    pdf.text("CODE-TOGETHER", 10, 15);

    pdf.setFont("Courier", "normal");
    pdf.setFontSize(11);
    pdf.text(`Room ID: ${roomId}`, 10, 25);
    pdf.text(`Language: ${language}`, 10, 32);
    pdf.line(10, 36, 200, 36);

    let y = 45;
    const lines = pdf.splitTextToSize(code, 180);

    lines.forEach((line) => {
      if (y > 280) {
        pdf.addPage();
        y = 20;
      }
      pdf.text(line, 10, y);
      y += 6;
    });

    pdf.save(`code-${roomId || "export"}.pdf`);
  };

  /* ===============================
     UI
  =============================== */
  if (!joined) {
    return (
      <div className="join-container">
        <div className="join-form">
          <h1>Join Code Room</h1>
          <input placeholder="Room Id" value={roomId} onChange={(e) => setRoomId(e.target.value)} />
          <input placeholder="Your Name" value={userName} onChange={(e) => setUserName(e.target.value)} />
          <input type="password" placeholder="Room Password" value={roomPassword} onChange={(e) => setRoomPassword(e.target.value)} />
          <button onClick={joinRoom}>Join Room</button>
        </div>
      </div>
    );
  }

  const adminName = users[0]?.name;

  return (
    <div className="editor-container">
      <div className={`sidebar ${sidebarOpen ? "" : "sidebar-hidden"}`}>
        <div className="room-info">
          <h2>Code Room: {roomId}</h2>
          <button onClick={copyRoomId} className="copy-btn">Copy Id</button>
          {copySuccess && <span className="copy-success">{copySuccess}</span>}
        </div>

        <h3>Users in Room:</h3>
        <ul>
          {users.map((user, index) => (
            <li key={index}>
              {user.name.slice(0, 8)}... {index === 0 && " 👑"}
              <br />
              <small>⏱ {formatTime(user.joinedAt)}</small>
              <br />
              <small>{permissions[user.name] ? "✏️ Write" : "👀 Read"}</small>

              {userName === adminName && user.name !== adminName && (
                <div>
                  <button style={{ marginTop: "4px" }} onClick={() => toggleWritePermission(user.name)}>
                    {permissions[user.name] ? "Revoke Write" : "Allow Write"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>

        <p className="typing-indicator">{typing}</p>

        <select className="language-selector" value={language} onChange={handleLanguageChange}>
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
          <option value="java">Java</option>
          <option value="cpp">C++</option>
        </select>

        <button className="leave-btn" onClick={leaveRoom}>Leave Room</button>
      </div>

      <div className="editor-wrapper">
        <Editor
          height="65%"
          language={language}
          value={code}
          onChange={handleCodeChange}
          theme="vs-dark"
          options={{ minimap: { enabled: false }, fontSize: 14, readOnly: !canWrite }}
        />

        <div style={{ display: "flex", gap: "10px" }}>
          <button className="run-btn" onClick={runCode}>Execute</button>
          <button className="run-btn" onClick={() => setSidebarOpen(p => !p)}>
            {sidebarOpen ? "Hide Sidebar" : "Show Sidebar"}
          </button>
          <button className="run-btn" onClick={exportToPDF}>Export PDF</button>

          {userName === adminName && (
            <button
              className="run-btn"
              style={{ backgroundColor: "#e74c3c", color: "white" }}
              onClick={endRoomForAll}
            >
              End Room
            </button>
          )}
        </div>

        <textarea
          className="output-console"
          value={outPut}
          readOnly
          placeholder="// Output will appear here"
        />
      </div>
    </div>
  );
};

export default App;
