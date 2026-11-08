Page({
  data: { opening: false },
  onShow() { this.setData({ opening: false }); },
  openBuildPreview() {
    if (this.data.opening) return;
    this.setData({ opening: true });
    wx.navigateTo({
      url: '/pages/buildpreview/index',
      fail: () => {
        this.setData({ opening: false });
        wx.showToast({ title: '页面暂时无法打开，请重试', icon: 'none' });
      },
    });
  },
  showComingSoon(event) {
    wx.showToast({ title: event.currentTarget.dataset.label + '即将开放', icon: 'none' });
  },
});
