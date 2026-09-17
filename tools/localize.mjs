import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { compressLz77, decompressLz77, loadRom, sourceSha256 } from './inspect-rom.mjs';

const source = loadRom();
const output = Buffer.alloc(8 * 1024 * 1024, 255);
source.copy(output);
const resourceOffset = 0x0f3ddc;
const spriteResources = new Map();
const font = 'assets/Silver.ttf';
const translationFont = { name: 'Silver', file: font, sha256: createHash('sha256').update(readFileSync(font)).digest('hex') };
const mahjongActionStyle = { pointSize: 12, gravity: 'west', fill: 10, outline: false };

function renderText(width, height, text, pointSize, gravity = 'center') {
  const argumentsList = ['-background', 'black', '-fill', 'white', '-font', font, '-pointsize', String(pointSize * 19 / 12), '+antialias', `label:${text}`, '-trim', '+repage'];
  const size = execFileSync('magick', [...argumentsList, '-format', '%w %h', 'info:'], { encoding: 'utf8' }).trim().split(' ').map(Number);
  assert(size[0] <= width && size[1] <= height, `Silver text exceeds ${width}x${height}: ${text} (${size.join('x')})`);
  return execFileSync('magick', [...argumentsList, '-gravity', gravity, '-extent', `${width}x${height}`, '-colorspace', 'Gray', '-depth', '8', 'gray:-']);
}
const dimensions = [[[8, 8], [16, 16], [32, 32], [64, 64]], [[16, 8], [32, 8], [32, 16], [64, 32]], [[8, 16], [8, 32], [16, 32], [32, 64]]];
const entries = [
  { capture: 'select', top: 89, text: '模式選擇' },
  { capture: 'select', top: 108, text: '選項' },
  { capture: 'select', top: 128, text: '製作人員' },
  { capture: 'game-menu', top: 89, text: '單人遊戲' },
  { capture: 'game-menu', top: 108, text: '卡匣接力' },
  { capture: 'game-menu', top: 128, text: '多卡匣連線' },
  { capture: 'sanma', graphics: 0x130750, graphicsBase: 0x10000, top: 8, text: '三人制', fill: 2, outline: 1 },
  { capture: 'mahjong-next-opening', graphics: 0x132ed4, graphicsBase: 0x14000, rect: { left: 196, top: 136, width: 24, height: 16 }, spriteGeometries: [{ tile: 546, left: 196, top: 136, width: 16, height: 16 }, { tile: 548, left: 212, top: 136, width: 8, height: 16 }], spriteTileTargets: { 548: 550 }, text: '跳過', pointSize: 12, fill: 4, outline: false },
  ...[[72, '寶'], [140, '餘']].map(([left, text]) => ({ capture: 'mahjong-dealt', graphics: 0x12dd4c, graphicsBase: 0x14000, rect: { left, top: 78, width: 16, height: 16 }, text, pointSize: 12, fill: 1, background: 2, outline: false })),
  { capture: 'mahjong-turns-25', graphics: 0x12dd4c, graphicsBase: 0x14000, spriteTiles: [612, 614], rect: { left: 116, top: 116, width: 36, height: 16 }, text: '吃', ...mahjongActionStyle },
  { capture: 'mahjong-pon', graphics: 0x12dd4c, graphicsBase: 0x14000, spriteTiles: [604, 608], rect: { left: 116, top: 116, width: 36, height: 16 }, text: '碰', ...mahjongActionStyle },
  { capture: 'mahjong-kan-fixture', graphics: 0x12dd4c, graphicsBase: 0x14000, spriteTiles: [618], rect: { left: 116, top: 116, width: 16, height: 16 }, text: '槓', ...mahjongActionStyle },
  ...[['riichi', 622, 984, '立直'], ['tsumo', 630, 992, '自摸'], ['ron', 634, 1000, '榮和']].map(([action, tile, target, text]) => ({ capture: `mahjong-${action}-fixture`, graphics: 0x12dd4c, graphicsBase: 0x14000, spriteTiles: [tile], spriteGeometries: [{ tile, width: 32, height: 16 }], spriteTileTargets: { [tile]: target }, rect: { left: 116, top: 116, width: 32, height: 16 }, text, ...mahjongActionStyle })),
  ...[
    [51, [688], 102, 16, '碰', 12],
    [52, [696], 102, 16, '槓', 12],
    [53, [700, 704], 102, 36, '吃', 12],
  ].map(([animation, spriteTiles, left, width, text, pointSize]) => ({ capture: `mahjong-notice-${animation}-fixture`, graphics: 0x12dd4c, graphicsBase: 0x14000, spriteTiles, rect: { left, top: 108, width, height: 16 }, text, gravity: 'west', textInsetLeft: 2, pointSize, fill: 9, outline: 15 })),
  ...[
    [54, 95, 49, '立直', { 706: '立', 700: '直' }, { 700: 626 }],
    [55, 97, 34, '自摸', { 710: '自', 714: '摸' }, {}],
    [56, 97, 34, '榮和', { 720: '榮', 692: '和' }, {}],
  ].map(([animation, left, width, text, spriteText, spriteTileTargets]) => ({ capture: `mahjong-notice-${animation}-fixture`, graphics: 0x12dd4c, graphicsBase: 0x14000, spriteTiles: Object.keys(spriteText).map(Number), spriteText, spriteTileTargets, rect: { left, top: 108, width, height: 16 }, text, pointSize: 12, fill: 9, outline: 15 })),
  { capture: 'speed-opening', graphics: 0x14fd60, graphicsBase: 0x10180, rect: { left: 157, top: 52, width: 62, height: 40 }, text: '按 A 鍵\n出牌', fill: 4, background: 1, outline: false },
  { capture: 'daifugo-page2', graphics: 0x15c090, graphicsBase: 0x15900, spriteTiles: [713], rect: { left: 181, top: 149, width: 32, height: 11 }, text: '開始', pointSize: 8, fill: 1, outline: 7 },
];
const writtenPixels = new Map();
const backgroundPages = [
  ...[
    ['speed', 0x152400, 0x152d84, [0x152b20, 0x152c64]],
    ['daifugo', 0x15cbf0, 0x15c84c, [0x15c5f4, 0x15c730]],
    ['poker', 0x16d35c, 0x16dd44, [0x16daac, 0x16dc24]],
    ['memory', 0x178368, 0x178aec, [0x178888, 0x1789cc]],
  ].map(([game, graphics, map, relatedMaps]) => ({
    capture: `${game}-replay-layout`, graphics, map, relatedMaps, layoutOnly: true,
    labels: [
      { left: 0, top: 8, width: 80, height: 24, text: '再玩一局？', fill: 8, outline: 9, background: 7, pointSize: 12 },
      { left: 108, top: 8, width: 32, height: 24, text: '要', fill: 8, outline: 9, background: 7, pointSize: 12 },
      { left: 164, top: 8, width: 48, height: 24, text: '不要', fill: 8, outline: 9, background: 7, pointSize: 12 },
    ],
  })),
  {
    capture: 'flower-replay-layout', graphics: 0x144594, map: 0x1442dc, layoutOnly: true,
    games: ['koikoi', 'hanamatch'], graphicsBase: 0x8580, mapBase: 0xd800, tileBias: 0x402c,
    labels: [
      { left: 80, top: 48, width: 72, height: 16, text: '再玩一局？', fill: 8, background: 9, pointSize: 12 },
      { left: 104, top: 72, width: 48, height: 16, text: '要', fill: 15, outline: 12, background: 9, pointSize: 12 },
      { left: 104, top: 88, width: 48, height: 16, text: '不要', fill: 15, outline: 12, background: 9, pointSize: 12 },
    ],
  },
  {
    capture: 'mahjong-pause', graphics: 0x110c64, map: 0x111a58, mapBase: 0x1800,
    labels: [
      ...['音樂', '音效', '語音'].map((text, index) => ({ left: 64, top: 56 + index * 16, width: 48, height: 16, text, fill: 13, outline: 11, background: 5, pointSize: 12 })),
      { left: 64, top: 112, width: 104, height: 16, text: '中止對局', fill: 13, outline: 11, background: 5, pointSize: 12 },
    ],
  },
  {
    capture: 'hanamatch', graphics: 0x145ad0, map: 0x144ea0, graphicsBase: 0x90a0, mapBase: 0xd000, tileBias: 0x8085,
    labels: [
      { left: 16, top: 0, width: 96, height: 24, text: '花牌配對', fill: 6, outline: 1, background: 0, pointSize: 18 },
      { left: 136, top: 8, width: 88, height: 16, text: '規則設定', fill: 12, outline: 1, background: 0, pointSize: 14 },
      ...[[24, 33, 112, '電腦等級'], [24, 47, 96, '對局次數']].map(([left, top, width, text], index) => ({ left, top, width, height: 13, text, fill: 1, background: index % 2 ? 3 : 2, pointSize: 12 })),
      ...['月見花見', '雨四光', '表菅原', '種牌役', '名次獎勵', '低分罰則'].flatMap((text, index) => [
        { left: 24, top: 61 + index * 14, width: 80, height: 13, text, background: index % 2 ? 3 : 2 },
        { left: 120, top: 61 + index * 14, width: 40, height: 13, text: '有', background: index % 2 ? 3 : 2 },
        { left: 176, top: 61 + index * 14, width: 40, height: 13, text: '無', background: index % 2 ? 3 : 2 },
      ]).map(label => ({ ...label, fill: 1, pointSize: 12 })),
    ],
  },
  {
    capture: 'speed', graphics: 0x1511cc, map: 0x151d0c,
    labels: [
      { left: 16, top: 8, width: 88, height: 24, text: '極速接龍', fill: 6, outline: 1, background: 0, pointSize: 18 },
      { left: 136, top: 16, width: 88, height: 16, text: '規則設定', fill: 12, outline: 1, background: 0, pointSize: 14 },
      ...[
        [24, 48, 112, '電腦等級'], [24, 64, 64, '牌組'], [96, 64, 48, '隨機'], [160, 64, 56, '分色'],
        [24, 80, 64, '鬼牌'], [96, 80, 48, '使用'], [160, 80, 56, '不使用'],
        [24, 96, 56, 'A與K'], [96, 96, 56, '相接'], [160, 96, 56, '不相接'],
      ].map(([left, top, width, text]) => ({ left, top, width, height: 16, text, fill: 1, background: 2, pointSize: 12, preserveMargin: 2 })),
    ],
  },
  {
    capture: 'daifugo', graphics: 0x159f8c, map: 0x1597b8, mapBase: 0xe800,
    labels: [
      { left: 16, top: 0, width: 80, height: 24, text: '大富豪', fill: 6, outline: 1, background: 0, pointSize: 18 },
      { left: 136, top: 0, width: 88, height: 24, text: '規則設定', fill: 12, outline: 1, background: 0, pointSize: 16 },
      ...[
        [24, 32, 112, '電腦等級'], [24, 48, 88, '鬼牌張數'],
        [24, 64, 88, '2或鬼牌收尾'], [128, 64, 40, '允許'], [176, 64, 48, '判負'],
        [24, 80, 88, '跳過後'], [128, 80, 40, '可出牌'], [176, 80, 48, '禁出牌'],
        [24, 96, 88, '出完後場牌'], [128, 96, 32, '清除'], [176, 96, 48, '保留'],
        [24, 112, 192, '第二局起由誰先出'], [32, 128, 56, '隨機'], [104, 128, 56, '末位'], [176, 128, 40, '首位'],
      ].map(([left, top, width, text]) => ({ left, top: top - 1, width, height: 14, text, fill: 1, background: ((top - 32) / 16) % 2 ? 3 : 2, pointSize: 12 })),
    ],
  },
  {
    capture: 'daifugo-page2', graphics: 0x15af88, map: 0x159b30, mapBase: 0xe800,
    labels: [
      ...[[0, '換牌'], [1, '革命'], [2, '對子'], [7, '連號疊出']].flatMap(([row, text]) => [
        [24, row, 96, text], [136, row, 32, '有'], [184, row, 32, '無'],
      ]),
      [24, 3, 192, '連號'], [40, 4, 32, '無'], [88, 4, 56, '2張以上'], [160, 4, 56, '3張以上'],
      [24, 5, 192, '連號革命'], [40, 6, 32, '無'], [88, 6, 56, '4張以上'], [160, 6, 56, '5張以上'],
    ].map(([left, row, width, text]) => ({ left, top: 15 + row * 16, width, height: 14, text, fill: 1, background: row % 2 ? 3 : 2, pointSize: 12 })),
  },
  {
    capture: 'daifugo-page3', graphics: 0x15b7a8, map: 0x159d64, mapBase: 0xe800,
    labels: ['換座', '富豪落貧', '順子', '花色鎖定', '5跳過', '8切牌', 'J反轉', 'Q逆轉方向'].flatMap((text, row) => [
      { left: 24, width: 104, text }, { left: 132, width: 32, text: '有' }, { left: 180, width: 32, text: '無' },
    ].map(label => ({ ...label, top: 15 + row * 16, height: 14, fill: 1, background: row % 2 ? 3 : 2, pointSize: 12 }))),
  },
  {
    capture: 'memory', graphics: 0x1777a0, map: 0x1780cc, graphicsBase: 0xc000, mapBase: 0xe800, tileBias: 0xf000,
    labels: [
      { left: 24, top: 8, width: 104, height: 24, text: '記憶翻牌', fill: 6, outline: 1, background: 0, pointSize: 18 },
      { left: 136, top: 16, width: 88, height: 16, text: '規則設定', fill: 12, outline: 1, background: 0, pointSize: 14 },
      ...[[32, 48, 88, '電腦等級'], [32, 80, 88, '排列方式']].map(([left, top, width, text]) => ({ left, top, width, height: 16, text, fill: 1, background: 2, pointSize: 12, preserveMargin: 2 })),
    ],
  },
  {
    capture: 'poker', graphics: 0x16c6fc, map: 0x16d060, graphicsBase: 0xc000, mapBase: 0xe800, tileBias: 0xf000,
    labels: [
      { left: 16, top: 16, width: 80, height: 24, text: '撲克', fill: 6, outline: 1, background: 0, pointSize: 18 },
      { left: 136, top: 24, width: 88, height: 16, text: '規則設定', fill: 12, outline: 1, background: 0, pointSize: 14 },
      ...[
        [24, 56, 56, '棄牌'], [96, 56, 64, '蓋牌'], [168, 56, 48, '明牌'],
        [24, 72, 88, '鬼牌張數'], [24, 88, 88, '對局次數'], [24, 104, 88, '加注次數'],
      ].map(([left, top, width, text]) => ({ left, top, width, height: 16, text, fill: 1, background: 2, pointSize: 12, preserveMargin: 2 })),
    ],
  },
  {
    capture: 'koikoi', graphics: 0x145158, map: 0x144c74, graphicsBase: 0x90a0, mapBase: 0xd000, tileBias: 0x8085,
    labels: [
      { left: 16, top: 8, width: 96, height: 24, text: '花札來來', fill: 6, outline: 1, background: 0, pointSize: 18 },
      { left: 136, top: 16, width: 88, height: 16, text: '規則設定', fill: 12, outline: 1, background: 0, pointSize: 14 },
      ...[
        [24, 48, 112, '電腦等級'], [24, 64, 96, '對局次數'], [24, 80, 80, '月見花見'],
        [24, 96, 80, '雨四光'], [24, 112, 80, '莊家優先'],
        [120, 80, 40, '有'], [168, 80, 40, '無'], [120, 96, 40, '有'], [168, 96, 40, '無'],
        [120, 112, 40, '有'], [168, 112, 40, '無'],
      ].map(([left, top, width, text]) => ({ left, top, width, height: 16, text, fill: 1, background: 2, pointSize: 12, preserveMargin: 2 })),
    ],
  },
  {
    capture: 'mahjong-next', graphics: 0x12fbcc, map: 0x12f958, graphicsBase: 0xa000, mapBase: 0xf000, tileBias: 256,
    labels: [
      { left: 8, top: 0, width: 64, height: 24, text: '麻將', fill: 12, outline: 1, background: 0, pointSize: 18 },
      { left: 136, top: 0, width: 88, height: 24, text: '規則設定', fill: 6, outline: 1, background: 0, pointSize: 16 },
      ...[
        [24, 32, 112, '電腦等級'], [24, 48, 48, '對局'], [88, 48, 56, '半莊戰'], [152, 48, 64, '東風戰'],
        [24, 64, 48, '起始點'], [24, 80, 96, '食斷'], [24, 96, 96, '後付'],
        [24, 112, 96, '二翻起和'], [24, 128, 96, '未聽牌輪莊'],
        [136, 80, 40, '有'], [184, 80, 40, '無'], [136, 96, 40, '有'], [184, 96, 40, '無'],
        [136, 112, 32, '有'], [184, 112, 40, '無'], [136, 128, 40, '有'], [184, 128, 40, '無'],
      ].map(([left, top, width, text]) => ({ left, top, width, height: 16, text, fill: 1, background: 2, pointSize: 12, preserveMargin: 2 })),
    ],
  },
  {
    capture: 'mahjong', graphics: 0x0f89f4, map: 0x0f880c,
    labels: [
      { left: 24, top: 0, width: 192, height: 32, text: '玩家設定', fill: 6, outline: 8, background: 0, pointSize: 18 },
      ...[32, 64, 96, 128].map(top => ({ left: 184, top, width: 40, height: 24, text: '觀戰', fill: 10, background: 14, pointSize: 16, preserveMargin: 3 })),
    ],
  },
  {
    capture: 'games', graphics: 0x0fac48, map: 0x0fa88c,
    labels: [
      { left: 48, top: 0, width: 152, height: 32, text: '遊戲選擇', fill: 6, outline: 8, background: 0, pointSize: 18 },
      ...['麻將', '三人麻將', '花札來來', '花牌配對', '極速接龍', '大富豪', '記憶翻牌', '撲克'].map((text, index) => ({
        left: index % 2 ? 128 : 8, top: 32 + Math.floor(index / 2) * 32,
        width: index % 2 ? 80 : 88, height: 24, text, fill: 14, background: Math.floor(index / 2) === 1 ? 6 : 10, pointSize: 16, preserveEdge: true,
      })),
    ],
  },
  {
    capture: 'options', graphics: 0x1145dc, map: 0x114f00,
    labels: [
      { left: 64, top: 0, width: 112, height: 32, text: '選項設定', fill: 7, outline: 1, background: 0, pointSize: 18 },
      ...['背景音樂', '音效', '語音'].map((text, index) => ({ left: 40, top: 48 + index * 24, width: 64, height: 24, text, fill: 11, outline: 1, background: 9, pointSize: 12, preserveMargin: 3 })),
      { left: 64, top: 128, width: 112, height: 16, text: '返回', fill: 11, outline: 1, background: 15, pointSize: 12 },
    ],
  },
];
const resourceChanges = [];
let freeOffset = source.length;
while (freeOffset > 0 && source[freeOffset - 1] === 255) freeOffset--;
freeOffset = (freeOffset + 3) & ~3;

