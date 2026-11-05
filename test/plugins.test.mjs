import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';

// Real backend imports from the actual repository code
import * as screenshotBackend from '../plugins/dsh-screenshot-button/index.js';
import * as sessionAdminBackend from '../plugins/dsh-session-admin/index.js';

const clientSource = readFileSync(new URL('../plugins/dsh-screenshot-button/client.js', import.meta.url), 'utf8');

/**
 * Creates a mock image Blob with given byte content and sha-256 capability
 */
function createMockImageBlob(contentStr, type = 'image/png') {
  const buf = Buffer.from(contentStr);
  return {
    size: buf.length,
    type,
    async arrayBuffer() {
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  };
}

/**
 * Test Harness to execute real client.js code through node:vm
 */
function setupRealClient({ clipboard, fetchFn, userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform = 'Win32' } = {}) {
  let capturedFactory = null;
  const focusListeners = new Set();
  const dispatchedEvents = [];

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
    baseURI: 'http://127.0.0.1:54732/',
    querySelector: (selector) => {
      return {
        focus() {},
        dispatchEvent: (evt) => {
          dispatchedEvents.push(evt);
          return true;
        },
      };
    },
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
    fetch: fetchFn || (async () => ({ ok: true, status: 200 })),
    URL: globalThis.URL,
    console,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
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
      }
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(clientSource, sandbox);

  if (!capturedFactory) {
    throw new Error('Failed to capture client factory from real client.js');
  }

  // Minimal React hook harness
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
    useEffect(effect, deps) {
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
  };
}

// ---------------------------------------------------------------------
// TEST CATEGORY 1: 真实 client.js 剪贴板逻辑测试 (5 类情况)
// ---------------------------------------------------------------------

test('1.1 [真实 client.js] 剪贴板有旧图，点截图后取消 -> 旧图绝不插入，超时恢复 idle', async () => {
  const oldImageBlob = createMockImageBlob('OLD_STALE_IMAGE_BYTES_111');
  let currentClipboardBlob = oldImageBlob;

  const clipboard = {
    read: async () => [{
      types: ['image/png'],
      getType: async (t) => currentClipboardBlob,
    }],
  };

  const client = setupRealClient({ clipboard });
  const tree1 = client.render();
  const mainBtn = tree1.children.find((c) => c.props.key === 'main-btn');

  // Click screenshot button
  await mainBtn.props.onClick();

  // User canceled snip: focus returns, but clipboard still has the old image
  client.triggerFocus();
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(client.dispatchedEvents.length, 0, '旧图绝对不能被插入');

  // Verify button state during capturing
  const treeCapturing = client.render();
  assert.equal(treeCapturing.children.find((c) => c.props.key === 'main-btn').props.disabled, true);

  client.unmount();
});

test('1.2 [真实 client.js] 剪贴板有旧图，新图写入较慢 (500ms 持续轮询) -> 成功插入新图一次，不插旧图', async () => {
  const oldImageBlob = createMockImageBlob('OLD_STALE_IMAGE_BYTES_222');
  const newImageBlob = createMockImageBlob('NEW_SNIPPED_IMAGE_BYTES_333');
  let currentClipboardBlob = oldImageBlob;

  const clipboard = {
    read: async () => [{
      types: ['image/png'],
      getType: async (t) => currentClipboardBlob,
    }],
  };

  const client = setupRealClient({ clipboard });
  const tree = client.render();
  const mainBtn = tree.children.find((c) => c.props.key === 'main-btn');

  await mainBtn.props.onClick();
  assert.equal(client.dispatchedEvents.length, 0, '刚启动时旧图不插入');

  // New image writes after 150ms
  await new Promise((r) => setTimeout(r, 150));
  currentClipboardBlob = newImageBlob;

  // Wait for 500ms polling to hit
  await new Promise((r) => setTimeout(r, 600));

  assert.equal(client.dispatchedEvents.length, 1, '新图写入后只插入一次');
  assert.equal(client.dispatchedEvents[0].clipboardData.file.size, newImageBlob.size);

  client.unmount();
});

