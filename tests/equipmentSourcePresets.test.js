const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STAT_FIELDS, BADGES, createDraft, statRows } = require('../miniprogram/domain/profile');
const { newDraft, validateDraft, normalizeEquipment, getSlot } = require('../miniprogram/domain/equipment');
const { calculate } = require('../miniprogram/domain/calculator');
const { TRANSFORM_PRESETS, RING_PRESETS, resolveSectionPreset } = require('../miniprogram/domain/equipmentSourcePresets');
const { createProfileRepository, STORAGE_KEY } = require('../miniprogram/services/profileRepository');
const { parseEquipmentOcr } = require('../miniprogram/domain/equipmentOcr');

const base = { minAttack: 25, maxAttack: 25, defense: 181, magicAttack: 1427, hit: 25,
  magicDefense: 671, strength: 50, constitution: 1387, agility: 362, wisdom: 2850, dexterity: 50, spirit: 1338 };
function selectedItem(slot, source, selection) {
  const draft = newDraft(slot);
  const section = draft.sections.find(item => item.key === source);
  section.enabled = selection.key !== 'none'; section.selection = selection;
  return validateDraft(draft);
}

test('game panel and bare form share game row order; six badges retain stable IDs with their actual names', () => {
  const order = ['minAttack', 'defense', 'maxAttack', 'hit', 'magicAttack', 'magicDefense',
    'strength', 'constitution', 'agility', 'wisdom', 'dexterity', 'spirit'];
  assert.deepEqual(STAT_FIELDS.map(item => item.key), order);
  assert.deepEqual(createDraft(base).map(item => item.key), order);
  assert.deepEqual(statRows(base, 0, 6).map(row => row.cells.map(cell => cell.key)),
    [['minAttack', 'defense'], ['maxAttack', 'hit'], ['magicAttack', 'magicDefense']]);
  assert.deepEqual(BADGES.map(item => item.label), ['英勇徽章', '信仰徽章', '忠诚徽章', '卓越徽章', '睿智徽章', '狂野徽章']);
  for (let index = 0; index < 6; index++) assert.equal(getSlot('badge' + (index + 1)).label, BADGES[index].label);
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/buildpreview/index.wxml'), 'utf8');
  const badgeRow = wxml.slice(wxml.indexOf('<view class="badges"'), wxml.indexOf('<view class="vital-stats"'));
  assert.ok(badgeRow.includes('data-key="artifact"'));
  assert.equal(wxml.slice(wxml.indexOf('<view class="preview-footer"'), wxml.indexOf('class="extra-stats"')).includes('data-key="artifact"'), false);
});

test('all ten spirit transforms carry exactly their supplied attack or life/mana pair and survive persistence', () => {
  assert.equal(TRANSFORM_PRESETS.length, 10);
  for (const [tier, attack, magic, life] of [
    ['900',80,100,800], ['1000',80,100,1000], ['270',130,150,1200], ['gold',220,250,2500], ['285',180,200,2000],
  ]) {
    for (const [kind, values] of [['attack',{attack,magicAttack:magic}], ['life',{hp:life,mp:life}]]) {
      for (const slot of ['helmet','gloves','robe','boots','weapon','face','necklace','backpack','ring','artifact','shield']) {
        const item = selectedItem(slot, 'spiritTransform', { key: tier + '-' + kind });
        assert.ok(item, slot + tier + kind);
        assert.deepEqual(item.sections.spiritTransform.values, values);
        assert.equal(normalizeEquipment(slot, item).sections.spiritTransform.selection.key, tier + '-' + kind);
      }
    }
  }
  assert.notEqual(TRANSFORM_PRESETS[0].key, TRANSFORM_PRESETS[2].key);
  assert.deepEqual(TRANSFORM_PRESETS[0].values, TRANSFORM_PRESETS[2].values);
});