function writeResource(offset, data) {
  const previous = decompressLz77(source, offset);
  const encoded = compressLz77(data);
  assert.deepEqual(decompressLz77(encoded).data, data);
  let target = offset;
  const references = [];
  if (encoded.length > previous.consumed) {
    target = freeOffset;
    freeOffset = (target + encoded.length + 3) & ~3;
    assert(freeOffset <= output.length, 'Insufficient expanded ROM space for relocation');
    assert(output.subarray(target, freeOffset).every(byte => byte === 255), 'Relocation would overwrite existing data');
    for (let location = 0; location + 4 <= source.length; location += 4) {
      if (source.readUInt32LE(location) !== 0x08000000 + offset) continue;
      output.writeUInt32LE(0x08000000 + target, location);
      references.push(location);
    }
    assert(references.length > 0, 'No relocatable pointers found');
  }
  encoded.copy(output, target);
  resourceChanges.push({ offset, target, originalBytes: previous.consumed, patchedBytes: encoded.length, references });
}

function backgroundPixel(graphics, tileEntry, horizontal, vertical) {
  const tileX = tileEntry & 0x400 ? 7 - horizontal : horizontal;
  const tileY = tileEntry & 0x800 ? 7 - vertical : vertical;
  const packed = graphics[(tileEntry & 1023) * 32 + tileY * 4 + (tileX >> 1)];
  return (packed >> ((tileX & 1) * 4)) & 15;
}

