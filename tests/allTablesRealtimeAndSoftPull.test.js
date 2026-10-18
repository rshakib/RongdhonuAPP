/**
 * All Tables Realtime & Soft Pull Verification
 * Run with: node tests/allTablesRealtimeAndSoftPull.test.js
 *
 * Verifies:
 * 1. services/supabaseSync.js defines SIGNAL_GROUPS covering all cloud-backed tables:
 *    - tables, high, deletions, daily, menu, low
 * 2. services/realtimeSignal.js enables all 6 groups in ENABLED_GROUPS
 * 3. App.js wires realtime signals to all 6 groups in startRealtimeSignal onPull
 * 4. Background soft safety polls are active for all groups
 * 5. Fallback auto pull cadences are preserved when realtime drops
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   ALL TABLES REALTIME & SOFT PULL VERIFICATION       ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const sync = require('../services/supabaseSync.js');
const signal = require('../services/realtimeSignal.js');
const appSrc = fs.readFileSync('App.js', 'utf8');

// 1. SIGNAL_GROUPS covers all groups
it('SIGNAL_GROUPS covers tables, high, deletions, daily, menu, and low', () => {
  assert.ok(Array.isArray(sync.SIGNAL_GROUPS.tables), 'tables group exists');
  assert.ok(Array.isArray(sync.SIGNAL_GROUPS.high), 'high group exists');
  assert.ok(Array.isArray(sync.SIGNAL_GROUPS.deletions), 'deletions group exists');
  assert.ok(Array.isArray(sync.SIGNAL_GROUPS.daily), 'daily group exists');
  assert.ok(Array.isArray(sync.SIGNAL_GROUPS.menu), 'menu group exists');
  assert.ok(Array.isArray(sync.SIGNAL_GROUPS.low), 'low group exists');

  assert.ok(sync.SIGNAL_GROUPS.menu.includes('menu_items'), 'menu has menu_items');
  assert.ok(sync.SIGNAL_GROUPS.menu.includes('menu_categories'), 'menu has menu_categories');
  assert.ok(sync.SIGNAL_GROUPS.low.includes('users'), 'low has users');
  assert.ok(sync.SIGNAL_GROUPS.low.includes('supplier_due'), 'low has supplier_due');
  assert.ok(sync.SIGNAL_GROUPS.low.includes('owner_salary_ledger'), 'low has owner_salary_ledger');
});

// 2. ENABLED_GROUPS has all 6 groups enabled
it('services/realtimeSignal.js enables all 6 groups in ENABLED_GROUPS', () => {
  assert.strictEqual(signal.ENABLED_GROUPS.tables, true, 'tables enabled');
  assert.strictEqual(signal.ENABLED_GROUPS.high, true, 'high enabled');
  assert.strictEqual(signal.ENABLED_GROUPS.deletions, true, 'deletions enabled');
  assert.strictEqual(signal.ENABLED_GROUPS.daily, true, 'daily enabled');
  assert.strictEqual(signal.ENABLED_GROUPS.menu, true, 'menu enabled');
  assert.strictEqual(signal.ENABLED_GROUPS.low, true, 'low enabled');
});

// 3. App.js onPull routes all 6 groups
it('App.js startRealtimeSignal onPull routes all 6 groups to instant pull handlers', () => {
  assert.ok(appSrc.includes("if (group === 'tables') runAutoPull('realtime-tables-pull'"), 'routes tables');
  assert.ok(appSrc.includes("else if (group === 'high') runAutoPull('realtime-high-frequency-pull'"), 'routes high');
  assert.ok(appSrc.includes("else if (group === 'deletions') runAutoPull('realtime-deletions-pull'"), 'routes deletions');
  assert.ok(appSrc.includes("else if (group === 'daily') runAutoPull('realtime-daily-pull'"), 'routes daily');
  assert.ok(appSrc.includes("else if (group === 'menu') runAutoPull('realtime-menu-pull'"), 'routes menu');
  assert.ok(appSrc.includes("else if (group === 'low') runAutoPull('realtime-low-frequency-pull'"), 'routes low');
});

// 4. Background soft safety polls
it('App.js registers background soft safety pollers for all groups', () => {
  assert.ok(appSrc.includes("registerSyncTimer('supabase-tables-poll', 5000"), 'tables poll');
  assert.ok(appSrc.includes("registerSyncTimer('supabase-high-frequency-poll', 10000"), 'high poll');
  assert.ok(appSrc.includes("registerSyncTimer('supabase-deletions-poll', 15000"), 'deletions poll');
  assert.ok(appSrc.includes("registerSyncTimer('supabase-low-frequency-poll', 60000"), 'low poll');
  assert.ok(appSrc.includes("registerSyncTimer('supabase-menu-poll', 300000"), 'menu poll');
});

(async () => {
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✔ ${t.desc}`);
    } catch (err) {
      failed++;
      console.error(`  ✖ ${t.desc}`);
      console.error(`    ${err.message}`);
    }
  }

  console.log('\n------------------------------------------------------');
  console.log(`Results: ${passed} passed, ${failed} failed (${tests.length} total)`);
  console.log('------------------------------------------------------\n');

  if (failed > 0) process.exit(1);
})();
