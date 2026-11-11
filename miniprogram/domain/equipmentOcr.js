const { ATTRIBUTES, getSlot, definitions, allowedAttributes } = require('./equipment');
const { getBazheTier, setDragonTier, setBazheTier, detectDragonTier, detectBazheTier } = require('./equipmentEffects');

const ALIASES = [
  ['damageResistance', '伤害抗性值|伤害抗性'],
  ['magicResistance', '魔法抗性|魔抗'], ['magicDefense', '魔法防御|魔防'],
  ['minAttack', '最小攻击'], ['maxAttack', '最大攻击'],
  ['magicAttack', '魔法攻击力|魔法攻击|魔攻'],
  ['hp', '生命最大值|最大生命值|最大生命|生命上限'],
  ['mp', '法力最大值|最大法力值|最大法力|法力上限'],
  ['armor', '护甲值|护甲'], ['strength', '力量'], ['constitution', '体质'],
  ['agility', '敏捷'], ['wisdom', '智慧'], ['dexterity', '灵巧'], ['spirit', '精神'],
  ['defense', '防御'], ['hit', '命中'], ['attack', '攻击力|攻击'],
];

function orderedLines(anchors) {
  if (typeof anchors === 'string') return anchors.split(/\r?\n/).map((text) => ({ text }));
  const rows = (anchors || []).map((anchor, index) => {
    const shape = anchor.box || anchor.points || [];
    const points = Array.isArray(shape) ? shape : [];
    const xs = points.map((p) => Number(p.x)).filter(Number.isFinite);
    const ys = points.map((p) => Number(p.y)).filter(Number.isFinite);
    return { text: anchor.text || anchor.DetectedText || '', index,
      x: xs.length ? Math.min(...xs) : null, y: ys.length ? Math.min(...ys) : index,
      height: ys.length ? Math.max(...ys) - Math.min(...ys) : 0 };
  });
  const positions = rows.filter((r) => r.x !== null).map((r) => r.x).sort((a, b) => a - b);
  let boundary = null;
  if (positions.length > 1) {
    let gap = 0;
    for (let i = 1; i < positions.length; i++) {
      if (positions[i] - positions[i - 1] > gap) {
        gap = positions[i] - positions[i - 1];
        boundary = (positions[i] + positions[i - 1]) / 2;
      }
    }
    const extent = positions[positions.length - 1] - positions[0];
    if (gap < extent * 0.3) boundary = null;
    const headers = rows.filter((r) => r.x !== null
      && /变装[:：]|灵变[:：]|^[\u4e00-\u9fa5]{0,4}灵[:：]/.test(r.text.replace(/\s/g, '')));
    if (headers.length) {
      const rightStart = Math.min(...headers.map((r) => r.x));
      if (rightStart - positions[0] > extent * 0.3) boundary = rightStart - extent * 0.04;
    }
  }
  rows.sort((a, b) => {
    if (boundary !== null && a.x !== null && b.x !== null) {
      const columns = Number(a.x > boundary) - Number(b.x > boundary);
      if (columns) return columns;
    }
    return a.y - b.y || a.index - b.index;
  });
  const lines = [];
  rows.forEach((row) => {
    const previous = lines[lines.length - 1];
    const column = boundary === null ? 0 : Number(row.x > boundary);
    if (previous && row.x !== null && previous.positioned && previous.column === column
      && Math.abs(row.y - previous.y) <= Math.max(0.002, Math.min(row.height, previous.height) * 0.45)) {
      previous.parts.push(row);
    } else lines.push({ column, y: row.y, height: row.height, positioned: row.x !== null, parts: [row] });
  });
  return lines.flatMap((line) => line.parts.sort((a, b) => (a.x || 0) - (b.x || 0))
    .map((r) => r.text).join('').split(/\r?\n/).map((text) => ({ text })));
}

