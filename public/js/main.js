// Client: kết nối Socket.IO, nhận sự kiện từ server, vẽ và đọc phím/chuột.
// Server là nơi quyết định mọi thứ, client chỉ gửi ý định và phát lại kết quả.

import { WORLD, WEAPONS, WEAPON_ORDER, TANK } from '/shared/config.js';
import { buildBackground, buildTerrain, carveTerrain, drawCloud, drawTank, Effects } from './render.js';
import { sound } from './sound.js';

const { width: W, height: H } = WORLD;
const socket = io();
const $ = (sel) => document.querySelector(sel);
const canvas = $('#game');
const g = canvas.getContext('2d');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const bgImage = buildBackground();

const S = {
  screen: 'menu', // menu | lobby | game | result
  room: null,
  tanks: [],
  terrain: buildTerrain(decorHeights()),
  wind: 0,
  turnId: null,
  turnEndsAt: 0,
  phase: 'idle', // idle | aim | firing | resolving | over
  anim: null,
  queue: [],
  effects: new Effects(),
  clouds: Array.from({ length: 7 }, () => ({
    x: Math.random() * W,
    y: 40 + Math.random() * 260,
    w: 140 + Math.random() * 140,
    s: 0.5 + Math.random() * 0.8,
  })),
  keys: new Set(),
  aimDirty: false,
  lastAimSent: 0,
  moveCooldown: 0,
  pointer: false,
  lastTimerShown: -1,
};

/** Đồi thấp để làm nền cho màn hình menu. */
function decorHeights() {
  return Array.from({ length: W }, (_, x) => Math.round(560 + Math.sin(x / 170) * 50 + Math.sin(x / 55) * 16));
}

const tankById = (id) => S.tanks.find((t) => t.id === id);
const myTank = () => tankById(socket.id);
const isMyTurn = () => S.phase === 'aim' && S.turnId === socket.id;

/** Tạo phần tử DOM bằng textContent, không bao giờ chèn HTML từ người chơi khác. */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

// ================= Màn hình =================

function show(screen) {
  S.screen = screen;
  for (const id of ['menu', 'lobby', 'result']) $('#' + id).classList.toggle('hidden', id !== screen);
  $('#hud').classList.toggle('hidden', screen !== 'game' && screen !== 'result');
}

let toastTimer = 0;
function toast(msg) {
  const node = $('#toast');
  node.textContent = msg;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2200);
}

// ================= Menu =================

const nameInput = $('#name');
nameInput.value = localStorage.getItem('pho-thu-name') || '';
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) $('#code').value = urlRoom.toUpperCase().slice(0, 4);

function menuError(msg) {
  $('#menu-error').textContent = msg || '';
}

function afterJoin(res) {
  if (!res?.ok) menuError(res?.error || 'Không vào được phòng');
  else menuError('');
}

function readName() {
  const name = nameInput.value.trim();
  localStorage.setItem('pho-thu-name', name);
  return name;
}

$('#btn-create').addEventListener('click', () => {
  sound.unlock();
  socket.emit('room:create', { name: readName() }, afterJoin);
});

$('#btn-join').addEventListener('click', () => {
  sound.unlock();
  const code = $('#code').value.trim();
  if (code.length !== 4) return menuError('Mã phòng gồm 4 chữ cái');
  socket.emit('room:join', { code, name: readName() }, afterJoin);
});

// ================= Phòng chờ =================

