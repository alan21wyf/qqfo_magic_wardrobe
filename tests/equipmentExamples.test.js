const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { UPLOAD_IMAGE_GUIDANCE, getEquipmentExample } = require('../miniprogram/domain/equipmentExamples');
const { createEquipmentStandardPage } = require('../miniprogram/pages/buildpreview/equipmentStandard');
const { STAT_FIELDS } = require('../miniprogram/domain/profile');
const root = path.resolve(__dirname, '../miniprogram');
const originals = [
  ['helmet', 'armor', 618, 681, '54dd60883a720f48a49c285a19e474556ca13cf5a1ace7c1658f0670116c2a83'],
  ['gloves', 'accessories', 612, 687, 'dd161f6ec8d6c810b85dec734de6d9ae726e1a3c52c70e2c839bb6ab5f1154c4'],
  ['robe', 'armor', 615, 708, '0a06117e2ce5d45ca4e0e9c4def7a439184cb6e53284f514f0e6f425117e2af6'],
  ['boots', 'armor', 549, 717, '34fa14b98886366e33f8f2a6ecbabe5fd4662b1d433b9fdeeba7fb8a80b27be6'],
  ['weapon', 'gear', 558, 687, '65bbc3355a8a866db1e2314cd0c55994280a94d6110909e74dd692f48e8212ba'],
  ['face', 'accessories', 618, 720, '1158da00a55b4f6c8d70ed5f42f585cfbcd270f30d56e6788aa331aa5208d440'],
  ['necklace', 'gear', 563, 675, '2a914cf3539e6e241d637dd585eca460d34b59451f26594b3ce77ba82b35fa5a'],
  ['backpack', 'gear', 636, 696, '80a4ff0fee3b611d54f44b7237511450cfe8656a624ebd36a29e8f5015961b9f'],
  ['ring', 'accessories', 579, 687, '8bb831ab402d54351c6025a74358ed5af48bd8e0ffc889630204d55b880a2c43'],
];
let definition;
global.Page = (value) => { definition = value; };
require('../miniprogram/pages/buildpreview/index');
delete global.Page;
function fixture(slot) {
  const baseStats = Object.fromEntries(STAT_FIELDS.map((s) => [s.key, 100]));
  const page = Object.assign({}, definition, { data: structuredClone(definition.data),
    profiles: { swordsman: { baseStats } }, setData(value) { Object.assign(this.data, value); } });
  page.data.loading = false;
  page.showProfession('swordsman');
  page.selectEquipment({ currentTarget: { dataset: { key: slot } } });
  page.equipmentDraft.sections[0].fields = [{ key: 'wisdom', value: '152' }];
  page.updateEquipmentEditor();
  return page;
}
function viewer(group, slot) {
  const page = createEquipmentStandardPage(group);
  page.setData = (value) => Object.assign(page.data, value);
  page.onLoad({ slot });
  return page;
}
async function withWx(api, action) {
  const previous = global.wx;
  global.wx = api;
  try { await action(); } finally { if (previous === undefined) delete global.wx; else global.wx = previous; }
}

test('nine slot examples keep the original PNG bytes and dimensions', () => {
  for (const [slot, group, width, height, hash] of originals) {
    const example = getEquipmentExample(slot);
    assert.equal(example.group, group, slot);
    const bytes = fs.readFileSync(path.join(root, example.src));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), width, slot);
    assert.equal(bytes.readUInt32BE(20), height, slot);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), hash, slot);
  }
});

test('opening the standard routes to this slot only and preserves the editable draft on return', async () => {
  for (const [slot] of originals) {
    const page = fixture(slot), draft = page.equipmentDraft;
    const before = structuredClone(draft), profile = structuredClone(page.profiles);
    await withWx({ navigateTo(options) {
      assert.equal(options.url, getEquipmentExample(slot).page + '?slot=' + slot);
      options.complete();
    } }, async () => {
      page.openEquipmentHelp();
      page.onShow();
      assert.equal(page.data.equipmentOpen, true);
      assert.equal(page.data.equipmentHelpOpen, false);
      assert.equal(page.equipmentDraft, draft);
      assert.deepEqual(page.equipmentDraft, before);
      assert.deepEqual(page.profiles, profile);
    });
  }
});