function translateBackground(page) {
  const graphics = decompressLz77(source, page.graphics).data;
  const tileMap = decompressLz77(source, page.map).data;
  const columns = tileMap.readUInt16LE(0);
  const rows = tileMap.readUInt16LE(2);
  assert.equal(tileMap.length, 4 + columns * rows * 2);
  assert(columns === 30 || columns === 32);
  const graphicsBase = page.graphicsBase ?? 0;
  const mapBase = page.mapBase ?? 0xf800;
  if (!page.layoutOnly) {
    const vram = readFileSync(`work/${page.capture}.vram`);
    assert(vram.subarray(graphicsBase, graphicsBase + graphics.length).equals(graphics), 'Unexpected BG graphics');
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        assert.equal(vram.readUInt16LE(mapBase + row * 64 + column * 2), tileMap.readUInt16LE(4 + (row * columns + column) * 2) + (page.tileBias ?? 0), 'Unexpected BG map');
      }
    }
  }
  const editedCells = new Map();
  const paintedPixels = new Set();
  for (const label of page.labels) {
    const { left, top, width, height, text, pointSize } = label;
    assert([left, top, width, height].every(Number.isInteger));
    assert(left >= 0 && top >= 0 && left + width <= columns * 8 && top + height <= rows * 8);
    assert([...text].length * pointSize <= width);
    const mask = renderText(width, height, text, pointSize);
    assert.equal(mask.length, width * height);
    assert(mask.some(pixel => pixel > 127));
    for (let pixelY = 0; pixelY < height; pixelY++) {
      for (let pixelX = 0; pixelX < width; pixelX++) {
        const screenX = left + pixelX;
        const screenY = top + pixelY;
        const pixelKey = screenY * columns * 8 + screenX;
        assert(!paintedPixels.has(pixelKey), `Overlapping labels in ${page.capture}: ${text}`);
        paintedPixels.add(pixelKey);
        const cell = Math.floor(screenY / 8) * columns + Math.floor(screenX / 8);
        const originalEntry = tileMap.readUInt16LE(4 + cell * 2);
        if (!editedCells.has(cell)) {
          const tile = Buffer.alloc(32);
          for (let vertical = 0; vertical < 8; vertical++) {
            for (let horizontal = 0; horizontal < 8; horizontal++) {
              tile[vertical * 4 + (horizontal >> 1)] |= backgroundPixel(graphics, originalEntry, horizontal, vertical) << ((horizontal & 1) * 4);
            }
          }
          editedCells.set(cell, { tile, palette: originalEntry & 0xf000 });
        }
        const { tile } = editedCells.get(cell);
        const horizontal = screenX % 8;
        const vertical = screenY % 8;
        let value = label.background;
        const margin = label.preserveMargin ?? (label.preserveEdge ? 1 : 0);
        if (pixelY < margin || pixelY >= height - margin) value = backgroundPixel(graphics, originalEntry, horizontal, vertical);
        if (mask[pixelY * width + pixelX] > 127) value = label.fill;
        else if (label.outline !== undefined) {
          for (let deltaY = -1; deltaY <= 1; deltaY++) {
            for (let deltaX = -1; deltaX <= 1; deltaX++) {
              const neighborX = pixelX + deltaX;
              const neighborY = pixelY + deltaY;
              if (neighborX >= 0 && neighborX < width && neighborY >= 0 && neighborY < height && mask[neighborY * width + neighborX] > 127) value = label.outline;
            }
          }
        }
        const byteOffset = vertical * 4 + (horizontal >> 1);
        const shift = (horizontal & 1) * 4;
        tile[byteOffset] = (tile[byteOffset] & ~(15 << shift)) | (value << shift);
      }
    }
  }
  const protectedTiles = new Set();
  for (const offset of page.relatedMaps ?? []) {
    const related = decompressLz77(source, offset).data;
    assert.equal(related.length, 4 + related.readUInt16LE(0) * related.readUInt16LE(2) * 2);
    for (let location = 4; location < related.length; location += 2) protectedTiles.add(related.readUInt16LE(location) & 1023);
  }
  for (let cell = 0; cell < columns * rows; cell++) {
    if (!editedCells.has(cell)) protectedTiles.add(tileMap.readUInt16LE(4 + cell * 2) & 1023);
  }
  const available = [...new Set([...editedCells.keys()].map(cell => tileMap.readUInt16LE(4 + cell * 2) & 1023))].filter(tile => !protectedTiles.has(tile));
  const replacements = new Map();
  const newGraphics = Buffer.from(graphics);
  const newMap = Buffer.from(tileMap);
  for (const [cell, { tile, palette }] of editedCells) {
    const key = tile.toString('hex');
    if (!replacements.has(key)) {
      const target = available.shift();
      assert(target !== undefined, `Insufficient exclusive tiles for ${page.capture}`);
      assert(target * 32 + 32 <= newGraphics.length);
      tile.copy(newGraphics, target * 32);
      replacements.set(key, target);
    }
    newMap.writeUInt16LE(palette | replacements.get(key), 4 + cell * 2);
  }
  for (let screenY = 0; screenY < rows * 8; screenY++) {
    for (let screenX = 0; screenX < columns * 8; screenX++) {
      if (paintedPixels.has(screenY * columns * 8 + screenX)) continue;
      const cell = Math.floor(screenY / 8) * columns + Math.floor(screenX / 8);
      const before = backgroundPixel(graphics, tileMap.readUInt16LE(4 + cell * 2), screenX % 8, screenY % 8);
      const after = backgroundPixel(newGraphics, newMap.readUInt16LE(4 + cell * 2), screenX % 8, screenY % 8);
      assert.equal(after, before, `Untranslated pixel changed in ${page.capture} at ${screenX},${screenY}`);
    }
  }
  writeResource(page.graphics, newGraphics);
  writeResource(page.map, newMap);
}

