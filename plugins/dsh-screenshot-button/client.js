window.__ModuleLoader__.load({
  id: '@local/screenshot-button',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // Helper: insert image file into composer (single dispatch only to avoid duplicates)
    function insertImageFile(file) {
      const editor = document.querySelector('div[contenteditable="true"], div[contenteditable="plaintext-only"], [role="textbox"], .cm-content');
      if (editor) {
        try {
          editor.focus();
          const dt = new DataTransfer();
          dt.items.add(file);
          const pasteEvt = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt,
          });
          editor.dispatchEvent(pasteEvt);
          return true;
        } catch (err) {
          console.warn('[ScreenshotButton] editor paste dispatch warning:', err);
        }
      }

      // Fallback only if no contenteditable editor was found
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        const dropEvt = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        });
        document.dispatchEvent(dropEvt);
        return true;
      } catch (err) {
        console.warn('[ScreenshotButton] document drop dispatch warning:', err);
      }

      return false;
    }

    // Helper: read image blob from clipboard
    async function readImageBlobFromClipboard() {
      if (!navigator.clipboard || !navigator.clipboard.read) return null;
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          for (const type of item.types) {
            if (type.startsWith('image/')) {
              return await item.getType(type);
            }
          }
        }
      } catch (err) {
        console.warn('[ScreenshotButton] clipboard read warning:', err);
      }
      return null;
    }

    // Helper: compute SHA-256 content fingerprint for an image blob
    async function computeBlobFingerprint(blob) {
      if (!blob) return null;
      try {
        const buffer = await blob.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(digest));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return `${blob.size}:${hashHex}`;
      } catch (err) {
        console.warn('[ScreenshotButton] Failed to compute image fingerprint:', err);
        return null;
      }
    }

    function ScreenshotToolbarControl() {
      const [status, setStatus] = React.useState('idle'); // 'idle' | 'capturing' | 'success'
      const [hoverScreenshot, setHoverScreenshot] = React.useState(false);
      const [hoverPaste, setHoverPaste] = React.useState(false);
      const isZh = typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase().startsWith('zh');
      const isWin = typeof navigator !== 'undefined' && /windows|win32/i.test(navigator.userAgent || navigator.platform || '');

      const handlePasteDirect = async () => {
        setStatus('capturing');
        const blob = await readImageBlobFromClipboard();
        if (blob) {
          const file = new File([blob], `screenshot-${Date.now()}.png`, { type: blob.type || 'image/png' });
          insertImageFile(file);
          setStatus('success');
          setTimeout(() => setStatus('idle'), 1600);
        } else {
          setStatus('idle');
        }
      };

      const handleScreenshot = async () => {
        setStatus('capturing');

        // 1. Calculate baseline image fingerprint (bytes + SHA-256) before snipping
        const baselineBlob = await readImageBlobFromClipboard();
        const baselineFingerprint = await computeBlobFingerprint(baselineBlob);

        // 2. Trigger Windows native screen snipping via Host endpoint
        try {
          const resp = await fetch('/api/local/trigger-snipping', { method: 'POST' });
          if (!resp.ok) {
            console.warn('[ScreenshotButton] trigger snipping rejected with status:', resp.status);
            setStatus('idle');
            return;
          }
        } catch (err) {
          console.warn('[ScreenshotButton] trigger snipping error:', err);
          setStatus('idle');
          return;
        }

        // 3. Continuously poll every 500ms and check immediately on window focus, up to 12s
        let handled = false;
        let pollTimer = null;
        let expireTimer = null;

        const cleanup = () => {
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
          if (expireTimer) { clearTimeout(expireTimer); expireTimer = null; }
          window.removeEventListener('focus', onFocus);
        };

        const checkClipboard = async () => {
          if (handled) return;
          const currentBlob = await readImageBlobFromClipboard();
          if (!currentBlob) return;
          const currentFingerprint = await computeBlobFingerprint(currentBlob);
          if (currentFingerprint && currentFingerprint !== baselineFingerprint) {
            handled = true;
            cleanup();
            const file = new File([currentBlob], `screenshot-${Date.now()}.png`, { type: currentBlob.type || 'image/png' });
            insertImageFile(file);
            setStatus('success');
            setTimeout(() => setStatus('idle'), 1600);
          }
        };

        const onFocus = () => {
          checkClipboard();
          setTimeout(checkClipboard, 350);
        };

        window.addEventListener('focus', onFocus);
        pollTimer = setInterval(checkClipboard, 500);

        // Expire after 12 seconds: restore button and do not insert anything
        expireTimer = setTimeout(() => {
          if (!handled) {
            cleanup();
            setStatus('idle');
          }
        }, 12000);
      };

      const containerStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        height: '28px',
        margin: '0 2px',
        gap: '2px',
        userSelect: 'none',
      };

      const screenshotBtnStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        height: '28px',
        padding: '0 6px',
        fontSize: '13px',
        lineHeight: '20px',
        fontWeight: 400,
        color: status === 'capturing'
          ? 'var(--dsw-alias-brand-primary, #3b82f6)'
          : hoverScreenshot
          ? 'var(--dsw-alias-label-primary, #ffffff)'
          : 'var(--dsw-alias-label-secondary, #9da4ae)',
        backgroundColor: hoverScreenshot
          ? 'var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08))'
          : 'transparent',
        border: 'none',
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        boxSizing: 'border-box',
      };

      const pasteBtnStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        height: '28px',
        padding: '0 6px',
        fontSize: '13px',
        lineHeight: '20px',
        fontWeight: 400,
        color: hoverPaste
          ? 'var(--dsw-alias-label-primary, #ffffff)'
          : 'var(--dsw-alias-label-secondary, #9da4ae)',
        backgroundColor: hoverPaste
          ? 'var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08))'
          : 'transparent',
        border: 'none',
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        boxSizing: 'border-box',
      };

      const iconStyle = {
        width: 13,
        height: 13,
        marginRight: 4,
        verticalAlign: 'middle',
        flexShrink: 0,
        stroke: status === 'success' ? 'var(--dsw-static-green-500, #10b981)' : 'currentColor',
      };

      const cameraSvg = h('svg', {
        key: 'cam',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        style: iconStyle,
      }, [
        h('path', { key: 'p', d: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z' }),
        h('circle', { key: 'c', cx: 12, cy: 13, r: 4 }),
      ]);

      let textLabel = isZh ? '截图' : 'Screenshot';
      if (status === 'capturing') textLabel = isZh ? '等待框选...' : 'Snipping...';
      if (status === 'success') textLabel = isZh ? '✓ 已插入' : '✓ Inserted';

      const controls = [];
      if (isWin) {
        controls.push(
          h('button', {
            key: 'main-btn',
            type: 'button',
            style: screenshotBtnStyle,
            title: isZh ? '唤起系统截图 (Win+Shift+S)，框选后切回自动插入' : 'Trigger Windows Snip (Win+Shift+S) and auto-insert',
            onClick: handleScreenshot,
            onMouseEnter: () => setHoverScreenshot(true),
            onMouseLeave: () => setHoverScreenshot(false),
          }, [
            cameraSvg,
            h('span', { key: 'txt' }, textLabel),
          ])
        );
      }

      controls.push(
        h('button', {
          key: 'clip-btn',
          type: 'button',
          style: pasteBtnStyle,
          title: isZh ? '直接将剪贴板刚截好的图片贴入对话框' : 'Paste clipboard image directly',
          onClick: (e) => {
            e.stopPropagation();
            handlePasteDirect();
          },
          onMouseEnter: () => setHoverPaste(true),
          onMouseLeave: () => setHoverPaste(false),
        }, isZh ? '贴图' : 'Paste')
      );

      return h('div', {
        style: containerStyle,
      }, controls);
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'screenshot-button',
          order: 10,
        }, ScreenshotToolbarControl));
      },
    };
  },
});