test('all sixteen ring variants have the correct four base attributes; only tier 3 adds the base 300 HP', () => {
  assert.equal(RING_PRESETS.length, 16);
  for (const [tier, amount, hp] of [['3',80,300], ['7',200,0], ['9',260,0], ['gold',260,0]]) {
    for (const [variant, attack, core, extra] of [
      ['physical-dex','attack','strength','dexterity'], ['physical-agi','attack','strength','agility'],
      ['magic-spirit','magicAttack','wisdom','spirit'], ['magic-agi','magicAttack','wisdom','agility'],
    ]) {
      const resolved = resolveSectionPreset('ring','spirit',{ key:tier+'-'+variant });
      assert.ok(resolved);
      assert.equal(resolved.values[core], amount);
      assert.equal(resolved.values.constitution, amount);
      assert.equal(resolved.values[extra], amount);
      assert.equal(resolved.values.hp || 0, hp);
      assert.equal(resolved.values[attack], amount + (tier === '7' ? 80 : tier === '9' ? 130 : tier === 'gold' ? 220 : 0));
      assert.equal(resolved.movement, 0);
      assert.equal(Object.keys(resolved.values).length, tier === '3' ? 5 : 4);
    }
  }
});

test('true soul and branch matrix uses exact tier-specific attack/life bonuses without adding both branches', () => {
  for (const [tier, first, second, plainAtk, trueAtk, plainHp, trueHp, speed, amount] of [
    ['7','blood','holy',280,320,1000,1200,5,200],
    ['9','demon','angel',390,440,1500,1800,7,260],
    ['gold','demon','angel',480,480,2500,2500,8,260],
  ]) {
    for (const [variant, key] of [['physical-dex','attack'],['magic-spirit','magicAttack']]) {
      for (const trueSoul of [false,true]) {
        const attack = resolveSectionPreset('ring','spirit',{key:tier+'-'+variant,trueSoul,branch:first});
        assert.equal(attack.values[key], trueSoul ? trueAtk : plainAtk);
        assert.equal(attack.values.hp, undefined);
        assert.equal(attack.movement, trueSoul ? speed : 0);
        const life = resolveSectionPreset('ring','spirit',{key:tier+'-'+variant,trueSoul,branch:second});
        assert.equal(life.values[key], amount);
        assert.equal(life.values.hp, trueSoul ? trueHp : plainHp);
        assert.equal(life.movement, trueSoul ? speed : 0);
      }
    }
  }
  const three = resolveSectionPreset('ring','spirit',{key:'3-magic-agi',trueSoul:true});
  assert.equal(three.movement,2); assert.equal(three.values.hp,300); assert.equal(three.values.magicAttack,80);
  assert.deepEqual(three.branches,[]);
});

test('preset selections are authoritative, reject invalid metadata, and keep face bazhe mutually exclusive', () => {
  const item = selectedItem('ring','spirit',{key:'9-magic-spirit',trueSoul:true});
  assert.equal(item.sections.spirit.values.magicAttack,440);
  item.sections.spirit.values = { magicAttack:99999 };
  assert.equal(normalizeEquipment('ring',item).sections.spirit.values.magicAttack,440);
  for (const selection of [{key:'unknown'}, {key:'9-magic-spirit',trueSoul:'yes'},
    {key:'7-magic-spirit',branch:'angel'}, {key:'3-magic-spirit',branch:'demon'}]) {
    assert.equal(selectedItem('ring','spirit',selection),null);
  }
  const wrong = newDraft('weapon'); wrong.sections[0].selection={key:'900-attack'};
  assert.equal(validateDraft(wrong),null);
  const face = newDraft('face'); const source=face.sections.find(item=>item.key==='spiritTransform');
  source.enabled=true;source.selection={key:'gold-life'};face.effects.bazheTier='bazhe10';
  const saved=validateDraft(face);
  assert.equal(saved.sections.spiritTransform.enabled,false);
  assert.deepEqual(saved.sections.spiritTransform.values,{});
  assert.equal(saved.sections.spiritTransform.selection.key,'gold-life');
  const restored=newDraft('face',saved);restored.effects.bazheTier='none';restored.sections[2].enabled=true;
  assert.deepEqual(validateDraft(restored).sections.spiritTransform.values,{hp:2500,mp:2500});
});

