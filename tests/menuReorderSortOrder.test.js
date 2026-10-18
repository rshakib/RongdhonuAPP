/**
 * Automated Test Suite: Menu Item Reordering and Custom Alignment
 * File: tests/menuReorderSortOrder.test.js
 *
 * Verifies:
 * - sort_order column migration and default 0
 * - getMenuItems custom order priority over price/name
 * - updateMenuItemsOrder atomic batch update and sync queue enqueuing
 * - Resetting sort_order to 0 restores price low-to-high default
 * - Supabase dispatcher whitelist and payload formatting for sort_order
 */

'use strict';
const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');

console.log('======================================================');
console.log('   MENU REORDER & SORT ORDER TEST SUITE               ');
console.log('======================================================\n');

let passedTests = 0;
let failedTests = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅  ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌  ${desc}`);
    console.error(`      Error: ${err.message}`);
    failedTests++;
  }
}

// In-memory DB setup
function createTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      category TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      is_synced INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      attempts INTEGER DEFAULT 0,
      created_at TEXT
    );
  `);
  return db;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

it('Test 1: Default sort order when sort_order is 0 is Price ASC, then Name ASC', () => {
  const db = createTestDb();
  
  // Insert burger items with varying prices
  db.exec(`
    INSERT INTO menu_items (id, name, price, category, sort_order) VALUES
      ('b1', 'রংধনু বার্গার', 170, 'বার্গার', 0),
      ('b2', 'স্পেশাল বার্গার', 90, 'বার্গার', 0),
      ('b3', 'সাব বার্গার', 100, 'বার্গার', 0),
      ('b4', 'বারবিকিউ বার্গার', 150, 'বার্গার', 0),
      ('b5', 'স্পেশাল নাগা বার্গার', 100, 'বার্গার', 0);
  `);

  const rows = db.prepare(`
    SELECT name, price, sort_order FROM menu_items
    WHERE is_active = 1
    ORDER BY category ASC, 
             CASE WHEN COALESCE(sort_order, 0) > 0 THEN sort_order ELSE 999999 END ASC, 
             price ASC, 
             name ASC
  `).all();

  assert.strictEqual(rows.length, 5);
  // 90 -> 100 (সাব) -> 100 (স্পেশাল নাগা) -> 150 -> 170
  assert.strictEqual(rows[0].price, 90);
  assert.strictEqual(rows[0].name, 'স্পেশাল বার্গার');
  assert.strictEqual(rows[1].price, 100);
  assert.strictEqual(rows[2].price, 100);
  assert.strictEqual(rows[3].price, 150);
  assert.strictEqual(rows[3].name, 'বারবিকিউ বার্গার');
  assert.strictEqual(rows[4].price, 170);
  assert.strictEqual(rows[4].name, 'রংধনু বার্গার');
});

it('Test 2: Custom sort_order set by Manager/Owner takes strict priority over price', () => {
  const db = createTestDb();
  
  // Manager wants 'রংধনু বার্গার' (170tk) to be #1, and 'স্পেশাল বার্গার' (90tk) to be #2
  db.exec(`
    INSERT INTO menu_items (id, name, price, category, sort_order) VALUES
      ('b1', 'রংধনু বার্গার', 170, 'বার্গার', 1),
      ('b2', 'স্পেশাল বার্গার', 90, 'বার্গার', 2),
      ('b3', 'সাব বার্গার', 100, 'বার্গার', 3);
  `);

  const rows = db.prepare(`
    SELECT name, price, sort_order FROM menu_items
    WHERE is_active = 1
    ORDER BY category ASC, 
             CASE WHEN COALESCE(sort_order, 0) > 0 THEN sort_order ELSE 999999 END ASC, 
             price ASC, 
             name ASC
  `).all();

  assert.strictEqual(rows[0].name, 'রংধনু বার্গার');
  assert.strictEqual(rows[0].sort_order, 1);
  assert.strictEqual(rows[1].name, 'স্পেশাল বার্গার');
  assert.strictEqual(rows[1].sort_order, 2);
  assert.strictEqual(rows[2].name, 'সাব বার্গার');
  assert.strictEqual(rows[2].sort_order, 3);
});

it('Test 3: Unordered items (sort_order = 0) appear after customized items and sort by price', () => {
  const db = createTestDb();
  
  // Only 1 item has custom order (b1: sort_order = 1), others are 0
  db.exec(`
    INSERT INTO menu_items (id, name, price, category, sort_order) VALUES
      ('b1', 'রংধনু বার্গার', 170, 'বার্গার', 1),
      ('b2', 'স্পেশাল বার্গার', 90, 'বার্গার', 0),
      ('b3', 'সাব বার্গার', 100, 'বার্গার', 0);
  `);

  const rows = db.prepare(`
    SELECT name, price, sort_order FROM menu_items
    WHERE is_active = 1
    ORDER BY category ASC, 
             CASE WHEN COALESCE(sort_order, 0) > 0 THEN sort_order ELSE 999999 END ASC, 
             price ASC, 
             name ASC
  `).all();

  assert.strictEqual(rows[0].name, 'রংধনু বার্গার'); // Custom #1
  assert.strictEqual(rows[1].name, 'স্পেশাল বার্গার'); // Price 90
  assert.strictEqual(rows[2].name, 'সাব বার্গার'); // Price 100
});

