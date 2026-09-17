import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decompressLz77, loadRom } from './inspect-rom.mjs';

const source = loadRom();

export function checkBubbleText(patched, report) {
  const graphics = decompressLz77(patched, report.resourceChanges.find(entry => entry.offset === 0x12dd4c).target).data;
  for (const [text, tile] of [['碰', 688], ['槓', 696], ['吃', 700]]) {
    const mask = execFileSync('magick', ['-background', 'black', '-fill', 'white', '-font', report.translationFont.file, '-pointsize', '19', '+antialias', `label:${text}`, '-trim', '+repage', '-gravity', 'center', '-extent', '16x16', '-colorspace', 'Gray', '-depth', '8', 'gray:-']);
    for (let row = 0; row < 16; row++) {
      for (let column = 0; column < 16; column++) {
        let expected = mask[row * 16 + column] > 127 ? 9 : 0;
        if (!expected) {
          for (let deltaY = -1; deltaY <= 1; deltaY++) {
            for (let deltaX = -1; deltaX <= 1; deltaX++) {
              const neighborX = column + deltaX, neighborY = row + deltaY;
              if (neighborX >= 0 && neighborX < 16 && neighborY >= 0 && neighborY < 16 && mask[neighborY * 16 + neighborX] > 127) expected = 15;
            }
          }
        }
        const offset = (tile - 512 + Math.floor(row / 8) * 2 + Math.floor(column / 8)) * 32 + row % 8 * 4 + Math.floor(column % 8 / 2);
        assert.equal((graphics[offset] >> ((column % 2) * 4)) & 15, expected, `Bubble glyph/outline mismatch: ${text} at ${column},${row}`);
        if (row === 0 || row === 15 || column === 0 || column === 15) assert.equal(expected, 0, `Bubble outline touches sprite edge: ${text}`);
      }
    }
  }
  console.log('Bubble text passed: complete 12px Silver 碰/槓/吃 and 1px outlines inside all sprite edges.');
}

export function expectedActionPalette(original, report) {
  const expected = Buffer.from(original);
  const colors = report.actionTextColors;
  const start = 0x200 + colors.paletteIndex * 32;
  if (original.subarray(start, start + 32).equals(source.subarray(colors.paletteOffset, colors.paletteOffset + 32))) {
    assert.equal(expected.readUInt16LE(start + colors.index * 2), colors.original);
    expected.writeUInt16LE(colors.selected, start + colors.index * 2);
  }
  return expected;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [reference, current] = process.argv.slice(2);
  if (reference === '--bubbles') {
    checkBubbleText(readFileSync('work/isseki-hatchou-zh-hant-preview.gba'), JSON.parse(readFileSync('dist/report.json', 'utf8')));
    process.exit(0);
  }
  assert(reference && current, 'Usage: node tools/check-action-colors.mjs reference-prefix current-prefix');
  const report = JSON.parse(readFileSync('dist/report.json', 'utf8'));
  assert.deepEqual(readFileSync(`${current}.palette`), expectedActionPalette(readFileSync(`${reference}.palette`), report), 'Unexpected palette change');
  assert.deepEqual(readFileSync(`${current}.oam`), readFileSync(`${reference}.oam`), 'Action sprite geometry changed');
  const original = readFileSync(`${reference}.vram`);
  const updated = readFileSync(`${current}.vram`);
  const tiles = new Set([608, 609, 610, 611, 614, 615, 616, 617, 618, 619, 620, 621, ...Array.from({ length: 24 }, (_, index) => 984 + index)]);
  for (let offset = 0; offset < original.length; offset++) {
    for (const shift of [0, 4]) {
      const before = (original[offset] >> shift) & 15, after = (updated[offset] >> shift) & 15;
      if (before === after) continue;
      assert(tiles.has(Math.floor((offset - 0x10000) / 32)), `Non-action graphics changed at ${offset.toString(16)}`);
      assert.equal(before, 2);
      assert.equal(after, report.actionTextColors.index);
    }
  }
  console.log(`${current}: only action ink moved from index 2 to 10; exact selected palette change; unchanged OAM and all other graphics.`);
}