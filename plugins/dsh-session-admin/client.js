/**
 * Browser half of the session-admin bundle: one "Delete session" row in a
 * Session's "..." menu, plus the confirmation dialog and result notice it
 * raises. The actual deletion happens in the Host half behind an authenticated
 * Connection route; this module never touches the filesystem.
 *
 * @module @local/dsh-session-admin
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-session-admin',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Route the browser posts a storage-inventory request to. */
    const INVENTORY_ROUTE = 'api/sessionAdmin/inventory';

    /** Main-panel key of the cleanup page, also its sidebar launcher id. */
    const PANEL_ID = 'session-admin-cleanup';

    /** Locale namespace owned by this bundle. */
    const NS = '@local/dsh-session-admin';
    /** Browser-relative form of the Host route (keeps a mount prefix working). */
    const DELETE_ROUTE = 'api/sessionAdmin/delete';

    const zh = {
      'menu.deleteSession': '删除会话',
      'menu.unsupported': '当前 Harness 版本不支持',
      'dialog.title': '删除会话',
      'dialog.desc': '将把“{title}”及其全部对话记录永久删除。此操作无法撤销。',
      'dialog.note': '会话日志与投影缓存会一并清除。',
      'dialog.cancel': '取消',
      'dialog.confirm': '删除会话',
      'dialog.pending': '正在删除会话…',
      'dialog.failed': '删除失败：{message}',
      'notice.done': '已删除会话，释放 {size}',
      'notice.queued': '已删除该会话；它在本进程内仍驻留，日志文件将在下次启动时清理。',
      'notice.locked': '操作失败，请重试。',
      'notice.running': '该会话正在运行，请先停止再删除。',
      'notice.untitled': '未命名会话',
      'panel.title': '会话存储',
      'panel.locale': 'zh-CN',
      'panel.refresh': '刷新',
      'panel.refreshing': '刷新中…',
      'panel.loading': '正在计算各会话占用…',
      'panel.loadFailed': '读取失败：{message}',
      'panel.empty': '没有会话',
      'panel.summaryCount': '共 {count} 个会话',
      'panel.summaryBytes': '合计 {size}',
      'panel.summaryArchived': '其中已归档 {size}',
      'panel.summaryPending': '待重启清理 {size}',
      'panel.selectAll': '全选',
      'panel.selectRow': '选择「{title}」',
      'panel.filterLabel': '筛选',
      'panel.filterAll': '全部',
      'panel.filterArchived': '仅已归档',
      'panel.filterIdle': '仅未打开',
      'panel.tagRunning': '运行中',
      'panel.tagResident': '已打开，待重启清理',
      'panel.tagArchived': '已归档',
      'panel.tagNoFiles': '无日志文件',
      'panel.noSelection': '未选择会话',
      'panel.selection': '已选 {count} 个 · {size}',
      'panel.clearSelection': '取消选择',
      'panel.deleteSelected': '删除所选（{count}）',
      'panel.deleting': '正在删除…',
      'panel.partialFailure': '已删除 {deleted} 个，{failed} 个失败：{detail}',
    };

    const en = {
      'menu.deleteSession': 'Delete session',
      'menu.unsupported': 'Unsupported in this Harness version',
      'dialog.title': 'Delete session',
      'dialog.desc': '"{title}" and its whole conversation log will be permanently deleted. This cannot be undone.',
      'dialog.note':
        'The session log and its projection cache will be removed together.',
      'dialog.cancel': 'Cancel',
      'dialog.confirm': 'Delete session',
      'dialog.pending': 'Deleting session…',
      'dialog.failed': 'Delete failed: {message}',
      'notice.done': 'Session deleted, freed {size}',
      'notice.queued': 'Session deleted. It is still resident in this process, so its log files are cleaned at the next start.',
      'notice.locked': 'The operation failed. Please try again.',
      'notice.running': 'This session is running. Stop it before deleting.',
      'notice.untitled': 'Untitled session',
      'panel.title': 'Session storage',
      'panel.locale': 'en-US',
      'panel.refresh': 'Refresh',
      'panel.refreshing': 'Refreshing…',
      'panel.loading': 'Measuring stored sessions…',
      'panel.loadFailed': 'Could not read storage: {message}',
      'panel.empty': 'No sessions',
      'panel.summaryCount': '{count} sessions',
      'panel.summaryBytes': '{size} total',
      'panel.summaryArchived': '{size} archived',
      'panel.summaryPending': '{size} queued for cleanup',
      'panel.selectAll': 'Select all',
      'panel.selectRow': 'Select "{title}"',
      'panel.filterLabel': 'Filter',
      'panel.filterAll': 'All',
      'panel.filterArchived': 'Archived only',
      'panel.filterIdle': 'Not open only',
      'panel.tagRunning': 'Running',
      'panel.tagResident': 'Clears on restart',
      'panel.tagArchived': 'Archived',
      'panel.tagNoFiles': 'No log files',
      'panel.noSelection': 'No sessions selected',
      'panel.selection': '{count} selected · {size}',
      'panel.clearSelection': 'Clear selection',
      'panel.deleteSelected': 'Delete selected ({count})',
      'panel.deleting': 'Deleting…',
      'panel.partialFailure': 'Deleted {deleted}, {failed} failed: {detail}',
    };

    /**
     * Minimal external store the dialog and notice subscribe to.
     * @param initial - the initial value.
     * @returns a snapshot with get/set/subscribe.
     */
    function createStore(initial) {
      let value = initial;
      const listeners = new Set();
      return {
        get() {
          return value;
        },
        set(next) {
          value = next;
          for (const listener of listeners) listener();
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    }

    /** Subscribe a component to one store through React's own subscription primitive. */
    function useStore(store) {
      return React.useSyncExternalStore(store.subscribe, store.get, store.get);
    }

    /** Substitute `{name}` placeholders. */
    function format(template, values) {
      return template.replace(/\{(\w+)\}/g, (match, name) =>
        Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match,
      );
    }

    /** Track whether the current DSH version and storage layout is supported. */
    const supportStore = createStore(true);

    /** Human-readable byte size for the result notice. */
    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      let value = bytes;
      let unit = 0;
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
      }
      return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
    }

    /**
     * POST one JSON request to a Host route and unwrap its result envelope.
     * @param route - browser-relative route path.
     * @param body - JSON-serializable request body.
     * @returns the Host result value.
     * @throws an Error carrying the Host failure code and message.
     */
    async function postToHost(route, body) {
      const response = await fetch(new URL(route, document.baseURI).href, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error(`unexpected response (HTTP ${String(response.status)})`);
      }
      if (payload?.ok === true) return payload.value;
      const failure = payload?.error;
      const error = new Error(typeof failure?.message === 'string' ? failure.message : `HTTP ${String(response.status)}`);
      error.code = typeof failure?.code === 'string' ? failure.code : 'session-admin/internal';
      if (error.code === 'session-admin/storage-incompatible') {
        supportStore.set(false);
      }
      throw error;
    }

    /**
     * Ask the Host to delete one Session.
     * @param sessionId - Session identity.
     * @returns the Host result value.
     */
    function requestHostDelete(sessionId) {
      return postToHost(DELETE_ROUTE, { sessionId });
    }

    /**
     * Ask the Host for the current per-Session storage inventory.
     * @returns rows plus totals.
     */
    function requestInventory() {
      return postToHost(INVENTORY_ROUTE, {});
    }

    /** Stylesheet for the row, dialog, and notice; theme tokens only. */
    const CSS = `
.dsa-menuitem{box-sizing:border-box;display:flex;align-items:center;gap:6px;width:100%;min-height:30px;margin:0;padding:5px 8px;border:none;border-radius:var(--dsw-radius-md,6px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer;user-select:none}
.dsa-menuitem:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsa-menuitem[data-danger]{color:var(--dsw-alias-state-error-primary)}
.dsa-menuitem[data-danger]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(239,68,68,.12))}
.dsa-menuitem-icon{display:inline-flex;flex:none;width:14px;height:14px;align-items:center;justify-content:center;color:inherit}
.dsa-menuitem-icon svg{width:14px;height:14px}
.dsa-menuitem-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:20px}
.dsa-backdrop{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.32)}
.dsa-panel{box-sizing:border-box;width:min(440px,calc(100vw - 32px));padding:20px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 12px 40px rgba(0,0,0,.28);font-size:14px;line-height:22px}
.dsa-title{margin:0 0 8px;font-size:16px;font-weight:600;line-height:24px}
.dsa-desc{margin:0 0 6px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.dsa-note{margin:0 0 16px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dsa-status{margin:0 0 12px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dsa-error{margin:0 0 12px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dsa-actions{display:flex;justify-content:flex-end;gap:8px}
.dsa-button{box-sizing:border-box;height:32px;padding:0 14px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,4px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.dsa-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsa-button:disabled{opacity:.55;cursor:default}
.dsa-button[data-danger]:not(:disabled){color:var(--dsw-alias-state-error-primary)}
.dsa-toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:2147483000;max-width:min(560px,calc(100vw - 32px));padding:10px 16px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;box-shadow:0 8px 28px rgba(0,0,0,.24)}
.dsa-page{box-sizing:border-box;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}
.dsa-pageScroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}
.dsa-pageContent{max-width:960px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}
.dsa-pageHeading{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;padding-top:28px;margin-bottom:8px}
.dsa-pageHeading h1{margin:0;font-size:20px;font-weight:600;line-height:28px}
.dsa-headingActions{display:flex;align-items:center;gap:8px}
.dsa-summary{display:flex;flex-wrap:wrap;gap:6px 20px;margin:0 0 20px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dsa-summary strong{color:var(--dsw-alias-label-primary);font-weight:600}
.dsa-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 0 12px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.dsa-toolbarSpacer{flex:1}
.dsa-checkbox{display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;user-select:none}
.dsa-checkbox input{margin:0;cursor:pointer}
.dsa-select{box-sizing:border-box;height:28px;padding:0 6px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,4px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.dsa-list{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
.dsa-row{display:grid;grid-template-columns:22px minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:9px 0;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.dsa-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.06))}
.dsa-rowMain{display:flex;flex-direction:column;min-width:0;gap:1px}
.dsa-rowTitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:19px}
.dsa-rowMeta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}
.dsa-rowSize{color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.dsa-rowTags{display:flex;flex-wrap:wrap;align-items:center;gap:4px;justify-content:flex-end}
.dsa-tag{display:inline-flex;align-items:center;padding:0 6px;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:16px;white-space:nowrap}
.dsa-tag[data-tone=warn]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.dsa-tag[data-tone=run]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.dsa-tag[data-tone=muted]{color:var(--dsw-alias-state-idle-primary)}
.dsa-emptyState{display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:80px;color:var(--dsw-alias-label-secondary);font-size:13px}
.dsa-footerBar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 0;position:sticky;bottom:0;background:var(--dsw-alias-bg-base);border-top:.5px solid var(--dsw-alias-border-l1)}
.dsa-selectionText{flex:1;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px}
.dsa-selectionText strong{color:var(--dsw-alias-label-primary);font-weight:600}
`;

    /** Official IconTrashOutlineRegular SVG matched 1:1 with DSH primitives. */
    function TrashIcon({ size = 14 } = {}) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          strokeWidth: 1,
        },
        h('path', { d: 'M1.28149 3.88831H14.7187', stroke: 'currentColor' }),
        h('path', {
          d: 'M5.41602 3.88833V2.47962C5.41602 2.29282 5.52492 2.11366 5.71876 1.98157C5.9126 1.84948 6.17551 1.77527 6.44964 1.77527H9.55053C9.82466 1.77527 10.0876 1.84948 10.2814 1.98157C10.4753 2.11366 10.5842 2.29282 10.5842 2.47962V3.88833',
          stroke: 'currentColor',
        }),
        h('path', {
          d: 'M2.57349 3.88831L3.19366 13.2943C3.21937 13.5502 3.33952 13.7872 3.53065 13.9593C3.72178 14.1313 3.97016 14.2259 4.22729 14.2246H11.7728C12.0299 14.2259 12.2783 14.1313 12.4694 13.9593C12.6605 13.7872 12.7807 13.5502 12.8064 13.2943L13.4266 3.88831',
          stroke: 'currentColor',
        }),
        h('path', { d: 'M6.44946 6.98926V11.1238', stroke: 'currentColor' }),
        h('path', { d: 'M9.55054 6.98926V11.1238', stroke: 'currentColor' }),
      );
    }

    /**
     * One Session's "..." row.
     * @param props - owner identity, the menu open pair, and this bundle's face.
     * @returns the row.
     */
    function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, t, requestDelete }) {
      const [menuOpen, setMenuOpen] = typeof useMenuOpenState === 'function' ? useMenuOpenState() : [false, () => {}];
      void menuOpen;
      const supported = useStore(supportStore);
      return h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          className: 'dsa-menuitem',
          'data-danger': supported ? '' : undefined,
          disabled: !supported,
          style: supported ? {} : { opacity: 0.6, cursor: 'not-allowed' },
          title: supported ? '' : t('menu.unsupported'),
          onClick: () => {
            if (!supported) return;
            setMenuOpen(false);
            requestDelete(sessionId, displayTitle);
          },
        },
        h('span', { className: 'dsa-menuitem-icon' }, h(TrashIcon, { size: 14 })),
        h('span', { className: 'dsa-menuitem-label' }, supported ? t('menu.deleteSession') : t('menu.unsupported')),
      );
    }

    /**
     * The confirmation dialog for one pending request.
     * @param props - the request store, the delete hop, its outcome store, and the locale seat.
     * @returns the dialog, or null while no request is pending.
     */
    function DeleteSessionDialog({ requests, deleteSession, notice, t }) {
      const request = useStore(requests);
      const [pending, setPending] = React.useState(false);
      const [error, setError] = React.useState(null);
      React.useEffect(() => {
        if (request === null) {
          setPending(false);
          setError(null);
        }
      }, [request]);
      const close = React.useCallback(() => {
        if (pending) return;
        requests.set(null);
      }, [pending, requests]);
      React.useEffect(() => {
        if (request === null) return undefined;
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            close();
          }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
      }, [request, close]);
      if (request === null) return null;
      const title = request.displayTitle.trim().length > 0 ? request.displayTitle : t('notice.untitled');
      const confirm = () => {
        setPending(true);
        setError(null);
        deleteSession(request.sessionId)
          .then((value) => {
            requests.set(null);
            notice.set({
              kind: 'done',
              freedBytes: value?.freedBytes ?? 0,
              queued: value?.queued === true,
              at: Date.now(),
            });
          })
          .catch((reason) => {
            setError(reason);
            setPending(false);
          });
      };
      return h(
        'div',
        {
          className: 'dsa-backdrop',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) close();
          },
        },
        h(
          'div',
          {
            className: 'dsa-panel',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('dialog.title'),
          },
          h('h2', { className: 'dsa-title' }, t('dialog.title')),
          h('p', { className: 'dsa-desc' }, format(t('dialog.desc'), { title })),
          h('p', { className: 'dsa-note' }, t('dialog.note')),
          pending ? h('div', { className: 'dsa-status', role: 'status' }, t('dialog.pending')) : null,
          error !== null
            ? h(
                'p',
                { className: 'dsa-error', role: 'alert' },
                format(t('dialog.failed'), {
                  message:
                    error.code === 'session-admin/running'
                      ? t('notice.running')
                      : error.message,
                }),
              )
            : null,
          h(
            'div',
            { className: 'dsa-actions' },
            h(
              'button',
              { type: 'button', className: 'dsa-button', disabled: pending, onClick: close },
              t('dialog.cancel'),
            ),
            h(
              'button',
              { type: 'button', className: 'dsa-button', 'data-danger': '', disabled: pending, onClick: confirm },
              t('dialog.confirm'),
            ),
          ),
        ),
      );
    }

    /**
     * The transient result notice.
     * @param props - the outcome store and the locale seat.
     * @returns the notice, or null when nothing recent is pending.
     */
    function DeleteSessionNotice({ notice, t }) {
      const value = useStore(notice);
      React.useEffect(() => {
        if (value === null) return undefined;
        const timer = window.setTimeout(() => notice.set(null), 4000);
        return () => window.clearTimeout(timer);
      }, [value, notice]);
      if (value === null) return null;
      const text =
        value.kind === 'done'
          ? value.queued === true
            ? t('notice.queued')
            : format(t('notice.done'), { size: formatBytes(value.freedBytes) })
          : t('notice.locked');
      return h('div', { className: 'dsa-toast', role: 'status' }, text);
    }

    /** Sidebar icon for the cleanup panel; matches the panel-list icon size. */
    function CleanupIcon({ size = 16 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false },
        h('path', {
          d: 'M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.5 8.2a1 1 0 0 0 1 .8h5a1 1 0 0 0 1-.8l.5-8.2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    /** Day label for the row meta line. */
    function formatDay(timestamp, locale) {
      if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
      try {
        return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(
          new Date(timestamp),
        );
      } catch {
        return new Date(timestamp).toISOString().slice(0, 10);
      }
    }

    /**
     * The cleanup panel: every stored Session with its footprint, selectable in
     * bulk. Deleting goes through the same Host route as the sidebar row, so a
     * Session whose Agent is still resident is queued for the next start instead
     * of failing.
     *
     * @param props - the Session list hook (for titles), the delete hop, and the locale seat.
     * @returns the page.
     */
    function CleanupPanel({ useSessions, deleteSession, t }) {
      const sessions = useSessions((state) => state.byId);
      const [state, setState] = React.useState({ phase: 'loading', rows: [], totals: null, error: null });
      const [selected, setSelected] = React.useState(() => new Set());
      const [filter, setFilter] = React.useState('all');
      const [busy, setBusy] = React.useState(false);
      const [failure, setFailure] = React.useState(null);

      const refresh = React.useCallback(() => {
        let cancelled = false;
        setState((previous) => ({ ...previous, phase: 'loading', error: null }));
        requestInventory().then(
          (value) => {
            if (cancelled) return;
            setState({ phase: 'ready', rows: value.rows, totals: value.totals, error: null });
            setSelected((previous) => {
              /* A row that disappeared must not stay selected invisibly. */
              const present = new Set(value.rows.map((row) => row.sessionId));
              const next = new Set([...previous].filter((id) => present.has(id)));
              return next.size === previous.size ? previous : next;
            });
          },
          (error) => {
            if (cancelled) return;
            setState({ phase: 'failed', rows: [], totals: null, error });
          },
        );
        return () => {
          cancelled = true;
        };
      }, []);

      React.useEffect(() => refresh(), [refresh]);

      const rows = React.useMemo(() => {
        if (filter === 'archived') return state.rows.filter((row) => row.archived);
        if (filter === 'idle') return state.rows.filter((row) => !row.attached);
        return state.rows;
      }, [state.rows, filter]);

      const titleOf = React.useCallback(
        (row) => {
          const title = sessions[row.sessionId]?.displayTitle;
          return typeof title === 'string' && title.trim().length > 0 ? title : row.sessionId;
        },
        [sessions],
      );

      const selectableIds = React.useMemo(
        () => rows.filter((row) => !row.running).map((row) => row.sessionId),
        [rows],
      );
      const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
      const selectedRows = rows.filter((row) => selected.has(row.sessionId));
      const selectedBytes = selectedRows.reduce((total, row) => total + row.bytes, 0);

      const toggle = (sessionId) => {
        setSelected((previous) => {
          const next = new Set(previous);
          if (next.has(sessionId)) next.delete(sessionId);
          else next.add(sessionId);
          return next;
        });
      };
      const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableIds));

      const runDelete = () => {
        const targets = [...selectedRows];
        if (targets.length === 0 || busy) return;
        setBusy(true);
        setFailure(null);
        const failures = [];
        let freed = 0;
        const next = async () => {
          for (const row of targets) {
            try {
              const value = await deleteSession(row.sessionId);
              freed += value?.freedBytes ?? 0;
            } catch (error) {
              failures.push({ title: titleOf(row), message: error?.message ?? String(error) });
            }
          }
          setBusy(false);
          setSelected(new Set());
          if (failures.length > 0) setFailure({ failures, deleted: targets.length - failures.length });
          refresh();
        };
        void next();
      };

      const totals = state.totals;
      const summary =
        totals === null
          ? null
          : h(
              'p',
              { className: 'dsa-summary' },
              h('span', null, format(t('panel.summaryCount'), { count: totals.count })),
              h('span', null, format(t('panel.summaryBytes'), { size: formatBytes(totals.bytes) })),
              h('span', null, format(t('panel.summaryArchived'), { size: formatBytes(totals.archivedBytes) })),
              h('span', null, format(t('panel.summaryPending'), { size: formatBytes(totals.pendingBytes) })),
            );

      const body = (() => {
        if (state.phase === 'loading' && state.rows.length === 0) {
          return h('div', { className: 'dsa-emptyState' }, t('panel.loading'));
        }
        if (state.phase === 'failed') {
          return h(
            'div',
            { className: 'dsa-emptyState' },
            h('div', null, format(t('panel.loadFailed'), { message: state.error?.message ?? '' })),
          );
        }
        if (rows.length === 0) return h('div', { className: 'dsa-emptyState' }, t('panel.empty'));
        return h(
          'ul',
          { className: 'dsa-list' },
          rows.map((row) => {
            const title = titleOf(row);
            const running = row.running === true;
            return h(
              'li',
              { className: 'dsa-row', key: row.sessionId },
              h('input', {
                type: 'checkbox',
                'aria-label': format(t('panel.selectRow'), { title }),
                checked: selected.has(row.sessionId),
                disabled: running || busy,
                onChange: () => toggle(row.sessionId),
              }),
              h(
                'div',
                { className: 'dsa-rowMain' },
                h('span', { className: 'dsa-rowTitle', title }, title),
                h(
                  'span',
                  { className: 'dsa-rowMeta' },
                  row.workspaceTitle.length > 0 ? h('span', null, row.workspaceTitle) : null,
                  h('span', null, formatDay(row.createdAt, t('panel.locale'))),
                  h('span', { title: row.sessionId }, row.sessionId),
                ),
              ),
              h('span', { className: 'dsa-rowSize' }, formatBytes(row.bytes)),
              h(
                'span',
                { className: 'dsa-rowTags' },
                running ? h('span', { className: 'dsa-tag', 'data-tone': 'run' }, t('panel.tagRunning')) : null,
                (row.pendingCleanup || row.attached) && !running
                  ? h('span', { className: 'dsa-tag', 'data-tone': 'warn' }, t('panel.tagResident'))
                  : null,
                row.archived ? h('span', { className: 'dsa-tag', 'data-tone': 'muted' }, t('panel.tagArchived')) : null,
                row.missingArtifacts
                  ? h('span', { className: 'dsa-tag', 'data-tone': 'muted' }, t('panel.tagNoFiles'))
                  : null,
              ),
            );
          }),
        );
      })();

      return h(
        'section',
        { className: 'dsa-page', 'aria-label': t('panel.title') },
        h(
          'div',
          { className: 'dsa-pageScroll' },
          h(
            'div',
            { className: 'dsa-pageContent' },
            h(
              'div',
              { className: 'dsa-pageHeading' },
              h('h1', null, t('panel.title')),
              h(
                'div',
                { className: 'dsa-headingActions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsa-button',
                    disabled: state.phase === 'loading' || busy,
                    onClick: () => refresh(),
                  },
                  state.phase === 'loading' ? t('panel.refreshing') : t('panel.refresh'),
                ),
              ),
            ),
            summary,
            h(
              'div',
              { className: 'dsa-toolbar' },
              h(
                'label',
                { className: 'dsa-checkbox' },
                h('input', {
                  type: 'checkbox',
                  checked: allSelected,
                  disabled: selectableIds.length === 0 || busy,
                  onChange: toggleAll,
                }),
                h('span', null, t('panel.selectAll')),
              ),
              h('div', { className: 'dsa-toolbarSpacer' }),
              h(
                'select',
                {
                  className: 'dsa-select',
                  value: filter,
                  'aria-label': t('panel.filterLabel'),
                  onChange: (event) => setFilter(event.currentTarget.value),
                },
                h('option', { value: 'all' }, t('panel.filterAll')),
                h('option', { value: 'archived' }, t('panel.filterArchived')),
                h('option', { value: 'idle' }, t('panel.filterIdle')),
              ),
            ),
            body,
            failure !== null
              ? h(
                  'div',
                  { className: 'dsa-error', role: 'alert', style: { marginTop: '12px' } },
                  format(t('panel.partialFailure'), {
                    deleted: failure.deleted,
                    failed: failure.failures.length,
                    detail: failure.failures.map((item) => `${item.title}: ${item.message}`).join('; '),
                  }),
                )
              : null,
            h(
              'div',
              { className: 'dsa-footerBar' },
              h(
                'span',
                { className: 'dsa-selectionText' },
                selectedRows.length === 0
                  ? t('panel.noSelection')
                  : h(
                      'span',
                      null,
                      format(t('panel.selection'), {
                        count: selectedRows.length,
                        size: formatBytes(selectedBytes),
                      }),
                    ),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsa-button',
                  disabled: selectedRows.length === 0 || busy,
                  onClick: () => setSelected(new Set()),
                },
                t('panel.clearSelection'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsa-button',
                  'data-danger': '',
                  disabled: selectedRows.length === 0 || busy,
                  onClick: runDelete,
                },
                busy ? t('panel.deleting') : format(t('panel.deleteSelected'), { count: selectedRows.length }),
              ),
            ),
          ),
        ),
      );
    }

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        const requests = createStore(null);
        const notice = createStore(null);
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-admin: dictionaries');
        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/dsh-session-admin';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => tag.remove();
        }, 'session-admin: styles');

        const requestDelete = (sessionId, displayTitle) => {
          requests.set({ sessionId, displayTitle: typeof displayTitle === 'string' ? displayTitle : '' });
        };
        const deleteSession = (sessionId) => requestHostDelete(sessionId);

        ctx.slots.inject('sidebar.workspaces.session.menu.item', function* () {
          yield ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.menu.item',
              id: 'delete',
              order: 500,
              locale: NS,
              inject: () => ({ requestDelete }),
            },
            DeleteSessionMenuItem,
          );
        });

        const dialogInjected = () => ({ requests, deleteSession, notice });
        ctx.slots.inject('shell.overlay', function* () {
          yield ctx.slots.register(
            { name: 'shell.overlay', id: 'session-admin-dialog', order: 60, locale: NS, inject: dialogInjected },
            DeleteSessionDialog,
          );
          yield ctx.slots.register(
            { name: 'shell.overlay', id: 'session-admin-notice', order: 61, locale: NS, inject: () => ({ notice }) },
            DeleteSessionNotice,
          );
        });

        /* Cleanup panel: a global main-column page plus its sidebar launcher. */
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            { name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ deleteSession }) },
            CleanupPanel,
          ),
        );
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS, label: () => t('panel.title') },
            CleanupIcon,
          ),
        );
      },
    };
  },
});
