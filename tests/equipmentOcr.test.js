const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEquipmentOcr } = require('../miniprogram/domain/equipmentOcr');
const { recognizeEquipmentImage } = require('../miniprogram/services/equipmentRecognition');

test('unordered two-column anchors join split labels and numbers without mixing sources', () => {
  const anchor = (text, x, y) => ({ text, box: [{ x, y }, { x: x + 0.08, y },
    { x: x + 0.08, y: y + 0.02 }, { x, y: y + 0.02 }] });
  const parsed = parseEquipmentOcr([
    anchor('235', 0.92, 0.2), anchor('152', 0.25, 0.2), anchor('项灵：', 0.7, 0.1),
    anchor('智慧', 0.7, 0.2), anchor('智慧', 0.1, 0.2), anchor('项链名称', 0.1, 0.0),
  ], 'necklace');
  assert.equal(parsed.sections.body.wisdom, 152);
  assert.equal(parsed.sections.spirit.wisdom, 235);
});

test('ring OCR sums duplicate body magic, separates transform, and excludes triggered effects', () => {
  const parsed = parseEquipmentOcr([
    '道天之神惊玉环', '魔法攻击 99', '魔抗 146', '生命最大值 +2280',
    '魔法攻击力 +455', '智慧 +152', '攻击时概率额外产生2000的魔法伤害',
    '名器之魂属性', '提高魔法攻击力6%', '变装：戒灵·恶魔·真（法）',
    '精神+260', '体质+260', '智慧+260', '魔法攻击+440', '移动速度+7%',
  ].join('\n'), 'ring');
  assert.equal(parsed.sections.body.magicAttack, 554);
  assert.equal(parsed.sections.body.magicResistance, 146);
  assert.equal(parsed.sections.body.hp, 2280);
  assert.equal(parsed.sections.spiritTransform.magicAttack, 440);
  assert.equal(parsed.sections.spiritTransform.wisdom, undefined);
  assert.equal(parsed.pending.find((g) => g.fromSection === 'spiritTransform').values.wisdom, 260);
  assert.equal(parsed.souls.magicAttack, 6);
});

test('necklace OCR separates dragon effect, fixed transform, spirit, and resistance', () => {
  const parsed = parseEquipmentOcr([
    '道天之神煌法坠', '魔法攻击150', '魔抗341', '护甲值+237', '魔抗+195', '智慧+152',
    '名器之魂属性', '提高魔法攻击力6%', '变装：龙啸九天*神', '智慧+15%', '体质+15%',
    '变装：项灵之心·喵小萌', '攻击+80', '魔法攻击+100',
    '项灵：', '项灵等级：15', '体质：241', '魔法攻击：274', '魔法防御：270', '智慧：235',
  ].join('\n'), 'necklace');
  assert.equal(parsed.effects.dragon, true);
  assert.equal(parsed.sections.body.magicResistance, 536);
  assert.equal(parsed.sections.body.wisdom, 152);
  assert.equal(parsed.sections.spiritTransform.attack, 80);
  assert.equal(parsed.sections.spiritTransform.magicAttack, 100);
  assert.equal(parsed.sections.spirit.magicAttack, 274);
  assert.equal(parsed.sections.spirit.magicDefense, 270);
  assert.equal(parsed.pending.some((g) => g.fromSection === 'spirit'), false);
  assert.equal(parsed.sections.spirit.wisdom, 235);
});

test('ambiguous costume source retained for review; bazhe percentages not counted as flat stats', () => {
  const parsed = parseEquipmentOcr([
    '夜影面饰', '力量+287', '变装：破神之面', '体质+300', '精神+300',
    '变装：霸者神龙+10', '力量+10%', '智慧+10%', '最大生命+1000',
    '面灵：', '力量254', '攻击255', '体质259',
  ].join('\n'), 'face');
  assert.equal(parsed.effects.bazhe10, true);
  assert.equal(parsed.sections.body.hp, undefined);
  assert.equal(parsed.sections.body.strength, 287);
  assert.equal(parsed.sections.spirit.strength, 254);
  assert.equal(parsed.pending.length, 1);
  assert.equal(parsed.sections.spirit.attack, 255);
  assert.equal(parsed.pending[0].values.constitution, 300);
});

test('shoe resistance does not become magic defense; movement soul not mapped', () => {
  const parsed = parseEquipmentOcr('防御102\n魔法抗性263\n护甲137\n名器之魂属性\n提高移动速度13%', 'boots');
  assert.equal(parsed.sections.body.defense, 102);
  assert.equal(parsed.sections.body.magicResistance, 263);
  assert.equal(parsed.sections.body.magicDefense, undefined);
  assert.deepEqual(parsed.souls, {});
});

test('spirit OCR accepts all six combat fields and reserves max life for ring spirits', () => {
  const text = '灵：\n魔法攻击100\n攻击80\n防御20\n魔法防御30\n伤害抗性40\n魔法抗性50\n最大生命600';
  for (const slot of ['boots', 'ring']) {
    const parsed = parseEquipmentOcr(text, slot);
    const expected = { magicAttack: 100, attack: 80, defense: 20,
      magicDefense: 30, damageResistance: 40, magicResistance: 50 };
    if (slot === 'ring') expected.hp = 600;
    assert.deepEqual(parsed.sections.spirit, expected, slot);
    if (slot === 'ring') assert.equal(parsed.pending.length, 0);
    else assert.deepEqual(parsed.pending.find((g) => g.fromSection === 'spirit').values, { hp: 600 });
  }
});

test('unsupported device reports failure instead of pretending recognition succeeded', async () => {
  await assert.rejects(recognizeEquipmentImage({}, '/test.png').result, /不支持/);
});

test('device OCR accepts anchors and destroys the session even if stop reports already stopped', async () => {
  let updates, stopped = 0, destroyed = 0;
  const fake = {
    createOffscreenCanvas() {
      const canvas = { width: 1, height: 1,
        getContext() { return { drawImage() {}, getImageData() { return { data: new Uint8Array(16) }; } }; },
        createImage() {
          const image = { width: 2, height: 2 };
          Object.defineProperty(image, 'src', { set() { queueMicrotask(() => image.onload()); } });
          return image;
        } };
      return canvas;
    },
    createVKSession() {
      return {
        on(name, fn) { assert.equal(name, 'updateAnchors'); updates = fn; },
        start(fn) { fn(null); },
        runOCR(data) { assert.equal(data.width, 2); queueMicrotask(() => updates([{ text: '智慧152' }])); },
        stop() { stopped++; throw new Error('already stopped'); }, destroy() { destroyed++; },
      };
    },
  };
  const result = await recognizeEquipmentImage(fake, '/test.png').result;
  assert.equal(result[0].text, '智慧152');
  assert.equal(stopped, 1); assert.equal(destroyed, 1);
});

test('cancelled OCR rejects and does not later produce a success', async () => {
  const job = recognizeEquipmentImage({
    createVKSession() {}, createOffscreenCanvas() { return { createImage() { return {}; } }; },
  }, '/test.png');
  job.cancel();
  await assert.rejects(job.result, /CANCELLED/);
});
