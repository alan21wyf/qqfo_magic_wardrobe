const test = require('node:test');
const assert = require('node:assert/strict');
const { DRAGON_TIERS, BAZHE_TIERS, getDragonTier, getBazheTier } = require('../miniprogram/domain/equipmentEffects');
const { newDraft, validateDraft, normalizeEquipment, decorateDraft } = require('../miniprogram/domain/equipment');
const { calculate } = require('../miniprogram/domain/calculator');
const { parseEquipmentOcr } = require('../miniprogram/domain/equipmentOcr');
const { createProfileRepository } = require('../miniprogram/services/profileRepository');
let definition;
global.Page = (value) => { definition = value; };
require('../miniprogram/pages/buildpreview/index');
delete global.Page;

const base = { minAttack: 60, maxAttack: 80, magicAttack: 57, defense: 20, hit: 30,
  magicDefense: 25, strength: 100, wisdom: 100, constitution: 100, agility: 100, spirit: 100, dexterity: 40 };
function item(slot, effects = {}, values = {}) {
  const draft = newDraft(slot);
  Object.assign(draft.effects, effects);
  draft.sections[0].fields = Object.entries(values).map(([key, value]) => ({ key, value: String(value) }));
  const value = validateDraft(draft);
  assert.ok(value, slot);
  return value;
}
const badge = () => item('badge1', {}, { strength: 100, wisdom: 100, constitution: 100,
  agility: 100, spirit: 100, dexterity: 10 });
function fixture(equipment = {}) {
  let saved = { schemaVersion: 1, profiles: { swordsman: { baseStats: base, equipment } } };
  const repository = createProfileRepository({
    getStorageSync() { return structuredClone(saved); },
    setStorageSync(key, value) { saved = structuredClone(value); },
  });
  const page = Object.assign({}, definition, { data: structuredClone(definition.data),
    profiles: structuredClone(saved.profiles), repository,
    setData(value, callback) { Object.assign(this.data, value); if (callback) callback(); } });
  page.data.loading = false;
  page.showProfession('swordsman');
  return { page, saved: () => structuredClone(saved) };
}
const event = (key, value) => ({ currentTarget: { dataset: { key } }, detail: { value } });
const select = (page, options, key, handler) => page[handler](event('', String(page.data[options].findIndex((x) => x.key === key))));
async function withWx(api, action) {
  const previous = global.wx;
  global.wx = Object.assign({ showToast() {} }, api);
  try { await action(); } finally { if (previous === undefined) delete global.wx; else global.wx = previous; }
}

test('dragon tiers apply 2/4/6/9/15 percent to the whole build including badge, excluding dexterity', () => {
  const expected = [
    ['qianlong', '潜龙出海', 2, 204, 1836], ['jianlong', '见龙在田', 4, 208, 1872],
    ['baiwei', '神龙摆尾', 6, 212, 1908], ['dragon', '龙啸九天', 9, 218, 1962],
    ['divine', '龙啸九天*神', 15, 230, 2070],
  ];
  for (const [key, name, percent, core, hp] of expected) {
    assert.deepEqual(DRAGON_TIERS.find((x) => x.key === key), { key, name, percent, hp: 0, label: name + '（' + percent + '%）' });
    const stats = calculate(base, { necklace: item('necklace', { dragonTier: key }), badge1: badge() }, 'swordsman');
    for (const field of ['strength', 'wisdom', 'constitution', 'agility', 'spirit']) assert.equal(stats[field], core, key + field);
    assert.equal(stats.dexterity, 50, key);
    assert.equal(stats.hp, hp, key);
    assert.equal(stats.magicAttack, 7 + core / 2, key);
  }
});

test('bazhe tiers boost only naked five stats and only +10 retains the fixed 1000 life', () => {
  for (const [key, percent, core, hp] of [
    ['jiaolong', 2, 202, 1818], ['longteng', 4, 204, 1836], ['zhanlong', 6, 206, 1854],
    ['bazhe', 8, 208, 1872], ['bazhe10', 10, 210, 2890],
  ]) {
    assert.equal(BAZHE_TIERS.find((x) => x.key === key).percent, percent);
    const stats = calculate(base, { face: item('face', { bazheTier: key }), badge1: badge() }, 'swordsman');
    for (const field of ['strength', 'wisdom', 'constitution', 'agility', 'spirit']) assert.equal(stats[field], core, key + field);
    assert.equal(stats.dexterity, 50, key);
    assert.equal(stats.hp, hp, key);
  }
});

