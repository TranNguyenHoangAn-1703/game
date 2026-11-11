// Luật chơi: server giữ toàn bộ trạng thái, client chỉ gửi ý định (ngắm, đi, bắn)
// và nhận lại kết quả để vẽ.

import { WORLD, TANK, TURN, WEAPONS, COLORS } from '../shared/config.js';
import { Terrain, generateHeights, simulateShell, muzzlePos } from './physics.js';
import { planBotShot } from './bot.js';

const { width: W } = WORLD;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function publicTank(t) {
  return {
    id: t.id,
    name: t.name,
    color: t.color,
    isBot: t.isBot,
    x: t.x,
    y: t.y,
    hp: t.hp,
    alive: t.alive,
    angle: t.angle,
    power: t.power,
    weapon: t.weapon,
    ammo: t.ammo,
    fuel: t.fuel,
  };
}

export class Game {
  /**
   * @param {{id:string,name:string,isBot:boolean}[]} players
   * @param {(event:string, payload:any)=>void} emit gửi sự kiện tới cả phòng
   * @param {{onOver?:()=>void}} hooks
   */
  constructor(players, emit, hooks = {}) {
    this.emit = emit;
    this.onOver = hooks.onOver;
    this.terrain = new Terrain(generateHeights((Math.random() * 2 ** 31) | 0));
    this.timers = new Set();
    this.turnIndex = -1;
    this.turnNumber = 0;
    this.wind = 0;
    this.phase = 'starting'; // starting | aim | resolving | over
    this.turnTimer = null;

    const order = shuffle(players);
    this.tanks = order.map((p, i) => this.createTank(p, i, order.length));
  }

  createTank(p, index, count) {
    const x = Math.round((W * (index + 1)) / (count + 1) + (Math.random() * 60 - 30));
    return {
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      color: COLORS[index % COLORS.length],
      x,
      y: this.terrain.groundBelow(x, 0),
      hp: TANK.maxHp,
      alive: true,
      angle: x < W / 2 ? 60 : 120,
      power: 60,
      weapon: 'normal',
      ammo: { big: WEAPONS.big.ammo, triple: WEAPONS.triple.ammo },
      fuel: TANK.fuel,
    };
  }

  // ---- tiện ích ----

  later(fn, ms) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  cancel(id) {
    if (id == null) return;
    clearTimeout(id);
    this.timers.delete(id);
  }

  clearTimers() {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
  }

  current() {
    return this.turnIndex >= 0 ? this.tanks[this.turnIndex] : null;
  }

  alive() {
    return this.tanks.filter((t) => t.alive);
  }

  destroy() {
    this.phase = 'over';
    this.clearTimers();
  }

  // ---- vòng đời ----

  start() {
    this.emit('game:start', {
      world: WORLD,
      heights: Array.from(this.terrain.heights),
      tanks: this.tanks.map(publicTank),
    });
    this.later(() => this.nextTurn(), TURN.startDelayMs);
  }

  nextTurn() {
    if (this.phase === 'over') return;
    if (this.alive().length <= 1) return this.finish();

    do {
      this.turnIndex = (this.turnIndex + 1) % this.tanks.length;
    } while (!this.tanks[this.turnIndex].alive);

    const t = this.tanks[this.turnIndex];
    this.turnNumber++;
    this.wind = Math.round(Math.random() * 20 - 10);
    t.fuel = TANK.fuel;
    this.phase = 'aim';

    this.turnTimer = this.later(() => this.onTimeout(), TURN.timeMs);
    this.emit('game:turn', {
      currentId: t.id,
      wind: this.wind,
      timeLeftMs: TURN.timeMs,
      turn: this.turnNumber,
      tank: publicTank(t),
    });

    if (t.isBot) this.later(() => this.botTurn(), 1200 + Math.random() * 1000);
  }

  onTimeout() {
    if (this.phase !== 'aim') return;
    const t = this.current();
    this.emit('game:msg', { text: `${t.name} hết giờ` });
    this.nextTurn();
  }

  finish() {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.clearTimers();
    const winner = this.alive()[0] ?? null;
    this.emit('game:over', {
      winnerId: winner ? winner.id : null,
      winnerName: winner ? winner.name : null,
      tanks: this.tanks.map(publicTank),
    });
    this.onOver?.();
  }

  removePlayer(id) {
    const t = this.tanks.find((x) => x.id === id);
    if (!t || t.left) return;
    const wasAlive = t.alive;
    t.alive = false;
    t.left = true;
    this.emit('game:left', { id, name: t.name });

    if (this.phase === 'over') return;
    const cur = this.current();
    if (this.phase === 'aim' && cur && cur.id === id && wasAlive) {
      this.cancel(this.turnTimer);
      this.nextTurn();
    } else if (this.phase !== 'resolving' && this.alive().length <= 1) {
      this.finish();
    }
  }

  // ---- hành động của người chơi ----

  isTurnOf(id) {
    const t = this.current();
    return this.phase === 'aim' && !!t && t.id === id && t.alive;
  }

