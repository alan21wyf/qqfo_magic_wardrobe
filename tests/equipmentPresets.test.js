const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STAT_FIELDS } = require('../miniprogram/domain/profile');
const { newDraft, validateDraft } = require('../miniprogram/domain/equipment');
const { calculate } = require('../miniprogram/domain/calculator');
const { PRESET_NOTICE, PRESET_LEVELS, getEquipmentPreset, getPresetPreview, applyPresetBodies } = require('../miniprogram/domain/equipmentPresets');
const { createProfileRepository, STORAGE_KEY } = require('../miniprogram/services/profileRepository');
const { createPreviewLayout } = require('../miniprogram/domain/previewLayout');

const base = Object.fromEntries(STAT_FIELDS.map(({ key }) => [key, 100]));
const expected = {
  helmet: { wisdom: 152, hp: 4280, magicResistance: 487 },
  gloves: { wisdom: 152, constitution: 152, magicAttack: 455, hit: 1583, damageResistance: 137 },
  robe: { wisdom: 152, hp: 2280, defense: 170, magicResistance: 300, armor: 472 },
  boots: { wisdom: 152, constitution: 152, agility: 152, defense: 102, magicResistance: 263, armor: 137 },
  weapon: { wisdom: 152, magicAttack: 1133 },
  face: { wisdom: 152, constitution: 152, agility: 152, hp: 1052, defense: 68, armor: 91 },
  necklace: { wisdom: 152, magicAttack: 150, magicResistance: 536, armor: 237 },
  backpack: { wisdom: 152, constitution: 152, agility: 152, hp: 2000, damageResistance: 91, magicResistance: 188 },
  ring: { wisdom: 152, hp: 2280, magicAttack: 554, magicResistance: 146 },
};

test('102 mage preset matches nine source bodies, combining repeated static attributes only', () => {
  const equipped = applyPresetBodies('mage', 102);
  assert.deepEqual(Object.keys(equipped).sort(), Object.keys(expected).sort());
  for (const [slot, values] of Object.entries(expected)) {
    const item = equipped[slot];
    assert.deepEqual(item.sections.body, { enabled: true, values }, slot);
    assert.equal(item.equipped, true);
    assert.deepEqual(item.souls, {});
    assert.deepEqual(item.effects, { dragon: false, bazhe10: false, darkMight: false });
    assert.deepEqual(validateDraft(newDraft(slot, item)), item, slot + ' editor round trip');
    for (const key of ['spirit', 'spiritTransform', 'appearance']) {
      if (item.sections[key]) assert.deepEqual(item.sections[key], { enabled: false, values: {} }, slot + key);
    }
  }
  assert.deepEqual(equipped.weapon.bodyReference, { damage: 197, attackSpeed: 1200, spellCritPercent: 2 });
  assert.deepEqual(equipped.boots.bodyReference, { movementSpeedPercent: 35 });
  // All nine wisdom lines total 1,368; body magic attack totals 2,292.
  const total = calculate(base, equipped, 'mage');
  assert.equal(total.wisdom, 1468);
  assert.equal(total.magicAttack, 3076);
  assert.equal(total.hp, 18264);
  assert.equal(total.hit, 1683);
  assert.equal(total.armor, 937);
  assert.equal(total.magicResistance, 1920);
  assert.equal(total.damageResistance, 228);
});

test('preview separates intrinsic and refinement values in screenshot order without unrelated white metadata', () => {
  const items = getPresetPreview('mage', 102);
  assert.equal(items.length, 9);
  assert.deepEqual(items.map((item) => item.slot), Object.keys(expected));
  const necklace = items.find((item) => item.slot === 'necklace');
  assert.deepEqual(necklace.intrinsicRows.map((row) => row.text), ['魔法攻击 150', '魔抗 341']);
  assert.deepEqual(necklace.refinementRows.slice(0, 3).map((row) => row.text), ['护甲值 +237', '魔抗 +195', '智慧 +152']);
  const weapon = items.find((item) => item.slot === 'weapon');
  assert.equal(weapon.intrinsicRows.find((row) => row.key === 'magicAttack').value, 678);
  assert.equal(weapon.refinementRows.find((row) => row.key === 'magicAttack').value, 455);
  const face = items.find((item) => item.slot === 'face');
  assert.equal(face.intrinsicRows.find((row) => row.key === 'hp').value, 1052);
  assert.equal(face.refinementRows.some((row) => row.key === 'hp'), false);
  for (const item of items) {
    assert.match(item.icon, new RegExp('/' + item.slot + '\\.jpg$'));
    assert.ok(item.refinementRows.some((row) => row.text.includes('攻击')));
    assert.equal(item.intrinsicRows.some((row) => /重量|耐久|需要等级|炼化次数/.test(row.text)), false);
  }
  assert.deepEqual(getPresetPreview('mage', 96), []);
  assert.deepEqual(getPresetPreview('healer', 102), []);
  necklace.intrinsicRows[0].value = 0;
  assert.equal(getPresetPreview('mage', 102).find((item) => item.slot === 'necklace').intrinsicRows[0].value, 150);
});

