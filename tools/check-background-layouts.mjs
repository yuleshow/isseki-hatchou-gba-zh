import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { decompressLz77, loadRom } from './inspect-rom.mjs';

const source = loadRom();
function render(graphics, map) {
  const columns = map.readUInt16LE(0), rows = map.readUInt16LE(2);
  assert.equal(map.length, 4 + columns * rows * 2);
  const width = columns * 8, height = rows * 8, pixels = Buffer.alloc(width * height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const entry = map.readUInt16LE(4 + (Math.floor(row / 8) * columns + Math.floor(column / 8)) * 2);
      const horizontal = entry & 0x400 ? 7 - column % 8 : column % 8;
      const vertical = entry & 0x800 ? 7 - row % 8 : row % 8;
      const offset = (entry & 1023) * 32 + vertical * 4 + Math.floor(horizontal / 2);
      assert(offset < graphics.length, `Map uses unavailable tile ${entry & 1023}`);
      pixels[row * width + column] = (graphics[offset] >> ((horizontal % 2) * 4)) & 15;
    }
  }
  return { pixels, width, height };
}
function save(image, path) {
  const grayscale = image.pixels.map(value => 255 - value * 17);
  execFileSync('magick', ['-size', `${image.width}x${image.height}`, '-depth', '8', 'gray:-', '-filter', 'point', '-resize', '300%', path], { input: grayscale });
}
if (process.argv[2] === '--inspect') {
  const graphics = decompressLz77(source, Number(process.argv[3])).data;
  const map = decompressLz77(source, Number(process.argv[4])).data;
  save(render(graphics, map), process.argv[5]);
} else {
  const report = JSON.parse(readFileSync('dist/report.json', 'utf8'));
  const patched = readFileSync('work/isseki-hatchou-zh-hant-preview.gba');
  const updatedResource = offset => decompressLz77(patched, report.resourceChanges.find(entry => entry.offset === offset)?.target ?? offset).data;
  const pages = process.argv[2] === '--labels' ? report.backgroundLabelValidation : [...report.backgroundLayoutValidation, ...report.backgroundLabelValidation];
  for (const page of pages) {
    const graphics = decompressLz77(source, page.graphics).data, updated = updatedResource(page.graphics);
    assert.equal(updated.length, graphics.length);
    const original = render(graphics, decompressLz77(source, page.map).data);
    const current = render(updated, updatedResource(page.map));
    if (/^daifugo(?:-page[23])?-label-layout$/.test(page.capture)) {
      const firstRow = page.capture === 'daifugo-label-layout' ? 31 : 15;
      const rowCount = firstRow === 31 ? 7 : 8;
      for (const label of page.labels.filter(label => label.top >= firstRow)) {
        const row = (label.top - firstRow) / 16;
        assert(Number.isInteger(row) && row >= 0 && row < rowCount);
        assert.equal(label.height, 14);
        assert.equal(label.background, row % 2 ? 3 : 2);
        assert.equal(label.preserveMargin ?? 0, 0);
      }
      for (let row = 0; row < rowCount; row++) {
        for (let vertical = firstRow + 14 + row * 16; vertical < firstRow + 16 + row * 16; vertical++) {
          for (let horizontal = 24; horizontal < 224; horizontal++) {
            const pixel = vertical * current.width + horizontal;
            assert.equal(current.pixels[pixel], original.pixels[pixel], 'Daifugo divider changed');
          }
        }
      }
    }
    const painted = new Set();
    for (const label of page.labels) {
      const mask = execFileSync('magick', ['-background', 'black', '-fill', 'white', '-font', report.translationFont.file, '-pointsize', String(label.pointSize * 19 / 12), '+antialias', `label:${label.text}`, '-trim', '+repage', '-gravity', 'center', '-extent', `${label.width}x${label.height}`, '-colorspace', 'Gray', '-depth', '8', 'gray:-']);
      for (let row = 0; row < label.height; row++) {
        for (let column = 0; column < label.width; column++) {
          let color = mask[row * label.width + column] > 127 ? label.fill : label.background;
          if (color !== label.fill && label.outline !== undefined) {
            for (let deltaY = -1; deltaY <= 1; deltaY++) {
              for (let deltaX = -1; deltaX <= 1; deltaX++) {
                const neighborX = column + deltaX, neighborY = row + deltaY;
                if (neighborX >= 0 && neighborX < label.width && neighborY >= 0 && neighborY < label.height && mask[neighborY * label.width + neighborX] > 127) color = label.outline;
              }
            }
          }
          const pixel = (label.top + row) * current.width + label.left + column;
          assert.equal(current.pixels[pixel], color, `${page.capture}: ${label.text}`);
          painted.add(pixel);
        }
      }
    }
    for (let pixel = 0; pixel < original.pixels.length; pixel++) {
      if (!painted.has(pixel)) assert.equal(current.pixels[pixel], original.pixels[pixel], `${page.capture}: non-text pixel changed`);
    }
    for (const offset of page.relatedMaps ?? []) {
      const map = decompressLz77(source, offset).data;
      assert.deepEqual(updatedResource(offset), map);
      assert.deepEqual(render(updated, map).pixels, render(graphics, map).pixels, 'Related background changed');
    }
    save(original, `work/${page.capture}.png`);
    save(current, `work/${page.capture}-zh.png`);
    console.log(`Verified offline background ${page.capture}: ${page.labels.length} labels, icons and related maps unchanged`);
  }
}