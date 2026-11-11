// Hằng số dùng chung cho server và client.
// Server import qua đường dẫn tương đối, client import qua /shared/config.js.

export const WORLD = { width: 1600, height: 800 };

export const PHYSICS = {
  gravity: 0.12, // px / frame^2
  windAccel: 0.002, // gia tốc ngang cho mỗi đơn vị gió (px / frame^2)
  speedPerPower: 0.15, // vận tốc đầu = lực * hệ số này (px / frame)
  substeps: 4, // chia nhỏ mỗi frame để đạn không xuyên qua địa hình
  maxFrames: 1800, // quá 30 giây thì coi như đạn mất tích
};

export const TANK = {
  radius: 20, // bán kính va chạm
  centerOffset: 14, // tâm va chạm cách chân xe bao nhiêu px
  muzzle: 28, // chiều dài nòng, cũng là chỗ đạn xuất phát
  maxHp: 100,
  moveStep: 3, // mỗi lệnh di chuyển đi được bao nhiêu px
  fuel: 150, // tổng quãng đường mỗi lượt
  maxClimb: 7, // dốc cao hơn mức này thì xe không leo được
  margin: 24, // khoảng cách tối thiểu tới mép bản đồ
};

export const TURN = {
  timeMs: 30000, // thời gian suy nghĩ mỗi lượt
  settleMs: 1800, // chờ thêm sau khi đạn nổ để hiệu ứng chạy xong
  startDelayMs: 1500, // nghỉ trước lượt đầu tiên
};

export const LIMITS = { minPlayers: 2, maxPlayers: 4 };

export const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'];

// ammo: -1 nghĩa là không giới hạn
export const WEAPONS = {
  normal: { id: 'normal', name: 'Đạn thường', radius: 38, damage: 35, shells: 1, spread: 0, ammo: -1 },
  big: { id: 'big', name: 'Đạn lớn', radius: 62, damage: 55, shells: 1, spread: 0, ammo: 2 },
  triple: { id: 'triple', name: 'Ba tia', radius: 30, damage: 25, shells: 3, spread: 6, ammo: 2 },
};

export const WEAPON_ORDER = ['normal', 'big', 'triple'];
