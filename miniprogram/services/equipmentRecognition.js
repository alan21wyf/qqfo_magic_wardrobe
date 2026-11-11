// Local static-image OCR. Reference: official WeChat VKSession.runOCR documentation.
// No image upload or server credentials are needed for the device adapter.
// Start status meanings: official wechat-miniprogram/api-typings VKSessionStartCallback.
const START_FAILURES = {
  104: '图片识别授权被取消',
  112: '小程序隐私保护指引尚未声明所需接口，请在小程序后台补全后重试',
  1025: '识别相关隐私接口被微信限制，请检查小程序后台',
  1026: '识别相关隐私接口被微信限制，请检查小程序后台',
  2000000: '微信识别服务发生系统错误，请重试',
  2000001: '图片识别初始化参数错误',
  2000002: '当前设备不支持微信端侧图片识别',
  2000003: '当前系统不支持微信端侧图片识别',
  2000004: '当前设备不支持微信端侧图片识别',
  2003000: '识别会话不可用，请重新打开页面重试',
  2003001: '系统相机权限未开启，请在系统设置中允许微信使用相机',
  2003002: '小程序相机权限未开启，请在小程序设置中允许使用相机',
};

function recognitionEnvironment(api) {
  let info = {};
  for (const method of ['getDeviceInfo', 'getAppBaseInfo']) {
    try { if (typeof api[method] === 'function') Object.assign(info, api[method]()); } catch (_) { /* diagnostics must not hide the failure */ }
  }
  if (!info.platform || !info.SDKVersion) {
    try { if (typeof api.getSystemInfoSync === 'function') info = Object.assign({}, api.getSystemInfoSync(), info); } catch (_) { /* older clients */ }
  }
  return { platform: info.platform || '', SDKVersion: info.SDKVersion || '', version: info.version || '' };
}

function recognitionFailure(api, stage, message, nativeError) {
  const rawCode = typeof nativeError === 'number' ? nativeError
    : nativeError && (nativeError.errCode !== undefined ? nativeError.errCode : nativeError.code);
  const code = typeof rawCode === 'number' || typeof rawCode === 'string' ? rawCode : undefined;
  const reason = typeof nativeError === 'string' ? nativeError
    : nativeError && (nativeError.errMsg || nativeError.message) || '';
  const environment = recognitionEnvironment(api);
  if (stage === 'start' && START_FAILURES[code]) message = START_FAILURES[code];
  if (code !== undefined) message += '（错误码 ' + code + '）';
  if (reason) message += '：' + String(reason).slice(0, 120);
  if (environment.platform === 'devtools' && (code === undefined
    || [2000000, 2000002, 2000003, 2000004, 2003000].includes(Number(code)))) {
    message += '；当前为开发者工具，请使用手机真机调试';
  }
  const error = new Error(message);
  error.stage = stage;
  error.nativeCode = code;
  error.nativeMessage = String(reason);
  error.environment = environment;
  return error;
}

function recognizeEquipmentImage(api, path) {
  let session;
  let timer;
  let settled = false;
  let rejectPending;
  function dispose() {
    if (!session) return;
    try { session.stop(); } catch (_) { /* already stopped */ }
    try { session.destroy(); } catch (_) { /* already disposed */ }
  }
  const result = new Promise((resolve, reject) => {
    rejectPending = reject;
    function finish(error, anchors) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      dispose();
      if (error) {
        console.warn('[equipmentRecognition]', { stage: error.stage, nativeCode: error.nativeCode,
          nativeMessage: error.nativeMessage, environment: error.environment });
        reject(error);
      } else resolve(anchors);
    }
    if (!api.createVKSession || !api.createOffscreenCanvas) {
      finish(recognitionFailure(api, 'capability', '当前设备暂不支持图片识别，请继续手动填写')); return;
    }
    timer = setTimeout(() => finish(recognitionFailure(api, 'timeout', '识别超时，请重试或手动填写')), 20000);
    try {
      const canvas = api.createOffscreenCanvas({ type: '2d', width: 1, height: 1 });
      const image = canvas.createImage();
      image.onerror = (error) => finish(recognitionFailure(api, 'image', '无法读取图片，请重新选择', error));
      image.onload = () => {
        if (settled) return;
        try {
          const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
          const width = Math.max(1, Math.round(image.width * scale));
          const height = Math.max(1, Math.round(image.height * scale));
          canvas.width = width; canvas.height = height;
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0, width, height);
          const pixels = context.getImageData(0, 0, width, height).data;
          try { session = api.createVKSession({ track: { OCR: { mode: 2 } }, version: 'v1' }); }
          catch (error) { finish(recognitionFailure(api, 'create', '无法创建图片识别会话', error)); return; }
          if (!session || !session.runOCR) { finish(recognitionFailure(api, 'capability', '当前设备暂不支持图片识别，请继续手动填写')); return; }
          session.on('updateAnchors', (event) => {
            const anchors = Array.isArray(event) ? event : (event && event.anchors) || [];
            if (anchors.length) finish(null, anchors);
          });
          try {
            session.start((error) => {
              if (settled) return;
              if (error) { finish(recognitionFailure(api, 'start', '暂时无法启动识别', error)); return; }
              try { session.runOCR({ frameBuffer: pixels.buffer, width, height }); }
              catch (error) { finish(recognitionFailure(api, 'recognize', '图片识别执行失败', error)); }
            });
          } catch (error) { finish(recognitionFailure(api, 'start', '暂时无法启动识别', error)); }
        } catch (error) { finish(recognitionFailure(api, 'preprocess', '图片处理失败，请重新选择', error)); }
      };
      image.src = path;
    } catch (error) { finish(recognitionFailure(api, 'image', '图片识别不可用，请继续手动填写', error)); }
  });
  return { result, cancel() {
    if (settled) return;
    settled = true; clearTimeout(timer);
    dispose();
    rejectPending(new Error('CANCELLED'));
  } };
}
module.exports = { recognizeEquipmentImage };