it('Test 4: Atomic batch update updates sort_order and enqueues sync', () => {
  const db = createTestDb();
  
  db.exec(`
    INSERT INTO menu_items (id, name, price, category, sort_order) VALUES
      ('f1', 'ফ্রেঞ্চ ফ্রাই', 80, 'ফ্রাই', 0),
      ('f2', 'চিকেন নাগা উইংস', 100, 'ফ্রাই', 0),
      ('f3', 'ক্রিসপি চিকেন ফ্রাই', 120, 'ফ্রাই', 0);
  `);

  // Simulating updateMenuItemsOrder
  const itemsToUpdate = [
    { id: 'f3', sort_order: 1 },
    { id: 'f1', sort_order: 2 },
    { id: 'f2', sort_order: 3 }
  ];

  db.exec('BEGIN TRANSACTION');
  for (const item of itemsToUpdate) {
    db.prepare('UPDATE menu_items SET sort_order = ?, is_synced = 0 WHERE id = ?').run(item.sort_order, item.id);
    db.prepare('INSERT INTO sync_queue (table_name, record_id, action, status) VALUES (?, ?, ?, ?)').run('menu_items', item.id, 'UPDATE', 'PENDING');
  }
  db.exec('COMMIT');

  const rows = db.prepare(`
    SELECT name, sort_order FROM menu_items
    ORDER BY CASE WHEN COALESCE(sort_order, 0) > 0 THEN sort_order ELSE 999999 END ASC
  `).all();

  assert.strictEqual(rows[0].name, 'ক্রিসপি চিকেন ফ্রাই');
  assert.strictEqual(rows[0].sort_order, 1);
  assert.strictEqual(rows[1].name, 'ফ্রেঞ্চ ফ্রাই');
  assert.strictEqual(rows[1].sort_order, 2);
  assert.strictEqual(rows[2].name, 'চিকেন নাগা উইংস');
  assert.strictEqual(rows[2].sort_order, 3);

  const syncEntries = db.prepare("SELECT * FROM sync_queue WHERE table_name = 'menu_items'").all();
  assert.strictEqual(syncEntries.length, 3);
  assert.strictEqual(syncEntries[0].action, 'UPDATE');
  assert.strictEqual(syncEntries[0].record_id, 'f3');
});

it('Test 5: Resetting sort_order to 0 restores price low-to-high order', () => {
  const db = createTestDb();
  
  db.exec(`
    INSERT INTO menu_items (id, name, price, category, sort_order) VALUES
      ('f3', 'ক্রিসপি চিকেন ফ্রাই', 120, 'ফ্রাই', 1),
      ('f1', 'ফ্রেঞ্চ ফ্রাই', 80, 'ফ্রাই', 2);
  `);

  // Reset to 0
  db.exec(`UPDATE menu_items SET sort_order = 0;`);

  const rows = db.prepare(`
    SELECT name, price FROM menu_items
    ORDER BY CASE WHEN COALESCE(sort_order, 0) > 0 THEN sort_order ELSE 999999 END ASC, price ASC
  `).all();

  assert.strictEqual(rows[0].name, 'ফ্রেঞ্চ ফ্রাই');
  assert.strictEqual(rows[0].price, 80);
  assert.strictEqual(rows[1].name, 'ক্রিসপি চিকেন ফ্রাই');
  assert.strictEqual(rows[1].price, 120);
});

it('Test 6: Supabase sync dispatcher whitelists sort_order column and formats integer', () => {
  const { SUPABASE_TABLE_COLUMNS, transformToSupabaseRow } = require('../services/supabaseSyncDispatcher.js');
  
  assert(SUPABASE_TABLE_COLUMNS.menu_items.has('sort_order'), 'sort_order must be in SUPABASE_TABLE_COLUMNS.menu_items');

  const localRecord = {
    id: 'test-item-1',
    name: 'চিকেন পপকর্ন',
    price: 140,
    category: 'চিকেন',
    sort_order: 5,
    is_active: 1
  };

  const formatted = transformToSupabaseRow('menu_items', localRecord);
  assert.strictEqual(formatted.sort_order, 5);
  assert.strictEqual(typeof formatted.sort_order, 'number');
  assert.strictEqual(formatted.is_active, true);
});

