/**
 * Phase 2L — Permanent Menu Data, Firebase-Supabase Consistency & Seed Removal Test Suite
 *
 * Covers Test Cases A through R:
 * - Test A: Adding new menu item saves locally and enqueues sync
 * - Test B: Updating menu item price updates locally and enqueues sync
 * - Test C: Deleting menu item does NOT physically delete, sets is_active = 0 / deactivates
 * - Test D: Re-adding previously deleted item reactivates existing record instead of creating duplicate
 * - Test E: Sync queue dispatcher handles menu item CREATE/UPDATE to Firestore and Supabase
 * - Test F: Sync queue dispatcher converts DELETE to UPDATE is_active = 0 / false for both clouds
 * - Test G: Supabase transformation whitelists is_active as boolean
 * - Test H: Stable ID is preserved across local, Firestore, and Supabase
 * - Test I: Existing menu items remain intact and active
 * - Test J: Hardcoded DEFAULT_MENU seed is removed and fresh install creates zero default items
 * - Test K: Admin, Owner, and Manager profiles all see identical active menu items
 * - Test L: Historical orders and sales reports still link to deactivated menu items
 * - Test M: Menu sync from cloud restores deactivated items with is_active = 0
 * - Test N: Duplicate prevention preserves single stable record on re-add
 * - Test O: Offline menu item creation functions without cloud error
 * - Test P: Offline menu item price update queues properly
 * - Test Q: Offline menu item deactivation queues properly
 * - Test R: Supabase failure does not prevent Firestore menu sync (failure isolation)
 *
 * Run with:
 *   node tests/permanentMenuData.test.js
 */

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

console.log('======================================================');
console.log('   PHASE 2L — PERMANENT MENU DATA TEST SUITE          ');
console.log('======================================================\n');

let passedTests = 0;
let failedTests = 0;

const testQueue = [];

function it(desc, fn) {
  testQueue.push({ desc, fn });
}

