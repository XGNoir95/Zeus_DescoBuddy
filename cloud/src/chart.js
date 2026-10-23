// Indexed-PNG chart renderer for the Workers free tier.
// No meter data leaves Cloudflare except in the user's Telegram photo.
import { drawFontText, fontPalette } from "./font.js";
const WIDTH = 760;
const HEIGHT = 900;
const COLORS = [
  [9, 23, 36], // background
  [17, 42, 61], // card
  [43, 74, 94], // grid
  [84, 199, 217], // confirmed
  [245, 184, 101], // probable
  [246, 250, 255], // white
  [169, 189, 204], // muted
  [28, 60, 79], // subdued box
];
const C = {
  bg: 0,
  card: 1,
  grid: 2,
  official: 3,
  estimate: 4,
  white: 5,
  muted: 6,
  box: 7,
};
const TEXT_COLORS = [C.official, C.estimate, C.white, C.muted];
const PALETTE = fontPalette(
  COLORS,
  TEXT_COLORS.map((index) => COLORS[index]),
);

function canvas() {
  const pixels = new Uint8Array(WIDTH * HEIGHT);
  const rect = (x, y, w, h, color) => {
    const left = Math.max(0, Math.floor(x)),
      top = Math.max(0, Math.floor(y));
    const right = Math.min(WIDTH, Math.ceil(x + w)),
      bottom = Math.min(HEIGHT, Math.ceil(y + h));
    for (let row = top; row < bottom; row++)
      pixels.fill(color, row * WIDTH + left, row * WIDTH + right);
  };
  const line = (x0, y0, x1, y1, color, thickness = 2) => {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0),
      dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1,
      sy = y0 < y1 ? 1 : -1;
    let error = dx - dy;
    while (true) {
      rect(
        x0 - Math.floor(thickness / 2),
        y0 - Math.floor(thickness / 2),
        thickness,
        thickness,
        color,
      );
      if (x0 === x1 && y0 === y1) break;
      const e = 2 * error;
      if (e > -dy) {
        error -= dy;
        x0 += sx;
      }
      if (e < dx) {
        error += dx;
        y0 += sy;
      }
    }
  };
  const text = (value, x, y, scale = 3, color = C.white, align = "left") =>
    drawFontText(
      pixels,
      WIDTH,
      HEIGHT,
      value,
      x,
      y,
      { 2: 16, 3: 20, 5: 34 }[scale],
      color,
      align,
      TEXT_COLORS,
      COLORS.length,
    );
  return { pixels, rect, line, text };
}

function crcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
}
const CRC = crcTable();
function chunk(type, data) {
  const out = new Uint8Array(data.length + 12),
    view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < data.length + 8; i++)
    crc = CRC[(crc ^ out[i]) & 255] ^ (crc >>> 8);
  view.setUint32(data.length + 8, (crc ^ 0xffffffff) >>> 0);
  return out;
}
function deflateStored(raw) {
  const blocks = Math.ceil(raw.length / 65535),
    out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let offset = 2,
    a = 1,
    b = 0;
  for (let pos = 0; pos < raw.length; pos += 65535) {
    const length = Math.min(65535, raw.length - pos);
    out[offset++] = pos + length === raw.length ? 1 : 0;
    out[offset++] = length & 255;
    out[offset++] = length >>> 8;
    out[offset++] = ~length & 255;
    out[offset++] = (~length >>> 8) & 255;
    out.set(raw.subarray(pos, pos + length), offset);
    offset += length;
  }
  for (let i = 0; i < raw.length; i++) {
    a += raw[i];
    b += a;
    if (i % 5552 === 0) {
      a %= 65521;
      b %= 65521;
    }
  }
  a %= 65521;
  b %= 65521;
  new DataView(out.buffer).setUint32(offset, ((b << 16) | a) >>> 0);
  return out;
}
function png(pixels) {
  const raw = new Uint8Array(HEIGHT * (WIDTH + 1));
  for (let y = 0; y < HEIGHT; y++)
    raw.set(pixels.subarray(y * WIDTH, (y + 1) * WIDTH), y * (WIDTH + 1) + 1);
  const header = new Uint8Array(13),
    view = new DataView(header.buffer);
  view.setUint32(0, WIDTH);
  view.setUint32(4, HEIGHT);
  header[8] = 8;
  header[9] = 3;
  const palette = new Uint8Array(PALETTE.flat()),
    parts = [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("PLTE", palette),
      chunk("IDAT", deflateStored(raw)),
      chunk("IEND", new Uint8Array()),
    ];
  const bytes = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function panelBase(g, y, heading, max) {
  g.rect(30, y, 700, 245, C.card);
  g.text(heading, 55, y + 22, 3, C.white);
  const top = y + 78,
    bottom = y + 202;
  for (const fraction of [0, 0.5, 1]) {
    const lineY = bottom - fraction * (bottom - top);
    g.line(70, lineY, 710, lineY, C.grid, 1);
    g.text(
      String(Math.round(max * fraction)),
      62,
      lineY - 6,
      2,
      C.muted,
      "right",
    );
  }
  return { top, bottom };
}
function weeklyPanel(g, y, heading, rows, field, max) {
  const { top, bottom } = panelBase(g, y, heading, max);
  rows.forEach((row, i) => {
    const value = row[field] == null ? null : Number(row[field]),
      x = 97 + i * 95,
      color = row.estimated && field === "cost" ? C.estimate : C.official;
    if (value !== null && Number.isFinite(value)) {
      const height = Math.max(
        value > 0 ? 2 : 0,
        Math.round((value / max) * (bottom - top)),
      );
      g.rect(x - 26, bottom - height, 52, height, color);
      g.text(
        field === "cost" ? value.toFixed(2) : value.toFixed(3),
        x,
        bottom - height - 20,
        2,
        color,
        "center",
      );
    } else {
      g.rect(x - 24, bottom - 31, 48, 31, C.box);
      g.text("?", x, bottom - 24, 2, C.muted, "center");
    }
    g.text(row.date.slice(8), x, bottom + 13, 2, C.muted, "center");
  });
}
function monthlyPanel(g, y, heading, rows, field, max) {
  const { top, bottom } = panelBase(g, y, heading, max);
  let prior = null;
  rows.forEach((row, i) => {
    const x = 82 + i * (616 / Math.max(1, rows.length - 1)),
      value = row[field] == null ? null : Number(row[field]);
    if (
      i === 0 ||
      ((i + 1) % 5 === 0 && rows.length - i > 2) ||
      i === rows.length - 1
    )
      g.text(
        String(Number(row.date.slice(8))),
        x,
        bottom + 13,
        2,
        C.muted,
        "center",
      );
    if (value === null || !Number.isFinite(value)) {
      prior = null;
      return;
    }
    const pointY = bottom - (value / max) * (bottom - top),
      color = row.estimated && field === "cost" ? C.estimate : C.official;
    if (prior) g.line(prior.x, prior.y, x, pointY, color, 3);
    g.rect(x - 3, pointY - 3, 7, 7, color);
    prior = { x, y: pointY };
  });
}

export function renderChart(spec) {
  if (
    !spec ||
    !["week", "month"].includes(spec.kind) ||
    !Array.isArray(spec.rows) ||
    spec.rows.length < 1 ||
    spec.rows.length > 31 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(spec.start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(spec.end)
  )
    throw new Error("Invalid graph data.");
  const rows = spec.rows.map((row) => {
    const cost = row.cost == null ? null : Number(row.cost),
      units = row.units == null ? null : Number(row.units);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      (cost !== null &&
        (!Number.isFinite(cost) || cost < 0 || cost > 1000000)) ||
      (units !== null &&
        (!Number.isFinite(units) || units < 0 || units > 1000000))
    )
      throw new Error("Invalid graph value.");
    return { ...row, cost, units };
  });
  const g = canvas(),
    totalCost = rows.reduce((sum, row) => sum + (row.cost || 0), 0),
    officialCost = rows.reduce(
      (sum, row) => sum + (!row.estimated && row.cost != null ? row.cost : 0),
      0,
    ),
    units = rows.reduce((sum, row) => sum + (row.units || 0), 0),
    costMax = Math.max(1, ...rows.map((row) => row.cost || 0)) * 1.14,
    unitMax = Math.max(1, ...rows.map((row) => row.units || 0)) * 1.14;
  g.text("ZEUS DESCOBUDDY", 39, 32, 3, C.official);
  g.text(
    spec.kind === "week" ? "WEEKLY GRAPH" : "MONTHLY GRAPH",
    39,
    79,
    5,
    C.white,
  );
  g.text(`${spec.start} TO ${spec.end}`, 41, 130, 3, C.muted);
  g.rect(30, 177, 340, 92, C.card);
  g.rect(390, 177, 340, 92, C.card);
  g.text("COST SHOWN (TK)", 52, 196, 3, C.muted);
  g.text(totalCost.toFixed(2), 52, 226, 5, C.white);
  g.text("DESCO KWH", 412, 196, 3, C.muted);
  g.text(units.toFixed(3), 412, 226, 5, C.white);
  const draw = spec.kind === "week" ? weeklyPanel : monthlyPanel;
  draw(g, 292, "DAILY COST (TK)", rows, "cost", costMax);
  draw(g, 554, "ELECTRICITY (KWH)", rows, "units", unitMax);
  g.rect(31, 824, 20, 20, C.official);
  g.text("DESCO CONFIRMED", 61, 826, 3, C.muted);
  g.rect(414, 824, 20, 20, C.estimate);
  g.text("PROBABLE COST", 444, 826, 3, C.muted);
  if (totalCost > officialCost)
    g.text(
      `INCLUDES TK ${(totalCost - officialCost).toFixed(2)} UNOFFICIAL`,
      39,
      858,
      2,
      C.estimate,
    );
  return png(g.pixels);
}
