// Mọi thứ liên quan tới vẽ: nền trời, địa hình (canvas riêng, đục lỗ khi nổ),
// xe tăng và hiệu ứng nổ.

import { WORLD, TANK } from '/shared/config.js';

const { width: W, height: H } = WORLD;
const TAU = Math.PI * 2;

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Làm tối (amt < 0) hoặc sáng (amt > 0) một màu hex #rrggbb. */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `rgb(${r},${g},${b})`;
}

// ---------- Nền ----------

function ridge(g, base, amp, phase, color) {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) {
    const y = base - amp * (0.5 + 0.5 * Math.sin(x * 0.004 + phase)) - amp * 0.35 * Math.sin(x * 0.011 + phase * 2);
    g.lineTo(x, y);
  }
  g.lineTo(W, H);
  g.closePath();
  g.fill();
}

export function buildBackground() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');

  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#4aa8e8');
  sky.addColorStop(0.65, '#bfe6ff');
  sky.addColorStop(1, '#f4fbff');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  const sun = g.createRadialGradient(1250, 150, 10, 1250, 150, 170);
  sun.addColorStop(0, 'rgba(255,252,210,1)');
  sun.addColorStop(0.25, 'rgba(255,240,170,.85)');
  sun.addColorStop(1, 'rgba(255,240,170,0)');
  g.fillStyle = sun;
  g.fillRect(850, 0, 750, 450);

  ridge(g, 470, 150, 0.6, '#9dbfe0');
  ridge(g, 560, 110, 2.1, '#7fa6cf');
  return c;
}

export function drawCloud(g, c) {
  g.fillStyle = 'rgba(255,255,255,.86)';
  const parts = [
    [0, 0, 0.5, 0.17],
    [-0.24, 0.04, 0.3, 0.12],
    [0.26, 0.05, 0.28, 0.11],
    [0.05, -0.08, 0.28, 0.14],
  ];
  for (const [dx, dy, rx, ry] of parts) {
    g.beginPath();
    g.ellipse(c.x + dx * c.w, c.y + dy * c.w, rx * c.w, ry * c.w, 0, 0, TAU);
    g.fill();
  }
}

// ---------- Địa hình ----------

export function buildTerrain(heights) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');

  g.beginPath();
  g.moveTo(0, H);
  for (let x = 0; x < W; x++) g.lineTo(x, heights[x]);
  g.lineTo(W, H);
  g.closePath();
  const dirt = g.createLinearGradient(0, H * 0.3, 0, H);
  dirt.addColorStop(0, '#9a6a37');
  dirt.addColorStop(1, '#3b2412');
  g.fillStyle = dirt;
  g.fill();

  // Từ đây chỉ vẽ lên phần đất đã có
  g.globalCompositeOperation = 'source-atop';

  let seed = 20240607;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,.12)' : 'rgba(255,225,170,.08)';
    g.beginPath();
    g.arc(rnd() * W, H * 0.25 + rnd() * H * 0.75, 1 + rnd() * 3.5, 0, TAU);
    g.fill();
  }

  g.lineJoin = 'round';
  g.beginPath();
  for (let x = 0; x < W; x++) (x ? g.lineTo(x, heights[x]) : g.moveTo(x, heights[x]));
  g.lineWidth = 18;
  g.strokeStyle = '#3f9a45';
  g.stroke();
  g.lineWidth = 8;
  g.strokeStyle = '#7ed957';
  g.stroke();
  return c;
}

/** Đục một hố tròn và làm sẫm viền xung quanh cho giống vết cháy. */
export function carveTerrain(canvas, x, y, r) {
  const g = canvas.getContext('2d');
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(25,12,0,.55)';
  g.beginPath();
  g.arc(x, y, r + 6, 0, TAU);
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.restore();
}

// ---------- Xe tăng ----------