test('helmet and backpack fixed refinement life contributes once; magic damage procs do not become HP', () => {
  const preset = getEquipmentPreset('mage', 102);
  assert.equal(preset.helmet.values.hp, 4280);
  assert.equal(preset.backpack.values.hp, 2000);
  assert.equal(preset.necklace.values.hp, undefined);
  assert.equal(preset.ring.values.hp, 2280);
  for (const slot of ['helmet', 'backpack']) {
    assert.equal(preset[slot].refinement.find((row) => row.label === '血量增加').value, 2000);
  }
  const once = applyPresetBodies('mage', 102);
  const twice = applyPresetBodies('mage', 102, once);
  assert.deepEqual(twice, once);
});

test('levels are ordered 60 through 138 in six-level steps; only known mage 102 data can load', () => {
  assert.deepEqual(PRESET_LEVELS, [60, 66, 72, 78, 84, 90, 96, 102, 108, 114, 120, 126, 132, 138]);
  for (const profession of ['mage', 'healer', 'warrior', 'assassin', 'swordsman']) {
    for (const level of PRESET_LEVELS) {
      assert.equal(Boolean(getEquipmentPreset(profession, level)), profession === 'mage' && level === 102);
    }
  }
  assert.throws(() => applyPresetBodies('mage', 96), /PRESET_NOT_AVAILABLE/);
  const preset = getEquipmentPreset('mage', 102);
  preset.helmet.values.wisdom = 0;
  assert.equal(getEquipmentPreset('mage', 102).helmet.values.wisdom, 152);
});

function manualItem(slot) {
  const draft = newDraft(slot);
  draft.sections[0].fields = [{ key: 'wisdom', value: '1' }];
  for (const source of draft.sections.slice(1)) {
    source.enabled = true;
    source.fields = [{ key: source.key === 'spiritTransform' ? 'magicAttack' : 'wisdom', value: '260' }];
  }
  draft.souls = [{ key: 'magicAttack', value: '8' }];
  if (slot === 'necklace') draft.effects.dragonTier = 'divine';
  if (slot === 'face') draft.effects.bazheTier = 'bazhe10';
  if (slot === 'weapon') draft.effects.darkMight = true;
  return validateDraft(draft);
}

test('preset updates only bodies, preserves manual sources/effects and unrelated slots, and never mutates input', () => {
  const previous = Object.fromEntries(Object.keys(expected).map((slot) => [slot, manualItem(slot)]));
  previous.ring.equipped = false;
  previous.weapon.custom = 'keep';
  previous.face.sections.spiritTransform = { enabled: false, values: { magicAttack: 80 } };
  const badge = newDraft('badge1'); badge.sections[0].fields = [{ key: 'wisdom', value: '50' }];
  previous.badge1 = validateDraft(badge);
  const snapshot = structuredClone(previous);
  const loaded = applyPresetBodies('mage', 102, previous);
  for (const slot of Object.keys(expected)) {
    assert.deepEqual(loaded[slot].souls, previous[slot].souls, slot);
    assert.deepEqual(loaded[slot].effects, previous[slot].effects, slot);
    for (const source of Object.keys(previous[slot].sections).filter((key) => key !== 'body')) {
      assert.deepEqual(loaded[slot].sections[source], previous[slot].sections[source], slot + source);
    }
  }
  assert.deepEqual(loaded.badge1, previous.badge1);
  assert.equal(loaded.ring.equipped, true);
  assert.equal(loaded.weapon.custom, 'keep');
  assert.deepEqual(previous, snapshot);
  loaded.ring.sections.spirit.values.wisdom = 0;
  assert.equal(previous.ring.sections.spirit.values.wisdom, 260);
});

function storageFixture() {
  let saved = { schemaVersion: 1, profiles: {
    mage: { baseStats: base, equipment: { ring: manualItem('ring') }, custom: 'mage' },
    healer: { baseStats: base, custom: 'other' },
  } };
  let writes = 0;
  const storage = {
    getStorageSync(key) { assert.equal(key, STORAGE_KEY); return structuredClone(saved); },
    setStorageSync(key, value) { writes++; saved = structuredClone(value); },
  };
  return { storage, repository: createProfileRepository(storage), saved: () => saved, writes: () => writes };
}

