/**
 * Phase 8 — Manual cloud paths converted to Supabase-primary + Firebase fallback.
 * Run with: node tests/phase8ManualCloudSupabaseFirst.test.js
 *
 * `resyncSameDayFromCloud()` and `restoreDatabaseFromCloud()` now try Supabase
 * FIRST and fall back to the unchanged Firebase implementations.
 *
 * These functions live in database.js, which imports expo-sqlite at load time and
 * therefore cannot be executed in plain Node — so this suite asserts on the code
 * structure + the App.js wiring (the same approach used by the phase7 source tests).
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   PHASE 8 — MANUAL CLOUD: SUPABASE-FIRST VERIFICATION ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const db = fs.readFileSync('database.js', 'utf8');
const app = fs.readFileSync('App.js', 'utf8');

// ---------------------------------------------------------------------------
// 1. restoreDatabaseFromCloud() — Supabase-first + Firebase fallback
// ---------------------------------------------------------------------------
it('restore: wrapper is Supabase-first with a Firebase fallback', () => {
  assert.ok(db.includes("export async function restoreDatabaseFromCloud({ mode = 'full', supabaseFirst = false, skipCollections = null } = {})"), 'wrapper signature + supabaseFirst flag');
  assert.ok(db.includes("require('./services/supabaseSync.js')"), 'lazy Supabase import (no static cycle)');
  assert.ok(db.includes('supa.isSupabasePrimaryHealthy()'), 'health gate');
  assert.ok(db.includes('supa.restoreSupabaseWindow({'), 'reuses the Phase-3 Supabase restore');
  assert.ok(db.includes('return await restoreFirebaseFromCloud({ mode });'), 'falls back to full Firebase on Supabase failure');
  assert.ok(db.includes('...(supaRes.failedCollections || []), ...(fbRes.failedCollections || [])'), 'failed list = union of both passes (honest)');
});

it('restore: default (supabaseFirst=false) === legacy Firebase-only path', () => {
  assert.ok(db.includes('if (!supabaseFirst) {'), 'early return when not Supabase-first');
  assert.ok(db.includes('return await restoreFirebaseFromCloud({ mode, skipCollections });'), 'straight to Firebase (hybrid fallback unchanged)');
});

it('restore: Firebase pass only covers the Firebase-only scope (skip filter)', () => {
  assert.ok(db.includes("async function restoreFirebaseFromCloud({ mode = 'full', skipCollections = null } = {})"), 'firebase impl keeps its own name');
  assert.ok(db.includes('filter((t) => !skip.has(t))'), 'alwaysFull/recentOnly/skipRestoreMarkers filtered by skip');
  assert.ok(db.includes("'restaurant_tables',") && db.includes("...(profile.recentOnly || [])"), 'Supabase scope = tables + recent window + menu/daily');
});

// ---------------------------------------------------------------------------
// 2. resyncSameDayFromCloud() — Supabase-first + Firebase fallback
// ---------------------------------------------------------------------------
it('resync: Supabase-primary helper exists and reuses the Supabase sync fns', () => {
  assert.ok(db.includes('async function resyncSameDayFromSupabase(todayStr, status, supa)'), 'helper defined');
  assert.ok(db.includes('await supa.syncSupabaseTables();'), 'reuses syncSupabaseTables');
  assert.ok(db.includes('await supa.syncSupabaseHighFrequencyCollections();'), 'reuses high-freq sync');
  assert.ok(db.includes('await supa.syncSupabaseLowFrequencyCollections();'), 'reuses low-freq sync');
  assert.ok(db.includes('await supa.syncSupabaseMenu();'), 'reuses menu sync');
  assert.ok(db.includes('last_sync_time_supabase_${t}'), 'resets the Supabase cursors for today\'s window');
});

it('resync: Supabase branch returns early on success, else falls through to Firebase', () => {
  assert.ok(db.includes('if (supaRes && supaRes.success) return supaRes;'), 'returns Supabase result when successful');
  assert.ok(db.includes("source: 'supabase'"), 'reports the source');
  assert.ok(db.includes('// 2. SAFETY FIRST: Fetch raw records from Firebase Firestore'), 'Firebase fetch step intact');
  assert.ok(db.includes("// 4. ATOMIC LOCAL WIPE OF TODAY'S DATA IN SQLITE"), 'Firebase wipe step intact');
  assert.ok(db.includes('count: totalRestored,'), 'Firebase success shape (with a real count) intact');
});

it('resync: BOTH paths perform the SAME scoped wipe (shared helper)', () => {
  assert.ok(db.includes('function wipeLocalTodayScoped(todayStr)'), 'shared wipe helper defined');
  assert.strictEqual((db.match(/wipeLocalTodayScoped\(todayStr\);/g) || []).length, 2, 'helper invoked by both the Supabase and Firebase resync paths');
  assert.ok(db.includes("DELETE FROM orders WHERE date(created_at, 'localtime') = ?"), 'orders wipe SQL');
  assert.ok(db.includes('DELETE FROM supplier_payment_ledger WHERE payment_date = ? OR id = ?'), 'supplier ledger wipe SQL');
  assert.ok(db.includes('DELETE FROM sync_queue WHERE (table_name IN'), 'today-scoped queue cleanup present');
});

it('wipe is resync-ONLY: the periodic Supabase syncers still merge, never wipe', () => {
  const supaSync = fs.readFileSync('services/supabaseSync.js', 'utf8');
  assert.ok(!/DELETE FROM (orders|order_items|payments|expenses|deliveries|daily_submit|daily_summary|due_payments)\b/.test(supaSync), 'no table wipe inside services/supabaseSync.js');
  assert.ok(supaSync.includes('mergeSupabaseRows'), 'periodic path still merges (unchanged)');
  assert.ok(supaSync.includes('INSERT OR REPLACE INTO ${table}'), 'merge upsert unchanged');
});

// ---------------------------------------------------------------------------
// 3. Honest reporting (no false success)
// ---------------------------------------------------------------------------
it('resync: both-path failure still surfaces the honest error', () => {
  assert.ok(db.includes('ডাটাবেজ আপডেটে সমস্যা'), 'local DB error surfaced');
  assert.ok(app.includes('Alert.alert("ব্যর্থ", res.error || res.message'), 'resync failure alert intact');
  assert.ok(db.includes("error: 'Supabase sync failed during resync'"), 'Supabase mid-flight failure reported to the caller');
});

it('restore: failure still surfaces the failed-table list', () => {
  assert.ok(app.includes('Alert.alert("ব্যর্থ", `ডাটা রিস্টোর করতে সমস্যা'), 'restore failure alert intact');
  assert.ok(app.includes('failedList'), 'failed-collection list still shown');
});

it('resync alert is source-aware and count-optional (no fabricated numbers)', () => {
  assert.ok(app.includes("const srcLabel = res.source === 'supabase' ? 'Supabase' : 'Firebase'"), 'source label');
  assert.ok(app.includes('res.count != null ?'), 'count shown only when present');
});

// ---------------------------------------------------------------------------
// 4. App.js wiring
// ---------------------------------------------------------------------------
it('App.js: manual buttons route through the converted paths', () => {
  assert.ok(app.includes("restoreDatabaseFromCloud({ mode: 'full', supabaseFirst: true })"), 'Cloud Restore passes supabaseFirst');
  assert.ok(app.includes('await resyncSameDayFromCloud()'), 'Same-Day Resync calls the converted fn');
});

(async () => {
  for (const t of tests) {
    try { await t.fn(); passed++; console.log(`  ✅  ${t.desc}`); }
    catch (err) { failed++; console.error(`  ❌  ${t.desc}`); console.error(`      ${err.message}`); }
  }
  console.log('\n------------------------------------------------------');
  console.log(`Tests Passed: ${passed}`);
  console.log(`Tests Failed: ${failed}`);
  console.log('======================================================\n');
  if (failed > 0) process.exit(1);
})();
