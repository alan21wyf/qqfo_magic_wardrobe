const test = require('node:test');
const assert = require('node:assert/strict');
const { STAT_FIELDS } = require('../miniprogram/domain/profile');
const { parseEquipmentOcr } = require('../miniprogram/domain/equipmentOcr');
let definition;
global.Page = (page) => { definition = page; };
require('../miniprogram/pages/buildpreview/index');
delete global.Page;
const base = Object.fromEntries(STAT_FIELDS.map((s) => [s.key, 100]));
function fixture() {
  const page = Object.assign({}, definition, { data: structuredClone(definition.data),
    profiles: { swordsman: { baseStats: structuredClone(base) } },
    setData(values, fn) { Object.assign(this.data, values); if (fn) fn(); } });
  page.data.loading = false; page.showProfession('swordsman');
  return page;
}
const event = (dataset, value) => ({ currentTarget: { dataset }, detail: { value } });

test('equipment cannot open until bare data confirmed, and cancellation leaves persisted profile unchanged', () => {
  const page = fixture();
  page.data.ready = false; page.selectEquipment(event({ key: 'ring' }));
  assert.equal(page.data.equipmentOpen, false);
  page.data.ready = true; page.selectEquipment(event({ key: 'ring' }));
  page.applyRecognizedEquipment(parseEquipmentOcr('智慧152', 'ring'));
  assert.equal(page.data.equipmentCanSave, true);
  page.closeEquipmentDialog();
  assert.equal(page.profiles.swordsman.equipment, undefined);
});

test('face dropdown changes disable transform contribution while preserving other sources', () => {
  const page = fixture();
  page.selectEquipment(event({ key: 'face' }));
  page.applyRecognizedEquipment(parseEquipmentOcr('力量10\n灵变：测试\n魔法攻击999', 'face'));
  page.chooseFaceMode(event({}, String(page.data.faceOptions.findIndex((s) => s.key === 'bazhe10'))));
  assert.equal(page.data.faceMode, 'bazhe10');
  assert.equal(page.data.equipmentEffects.bazhe10, true);
  const section = page.data.equipmentSections.find((s) => s.key === 'spiritTransform');
  assert.equal(section.enabled, false);
  assert.equal(page.data.equipmentAllImpactRows.find((r) => r.key === 'wisdom').after, 110);
  page.chooseFaceMode(event({}, String(page.data.faceOptions.findIndex((s) => s.key === 'spiritTransform'))));
  assert.equal(page.data.equipmentEffects.bazhe10, false);
  assert.equal(page.data.equipmentAllImpactRows.find((r) => r.key === 'magicAttack').after, 1099);
});

test('OCR values update impact immediately but ambiguous sources block save until assigned', () => {
  const page = fixture();
  page.selectEquipment(event({ key: 'helmet' }));
  page.applyRecognizedEquipment(parseEquipmentOcr('智慧10\n变装：未知\n魔法攻击100', 'helmet'));
  assert.equal(page.data.recognitionReview, true);
  assert.equal(page.data.equipmentCanSave, false);
  assert.equal(page.data.ocrPending.length, 1);
  const appearanceIndex = page.data.ocrPending[0].sources.findIndex((s) => s.key === 'appearance');
  page.assignOcrSource(event({ id: page.data.ocrPending[0].id }, String(appearanceIndex)));
  assert.equal(page.data.ocrPending.length, 0);
  assert.equal(page.data.equipmentCanSave, true);
  assert.ok(page.data.equipmentImpactRows.some((r) => r.key === 'magicAttack' && r.delta > 100));
});

test('closing standards preserves draft; save failure keeps form, repeat taps save once', async () => {
  const page = fixture();
  page.selectEquipment(event({ key: 'ring' }));
  page.applyRecognizedEquipment(parseEquipmentOcr('智慧152', 'ring'));
  const previousWx = global.wx;
  global.wx = { navigateTo(options) { options.complete(); } };
  try { page.openEquipmentHelp(); page.closeEquipmentHelp(); } finally { global.wx = previousWx; }
  assert.equal(page.equipmentDraft.sections[0].fields[0].value, '152');
  let rejectSave, calls = 0;
  page.repository = { saveEquipment() {
    calls++; return new Promise((resolve, reject) => { rejectSave = reject; });
  } };
  const first = page.confirmEquipment();
  await page.confirmEquipment();
  assert.equal(calls, 1);
  rejectSave(new Error('full'));
  await first;
  assert.equal(page.data.equipmentOpen, true);
  assert.equal(page.equipmentDraft.sections[0].fields[0].value, '152');
  assert.ok(page.data.equipmentError);
});

test('successful save updates panel and reopening restores separate sources', async () => {
  const page = fixture();
  page.selectEquipment(event({ key: 'ring' }));
  page.applyRecognizedEquipment(parseEquipmentOcr('智慧152\n戒灵：\n体质260', 'ring'));
  page.repository = { async saveEquipment(profession, slot, item) {
    return { baseStats: base, equipment: { [slot]: item } };
  } };
  const previous = global.wx; global.wx = { showToast() {} };
  try { await page.confirmEquipment(); } finally { global.wx = previous; }
  assert.equal(page.data.equipmentOpen, false);
  assert.equal(page.data.equippedCount, 1);
  page.selectEquipment(event({ key: 'ring' }));
  assert.equal(page.equipmentDraft.sections[0].fields[0].value, '152');
  assert.equal(page.equipmentDraft.sections.find((s) => s.key === 'spirit').fields[0].value, '260');
});

test('late gallery callback cannot fill a different equipment editor', async () => {
  const page = fixture();
  page.selectEquipment(event({ key: 'ring' }));
  let chosen;
  const previous = global.wx;
  global.wx = { chooseImage(options) { chosen = options.success; } };
  try {
    const request = page.uploadEquipmentImage();
    page.closeEquipmentDialog();
    page.selectEquipment(event({ key: 'boots' }));
    chosen({ tempFilePaths: ['/old-ring.png'] });
    await request;
    assert.equal(page.equipmentDraft.slot, 'boots');
    assert.equal(page.data.equipmentImage, '');
    assert.equal(page.data.recognitionReview, false);
  } finally { global.wx = previous; }
});
