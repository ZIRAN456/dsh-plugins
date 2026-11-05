window.__ModuleLoader__.load({
  id: '@local/screenshot-button',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Browser-relative route matching connection.fetch (keeps base path working) */
    const SNIP_ROUTE = 'api/local/trigger-snipping';

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

    /**
     * Read baseline clipboard image state before snipping.
     * Distinguishes 3 outcomes:
     *   { status: 'has-image', blob: Blob, fingerprint: string }
     *   { status: 'empty', blob: null, fingerprint: null }
     *   { status: 'failed', error: Error | string }
     */
    async function getClipboardBaseline() {
      if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
        return { status: 'failed', error: new Error('navigator.clipboard.read API is not available') };
      }
      let items;
      try {
        items = await navigator.clipboard.read();
      } catch (err) {
        return { status: 'failed', error: err };
      }

      let imageBlob = null;
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            try {
              imageBlob = await item.getType(type);
              break;
            } catch (err) {
              return { status: 'failed', error: err };
            }
          }
        }
        if (imageBlob) break;
      }

      if (!imageBlob) {
        return { status: 'empty', blob: null, fingerprint: null };
      }

      try {
        const fingerprint = await computeBlobFingerprint(imageBlob);
        if (!fingerprint) {
          return { status: 'failed', error: new Error('Failed to compute image fingerprint') };
        }
        return { status: 'has-image', blob: imageBlob, fingerprint };
      } catch (err) {
        return { status: 'failed', error: err };
      }
    }

    function ScreenshotToolbarControl() {
      const [status, setStatus] = React.useState('idle'); // 'idle' | 'capturing' | 'success'
      const [hoverScreenshot, setHoverScreenshot] = React.useState(false);
      const [hoverPaste, setHoverPaste] = React.useState(false);
      const activeCycleRef = React.useRef(null);
      const isUnmountedRef = React.useRef(false);
      const lastInsertedFingerprintRef = React.useRef(null);
      const isZh = typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase().startsWith('zh');
      const isWin = typeof navigator !== 'undefined' && /windows|win32/i.test(navigator.userAgent || navigator.platform || '');

      React.useEffect(() => {
        isUnmountedRef.current = false;
        return () => {
          isUnmountedRef.current = true;
          if (activeCycleRef.current) {
            activeCycleRef.current.abort();
            activeCycleRef.current = null;
          }
        };
      }, []);

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
        // Cancel any active capture cycle before starting a new one
        if (activeCycleRef.current) {
          activeCycleRef.current.abort();
          activeCycleRef.current = null;
        }

        // 1. Calculate baseline image fingerprint (bytes + SHA-256) before snipping
        const baseline = await getClipboardBaseline();
        if (baseline.status === 'failed') {
          console.warn('[ScreenshotButton] Clipboard baseline read or fingerprint calculation failed, aborting capture:', baseline.error);
          setStatus('idle');
          return;
        }

        if (isUnmountedRef.current) return;
        setStatus('capturing');

        const baselineFingerprint = baseline.fingerprint;

        // 2. Trigger Windows native screen snipping via Host endpoint
        try {
          const resp = await fetch(new URL(SNIP_ROUTE, document.baseURI).href, {
            method: 'POST',
            credentials: 'include',
          });
          if (!resp.ok) {
            console.warn('[ScreenshotButton] trigger snipping rejected with status:', resp.status);
            if (!isUnmountedRef.current) setStatus('idle');
            return;
          }
        } catch (err) {
          console.warn('[ScreenshotButton] trigger snipping error:', err);
          if (!isUnmountedRef.current) setStatus('idle');
          return;
        }

        if (isUnmountedRef.current) return;

        // 3. Continuously poll every 500ms and check immediately on window focus, up to 12s
        let handled = false;
        let inFlight = false;
        let pollTimer = null;
        let expireTimer = null;

        const cleanup = () => {
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
          if (expireTimer) { clearTimeout(expireTimer); expireTimer = null; }
          window.removeEventListener('focus', onFocus);
          if (activeCycleRef.current === cycle) {
            activeCycleRef.current = null;
          }
        };

        const cycle = {
          abort: () => {
            handled = true;
            cleanup();
          },
        };
        activeCycleRef.current = cycle;

        const checkClipboard = async () => {
          if (handled || inFlight || isUnmountedRef.current) return;
          inFlight = true;
          try {
            const currentBlob = await readImageBlobFromClipboard();
            if (!currentBlob || handled || isUnmountedRef.current) return;
            const currentFingerprint = await computeBlobFingerprint(currentBlob);
            if (currentFingerprint && currentFingerprint !== baselineFingerprint && !handled && !isUnmountedRef.current) {
              if (lastInsertedFingerprintRef.current === currentFingerprint) {
                return;
              }
              handled = true;
              lastInsertedFingerprintRef.current = currentFingerprint;
              cleanup();
              const file = new File([currentBlob], `screenshot-${Date.now()}.png`, { type: currentBlob.type || 'image/png' });
              insertImageFile(file);
              if (!isUnmountedRef.current) {
                setStatus('success');
                setTimeout(() => {
                  if (!isUnmountedRef.current) setStatus('idle');
                }, 1600);
              }
            }
          } finally {
            inFlight = false;
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
            if (!isUnmountedRef.current) setStatus('idle');
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
            disabled: status === 'capturing',
            style: {
              ...screenshotBtnStyle,
              cursor: status === 'capturing' ? 'default' : 'pointer',
              opacity: status === 'capturing' ? 0.85 : 1,
            },
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
