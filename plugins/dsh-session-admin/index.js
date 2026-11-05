/**
 * Host half of the session-admin bundle: permanently delete one stored Session
 * and every artifact the DSH runtimes keep for it.
 *
 * Deletion is a four-part operation, because the registry, the projection
 * cache, and the JSONL backend each hold their own copy of "this Session
 * exists":
 *
 *   1. the workspace registry's archive / pin sets and the owning Workspace's
 *      ordered `sessionIds` account,
 *   2. the persisted projection-cache record,
 *   3. the JSONL session directory (log generations plus the write lock),
 *   4. the client Session list, told to drop the row.
 *
 * Steps 1-3 run through public service methods only, so the registry's own
 * cache can never be clobbered by a stale copy. A running Agent refuses the
 * whole operation: its write handle keeps the kernel lock and would leave a
 * half-deleted Session behind.
 *
 * @module @local/dsh-session-admin
 */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Route the browser posts a deletion request to (shared Connection channel). */
const DELETE_PATH = '/api/sessionAdmin/delete';

/** Route the browser posts a storage-inventory request to. */
const INVENTORY_PATH = '/api/sessionAdmin/inventory';

/** Route the browser probes storage compatibility with. */
const STATUS_PATH = '/api/sessionAdmin/status';

/**
 * Path of the durable cleanup queue: Sessions whose registry rows are already
 * gone but whose log files must still be unlinked at the next start, because a
 * resident Agent could rewrite them after the delete.
 */
const PENDING_PATH = join(dshHome(), 'storages', 'session_admin_pending.json');

/**
 * Sessions deleted during this process. A resident Agent keeps its Session in
 * the in-memory store, so the Host would otherwise list it again after a
 * refresh; the tombstone hides it until the process restarts.
 */
const tombstones = new Set();

/** DSH home, matching `dshHomePath()` precedence: `$DSH_HOME`, then `~/.dsh`. */
function dshHome() {
  const configured = process.env.DSH_HOME;
  return configured !== undefined && configured.trim().length > 0 ? configured : join(homedir(), '.dsh');
}

/**
 * Encode a Session id as one filesystem-safe directory name.
 *
 * This mirrors the JSONL backend's `encodeSegment`: safe code units stay
 * literal and every other UTF-16 unit becomes `~XXXX`. The encoding is
 * injective, so matching directory names identifies exactly one Session
 * without re-deriving the project directory from its (possibly moved) cwd.
 *
 * @param raw - the Session id.
 * @returns the encoded single path segment.
 */
function encodeSegment(raw) {  if (raw === '.') return '~002E';
  if (raw === '..') return '~002E~002E';
  let out = '';
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    const character = String.fromCharCode(code);
    if (character !== '~' && /^[A-Za-z0-9._-]$/.test(character)) out += character;
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0');
  }
  return out;
}

/** One request-scoped failure carrying an HTTP status and a stable code. */
class DeleteFailure extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Byte size of one regular file, or 0 when it has gone. */
async function fileBytes(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}

/** Recursive byte size of a directory, tolerating races with concurrent writers. */
async function directoryBytes(path) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const child = join(path, entry.name);
    total += entry.isDirectory() ? await directoryBytes(child) : await fileBytes(child);
  }
  return total;
}

/**
 * Delete the JSONL artifacts of one Session: every `<sessions root>/<project>`
 * entry whose directory name is that Session's encoded id.
 *
 * @param sessionId - Session whose directories are removed.
 * @returns the released byte count and the removed directory paths.
 */
async function removeSessionDirectories(sessionId) {
  const sessions = await findSessionDirectories(sessionId);
  let freedBytes = 0;
  const removed = [];
  for (const { path, bytes } of sessions) {
    await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    freedBytes += bytes;
    removed.push(path);
  }
  return { freedBytes, removed };
}

/**
 * Locate one Session's on-disk directories, with their current size.
 *
 * The same id can appear under more than one project directory when a Session
 * was resumed after its workspace moved, so every match is returned.
 *
 * @param sessionId - Session whose directories are located.
 * @returns the matching directories and their byte sizes.
 */
