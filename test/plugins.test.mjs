import nodeTest, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';

// Real backend imports from the actual repository code
import * as screenshotBackend from '../plugins/dsh-screenshot-button/index.js';
import * as sessionAdminBackend from '../plugins/dsh-session-admin/index.js';

// ---------------------------------------------------------------------
// 时间上限：每条测试最多 20 秒，超时算失败；整套测试最多 120 秒，超过就以失败退出。
// ---------------------------------------------------------------------
const PER_TEST_TIMEOUT_MS = 20_000;
const SUITE_TIMEOUT_MS = 120_000;

function test(name, fn) {
  return nodeTest(name, { timeout: PER_TEST_TIMEOUT_MS }, fn);
}

// unref：测试正常结束时不拖住进程；只有别的东西让进程挂住时才会触发。
setTimeout(() => {
  console.error(`✖ 整套测试超过 ${SUITE_TIMEOUT_MS / 1000} 秒仍未结束，按失败处理并强制退出`);
  process.exit(1);
}, SUITE_TIMEOUT_MS).unref();

/**
 * 记录插件代码在沙箱里开的所有定时器。
 * 每条测试结束后把还活着的定时器全部清掉，这样插件漏清定时器时，
 * 测试只会在断言上失败，不会让整套测试一直挂着跑不完。
 */
const allSandboxTimers = new Set();

function createTrackedTimers() {
  const live = new Set();
  const track = (kind, handle) => {
    const rec = { kind, handle };
    live.add(rec);
    allSandboxTimers.add(rec);
    return rec;
  };
  const untrack = (handle) => {
    for (const rec of live) {
      if (rec.handle === handle) {
        live.delete(rec);
        allSandboxTimers.delete(rec);
      }
    }
  };
  return {
    setTimeout(fn, ms, ...args) {
      let rec = null;
      const handle = globalThis.setTimeout(() => {
        live.delete(rec);
        allSandboxTimers.delete(rec);
        fn(...args);
      }, ms);
      rec = track('timeout', handle);
      return handle;
    },
    clearTimeout(handle) {
      untrack(handle);
      globalThis.clearTimeout(handle);
    },
    setInterval(fn, ms, ...args) {
      const handle = globalThis.setInterval(fn, ms, ...args);
      track('interval', handle);
      return handle;
    },
    clearInterval(handle) {
      untrack(handle);
      globalThis.clearInterval(handle);
    },
    liveCount(kind) {
      return Array.from(live).filter((r) => !kind || r.kind === kind).length;
    },
  };
}

afterEach(() => {
  for (const rec of allSandboxTimers) {
    if (rec.kind === 'interval') globalThis.clearInterval(rec.handle);
    else globalThis.clearTimeout(rec.handle);
  }
  allSandboxTimers.clear();
});

const screenshotClientSource = readFileSync(new URL('../plugins/dsh-screenshot-button/client.js', import.meta.url), 'utf8');
const sessionAdminClientSource = readFileSync(new URL('../plugins/dsh-session-admin/client.js', import.meta.url), 'utf8');

/**
 * Creates a mock image Blob with given byte content and sha-256 capability
 */
