const modeData = {
  equipmentMode: 'edit', equipmentBusy: false, clearConfirmationOpen: false,
  takeoffHintVisible: false, takeoffHintFading: false, recordedCount: 0,
};
const modeMethods = {
  clearEquipmentModeTimers() {
    clearTimeout(this.takeoffHintTimer);
    clearTimeout(this.takeoffFadeTimer);
    this.takeoffHintTimer = null;
    this.takeoffFadeTimer = null;
  },
  dismissTakeoffHint() {
    this.clearEquipmentModeTimers();
    this.setData({ takeoffHintVisible: false, takeoffHintFading: false });
  },
  showTakeoffHint() {
    this.dismissTakeoffHint();
    this.setData({ takeoffHintVisible: true, takeoffHintFading: false });
    this.takeoffHintTimer = setTimeout(() => {
      if (this.unloaded || this.data.equipmentMode !== 'takeoff') return;
      this.setData({ takeoffHintFading: true });
      this.takeoffFadeTimer = setTimeout(() => {
        if (!this.unloaded) this.setData({ takeoffHintVisible: false, takeoffHintFading: false });
      }, 500);
    }, 5000);
  },
  setEquipmentMode(event) {
    if (!this.data.ready || this.data.loading || this.data.loadError || this.data.equipmentBusy
      || this.data.clearConfirmationOpen || this.data.equipmentOpen || this.data.dialogOpen || this.data.presetOpen) return;
    const mode = event.currentTarget.dataset.mode;
    if (mode === 'clear') return this.confirmClearEquipment();
    if (!['edit', 'takeoff'].includes(mode)) return;
    this.setData({ equipmentMode: mode });
    if (mode === 'takeoff') this.showTakeoffHint();
    else this.dismissTakeoffHint();
  },
  async toggleEquipmentSlot(slot) {
    if (this.data.equipmentBusy || this.data.clearConfirmationOpen) return;
    const profession = this.data.profession;
    const profile = this.profiles[profession];
    const item = profile && profile.equipment && profile.equipment[slot];
    if (!item) { wx.showToast({ title: '此部位尚未录入装备', icon: 'none' }); return; }
    const active = item.equipped === false;
    this.setData({ equipmentBusy: true });
    try {
      const record = await this.repository.setEquipmentActive(profession, slot, active);
      this.profiles[profession] = record;
      if (this.unloaded) return;
      this.showEquipmentSummary();
      wx.showToast({ title: active ? '已装备，已计入属性' : '已取下，录入数据保留', icon: 'none' });
    } catch (_) {
      if (!this.unloaded) wx.showToast({ title: active ? '装备未成功，请重试' : '取下未成功，请重试', icon: 'none' });
    } finally { if (!this.unloaded) this.setData({ equipmentBusy: false }); }
  },
  async confirmClearEquipment() {
    if (this.data.equipmentBusy || this.data.clearConfirmationOpen) return;
    const profession = this.data.profession;
    const previousMode = this.data.equipmentMode;
    this.dismissTakeoffHint();
    this.setData({ clearConfirmationOpen: true, equipmentMode: 'clear' });
    try {
      const answer = await new Promise((resolve, reject) => wx.showModal({
        title: '清除装备', content: '是否清除所有录入装备',
        confirmText: '确认清除', cancelText: '取消', confirmColor: '#a74735',
        success: resolve, fail: reject,
      }));
      if (this.unloaded) return;
      this.setData({ clearConfirmationOpen: false });
      if (!answer.confirm) { this.setData({ equipmentMode: previousMode }); return; }
      this.setData({ equipmentBusy: true });
      const record = await this.repository.clearEquipment(profession);
      this.profiles[profession] = record;
      if (this.unloaded) return;
      this.setData({ equipmentMode: 'edit' });
      this.showEquipmentSummary();
      wx.showToast({ title: '当前职业装备已清除', icon: 'none' });
    } catch (_) {
      if (!this.unloaded) {
        this.setData({ equipmentMode: previousMode });
        wx.showToast({ title: '清除未成功，数据已保留', icon: 'none' });
      }
    } finally {
      if (!this.unloaded) this.setData({ equipmentBusy: false, clearConfirmationOpen: false });
    }
  },
};
module.exports = { modeData, modeMethods };
