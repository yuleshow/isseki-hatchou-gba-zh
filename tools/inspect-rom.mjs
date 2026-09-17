import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const sourceArchive = fileURLToPath(new URL('../assets/Isseki Hatchou - Kore 1ppon de 8shurui! (Japan).zip', import.meta.url));
export const sourceSha256 = 'f8d2857075b2de7b0a13f657dfc8974d211fb271d0c323a1cf65c39360dcdd06';

export function loadRom(path = sourceArchive) {
  const rom = path.toLowerCase().endsWith('.zip')
    ? execFileSync('unzip', ['-p', path, '*.gba'], { maxBuffer: 32 * 1024 * 1024 })
    : readFileSync(path);
  assert.equal(createHash('sha256').update(rom).digest('hex'), sourceSha256, 'Unsupported source ROM');
  return rom;
}

export function decompressLz77(source, offset = 0, maxSize = 0x40000) {
  assert.equal(source[offset], 0x10, 'Not GBA LZ77');
  const size = source.readUIntLE(offset + 1, 3);
  assert(size > 0 && size <= maxSize, 'Invalid decompressed size');
  const data = Buffer.alloc(size);
  let cursor = offset + 4;
  let written = 0;
  while (written < size) {
    assert(cursor < source.length, 'Truncated flags');
    const flags = source[cursor++];
    for (let bit = 7; bit >= 0 && written < size; bit--) {
      if (flags & (1 << bit)) {
        assert(cursor + 1 < source.length, 'Truncated reference');
        const first = source[cursor++];
        const second = source[cursor++];
        const length = (first >> 4) + 3;
        const distance = ((first & 15) << 8) + second + 1;
        assert(distance <= written, 'Reference before output');
        for (let count = 0; count < length && written < size; count++) {
          data[written] = data[written - distance];
          written++;
        }
      } else {
        assert(cursor < source.length, 'Truncated literal');
        data[written++] = source[cursor++];
      }
    }
  }
  return { data, consumed: cursor - offset };
}

export function compressLz77(data) {
  assert(data.length > 0 && data.length <= 0xffffff);
  const output = [0x10, data.length & 255, (data.length >> 8) & 255, data.length >> 16];
  let position = 0;
  while (position < data.length) {
    const flagPosition = output.length;
    output.push(0);
    for (let bit = 7; bit >= 0 && position < data.length; bit--) {
      let bestLength = 0;
      let bestDistance = 0;
      for (let distance = 2; distance <= Math.min(position, 4096); distance++) {
        let length = 0;
        while (length < 18 && position + length < data.length && data[position + length] === data[position + length - distance]) length++;
        if (length > bestLength) {
          bestLength = length;
          bestDistance = distance;
        }
        if (length === 18) break;
      }
      if (bestLength >= 3) {
        output[flagPosition] |= 1 << bit;
        const reference = ((bestLength - 3) << 12) | (bestDistance - 1);
        output.push(reference >> 8, reference & 255);
        position += bestLength;
      } else {
        output.push(data[position++]);
      }
    }
  }
  return Buffer.from(output);
}

export function renderTiles(data, path, columns = 32) {
  const tiles = Math.floor(data.length / 32);
  assert(tiles > 0, 'No complete 4bpp tiles');
  const width = columns * 8;
  const height = Math.ceil(tiles / columns) * 8;
  const pixels = Buffer.alloc(width * height, 255);
  for (let tile = 0; tile < tiles; tile++) {
    for (let pixel = 0; pixel < 64; pixel++) {
      const packed = data[tile * 32 + (pixel >> 1)];
      const value = (packed >> ((pixel & 1) * 4)) & 15;
      const horizontal = (tile % columns) * 8 + (pixel % 8);
      const vertical = Math.floor(tile / columns) * 8 + Math.floor(pixel / 8);
      pixels[vertical * width + horizontal] = 255 - value * 17;
    }
  }
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-i', 'pipe:0', '-frames:v', '1', '-update', '1', path], {
    input: Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), pixels]),
  });
}

export function scanResources(rom) {
  const pointers = new Map();
  for (let location = 0; location + 4 <= rom.length; location += 4) {
    const target = rom.readUInt32LE(location) - 0x08000000;
    if (target < 0 || target >= rom.length || target % 4 !== 0) continue;
    if (!pointers.has(target)) pointers.set(target, []);
    pointers.get(target).push(location);
  }
  const resources = [];
  for (const [offset, references] of pointers) {
    if (offset + 4 > rom.length || rom[offset] !== 0x10) continue;
    try {
      const { data, consumed } = decompressLz77(rom, offset);
      if (data.length < 32 || data.length % 32 !== 0) continue;
      resources.push({ offset, compressedBytes: consumed, decodedBytes: data.length, references });
    } catch {
      continue;
    }
  }
  return resources.sort((first, second) => first.offset - second.offset);
}

function selfTest() {
  assert.equal(decompressLz77(Buffer.from([0x10, 6, 0, 0, 0x10, 65, 66, 67, 0, 2])).data.toString(), 'ABCABC');
  assert.equal(decompressLz77(Buffer.from([0x10, 6, 0, 0, 0x40, 65, 0x20, 0])).data.toString(), 'AAAAAA');
  assert.throws(() => decompressLz77(Buffer.from([0x10, 3, 0, 0, 0x80, 0, 0])));
  assert.throws(() => decompressLz77(Buffer.from([0x10, 3, 0, 0, 0, 65])));
  assert.throws(() => decompressLz77(Buffer.from([0x10, 0, 0, 0])));
  for (const data of [Buffer.from('ABCABC'), Buffer.alloc(10000, 65), Buffer.from(Array.from({ length: 1024 }, (_, index) => index & 255))]) {
    assert.deepEqual(decompressLz77(compressLz77(data)).data, data);
  }
  console.log('LZ77 compression and decompression self-tests passed');
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--self-test') return selfTest();
  const rom = loadRom();
  if (command === 'scan') {
    const output = args[0] ?? 'work/analysis';
    mkdirSync(output, { recursive: true });
    const resources = scanResources(rom);
    writeFileSync(join(output, 'resources.json'), JSON.stringify({ sha256: sourceSha256, resources }, null, 2) + '\n');
    console.log(`Found ${resources.length} pointer-referenced LZ77 candidates`);
    for (const resource of resources) {
      const name = resource.offset.toString(16).padStart(6, '0');
      const { data } = decompressLz77(rom, resource.offset);
      writeFileSync(join(output, `${name}.bin`), data);
      renderTiles(data, join(output, `${name}.png`));
      console.log(`0x${name}: ${resource.compressedBytes} -> ${data.length} bytes`);
    }
  } else if (command === 'tiles') {
    const [start, length, output = 'work/tiles.png'] = args;
    const offset = Number(start);
    const size = Number(length);
    assert(Number.isInteger(offset) && offset >= 0 && Number.isInteger(size) && size > 0 && offset + size <= rom.length, 'Invalid ROM range');
    renderTiles(rom.subarray(offset, offset + size), output);
  } else {
    throw new Error('Usage: node tools/inspect-rom.mjs --self-test | scan [output-directory] | tiles offset length [output.png]');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();