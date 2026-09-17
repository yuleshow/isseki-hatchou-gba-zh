import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { decompressLz77, loadRom } from './inspect-rom.mjs';

const source = loadRom();
const graphicsOffset = 0x168b98;
const original = decompressLz77(source, graphicsOffset).data;
const report = JSON.parse(readFileSync('dist/report.json', 'utf8'));
const patched = readFileSync('work/isseki-hatchou-zh-hant-preview.gba');
const resource = report.resourceChanges.find(entry => entry.offset === graphicsOffset);
const updated = decompressLz77(patched, resource.target).data;
assert.equal(updated.length, original.length);
assert.equal(report.pokerTextValidation.labels.length, 24);
assert.deepEqual(patched.subarray(0x168670, graphicsOffset), source.subarray(0x168670, graphicsOffset), 'Poker layouts or animations changed');
const palette = readFileSync('work/poker-opening.palette');
const sheets = [original, updated].map(() => Buffer.alloc(256 * 24 * 20 * 3));
const painted = new Set();
for (let animation = 0; animation < 24; animation++) {
  const frame = source.readUInt32LE(0x168b38 + animation * 4) - 0x08000000;
  const layout = source.readUInt32LE(frame) - 0x08000000;
  const count = source.readUInt16LE(frame + 6);
  const images = [original, updated].map(() => Buffer.alloc(256 * 16));
  let layoutWidth = 0;
  for (let sprite = 0; sprite < count; sprite++) {
    const descriptor = layout + sprite * 12;
    const tile = source.readUInt16LE(descriptor);
    const left = source.readInt16LE(descriptor + 2), top = source.readInt16LE(descriptor + 4);
    const size = source[descriptor + 9];
    const width = 8 << (size >> 2), height = 8 << (size & 3);
    layoutWidth = Math.max(layoutWidth, left + width);
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const offset = (tile + Math.floor(row / 8) * (width / 8) + Math.floor(column / 8)) * 32 + (row % 8) * 4 + Math.floor(column % 8 / 2);
        assert(offset < original.length);
        for (const [index, graphics] of [original, updated].entries()) {
          const color = (graphics[offset] >> ((column % 2) * 4)) & 15;
          images[index][(top + row) * 256 + left + column] = color;
          const rgb = palette.readUInt16LE(512 + 3 * 32 + color * 2);
          const pixel = ((animation * 20 + top + row) * 256 + left + column) * 3;
          assert(pixel >= 0 && pixel + 2 < sheets[index].length);
          for (let component = 0; component < 3; component++) sheets[index][pixel + component] = Math.round(((rgb >> (component * 5)) & 31) * 255 / 31);
        }
        if (row > 0 && row < 15 && left + column > 0 && left + column < report.pokerTextValidation.labels[animation].width - 1) painted.add(offset * 2 + column % 2);
      }
    }
  }
  const label = report.pokerTextValidation.labels[animation];
  assert.equal(label.width, layoutWidth);
  const mask = execFileSync('magick', ['-background', 'black', '-fill', 'white', '-font', report.translationFont.file, '-pointsize', '19', '+antialias', `label:${label.text}`, '-trim', '+repage', '-gravity', 'center', '-extent', `${layoutWidth - 2}x14`, '-colorspace', 'Gray', '-depth', '8', 'gray:-']);
  for (let row = 0; row < 16; row++) {
    for (let column = 0; column < layoutWidth; column++) {
      const position = row * 256 + column;
      const interior = row > 0 && row < 15 && column > 0 && column < layoutWidth - 1;
      const expected = interior ? (mask[(row - 1) * (layoutWidth - 2) + column - 1] > 127 ? label.fill : label.background) : images[0][position];
      assert.equal(images[1][position], expected, `${animation}: ${label.text} at ${column},${row}`);
    }
  }
}
for (let pixel = 0; pixel < original.length * 2; pixel++) {
  if (!painted.has(pixel)) assert.equal((updated[pixel >> 1] >> ((pixel % 2) * 4)) & 15, (original[pixel >> 1] >> ((pixel % 2) * 4)) & 15, 'Poker non-text pixel changed');
}
for (const [index, sheet] of sheets.entries()) execFileSync('magick', ['-size', '256x480', '-depth', '8', 'rgb:-', '-filter', 'point', '-resize', '200%', `work/poker-text-layouts${index ? '-zh' : ''}.png`], { input: sheet });
console.log('Verified 24 poker text layouts: exact Silver masks, borders, unrelated tiles, allocation and animations preserved');