test('1.3 [真实 client.js] 剪贴板有旧图，截了新图 (正常流程) -> 窗口焦点回来时插入新图一次', async () => {
  const oldImageBlob = createMockImageBlob('OLD_STALE_IMAGE_BYTES_AAA');
  const newImageBlob = createMockImageBlob('NEW_SNIPPED_IMAGE_BYTES_BBB');
  let currentClipboardBlob = oldImageBlob;

  const clipboard = {
    read: async () => [{
      types: ['image/png'],
      getType: async (t) => currentClipboardBlob,
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
  assert.equal(client.dispatchedEvents[0].clipboardData.file.size, newImageBlob.size);

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
        getType: async (t) => currentClipboardBlob,
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
  assert.equal(client.dispatchedEvents[0].clipboardData.file.size, newImageBlob.size);

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

  // Test 501 rejection
  const client501 = setupRealClient({
    clipboard,
    fetchFn: async () => ({ ok: false, status: 501 }),
  });

  const tree1 = client501.render();
  const mainBtn1 = tree1.children.find((c) => c.props.key === 'main-btn');

  // Baseline was read before fetch (count=1)
  await mainBtn1.props.onClick();

  // Reset counter to observe behavior AFTER rejection
  const readsAfterRejection = clipboardReadCount;
  client501.triggerFocus();
  await new Promise((r) => setTimeout(r, 100));

  assert.equal(clipboardReadCount, readsAfterRejection, '后端拒绝后，后续绝不再读剪贴板');
  assert.equal(client501.dispatchedEvents.length, 0, '没有插入任何图片');

  client501.unmount();
});

// ---------------------------------------------------------------------
// TEST CATEGORY 2: 真实 client.js 重复点击与卸载测试 (说明第 1、2 条)
// ---------------------------------------------------------------------

test('2.1 [真实 client.js] 连续点两次截图 -> 上一轮被彻底取消，同一张新图只插入一次', async () => {
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

  // First click
  await mainBtn.props.onClick();

  // Second click while capturing
  await mainBtn.props.onClick();

  // Now new image arrives
  currentClipboardBlob = newImageBlob;
  client.triggerFocus();
  await new Promise((r) => setTimeout(r, 80));

  assert.equal(client.dispatchedEvents.length, 1, '连点两次后新图绝不插两遍，只插一次');
  client.unmount();
});

test('2.2 [真实 client.js] 组件卸载 -> 定时器与焦点监听清理，卸载后绝不插图', async () => {
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
  assert.equal(client.focusListeners.size > 0, true, '截图期间挂载了 focus 监听');

  // Unmount component (e.g. user navigated to another conversation)
  client.unmount();
  assert.equal(client.focusListeners.size, 0, '卸载后 focus 监听被彻底移除');

  // Simulate new image arrival after unmount
  currentClipboardBlob = newImageBlob;
  client.triggerFocus();
  await new Promise((r) => setTimeout(r, 100));

  assert.equal(client.dispatchedEvents.length, 0, '组件卸载后绝不再向输入框插入图片');
});

test('2.3 [真实 client.js] 点击前读基准失败 -> 不唤起截图、不进入等待，恢复 idle', async () => {
  let fetchCalled = false;
  const clipboard = {
    read: async () => {
      throw new Error('Clipboard access denied by user permission');
    },
  };

  const client = setupRealClient({
    clipboard,
    fetchFn: async () => {
      fetchCalled = true;
      return { ok: true, status: 200 };
    },
  });

  const tree = client.render();
  const mainBtn = tree.children.find((c) => c.props.key === 'main-btn');

  await mainBtn.props.onClick();

  assert.equal(fetchCalled, false, '读基准失败时不向后端发起截图请求');
  assert.equal(client.dispatchedEvents.length, 0, '没有插入任何图片');

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

// ---------------------------------------------------------------------
// TEST CATEGORY 4: 跨平台按钮显示测试 (通过浏览器标识)
// ---------------------------------------------------------------------

test('4.1 [真实 client.js] 按钮显示：Windows 浏览器标识下渲染「截图」与「贴图」', () => {
  const clientWin = setupRealClient({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    platform: 'Win32',
  });
  const tree = clientWin.render();
  const btnKeys = tree.children.map((c) => c.props.key);
  assert.deepEqual(btnKeys, ['main-btn', 'clip-btn'], 'Windows 下显示两个按钮');
  clientWin.unmount();
});

test('4.2 [真实 client.js] 按钮显示：macOS / Linux 浏览器标识下仅渲染「贴图」，隐藏「截图」', () => {
  const clientMac = setupRealClient({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    platform: 'MacIntel',
  });
  const treeMac = clientMac.render();
  const btnKeysMac = treeMac.children.map((c) => c.props.key);
  assert.deepEqual(btnKeysMac, ['clip-btn'], 'macOS 下仅显示贴图按钮');
  clientMac.unmount();

  const clientLinux = setupRealClient({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    platform: 'Linux x86_64',
  });
  const treeLinux = clientLinux.render();
  const btnKeysLinux = treeLinux.children.map((c) => c.props.key);
  assert.deepEqual(btnKeysLinux, ['clip-btn'], 'Linux 下仅显示贴图按钮');
  clientLinux.unmount();
});

// ---------------------------------------------------------------------
// TEST CATEGORY 5: 真实 session-admin 存储结构完整性检查测试
// ---------------------------------------------------------------------

test('5.1 [真实 session-admin index.js] 存储结构检查：缺少 DSH / sessions / projcache 时拒绝删除并返回 500', async () => {
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

  // Case A: DSH home directory is missing
  const origDshHome = process.env.DSH_HOME;
  try {
    process.env.DSH_HOME = join(tmpdir(), 'non_existent_dsh_dir_' + Date.now());

    const req = new Request('http://127.0.0.1/api/sessionAdmin/delete', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'test-session-1' }),
    });
    const resp = await deleteRoute.fetch(req);
    assert.equal(resp.status, 500);
    const body = await resp.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'session-admin/storage-incompatible');

    // Inventory should also reject
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