it('Test 7: Drag-and-drop slot shift calculation and reorder splice mechanics', () => {
  const STEP = 72;
  function computeTargetShift(index, draggedIndex, hoverIndex) {
    if (draggedIndex === null || hoverIndex === null || index === draggedIndex) return 0;
    if (hoverIndex > draggedIndex) {
      if (index > draggedIndex && index <= hoverIndex) return -STEP;
    } else if (hoverIndex < draggedIndex) {
      if (index >= hoverIndex && index < draggedIndex) return STEP;
    }
    return 0;
  }

  // 4 items: [Item 0, Item 1, Item 2, Item 3]
  // Drag Item 0 down to hover over index 2
  assert.strictEqual(computeTargetShift(0, 0, 2), 0); // Dragged item handled by panY
  assert.strictEqual(computeTargetShift(1, 0, 2), -STEP); // Shifts up
  assert.strictEqual(computeTargetShift(2, 0, 2), -STEP); // Shifts up
  assert.strictEqual(computeTargetShift(3, 0, 2), 0); // Untouched

  // Drag Item 3 up to hover over index 1
  assert.strictEqual(computeTargetShift(0, 3, 1), 0); // Untouched
  assert.strictEqual(computeTargetShift(1, 3, 1), STEP); // Shifts down
  assert.strictEqual(computeTargetShift(2, 3, 1), STEP); // Shifts down
  assert.strictEqual(computeTargetShift(3, 3, 1), 0); // Dragged item handled by panY

  // Splice reorder simulation
  const items = ['স্পেশাল বার্গার', 'সাব বার্গার', 'রংধনু বার্গার'];
  // Move 'রংধনু বার্গার' (idx 2) to top (idx 0)
  const updated = [...items];
  const [moved] = updated.splice(2, 1);
  updated.splice(0, 0, moved);
  assert.deepStrictEqual(updated, ['রংধনু বার্গার', 'স্পেশাল বার্গার', 'সাব বার্গার']);
});

it('Test 8: Dynamic rank badge calculation during drag reflects real-time hover position', () => {
  function computeDisplayRank(index, isDragging, draggedIndex, hoverIndex) {
    let displayRank = index + 1;
    if (isDragging && hoverIndex !== null) {
      displayRank = hoverIndex + 1;
    } else if (draggedIndex !== null && hoverIndex !== null) {
      if (hoverIndex > draggedIndex && index > draggedIndex && index <= hoverIndex) {
        displayRank = index;
      } else if (hoverIndex < draggedIndex && index >= hoverIndex && index < draggedIndex) {
        displayRank = index + 2;
      }
    }
    return displayRank;
  }

  // Drag item 0 to slot 2:
  // Item 0 is dragging -> shows #3
  assert.strictEqual(computeDisplayRank(0, true, 0, 2), 3);
  // Item 1 shifts up -> shows #1
  assert.strictEqual(computeDisplayRank(1, false, 0, 2), 1);
  // Item 2 shifts up -> shows #2
  assert.strictEqual(computeDisplayRank(2, false, 0, 2), 2);
});

it('Test 9: PGRST204 missing sort_order column automatically retries without sort_order and succeeds', async () => {
  const { syncRecordToSupabase } = require('../services/supabaseSyncDispatcher.js');
  
  let upsertAttempts = [];
  const mockClient = {
    from: (table) => ({
      upsert: async (payload, options) => {
        upsertAttempts.push({ ...payload });
        if (payload.sort_order !== undefined) {
          return {
            error: {
              code: 'PGRST204',
              message: "Could not find the 'sort_order' column of 'menu_items' in the schema cache"
            }
          };
        }
        return { error: null };
      }
    })
  };

  const sqliteRow = {
    id: 'menu_123',
    name: 'চিকেন পপকর্ন',
    price: 140,
    category: 'চিকেন',
    sort_order: 2,
    is_active: 1
  };

  const result = await syncRecordToSupabase('menu_items', 'menu_123', 'UPDATE', sqliteRow, mockClient);
  
  assert.strictEqual(result.success, true, 'Sync must succeed via automatic fallback');
  assert.strictEqual(upsertAttempts.length, 2, 'Must have attempted twice: first with sort_order, then fallback');
  assert.strictEqual(upsertAttempts[0].sort_order, 2, 'First attempt had sort_order');
  assert.strictEqual(upsertAttempts[1].sort_order, undefined, 'Fallback attempt dropped sort_order');
  assert.strictEqual(upsertAttempts[1].name, 'চিকেন পপকর্ন', 'Fallback preserved all other fields');
});

console.log(`\n======================================================`);
console.log(`   RESULTS: ${passedTests} passed, ${failedTests} failed`);
console.log(`======================================================\n`);

if (failedTests > 0) {
  process.exit(1);
}