export function drawTank(g, t, o) {
  const x = t.rx;
  const y = t.ry;
  const cy = y - TANK.centerOffset;
  const a = (t.ra * Math.PI) / 180;

  g.fillStyle = 'rgba(0,0,0,.25)';
  g.beginPath();
  g.ellipse(x, y, 23, 5, 0, 0, TAU);
  g.fill();

  // nòng pháo
  g.save();
  g.translate(x, cy);
  g.rotate(-a);
  g.fillStyle = '#2b2f36';
  rr(g, 0, -3.5, TANK.muzzle, 7, 3);
  g.fill();
  g.fillStyle = '#4b5260';
  g.fillRect(TANK.muzzle - 6, -4.5, 6, 9);
  g.restore();

  // xích
  g.fillStyle = '#23262c';
  rr(g, x - 21, y - 9, 42, 11, 5);
  g.fill();
  g.fillStyle = '#5b616d';
  for (let i = -3; i <= 3; i++) {
    g.beginPath();
    g.arc(x + i * 6, y - 3.5, 2.6, 0, TAU);
    g.fill();
  }

  // thân và tháp pháo
  g.fillStyle = t.color;
  rr(g, x - 16, y - 21, 32, 14, 4);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,.22)';
  rr(g, x - 14, y - 20, 28, 4, 2);
  g.fill();
  g.fillStyle = shade(t.color, -0.12);
  g.beginPath();
  g.arc(x, cy, 9, 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,.35)';
  g.lineWidth = 1.5;
  g.stroke();

  // đường ngắm cho người chơi đang có lượt
  if (o.mine && o.turn) {
    const len = 30 + t.power * 1.1;
    g.save();
    g.setLineDash([3, 7]);
    g.lineWidth = 2.5;
    g.strokeStyle = 'rgba(255,255,255,.9)';
    g.beginPath();
    g.moveTo(x + Math.cos(a) * TANK.muzzle, cy - Math.sin(a) * TANK.muzzle);
    g.lineTo(x + Math.cos(a) * (TANK.muzzle + len), cy - Math.sin(a) * (TANK.muzzle + len));
    g.stroke();
    g.restore();
  }

  // tên và thanh máu
  const top = y - 58;
  g.font = 'bold 14px system-ui, sans-serif';
  g.textAlign = 'center';
  g.lineJoin = 'round';
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(0,0,0,.65)';
  g.strokeText(t.name, x, top - 8);
  g.fillStyle = '#fff';
  g.fillText(t.name, x, top - 8);

  g.fillStyle = 'rgba(0,0,0,.6)';
  rr(g, x - 25, top, 50, 8, 4);
  g.fill();
  const pct = Math.max(0, t.hp) / TANK.maxHp;
  g.fillStyle = pct > 0.5 ? '#43d17a' : pct > 0.25 ? '#f1c40f' : '#ff5252';
  if (pct > 0) {
    rr(g, x - 24, top + 1, 48 * pct, 6, 3);
    g.fill();
  }

  if (o.turn) {
    const bob = Math.sin(o.time / 180) * 4;
    const ay = top - 34 + bob;
    g.fillStyle = t.color;
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, ay + 12);
    g.lineTo(x - 9, ay);
    g.lineTo(x + 9, ay);
    g.closePath();
    g.fill();
    g.stroke();
  }
}

// ---------- Hiệu ứng ----------

export class Effects {
  constructor() {
    this.parts = [];
    this.rings = [];
    this.texts = [];
    this.shake = 0;
  }

  explosion(x, y, r) {
    const n = Math.round(r * 1.2);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * TAU;
      const sp = Math.random() * r * 0.11 + 0.5;
      const life = 24 + Math.random() * 30;
      this.parts.push({
        kind: 'fire',
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 0.4,
        g: -0.01,
        life,
        max: life,
        size: r * 0.12 + Math.random() * r * 0.14,
      });
    }
    for (let i = 0; i < n * 0.5; i++) {
      const life = 50 + Math.random() * 40;
      this.parts.push({
        kind: 'smoke',
        x: x + (Math.random() - 0.5) * r,
        y: y + (Math.random() - 0.5) * r * 0.5,
        vx: (Math.random() - 0.5) * 0.8,
        vy: -0.5 - Math.random() * 0.8,
        g: 0,
        life,
        max: life,
        size: r * 0.18 + Math.random() * r * 0.15,
      });
    }
    for (let i = 0; i < r * 0.5; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const sp = 2 + Math.random() * 6;
      const life = 50 + Math.random() * 30;
      this.parts.push({
        kind: 'debris',
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        g: 0.22,
        life,
        max: life,
        size: 2 + Math.random() * 3,
      });
    }
    this.rings.push({ x, y, r: r * 0.3, max: r * 1.5, life: 18, total: 18 });
    this.shake = Math.max(this.shake, Math.min(16, r * 0.22));
  }

  text(x, y, str, color = '#ff5252') {
    this.texts.push({ x, y, str, color, life: 70 });
  }

  update() {
    this.shake *= 0.88;
    for (const p of this.parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.g;
      p.vx *= 0.97;
      p.life--;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const r of this.rings) {
      r.r += (r.max - r.r) * 0.2;
      r.life--;
    }
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const t of this.texts) {
      t.y -= 0.8;
      t.life--;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
  }

  draw(g) {
    for (const p of this.parts) {
      const k = p.life / p.max;
      if (p.kind === 'fire') {
        g.fillStyle = `rgba(255,${Math.round(60 + 170 * k)},${Math.round(20 * k)},${0.25 + 0.75 * k})`;
        g.beginPath();
        g.arc(p.x, p.y, p.size * (0.5 + (1 - k) * 0.8), 0, TAU);
        g.fill();
      } else if (p.kind === 'smoke') {
        g.fillStyle = `rgba(70,70,70,${0.35 * k})`;
        g.beginPath();
        g.arc(p.x, p.y, p.size * (1.4 - k * 0.6), 0, TAU);
        g.fill();
      } else {
        g.fillStyle = `rgba(90,58,28,${Math.min(1, k * 2)})`;
        g.fillRect(p.x, p.y, p.size, p.size);
      }
    }
    for (const r of this.rings) {
      g.strokeStyle = `rgba(255,240,200,${r.life / r.total})`;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(r.x, r.y, r.r, 0, TAU);
      g.stroke();
    }
    g.font = 'bold 26px system-ui, sans-serif';
    g.textAlign = 'center';
    g.lineJoin = 'round';
    for (const t of this.texts) {
      g.globalAlpha = Math.min(1, t.life / 25);
      g.lineWidth = 5;
      g.strokeStyle = 'rgba(0,0,0,.7)';
      g.strokeText(t.str, t.x, t.y);
      g.fillStyle = t.color;
      g.fillText(t.str, t.x, t.y);
    }
    g.globalAlpha = 1;
  }
}
