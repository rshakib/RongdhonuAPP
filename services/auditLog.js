/**
 * Isolated Audit / Activity Log Engine
 *
 * Captures user-originated local writes (who did what, on which table, with
 * which values changed, on which device and which app) and pushes them to the
 * dedicated, isolated audit Supabase project.
 *
 * Design guarantees:
 *  - Strictly additive: the only integration point in the running app is a
 *    single fire-and-forget call from `enqueueSync` (database.js).
 *  - Never throws into a caller; every path is wrapped in try/catch.
 *  - Fully dormant (no-op) unless the audit project env vars are present.
 *  - Offline-safe: events are written to the local SQLite `audit_outbox` first
 *    and uploaded best-effort in the background.
 *
 * It intentionally does NOT log sync/pull/merge/restore writes: those never
 * call `enqueueSync`, so the log stays free of background noise.
 */

import {
  isAuditConfigured,
  isAuditSyncEnabled,
  insertAuditRows
} from './auditClient.js';

// ─── Tunables ───────────────────────────────────────────────────────────────
const AUDIT_EXCLUDED_TABLES = [
  'sync_queue',
  'sync_queue_supabase',
  'ai_dataset_queue',
  'ai_dataset_history',
  'weather_timeline_queue',
  'activity_logs',
  'audit_outbox',
  'deletions',
  'delete_history',
  'device_registry',
  'device_app_usage',
  'app_config',
  '_backup_metadata'
];

const META_FIELDS = new Set(['is_synced', 'is_synced_supabase']);
const MAX_FIELDS = 40;
const MAX_VALUE_LEN = 200;
const MAX_SNAPSHOT_LEN = 3000;
const PREIMAGE_TTL_MS = 15000;
const PREIMAGE_MAX = 200;
const IDENTITY_TTL_MS = 5000;
const FLUSH_INTERVAL_MS = 20000;   // safety-net cadence
const FLUSH_DEBOUNCE_MS = 400;     // push-to-audit-project delay after a user action
const FLUSH_BATCH = 50;
const OUTBOX_MAX = 5000;

// ─── Dependency seams (overridable in tests) ────────────────────────────────
const DEFAULT_DEPS = {
  getDb: () => require('../database').getDb(),
  getAppConfig: (key) => require('../database').getAppConfig(key),
  getUserByUsername: (username) => require('../database').getUserByUsername(username),
  getActiveProfile: () => require('../database').ACTIVE_APP_PROFILE,
  getDeviceRecord: () => require('./deviceRegistry').getCurrentDeviceRecord(),
  getAppVersion: () => {
    try {
      return require('../app.json').expo?.version || '';
    } catch (_) {
      return '';
    }
  },
  getDhakaDate: (date) => {
    try {
      return require('./dhakaTime.js').getDhakaCalendarDate(date);
    } catch (_) {
      try { return new Date(date).toISOString().slice(0, 10); } catch (__) { return null; }
    }
  },
  insertRows: insertAuditRows,
  isConfigured: isAuditConfigured,
  isEnabled: isAuditSyncEnabled,
  now: () => Date.now()
};
const deps = { ...DEFAULT_DEPS };

let preImages = new Map();
let identityCache = { at: 0, value: null };
let flushTimer = null;
let flushDebounceTimer = null;
let flushInFlight = false;
let flushQueued = false;

// ─── Small helpers ──────────────────────────────────────────────────────────
function isAuditEnabled() {
  try {
    return !!(deps.isConfigured() && deps.isEnabled());
  } catch (_) {
    return false;
  }
}

export function isExcludedTable(tableName) {
  if (!tableName) return true;
  const t = String(tableName).toLowerCase();
  if (t.startsWith('sqlite_')) return true;
  return AUDIT_EXCLUDED_TABLES.includes(t);
}

function isValidTableName(tableName) {
  return typeof tableName === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName);
}

function norm(v) {
  return v === null || v === undefined ? '' : String(v);
}

function truncVal(v) {
  if (v === null || v === undefined) return null;
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > MAX_VALUE_LEN ? `${s.slice(0, MAX_VALUE_LEN)}…` : s;
}

