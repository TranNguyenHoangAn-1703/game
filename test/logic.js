// Kiểm thử logic không cần mạng và không cần thư viện ngoài:
// vật lý, luật chơi (Game), bot và phòng chơi (Room, dùng io giả).
// Chạy bằng: npm run test:logic

import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { planBotShot } from '../server/bot.js';
import { Room } from '../server/room.js';
import { Terrain, simulateShell } from '../server/physics.js';
import { WORLD, WEAPONS, LIMITS } from '../shared/config.js';

const { width: W } = WORLD;
const count = (terrain) => terrain.solid.reduce((s, v) => s + v, 0);
const names = (events) => events.map(([e]) => e);

// ---- Vật lý ----
{
  const flat = new Terrain(new Int16Array(W).fill(600));
  const base = { terrain: flat, tanks: [], shooterId: 'x', x: 100, y: 590, angleDeg: 45, power: 60 };

  const calm = simulateShell({ ...base, wind: 0 });
  assert.equal(calm.impact.type, 'ground');
  assert.ok(calm.impact.x > 700 && calm.impact.x < 850, `tầm bắn bất thường: ${calm.impact.x}`);

  const tail = simulateShell({ ...base, wind: 10 });
  const head = simulateShell({ ...base, wind: -10 });
  assert.ok(tail.impact.x > calm.impact.x && head.impact.x < calm.impact.x, 'gió phải đổi tầm bắn');

  const left = simulateShell({ ...base, x: 1000, angleDeg: 135, wind: 0 });
  assert.ok(left.impact.x < 1000, 'góc trên 90 độ phải bắn sang trái');

  const before = count(flat);
  flat.carve(calm.impact.x, calm.impact.y, 40);
  assert.ok(before - count(flat) > 1500, 'vụ nổ phải đục được một hố');
  assert.equal(flat.groundBelow(calm.impact.x, 0) > 600, true, 'mặt đất tại tâm hố phải thấp xuống');

  const target = [{ id: 't', alive: true, x: 400, y: 600 }];
  const direct = simulateShell({ ...base, tanks: target, x: 380, y: 560, angleDeg: 0, power: 8, wind: 0 });
  assert.equal(direct.impact.type, 'tank');
  console.log('ok  vật lý');
}

// ---- Game ----
{
  const events = [];
  const game = new Game(
    [
      { id: 'p1', name: 'An', isBot: false },
      { id: 'p2', name: 'Bình', isBot: false },
    ],
    (e, p) => events.push([e, p]),
  );
  game.nextTurn();
  const turn = events.find(([e]) => e === 'game:turn')[1];
  const cur = turn.currentId;
  const other = cur === 'p1' ? 'p2' : 'p1';
  assert.equal(game.phase, 'aim');
  assert.ok(turn.wind >= -10 && turn.wind <= 10);

  assert.equal(game.setAim(other, { angle: 10 }), false, 'người không có lượt không được ngắm');
  assert.equal(game.fire(other).ok, false);
  assert.equal(game.setAim(cur, { angle: 999, power: -5, weapon: 'big' }), true);
  const t = game.current();
  assert.equal(t.angle, 180, 'góc bị kẹp về 180');
  assert.equal(t.power, 5, 'lực bị kẹp về 5');
  assert.equal(t.weapon, 'big');
  game.setAim(cur, { angle: 50, power: 55, weapon: 'normal' });

  const x0 = t.x;
  const fuel0 = t.fuel;
  const moved = game.move(cur, t.x < W / 2 ? 1 : -1);
  if (moved) assert.equal(t.fuel, fuel0 - 3);
  else assert.equal(t.x, x0);
  assert.equal(game.move(cur, 2), false, 'hướng đi sai phải bị từ chối');

  const solidBefore = count(game.terrain);
  const res = game.fire(cur);
  assert.ok(res.ok);
  assert.equal(game.phase, 'resolving');
  assert.equal(game.fire(cur).ok, false, 'không được bắn hai lần một lượt');
  const shot = events.find(([e]) => e === 'game:shot')[1];
  assert.equal(shot.shells.length, 1);
  assert.equal(shot.shooterId, cur);
  if (shot.explosions.length) assert.ok(count(game.terrain) < solidBefore, 'địa hình phải bị đục');

  // Sát thương và hạ gục
  const victim = game.tanks.find((x) => x.id === other);
  victim.hp = 10;
  victim.alive = true;
  const hits = game.damage(victim.x, victim.y - 14, WEAPONS.normal);
  const hit = hits.find((h) => h.id === other);
  assert.ok(hit && hit.alive === false && hit.hp === 0);

  // Đạn Ba tia bắn ra 3 viên, tốn một viên dự trữ
  game.phase = 'aim';
  game.turnIndex = game.tanks.findIndex((x) => x.id === cur);
  t.ammo.triple = 1;
  t.weapon = 'triple';
  victim.alive = true;
  victim.hp = 100;
  assert.ok(game.fire(cur).ok);
  const shot3 = events.filter(([e]) => e === 'game:shot').at(-1)[1];
  assert.equal(shot3.shells.length, 3);
  assert.equal(t.ammo.triple, 0);
  assert.equal(t.weapon, 'normal', 'hết đạn đặc biệt thì tự về đạn thường');

  game.destroy();
  console.log('ok  luật chơi');
}

