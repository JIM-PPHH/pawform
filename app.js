import * as THREE from 'three';
import { STLExporter } from './STLExporter.js';

/* ================= 状态 ================= */
const DEFAULTS = {
  shape: 'rings', wave: 5, twist: 0,
  height: 120, rim: 160, diameter: 150, depth: 55, gap: 0.5, wall: 4,
  color: '#F7D959', font: 'round', petName: 'Momo',
  engrave: 'raised', decoration: 'flower', decoPos: 'right',
  fontSize: 24, textY: 48, textAngle: 0, textDepth: 1.2,
  support: true, bowlVisible: true,
};
const state = { ...DEFAULTS };

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sq = x => x * x;
const smoothstep = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const wrapPi = a => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

/* ================= 预设数据 ================= */
const MATERIALS = [
  ['丁香紫', 'Lilac Purple', '#AE96D4'], ['樱花粉', 'Sakura Pink', '#E8AFCF'],
  ['象牙白', 'Ivory White', '#FFFFFF'], ['骨白', 'Bone White', '#CBC6B8'],
  ['拿铁棕', 'Latte Brown', '#D3B7A7'], ['柠檬黄', 'Lemon Yellow', '#F7D959'],
  ['草绿', 'Grass Green', '#61C680'], ['冰蓝', 'Ice Blue', '#A3D8E1'],
  ['天空蓝', 'Sky Blue', '#56B7E6'], ['猩红', 'Scarlet Red', '#DE4343'],
  ['灰烬灰', 'Ash Gray', '#9B9EA0'], ['炭黑', 'Charcoal', '#000000'],
];

const FONTS = [
  { id: 'round', name: '软糖圆体', weight: 400, stack: '"Lilita One","Yuanti SC",YouYuan,STYuanti,"PingFang SC",sans-serif' },
  { id: 'sans', name: '圆润黑体', weight: 800, stack: 'Nunito,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif' },
  { id: 'serif', name: '经典衬线', weight: 400, stack: '"DM Serif Display","Songti SC",STSong,SimSun,serif' },
  { id: 'mono', name: '几何等宽', weight: 700, stack: '"Space Mono","Heiti SC",STHeiti,SimHei,"PingFang SC",sans-serif' },
  { id: 'kuaile', name: '萌趣快乐', weight: 400, stack: '"ZCOOL KuaiLe","Yuanti SC","PingFang SC",sans-serif' },
  { id: 'qingke', name: '黄油圆体', weight: 400, stack: '"ZCOOL QingKe HuangYou","PingFang SC","Hiragino Sans GB",sans-serif' },
  { id: 'kaiti', name: '手写楷体', weight: 400, stack: '"Zhi Mang Xing","Kaiti SC",STKaiti,KaiTi,"PingFang SC",sans-serif' },
  { id: 'mashan', name: '毛笔手写', weight: 400, stack: '"Ma Shan Zheng","STXingkai","Kaiti SC",sans-serif' },
];

const DECORATIONS = [
  ['none', '无装饰'], ['flower', '花朵'], ['heart', '爱心'],
  ['star', '星星'], ['paw', '爪印'], ['bone', '骨头'],
];

const SHAPES = [
  ['rings', '圆润叠圈'], ['bamboo', '竹节'], ['ribbed', '细密竖纹'], ['smooth', '极简圆筒'],
  ['petal', '花瓣'], ['wave', '波浪'], ['diamond', '菱格绗缝'], ['dots', '波点'],
  ['herring', '鱼骨纹'], ['taper', '锥形'], ['pebble', '鹅卵石'], ['twist', '旋纹'],
];

/* 区间平滑：x 在 [a,b] 之间由 0 过渡到 1 */
const sstep = (a, b, x) => smoothstep((x - a) / (b - a));

/* 竹节：每个节距内先是一段平直柱身，靠近节线处鼓出一圈凸箍，整体向上微收 */
function bambooProfile(s) {
  const p = s * 3 - Math.floor(s * 3);
  const ridge = sstep(0.50, 0.66, p) * (1 - sstep(0.88, 0.99, p));
  return 0.95 * ridge * (1 - 0.45 * s);
}

/* 角向纹理先展开成「平面」再计算：弧长 × 高度（mm），保证单元格不随碗径变形 */
const ARC_REF = 84, H_REF = 120;

/* 造型轮廓：f(theta, s) ∈ [0, 1] 为径向凸起系数，m(s) 为该高度的最大值 */
const PROFILES = {
  smooth: { f: () => 0, m: () => 0 },
  rings: { f: (t, s) => sq(Math.sin(Math.PI * s * 4)), m: s => sq(Math.sin(Math.PI * s * 4)) },
  bamboo: { f: (t, s) => bambooProfile(s), m: bambooProfile },
  ribbed: { f: t => 0.55 * (1 + Math.cos(t * 48)) / 2, m: () => 0.55 },
  petal: { f: (t, s) => (1 - 0.42 * s) * Math.pow((1 + Math.cos(t * 6)) / 2, 1.25), m: s => 1 - 0.42 * s },
  wave: { f: (t, s) => 0.62 * (1 + Math.cos(t * 10 + s * Math.PI * 2)) / 2, m: () => 0.62 },
  diamond: {
    f: (t, s) => {
      const a = t * 24, b = s * 34;          // 两组反向斜纹交叉成菱形格
      const w1 = (1 + Math.cos(a + b)) / 2;
      const w2 = (1 + Math.cos(a - b)) / 2;
      return 0.62 * Math.pow(w1 * w2, 0.55);
    },
    m: () => 0.62,
  },
  dots: {
    /* 波点：三角点阵排布，每个格心鼓一个圆包。点阵用轴坐标定位 + 立方坐标取整，
       保证求到的确实是最近的格心，圆心不会串位。 */
    f: (t, s) => {
      const x = t * ARC_REF, y = s * H_REF;
      const L = 16, rt3 = Math.sqrt(3);
      const v = 2 * y / (L * rt3);
      const u = x / L - v / 2;
      let ru = Math.round(u), rv = Math.round(v), rw = Math.round(-u - v);
      const du = Math.abs(ru - u), dv = Math.abs(rv - v), dw = Math.abs(rw + u + v);
      if (du > dv && du > dw) ru = -rv - rw;
      else if (dv > dw) rv = -ru - rw;
      const cx = ru * L + rv * L / 2, cy = rv * L * rt3 / 2;
      const d = Math.hypot(x - cx, y - cy) / (L / 2);   // 0=点心，1=与邻点的界
      return 0.62 * (1 - smoothstep((d - 0.20) / 0.42)); // 点内平顶，点在 0.62 半径处收边
    },
    m: () => 0.62,
  },
  herring: {
    /* 鱼骨纹：三角波把水平条纹折成 V 形，一排排 30° 左右的折线 */
    f: (t, s) => {
      const x = t * ARC_REF, y = s * H_REF;
      const W = 26, P = 12;
      const u = x - Math.floor(x / W) * W;
      const tri = Math.abs(u - W / 2) / (W / 2);       // 0..1 的三角波，边界连续
      return 0.62 * (1 + Math.cos(2 * Math.PI * (y / P + 0.55 * tri))) / 2;
    },
    m: () => 0.62,
  },
  taper: { f: (t, s) => Math.pow(1 - s, 1.15), m: s => Math.pow(1 - s, 1.15) },
  pebble: { f: (t, s) => Math.sin(Math.PI * s), m: s => Math.sin(Math.PI * s) },
  twist: { f: (t, s) => 0.6 * (1 + Math.cos(t * 24 - s * Math.PI * 4)) / 2, m: () => 0.6 },
};