async function findSessionDirectories(sessionId) {
  const root = join(dshHome(), 'sessions');
  const encoded = encodeSegment(sessionId);
  let projectDirectories;
  try {
    projectDirectories = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const found = [];
  for (const project of projectDirectories) {
    if (!project.isDirectory()) continue;
    const path = join(root, project.name, encoded);
    const present = await exists(path);
    if (!present) continue;
    found.push({ path, bytes: await directoryBytes(path) });
  }
  return found;
}

/** Whether a path exists at all (a directory empty of files still counts). */
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete the persisted projection-cache record.
 *
 * The cache service keeps the `session_projcache` domain open while it is
 * mounted, and that domain serves reads from memory: removing only the file
 * would let a later checkpoint write the row back. The record is therefore
 * deleted through its table first (durability included) and the standalone
 * document is unlinked as well, so a domain that is closed, mid-teardown, or
 * keyed differently cannot leave an orphan behind.
 *
 * @param ctx - Host context carrying the storage hub.
 * @param sessionId - Session whose cache row is removed.
 * @returns the released byte count.
 */
async function removeProjectionCache(ctx, sessionId) {
  const path = join(dshHome(), 'storages', 'session_projcache', 'sessions', `${encodeSegment(sessionId)}.json`);
  const bytes = await fileBytes(path);
  const domain = ctx.get('storageDomain')?.get('session_projcache');
  if (domain !== undefined) {
    try {
      await domain.table('sessions').delete(sessionId);
    } catch {
      /* A closed or mid-teardown domain falls through to the file unlink. */
    }
  }
  await rm(path, { force: true, maxRetries: 3, retryDelay: 50 });
  return bytes;
}

/**
 * Drop one Session from the workspace registry: its archive mark, its pin, and
 * its ordered slot in the owning Workspace account.
 *
 * @param ctx - Host context carrying the Workspace registry.
 * @param sessionId - Session to detach.
 */
async function detachFromWorkspaces(ctx, sessionId) {
  const registry = ctx.workspaceRegistry;
  await registry.unarchiveSession(sessionId);
  await registry.unpinSession(sessionId);
  for (const workspace of registry.list()) {
    if (!workspace.sessionIds.includes(sessionId)) continue;
    await workspace.detachSession(sessionId);
  }
}

/**
 * Preflight verification: ensure storage structure matches supported DSH layout.
 * Requires:
 *   1. DSH home directory
 *   2. sessions directory
 *   3. storages/session_projcache/sessions directory
 * Returns { valid: true } or { valid: false, reason: string }.
 */
async function verifyStorageStructure() {
  const home = dshHome();
  const sessionsDir = join(home, 'sessions');
  const projCacheDir = join(home, 'storages', 'session_projcache', 'sessions');

  const targets = [
    { name: 'DSH home directory', path: home },
    { name: 'Sessions directory', path: sessionsDir },
    { name: 'Projection cache directory', path: projCacheDir },
  ];

  for (const target of targets) {
    try {
      const s = await stat(target.path);
      if (!s.isDirectory()) {
        return { valid: false, reason: `${target.name} at "${target.path}" is not a directory` };
      }
    } catch {
      return { valid: false, reason: `${target.name} not found at "${target.path}"` };
    }
  }

  return { valid: true };
}

/**
 * Permanently delete one Session.
 *
 * A Session whose Agent is resident in this process still holds its log in
 * memory and writes it again on the next append or on teardown. The registry
 * and the projection cache are therefore cleared immediately (the row leaves
 * the list), the files are removed best-effort now, and any Session that was
 * attached is also queued so the next start removes whatever the departing
 * writer recreated.
 *
 * @param ctx - Host context with Connection, Session, Workspace, and storage services.
 * @param sessionId - Session identity from the browser request.
 * @returns the released byte count, removed paths, and whether cleanup was queued.
 * @throws {DeleteFailure} for a missing id or a running Agent.
 */
async function deleteSession(ctx, sessionId) {
  const storageCheck = await verifyStorageStructure();
  if (!storageCheck.valid) {
    throw new DeleteFailure(500, 'session-admin/storage-incompatible', storageCheck.reason);
  }
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw new DeleteFailure(400, 'session-admin/invalid-id', 'sessionId must be a non-empty string');
  }
  const agent = ctx.agents.get(sessionId);
  if (agent !== undefined && agent.status === 'running') {
    throw new DeleteFailure(409, 'session-admin/running', 'the Session is running; stop it before deleting');
  }
  const stored = await ctx.sessionPersistence.stat(sessionId);
  if (stored === undefined) {
    throw new DeleteFailure(404, 'session-admin/not-found', `no stored Session "${sessionId}"`);
  }
  const attached = ctx.sessions.get(sessionId) !== undefined || agent !== undefined;
  /*
   * Queue first, while nothing has been touched: a failed queue write must not
   * leave the registry detach done and the files still present. The queue is
   * best-effort — the deletion itself proceeds either way, because the registry
   * row is what makes a Session reachable, and the log is unlinked right here.
   */
  let queued = false;
  if (attached) {
    try {
      await queueForRemoval(sessionId);
      queued = true;
    } catch (error) {
      ctx.logger?.warn?.(`session-admin: could not queue cleanup for "${sessionId}": ${String(error)}`);
    }
  }
  await detachFromWorkspaces(ctx, sessionId);
  const cacheBytes = await removeProjectionCache(ctx, sessionId);
  let directories = { freedBytes: 0, removed: [] };
  try {
    directories = await removeSessionDirectories(sessionId);
  } catch (error) {
    /* A handle still open on the log: the queued pass removes it at next start. */
    ctx.logger?.warn?.(`session-admin: log removal for "${sessionId}" deferred: ${String(error)}`);
    if (!queued && attached) {
      try {
        await queueForRemoval(sessionId);
        queued = true;
      } catch (queueError) {
        ctx.logger?.warn?.(`session-admin: could not queue cleanup for "${sessionId}": ${String(queueError)}`);
      }
    }
  }
  tombstones.add(sessionId);
  /* The row leaves the client list even when only the registry knew this id. */
  ctx.emit('api-session/removed', sessionId);
  return {
    sessionId,
    freedBytes: cacheBytes + directories.freedBytes,
    removedPaths: directories.removed,
    queued,
  };
}