test('lower dragon and bazhe tiers combine with dark might and life soul in the original layers', () => {
  const ring = item('ring', {}, { hp: 100 }); ring.souls.hp = 20;
  const equipment = { badge1: badge(), ring, necklace: item('necklace', { dragonTier: 'baiwei' }),
    face: item('face', { bazheTier: 'longteng' }), weapon: item('weapon', { darkMight: true }) };
  const low = calculate(base, equipment, 'swordsman');
  assert.equal(low.strength, 903); // (100 + 4 naked + 100 gear + 460) * 1.36
  assert.equal(low.constitution, 277);
  assert.equal(low.hp, 3112); // R((277 integer constitution * 9 + 100) * 1.2)
  equipment.face = item('face', { bazheTier: 'bazhe10' });
  assert.equal(calculate(base, equipment, 'swordsman').hp, 4830); // F(285.6) = 285; R((285 * 9 + 100 + 1360) * 1.2)
});

test('legacy booleans retain their top tiers, explicit none wins and invalid tiers cannot be saved', () => {
  const legacyNecklace = item('necklace', { dragon: true });
  const legacyFace = item('face', { bazhe10: true });
  assert.equal(getDragonTier(normalizeEquipment('necklace', legacyNecklace).effects).key, 'divine');
  assert.equal(getBazheTier(normalizeEquipment('face', legacyFace).effects).key, 'bazhe10');
  const old = calculate(base, { necklace: legacyNecklace, face: legacyFace }, 'swordsman');
  const current = calculate(base, { necklace: item('necklace', { dragonTier: 'divine' }), face: item('face', { bazheTier: 'bazhe10' }) }, 'swordsman');
  assert.deepEqual(current, old);
  const none = item('necklace', { dragon: true, dragonTier: 'none' }, { wisdom: 10 });
  assert.equal(calculate(base, { necklace: none }, 'swordsman').wisdom, 110);
  for (const [slot, effect] of [['necklace', { dragonTier: 'unknown' }], ['face', { bazheTier: 'unknown' }]]) {
    const draft = newDraft(slot); Object.assign(draft.effects, effect);
    assert.equal(validateDraft(draft), null);
  }
  const misplaced = item('boots', { dragonTier: 'divine', bazheTier: 'bazhe10' }, { wisdom: 1 });
  assert.equal(calculate(base, { boots: misplaced }, 'swordsman').wisdom, 101);
});

test('all five face tiers exclude spirit transform while retaining spirit and costume', () => {
  for (const tier of BAZHE_TIERS.slice(1)) {
    const draft = newDraft('face');
    draft.effects.bazheTier = tier.key;
    for (const section of draft.sections) {
      section.enabled = true;
      section.fields = [{ key: section.key === 'spiritTransform' ? 'magicAttack' : 'wisdom', value: '10' }];
    }
    const result = validateDraft(draft);
    assert.equal(result.sections.spiritTransform.enabled, false, tier.key);
    assert.equal(result.sections.spirit.enabled, true, tier.key);
    assert.equal(result.sections.appearance.enabled, true, tier.key);
    assert.equal(decorateDraft(draft).find((s) => s.key === 'spiritTransform').disabledByBazhe, true, tier.key);
  }
});

test('dropdown changes preview immediately, keep old data until save, and restore the selected tier', async () => {
  const { page, saved } = fixture({ badge1: badge(), necklace: item('necklace', { dragon: true }) });
  page.selectEquipment(event('necklace'));
  assert.equal(page.data.dragonOptions[page.data.dragonIndex].key, 'divine');
  select(page, 'dragonOptions', 'baiwei', 'chooseDragonTier');
  assert.equal(page.data.equipmentAllImpactRows.find((r) => r.key === 'wisdom').after, 212);
  assert.equal(page.data.equipmentCanSave, true);
  assert.equal(saved().profiles.swordsman.equipment.necklace.effects.dragon, true);
  await withWx({}, async () => {
    await page.confirmEquipment();
    assert.equal(saved().profiles.swordsman.equipment.necklace.effects.dragonTier, 'baiwei');
    const restored = fixture(saved().profiles.swordsman.equipment).page;
    restored.selectEquipment(event('necklace'));
    assert.equal(restored.data.dragonOptions[restored.data.dragonIndex].key, 'baiwei');
    select(restored, 'dragonOptions', 'qianlong', 'chooseDragonTier');
    assert.equal(restored.data.equipmentAllImpactRows.find((r) => r.key === 'wisdom').after, 204);
    restored.closeEquipmentDialog();
    restored.selectEquipment(event('necklace'));
    assert.equal(restored.data.dragonOptions[restored.data.dragonIndex].key, 'baiwei');
  });
});