/* ================= 装配几何推导 ================= */
/* 内胆（不锈钢碗）抽象成：碗口外径 rim、嵌入直径 diameter、碗深 depth。
   支架内腔 = 碗外形 + 径向间隙 gap；外轮廓 = 内腔 + 壁厚 + 造型起伏。 */
function assembly() {
  const H = state.height;
  const depth = clamp(state.depth, 20, H - 12);
  const open = state.rim / 2 + state.gap;     // 顶部开口半径
  const seat = state.diameter / 2 + state.gap; // 碗底座处半径
  const need = Math.max(0, open - seat);
  const maxSlope = 0.6;                        // 内壁每毫米高度最大内收量
  const taperH = clamp(need / maxSlope, depth * 0.3, depth);
  const trayY = H - depth;
  const shoulderY = trayY + taperH;
  return { H, depth, open, seat, trayY, shoulderY };
}

function cavityRadius(y, g) {
  if (y >= g.shoulderY) return g.open;
  if (y >= g.trayY) {
    const t = (g.shoulderY - y) / Math.max(1e-6, g.shoulderY - g.trayY);
    return g.seat + (g.open - g.seat) * Math.cos(t * Math.PI / 2);
  }
  return g.seat;
}

/* ================= 装饰图形（canvas 绘制） ================= */
function drawDeco(ctx, kind, cx, cy, size, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(size / 2, size / 2);
  ctx.fillStyle = color || '#fff';
  const e = (x, y, rx, ry, rot) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2); ctx.fill(); };
  switch (kind) {
    case 'paw':
      e(0, 0.30, 0.46, 0.40);
      e(-0.52, -0.18, 0.17, 0.24, -0.45); e(-0.18, -0.46, 0.17, 0.25, -0.15);
      e(0.18, -0.46, 0.17, 0.25, 0.15); e(0.52, -0.18, 0.17, 0.24, 0.45);
      break;
    case 'heart':
      ctx.beginPath();
      ctx.moveTo(0, 0.62);
      ctx.bezierCurveTo(-0.92, 0.05, -0.62, -0.66, 0, -0.26);
      ctx.bezierCurveTo(0.62, -0.66, 0.92, 0.05, 0, 0.62);
      ctx.fill();
      break;
    case 'star':
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? 0.44 : 1.0;
        const a = k / 10 * Math.PI * 2 - Math.PI / 2;
        const px = Math.cos(a) * r, py = Math.sin(a) * r;
        k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      break;
    case 'flower':
      for (let k = 0; k < 6; k++) {
        const a = k / 6 * Math.PI * 2;
        e(Math.cos(a) * 0.52, Math.sin(a) * 0.52, 0.34, 0.2, a);
      }
      e(0, 0, 0.24, 0.24);
      break;
    case 'bone':
      e(-0.6, -0.27, 0.27, 0.27); e(-0.6, 0.27, 0.27, 0.27);
      e(0.6, -0.27, 0.27, 0.27); e(0.6, 0.27, 0.27, 0.27);
      ctx.fillRect(-0.6, -0.25, 1.2, 0.5);
      break;
  }
  ctx.restore();
}

