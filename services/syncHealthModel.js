/**
 * syncHealthModel.js — the PURE "did the main server AND the backup both get it?"
 * logic behind the Admin "Data Save Status" screen (SINGLE-SUPABASE build).
 *
 * Kept out of the screen file on purpose: the screen imports react-native, so the logic
 * could not be unit-tested in Node. This module imports nothing.
 *
 * Sources (2): 'supabase1' (the one Supabase project) and 'firebase' (the backup cloud).
 * Legacy heartbeat rows said 'supabase' → treated as supabase1.
 *
 * Inputs
 *  - heartbeats: rows from `sync_heartbeat`
 *  - local:      THIS phone's state — { queues: [...], tables: [{ table, cursors:{supabase1,firebase},
 *                pending:{supabase1,firebase} }] }
 *  - deviceNames:{ device_id: "OPPO A38" } for display (optional)
 *  - dbRefs:     { supabase1: { ref, source } } which project the server points at
 */

export const SOURCES = ['supabase1', 'firebase'];
export const SOURCE_SHORT = { supabase1: 'SB', firebase: 'FB' };
export const SOURCE_BN = { supabase1: 'মূল সার্ভার (Supabase)', firebase: 'ব্যাকআপ (Firebase)' };
/** English labels — the status screen is an operator/technician surface. */
export const SOURCE_EN = { supabase1: 'Main server (Supabase)', firebase: 'Backup (Firebase)' };
export const PROFILE_BN = { ADMIN: 'অ্যাডমিন অ্যাপ', OWNER: 'মালিক অ্যাপ', MANAGER: 'ম্যানেজার অ্যাপ' };
export const PROFILE_EN = { ADMIN: 'Admin app', OWNER: 'Owner app', MANAGER: 'Manager app' };
export const REF_SOURCE_EN = { env: 'build default', override: 'app override', none: 'not set' };
export const REF_SOURCE_BN = { env: 'বিল্ড ডিফল্ট', override: 'অ্যাপ ওভাররাইড', none: 'সেট করা নেই' };

export const SYNC_TOLERANCE_MIN = 2;   // both sides within this → "একসাথে"
export const WARN_LAG_MIN = 10;        // device-level: more than this → warn

/**
 * Technical table names → what a restaurant owner actually calls them. The top of the screen
 * shows these business groups only; raw names stay in the technical toggle.
 */
export const TABLE_GROUPS = [
  { key: 'billing',  labelBn: 'বিল ও অর্ডার',      labelEn: 'Bills & orders',   emoji: '🧾', tables: ['orders', 'order_items', 'payments', 'deliveries'] },
  { key: 'tables',   labelBn: 'টেবিল',              labelEn: 'Tables',           emoji: '🪑', tables: ['restaurant_tables'] },
  { key: 'menu',     labelBn: 'মেনু',               labelEn: 'Menu',             emoji: '🍽️', tables: ['menu_items', 'menu_categories'] },
  { key: 'daily',    labelBn: 'দৈনিক হিসাব',        labelEn: 'Daily accounts',   emoji: '📅', tables: ['daily_submit', 'daily_summary'] },
  { key: 'expense',  labelBn: 'খরচ',                labelEn: 'Expenses',         emoji: '💸', tables: ['expenses', 'owner_expenses'] },
  { key: 'supplier', labelBn: 'বাকি ও সাপ্লায়ার',  labelEn: 'Dues & suppliers', emoji: '📦', tables: ['due_payments', 'supplier_due', 'supplier_due_history', 'supplier_payment_ledger'] },
  { key: 'owner',    labelBn: 'মালিকের হিসাব',      labelEn: "Owner's accounts", emoji: '👤', tables: ['owner_employees', 'owner_salary_ledger', 'owner_deposits', 'owner_home_deposits'] },
  { key: 'users',    labelBn: 'লগইন ও ইউজার',       labelEn: 'Login & users',    emoji: '🔑', tables: ['users'] },
  { key: 'other',    labelBn: 'অন্যান্য',           labelEn: 'Other',            emoji: '🗂️', tables: ['eja_history', 'off_days', 'weather_data', 'delete_history', 'deletions'] }
];

