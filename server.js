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

// Mapa de salas: roomId => { sender: ws, viewer: ws }
const rooms = new Map();

function log(msg) {
  const time = new Date().toLocaleTimeString("pt-BR");
  console.log(`[${time}] ${msg}`);
}

function getRoomStats() {
  let active = 0;
  for (const [, room] of rooms) {
    if (room.sender || room.viewer) active++;
  }
  return { total: rooms.size, active };
}

wss.on("connection", (ws) => {
  log(`Nova conexão WebSocket`);

  let roomId = null;
  let role = null; // "sender" ou "viewer"

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "JSON inválido" }));
      return;
    }

    switch (msg.type) {
      // ─── Entrar em uma sala ───────────────────────────────────────────────
      case "join": {
        roomId = String(msg.room || "").trim();
        role = msg.role; // "sender" ou "viewer"

        if (!roomId) {
          ws.send(JSON.stringify({ type: "error", message: "room obrigatório" }));
          return;
        }
        if (role !== "sender" && role !== "viewer") {
          ws.send(JSON.stringify({ type: "error", message: "role deve ser sender ou viewer" }));
          return;
        }

        if (!rooms.has(roomId)) {
          rooms.set(roomId, { sender: null, viewer: null });
        }

        const room = rooms.get(roomId);

        if (role === "sender") {
          if (room.sender && room.sender.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "error", message: "Sala já tem um transmissor" }));
            return;
          }
          room.sender = ws;
          log(`Transmissor entrou na sala "${roomId}"`);
        } else {
          if (room.viewer && room.viewer.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "error", message: "Sala já tem um visualizador" }));
            return;
          }
          room.viewer = ws;
          log(`Visualizador entrou na sala "${roomId}"`);
        }

        ws.send(JSON.stringify({ type: "joined", room: roomId, role }));

        // Avisar o outro lado que o parceiro chegou
        const peer = role === "sender" ? room.viewer : room.sender;
        if (peer && peer.readyState === WebSocket.OPEN) {
          peer.send(JSON.stringify({ type: "peer_joined", role: role === "sender" ? "viewer" : "sender" }));
          ws.send(JSON.stringify({ type: "peer_joined", role: role === "sender" ? "sender" : "viewer" }));
        }

        log(`Salas ativas: ${getRoomStats().active}`);
        break;
      }

      // ─── Retransmitir SDP offer/answer e ICE candidates ──────────────────
      case "offer":
      case "answer":
      case "ice_candidate": {
        if (!roomId || !rooms.has(roomId)) {
          ws.send(JSON.stringify({ type: "error", message: "Entre em uma sala primeiro" }));
          return;
        }
        const room = rooms.get(roomId);
        const peer = role === "sender" ? room.viewer : room.sender;

        if (peer && peer.readyState === WebSocket.OPEN) {
          peer.send(JSON.stringify(msg));
          log(`[${roomId}] ${role} → ${msg.type}`);
        } else {
          ws.send(JSON.stringify({ type: "peer_not_ready", message: "Aguardando o outro lado conectar" }));
        }
        break;
      }

      default:
        ws.send(JSON.stringify({ type: "error", message: `Tipo desconhecido: ${msg.type}` }));
    }
  });

  ws.on("close", () => {
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      if (role === "sender") room.sender = null;
      if (role === "viewer") room.viewer = null;

      // Avisar o outro lado
      const peer = role === "sender" ? room.viewer : room.sender;
      if (peer && peer.readyState === WebSocket.OPEN) {
        peer.send(JSON.stringify({ type: "peer_left", role }));
      }

      // Limpar sala vazia
      if (!room.sender && !room.viewer) {
        rooms.delete(roomId);
      }

      log(`${role} saiu da sala "${roomId}" | Salas ativas: ${getRoomStats().active}`);
    }
  });

  ws.on("error", (err) => log(`Erro WebSocket: ${err.message}`));
});

log(`✅ Servidor rodando na porta ${PORT}`);
log(`   ws://localhost:${PORT}`);
log(`   Aguardando conexões...`);