/* ================= 名字 + 装饰 → 高度图 ================= */
function boxBlur(src, w, h, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w; let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / (2 * r + 1);
      acc += src[row + clamp(x + r + 1, 0, w - 1)] - src[row + clamp(x - r, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}

function buildLabel(g) {
  const name = state.petName.trim();
  const deco = state.decoration;
  if (!name && deco === 'none') return null;

  const font = FONTS.find(f => f.id === state.font) || FONTS[0];
  const fontPx = 220;
  const m = document.createElement('canvas').getContext('2d');
  m.font = `${font.weight} ${fontPx}px ${font.stack}`;
  m.textBaseline = 'alphabetic'; m.textAlign = 'left';

  const track = fontPx * 0.035;
  const glyph = fontPx * 0.8;

  /* 排版 */
  const items = [];
  if (deco !== 'none' && state.decoPos === 'replace' && name) {
    let buf = '';
    for (const ch of Array.from(name)) {
      if (ch === 'O' || ch === 'o') {
        if (buf) { items.push({ t: 'text', v: buf }); buf = ''; }
        items.push({ t: 'deco' });
      } else buf += ch;
    }
    if (buf) items.push({ t: 'text', v: buf });
    if (!items.some(i => i.t === 'deco')) { items.length = 0; items.push({ t: 'text', v: name }, { t: 'deco' }); }
  } else if (deco !== 'none') {
    if (state.decoPos === 'left') { items.push({ t: 'deco' }); if (name) items.push({ t: 'text', v: name }); }
    else { if (name) items.push({ t: 'text', v: name }); items.push({ t: 'deco' }); }
  } else {
    items.push({ t: 'text', v: name });
  }

  let total = 0;
  for (const it of items) {
    it.w = it.t === 'deco' ? glyph * 1.06 : Math.max(1, m.measureText(it.v).width);
    total += it.w;
  }
  total += track * (items.length - 1);
  if (total <= 1) return null;

  /* 垂直度量：
     - 「字号」= 文字墨迹高度，因此 mmPerPx 只由文字决定
     - 装饰图形与文字墨迹中心对齐，画布范围再扩展以容纳装饰 */
  const allText = items.filter(i => i.t === 'text').map(i => i.v).join('');
  const hasDeco = items.some(i => i.t === 'deco');
  let topExt, botExt, decoOffset, scaleRef;
  if (allText) {
    const tm = m.measureText(allText);
    const tAsc = tm.actualBoundingBoxAscent || fontPx * 0.72;
    const tDesc = tm.actualBoundingBoxDescent || 0;
    const textCenter = (tAsc - tDesc) / 2;     // 文字墨迹中心（相对基线，px，向上为正）
    topExt = tAsc;
    botExt = tDesc;
    if (hasDeco) {
      topExt = Math.max(topExt, textCenter + glyph * 0.5);
      botExt = Math.max(botExt, glyph * 0.5 - textCenter);
    }
    decoOffset = textCenter;
    scaleRef = Math.max(fontPx * 0.2, tAsc + tDesc);
  } else {
    topExt = botExt = glyph * 0.5;
    decoOffset = 0;
    scaleRef = glyph;
  }
  const mmPerPx = state.fontSize / scaleRef;
  const inkH = Math.max(1, topExt + botExt);
  const asc = topExt, desc = botExt;

  /* 画进 canvas */
  const pad = fontPx * 0.18;
  const W = Math.min(4096, Math.ceil(total + pad * 2));
  const H = Math.ceil(inkH + pad * 2);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.font = m.font;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  const baselinePy = pad + asc;
  const decoCy = baselinePy - decoOffset;
  let x = pad;
  for (const it of items) {
    if (it.t === 'deco') drawDeco(ctx, deco, x + it.w / 2, decoCy, glyph);
    else ctx.fillText(it.v, x, baselinePy);
    x += it.w + track;
  }

  /* 取 alpha → 模糊抗锯齿 → 高度场 */
  const img = ctx.getImageData(0, 0, W, H).data;
  const raw = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) raw[i] = img[i * 4 + 3] / 255;
  const data = boxBlur(raw, W, H, Math.max(1, Math.round(fontPx * 0.018)));

  /* 映射到圆柱面：横向按弧长展开（保持真实纵横比），纵向平移到指定高度 */
  const centerMM = clamp(state.height * state.textY / 100, 0, state.height);
  const sRef = clamp(centerMM / state.height, 0.05, 0.95);
  const Rref = cavityRadius(centerMM, g) + state.wall + state.wave * PROFILES[state.shape].m(sRef);
  const widthMm = W * mmPerPx;
  const halfAng = widthMm / (2 * Math.max(6, Rref));

  return {
    data, W, H, mmPerPx,
    halfAng,
    theta0: state.textAngle * Math.PI / 180,
    baselineMM: centerMM + (desc - asc) / 2 * mmPerPx,
    baselinePy,
    centerMM,
    inkHalfMM: inkH * mmPerPx / 2,
  };
}

function bilinear(d, w, h, x, y) {
  const x0 = clamp(Math.floor(x), 0, w - 1), y0 = clamp(Math.floor(y), 0, h - 1);
  const fx = clamp(x - x0, 0, 1), fy = clamp(y - y0, 0, 1);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  return lerp(lerp(d[y0 * w + x0], d[y0 * w + x1], fx), lerp(d[y1 * w + x0], d[y1 * w + x1], fx), fy);
}

function sampleLabel(L, u, y) {
  if (u < 0 || u > 1) return 0;
  const py = L.baselinePy - (y - L.baselineMM) / L.mmPerPx;
  if (py < 0 || py > L.H - 1) return 0;
  return bilinear(L.data, L.W, L.H, u * (L.W - 1), py);
}

/* ================= 支架几何 ================= */
/* 文字底板（凸台）的矩形边界：纵向按字号留边，环向按弧长留边 */
function bossExtent(label) {
  const padY = Math.max(1.8, state.fontSize * 0.22);
  const padA = Math.max(0.05, label.halfAng * 0.12);
  return { halfY: label.inkHalfMM + padY, halfAng: label.halfAng + padA };
}

function buildYs(H, g, label, draft) {
  const base = clamp(Math.round(H / (draft ? 4.2 : 2.5)) + 1, draft ? 34 : 42, draft ? 64 : 96);
  const ys = [];
  for (let k = 0; k < base; k++) ys.push(k / (base - 1) * H);
  const keys = [g.trayY, g.shoulderY];
  if (label) keys.push(clamp(label.centerMM - label.inkHalfMM * 0.8, 0.4, H - 0.4), clamp(label.centerMM + label.inkHalfMM * 0.8, 0.4, H - 0.4));
  for (const k of keys) {
    const y = clamp(k, 0, H);
    if (!ys.some(v => Math.abs(v - y) < 0.12)) ys.push(y);
  }
  if (label) {
    /* 凸台上下沿各插一对贴边行，让侧壁落成近似垂直的硬边（否则一行 2.5mm 会斜成坡） */
    const bx = bossExtent(label);
    for (const e of [label.centerMM - bx.halfY, label.centerMM + bx.halfY]) {
      for (const d of [-0.07, 0.07]) {
        const y = clamp(e + d, 0.2, H - 0.2);
        if (!ys.some(v => Math.abs(v - y) < 0.02)) ys.push(y);
      }
    }
  }
  if (label) {
    const top = clamp(label.centerMM + label.inkHalfMM * 0.85, 0, H);
    const bot = clamp(label.centerMM - label.inkHalfMM * 0.85, 0, H);
    const n = draft ? 12 : 24;
    for (let k = 1; k < n; k++) {
      const y = bot + (top - bot) * k / n;
      if (!ys.some(v => Math.abs(v - y) < 0.08)) ys.push(y);
    }
  }
  ys.sort((a, b) => a - b);
  return ys;
}

function buildStandGeometry(draft, g) {
  const H = g.H, wall = state.wall, wave = state.wave;
  const shape = state.shape;
  const profile = PROFILES[shape];

  let N = draft ? 192 : 384;
  if (shape === 'ribbed') N = draft ? 384 : 720;
  else if (shape === 'twist') N = draft ? 288 : 576;
  else if (shape === 'diamond' || shape === 'dots' || shape === 'herring') N = draft ? 320 : 640;
  else if (shape === 'wave' || shape === 'petal') N = draft ? 256 : 512;

  const ys = buildYs(H, g, null, draft);
  const M = ys.length;

  const cosA = new Float32Array(N), sinA = new Float32Array(N), angArr = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const th = i / N * Math.PI * 2;
    angArr[i] = th;
    cosA[i] = Math.cos(th); sinA[i] = Math.sin(th);
  }

  const cavArr = new Float32Array(M);
  for (let j = 0; j < M; j++) cavArr[j] = cavityRadius(ys[j], g);

  /* 整体扭转：把纹理按高度绕轴旋转，竖纹即变成螺纹 */
  const twistRad = (state.twist || 0) * Math.PI / 180;

  const total = state.support ? (2 * M + 1) * N : 2 * M * N;
  const pos = new Float32Array(total * 3);
  let cursor = 0;
  const push = (x, y, z) => { pos[cursor++] = x; pos[cursor++] = y; pos[cursor++] = z; };

  let maxR = 0;

  /* ---- 外表面（O 区段）：纯纹理回转面，文字与凸台不参与 ---- */
  for (let j = 0; j < M; j++) {
    const y = ys[j], s = y / H;
    const base = cavArr[j] + wall;
    const twistOff = twistRad * s;
    for (let i = 0; i < N; i++) {
      const r = base + wave * profile.f(angArr[i] - twistOff, s);
      if (r > maxR) maxR = r;
      push(r * cosA[i], y, r * sinA[i]);
    }
  }

  /* ---- 拓扑：一条首尾相接的封闭回转面 ----
     外壁(0..H) → 顶部环带 → 内腔(H..托盘行) → 托盘(朝上) → 排水孔壁(托盘行..0) → 底部环带(朝下) → 回到外壁。
     每条边恰由两个三角形共享，整体水密、无封闭空腔（排水孔贯通上下，打印不闷气）。 */

  /* 托盘所在行（取最近采样行）；无支撑时不切分 */
  let jt = 0;
  if (state.support) {
    let best = 1e9;
    for (let j = 1; j < M - 1; j++) {
      const d = Math.abs(ys[j] - g.trayY);
      if (d < best) { best = d; jt = j; }
    }
  }
  const drainR = state.support ? clamp(g.seat * 0.2, 4, 12) : 0;

  /* ---- 内腔网格（I 区段）：行 jt..M-1 ---- */
  const I0 = M * N;
  const MI = M - jt;
  for (let k = 0; k < MI; k++) {
    const j = jt + k, y = ys[j], r = cavArr[j];
    for (let i = 0; i < N; i++) push(r * cosA[i], y, r * sinA[i]);
  }

  /* ---- 排水孔壁（D 区段）：行 0..jt，半径恒为 drainR ---- */
  const D0 = I0 + MI * N;
  if (state.support) {
    for (let k = 0; k <= jt; k++) {
      const y = ys[k];
      for (let i = 0; i < N; i++) push(drainR * cosA[i], y, drainR * sinA[i]);
    }
  }

  /* ---- 索引 ---- */
  const tri = [];
  const O = (j, i) => j * N + i;          // 外壁
  const In = (k, i) => I0 + k * N + i;    // 内腔（k ↔ 行 jt+k）
  const Dw = (k, i) => D0 + k * N + i;    // 排水孔壁（k ↔ 行 k）
  const nxt = i => (i + 1) % N;

  for (let j = 0; j < M - 1; j++) {
    for (let i = 0; i < N; i++) {
      const b = nxt(i);
      tri.push(O(j, i), O(j + 1, i), O(j + 1, b), O(j, i), O(j + 1, b), O(j, b));          // 外壁朝外
    }
  }
  for (let k = 0; k < MI - 1; k++) {
    for (let i = 0; i < N; i++) {
      const b = nxt(i);
      tri.push(In(k, i), In(k, b), In(k + 1, b), In(k, i), In(k + 1, b), In(k + 1, i));    // 内腔朝内
    }
  }
  const last = M - 1;
  for (let i = 0; i < N; i++) {           // 顶部环带（朝上）
    const b = nxt(i);
    tri.push(O(last, i), In(MI - 1, i), In(MI - 1, b), O(last, i), In(MI - 1, b), O(last, b));
  }
  if (state.support) {
    for (let i = 0; i < N; i++) {         // 托盘（朝上）：内腔底行(r=seat) → 孔壁顶行(r=drainR)
      const b = nxt(i);
      tri.push(In(0, i), Dw(jt, i), Dw(jt, b), In(0, i), Dw(jt, b), In(0, b));
    }
    for (let k = 0; k < jt; k++) {        // 排水孔壁（朝内）
      for (let i = 0; i < N; i++) {
        const b = nxt(i);
        tri.push(Dw(k, i), Dw(k, b), Dw(k + 1, b), Dw(k, i), Dw(k + 1, b), Dw(k + 1, i));
      }
    }
    for (let i = 0; i < N; i++) {         // 底部环带（朝下）：外壁底行 → 孔壁底行
      const b = nxt(i);
      tri.push(O(0, i), O(0, b), Dw(0, b), O(0, i), Dw(0, b), Dw(0, i));
    }
  } else {
    for (let i = 0; i < N; i++) {         // 底部环带（朝下）：外壁底行 → 内腔底行
      const b = nxt(i);
      tri.push(O(0, i), O(0, b), In(0, b), O(0, i), In(0, b), In(0, i));
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, cursor), 3));
  geo.setIndex(tri);
  geo.computeVertexNormals();
  return { geo, maxR, tris: tri.length / 3 };
}

