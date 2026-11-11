import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { Room, makeCode } from './room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer() {
  const app = express();
  const rooms = new Map();

  app.use(express.static(path.join(__dirname, '../public')));
  app.use('/shared', express.static(path.join(__dirname, '../shared')));
  app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

  const server = http.createServer(app);
  const io = new Server(server);

  io.on('connection', (socket) => {
    let room = null;
    const reply = (cb, data) => typeof cb === 'function' && cb(data);
    const cleanName = (n) =>
      String(n ?? '')
        .trim()
        .slice(0, 16) || `Người chơi ${Math.floor(Math.random() * 900 + 100)}`;

    socket.on('room:create', (data, cb) => {
      if (room) return reply(cb, { ok: false, error: 'Bạn đang ở trong một phòng' });
      const r = new Room(makeCode(rooms), io, (code) => rooms.delete(code));
      rooms.set(r.code, r);
      const res = r.join(socket, cleanName(data?.name));
      if (res.ok) room = r;
      reply(cb, res);
    });

    socket.on('room:join', (data, cb) => {
      if (room) return reply(cb, { ok: false, error: 'Bạn đang ở trong một phòng' });
      const code = String(data?.code ?? '').trim().toUpperCase();
      const r = rooms.get(code);
      if (!r) return reply(cb, { ok: false, error: 'Không tìm thấy phòng này' });
      const res = r.join(socket, cleanName(data?.name));
      if (res.ok) room = r;
      reply(cb, res);
    });

    socket.on('room:addBot', (_d, cb) => reply(cb, room ? room.addBot(socket.id) : { ok: false }));
    socket.on('room:removeBot', (d, cb) =>
      reply(cb, room ? room.removeBot(socket.id, String(d?.id ?? '')) : { ok: false }),
    );
    socket.on('room:start', (_d, cb) => reply(cb, room ? room.start(socket.id) : { ok: false }));

    socket.on('room:leave', () => {
      room?.leave(socket.id);
      room = null;
    });

    socket.on('game:aim', (d) => room?.game?.setAim(socket.id, d));
    socket.on('game:move', (d) => room?.game?.move(socket.id, d?.dir));
    socket.on('game:fire', (_d, cb) =>
      reply(cb, room?.game ? room.game.fire(socket.id) : { ok: false, error: 'Chưa có ván nào' }),
    );

    socket.on('disconnect', () => {
      room?.leave(socket.id);
      room = null;
    });
  });

  return { app, server, io, rooms };
}

// Chỉ mở cổng khi chạy trực tiếp (npm start). Khi test thì import createServer.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createServer();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`Game đang chạy tại http://localhost:${port}`));
}
