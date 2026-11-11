const UPLOAD_IMAGE_GUIDANCE = '使用原始清晰截图，避免遮挡数字、红圈覆盖文字或只截一列。识别后的内容可以修改，无法确定的变装来源会请你选择。';
const EXAMPLES = {
  helmet: ['armor', '头盔'], robe: ['armor', '衣服'], boots: ['armor', '鞋子'],
  gloves: ['accessories', '手套'], face: ['accessories', '面饰'], ring: ['accessories', '戒指'],
  weapon: ['gear', '武器'], necklace: ['gear', '项链'], backpack: ['gear', '背包'],
};

function getEquipmentExample(slot) {
  if (!Object.prototype.hasOwnProperty.call(EXAMPLES, slot)) return null;
  const [group, label] = EXAMPLES[slot];
  const root = '/equipment-examples/' + group;
  return { slot, group, label, src: root + '/' + slot + '.png', page: root + '/index' };
}

module.exports = { UPLOAD_IMAGE_GUIDANCE, getEquipmentExample };
