// Phòng chơi: gom người chơi, bot và một ván game đang chạy.

import { LIMITS } from '../shared/config.js';
import { Game } from './game.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function makeCode(rooms) {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

export class Room {
  constructor(code, io, onEmpty) {
    this.code = code;
    this.io = io;
    this.onEmpty = onEmpty;
    this.players = new Map(); // id -> { id, name, isBot }
    this.hostId = null;
    this.state = 'lobby'; // lobby | playing
    this.game = null;
    this.botSeq = 0;
  }

  humans() {
    return [...this.players.values()].filter((p) => !p.isBot);
  }

  info() {
    return {
      code: this.code,
      hostId: this.hostId,
      state: this.state,
      min: LIMITS.minPlayers,
      max: LIMITS.maxPlayers,
      players: [...this.players.values()].map(({ id, name, isBot }) => ({ id, name, isBot })),
    };
  }

  push() {
    this.io.to(this.code).emit('room:update', this.info());
  }

  join(socket, name) {
    if (this.state !== 'lobby') return { ok: false, error: 'Phòng đang chơi, hãy đợi ván này kết thúc' };
    if (this.players.size >= LIMITS.maxPlayers) return { ok: false, error: 'Phòng đã đầy' };
    this.players.set(socket.id, { id: socket.id, name, isBot: false });
    if (!this.hostId) this.hostId = socket.id;
    socket.join(this.code);
    this.push();
    return { ok: true };
  }

  addBot(requesterId) {
    if (requesterId !== this.hostId) return { ok: false, error: 'Chỉ chủ phòng mới thêm được máy' };
    if (this.state !== 'lobby') return { ok: false, error: 'Ván đang chạy' };
    if (this.players.size >= LIMITS.maxPlayers) return { ok: false, error: 'Phòng đã đầy' };
    const seq = ++this.botSeq;
    const id = `bot-${this.code}-${seq}`;
    this.players.set(id, { id, name: `Máy ${seq}`, isBot: true });
    this.push();
    return { ok: true };
  }

  removeBot(requesterId, botId) {
    if (requesterId !== this.hostId) return { ok: false, error: 'Chỉ chủ phòng mới xóa được máy' };
    const p = this.players.get(botId);
    if (!p || !p.isBot || this.state !== 'lobby') return { ok: false, error: 'Không xóa được' };
    this.players.delete(botId);
    this.push();
    return { ok: true };
  }

  start(requesterId) {
    if (requesterId !== this.hostId) return { ok: false, error: 'Chỉ chủ phòng mới bắt đầu được' };
    if (this.state !== 'lobby') return { ok: false, error: 'Ván đang chạy' };
    if (this.players.size < LIMITS.minPlayers) return { ok: false, error: 'Cần ít nhất 2 người chơi (có thể thêm máy)' };

    this.state = 'playing';
    this.game = new Game(
      [...this.players.values()],
      (event, payload) => this.io.to(this.code).emit(event, payload),
      {
        onOver: () => {
          this.state = 'lobby';
          this.game = null;
          this.push();
        },
      },
    );
    this.push();
    this.game.start();
    return { ok: true };
  }

  leave(socketId) {
    if (!this.players.has(socketId)) return;
    this.game?.removePlayer(socketId);
    this.players.delete(socketId);
    this.io.sockets.sockets.get(socketId)?.leave(this.code);

    if (this.humans().length === 0) {
      this.game?.destroy();
      this.onEmpty?.(this.code);
      return;
    }
    if (this.hostId === socketId) this.hostId = this.humans()[0].id;
    this.push();
  }
}
