// Bot đơn giản: thử hàng nghìn cặp (góc, lực) bằng chính hàm mô phỏng của server,
// chọn cặp rơi gần mục tiêu nhất rồi cộng thêm một chút sai số cho giống người.

import { TANK } from '../shared/config.js';
import { simulateShell, muzzlePos } from './physics.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const jitter = (range) => (Math.random() * 2 - 1) * range;

export function planBotShot(game, bot) {
  const enemies = game.tanks.filter((t) => t.alive && t.id !== bot.id);
  if (!enemies.length) return null;

  const target = enemies.reduce((a, b) => (Math.abs(a.x - bot.x) <= Math.abs(b.x - bot.x) ? a : b));
  const ty = target.y - TANK.centerOffset;
  const by = bot.y - TANK.centerOffset;

  let best = null;
  for (let angle = 15; angle <= 165; angle += 3) {
    const m = muzzlePos(bot, angle);
    for (let power = 20; power <= 100; power += 3) {
      const { impact } = simulateShell({
        terrain: game.terrain,
        tanks: game.tanks,
        shooterId: bot.id,
        x: m.x,
        y: m.y,
        angleDeg: angle,
        power,
        wind: game.wind,
      });
      if (impact.type !== 'ground' && impact.type !== 'tank') continue;
      if (Math.hypot(impact.x - bot.x, impact.y - by) < 90) continue; // đừng tự nổ vào mình
      const d = Math.hypot(impact.x - target.x, impact.y - ty);
      if (!best || d < best.d) best = { angle, power, d };
    }
  }

  const fallbackAngle = bot.x < target.x ? 45 : 135;
  const angle = clamp((best ? best.angle : fallbackAngle) + jitter(3), 0, 180);
  const power = clamp((best ? best.power : 60) + jitter(4), 10, 100);

  let weapon = 'normal';
  const roll = Math.random();
  if (bot.ammo.big > 0 && roll < 0.3) weapon = 'big';
  else if (bot.ammo.triple > 0 && roll < 0.55) weapon = 'triple';

  return { angle, power, weapon };
}
