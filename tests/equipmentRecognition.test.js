const test = require('node:test');
const assert = require('node:assert/strict');
const { recognizeEquipmentImage } = require('../miniprogram/services/equipmentRecognition');
const { STAT_FIELDS } = require('../miniprogram/domain/profile');
const { parseEquipmentOcr } = require('../miniprogram/domain/equipmentOcr');

function device(status, extra = {}) {
  const counts = { stopped: 0, destroyed: 0, recognized: 0 };
  const api = Object.assign({
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
      return {
        on() {}, start(callback) { callback(status); }, runOCR() { counts.recognized++; },
        stop() { counts.stopped++; }, destroy() { counts.destroyed++; },
      };
    },
  }, extra);
  return { api, counts };
}

test('native start statuses expose privacy permission and device causes and release the failed session', async (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  for (const [code, message] of [[104, /授权被取消/], [112, /隐私保护指引/], [1025, /隐私接口/],
    [2000001, /参数错误/], [2000002, /设备不支持/], [2000003, /系统不支持/],
    [2003001, /系统相机权限/], [2003002, /小程序相机权限/]]) {
    const { api, counts } = device(code, {
      getDeviceInfo: () => ({ platform: 'android' }),
      getAppBaseInfo: () => ({ SDKVersion: '2.27.0', version: '8.0.50' }),
    });
    await assert.rejects(recognizeEquipmentImage(api, '/private-image.png').result, (error) => {
      assert.equal(error.stage, 'start');
      assert.equal(error.nativeCode, code);
      assert.match(error.message, message);
      assert.ok(error.message.includes(String(code)));
      assert.deepEqual(error.environment, { platform: 'android', SDKVersion: '2.27.0', version: '8.0.50' });
      return true;
    });
    assert.deepEqual(counts, { stopped: 1, destroyed: 1, recognized: 0 });
  }
  assert.equal(warnings.length, 8);
  assert.equal(JSON.stringify(warnings).includes('/private-image.png'), false);
});

test('a devtools start failure gives an actionable real-device hint and retains native status', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { api } = device(2003000, { getSystemInfoSync: () => ({ platform: 'devtools', SDKVersion: '2.27.0' }) });
  await assert.rejects(recognizeEquipmentImage(api, '/image.png').result, (error) => {
    assert.match(error.message, /手机真机调试/);
    assert.equal(error.nativeCode, 2003000);
    assert.equal(error.environment.platform, 'devtools');
    return true;
  });
});

test('native object errors and synchronous start exceptions retain their actual messages', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { api } = device({ errCode: -77, errMsg: 'native start unavailable' });
  await assert.rejects(recognizeEquipmentImage(api, '/image.png').result, (error) => {
    assert.equal(error.stage, 'start');
    assert.equal(error.nativeCode, -77);
    assert.match(error.message, /native start unavailable/);
    return true;
  });
  api.createVKSession = () => ({ on() {}, runOCR() {}, stop() {}, destroy() {}, start() { throw Error('native start exception'); } });
  await assert.rejects(recognizeEquipmentImage(api, '/image.png').result, (error) => {
    assert.equal(error.stage, 'start');
    assert.match(error.message, /native start exception/);
    return true;
  });
});

test('diagnostic API failures cannot mask the original OCR failure', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { api } = device(112, { getDeviceInfo() { throw Error('unsupported'); },
    getAppBaseInfo() { throw Error('unsupported'); }, getSystemInfoSync() { throw Error('unsupported'); } });
  await assert.rejects(recognizeEquipmentImage(api, '/image.png').result, (error) => {
    assert.equal(error.nativeCode, 112);
    assert.match(error.message, /隐私保护指引/);
    return true;
  });
});

test('upload shows the concrete startup failure and preserves previously entered equipment', async (t) => {
  t.mock.method(console, 'warn', () => {});
  let definition;
  global.Page = (value) => { definition = value; };
  require('../miniprogram/pages/buildpreview/index');
  delete global.Page;
  const baseStats = Object.fromEntries(STAT_FIELDS.map((s) => [s.key, 100]));
  const page = Object.assign({}, definition, { data: structuredClone(definition.data),
    profiles: { swordsman: { baseStats } }, setData(value) { Object.assign(this.data, value); } });
  page.data.loading = false;
  page.showProfession('swordsman');
  page.selectEquipment({ currentTarget: { dataset: { key: 'ring' } } });
  page.applyRecognizedEquipment(parseEquipmentOcr('智慧152', 'ring'));
  const draft = structuredClone(page.equipmentDraft);
  const { api } = device(112, { chooseImage(options) { options.success({ tempFilePaths: ['/image.png'] }); } });
  const previous = global.wx;
  global.wx = api;
  try {
    await page.uploadEquipmentImage();
    assert.match(page.data.equipmentError, /隐私保护指引.*112/);
    assert.equal(page.data.recognizing, false);
    assert.equal(page.data.equipmentCanSave, true);
    assert.deepEqual(page.equipmentDraft, draft);
    assert.equal(page.profiles.swordsman.equipment, undefined);
  } finally { if (previous === undefined) delete global.wx; else global.wx = previous; }
});