if (process.argv.includes('--capture')) {
  const opening = ['600:0', '1:8', '120:0', '1:8', '120:0', '1:1', '60:0', '1:1', '120:0', '1:80', '20:0', '1:80', '20:0', '1:80', '20:0', '1:10', '20:0', '1:1', '180:0', '1:1', '120:0', '1:1', '600:0'];
  for (const [name, turns, expectedTile] of [['actions', 0, 352], ['call', 1, 286], ['check-bet', 4, 382], ['check', 5, 324], ['showdown', 6, 24], ['check-right', 8, 324]]) {
    const sequence = [...opening, ...Array.from({ length: turns }, () => ['1:1', '180:0']).flat()];
    for (const [rom, suffix] of [['work/original.gba', ''], ['work/isseki-hatchou-zh-hant-preview.gba', '-zh']]) execFileSync('work/capture', [rom, `work/poker-text-${name}${suffix}`, ...sequence], { stdio: 'inherit' });
    const before = readFileSync(`work/poker-text-${name}.vram`), after = readFileSync(`work/poker-text-${name}-zh.vram`);
    assert.deepEqual(before.subarray(0x10000, 0x10000 + original.length), original);
    assert.deepEqual(after.subarray(0x10000, 0x10000 + updated.length), updated);
    updated.copy(before, 0x10000);
    const settings = report.validation.find(entry => entry.capture === 'poker' && entry.map);
    const originalSettings = decompressLz77(source, settings.graphics).data;
    assert.deepEqual(before.subarray(settings.graphicsBase, settings.graphicsBase + originalSettings.length), originalSettings);
    const settingsGraphics = report.resourceChanges.find(entry => entry.offset === settings.graphics);
    decompressLz77(patched, settingsGraphics.target).data.copy(before, settings.graphicsBase);
    const originalMap = decompressLz77(source, settings.map).data;
    const settingsMap = report.resourceChanges.find(entry => entry.offset === settings.map);
    const updatedMap = decompressLz77(patched, settingsMap.target).data;
    const columns = originalMap.readUInt16LE(0), rows = originalMap.readUInt16LE(2);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const mapOffset = 4 + (row * columns + column) * 2;
        const vramOffset = settings.mapBase + row * 64 + column * 2;
        assert.equal(before.readUInt16LE(vramOffset), originalMap.readUInt16LE(mapOffset) + settings.tileBias);
        before.writeUInt16LE(updatedMap.readUInt16LE(mapOffset) + settings.tileBias, vramOffset);
      }
    }
    assert.deepEqual(after, before, `${name}: other VRAM changed`);
    for (const suffix of ['palette', 'oam']) assert.deepEqual(readFileSync(`work/poker-text-${name}-zh.${suffix}`), readFileSync(`work/poker-text-${name}.${suffix}`), `${name}: ${suffix} changed`);
    const oam = readFileSync(`work/poker-text-${name}.oam`);
    let matches = 0;
    for (let sprite = 0; sprite < 128; sprite++) {
      const first = oam.readUInt16LE(sprite * 8), second = oam.readUInt16LE(sprite * 8 + 2), third = oam.readUInt16LE(sprite * 8 + 4);
      if ((first & 0x300) === 0x200 || (first & 255) >= 160 || (second & 511) >= 240) continue;
      if ((third & 1023) === expectedTile && third >> 12 === 3) matches++;
    }
    assert.equal(matches, name === 'showdown' ? 4 : 1, `${name}: expected natural text missing`);
    console.log(`Verified natural poker ${name}: text loaded, other VRAM/palette/OAM unchanged`);
  }
}