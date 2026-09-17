import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { decompressLz77, loadRom } from './inspect-rom.mjs';

const source = loadRom();
const patched = readFileSync('work/isseki-hatchou-zh-hant-preview.gba');
const report = JSON.parse(readFileSync('dist/report.json', 'utf8'));
const changes = report.resultsLayoutChanges;
assert.equal(changes.length, 5);
const expected = Buffer.from(source.subarray(0xdc60, 0xe148));
for (const change of changes) {
  assert.equal(source.readUInt16LE(change.offset), change.original);
  assert.equal(patched.readUInt16LE(change.offset), change.patched);
  expected.writeUInt16LE(change.patched, change.offset - 0xdc60);
}
assert.deepEqual(patched.subarray(0xdc60, 0xe148), expected, 'Unexpected change to result-list or summary code');
const stride = patched.readUInt16LE(0xdcd0) & 255;
assert.equal(stride, 14);
assert.equal(patched.readUInt16LE(0xde22) & 255, stride);
const summaryY = patched.readUInt16LE(0xded2) & 255;
assert.equal(summaryY, 142);
for (const offset of [0xdee2, 0xdef4]) assert.equal(patched.readUInt16LE(offset) & 255, summaryY);
assert(summaryY + 16 <= 158, 'Summary cells cross the bottom margin');
const font = decompressLz77(patched, report.resourceChanges.find(entry => entry.offset === 0x12e86c).target).data;
const pixelAt = (glyph, column, row) => {
  const offset = glyph * 128 + (Math.floor(row / 8) * 2 + Math.floor(column / 8)) * 32 + row % 8 * 4 + Math.floor(column % 8 / 2);
  return (font[offset] >> ((column % 2) * 4)) & 15;
};
for (const entry of report.resultsFontValidation.glyphChanges) {
  assert.equal(entry.originX, 2);
  assert.equal(entry.originY, entry.text === '么' ? 1 : 2);
  const native = execFileSync('magick', ['-background', 'black', '-fill', 'white', '-font', report.translationFont.file, '-pointsize', '19', '+antialias', `label:${entry.text}`, '-gravity', 'northwest', '-extent', '16x24', '-colorspace', 'Gray', '-depth', '8', 'gray:-']);
  let inkCount = 0;
  for (let row = 0; row < 16; row++) {
    for (let column = 0; column < 16; column++) {
      const nativeX = column - entry.originX, nativeY = row - entry.originY;
      const expectedInk = nativeX >= 0 && nativeY >= 0 && native[nativeY * 16 + nativeX] > 127;
      const actualInk = pixelAt(entry.glyph, column, row) !== 0;
      assert.equal(actualInk, expectedInk, `Results baseline/bearing mismatch: ${entry.text} at ${column},${row}`);
      if (actualInk) inkCount++;
    }
  }
  assert.equal(inkCount, native.filter(value => value > 127).length, `Results glyph clipped: ${entry.text}`);
}
let firstInkRow = 16, lastInkRow = -1;
for (let glyph = 0; glyph < 106; glyph++) {
  for (let row = 0; row < 16; row++) {
    for (let column = 0; column < 16; column++) {
      if (!pixelAt(glyph, column, row)) continue;
      firstInkRow = Math.min(firstInkRow, row);
      lastInkRow = Math.max(lastInkRow, row);
    }
  }
}
const minimumGap = stride + firstInkRow - lastInkRow - 1;
assert(minimumGap >= 2, 'Adjacent result rows touch');
const rows = [['自摸', '1'], ['立直', '1'], ['平和', '1'], ['一盃口', '1'], ['寶牌', '2']];
const glyphs = new Map(report.resultsFontValidation.glyphChanges.map(entry => [entry.text, entry.glyph]));
for (const variant of ['before', 'after', 'six-rows', 'alignment']) {
  const rowStride = variant === 'before' ? source.readUInt16LE(0xdcd0) & 255 : stride;
  const footerY = variant === 'before' ? source.readUInt16LE(0xded2) & 255 : summaryY;
  const pixels = Buffer.alloc(240 * 160 * 3);
  for (let pixel = 0; pixel < 240 * 160; pixel++) pixels[pixel * 3 + 1] = 120;
  const drawText = (text, left, top) => {
    for (const [index, character] of [...text].entries()) {
      const glyph = glyphs.get(character);
      assert(glyph !== undefined, `Missing result glyph: ${character}`);
      for (let row = 0; row < 16; row++) {
        for (let column = 0; column < 16; column++) {
          if (!pixelAt(glyph, column, row)) continue;
          const horizontal = left + index * 12 + column, vertical = top + row;
          if (variant !== 'before') assert(horizontal < 240 && vertical < 160, 'Clipped result text');
          if (horizontal >= 240 || vertical >= 160) continue;
          pixels.fill(255, (vertical * 240 + horizontal) * 3, (vertical * 240 + horizontal) * 3 + 3);
        }
      }
    }
  };
  const sampleRows = variant === 'alignment' ? [['立直', '1'], ['役牌', '1'], ['一氣通貫', '2'], ['混一色', '3'], ['裏寶牌', '3']] : variant === 'six-rows' ? [...rows, ['裏寶牌', '1']] : rows;
  for (const [index, [text, han]] of sampleRows.entries()) {
    const top = 28 + index * rowStride;
    drawText(text, 4, top);
    drawText(han, 148, top);
    drawText('翻', 160, top);
  }
  drawText('子', 4, footerY);
  drawText('6翻', 28, footerY);
  drawText('跳滿', 64, footerY);
  drawText('12000點', 100, footerY);
  execFileSync('magick', ['-size', '240x160', '-depth', '8', 'rgb:-', '-filter', 'point', '-resize', '300%', `work/results-layout-${variant}.png`], { input: pixels });
}
console.log(`Result layout checks passed: ${minimumGap}px minimum ink gap, both columns aligned, summary cells end at y=${summaryY + 16}; only five coordinate instructions changed. Offline layout proofs, not natural winning-screen captures.`);