  setAim(id, data) {
    if (!this.isTurnOf(id) || !data || typeof data !== 'object') return false;
    const t = this.current();
    this.applyAim(t, data);
    this.emit('game:aim', { id: t.id, angle: t.angle, power: t.power, weapon: t.weapon });
    return true;
  }

  applyAim(t, { angle, power, weapon }) {
    if (Number.isFinite(angle)) t.angle = clamp(angle, 0, 180);
    if (Number.isFinite(power)) t.power = clamp(power, 5, 100);
    const w = WEAPONS[weapon];
    if (w && (w.ammo < 0 || t.ammo[weapon] > 0)) t.weapon = weapon;
  }

  move(id, dir) {
    if (!this.isTurnOf(id) || (dir !== -1 && dir !== 1)) return false;
    const t = this.current();
    if (t.fuel <= 0) return false;

    const nx = clamp(t.x + dir * TANK.moveStep, TANK.margin, W - TANK.margin);
    if (nx === t.x) return false;

    const probeY = Math.round(t.y) - TANK.maxClimb - 1;
    if (this.terrain.isSolid(nx, probeY)) return false; // dốc quá cao
    const gy = this.terrain.groundBelow(nx, probeY);
    if (gy < 0) return false; // phía trước là vực

    t.x = nx;
    t.y = gy;
    t.fuel = Math.max(0, t.fuel - TANK.moveStep);
    this.emit('game:move', { id: t.id, x: t.x, y: t.y, fuel: t.fuel });
    return true;
  }

  fire(id) {
    if (!this.isTurnOf(id)) return { ok: false, error: 'Chưa tới lượt bạn' };
    const t = this.current();
    const w = WEAPONS[t.weapon];
    if (w.ammo >= 0 && t.ammo[t.weapon] <= 0) return { ok: false, error: 'Hết đạn loại này' };

    this.cancel(this.turnTimer);
    this.phase = 'resolving';
    if (w.ammo >= 0) t.ammo[t.weapon]--;

    // 1. Mô phỏng mọi viên đạn trên địa hình trước khi có vụ nổ nào
    const shells = [];
    for (let i = 0; i < w.shells; i++) {
      const angle = clamp(t.angle + (i - (w.shells - 1) / 2) * w.spread, 0, 180);
      const m = muzzlePos(t, angle);
      shells.push(
        simulateShell({
          terrain: this.terrain,
          tanks: this.tanks,
          shooterId: t.id,
          x: m.x,
          y: m.y,
          angleDeg: angle,
          power: t.power,
          wind: this.wind,
        }),
      );
    }

    // 2. Tính sát thương rồi đục địa hình
    const explosions = [];
    shells.forEach((s, i) => {
      if (s.impact.type !== 'ground' && s.impact.type !== 'tank') return;
      const { x, y } = s.impact;
      const hits = this.damage(x, y, w);
      this.terrain.carve(x, y, w.radius);
      explosions.push({ shell: i, x, y, r: w.radius, hits });
    });

    // 3. Xe tăng rơi xuống mặt đất mới
    this.settle();

    if (w.ammo >= 0 && t.ammo[t.weapon] === 0) t.weapon = 'normal';

    const frames = Math.max(...shells.map((s) => s.path.length / 2));
    this.emit('game:shot', {
      shooterId: t.id,
      weapon: w.id,
      shells: shells.map((s) => ({ path: s.path, impact: s.impact })),
      explosions,
      tanks: this.tanks.map(publicTank),
    });

    this.later(() => this.nextTurn(), Math.round(frames * (1000 / 60)) + TURN.settleMs);
    return { ok: true };
  }

  damage(x, y, weapon) {
    const hits = [];
    const reach = weapon.radius + TANK.radius;
    for (const t of this.tanks) {
      if (!t.alive) continue;
      const d = Math.hypot(t.x - x, t.y - TANK.centerOffset - y);
      if (d >= reach) continue;
      const falloff = 1 - Math.max(0, d - 10) / reach;
      const dmg = Math.max(1, Math.round(weapon.damage * falloff));
      t.hp = Math.max(0, t.hp - dmg);
      if (t.hp === 0) t.alive = false;
      hits.push({ id: t.id, dmg, hp: t.hp, alive: t.alive });
    }
    return hits;
  }

  settle() {
    for (const t of this.tanks) {
      if (!t.alive) continue;
      const gy = this.terrain.groundBelow(t.x, t.y - 12);
      if (gy < 0) {
        t.alive = false; // rơi xuống vực
        t.hp = 0;
      } else {
        t.y = gy;
      }
    }
  }

  // ---- bot ----

  botTurn() {
    const t = this.current();
    if (!t || !t.isBot || this.phase !== 'aim') return;
    const plan = planBotShot(this, t);
    if (!plan) return this.nextTurn();
    this.applyAim(t, plan);
    this.emit('game:aim', { id: t.id, angle: t.angle, power: t.power, weapon: t.weapon });
    this.later(() => this.fire(t.id), 900);
  }
}
