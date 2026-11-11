import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const ICON_SIZES = [16, 32, 48, 128];
const FILL = [31, 111, 120, 255];
const MARK = [244, 247, 244, 255];

export function iconLayout(size) {
  if (size === 128) return { margin: 16, radius: 18 };
  if (size === 48) return { margin: 4, radius: 8 };
  if (size === 32) return { margin: 3, radius: 6 };
  if (size === 16) return { margin: 1, radius: 3 };
  throw new Error(`Unsupported icon size ${size}.`);
}

function insideRoundRect(x, y, left, top, size, radius) {
  const right = left + size - 1;
  const bottom = top + size - 1;
  if (x < left || y < top || x > right || y > bottom) return false;
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  if (x === cx && y === cy) return true;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

export function renderIcon(size) {
  const { margin, radius } = iconLayout(size);
  const art = size - margin * 2;
  const pixels = Buffer.alloc(size * size * 4);
  const barWidth = Math.max(4, Math.round(art * 0.52));
  const barHeight = Math.max(2, Math.round(art * 0.1));
  const gap = Math.max(2, Math.round(art * 0.12));
  const barLeft = margin + Math.round((art - barWidth) / 2);
  const stack = barHeight * 2 + gap;
  const barTop = margin + Math.round((art - stack) / 2);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      if (!insideRoundRect(x, y, margin, margin, art, radius)) continue;
      const onBar =
        x >= barLeft &&
        x < barLeft + barWidth &&
        ((y >= barTop && y < barTop + barHeight) ||
          (y >= barTop + barHeight + gap && y < barTop + stack));
      const color = onBar ? MARK : FILL;
      pixels.set(color, offset);
    }
  }
  return pixels;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

export function encodePng(size, pixels = renderIcon(size)) {
  if (pixels.length !== size * size * 4) throw new Error("Unexpected pixel buffer.");
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    pixels.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const size of ICON_SIZES) {
    writeFileSync(new URL(`./icons/icon${size}.png`, import.meta.url), encodePng(size));
  }
}