/** Read the cleanup queue, tolerating absence and corruption. */
async function readPending() {
  try {
    const parsed = JSON.parse(await readFile(PENDING_PATH, 'utf8'));
    const ids = Array.isArray(parsed?.sessionIds) ? parsed.sessionIds : [];
    return ids.filter((id) => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

/** Persist the cleanup queue atomically (write a sibling, then rename over it). */
async function writePending(sessionIds) {
  const unique = [...new Set(sessionIds)];
  if (unique.length === 0) {
    await rm(PENDING_PATH, { force: true });
    return;
  }
  await mkdir(dirname(PENDING_PATH), { recursive: true });
  const temporary = `${PENDING_PATH}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: 1, sessionIds: unique }, null, 2), 'utf8');
  await rename(temporary, PENDING_PATH);
}

/** Add one Session id to the cleanup queue. */
async function queueForRemoval(sessionId) {
  const pending = await readPending();
  if (!pending.includes(sessionId)) await writePending([...pending, sessionId]);
}

/**
 * Drain the cleanup queue: unlink every queued Session's remaining artifacts,
 * keeping ids that still fail so a later start retries them.
 *
 * Runs at plugin start, before this process can attach any of those Sessions.
 *
 * @param ctx - Host context used for logging.
 * @returns the number of Sessions cleaned.
 */
async function drainPending(ctx) {
  const pending = await readPending();
  if (pending.length === 0) return 0;
  const remaining = [];
  let cleaned = 0;
  for (const sessionId of pending) {
    try {
      await removeProjectionCache(ctx, sessionId);
      await removeSessionDirectories(sessionId);
      cleaned += 1;
    } catch (error) {
      remaining.push(sessionId);
      ctx.logger?.warn?.(`session-admin: deferred cleanup of "${sessionId}" failed: ${String(error)}`);
    }
  }
  await writePending(remaining);
  if (cleaned > 0) ctx.logger?.info?.(`session-admin: cleaned ${String(cleaned)} deleted Session(s)`);
  return cleaned;
}

/** Read and validate one JSON request body. */
async function readJsonBody(request) {
  const text = await request.text();
  if (text.length === 0) throw new DeleteFailure(400, 'session-admin/bad-request', 'a JSON body is required');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DeleteFailure(400, 'session-admin/bad-request', 'the request body is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DeleteFailure(400, 'session-admin/bad-request', 'the request body must be a JSON object');
  }
  return parsed;
}

/** One JSON response for either outcome. */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/**
 * Handle one authenticated deletion request.
 *
 * @param ctx - Host context owning the operation.
 * @param request - authenticated HTTP request from Connection.
 * @returns the JSON result, using HTTP 200 for a completed deletion.
 */
async function handleDeleteHttp(ctx, request) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  const storageCheck = await verifyStorageStructure();
  if (!storageCheck.valid) {
    return jsonResponse(
      { ok: false, error: { code: 'session-admin/storage-incompatible', message: storageCheck.reason, details: {} } },
      500,
    );
  }
  try {
    const body = await readJsonBody(request);
    return jsonResponse({ ok: true, value: await deleteSession(ctx, body.sessionId) });
  } catch (error) {
    if (error instanceof DeleteFailure) {
      return jsonResponse({ ok: false, error: { code: error.code, message: error.message, details: {} } }, error.status);
    }
    const message = error instanceof Error ? error.message : String(error);
    ctx.logger?.warn?.(`session-admin: delete failed: ${message}`);
    return jsonResponse({ ok: false, error: { code: 'session-admin/internal', message, details: {} } }, 500);
  }
}

/**
 * Report every stored Session with its on-disk footprint, for the cleanup panel.
 *
 * Sizes are read fresh on each call rather than cached: the whole point of the
 * panel is deciding what to delete, so a stale number would be worse than a
 * slightly slower refresh. Sessions are reported from persistence (not the
 * client list) so a row can never be missing just because the browser has not
 * materialized it yet.
 *
 * @param ctx - Host context carrying the Session and Workspace services.
 * @returns one row per stored Session, largest first.
 */
async function inventory(ctx) {
  const live = new Set(ctx.sessions.list().map((session) => String(session.id)));
  const archived = new Set(ctx.workspaceRegistry.archivedSessionIds.map(String));
  const cwdBySession = new Map();
  for (const workspace of ctx.workspaceRegistry.list()) {
    for (const id of workspace.sessionIds) cwdBySession.set(String(id), workspace.title);
  }
  const stored = await ctx.sessionPersistence.list();
  const pending = new Set(await readPending());
  const rows = [];
  for (const snapshot of stored) {
    const sessionId = String(snapshot.header.id);
    /* A tombstoned Session is deleted but its Agent still holds it in memory. */
    if (tombstones.has(sessionId)) continue;
    const directories = await findSessionDirectories(sessionId);
    let bytes = directories.reduce((total, entry) => total + entry.bytes, 0);
    bytes += await fileBytes(
      join(dshHome(), 'storages', 'session_projcache', 'sessions', `${encodeSegment(sessionId)}.json`),
    );
    const agent = ctx.agents.get(snapshot.header.id);
    rows.push({
      sessionId,
      bytes,
      createdAt: snapshot.header.createdAt,
      workspaceTitle: cwdBySession.get(sessionId) ?? '',
      archived: archived.has(sessionId),
      /* Attached means resident in this process: files clear at the next start. */
      attached: live.has(sessionId),
      pendingCleanup: pending.has(sessionId),
      running: agent !== undefined && agent.status === 'running',
      missingArtifacts: directories.length === 0,
    });
  }
  rows.sort((left, right) => right.bytes - left.bytes || right.createdAt - left.createdAt);
  return {
    rows,
    totals: {
      count: rows.length,
      bytes: rows.reduce((total, row) => total + row.bytes, 0),
      archivedBytes: rows.reduce((total, row) => total + (row.archived ? row.bytes : 0), 0),
      /* Bytes that will be gone after the next start, from queued cleanup. */
      pendingBytes: rows.reduce((total, row) => total + (row.pendingCleanup ? row.bytes : 0), 0),
    },
  };
}

/**
 * Handle one authenticated inventory request.
 *
 * @param ctx - Host context owning the operation.
 * @param request - authenticated HTTP request from Connection.
 * @returns the JSON inventory.
 */
async function handleInventoryHttp(ctx, request) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  const storageCheck = await verifyStorageStructure();
  if (!storageCheck.valid) {
    return jsonResponse(
      { ok: false, error: { code: 'session-admin/storage-incompatible', message: storageCheck.reason, details: {} } },
      500,
    );
  }
  try {
    return jsonResponse({ ok: true, value: await inventory(ctx) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.logger?.warn?.(`session-admin: inventory failed: ${message}`);
    return jsonResponse({ ok: false, error: { code: 'session-admin/internal', message, details: {} } }, 500);
  }
}

/**
 * Handle one authenticated status probe request.
 *
 * @param ctx - Host context owning the operation.
 * @param request - authenticated HTTP request from Connection.
 * @returns compatibility status.
 */
async function handleStatusHttp(ctx, request) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } });
  const storageCheck = await verifyStorageStructure();
  if (!storageCheck.valid) {
    return jsonResponse(
      { ok: false, error: { code: 'session-admin/storage-incompatible', message: storageCheck.reason, details: {} } },
      500,
    );
  }
  return jsonResponse({ ok: true, value: { compatible: true } });
}

/**
 * Register the authenticated deletion and inventory routes for the browser half.
 *
 * @param ctx - Host context carrying Connection, Session, Workspace, and storage services.
 */
export function apply(ctx) {
  verifyStorageStructure().then((res) => {
    if (!res.valid) {
      ctx.logger?.warn?.(`[session-admin] Storage structure incompatible: ${res.reason}. Session admin operations disabled.`);
    }
  });
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: STATUS_PATH,
        methods: ['GET'],
        fetch: (request) => handleStatusHttp(ctx, request),
      }),
    'session-admin: status route',
  );
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: DELETE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => handleDeleteHttp(ctx, request),
      }),
    'session-admin: delete route',
  );
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: INVENTORY_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => handleInventoryHttp(ctx, request),
      }),
    'session-admin: inventory route',
  );
  /*
   * Clean up Sessions deleted during a previous run. This runs at activation,
   * before this process can attach any of them, so their logs are safe to
   * unlink here even though their Agents outlived the previous delete.
   */
  void drainPending(ctx).catch((error) => {
    ctx.logger?.warn?.(`session-admin: cleanup queue drain failed: ${String(error)}`);
  });
}

export const inject = ['connection', 'agents', 'sessions', 'sessionPersistence', 'workspaceRegistry'];
