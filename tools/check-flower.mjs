import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { decompressLz77, loadRom } from './inspect-rom.mjs';

const source = loadRom();
const report = JSON.parse(readFileSync('dist/report.json', 'utf8'));
const rom = readFileSync('work/isseki-hatchou-zh-hant-preview.gba');
const config = report.flowerTextValidation;
assert.equal(config.graphics, 0x13c914);
assert.equal(config.labels.length, 37);
const original = decompressLz77(source, config.graphics).data;
const updated = decompressLz77(rom, report.resourceChanges.find(entry => entry.offset === config.graphics).target).data;
assert.equal(updated.length, 15648);
assert.deepEqual(rom.subarray(0x13af6c, config.graphics), source.subarray(0x13af6c, config.graphics), 'Flower layouts/animation changed');
const painted = new Set();
for (const label of config.labels) {
  const { left, top, width, height } = label.rect;
  const mask = Buffer.alloc(width * height);
  for (const part of label.parts ?? [{ text: label.text, left: 0, width }]) {
    const args = ['-background', 'black', '-fill', 'white', '-font', report.translationFont.file, '-pointsize', String(label.pointSize * 19 / 12), '+antialias', `label:${part.text}`, '-trim', '+repage'];
    const size = execFileSync('magick', [...args, '-format', '%w %h', 'info:'], { encoding: 'utf8' }).trim().split(' ').map(Number);
    assert(size[0] <= part.width && size[1] <= height);
    const rendered = execFileSync('magick', [...args, '-gravity', 'center', '-extent', `${part.width}x${height}`, '-colorspace', 'Gray', '-depth', '8', 'gray:-']);
    for (let row = 0; row < height; row++) rendered.copy(mask, row * width + part.left, row * part.width, (row + 1) * part.width);
  }
  const ink = (horizontal, vertical) => horizontal >= 0 && horizontal < width && vertical >= 0 && vertical < height && mask[vertical * width + horizontal] > 127;
  const actualInk = new Set();
  for (let sprite = 0; sprite < label.spriteCount; sprite++) {
    if (label.spriteIndices && !label.spriteIndices.includes(sprite)) continue;
    const descriptor = label.layout + sprite * 12, tile = source.readUInt16LE(descriptor), size = source[descriptor + 9];
    const originX = source.readInt16LE(descriptor + 2), originY = source.readInt16LE(descriptor + 4);
    const spriteWidth = 8 << (size >> 2), spriteHeight = 8 << (size & 3);
    for (let row = 0; row < spriteHeight; row++) for (let column = 0; column < spriteWidth; column++) {
      const horizontal = originX + column - left, vertical = originY + row - top;
      if (horizontal < 0 || horizontal >= width || vertical < 0 || vertical >= height) continue;
      const pixel = (tile + Math.floor(row / 8) * spriteWidth / 8 + Math.floor(column / 8)) * 64 + row % 8 * 8 + column % 8;
      painted.add(pixel);
      let expected = ink(horizontal, vertical) ? label.fill : label.background;
      if (expected === label.background && label.outline !== undefined) {
        for (let deltaY = -1; deltaY <= 1; deltaY++) for (let deltaX = -1; deltaX <= 1; deltaX++) if (ink(horizontal + deltaX, vertical + deltaY)) expected = label.outline;
      }
      const actual = (updated[pixel >> 1] >> (pixel % 2 * 4)) & 15;
      assert.equal(actual, expected, `${label.animation} ${label.text}: pixel ${horizontal},${vertical}`);
      if (actual === label.fill) actualInk.add(vertical * width + horizontal);
    }
  }
  assert.equal(actualInk.size, mask.filter(value => value > 127).length, `${label.text}: lost ink`);
}
for (let pixel = 0; pixel < original.length * 2; pixel++) if (!painted.has(pixel)) assert.equal((updated[pixel >> 1] >> (pixel % 2 * 4)) & 15, (original[pixel >> 1] >> (pixel % 2 * 4)) & 15, 'Unrelated flower pixel or numeric suffix changed');
const palette = readFileSync('work/koikoi-opening.palette');
const animations = [...new Set([...config.labels.map(label => label.animation), ...Array.from({ length: 28 }, (_, index) => index + 46), 40, 43, 45])].sort((first, second) => first - second);
for (const [version, graphics] of [original, updated].entries()) {
  const sheet = Buffer.alloc(240 * animations.length * 48 * 3, 230);
  for (const [view, animation] of animations.entries()) {
    const frame = source.readUInt32LE(config.table + animation * 4) - 0x08000000, layout = source.readUInt32LE(frame) - 0x08000000, count = source.readUInt16LE(frame + 6);
    const originY = Math.min(...Array.from({ length: count }, (_, index) => source.readInt16LE(layout + index * 12 + 4)));
    for (let sprite = count - 1; sprite >= 0; sprite--) {
      const descriptor = layout + sprite * 12, tile = source.readUInt16LE(descriptor), size = source[descriptor + 9];
      const left = source.readInt16LE(descriptor + 2), top = source.readInt16LE(descriptor + 4) - originY;
      const width = 8 << (size >> 2), height = 8 << (size & 3), bank = source[descriptor + 7];
      for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
        const offset = (tile + Math.floor(row / 8) * width / 8 + Math.floor(column / 8)) * 32 + row % 8 * 4 + Math.floor(column % 8 / 2);
        const color = graphics[offset] >> (column % 2 * 4) & 15;
        if (!color) continue;
        assert(left + column < 240 && top + row < 48);
        const rgb = palette.readUInt16LE(512 + bank * 32 + color * 2), pixel = ((view * 48 + top + row) * 240 + left + column) * 3;
        for (let component = 0; component < 3; component++) sheet[pixel + component] = Math.round((rgb >> (component * 5) & 31) * 255 / 31);
      }
    }
  }
  execFileSync('magick', ['-size', `240x${animations.length * 48}`, '-depth', '8', 'rgb:-', '-filter', 'point', '-resize', '200%', `work/flower-text-layouts${version ? '-zh' : ''}.png`], { input: sheet });
}
console.log('Verified 37 flower text regions: Silver masks, shared glyphs, original numbers, unrelated pixels, allocation and animation descriptors');
if (process.argv.includes('--capture')) {
  const menu = ['600:0', '1:8', '120:0', '1:8', '120:0', '1:1', '60:0', '1:1', '120:0', '1:80', '20:0'];
  for (const name of ['koikoi', 'hanamatch']) {
    const prefix = `work/flower-text-${name}`;
    const sequence = [...menu, ...(name === 'hanamatch' ? ['1:10', '20:0'] : []), '1:1', '180:0', '1:1', '120:0', '1:1', '600:0'];
    const reference = readFileSync(`work/${name}-opening-zh.vram`);
    assert.deepEqual(reference.subarray(0x12700, 0x12700 + original.length), original, 'Baseline does not contain original flower text');
    updated.copy(reference, 0x12700);
    const replayOriginal = decompressLz77(source, 0x144594).data;
    assert.deepEqual(reference.subarray(0x8580, 0x8580 + replayOriginal.length), replayOriginal);
    decompressLz77(rom, report.resourceChanges.find(entry => entry.offset === 0x144594).target).data.copy(reference, 0x8580);
    const originalMap = decompressLz77(source, 0x1442dc).data;
    const updatedMap = decompressLz77(rom, report.resourceChanges.find(entry => entry.offset === 0x1442dc).target).data;
    for (let row = 0; row < 20; row++) for (let column = 0; column < 30; column++) {
      const mapOffset = 4 + (row * 30 + column) * 2, vramOffset = 0xd800 + row * 64 + column * 2;
      assert.equal(reference.readUInt16LE(vramOffset), originalMap.readUInt16LE(mapOffset) + 0x402c);
      reference.writeUInt16LE(updatedMap.readUInt16LE(mapOffset) + 0x402c, vramOffset);
    }
    execFileSync('work/capture', ['work/isseki-hatchou-zh-hant-preview.gba', prefix, ...sequence], { stdio: 'inherit' });
    assert.deepEqual(readFileSync(`${prefix}.vram`), reference, `${name}: other VRAM changed`);
    for (const extension of ['oam', 'palette']) assert.deepEqual(readFileSync(`${prefix}.${extension}`), readFileSync(`work/${name}-opening-zh.${extension}`), `${name}: ${extension} changed`);
    console.log(`Verified ${name} opening against previous preview: translated resource loaded, all other VRAM/OAM/palette unchanged`);
  }
}