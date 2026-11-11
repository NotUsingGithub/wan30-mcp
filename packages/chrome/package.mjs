import { crc32, deflateRawSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const PACKAGE_PATHS = [
  "LICENSE",
  "icons/icon128.png",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "manifest.json",
  "popup.css",
  "popup.html",
  "popup.js",
  "setup.js",
];

const ZIP_DATE = new Date(Date.UTC(2026, 10, 11, 0, 0, 0));

function dosStamp(date) {
  const time =
    (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
  const day =
    ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time, day };
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

export function buildZip(files) {
  const { time, day } = dosStamp(ZIP_DATE);
  const locals = [];
  const centrals = [];
  let offset = 0;
  const ordered = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const file of ordered) {
    if (file.name.includes("\\") || file.name.startsWith("/") || file.name.includes(".."))
      throw new Error(`Unsafe zip path ${file.name}.`);
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const compressed = deflateRawSync(data, { level: 9 });
    const name = Buffer.from(file.name);
    const checksum = crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(8),
      u16(time),
      u16(day),
      u32(checksum),
      u32(compressed.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      compressed,
    ]);
    locals.push(local);
    centrals.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(8),
        u16(time),
        u16(day),
        u32(checksum),
        u32(compressed.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ])
    );
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, central, eocd]);
}

export function readZip(buffer) {
  const files = [];
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const dataStart = nameStart + nameLength + extraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method !== 8) throw new Error(`Unexpected compression for ${name}.`);
    files.push({ name, compressed });
    offset = dataStart + compressedSize;
  }
  return files;
}

export function extensionFiles(root = new URL("./", import.meta.url)) {
  return PACKAGE_PATHS.map((name) => ({
    name,
    data: readFileSync(new URL(name, root)),
  }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: node package.mjs <zip-path>");
  writeFileSync(target, buildZip(extensionFiles()));
}