test('unprovided badge artifact and shield examples show only the preserved guidance', async () => {
  assert.equal(UPLOAD_IMAGE_GUIDANCE, '使用原始清晰截图，避免遮挡数字、红圈覆盖文字或只截一列。识别后的内容可以修改，无法确定的变装来源会请你选择。');
  for (const slot of ['badge1', 'badge6', 'artifact', 'shield']) {
    assert.equal(getEquipmentExample(slot), null);
    const page = fixture(slot);
    await withWx({ navigateTo() { assert.fail('No replacement image for ' + slot); } }, async () => {
      page.openEquipmentHelp();
      assert.equal(page.data.equipmentHelpOpen, true);
      assert.equal(page.data.uploadImageGuidance, UPLOAD_IMAGE_GUIDANCE);
      page.closeEquipmentHelp();
      assert.equal(page.data.equipmentHelpOpen, false);
      assert.equal(page.equipmentDraft.sections[0].fields[0].value, '152');
    });
  }
});

test('standard page validates its own package and opens only the full current image for zoom', async () => {
  for (const [slot, group] of originals) {
    const page = viewer(group, slot);
    assert.equal(page.data.exampleImage, getEquipmentExample(slot).src);
    assert.equal(page.data.uploadImageGuidance, UPLOAD_IMAGE_GUIDANCE);
    await withWx({ previewImage(options) {
      assert.equal(options.current, getEquipmentExample(slot).src);
      assert.deepEqual(options.urls, [getEquipmentExample(slot).src]);
    } }, async () => page.previewExampleImage());
  }
  assert.equal(viewer('armor', 'ring').data.exampleImage, '');
  assert.equal(viewer('armor', '../ring').data.exampleImage, '');
  assert.equal(getEquipmentExample('__proto__'), null);
});

test('rapid standard taps navigate once; failure keeps draft and allows retry', async () => {
  const page = fixture('ring'), before = structuredClone(page.equipmentDraft);
  let pending, calls = 0, toasts = 0;
  await withWx({ navigateTo(options) { calls++; pending = options; }, showToast() { toasts++; } }, async () => {
    page.openEquipmentHelp(); page.openEquipmentHelp();
    assert.equal(calls, 1);
    pending.fail(); pending.complete();
    assert.equal(toasts, 1);
    assert.deepEqual(page.equipmentDraft, before);
    page.openEquipmentHelp();
    assert.equal(calls, 2);
    pending.complete();
  });
});

test('examples live in registered subpackages with conservative two-megabyte package budgets', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const packages = app.subpackages;
  const sizes = Object.fromEntries(packages.map((p) => [p.root, 0]));
  let main = 0;
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else {
        const relative = path.relative(root, file).split(path.sep).join('/');
        const pack = packages.find((p) => relative.startsWith(p.root + '/'));
        if (pack) sizes[pack.root] += fs.statSync(file).size;
        else main += fs.statSync(file).size;
      }
    }
  }
  walk(root);
  assert.ok(main < 2_000_000, 'main package exceeds budget: ' + main);
  for (const p of packages) {
    assert.ok(sizes[p.root] < 2_000_000, p.root + ' exceeds budget: ' + sizes[p.root]);
    assert.ok(p.pages.includes('index'));
    for (const extension of ['js', 'json', 'wxml', 'wxss']) assert.ok(fs.existsSync(path.join(root, p.root, 'index.' + extension)));
  }
  for (const [slot] of originals) {
    const example = getEquipmentExample(slot);
    assert.ok(packages.some((p) => example.page.startsWith('/' + p.root + '/')));
  }
});
