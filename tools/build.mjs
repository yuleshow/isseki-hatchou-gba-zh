import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { decompressLz77, loadRom, sourceArchive } from './inspect-rom.mjs';
import { checkBubbleText, expectedActionPalette } from './check-action-colors.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
assert.equal(process.platform, 'darwin', 'This capture build currently supports macOS');
loadRom();
mkdirSync('work', { recursive: true });
const mgba = process.env.MGBA_PREFIX ?? execFileSync('brew', ['--prefix', 'mgba'], { encoding: 'utf8' }).trim();
const compatibleSdk = '/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk';
const sdk = process.env.MACOS_SDK ?? (existsSync(compatibleSdk) ? compatibleSdk : execFileSync('xcrun', ['--show-sdk-path'], { encoding: 'utf8' }).trim());
execFileSync('xcrun', ['clang', '-Wall', '-Wextra', '-Werror', '-isysroot', sdk, '-mmacosx-version-min=15.0', `-I${join(mgba, 'include')}`, 'tools/capture.c', `-L${join(mgba, 'lib')}`, '-lmgba', '-o', 'work/capture'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/inspect-rom.mjs', '--self-test'], { stdio: 'inherit' });
const mainMenu = ['600:0', '1:8', '120:0', '1:8', '120:0'];
const modeMenu = [...mainMenu, '1:1', '60:0'];
const gameSelect = [...modeMenu, '1:1', '120:0'];
const players = [...gameSelect, '1:1', '180:0'];
const rules = [...players, '1:1', '120:0'];
const mahjongPause = [...rules, '1:1', '1800:0', '1:8', '60:0'];
const mahjongDealt = [...rules, '1:1', '600:0', '1:2', '1200:0'];
const mahjongTurns = count => [...mahjongDealt, ...Array.from({ length: count }, () => ['1:1', '180:0']).flat()];
const mahjongPon = [...mahjongDealt, 'watch:608:7000'];
const displayFixtures = [['kan', 42, 35, 618], ['riichi', 43, 36, 622], ['tsumo', 44, 37, 630], ['ron', 45, 38, 634]].flatMap(([action, prompt, announcement, tile]) =>
  [['fixture', prompt], ['announcement-fixture', announcement]].map(([variant, animation]) => ({
    name: `mahjong-${action}-${variant}`, validationCapture: `mahjong-${action}-fixture`,
    sequence: [...mahjongPon, `mahjong-preview:${animation}`], displayOnly: true, expectedTile: ({ riichi: 984, tsumo: 992, ron: 1000 })[action] ?? tile,
    actionTile: action === 'kan' ? undefined : [tile, ({ riichi: 984, tsumo: 992, ron: 1000 })[action]],
    oamRemap: action === 'riichi' ? [614, 604] : action === 'tsumo' ? [626, 604] : undefined,
  })));
for (let seat = 0; seat < 4; seat++) {
  for (let notice = 0; notice < 8; notice++) {
    const animation = 50 + seat * 8 + notice;
    displayFixtures.push({
      name: `mahjong-notice-${animation}-fixture`,
      validationCapture: notice === 0 || notice === 7 ? 'mahjong-dealt' : `mahjong-notice-${50 + notice}-fixture`,
      sequence: [...mahjongPon, `mahjong-preview:${animation}`], displayOnly: true,
      expectedTile: [669, 688, 696, 700, 706, 710, 720, 724][notice],
      oamRemap: notice === 4 ? [700, 626] : notice === 1 || notice === 2 ? [692, 604] : undefined,
    });
  }
}
const cases = [
  ...displayFixtures,
  { name: 'mahjong-pon', sequence: mahjongPon },
  { name: 'mahjong-pon-confirm', validationCapture: 'mahjong-dealt', sequence: [...mahjongPon, '30:0', '1:1', '180:0'] },
  { name: 'mahjong-pon-cancel', validationCapture: 'mahjong-dealt', sequence: [...mahjongPon, '30:0', '1:2', '180:0'] },
  { name: 'mahjong-turns-25', sequence: mahjongTurns(25) },
  { name: 'mahjong-chi-confirm', validationCapture: 'mahjong-dealt', sequence: [...mahjongTurns(25), '1:1', '180:0'] },
  { name: 'mahjong-chi-cancel', validationCapture: 'mahjong-dealt', sequence: [...mahjongTurns(25), '1:2', '60:0'] },
  ...[17, 20, 22].map(count => ({ name: `mahjong-turns-${count}`, validationCapture: 'mahjong-dealt', sequence: mahjongTurns(count) })),
  { name: 'mahjong-pause', sequence: mahjongPause },
  { name: 'mahjong-resume', validationCapture: 'mahjong-next-opening', sequence: [...mahjongPause, '1:8', '60:0'] },
  { name: 'mahjong-dealt', sequence: mahjongDealt },
  { name: 'mahjong-discard', validationCapture: 'mahjong-dealt', sequence: [...mahjongDealt, '1:1', '120:0'] },
  { name: 'mahjong-quit', validationCapture: 'mahjong-next', sequence: [...mahjongPause, '1:80', '10:0', '1:80', '10:0', '1:80', '10:0', '1:1', '60:0'] },
  { name: 'mahjong-select', validationCapture: 'mahjong-next', sequence: [...mahjongDealt, '1:4', '60:0'] },
  { name: 'select', sequence: mainMenu },
  { name: 'game-menu', sequence: [...mainMenu, '1:1', '120:0'] },
  { name: 'games', sequence: gameSelect },
  { name: 'options', sequence: [...mainMenu, '1:80', '10:0', '1:1', '120:0'] },
  { name: 'mahjong', sequence: players },
  { name: 'mahjong-next', sequence: rules },
  { name: 'sanma', validationCapture: 'mahjong-next', sequence: [...gameSelect, '1:10', '20:0', '1:1', '180:0', '1:1', '120:0'] },
  { name: 'koikoi', sequence: [...gameSelect, '1:80', '20:0', '1:1', '180:0', '1:1', '120:0'] },
  ...[['hanamatch', 1, true], ['speed', 2, false], ['daifugo', 2, true], ['memory', 3, false], ['poker', 3, true]].map(([name, row, right]) => ({
    name,
    sequence: [...gameSelect, ...Array.from({ length: row }, () => ['1:80', '20:0']).flat(), ...(right ? ['1:10', '20:0'] : []), '1:1', '180:0', '1:1', '120:0'],
  })),
];
const gameCases = cases.filter(testCase => ['mahjong-next', 'sanma', 'koikoi', 'hanamatch', 'speed', 'daifugo', 'memory', 'poker'].includes(testCase.name));
const daifugoRules = gameCases.find(testCase => testCase.name === 'daifugo').sequence;
for (const page of [2, 3]) {
  const name = `daifugo-page${page}`;
  const sequence = [...daifugoRules, ...Array.from({ length: page - 1 }, () => ['1:100', '60:0']).flat()];
  cases.push(
    { name, sequence },
    { name: `${name}-changed`, validationCapture: name, sequence: [...sequence, '1:10', '20:0', '1:80', '20:0', '1:10', '60:0'] },
  );
}
const sanmaRules = gameCases.find(testCase => testCase.name === 'sanma').sequence;
const speedRules = gameCases.find(testCase => testCase.name === 'speed').sequence;
cases.push(
  { name: 'sanma-dealt', validationCapture: 'mahjong-dealt', sequence: [...sanmaRules, '1:1', '600:0', '1:2', '1200:0'] },
  { name: 'sanma-pause', validationCapture: 'mahjong-pause', sequence: [...sanmaRules, '1:1', '600:0', '1:8', '60:0'] },
  { name: 'speed-pause', validationCapture: 'mahjong-pause', sequence: [...speedRules, '1:1', '600:0', '1:8', '60:0'] },
);
for (const testCase of gameCases.filter(testCase => ['mahjong-next', 'sanma', 'speed', 'poker'].includes(testCase.name))) {
  cases.push({ name: `${testCase.name}-opening`, validationCapture: testCase.name === 'sanma' ? 'mahjong-next-opening' : undefined, sequence: [...testCase.sequence, '1:1', '600:0'] });
}

function capture(rom, name, sequence) {
  const log = openSync(`work/${name}.log`, 'w');
  try {
    execFileSync('work/capture', [rom, `work/${name}`, ...sequence], { stdio: ['ignore', log, log] });
  } finally {
    closeSync(log);
  }
  const pixels = execFileSync('ffmpeg', ['-v', 'error', '-i', `work/${name}.png`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
  assert.equal(pixels.length, 240 * 160 * 3);
  const colors = new Set();
  for (let offset = 0; offset < pixels.length; offset += 3) colors.add(pixels.readUIntBE(offset, 3));
  assert(colors.size > 8, `Blank or invalid capture: ${name}`);
}

function applySkipGeometry(oam, name) {
  if (!['mahjong-next-opening', 'sanma-opening', 'mahjong-resume'].includes(name)) return;
  const changes = [
    { tile: 546, first: 0x8088, second: 0x00e0, patchedFirst: 0x0088, patchedSecond: 0x40c4, patchedTile: 546 },
    { tile: 548, first: 0x4090, second: 0x40c0, patchedFirst: 0x8088, patchedSecond: 0x00d4, patchedTile: 550 },
  ];
  for (const change of changes) {
    let matches = 0;
    for (let offset = 0; offset < oam.length; offset += 8) {
      const tile = oam.readUInt16LE(offset + 4);
      if ((tile & 1023) !== change.tile) continue;
      assert.equal(oam.readUInt16LE(offset), change.first, `Unexpected skip position: ${name}`);
      assert.equal(oam.readUInt16LE(offset + 2), change.second, `Unexpected skip dimensions: ${name}`);
      oam.writeUInt16LE(change.patchedFirst, offset);
      oam.writeUInt16LE(change.patchedSecond, offset + 2);
      oam.writeUInt16LE((tile & ~1023) | change.patchedTile, offset + 4);
      matches++;
    }
    assert.equal(matches, 1, `Missing skip sprite: ${name}`);
  }
}

for (const testCase of cases) {
  capture(sourceArchive, testCase.name, testCase.sequence);
  console.log(`Captured original ${testCase.name}`);
}
execFileSync(process.execPath, ['tools/localize.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/check-retry.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/check-results-layout.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/check-background-layouts.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/check-poker.mjs', '--capture'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/check-daifugo.mjs', '--capture'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/check-flower.mjs'], { stdio: 'inherit' });
const patchedPath = 'work/isseki-hatchou-zh-hant-preview.gba';
const patched = readFileSync(patchedPath);
const report = JSON.parse(readFileSync('dist/report.json', 'utf8'));
checkBubbleText(patched, report);
function verifyLoadedBackgrounds(originalName, patchedName) {
  const original = readFileSync(`work/${originalName}.vram`);
  const current = readFileSync(`work/${patchedName}.vram`);
  const source = loadRom();
  for (const page of report.backgroundLayoutValidation) {
    if (page.graphicsBase === undefined) continue;
    const graphics = decompressLz77(source, page.graphics).data;
    if (!original.subarray(page.graphicsBase, page.graphicsBase + graphics.length).equals(graphics)) continue;
    const resource = report.resourceChanges.find(entry => entry.offset === page.graphics);
    const expected = decompressLz77(patched, resource.target).data;
    assert.deepEqual(current.subarray(page.graphicsBase, page.graphicsBase + expected.length), expected, `Preloaded background mismatch: ${patchedName}`);
    const map = decompressLz77(source, page.map).data;
    const mapResource = report.resourceChanges.find(entry => entry.offset === page.map);
    const updatedMap = decompressLz77(patched, mapResource.target).data;
    const columns = map.readUInt16LE(0), rows = map.readUInt16LE(2);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const location = page.mapBase + row * 64 + column * 2;
        const cell = 4 + (row * columns + column) * 2;
        assert.equal(original.readUInt16LE(location), map.readUInt16LE(cell) + page.tileBias, 'Unexpected preloaded map layout');
        assert.equal(current.readUInt16LE(location), updatedMap.readUInt16LE(cell) + page.tileBias, `Preloaded map mismatch: ${patchedName}`);
      }
    }
  }
}
const mainActionGraphics = decompressLz77(patched, report.resourceChanges.find(resource => resource.offset === 0x12dd4c).target).data;
const extraActionGraphics = decompressLz77(patched, report.actionTextGraphics.target).data;
for (const [text, tile, width] of [['吃', 614, 16], ['碰', 608, 16], ['槓', 618, 16], ['立直', 984, 32], ['自摸', 992, 32], ['榮和', 1000, 32]]) {
  const expected = execFileSync('magick', ['-background', 'black', '-fill', 'white', '-font', 'assets/Silver.ttf', '-pointsize', '19', '+antialias', `label:${text}`, '-trim', '+repage', '-gravity', 'west', '-extent', `${width}x16`, '-colorspace', 'Gray', '-depth', '8', 'gray:-']);
  const data = tile >= 984 ? extraActionGraphics : mainActionGraphics;
  const baseTile = tile >= 984 ? 984 : 512;
  for (let row = 0; row < 16; row++) {
    for (let column = 0; column < width; column++) {
      const offset = (tile - baseTile + Math.floor(row / 8) * (width / 8) + Math.floor(column / 8)) * 32 + (row % 8) * 4 + Math.floor((column % 8) / 2);
      assert.equal((data[offset] >> ((column % 2) * 4)) & 15, expected[row * width + column] > 127 ? report.actionTextColors.index : 0, `Action font size/alignment mismatch: ${text} at ${column},${row}`);
    }
  }
}
console.log('Verified all six popup actions: identical 12-pixel Silver size and left alignment');
const originalResults = decompressLz77(loadRom(), report.resultsFontValidation.graphics).data;
const resultsResource = report.resourceChanges.find(resource => resource.offset === report.resultsFontValidation.graphics);
const silverResults = decompressLz77(patched, resultsResource.target).data;
assert.equal(silverResults.length, originalResults.length);
assert.equal(report.resultsFontValidation.glyphChanges.length, 106);
assert.equal(report.resultsFontValidation.smallDigits.length, 10);
assert.deepEqual(silverResults.subarray(106 * 128, 108 * 128), originalResults.subarray(106 * 128, 108 * 128), 'Results stick icons changed');
for (const rank of report.resultsFontValidation.ranks) {
  const resource = report.resourceChanges.find(entry => entry.offset === rank.graphics);
  assert.equal(decompressLz77(patched, resource.target).data.length, [...rank.glyphs].length * 512);
}
console.log('Verified Silver results allocations: 106 glyphs, ten small digits, five rank banners; stick icons preserved');
for (const testCase of cases) {
  const name = `${testCase.name}-zh`;
  capture(patchedPath, name, testCase.sequence);
  if (testCase.sequence.some(step => step.startsWith('watch:'))) {
    const matches = captureName => [...readFileSync(`work/${captureName}.log`, 'utf8').matchAll(/Matched tile (\d+) after (\d+) frames/g)].map(match => match[0]);
    const originalMatches = matches(testCase.name);
    assert.equal(originalMatches.length, testCase.sequence.filter(step => step.startsWith('watch:')).length);
    assert.deepEqual(matches(name), originalMatches, `Action timing changed: ${name}`);
  }
  const vram = readFileSync(`work/${name}.vram`);
  verifyLoadedBackgrounds(testCase.name, name);
  const validations = report.validation.filter(entry => entry.capture === testCase.name || entry.capture === testCase.validationCapture);
  assert(validations.length > 0, `Missing graphics validation for ${name}`);
  for (const validation of validations) {
    const resource = report.resourceChanges.find(entry => entry.offset === validation.graphics);
    const expected = decompressLz77(patched, resource.target).data;
    assert(vram.subarray(validation.graphicsBase, validation.graphicsBase + expected.length).equals(expected), `BIOS VRAM decompression mismatch: ${name}`);
    if (validation.map !== undefined) {
      const mapResource = report.resourceChanges.find(entry => entry.offset === validation.map);
      const tileMap = decompressLz77(patched, mapResource.target).data;
      const columns = tileMap.readUInt16LE(0);
      const rows = tileMap.readUInt16LE(2);
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          assert.equal(vram.readUInt16LE(validation.mapBase + row * 64 + column * 2), tileMap.readUInt16LE(4 + (row * columns + column) * 2) + validation.tileBias, `Tilemap mismatch: ${name}`);
        }
      }
    }
  }
  assert(expectedActionPalette(readFileSync(`work/${testCase.name}.palette`), report).equals(readFileSync(`work/${name}.palette`)), `Palette behavior changed: ${name}`);
  if (validations.some(validation => validation.graphics === 0x12dd4c)) {
    const extra = report.actionTextGraphics;
    const expected = decompressLz77(patched, extra.target).data;
    assert.equal(expected.length, 768);
    assert(vram.subarray(extra.graphicsBase, extra.graphicsBase + expected.length).equals(expected), `Action text VRAM mismatch: ${name}`);
  }
  const expectedOam = readFileSync(`work/${testCase.name}.oam`);
  const actualOam = readFileSync(`work/${name}.oam`);
  if (testCase.actionTile) {
    const [originalTile, patchedTile] = testCase.actionTile;
    let matches = 0;
    for (let offset = 0; offset < expectedOam.length; offset += 8) {
      const tile = expectedOam.readUInt16LE(offset + 4);
      if ((tile & 1023) !== originalTile) continue;
      const first = expectedOam.readUInt16LE(offset), second = expectedOam.readUInt16LE(offset + 2);
      assert.equal(first & 0xc000, 0);
      assert.equal(second & 0xc000, 0x4000);
      expectedOam.writeUInt16LE(first | 0x4000, offset);
      expectedOam.writeUInt16LE((second & 0x3fff) | 0x8000, offset + 2);
      expectedOam.writeUInt16LE((tile & ~1023) | patchedTile, offset + 4);
      matches++;
    }
    assert.equal(matches, 1, `Missing enlarged action sprite: ${name}`);
  }
  if (testCase.oamRemap) {
    const [originalTile, patchedTile] = testCase.oamRemap;
    let remapped = 0;
    for (let offset = 4; offset < expectedOam.length; offset += 8) {
      const value = expectedOam.readUInt16LE(offset);
      if ((value & 1023) !== originalTile) continue;
      expectedOam.writeUInt16LE((value & ~1023) | patchedTile, offset);
      remapped++;
    }
    assert.equal(remapped, 1, `Missing shared glyph remap: ${name}`);
  }
  applySkipGeometry(expectedOam, testCase.name);
  assert(expectedOam.equals(actualOam), `Sprite placement changed: ${name}`);
  if (testCase.displayOnly) {
    const visibleTiles = [];
    for (let offset = 0; offset < actualOam.length; offset += 8) {
      const first = actualOam.readUInt16LE(offset), second = actualOam.readUInt16LE(offset + 2);
      if ((first & 0x300) !== 0x200 && (first & 255) < 160 && (second & 511) < 240) visibleTiles.push(actualOam.readUInt16LE(offset + 4) & 1023);
    }
    assert(visibleTiles.includes(testCase.expectedTile), `Wrong display fixture: ${name}`);
    assert(readFileSync(`work/${name}.log`, 'utf8').includes('not natural gameplay'));
  }
  console.log(`Verified ${name}: graphics, tilemaps, palette, sprite placement, nonblank screenshot`);
}
for (const testCase of gameCases) {
  for (const [state, steps] of [
    ['changed', ['1:10', '20:0', '1:80', '20:0', '1:10', '60:0']],
    ['opening', ['1:1', '600:0']],
  ]) {
    const name = `${testCase.name}-${state}`;
    const sequence = [...testCase.sequence, ...steps];
    capture(sourceArchive, name, sequence);
    capture(patchedPath, `${name}-zh`, sequence);
    verifyLoadedBackgrounds(name, `${name}-zh`);
    for (const suffix of ['palette', 'oam']) {
      const original = readFileSync(`work/${name}.${suffix}`);
      const expected = suffix === 'palette' ? expectedActionPalette(original, report) : original;
      if (suffix === 'oam') applySkipGeometry(expected, name);
      assert(expected.equals(readFileSync(`work/${name}-zh.${suffix}`)), `${state} behavior changed: ${testCase.name} ${suffix}`);
    }
    console.log(`Verified ${testCase.name} ${state}: nonblank capture, expected palette and sprite layout`);
  }
}
report.verifiedScreens = cases.filter(testCase => !testCase.displayOnly).map(testCase => testCase.name);
report.verifiedDisplayFixtures = displayFixtures.map(testCase => testCase.name);
report.verifiedOptionChanges = gameCases.map(testCase => testCase.name);
report.mahjongValidation = {
  focus: 'mahjong-first',
  states: cases.filter(testCase => !testCase.displayOnly && (testCase.name.startsWith('mahjong-') || testCase.name.startsWith('sanma-'))).map(testCase => testCase.name),
  roundCoverage: 'One naturally played exhaustive draw, score screen, and next hand; chi and pon confirmation/cancellation, pause/resume, rule inspection, and abort-to-rules. Pon is reached without memory injection; original/patched event timing is identical.',
  displayCoverage: 'Kan, riichi, tsumo, and ron prompt/announcement graphics plus eight speech-bubble notices at all four seats, rendered by the original engine using an emulator-only animation-pointer override. These are not naturally reached actions or winning hands. Bubble fixtures select the text keyframe and reset the display origin only.',
  remaining: ['natural kan/riichi/ron/tsumo action and confirm/cancel paths', 'winning-hand yaku and payment screens', 'tenpai/noten notices', 'complete match and multiplayer'],
};
report.gameplaySmokeTest = { games: gameCases.map(testCase => testCase.name), framesAfterConfirm: 600, scope: 'opening screen or animation only; not a full match or hardware test' };
writeFileSync('dist/report.json', JSON.stringify(report, null, 2) + '\n');
console.log(`Partial preview build: ${report.verifiedScreens.length} screen paths and ${displayFixtures.length} display-only fixtures passed. Full localization is not complete.`);