function parseEquipmentOcr(anchors, slot) {
  const config = getSlot(slot);
  const sections = { body: {}, spirit: {}, spiritTransform: {}, appearance: {} };
  const souls = {};
  const effects = { dragon: false, bazhe10: false, darkMight: false };
  const pending = [];
  const warnings = [];
  let target = sections.body;
  let effectHeader = false;
  let soulMode = false;
  let name = '';
  for (const row of orderedLines(anchors)) {
    const line = row.text.replace(/\s/g, '').replace(/％/g, '%').replace(/[﹢＋]/g, '+');
    if (!line) continue;
    if (!name && !/灵[:：]|变装|力量|魔法|防御|体质/.test(line)) name = line.slice(0, 40);
    if (/名[器品].*魂|魂属性/.test(line)) { soulMode = true; effectHeader = false; continue; }
    const dragon = detectDragonTier(line);
    const bazhe = detectBazheTier(line);
    if (dragon) {
      if (config.hasDragon) setDragonTier(effects, dragon.key);
      else warnings.push('识别到' + dragon.name + '，请核对装备部位');
      effectHeader = true; soulMode = false; continue;
    }
    if (bazhe) {
      if (config.hasBazhe) setBazheTier(effects, bazhe.key);
      else warnings.push('识别到' + bazhe.name + '，请核对装备部位');
      effectHeader = true; soulMode = false; continue;
    }
    if (/极暗黑.*(?:威武|之杖)|威武.*极暗黑/.test(line)) {
      if (config.hasDarkMight) effects.darkMight = true;
      else warnings.push('识别到极暗黑威武，请核对装备部位');
      effectHeader = true; soulMode = false; continue;
    }
    if (/^[\u4e00-\u9fa5]{0,4}灵[:：]/.test(line)) {
      target = sections.spirit; effectHeader = false; soulMode = false; continue;
    }
    if (/灵变[:：]/.test(line)) {
      target = sections.spiritTransform; effectHeader = false; soulMode = false; continue;
    }
    if (/变装[:：]/.test(line)) {
      effectHeader = false; soulMode = false;
      if (config.hasAppearance) {
        const group = { id: 'group' + pending.length, title: line, values: {} };
        pending.push(group); target = group.values;
      } else target = sections.spiritTransform;
      continue;
    }
    if (effectHeader || /攻击时|概率|反射|施法|炼化|等级|熟练|耐久|重量|需要|不可|移动/.test(line)) continue;
    if (soulMode) {
      const match = line.match(/(?:提高|增加)?(魔法攻击力|魔法攻击|魔攻|物理攻击力|物理攻击|物攻|最大生命值|最大生命|生命上限|生命)[^\d]*([\d.]+)%/);
      if (match && config.hasSoul) {
        const key = /魔/.test(match[1]) ? 'magicAttack' : /生命/.test(match[1]) ? 'hp' : 'physicalAttack';
        souls[key] = (souls[key] || 0) + Number(match[2]);
      }
      continue;
    }
    if (/%/.test(line)) continue;
    const pattern = new RegExp('(' + ALIASES.map((a) => a[1]).join('|') + ')[：:]?\\+?(\\d+(?:\\.\\d+)?)', 'g');
    let match;
    while ((match = pattern.exec(line))) {
      const alias = ALIASES.find((a) => new RegExp('^(?:' + a[1] + ')$').test(match[1]));
      if (!alias) continue;
      const value = Number(match[2]);
      if (Number.isFinite(value)) target[alias[0]] = (target[alias[0]] || 0) + value;
    }
  }
  if (config.badge) {
    ['spirit', 'spiritTransform', 'appearance'].forEach((key) => {
      if (Object.keys(sections[key]).length) warnings.push('徽章只保留本体词条，请核对识别结果');
      sections[key] = {};
    });
  }
  if (getBazheTier(effects).percent && Object.keys(sections.spiritTransform).length) {
    warnings.push('面饰灵变与霸者系列二选一，请选择需要的效果');
    setBazheTier(effects, 'none');
  }
  definitions(slot).forEach((definition) => {
    const allowed = allowedAttributes(slot, definition.key).map((a) => a.key);
    const extra = {};
    Object.keys(sections[definition.key]).forEach((key) => {
      if (allowed.includes(key)) return;
      extra[key] = sections[definition.key][key];
      delete sections[definition.key][key];
    });
    if (Object.keys(extra).length) pending.push({
      id: 'group' + pending.length, title: definition.label + '中需要调整来源的词条',
      fromSection: definition.key, values: extra,
    });
  });
  return { name, sections, souls, effects,
    pending: pending.filter((g) => Object.keys(g.values).length), warnings };
}

function fieldsFromValues(values) {
  return ATTRIBUTES.filter((a) => Object.prototype.hasOwnProperty.call(values, a.key))
    .map((a) => ({ key: a.key, label: a.label, value: String(values[a.key]) }));
}

module.exports = { orderedLines, parseEquipmentOcr, fieldsFromValues };