/** Plain status words — no codes, no counts, no abbreviations. */
export const PLAIN_STATUS = {
  ok: 'ঠিক আছে',
  pending: 'পাঠানো বাকি',
  problem: 'সমস্যা আছে',
  none: 'এখনো কিছু নেই'
};

/** Legacy heartbeat rows said 'supabase' for the (then only) project → supabase1. */
export function normalizeSource(backend) {
  const raw = String(backend || '').toLowerCase();
  return raw === 'supabase' ? 'supabase1' : raw;
}

/** Write targets for a table in the single-DB build: the one server + the backup. */
export function targetsFor(_table) {
  return ['supabase1', 'firebase'];
}

function asObjectLoose(v) {
  if (!v) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (_) { return null; } }
  return typeof v === 'object' ? v : null;
}

function lagMin(a, b) {
  if (!a || !b) return null;
  const d = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return Number.isFinite(d) ? Math.round(d / 60000) : null;
}

/** Minutes since an ISO timestamp (null when unknown/future). Pure → testable. */
export function ageMinutes(iso, now = Date.now()) {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const mins = Math.floor((Number(now) - ms) / 60000);
  return mins < 0 ? null : mins;
}

/**
 * Cascading elapsed time, ENGLISH (the status screen is an operator surface):
 *   "45 sec" · "1 min 3 sec" · "2 hour 3 min 5 sec" · "2 day 1 hour 20 min"
 * Pure → unit-testable with an injected `now`.
 */
export function formatElapsedEn(fromIso, now = Date.now()) {
  if (!fromIso) return 'no data';
  const ms = Number(now) - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'no data';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days} day ${hours} hour ${mins} min`;
  if (hours > 0) return `${hours} hour ${mins} min ${secs} sec`;
  if (mins > 0) return `${mins} min ${secs} sec`;
  return `${secs} sec`;
}

/** Same, in Bengali (used where the owner reads it). */
export function formatElapsedBn(fromIso, now = Date.now()) {
  if (!fromIso) return 'তথ্য নেই';
  const ms = Number(now) - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'তথ্য নেই';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days} দিন ${hours} ঘন্টা ${mins} মিনিট`;
  if (hours > 0) return `${hours} ঘন্টা ${mins} মিনিট ${secs} সেকেন্ড`;
  if (mins > 0) return `${mins} মিনিট ${secs} সেকেন্ড`;
  return `${secs} সেকেন্ড`;
}

/**
 * @param {object} input
 * @param {Array}  input.heartbeats   rows from sync_heartbeat
 * @param {object} input.local        readLocalState() output for this phone
 * @param {object} input.deviceNames  { device_id: "OPPO A38" } for display (optional)
 * @param {object} input.dbRefs       { supabase1: { ref, source } } which PROJECT the server points at
 */
