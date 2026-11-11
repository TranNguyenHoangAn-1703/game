// Vật lý thuần: sinh địa hình, địa hình bị đào, mô phỏng đường bay của đạn.
// Không phụ thuộc socket nên test và bot dùng lại được.

import { WORLD, PHYSICS, TANK } from '../shared/config.js';

const { width: W, height: H } = WORLD;

export function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round1 = (v) => Math.round(v * 10) / 10;

/** Chiều cao mặt đất cho từng cột x, cộng từ vài sóng sin ngẫu nhiên. */
export function generateHeights(seed) {
  const rnd = mulberry32(seed);
  const waves = [
    { amp: 70 + rnd() * 50, freq: ((1 + rnd() * 1.5) * 2 * Math.PI) / W, ph: rnd() * Math.PI * 2 },
    { amp: 35 + rnd() * 30, freq: ((3 + rnd() * 2) * 2 * Math.PI) / W, ph: rnd() * Math.PI * 2 },
    { amp: 12 + rnd() * 10, freq: ((8 + rnd() * 5) * 2 * Math.PI) / W, ph: rnd() * Math.PI * 2 },
  ];
  const base = H * 0.62;
  const heights = new Int16Array(W);
  for (let x = 0; x < W; x++) {
    let h = base;
    for (const w of waves) h += w.amp * Math.sin(x * w.freq + w.ph);
    heights[x] = Math.round(clamp(h, H * 0.3, H * 0.88));
  }
  return heights;
}

/** Địa hình dạng bitmap: 1 là đất, 0 là trống. Đạn nổ thì đục lỗ tròn. */
export class Terrain {
  constructor(heights) {
    this.heights = heights;
    this.solid = new Uint8Array(W * H);
    for (let x = 0; x < W; x++) {
      for (let y = heights[x]; y < H; y++) this.solid[y * W + x] = 1;
    }
  }

  isSolid(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= W || iy < 0 || iy >= H) return false;
    return this.solid[iy * W + ix] === 1;
  }

  carve(cx, cy, r) {
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(H - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      const half = Math.sqrt(Math.max(0, r * r - dy * dy));
      const x0 = Math.max(0, Math.ceil(cx - half));
      const x1 = Math.min(W - 1, Math.floor(cx + half));
      for (let x = x0; x <= x1; x++) this.solid[y * W + x] = 0;
    }
  }

  /** Tìm điểm đất đầu tiên bên dưới (x, fromY). Trả -1 nếu bên dưới không còn đất. */
  groundBelow(x, fromY = 0) {
    const ix = clamp(Math.round(x), 0, W - 1);
    for (let y = Math.max(0, Math.floor(fromY)); y < H; y++) {
      if (this.solid[y * W + ix]) return y;
    }
    return -1;
  }
}

/** Vị trí đầu nòng của xe tăng ứng với một góc bắn. */
export function muzzlePos(tank, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  return {
    x: tank.x + Math.cos(a) * TANK.muzzle,
    y: tank.y - TANK.centerOffset - Math.sin(a) * TANK.muzzle,
  };
}

/**
 * Mô phỏng một viên đạn từ lúc rời nòng tới lúc chạm.
 * Góc đo từ trục +x ngược chiều kim đồng hồ: 0 là sang phải, 90 là thẳng lên, 180 là sang trái.
 * Trả về đường bay (mỗi frame một điểm, mảng phẳng x,y,x,y...) và điểm va chạm.
 */
export function simulateShell({ terrain, tanks, shooterId, x, y, angleDeg, power, wind }) {
  const a = (angleDeg * Math.PI) / 180;
  const speed = power * PHYSICS.speedPerPower;
  let vx = Math.cos(a) * speed;
  let vy = -Math.sin(a) * speed;
  const sub = PHYSICS.substeps;
  const dt = 1 / sub;
  const r2 = TANK.radius * TANK.radius;
  const path = [round1(x), round1(y)];
  let impact = { type: 'timeout', x, y };

  for (let f = 0; f < PHYSICS.maxFrames; f++) {
    let hit = null;
    for (let s = 0; s < sub && !hit; s++) {
      vx += wind * PHYSICS.windAccel * dt;
      vy += PHYSICS.gravity * dt;
      x += vx * dt;
      y += vy * dt;

      if (x < -60 || x > W + 60) hit = { type: 'out' };
      else if (y > H) hit = { type: 'water' };
      else if (terrain.isSolid(x, y)) hit = { type: 'ground' };
      else {
        for (const t of tanks) {
          if (!t.alive) continue;
          if (t.id === shooterId && f < 10) continue; // tránh tự bắn trúng mình ngay khi rời nòng
          const dx = x - t.x;
          const dy = y - (t.y - TANK.centerOffset);
          if (dx * dx + dy * dy <= r2) {
            hit = { type: 'tank', id: t.id };
            break;
          }
        }
      }
    }
    path.push(round1(x), round1(y));
    if (hit) {
      impact = { ...hit, x: round1(x), y: round1(y) };
      break;
    }
    if (f === PHYSICS.maxFrames - 1) impact = { type: 'timeout', x: round1(x), y: round1(y) };
  }
  return { path, impact };
}