test('loading a preset persists nine bodies atomically, keeps bare stats/other professions, and rejects unknown presets', async () => {
  const f = storageFixture(); const before = structuredClone(f.saved());
  const loaded = await f.repository.applyEquipmentPreset('mage', 102);
  assert.equal(f.writes(), 1);
  assert.equal(Object.keys(loaded.equipment).length, 9);
  assert.deepEqual(loaded.baseStats, before.profiles.mage.baseStats);
  assert.deepEqual(f.saved().profiles.healer, before.profiles.healer);
  assert.equal(loaded.custom, 'mage');
  assert.deepEqual(loaded.equipment.ring.souls, { magicAttack: 8 });
  await assert.rejects(f.repository.applyEquipmentPreset('mage', 96), /PRESET_NOT_AVAILABLE/);
  await assert.rejects(f.repository.applyEquipmentPreset('healer', 102), /PRESET_NOT_AVAILABLE/);
  await assert.rejects(f.repository.applyEquipmentPreset('warrior', 102), /BASE_STATS_REQUIRED/);
  assert.equal(f.writes(), 1);
});

test('storage failure cannot partially replace existing equipment', async () => {
  const f = storageFixture(); const before = structuredClone(f.saved());
  f.storage.setStorageSync = () => { throw new Error('STORAGE_FULL'); };
  await assert.rejects(f.repository.applyEquipmentPreset('mage', 102), /STORAGE_FULL/);
  assert.deepEqual(f.saved(), before);
});

let definition;
global.Page = (page) => { definition = page; };
require('../miniprogram/pages/buildpreview/index');
delete global.Page;
const event = (dataset) => ({ currentTarget: { dataset } });
function pageFixture() {
  const f = storageFixture();
  const page = Object.assign({}, definition, { data: structuredClone(definition.data),
    profiles: structuredClone(f.saved().profiles), repository: f.repository,
    setData(value) { Object.assign(this.data, value); } });
  page.data.loading = false;
  page.showProfession('mage');
  return { ...f, page };
}

test('preset dialog cancellation is read-only and blocks underlying controls; it is mage-only', () => {
  const { page, writes } = pageFixture(); const before = structuredClone(page.profiles);
  page.openEquipmentPresets();
  assert.equal(page.data.presetOpen, true);
  page.selectProfession(event({ key: 'healer' }));
  page.openBaseDialog(); page.selectEquipment(event({ key: 'ring' }));
  page.setEquipmentMode(event({ mode: 'takeoff' }));
  assert.equal(page.data.profession, 'mage');
  assert.equal(page.data.dialogOpen, false);
  assert.equal(page.data.equipmentOpen, false);
  assert.equal(page.data.equipmentMode, 'edit');
  page.closeEquipmentPresets();
  assert.deepEqual(page.profiles, before); assert.equal(writes(), 0);
  page.showProfession('healer'); page.openEquipmentPresets();
  assert.equal(page.data.presetOpen, false);
  page.showProfession('mage'); page.data.ready = false; page.openEquipmentPresets();
  assert.equal(page.data.presetOpen, false);
});

test('level selection only previews; confirmation loads once and refreshes totals and editor', async () => {
  const { page, writes } = pageFixture(); const previous = global.wx;
  global.wx = { showToast() {} };
  try {
    page.openEquipmentPresets(); await page.chooseEquipmentPreset(event({ level: 96 }));
    assert.equal(writes(), 0); assert.equal(page.data.presetOpen, true);
    await page.chooseEquipmentPreset(event({ level: '102' }));
    assert.equal(writes(), 0); assert.equal(page.data.presetStage, 'confirm');
    assert.equal(page.data.presetItems.length, 9);
    assert.equal(page.data.equippedCount, 1);
    await page.confirmEquipmentPreset();
    assert.equal(writes(), 1); assert.equal(page.data.presetOpen, false);
    assert.equal(page.data.equippedCount, 9);
    assert.equal(page.data.equipmentMode, 'edit');
    page.selectEquipment(event({ key: 'weapon' }));
    assert.equal(page.equipmentDraft.sections[0].fields.find((field) => field.key === 'magicAttack').value, '1133');
    assert.equal(page.data.bodyReferenceRows.find((field) => field.key === 'attackSpeed').value, 1200);
    page.closeEquipmentDialog();
    page.selectEquipment(event({ key: 'ring' }));
    assert.equal(page.equipmentDraft.souls[0].value, '8');
    assert.equal(page.data.equipmentCanSave, true);
  } finally { global.wx = previous; }
});