function parseJsonOrNull(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

// ─── SQL parsing (used by the pre-image capture) ────────────────────────────
const WRITE_RE = /^\s*(insert(?:\s+or\s+\w+)?\s+into|update|delete\s+from)\s+["'`[]?([A-Za-z_][A-Za-z0-9_]*)/i;

export function parseWriteSql(sql) {
  if (typeof sql !== 'string' || !sql) return null;
  const s = sql.replace(/^[\s;]+/, '');
  if (!/^(insert|update|delete)/i.test(s)) return null;
  const m = WRITE_RE.exec(s);
  if (!m) return null;
  const verb = m[1].toUpperCase();
  const action = verb.startsWith('INSERT') ? 'INSERT' : verb.startsWith('UPDATE') ? 'UPDATE' : 'DELETE';
  return { action, table: m[2] };
}

export function extractIdParam(sql, params) {
  const list = Array.isArray(params) ? params : [];
  if (typeof sql !== 'string' || !sql) return list.length ? list[list.length - 1] : null;
  const m = /where[\s\S]*?\bid\s*=\s*\?/i.exec(sql);
  if (!m) return list.length ? list[list.length - 1] : null;
  const qIdx = m.index + m[0].length - 1; // index of the '?' right after "id ="
  let n = 0;
  for (let i = 0; i <= qIdx && i < sql.length; i++) {
    if (sql[i] === '?') n++;
  }
  if (n > 0 && n <= list.length) return list[n - 1];
  return list.length ? list[list.length - 1] : null;
}

// ─── Pre-image stash (before → after diffs) ─────────────────────────────────
function preKey(table, action, id) {
  return `${table}|${action}|${String(id)}`;
}

export function stashPreImage(table, action, id, pre) {
  try {
    if (!pre) return;
    const k = preKey(table, action, id);
    preImages.set(k, { at: Date.now(), pre });
    while (preImages.size > PREIMAGE_MAX) {
      const oldest = preImages.keys().next().value;
      preImages.delete(oldest);
    }
  } catch (_) {}
}

export function takePreImage(table, action, id) {
  try {
    const k = preKey(table, action, id);
    const hit = preImages.get(k);
    if (!hit) return null;
    preImages.delete(k);
    if (Date.now() - hit.at > PREIMAGE_TTL_MS) return null;
    return hit.pre;
  } catch (_) {
    return null;
  }
}

/**
 * Called from the SQLite instance wrapper (database.js getDb) BEFORE a write
 * executes, so we can remember the previous row for an accurate diff.
 * Best-effort, never throws, no-op while audit is dormant.
 */
export function capturePreImage(dbInstance, sql, params) {
  try {
    if (!isAuditEnabled()) return;
    if (!dbInstance || typeof dbInstance.getFirstSync !== 'function') return;
    const parsed = parseWriteSql(sql);
    if (!parsed) return;
    if (parsed.action === 'INSERT') return; // nothing existed before
    if (!isValidTableName(parsed.table) || isExcludedTable(parsed.table)) return;

    const id = extractIdParam(sql, params);
    if (id === null || id === undefined || id === '') return;

    const pre = dbInstance.getFirstSync(`SELECT * FROM ${parsed.table} WHERE id = ?`, [String(id)]);
    if (!pre) return;
    stashPreImage(parsed.table, parsed.action, id, pre);
  } catch (_) {}
}

// ─── Identity resolution ────────────────────────────────────────────────────
function resolveIdentity() {
  const nowMs = deps.now();
  if (identityCache.value && nowMs - identityCache.at < IDENTITY_TTL_MS) {
    return identityCache.value;
  }

  const who = {
    appProfile: '',
    appVersion: '',
    userName: '',
    userRole: '',
    deviceId: '',
    deviceName: '',
    deviceModel: '',
    devicePlatform: ''
  };

  try { who.appProfile = String(deps.getActiveProfile() || '').toUpperCase(); } catch (_) {}
  try { who.appVersion = String(deps.getAppVersion() || ''); } catch (_) {}

  try {
    const username = deps.getAppConfig('login_session_user');
    if (username) {
      who.userName = String(username);
      const user = deps.getUserByUsername(username);
      if (user) {
        who.userName = String(user.display_name || user.username || username);
        who.userRole = String(user.role || '').toLowerCase();
      }
    }
  } catch (_) {}

  let deviceRecord = null;
  try {
    deviceRecord = deps.getDeviceRecord();
    if (deviceRecord) {
      who.deviceId = String(deviceRecord.device_id || '');
      who.deviceName = String(deviceRecord.device_name || '');
      who.deviceModel = String(deviceRecord.model || '');
    }
  } catch (_) {}

  // Never store a nameless event: fall back to the device registry, then to the
  // app profile, so every card can show who did it.
  if (!who.userName) {
    const fromDevice = deviceRecord && (deviceRecord.display_name || deviceRecord.user_name || deviceRecord.role);
    if (fromDevice) who.userName = String(fromDevice);
  }
  if (!who.userName) {
    who.userName = who.appProfile ? `${who.appProfile} অ্যাপ` : 'অজানা';
  }
  if (!who.userRole && deviceRecord && deviceRecord.role) {
    who.userRole = String(deviceRecord.role).toLowerCase();
  }

  try {
    const { Platform } = require('react-native');
    who.devicePlatform = String((Platform && Platform.OS) || '');
  } catch (_) {}

  if (!who.userRole) who.userRole = String(who.appProfile || '').toLowerCase();

  identityCache = { at: nowMs, value: who };
  return who;
}

// ─── Diff + snapshot builders ───────────────────────────────────────────────
export function buildChanges(pre, post) {
  const src = post || pre;
  if (!src || typeof src !== 'object') return null;
  const out = {};
  let count = 0;

  for (const key of Object.keys(src)) {
    if (META_FIELDS.has(key)) continue;
    const a = pre ? pre[key] : undefined;
    const b = post ? post[key] : undefined;

    if (pre && post) {
      if (norm(a) === norm(b)) continue;
      out[key] = { from: truncVal(a), to: truncVal(b) };
    } else if (!pre && post) {
      if (b === null || b === undefined || b === '') continue;
      out[key] = { from: null, to: truncVal(b) };
    } else {
      out[key] = { from: truncVal(a), to: null };
    }

    if (++count >= MAX_FIELDS) break;
  }

  return count > 0 ? out : null;
}

export function truncateSnapshot(row) {
  if (!row || typeof row !== 'object') return null;
  const out = {};
  for (const key of Object.keys(row)) {
    if (META_FIELDS.has(key)) continue;
    out[key] = truncVal(row[key]);
  }
  const json = JSON.stringify(out);
  if (json.length <= MAX_SNAPSHOT_LEN) return out;
  return { _truncated: true, _preview: json.slice(0, MAX_SNAPSHOT_LEN) };
}

/**
 * Push to the audit project right after a user action (coalesced): several
 * writes in the same tick produce ONE upload. The 20s timer stays as a
 * backstop, and the local outbox keeps everything safe while offline.
 */
function scheduleImmediateFlush() {
  try {
    if (!isAuditEnabled()) return;
    if (flushDebounceTimer) return;
    flushDebounceTimer = setTimeout(() => {
      flushDebounceTimer = null;
      runFlush();
    }, FLUSH_DEBOUNCE_MS);
  } catch (_) {}
}

function runFlush() {
  if (flushInFlight) {
    flushQueued = true;
    return;
  }
  flushInFlight = true;
  flushAuditOutbox()
    .catch(() => {})
    .then(() => {
      flushInFlight = false;
      if (flushQueued) {
        flushQueued = false;
        scheduleImmediateFlush();
      }
    });
}

// ─── Outbox ─────────────────────────────────────────────────────────────────
function pruneOutbox(db) {
  try {
    db.runSync(
      `DELETE FROM audit_outbox WHERE id NOT IN (SELECT id FROM audit_outbox ORDER BY created_at DESC LIMIT ${OUTBOX_MAX})`
    );
  } catch (_) {}
}

/**
 * Record a user-originated change. Synchronous + never throws.
 * Returns the local event id (or null when skipped).
 */
export function recordActivity({ tableName, recordId, action } = {}) {
  try {
    if (!isAuditEnabled()) return null;
    if (!isValidTableName(tableName) || isExcludedTable(tableName)) return null;

    const table = String(tableName);
    const act = String(action || 'UPDATE').toUpperCase();
    if (act !== 'INSERT' && act !== 'UPDATE' && act !== 'DELETE') return null;

    let db = null;
    try { db = deps.getDb(); } catch (_) { db = null; }
    if (!db || typeof db.runSync !== 'function') return null;

    const id = recordId === null || recordId === undefined ? '' : String(recordId);
    const pre = act === 'INSERT' ? null : takePreImage(table, act, id);

    let post = null;
    if (act === 'INSERT' || act === 'UPDATE') {
      try { post = db.getFirstSync(`SELECT * FROM ${table} WHERE id = ?`, [id]); } catch (_) { post = null; }
    }

    const changes = buildChanges(pre, post);
    const snapshot = truncateSnapshot(post || pre);

    const who = resolveIdentity();
    const nowMs = deps.now();
    const when = new Date(nowMs);
    const iso = when.toISOString();
    let businessDate = null;
    try { businessDate = deps.getDhakaDate(when); } catch (_) { businessDate = null; }

    const eventId = `evt_${nowMs}_${Math.random().toString(36).slice(2, 8)}`;

    db.runSync(
      `INSERT OR REPLACE INTO audit_outbox (
        id, created_at, business_date, app_profile, app_version, user_name, user_role,
        device_id, device_name, device_model, device_platform, table_name, action, record_id,
        changes, snapshot, status, retry_count, last_error, sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, NULL, NULL)`,
      [
        eventId,
        iso,
        businessDate,
        who.appProfile,
        who.appVersion,
        who.userName,
        who.userRole,
        who.deviceId,
        who.deviceName,
        who.deviceModel,
        who.devicePlatform,
        table,
        act,
        id,
        changes ? JSON.stringify(changes) : null,
        snapshot ? JSON.stringify(snapshot) : null
      ]
    );

    pruneOutbox(db);
    scheduleImmediateFlush();
    return eventId;
  } catch (err) {
    console.warn('[AuditLog] recordActivity skipped:', err?.message || err);
    return null;
  }
}

export function toRemoteRow(row) {
  try {
    return {
      event_id: row.id,
      event_at: row.created_at || null,
      business_date: row.business_date || null,
      app_profile: row.app_profile || null,
      app_version: row.app_version || null,
      user_name: row.user_name || null,
      user_role: row.user_role || null,
      device_id: row.device_id || null,
      device_name: row.device_name || null,
      device_model: row.device_model || null,
      device_platform: row.device_platform || null,
      table_name: row.table_name || null,
      action: row.action || null,
      record_id: row.record_id === null || row.record_id === undefined ? null : String(row.record_id),
      changes: parseJsonOrNull(row.changes),
      snapshot: parseJsonOrNull(row.snapshot)
    };
  } catch (_) {
    return null;
  }
}

/** Best-effort upload of pending outbox rows. Never throws. */
export async function flushAuditOutbox() {
  try {
    if (!isAuditEnabled()) return { ok: false, sent: 0 };
    let db = null;
    try { db = deps.getDb(); } catch (_) { db = null; }
    if (!db || typeof db.getAllSync !== 'function') return { ok: false, sent: 0 };

    const rows = db.getAllSync(
      `SELECT * FROM audit_outbox WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT ${FLUSH_BATCH}`
    ) || [];
    if (rows.length === 0) return { ok: true, sent: 0 };

    const payload = rows.map(toRemoteRow).filter(Boolean);
    if (payload.length === 0) return { ok: true, sent: 0 };

    const res = await deps.insertRows(payload);
    if (!res || !res.ok) {
      const err = String((res && res.error) || 'unknown error').slice(0, 200);
      console.warn(`[AuditLog] audit upload failed (${payload.length} event(s) kept locally):`, err);
      for (const r of rows) {
        try {
          db.runSync('UPDATE audit_outbox SET retry_count = retry_count + 1, last_error = ? WHERE id = ?', [err, r.id]);
        } catch (_) {}
      }
      return { ok: false, sent: 0, error: err };
    }

    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    db.runSync(`DELETE FROM audit_outbox WHERE id IN (${placeholders})`, ids);
    return { ok: true, sent: ids.length };
  } catch (err) {
    return { ok: false, sent: 0, error: err?.message || String(err) };
  }
}

export function getAuditOutboxStats() {
  try {
    const db = deps.getDb();
    const total = db.getFirstSync('SELECT COUNT(*) AS n FROM audit_outbox');
    const pending = db.getFirstSync("SELECT COUNT(*) AS n FROM audit_outbox WHERE status = 'PENDING'");
    const last = db.getFirstSync(
      'SELECT last_error FROM audit_outbox WHERE last_error IS NOT NULL ORDER BY retry_count DESC LIMIT 1'
    );
    return {
      total: (total && total.n) || 0,
      pending: (pending && pending.n) || 0,
      lastError: (last && last.last_error) || null
    };
  } catch (_) {
    return { total: 0, pending: 0, lastError: null };
  }
}

export function startAuditService() {
  try {
    if (!isAuditEnabled()) return false;
    if (flushTimer) return true;
    runFlush();
    flushTimer = setInterval(() => { runFlush(); }, FLUSH_INTERVAL_MS);
    return true;
  } catch (_) {
    return false;
  }
}

export function stopAuditService() {
  try {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    if (flushDebounceTimer) {
      clearTimeout(flushDebounceTimer);
      flushDebounceTimer = null;
    }
  } catch (_) {}
}

// ─── Test seams ─────────────────────────────────────────────────────────────
export function __setAuditDepsForTesting(overrides = {}) {
  Object.assign(deps, overrides);
}

export function __resetAuditDepsForTesting() {
  for (const key of Object.keys(DEFAULT_DEPS)) deps[key] = DEFAULT_DEPS[key];
  preImages = new Map();
  identityCache = { at: 0, value: null };
  flushInFlight = false;
  flushQueued = false;
  stopAuditService();
}

export const __internals = {
  parseWriteSql,
  extractIdParam,
  buildChanges,
  truncateSnapshot,
  isExcludedTable,
  stashPreImage,
  takePreImage,
  toRemoteRow
};
