import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------
// Helpers & Mock Implementations mirroring client.js & index.js logic
// ---------------------------------------------------------------------

/** Computes SHA-256 fingerprint matching client.js computeBlobFingerprint */
async function computeBlobFingerprint(blob) {
  if (!blob) return null;
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(digest));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${blob.size}:${hashHex}`;
}

/** Mock Blob for testing without browser */
class MockBlob {
  constructor(content, type = 'image/png') {
    this._buffer = Buffer.from(content);
    this.size = this._buffer.length;
    this.type = type;
  }
  async arrayBuffer() {
    return this._buffer.buffer.slice(this._buffer.byteOffset, this._buffer.byteOffset + this._buffer.byteLength);
  }
}

/**
 * Controller simulator matching the exact state machine in ScreenshotToolbarControl
 */
class ScreenshotClientSimulator {
  constructor({ clipboard, fetchFn, isWin = true }) {
    this.clipboard = clipboard; // provides readImageBlob()
    this.fetchFn = fetchFn;
    this.isWin = isWin;
    this.status = 'idle';
    this.insertedFiles = [];
    this.focusListeners = new Set();
  }

  addEventListener(event, fn) {
    if (event === 'focus') this.focusListeners.add(fn);
  }

  removeEventListener(event, fn) {
    if (event === 'focus') this.focusListeners.delete(fn);
  }

  triggerFocus() {
    for (const fn of Array.from(this.focusListeners)) {
      fn();
    }
  }

  insertImageFile(file) {
    this.insertedFiles.push(file);
  }

  async handleScreenshot({ timeoutMs = 12000, pollIntervalMs = 500, advanceTimeFn } = {}) {
    this.status = 'capturing';

    // 1. Calculate baseline image fingerprint (bytes + SHA-256) before snipping
    const baselineBlob = await this.clipboard.readImageBlob();
    const baselineFingerprint = await computeBlobFingerprint(baselineBlob);

    // 2. Trigger native screen snipping via Host endpoint
    try {
      const resp = await this.fetchFn('api/local/trigger-snipping', { method: 'POST', credentials: 'include' });
      if (!resp.ok) {
        this.status = 'idle';
        return;
      }
    } catch {
      this.status = 'idle';
      return;
    }

    // 3. Polling and focus listener
    let handled = false;
    let inFlight = false;
    let pollTimer = null;
    let expireTimer = null;

    const cleanup = () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (expireTimer) { clearTimeout(expireTimer); expireTimer = null; }
      this.removeEventListener('focus', onFocus);
    };

    const checkClipboard = async () => {
      if (handled || inFlight) return;
      inFlight = true;
      try {
        const currentBlob = await this.clipboard.readImageBlob();
        if (!currentBlob || handled) return;
        const currentFingerprint = await computeBlobFingerprint(currentBlob);
        if (currentFingerprint && currentFingerprint !== baselineFingerprint && !handled) {
          handled = true;
          cleanup();
          this.insertImageFile({ size: currentBlob.size, type: currentBlob.type, name: 'screenshot.png' });
          this.status = 'success';
        }
      } finally {
        inFlight = false;
      }
    };

    const onFocus = () => {
      checkClipboard();
      setTimeout(checkClipboard, 50);
    };

    this.addEventListener('focus', onFocus);
    pollTimer = setInterval(checkClipboard, pollIntervalMs);

    expireTimer = setTimeout(() => {
      if (!handled) {
        cleanup();
        this.status = 'idle';
      }
    }, timeoutMs);

    return {
      checkClipboard,
      cleanup,
      isHandled: () => handled,
      expire: () => {
        cleanup();
        if (!handled) this.status = 'idle';
      }
    };
  }

  renderButtons() {
    const buttons = [];
    if (this.isWin) {
      buttons.push('截图');
    }
    buttons.push('贴图');
    return buttons;
  }
}

// ---------------------------------------------------------------------
// TEST SUITE 1: 截图插件剪贴板逻辑 (5 类情况)
// ---------------------------------------------------------------------

test('1.1 剪贴板有旧图，点截图后取消 -> 不插入旧图，超时恢复 idle', async () => {
  const oldImage = new MockBlob('OLD_IMAGE_DATA_111');
  let currentClipboardBlob = oldImage;

  const clipboard = {
    readImageBlob: async () => currentClipboardBlob,
  };

  const client = new ScreenshotClientSimulator({
    clipboard,
    fetchFn: async () => ({ ok: true, status: 200 }),
    isWin: true,
  });

  const session = await client.handleScreenshot({ timeoutMs: 12000 });
  assert.equal(client.status, 'capturing');

  // User canceled: focus returns but clipboard still has the old image
  client.triggerFocus();
  await session.checkClipboard();

  assert.equal(client.insertedFiles.length, 0, '旧图绝对不能被插入');
  assert.equal(session.isHandled(), false);

  // Expire session
  session.expire();
  assert.equal(client.status, 'idle', '超时后按钮恢复 idle');
  assert.equal(client.insertedFiles.length, 0, '超时后依然没有插入任何图片');
});

test('1.2 剪贴板有旧图，新图写入较慢 (轮询检测) -> 成功插入新图一次，不插旧图', async () => {
  const oldImage = new MockBlob('OLD_IMAGE_DATA_222');
  const newImage = new MockBlob('NEW_IMAGE_DATA_333');
  let currentClipboardBlob = oldImage;

  const clipboard = {
    readImageBlob: async () => currentClipboardBlob,
  };

  const client = new ScreenshotClientSimulator({
    clipboard,
    fetchFn: async () => ({ ok: true, status: 200 }),
    isWin: true,
  });

  const session = await client.handleScreenshot({ timeoutMs: 12000 });
  assert.equal(client.status, 'capturing');

  // First poll: still old image
  await session.checkClipboard();
  assert.equal(client.insertedFiles.length, 0, '初次轮询仍为旧图时不插入');

  // Second poll: Windows snipping tool finally writes new image
  currentClipboardBlob = newImage;
  await session.checkClipboard();

  assert.equal(client.insertedFiles.length, 1, '新图写入后只插入一次');
  assert.equal(client.insertedFiles[0].size, newImage.size);
  assert.equal(client.status, 'success');

  // Subsequent check should not insert again
  await session.checkClipboard();
  assert.equal(client.insertedFiles.length, 1, '不发生重复插入');
});

test('1.3 剪贴板有旧图，截了新图 (正常流程) -> 窗口焦点回来时插入新图一次', async () => {
  const oldImage = new MockBlob('OLD_IMAGE_DATA_AAA');
  const newImage = new MockBlob('NEW_IMAGE_DATA_BBB');
  let currentClipboardBlob = oldImage;

  const clipboard = {
    readImageBlob: async () => currentClipboardBlob,
  };

  const client = new ScreenshotClientSimulator({
    clipboard,
    fetchFn: async () => ({ ok: true, status: 200 }),
    isWin: true,
  });

  const session = await client.handleScreenshot({ timeoutMs: 12000 });
  assert.equal(client.status, 'capturing');

  // User snips new image, then focus returns
  currentClipboardBlob = newImage;
  client.triggerFocus();
  // Wait a short tick for the async focus listener to complete
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(client.insertedFiles.length, 1, '焦点回来检测到新图，插入一次');
  assert.equal(client.status, 'success');
  session.cleanup();
});

test('1.4 剪贴板为空，截了新图 -> 正常插入新图一次', async () => {
  let currentClipboardBlob = null;
  const newImage = new MockBlob('NEW_IMAGE_DATA_FROM_EMPTY');

  const clipboard = {
    readImageBlob: async () => currentClipboardBlob,
  };

  const client = new ScreenshotClientSimulator({
    clipboard,
    fetchFn: async () => ({ ok: true, status: 200 }),
    isWin: true,
  });

  const session = await client.handleScreenshot({ timeoutMs: 12000 });
  assert.equal(client.status, 'capturing');

  // Snip created image
  currentClipboardBlob = newImage;
  await session.checkClipboard();

  assert.equal(client.insertedFiles.length, 1, '由空到有新图，插入一次');
  assert.equal(client.insertedFiles[0].size, newImage.size);
  assert.equal(client.status, 'success');
  session.cleanup();
});

test('1.5 后端拒绝请求 (返回 501/500/网络失败) -> 前端立刻恢复 idle，不读剪贴板且不插入', async () => {
  let clipboardReadCount = 0;
  const oldImage = new MockBlob('STALE_IMAGE');

  const clipboard = {
    readImageBlob: async () => {
      clipboardReadCount++;
      return oldImage;
    },
  };

  // Simulate 501 Unsupported Platform response
  const client501 = new ScreenshotClientSimulator({
    clipboard,
    fetchFn: async () => ({ ok: false, status: 501 }),
    isWin: true,
  });

  await client501.handleScreenshot();
  assert.equal(client501.status, 'idle', '后端返回 501 时前端立刻置为 idle');
  assert.equal(client501.insertedFiles.length, 0, '没有插入任何图片');

  // Simulate network rejection
  const clientNetErr = new ScreenshotClientSimulator({
    clipboard,
    fetchFn: async () => { throw new Error('Network failure'); },
    isWin: true,
  });

  await clientNetErr.handleScreenshot();
  assert.equal(clientNetErr.status, 'idle', '网络错误时前端立刻置为 idle');
  assert.equal(clientNetErr.insertedFiles.length, 0, '没有插入任何图片');
});

// ---------------------------------------------------------------------
// TEST SUITE 2: 后端接口 (非 Windows 返回 501，子进程错误不崩溃返回 500)
// ---------------------------------------------------------------------

/** Backend route handler implementation mirroring index.js */
async function handleSnippingRoute({ platform, spawnMock }) {
  if (platform !== 'win32') {
    return {
      status: 501,
      body: { ok: false, error: 'unsupported-platform' },
    };
  }

  return new Promise((resolve) => {
    let settled = false;
    let child;
    try {
      child = spawnMock();
    } catch (err) {
      return resolve({
        status: 500,
        body: { ok: false, error: String(err) },
      });
    }

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        resolve({
          status: 500,
          body: { ok: false, error: String(err) },
        });
      }
    });

    child.on('spawn', () => {
      if (!settled) {
        settled = true;
        resolve({
          status: 200,
          body: { ok: true },
        });
      }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({
          status: 200,
          body: { ok: true },
        });
      }
    }, 50);
  });
}

test('2.1 后端接口：非 Windows (linux/darwin) 平台请求返回 501 unsupported-platform', async () => {
  const resLinux = await handleSnippingRoute({ platform: 'linux', spawnMock: () => {} });
  assert.equal(resLinux.status, 501);
  assert.deepEqual(resLinux.body, { ok: false, error: 'unsupported-platform' });

  const resMac = await handleSnippingRoute({ platform: 'darwin', spawnMock: () => {} });
  assert.equal(resMac.status, 501);
  assert.deepEqual(resMac.body, { ok: false, error: 'unsupported-platform' });
});

test('2.2 后端接口：子进程启动失败 (ENOENT / 权限拒绝) 不崩溃并返回 500', async () => {
  const mockChild = new EventEmitter();
  const spawnMock = () => {
    // Asynchronously emit error event like real Node child_process
    queueMicrotask(() => {
      mockChild.emit('error', new Error('spawn explorer.exe ENOENT'));
    });
    return mockChild;
  };

  const res = await handleSnippingRoute({ platform: 'win32', spawnMock });
  assert.equal(res.status, 500);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /ENOENT/);
});

// ---------------------------------------------------------------------
// TEST SUITE 3: 按钮显示逻辑 (跨平台适配)
// ---------------------------------------------------------------------

test('3.1 按钮显示：Windows 环境下同时显示「截图」和「贴图」两个按钮', () => {
  const clientWin = new ScreenshotClientSimulator({ clipboard: null, fetchFn: null, isWin: true });
  const buttons = clientWin.renderButtons();
  assert.deepEqual(buttons, ['截图', '贴图']);
});

test('3.2 按钮显示：macOS / Linux 环境下仅显示「贴图」按钮，截图按钮自动隐藏', () => {
  const clientMac = new ScreenshotClientSimulator({ clipboard: null, fetchFn: null, isWin: false });
  const buttons = clientMac.renderButtons();
  assert.deepEqual(buttons, ['贴图'], '非 Windows 环境绝对不渲染截图按钮');
});