/* ================= 文字凸台（独立模型） ================= */
/* 一块圆角矩形板，叠在筒身上、底面陷进壁里与之相交。
   逐行解析求左右边界（圆角是真正的圆弧），所以边缘干净、不带网格锯齿。
   顶面承载文字浮雕/凹刻，侧壁竖直。 */
function buildPlateGeometry(draft, label, g) {
  const H = g.H, wall = state.wall, wave = state.wave;
  const profile = PROFILES[state.shape];
  const boss = bossExtent(label);
  const halfY = boss.halfY;
  const cy = label.centerMM;

  /* 板面高度：板范围内纹理峰值再留 1.6 mm 余量，保证始终凸出纹理；
     板底沉到内腔之上一层，保证和筒身是实体相交而不是贴面 */
  const yLo = clamp(cy - halfY, 0, H), yHi = clamp(cy + halfY, 0, H);
  let mM = 0, cavMin = Infinity;
  for (let k = 0; k <= 32; k++) {
    const y = lerp(yLo, yHi, k / 32);
    mM = Math.max(mM, profile.m(y / H));
    cavMin = Math.min(cavMin, cavityRadius(y, g));
  }
  const cavMid = cavityRadius(cy, g);
  const topR = cavMid + wall + Math.max(wave * mM, 1.6);
  const botR = cavMin + clamp(wall * 0.45, 0.9, 2.0);

  const Rref = cavMid + wall;
  const halfArc = boss.halfAng * Rref;                       // 板半宽（弧长 mm）
  const labelArc = label.halfAng * Rref;
  const R = clamp(Math.min(halfY, halfArc) * 0.52, 3, 9.5);  // 圆角半径
  const flatW = Math.max(0.5, halfArc - R);                  // 直边段半宽

  const rows = clamp(Math.round(halfY * 2 / (draft ? 1.6 : 0.9)), 10, 90);
  const cols = clamp(Math.round(halfArc * 2 / (draft ? 1.6 : 1.0)), 40, 200);

  /* 每行的半宽：圆角区用圆弧解析求 */
  const hw = new Float32Array(rows);
  for (let j = 0; j < rows; j++) {
    const y = cy - halfY + 2 * halfY * j / (rows - 1);
    const t = Math.abs(y - cy) - (halfY - R);
    hw[j] = t <= 0 ? halfArc : (t >= R ? flatW : flatW + Math.sqrt(R * R - t * t));
  }
  const rowY = j => cy - halfY + 2 * halfY * j / (rows - 1);

  const sign = state.engrave === 'raised' ? 1 : -1;
  const depth = Math.min(state.textDepth, Math.max(0.3, topR - botR - 1.2));

  const pos = [], idx = [];
  const put = (r, th, y) => {
    pos.push(r * Math.cos(th), y, r * Math.sin(th));
    return pos.length / 3 - 1;
  };

  /* ---- 顶面 ---- */
  const top = new Int32Array(rows * cols);
  let maxR = topR;
  for (let j = 0; j < rows; j++) {
    const y = rowY(j);
    for (let i = 0; i < cols; i++) {
      const u = (i / (cols - 1)) * 2 - 1;                    // -1..1
      const arc = u * hw[j];
      const h = sampleLabel(label, 0.5 - arc / (2 * labelArc), y);
      const r = topR + sign * h * depth;
      if (r > maxR) maxR = r;
      top[j * cols + i] = put(r, label.theta0 + arc / Rref, y);
    }
  }
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = top[j * cols + i], b = top[(j + 1) * cols + i];
      const c = top[(j + 1) * cols + i + 1], d = top[j * cols + i + 1];
      idx.push(a, b, c, a, c, d);                            // 法线朝外
    }
  }

  /* ---- 侧壁：沿边界环一圈，垂直落到板底 ---- */
  const loop = [];
  for (let j = 0; j < rows; j++) loop.push([j, cols - 1]);
  for (let i = cols - 2; i >= 0; i--) loop.push([rows - 1, i]);
  for (let j = rows - 2; j >= 0; j--) loop.push([j, 0]);
  for (let i = 1; i < cols - 1; i++) loop.push([0, i]);

  const bot = [];
  for (const [j, i] of loop) {
    const u = (i / (cols - 1)) * 2 - 1;
    bot.push(put(botR, label.theta0 + (u * hw[j]) / Rref, rowY(j)));
  }
  const L = loop.length;
  for (let k = 0; k < L; k++) {
    const k1 = (k + 1) % L;
    const tk = top[loop[k][0] * cols + loop[k][1]];
    const tk1 = top[loop[k1][0] * cols + loop[k1][1]];
    idx.push(tk, bot[k1], bot[k], tk, tk1, bot[k1]);         // 法线朝外
  }

  /* ---- 底面（埋在筒身里，法线朝轴心） ---- */
  const cIdx = put(botR, label.theta0, cy);
  for (let k = 0; k < L; k++) idx.push(cIdx, bot[k], bot[(k + 1) % L]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return { geo, maxR, tris: idx.length / 3 };
}

/* 把两块几何并成一个（凸台与支架是同一次导出的两个壳体） */
function mergeGeometry(a, b) {
  const pa = a.getAttribute('position'), pb = b.getAttribute('position');
  const ia = a.getIndex(), ib = b.getIndex();
  const positions = new Float32Array(pa.array.length + pb.array.length);
  positions.set(pa.array, 0);
  positions.set(pb.array, pa.array.length);
  const index = new Uint32Array(ia.array.length + ib.array.length);
  index.set(ia.array, 0);
  const off = pa.count;
  for (let k = 0; k < ib.array.length; k++) index[ia.array.length + k] = ib.array[k] + off;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  a.dispose(); b.dispose();
  return geo;
}

