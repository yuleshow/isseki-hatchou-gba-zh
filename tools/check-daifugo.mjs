import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { decompressLz77, loadRom } from './inspect-rom.mjs';

const source = loadRom();
const palette = readFileSync('work/daifugo-opening.palette');
const report = JSON.parse(readFileSync('dist/report.json', 'utf8'));
const patched = readFileSync('work/isseki-hatchou-zh-hant-preview.gba');
assert.equal(report.daifugoTextValidation.labels.length, 28);
const resources = [
  { graphics: 0x15e830, table: 0x15e7d0, count: 10, layouts: 0x15e1bc, base: 0x10000 },
  { graphics: 0x160448, table: 0x1603d4, count: 18, layouts: 0x15f3f4, base: 0x117e0 },
];
for (const resource of resources) {
  assert.deepEqual(report.daifugoTextValidation.labels.filter(label => label.graphics === resource.graphics).map(label => label.animation).sort((first, second) => first - second), Array.from({ length: resource.count }, (_, index) => index));
}
const exchange = report.daifugoTextValidation.labels.find(label => label.graphics === 0x160448 && label.animation === 13);
assert.deepEqual(exchange.parts.map(part => [part.text, part.left, part.width]), [['交', 0, 24], ['換', 24, 24], ['中', 48, 24]]);
const exchangeFrame = source.readUInt32LE(0x1603d4 + 13 * 4) - 0x08000000;
for (let step = 0; step < 10; step++) {
  const frame = exchangeFrame + step * 8, layout = source.readUInt32LE(frame) - 0x08000000;
  assert.equal(source.readUInt16LE(frame + 4), 6);
  assert.equal(source.readUInt16LE(frame + 6), 12);
  for (let group = 0; group < 3; group++) {
    const groupStart = group * 4;
    const displacement = source.readInt16LE(layout + groupStart * 12 + 4) - source.readInt16LE(exchange.layout + groupStart * 12 + 4);
    assert(displacement >= -6 && displacement <= 0);
    for (let sprite = groupStart; sprite < groupStart + 4; sprite++) {
      const descriptor = layout + sprite * 12, originalDescriptor = exchange.layout + sprite * 12;
      assert.deepEqual(source.subarray(descriptor, descriptor + 4), source.subarray(originalDescriptor, originalDescriptor + 4));
      assert.deepEqual(source.subarray(descriptor + 6, descriptor + 12), source.subarray(originalDescriptor + 6, originalDescriptor + 12));
      assert.equal(source.readInt16LE(descriptor + 4), source.readInt16LE(originalDescriptor + 4) + displacement, 'Exchange character split across animation groups');
    }
  }
}
assert.equal(source.readUInt32LE(exchangeFrame + 80), 0x0fffffff);
for (const resource of resources) {
  const original = decompressLz77(source, resource.graphics).data;
  const relocation = report.resourceChanges.find(entry => entry.offset === resource.graphics);
  const updated = decompressLz77(patched, relocation.target).data;
  assert.equal(updated.length, original.length);
  assert.deepEqual(patched.subarray(resource.layouts, resource.graphics), source.subarray(resource.layouts, resource.graphics));
  const painted = new Set();
  for (const label of report.daifugoTextValidation.labels.filter(label => label.graphics === resource.graphics)) {
    const rect = label.rect ?? { left: 0, top: 1, width: 32, height: 14 };
    const mask = Buffer.alloc(rect.width * rect.height);
    for (const part of label.parts ?? [{ text: label.text, left: 0, width: rect.width }]) {
      const rendered = execFileSync('magick', ['-background', 'black', '-fill', 'white', '-font', report.translationFont.file, '-pointsize', String(label.pointSize * 19 / 12), '+antialias', `label:${part.text}`, '-trim', '+repage', '-gravity', part.gravity ?? 'center', '-extent', `${part.width}x${rect.height}`, '-colorspace', 'Gray', '-depth', '8', 'gray:-']);
      for (let row = 0; row < rect.height; row++) rendered.copy(mask, row * rect.width + part.left, row * part.width, (row + 1) * part.width);
    }
    const actualInk = new Set();
    for (let sprite = 0; sprite < label.spriteCount; sprite++) {
      const descriptor = label.layout + sprite * 12, tile = source.readUInt16LE(descriptor);
      const left = source.readInt16LE(descriptor + 2), top = source.readInt16LE(descriptor + 4), size = source[descriptor + 9];
      const width = 8 << (size >> 2), height = 8 << (size & 3);
      for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
        const pixel = (tile + Math.floor(row / 8) * width / 8 + Math.floor(column / 8)) * 64 + row % 8 * 8 + column % 8;
        painted.add(pixel);
        const color = (updated[pixel >> 1] >> ((pixel % 2) * 4)) & 15;
        const horizontal = left + column - rect.left, vertical = top + row - rect.top;
        const ink = (horizontal, vertical) => horizontal >= 0 && horizontal < rect.width && vertical >= 0 && vertical < rect.height && mask[vertical * rect.width + horizontal] > 127;
        const interior = horizontal >= 0 && horizontal < rect.width && vertical >= 0 && vertical < rect.height;
        if (color === (label.status ? 7 : label.small ? 1 : 2) && (!label.status || interior)) actualInk.add(`${horizontal},${vertical}`);
        if (ink(horizontal, vertical)) assert.equal(color, label.status ? 7 : label.small ? 1 : 2, `${label.text}: lost ink`);
        else if (label.status) {
          const originalColor = (original[pixel >> 1] >> ((pixel % 2) * 4)) & 15;
          assert.equal(color, interior ? 1 : originalColor, `${label.text}: status background or border`);
        } else if (!label.small) {
          let outline = false;
          for (let deltaY = -1; deltaY <= 1; deltaY++) for (let deltaX = -1; deltaX <= 1; deltaX++) outline ||= ink(horizontal + deltaX, vertical + deltaY);
          assert.equal(color, outline ? 7 : 0, `${label.text}: background or outline`);
        } else {
          const originalColumn = column < 20 ? column : column < 28 ? 19 : column - 8;
          const originalPixel = (64 + Math.floor(row / 8) * 4 + Math.floor(originalColumn / 8)) * 64 + row % 8 * 8 + originalColumn % 8;
          const border = (original[originalPixel >> 1] >> ((originalPixel % 2) * 4)) & 15;
          assert.equal(color, row > 0 && row < 14 && column > 0 && column < 29 ? 7 : border, `${label.text}: small frame`);
        }
      }
    }
    assert.equal(actualInk.size, mask.filter(value => value > 127).length, `${label.text}: extra or clipped ink`);
  }
  for (let pixel = 0; pixel < original.length * 2; pixel++) if (!painted.has(pixel)) assert.equal((updated[pixel >> 1] >> ((pixel % 2) * 4)) & 15, (original[pixel >> 1] >> ((pixel % 2) * 4)) & 15, 'Unrelated daifugo pixel');
  const views = Array.from({ length: resource.count }, (_, animation) => ({ animation, step: 0 }));
  if (resource.graphics === 0x160448) views.push(...Array.from({ length: 9 }, (_, index) => ({ animation: 13, step: index + 1 })));
  for (const [version, graphics] of [original, updated].entries()) {
  const sheet = Buffer.alloc(256 * views.length * 40 * 3);
  for (const [viewIndex, { animation, step }] of views.entries()) {
    const frame = source.readUInt32LE(resource.table + animation * 4) - 0x08000000 + step * 8;
    const layout = source.readUInt32LE(frame) - 0x08000000;
    const count = source.readUInt16LE(frame + 6);
    const descriptors = [];
    const originY = Math.min(...Array.from({ length: count }, (_, sprite) => source.readInt16LE(layout + sprite * 12 + 4)));
    for (let sprite = count - 1; sprite >= 0; sprite--) {
      const descriptor = layout + sprite * 12;
      const tile = source.readUInt16LE(descriptor);
      const left = source.readInt16LE(descriptor + 2), top = source.readInt16LE(descriptor + 4);
      const bank = source[descriptor + 7], size = source[descriptor + 9];
      const width = 8 << (size >> 2), height = 8 << (size & 3);
      descriptors.push({ tile, left, top, width, height, bank });
      for (let row = 0; row < height; row++) {
        for (let column = 0; column < width; column++) {
          const offset = (tile + Math.floor(row / 8) * (width / 8) + Math.floor(column / 8)) * 32 + (row % 8) * 4 + Math.floor(column % 8 / 2);
          assert(offset < graphics.length);
          const color = (graphics[offset] >> ((column % 2) * 4)) & 15;
          const rgb = palette.readUInt16LE(512 + bank * 32 + color * 2);
          if (color === 0) continue;
          const horizontal = left + column, vertical = top + row - originY;
          if (horizontal < 0 || horizontal >= 256 || vertical < 0 || vertical >= 40) continue;
          const pixel = ((viewIndex * 40 + vertical) * 256 + horizontal) * 3;
          for (let component = 0; component < 3; component++) sheet[pixel + component] = Math.round(((rgb >> (component * 5)) & 31) * 255 / 31);
        }
      }
    }
  }
  execFileSync('magick', ['-size', `256x${views.length * 40}`, '-depth', '8', 'rgb:-', '-filter', 'point', '-resize', '200%', `work/daifugo-text-${resource.graphics.toString(16)}${version ? '-zh' : ''}.png`], { input: sheet });
  }
}
console.log(`Verified ${report.daifugoTextValidation.labels.length} daifugo labels: exact Silver masks, outlines, frames, unrelated pixels, allocations and original animations`);
console.log('Verified all ten exchange animation frames: whole-character motion and original timing preserved');

