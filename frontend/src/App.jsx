import { useEffect, useRef, useState } from "react";
import "./App.css";
import { io } from "socket.io-client";
import Editor from "@monaco-editor/react";
import jsPDF from "jspdf";

const socket = io("https://code-together-b401.onrender.com");
// const socket = io("http://localhost:5000");

const App = () => {
  const [joined, setJoined] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [userName, setUserName] = useState("");
  const [roomPassword, setRoomPassword] = useState("");

  const [language, setLanguage] = useState("javascript");
  const [code, setCode] = useState("");
  const [users, setUsers] = useState([]);

  const [typing, setTyping] = useState("");
  const [outPut, setOutPut] = useState("");
  const [showOutput, setShowOutput] = useState(false);
  const [copySuccess, setCopySuccess] = useState("");

  const [permissions, setPermissions] = useState({});
  const [canWrite, setCanWrite] = useState(false);

  const [topic, setTopic] = useState("");

  const typingTimeout = useRef(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const hasLeftRef = useRef(false);

  const [chatOpen, setChatOpen] = useState(false);
  const [roomMessages, setRoomMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");

  const chatEndRef = useRef(null);
  const closeConsole = () => {
    setShowOutput(false);
  };

  /* SOCKET EVENTS */

  useEffect(() => {
    socket.on("userJoined", (users) => {
      if (hasLeftRef.current) return;

      setUsers(users);
      setJoined(true);
      setShowOutput(false);

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

    socket.on("topicUpdate", (newTopic) => {
      setTopic(newTopic);
    });

    socket.on("userTyping", (user) => {
      setTyping(`${user.slice(0, 8)}... is typing`);

      clearTimeout(typingTimeout.current);

      typingTimeout.current = setTimeout(() => setTyping(""), 1500);
    });

    socket.on("receiveRoomMessage", (msg) => {
      setRoomMessages((prev) => [
        ...prev,
        {
          ...msg,
          timestamp: msg.timestamp || Date.now(),
        },
      ]);
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
      setCode("");
      setLanguage("javascript");
      setOutPut("");
      setUsers([]);
      setPermissions({});
      setCanWrite(false);
      setSidebarOpen(true);
      setTopic("");
    });

    return () => {
      socket.off("userJoined");
      socket.off("joinError");
      socket.off("permissionUpdate");
      socket.off("codeUpdate");
      socket.off("topicUpdate");
      socket.off("userTyping");

      socket.off("receiveRoomMessage"); // ADD
      socket.off("receivePrivateMessage"); // ADD

      socket.off("languageUpdate");
      socket.off("codeResponse");
      socket.off("roomEnded");
    };
  }, [userName]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [roomMessages]);

  /* LIVE TIMER */

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

  /* ACTIONS */

  const joinRoom = () => {
    if (!roomId || !userName) return;

    hasLeftRef.current = false;

    socket.emit("join", {
      roomId,
      userName,
      password: roomPassword,
    });
  };

  const leaveRoom = () => {
    hasLeftRef.current = true;

    socket.emit("leaveRoom");

    setJoined(false);
    setRoomId("");
    setUserName("");
    setRoomPassword("");
    setCode("");
    setLanguage("javascript");
    setOutPut("");
    setUsers([]);
    setPermissions({});
    setCanWrite(false);
    setTopic("");
    setShowOutput(false);
  };

  const handleTopicChange = (e) => {
    const newTopic = e.target.value;

    setTopic(newTopic);

    socket.emit("topicChange", {
      roomId,
      topic: newTopic,
    });
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
    if (!topic.trim()) {
      alert("Admin must set coding topic first.");
      return;
    }

    setCode(newCode);

    socket.emit("codeChange", {
      roomId,
      code: newCode,
    });

    socket.emit("typing", {
      roomId,
      userName,
    });
  };

  const handleLanguageChange = (e) => {
    const newLanguage = e.target.value;

    setLanguage(newLanguage);

    socket.emit("languageChange", {
      roomId,
      language: newLanguage,
    });
  };

  const sendRoomMessage = () => {
    if (!chatInput.trim()) return;

    socket.emit("sendRoomMessage", {
      roomId,
      userName,
      message: chatInput,
    });

    setChatInput("");
  };

  const runCode = () => {
    if (!topic.trim()) {
      alert("Admin must set coding topic first.");

      return;
    }

    if (!joined || !code.trim()) return;
    setShowOutput(true);

    setOutPut("⏳ Running...");

    socket.emit("compileCode", {
      code,
      roomId,
      language,
    });
  };

  const toggleWritePermission = (targetUser) => {
    socket.emit("setWritePermission", {
      roomId,
      targetUser, // DO NOT lowercase
      canWrite: !permissions[targetUser],
    });
  };

  /* PDF EXPORT */

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
    pdf.text(`Topic: ${topic}`, 10, 39);

    pdf.line(10, 42, 200, 42);

    let y = 50;

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

  // LOG OF CONNECTED USER

  const exportUserLogPDF = () => {
    if (!users.length) return;

    const pdf = new jsPDF("p", "mm", "a4");

    pdf.setFont("Courier", "bold");
    pdf.setFontSize(16);
    pdf.text("CODE ROOM USER LOG", 10, 15);

    pdf.setFont("Courier", "normal");
    pdf.setFontSize(11);

    pdf.text(`Room ID: ${roomId}`, 10, 25);
    pdf.text(`Topic: ${topic || "N/A"}`, 10, 32);

    pdf.line(10, 38, 200, 38);

    let y = 48;

    users.forEach((user, index) => {
      const joinTime = new Date(user.joinedAt).toLocaleTimeString();

      pdf.text(`${index + 1}. ${user.name}  |  Joined at: ${joinTime}`, 10, y);

      y += 8;

      if (y > 280) {
        pdf.addPage();
        y = 20;
      }
    });

    pdf.save(`user-log-${roomId}.pdf`);
  };

  /* JOIN UI */

  if (!joined) {
    return (
      <div className="join-container">
        <form
          className="join-form"
          onSubmit={(e) => {
            e.preventDefault();
            joinRoom();
          }}
        >
          <h1>Join Code Room</h1>

          <input
            placeholder="Room Id"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          />

          <input
            placeholder="Your Name"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
          />

          <input
            type="password"
            placeholder="Room Password"
            value={roomPassword}
            onChange={(e) => setRoomPassword(e.target.value)}
          />

          <button type="submit">Join Room</button>
        </form>
      </div>
    );
  }

  const adminName = users[0]?.name;

  return (
    <div className="editor-container">
      <div
        className={`sidebar ${sidebarOpen ? "sidebar-open" : "sidebar-hidden"}`}
      >
        <div className="room-info">
          <h2>Code Room: {roomId}</h2>

          <button onClick={copyRoomId} className="copy-btn">
            Copy Id
          </button>

          {copySuccess && <span className="copy-success">{copySuccess}</span>}
        </div>

        <h3>Users in Room:</h3>

        <ul>
          {users.map((user, index) => (
            <li key={index}>
              {user.name.slice(0, 8)}...
              {index === 0 && " 👑"}
              <br />
              <small>⏱ {formatTime(user.joinedAt)}</small>
              <br />
              <small>{permissions[user.name] ? "✏️ Write" : "👀 Read"}</small>
              {userName === adminName && user.name !== adminName && (
                <div>
                  <button
                    style={{ marginTop: "4px" }}
                    onClick={() => toggleWritePermission(user.name)}
                  >
                    {permissions[user.name] ? "Revoke Write" : "Allow Write"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>

        <p className="typing-indicator">{typing}</p>

        <select
          className="language-selector"
          value={language}
          onChange={handleLanguageChange}
        >
          <option value="javascript">JavaScript</option>

          <option value="python">Python</option>

          <option value="java">Java</option>

          <option value="cpp">C++</option>
        </select>
        <div className="sidebar-buttons">
          <button className="run-btn" onClick={exportToPDF}>
            Export PDF
          </button>

          {userName === adminName && (
            <>
              <button className="end-room-btn" onClick={endRoomForAll}>
                End Room
              </button>

              <button className="log-btn" onClick={exportUserLogPDF}>
                Download User Log
              </button>
            </>
          )}
        <button className="leave-btn" onClick={leaveRoom}>
          Leave Room
        </button>
        </div>

      </div>

      <div className="editor-wrapper">
        <div className="topic-header">
          <div className="header-left">
            {/* <h3>Code Room: {roomId}</h3> */}
          </div>

          <div className="header-center">
            {userName === adminName ? (
              <>
                <input
                  type="text"
                  value={topic}
                  onChange={handleTopicChange}
                  placeholder="Enter Coding Topic..."
                  className="topic-input"
                />

                {!topic && (
                  <div className="topic-warning">
                    ⚠ Please enter a topic before writing code
                  </div>
                )}
              </>
            ) : (
              <div className="topic-title">
                Coding Topic: {topic || "Waiting for admin..."}
              </div>
            )}
          </div>

          <div className="header-right">
            <button className="chat-btn" onClick={runCode}>
              Execute
            </button>

            <button className="chat-btn" onClick={() => setChatOpen(!chatOpen)}>
              💬 Chat
            </button>

            <button
              className="menu-btn"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              ☰ More
            </button>
          </div>
        </div>

        <div className="editor-area">
          {!code && (
            <div className="editor-placeholder">Start typing your code...</div>
          )}

          <Editor
            key={roomId}
            height={showOutput ? "65vh" : "100%"}
            language={language}
            value={code}
            onChange={handleCodeChange}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              readOnly: !canWrite || (userName !== adminName && !topic),

              smoothScrolling: true,
              cursorSmoothCaretAnimation: "on",
              automaticLayout: true,
            }}
          />
        </div>

        {showOutput && (
          <div className="console-container">
            <button className="console-close" onClick={closeConsole}>
              ✖
            </button>
            <textarea className="output-console" value={outPut} readOnly />
          </div>
        )}
      </div>
      {/* CHAT PANEL */}
      {chatOpen && (
        <div className="chat-panel">
          <div className="chat-header">Room Chat</div>

          <div className="chat-messages">
            {roomMessages.map((m, i) => (
              <div
                key={i}
                className={`chat-message ${
                  m.userName === userName ? "my-message" : ""
                }`}
              >
                <div className="chat-user">{m.userName}</div>
                <div className="chat-bubble">{m.message}</div>
                <div className="chat-time">
                  {m.timestamp
                    ? new Date(m.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : ""}
                </div>
              </div>
            ))}
            <div ref={chatEndRef}></div>
          </div>

          <div className="chat-input-area">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Type message..."
              onKeyDown={(e) => {
                if (e.key === "Enter") sendRoomMessage();
              }}
            />

            <button onClick={sendRoomMessage}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
