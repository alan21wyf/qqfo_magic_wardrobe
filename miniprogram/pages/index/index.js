Page({
  data: { opening: false, artworkFailed: false },
  onShow() { this.setData({ opening: false }); },
  onArtworkError() {
    if (!this.data.artworkFailed) this.setData({ artworkFailed: true });
  },
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
});