// ---- Người chơi thoát giữa ván ----
{
  const events = [];
  const game = new Game(
    [
      { id: 'p1', name: 'An', isBot: false },
      { id: 'p2', name: 'Bình', isBot: false },
    ],
    (e, p) => events.push([e, p]),
  );
  game.nextTurn();
  const leaver = game.current().id;
  game.removePlayer(leaver);
  const over = events.find(([e]) => e === 'game:over');
  assert.ok(over, 'chỉ còn một người thì ván phải kết thúc');
  assert.equal(over[1].winnerId, leaver === 'p1' ? 'p2' : 'p1');
  game.destroy();
  console.log('ok  thoát giữa ván');
}

// ---- Bot ----
{
  for (let i = 0; i < 5; i++) {
    const game = new Game(
      [
        { id: 'h', name: 'Người', isBot: false },
        { id: 'b', name: 'Máy', isBot: true },
      ],
      () => {},
    );
    const bot = game.tanks.find((x) => x.isBot);
    const plan = planBotShot(game, bot);
    assert.ok(plan && plan.angle >= 0 && plan.angle <= 180 && plan.power >= 10 && plan.power <= 100);
    assert.ok(WEAPONS[plan.weapon]);
    game.destroy();
  }
  console.log('ok  bot lên kế hoạch bắn');
}

// ---- Room với io giả ----
{
  const sent = [];
  const io = {
    to: () => ({ emit: (e, p) => sent.push([e, p]) }),
    sockets: { sockets: new Map() },
  };
  const sock = (id) => ({ id, join() {}, leave() {} });
  let emptied = null;
  const room = new Room('ABCD', io, (c) => (emptied = c));

  assert.ok(room.join(sock('a'), 'An').ok);
  assert.equal(room.hostId, 'a');
  assert.equal(room.start('a').ok, false, 'một người chưa bắt đầu được');
  assert.ok(room.join(sock('b'), 'Bình').ok);
  assert.equal(room.addBot('b').ok, false, 'chỉ chủ phòng mới thêm máy');
  assert.ok(room.addBot('a').ok);
  assert.ok(room.addBot('a').ok);
  assert.equal(room.addBot('a').ok, false, `tối đa ${LIMITS.maxPlayers} người chơi`);
  assert.ok(room.removeBot('a', 'bot-ABCD-2').ok);
  assert.equal(room.start('b').ok, false);

  assert.ok(room.start('a').ok);
  assert.equal(room.state, 'playing');
  assert.equal(room.join(sock('c'), 'Chi').ok, false, 'đang chơi thì không vào thêm được');
  assert.ok(names(sent).includes('game:start'));

  room.leave('a');
  assert.equal(room.hostId, 'b', 'chủ phòng thoát thì người còn lại làm chủ');
  room.leave('b');
  assert.equal(emptied, 'ABCD', 'hết người thật thì phòng bị xóa');
  console.log('ok  phòng chơi');
}

console.log('Tất cả kiểm thử logic đã qua.');
process.exit(0);