let definition;
global.Page = value => { definition = value; };
require('../miniprogram/pages/buildpreview/index');
delete global.Page;
const event = (dataset, value) => ({ currentTarget:{dataset},detail:{value} });
function fixture(equipment={}) {
  let saved={schemaVersion:1,profiles:{mage:{baseStats:base,equipment,manaCalibration:{spirit:1338,mp:13268}}}};
  const repository=createProfileRepository({getStorageSync:()=>structuredClone(saved),setStorageSync(key,value){assert.equal(key,STORAGE_KEY);saved=structuredClone(value);}});
  const page=Object.assign({},definition,{data:structuredClone(definition.data),profiles:structuredClone(saved.profiles),repository,
    setData(value,callback){Object.assign(this.data,value);if(callback)callback();}});
  page.data.loading=false;page.showProfession('mage');
  return {page,saved:()=>structuredClone(saved)};
}
function choose(page,section,key) {
  const options=section==='spiritTransform'?page.data.transformOptions:page.data.ringOptions;
  page.chooseSourcePreset(event({section},String(options.findIndex(item=>item.key===key))));
}

test('transform UI replaces values immediately, none removes them, cancellation preserves old sources and tier IDs persist', async () => {
  const {page,saved}=fixture();page.selectEquipment(event({key:'necklace'}));
  choose(page,'spiritTransform','900-life');
  assert.equal(page.data.equipmentAllImpactRows.find(row=>row.key==='hp').delta,800);
  assert.equal(page.data.equipmentAllImpactRows.find(row=>row.key==='mp').delta,800);
  choose(page,'spiritTransform','900-life');
  assert.equal(page.data.equipmentAllImpactRows.find(row=>row.key==='hp').delta,800);
  choose(page,'spiritTransform','1000-attack');
  assert.equal(page.data.equipmentAllImpactRows.find(row=>row.key==='minAttack').delta,80);
  assert.equal(page.data.equipmentAllImpactRows.find(row=>row.key==='magicAttack').delta,100);
  assert.equal(saved().profiles.mage.equipment.necklace,undefined);
  page.closeEquipmentDialog();page.selectEquipment(event({key:'necklace'}));
  assert.equal(page.data.transformLabel,'无灵变');
  choose(page,'spiritTransform','1000-attack');
  const old=global.wx;global.wx={showToast(){}};
  try {await page.confirmEquipment();}finally{global.wx=old;}
  page.selectEquipment(event({key:'necklace'}));assert.equal(page.data.transformLabel,'1000攻击灵变');
  choose(page,'spiritTransform','none');
  const disabled = page.equipmentDraft.sections.find(item=>item.key==='spiritTransform');
  assert.equal(disabled.enabled,false);assert.deepEqual(disabled.selection,{key:'none'});
  assert.equal(saved().profiles.mage.equipment.necklace.sections.spiritTransform.selection.key,'1000-attack');
});

test('ring UI preserves true soul across levels, resets incompatible branches and restores saved selections', async () => {
  const {page,saved}=fixture();page.selectEquipment(event({key:'ring'}));
  choose(page,'spirit','7-magic-spirit');assert.equal(page.data.ringBranch,'blood');
  page.toggleRingTrueSoul(event({},true));assert.equal(page.data.ringMovement,5);
  page.chooseRingBranch(event({},'holy'));
  assert.equal(validateDraft(page.equipmentDraft).sections.spirit.values.hp,1200);
  choose(page,'spirit','9-magic-spirit');assert.equal(page.data.ringTrueSoul,true);assert.equal(page.data.ringBranch,'demon');
  assert.equal(validateDraft(page.equipmentDraft).sections.spirit.values.magicAttack,440);
  page.chooseRingBranch(event({},'angel'));
  assert.equal(validateDraft(page.equipmentDraft).sections.spirit.values.hp,1800);
  choose(page,'spirit','gold-magic-spirit');assert.equal(page.data.ringBranch,'angel');
  assert.equal(validateDraft(page.equipmentDraft).sections.spirit.values.hp,2500);
  const old=global.wx;global.wx={showToast(){}};
  try {await page.confirmEquipment();}finally{global.wx=old;}
  assert.equal(saved().profiles.mage.equipment.ring.sections.spirit.selection.branch,'angel');
  page.selectEquipment(event({key:'ring'}));assert.equal(page.data.ringLabel,'法系黄金精');assert.equal(page.data.ringMovement,8);
  page.toggleRingTrueSoul(event({},false));
  assert.equal(validateDraft(page.equipmentDraft).sections.spirit.values.hp,2500);
  assert.equal(page.data.ringMovement,0);
});