/* ================= 不锈钢内胆（仅预览，不导出） ================= */
function buildInsertGeometry(g) {
  const t = 1.5;
  const rt = Math.max(10, state.rim / 2 - 0.4);
  const rb = Math.max(8, Math.min(rt - 3, state.diameter / 2 - 1.4));
  const bot = g.trayY, top = g.H + 6;   // 碗沿高出支架口沿，露出钢碗边
  const D = Math.max(8, top - bot);
  const K = 34;
  const wallR = u => rb + (rt - rb) * Math.pow(u, 1.22);
  const pts = [];
  pts.push(new THREE.Vector2(0, bot + t));
  pts.push(new THREE.Vector2(rb * 0.42, bot + t));
  pts.push(new THREE.Vector2(rb * 0.8, bot + t * 1.35));
  for (let i = 0; i <= K; i++) {
    const u = i / K;
    pts.push(new THREE.Vector2(Math.max(t * 0.5, wallR(u) - t), bot + t + (D - t * 1.6) * u));
  }
  pts.push(new THREE.Vector2(rt - t * 0.6, top + t * 0.4));
  pts.push(new THREE.Vector2(rt - t * 0.15, top + t * 0.55));
  pts.push(new THREE.Vector2(rt, top));
  for (let i = K; i >= 0; i--) {
    const u = i / K;
    pts.push(new THREE.Vector2(Math.max(0.01, wallR(u)), bot + D * u));
  }
  pts.push(new THREE.Vector2(rb * 0.72, bot + 0.2));
  pts.push(new THREE.Vector2(rb * 0.32, bot));
  pts.push(new THREE.Vector2(0.01, bot));
  return new THREE.LatheGeometry(pts, 128);
}

/* ================= 渲染 ================= */
let renderer, scene, camera, standMesh, insertMesh, ground, keyLight;
let webglOK = true;

function makeEnvTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.42, '#f7f1e6');
  grd.addColorStop(0.52, '#e9e0d0');
  grd.addColorStop(1, '#7d7263');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(30, 8, 46, 26);       // “窗户”高光
  g.fillRect(170, 4, 30, 18);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function initScene() {
  const holder = $('canvas');
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (e) {
    webglOK = false;
    $('previewNotice').hidden = false;
    $('previewNotice').textContent = '当前浏览器不支持 WebGL，3D 预览不可用，但参数与导出仍然可用。';
    return;
  }
  /* 至少 2 倍超采样：低 DPI 屏或预览器里也不会被拉糊 */
  renderer.setPixelRatio(clamp(window.devicePixelRatio || 1, 2, 3));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  holder.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 1, 6000);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = makeEnvTexture();
  scene.environment = pmrem.fromEquirectangular(envTex).texture;
  envTex.dispose(); pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xfff7ec, 0xcbbba0, 0.5));
  keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
  keyLight.position.set(240, 460, 220);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 50;
  keyLight.shadow.camera.far = 1600;
  keyLight.shadow.camera.left = -320; keyLight.shadow.camera.right = 320;
  keyLight.shadow.camera.top = 320; keyLight.shadow.camera.bottom = -320;
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.9;
  scene.add(keyLight);
  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  fill.position.set(-320, 160, -260);
  scene.add(fill);
  const rimLight = new THREE.DirectionalLight(0xffe8cf, 0.5);
  rimLight.position.set(-60, 340, -360);
  scene.add(rimLight);

  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000),
    new THREE.ShadowMaterial({ opacity: 0.17 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  ground.receiveShadow = true;
  scene.add(ground);

  standMaterial = new THREE.MeshStandardMaterial({ color: state.color, roughness: 0.66, metalness: 0.0 });
  insertMaterial = new THREE.MeshStandardMaterial({
    color: 0xd9dce0, metalness: 0.92, roughness: 0.24, side: THREE.DoubleSide,
  });

  bindControls(holder);
  new ResizeObserver(resize).observe(holder);
  resize();
}

let standMaterial, insertMaterial;

/* ---- 轨道相机（含惯性、双指缩放、自动旋转） ---- */
const orbit = {
  theta: 0.42, phi: 1.16, dist: 520,
  tTheta: 0.42, tPhi: 1.16, tDist: 520,
  target: new THREE.Vector3(0, 55, 0),
  autoRotate: false,
};
const viewDefault = () => {
  const base = state.textAngle * Math.PI / 180;
  orbit.tTheta = base + 0.42;
  orbit.tPhi = 1.16;
  userZoom = 1;
  orbit.tDist = fitDist;
};
const viewFront = () => { orbit.tTheta = state.textAngle * Math.PI / 180; orbit.tPhi = 1.5; };
const viewSupport = () => { orbit.tTheta = state.textAngle * Math.PI / 180 + 0.7; orbit.tPhi = 2.35; };

let fitDist = 520;      // 自动取景距离
let userZoom = 1;       // 用户相对自动取景的缩放（滚轮 / 双指）

function fitCamera(H, maxR) {
  orbit.target.y = H * 0.44;
  fitDist = Math.max(maxR * 5.2, H * 4.0, 500);
  const d = clamp(fitDist * userZoom, fitDist * 0.35, fitDist * 2.6);
  orbit.tDist = d;
  orbit.dist = clamp(orbit.dist, fitDist * 0.3, fitDist * 3);
  if (Math.abs(orbit.dist - d) > fitDist * 1.2) orbit.dist = d * 1.25;
}

function bindControls(holder) {
  const el = renderer.domElement;
  const pointers = new Map();
  let pinchDist = 0;
  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  el.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      // 向右拖动 → 视角逆时针旋转（表面跟随光标方向转动）
      orbit.tTheta += dx * 0.0056;
      orbit.tPhi = clamp(orbit.tPhi - dy * 0.0045, 0.12, 2.8);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) {
        orbit.tDist = clamp(orbit.tDist * pinchDist / Math.max(1, d), fitDist * 0.35, fitDist * 2.6);
        userZoom = clamp(orbit.tDist / fitDist, 0.35, 2.6);
      }
      pinchDist = d;
    }
  });
  const end = e => { pointers.delete(e.pointerId); pinchDist = 0; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', e => {
    e.preventDefault();
    orbit.tDist = clamp(orbit.tDist * Math.exp(e.deltaY * 0.0013), fitDist * 0.35, fitDist * 2.6);
    userZoom = clamp(orbit.tDist / fitDist, 0.35, 2.6);
  }, { passive: false });
}

function resize() {
  if (!renderer) return;
  const holder = $('canvas');
  const w = holder.clientWidth, h = holder.clientHeight;
  if (!w || !h) return;
  const pr = clamp(window.devicePixelRatio || 1, 2, 3);   // 换屏 / 改缩放后同步
  if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/* ================= 重建 ================= */
let lastLabelKey = '';
let draftTimer = 0, fullTimer = 0;

function labelKey() {
  return [state.petName, state.font, state.decoration, state.decoPos, state.fontSize, state.engrave].join('|');
}

function rebuild(draft) {
  if (!webglOK) { updateReads(null); return; }
  const g = assembly();
  const label = buildLabel(g);
  /* 支架与文字凸台各自成网格，导出的 STL 里是两个相交壳体 */
  const stand = buildStandGeometry(draft, g);
  const plate = label ? buildPlateGeometry(draft, label, g) : null;
  const geo = plate ? mergeGeometry(stand.geo, plate.geo) : stand.geo;
  const maxR = Math.max(stand.maxR, plate ? plate.maxR : 0);
  const tris = stand.tris + (plate ? plate.tris : 0);

  if (standMesh) { standMesh.geometry.dispose(); standMesh.geometry = geo; }
  else {
    standMesh = new THREE.Mesh(geo, standMaterial);
    standMesh.castShadow = true;
    standMesh.receiveShadow = true;
    scene.add(standMesh);
  }

  const igeo = buildInsertGeometry(g);
  if (!insertMesh) {
    insertMesh = new THREE.Mesh(igeo, insertMaterial);
    insertMesh.castShadow = true;
    scene.add(insertMesh);
  } else { insertMesh.geometry.dispose(); insertMesh.geometry = igeo; }
  insertMesh.visible = state.bowlVisible;

  keyLight.position.set(240, 460, 220);
  fitCamera(g.H, maxR);
  updateReads({ g, maxR, tris });
}

function scheduleBuild(draft) {
  if (draft) {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => rebuild(true), 14);
  }
  clearTimeout(fullTimer);
  fullTimer = setTimeout(() => rebuild(false), 260);
}