export function buildSyncHealthModel({ heartbeats = [], local = null, deviceNames = {}, dbRefs = {} } = {}) {
  // Prefer the human name; fall back to a short id so a missing name is still identifiable.
  const nameOf = (id) => {
    const key = String(id || '');
    if (key && deviceNames && deviceNames[key]) return deviceNames[key];
    if (!key) return 'অজানা ডিভাইস';
    return key.length > 12 ? `${key.slice(0, 12)}…` : key;
  };
  const byDevice = {};
  for (const r of heartbeats || []) {
    if (!r || !r.device_id) continue;
    const src = normalizeSource(r.backend);
    if (!SOURCES.includes(src)) continue;
    byDevice[r.device_id] = byDevice[r.device_id] || {};
    byDevice[r.device_id][src] = r;
  }
  const devices = Object.keys(byDevice).sort();
  const newest = (vals) => vals.filter(Boolean).reduce((m, v) => (!m || v > m ? v : m), null);

  // ── fleet-wide per source (every phone) ────────────────────────────────────
  const sources = {};
  for (const s of SOURCES) {
    const rows = devices.map((d) => byDevice[d][s]).filter(Boolean);
    const pendingTables = {};
    for (const r of rows) {
      const obj = asObjectLoose(r.pending_tables);
      for (const [t, n] of Object.entries(obj || {})) pendingTables[t] = (pendingTables[t] || 0) + (Number(n) || 0);
    }
    const pickLatest = (field) => rows
      .filter((r) => r[field])
      .sort((a, b) => String(b[field]).localeCompare(String(a[field])))[0] || null;
    const readRow = pickLatest('last_read_at');
    const pushRow = pickLatest('last_push_at');

    sources[s] = {
      devices: rows.length,
      lastPushAt: newest(rows.map((r) => r.last_push_at)),
      lastReadAt: newest(rows.map((r) => r.last_read_at)),
      lastRead: readRow ? {
        at: readRow.last_read_at,
        device: String(readRow.device_id || ''),
        deviceLabel: nameOf(readRow.device_id),
        rows: readRow.last_rows == null ? null : Number(readRow.last_rows) || 0,
        appLabel: PROFILE_BN[String(readRow.app_profile || '').toUpperCase()] || 'অজানা অ্যাপ',
        appLabelEn: PROFILE_EN[String(readRow.app_profile || '').toUpperCase()] || 'Unknown app'
      } : null,
      lastPush: pushRow ? {
        at: pushRow.last_push_at,
        device: String(pushRow.device_id || ''),
        deviceLabel: nameOf(pushRow.device_id),
        ok: pushRow.last_push_ok !== false,
        appLabel: PROFILE_BN[String(pushRow.app_profile || '').toUpperCase()] || 'অজানা অ্যাপ',
        appLabelEn: PROFILE_EN[String(pushRow.app_profile || '').toUpperCase()] || 'Unknown app'
      } : null,
      ok: rows.length ? rows.every((r) => r.last_push_ok !== false) : null,
      pendingTables
    };
  }
  const fleetTotal = {};
  for (const s of SOURCES) fleetTotal[s] = Object.values(sources[s].pendingTables).reduce((a, b) => a + b, 0);
  const hasFleet = SOURCES.some((s) => Object.keys(sources[s].pendingTables).length > 0);

  // ── per device × app ───────────────────────────────────────────────────────
  const deviceViews = devices.map((dev) => {
    const by = byDevice[dev];
    const p1 = by.supabase1 || null;
    const fb = by.firebase || null;
    const lag = lagMin(p1 && p1.last_push_at, fb && fb.last_push_at);
    const anyFail = [p1, fb].some((r) => r && r.last_push_ok === false);
    const missing = !p1 && !fb;
    let state = 'ok';
    let line = 'সব সার্ভারে সেভ হচ্ছে';
    if (missing) { state = 'warn'; line = 'কিছু তথ্য এখনো আসেনি'; }
    else if (anyFail) { state = 'bad'; line = 'একটি সার্ভারে সেভ হচ্ছে না'; }
    else if (lag != null && lag > WARN_LAG_MIN) { state = 'warn'; line = `${lag} মিনিট পিছিয়ে আছে`; }
    const profile = (p1 && p1.app_profile) || (fb && fb.app_profile) || '';
    return {
      dev, p1, fb, lag, state, line, profile,
      appLabel: PROFILE_BN[String(profile).toUpperCase()] || 'ফোন',
      appLabelEn: PROFILE_EN[String(profile).toUpperCase()] || 'Phone',
      deviceLabel: nameOf(dev),
      bySource: { supabase1: p1, firebase: fb }
    };
  });
  const badDevices = deviceViews.filter((d) => d.state !== 'ok');

  // ── the 2 DB cards: name + WHERE it points + WHO last WROTE and READ it, and when ──
  const dbCards = SOURCES.map((s) => {
    const ident = dbRefs[s] || {};
    return {
      key: s,
      short: SOURCE_SHORT[s],
      nameBn: SOURCE_BN[s],
      nameEn: SOURCE_EN[s],
      ref: ident.ref || null,
      refSource: ident.source || null,
      refSourceBn: REF_SOURCE_BN[ident.source] || null,
      refSourceEn: REF_SOURCE_EN[ident.source] || null,
      devices: sources[s].devices,
      lastPushAt: sources[s].lastPushAt,
      pushAgeMin: ageMinutes(sources[s].lastPushAt),
      lastPush: sources[s].lastPush,
      pushOk: sources[s].ok,
      pendingTables: sources[s].pendingTables,
      pendingTotal: Object.values(sources[s].pendingTables || {}).reduce((a, n) => a + (Number(n) || 0), 0),
      lastReadAt: sources[s].lastReadAt,
      readAgeMin: ageMinutes(sources[s].lastReadAt),
      lastRead: sources[s].lastRead
    };
  });

  // ── per table: did BOTH sides get it? (single-DB "in step" answer) ──────────
  const tableRows = (local?.tables || []).map((t) => {
    const targets = t.targets || targetsFor(t.table);
    const pendingOf = (src) => (hasFleet ? (sources[src].pendingTables[t.table] || 0) : (t.pending?.[src] || 0));
    const flags = {};
    for (const src of targets) flags[src] = pendingOf(src) === 0;
    const badTargets = targets.filter((src) => !flags[src]);

    const sbCursor = t.cursors?.supabase1 || null;
    const fbCursor = t.cursors?.firebase || null;
    const noInfo = !sbCursor && !fbCursor;
    const readLag = lagMin(sbCursor, fbCursor);

    let label = '— এখনো কিছু যায়নি';
    let tone = 'muted';
    if (!noInfo) {
      if (badTargets.length === 2) { label = `🔴 SB + FB বাকি`; tone = 'bad'; }
      else if (badTargets.length === 1) { label = `⚠️ ${SOURCE_SHORT[badTargets[0]]} বাকি`; tone = 'warn'; }
      else if (readLag != null && readLag > SYNC_TOLERANCE_MIN) { label = `⚠️ ${readLag} মিনিট ফারাক`; tone = 'warn'; }
      else { label = '✅ সব সার্ভারে গেছে'; tone = 'ok'; }
    }
    const group = TABLE_GROUPS.find((g) => g.tables.includes(t.table));
    return {
      ...t, targets, flags, badTargets, label, tone, noInfo, readLag,
      labelBn: group ? group.labelBn : 'অন্যান্য',
      emoji: group ? group.emoji : '🗂️',
      sbCursor, fbCursor
    };
  });

  const inStepRows = tableRows.filter((r) => !r.noInfo && r.tone === 'ok');
  const problemTables = tableRows.filter((r) => r.tone !== 'ok' && !r.noInfo);
  const positionSummary = {
    total: tableRows.length,
    same: inStepRows.length,
    different: problemTables.length,
    missing: tableRows.filter((r) => r.badTargets && r.badTargets.length === 2).length,
    none: tableRows.filter((r) => r.noInfo).length,
    allSame: problemTables.length === 0 && inStepRows.length > 0
  };

  // ── owner-friendly view of the mismatches: ONE CARD PER BUSINESS GROUP ─────
  const problemCards = TABLE_GROUPS
    .map((g) => {
      const rows = problemTables.filter((r) => g.tables.includes(r.table));
      if (!rows.length) return null;
      const worst = rows.reduce((a, b) => ((b.readLag || 0) > (a.readLag || 0) ? b : a), rows[0]);
      const badBoth = rows.some((r) => (r.badTargets || []).length === 2);
      const badNames = [...new Set(rows.flatMap((r) => (r.badTargets || []).map((k) => SOURCE_SHORT[k])))];
      return {
        key: g.key,
        emoji: g.emoji,
        labelBn: g.labelBn,
        labelEn: g.labelEn,
        tables: rows.map((r) => r.table),
        count: rows.length,
        status: badBoth ? 'missing' : 'different',
        worstSpreadMin: worst.readLag || 0,
        lineEn: badBoth
          ? `${badNames.join(' and ')} has not delivered this data yet`
          : (worst.readLag ? `${Math.round(worst.readLag)} min behind` : `${badNames.join(' and ')} still pending`),
        lineBn: badBoth
          ? `${badNames.join(' ও ')} এখনো এই ডেটা পাঠায়নি`
          : (worst.readLag ? `${Math.round(worst.readLag)} মিনিট পিছিয়ে আছে` : `${badNames.join(' ও ')} বাকি`)
      };
    })
    .filter(Boolean);

  const positionTone = problemTables.length ? (positionSummary.missing ? 'bad' : 'warn') : (positionSummary.allSame ? 'ok' : 'unknown');
  const positionVerdict = positionTone === 'ok'
    ? { tone: 'ok', titleBn: 'সব জায়গায় একই ডেটা', hintBn: 'মূল সার্ভার ও ব্যাকআপ — দুটোতেই সব পৌঁছেছে।', titleEn: 'Everything is in step', hintEn: 'Both the main server and the backup received the same data.' }
    : positionTone === 'unknown'
      ? { tone: 'unknown', titleBn: 'এখনো মেলানোর মতো ডেটা আসেনি', hintBn: 'অ্যাপ একটু চালু রাখুন।', titleEn: 'Not enough data to compare yet', hintEn: 'Keep the app open for a little while.' }
      : {
        tone: positionTone,
        titleBn: `${problemCards.length} টি জায়গায় ডেটা মিলছে না`,
        hintBn: 'নিচে কোন জায়গায় সমস্যা তা লেখা আছে। সাধারণত ইন্টারনেট ফিরলেই নিজে থেকে মিলে যায়।',
        titleEn: `${problemCards.length} area(s) are not in step`,
        hintEn: 'The list below shows where. It usually catches up on its own once the internet is back.'
      };

  const positionSummaryEn = `Checked ${positionSummary.total} tables · ${positionSummary.same} in step`
    + (positionSummary.none ? ` · ${positionSummary.none} not arrived yet` : '');
  const positionSummaryBn = `চেক করা হয়েছে ${positionSummary.total} টি টেবিল · একই জায়গায় ${positionSummary.same} টি`
    + (positionSummary.none ? ` · এখনো আসেনি ${positionSummary.none} টি` : '');

  // ── overall verdict ────────────────────────────────────────────────────────
  const anyPushFailed = SOURCES.some((s) => sources[s].ok === false);
  const fleetBacklog = SOURCES.some((s) => fleetTotal[s] > 0);
  const anyPending = fleetBacklog || tableRows.some((r) => r.badTargets.length > 0);
  const overall = !(heartbeats || []).length ? 'unknown'
    : (problemTables.length > 0 || badDevices.some((d) => d.state === 'bad')) ? 'bad'
      : (badDevices.length > 0 || tableRows.some((r) => r.noInfo) || anyPending) ? 'warn'
        : 'ok';

  let verdict;
  if (!(heartbeats || []).length) {
    verdict = { tone: 'unknown', titleBn: 'এখনো তথ্য পাওয়া যায়নি', hintBn: 'অ্যাপ একটু চালু রাখুন, তারপর "Refresh" চাপুন।' };
  } else if (anyPushFailed || overall === 'bad') {
    verdict = { tone: 'bad', titleBn: 'কিছু ডেটা সেভ হয়নি', hintBn: 'ইন্টারনেট চেক করুন। ঠিক না হলে অ্যাডমিনকে জানান।' };
  } else if (anyPending || overall === 'warn') {
    verdict = { tone: 'warn', titleBn: 'কিছু ডেটা সেভ হতে দেরি হচ্ছে', hintBn: 'চিন্তার কিছু নেই। ইন্টারনেট থাকলে এমনিতেই পাঠিয়ে যাবে।' };
  } else {
    verdict = { tone: 'ok', titleBn: 'সব ডেটা ঠিকঠাক সেভ হচ্ছে', hintBn: 'কিছু করার দরকার নেই।' };
  }

  const fleetReadAt = newest(SOURCES.map((s) => sources[s].lastReadAt));

  return {
    devices, deviceViews, badDevices, sources, fleetTotal, hasFleet, tableRows, problemTables, overall,
    verdict, fleetReadAt, anyPushFailed, anyPending,
    dbCards, positionRows: tableRows, positionSummary, problemCards, positionVerdict,
    positionSummaryBn, positionSummaryEn
  };
}
