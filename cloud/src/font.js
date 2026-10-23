import atlas from "./font-atlas.js";

// The generated atlas uses real Roboto outlines rasterized at build time.
// Seven premultiplied shades keep the indexed PNG small and smooth.
export function fontPalette(baseColors, foregroundColors) {
  const palette = [...baseColors];
  for (const base of baseColors)
    for (const foreground of foregroundColors)
      for (let shade = 1; shade <= 7; shade++) {
        const opacity = shade / 7;
        palette.push(
          base.map((component, i) =>
            Math.round(component * (1 - opacity) + foreground[i] * opacity),
          ),
        );
      }
  return palette;
}

const decoded = new Map();
function glyph(size, char) {
  const source = atlas[size][char] || atlas[size]["?"];
  if (!source.data) return { ...source, bytes: null };
  const key = `${size}:${char}`;
  if (!decoded.has(key))
    decoded.set(
      key,
      Uint8Array.from(atob(source.data), (letter) => letter.charCodeAt(0)),
    );
  return { ...source, bytes: decoded.get(key) };
}

export function drawFontText(
  pixels,
  width,
  height,
  value,
  x,
  y,
  size,
  color,
  align,
  foregroundIndices,
  baseColorCount,
) {
  const letters = [...String(value).toUpperCase()].map((char) =>
    glyph(size, char),
  );
  const textWidth = letters.reduce((sum, letter) => sum + letter.advance, 0);
  let cursor = Math.round(
    align === "center"
      ? x - textWidth / 2
      : align === "right"
        ? x - textWidth
        : x,
  );
  const foreground = foregroundIndices.indexOf(color);
  if (foreground < 0) throw new Error("Unsupported font color.");
  for (const letter of letters) {
    if (letter.bytes)
      for (let row = 0; row < letter.h; row++) {
        const py = Math.round(y + letter.y + row);
        if (py < 0 || py >= height) continue;
        for (let column = 0; column < letter.w; column++) {
          const px = cursor + letter.x + column;
          if (px < 0 || px >= width) continue;
          const offset = row * letter.w + column;
          const packed = letter.bytes[offset >> 1];
          const alpha = offset & 1 ? packed & 15 : packed >> 4;
          const shade = Math.round((alpha * 7) / 15);
          if (!shade) continue;
          const index = py * width + px;
          const background =
            pixels[index] < baseColorCount
              ? pixels[index]
              : Math.floor(
                  (pixels[index] - baseColorCount) /
                    (foregroundIndices.length * 7),
                );
          pixels[index] =
            baseColorCount +
            background * foregroundIndices.length * 7 +
            foreground * 7 +
            shade -
            1;
        }
      }
    cursor += letter.advance;
  }
}