/* ================= 读数与校验 ================= */
function updateReads(info) {
  const H = state.height;
  if (!info) {
    $('heightRead').innerHTML = `${H} <small>mm</small>`;
    return;
  }
  const { g, maxR, tris } = info;
  $('heightRead').innerHTML = `${H.toFixed(0)} <small>mm</small>`;
  $('diamRead').innerHTML = `${(maxR * 2).toFixed(1)} <small>mm</small>`;
  $('holeRead').innerHTML = `${(state.diameter + 2 * state.gap).toFixed(1)} <small>mm</small>`;
  $('meshRead').textContent = `三角形 ${tris.toLocaleString()} · 壁厚 ${state.wall} mm · 内胆深 ${g.depth.toFixed(0)} mm`;
  const shapeName = SHAPES.find(s => s[0] === state.shape)[1];
  $('materialLabel').textContent = `Bambu Lab · PLA Matte · ${shapeName}`;

  const errors = [];
  if (state.depth > H - 12) errors.push(`碗深超过支架高度可容纳范围，内腔已自动按 ${(H - 12).toFixed(0)} mm 处理。`);
  if (state.diameter > state.rim - 5) errors.push('嵌入直径应比碗口外径小至少 5 mm，否则不锈钢碗放不进去。');
  $('error').textContent = errors.join(' ');

  const lift = Math.max(0, H - g.depth);
  if (state.support) {
    $('supportRead').textContent = lift > 1
      ? `底部托高 ${lift.toFixed(0)} mm，有托盘托住碗底`
      : '碗底几乎贴地，托盘很薄';
    $('supportDescription').textContent = '托盘与支架一体打印，用来承托不锈钢碗底。关掉内胆显示可以看到内部。';
  } else {
    $('supportRead').textContent = '底部镂空，仅靠碗口一圈承托';
    $('supportDescription').textContent = '没有托盘时，支架只是一圈支撑环，碗底由地面托住。';
  }
}

function updateMaterialUI() {
  const hex = state.color.toUpperCase();
  const known = MATERIALS.find(m => m[2].toUpperCase() === hex);
  $('materialDot').style.background = state.color;
  $('selectedMaterial').textContent = known ? known[0] : '自定义颜色';
  $('selectedMaterialSub').textContent = known
    ? `Bambu Lab PLA Matte · ${known[1]}`
    : '自定义颜色 · 不对应指定耗材';
  $('hexLabel').textContent = hex;
  $('customHex').textContent = known ? `${known[0]} · ${hex}` : hex;
  $('customColor').value = state.color.length === 7 ? state.color : '#F7D959';
  document.querySelectorAll('#colors .swatch').forEach(b =>
    b.classList.toggle('selected', b.dataset.color.toUpperCase() === hex));
}

