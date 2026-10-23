// Indexed-PNG chart renderer for the Workers free tier.
// No meter data leaves Cloudflare except in the user's Telegram photo.
import { drawFontText, fontPalette } from "./font.js";
const WIDTH = 760;
const HEIGHT = 900;
const COLORS = [
  [20, 27, 58], // logo navy, background
  [29, 39, 80], // card
  [40, 52, 95], // elevated card / subtle outline
  [69, 81, 122], // grid and hairlines
  [255, 197, 51], // logo yellow, confirmed cost
  [244, 151, 99], // warm orange, unofficial cost
  [238, 241, 249], // logo white
  [167, 178, 208], // secondary text
  [180, 192, 231], // kWh, cool neutral from logo white/navy
  [49, 61, 103], // pending placeholder
];
const C = {
  bg: 0,
  card: 1,
  raised: 2,
  grid: 3,
  official: 4,
  estimate: 5,
  white: 6,
  muted: 7,
  units: 8,
  box: 9,
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
  const roundRect = (x, y, w, h, radius, color) => {
    const r = Math.min(radius, Math.floor(w / 2), Math.floor(h / 2));
    rect(x + r, y, w - 2 * r, h, color);
    rect(x, y + r, w, h - 2 * r, color);
    for (let row = 0; row < r; row++) {
      const inset = Math.ceil(r - Math.sqrt(r * r - (r - row - 0.5) ** 2));
      rect(x + inset, y + row, w - 2 * inset, 1, color);
      rect(x + inset, y + h - row - 1, w - 2 * inset, 1, color);
    }
  };
  const polygon = (points, color) => {
    const top = Math.floor(Math.min(...points.map((point) => point[1])));
    const bottom = Math.ceil(Math.max(...points.map((point) => point[1])));
    for (let y = top; y < bottom; y++) {
      const crossings = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i],
          b = points[(i + 1) % points.length];
        if (
          (a[1] <= y + 0.5 && b[1] > y + 0.5) ||
          (b[1] <= y + 0.5 && a[1] > y + 0.5)
        )
          crossings.push(
            a[0] + ((y + 0.5 - a[1]) * (b[0] - a[0])) / (b[1] - a[1]),
          );
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2)
        rect(crossings[i], y, crossings[i + 1] - crossings[i], 1, color);
    }
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
  return { pixels, rect, roundRect, polygon, line, text };
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

function panelBase(g, y, heading, max, available, total) {
  g.roundRect(30, y, 700, 235, 16, C.raised);
  g.roundRect(32, y + 2, 696, 231, 14, C.card);
  g.text(heading, 54, y + 20, 3, C.white);
  g.text(`${available}/${total} DAYS`, 700, y + 23, 2, C.muted, "right");
  g.rect(54, y + 53, 36, 3, C.official);
  const top = y + 79,
    bottom = y + 193;
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
  const { top, bottom } = panelBase(
    g,
    y,
    heading,
    max,
    rows.filter((row) => row[field] != null).length,
    rows.length,
  );
  rows.forEach((row, i) => {
    const value = row[field] == null ? null : Number(row[field]),
      x = 97 + i * 95,
      color =
        field === "units" ? C.units : row.estimated ? C.estimate : C.official;
    if (value !== null && Number.isFinite(value)) {
      const height = Math.max(
        value > 0 ? 2 : 0,
        Math.round((value / max) * (bottom - top)),
      );
      g.roundRect(x - 24, bottom - height, 48, height, 5, color);
      g.text(
        field === "cost" ? value.toFixed(2) : value.toFixed(3),
        x,
        bottom - height - 23,
        2,
        field === "units" ? C.white : color,
        "center",
      );
    } else {
      g.roundRect(x - 24, bottom - 30, 48, 30, 5, C.box);
      g.text("?", x, bottom - 25, 2, C.muted, "center");
    }
    g.text(row.date.slice(8), x, bottom + 12, 2, C.muted, "center");
  });
}
function monthlyPanel(g, y, heading, rows, field, max) {
  const { top, bottom } = panelBase(
    g,
    y,
    heading,
    max,
    rows.filter((row) => row[field] != null).length,
    rows.length,
  );
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
        bottom + 12,
        2,
        C.muted,
        "center",
      );
    if (value === null || !Number.isFinite(value)) {
      prior = null;
      return;
    }
    const pointY = bottom - (value / max) * (bottom - top),
      color =
        field === "units" ? C.units : row.estimated ? C.estimate : C.official;
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
  // The exact navy, yellow, and white come from assets/zeus-logo-horizontal-dark.png.
  g.roundRect(30, 25, 56, 56, 12, C.official);
  g.rect(44, 39, 29, 7, C.bg);
  g.polygon(
    [
      [67, 46],
      [75, 46],
      [52, 69],
      [44, 69],
    ],
    C.bg,
  );
  g.rect(44, 67, 30, 7, C.bg);
  g.text("ZEUS", 103, 29, 5, C.white);
  g.text("DESCOBUDDY", 105, 67, 2, C.muted);
  g.text(
    spec.kind === "week" ? "WEEKLY USAGE" : "MONTHLY USAGE",
    31,
    107,
    5,
    C.white,
  );
  g.text(`${spec.start} TO ${spec.end}`, 32, 153, 3, C.muted);
  g.rect(30, 187, 700, 2, C.grid);
  g.rect(30, 187, 96, 3, C.official);

  g.roundRect(30, 205, 426, 112, 14, C.raised);
  g.roundRect(32, 207, 422, 108, 12, C.card);
  g.rect(50, 225, 4, 66, C.official);
  g.text("COST SHOWN", 70, 221, 3, C.muted);
  g.text(`TK ${totalCost.toFixed(2)}`, 70, 251, 5, C.white);
  g.text(
    totalCost > officialCost ? "INCLUDES PROBABLE COST" : "DESCO DAILY COST",
    70,
    289,
    2,
    totalCost > officialCost ? C.estimate : C.muted,
  );

  g.roundRect(473, 205, 257, 112, 14, C.raised);
  g.roundRect(475, 207, 253, 108, 12, C.card);
  g.rect(493, 225, 4, 66, C.units);
  g.text("UNITS SHOWN", 513, 221, 3, C.muted);
  g.text(units.toFixed(3), 513, 251, 5, C.white);
  g.text("DESCO KWH", 513, 289, 2, C.muted);

  const draw = spec.kind === "week" ? weeklyPanel : monthlyPanel;
  draw(g, 337, "DAILY COST / TK", rows, "cost", costMax);
  draw(g, 588, "ELECTRICITY / KWH", rows, "units", unitMax);

  g.roundRect(30, 843, 16, 16, 4, C.official);
  g.text("DESCO COST", 55, 841, 2, C.muted);
  g.roundRect(244, 843, 16, 16, 4, C.estimate);
  g.text("PROBABLE", 269, 841, 2, C.muted);
  g.roundRect(446, 843, 16, 16, 4, C.units);
  g.text("KWH", 471, 841, 2, C.muted);
  if (totalCost > officialCost)
    g.text(
      `PROBABLE TK ${(totalCost - officialCost).toFixed(2)} IS NOT DESCO DAILY COST`,
      31,
      870,
      2,
      C.estimate,
    );
  else if (rows.some((row) => row.cost == null || row.units == null))
    g.text("PENDING DAYS ARE NOT COUNTED IN TOTALS", 31, 870, 2, C.muted);
  else g.text("ALL DAYS HAVE DESCO-PUBLISHED VALUES", 31, 870, 2, C.muted);
  return png(g.pixels);
}
