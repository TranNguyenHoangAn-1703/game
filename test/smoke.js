// Kiểm thử nhanh: vật lý, phòng chơi, một lượt bắn thật qua Socket.IO, bot và người chơi thoát giữa ván.
// Chạy bằng: npm test

import assert from 'node:assert/strict';
import { io as connectClient } from 'socket.io-client';
import { createServer } from '../server/index.js';
import { Terrain, simulateShell } from '../server/physics.js';
import { WORLD } from '../shared/config.js';

const { width: W } = WORLD;

// ---- 1. Vật lý ----
{
  const flat = new Terrain(new Int16Array(W).fill(600));
  const base = { terrain: flat, tanks: [], shooterId: 'x', x: 100, y: 590, angleDeg: 45, power: 60 };

  const calm = simulateShell({ ...base, wind: 0 });
  assert.equal(calm.impact.type, 'ground');
  assert.ok(calm.impact.x > 700 && calm.impact.x < 850, `tầm bắn bất thường: ${calm.impact.x}`);

  const windy = simulateShell({ ...base, wind: 10 });
  assert.ok(windy.impact.x > calm.impact.x, 'gió thuận phải đẩy đạn đi xa hơn');

  const before = flat.solid.reduce((s, v) => s + v, 0);
  flat.carve(calm.impact.x, calm.impact.y, 40);
  const after = flat.solid.reduce((s, v) => s + v, 0);
  assert.ok(before - after > 1500, 'vụ nổ phải đục được một hố');
  console.log('ok  vật lý');
}

// ---- 2. Mạng ----
const { server } = createServer();
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}`;

const connect = () =>
  new Promise((res) => {
    const s = connectClient(url, { forceNew: true });
    s.on('connect', () => res(s));
  });
const call = (s, ev, data) => new Promise((res) => s.emit(ev, data, res));
const waitUntil = (s, ev, pred = () => true, ms = 30000) =>
  new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`hết giờ chờ ${ev}`)), ms);
    const handler = (d) => {
      if (!pred(d)) return;
      clearTimeout(timer);
      s.off(ev, handler);
      res(d);
    };
    s.on(ev, handler);
  });

try {
  // Hai người chơi vào phòng, bắn một phát
  const a = await connect();
  const b = await connect();
  const created = await call(a, 'room:create', { name: 'An' });
  assert.ok(created.ok);
  const roomInfo = await waitUntil(a, 'room:update');
  assert.equal(roomInfo.code.length, 4);

  const bad = await call(b, 'room:join', { code: 'ZZZZ', name: 'Bình' });
  assert.equal(bad.ok, false);
  const good = await call(b, 'room:join', { code: roomInfo.code.toLowerCase(), name: 'Bình' });
  assert.ok(good.ok);

  const notHost = await call(b, 'room:start');
  assert.equal(notHost.ok, false);

  const startA = waitUntil(a, 'game:start');
  assert.ok((await call(a, 'room:start')).ok);
  const start = await startA;
  assert.equal(start.heights.length, W);
  assert.equal(start.tanks.length, 2);
  assert.ok(start.tanks.every((t) => t.y > 0 && t.hp === 100));

  const turn = await waitUntil(a, 'game:turn');
  const shooter = turn.currentId === a.id ? a : b;
  const shot = waitUntil(a, 'game:shot');
  shooter.emit('game:aim', { angle: 50, power: 55, weapon: 'normal' });
  const fired = await call(shooter, 'game:fire', null);
  assert.ok(fired.ok);
  const result = await shot;
  assert.equal(result.shells.length, 1);
  assert.ok(result.shells[0].path.length > 20);
  assert.equal(result.shooterId, shooter.id);

  // Người còn lại thoát giữa ván thì người ở lại thắng
  const over = waitUntil(a, 'game:over');
  b.disconnect();
  const end = await over;
  assert.equal(end.winnerId, a.id);
  console.log('ok  phòng chơi, lượt bắn, thoát giữa ván');

  // Chơi với máy: máy phải tự bắn được
  const h = await connect();
  assert.ok((await call(h, 'room:create', { name: 'Hạnh' })).ok);
  assert.ok((await call(h, 'room:addBot')).ok);
  const hStart = waitUntil(h, 'game:start');
  assert.ok((await call(h, 'room:start')).ok);
  const st = await hStart;
  const bot = st.tanks.find((t) => t.isBot);
  assert.ok(bot);
  h.on('game:turn', (d) => {
    if (d.currentId !== h.id) return;
    h.emit('game:aim', { angle: 60, power: 55, weapon: 'normal' });
    h.emit('game:fire', null, () => {});
  });
  const botShot = await waitUntil(h, 'game:shot', (d) => d.shooterId === bot.id);
  assert.ok(botShot.shells[0].path.length > 4);
  console.log('ok  bot tự bắn');

  a.disconnect();
  h.disconnect();
  console.log('Tất cả kiểm thử đã qua.');
  process.exit(0);
} catch (err) {
  console.error('Kiểm thử thất bại:', err);
  process.exit(1);
}
