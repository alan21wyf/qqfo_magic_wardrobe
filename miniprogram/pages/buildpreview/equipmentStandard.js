const { UPLOAD_IMAGE_GUIDANCE, getEquipmentExample } = require('../../domain/equipmentExamples');

function createEquipmentStandardPage(group) {
  return {
    data: { uploadImageGuidance: UPLOAD_IMAGE_GUIDANCE, exampleImage: '', exampleLabel: '' },
    onLoad(options) {
      const example = getEquipmentExample(options && options.slot);
      if (!example || example.group !== group) return;
      this.setData({ exampleImage: example.src, exampleLabel: example.label + '装备截图示例' });
    },
    previewExampleImage() {
      if (this.data.exampleImage) wx.previewImage({ current: this.data.exampleImage, urls: [this.data.exampleImage] });
    },
    onExampleImageError() { wx.showToast({ title: '示例图加载失败，请重新打开', icon: 'none' }); },
  };
}

module.exports = { createEquipmentStandardPage };
