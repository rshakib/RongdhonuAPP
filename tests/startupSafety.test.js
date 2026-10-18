/**
 * Startup safety — no destructive "test rollback" may run during DB initialization.
 * Run with: node tests/startupSafety.test.js
 *
 * Regression guard for the removed `executeLocalTestRollback()` which ran on EVERY app
 * start (unconditionally, in release builds too) and deleted real rows for 2026-07-26/27
 * plus `app_config.pending_ijara_amount` / `pending_ijara_date`, while logging a
 * hardcoded developer-machine "backup" path that did not exist on a phone.
 */

'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('======================================================');
console.log('   STARTUP SAFETY — NO DESTRUCTIVE TEST ROLLBACK      ');
console.log('======================================================\n');

let passed = 0;
let failed = 0;
const tests = [];
function it(desc, fn) { tests.push({ desc, fn }); }

const dbSrc = fs.readFileSync('database.js', 'utf8');

it('the startup test-rollback helper is gone entirely (definition AND call)', () => {
  assert.ok(!dbSrc.includes('executeLocalTestRollback'), 'no leftover definition or call site');
  assert.ok(!dbSrc.includes('[LOCAL TEST ROLLBACK]'), 'no rollback logging left');
  assert.ok(!/antigravity-cli/.test(dbSrc), 'no hardcoded developer-machine backup path');
});

it('no hardcoded test date is present in the database module', () => {
  assert.ok(!dbSrc.includes('2026-07-26'), 'the hardcoded 2026-07-26 target is gone');
  assert.ok(!dbSrc.includes('exp_2026-07-27_ijara'), 'no hardcoded ijara expense id');
});

it('app_config pending_ijara_* is never blanket-deleted at startup', () => {
  assert.ok(
    !/DELETE FROM app_config WHERE key IN \('pending_ijara_amount', 'pending_ijara_date'\)/.test(dbSrc),
    'the destructive ijara-config delete is gone'
  );
});

it('initDatabase still initializes normally (no collateral damage from the removal)', () => {
  const start = dbSrc.indexOf('export function initDatabase');
  assert.ok(start > -1, 'initDatabase exists');
  const end = dbSrc.indexOf('\nexport function', start + 10);
  const body = end > -1 ? dbSrc.slice(start, end) : dbSrc.slice(start);
  assert.ok(body.includes('Auto Initialization Completed successfully'), 'init still reports completion');
  assert.ok(body.includes('Starting Auto Initialization'), 'init still reports its start');
  assert.ok(!/executeLocal|TestRollback/.test(body), 'the startup path calls no rollback helper');
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
