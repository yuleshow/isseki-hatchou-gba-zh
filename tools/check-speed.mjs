import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { decompressLz77, loadRom } from './inspect-rom.mjs';

const source = loadRom();
const palette = readFileSync('work/speed-opening.palette');
const graphics = decompressLz77(source, 0x14fd60).data;
const sheet = Buffer.alloc(256 * 27 * 80 * 3);
for (let animation = 0; animation < 27; animation++) {
  const frame = source.readUInt32LE(0x14fcf4 + animation * 4) - 0x08000000;
  const layout = source.readUInt32LE(frame) - 0x08000000, count = source.readUInt16LE(frame + 6);
  const sprites = Array.from({ length: count }, (_, index) => {
    const descriptor = layout + index * 12, size = source[descriptor + 9];
    return { tile: source.readUInt16LE(descriptor), left: source.readInt16LE(descriptor + 2), top: source.readInt16LE(descriptor + 4), bank: source[descriptor + 7], width: 8 << (size >> 2), height: 8 << (size & 3) };
  });
  const originX = Math.min(...sprites.map(sprite => sprite.left)), originY = Math.min(...sprites.map(sprite => sprite.top));
  console.log(animation, layout.toString(16), JSON.stringify(sprites));
  for (const sprite of sprites.toReversed()) {
    for (let row = 0; row < sprite.height; row++) for (let column = 0; column < sprite.width; column++) {
      const offset = (sprite.tile + Math.floor(row / 8) * sprite.width / 8 + Math.floor(column / 8)) * 32 + row % 8 * 4 + Math.floor(column % 8 / 2);
      assert(offset < graphics.length);
      const color = (graphics[offset] >> ((column % 2) * 4)) & 15;
      if (!color) continue;
      const horizontal = sprite.left + column - originX, vertical = sprite.top + row - originY;
      assert(horizontal >= 0 && horizontal < 256 && vertical >= 0 && vertical < 80);
      const rgb = palette.readUInt16LE(512 + sprite.bank * 32 + color * 2), pixel = ((animation * 80 + vertical) * 256 + horizontal) * 3;
      for (let component = 0; component < 3; component++) sheet[pixel + component] = Math.round(((rgb >> (component * 5)) & 31) * 255 / 31);
    }
  }
}
execFileSync('magick', ['-size', '256x2160', '-depth', '8', 'rgb:-', '-filter', 'point', '-resize', '200%', 'work/speed-text-original.png'], { input: sheet });