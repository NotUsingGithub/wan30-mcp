import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const files = [
  '.actor/actor.json',
  '.actor/dataset_schema.json',
  '.actor/input_schema.json',
  '.actor/output_schema.json',
  '.dockerignore',
  'Dockerfile',
  'LICENSE',
  'README.md',
  'package.json',
  'package.mjs',
  'src/main.js',
  'test/run.mjs',
];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
}

function u32(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0);
  return out;
}

function zipStored(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ]);
    locals.push(local);
    central.push(Buffer.concat([
      u32(0x02014b50),
      u16(0x0314),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0o100644 << 16),
      u32(offset),
      name,
    ]));
    offset += local.length;
  }
  const centralDir = Buffer.concat(central);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralDir, end]);
}

const archive = zipStored(files.map((name) => ({
  name,
  data: readFileSync(resolve(here, name)),
})));
const digest = createHash('sha256').update(archive).digest('hex');
const destination = resolve('/opt/cursor/artifacts/wan30-video-0.1.0-apify-source.zip');
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, archive);
writeFileSync(`${destination}.sha256`, `${digest}  wan30-video-0.1.0-apify-source.zip\n`);
console.log(destination);
console.log(digest);