test('face dropdown switches all tiers and spirit transform, preserving the draft fields', async () => {
  const draft = newDraft('face');
  draft.effects.bazhe10 = true;
  draft.sections[0].fields = [{ key: 'wisdom', value: '10' }];
  const face = validateDraft(draft);
  face.sections.spiritTransform = { enabled: false, values: { magicAttack: 500 } };
  const { page, saved } = fixture({ face });
  page.selectEquipment(event('face'));
  assert.equal(page.data.faceOptions[page.data.faceIndex].key, 'bazhe10');
  select(page, 'faceOptions', 'longteng', 'chooseFaceMode');
  assert.equal(page.data.equipmentAllImpactRows.find((r) => r.key === 'wisdom').after, 114);
  assert.equal(page.data.equipmentAllImpactRows.find((r) => r.key === 'hp').after, 936);
  assert.equal(page.data.equipmentSections.find((s) => s.key === 'spiritTransform').disabledByBazhe, true);
  select(page, 'faceOptions', 'spiritTransform', 'chooseFaceMode');
  assert.equal(page.data.equipmentAllImpactRows.find((r) => r.key === 'magicAttack').after, 562);
  select(page, 'faceOptions', 'jiaolong', 'chooseFaceMode');
  assert.equal(page.equipmentDraft.sections.find((s) => s.key === 'spiritTransform').fields[0].value, '500');
  await withWx({}, async () => {
    await page.confirmEquipment();
    const restored = fixture(saved().profiles.swordsman.equipment).page;
    restored.selectEquipment(event('face'));
    assert.equal(restored.data.faceOptions[restored.data.faceIndex].key, 'jiaolong');
    assert.equal(restored.data.bazheDescription, '五项裸装属性 +2%');
  });
});

test('OCR selects every tier by name and skips its fixed effect lines rather than duplicating stats', () => {
  for (const [slot, options, field] of [['necklace', DRAGON_TIERS, 'dragonTier'], ['face', BAZHE_TIERS, 'bazheTier']]) {
    for (const tier of options.slice(1)) {
      const parsed = parseEquipmentOcr('变装：' + tier.name + '\n力量+' + tier.percent + '%\n最大生命+1000', slot);
      assert.equal(parsed.effects[field], tier.key, tier.name);
      assert.deepEqual(parsed.sections.body, {}, tier.name);
      const { page } = fixture();
      page.selectEquipment(event(slot));
      page.applyRecognizedEquipment(parsed);
      assert.equal(page.data.equipmentCanSave, true, tier.name);
      assert.equal(page.equipmentDraft.effects[field], tier.key, tier.name);
    }
  }
  assert.equal(parseEquipmentOcr('变装：龙啸九天·神', 'necklace').effects.dragonTier, 'divine');
  assert.equal(parseEquipmentOcr('变装：龙啸九天', 'necklace').effects.dragonTier, 'dragon');
  assert.equal(parseEquipmentOcr('变装：霸者神龙', 'face').effects.bazheTier, 'bazhe');
  assert.equal(parseEquipmentOcr('变装：霸者神龙+10', 'necklace').effects.bazhe10, false);
});

test('re-recognition replaces a previous higher tier and inactive gear removes all tier bonuses', async () => {
  const { page } = fixture({ necklace: item('necklace', { dragon: true }), face: item('face', { bazhe10: true }) });
  page.selectEquipment(event('necklace'));
  page.applyRecognizedEquipment(parseEquipmentOcr('变装：潜龙出海\n力量+2%', 'necklace'));
  assert.equal(page.data.equipmentAllImpactRows.find((r) => r.key === 'wisdom').after, 112);
  await withWx({}, async () => {
    await page.confirmEquipment();
    page.data.equipmentMode = 'takeoff';
    await page.selectEquipment(event('necklace'));
    assert.equal(page.data.coreRows.flatMap((r) => r.cells).find((r) => r.key === 'wisdom').value, 110);
    await page.selectEquipment(event('necklace'));
    assert.equal(page.data.coreRows.flatMap((r) => r.cells).find((r) => r.key === 'wisdom').value, 112);
  });
});

test('upload containing only a lower-tier effect is recognized as valid equipment', async () => {
  for (const [slot, name, field, key] of [
    ['necklace', '潜龙出海', 'dragonTier', 'qianlong'], ['face', '龙腾虎跃', 'bazheTier', 'longteng'],
  ]) {
    const { page } = fixture();
    page.selectEquipment(event(slot));
    let receive;
    await withWx({
      chooseImage(options) { options.success({ tempFilePaths: ['/effect.png'] }); },
      createOffscreenCanvas() {
        return {
          getContext() { return { drawImage() {}, getImageData() { return { data: new Uint8Array(16) }; } }; },
          createImage() {
            const image = { width: 2, height: 2 };
            Object.defineProperty(image, 'src', { set() { queueMicrotask(() => image.onload()); } });
            return image;
          },
        };
      },
      createVKSession() {
        return { on(event, callback) { receive = callback; }, start(callback) { callback(null); },
          runOCR() { queueMicrotask(() => receive([{ text: '变装：' + name }])); }, stop() {}, destroy() {} };
      },
    }, async () => {
      await page.uploadEquipmentImage();
      assert.equal(page.data.recognizing, false);
      assert.equal(page.data.recognitionReview, true);
      assert.equal(page.data.equipmentCanSave, true);
      assert.equal(page.equipmentDraft.effects[field], key);
    });
  }
});
