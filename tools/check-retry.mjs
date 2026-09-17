import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { decompressLz77, loadRom } from './inspect-rom.mjs';

const source = loadRom();
const patched = readFileSync('work/isseki-hatchou-zh-hant-preview.gba');
const report = JSON.parse(readFileSync('dist/report.json', 'utf8'));
const dialog = report.retryDialogValidation;
const resource = report.resourceChanges.find(entry => entry.offset === dialog.graphics);
assert.equal(patched.readUInt32LE(0x11a80), 0x08000000 + resource.target);
assert.deepEqual(patched.subarray(dialog.palette, dialog.graphics), source.subarray(dialog.palette, dialog.graphics), 'Retry palette, layouts, or animations changed');
const originalGraphics = decompressLz77(source, dialog.graphics).data;
const updatedGraphics = decompressLz77(patched, resource.target).data;
assert.equal(updatedGraphics.length, originalGraphics.length);
const images = [originalGraphics, updatedGraphics].map(graphics => {
  const colors = Buffer.alloc(240 * 160, 0);
  for (let sprite = 0; sprite < dialog.spriteCount; sprite++) {
    const descriptor = dialog.layout + sprite * 12;
    const tile = source.readUInt16LE(descriptor);
    const left = source.readUInt16LE(descriptor + 2), top = source.readUInt16LE(descriptor + 4);
    const dimensions = source[descriptor + 9];
    const width = 8 << (dimensions >> 2), height = 8 << (dimensions & 3);
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const offset = (tile + Math.floor(row / 8) * (width / 8) + Math.floor(column / 8)) * 32 + (row % 8) * 4 + Math.floor(column % 8 / 2);
        colors[(top + row) * 240 + left + column] = (graphics[offset] >> ((column % 2) * 4)) & 15;
      }
    }
  }
  return colors;
});
const translatedPixels = new Set();
for (const label of dialog.labels) {
  const mask = execFileSync('magick', ['-background', 'black', '-fill', 'white', '-font', report.translationFont.file, '-pointsize', '19', '+antialias', `label:${label.text}`, '-trim', '+repage', '-gravity', 'west', '-extent', `${label.width}x${label.height}`, '-colorspace', 'Gray', '-depth', '8', 'gray:-']);
  assert(mask.some(value => value > 127));
  for (let row = 0; row < label.height; row++) {
    for (let column = 0; column < label.width; column++) {
      const pixel = (label.top + row) * 240 + label.left + column;
      translatedPixels.add(pixel);
      assert.equal(images[1][pixel], mask[row * label.width + column] > 127 ? label.fill : 5, `Retry text mismatch: ${label.text}`);
    }
  }
}
for (let pixel = 0; pixel < images[0].length; pixel++) {
  if (!translatedPixels.has(pixel)) assert.equal(images[1][pixel], images[0][pixel], 'Retry pixel outside text changed');
}
for (const [index, colors] of images.entries()) {
  const pixels = Buffer.alloc(colors.length * 3);
  for (let pixel = 0; pixel < colors.length; pixel++) {
    const color = source.readUInt16LE(dialog.palette + colors[pixel] * 2);
    for (let component = 0; component < 3; component++) pixels[pixel * 3 + component] = Math.round(((color >> (component * 5)) & 31) * 255 / 31);
  }
  execFileSync('magick', ['-size', '240x160', '-depth', '8', 'rgb:-', '-filter', 'point', '-resize', '300%', `work/mahjong-retry-layout${index ? '-zh' : ''}.png`], { input: pixels });
}
console.log('Retry layout passed: three 12px Silver labels; A/B icons, border, palette, animations, allocation, and loader pointer preserved. Natural replay flow remains unverified.');