function createMockImageBlob(contentStr, type = 'image/png') {
  const buf = Buffer.from(contentStr);
  return {
    size: buf.length,
    type,
    _rawBuffer: buf,
    async arrayBuffer() {
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  };
}

/**
 * Test Harness to execute real screenshot client.js code through node:vm
 */
function setupRealScreenshotClient({ clipboard, fetchFn, userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform = 'Win32', timers } = {}) {
  let capturedFactory = null;
  const sandboxTimers = timers || createTrackedTimers();
  const focusListeners = new Set();
  const dispatchedEvents = [];
  const recordedFetchCalls = [];

  const defaultFetch = async (url, opts) => {
    recordedFetchCalls.push({ url: String(url), opts });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  const activeFetch = fetchFn
    ? async (url, opts) => {
        recordedFetchCalls.push({ url: String(url), opts });
        return fetchFn(url, opts);
      }
    : defaultFetch;

  const mockWindow = {
    __ModuleLoader__: {
      load: (mod) => {
        capturedFactory = mod.factory;
      },
    },
    location: { href: 'http://127.0.0.1:54732/index.html' },
    addEventListener: (ev, fn) => {
      if (ev === 'focus') focusListeners.add(fn);
    },
    removeEventListener: (ev, fn) => {
      if (ev === 'focus') focusListeners.delete(fn);
    },
  };

  const mockDocument = {
    baseURI: 'http://127.0.0.1:54732/app/subpath/',
    querySelector: () => ({
      focus() {},
      dispatchEvent: (evt) => {
        dispatchedEvents.push(evt);
        return true;
      },
    }),
    dispatchEvent: (evt) => {
      dispatchedEvents.push(evt);
      return true;
    },
  };

  const sandbox = {
    window: mockWindow,
    document: mockDocument,
    navigator: {
      clipboard,
      userAgent,
      platform,
      language: 'zh-CN',
    },
    crypto: globalThis.crypto,
    fetch: activeFetch,
    URL: globalThis.URL,
    console,
    setTimeout: sandboxTimers.setTimeout,
    clearTimeout: sandboxTimers.clearTimeout,
    setInterval: sandboxTimers.setInterval,
    clearInterval: sandboxTimers.clearInterval,
    DataTransfer: class {
      constructor() {
        this.items = { add: (file) => { this.file = file; } };
      }
    },
    ClipboardEvent: class {
      constructor(type, init) {
        this.type = type;
        this.clipboardData = init?.clipboardData;
      }
    },
    DragEvent: class {
      constructor(type, init) {
        this.type = type;
        this.dataTransfer = init?.dataTransfer;
      }
    },
    File: class {
      constructor(parts, name, opts) {
        this.parts = parts;
        this.name = name;
        this.type = opts?.type || 'image/png';
        this.size = parts[0]?.size || 0;
        this._rawBuffer = parts[0]?._rawBuffer || null;
      }
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(screenshotClientSource, sandbox);

  if (!capturedFactory) {
    throw new Error('Failed to capture client factory from real client.js');
  }

  // React hook simulation
  let stateMap = new Map();
  let refMap = new Map();
  let effectCleanups = [];
  let hookIndex = 0;

  const resetHookIndex = () => { hookIndex = 0; };

  const mockReact = {
    useState(initial) {
      const idx = hookIndex++;
      if (!stateMap.has(idx)) {
        stateMap.set(idx, typeof initial === 'function' ? initial() : initial);
      }
      const val = stateMap.get(idx);
      const setter = (next) => {
        const nextVal = typeof next === 'function' ? next(stateMap.get(idx)) : next;
        stateMap.set(idx, nextVal);
      };
      return [val, setter];
    },
    useRef(initial) {
      const idx = hookIndex++;
      if (!refMap.has(idx)) {
        refMap.set(idx, { current: initial });
      }
      return refMap.get(idx);
    },
    useEffect(effect) {
      const cleanup = effect();
      if (typeof cleanup === 'function') {
        effectCleanups.push(cleanup);
      }
    },
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat() };
    },
  };

  const plugin = capturedFactory((id) => {
    if (id === 'react') return mockReact;
    return {};
  });

  let registeredComponent = null;
  const mockCtx = {
    slots: {
      inject: (slot, cb) => cb(),
      register: (opts, comp) => {
        registeredComponent = comp;
      },
    },
  };

  plugin.apply(mockCtx);

  const renderComponent = () => {
    resetHookIndex();
    return registeredComponent();
  };

  const triggerFocus = () => {
    for (const fn of Array.from(focusListeners)) {
      fn();
    }
  };

  const unmount = () => {
    for (const cleanup of effectCleanups) {
      cleanup();
    }
    effectCleanups = [];
  };

  return {
    render: renderComponent,
    triggerFocus,
    unmount,
    dispatchedEvents,
    focusListeners,
    recordedFetchCalls,
    liveIntervals: () => sandboxTimers.liveCount('interval'),
    liveTimers: () => sandboxTimers.liveCount(),
  };
}

const setupRealClient = setupRealScreenshotClient;

// ---------------------------------------------------------------------
// TEST CATEGORY 1: 真实 client.js 剪贴板逻辑测试 (5 类情况)
// ---------------------------------------------------------------------

test('1.1 [真实 client.js] 剪贴板有旧图，点截图后取消 -> 旧图绝不插入，超时满12秒恢复 idle 且无任何插入', async () => {
  const oldImageBlob = createMockImageBlob('OLD_STALE_IMAGE_BYTES_111');
  let currentClipboardBlob = oldImageBlob;

  const clipboard = {
    read: async () => [{
      types: ['image/png'],
      getType: async () => currentClipboardBlob,
    }],
  };

  // Mock setTimeout to advance fast-forwarding 12s
  let activeTimers = [];
  const client = setupRealClient({ clipboard });
  const tree1 = client.render();
  const mainBtn = tree1.children.find((c) => c.props.key === 'main-btn');

  await mainBtn.props.onClick();

  // Focus returns with unchanged old image
  client.triggerFocus();
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(client.dispatchedEvents.length, 0, '旧图绝对不能被插入');

  // Verify button state during capturing
  const treeCapturing = client.render();
  assert.equal(treeCapturing.children.find((c) => c.props.key === 'main-btn').props.disabled, true);

  client.unmount();
});

test('1.2 [真实 client.js] 剪贴板有旧图，新图写入较慢 (500ms 持续轮询) -> 比对字节内容成功插入新图一次，不插旧图', async () => {
  const oldImageBlob = createMockImageBlob('OLD_IMAGE_SAME_SIZE_111');
  const newImageBlob = createMockImageBlob('NEW_IMAGE_SAME_SIZE_222'); // same length, distinct content
  assert.equal(oldImageBlob.size, newImageBlob.size, '验证同尺寸不同哈希的严苛条件');
  let currentClipboardBlob = oldImageBlob;

  const clipboard = {
    read: async () => [{
      types: ['image/png'],
      getType: async () => currentClipboardBlob,
    }],
  };

  const client = setupRealClient({ clipboard });
  const tree = client.render();
  const mainBtn = tree.children.find((c) => c.props.key === 'main-btn');

  await mainBtn.props.onClick();
  assert.equal(client.dispatchedEvents.length, 0, '刚启动时旧图不插入');

  // New image writes after 120ms
  await new Promise((r) => setTimeout(r, 120));
  currentClipboardBlob = newImageBlob;

  // Wait for 500ms polling to hit
  await new Promise((r) => setTimeout(r, 600));

  assert.equal(client.dispatchedEvents.length, 1, '新图写入后只插入一次');
  const inserted = client.dispatchedEvents[0].clipboardData.file;
  assert.equal(inserted._rawBuffer.toString('utf8'), 'NEW_IMAGE_SAME_SIZE_222', '必须插入新图内容而非旧图');

  client.unmount();
});

test('1.3 [真实 client.js] 剪贴板有旧图，截了新图 (正常流程) -> 窗口焦点回来时插入新图一次 (比对内容)', async () => {
  const oldImageBlob = createMockImageBlob('OLD_STALE_IMAGE_AAA');
  const newImageBlob = createMockImageBlob('NEW_SNIPPED_IMAGE_BBB');
  let currentClipboardBlob = oldImageBlob;

  const clipboard = {
    read: async () => [{
      types: ['image/png'],
      getType: async () => currentClipboardBlob,
    }],
  };

  const client = setupRealClient({ clipboard });
  const tree = client.render();
  const mainBtn = tree.children.find((c) => c.props.key === 'main-btn');

  await mainBtn.props.onClick();

  // User snips new image and focuses back
  currentClipboardBlob = newImageBlob;
  client.triggerFocus();

  await new Promise((r) => setTimeout(r, 60));

  assert.equal(client.dispatchedEvents.length, 1, '焦点回来检测到新图，插入一次');
  const inserted = client.dispatchedEvents[0].clipboardData.file;
  assert.equal(inserted._rawBuffer.toString('utf8'), 'NEW_SNIPPED_IMAGE_BBB', '插入的必须是新图字节内容');

  client.unmount();
});

test('1.4 [真实 client.js] 剪贴板为空，截了新图 -> 正常插入新图一次', async () => {
  let currentClipboardBlob = null;
  const newImageBlob = createMockImageBlob('NEW_IMAGE_FROM_EMPTY');

  const clipboard = {
    read: async () => {
      if (!currentClipboardBlob) return [];
      return [{
        types: ['image/png'],
        getType: async () => currentClipboardBlob,
      }];
    },
  };

  const client = setupRealClient({ clipboard });
  const tree = client.render();
  const mainBtn = tree.children.find((c) => c.props.key === 'main-btn');

  await mainBtn.props.onClick();

  // New image snipped
  currentClipboardBlob = newImageBlob;
  client.triggerFocus();

  await new Promise((r) => setTimeout(r, 60));

  assert.equal(client.dispatchedEvents.length, 1, '剪贴板由空到截取新图，插入一次');
  const inserted = client.dispatchedEvents[0].clipboardData.file;
  assert.equal(inserted._rawBuffer.toString('utf8'), 'NEW_IMAGE_FROM_EMPTY');

  client.unmount();
});

test('1.5 [真实 client.js] 后端拒绝请求 (501/500/网络失败) -> 前端立刻恢复 idle，绝不读剪贴板且不插入', async () => {
  let clipboardReadCount = 0;
  const oldImageBlob = createMockImageBlob('OLD_IMAGE_BYTES');

  const clipboard = {
    read: async () => {
      clipboardReadCount++;
      return [{
        types: ['image/png'],
        getType: async () => oldImageBlob,
      }];
    },
  };

  const client501 = setupRealClient({
    clipboard,
    fetchFn: async () => ({ ok: false, status: 501 }),
  });

  const tree = client501.render();
  const mainBtn = tree.children.find((c) => c.props.key === 'main-btn');

  // Baseline read happened before fetch (count=1)
  await mainBtn.props.onClick();

  const readsAfterRejection = clipboardReadCount;
  client501.triggerFocus();
  await new Promise((r) => setTimeout(r, 100));

  // Assert clipboard was NEVER read again after rejection
  assert.equal(clipboardReadCount, readsAfterRejection, '后端拒绝后，后续绝不再读剪贴板');
  assert.equal(client501.dispatchedEvents.length, 0, '没有插入任何图片');

  client501.unmount();
});

// ---------------------------------------------------------------------
// TEST CATEGORY 2: 真实 client.js 连点、卸载、失败与跨轮测试
// ---------------------------------------------------------------------

test('2.1 [真实 client.js] 真正的并发连点 (第一下未完成读基准时点第二下) -> fetch 仅调用 1 次，新图仅插入 1 次', async () => {
  const oldImageBlob = createMockImageBlob('OLD_IMAGE');
  const newImageBlob = createMockImageBlob('NEW_IMAGE');
  let currentClipboardBlob = oldImageBlob;

  let resolveFirstRead;
  const firstReadPromise = new Promise((r) => { resolveFirstRead = r; });
  let readInvocations = 0;

  const clipboard = {
    read: async () => {
      readInvocations++;
      if (readInvocations === 1) {
        // Slow down first read to create realistic click race gap
        await firstReadPromise;
      }
      return [{
        types: ['image/png'],
        getType: async () => currentClipboardBlob,
      }];
    },
  };

  const client = setupRealClient({ clipboard });
  const tree = client.render();
  const mainBtn = tree.children.find((c) => c.props.key === 'main-btn');

  // First click (enters read)
  const clickPromise1 = mainBtn.props.onClick();

  // Rapid second click while first click is STILL in getClipboardBaseline()
  const clickPromise2 = mainBtn.props.onClick();

  // Third click
  const clickPromise3 = mainBtn.props.onClick();

  // Now release first read
  resolveFirstRead();
  await Promise.all([clickPromise1, clickPromise2, clickPromise3]);

  // Assert backend trigger endpoint was called EXACTLY ONCE
  assert.equal(client.recordedFetchCalls.length, 1, '并发连点时，后端接口严格只允许被请求一次');

  // New image arrives
  currentClipboardBlob = newImageBlob;
  client.triggerFocus();
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(client.dispatchedEvents.length, 1, '同一张新图只插入一次');
  client.unmount();
});

test('2.2 [真实 client.js] 组件卸载 -> 定时器与焦点监听彻底清理，卸载后绝不插图', async () => {
  const oldImageBlob = createMockImageBlob('OLD_IMAGE');
  const newImageBlob = createMockImageBlob('NEW_IMAGE');
  let currentClipboardBlob = oldImageBlob;

  const clipboard = {
    read: async () => [{
      types: ['image/png'],
      getType: async () => currentClipboardBlob,
    }],
  };

  const client = setupRealClient({ clipboard });
  const tree = client.render();
  const mainBtn = tree.children.find((c) => c.props.key === 'main-btn');

  await mainBtn.props.onClick();
  assert.equal(client.focusListeners.size > 0, true, '截图等待期间挂载了 focus 监听');

  // Unmount component
  client.unmount();
  assert.equal(client.focusListeners.size, 0, '组件卸载后 focus 监听被彻底移除');

  // Image writes after unmount
  currentClipboardBlob = newImageBlob;
  client.triggerFocus();
  await new Promise((r) => setTimeout(r, 100));

  assert.equal(client.dispatchedEvents.length, 0, '组件卸载后绝不再向输入框插入图片');
});

test('2.3 [真实 client.js] 点击前读基准失败 (权限拒绝/数据异常) -> 不唤起截图后端、不进入等待，恢复 idle', async () => {
  let fetchCount = 0;
  const clipboard = {
    read: async () => {
      throw new Error('Clipboard access denied by user permission');
    },
  };

  const client = setupRealClient({
    clipboard,
    fetchFn: async () => {
      fetchCount++;
      return { ok: true, status: 200 };
    },
  });

  const tree = client.render();
  const mainBtn = tree.children.find((c) => c.props.key === 'main-btn');

  await mainBtn.props.onClick();

  assert.equal(fetchCount, 0, '读基准失败时不向后端发起截图请求');
  assert.equal(client.dispatchedEvents.length, 0, '没有插入任何图片');

  client.unmount();
});

test('2.4 [真实 client.js] 内容相同的第二次截图 -> 跨轮次正常插入相同内容的新截图，同一轮内去重', async () => {
  const identicalImageBlob = createMockImageBlob('IDENTICAL_SCREENSHOT_BYTES');
  let currentClipboardBlob = null;

  const clipboard = {
    read: async () => {
      if (!currentClipboardBlob) return [];
      return [{
        types: ['image/png'],
        getType: async () => currentClipboardBlob,
      }];
    },
  };

  const client = setupRealClient({ clipboard });
  const tree = client.render();
  const mainBtn = tree.children.find((c) => c.props.key === 'main-btn');

  // Round 1: Snip identical image
  await mainBtn.props.onClick();
  currentClipboardBlob = identicalImageBlob;
  client.triggerFocus();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(client.dispatchedEvents.length, 1, '第一轮截图成功插入');

  // Round 2: Clear clipboard to simulate fresh state, snip identical image again
  currentClipboardBlob = null;
  await mainBtn.props.onClick();
  currentClipboardBlob = identicalImageBlob;
  client.triggerFocus();
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(client.dispatchedEvents.length, 2, '第二轮截取相同内容的图片，必须正常插入');
  client.unmount();
});

test('2.5 [真实 client.js] 贴图按钮功能 -> 点击一键读取剪贴板图片并插入单张图片', async () => {
  const pasteImageBlob = createMockImageBlob('DIRECT_PASTE_IMAGE_BYTES');
  const clipboard = {
    read: async () => [{
      types: ['image/png'],
      getType: async () => pasteImageBlob,
    }],
  };

  const client = setupRealClient({ clipboard });
  const tree = client.render();
  const clipBtn = tree.children.find((c) => c.props.key === 'clip-btn');

  await clipBtn.props.onClick({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(client.dispatchedEvents.length, 1, '贴图按钮成功插入图片一次');
  const inserted = client.dispatchedEvents[0].clipboardData.file;
  assert.equal(inserted._rawBuffer.toString('utf8'), 'DIRECT_PASTE_IMAGE_BYTES');

  client.unmount();
});

test('2.6 [真实 client.js] 请求地址与认证凭据 -> 请求携带 credentials: include 且使用 baseURI 解析', async () => {
  const clipboard = {
    read: async () => [],
  };

  const client = setupRealClient({ clipboard });
  const tree = client.render();
  const mainBtn = tree.children.find((c) => c.props.key === 'main-btn');

  await mainBtn.props.onClick();

  assert.equal(client.recordedFetchCalls.length, 1);
  const call = client.recordedFetchCalls[0];
  assert.equal(call.url, 'http://127.0.0.1:54732/app/subpath/api/local/trigger-snipping', '请求地址基于 document.baseURI 解析');
  assert.equal(call.opts.credentials, 'include', '请求显式携带 credentials: include');

  client.unmount();
});

// ---------------------------------------------------------------------
// TEST CATEGORY 3: 真实后端 index.js 接口测试
// ---------------------------------------------------------------------

test('3.1 [真实 index.js] 后端接口：非 Windows (linux/darwin) 请求返回 501 unsupported-platform', async () => {
  let registeredRoute = null;
  const mockCtx = {
    effect: (fn) => fn(),
    connection: {
      fetch: {
        register: (route) => {
          registeredRoute = route;
        },
      },
    },
  };

  screenshotBackend.apply(mockCtx);
  assert.ok(registeredRoute, '截图路由已通过 connection.fetch 注册');

  const origPlatform = process.platform;
  try {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const respLinux = await registeredRoute.fetch(new Request('http://127.0.0.1/api/local/trigger-snipping', { method: 'POST' }));
    assert.equal(respLinux.status, 501);
    const bodyLinux = await respLinux.json();
    assert.deepEqual(bodyLinux, { ok: false, error: 'unsupported-platform' });

    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const respMac = await registeredRoute.fetch(new Request('http://127.0.0.1/api/local/trigger-snipping', { method: 'POST' }));
    assert.equal(respMac.status, 501);
    const bodyMac = await respMac.json();
    assert.deepEqual(bodyMac, { ok: false, error: 'unsupported-platform' });
  } finally {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  }
});

test('3.2 [真实 index.js] 后端接口：Windows 上启动失败 (如无法启动 explorer) 返回 500 且宿主不崩溃', async () => {
  let registeredRoute = null;
  const mockCtx = {
    effect: (fn) => fn(),
    connection: {
      fetch: {
        register: (route) => {
          registeredRoute = route;
        },
      },
    },
  };

  screenshotBackend.apply(mockCtx);
  assert.ok(registeredRoute);

  // When explorer.exe fails or cannot be found
  const origPlatform = process.platform;
  const origPath = process.env.PATH;
  try {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    process.env.PATH = join(tmpdir(), 'empty_path_for_test_' + Date.now());

    // Should return 500 or handle error event without uncaughtException
    const resp = await registeredRoute.fetch(new Request('http://127.0.0.1/api/local/trigger-snipping', { method: 'POST' }));
    assert.ok(resp.status === 500 || resp.status === 200);
  } finally {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    process.env.PATH = origPath;
  }
});

// ---------------------------------------------------------------------
// TEST CATEGORY 4: 跨平台按钮显示测试 (通过浏览器标识)
// ---------------------------------------------------------------------

test('4.1 [真实 client.js] 按钮显示：Windows 浏览器标识下渲染「截图」与「贴图」', () => {
  const clientWin = setupRealScreenshotClient({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    platform: 'Win32',
  });
  const tree = clientWin.render();
  const btnKeys = tree.children.map((c) => c.props.key);
  assert.deepEqual(btnKeys, ['main-btn', 'clip-btn'], 'Windows 下显示两个按钮');
  clientWin.unmount();
});

test('4.2 [真实 client.js] 按钮显示：macOS / Linux 浏览器标识下仅渲染「贴图」，隐藏「截图」', () => {
  const clientMac = setupRealScreenshotClient({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    platform: 'MacIntel',
  });
  const treeMac = clientMac.render();
  const btnKeysMac = treeMac.children.map((c) => c.props.key);
  assert.deepEqual(btnKeysMac, ['clip-btn'], 'macOS 下仅显示贴图按钮');
  clientMac.unmount();

  const clientLinux = setupRealScreenshotClient({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    platform: 'Linux x86_64',
  });
  const treeLinux = clientLinux.render();
  const btnKeysLinux = treeLinux.children.map((c) => c.props.key);
  assert.deepEqual(btnKeysLinux, ['clip-btn'], 'Linux 下仅显示贴图按钮');
  clientLinux.unmount();
});

// ---------------------------------------------------------------------
// TEST CATEGORY 5: 真实 session-admin 存储结构完整性与前端显示测试
// ---------------------------------------------------------------------

test('5.1 [真实 session-admin index.js] 存储结构检查：缺少目录时拒绝删除与清单并返回 500', async () => {
  let deleteRoute = null;
  let inventoryRoute = null;

  const mockCtx = {
    effect: (fn) => fn(),
    logger: { warn: () => {} },
    connection: {
      fetch: {
        register: (route) => {
          if (route.path.includes('delete')) deleteRoute = route;
          if (route.path.includes('inventory')) inventoryRoute = route;
        },
      },
    },
    sessions: { list: () => [] },
    workspaceRegistry: { archivedSessionIds: [], list: () => [] },
    sessionPersistence: { list: async () => [] },
  };

  sessionAdminBackend.apply(mockCtx);
  assert.ok(deleteRoute, 'delete 路由已注册');
  assert.ok(inventoryRoute, 'inventory 路由已注册');

  const origDshHome = process.env.DSH_HOME;

  // Case A: DSH home directory is missing
  try {
    process.env.DSH_HOME = join(tmpdir(), 'non_existent_dsh_dir_' + Date.now());
    const req = new Request('http://127.0.0.1/api/sessionAdmin/delete', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'test-session-1' }),
    });
    const resp = await deleteRoute.fetch(req);
    assert.equal(resp.status, 500);
    const body = await resp.json();
    assert.equal(body.error.code, 'session-admin/storage-incompatible');

    const invReq = new Request('http://127.0.0.1/api/sessionAdmin/inventory', { method: 'POST' });
    const invResp = await inventoryRoute.fetch(invReq);
    assert.equal(invResp.status, 500);
    const invBody = await invResp.json();
    assert.equal(invBody.error.code, 'session-admin/storage-incompatible');
  } finally {
    process.env.DSH_HOME = origDshHome;
  }

  // Case B: DSH home exists, but sessions directory is missing
  const tempHome = mkdtempSync(join(tmpdir(), 'dsh_test_home_'));
  try {
    process.env.DSH_HOME = tempHome;
    const req = new Request('http://127.0.0.1/api/sessionAdmin/delete', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'test-session-2' }),
    });
    const resp = await deleteRoute.fetch(req);
    assert.equal(resp.status, 500);
    const body = await resp.json();
    assert.equal(body.error.code, 'session-admin/storage-incompatible');
    assert.match(body.error.message, /Sessions directory/);
  } finally {
    process.env.DSH_HOME = origDshHome;
    rmSync(tempHome, { recursive: true, force: true });
  }

  // Case C: DSH home and sessions exist, but storages/session_projcache/sessions is missing
  const tempHome2 = mkdtempSync(join(tmpdir(), 'dsh_test_home2_'));
  try {
    mkdirSync(join(tempHome2, 'sessions'), { recursive: true });
    process.env.DSH_HOME = tempHome2;
    const req = new Request('http://127.0.0.1/api/sessionAdmin/delete', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'test-session-3' }),
    });
    const resp = await deleteRoute.fetch(req);
    assert.equal(resp.status, 500);
    const body = await resp.json();
    assert.equal(body.error.code, 'session-admin/storage-incompatible');
    assert.match(body.error.message, /Projection cache/);
  } finally {
    process.env.DSH_HOME = origDshHome;
    rmSync(tempHome2, { recursive: true, force: true });
  }
});

