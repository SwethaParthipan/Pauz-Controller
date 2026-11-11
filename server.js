
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;
const ROOT = __dirname;

const sessions = new Map();

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;

  let filename;

  if (pathname === "/" || pathname === "/laptop.html") {
    filename = "laptop.html";
  } else if (pathname === "/controller.html") {
    filename = "controller.html";
  } else {
    res.writeHead(404);
    return res.end("Page not found");
  }

  const filePath = path.join(ROOT, filename);

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      return res.end("PAUZ page not found");
    }

    const type = filename.endsWith(".html")
      ? "text/html"
      : "text/plain";

    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store"
    });

    res.end(content);
  });
});

const wss = new WebSocket.Server({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://localhost");
  const session = url.searchParams.get("session");
  const role = url.searchParams.get("role");

  if (!session || !["host", "controller"].includes(role)) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.session = session;
    ws.role = role;
    wss.emit("connection", ws);
  });
});

wss.on("connection", (ws) => {
  if (!sessions.has(ws.session)) {
    sessions.set(ws.session, {
      host: null,
      controller: null
    });
  }

  const room = sessions.get(ws.session);

  if (room[ws.role] && room[ws.role].readyState === WebSocket.OPEN) {
    ws.close(1008, "Device already connected");
    return;
  }

  room[ws.role] = ws;

  const otherRole = ws.role === "host" ? "controller" : "host";
  const other = room[otherRole];

  ws.send(JSON.stringify({
    type: "status",
    connected: !!other && other.readyState === WebSocket.OPEN
  }));

  if (other && other.readyState === WebSocket.OPEN) {
    other.send(JSON.stringify({
      type: "status",
      connected: true
    }));
  }

  ws.on("message", (message) => {
    const destination = room[otherRole];

    if (destination && destination.readyState === WebSocket.OPEN) {
      destination.send(message.toString());
    }
  });

  ws.on("close", () => {
    if (room[ws.role] === ws) {
      room[ws.role] = null;
    }

    const remaining = room[otherRole];

    if (remaining && remaining.readyState === WebSocket.OPEN) {
      remaining.send(JSON.stringify({
        type: "status",
        connected: false
      }));
    }

    if (!room.host && !room.controller) {
      sessions.delete(ws.session);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`PAUZ server running on port ${PORT}`);
});