for (const entry of entries) {
  const offset = entry.graphics ?? resourceOffset;
  if (!spriteResources.has(offset)) {
    const original = decompressLz77(source, offset).data;
    const updated = Buffer.alloc(offset === 0x12dd4c ? 0x3e00 : original.length);
    original.copy(updated);
    spriteResources.set(offset, { original, updated });
  }
  const { original, updated } = spriteResources.get(offset);
  const vram = readFileSync(`work/${entry.capture}.vram`);
  const oam = readFileSync(`work/${entry.capture}.oam`);
  const io = readFileSync(`work/${entry.capture}.io`);
  assert(io.readUInt16LE(0) & 0x40, 'Expected 1D OBJ mapping');
  const base = vram.indexOf(original);
  assert(base >= 0x10000, 'Resource not found in OBJ VRAM');
  const sprites = [];
  for (let index = 0; index < 128; index++) {
    const first = oam.readUInt16LE(index * 8);
    const second = oam.readUInt16LE(index * 8 + 2);
    const third = oam.readUInt16LE(index * 8 + 4);
    if (entry.spriteTiles && !entry.spriteTiles.includes(third & 1023)) continue;
    if ((first & 0x300) === 0x200 || (first & 255) >= 160) continue;
    if (!entry.rect && (first & 255) !== entry.top) continue;
    const [width, height] = dimensions[first >> 14][second >> 14];
    const sprite = { left: second & 511, top: first & 255, width, height, tile: third & 1023 };
    const geometry = entry.spriteGeometries?.find(candidate => candidate.tile === sprite.tile);
    if (geometry) Object.assign(sprite, geometry);
    if (entry.rect && (sprite.left >= entry.rect.left + entry.rect.width || sprite.left + width <= entry.rect.left || sprite.top >= entry.rect.top + entry.rect.height || sprite.top + height <= entry.rect.top)) continue;
    assert(!(first & 0x2100) && !(second & 0x3000), 'Unsupported transformed/8bpp OBJ');
    sprites.push(sprite);
  }
  assert(sprites.length > 0, 'No matching text sprites');
  const left = entry.rect?.left ?? Math.min(...sprites.map(sprite => sprite.left));
  const top = entry.rect?.top ?? entry.top;
  const width = entry.rect?.width ?? Math.max(...sprites.map(sprite => sprite.left + sprite.width)) - left;
  const height = entry.rect?.height ?? Math.max(...sprites.map(sprite => sprite.height));
  const pointSize = entry.pointSize ?? 12;
  const textInsetTop = entry.textInsetTop ?? 0;
  assert(Number.isInteger(textInsetTop) && textInsetTop >= 0 && textInsetTop < height);
  assert(entry.text.split('\n').every(line => [...line].length * pointSize <= width), 'Translation exceeds available width');
  let pixels;
  if (entry.spriteText) {
    pixels = Buffer.alloc(width * height);
    assert.equal(sprites.length, Object.keys(entry.spriteText).length);
    for (const sprite of sprites) {
      const text = entry.spriteText[sprite.tile];
      assert(text && [...text].length * pointSize <= sprite.width);
      const rendered = renderText(sprite.width, sprite.height, text, pointSize);
      assert.equal(rendered.length, sprite.width * sprite.height);
      const originX = sprite.left - left, originY = sprite.top - top;
      assert(originX >= 0 && originY >= 0 && originX + sprite.width <= width && originY + sprite.height <= height);
      for (let row = 0; row < sprite.height; row++) rendered.copy(pixels, (originY + row) * width + originX, row * sprite.width, (row + 1) * sprite.width);
    }
  } else {
    const textInsetLeft = entry.textInsetLeft ?? 0;
    assert(Number.isInteger(textInsetLeft) && textInsetLeft >= 0 && textInsetLeft < width);
    const rendered = renderText(width - textInsetLeft, height - textInsetTop, entry.text, pointSize, entry.gravity ?? 'center');
    pixels = Buffer.alloc(width * height);
    for (let row = 0; row < height - textInsetTop; row++) {
      rendered.copy(pixels, (row + textInsetTop) * width + textInsetLeft, row * (width - textInsetLeft), (row + 1) * (width - textInsetLeft));
    }
  }
  assert.equal(pixels.length, width * height);
  assert(pixels.some(pixel => pixel > 127), 'Blank glyph rendering');
  const coveredPixels = new Set();
  for (const sprite of sprites) {
    for (let vertical = 0; vertical < sprite.height; vertical++) {
      for (let horizontal = 0; horizontal < sprite.width; horizontal++) {
        const glyphHorizontal = sprite.left - left + horizontal;
        const glyphVertical = sprite.top - top + vertical;
        if (glyphHorizontal < 0 || glyphHorizontal >= width || glyphVertical < 0 || glyphVertical >= height) continue;
        coveredPixels.add(glyphVertical * width + glyphHorizontal);
        const foreground = pixels[glyphVertical * width + glyphHorizontal] > 127;
        let value = foreground ? (entry.fill ?? 11) : (entry.background ?? 0);
        if (!foreground && entry.outline !== false) {
          for (let deltaY = -1; deltaY <= 1; deltaY++) {
            for (let deltaX = -1; deltaX <= 1; deltaX++) {
              const neighborX = glyphHorizontal + deltaX;
              const neighborY = glyphVertical + deltaY;
              if (neighborX >= 0 && neighborX < width && neighborY >= 0 && neighborY < height && pixels[neighborY * width + neighborX] > 127) value = entry.outline ?? 12;
            }
          }
        }
        const tile = (entry.spriteTileTargets?.[sprite.tile] ?? sprite.tile) + Math.floor(vertical / 8) * (sprite.width / 8) + Math.floor(horizontal / 8);
        const byteOffset = 0x10000 - base + tile * 32 + (vertical % 8) * 4 + Math.floor((horizontal % 8) / 2);
        assert(byteOffset >= 0 && byteOffset < updated.length, 'OBJ outside resource');
        const shift = (horizontal & 1) * 4;
        const key = `${offset}:${byteOffset * 2 + (horizontal & 1)}`;
        if (writtenPixels.has(key)) assert.equal(writtenPixels.get(key), value, 'Conflicting shared glyph');
        writtenPixels.set(key, value);
        updated[byteOffset] = (updated[byteOffset] & ~(15 << shift)) | (value << shift);
      }
    }
  }
  for (let pixel = 0; pixel < pixels.length; pixel++) {
    assert(pixels[pixel] <= 127 || coveredPixels.has(pixel), `Text outside visible sprites: ${entry.capture} ${entry.text}`);
  }
}