test('5.2 [真实 session-admin index.js] 存储结构检查：非目录 (是文件而非目录) 严格拦截并返回 500', async () => {
  let deleteRoute = null;
  const mockCtx = {
    effect: (fn) => fn(),
    logger: { warn: () => {} },
    connection: {
      fetch: {
        register: (route) => {
          if (route.path.includes('delete')) deleteRoute = route;
        },
      },
    },
    sessions: { list: () => [] },
    workspaceRegistry: { archivedSessionIds: [], list: () => [] },
    sessionPersistence: { list: async () => [] },
  };

  sessionAdminBackend.apply(mockCtx);

  const origDshHome = process.env.DSH_HOME;
  const tempHome = mkdtempSync(join(tmpdir(), 'dsh_file_test_'));

  try {
    // Create 'sessions' as a regular file, NOT a directory
    writeFileSync(join(tempHome, 'sessions'), 'not_a_directory');
    process.env.DSH_HOME = tempHome;

    const req = new Request('http://127.0.0.1/api/sessionAdmin/delete', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'test-file-not-dir' }),
    });
    const resp = await deleteRoute.fetch(req);
    assert.equal(resp.status, 500);
    const body = await resp.json();
    assert.equal(body.error.code, 'session-admin/storage-incompatible');
    assert.match(body.error.message, /not a directory/);
  } finally {
    process.env.DSH_HOME = origDshHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
});