if (process.argv.includes('--capture')) {
  const opening = ['600:0', '1:8', '120:0', '1:8', '120:0', '1:1', '60:0', '1:1', '120:0', '1:80', '20:0', '1:80', '20:0', '1:10', '20:0', '1:1', '180:0', '1:1', '120:0', '1:1', '600:0'];
  for (const turns of [0, 1, 4]) {
    const sequence = [...opening, ...Array.from({ length: turns }, () => ['1:2', '180:0']).flat()];
    const prefix = `work/daifugo-text-turns-${turns}`;
    for (const [rom, suffix] of [['work/original.gba', ''], ['work/isseki-hatchou-zh-hant-preview.gba', '-zh']]) execFileSync('work/capture', [rom, `${prefix}${suffix}`, ...sequence], { stdio: 'inherit' });
    const before = readFileSync(`${prefix}.vram`), after = readFileSync(`${prefix}-zh.vram`);
    for (const resource of resources) {
      const original = decompressLz77(source, resource.graphics).data;
      const updated = decompressLz77(patched, report.resourceChanges.find(entry => entry.offset === resource.graphics).target).data;
      assert.deepEqual(before.subarray(resource.base, resource.base + original.length), original);
      assert.deepEqual(after.subarray(resource.base, resource.base + updated.length), updated);
      updated.copy(before, resource.base);
    }
    const footer = decompressLz77(source, 0x15c090).data;
    assert.deepEqual(before.subarray(0x15900, 0x15900 + footer.length), footer);
    decompressLz77(patched, report.resourceChanges.find(entry => entry.offset === 0x15c090).target).data.copy(before, 0x15900);
    const originalMap = decompressLz77(source, 0x1597b8).data;
    const updatedMap = decompressLz77(patched, report.resourceChanges.find(entry => entry.offset === 0x1597b8).target).data;
    for (let row = 0; row < 20; row++) for (let column = 0; column < 30; column++) {
      const mapOffset = 4 + (row * 30 + column) * 2, vramOffset = 0xe800 + row * 64 + column * 2;
      assert.equal(before.readUInt16LE(vramOffset), originalMap.readUInt16LE(mapOffset));
      before.writeUInt16LE(updatedMap.readUInt16LE(mapOffset), vramOffset);
    }
    assert.deepEqual(after, before, `${prefix}: other VRAM changed`);
    for (const extension of ['oam', 'palette']) assert.deepEqual(readFileSync(`${prefix}.${extension}`), readFileSync(`${prefix}-zh.${extension}`), `${prefix}: ${extension} changed`);
    console.log(`Verified natural daifugo ${turns} turns: exact VRAM, palette and OAM`);
  }
}