function renderLobby() {
  const info = S.room;
  if (!info) return;
  const isHost = info.hostId === socket.id;
  $('#room-code').textContent = info.code;

  const list = $('#lobby-players');
  list.replaceChildren();
  info.players.forEach((p) => {
    const li = el('li', {}, [
      el('i', { style: { background: ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'][list.children.length % 4] } }),
      el('span', { text: p.name }),
    ]);
    if (p.id === info.hostId) li.append(el('em', { text: 'chủ phòng' }));
    if (p.isBot) {
      li.append(el('em', { text: 'máy' }));
      if (isHost) {
        li.append(el('button', { type: 'button', text: '×', title: 'Xóa máy', onclick: () => socket.emit('room:removeBot', { id: p.id }) }));
      }
    }
    list.append(li);
  });

  $('#btn-bot').classList.toggle('hidden', !isHost);
  $('#btn-bot').disabled = info.players.length >= info.max;
  $('#btn-start').classList.toggle('hidden', !isHost);
  $('#btn-start').disabled = info.players.length < info.min;
  $('#lobby-hint').textContent = isHost
    ? info.players.length < info.min
      ? 'Cần thêm ít nhất một người hoặc một máy để bắt đầu.'
      : ''
    : 'Đang chờ chủ phòng bắt đầu.';
}

$('#btn-bot').addEventListener('click', () => socket.emit('room:addBot', null, (r) => !r?.ok && toast(r?.error || 'Không thêm được')));
$('#btn-start').addEventListener('click', () => {
  sound.unlock();
  socket.emit('room:start', null, (r) => !r?.ok && toast(r?.error || 'Không bắt đầu được'));
});
$('#btn-leave').addEventListener('click', () => {
  socket.emit('room:leave');
  S.room = null;
  show('menu');
});
$('#btn-copy').addEventListener('click', async () => {
  const link = `${location.origin}/?room=${S.room?.code ?? ''}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Đã sao chép liên kết');
  } catch {
    toast(link);
  }
});
$('#btn-back').addEventListener('click', () => show(S.room ? 'lobby' : 'menu'));

socket.on('room:update', (info) => {
  S.room = info;
  if (S.screen === 'menu') show('lobby');
  renderLobby();
});

socket.on('disconnect', () => {
  S.room = null;
  S.phase = 'idle';
  show('menu');
  menuError('Mất kết nối tới máy chủ');
});

// ================= Sự kiện trong ván =================

function afterAnim(fn) {
  if (S.anim) S.queue.push(fn);
  else fn();
}

function flushQueue() {
  while (S.queue.length && !S.anim) S.queue.shift()();
}

socket.on('game:start', (d) => {
  S.tanks = d.tanks.map((t) => ({ ...t, rx: t.x, ry: t.y, ra: t.angle }));
  S.terrain = buildTerrain(d.heights);
  S.effects = new Effects();
  S.anim = null;
  S.queue = [];
  S.phase = 'idle';
  S.turnId = null;
  S.wind = 0;
  show('game');
  updateHud();
  toast('Trận đấu bắt đầu');
});

socket.on('game:turn', (d) =>
  afterAnim(() => {
    S.turnId = d.currentId;
    S.wind = d.wind;
    S.turnEndsAt = performance.now() + d.timeLeftMs;
    S.phase = 'aim';
    S.lastTimerShown = -1;
    const t = tankById(d.currentId);
    if (t) Object.assign(t, d.tank);
    toast(d.currentId === socket.id ? 'Đến lượt bạn' : `Lượt của ${t?.name ?? '...'}`);
    updateHud();
  }),
);

socket.on('game:aim', (d) => {
  if (d.id === socket.id) return; // bản của mình đã có sẵn ở máy này
  const t = tankById(d.id);
  if (!t) return;
  t.angle = d.angle;
  t.power = d.power;
  t.weapon = d.weapon;
  updateHud();
});

socket.on('game:move', (d) => {
  const t = tankById(d.id);
  if (!t) return;
  t.x = d.x;
  t.y = d.y;
  t.fuel = d.fuel;
  if (d.id === socket.id) updateHud();
});

socket.on('game:msg', (d) => toast(d.text));

socket.on('game:left', (d) => {
  const t = tankById(d.id);
  if (t && t.alive) {
    t.alive = false;
    S.effects.explosion(t.rx, t.ry - TANK.centerOffset, 45);
    sound.explode(45);
  }
  toast(`${d.name} đã thoát`);
  updateHud();
});

socket.on('game:shot', (d) => {
  S.phase = 'resolving';
  $('#timer').textContent = '…';
  for (const ft of d.tanks) {
    const t = tankById(ft.id);
    if (!t) continue;
    t.ammo = ft.ammo;
    if (ft.id === d.shooterId) t.weapon = ft.weapon;
  }
  S.anim = {
    shells: d.shells.map((s) => ({ path: s.path, i: 0, done: false, trail: [] })),
    explosions: d.explosions,
    final: d.tanks,
    weapon: WEAPONS[d.weapon],
    settle: 0,
  };
  sound.shoot();
  updateHud();
});

socket.on('game:over', (d) =>
  afterAnim(() => {
    S.phase = 'over';
    const mine = d.winnerId === socket.id;
    $('#result-title').textContent = d.winnerName ? (mine ? 'Bạn thắng!' : `${d.winnerName} thắng`) : 'Hòa';
    $('#result-sub').textContent = mine ? 'Bắn chuẩn lắm.' : 'Ván sau sẽ khác.';
    show('result');
  }),
);

// ================= Hoạt ảnh phát đạn =================

function explode(ex) {
  carveTerrain(S.terrain, ex.x, ex.y, ex.r);
  S.effects.explosion(ex.x, ex.y, ex.r);
  sound.explode(ex.r);
  for (const h of ex.hits) {
    const t = tankById(h.id);
    if (!t) continue;
    t.hp = h.hp;
    S.effects.text(t.rx, t.ry - 78, `-${h.dmg}`);
    if (!h.alive && t.alive) {
      t.alive = false;
      S.effects.explosion(t.rx, t.ry - TANK.centerOffset, 55);
      sound.explode(60);
    }
  }
  updateHud();
}

function stepAnim() {
  const a = S.anim;
  let allDone = true;

  a.shells.forEach((sh, idx) => {
    if (sh.done) return;
    const last = sh.path.length / 2 - 1;
    sh.i = Math.min(sh.i + 1, last);
    sh.trail.push([sh.path[sh.i * 2], sh.path[sh.i * 2 + 1]]);
    if (sh.trail.length > 18) sh.trail.shift();
    if (sh.i >= last) {
      sh.done = true;
      const ex = a.explosions.find((e) => e.shell === idx);
      if (ex) explode(ex);
    } else {
      allDone = false;
    }
  });

  if (!allDone) return;
  a.settle++;

  if (a.settle === 1) {
    // Đất đã bị đục xong, xe tăng rơi xuống vị trí mới do server tính
    for (const ft of a.final) {
      const t = tankById(ft.id);
      if (!t) continue;
      t.x = ft.x;
      t.y = ft.y;
      t.hp = ft.hp;
      t.fuel = ft.fuel;
      if (t.alive && !ft.alive) {
        t.alive = false;
        S.effects.explosion(t.rx, t.ry - TANK.centerOffset, 55);
        sound.explode(60);
      }
    }
    updateHud();
  }

  if (a.settle > 75) {
    S.anim = null;
    flushQueue();
  }
}

// ================= HUD =================

const weaponButtons = WEAPON_ORDER.map((id, i) => {
  const btn = el('button', { type: 'button', 'data-w': id, onclick: () => selectWeapon(id) }, [
    el('span', { text: `${i + 1} ${WEAPONS[id].name}` }),
    el('small', { text: '' }),
  ]);
  $('#weapons').append(btn);
  return btn;
});

function updateHud() {
  updateTopbar();
  updateControls();
  updateRoster();
}

function updateTopbar() {
  const cur = tankById(S.turnId);
  $('#turn-name').textContent = S.phase === 'idle' ? 'Chuẩn bị...' : cur ? cur.name : '';
  $('#turn-name').style.color = cur?.color ?? '#fff';

  const w = S.wind;
  $('#wind-arrow').textContent = w === 0 ? '·' : (w > 0 ? '→' : '←').repeat(Math.max(1, Math.ceil(Math.abs(w) / 3)));
  $('#wind-val').textContent = Math.abs(w);
}

function updateControls() {
  const me = myTank();
  if (me) {
    $('#v-angle').textContent = Math.round(me.angle);
    $('#v-power').textContent = Math.round(me.power);
    $('#power-fill').style.width = `${me.power}%`;
    $('#fuel-fill').style.width = `${Math.round((100 * me.fuel) / TANK.fuel)}%`;
    for (const btn of weaponButtons) {
      const id = btn.dataset.w;
      const def = WEAPONS[id];
      btn.querySelector('small').textContent = def.ammo < 0 ? '∞' : `x${me.ammo[id]}`;
      btn.classList.toggle('active', me.weapon === id);
      btn.disabled = def.ammo >= 0 && me.ammo[id] <= 0;
    }
  }
  $('#controls').classList.toggle('inactive', !isMyTurn() || !me?.alive);
}

function updateRoster() {
  const list = $('#players');
  list.replaceChildren();
  for (const t of S.tanks) {
    const li = el('li', { class: `${t.alive ? '' : 'dead'} ${t.id === S.turnId && t.alive ? 'turn' : ''}` }, [
      el('i', { style: { background: t.color } }),
      el('span', { text: t.name }),
      el('div', { class: 'hp' }, [el('b', { style: { width: `${Math.max(0, t.hp)}%` } })]),
    ]);
    list.append(li);
  }
}

// ================= Điều khiển =================

function selectWeapon(id) {
  const t = myTank();
  if (!isMyTurn() || !t) return;
  const def = WEAPONS[id];
  if (def.ammo >= 0 && t.ammo[id] <= 0) return;
  t.weapon = id;
  S.aimDirty = true;
  updateHud();
}

function sendAim(force = false) {
  const t = myTank();
  if (!t || !S.aimDirty) return;
  const now = performance.now();
  if (!force && now - S.lastAimSent < 60) return;
  S.lastAimSent = now;
  S.aimDirty = false;
  socket.emit('game:aim', { angle: Math.round(t.angle * 10) / 10, power: Math.round(t.power * 10) / 10, weapon: t.weapon });
}

function fire() {
  if (!isMyTurn()) return;
  sendAim(true);
  S.phase = 'firing';
  socket.emit('game:fire', null, (res) => {
    if (!res?.ok && S.phase === 'firing') {
      S.phase = 'aim';
      toast(res?.error || 'Không bắn được');
    }
  });
}

function handleInput() {
  if (!isMyTurn()) return;
  const t = myTank();
  if (!t) return;
  const k = S.keys;
  const fine = k.has('shift') ? 0.25 : 1;
  const left = k.has('arrowleft') || k.has('a');
  const right = k.has('arrowright') || k.has('d');
  const up = k.has('arrowup') || k.has('w');
  const down = k.has('arrowdown') || k.has('s');
  let changed = false;

  // Đi sang trái thì quay nòng sang trái, và ngược lại
  if (left && t.angle < 90) {
    t.angle = 180 - t.angle;
    changed = true;
  } else if (right && t.angle > 90) {
    t.angle = 180 - t.angle;
    changed = true;
  }

  if (up || down) {
    const step = 0.6 * fine * (up ? 1 : -1); // dương nghĩa là nâng nòng
    t.angle = t.angle <= 90 ? clamp(t.angle + step, 0, 90) : clamp(t.angle - step, 90.01, 180);
    changed = true;
  }
  if (k.has('e') || k.has('q')) {
    t.power = clamp(t.power + (k.has('e') ? 0.5 : -0.5) * fine, 5, 100);
    changed = true;
  }
  if (changed) {
    t.ra = t.angle;
    S.aimDirty = true;
    updateControls();
  }

  S.moveCooldown--;
  const dir = (right ? 1 : 0) - (left ? 1 : 0);
  if (dir && S.moveCooldown <= 0 && t.fuel > 0) {
    socket.emit('game:move', { dir });
    S.moveCooldown = 3;
  }
  sendAim();
}

window.addEventListener('keydown', (e) => {
  if (S.screen !== 'game' || e.target.tagName === 'INPUT') return;
  const key = e.key.toLowerCase();
  if (key === 'm') {
    toast(sound.toggle() ? 'Đã tắt âm thanh' : 'Đã bật âm thanh');
    return;
  }
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) e.preventDefault();
  S.keys.add(key);
  if (e.repeat) return;
  if (key === ' ' || key === 'enter') fire();
  const n = Number(key);
  if (n >= 1 && n <= WEAPON_ORDER.length) selectWeapon(WEAPON_ORDER[n - 1]);
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') e.preventDefault();
  S.keys.delete(e.key.toLowerCase());
});
window.addEventListener('blur', () => S.keys.clear());

function pointerAim(e) {
  const t = myTank();
  if (!t || !isMyTurn()) return;
  const r = canvas.getBoundingClientRect();
  const px = (e.clientX - r.left) * (W / r.width);
  const py = (e.clientY - r.top) * (H / r.height);
  const dx = px - t.rx;
  const dy = t.ry - TANK.centerOffset - py;
  let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (ang < 0) ang = dx >= 0 ? 0 : 180;
  t.angle = ang;
  t.ra = ang;
  t.power = clamp(Math.hypot(dx, dy) / 6, 5, 100);
  S.aimDirty = true;
  updateControls();
}

canvas.addEventListener('pointerdown', (e) => {
  if (S.screen !== 'game') return;
  S.pointer = true;
  canvas.setPointerCapture(e.pointerId);
  pointerAim(e);
});
canvas.addEventListener('pointermove', (e) => S.pointer && pointerAim(e));
canvas.addEventListener('pointerup', () => (S.pointer = false));
canvas.addEventListener('pointercancel', () => (S.pointer = false));
canvas.addEventListener(
  'wheel',
  (e) => {
    const t = myTank();
    if (S.screen !== 'game' || !t || !isMyTurn()) return;
    e.preventDefault();
    t.power = clamp(t.power + (e.deltaY < 0 ? 2 : -2), 5, 100);
    S.aimDirty = true;
    updateControls();
  },
  { passive: false },
);

$('#btn-fire').addEventListener('click', () => {
  fire();
  document.activeElement?.blur();
});
$('#btn-mute').addEventListener('click', () => {
  toast(sound.toggle() ? 'Đã tắt âm thanh' : 'Đã bật âm thanh');
  document.activeElement?.blur();
});

// ================= Vòng lặp =================

function tick() {
  if (S.screen === 'game') handleInput();
  if (S.anim) stepAnim();

  for (const t of S.tanks) {
    t.rx += (t.x - t.rx) * 0.25;
    t.ry += (t.y - t.ry) * 0.25;
    if (Math.abs(t.x - t.rx) < 0.1) t.rx = t.x;
    if (Math.abs(t.y - t.ry) < 0.1) t.ry = t.y;
    t.ra = t.id === socket.id ? t.angle : t.ra + (t.angle - t.ra) * 0.3;
  }
  S.effects.update();

  for (const c of S.clouds) {
    c.x += (0.15 + S.wind * 0.04) * c.s;
    if (c.x > W + 200) c.x = -200;
    if (c.x < -200) c.x = W + 200;
  }

  if (S.phase === 'aim') {
    const left = Math.max(0, Math.ceil((S.turnEndsAt - performance.now()) / 1000));
    if (left !== S.lastTimerShown) {
      S.lastTimerShown = left;
      $('#timer').textContent = left;
      $('#timer').classList.toggle('urgent', left <= 5);
      if (left > 0 && left <= 5 && isMyTurn()) sound.tick();
    }
  }
}

function render(now) {
  g.save();
  g.clearRect(0, 0, W, H);
  if (S.effects.shake > 0.5) g.translate((Math.random() - 0.5) * S.effects.shake, (Math.random() - 0.5) * S.effects.shake);

  g.drawImage(bgImage, 0, 0);
  for (const c of S.clouds) drawCloud(g, c);
  g.drawImage(S.terrain, 0, 0);

  for (const t of S.tanks) {
    if (!t.alive) continue;
    drawTank(g, t, { turn: t.id === S.turnId && S.phase === 'aim', mine: t.id === socket.id, time: now });
  }

  if (S.anim) {
    const big = S.anim.weapon?.id === 'big';
    for (const sh of S.anim.shells) {
      if (sh.done) continue;
      sh.trail.forEach(([x, y], i) => {
        g.fillStyle = `rgba(255,200,120,${(i / sh.trail.length) * 0.5})`;
        g.beginPath();
        g.arc(x, y, 2 + (i / sh.trail.length) * 2, 0, Math.PI * 2);
        g.fill();
      });
      const x = sh.path[sh.i * 2];
      const y = sh.path[sh.i * 2 + 1];
      g.fillStyle = '#2a2a2a';
      g.strokeStyle = '#ffb020';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, big ? 7 : 5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }

  S.effects.draw(g);
  g.restore();
}

let last = performance.now();
let acc = 0;
function frame(now) {
  acc += Math.min(100, now - last);
  last = now;
  while (acc >= 1000 / 60) {
    tick();
    acc -= 1000 / 60;
  }
  render(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