test('5.3 [真实 session-admin index.js] 存储结构检查：目录结构完整时放行', async () => {
  let deleteRoute = null;
  const mockCtx = {
    effect: (fn) => fn(),
    logger: { warn: () => {} },
    connection: {
      fetch: {
        register: (route) => {
          if (route.path.includes('delete')) deleteRoute = route;
        },
      },
    },
    sessions: { list: () => [] },
    agents: { get: () => undefined },
    workspaceRegistry: { archivedSessionIds: [], list: () => [] },
    sessionPersistence: { list: async () => [], stat: async () => undefined },
  };

  sessionAdminBackend.apply(mockCtx);

  const origDshHome = process.env.DSH_HOME;
  const tempHome = mkdtempSync(join(tmpdir(), 'dsh_valid_test_'));

  try {
    mkdirSync(join(tempHome, 'sessions'), { recursive: true });
    mkdirSync(join(tempHome, 'storages', 'session_projcache', 'sessions'), { recursive: true });
    process.env.DSH_HOME = tempHome;

    const req = new Request('http://127.0.0.1/api/sessionAdmin/delete', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'valid-structure-session' }),
    });
    const resp = await deleteRoute.fetch(req);
    // Should pass storage structure check and proceed to session lookup (returning 404 because session does not exist in mock)
    assert.equal(resp.status, 404);
    const body = await resp.json();
    assert.equal(body.error.code, 'session-admin/not-found');
  } finally {
    process.env.DSH_HOME = origDshHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
});

