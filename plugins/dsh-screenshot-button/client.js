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

    // Helper: read image from clipboard
    async function readImageFromClipboard() {
      if (!navigator.clipboard || !navigator.clipboard.read) return null;
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          for (const type of item.types) {
            if (type.startsWith('image/')) {
              const blob = await item.getType(type);
              return new File([blob], `screenshot-${Date.now()}.png`, { type: blob.type || 'image/png' });
            }
          }
        }
      } catch (err) {
        console.warn('[ScreenshotButton] clipboard read warning:', err);
      }
      return null;
    }

    function ScreenshotToolbarControl() {
      const [status, setStatus] = React.useState('idle'); // 'idle' | 'capturing' | 'success'
      const [hoverScreenshot, setHoverScreenshot] = React.useState(false);
      const [hoverPaste, setHoverPaste] = React.useState(false);
      const isZh = typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase().startsWith('zh');
      const isWin = typeof navigator !== 'undefined' && /windows|win32/i.test(navigator.userAgent || navigator.platform || '');

      const handlePasteDirect = async () => {
        setStatus('capturing');
        const file = await readImageFromClipboard();
        if (file) {
          insertImageFile(file);
          setStatus('success');
          setTimeout(() => setStatus('idle'), 1600);
        } else {
          setStatus('idle');
        }
      };

      const handleScreenshot = async () => {
        setStatus('capturing');

        // 1. Record baseline clipboard image size to prevent pasting stale image if user cancels
        const baseline = await readImageFromClipboard();
        const baselineFingerprint = baseline ? `${baseline.size}_${baseline.lastModified}` : 'empty';

        // 2. Trigger Windows native screen snipping via Host endpoint
        try {
          const resp = await fetch('/api/local/trigger-snipping', { method: 'POST' });
          if (!resp.ok) {
            console.warn('[ScreenshotButton] trigger snipping responded with status:', resp.status);
          }
        } catch (err) {
          console.warn('[ScreenshotButton] trigger snipping error:', err);
        }

        // 3. Listen for window focus: only check clipboard when focus returns after snip
        let handled = false;
        const onFocus = () => {
          window.removeEventListener('focus', onFocus);
          setTimeout(async () => {
            if (handled) return;
            const latest = await readImageFromClipboard();
            if (!latest) {
              setStatus('idle');
              return;
            }
            const latestFingerprint = `${latest.size}_${latest.lastModified}`;
            // Only insert if clipboard has a newly captured image
            if (baselineFingerprint === 'empty' || latestFingerprint !== baselineFingerprint) {
              handled = true;
              insertImageFile(latest);
              setStatus('success');
              setTimeout(() => setStatus('idle'), 1600);
            } else {
              // User canceled or clipboard didn't update: do not paste old image
              setStatus('idle');
            }
          }, 350);
        };

        window.addEventListener('focus', onFocus);

        // Safety timeout to clean up listener if user stays away
        setTimeout(() => {
          window.removeEventListener('focus', onFocus);
          setStatus((prev) => (prev === 'capturing' ? 'idle' : prev));
        }, 30000);
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

      const screenshotTooltip = isWin
        ? (isZh ? '唤起系统截图 (Win+Shift+S)，框选后切回自动插入' : 'Trigger Windows Snip (Win+Shift+S) and auto-insert')
        : (isZh ? '系统截图仅支持 Windows；可在外部截图后点击【贴图】' : 'Native snip is Windows-only; use Paste after screenshotting');

      return h('div', {
        style: containerStyle,
      }, [
        // Screenshot button
        h('button', {
          key: 'main-btn',
          type: 'button',
          style: screenshotBtnStyle,
          title: screenshotTooltip,
          onClick: handleScreenshot,
          onMouseEnter: () => setHoverScreenshot(true),
          onMouseLeave: () => setHoverScreenshot(false),
        }, [
          cameraSvg,
          h('span', { key: 'txt' }, textLabel),
        ]),
        // Paste button
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
        }, isZh ? '贴图' : 'Paste'),
      ]);
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
