/**
 * ScreenCast - Servidor de Sinalização WebRTC
 * Conecta um transmissor (celular) com um visualizador (PC)
 *
 * Como usar:
 *   npm install ws
 *   node server.js
 *
 * Porta padrão: 8080
 * Para rodar em produção: PORT=3000 node server.js
 */

const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

const rooms = new Map();

function log(msg) {
  const time = new Date().toLocaleTimeString("pt-BR");
  console.log(`[${time}] ${msg}`);
}

wss.on("connection", (ws) => {
  let roomId = null;
  let role = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "join") {
      roomId = String(msg.room || "").trim();
      role = msg.role;

      if (!rooms.has(roomId)) rooms.set(roomId, { sender: null, viewer: null });
      const room = rooms.get(roomId);

      if (role === "sender") room.sender = ws;
      if (role === "viewer") room.viewer = ws;

      ws.send(JSON.stringify({ type: "joined", room: roomId, role }));
      log(`${role} entrou na sala "${roomId}"`);

      // Avisar ambos imediatamente se os dois já estão na sala
      const { sender, viewer } = room;
      if (sender && viewer &&
          sender.readyState === WebSocket.OPEN &&
          viewer.readyState === WebSocket.OPEN) {
        log(`Sala "${roomId}" completa — conectando os dois`);
        sender.send(JSON.stringify({ type: "peer_joined", role: "viewer" }));
        viewer.send(JSON.stringify({ type: "peer_joined", role: "sender" }));
      }
      return;
    }

    // Repassar offer, answer, ice_candidate
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const peer = role === "sender" ? room.viewer : room.sender;
    if (peer && peer.readyState === WebSocket.OPEN) {
      peer.send(JSON.stringify(msg));
    }
  });

  ws.on("close", () => {
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const peer = role === "sender" ? room.viewer : room.sender;
    if (role === "sender") room.sender = null;
    if (role === "viewer") room.viewer = null;
    if (peer && peer.readyState === WebSocket.OPEN) {
      peer.send(JSON.stringify({ type: "peer_left", role }));
    }
    if (!room.sender && !room.viewer) rooms.delete(roomId);
    log(`${role} saiu da sala "${roomId}"`);
  });
});

log(`Servidor rodando na porta ${PORT}`);