for (const [offset, { original, updated }] of spriteResources) {
  for (let pixel = 0; pixel < updated.length * 2; pixel++) {
    if (writtenPixels.has(`${offset}:${pixel}`)) continue;
    const shift = (pixel & 1) * 4;
    assert.equal((updated[pixel >> 1] >> shift) & 15, ((original[pixel >> 1] ?? 0) >> shift) & 15, 'Untranslated sprite pixel changed');
  }
  writeResource(offset, updated.subarray(0, original.length));
}
for (const page of backgroundPages) translateBackground(page);
const pokerTextValidation = {
  graphics: 0x168b98, graphicsBase: 0x10000, table: 0x168b38,
  labels: ['高牌', '一對', '兩對', '三條', '四條', '五條', '順子', '同花', '葫蘆', '同花順', '皇家同花順', '底注', '加注', '下注', '跟注', '全下', '過牌', '棄牌', '跟注', '棄牌', '加注', '過牌', '下注', '全下'].map((text, animation) => ({ animation, text, pointSize: 12, fill: animation < 11 ? 1 : 7, background: animation < 11 ? 7 : 12 })),
};
const pokerGraphics = decompressLz77(source, pokerTextValidation.graphics).data;
assert.equal(pokerGraphics.length, 13120);
const updatedPokerGraphics = Buffer.from(pokerGraphics);
const paintedPokerPixels = new Set();
for (const label of pokerTextValidation.labels) {
  const frame = source.readUInt32LE(pokerTextValidation.table + label.animation * 4) - 0x08000000;
  const layout = source.readUInt32LE(frame) - 0x08000000;
  const count = source.readUInt16LE(frame + 6);
  const pixels = new Map();
  let width = 0;
  for (let sprite = 0; sprite < count; sprite++) {
    const descriptor = layout + sprite * 12;
    const tile = source.readUInt16LE(descriptor);
    const left = source.readUInt16LE(descriptor + 2), top = source.readUInt16LE(descriptor + 4);
    const size = source[descriptor + 9], spriteWidth = 8 << (size >> 2), height = 8 << (size & 3);
    assert.equal(top, 0);
    assert.equal(height, 16);
    width = Math.max(width, left + spriteWidth);
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < spriteWidth; column++) {
        const pixel = (tile + Math.floor(row / 8) * (spriteWidth / 8) + Math.floor(column / 8)) * 64 + (row % 8) * 8 + column % 8;
        assert(pixel < pokerGraphics.length * 2);
        const position = row * 256 + left + column;
        assert(!pixels.has(position));
        pixels.set(position, pixel);
      }
    }
  }
  Object.assign(label, { width, height: 16, layout, spriteCount: count });
  const mask = renderText(width - 2, 14, label.text, label.pointSize);
  for (let row = 1; row < 15; row++) {
    for (let column = 1; column < width - 1; column++) {
      const pixel = pixels.get(row * 256 + column);
      assert(pixel !== undefined, `Uncovered poker text: ${label.text}`);
      assert(!paintedPokerPixels.has(pixel), 'Overlapping poker text tiles');
      paintedPokerPixels.add(pixel);
      const shift = (pixel % 2) * 4, offset = Math.floor(pixel / 2);
      const color = mask[(row - 1) * (width - 2) + column - 1] > 127 ? label.fill : label.background;
      updatedPokerGraphics[offset] = (updatedPokerGraphics[offset] & ~(15 << shift)) | (color << shift);
    }
  }
}
for (let pixel = 0; pixel < pokerGraphics.length * 2; pixel++) {
  if (paintedPokerPixels.has(pixel)) continue;
  const shift = (pixel % 2) * 4, offset = Math.floor(pixel / 2);
  assert.equal((updatedPokerGraphics[offset] >> shift) & 15, (pokerGraphics[offset] >> shift) & 15, 'Poker border or unrelated pixel changed');
}
writeResource(pokerTextValidation.graphics, updatedPokerGraphics);
const daifugoTextValidation = {
  scope: 'Ten seat labels, fourteen announcements and four exchange instructions; original sprite layouts and animations preserved. Natural exchange and special-rule events are not fully verified.',
  labels: [
    ...['平民', '1名', '2名', '3名', '4名', '出完', '犯規', '落貧'].map((text, animation) => ({ graphics: 0x15e830, graphicsBase: 0x10000, table: 0x15e7d0, animation, text, pointSize: 12, status: true, rect: { left: 1, top: 1, width: 30, height: 14 } })),
    { graphics: 0x15e830, graphicsBase: 0x10000, table: 0x15e7d0, animation: 8, text: '不出', pointSize: 12, small: true },
    { graphics: 0x15e830, graphicsBase: 0x10000, table: 0x15e7d0, animation: 9, text: '跳過', pointSize: 12, small: true },
    { graphics: 0x160448, graphicsBase: 0x117e0, table: 0x1603d4, animation: 2, text: '8切牌', pointSize: 16, spriteCount: 6, rect: { left: 92, top: 65, width: 56, height: 22 } },
    { graphics: 0x160448, graphicsBase: 0x117e0, table: 0x1603d4, animation: 6, text: '逆轉方向', pointSize: 16, spriteCount: 6, rect: { left: 84, top: 65, width: 72, height: 22 } },
    { graphics: 0x160448, graphicsBase: 0x117e0, table: 0x1603d4, animation: 7, text: '跳過', pointSize: 18, spriteCount: 6, rect: { left: 82, top: 65, width: 72, height: 22 } },
    ...[
      [0, '革命', 4, 100, 65, 40, 22],
      [1, '王政復古', 6, 80, 65, 79, 22],
      [3, 'J反轉', 9, 56, 65, 128, 22],
      [4, '鎖定', 4, 100, 65, 40, 22],
      [5, '順子', 4, 100, 65, 40, 22],
      [8, '出完', 6, 92, 66, 56, 22],
      [9, '犯規', 4, 99, 65, 40, 22],
      [10, '守位', 5, 100, 65, 40, 22],
      [11, '落貧', 5, 92, 65, 56, 22],
      [12, '結束', 4, 100, 65, 40, 22],
    ].map(([animation, text, spriteCount, left, top, width, height]) => ({ graphics: 0x160448, graphicsBase: 0x117e0, table: 0x1603d4, animation, text, pointSize: 16, spriteCount, rect: { left, top, width, height } })),
    { graphics: 0x160448, graphicsBase: 0x117e0, table: 0x1603d4, animation: 13, text: '交換中', pointSize: 16, rect: { left: 84, top: 65, width: 72, height: 22 }, parts: [...'交換中'].map((text, index) => ({ text, left: index * 24, width: 24 })) },
    ...[
      [14, '這張牌將交出', 48, 144, [{ text: '這張牌', left: 0, width: 76, gravity: 'east' }, { text: '將交出', left: 80, width: 64, gravity: 'west' }]],
      [15, '這張牌已收到', 32, 176, [{ text: '這張牌', left: 0, width: 76, gravity: 'east' }, { text: '已收到', left: 80, width: 96, gravity: 'west' }]],
      [16, '請選擇1張牌交出', 20, 200, [{ text: '請選擇', left: 0, width: 84, gravity: 'east' }, { text: '1張牌交出', left: 88, width: 112, gravity: 'west' }]],
      [17, '請選擇2張牌交出', 20, 200, [{ text: '請選擇', left: 0, width: 84, gravity: 'east' }, { text: '2張牌交出', left: 88, width: 112, gravity: 'west' }]],
    ].map(([animation, text, left, width, parts]) => ({ graphics: 0x160448, graphicsBase: 0x117e0, table: 0x1603d4, animation, text, parts, pointSize: 12, status: true, rect: { left, top: 73, width, height: 14 } })),
  ],
};
for (const graphics of [0x15e830, 0x160448]) {
  const original = decompressLz77(source, graphics).data;
  const updated = Buffer.from(original), painted = new Set();
  for (const label of daifugoTextValidation.labels.filter(label => label.graphics === graphics)) {
    const frame = source.readUInt32LE(label.table + label.animation * 4) - 0x08000000;
    label.layout = source.readUInt32LE(frame) - 0x08000000;
    label.spriteCount ??= source.readUInt16LE(frame + 6);
    const rect = label.rect ?? { left: 0, top: 1, width: 32, height: 14 };
    const mask = Buffer.alloc(rect.width * rect.height);
    for (const part of label.parts ?? [{ text: label.text, left: 0, width: rect.width }]) {
      const rendered = renderText(part.width, rect.height, part.text, label.pointSize, part.gravity ?? 'center');
      assert(part.left >= 0 && part.left + part.width <= rect.width);
      for (let row = 0; row < rect.height; row++) rendered.copy(mask, row * rect.width + part.left, row * part.width, (row + 1) * part.width);
    }
    const covered = new Set();
    for (let sprite = 0; sprite < label.spriteCount; sprite++) {
      const descriptor = label.layout + sprite * 12;
      const tile = source.readUInt16LE(descriptor), left = source.readInt16LE(descriptor + 2), top = source.readInt16LE(descriptor + 4);
      const size = source[descriptor + 9], width = 8 << (size >> 2), height = 8 << (size & 3);
      for (let row = 0; row < height; row++) {
        for (let column = 0; column < width; column++) {
          const pixel = (tile + Math.floor(row / 8) * (width / 8) + Math.floor(column / 8)) * 64 + row % 8 * 8 + column % 8;
          assert(pixel < original.length * 2);
          const horizontal = left + column - rect.left, vertical = top + row - rect.top;
          const ink = (horizontal, vertical) => horizontal >= 0 && horizontal < rect.width && vertical >= 0 && vertical < rect.height && mask[vertical * rect.width + horizontal] > 127;
          let color = 0;
          if (label.status) {
            color = (original[pixel >> 1] >> ((pixel % 2) * 4)) & 15;
            if (horizontal >= 0 && horizontal < rect.width && vertical >= 0 && vertical < rect.height) color = 1;
          }
          if (label.small) {
            const originalColumn = column < 20 ? column : column < 28 ? 19 : column - 8;
            const originalPixel = (64 + Math.floor(row / 8) * 4 + Math.floor(originalColumn / 8)) * 64 + row % 8 * 8 + originalColumn % 8;
            color = (original[originalPixel >> 1] >> ((originalPixel % 2) * 4)) & 15;
            if (row > 0 && row < 14 && column > 0 && column < 29) color = 7;
          }
          if (ink(horizontal, vertical)) color = label.status ? 7 : label.small ? 1 : 2;
          else if (!label.small && !label.status) {
            for (let deltaY = -1; deltaY <= 1; deltaY++) for (let deltaX = -1; deltaX <= 1; deltaX++) if (ink(horizontal + deltaX, vertical + deltaY)) color = 7;
          }
          if (horizontal >= 0 && horizontal < rect.width && vertical >= 0 && vertical < rect.height) covered.add(vertical * rect.width + horizontal);
          const shift = (pixel % 2) * 4;
          if (painted.has(pixel)) assert.equal((updated[pixel >> 1] >> shift) & 15, color, `${label.text}: conflicting shared text`);
          painted.add(pixel);
          updated[pixel >> 1] = (updated[pixel >> 1] & ~(15 << shift)) | (color << shift);
        }
      }
    }
    for (let pixel = 0; pixel < mask.length; pixel++) assert(mask[pixel] <= 127 || covered.has(pixel), `${label.text}: clipped text`);
  }
  for (let pixel = 0; pixel < original.length * 2; pixel++) if (!painted.has(pixel)) assert.equal((updated[pixel >> 1] >> ((pixel % 2) * 4)) & 15, (original[pixel >> 1] >> ((pixel % 2) * 4)) & 15);
  writeResource(graphics, updated);
}
const flowerTextValidation = {
  graphics: 0x13c914, table: 0x13c748,
  scope: 'Original sprite layouts; offline glyph checks and opening resource checks only, not natural scoring or special-rule validation.',
  labels: [
    ...[[0, '素牌'], [15, '短冊'], [21, '種牌'], [26, '青短'], [27, '赤短']].map(([animation, text]) => ({ animation, text, rect: { left: 1, top: 1, width: 38, height: 14 } })),
    ...[[1, 14, '素'], [16, 20, '短'], [22, 25, '種']].flatMap(([first, last, text]) => Array.from({ length: last - first + 1 }, (_, index) => ({ animation: first + index, text, rect: { left: 1, top: 1, width: 23, height: 14 }, preservedNumber: index + 2 }))),
    ...[[36, '藤'], [37, '桐'], [38, '雨']].map(([animation, text]) => ({ animation, text: `${text}島`, rect: { left: 1, top: 1, width: 38, height: 14 }, parts: [{ text, left: 0, width: 15 }, { text: '島', left: 15, width: 23 }] })),
    { animation: 109, text: '低分', rect: { left: 1, top: 1, width: 38, height: 14 } },
    { animation: 39, text: '繼續', fill: 5, background: 1, rect: { left: 2, top: 1, width: 60, height: 14 } },
    { animation: 39, text: '結算', fill: 5, background: 1, rect: { left: 2, top: 17, width: 60, height: 14 } },
    ...[58, 114].map(left => ({ animation: 42, text: '再來', pointSize: 24, fill: 12, background: 0, outline: 8, spriteIndices: left === 58 ? [4, 5, 6] : [1, 2, 3], rect: { left, top: 64, width: 56, height: 32 } })),
    { animation: 44, text: '結算', pointSize: 24, fill: 12, background: 0, outline: 8, spriteIndices: [1, 2], rect: { left: 75, top: 64, width: 72, height: 32 } },
  ],
};
const flowerOriginal = decompressLz77(source, flowerTextValidation.graphics).data;
assert.equal(flowerOriginal.length, 15648);
const flowerUpdated = Buffer.from(flowerOriginal), flowerPainted = new Map();
for (const label of flowerTextValidation.labels) {
  label.pointSize ??= 12;
  label.fill ??= 5;
  label.background ??= 1;
  const frame = source.readUInt32LE(flowerTextValidation.table + label.animation * 4) - 0x08000000;
  label.layout = source.readUInt32LE(frame) - 0x08000000;
  label.spriteCount = source.readUInt16LE(frame + 6);
  const { left, top, width, height } = label.rect;
  const mask = Buffer.alloc(width * height);
  for (const part of label.parts ?? [{ text: label.text, left: 0, width }]) {
    const rendered = renderText(part.width, height, part.text, label.pointSize);
    for (let row = 0; row < height; row++) rendered.copy(mask, row * width + part.left, row * part.width, (row + 1) * part.width);
  }
  const covered = new Set();
  for (let sprite = 0; sprite < label.spriteCount; sprite++) {
    if (label.spriteIndices && !label.spriteIndices.includes(sprite)) continue;
    const descriptor = label.layout + sprite * 12, tile = source.readUInt16LE(descriptor);
    const originX = source.readInt16LE(descriptor + 2), originY = source.readInt16LE(descriptor + 4), size = source[descriptor + 9];
    const spriteWidth = 8 << (size >> 2), spriteHeight = 8 << (size & 3);
    for (let row = 0; row < spriteHeight; row++) for (let column = 0; column < spriteWidth; column++) {
      const horizontal = originX + column - left, vertical = originY + row - top;
      if (horizontal < 0 || horizontal >= width || vertical < 0 || vertical >= height) continue;
      const pixel = (tile + Math.floor(row / 8) * spriteWidth / 8 + Math.floor(column / 8)) * 64 + row % 8 * 8 + column % 8;
      assert(pixel < flowerOriginal.length * 2);
      let color = mask[vertical * width + horizontal] > 127 ? label.fill : label.background;
      if (color === label.background && label.outline !== undefined) {
        for (let deltaY = -1; deltaY <= 1; deltaY++) for (let deltaX = -1; deltaX <= 1; deltaX++) {
          const neighborX = horizontal + deltaX, neighborY = vertical + deltaY;
          if (neighborX >= 0 && neighborX < width && neighborY >= 0 && neighborY < height && mask[neighborY * width + neighborX] > 127) color = label.outline;
        }
      }
      if (flowerPainted.has(pixel)) assert.equal(flowerPainted.get(pixel), color, `${label.text}: conflicting shared flower glyph`);
      flowerPainted.set(pixel, color);
      covered.add(vertical * width + horizontal);
      const shift = pixel % 2 * 4;
      flowerUpdated[pixel >> 1] = (flowerUpdated[pixel >> 1] & ~(15 << shift)) | (color << shift);
    }
  }
  for (let pixel = 0; pixel < mask.length; pixel++) assert(mask[pixel] <= 127 || covered.has(pixel), `${label.text}: clipped flower glyph`);
}
for (let pixel = 0; pixel < flowerOriginal.length * 2; pixel++) if (!flowerPainted.has(pixel)) assert.equal((flowerUpdated[pixel >> 1] >> (pixel % 2 * 4)) & 15, (flowerOriginal[pixel >> 1] >> (pixel % 2 * 4)) & 15);
writeResource(flowerTextValidation.graphics, flowerUpdated);
const resultGlyphTranslations = [
  [9, '槍', '搶'], [23, '気', '氣'], [25, '対', '對'], [28, '帯', '帶'],
  [34, '発', '發'], [50, '国', '國'], [53, '双', '雙'], [61, '宝', '寶'],
  [68, '緑', '綠'], [75, '万', '萬'], [82, '荘', '莊'], [85, '満', '滿'],
  [86, '点', '點'], [103, 'ド', '寶'], [104, 'ラ', '牌'],
].map(([glyph, original, text]) => ({ glyph, original, text }));
const resultGlyphRows = [
  '自摸河海底嶺上開花槍立直平断么盃',
  '口牌ダブル同順気通対々全帯混純二',
  '流し発副符天和地人四暗刻く単騎待',
  'ちう国士無双大三元槓子九連宝燈字',
  '一色小喜緑清老頭車輪百万石七星十',
  '面八荘紅役満点親x0123456',
  '789貫倍跳裏ドラ翻',
];
assert(resultGlyphRows.slice(0, -1).every(row => [...row].length === 16));
const resultGlyphChanges = [...resultGlyphRows.join('')].map((original, glyph) => ({
  glyph, original, text: resultGlyphTranslations.find(change => change.glyph === glyph)?.text ?? original,
  originX: 2, originY: original === '么' ? 1 : 2,
}));
assert.equal(resultGlyphChanges.length, 106);
const resultFontOffset = 0x12e86c;
const resultFont = decompressLz77(source, resultFontOffset).data;
assert.equal(resultFont.length, 14144, 'Unexpected results font size');
const updatedResultFont = Buffer.from(resultFont);
for (const change of resultGlyphChanges) {
  const start = change.glyph * 128;
  const colors = new Set();
  for (const packed of resultFont.subarray(start, start + 128)) {
    if (packed & 15) colors.add(packed & 15);
    if (packed >> 4) colors.add(packed >> 4);
  }
  assert.equal(colors.size, 1, `Unexpected results glyph palette: ${change.original}`);
  const [foreground] = colors;
  const native = execFileSync('magick', ['-background', 'black', '-fill', 'white', '-font', font, '-pointsize', '19', '+antialias', `label:${change.text}`, '-gravity', 'northwest', '-extent', '16x24', '-colorspace', 'Gray', '-depth', '8', 'gray:-']);
  const mask = Buffer.alloc(16 * 16);
  for (let row = 0; row < 24; row++) {
    for (let column = 0; column < 16; column++) {
      if (native[row * 16 + column] <= 127) continue;
      assert(row + change.originY < 14 && column < 12, `Results glyph exceeds native 12px cell: ${change.text}`);
      mask[(row + change.originY) * 16 + column + change.originX] = 255;
    }
  }
  updatedResultFont.fill(0, start, start + 128);
  for (let vertical = 0; vertical < 16; vertical++) {
    for (let horizontal = 0; horizontal < 16; horizontal++) {
      if (mask[vertical * 16 + horizontal] <= 127) continue;
      const tile = Math.floor(vertical / 8) * 2 + Math.floor(horizontal / 8);
      const offset = start + tile * 32 + (vertical % 8) * 4 + Math.floor((horizontal % 8) / 2);
      updatedResultFont[offset] |= foreground << ((horizontal & 1) * 4);
    }
  }
}
const changedResultGlyphs = new Set(resultGlyphChanges.map(change => change.glyph));
const resultSmallDigits = Array.from({ length: 10 }, (_, digit) => ({ tile: 432 + digit, text: String(digit) }));
for (const digit of resultSmallDigits) {
  const start = digit.tile * 32;
  const colors = new Set([...resultFont.subarray(start, start + 32)].flatMap(value => [value & 15, value >> 4]).filter(Boolean));
  assert.equal(colors.size, 1);
  const [foreground] = colors;
  const mask = renderText(8, 8, digit.text, 8);
  updatedResultFont.fill(0, start, start + 32);
  for (let pixel = 0; pixel < 64; pixel++) {
    if (mask[pixel] > 127) updatedResultFont[start + (pixel >> 1)] |= foreground << ((pixel & 1) * 4);
  }
}
for (let offset = 0; offset < resultFont.length; offset++) {
  if (!changedResultGlyphs.has(Math.floor(offset / 128)) && offset < 432 * 32) assert.equal(updatedResultFont[offset], resultFont[offset], 'Results icon changed');
}
writeResource(resultFontOffset, updatedResultFont);
const resultRankChanges = [
  { graphics: 0x135ee8, glyphs: '貫滿', text: '滿貫', fill: 2, outline: 1 },
  { graphics: 0x135b68, glyphs: '滿跳', text: '跳滿', fill: 2, outline: 1 },
  { graphics: 0x135828, glyphs: '滿倍', text: '倍滿', fill: 2, outline: 1 },
  { graphics: 0x136284, glyphs: '滿倍三', text: '三倍滿', fill: 2, outline: 1 },
  { graphics: 0x13658c, glyphs: '役滿', text: '役滿', fill: 4, outline: 6 },
];
for (const rank of resultRankChanges) {
  const original = decompressLz77(source, rank.graphics).data;
  assert.equal(original.length, [...rank.glyphs].length * 512);
  const updated = Buffer.alloc(original.length);
  for (const [glyph, text] of [...rank.glyphs].entries()) {
    const mask = renderText(32, 32, text, 24);
    for (let row = 0; row < 32; row++) {
      for (let column = 0; column < 32; column++) {
        let color = mask[row * 32 + column] > 127 ? rank.fill : 0;
        if (!color) {
          for (let deltaY = -1; deltaY <= 1; deltaY++) {
            for (let deltaX = -1; deltaX <= 1; deltaX++) {
              const neighborX = column + deltaX, neighborY = row + deltaY;
              if (neighborX >= 0 && neighborX < 32 && neighborY >= 0 && neighborY < 32 && mask[neighborY * 32 + neighborX] > 127) color = rank.outline;
            }
          }
        }
        const tile = Math.floor(row / 8) * 4 + Math.floor(column / 8);
        updated[glyph * 512 + tile * 32 + (row % 8) * 4 + Math.floor((column % 8) / 2)] |= color << ((column & 1) * 4);
      }
    }
  }
  writeResource(rank.graphics, updated);
}
const retryDialogValidation = {
  graphics: 0x132738, graphicsBase: 0x15f60, palette: 0x132354,
  layout: 0x132374, spriteCount: 57,
  labels: [
    { left: 80, top: 48, width: 72, height: 16, text: '再玩一局？', fill: 8 },
    { left: 104, top: 68, width: 48, height: 16, text: '要', fill: 1 },
    { left: 104, top: 84, width: 48, height: 16, text: '不要', fill: 1 },
  ],
  scope: 'Original sprite layout and palette reconstruction only; natural end-of-match display and A/B continuation are not yet verified.',
};
const retryGraphics = decompressLz77(source, retryDialogValidation.graphics).data;
assert.equal(retryGraphics.length, 2368);
const updatedRetryGraphics = Buffer.from(retryGraphics);
const retryPixels = new Map();
for (let sprite = 0; sprite < retryDialogValidation.spriteCount; sprite++) {
  const descriptor = retryDialogValidation.layout + sprite * 12;
  const tile = source.readUInt16LE(descriptor);
  const left = source.readUInt16LE(descriptor + 2), top = source.readUInt16LE(descriptor + 4);
  const size = source[descriptor + 9], width = 8 << (size >> 2), height = 8 << (size & 3);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const pixel = (tile + Math.floor(row / 8) * (width / 8) + Math.floor(column / 8)) * 64 + (row % 8) * 8 + column % 8;
      assert(pixel < retryGraphics.length * 2);
      const screenPixel = (top + row) * 240 + left + column;
      assert(!retryPixels.has(screenPixel), 'Overlapping retry sprites');
      retryPixels.set(screenPixel, pixel);
    }
  }
}
const paintedRetryPixels = new Set();
for (const label of retryDialogValidation.labels) {
  const mask = renderText(label.width, label.height, label.text, 12, 'west');
  for (let row = 0; row < label.height; row++) {
    for (let column = 0; column < label.width; column++) {
      const screenPixel = (label.top + row) * 240 + label.left + column;
      const pixel = retryPixels.get(screenPixel);
      assert(pixel !== undefined, `Uncovered retry text: ${label.text}`);
      assert(!paintedRetryPixels.has(screenPixel), 'Overlapping retry labels');
      paintedRetryPixels.add(screenPixel);
      const shift = (pixel % 2) * 4, offset = Math.floor(pixel / 2);
      const color = mask[row * label.width + column] > 127 ? label.fill : 5;
      updatedRetryGraphics[offset] = (updatedRetryGraphics[offset] & ~(15 << shift)) | (color << shift);
    }
  }
}
for (const [screenPixel, pixel] of retryPixels) {
  if (paintedRetryPixels.has(screenPixel)) continue;
  const offset = Math.floor(pixel / 2), shift = (pixel % 2) * 4;
  assert.equal((updatedRetryGraphics[offset] >> shift) & 15, (retryGraphics[offset] >> shift) & 15, 'Retry icon or border changed');
}
writeResource(retryDialogValidation.graphics, updatedRetryGraphics);
const spriteGeometryChanges = [
  { offset: 0x132d4c, original: '2200e0008800000000010000', patched: '2200c4008800000000050000' },
  { offset: 0x132d58, original: '2400c0009000000000080000', patched: '2600d4008800000000010000' },
];
for (const [offsets, originalTile, patchedTile] of [
  [[0x12a298, 0x12a394], 110, 472],
  [[0x12a2b0, 0x12a3b8], 118, 480],
  [[0x12a2c8, 0x12a3dc], 122, 488],
]) {
  for (const offset of offsets) {
    assert.equal(source.readUInt16LE(offset), originalTile, 'Unexpected action glyph layout');
    assert.equal(source.readUInt16LE(offset + 8), 0x0500, 'Unexpected action glyph size');
    const original = source.subarray(offset, offset + 12);
    const patched = Buffer.from(original);
    patched.writeUInt16LE(patchedTile, 0);
    patched.writeUInt16LE(0x0900, 8);
    spriteGeometryChanges.push({ offset, original: original.toString('hex'), patched: patched.toString('hex') });
  }
}
for (const change of spriteGeometryChanges) {
  assert.equal(source.subarray(change.offset, change.offset + 12).toString('hex'), change.original, 'Unexpected skip sprite layout');
  Buffer.from(change.patched, 'hex').copy(output, change.offset);
}
const spriteLayoutChanges = [0x12a28c, 0x12a388].map(offset => {
  assert.equal(source.readUInt16LE(offset), 102, 'Unexpected shared riichi glyph');
  output.writeUInt16LE(92, offset);
  return { offset, originalTile: 102, patchedTile: 92, reason: 'Riichi must not reuse the translated chi glyph; use the cleared shared suffix.' };
});
for (const offset of [0x12aad8, 0x12b534, 0x12bf90, 0x12c9ec]) {
  assert.equal(source.readUInt16LE(offset), 188, 'Unexpected shared riichi bubble glyph');
  output.writeUInt16LE(114, offset);
  spriteLayoutChanges.push({ offset, originalTile: 188, patchedTile: 114, reason: 'Riichi bubble uses a dedicated full-size second character instead of the shared chi glyph.' });
}
for (const [originalTile, offsets] of [[114, [0x12a2a4, 0x12a3ac]], [180, [0x12a760, 0x12a88c, 0x12b1bc, 0x12b2e8, 0x12bc0c, 0x12bd38, 0x12c674, 0x12c7a0]]]) {
  for (const offset of offsets) {
    assert.equal(source.readUInt16LE(offset), originalTile, 'Unexpected reused suffix');
    output.writeUInt16LE(92, offset);
    spriteLayoutChanges.push({ offset, originalTile, patchedTile: 92, reason: 'Keep this suffix blank after repurposing its graphics for a full-size Chinese character.' });
  }
}
const actionGraphics = spriteResources.get(0x12dd4c).updated.subarray(0x3b00, 0x3e00);
const encodedActions = compressLz77(actionGraphics);
assert.deepEqual(decompressLz77(encodedActions).data, actionGraphics);
const actionGraphicsOffset = freeOffset;
const actionHookOffset = (actionGraphicsOffset + encodedActions.length + 3) & ~3;
freeOffset = actionHookOffset + 24;
assert(freeOffset <= output.length);
assert(output.subarray(actionGraphicsOffset, freeOffset).every(value => value === 255));
encodedActions.copy(output, actionGraphicsOffset);
const hookInstructions = [0xb510, 0xdf12, 0xb40f, 0x4802, 0x4902, 0xdf12, 0xbc0f, 0xbd10];
hookInstructions.forEach((instruction, index) => output.writeUInt16LE(instruction, actionHookOffset + index * 2));
output.writeUInt32LE(0x08000000 + actionGraphicsOffset, actionHookOffset + 16);
output.writeUInt32LE(0x06017b00, actionHookOffset + 20);
const actionLoadChanges = [0x1145a, 0x118f6].map(offset => {
  const original = source.subarray(offset, offset + 4).toString('hex');
  assert.equal(original, offset === 0x1145a ? 'eff7e7fb' : 'eff799f9');
  const displacement = actionHookOffset - offset - 4;
  assert(displacement >= -0x400000 && displacement < 0x400000 && displacement % 2 === 0);
  output.writeUInt16LE(0xf000 | ((displacement >> 12) & 0x7ff), offset);
  output.writeUInt16LE(0xf800 | ((displacement >> 1) & 0x7ff), offset + 2);
  return { offset, original, patched: output.subarray(offset, offset + 4).toString('hex') };
});
const actionTextGraphics = { target: actionGraphicsOffset, graphicsBase: 0x17b00, bytes: actionGraphics.length, hook: actionHookOffset, loadChanges: actionLoadChanges };
const actionTextColors = {
  index: 10, selected: 0x03ff, unselected: 0x03e0,
  paletteOffset: 0x129ccc, paletteIndex: 1, original: 0,
};
assert.equal(source.readUInt16LE(0x76a38 + actionTextColors.index * 2), actionTextColors.unselected);
assert.equal(source.readUInt16LE(actionTextColors.paletteOffset + actionTextColors.index * 2), actionTextColors.original);
output.writeUInt16LE(actionTextColors.selected, actionTextColors.paletteOffset + actionTextColors.index * 2);
const resultsLayoutChanges = [
  { offset: 0xdcd0, original: 0x210c, patched: 0x210e, reason: 'Shared yaku/han row advance: 12 -> 14.' },
  { offset: 0xde22, original: 0x300c, patched: 0x300e, reason: 'Dora to ura-dora row advance: 12 -> 14.' },
  { offset: 0xded2, original: 0x2194, patched: 0x218e, reason: 'Summary shared Y: 148 -> 142.' },
  { offset: 0xdee2, original: 0x2294, patched: 0x228e, reason: 'Dealer summary Y: 148 -> 142.' },
  { offset: 0xdef4, original: 0x2294, patched: 0x228e, reason: 'Non-dealer summary Y: 148 -> 142.' },
];
for (const change of resultsLayoutChanges) {
  assert.equal(source.readUInt16LE(change.offset), change.original, 'Unexpected results layout instruction');
  output.writeUInt16LE(change.patched, change.offset);
}
const chunks = [Buffer.from('PATCH')];
let position = 0;
while (position < output.length) {
  if (source[position] === output[position]) {
    position++;
    continue;
  }
  const start = position;
  let runEnd = position + 1;
  while (runEnd < output.length && output[runEnd] === output[position] && runEnd - position < 65535) runEnd++;
  if (runEnd - position >= 8) {
    const record = Buffer.alloc(8);
    record.writeUIntBE(start, 0, 3);
    record.writeUInt16BE(runEnd - start, 5);
    record[7] = output[start];
    chunks.push(record);
    position = runEnd;
    continue;
  }
  while (position < output.length && source[position] !== output[position] && position - start < 65535) position++;
  const header = Buffer.alloc(5);
  header.writeUIntBE(start, 0, 3);
  header.writeUInt16BE(position - start, 3);
  chunks.push(header, output.subarray(start, position));
}
chunks.push(Buffer.from('EOF'));
const patch = Buffer.concat(chunks);
const replay = Buffer.alloc(output.length);
source.copy(replay);
let cursor = 5;
while (patch.subarray(cursor, cursor + 3).toString() !== 'EOF') {
  const offset = patch.readUIntBE(cursor, 3);
  const size = patch.readUInt16BE(cursor + 3);
  if (size === 0) {
    const runLength = patch.readUInt16BE(cursor + 5);
    replay.fill(patch[cursor + 7], offset, offset + runLength);
    cursor += 8;
  } else {
    patch.copy(replay, offset, cursor + 5, cursor + 5 + size);
    cursor += 5 + size;
  }
}
assert.deepEqual(replay, output, 'IPS round-trip mismatch');
mkdirSync('dist', { recursive: true });
writeFileSync('work/isseki-hatchou-zh-hant-preview.gba', output);
writeFileSync('dist/isseki-hatchou-zh-hant-preview.ips', patch);
const translated = [...entries, ...backgroundPages.flatMap(page => page.labels.map(label => ({ capture: page.capture, text: label.text }))), ...retryDialogValidation.labels.map(label => ({ capture: 'mahjong-retry-layout', graphics: retryDialogValidation.graphics, text: label.text, displayOnly: true })), ...pokerTextValidation.labels.map(label => ({ capture: 'poker-text-layout', graphics: pokerTextValidation.graphics, text: label.text, animation: label.animation })), ...daifugoTextValidation.labels.map(label => ({ capture: 'daifugo-text-layout', graphics: label.graphics, text: label.text, animation: label.animation })), ...flowerTextValidation.labels.map(label => ({ capture: 'flower-text-layout', graphics: flowerTextValidation.graphics, text: `${label.text}${label.preservedNumber ?? ''}`, animation: label.animation }))];
const validation = [
  ...['select', 'game-menu'].map(capture => ({ capture, graphics: resourceOffset, graphicsBase: 0x12000 })),
  ...entries.filter(entry => entry.graphics).map(entry => ({ capture: entry.capture, graphics: entry.graphics, graphicsBase: entry.graphicsBase })),
  ...['daifugo', 'daifugo-page3'].map(capture => ({ capture, graphics: 0x15c090, graphicsBase: 0x15900 })),
  { capture: 'poker-opening', graphics: pokerTextValidation.graphics, graphicsBase: pokerTextValidation.graphicsBase },
  ...[0x15e830, 0x160448].map(graphics => ({ capture: 'daifugo-opening', graphics, graphicsBase: graphics === 0x15e830 ? 0x10000 : 0x117e0 })),
  ...['koikoi-opening', 'hanamatch-opening'].map(capture => ({ capture, graphics: flowerTextValidation.graphics, graphicsBase: 0x12700 })),
  ...backgroundPages.filter(page => !page.layoutOnly).map(page => ({ capture: page.capture, graphics: page.graphics, graphicsBase: page.graphicsBase ?? 0, map: page.map, mapBase: page.mapBase ?? 0xf800, tileBias: page.tileBias ?? 0 })),
];
const backgroundLayoutValidation = backgroundPages.filter(page => page.layoutOnly).map(page => ({ ...page, scope: 'Offline background layout only; natural result/replay flow and scrolling are not yet verified.' }));
const backgroundLabelValidation = backgroundPages.filter(page => /^daifugo(?:-page[23])?$/.test(page.capture)).map(page => ({ ...page, capture: `${page.capture}-label-layout` }));
const resultsFontValidation = { graphics: resultFontOffset, glyphChanges: resultGlyphChanges, smallDigits: resultSmallDigits, ranks: resultRankChanges, scope: 'Silver text and rank atlases and patch round trips only; natural winning-screen rendering and scoring flow are not yet verified.' };
writeFileSync('dist/report.json', JSON.stringify({ status: 'partial-menu-preview', sourceSha256, translationFont, translated, resourceChanges, spriteLayoutChanges, spriteGeometryChanges, actionTextGraphics, actionTextColors, resultsFontValidation, resultsLayoutChanges, retryDialogValidation, backgroundLayoutValidation, backgroundLabelValidation, pokerTextValidation, daifugoTextValidation, flowerTextValidation, validation, patchBytes: patch.length }, null, 2) + '\n');
console.log(`Built partial menu preview: ${translated.length} labels, ${patch.length}-byte IPS; compression and patch round trips passed.`);
console.log(`Results font: ${resultGlyphChanges.length} glyph substitutions checked; winning-screen rendering remains unverified.`);