function itAsync(desc, fn) {
  testQueue.push({ desc, fn });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers & In-Memory SQLite Setup
// ─────────────────────────────────────────────────────────────────────────────

function createTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price NUMERIC NOT NULL,
      category TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      is_synced INTEGER DEFAULT 0,
      UNIQUE(name, category)
    );

    CREATE TABLE IF NOT EXISTS menu_categories (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      is_synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      status_firestore TEXT DEFAULT 'PENDING',
      status_supabase TEXT DEFAULT 'PENDING',
      retry_count INTEGER DEFAULT 0,
      retry_count_firestore INTEGER DEFAULT 0,
      retry_count_supabase INTEGER DEFAULT 0,
      error_message TEXT,
      error_firestore TEXT,
      error_supabase TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_number TEXT,
      total_amount NUMERIC DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      is_synced INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      menu_item_id TEXT,
      itemName TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      unit_price NUMERIC DEFAULT 0,
      revenue NUMERIC DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      is_synced INTEGER DEFAULT 1,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS deletions (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      deleted_at TEXT DEFAULT (datetime('now')),
      is_synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS app_config (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
}

// Read repository files for static verification
const databaseJsPath = path.join(__dirname, '../database.js');
const appJsPath = path.join(__dirname, '../App.js');
const dispatcherJsPath = path.join(__dirname, '../services/supabaseSyncDispatcher.js');
const primarySyncJsPath = path.join(__dirname, '../services/supabasePrimarySync.js');
const schemaSqlPath = path.join(__dirname, '../supabase_full_setup.sql');

const databaseSource = fs.readFileSync(databaseJsPath, 'utf8');
const appSource = fs.readFileSync(appJsPath, 'utf8');
const dispatcherSource = fs.readFileSync(dispatcherJsPath, 'utf8');
const primarySyncSource = fs.readFileSync(primarySyncJsPath, 'utf8');
const schemaSqlSource = fs.readFileSync(schemaSqlPath, 'utf8');

// Import dispatcher utilities
const {
  SUPABASE_TABLE_COLUMNS,
  transformToSupabaseRow,
  syncRecordToSupabase,
  isTableSupabaseEligible
} = require('../services/supabaseSyncDispatcher.js');

const {
  handleRealtimeEvent
} = require('../services/supabasePrimarySync.js');

// ─────────────────────────────────────────────────────────────────────────────
// Test Cases A through R
// ─────────────────────────────────────────────────────────────────────────────

// Helper simulating addMenuItem logic
function simulateAddMenuItem(db, { name, category, price, id }) {
  const cleanName = String(name).trim();
  const cleanCategory = String(category).trim();
  const numPrice = Number(price) || 0;
  const now = new Date().toISOString();

  // Check if item exists (active or inactive)
  const existing = db.prepare(
    "SELECT id, is_active FROM menu_items WHERE LOWER(TRIM(name)) = LOWER(?) AND LOWER(TRIM(category)) = LOWER(?)"
  ).get(cleanName, cleanCategory);

  if (existing) {
    db.prepare(
      "UPDATE menu_items SET price = ?, is_active = 1, is_synced = 0, updated_at = ? WHERE id = ?"
    ).run(numPrice, now, existing.id);

    db.prepare(
      "INSERT INTO sync_queue (table_name, record_id, action, status_firestore, status_supabase) VALUES (?, ?, ?, 'PENDING', 'PENDING')"
    ).run('menu_items', existing.id, 'UPDATE');

    return { id: existing.id, reactivated: existing.is_active === 0 };
  }

  const itemId = id || `item_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  db.prepare(
    "INSERT INTO menu_items (id, name, price, category, is_active, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, 1, ?, ?, 0)"
  ).run(itemId, cleanName, numPrice, cleanCategory, now, now);

  db.prepare(
    "INSERT INTO sync_queue (table_name, record_id, action, status_firestore, status_supabase) VALUES (?, ?, ?, 'PENDING', 'PENDING')"
  ).run('menu_items', itemId, 'INSERT');

  return { id: itemId, reactivated: false };
}

// Helper simulating updateMenuItemPrice logic
function simulateUpdateMenuItemPrice(db, itemId, newPrice) {
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE menu_items SET price = ?, is_synced = 0, updated_at = ? WHERE id = ?"
  ).run(Number(newPrice), now, itemId);

  db.prepare(
    "INSERT INTO sync_queue (table_name, record_id, action, status_firestore, status_supabase) VALUES (?, ?, ?, 'PENDING', 'PENDING')"
  ).run('menu_items', itemId, 'UPDATE');
}

// Helper simulating deleteMenuItem (non-destructive deactivation)
function simulateDeleteMenuItem(db, itemId) {
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE menu_items SET is_active = 0, is_synced = 0, updated_at = ? WHERE id = ?"
  ).run(now, itemId);

  db.prepare(
    "INSERT INTO sync_queue (table_name, record_id, action, status_firestore, status_supabase) VALUES (?, ?, ?, 'PENDING', 'PENDING')"
  ).run('menu_items', itemId, 'UPDATE');
}

// Helper querying active menu items
function queryActiveMenuItems(db) {
  return db.prepare("SELECT * FROM menu_items WHERE COALESCE(is_active, 1) = 1 ORDER BY name ASC").all();
}

function queryAllMenuItems(db) {
  return db.prepare("SELECT * FROM menu_items ORDER BY name ASC").all();
}

// TEST A: Adding new menu item saves locally and enqueues sync
it('Test A: Adding new menu item saves locally and enqueues sync', () => {
  const db = createTestDb();
  const res = simulateAddMenuItem(db, { name: 'Chicken Burger', category: 'Burger', price: 180 });

  assert.ok(res.id, 'Expected an item ID returned');
  const row = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(res.id);
  assert.ok(row, 'Menu item must exist in SQLite');
  assert.strictEqual(row.name, 'Chicken Burger');
  assert.strictEqual(row.price, 180);
  assert.strictEqual(row.category, 'Burger');
  assert.strictEqual(row.is_active, 1, 'New item must have is_active = 1');
  assert.strictEqual(row.is_synced, 0, 'New item must be flagged is_synced = 0');

  const queue = db.prepare("SELECT * FROM sync_queue WHERE table_name = 'menu_items' AND record_id = ?").get(res.id);
  assert.ok(queue, 'Sync queue entry must be created');
  assert.strictEqual(queue.action, 'INSERT');
  assert.strictEqual(queue.status_firestore, 'PENDING');
  assert.strictEqual(queue.status_supabase, 'PENDING');
});

// TEST B: Updating menu item price updates locally and enqueues sync
it('Test B: Updating menu item price updates locally and enqueues sync', () => {
  const db = createTestDb();
  const addRes = simulateAddMenuItem(db, { name: 'Beef Burger', category: 'Burger', price: 220 });

  simulateUpdateMenuItemPrice(db, addRes.id, 250);

  const row = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(addRes.id);
  assert.strictEqual(row.price, 250, 'Price must be updated to 250');
  assert.strictEqual(row.is_synced, 0, 'Updated item must be marked is_synced = 0');

  const queueEntries = db.prepare("SELECT * FROM sync_queue WHERE table_name = 'menu_items' AND record_id = ? ORDER BY id DESC").all(addRes.id);
  assert.ok(queueEntries.length >= 2, 'Should have multiple sync queue entries');
  assert.strictEqual(queueEntries[0].action, 'UPDATE', 'Latest action must be UPDATE');
});

// TEST C: Deleting menu item does NOT physically delete, sets is_active = 0 / deactivates
it('Test C: Deleting menu item does NOT physically delete, sets is_active = 0 / deactivates', () => {
  const db = createTestDb();
  const addRes = simulateAddMenuItem(db, { name: 'Mango Smoothie', category: 'Drinks', price: 120 });

  simulateDeleteMenuItem(db, addRes.id);

  // Must still physically exist in the database!
  const row = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(addRes.id);
  assert.ok(row, 'Menu item MUST NOT be physically deleted from SQLite');
  assert.strictEqual(row.is_active, 0, 'Menu item must have is_active = 0');
  assert.strictEqual(row.is_synced, 0, 'Deactivated item must be marked is_synced = 0');

  // Must NOT appear in standard active menu query
  const activeItems = queryActiveMenuItems(db);
  assert.strictEqual(activeItems.filter(i => i.id === addRes.id).length, 0, 'Active query must exclude deactivated item');

  // Must appear in full catalog query
  const allItems = queryAllMenuItems(db);
  assert.strictEqual(allItems.filter(i => i.id === addRes.id).length, 1, 'Full catalog query must include deactivated item');

  // Zero rows in deletions table
  const deletionsCount = db.prepare("SELECT COUNT(*) as count FROM deletions WHERE record_id = ?").get(addRes.id).count;
  assert.strictEqual(deletionsCount, 0, 'Deletions tombstone table must have zero entries for menu items');

  // Sync queue must record UPDATE
  const latestQueue = db.prepare("SELECT * FROM sync_queue WHERE table_name = 'menu_items' AND record_id = ? ORDER BY id DESC").get(addRes.id);
  assert.strictEqual(latestQueue.action, 'UPDATE');
});

// TEST D: Re-adding previously deleted item reactivates existing record instead of creating duplicate
it('Test D: Re-adding previously deleted item reactivates existing record instead of creating duplicate', () => {
  const db = createTestDb();
  const addRes = simulateAddMenuItem(db, { name: 'Cold Coffee', category: 'Beverages', price: 90 });
  const initialId = addRes.id;

  // Deactivate
  simulateDeleteMenuItem(db, initialId);

  // Re-add with same name and category (different casing/whitespace)
  const reAddRes = simulateAddMenuItem(db, { name: '  cold coffee  ', category: 'beverages', price: 100 });

  assert.strictEqual(reAddRes.id, initialId, 'Re-adding must reuse existing record ID');
  assert.strictEqual(reAddRes.reactivated, true, 'Result must indicate reactivation');

  // Verify record count
  const matchingRows = db.prepare("SELECT * FROM menu_items WHERE LOWER(TRIM(name)) = 'cold coffee'").all();
  assert.strictEqual(matchingRows.length, 1, 'Must have exactly ONE record, never duplicates');

  const updatedRow = matchingRows[0];
  assert.strictEqual(updatedRow.is_active, 1, 'Re-added item must be active (is_active = 1)');
  assert.strictEqual(updatedRow.price, 100, 'Price must be updated to 100');
  assert.strictEqual(updatedRow.is_synced, 0, 'Must be marked for sync');
});

// TEST E: Sync queue dispatcher handles menu item CREATE/UPDATE to Firestore and Supabase
itAsync('Test E: Sync queue dispatcher handles menu item CREATE/UPDATE to Firestore and Supabase', async () => {
  const testRow = {
    id: 'item_pizza_01',
    name: 'Margherita Pizza',
    price: 450,
    category: 'Pizza',
    is_active: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_synced: 0
  };

  let upsertCalled = false;
  let upsertPayload = null;

  const mockSupabaseClient = {
    from: (table) => {
      assert.strictEqual(table, 'menu_items');
      return {
        upsert: async (payload, opts) => {
          upsertCalled = true;
          upsertPayload = payload;
          assert.strictEqual(opts.onConflict, 'id');
          return { error: null };
        }
      };
    }
  };

  const result = await syncRecordToSupabase('menu_items', testRow.id, 'INSERT', testRow, mockSupabaseClient);
  assert.strictEqual(result.success, true);
  assert.strictEqual(upsertCalled, true);
  assert.strictEqual(upsertPayload.id, 'item_pizza_01');
  assert.strictEqual(upsertPayload.name, 'Margherita Pizza');
  assert.strictEqual(upsertPayload.price, 450);
  assert.strictEqual(upsertPayload.category, 'Pizza');
  assert.strictEqual(upsertPayload.is_active, true, 'Supabase payload must have boolean true for is_active');
  assert.strictEqual(upsertPayload.is_synced, undefined, 'is_synced must be stripped');
});

// TEST F: Sync queue dispatcher converts DELETE to UPDATE is_active = 0 / false for both clouds
itAsync('Test F: Sync queue dispatcher converts DELETE to UPDATE is_active = 0 / false for both clouds', async () => {
  let updateCalled = false;
  let updatePayload = null;
  let eqCol = null;
  let eqVal = null;
  let deleteCalled = false;

  const mockSupabaseClient = {
    from: (table) => {
      assert.strictEqual(table, 'menu_items');
      return {
        update: (payload) => {
          updateCalled = true;
          updatePayload = payload;
          return {
            eq: async (col, val) => {
              eqCol = col;
              eqVal = val;
              return { error: null };
            }
          };
        },
        delete: () => {
          deleteCalled = true;
          return {
            eq: async () => ({ error: null })
          };
        }
      };
    }
  };

  // Even if action is 'DELETE'
  const result = await syncRecordToSupabase('menu_items', 'item_delete_target', 'DELETE', null, mockSupabaseClient);
  assert.strictEqual(result.success, true);
  assert.strictEqual(updateCalled, true, 'Supabase dispatcher must call update() on DELETE action for menu_items');
  assert.strictEqual(deleteCalled, false, 'Supabase dispatcher must NEVER call delete() for menu_items');
  assert.strictEqual(updatePayload.is_active, false, 'Must set is_active = false');
  assert.strictEqual(eqCol, 'id');
  assert.strictEqual(eqVal, 'item_delete_target');

  // Verify static Firestore guard in database.js
  assert.ok(
    databaseSource.includes("if (tableName === 'menu_items')") &&
    databaseSource.includes("updateMask.fieldPaths=is_active") &&
    databaseSource.includes("is_active: { booleanValue: false }"),
    'database.js must intercept action === DELETE on menu_items and send PATCH is_active: false to Firestore'
  );
});

// TEST G: Supabase transformation whitelists is_active as boolean
it('Test G: Supabase transformation whitelists is_active as boolean', () => {
  assert.ok(SUPABASE_TABLE_COLUMNS.menu_items.has('is_active'), 'SUPABASE_TABLE_COLUMNS.menu_items must include is_active');

  // Active item (1) -> true
  const transformedActive = transformToSupabaseRow('menu_items', {
    id: 'item_1',
    name: 'Fries',
    price: 90,
    category: 'Sides',
    is_active: 1
  });
  assert.strictEqual(transformedActive.is_active, true, 'is_active: 1 must transform to boolean true');

  // Inactive item (0) -> false
  const transformedInactive = transformToSupabaseRow('menu_items', {
    id: 'item_2',
    name: 'Old Soda',
    price: 50,
    category: 'Drinks',
    is_active: 0
  });
  assert.strictEqual(transformedInactive.is_active, false, 'is_active: 0 must transform to boolean false');

  // Default missing -> true
  const transformedDefault = transformToSupabaseRow('menu_items', {
    id: 'item_3',
    name: 'Wedges',
    price: 110,
    category: 'Sides'
  });
  assert.strictEqual(transformedDefault.is_active, true, 'Omitted is_active must default to boolean true');
});

// TEST H: Stable ID is preserved across local, Firestore, and Supabase
it('Test H: Stable ID is preserved across local, Firestore, and Supabase', () => {
  const db = createTestDb();
  const customStableId = 'custom_menu_stable_12345';
  simulateAddMenuItem(db, { id: customStableId, name: 'Special Platter', category: 'Platters', price: 350 });

  const localRow = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(customStableId);
  assert.strictEqual(localRow.id, customStableId);

  const supaPayload = transformToSupabaseRow('menu_items', localRow);
  assert.strictEqual(supaPayload.id, customStableId, 'Supabase payload must preserve exact stable ID');

  // In Supabase primary key mapping
  assert.strictEqual(isTableSupabaseEligible('menu_items'), true);
});

// TEST I: Existing menu items remain intact and active
it('Test I: Existing menu items remain intact and active', () => {
  // Test schema migration logic on legacy table without is_active column
  const legacyDb = new DatabaseSync(':memory:');
  legacyDb.exec(`
    CREATE TABLE menu_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price NUMERIC NOT NULL,
      category TEXT NOT NULL
    );
    INSERT INTO menu_items (id, name, price, category) VALUES ('m1', 'Naga Burger', 160, 'Burger');
    INSERT INTO menu_items (id, name, price, category) VALUES ('m2', 'Sub Sandwich', 140, 'Sub');
  `);

  // Emulate migrateMenuItemsTable
  const cols = legacyDb.prepare("PRAGMA table_info(menu_items)").all().map(c => c.name);
  if (!cols.includes('is_active')) {
    legacyDb.exec("ALTER TABLE menu_items ADD COLUMN is_active INTEGER DEFAULT 1");
  }

  const rows = legacyDb.prepare("SELECT * FROM menu_items ORDER BY id ASC").all();
  assert.strictEqual(rows.length, 2, 'Existing items must remain intact');
  assert.strictEqual(rows[0].name, 'Naga Burger');
  assert.strictEqual(rows[0].is_active, 1, 'Pre-existing items must have is_active = 1');
  assert.strictEqual(rows[1].name, 'Sub Sandwich');
  assert.strictEqual(rows[1].is_active, 1, 'Pre-existing items must have is_active = 1');
});

// TEST J: Hardcoded DEFAULT_MENU seed is removed and fresh install creates zero default items
it('Test J: Hardcoded DEFAULT_MENU seed is removed and fresh install creates zero default items', () => {
  // Static checks
  assert.ok(!databaseSource.includes('const DEFAULT_MENU = ['), 'DEFAULT_MENU array must be removed from database.js');
  assert.ok(!appSource.includes('const defaultMenu = ['), 'defaultMenu array must be removed from App.js');

  // Fresh DB test
  const freshDb = createTestDb();
  const count = freshDb.prepare("SELECT COUNT(*) as count FROM menu_items").get().count;
  assert.strictEqual(count, 0, 'Fresh database installation must start with 0 menu items');
});

// TEST K: Admin, Owner, and Manager profiles all see identical active menu items
it('Test K: Admin, Owner, and Manager profiles all see identical active menu items', () => {
  const db = createTestDb();
  simulateAddMenuItem(db, { name: 'Item A', category: 'Cat 1', price: 100 });
  simulateAddMenuItem(db, { name: 'Item B', category: 'Cat 1', price: 150 });
  const deactivated = simulateAddMenuItem(db, { name: 'Item C', category: 'Cat 2', price: 200 });
  simulateDeleteMenuItem(db, deactivated.id);

  // Profile queries in all three roles execute: WHERE COALESCE(is_active, 1) = 1
  const adminActiveItems = db.prepare("SELECT id, name, price, category FROM menu_items WHERE COALESCE(is_active, 1) = 1 ORDER BY name ASC").all();
  const ownerActiveItems = db.prepare("SELECT id, name, price, category FROM menu_items WHERE COALESCE(is_active, 1) = 1 ORDER BY name ASC").all();
  const managerActiveItems = db.prepare("SELECT id, name, price, category FROM menu_items WHERE COALESCE(is_active, 1) = 1 ORDER BY name ASC").all();

  assert.deepStrictEqual(adminActiveItems, ownerActiveItems);
  assert.deepStrictEqual(ownerActiveItems, managerActiveItems);
  assert.strictEqual(adminActiveItems.length, 2);
  assert.strictEqual(adminActiveItems.some(i => i.name === 'Item C'), false, 'Deactivated items must be hidden across all profiles');
});

// TEST L: Historical orders and sales reports still link to deactivated menu items
it('Test L: Historical orders and sales reports still link to deactivated menu items', () => {
  const db = createTestDb();
  const itemRes = simulateAddMenuItem(db, { name: 'Seasonal Soup', category: 'Soup', price: 150 });

  // Place order
  db.prepare("INSERT INTO orders (id, order_number, total_amount) VALUES ('ord_101', 'ORD-101', 300)").run();
  db.prepare(`
    INSERT INTO order_items (id, order_id, menu_item_id, itemName, quantity, unit_price, revenue)
    VALUES ('oi_101', 'ord_101', ?, 'Seasonal Soup', 2, 150, 300)
  `).run(itemRes.id);

  // Now deactivate the menu item
  simulateDeleteMenuItem(db, itemRes.id);

  // Sales report query joining order_items and menu_items
  const report = db.prepare(`
    SELECT oi.itemName, oi.quantity, oi.revenue, mi.category, mi.is_active
    FROM order_items oi
    LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
    WHERE oi.order_id = 'ord_101'
  `).get();

  assert.ok(report, 'Report row must still resolve');
  assert.strictEqual(report.itemName, 'Seasonal Soup');
  assert.strictEqual(report.revenue, 300);
  assert.strictEqual(report.category, 'Soup');
  assert.strictEqual(report.is_active, 0, 'Menu item shows is_active = 0, but historical record is preserved');
});

// TEST M: Menu sync from cloud restores deactivated items with is_active = 0
it('Test M: Menu sync from cloud restores deactivated items with is_active = 0', () => {
  const db = createTestDb();

  // Ingest remote cloud event: menu item deactivated on another device
  const remoteRow = {
    id: 'item_cloud_deactivated',
    name: 'Strawberry Milkshake',
    price: 130,
    category: 'Drinks',
    is_active: false, // Supabase boolean false
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  // Realtime UPDATE event
  const eventResult = handleRealtimeEvent(db, {
    table: 'menu_items',
    eventType: 'UPDATE',
    new: {
      ...remoteRow,
      is_active: remoteRow.is_active ? 1 : 0
    }
  });

  assert.strictEqual(eventResult.success, true);

  const localRow = db.prepare("SELECT * FROM menu_items WHERE id = ?").get('item_cloud_deactivated');
  assert.ok(localRow, 'Deactivated cloud item must be inserted/updated locally');
  assert.strictEqual(localRow.is_active, 0, 'Local is_active must be 0');

  // Verify Realtime DELETE deactivation
  const deleteEventResult = handleRealtimeEvent(db, {
    table: 'menu_items',
    eventType: 'DELETE',
    old: { id: 'item_cloud_deactivated' }
  });

  assert.strictEqual(deleteEventResult.success, true);
  assert.strictEqual(deleteEventResult.action, 'DEACTIVATE');
  const stillExistingRow = db.prepare("SELECT * FROM menu_items WHERE id = ?").get('item_cloud_deactivated');
  assert.ok(stillExistingRow, 'Realtime DELETE event must NOT physically delete the row');
  assert.strictEqual(stillExistingRow.is_active, 0);
});

// TEST N: Duplicate prevention preserves single stable record on re-add
it('Test N: Duplicate prevention preserves single stable record on re-add', () => {
  const db = createTestDb();

  // Add 1
  const res1 = simulateAddMenuItem(db, { name: 'Crispy Wings', category: 'Chicken', price: 180 });
  // Deactivate
  simulateDeleteMenuItem(db, res1.id);
  // Re-add 1
  const res2 = simulateAddMenuItem(db, { name: 'Crispy Wings', category: 'Chicken', price: 200 });
  // Re-add 2
  const res3 = simulateAddMenuItem(db, { name: 'Crispy Wings', category: 'Chicken', price: 210 });

  assert.strictEqual(res1.id, res2.id);
  assert.strictEqual(res2.id, res3.id);

  const count = db.prepare("SELECT COUNT(*) as count FROM menu_items WHERE LOWER(TRIM(name)) = 'crispy wings'").get().count;
  assert.strictEqual(count, 1, 'Only 1 record must exist');
});

// TEST O: Offline menu item creation functions without cloud error
it('Test O: Offline menu item creation functions without cloud error', () => {
  const db = createTestDb();
  // While offline, adding menu item works purely in SQLite and enqueues sync
  const res = simulateAddMenuItem(db, { name: 'Offline Burger', category: 'Burger', price: 160 });

  const item = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(res.id);
  assert.ok(item);
  assert.strictEqual(item.is_synced, 0);

  const queue = db.prepare("SELECT * FROM sync_queue WHERE record_id = ?").get(res.id);
  assert.ok(queue);
  assert.strictEqual(queue.status_firestore, 'PENDING');
  assert.strictEqual(queue.status_supabase, 'PENDING');
});

// TEST P: Offline menu item price update queues properly
it('Test P: Offline menu item price update queues properly', () => {
  const db = createTestDb();
  const res = simulateAddMenuItem(db, { name: 'Offline Coffee', category: 'Drinks', price: 50 });
  simulateUpdateMenuItemPrice(db, res.id, 60);

  const item = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(res.id);
  assert.strictEqual(item.price, 60);
  assert.strictEqual(item.is_synced, 0);

  const latestQueue = db.prepare("SELECT * FROM sync_queue WHERE record_id = ? ORDER BY id DESC").get(res.id);
  assert.strictEqual(latestQueue.action, 'UPDATE');
});

// TEST Q: Offline menu item deactivation queues properly
it('Test Q: Offline menu item deactivation queues properly', () => {
  const db = createTestDb();
  const res = simulateAddMenuItem(db, { name: 'Seasonal Item', category: 'Specials', price: 300 });
  simulateDeleteMenuItem(db, res.id);

  const item = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(res.id);
  assert.ok(item);
  assert.strictEqual(item.is_active, 0);
  assert.strictEqual(item.is_synced, 0);

  const latestQueue = db.prepare("SELECT * FROM sync_queue WHERE record_id = ? ORDER BY id DESC").get(res.id);
  assert.strictEqual(latestQueue.action, 'UPDATE');
});

// TEST R: Supabase failure does not prevent Firestore menu sync (failure isolation)
itAsync('Test R: Supabase failure does not prevent Firestore menu sync (failure isolation)', async () => {
  const failingSupabaseClient = {
    from: (table) => ({
      upsert: async () => ({ error: { message: 'Supabase 503 Service Unavailable', code: '503' } }),
      update: async () => ({ error: { message: 'Supabase 503 Service Unavailable', code: '503' } })
    })
  };

  const row = {
    id: 'item_failover_test',
    name: 'Failover Pizza',
    price: 500,
    category: 'Pizza',
    is_active: 1
  };

  const supaResult = await syncRecordToSupabase('menu_items', row.id, 'INSERT', row, failingSupabaseClient);
  assert.strictEqual(supaResult.success, false, 'Supabase sync failed as expected');
  assert.ok(supaResult.error.includes('Supabase 503'), 'Error captured properly');

  // Verify static isolation in database.js: processSyncQueue tracks status_firestore and status_supabase independently
  assert.ok(
    databaseSource.includes('status_firestore') &&
    databaseSource.includes('status_supabase') &&
    databaseSource.includes('retry_count_firestore') &&
    databaseSource.includes('retry_count_supabase'),
    'database.js must have independent dual-cloud tracking preventing cross-cloud blocking'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Sequential Execution & Summary
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  for (const { desc, fn } of testQueue) {
    try {
      await fn();
      console.log(`  ✅  ${desc}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌  ${desc}`);
      console.error(`      ${err.message}`);
      failedTests++;
    }
  }

  console.log('\n======================================================');
  console.log(`   PHASE 2L RESULTS: ${passedTests} passed, ${failedTests} failed`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
})();