/* ================= 缩略图 ================= */
function drawShapeThumb(canvas, shape) {
  const g = canvas.getContext('2d');
  const W = canvas.width, Hh = canvas.height;
  g.clearRect(0, 0, W, Hh);
  const P = PROFILES[shape];
  g.fillStyle = '#f7f1e6';
  g.strokeStyle = '#a89477';
  g.lineWidth = 1.6;
  g.lineJoin = 'round';
  g.beginPath();

  if (['ribbed', 'petal', 'wave', 'twist'].includes(shape)) {
    /* 俯视轮廓 */
    const cx = W / 2, cy = Hh / 2, r0 = Math.min(W, Hh) * 0.4, s = 0.6;
    const norm = 1 + 0.55 * Math.max(P.m(s), 0.001);
    for (let k = 0; k <= 180; k++) {
      const th = k / 180 * Math.PI * 2;
      const r = r0 * (1 + 0.55 * P.f(th, s)) / norm;
      const x = cx + Math.cos(th) * r;
      const y = cy + Math.sin(th) * r * 0.88;
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
  } else {
    /* 侧视轮廓：s=0 在底部 */
    const cx = W / 2, top = Hh * 0.12, bot = Hh * 0.9;
    const r0 = W * 0.4;
    let gm = 0;
    for (let k = 0; k <= 40; k++) gm = Math.max(gm, P.m(k / 40));
    const norm = 1 + 0.55 * gm;
    for (let k = 0; k <= 120; k++) {
      const s = k / 120;
      const half = r0 * (1 + 0.55 * P.m(s)) / norm;
      const y = bot - (bot - top) * s;
      const x = cx - half;
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    for (let k = 120; k >= 0; k--) {
      const s = k / 120;
      const half = r0 * (1 + 0.55 * P.m(s)) / norm;
      const y = bot - (bot - top) * s;
      g.lineTo(cx + half, y);
    }
  }
  g.closePath();
  g.fill();
  g.stroke();

  if (shape === 'diamond' || shape === 'dots' || shape === 'herring') {
    /* 这几种是面状纹理，单看外轮廓读不出来，在筒身里叠一层纹样示意 */
    g.save();
    g.clip();
    g.strokeStyle = 'rgba(168,148,119,0.45)';
    g.lineWidth = 1.1;
    const cx = W / 2, top = Hh * 0.12, bot = Hh * 0.9;
    if (shape === 'diamond') {
      const step = W * 0.105;
      for (let k = -6; k <= 6; k++) {
        const x = cx + k * step;
        g.beginPath(); g.moveTo(x - 30, top - 8); g.lineTo(x + 30, bot + 8); g.stroke();
        g.beginPath(); g.moveTo(x + 30, top - 8); g.lineTo(x - 30, bot + 8); g.stroke();
      }
    } else if (shape === 'dots') {
      /* 波点：错行排布的小圆点 */
      const r = 5.4, dx = 17, dy = 15;
      for (let col = -1; col < 8; col++) {
        for (let row = -1; row < 9; row++) {
          const px = cx - 60 + col * dx;
          const py = top - 10 + row * dy + (col % 2 ? dy / 2 : 0);
          g.beginPath();
          g.arc(px, py, r, 0, Math.PI * 2);
          g.stroke();
        }
      }
    } else {
      /* 一排排 V 形折线 */
      const w = 22, hh = 14, gap = 17;
      g.lineJoin = 'miter';
      for (let r = 0; top - 14 + r * gap < bot + 10; r++) {
        const yb = top - 14 + r * gap;
        g.beginPath();
        for (let k = -10; k <= 10; k++) {
          const x = cx + k * w + (r % 2 ? w : 0);   // 相邻行错开半格，才像鱼骨不是波浪
          const y = yb + (Math.abs(k) % 2 ? -hh : 0);
          k === -12 ? g.moveTo(x, y) : g.lineTo(x, y);
        }
        g.stroke();
      }
    }
    g.restore();
  }
}

/* ================= UI 构建 ================= */
function buildShapes() {
  const box = $('shapes');
  box.innerHTML = '';
  for (const [id, name] of SHAPES) {
    const b = document.createElement('button');
    b.dataset.shape = id;
    b.setAttribute('aria-label', name);
    if (state.shape === id) b.classList.add('selected');
    const c = document.createElement('canvas');
    c.width = 144; c.height = 104;
    drawShapeThumb(c, id);
    b.appendChild(c);
    b.appendChild(document.createTextNode(name));
    b.onclick = () => {
      state.shape = id;
      box.querySelectorAll('button').forEach(x => x.classList.toggle('selected', x === b));
      updateTwistAvailability();
      scheduleBuild(true);
    };
    box.appendChild(b);
  }
  const count = $('shapeCount');
  if (count) count.textContent = `${SHAPES.length} 种预设`;
  updateTwistAvailability();
}

/* 只有带竖向纹理的造型，扭转才看得出来 */
const TWISTABLE = ['ribbed', 'petal', 'wave', 'twist', 'diamond', 'dots', 'herring'];
function updateTwistAvailability() {
  const el = $('twist');
  if (!el) return;
  const ok = TWISTABLE.includes(state.shape);
  el.disabled = !ok;
  const wrap = el.closest('.slider-control');
  if (wrap) wrap.classList.toggle('is-disabled', !ok);
  $('twistLabel').textContent = ok ? '整体扭转（螺纹）' : '整体扭转 · 当前造型为轴对称，扭转不改变外形';
  $('twistOut').textContent = ok ? state.twist.toFixed(0) + '°' : '—';
}

function buildColors() {
  const box = $('colors');
  box.innerHTML = '';
  for (const [name, en, hex] of MATERIALS) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.color = hex;
    b.title = `${name} · ${en} · ${hex}`;
    b.setAttribute('aria-label', name);
    b.innerHTML = `<i style="background:${hex}"></i><span>${name}</span>`;
    b.onclick = () => {
      state.color = hex;
      updateMaterialUI();
      if (standMaterial) standMaterial.color.set(hex);
    };
    box.appendChild(b);
  }
}

function buildFonts() {
  const box = $('fonts');
  box.innerHTML = '';
  for (const f of FONTS) {
    const b = document.createElement('button');
    b.dataset.font = f.id;
    if (state.font === f.id) b.classList.add('selected');
    b.innerHTML = `<b style="font-family:${f.stack};font-weight:${f.weight}">Aa</b><small>${f.name}</small>`;
    b.onclick = () => {
      state.font = f.id;
      box.querySelectorAll('button').forEach(x => x.classList.toggle('selected', x === b));
      $('petName').style.fontFamily = f.stack;
      $('petName').style.fontWeight = f.weight;
      scheduleBuild(true);
    };
    box.appendChild(b);
  }
  const cur = FONTS.find(f => f.id === state.font) || FONTS[0];
  $('petName').style.fontFamily = cur.stack;
  $('petName').style.fontWeight = cur.weight;
}

function buildDecorations() {
  const box = $('decorations');
  box.innerHTML = '';
  for (const [id, name] of DECORATIONS) {
    const b = document.createElement('button');
    b.dataset.decoration = id;
    b.setAttribute('aria-pressed', state.decoration === id ? 'true' : 'false');
    if (state.decoration === id) b.classList.add('selected');
    if (id === 'none') b.textContent = name;
    else {
      const c = document.createElement('canvas');
      c.width = 100; c.height = 70;
      const g = c.getContext('2d');
      drawDeco(g, id, 50, 35, 46, '#756350');
      b.appendChild(c);
      b.appendChild(document.createTextNode(name));
    }
    b.onclick = () => {
      state.decoration = id;
      box.querySelectorAll('button').forEach(x => {
        const on = x === b;
        x.classList.toggle('selected', on);
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      scheduleBuild(true);
    };
    box.appendChild(b);
  }
}

/* ================= 绑定 ================= */
function bindSlider(id, key, fmt, map) {
  const el = $(id), out = $(id + 'Out');
  const upd = () => {
    const v = parseFloat(el.value);
    state[key] = map ? map(v) : v;
    if (out) out.textContent = fmt ? fmt(v) : v;
    scheduleBuild(true);
  };
  el.addEventListener('input', upd);
  upd();
}

function bindNumber(id, key, { min, max, step, after } = {}) {
  const el = $(id);
  const upd = () => {
    let v = parseFloat(el.value);
    if (Number.isNaN(v)) return;
    if (min != null) v = clamp(v, min, max);
    state[key] = v;
    if (after) after(v);
    scheduleBuild(true);
  };
  el.addEventListener('input', upd);
  el.addEventListener('change', () => {
    let v = parseFloat(el.value);
    if (!Number.isNaN(v) && min != null) v = clamp(v, min, max);
    el.value = v;
  });
}

let autoInsert = true;

function bindUI() {
  bindSlider('wave', 'wave', v => v.toFixed(1) + ' mm');
  bindSlider('twist', 'twist', v => v.toFixed(0) + '°');
  bindSlider('height', 'height', v => v.toFixed(0) + ' mm');
  bindSlider('fontSize', 'fontSize', v => v.toFixed(0) + ' mm');
  bindSlider('textY', 'textY', v => v.toFixed(0) + ' %');
  bindSlider('textAngle', 'textAngle', v => v.toFixed(0) + '°');
  bindSlider('textDepth', 'textDepth', v => v.toFixed(1) + ' mm');

  bindNumber('rim', 'rim', {
    min: 90, max: 260,
    after: v => {
      if (autoInsert) {
        const est = clamp(v - 10, 50, 250);
        state.diameter = est;
        $('diameter').value = est;
      }
    },
  });
  bindNumber('diameter', 'diameter', { min: 50, max: 250, after: () => { autoInsert = false; } });
  bindNumber('depth', 'depth', { min: 25, max: 140 });
  bindNumber('gap', 'gap', { min: 0.2, max: 2 });
  bindNumber('wall', 'wall', { min: 2, max: 8 });

  const nameEl = $('petName');
  nameEl.addEventListener('input', () => {
    state.petName = nameEl.value;
    $('nameCount').textContent = `${nameEl.value.length} / 12`;
    scheduleBuild(true);
  });
  $('resetText').onclick = () => {
    nameEl.value = 'Momo';
    state.petName = 'Momo';
    $('nameCount').textContent = '4 / 12';
    scheduleBuild(true);
  };

  document.querySelectorAll('[data-engrave]').forEach(b => {
    b.onclick = () => {
      state.engrave = b.dataset.engrave;
      document.querySelectorAll('[data-engrave]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      $('depthLabel').textContent = state.engrave === 'raised' ? '浮雕厚度' : '凹刻深度';
      scheduleBuild(true);
    };
  });

  document.querySelectorAll('[data-deco-pos]').forEach(b => {
    b.onclick = () => {
      state.decoPos = b.dataset.decoPos;
      document.querySelectorAll('[data-deco-pos]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      scheduleBuild(true);
    };
  });

  $('customColor').addEventListener('input', e => {
    state.color = e.target.value;
    updateMaterialUI();
    if (standMaterial) standMaterial.color.set(state.color);
  });

  const supportBtn = $('bottomSupportToggle');
  supportBtn.onclick = () => {
    state.support = !state.support;
    supportBtn.setAttribute('aria-checked', state.support ? 'true' : 'false');
    $('bottomSupportState').textContent = state.support ? 'ON' : 'OFF';
    scheduleBuild(false);
  };

  /* 视图控制 */
  const bowlBtn = $('bowlToggle');
  bowlBtn.onclick = () => {
    state.bowlVisible = !state.bowlVisible;
    bowlBtn.classList.toggle('active', state.bowlVisible);
    bowlBtn.setAttribute('aria-pressed', state.bowlVisible ? 'true' : 'false');
    $('bowlState').textContent = state.bowlVisible ? 'ON' : 'OFF';
    if (insertMesh) insertMesh.visible = state.bowlVisible;
  };
  const rotateBtn = $('rotate');
  rotateBtn.onclick = () => {
    orbit.autoRotate = !orbit.autoRotate;
    rotateBtn.setAttribute('aria-pressed', orbit.autoRotate ? 'true' : 'false');
    rotateBtn.classList.toggle('active', orbit.autoRotate);
  };
  $('resetView').onclick = viewDefault;
  $('frontView').onclick = viewFront;
  $('supportView').onclick = viewSupport;

  $('fullscreenView').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('stage').requestFullscreen?.();
  };
  document.addEventListener('fullscreenchange', () => {
    $('fullscreenView').setAttribute('aria-pressed', document.fullscreenElement ? 'true' : 'false');
  });

  /* 标签页 */
  const tabs = ['appearance', 'dimensions', 'engraving'];
  const selectTab = id => {
    for (const t of tabs) {
      $('tab-' + t).setAttribute('aria-selected', t === id ? 'true' : 'false');
      $('tab-' + t).tabIndex = t === id ? 0 : -1;
      $('panel-' + t).hidden = t !== id;
    }
  };
  tabs.forEach((t, idx) => {
    $('tab-' + t).onclick = () => selectTab(t);
    $('tab-' + t).addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const next = (idx + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        selectTab(tabs[next]);
        $('tab-' + tabs[next]).focus();
      }
    });
  });

  $('export').onclick = exportSTL;
  $('shareExport').onclick = openShare;
  $('closeShare').onclick = () => { $('shareSheet').hidden = true; };
  $('copyShareLink').onclick = () => {
    navigator.clipboard?.writeText($('shareLink').value).then(() => toast('链接已复制'));
  };
  $('shareSheet').addEventListener('click', e => {
    if (e.target === $('shareSheet')) $('shareSheet').hidden = true;
  });

  updateTwistAvailability();

  $('shareImport').addEventListener('keydown', e => {
    if (e.key === 'Enter') { applyShareText($('shareImport').value); }
  });
  $('shareImport').addEventListener('change', () => applyShareText($('shareImport').value));
}

/* ================= 导出 ================= */
function exportSTL() {
  if (!standMesh) { toast('几何尚未生成，请稍候'); return; }
  clearTimeout(fullTimer);
  rebuild(false);
  standMesh.updateMatrixWorld(true);
  const exporter = new STLExporter();
  const data = exporter.parse(standMesh, { binary: true });
  const blob = new Blob([data], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const nm = (state.petName || 'bowl').replace(/[^\w\u4e00-\u9fa5-]+/g, '');
  a.download = `PPfantasy-${nm}-${state.shape}.stl`;
  a.click();
  URL.revokeObjectURL(a.href);
  const kb = (blob.size / 1024).toFixed(0);
  toast(`已导出 STL（${kb} KB · 毫米制 · 不含内胆）`);
}

/* ================= 分享 ================= */
const KEYS = ['shape', 'wave', 'twist', 'height', 'rim', 'diameter', 'depth', 'gap', 'wall', 'color',
  'font', 'petName', 'engrave', 'decoration', 'decoPos', 'fontSize', 'textY', 'textAngle',
  'textDepth', 'support', 'bowlVisible'];

function encodeShare() {
  const o = {};
  KEYS.forEach(k => o[k] = state[k]);
  return 'P1.' + btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeShare(code) {
  try {
    const s = code.replace(/-/g, '+').replace(/_/g, '/');
    const o = JSON.parse(decodeURIComponent(escape(atob(s))));
    for (const k of KEYS) if (o[k] != null) state[k] = o[k];
    return true;
  } catch { return false; }
}
function applyShareText(text) {
  if (!text) return;
  const m = String(text).match(/P1\.([A-Za-z0-9\-_]+)/);
  const code = m ? m[1] : text.trim();
  if (decodeShare(code)) {
    syncAllUI();
    rebuild(false);
    toast('设计已恢复 ✓');
    history.replaceState(null, '', '#p=' + code);
    $('shareImport').value = '';
  } else {
    toast('没能识别这个分享码');
  }
}
function openShare() {
  const code = encodeShare();
  const url = location.origin === 'null' || !location.origin.startsWith('http')
    ? location.href.split('#')[0] + '#p=' + code
    : location.origin + location.pathname + '#p=' + code;
  $('shareLink').value = url;
  $('shareCode').value = code;
  $('shareSheet').hidden = false;
  history.replaceState(null, '', '#p=' + code);
  navigator.clipboard?.writeText(url).catch(() => {});
}
function loadFromHash() {
  const m = location.hash.match(/[#&]p=([^&#]+)/i);
  if (m && decodeShare(m[1])) return true;
  return false;
}

/* ================= UI 同步 ================= */
function syncAllUI() {
  $('wave').value = state.wave; $('waveOut').textContent = state.wave.toFixed(1) + ' mm';
  $('twist').value = state.twist; $('twistOut').textContent = state.twist.toFixed(0) + '°';
  $('height').value = state.height; $('heightOut').textContent = state.height.toFixed(0) + ' mm';
  $('fontSize').value = state.fontSize; $('fontSizeOut').textContent = state.fontSize.toFixed(0) + ' mm';
  $('textY').value = state.textY; $('textYOut').textContent = state.textY.toFixed(0) + ' %';
  $('textAngle').value = state.textAngle; $('textAngleOut').textContent = state.textAngle.toFixed(0) + '°';
  $('textDepth').value = state.textDepth; $('textDepthOut').textContent = state.textDepth.toFixed(1) + ' mm';
  $('rim').value = state.rim; $('diameter').value = state.diameter; $('depth').value = state.depth;
  $('gap').value = state.gap; $('wall').value = state.wall;
  $('petName').value = state.petName;
  $('nameCount').textContent = `${state.petName.length} / 12`;
  $('bottomSupportToggle').setAttribute('aria-checked', state.support ? 'true' : 'false');
  $('bottomSupportState').textContent = state.support ? 'ON' : 'OFF';
  $('bowlState').textContent = state.bowlVisible ? 'ON' : 'OFF';
  $('bowlToggle').classList.toggle('active', state.bowlVisible);
  $('depthLabel').textContent = state.engrave === 'raised' ? '浮雕厚度' : '凹刻深度';
  document.querySelectorAll('[data-engrave]').forEach(x => x.setAttribute('aria-pressed', x.dataset.engrave === state.engrave ? 'true' : 'false'));
  document.querySelectorAll('[data-deco-pos]').forEach(x => x.setAttribute('aria-pressed', x.dataset.decoPos === state.decoPos ? 'true' : 'false'));
  buildShapes();
  buildColors();
  buildFonts();
  buildDecorations();
  updateMaterialUI();
}

/* ================= toast ================= */
let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ================= 主循环 ================= */
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  if (!renderer) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  if (orbit.autoRotate) orbit.tTheta -= dt * 0.35;
  const k = Math.min(1, dt * 9);
  orbit.theta += (orbit.tTheta - orbit.theta) * k;
  orbit.phi += (orbit.tPhi - orbit.phi) * k;
  orbit.dist += (orbit.tDist - orbit.dist) * k;
  const sp = Math.sin(orbit.phi);
  camera.position.set(
    orbit.target.x + orbit.dist * sp * Math.cos(orbit.theta),
    orbit.target.y + orbit.dist * Math.cos(orbit.phi),
    orbit.target.z + orbit.dist * sp * Math.sin(orbit.theta)
  );
  camera.lookAt(orbit.target);
  renderer.render(scene, camera);
}

/* ================= 启动 ================= */
loadFromHash();
initScene();
buildShapes();
buildColors();
buildFonts();
buildDecorations();
bindUI();
updateMaterialUI();
rebuild(false);
animate();
window.__ppfReady = true;

/* 字体加载完成后重刻一次文字，保证几何与预览一致 */
if (document.fonts?.ready) {
  document.fonts.ready.then(() => {
    if (state.petName.trim() || state.decoration !== 'none') scheduleBuild(false);
  });
}
window.addEventListener('hashchange', () => {
  if (loadFromHash()) { syncAllUI(); rebuild(false); }
});