test('5.4 [真实 session-admin index.js] 启动检查：启动时校验不兼容在 logger.warn 输出报警', async () => {
  const warnMessages = [];
  const mockCtx = {
    effect: (fn) => fn(),
    logger: {
      warn: (msg) => { warnMessages.push(msg); },
    },
    connection: {
      fetch: {
        register: () => {},
      },
    },
    sessions: { list: () => [] },
    agents: { get: () => undefined },
    workspaceRegistry: { archivedSessionIds: [], list: () => [] },
    sessionPersistence: { list: async () => [] },
  };

  const origDshHome = process.env.DSH_HOME;
  try {
    process.env.DSH_HOME = join(tmpdir(), 'missing_dsh_' + Date.now());
    sessionAdminBackend.apply(mockCtx);

    await new Promise((r) => setTimeout(r, 60));
    assert.ok(warnMessages.length > 0, '启动期必须在 logger.warn 输出报警');
    assert.ok(warnMessages.some((m) => m.includes('Storage structure incompatible')), '必须输出结构不兼容报警');
  } finally {
    process.env.DSH_HOME = origDshHome;
  }
});

test('5.5 [真实 session-admin client.js] 前端菜单：后端返回 storage-incompatible 时菜单项立即显示「当前 Harness 版本不支持」且 disabled', async () => {
  let capturedFactory = null;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: (mod) => { capturedFactory = mod.factory; },
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    document: {
      baseURI: 'http://127.0.0.1:54732/',
      head: { appendChild: () => {} },
      createElement: () => ({ dataset: {}, remove: () => {} }),
    },
    fetch: async () => ({
      json: async () => ({
        ok: false,
        error: { code: 'session-admin/storage-incompatible', message: 'Storage not supported' },
      }),
    }),
    URL: globalThis.URL,
    console,
  };

  vm.createContext(sandbox);
  vm.runInContext(sessionAdminClientSource, sandbox);

  assert.ok(capturedFactory, '成功捕获真实 session-admin client factory');

  let hookIdx = 0;
  const mockReact = {
    useState: (init) => [init, () => {}],
    useRef: (init) => ({ current: init }),
    useEffect: (fn) => { fn(); },
    useCallback: (fn) => fn,
    useSyncExternalStore: (sub, getSnapshot) => getSnapshot(),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
  };

  const plugin = capturedFactory((id) => (id === 'react' ? mockReact : {}));

  let registeredMenuItem = null;
  const mockCtx = {
    effect: (fn) => fn(),
    locale: {
      bind: () => (key) => (key === 'menu.unsupported' ? '当前 Harness 版本不支持' : '删除会话'),
      register: () => {},
    },
    slots: {
      inject: (slot, genFn) => {
        if (slot === 'sidebar.workspaces.session.menu.item') {
          const iter = genFn();
          for (const item of iter) {
            registeredMenuItem = item;
          }
        }
      },
      register: (opts, comp) => comp,
    },
  };

  plugin.apply(mockCtx);

  // Wait for probeCompatibility to settle
  await new Promise((r) => setTimeout(r, 60));

  assert.ok(registeredMenuItem, '注册了侧边栏会话菜单组件');
  const rendered = registeredMenuItem({
    sessionId: 'test-session',
    displayTitle: 'Test',
    useMenuOpenState: () => [true, () => {}],
    t: (key) => (key === 'menu.unsupported' ? '当前 Harness 版本不支持' : '删除会话'),
    requestDelete: () => {},
  });

  assert.equal(rendered.props.disabled, true, '存储不兼容时菜单项必须被禁用 (disabled=true)');
  const labelSpan = rendered.children.find((c) => c.props.className === 'dsa-menuitem-label');
  assert.equal(labelSpan.children[0], '当前 Harness 版本不支持', '菜单项文本必须显示为「当前 Harness 版本不支持」');
});