test('legacy sources preserve their totals, OCR source edits leave preset mode, and non-ring spirits remain manual', () => {
  const draft=newDraft('ring');const spirit=draft.sections.find(item=>item.key==='spirit');
  spirit.enabled=true;spirit.fields=[{key:'wisdom',value:'277'},{key:'hp',value:'450'}];
  const saved=validateDraft(draft);const {page}=fixture({ring:saved});page.selectEquipment(event({key:'ring'}));
  assert.equal(page.data.ringLabel,'原有戒指灵（保留）');
  assert.deepEqual(validateDraft(page.equipmentDraft),saved);
  choose(page,'spirit','9-magic-spirit');
  page.applyRecognizedEquipment(parseEquipmentOcr('戒灵：\n智慧260\n体质260\n精神260\n魔法攻击440','ring'));
  assert.equal(page.equipmentDraft.sections.find(item=>item.key==='spirit').selection,undefined);
  assert.equal(page.data.ringLabel,'原有戒指灵（保留）');
  page.closeEquipmentDialog();page.selectEquipment(event({key:'helmet'}));
  assert.equal(page.data.equipmentSections.find(item=>item.key==='spirit').usesPreset,false);
});

test('source preset calculations stop on takeoff; regular weapon appearance fills both 150 stats', async () => {
  const ring=selectedItem('ring','spirit',{key:'9-magic-spirit',trueSoul:true});
  assert.equal(ring.sections.spirit.values.magicAttack,440);
  const active=calculate(base,{ring},'mage');ring.equipped=false;
  assert.deepEqual(calculate(base,{ring},'mage'),calculate(base,{},'mage'));
  assert.ok(active.magicAttack>base.magicAttack);
  const {page}=fixture();page.selectEquipment(event({key:'weapon'}));
  page.chooseWeaponMode(event({},'custom'));
  assert.deepEqual(validateDraft(page.equipmentDraft).sections.appearance.values,{strength:150,wisdom:150});
  page.chooseWeaponMode(event({},'darkMight'));
  assert.equal(validateDraft(page.equipmentDraft).sections.appearance.enabled,false);
  page.chooseWeaponMode(event({},'custom'));
  assert.deepEqual(validateDraft(page.equipmentDraft).sections.appearance.values,{strength:150,wisdom:150});
});

test('face controls retain an inactive transform preset while bazhe is selected, then restore it', async () => {
  const {page}=fixture();page.selectEquipment(event({key:'face'}));
  choose(page,'spiritTransform','270-life');assert.equal(page.data.faceMode,'spiritTransform');
  const bazheIndex=page.data.faceOptions.findIndex(item=>item.key==='bazhe10');
  page.chooseFaceMode(event({},String(bazheIndex)));
  assert.equal(page.data.faceMode,'bazhe10');
  const old=global.wx;global.wx={showToast(){}};
  try {await page.confirmEquipment();}finally{global.wx=old;}
  page.selectEquipment(event({key:'face'}));
  const transformIndex=page.data.faceOptions.findIndex(item=>item.key==='spiritTransform');
  page.chooseFaceMode(event({},String(transformIndex)));
  assert.equal(page.data.transformLabel,'270生命灵变');
  assert.deepEqual(validateDraft(page.equipmentDraft).sections.spiritTransform.values,{hp:1200,mp:1200});
  assert.equal(validateDraft(page.equipmentDraft).effects.bazhe10,false);
});

test('failed preset save keeps selected tier and toggles editable and does not overwrite old equipment', async () => {
  const {page,saved}=fixture();page.selectEquipment(event({key:'ring'}));
  choose(page,'spirit','9-magic-spirit');page.toggleRingTrueSoul(event({},true));
  page.chooseRingBranch(event({},'angel'));
  const before=saved();let calls=0,rejectSave;
  page.repository.saveEquipment=()=>{calls++;return new Promise((_,reject)=>{rejectSave=reject;});};
  const request=page.confirmEquipment();await page.confirmEquipment();assert.equal(calls,1);
  rejectSave(new Error('full'));await request;
  assert.equal(page.data.equipmentOpen,true);assert.equal(page.data.ringTrueSoul,true);
  assert.equal(page.data.ringBranch,'angel');assert.equal(page.data.ringLabel,'法系9精');
  assert.equal(validateDraft(page.equipmentDraft).sections.spirit.values.hp,1800);
  assert.deepEqual(saved(),before);
});