test('every preview icon opens its own tooltip; closing, returning and cancelling never save', async () => {
  const { page, writes } = pageFixture(); const before = structuredClone(page.profiles);
  await page.confirmEquipmentPreset();
  page.openEquipmentPresets(); page.chooseEquipmentPreset(event({ level: 102 }));
  for (const slot of Object.keys(expected)) {
    page.openPresetEquipment(event({ slot }));
    assert.equal(page.data.presetDetail.slot, slot);
    assert.ok(page.data.presetDetail.intrinsicRows.length);
    assert.ok(page.data.presetDetail.refinementRows.length);
    await page.confirmEquipmentPreset(); // The tooltip must be dismissed first.
    assert.equal(writes(), 0);
    page.closePresetEquipment();
  }
  page.openPresetEquipment(event({ slot: 'shield' }));
  assert.equal(page.data.presetDetail, null);
  page.backToPresetLevels();
  assert.equal(page.data.presetStage, 'levels');
  assert.equal(page.data.presetSelectedLevel, 0);
  page.chooseEquipmentPreset(event({ level: 102 }));
  page.openPresetEquipment(event({ slot: 'necklace' }));
  page.closeEquipmentPresets();
  assert.equal(page.data.presetDetail, null);
  assert.deepEqual(page.profiles, before); assert.equal(writes(), 0);
  page.openEquipmentPresets(); assert.equal(page.data.presetStage, 'levels');
});

test('repeat taps save once; pending load blocks closing/switching and failure keeps old data for retry', async () => {
  const { page } = pageFixture(); const before = structuredClone(page.profiles);
  let reject, calls = 0;
  page.repository = { applyEquipmentPreset() { calls++; return new Promise((_, fail) => { reject = fail; }); } };
  page.openEquipmentPresets();
  page.chooseEquipmentPreset(event({ level: 102 }));
  const request = page.confirmEquipmentPreset();
  await page.confirmEquipmentPreset();
  page.backToPresetLevels(); page.openPresetEquipment(event({ slot: 'ring' }));
  page.closeEquipmentPresets(); page.selectProfession(event({ key: 'healer' }));
  assert.equal(calls, 1); assert.equal(page.data.presetOpen, true);
  assert.equal(page.data.profession, 'mage');
  reject(new Error('full')); await request;
  assert.equal(page.data.equipmentBusy, false); assert.ok(page.data.presetError);
  assert.equal(page.data.presetStage, 'confirm'); assert.equal(page.data.presetItems.length, 9);
  assert.deepEqual(page.profiles, before);
});

test('five or six equal mode buttons fit short, tall, landscape and tablet screens; profession switch updates count', () => {
  for (const [windowWidth, windowHeight, safeBottom = 0] of [[320, 360], [320, 480], [375, 603], [390, 750, 34], [430, 839, 34], [844, 302, 21], [768, 900]]) {
    for (const count of [5, 6]) {
      const layout = createPreviewLayout({ windowWidth, windowHeight, screenHeight: windowHeight + 88,
        safeArea: { bottom: windowHeight + 88 - safeBottom } }, { modeCount: count });
      const m = layout.metrics;
      assert.equal(m.modeCount, count);
      assert.ok(m.modeHeight * count + m.modeGap * (count - 1) + 10 <= m.gearHeight + .001);
      assert.ok(m.modeHeight >= 20);
    }
  }
  const { page } = pageFixture(); assert.equal(page.viewportLayout.modeCount, 6);
  page.showProfession('healer'); assert.equal(page.viewportLayout.modeCount, 5);
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/buildpreview/index.wxml'), 'utf8');
  assert.match(wxml, /wx:if="\{\{profession === 'mage'\}\}" class="equipment-mode-button" bindtap="openEquipmentPresets"/);
  assert.ok(wxml.indexOf('>录入装备</button>') < wxml.indexOf('>选择预设装备</button>'));
  assert.ok(wxml.indexOf('>选择预设装备</button>') < wxml.indexOf('>取下装备</button>'));
  assert.ok(wxml.indexOf('>取下装备</button>') < wxml.indexOf('>保存当前装备</button>'));
  assert.ok(wxml.indexOf('>保存当前装备</button>') < wxml.indexOf('>分享</button>'));
  assert.ok(wxml.indexOf('>分享</button>') < wxml.indexOf('>清除装备</button>'));
  assert.equal(definition.data.presetNotice, PRESET_NOTICE);
});

test('HP and uncalibrated MP both derive from integer core values before final rounding', () => {
  const necklace = newDraft('necklace'); necklace.effects.dragon = true;
  const ring = newDraft('ring');
  ring.sections[0].fields = [{ key: 'mp', value: '0.7' }];
  ring.souls = [{ key: 'hp', value: '25' }];
  const result = calculate({ ...base, constitution: 4, spirit: 1.2 },
    { necklace: validateDraft(necklace), ring: validateDraft(ring) }, 'mage');
  // F(4 × 1.15) = 4 constitution; R(4 × 9 × 1.25) = 45 life.
  assert.equal(result.hp, 45);
  // F(1.2 × 1.15) = 1 spirit; R(1 × 9.9 + .7) = 11 estimated mana.
  assert.equal(result.mp, 11);
});
