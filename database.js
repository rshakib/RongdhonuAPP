import * as SQLite from 'expo-sqlite';
import { AppState, Platform } from 'react-native';
import { buildDailyDataset, buildItemDataset } from './services/aiDataset/builder';
import {
  DEFAULT_BATCH_SIZE,
  buildBatchPayload,
  transmitBatchToGoogleSheets,
  processStructuredTransportResponse
} from './services/aiDataset/transport/googleSheets';
import { getFirestoreAuthHeaders, invalidateCurrentToken, isAuthCredentialKey } from './services/firebaseAuth.js';
import { getRolePriority, remotePriorityWins } from './services/dailySubmitPriority.js';
import { isTombstoned, clearTombstone, isResurrectBlocked, isTombstoneStale } from './services/tombstoneStore.js';

let dbInstance = null;

// ISOLATED AUDIT: lazily resolve the audit module so the audit feature stays
// fully optional (if the file is missing the app still runs normally).
let auditModuleCache;
function getAuditModule() {
  if (auditModuleCache === undefined) {
    try {
      auditModuleCache = require('./services/auditLog.js');
    } catch (_) {
      auditModuleCache = null;
    }
  }
  return auditModuleCache;
}

// ISOLATED AUDIT: wrap the SQLite instance so the audit module can remember the
// pre-image of UPDATE/DELETE writes (needed for before→after diffs). Strictly
// additive — arguments and return values are untouched and every step is
// best-effort, so a failure here can never affect a write.
function attachAuditPreImageCapture(instance) {
  if (!instance || instance.__auditWrapped) return instance;
  try {
    const originalRunSync = instance.runSync.bind(instance);
    instance.runSync = (sql, params) => {
      try {
        const audit = getAuditModule();
        if (audit && typeof audit.capturePreImage === 'function') {
          audit.capturePreImage(instance, sql, params);
        }
      } catch (_) {}
      return originalRunSync(sql, params);
    };
    instance.__auditWrapped = true;
  } catch (_) {}
  return instance;
}

// Firebase Usage Monitor internal tracking variables
let firestoreReadsToday = 0;
let firestoreWritesToday = 0;
let firestoreDeletesToday = 0;
let syncUploadsToday = 0;
let syncDownloadsToday = 0;
export function getDb() {
  if (!dbInstance) {
    try {
      dbInstance = SQLite.openDatabaseSync('rongdhonu.db', { useNewConnection: true });
      dbInstance.execSync("PRAGMA foreign_keys = ON;");
      attachAuditPreImageCapture(dbInstance);
      console.log("[DB] Lazily opened native SQLite Database connection successfully with Foreign Key enforcement enabled.");
    } catch (e) {
      console.error("[DB] Critical: Failed to open native SQLite Database connection:", e);
      throw e;
    }
  }
  return dbInstance;
}

export const db = new Proxy({}, {
  get(target, prop) {
    const instance = getDb();
    if (!instance) {
      throw new Error("[DB] Database instance is null during lazy-load property access: " + String(prop));
    }
    const value = instance[prop];
    if (typeof value === 'function') {
      return (...args) => {
        // Intercept query methods to protect against expo-sqlite JNI NullPointerException parameter binding bug
        if (prop === 'getFirstSync' || prop === 'getAllSync' || prop === 'runSync') {
          if (args.length === 1) {
            args.push([]); 
          } else if (args[1] === undefined || args[1] === null) {
            args[1] = [];
          } else if (Array.isArray(args[1])) {
            // Deep sanitize: ensure every single element in the binding array is a non-null string
            args[1] = args[1].map(p => (p === null || p === undefined) ? "" : String(p));
          }
        }
        return value.apply(instance, args);
      };
    }
    return value;
  }
});

// Global state to track sync error for diagnostics
let lastSyncError = "None";
let isProcessingSyncQueue = false;

const cleanEnvVar = (val) => {
  if (!val) return '';
  let s = String(val).trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.substring(1, s.length - 1);
  if (s.startsWith("'") && s.endsWith("'")) s = s.substring(1, s.length - 1);
  return s.trim();
};


// Bangladesh Public Holidays for 2026/2027
const BD_HOLIDAYS = {
  "01-01": "New Year's Day",
  "02-21": "Language Martyrs' Day",
  "03-17": "Mujibur Rahman Birthday",
  "03-26": "Independence Day",
  "04-14": "Pohela Boishakh",
  "05-01": "May Day",
  "12-16": "Victory Day",
  "12-25": "Christmas Day"
};

// Default Restaurant Menu (56 items) to seed when menu_items count is 0
const DEFAULT_MENU = [
  // বার্গার (6)
  { name: 'স্পেশাল বার্গার', price: 90, category: 'বার্গার' },
  { name: 'স্পেশাল নাগা বার্গার', price: 100, category: 'বার্গার' },
  { name: 'সাব বার্গার', price: 100, category: 'বার্গার' },
  { name: 'বার্বিকিউ বার্গার', price: 150, category: 'বার্গার' },
  { name: 'স্পাইসি চিজ বার্গার', price: 160, category: 'বার্গার' },
  { name: 'রংধনু বার্গার', price: 170, category: 'বার্গার' },
  
  // ফ্রাই (6)
  { name: 'চাইনিজ চিকেন ফ্রাই', price: 60, category: 'ফ্রাই' },
  { name: 'থাই চিকেন ফ্রাই', price: 100, category: 'ফ্রাই' },
  { name: 'ক্রিসপি চিকেন ফ্রাই', price: 120, category: 'ফ্রাই' },
  { name: 'চিকেন হানি উইংস', price: 100, category: 'ফ্রাই' },
  { name: 'চিকেন নাগা উইংস', price: 100, category: 'ফ্রাই' },
  { name: 'ফ্রেঞ্চ ফ্রাই', price: 80, category: 'ফ্রাই' },
  
  // নুডুলস (4)
  { name: 'ম্যাগি মাসালা নুডুলস', price: 100, category: 'নুডুলস' },
  { name: 'চিকেন ম্যাগি নুডুলস', price: 120, category: 'নুডুলস' },
  { name: 'চিকেন চাউমিন', price: 150, category: 'নুডুলস' },
  { name: 'চিকেন পাস্তা', price: 150, category: 'নুডুলস' },
  
  // চিকেন (3)
  { name: 'কেসুনাটি সালাদ', price: 170, category: 'চিকেন' },
  { name: 'চিকেন রেড কারি', price: 150, category: 'চিকেন' },
  { name: 'চিকেন পপকর্ন', price: 140, category: 'চিকেন' },
  
  // রাইস (10)
  { name: 'মোরগ পোলাও+ডিম', price: 170, category: 'রাইস' },
  { name: 'চিকেন বিরিয়ানি+ডিম', price: 160, category: 'রাইস' },
  { name: 'খাসির কাচ্চি', price: 260, category: 'রাইস' },
  { name: 'চিকেন কাচ্চি', price: 200, category: 'রাইস' },
  { name: 'মিট বক্স', price: 160, category: 'রাইস' },
  { name: 'স্পেশাল মিটবক্স', price: 220, category: 'রাইস' },
  { name: 'রাইস বুল', price: 160, category: 'রাইস' },
  { name: 'চিকেন কারি রাইস', price: 160, category: 'রাইস' },
  { name: 'ফ্রাইড রাইস', price: 160, category: 'রাইস' },
  { name: 'রংধনু স্পেশাল', price: 220, category: 'রাইস' },
  
  // স্ন্যাকস (5)
  { name: 'চিকেন শর্মা', price: 150, category: 'স্ন্যাকস' },
  { name: 'চিকেন স্যান্ডউইচ', price: 130, category: 'স্ন্যাকস' },
  { name: 'চিকেন ফিংগার', price: 170, category: 'স্ন্যাকস' },
  { name: 'চকলেট ওয়াফেল', price: 170, category: 'স্ন্যাকস' },
  { name: 'আইসক্রিম ওয়াফেল', price: 220, category: 'স্ন্যাকস' },
  
  // পিজ্জা (2)
  { name: 'পিৎজা', price: 400, category: 'পিজ্জা' },
  { name: 'স্পেশাল পিৎজা', price: 500, category: 'পিজ্জা' },
  
  // ড্রিংকস (20)
  { name: 'লাচ্ছি', price: 60, category: 'ড্রিংকস' },
  { name: 'কোল্ড কফি', price: 60, category: 'ড্রিংকস' },
  { name: 'স্ট্রবেরি লাচ্ছি', price: 90, category: 'ড্রিংকস' },
  { name: 'ভ্যানেলা লাচ্ছি', price: 100, category: 'ড্রিংকস' },
  { name: 'স্ট্রবেরি মিল্কশেক', price: 100, category: 'ড্রিংকস' },
  { name: 'চাকালেট মিল্কশেক', price: 100, category: 'ড্রিংকস' },
  { name: 'স্পেশাল খেজুর মিল্কশেক', price: 120, category: 'ড্রিংকস' },
  { name: 'স্পেশাল বাদাম মিল্কশেক', price: 150, category: 'ড্রিংকস' },
  { name: 'কোল্ড কফি+আইসক্রিম', price: 120, category: 'ড্রিংকস' },
  { name: 'মিক্স আইসক্রিম', price: 120, category: 'ড্রিংকস' },
  { name: 'ফালুদা', price: 130, category: 'ড্রিংকস' },
  { name: 'অরেঞ্জ জুস', price: 120, category: 'ড্রিংকস' },
  { name: 'মিক্স ফুট জুস', price: 150, category: 'ড্রিংকস' },
  { name: 'ভার্জিন মোজিতো', price: 70, category: 'ড্রিংকস' },
  { name: 'কোল্ড ড্রিংস', price: 30, category: 'ড্রিংকস' },
  { name: 'লেমন জুস+পুদিনা', price: 70, category: 'ড্রিংকস' },
  { name: 'বুরহানি', price: 60, category: 'ড্রিংকস' },
  { name: 'ব্ল্যাক কফি', price: 70, category: 'ড্রিংকস' },
  { name: 'হট কফি', price: 70, category: 'ড্রিংকস' },
  { name: 'স্পেশাল হট কফি', price: 80, category: 'ড্রিংকস' },
  
  // Special Item (Rule 1: Water is not shown in general menu list, but stored here)
  { name: 'পানি', price: 20, category: 'ড্রিংকস' }
];

// SQL commands to create all required 18 tables
const TABLE_SCHEMAS = {
  users: `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      pin TEXT,
      role TEXT,
      display_name TEXT,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  restaurant_tables: `
    CREATE TABLE IF NOT EXISTS restaurant_tables (
      id TEXT PRIMARY KEY,
      table_id TEXT,
      table_name TEXT,
      status TEXT,
      items TEXT, -- JSON array of active items
      startTime TEXT,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  orders: `
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, -- order_id
      table_id TEXT,
      items TEXT, -- Text summary or serialized items
      subtotal REAL,
      discount REAL,
      delivery_charge REAL DEFAULT 0,
      change_money_given REAL DEFAULT 0,
      cash_amount REAL DEFAULT 0,
      bkash_amount REAL DEFAULT 0,
      nagad_amount REAL DEFAULT 0,
      rocket_amount REAL DEFAULT 0,
      due_amount REAL DEFAULT 0,
      grand_total REAL,
      payment_status TEXT, -- Paid, Unpaid, Pending, etc.
      payment_method TEXT,
      time TEXT,
      created_at TEXT,
      updated_at TEXT,
      locked_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  order_items: `
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT,
      itemName TEXT,
      quantity INTEGER,
      unit_price REAL DEFAULT 0,
      revenue REAL,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,

  payments: `
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      order_id TEXT,
      total_amount REAL,
      customer_paid REAL,
      discount_amount REAL,
      delivery_charge REAL DEFAULT 0,
      change_money_given REAL DEFAULT 0,
      cash_amount REAL DEFAULT 0,
      bkash_amount REAL DEFAULT 0,
      nagad_amount REAL DEFAULT 0,
      rocket_amount REAL DEFAULT 0,
      due_amount REAL DEFAULT 0,
      payment_method TEXT,
      payment_status TEXT,
      paid_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  expenses: `
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      category TEXT, -- দুদু স্টোর, আকাশ মুরগী, বার্গার বান, বাজার, অন্যান্য
      amount REAL,
      note TEXT,
      is_due INTEGER DEFAULT 0,
      given_amount REAL DEFAULT 0,
      used_amount REAL DEFAULT 0,
      returned_amount REAL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  deliveries: `
    CREATE TABLE IF NOT EXISTS deliveries (
      id TEXT PRIMARY KEY, -- delivery_id
      customer_name TEXT,
      amount REAL,
      status TEXT, -- BUSY, COMPLETED
      items TEXT, -- JSON string of items
      startTime TEXT,
      delivery_charge REAL DEFAULT 0,
      change_money_given REAL DEFAULT 0,
      created_at TEXT,
      completed_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  daily_submit: `
    CREATE TABLE IF NOT EXISTS daily_submit (
      id TEXT PRIMARY KEY, -- YYYY-MM-DD
      date TEXT UNIQUE,
      total_sell REAL,
      cash_payment REAL,
      bkash_payment REAL,
      nagad_payment REAL,
      rocket_payment REAL DEFAULT 0,
      delivery_sell REAL DEFAULT 0,
      delivery_charge REAL DEFAULT 0,
      eja REAL,
      dudu_store REAL,
      akash_murgi REAL,
      burger_bun REAL,
      bazar REAL,
      others REAL,
      total_expense REAL,
      net_cash REAL DEFAULT 0,
      net_deposit REAL,
      notes TEXT,
      submitted_by TEXT,
      submitted_at TEXT,
      is_locked INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0,
      submission_type TEXT DEFAULT 'MANUAL'
    );
  `,
  daily_summary: `
    CREATE TABLE IF NOT EXISTS daily_summary (
      id TEXT PRIMARY KEY, -- YYYY-MM-DD
      date TEXT UNIQUE,
      dayOfWeek TEXT,
      weekOfMonth INTEGER,
      isFriday INTEGER,
      isHoliday INTEGER,
      specialDayNote TEXT,
      temperature REAL,
      humidity REAL,
      condition TEXT,
      isRainy INTEGER,
      windSpeed REAL,
      totalOrders INTEGER,
      totalSales REAL,
      totalDiscount REAL,
      totalExpense REAL,
      totalDelivery REAL,
      total_delivery_charge REAL DEFAULT 0,
      averageOrderValue REAL,
      peakHour TEXT,
      firstOrderTime TEXT,
      lastOrderTime TEXT,
      cashTotal REAL,
      bkashTotal REAL,
      nagadTotal REAL,
      rocketTotal REAL DEFAULT 0,
      ejaAmount REAL,
      netCash REAL,
      ownerDeposit REAL,
      itemSummary TEXT, -- JSON string
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  menu_categories: `
    CREATE TABLE IF NOT EXISTS menu_categories (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  menu_items: `
    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      name TEXT,
      price REAL,
      category TEXT,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0,
      UNIQUE(name, category)
    );
  `,
  due_payments: `
    CREATE TABLE IF NOT EXISTS due_payments (
      id TEXT PRIMARY KEY,
      customer_name TEXT,
      amount REAL,
      order_id TEXT,
      status TEXT,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  eja_history: `
    CREATE TABLE IF NOT EXISTS eja_history (
      id TEXT PRIMARY KEY,
      date TEXT,
      eja_amount REAL,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  off_days: `
    CREATE TABLE IF NOT EXISTS off_days (
      id TEXT PRIMARY KEY,
      date TEXT UNIQUE,
      created_by TEXT,
      reason TEXT,
      status TEXT,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  weather_data: `
    CREATE TABLE IF NOT EXISTS weather_data (
      id TEXT PRIMARY KEY,
      date TEXT UNIQUE,
      temperature REAL,
      humidity REAL,
      condition TEXT,
      isRainy INTEGER,
      windSpeed REAL,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  sync_queue: `
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT,
      table_name TEXT,
      action TEXT, -- INSERT, UPDATE, DELETE
      status TEXT DEFAULT 'PENDING', -- PENDING, SUCCESS, FAILED
      created_at TEXT,
      retry_count INTEGER DEFAULT 0,
      last_error TEXT,
      last_attempt_at TEXT
    );
  `,
  notifications: `
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      title TEXT,
      message TEXT,
      read INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  app_config: `
    CREATE TABLE IF NOT EXISTS app_config (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE,
      value TEXT,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  ai_dataset_history: `
    CREATE TABLE IF NOT EXISTS ai_dataset_history (
      id TEXT PRIMARY KEY, -- Type_Date_Hour_Item
      date TEXT,
      type TEXT, -- AI_DAILY_SALES_DATASET, AI_ITEM_SALES_DATASET
      exported_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  ai_dataset_queue: `
    CREATE TABLE IF NOT EXISTS ai_dataset_queue (
      id TEXT PRIMARY KEY, -- dataset_id
      type TEXT, -- AI_DAILY_SALES_DATASET, AI_ITEM_SALES_DATASET
      business_date TEXT,
      payload TEXT, -- JSON payload for the export
      status TEXT DEFAULT 'PENDING', -- PENDING, IN_PROGRESS, SUCCESS, FAILED, RETRY
      retry_count INTEGER DEFAULT 0,
      last_error TEXT DEFAULT NULL,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  supplier_due: `
    CREATE TABLE IF NOT EXISTS supplier_due (
      id TEXT PRIMARY KEY,
      supplier_name TEXT,
      current_due REAL DEFAULT 0,
      note TEXT,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  supplier_due_history: `
    CREATE TABLE IF NOT EXISTS supplier_due_history (
      id TEXT PRIMARY KEY,
      date TEXT,
      supplier_id TEXT,
      supplier_name TEXT,
      previous_due REAL,
      purchase_amount REAL,
      payment_amount REAL,
      current_due REAL,
      note TEXT,
      created_by TEXT,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  supplier_payment_ledger: `
    CREATE TABLE IF NOT EXISTS supplier_payment_ledger (
      id TEXT PRIMARY KEY,
      payment_date TEXT UNIQUE,
      month TEXT,
      year TEXT,
      variety_store_amount REAL DEFAULT 0,
      morgir_dokan_amount REAL DEFAULT 0,
      burger_ban_amount REAL DEFAULT 0,
      created_by TEXT,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  deletions: `
    CREATE TABLE IF NOT EXISTS deletions (
      id TEXT PRIMARY KEY, -- tableName_recordId
      table_name TEXT,
      record_id TEXT,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  delete_history: `
    CREATE TABLE IF NOT EXISTS delete_history (
      id TEXT PRIMARY KEY,
      record_type TEXT,
      record_id TEXT,
      deleted_by TEXT,
      deleted_at TEXT,
      created_by TEXT,
      original_created_at TEXT,
      snapshot_data TEXT,
      sync_status INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  history_download_log: `
    CREATE TABLE IF NOT EXISTS history_download_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_type TEXT, -- ITEM_SALES, DEPOSIT_REPORT, MENU_RECOVERY
      requested_period TEXT, -- YYYY-MM-DD or YYYY-MM
      downloaded_at TEXT,
      downloaded_by TEXT
    );
  `,
  daily_submit_priority: `
    CREATE TABLE IF NOT EXISTS daily_submit_priority (
      business_date TEXT PRIMARY KEY,
      submitted_by TEXT,
      role TEXT,
      priority INTEGER,
      sync_source_device TEXT,
      device_id TEXT,
      submitted_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  owner_employees: `
    CREATE TABLE IF NOT EXISTS owner_employees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      designation TEXT,
      monthly_salary REAL NOT NULL,
      joining_date TEXT,
      status TEXT DEFAULT 'ACTIVE',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      is_synced INTEGER DEFAULT 0
    );
  `,
  owner_salary_ledger: `
    CREATE TABLE IF NOT EXISTS owner_salary_ledger (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_type TEXT NOT NULL,
      payment_date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      is_synced INTEGER DEFAULT 0,
      FOREIGN KEY (employee_id) REFERENCES owner_employees(id) ON DELETE CASCADE
    );
  `,
  owner_expenses: `
    CREATE TABLE IF NOT EXISTS owner_expenses (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      expense_date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      is_synced INTEGER DEFAULT 0
    );
  `,
  owner_deposits: `
    CREATE TABLE IF NOT EXISTS owner_deposits (
      id TEXT PRIMARY KEY,
      month TEXT NOT NULL,
      amount REAL NOT NULL,
      created_at TEXT NOT NULL,
      is_synced INTEGER DEFAULT 0
    );
  `,
  owner_home_deposits: `
    CREATE TABLE IF NOT EXISTS owner_home_deposits (
      id TEXT PRIMARY KEY,
      amount REAL NOT NULL,
      deposit_date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      is_synced INTEGER DEFAULT 0
    );
  `,
  activity_logs: `
    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      business_date TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      action_type TEXT NOT NULL,
      action_title TEXT NOT NULL,
      description TEXT,
      app_profile TEXT NOT NULL,
      user_role TEXT,
      user_name TEXT,
      device_id TEXT,
      device_name TEXT,
      device_model TEXT,
      device_platform TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      is_synced INTEGER DEFAULT 0
    );
  `,
  audit_outbox: `
    CREATE TABLE IF NOT EXISTS audit_outbox (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      business_date TEXT,
      app_profile TEXT,
      app_version TEXT,
      user_name TEXT,
      user_role TEXT,
      device_id TEXT,
      device_name TEXT,
      device_model TEXT,
      device_platform TEXT,
      table_name TEXT,
      action TEXT,
      record_id TEXT,
      changes TEXT,
      snapshot TEXT,
      status TEXT DEFAULT 'PENDING',
      retry_count INTEGER DEFAULT 0,
      last_error TEXT,
      sent_at TEXT
    );
  `
};

export function migrateMenuItemsTable() {
  try {
    // Check if table exists
    const tableExists = db.getFirstSync("SELECT name FROM sqlite_master WHERE type='table' AND name='menu_items'");
    if (!tableExists) return;

    // Check if it has a unique constraint on 'name' alone or if it needs migration
    const tableSql = db.getFirstSync("SELECT sql FROM sqlite_master WHERE type='table' AND name='menu_items'");
    let needsMigration = false;
    if (tableSql && tableSql.sql) {
      const sqlStr = tableSql.sql.toLowerCase();
      // If table SQL has "unique" on "name" but doesn't have "unique(name, category)" or "unique (name, category)", migrate it.
      if (sqlStr.includes("name text unique") || (sqlStr.includes("unique") && !sqlStr.includes("category"))) {
        needsMigration = true;
      }
    }

    if (needsMigration) {
      console.log("[DB Migration] Migrating menu_items table to compound UNIQUE(name, category)...");
      
      // 1. Fetch all existing menu items
      const existingItems = db.getAllSync("SELECT * FROM menu_items");
      
      // 2. Drop the old table
      db.execSync("DROP TABLE menu_items");
      
      // 3. Create the new table
      db.execSync(`
        CREATE TABLE menu_items (
          id TEXT PRIMARY KEY,
          name TEXT,
          price REAL,
          category TEXT,
          created_at TEXT,
          updated_at TEXT,
          is_synced INTEGER DEFAULT 0,
          UNIQUE(name, category)
        );
      `);
      
      // 4. Clean and re-insert the existing items
      const now = new Date().toISOString();
      const seen = new Set();
      for (const item of existingItems) {
        const key = `${String(item.name).trim().toLowerCase()}||${String(item.category || '').trim().toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          db.runSync(
            "INSERT INTO menu_items (id, name, price, category, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [item.id, item.name, item.price, item.category, item.created_at || now, item.updated_at || now, item.is_synced || 0]
          );
        } else {
          console.log(`[DB Migration] Dropped local duplicate item on migration: ${item.name} (${item.category})`);
        }
      }
      console.log("[DB Migration] menu_items table migration completed successfully.");
    }
  } catch (err) {
    console.error("[DB Migration] Failed to migrate menu_items table:", err);
  }
}

export function migrateDeliveryCharge() {
  try {
    // 1. Migrate orders table
    const ordersColumns = db.getAllSync("PRAGMA table_info(orders)");
    const ordersHasDeliveryCharge = ordersColumns.some(col => col.name === 'delivery_charge');
    if (!ordersHasDeliveryCharge) {
      console.log("[DB Migration] Adding delivery_charge column to orders table...");
      db.execSync("ALTER TABLE orders ADD COLUMN delivery_charge REAL DEFAULT 0");
    }
    const ordersHasChangeMoney = ordersColumns.some(col => col.name === 'change_money_given');
    if (!ordersHasChangeMoney) {
      console.log("[DB Migration] Adding change_money_given column to orders table...");
      db.execSync("ALTER TABLE orders ADD COLUMN change_money_given REAL DEFAULT 0");
    }

    // 2. Migrate payments table
    const paymentsColumns = db.getAllSync("PRAGMA table_info(payments)");
    const paymentsHasDeliveryCharge = paymentsColumns.some(col => col.name === 'delivery_charge');
    if (!paymentsHasDeliveryCharge) {
      console.log("[DB Migration] Adding delivery_charge column to payments table...");
      db.execSync("ALTER TABLE payments ADD COLUMN delivery_charge REAL DEFAULT 0");
    }
    const paymentsHasChangeMoney = paymentsColumns.some(col => col.name === 'change_money_given');
    if (!paymentsHasChangeMoney) {
      console.log("[DB Migration] Adding change_money_given column to payments table...");
      db.execSync("ALTER TABLE payments ADD COLUMN change_money_given REAL DEFAULT 0");
    }

    // 3. Migrate deliveries table
    const deliveriesColumns = db.getAllSync("PRAGMA table_info(deliveries)");
    const deliveriesHasDeliveryCharge = deliveriesColumns.some(col => col.name === 'delivery_charge');
    if (!deliveriesHasDeliveryCharge) {
      console.log("[DB Migration] Adding delivery_charge column to deliveries table...");
      db.execSync("ALTER TABLE deliveries ADD COLUMN delivery_charge REAL DEFAULT 0");
    }
    const deliveriesHasChangeMoney = deliveriesColumns.some(col => col.name === 'change_money_given');
    if (!deliveriesHasChangeMoney) {
      console.log("[DB Migration] Adding change_money_given column to deliveries table...");
      db.execSync("ALTER TABLE deliveries ADD COLUMN change_money_given REAL DEFAULT 0");
    }

    // 4. Migrate daily_summary table
    const summaryColumns = db.getAllSync("PRAGMA table_info(daily_summary)");
    const summaryHasDeliveryCharge = summaryColumns.some(col => col.name === 'total_delivery_charge');
    if (!summaryHasDeliveryCharge) {
      console.log("[DB Migration] Adding total_delivery_charge column to daily_summary table...");
      db.execSync("ALTER TABLE daily_summary ADD COLUMN total_delivery_charge REAL DEFAULT 0");
    }
  } catch (err) {
    console.error("[DB Migration] Failed to migrate delivery columns:", err);
  }
}

export function migrateSplitPayments() {
  try {
    const ordersCols = db.getAllSync("PRAGMA table_info(orders)");
    const paymentsCols = db.getAllSync("PRAGMA table_info(payments)");
    const submitCols = db.getAllSync("PRAGMA table_info(daily_submit)");
    
    const fields = ['cash_amount', 'bkash_amount', 'nagad_amount', 'rocket_amount', 'due_amount'];
    
    for (const f of fields) {
      if (!ordersCols.some(c => c.name === f)) {
        console.log(`[DB Migration] Adding ${f} to orders table...`);
        db.execSync(`ALTER TABLE orders ADD COLUMN ${f} REAL DEFAULT 0`);
      }
      if (!paymentsCols.some(c => c.name === f)) {
        console.log(`[DB Migration] Adding ${f} to payments table...`);
        db.execSync(`ALTER TABLE payments ADD COLUMN ${f} REAL DEFAULT 0`);
      }
    }

    if (!submitCols.some(c => c.name === 'rocket_payment')) {
       console.log("[DB Migration] Adding rocket_payment to daily_submit table...");
       db.execSync("ALTER TABLE daily_submit ADD COLUMN rocket_payment REAL DEFAULT 0");
    }

    if (!submitCols.some(c => c.name === 'submission_type')) {
       console.log("[DB Migration] Adding submission_type to daily_submit table...");
       db.execSync("ALTER TABLE daily_submit ADD COLUMN submission_type TEXT DEFAULT 'MANUAL'");
    }

    const summaryCols = db.getAllSync("PRAGMA table_info(daily_summary)");
    if (!summaryCols.some(c => c.name === 'rocketTotal')) {
       console.log("[DB Migration] Adding rocketTotal to daily_summary table...");
       db.execSync("ALTER TABLE daily_summary ADD COLUMN rocketTotal REAL DEFAULT 0");
    }
  } catch (err) {
    console.error("[DB Migration] Split payment migration failed:", err);
  }
}

export function migrateSyncQueueDiagnostics() {
  try {
    const queueColumns = db.getAllSync("PRAGMA table_info(sync_queue)");
    if (!queueColumns || queueColumns.length === 0) return;

    const hasRetryCount = queueColumns.some(col => col.name === 'retry_count');
    const hasLastError = queueColumns.some(col => col.name === 'last_error');
    const hasLastAttemptAt = queueColumns.some(col => col.name === 'last_attempt_at');

    if (!hasRetryCount) {
      db.execSync("ALTER TABLE sync_queue ADD COLUMN retry_count INTEGER DEFAULT 0");
    }
    if (!hasLastError) {
      db.execSync("ALTER TABLE sync_queue ADD COLUMN last_error TEXT");
    }
    if (!hasLastAttemptAt) {
      db.execSync("ALTER TABLE sync_queue ADD COLUMN last_attempt_at TEXT");
    }
  } catch (err) {
    console.error("[DB Migration] Sync queue diagnostics migration failed:", err);
  }
}

// Phase 2: independent Supabase outbound queue (mirrors sync_queue; Firebase untouched).
export function migrateSupabaseSyncQueue() {
  try {
    db.execSync(`
      CREATE TABLE IF NOT EXISTS sync_queue_supabase (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id TEXT,
        table_name TEXT,
        action TEXT, -- INSERT, UPDATE, DELETE
        status TEXT DEFAULT 'PENDING', -- PENDING, SUCCESS, FAILED
        created_at TEXT,
        retry_count INTEGER DEFAULT 0,
        last_error TEXT,
        last_attempt_at TEXT
      );
    `);
  } catch (err) {
    console.error("[DB Migration] Supabase sync queue migration failed:", err);
  }
}

// Phase 4: deterministic same-role multi-device tie-breaker columns.
export function migrateDailySubmitPriorityTiebreaker() {
  try {
    const cols = db.getAllSync("PRAGMA table_info(daily_submit_priority)");
    if (!cols || cols.length === 0) return;
    if (!cols.some(c => c.name === 'submitted_at')) {
      console.log("[DB Migration] Adding submitted_at to daily_submit_priority...");
      db.execSync("ALTER TABLE daily_submit_priority ADD COLUMN submitted_at TEXT");
    }
    if (!cols.some(c => c.name === 'device_id')) {
      console.log("[DB Migration] Adding device_id to daily_submit_priority...");
      db.execSync("ALTER TABLE daily_submit_priority ADD COLUMN device_id TEXT");
    }
  } catch (err) {
    console.error("[DB Migration] daily_submit_priority tie-breaker migration failed:", err);
  }
}

// Phase 7.2: PER-BACKEND Supabase sync flag.
// `is_synced` stays FIREBASE-ONLY (unchanged). `is_synced_supabase` tracks the
// independent Supabase push, so the Supabase pull never trusts Firebase's flag.
// This is the fix for the shared-flag flicker on dual-written tables (a fast
// Firebase push flipped is_synced=1, so the slower Supabase pull wrongly trusted
// its still-stale copy and overwrote the local edit).
export function migrateSupabaseSyncFlags() {
  try {
    const tables = db.getAllSync("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    for (const t of tables) {
      const name = t && t.name;
      if (!name || name === '_backup_metadata') continue;
      let cols = [];
      try { cols = db.getAllSync(`PRAGMA table_info(${name})`).map((c) => c.name); } catch (_) { continue; }
      if (!cols.includes('is_synced')) continue;         // only synced tables participate
      if (cols.includes('is_synced_supabase')) continue; // already migrated
      try {
        db.execSync(`ALTER TABLE ${name} ADD COLUMN is_synced_supabase INTEGER DEFAULT 0`);
      } catch (e) {
        console.error(`[DB Migration] is_synced_supabase add failed for ${name}:`, e.message);
      }
    }
  } catch (err) {
    console.error("[DB Migration] Supabase sync-flags migration failed:", err);
  }
}

export function migrateDailySubmitUnified() {
  try {
    const submitCols = db.getAllSync("PRAGMA table_info(daily_submit)");
    const columnsToAdd = [
      { name: 'delivery_sell', type: 'REAL DEFAULT 0' },
      { name: 'delivery_charge', type: 'REAL DEFAULT 0' },
      { name: 'net_cash', type: 'REAL DEFAULT 0' },
      { name: 'notes', type: 'TEXT' }
    ];

    for (const col of columnsToAdd) {
      if (!submitCols.some(c => c.name === col.name)) {
        console.log(`[DB Migration] Adding ${col.name} to daily_submit table...`);
        db.execSync(`ALTER TABLE daily_submit ADD COLUMN ${col.name} ${col.type}`);
      }
    }
  } catch (err) {
    console.error("[DB Migration] Daily submit unified migration failed:", err);
  }
}

export function migrateDeleteHistory() {
  try {
    const tableInfo = db.getAllSync("PRAGMA table_info(delete_history)");
    if (tableInfo.length > 0) {
      const hasOriginalCreatedAt = tableInfo.some(c => c.name === 'original_created_at');
      if (!hasOriginalCreatedAt) {
        console.log("[DB Migration] Old delete_history found. Dropping and recreating for new audit system...");
        db.execSync("DROP TABLE IF EXISTS delete_history");
        db.execSync(TABLE_SCHEMAS.delete_history);
      }
    }
  } catch (err) {
    console.error("[DB Migration] Delete history migration failed:", err);
  }
}

export function migrateSupplierDue() {
  try {
    const tableInfo = db.getAllSync("PRAGMA table_info(supplier_due)");
    const hasPreviousDue = tableInfo.some(c => c.name === 'previous_due');
    if (hasPreviousDue) {
      db.execSync("DROP TABLE IF EXISTS supplier_due");
      db.execSync(TABLE_SCHEMAS.supplier_due);
    }

    const now = new Date().toISOString();
    const dudu = db.getFirstSync("SELECT id FROM supplier_due WHERE id = 'dudu_store'");
    if (!dudu) {
      db.runSync(
        "INSERT INTO supplier_due (id, supplier_name, current_due, note, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, ?, 0)",
        ['dudu_store', '🥛 দুদু স্টোর', 4000, '', now, now]
      );
    }
    const akash = db.getFirstSync("SELECT id FROM supplier_due WHERE id = 'akash_murgi'");
    if (!akash) {
      db.runSync(
        "INSERT INTO supplier_due (id, supplier_name, current_due, note, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, ?, 0)",
        ['akash_murgi', '🐔 আকাশ মুরগি', 5000, '', now, now]
      );
    }
    const burger = db.getFirstSync("SELECT id FROM supplier_due WHERE id = 'burger_bun'");
    if (!burger) {
      db.runSync(
        "INSERT INTO supplier_due (id, supplier_name, current_due, note, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, ?, 0)",
        ['burger_bun', '🍔 বার্গার বান', 0, '', now, now]
      );
    }
  } catch (err) {
    console.error("[DB Migration] Supplier Due migration failed:", err);
  }
}

export function migrateAIDatasetTables() {
  try {
    const queueCols = db.getAllSync("PRAGMA table_info(ai_dataset_queue)");
    if (queueCols && queueCols.length > 0) {
      if (!queueCols.some(c => c.name === 'is_synced')) {
        console.log("[DB Migration] Adding is_synced to ai_dataset_queue...");
        db.execSync("ALTER TABLE ai_dataset_queue ADD COLUMN is_synced INTEGER DEFAULT 0");
      }
      if (!queueCols.some(c => c.name === 'retry_count')) {
        console.log("[DB Migration] Adding retry_count to ai_dataset_queue...");
        db.execSync("ALTER TABLE ai_dataset_queue ADD COLUMN retry_count INTEGER DEFAULT 0");
      }
      if (!queueCols.some(c => c.name === 'last_error')) {
        console.log("[DB Migration] Adding last_error to ai_dataset_queue...");
        db.execSync("ALTER TABLE ai_dataset_queue ADD COLUMN last_error TEXT DEFAULT NULL");
      }
    }
    const historyCols = db.getAllSync("PRAGMA table_info(ai_dataset_history)");
    if (historyCols && historyCols.length > 0) {
      if (!historyCols.some(c => c.name === 'is_synced')) {
        console.log("[DB Migration] Adding is_synced to ai_dataset_history...");
        db.execSync("ALTER TABLE ai_dataset_history ADD COLUMN is_synced INTEGER DEFAULT 0");
      }
    }
  } catch (err) {
    console.error("[DB Migration] AI Dataset tables migration failed:", err);
  }
}

// ==========================================
// 1. AUTO INITIALIZATION ENGINE
// ==========================================

export function initDatabase(skipSeeding = false) {
  console.log(`[DB] Starting Auto Initialization (skipSeeding=${skipSeeding})...`);
  try {
    // Run schema migrations first
    migrateMenuItemsTable();
    migrateDeliveryCharge();
    migrateSplitPayments();
    migrateDailySubmitUnified();
    migrateSupplierDue();
    migrateDeleteHistory();
    migrateAIDatasetTables();

    // 1. Create tables
    for (const [tableName, sql] of Object.entries(TABLE_SCHEMAS)) {
      db.execSync(sql);
    }
    try {
      db.execSync(`
        CREATE INDEX IF NOT EXISTS idx_activity_logs_date ON activity_logs (business_date);
        CREATE INDEX IF NOT EXISTS idx_activity_logs_time ON activity_logs (timestamp);
      `);
    } catch (idxErr) {}
    migrateSyncQueueDiagnostics();
    migrateSupabaseSyncQueue();
    migrateDailySubmitPriorityTiebreaker();
    migrateSupabaseSyncFlags();
    console.log("[DB] SQLite Tables Verified/Created successfully.");

    // Check if one-off database wipe is required to prepare a completely fresh environment
    let isWiped = false;
    try {
      const configVal = db.getFirstSync("SELECT value FROM app_config WHERE key = 'db_wiped_v2'");
      if (configVal && configVal.value === 'true') {
        isWiped = true;
      }
    } catch (e) {
      // If table doesn't exist yet, it's fine, we will wipe
    }

    if (!isWiped) {
      console.log("[DB] Performing one-time full database wipe to clear all demo data...");
      const tablesToWipe = [
        'users', 'restaurant_tables', 'orders', 'order_items', 'payments', 
        'expenses', 'deliveries', 'daily_submit', 'daily_summary', 
        'menu_categories', 'menu_items', 'due_payments', 'eja_history', 
        'off_days', 'weather_data', 'sync_queue'
      ];
      for (const t of tablesToWipe) {
        try {
          db.execSync(`DELETE FROM ${t}`);
        } catch (err) {
          console.log(`[DB] Note: Failed to wipe table ${t} (might not exist yet):`, err.message);
        }
      }
      try {
        db.runSync("INSERT OR REPLACE INTO app_config (key, value) VALUES ('db_wiped_v2', 'true')");
        console.log("[DB] One-time database wipe completed successfully. Config flag set.");
      } catch (err) {
        console.error("[DB] Failed to save database wipe configuration flag:", err);
      }
    }

    if (skipSeeding) {
      startSyncService();
      return true;
    }

    // 2. Seed Default Users if none exist
    const userCount = db.getFirstSync("SELECT COUNT(*) as count FROM users");
    if (userCount.count === 0) {
      console.log("[DB] Seeding Default Users...");
      const defaultUsers = [
        { id: "owner_ro", username: "ro", pin: "2420", role: "owner", display_name: "মালিক (Owner)" },
        { id: "manager_shakib1", username: "m", pin: "1111", role: "manager", display_name: "ম্যানেজার (Manager)" },
        { id: "admin_a", username: "a", pin: "1323", role: "admin", display_name: "অ্যাডমিন (Admin)" }
      ];
      const now = new Date().toISOString();
      for (const u of defaultUsers) {
        db.runSync(
          "INSERT INTO users (id, username, pin, role, display_name, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
          [u.id, u.username, u.pin, u.role, u.display_name, now, now]
        );
        enqueueSync("users", u.id, "INSERT");
      }
    } else {
      // Migrate existing usernames and pins if they already exist in database
      try {
        // Remove deprecated owner_shakib user
        const oldOwner = db.getFirstSync("SELECT id FROM users WHERE username = 'rokib'");
        if (oldOwner) {
          db.runSync("DELETE FROM users WHERE username = 'rokib'");
          enqueueSync("users", oldOwner.id, "DELETE");
          console.log("[DB Migration] Removed deprecated owner_shakib user");
        }
        // Ensure owner_ro exists for existing databases
        const ownerRo = db.getFirstSync("SELECT id FROM users WHERE username = 'ro'");
        if (!ownerRo) {
          const now = new Date().toISOString();
          db.runSync(
            "INSERT INTO users (id, username, pin, role, display_name, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
            ["owner_ro", "ro", "2420", "owner", "মালিক (Owner)", now, now]
          );
          enqueueSync("users", "owner_ro", "INSERT");
        }
      } catch (err) {
        console.error("[DB Migration] Failed to update usernames and pins:", err);
      }
    }

    // 3. Seed/Sync Fixed 8 Restaurant Tables
    console.log("[DB] Verifying Fixed 8 Restaurant Tables...");
    const fixedTables = [
      { id: 'table_1', name: 'T-1' },
      { id: 'table_2', name: 'T-2' },
      { id: 'table_3', name: 'T-3' },
      { id: 'table_4', name: 'T-4' },
      { id: 'table_5', name: 'কাচ' },
      { id: 'table_6', name: 'গাছ' },
      { id: 'table_7', name: 'বাহির' },
      { id: 'table_8', name: 'Extra' },
    ];

    const now = new Date().toISOString();
    
    // Insert or update the 8 fixed tables
    for (const ft of fixedTables) {
      const existing = db.getFirstSync("SELECT * FROM restaurant_tables WHERE id = ?", [ft.id]);
      if (!existing) {
        db.runSync(
          "INSERT INTO restaurant_tables (id, table_id, table_name, status, items, startTime, created_at, updated_at, is_synced) VALUES (?, ?, ?, 'FREE', '[]', '', ?, ?, 0)",
          [ft.id, ft.id, ft.name, now, now]
        );
        enqueueSync("restaurant_tables", ft.id, "INSERT");
      } else if (existing.table_name !== ft.name) {
        // Force rename to match our strict naming
        console.log(`[TABLE8-DEBUG] init rename-mismatch ${ft.id}: local="${existing.table_name}" -> "${ft.name}"`);
        db.runSync(
          "UPDATE restaurant_tables SET table_name = ?, updated_at = ?, is_synced = 0 WHERE id = ?",
          [ft.name, now, ft.id]
        );
        enqueueSync("restaurant_tables", ft.id, "UPDATE");
      }
    }

    // Prune any other tables from SQLite to prevent duplicates
    try {
      const allTables = db.getAllSync("SELECT id FROM restaurant_tables");
      const fixedIds = fixedTables.map(ft => ft.id);
      for (const t of allTables) {
        if (!fixedIds.includes(t.id)) {
          console.log(`[DB] Pruning extra restaurant table: ${t.id} from local and cloud...`);
          db.runSync("DELETE FROM restaurant_tables WHERE id = ?", [t.id]);
          enqueueSync("restaurant_tables", t.id, "DELETE");
        }
      }
    } catch (err) {
      console.error("[DB Pruning] Failed to prune tables:", err);
    }

    // 4. Seed Default Restaurant Menu (56 items) is disabled to support a completely fresh data store
    // seedDefaultMenu();

    // Clean up duplicate menu items locally and push deletes to Firebase
    cleanupDuplicateMenuItems();

    // 5. Initialize Services automatically
    startSyncService();
    triggerWeatherFetch();
    triggerGoogleSheetExportCheck();
    triggerWeatherTimelineService();

    // 6. Audit & Migration: Add unit_price to order_items if missing and fix Water sales
    try {
      // PURGE FORBIDDEN QUEUE ITEMS (Fixes 403 errors)
      const forbiddenTables = ['ai_dataset_queue', 'ai_dataset_history', 'weather_timeline_queue'];
      const placeholders = forbiddenTables.map(() => '?').join(',');
      db.runSync(`DELETE FROM sync_queue WHERE table_name IN (${placeholders})`, forbiddenTables);
      console.log("[DB Audit] Purged forbidden local-only items from sync_queue.");

      // Add column if it doesn't exist (SQLite doesn't support IF NOT EXISTS for ADD COLUMN)
      const tableInfo = db.getAllSync("PRAGMA table_info(order_items)");
      const hasUnitPrice = tableInfo.some(col => col.name === 'unit_price');
      if (!hasUnitPrice) {
        db.runSync("ALTER TABLE order_items ADD COLUMN unit_price REAL DEFAULT 0");
      }

      // Historical Data Fix: 
      // 1. Populate unit_price from revenue/quantity where missing
      db.runSync("UPDATE order_items SET unit_price = revenue / quantity WHERE quantity > 0 AND (unit_price IS NULL OR unit_price = 0)");
      
      // 2. Specifically fix "পানি" (Water) where revenue might have been 0
      // We use 20 as the industry standard/fallback for this project
      db.runSync("UPDATE order_items SET unit_price = 20, revenue = quantity * 20 WHERE itemName = 'পানি' AND (revenue = 0 OR unit_price = 0)");
      
      console.log("[DB Audit] order_items table audited and historical Water sales fixed.");
    } catch (err) {
      console.error("[DB Audit] Failed to audit order_items:", err);
    }

    console.log("[DB] Auto Initialization Completed successfully.");
    return true;
  } catch (error) {
    console.error("[DB] Critical DB initialization error:", error);
    return false;
  }
}

export function seedDefaultMenu() {
  try {
    const countRes = db.getFirstSync("SELECT COUNT(*) as count FROM menu_items");
    const count = countRes ? countRes.count : 0;
    if (count > 0) {
      console.log(`[DB] Seeding skipped. menu_items already contains ${count} items.`);
      return;
    }

    console.log("[DB] menu_items count is 0. Auto-seeding default restaurant menu...");
    const now = new Date().toISOString();
    for (const item of DEFAULT_MENU) {
      const cleanName = String(item.name).trim();
      const cleanCategory = String(item.category || '').trim();
      
      const uniqueString = `${cleanName.toLowerCase()}||${cleanCategory.toLowerCase()}`;
      let hash = 0;
      for (let i = 0; i < uniqueString.length; i++) {
        hash = Math.imul(31, hash) + uniqueString.charCodeAt(i) | 0;
      }
      const id = `menu_seed_${Math.abs(hash)}`;

      const exists = db.getFirstSync(
        "SELECT id FROM menu_items WHERE LOWER(TRIM(name)) = LOWER(?) AND LOWER(TRIM(category)) = LOWER(?)",
        [cleanName, cleanCategory]
      );
      if (!exists) {
        db.runSync(
          "INSERT OR REPLACE INTO menu_items (id, name, price, category, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, ?, 0)",
          [id, cleanName, item.price, cleanCategory, now, now]
        );
        enqueueSync("menu_items", id, "INSERT");
      }
    }
    console.log(`[DB] Seeding finished. ${DEFAULT_MENU.length} items verified.`);
  } catch (err) {
    console.error("[DB] Failed to seed default restaurant menu:", err);
  }
}

export function cleanupDuplicateMenuItems() {
  try {
    console.log("[DB] Starting local and cloud duplicate menu item cleanup...");
    // Order by created_at DESC or id DESC to keep the newest items
    const rows = db.getAllSync("SELECT * FROM menu_items ORDER BY created_at DESC, id DESC");
    const seenKeys = new Set();
    let deleteCount = 0;

    for (const r of rows) {
      const cleanName = String(r.name).trim().toLowerCase();
      const cleanCategory = String(r.category || '').trim().toLowerCase();
      const compoundKey = `${cleanName}||${cleanCategory}`;

      if (seenKeys.has(compoundKey)) {
        // This is a duplicate! Let's delete it locally
        db.runSync("DELETE FROM menu_items WHERE id = ?", [r.id]);
        
        // Enqueue deletion in Firestore sync queue!
        enqueueSync("menu_items", r.id, "DELETE");
        
        console.log(`[DB] Enqueued DELETE for duplicate menu item: "${r.name}" [${r.category}] (ID: ${r.id})`);
        deleteCount++;
      } else {
        seenKeys.add(compoundKey);
      }
    }
    
    if (deleteCount > 0) {
      console.log(`[DB] Successfully cleaned up ${deleteCount} duplicate items in SQLite and enqueued Firestore deletes.`);
      processSyncQueue();
    } else {
      console.log("[DB] No duplicate menu items found.");
    }
    return deleteCount;
  } catch (err) {
    console.error("[DB] Cleanup duplicate menu items failed:", err);
    return 0;
  }
}

// ==========================================
// 2. SYNCHRONIZATION QUEUE SYSTEM
// ==========================================

// PK column for a local table (mirrors the Supabase conflict key).
function getLocalRecordPkColumn(tableName) {
  if (tableName === 'daily_submit' || tableName === 'daily_summary' || tableName === 'ai_dataset_history') return 'date';
  if (tableName === 'daily_submit_priority') return 'business_date';
  return 'id';
}

export function enqueueSync(tableName, recordId, action) {
  try {
    // SECURITY GUARD: Never enqueue auth credentials into sync_queue
    if (isAuthCredentialKey(recordId) || (tableName === 'app_config' && String(recordId).startsWith('_fb_auth_'))) {
      return;
    }

    // IGNORE local-only tables to prevent Firestore 403 errors
    const forbiddenTables = ['ai_dataset_queue', 'ai_dataset_history', 'weather_timeline_queue'];
    if (forbiddenTables.includes(tableName)) return;

    // ISOLATED AUDIT STREAM: append a fire-and-forget activity event for the
    // dedicated audit project. Strictly additive (lazy require + try/catch) and
    // it never throws, so it cannot affect the sync path in any way.
    try {
      getAuditModule().recordActivity({ tableName, recordId, action });
    } catch (_) {}

    // DEBUG: trace who enqueues restaurant_tables writes (table_8 loop investigation).
    if (tableName === 'restaurant_tables') {
      const caller = (new Error().stack || '').split('\n').slice(2, 4).map((s) => s.trim()).join(' <- ');
      console.log(`[TABLE8-DEBUG] enqueue ${action} id=${recordId} caller=${caller}`);
    }

    // R3/R4 fix: a genuine add/update clears any stale tombstone for this record
    // so a legitimate re-create is not permanently blocked by the merge-skip.
    if (action !== 'DELETE') {
      clearTombstone(db, tableName, recordId);
      // Phase 7.2: mark this record as UNSYNCED-to-Supabase (mirrors the is_synced
      // reset done at the local write sites) so the Supabase pull won't overwrite
      // the fresh local edit with a stale Supabase copy.
      try {
        db.runSync(
          `UPDATE ${tableName} SET is_synced_supabase = 0 WHERE ${getLocalRecordPkColumn(tableName)} = ?`,
          [recordId]
        );
      } catch (_) {}
    }

    // Delete any pending write for this specific record in the queue to avoid stale runs
    db.runSync(
      "DELETE FROM sync_queue WHERE record_id = ? AND table_name = ? AND status = 'PENDING'",
      [recordId, tableName]
    );
    // Add fresh PENDING sync
    db.runSync(
      "INSERT INTO sync_queue (record_id, table_name, action, status, created_at) VALUES (?, ?, ?, 'PENDING', ?)",
      [recordId, tableName, action, new Date().toISOString()]
    );

    // PHASE 2 DUAL-WRITE: mirror the write into the independent Supabase queue.
    // Runs AFTER the Firebase enqueue above and is fully isolated (lazy require +
    // try/catch) so a Supabase failure can never affect the Firebase path.
    try {
      const { enqueueSupabaseSync } = require('./services/supabaseSyncQueue.js');
      enqueueSupabaseSync(tableName, recordId, action);
    } catch (supaEnqueueErr) {
      console.warn("[DB] Supabase enqueue delegation skipped (isolated):", supaEnqueueErr?.message || supaEnqueueErr);
    }
  } catch (err) {
    console.error("[DB] Failed to enqueue sync:", err);
  }
}

// Helper to convert SQLite flat row objects into Google Firestore REST payload format
function toFirestoreDocument(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'is_synced' || k === 'is_synced_supabase') continue; // local only
    if (v === null || v === undefined) continue;
    
    if (typeof v === 'string') {
      fields[k] = { stringValue: v };
    } else if (typeof v === 'number') {
      fields[k] = { doubleValue: v };
    } else if (typeof v === 'boolean') {
      fields[k] = { booleanValue: v };
    } else if (typeof v === 'object') {
      fields[k] = { stringValue: JSON.stringify(v) };
    } else {
      fields[k] = { stringValue: String(v) };
    }
  }
  return { fields };
}

// Global Sync Service Processor (Offline-first Background Worker)
let syncIntervalId = null;
let isSystemOnline = true; // Tracked via App.js / NetInfo

export function setSystemOnline(online) {
  isSystemOnline = !!online;
}

const MAX_FAILED_RETRY_DELAY_MS = 10 * 60 * 1000;

function getFailedQueueRetryDelayMs(retryCount = 0) {
  const safeRetryCount = Math.max(0, Number(retryCount) || 0);
  return Math.min(MAX_FAILED_RETRY_DELAY_MS, Math.pow(2, safeRetryCount) * 30000);
}

function isFailedQueueItemRetryDue(item, nowMs = Date.now()) {
  if (!item.last_attempt_at) return true;
  const lastAttemptMs = new Date(item.last_attempt_at).getTime();
  if (!Number.isFinite(lastAttemptMs)) return true;
  return nowMs - lastAttemptMs >= getFailedQueueRetryDelayMs(item.retry_count || 0);
}

const syncRuntimeDiagnostics = {
  timers: {},
  lastSuccess: {},
  lastFailure: {},
  lastSkipped: {},
  lastStarted: {},
  lastFinished: {},
  lastHung: {},
  inFlight: {},
  eventLoopLag: {},
  appStates: [],
  uncaughtErrors: [],
  appState: AppState?.currentState || 'unknown',
  readCounters: {
    highFrequency: 0,
    lowFrequency: 0,
    tables: 0,
    deletions: 0,
    recovery: 0,
    restore: 0,
    historical: 0,
    menu: 0,
    background: 0,
    foreground: 0,
    netInfo: 0,
    total: 0,
    netInfoCount: 0,
    foregroundCount: 0
  },
  cycleStats: []
};

export function incrementNetInfoRecoveryCount() {
  syncRuntimeDiagnostics.readCounters.netInfoCount += 1;
}

export function incrementForegroundRecoveryCount() {
  syncRuntimeDiagnostics.readCounters.foregroundCount += 1;
}

function incrementReadCounter(type, count = 1) {
  if (syncRuntimeDiagnostics.readCounters[type] !== undefined) {
    syncRuntimeDiagnostics.readCounters[type] += count;
  }
  syncRuntimeDiagnostics.readCounters.total += count;
  
  if (AppState && AppState.currentState === 'active') {
    syncRuntimeDiagnostics.readCounters.foreground += count;
  } else {
    syncRuntimeDiagnostics.readCounters.background += count;
  }
}

export function registerSyncTimer(name, intervalMs, functionName) {
  syncRuntimeDiagnostics.timers[name] = {
    function: functionName,
    intervalMs,
    registeredAt: new Date().toISOString(),
    active: true
  };
  console.log(`[Sync Timer] ACTIVE name=${name} function=${functionName} interval=${intervalMs}ms`);
}

export function markSyncTimerInactive(name) {
  if (syncRuntimeDiagnostics.timers[name]) {
    syncRuntimeDiagnostics.timers[name].active = false;
    syncRuntimeDiagnostics.timers[name].clearedAt = new Date().toISOString();
  }
  console.log(`[Sync Timer] INACTIVE name=${name}`);
}

export function recordAutoSyncEvent(name, status, details = '') {
  const now = new Date().toISOString();
  if (status === 'started') {
    syncRuntimeDiagnostics.lastStarted[name] = { at: now, details };
    syncRuntimeDiagnostics.inFlight[name] = { startedAt: now, details };
  } else if (status === 'finished') {
    syncRuntimeDiagnostics.lastFinished[name] = { at: now, details };
    delete syncRuntimeDiagnostics.inFlight[name];
  } else if (status === 'hang') {
    syncRuntimeDiagnostics.lastHung[name] = { at: now, details };
  } else if (status === 'appstate') {
    syncRuntimeDiagnostics.appState = details;
    syncRuntimeDiagnostics.appStates.push({ at: now, state: details });
    if (syncRuntimeDiagnostics.appStates.length > 20) syncRuntimeDiagnostics.appStates.shift();
  } else if (status === 'uncaught') {
    syncRuntimeDiagnostics.uncaughtErrors.push({ at: now, details });
    if (syncRuntimeDiagnostics.uncaughtErrors.length > 20) syncRuntimeDiagnostics.uncaughtErrors.shift();
  } else if (status === 'event-loop-lag') {
    syncRuntimeDiagnostics.eventLoopLag[name] = { at: now, details };
  }

  if (status === 'success') {
    syncRuntimeDiagnostics.lastSuccess[name] = now;
    delete syncRuntimeDiagnostics.inFlight[name];
  } else if (status === 'failure') {
    syncRuntimeDiagnostics.lastFailure[name] = { at: now, details };
    delete syncRuntimeDiagnostics.inFlight[name];
  } else if (status === 'skipped') {
    syncRuntimeDiagnostics.lastSkipped[name] = { at: now, details };
  }
  const suffix = details ? ` details=${details}` : '';
  console.log(`[Sync Runtime] ${name} ${status} at ${now}${suffix}`);
}

export async function traceSyncOperation(name, operation) {
  const startedAtMs = Date.now();
  recordAutoSyncEvent(name, 'started', `timestamp=${new Date(startedAtMs).toISOString()}`);
  try {
    const result = await operation();
    const durationMs = Date.now() - startedAtMs;
    recordAutoSyncEvent(name, 'finished', `durationMs=${durationMs} result=${JSON.stringify(result)}`);
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAtMs;
    recordAutoSyncEvent(name, 'failure', `durationMs=${durationMs} error=${err.message}`);
    throw err;
  }
}

export function getSyncRuntimeDiagnostics() {
  return {
    ...syncRuntimeDiagnostics,
    appState: AppState?.currentState || syncRuntimeDiagnostics.appState,
    daemonRunning: syncIntervalId !== null
  };
}

export function startSyncService() {
  if (syncIntervalId) return;
  console.log("[Sync] Starting Background Sync Daemon (Fast Recovery Mode: 5s)...");
  registerSyncTimer('queue-push-daemon', 5000, 'processSyncQueue');
  
  syncIntervalId = setInterval(async () => {
    const timerName = 'queue-push-daemon';
    if (AppState && AppState.currentState !== 'active') {
      recordAutoSyncEvent(timerName, 'skipped', `appState=${AppState.currentState}`);
      return;
    }

    if (isProcessingSyncQueue) {
      recordAutoSyncEvent(timerName, 'skipped', 'already-processing-queue');
      return;
    }

    let watchdog = null;
    try {
      // 4-second watchdog for 5-second cycle
      watchdog = setTimeout(() => {
        recordAutoSyncEvent(timerName, 'hang', 'processSyncQueue has not returned after 4000ms');
      }, 4000);
      
      const result = await traceSyncOperation(`${timerName}:processSyncQueue`, () => processSyncQueue());
      recordAutoSyncEvent(timerName, 'success', `writes=${result.successfulWrites || 0} failed=${result.failedWrites || 0}`);
    } catch (err) {
      recordAutoSyncEvent(timerName, 'failure', err.message);
    } finally {
      if (watchdog) clearTimeout(watchdog);
    }
  }, 5000); // Check and push changes every 5 seconds
}

export async function processSyncQueue(singleRecordId = null, singleTableName = null) {
  // CHECK IF SYNC IS PAUSED
  if (isSyncPaused()) {
    console.log("[Sync Processor] Sync is PAUSED. Skipping queue processing.");
    return { beforeCount: 0, afterCount: 0, successfulWrites: 0, failedWrites: 0 };
  }

  // Concurrency Lock: Prevent multiple cycles from overlapping
  if (isProcessingSyncQueue && !singleRecordId) return { beforeCount: 0, afterCount: 0, successfulWrites: 0, failedWrites: 0 };
  
  if (!singleRecordId) isProcessingSyncQueue = true;

  try {
    const projectId = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
    const apiKey = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_API_KEY);

    if (!projectId || !apiKey) {
      lastSyncError = "Environment variables missing: EXPO_PUBLIC_FIREBASE_PROJECT_ID or EXPO_PUBLIC_FIREBASE_API_KEY is not defined.";
      return {
        beforeCount: 0,
        afterCount: 0,
        successfulWrites: 0,
        failedWrites: 0,
        error: lastSyncError
      };
    }

    let beforeCount = 0;
    let afterCount = 0;
    let successfulWrites = 0;
    let failedWrites = 0;

    if (!isSystemOnline && !singleRecordId) {
      console.log("[Sync Processor] Skipping queue processing because system is OFFLINE.");
      return { beforeCount: 0, afterCount: 0, successfulWrites: 0, failedWrites: 0 };
    }

    // Wrap core logic to ensure lock release
    const runProcessor = async () => {
      // Check if database instance is active before querying
      if (!dbInstance) {
        throw new Error("[Sync] Native SQLite Database reference 'db' is null or undefined.");
      }

      // 1. Fetch items to process
      let pendingItems = [];
      if (singleRecordId && singleTableName) {
        // Immediate mode: process only the requested record if it's in the queue
        pendingItems = dbInstance.getAllSync(
          "SELECT * FROM sync_queue WHERE record_id = ? AND table_name = ? AND (status = 'PENDING' OR status = 'FAILED') ORDER BY status DESC, id ASC",
          [String(singleRecordId), singleTableName]
        );
      } else {
        // Batch mode: fetch up to 20 pending or failed items, prioritizing PENDING before FAILED
        const beforeRes = dbInstance.getFirstSync(
          "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING' OR status = 'FAILED'"
        );
        beforeCount = beforeRes ? beforeRes.count : 0;

        pendingItems = dbInstance.getAllSync(
          "SELECT * FROM sync_queue WHERE status = 'PENDING' ORDER BY id ASC LIMIT 20"
        );

        if (pendingItems.length < 20) {
          const failedCandidates = dbInstance.getAllSync(
            "SELECT * FROM sync_queue WHERE status = 'FAILED' ORDER BY id ASC LIMIT 100"
          );
          const nowMs = Date.now();
          const retryDue = failedCandidates.filter(item => isFailedQueueItemRetryDue(item, nowMs));
          const skippedFailed = failedCandidates.length - retryDue.length;
          if (skippedFailed > 0) {
            console.log(`[Queue Audit] Backoff skipped ${skippedFailed} failed records this cycle. New pending records are not blocked.`);
          }
          pendingItems = pendingItems.concat(retryDue.slice(0, 20 - pendingItems.length));
        }
      }

      if (pendingItems.length === 0) {
        return { beforeCount, afterCount: 0, successfulWrites, failedWrites };
      }

      if (!singleRecordId) {
        console.log(`[Sync Processor] Starting batch sync. Queue size before: ${beforeCount}. Items in batch: ${pendingItems.length}`);
        const queueSnapshot = pendingItems.map(item => ({
          queueId: item.id,
          collection: item.table_name,
          recordId: item.record_id,
          action: item.action,
          status: item.status,
          retryCount: item.retry_count || 0,
          lastError: item.last_error || '',
          createdAt: item.created_at,
          lastAttemptAt: item.last_attempt_at || ''
        }));
        console.log(`[Queue Audit] First ${pendingItems.length} pending/failed records: ${JSON.stringify(queueSnapshot)}`);
      }

      for (const item of pendingItems) {
        const { id: queueId, record_id: recordId, table_name: tableName, action } = item;
        
        if (!queueId) continue;

        // SURGICAL CLEANUP: Remove local-only tables from sync queue (Prevents 403 blocks)
        const forbiddenTables = ['ai_dataset_queue', 'ai_dataset_history', 'weather_timeline_queue'];
        if (forbiddenTables.includes(tableName)) {
          console.log(`[Queue Cleanup] Removing forbidden local-only item queueId=${queueId} collection=${tableName}`);
          dbInstance.runSync("DELETE FROM sync_queue WHERE id = ?", [Number(queueId)]);
          successfulWrites++;
          continue;
        }

        // SECURITY GUARD: Never sync auth credentials if somehow queued
        if (tableName === 'app_config' && isAuthCredentialKey(recordId)) {
          console.log(`[Queue Cleanup] Removing forbidden auth credential queue item queueId=${queueId}`);
          dbInstance.runSync("DELETE FROM sync_queue WHERE id = ?", [Number(queueId)]);
          continue;
        }

        if (!tableName || !recordId) {
          // Delete invalid/empty sync queue records to clear them from SQLite
          console.log(`[Queue Audit] Removing invalid queue item queueId=${queueId} collection=${tableName || ''} recordId=${recordId || ''} action=${action || ''}`);
          dbInstance.runSync("DELETE FROM sync_queue WHERE id = ?", [Number(queueId)]);
          successfulWrites++;
          continue;
        }

        // PRE-DISPATCH AUTH GUARD: Never dispatch unauthenticated requests to Firestore
        const auth = await getFirestoreAuthHeaders();
        if (!auth.success) {
          lastSyncError = `Auth unavailable: ${auth.error}`;
          dbInstance.runSync(
            "UPDATE sync_queue SET status = 'FAILED', last_error = ? WHERE id = ?",
            [lastSyncError, Number(queueId)]
          );
          console.log(`[Queue Audit] AUTH ABORT queueId=${queueId} collection=${tableName} recordId=${recordId} error=${lastSyncError}`);
          failedWrites++;
          continue;
        }

        try {
          const attemptAt = new Date().toISOString();
          const currentRetryCount = Number(item.retry_count || 0);
          dbInstance.runSync(
            "UPDATE sync_queue SET last_attempt_at = ?, retry_count = ? WHERE id = ?",
            [attemptAt, currentRetryCount + 1, Number(queueId)]
          );
          console.log(`[Queue Audit] Attempt queueId=${queueId} collection=${tableName} recordId=${recordId} action=${action} retry=${currentRetryCount + 1}`);

          const encodedId = encodeURIComponent(recordId);
          if (action === 'DELETE') {
            const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${tableName}/${encodedId}?key=${apiKey}`;
            let res = await fetch(url, { method: 'DELETE', headers: { ...auth.headers } });

            if (res.status === 401) {
              invalidateCurrentToken();
              const retryAuth = await getFirestoreAuthHeaders();
              if (retryAuth.success) {
                res = await fetch(url, { method: 'DELETE', headers: { ...retryAuth.headers } });
              }
            }
            
            if (res.ok || res.status === 404) {
              // Delete record from sync queue upon successful synchronization
              dbInstance.runSync("DELETE FROM sync_queue WHERE id = ?", [Number(queueId)]);
              lastSyncError = "None";
              successfulWrites++;
              
              // Track metrics
              firestoreDeletesToday++;
              syncUploadsToday++;
            } else if (res.status === 403) {
              const errText = await res.text();
              lastSyncError = `HTTP 403 (Permission Denied): ${errText}`;
              dbInstance.runSync(
                "UPDATE sync_queue SET status = 'FAILED', last_error = ? WHERE id = ?",
                [lastSyncError, Number(queueId)]
              );
              console.log(`[Queue Audit] FAIL (403 Permission Denied) queueId=${queueId} collection=${tableName} recordId=${recordId}`);
              failedWrites++;
            } else {
              const errText = await res.text();
              lastSyncError = `HTTP ${res.status}: ${errText}`;
              dbInstance.runSync(
                "UPDATE sync_queue SET status = 'FAILED', last_error = ? WHERE id = ?",
                [lastSyncError, Number(queueId)]
              );
              console.log(`[Queue Audit] FAIL queueId=${queueId} collection=${tableName} recordId=${recordId} action=${action} retry=${currentRetryCount + 1} error=${lastSyncError}`);
              failedWrites++;
            }
          } else {
            let row = null;
            const rIdStr = String(recordId);
            if (tableName === 'daily_submit' || tableName === 'daily_summary' || tableName === 'ai_dataset_history') {
              row = dbInstance.getFirstSync(`SELECT * FROM ${tableName} WHERE date = ?`, [rIdStr]);
            } else if (tableName === 'daily_submit_priority') {
              row = dbInstance.getFirstSync(`SELECT * FROM ${tableName} WHERE business_date = ?`, [rIdStr]);
            } else {
              row = dbInstance.getFirstSync(`SELECT * FROM ${tableName} WHERE id = ?`, [rIdStr]);
            }

            if (!row) {
              // Record deleted locally before sync; delete it from the queue
              console.log(`[Queue Audit] Missing local row, removing queue item queueId=${queueId} collection=${tableName} recordId=${recordId} action=${action}`);
              dbInstance.runSync("DELETE FROM sync_queue WHERE id = ?", [Number(queueId)]);
              successfulWrites++;
              continue;
            }

            // Priority Conflict Resolution Check
            if (tableName === 'daily_submit') {
              try {
                const localPriorityRec = getDailySubmitPriority(rIdStr);
                // Default local record to manager priority when absent.
                const localPriorityRecord = localPriorityRec || { priority: 10 };

                // Fetch remote priority from Firestore for this business date
                console.log(`[Firebase-Read] daily_submit priority GET (processSyncQueue) id=${rIdStr}`);
                const remotePriorityUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/daily_submit_priority/${encodeURIComponent(rIdStr)}?key=${apiKey}`;
                let remotePriorityRes = await fetch(remotePriorityUrl, { headers: { ...auth.headers } });
                if (remotePriorityRes.status === 401) {
                  invalidateCurrentToken();
                  const retryAuth = await getFirestoreAuthHeaders();
                  if (retryAuth.success) {
                    remotePriorityRes = await fetch(remotePriorityUrl, { headers: { ...retryAuth.headers } });
                  }
                }
                
                if (remotePriorityRes.ok) {
                  const remotePriorityDoc = await remotePriorityRes.json();
                  const remoteFields = remotePriorityDoc.fields || {};
                  const remotePriority = remoteFields.priority ? Number(remoteFields.priority.integerValue || remoteFields.priority.doubleValue || 0) : 0;
                  // Deterministic same-role tie-breaker record (Phase 4).
                  const remotePriorityRecord = {
                    priority: remotePriority,
                    submitted_at: remoteFields.submitted_at ? (remoteFields.submitted_at.stringValue || remoteFields.submitted_at.timestampValue || '') : '',
                    device_id: remoteFields.device_id ? (remoteFields.device_id.stringValue || '') : '',
                    sync_source_device: remoteFields.sync_source_device ? (remoteFields.sync_source_device.stringValue || '') : ''
                  };

                  if (remotePriorityWins(localPriorityRecord, remotePriorityRecord)) {
                    console.log(`[Priority Sync] Remote priority wins (remote=${remotePriorityRecord.priority}/${remotePriorityRecord.submitted_at}/${remotePriorityRecord.device_id}, local=${localPriorityRecord.priority}/${localPriorityRecord.submitted_at || ''}/${localPriorityRecord.device_id || ''}) for daily_submit date ${rIdStr}. Skipping upload.`);
                    // Skip upload and mark queue complete (delete from queue)
                    dbInstance.runSync("DELETE FROM sync_queue WHERE id = ?", [Number(queueId)]);
                    successfulWrites++;
                    continue;
                  }
                }
              } catch (err) {
                console.error("[Priority Sync] Conflict check failed:", err.message);
                // In case of error (e.g. offline during check), we proceed with default sync behavior
              }
            }

            const firestoreDoc = toFirestoreDocument(row);
            const targetCollection = tableName === 'deletions' ? 'app_config' : tableName;
            const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${targetCollection}/${encodeURIComponent(rIdStr)}?key=${apiKey}`;
            
            let res = await fetch(url, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', ...auth.headers },
              body: JSON.stringify(firestoreDoc)
            });

            if (res.status === 401) {
              invalidateCurrentToken();
              const retryAuth = await getFirestoreAuthHeaders();
              if (retryAuth.success) {
                res = await fetch(url, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json', ...retryAuth.headers },
                  body: JSON.stringify(firestoreDoc)
                });
              }
            }

            if (res.ok) {
              // Delete record from sync queue upon successful synchronization
              dbInstance.runSync("DELETE FROM sync_queue WHERE id = ?", [Number(queueId)]);
              lastSyncError = "None";
              successfulWrites++;
              
              // Track metrics
              firestoreWritesToday++;
              syncUploadsToday++;
              
              if (tableName === 'daily_submit' || tableName === 'daily_summary' || tableName === 'ai_dataset_history') {
                dbInstance.runSync(`UPDATE ${tableName} SET is_synced = 1 WHERE date = ?`, [rIdStr]);
              } else if (tableName === 'daily_submit_priority') {
                dbInstance.runSync(`UPDATE ${tableName} SET is_synced = 1 WHERE business_date = ?`, [rIdStr]);
              } else {
                dbInstance.runSync(`UPDATE ${tableName} SET is_synced = 1 WHERE id = ?`, [rIdStr]);
              }
            } else if (res.status === 403) {
              const errText = await res.text();
              lastSyncError = `HTTP 403 (Permission Denied): ${errText}`;
              dbInstance.runSync(
                "UPDATE sync_queue SET status = 'FAILED', last_error = ? WHERE id = ?",
                [lastSyncError, Number(queueId)]
              );
              console.log(`[Queue Audit] FAIL (403 Permission Denied) queueId=${queueId} collection=${tableName} recordId=${recordId}`);
              failedWrites++;
            } else {
              const errText = await res.text();
              lastSyncError = `HTTP ${res.status}: ${errText}`;
              dbInstance.runSync(
                "UPDATE sync_queue SET status = 'FAILED', last_error = ? WHERE id = ?",
                [lastSyncError, Number(queueId)]
              );
              console.log(`[Queue Audit] FAIL queueId=${queueId} collection=${tableName} recordId=${recordId} action=${action} retry=${currentRetryCount + 1} error=${lastSyncError}`);
              failedWrites++;
            }
          }
        } catch (err) {
          lastSyncError = `Sync Error: ${err.message}`;
          dbInstance.runSync(
            "UPDATE sync_queue SET status = 'FAILED', last_error = ? WHERE id = ?",
            [lastSyncError, Number(queueId)]
          );
          console.log(`[Queue Audit] FAIL queueId=${queueId} collection=${tableName} recordId=${recordId} action=${action} retry=${Number(item.retry_count || 0) + 1} error=${lastSyncError}`);
          failedWrites++;
        }
      }

      if (!singleRecordId) {
        const afterRes = dbInstance.getFirstSync(
          "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING' OR status = 'FAILED'"
        );
        afterCount = afterRes ? afterRes.count : 0;
      }

      // Observability heartbeat (isolated + throttled): proves Firebase pushes happen.
      try {
        const { recordSyncHeartbeat } = require('./services/supabaseHeartbeat.js');
        recordSyncHeartbeat({
          backend: 'firebase',
          kind: 'push',
          rows: successfulWrites,
          ok: failedWrites === 0,
          error: failedWrites ? lastSyncError : null,
          includeTables: 'sync_queue'
        }).catch(() => {});
      } catch (_) {}

      return { beforeCount, afterCount, successfulWrites, failedWrites };
    };

    return await runProcessor();

  } catch (err) {
    lastSyncError = `Daemon execution error: ${err.message}`;
    console.error("[Sync] Daemon execution error:", err);
    return { beforeCount: 0, afterCount: 0, successfulWrites: 0, failedWrites: 0 };
  } finally {
    if (!singleRecordId) isProcessingSyncQueue = false;
  }
}

export async function syncRecordImmediately(tableName, recordId) {
  // PUSH-ON-WRITE: send this record to BOTH clouds at once. Previously only
  // Firebase was pushed here, so the Supabase copy (the primary read source)
  // had to wait for its own 5s daemon — the "push is late" symptom.
  const pushFirebase = async () => {
    try {
      const result = await processSyncQueue(recordId, tableName);
      return result.successfulWrites > 0;
    } catch (e) {
      return false;
    }
  };

  const pushSupabase = async () => {
    try {
      const { syncSupabaseRecordImmediately } = require("./services/supabaseSyncQueue.js");
      return await syncSupabaseRecordImmediately(tableName, recordId);
    } catch (supaErr) {
      console.warn("[DB] Supabase immediate push skipped (isolated):", supaErr?.message || supaErr);
      return false;
    }
  };

  const [firebaseOk, supabaseOk] = await Promise.all([pushFirebase(), pushSupabase()]);
  return firebaseOk || supabaseOk;
}

export function isSyncServiceRunning() {
  return syncIntervalId !== null;
}

export function isDbInitialized() {
  return dbInstance !== null;
}

// Check if database is empty (no users or no orders)
export function isDatabaseEmpty() {
  try {
    const userCount = db.getFirstSync("SELECT COUNT(*) as count FROM users");
    const orderCount = db.getFirstSync("SELECT COUNT(*) as count FROM orders");
    // If we have 0 users and 0 orders, it's considered empty (new install)
    return (userCount?.count === 0 && orderCount?.count === 0);
  } catch (e) {
    return true;
  }
}

async function fetchChangedRecordsFromFirestore(collectionName, lastSyncTime, endTime = null) {
  const projectId = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
  const apiKey = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_API_KEY);
  if (!projectId || !apiKey) return { success: false, documents: [] };

  try {
    const auth = await getFirestoreAuthHeaders();
    if (!auth.success) {
      console.warn(`[Pull Sync] ${collectionName} skipped: Auth unavailable (${auth.error})`);
      return { success: false, documents: [] };
    }

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;
    // Optional upper bound (`endTime`). A range on a SINGLE field is served by Firestore's
    // single-field index, so no composite index is needed. WITHOUT it the query means
    // "everything updated since lastSyncTime → now", which is what made the historical
    // downloads pull months of documents and then discard them client-side.
    const where = endTime
      ? {
          compositeFilter: {
            op: 'AND',
            filters: [
              { fieldFilter: { field: { fieldPath: 'updated_at' }, op: 'GREATER_THAN', value: { stringValue: lastSyncTime } } },
              { fieldFilter: { field: { fieldPath: 'updated_at' }, op: 'LESS_THAN', value: { stringValue: endTime } } }
            ]
          }
        }
      : {
          fieldFilter: {
            field: { fieldPath: "updated_at" },
            op: "GREATER_THAN",
            value: { stringValue: lastSyncTime }
          }
        };
    const query = {
      structuredQuery: {
        from: [{ collectionId: collectionName }],
        where
      }
    };

    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.headers },
      body: JSON.stringify(query)
    });

    if (res.status === 401) {
      invalidateCurrentToken();
      const retryAuth = await getFirestoreAuthHeaders();
      if (retryAuth.success) {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...retryAuth.headers },
          body: JSON.stringify(query)
        });
      }
    }

    if (!res.ok) {
      if (res.status === 403) {
        console.log(`[Pull Sync] ${collectionName} is forbidden (403). Handling gracefully (treating as empty).`);
        return { success: true, documents: [] };
      }
      console.error(`[Pull Sync] ${collectionName} fetch FAILED with status ${res.status}`);
      return { success: false, documents: [] };
    }

    const data = await res.json();
    const documents = [];
    if (data && Array.isArray(data)) {
      for (const item of data) {
        if (item.document) {
          documents.push(item.document);
        }
      }
    }

    // Track metrics
    firestoreReadsToday += documents.length;
    syncDownloadsToday++;

    return { success: true, documents };
  } catch (err) {
    console.error(`[Pull Sync] ${collectionName} fetch EXCEPTION: ${err.message}`);
    return { success: false, documents: [] };
  }
}
// A table with no Firebase cursor used to be read as the ENTIRE collection, which is what
// produced multi-thousand-document read bursts. First syncs are now bounded to this window;
// the cursor is stored afterwards so every later pull is a small delta.
const FIREBASE_FIRST_SYNC_DAYS = 31;

async function syncCollections(collectionsList, cycleName = 'Unnamed Cycle') {
  const projectId = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
  const apiKey = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_API_KEY);
  
  if (!projectId || !apiKey) {
    console.error("[Pull Sync] Critical: Firebase configuration is missing in environment variables.");
    console.log(`[Pull Sync] Runtime Check - ProjectID: ${projectId ? 'Present' : 'MISSING'}, APIKey: ${apiKey ? 'Present' : 'MISSING'}`);
    return false;
  }

  console.log(`[Pull Sync] Starting sync for: ${collectionsList.join(', ')}`);
  let hasChanges = false;
  
  const cycleStat = {
    id: Date.now().toString(),
    name: cycleName,
    collections: [],
    totalReads: 0,
    timestamp: new Date().toISOString()
  };

  try {
    for (const table of collectionsList) {
      // 1. Determine lastSyncTime
      let lastSyncTime = null;
      try {
        const row = db.getFirstSync("SELECT value FROM app_config WHERE key = ?", [`last_sync_time_${table}`]);
        if (row) lastSyncTime = row.value;
      } catch (e) {}

      // Capture the moment we start fetching. We might use this if no records are found,
      // but we'll subtract a small buffer to be safe against eventual consistency gaps.
      const queryStartTime = new Date().toISOString();

      const queryCollection = table === 'deletions' ? 'app_config' : table;
      
      let fetchResult = { success: false, documents: [] };
      let estReads = 0;
      let isFullSync = false;

      if (lastSyncTime) {
        // OVERLAP SAFETY: Subtract 60 seconds from lastSyncTime to ensure eventual consistency
        // and time-drift gaps are covered. UPSERT (INSERT OR REPLACE) handles duplicates.
        let queryMarker = lastSyncTime;
        try {
          const overlapDate = new Date(new Date(lastSyncTime).getTime() - 60000);
          queryMarker = overlapDate.toISOString();
        } catch (e) {}

        console.log(`[Pull Sync] Fetching changed records for "${table}" since ${queryMarker} (Overlap 60s from ${lastSyncTime})...`);
        fetchResult = await fetchChangedRecordsFromFirestore(queryCollection, queryMarker);
        estReads = 1 + (fetchResult?.documents?.length || 0); // 1 for query run, +1 per doc returned
      } else {
        // No cursor for this table ⇒ bounded first sync over the last FIREBASE_FIRST_SYNC_DAYS
        // days (previously: the entire collection). The cursor is stored afterwards, so every
        // subsequent pull is a small delta.
        const firstSyncMarker = new Date(Date.now() - FIREBASE_FIRST_SYNC_DAYS * 86400000).toISOString();
        console.log(`[Pull Sync] No cursor for "${table}" — bounded read since ${firstSyncMarker} (last ${FIREBASE_FIRST_SYNC_DAYS} days)`);
        fetchResult = await fetchChangedRecordsFromFirestore(queryCollection, firstSyncMarker);
        isFullSync = false;
        estReads = 1 + (fetchResult?.documents?.length || 0);
      }

      cycleStat.collections.push({
        name: table,
        queryCount: 1, // Currently 1 query per table per cycle
        docsReturned: fetchResult?.documents?.length || 0,
        estimatedReads: estReads,
        isFullSync
      });
      cycleStat.totalReads += estReads;

      const { success, documents: docs } = fetchResult;

      if (!success) {
        console.log(`[Pull Sync] ${table} fetch FAILED or OFFLINE. Skipping marker update to avoid data gaps.`);
        continue;
      }

      let maxUpdatedAt = lastSyncTime;
      console.log(`[Pull Sync] ${table}: records_received=${docs.length} last_sync_time_before=${lastSyncTime || 'START'}`);

      for (const doc of docs) {
        const row = fromFirestoreDocument(doc);
        const docId = String(row.id);

        if (table === 'menu_items') console.log(`[MENU-DEBUG] pull doc ${docId}`);

        // Track max updated_at for the next sync marker
        if (row.updated_at && (!maxUpdatedAt || row.updated_at > maxUpdatedAt)) {
          maxUpdatedAt = row.updated_at;
        }

        // Safeguard to prevent restaurant table duplicates or random custom tables from being pulled
        if (table === 'restaurant_tables') {
          const allowedIds = ['table_1', 'table_2', 'table_3', 'table_4', 'table_5', 'table_6', 'table_7', 'table_8'];
          if (!allowedIds.includes(docId)) {
            continue; // Skip any custom or mismatched table ID
          }
        }

        // If table is 'deletions' but this is a regular app_config row (no table_name or record_id), ignore it.
        if (table === 'deletions' && (!row.table_name || !row.record_id)) {
          continue;
        }

        // Conversely, if table is 'app_config' but this is a deletion tombstone (has table_name and record_id),
        // we process the deletion locally, but we do NOT insert it into the SQLite 'app_config' table.
        // Instead, we insert it into 'deletions' SQLite table.
        if (table === 'app_config' && row.table_name && row.record_id) {
          const targetTable = row.table_name;
          const targetId = row.record_id;
          console.log(`[Pull Sync app_config] Remote deletion pulled for table "${targetTable}", record ID/Date "${targetId}"`);
          try {
            if (targetTable === 'daily_submit' || targetTable === 'daily_summary' || targetTable === 'ai_dataset_history') {
              db.runSync(`DELETE FROM ${targetTable} WHERE date = ?`, [String(targetId)]);
            } else {
              db.runSync(`DELETE FROM ${targetTable} WHERE id = ?`, [String(targetId)]);
            }
          } catch (err) {
            console.error(`[Pull Sync] Failed to delete target record locally:`, err.message);
          }
          
          try {
            db.runSync(
              "INSERT OR REPLACE INTO deletions (id, table_name, record_id, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, 1)",
              [row.id, row.table_name, row.record_id, row.created_at, row.updated_at]
            );
            hasChanges = true;
          } catch (e) {
            console.error("[Pull Sync] Failed to record deletion in deletions table:", e.message);
          }
          continue;
        }

        // R3/R4 fix (time-aware, FINAL-RESURRECT-2): never resurrect a locally-deleted
        // record — UNLESS the cloud row is strictly newer than the tombstone (legitimate
        // re-create after a delete), in which case the stale tombstone is cleared.
        if (table !== 'deletions' && isResurrectBlocked(db, table, docId, row.updated_at || row.created_at)) {
          console.log(`[Sync] Skipped resurrect: ${table}/${docId}, tombstone present`);
          continue;
        }

        let localRow = null;
        try {
          localRow = db.getFirstSync(`SELECT * FROM ${table} WHERE id = ?`, [docId]);
        } catch (e) {}

        // Compare timestamps to see if it actually changed
        let shouldUpdate = false;
        if (!localRow) {
          shouldUpdate = true;
        } else {
          const localTime = new Date(localRow.updated_at || localRow.created_at || 0).getTime();
          const cloudTime = new Date(row.updated_at || row.created_at || 0).getTime();
          
          if (cloudTime > localTime) {
            shouldUpdate = true;
          } else if (localRow.is_synced === 0) {
            // Keep newer/equal local edits, but allow newer cloud data to repair stale unsynced rows.
            continue;
          } else {
            // Property equality fallback check
            for (const key of Object.keys(row)) {
              if (row[key] !== localRow[key] && key !== 'is_synced') {
                shouldUpdate = true;
                break;
              }
            }
          }
        }

        if (table === 'restaurant_tables' || table === 'order_items') {
          const _lt = localRow ? new Date(localRow.updated_at || localRow.created_at || 0).getTime() : 0;
          const _ct = new Date(row.updated_at || row.created_at || 0).getTime();
          console.log(`[MERGE-DEBUG] FB ${table}/${docId} localSynced=${localRow ? localRow.is_synced : 'none'} localTs=${_lt} cloudTs=${_ct} shouldUpdate=${shouldUpdate}`);
        }

        if (shouldUpdate) {
          // If table is deletions, perform local deletion of target record
          if (table === 'deletions') {
            const targetTable = row.table_name;
            const targetId = row.record_id;
            // FINAL-RESURRECT-3: ignore a STALE tombstone (the local row was re-created
            // AFTER this deletion) — do not delete it and do not store the tombstone.
            if (isTombstoneStale(db, targetTable, targetId, row.updated_at || row.created_at)) {
              console.log(`[Pull Sync] Ignored stale tombstone (row re-created after delete): ${targetTable}/${targetId}`);
              continue;
            }
            console.log(`[Pull Sync] Remote deletion pulled for table "${targetTable}", record ID/Date "${targetId}"`);
            try {
              if (targetTable === 'daily_submit' || targetTable === 'daily_summary' || targetTable === 'ai_dataset_history') {
                db.runSync(`DELETE FROM ${targetTable} WHERE date = ?`, [String(targetId)]);
              } else {
                db.runSync(`DELETE FROM ${targetTable} WHERE id = ?`, [String(targetId)]);
              }
            } catch (err) {
              console.error(`[Pull Sync] Failed to delete target record locally:`, err.message);
            }
          }

          // Enforce uniqueness constraints
          if (table === 'menu_items') {
            const cleanName = String(row.name).trim().toLowerCase();
            const cleanCategory = String(row.category || '').trim().toLowerCase();
            
            const dup = db.getFirstSync(
              "SELECT id FROM menu_items WHERE LOWER(TRIM(name)) = LOWER(?) AND LOWER(TRIM(category)) = LOWER(?) AND id != ?",
              [cleanName, cleanCategory, docId]
            );
            if (dup) {
              console.log(`[Pull Sync] Removing local duplicate for ${row.name} (${row.category}) with ID ${dup.id}`);
              db.runSync("DELETE FROM menu_items WHERE id = ?", [dup.id]);
            }
          }

          // --- SCHEMA GUARDIAN ---
          // Ensure we only insert keys that actually exist in the target SQLite table schema.
          // This prevents crashes (prepareSync rejected) if Firestore contains unknown columns.
          let validColumns = [];
          try {
            validColumns = db.getAllSync(`PRAGMA table_info(${table})`).map(c => c.name);
          } catch (err) {
            console.error(`[Pull Sync] Failed to get schema for ${table}:`, err.message);
            continue;
          }

          const filteredRow = {};
          for (const key of Object.keys(row)) {
            // Exclude is_synced from the filtered set because we add it manually as '1' in the SQL
            if (validColumns.includes(key) && key !== 'is_synced') {
              filteredRow[key] = row[key];
            }
          }

          const keys = Object.keys(filteredRow);
          if (keys.length === 0) continue;

          const hasIsSynced = validColumns.includes('is_synced');
          const placeholders = keys.map(() => '?').join(', ');
          const sql = hasIsSynced
            ? `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}, is_synced) VALUES (${placeholders}, 1)`
            : `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
          const values = keys.map(k => filteredRow[k]);
          
          try {
            db.runSync(sql, values);
            hasChanges = true;
          } catch (e) {
            console.error(`[Pull Sync] Failed to update row in table "${table}":`, e.message);
            console.log(`[Pull Sync] Faulty SQL: ${sql}`);
            console.log(`[Pull Sync] Faulty Values: ${JSON.stringify(values)}`);
          }
        }
      }

      // 3. Update lastSyncTime marker
      // Ensure marker never moves backwards due to the 60s overlap window
      let finalMarker = maxUpdatedAt;
      if (!finalMarker || (lastSyncTime && lastSyncTime > finalMarker)) {
        finalMarker = lastSyncTime;
      }
      
      const safetyBufferDate = new Date(new Date(queryStartTime).getTime() - 15000);
      const safetyBufferTime = safetyBufferDate.toISOString();

      if (!docs || docs.length === 0) {
        // If no records, advance safely to 15s before we started querying (if it's newer than current marker)
        if (safetyBufferTime > finalMarker) {
          finalMarker = safetyBufferTime;
        }
      }
      
      console.log(`[Pull Sync] ${table}: last_sync_time_after=${finalMarker}`);

      try {
        db.runSync("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)", [`last_sync_time_${table}`, finalMarker]);
      } catch (e) {
        console.error(`[Pull Sync] Failed to persist marker for ${table}:`, e.message);
      }
    }
  } catch (err) {
    console.error("[Pull Sync] syncCollections execution error:", err);
  }

  // Finalize and log cycle stats
  syncRuntimeDiagnostics.cycleStats.unshift(cycleStat);
  if (syncRuntimeDiagnostics.cycleStats.length > 50) {
    syncRuntimeDiagnostics.cycleStats.pop();
  }
  
  console.log(`[Cycle Stat] ${cycleStat.name} | Total Reads: ${cycleStat.totalReads} | Collections: ${cycleStat.collections.map(c => `${c.name}(${c.estimatedReads})`).join(', ')}`);

  return hasChanges;
}

let isPullingSyncHigh = false;
let isPullingSyncLow = false;
let isPullingSyncDeletions = false;

export async function syncDeletionsOnly() {
  if (isPullingSyncDeletions) {
    recordAutoSyncEvent('syncDeletionsOnly', 'skipped', 'already-running');
    return false;
  }
  isPullingSyncDeletions = true;
  try {
    incrementReadCounter('deletions', 1);
    return await traceSyncOperation('syncDeletionsOnly', () => syncCollections(['deletions'], 'Deletions Sync'));
  } catch (err) {
    recordAutoSyncEvent('syncDeletionsOnly', 'failure', err.message);
    return false;
  } finally {
    isPullingSyncDeletions = false;
  }
}

export async function syncMenuOnly() {
  try {
    incrementReadCounter('menu', 2);
    return await traceSyncOperation('syncMenuOnly', () => syncCollections(['menu_items', 'menu_categories'], 'Menu Sync'));
  } catch (err) {
    recordAutoSyncEvent('syncMenuOnly', 'failure', err.message);
    return false;
  }
}

// Phase 3: Firebase-only pull used by the Supabase hybrid restore — menu tables
// plus daily_submit/daily_summary (which are NEVER read back from Supabase).
export async function syncDailyAndMenuFromFirebase() {
  try {
    console.log('[Firebase-Read] syncDailyAndMenuFromFirebase triggered');
    incrementReadCounter('menu', 4);
    return await traceSyncOperation('syncDailyAndMenuFromFirebase', () => syncCollections(
      ['menu_items', 'menu_categories', 'daily_submit', 'daily_summary'],
      'Supabase-Restore Firebase-only'
    ));
  } catch (err) {
    recordAutoSyncEvent('syncDailyAndMenuFromFirebase', 'failure', err.message);
    return false;
  }
}

// --- APP PROFILE & CENTRALIZED SYNC COLLECTION REGISTRY ---
const RAW_APP_PROFILE = String(process.env.EXPO_PUBLIC_APP_PROFILE || '').toUpperCase().trim();
const VALID_APP_PROFILES = ['ADMIN', 'OWNER', 'MANAGER'];
/** false ⇒ the build never set EXPO_PUBLIC_APP_PROFILE (mis-built APK). */
export const APP_PROFILE_RESOLVED = VALID_APP_PROFILES.includes(RAW_APP_PROFILE);
export const ACTIVE_APP_PROFILE = APP_PROFILE_RESOLVED ? RAW_APP_PROFILE : 'ADMIN';

/**
 * Restore scope — the SINGLE source of truth for "how far back do we restore".
 *   MANAGER        → running business day only
 *   ADMIN / OWNER  → last 31 days
 *   unresolved ''  → running-day only (FAIL-CONSERVATIVE: a mis-built APK must
 *                    never silently pull the full 31-day scope)
 */
export function getRestoreMode(profileName) {
  const p = String(profileName || '').toUpperCase().trim();
  if (p === 'MANAGER') return 'today';
  if (p === 'ADMIN' || p === 'OWNER') return '31d';
  return 'today';
}

export const APP_PROFILES = {
  ADMIN: {
    name: 'ADMIN',
    alwaysFull: ['users', 'menu_categories', 'menu_items', 'restaurant_tables', 'app_config', 'supplier_due', 'owner_employees', 'owner_salary_ledger', 'owner_deposits', 'owner_home_deposits'],
    recentOnly: [
      'orders', 'order_items', 'payments', 'expenses', 'deliveries', 
      'daily_submit', 'daily_summary', 'due_payments', 'eja_history', 
      'off_days', 'weather_data', 'supplier_payment_ledger', 'owner_expenses'
    ],
    tablesOnly: ['restaurant_tables'],
    highFreq: ['orders', 'order_items', 'payments', 'deliveries'],
    lowFreq: [
      'users', 'daily_summary', 'due_payments', 'weather_data', 'off_days', 
      'app_config', 'expenses', 'eja_history', 'daily_submit', 'supplier_due', 
      'supplier_due_history', 'supplier_payment_ledger', 'delete_history', 
      'owner_employees', 'owner_salary_ledger', 'owner_expenses', 'owner_deposits', 'owner_home_deposits'
    ],
    deviceRegistry: [],
    skipRestoreMarkers: ['deletions', 'delete_history', 'supplier_due_history']
  },
  OWNER: {
    name: 'OWNER',
    alwaysFull: ['users', 'menu_categories', 'menu_items', 'restaurant_tables', 'app_config', 'supplier_due', 'owner_employees', 'owner_salary_ledger', 'owner_deposits', 'owner_home_deposits'],
    recentOnly: [
      'orders', 'order_items', 'payments', 'expenses', 'deliveries', 
      'daily_submit', 'daily_summary', 'due_payments', 'eja_history', 
      'off_days', 'weather_data', 'supplier_payment_ledger', 'owner_expenses'
    ],
    tablesOnly: ['restaurant_tables'],
    highFreq: ['orders', 'order_items', 'payments', 'deliveries'],
    lowFreq: [
      'users', 'daily_summary', 'due_payments', 'weather_data', 'off_days', 
      'app_config', 'expenses', 'eja_history', 'daily_submit', 'supplier_due', 
      'supplier_due_history', 'supplier_payment_ledger', 
      'owner_employees', 'owner_salary_ledger', 'owner_expenses', 'owner_deposits', 'owner_home_deposits'
    ],
    deviceRegistry: [],
    skipRestoreMarkers: ['deletions', 'delete_history', 'supplier_due_history']
  },
  MANAGER: {
    name: 'MANAGER',
    alwaysFull: ['users', 'menu_categories', 'menu_items', 'restaurant_tables', 'app_config', 'supplier_due'],
    recentOnly: [
      'orders', 'order_items', 'payments', 'expenses', 'deliveries', 
      'daily_submit', 'daily_summary', 'eja_history'
    ],
    tablesOnly: ['restaurant_tables'],
    highFreq: ['orders', 'order_items', 'payments', 'deliveries'],
    lowFreq: [
      'users', 'daily_summary', 'app_config', 'expenses', 'daily_submit', 'supplier_due', 'eja_history'
    ],
    deviceRegistry: [],
    skipRestoreMarkers: [
      'deletions', 'delete_history', 'supplier_due_history', 'due_payments', 
      'off_days', 'weather_data', 'supplier_payment_ledger', 
      'owner_employees', 'owner_salary_ledger', 'owner_expenses', 'owner_deposits', 'owner_home_deposits'
    ]
  }
};

export function getActiveProfileConfig() {
  return APP_PROFILES[ACTIVE_APP_PROFILE] || APP_PROFILES.ADMIN;
}

let isPullingSyncTables = false;

export async function syncTablesOnly() {
  if (isPullingSyncTables) {
    recordAutoSyncEvent('syncTablesOnly', 'skipped', 'already-running');
    return false;
  }
  isPullingSyncTables = true;
  try {
    const profile = getActiveProfileConfig();
    const tables = profile.tablesOnly;
    incrementReadCounter('tables', tables.length);
    return await traceSyncOperation('syncTablesOnly', () => syncCollections(tables, 'Table Sync'));
  } catch (err) {
    recordAutoSyncEvent('syncTablesOnly', 'failure', err.message);
    return false;
  } finally {
    isPullingSyncTables = false;
  }
}

export async function syncHighFrequencyCollections() {
  if (isPullingSyncHigh) {
    recordAutoSyncEvent('syncHighFrequencyCollections', 'skipped', 'already-running');
    return false;
  }
  isPullingSyncHigh = true;
  let hasChanges = false;
  try {
    const profile = getActiveProfileConfig();
    const highFreq = profile.highFreq;
    incrementReadCounter('highFrequency', highFreq.length);
    hasChanges = await traceSyncOperation('syncHighFrequencyCollections', () => syncCollections(highFreq, 'High Frequency Sync'));
  } catch (err) {
    recordAutoSyncEvent('syncHighFrequencyCollections', 'failure', err.message);
    return false;
  } finally {
    isPullingSyncHigh = false;
  }
  return hasChanges;
}

export async function syncLowFrequencyCollections() {
  if (isPullingSyncLow) {
    recordAutoSyncEvent('syncLowFrequencyCollections', 'skipped', 'already-running');
    return false;
  }
  isPullingSyncLow = true;
  let hasChanges = false;
  try {
    const profile = getActiveProfileConfig();
    const lowFreq = profile.lowFreq;
    incrementReadCounter('lowFrequency', lowFreq.length);
    hasChanges = await traceSyncOperation('syncLowFrequencyCollections', () => syncCollections(lowFreq, 'Low Frequency Sync'));
  } catch (err) {
    recordAutoSyncEvent('syncLowFrequencyCollections', 'failure', err.message);
    return false;
  } finally {
    isPullingSyncLow = false;
  }
  return hasChanges;
}

export async function syncDeviceRegistry() {
  // Device Registry cloud sync has migrated to Supabase Realtime.
  // Firestore sync for device_registry is fully decommissioned.
  return false;
}

export function clearDeadQueueItems() {
  try {
    const deadCollections = ['firebase_usage', 'device_registry'];
    for (const coll of deadCollections) {
      db.runSync("DELETE FROM sync_queue WHERE table_name = ?", [coll]);
    }
    console.log("[DB] Cleared dead sync queue items for collections:", deadCollections);
    return true;
  } catch (err) {
    console.error("[DB] Failed to clear dead queue items:", err);
    return false;
  }
}

export function resetLastSyncTime(collectionName = null) {
  try {
    if (collectionName) {
      db.runSync("DELETE FROM app_config WHERE key = ?", [`last_sync_time_${collectionName}`]);
      console.log(`[Sync] Reset last sync time for "${collectionName}".`);
    } else {
      db.runSync("DELETE FROM app_config WHERE key LIKE 'last_sync_time_%'");
      console.log("[Sync] Reset last sync time for all collections.");
    }
    return true;
  } catch (e) {
    console.error("[Sync] Failed to reset last sync times:", e);
    return false;
  }
}

// --- CLOUD RESTORATION LOGIC ---

async function fetchCollection(collectionName, isMasterTable = false) {
  const projectId = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
  const apiKey = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_API_KEY);
  if (!projectId || !apiKey) return { success: false, documents: [] };

  const auth = await getFirestoreAuthHeaders();
  if (!auth.success) {
    console.warn(`[Restore] Collection ${collectionName} skipped: Auth unavailable (${auth.error})`);
    return { success: false, documents: [] };
  }

  let allDocuments = [];
  let nextPageToken = "";

  try {
    do {
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionName}?key=${apiKey}&pageSize=300${nextPageToken ? `&pageToken=${nextPageToken}` : ""}`;
      let res = await fetch(url, { headers: { ...auth.headers } });

      if (res.status === 401) {
        invalidateCurrentToken();
        const retryAuth = await getFirestoreAuthHeaders();
        if (retryAuth.success) {
          res = await fetch(url, { headers: { ...retryAuth.headers } });
        }
      }

      if (!res.ok) {
        if (res.status === 404) return { success: !isMasterTable, documents: [] }; 
        if (res.status === 403) {
          console.log(`[Restore] Collection ${collectionName} is forbidden (403). Handling gracefully (treating as empty).`);
          return { success: !isMasterTable, documents: [] };
        }
        console.error(`[Restore] Failed to fetch collection ${collectionName}:`, res.status);
        return { success: false, documents: [] };
      }
      const data = await res.json();
      if (data.documents) {
        allDocuments = allDocuments.concat(data.documents);
      }
      nextPageToken = data.nextPageToken || "";
    } while (nextPageToken);
  } catch (err) {
    console.error(`[Restore] Error fetching collection ${collectionName}:`, err);
    return { success: false, documents: [] };
  }

  // Track metrics
  firestoreReadsToday += allDocuments.length;
  syncDownloadsToday++;

  return { success: true, documents: allDocuments };
}

function fromFirestoreDocument(doc) {
  const obj = {};
  const fields = doc.fields || {};
  for (const [k, v] of Object.entries(fields)) {
    if (v.stringValue !== undefined) obj[k] = v.stringValue;
    else if (v.doubleValue !== undefined) obj[k] = Number(v.doubleValue);
    else if (v.integerValue !== undefined) obj[k] = Number(v.integerValue);
    else if (v.booleanValue !== undefined) obj[k] = v.booleanValue;
    else if (v.timestampValue !== undefined) obj[k] = v.timestampValue;
  }
  // doc.name is "projects/.../documents/collection/docId"
  const nameParts = doc.name.split('/');
  obj.id = nameParts[nameParts.length - 1];
  return obj;
}

/**
 * Manual "Cloud Restore" entry point — Supabase-primary + Firebase fallback.
 *
 * Supabase is asked FIRST for the scope it owns in normal operation
 * (`restaurant_tables` + the rolling 31-day transactional window + menu/daily).
 * The remaining permanent/master tables stay Firebase-sourced, per the
 * established read-routing rules. If Supabase is unhealthy — or its pass fails —
 * the full Firebase restore runs exactly as before. The returned failed-collection
 * list is the UNION of both passes, so the UI alert stays truthful.
 *
 * Default (`supabaseFirst=false`) is equivalent to the legacy Firebase-only
 * behavior used by `restoreHybridDatabaseFromCloud`'s Firebase fallback.
 */
export async function restoreDatabaseFromCloud({ mode = 'full', supabaseFirst = false, skipCollections = null } = {}) {
  if (!supabaseFirst) {
    return await restoreFirebaseFromCloud({ mode, skipCollections });
  }

  let supaRes = null;
  try {
    const supa = require('./services/supabaseSync.js');
    if (supa.isSupabasePrimaryHealthy()) {
      console.log('[Restore] Supabase-primary pass (restaurant_tables + 31d window + menu/daily)');
      supaRes = await supa.restoreSupabaseWindow({
        profileName: ACTIVE_APP_PROFILE,
        mode: mode === 'today' ? 'today' : '31d'
      });
    } else {
      console.log('[Restore] Supabase not healthy → Firebase-only restore');
    }
  } catch (e) {
    console.warn('[Restore] Supabase pass unavailable → Firebase:', e?.message || e);
  }

  if (!supaRes || !supaRes.success) {
    // Supabase unavailable/failed → full Firebase restore (unchanged behavior).
    return await restoreFirebaseFromCloud({ mode });
  }

  // Supabase covered its scope; Firebase restores only the remainder.
  const profile = getActiveProfileConfig();
  const supabaseScope = [
    'restaurant_tables',
    'menu_items',
    'menu_categories',
    'daily_submit',
    'daily_summary',
    ...(profile.recentOnly || [])
  ];
  const fbRes = await restoreFirebaseFromCloud({ mode, skipCollections: supabaseScope });

  const failedCollections = [...(supaRes.failedCollections || []), ...(fbRes.failedCollections || [])];
  return {
    success: failedCollections.length === 0,
    failedCollections,
    rowsWritten: (supaRes.rowsWritten || 0) + (fbRes.rowsWritten || 0)
  };
}

async function restoreFirebaseFromCloud({ mode = 'full', skipCollections = null } = {}) {
  const skip = new Set(skipCollections || []);
  console.log(`[Firebase-Read] restoreFirebaseFromCloud triggered (mode=${mode}, skip=${[...skip].join('|') || 'none'})`);
  const profile = getActiveProfileConfig();
  const alwaysFull = (profile.alwaysFull || []).filter((t) => !skip.has(t));
  const recentOnly = (profile.recentOnly || []).filter((t) => !skip.has(t));
  const skipRestoreMarkers = (profile.skipRestoreMarkers || ['deletions', 'delete_history', 'supplier_due_history']).filter((t) => !skip.has(t));
  const MASTER_TABLES = ['users', 'menu_categories', 'menu_items', 'restaurant_tables', 'app_config'];

  console.log(`[Restore] Starting Smart History Restoration (mode=${mode}) for profile '${profile.name}'...`);
  console.log(`[Restore] Targeting: Full=[${alwaysFull.join(',')}] Recent=[${recentOnly.join(',')}]`);

  const failedCollections = [];

  const processDocs = async (table, docs) => {
    if (docs.length === 0) return;
    
    let validColumns = [];
    try {
      validColumns = db.getAllSync(`PRAGMA table_info(${table})`).map(c => c.name);
    } catch (err) {
      console.error(`[Restore] Failed to get schema for ${table}:`, err.message);
      return;
    }

    for (const doc of docs) {
      const row = fromFirestoreDocument(doc);
      const filteredRow = {};
      for (const key of Object.keys(row)) {
        if (validColumns.includes(key) && key !== 'is_synced') {
          filteredRow[key] = row[key];
        }
      }
      const keys = Object.keys(filteredRow);
      if (keys.length === 0) continue;
      const placeholders = keys.map(() => "?").join(", ");
      const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(", ")}, is_synced) VALUES (${placeholders}, 1)`;
      const values = keys.map(k => filteredRow[k]);
      try {
        db.runSync(sql, values);
      } catch (e) {
        console.error(`[Restore] Failed to insert row into ${table}:`, e.message);
      }
    }
  };

  // Capture start time to use as sync marker baseline
  const restoreStartTime = new Date().toISOString();

  // Threshold for recent history: start of today's business day (today) or 31 days ago (full)
  let thresholdIso;
  if (mode === 'today') {
    thresholdIso = new Date(`${getBusinessDate()}T00:00:00`).toISOString();
  } else {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - 31);
    thresholdIso = thresholdDate.toISOString();
  }

  // FK checks off during master-table load: owner_salary_ledger.employee_id → owner_employees(id).
  // Also prevents INSERT OR REPLACE on employees from CASCADE-deleting child ledger rows. Re-enabled after.
  try { db.execSync("PRAGMA foreign_keys = OFF;"); } catch (e) {}

  // 1. Process Always Full
  for (const table of alwaysFull) {
    try {
      console.log(`[Restore] Restoring full table: ${table}...`);
      incrementReadCounter('restore', 1);
      const { success, documents: docs } = await fetchCollection(table, MASTER_TABLES.includes(table));
      if (success) {
        await processDocs(table, docs);
        // Initialize sync marker so background sync doesn't re-download full history
        db.runSync("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)", [`last_sync_time_${table}`, restoreStartTime]);
      } else {
        failedCollections.push(table);
        console.warn(`[Restore] Table '${table}' fetch failed — cursor not stamped.`);
      }
    } catch (err) {
      failedCollections.push(table);
      console.error(`[Restore] Critical error restoring ${table}:`, err);
    }
  }

  try { db.execSync("PRAGMA foreign_keys = ON;"); } catch (e) {}

  // Initialize markers for tables skipped in this profile to prevent background full-fetch loop
  for (const table of skipRestoreMarkers) {
    db.runSync("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)", [`last_sync_time_${table}`, restoreStartTime]);
    console.log(`[Restore Profile Marker] Initialized marker for skipped table: ${table}`);
  }

  // 2. Process Recent Only (Last 31 Days)
  for (const table of recentOnly) {
    try {
      console.log(`[Restore] Restoring last 31 days for: ${table}...`);
      
      incrementReadCounter('restore', 1);
      const result = await fetchChangedRecordsFromFirestore(table, thresholdIso);
      
      if (result.success) {
        await processDocs(table, result.documents);
        // Initialize sync marker to prevent full history pull.
        db.runSync("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)", [`last_sync_time_${table}`, restoreStartTime]);
      } else {
        failedCollections.push(table);
        console.warn(`[Restore] Table '${table}' fetch failed — cursor not stamped.`);
      }
    } catch (err) {
      failedCollections.push(table);
      console.error(`[Restore] Critical error restoring recent ${table}:`, err);
    }
  }
  
  if (mode === 'today') {
    try {
      const orphanIds = new Set();
      const itemOrphans = db.getAllSync("SELECT DISTINCT order_id FROM order_items WHERE order_id IS NOT NULL AND order_id NOT IN (SELECT id FROM orders)");
      const payOrphans = db.getAllSync("SELECT DISTINCT order_id FROM payments WHERE order_id IS NOT NULL AND order_id NOT IN (SELECT id FROM orders)");
      [...itemOrphans, ...payOrphans].forEach(r => { if (r.order_id) orphanIds.add(String(r.order_id)); });

      if (orphanIds.size === 0) {
        console.log('[Restore] Orphan check: no order_items/payments without a local parent order.');
      } else {
        console.log(`[Restore] Orphan check: ${orphanIds.size} order(s) referenced by order_items/payments have no local parent. Fetching parents by ID...`);
        for (const orphanOrderId of orphanIds) {
          try {
            const rawDoc = await fetchSingleDocFromFirestore('orders', orphanOrderId);
            if (rawDoc) {
              await processDocs('orders', [rawDoc]);
              console.log(`[Restore] Orphan parent fetched: orders/${orphanOrderId}`);
            } else {
              console.warn(`[Restore] Orphan parent not found on server: orders/${orphanOrderId}`);
            }
          } catch (fetchErr) {
            console.error(`[Restore] Orphan parent fetch error for orders/${orphanOrderId}:`, fetchErr.message);
            if (!failedCollections.includes('orders')) failedCollections.push('orders');
          }
        }
      }
    } catch (orphanErr) {
      console.error('[Restore] Orphan safety-net error:', orphanErr.message);
    }
  }

  const success = failedCollections.length === 0;
  if (!success) {
    console.warn(`[Restore] Completed with failures: ${failedCollections.join(', ')}`);
  }
  console.log(`[Restore] Smart History Restoration completed for profile '${profile.name}'.`);
  return { success, failedCollections };
}

// Downloads ONLY this profile's users (role-filtered) so login can work before the device is approved.
const USERS_ROLE_FILTER = {
  ADMIN: ['admin', 'owner', 'manager'],
  OWNER: ['owner'],
  MANAGER: ['manager']
};

export async function restoreUsersOnlyForProfile() {
  const profile = getActiveProfileConfig();
  const roles = USERS_ROLE_FILTER[profile.name] || ['admin'];

  // 1) Supabase FIRST (primary read path). Avoids a hard dependency on Firebase reads:
  //    with an exhausted Firebase quota and a healthy Supabase, login still works.
  //    `users` is device-gated, so an ACTIVE device gets rows here; a PENDING device
  //    gets 0 → we fall through to the Firebase pre-approval path below.
  try {
    const { restoreUsersFromSupabase } = require('./services/supabaseSync.js');
    const supaRes = await restoreUsersFromSupabase(roles);
    if (supaRes && supaRes.success && supaRes.count > 0) {
      console.log(`[UsersBootstrap] Restored ${supaRes.count} users from SUPABASE (roles=${roles.join(',')}).`);
      return supaRes;
    }
    console.log(`[UsersBootstrap] Supabase users unavailable (${supaRes && supaRes.error}) → Firebase fallback`);
  } catch (supaErr) {
    console.warn('[UsersBootstrap] Supabase users path failed → Firebase fallback:', supaErr?.message || supaErr);
  }

  // 2) Firebase fallback (unchanged behavior).
  const projectId = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
  const apiKey = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_API_KEY);
  if (!projectId || !apiKey || roles.length === 0) return { success: false, count: 0 };

  try {
    const auth = await getFirestoreAuthHeaders();
    if (!auth.success) {
      console.warn(`[UsersBootstrap] Auth unavailable (${auth.error})`);
      return { success: false, count: 0 };
    }

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;
    const query = {
      structuredQuery: {
        from: [{ collectionId: 'users' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'role' },
            op: 'IN',
            value: { arrayValue: { values: roles.map(r => ({ stringValue: r })) } }
          }
        }
      }
    };

    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.headers },
      body: JSON.stringify(query)
    });

    if (res.status === 401) {
      invalidateCurrentToken();
      const retryAuth = await getFirestoreAuthHeaders();
      if (retryAuth.success) {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...retryAuth.headers },
          body: JSON.stringify(query)
        });
      }
    }

    if (!res.ok) {
      console.warn(`[UsersBootstrap] users query failed: HTTP ${res.status}`);
      return { success: false, count: 0 };
    }

    const rows = await res.json();
    const docs = (Array.isArray(rows) ? rows : []).filter(r => r && r.document).map(r => r.document);

    let validColumns = [];
    try {
      validColumns = db.getAllSync("PRAGMA table_info(users)").map(c => c.name);
    } catch (err) {
      console.error('[UsersBootstrap] Failed to read users schema:', err.message);
      return { success: false, count: 0 };
    }

    for (const doc of docs) {
      const row = fromFirestoreDocument(doc);
      const filteredRow = {};
      for (const key of Object.keys(row)) {
        if (validColumns.includes(key) && key !== 'is_synced') {
          filteredRow[key] = row[key];
        }
      }
      const keys = Object.keys(filteredRow);
      if (keys.length === 0) continue;
      const placeholders = keys.map(() => '?').join(', ');
      try {
        db.runSync(`INSERT OR REPLACE INTO users (${keys.join(', ')}, is_synced) VALUES (${placeholders}, 1)`, keys.map(k => filteredRow[k]));
      } catch (e) {
        console.error('[UsersBootstrap] Failed to insert user:', e.message);
      }
    }

    console.log(`[UsersBootstrap] Downloaded ${docs.length} users for profile '${profile.name}' (roles=${roles.join(',')}).`);
    return { success: true, count: docs.length };
  } catch (err) {
    console.error('[UsersBootstrap] Error:', err.message);
    return { success: false, count: 0, error: err.message };
  }
}

// Getter for sync error
export function getLastSyncError() {
  return lastSyncError;
}

// --- SAME-DAY CLOUD RESYNC SYSTEM (EMERGENCY DAY RESTORE) ---

export function getSameDayResyncStatus(targetDateStr = null) {
  try {
    const todayStr = targetDateStr || getBusinessDate();
    const countRow = db.getFirstSync("SELECT value FROM app_config WHERE key = ?", [`same_day_resync_count_${todayStr}`]);
    const lastAtRow = db.getFirstSync("SELECT value FROM app_config WHERE key = 'same_day_resync_last_at'");
    const count = countRow ? parseInt(countRow.value, 10) || 0 : 0;
    const maxLimit = 2;
    return {
      count,
      maxLimit,
      remaining: Math.max(0, maxLimit - count),
      limitReached: count >= maxLimit,
      lastAt: lastAtRow?.value || null
    };
  } catch (err) {
    console.error("[SameDay Resync] Failed to get status:", err);
    return { count: 0, maxLimit: 2, remaining: 2, limitReached: false, lastAt: null };
  }
}

export function resetSameDayResyncLimit(targetDateStr = null) {
  try {
    const todayStr = targetDateStr || getBusinessDate();
    db.runSync("DELETE FROM app_config WHERE key = ?", [`same_day_resync_count_${todayStr}`]);
    console.log(`[SameDay Resync] Reset limit counter for ${todayStr}`);
    return true;
  } catch (err) {
    console.error("[SameDay Resync] Failed to reset limit counter:", err);
    return false;
  }
}

async function fetchSingleDocFromFirestore(collectionName, docId) {
  const projectId = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
  const apiKey = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_API_KEY);
  if (!projectId || !apiKey || !docId) return null;

  const auth = await getFirestoreAuthHeaders();
  if (!auth.success) return null;

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionName}/${encodeURIComponent(docId)}?key=${apiKey}`;
    let res = await fetch(url, { headers: { ...auth.headers } });
    if (res.status === 401) {
      invalidateCurrentToken();
      const retryAuth = await getFirestoreAuthHeaders();
      if (retryAuth.success) {
        res = await fetch(url, { headers: { ...retryAuth.headers } });
      }
    }
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.warn(`[SameDay Resync] Error fetching single doc ${collectionName}/${docId}:`, e.message);
  }
  return null;
}

/**
 * Scoped local wipe of TODAY's rows in the day-scoped tables (+ their queued
 * writes). Shared by BOTH same-day-resync paths so the manual "force-fix today"
 * button has identical semantics on Supabase and Firebase. Only ever called by the
 * manual resync — the periodic Supabase polls (signal-driven 30s safety for tables/high/
 * deletions, 60s low-freq, 300s menu) NEVER wipe; they merge.
 */
function wipeLocalTodayScoped(todayStr) {
  const localOrders = db.getAllSync("SELECT id FROM orders WHERE date(created_at, 'localtime') = ?", [todayStr]);
  const localOrderIds = localOrders.map(o => String(o.id));

  db.runSync("DELETE FROM order_items WHERE date(created_at, 'localtime') = ?", [todayStr]);
  if (localOrderIds.length > 0) {
    const placeholders = localOrderIds.map(() => '?').join(',');
    db.runSync(`DELETE FROM order_items WHERE order_id IN (${placeholders})`, localOrderIds);
    db.runSync(`DELETE FROM payments WHERE order_id IN (${placeholders})`, localOrderIds);
    db.runSync(`DELETE FROM due_payments WHERE order_id IN (${placeholders})`, localOrderIds);
  }
  db.runSync("DELETE FROM payments WHERE date(created_at, 'localtime') = ?", [todayStr]);
  db.runSync("DELETE FROM due_payments WHERE date(created_at, 'localtime') = ?", [todayStr]);
  db.runSync("DELETE FROM orders WHERE date(created_at, 'localtime') = ?", [todayStr]);
  db.runSync("DELETE FROM expenses WHERE date(created_at, 'localtime') = ? OR id LIKE ?", [todayStr, `exp_${todayStr}_%`]);
  db.runSync("DELETE FROM deliveries WHERE date(created_at, 'localtime') = ? OR date(completed_at, 'localtime') = ? OR id LIKE ?", [todayStr, todayStr, `D-${todayStr}-%`]);
  db.runSync("DELETE FROM daily_submit WHERE date = ? OR id = ?", [todayStr, todayStr]);
  db.runSync("DELETE FROM daily_summary WHERE date = ? OR id = ?", [todayStr, todayStr]);
  db.runSync("DELETE FROM eja_history WHERE date = ? OR date(created_at, 'localtime') = ? OR id = ?", [todayStr, todayStr, `eja_${todayStr}`]);
  db.runSync("DELETE FROM supplier_due_history WHERE date = ? OR date(created_at, 'localtime') = ?", [todayStr, todayStr]);
  db.runSync("DELETE FROM supplier_payment_ledger WHERE payment_date = ? OR id = ?", [todayStr, `spl_${todayStr}`]);

  // Clean sync_queue for today's wiped records so stale local pending writes don't overwrite cloud data
  db.runSync(
    "DELETE FROM sync_queue WHERE (table_name IN ('orders', 'order_items', 'payments', 'expenses', 'deliveries', 'due_payments', 'daily_submit', 'daily_summary', 'eja_history', 'supplier_payment_ledger')) AND (record_id LIKE ? OR record_id LIKE ?)",
    [`%${todayStr}%`, `%${todayStr.replace(/-/g, '')}%`]
  );
  if (localOrderIds.length > 0) {
    const placeholders = localOrderIds.map(() => '?').join(',');
    db.runSync(`DELETE FROM sync_queue WHERE table_name IN ('orders', 'order_items', 'payments', 'due_payments') AND record_id IN (${placeholders})`, localOrderIds);
  }
  return localOrderIds.length;
}

/**
 * Supabase-primary Same-Day Resync: WIPE today's scoped local rows (same shared
 * helper as the Firebase path — this is a "force-fix today" tool, not a merge),
 * reset the Supabase cursors for the day-scoped tables, then re-pull today's window
 * from Supabase. Returns null when Supabase is not healthy, so the caller falls back
 * to the unchanged Firebase implementation.
 */
async function resyncSameDayFromSupabase(todayStr, status, supa) {
  if (!supa || typeof supa.isSupabasePrimaryHealthy !== 'function') return null;
  if (!supa.isSupabasePrimaryHealthy()) return null;

  const dayScoped = [
    'orders', 'order_items', 'payments', 'expenses', 'deliveries', 'due_payments',
    'eja_history', 'supplier_due_history', 'daily_submit', 'daily_summary',
    'supplier_payment_ledger', 'restaurant_tables'
  ];
  const sinceIso = new Date(new Date(`${todayStr}T00:00:00.000Z`).getTime() - 60000).toISOString();
  for (const t of dayScoped) {
    try {
      db.runSync("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)", [`last_sync_time_supabase_${t}`, sinceIso]);
    } catch (_) {}
  }

  // Wipe today's scoped local rows first (the button's purpose: clear stale/junk
  // local data), then re-populate from Supabase below.
  try {
    wipeLocalTodayScoped(todayStr);
    console.log(`[SameDay Resync] Local data for ${todayStr} cleared (Supabase path).`);
  } catch (wipeErr) {
    return { success: false, error: `লোকাল ডাটা ক্লিয়ার ব্যর্থ: ${wipeErr.message}` };
  }

  console.log(`[SameDay Resync] Supabase-primary path: re-pulling today's window since ${sinceIso}`);
  await supa.syncSupabaseTables();
  await supa.syncSupabaseHighFrequencyCollections();
  await supa.syncSupabaseLowFrequencyCollections();
  await supa.syncSupabaseMenu();
  await supa.syncSupabaseDeletions();

  if (!supa.isSupabasePrimaryHealthy()) {
    return { success: false, error: 'Supabase sync failed during resync' };
  }

  try {
    calculateAndSaveDailySummary(todayStr);
    const newCount = status.count + 1;
    const nowIso = new Date().toISOString();
    db.runSync(
      "INSERT OR REPLACE INTO app_config (id, key, value, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, 0)",
      [`same_day_resync_count_${todayStr}`, `same_day_resync_count_${todayStr}`, String(newCount), nowIso, nowIso]
    );
    db.runSync(
      "INSERT OR REPLACE INTO app_config (id, key, value, created_at, updated_at, is_synced) VALUES (?, 'same_day_resync_last_at', ?, ?, ?, 0)",
      ['same_day_resync_last_at', nowIso, nowIso, nowIso]
    );
    const remaining = Math.max(0, 2 - newCount);
    console.log(`[SameDay Resync] Supabase path completed for ${todayStr}. Remaining: ${remaining}`);
    return { success: true, count: null, remaining, businessDate: todayStr, source: 'supabase' };
  } catch (err) {
    return { success: false, error: `ডাটাবেজ আপডেটে সমস্যা: ${err.message}` };
  }
}

export async function resyncSameDayFromCloud(targetDateStr = null) {
  console.log('[Firebase-Read] resyncSameDayFromCloud triggered');
  const todayStr = targetDateStr || getBusinessDate();
  console.log(`[SameDay Resync] Starting Same-Day Cloud Resync for date: ${todayStr}...`);

  // 1. Check rate limit
  const status = getSameDayResyncStatus(todayStr);
  if (status.limitReached) {
    console.warn(`[SameDay Resync] Daily limit reached (${status.count}/${status.maxLimit}) for ${todayStr}`);
    return {
      success: false,
      limitReached: true,
      count: status.count,
      maxLimit: status.maxLimit,
      message: 'আজকের জন্য রিসিন্কের সীমা শেষ (সর্বোচ্চ ২ বার)।'
    };
  }

  // 1b. Supabase-primary path (Phase 3 pattern). On any failure we fall through to
  // the unchanged Firebase logic below.
  try {
    const supa = require('./services/supabaseSync.js');
    if (supa.isSupabasePrimaryHealthy()) {
      const supaRes = await resyncSameDayFromSupabase(todayStr, status, supa);
      if (supaRes && supaRes.success) return supaRes;
      console.warn('[SameDay Resync] Supabase path failed → Firebase fallback:', supaRes && supaRes.error);
    } else {
      console.log('[SameDay Resync] Supabase not healthy → Firebase path');
    }
  } catch (supaErr) {
    console.warn('[SameDay Resync] Supabase path unavailable → Firebase fallback:', supaErr?.message || supaErr);
  }

  // 2. SAFETY FIRST: Fetch raw records from Firebase Firestore BEFORE touching local SQLite data
  // In Bangladesh (UTC+6), calculate business day start in UTC with 2-hour safety buffer
  let queryMarkerIso;
  try {
    const midnightBd = new Date(Date.parse(`${todayStr}T00:00:00+06:00`));
    queryMarkerIso = new Date(midnightBd.getTime() - 2 * 3600 * 1000).toISOString();
  } catch (e) {
    // Fallback: 26 hours ago
    queryMarkerIso = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
  }

  console.log(`[SameDay Resync] Fetching Firestore records updated after ${queryMarkerIso}...`);

  const collections = [
    'orders',
    'order_items',
    'payments',
    'expenses',
    'deliveries',
    'due_payments',
    'eja_history',
    'supplier_due_history'
  ];

  const downloadedDocs = {};
  for (const table of collections) {
    incrementReadCounter('restore', 1);
    const result = await fetchChangedRecordsFromFirestore(table, queryMarkerIso);
    if (!result.success) {
      console.error(`[SameDay Resync] Network fetch failed for collection "${table}". Aborting without touching local data.`);
      return {
        success: false,
        error: `Firebase থেকে "${table}" ডাটা আনতে সমস্যা হয়েছে। নেটওয়ার্ক সংযোগ চেক করুন।`
      };
    }
    downloadedDocs[table] = result.documents || [];
  }

  // Direct fetch for daily_submit, daily_summary, and supplier_payment_ledger
  const dsResult = await fetchChangedRecordsFromFirestore('daily_submit', queryMarkerIso);
  let dsDocs = dsResult.success ? (dsResult.documents || []) : [];
  if (dsDocs.length === 0) {
    const singleDs = await fetchSingleDocFromFirestore('daily_submit', todayStr);
    if (singleDs) dsDocs.push(singleDs);
  }
  downloadedDocs['daily_submit'] = dsDocs;

  const dsumResult = await fetchChangedRecordsFromFirestore('daily_summary', queryMarkerIso);
  let dsumDocs = dsumResult.success ? (dsumResult.documents || []) : [];
  if (dsumDocs.length === 0) {
    const singleDsum = await fetchSingleDocFromFirestore('daily_summary', todayStr);
    if (singleDsum) dsumDocs.push(singleDsum);
  }
  downloadedDocs['daily_summary'] = dsumDocs;

  const splResult = await fetchChangedRecordsFromFirestore('supplier_payment_ledger', queryMarkerIso);
  let splDocs = splResult.success ? (splResult.documents || []) : [];
  if (splDocs.length === 0) {
    const singleSpl = await fetchSingleDocFromFirestore('supplier_payment_ledger', `spl_${todayStr}`);
    if (singleSpl) splDocs.push(singleSpl);
  }
  downloadedDocs['supplier_payment_ledger'] = splDocs;

  // Restaurant tables current live state
  const tablesResult = await fetchCollection('restaurant_tables');
  const restaurantTableDocs = tablesResult.success ? (tablesResult.documents || []) : [];

  // 3. Filter documents strictly belonging to todayStr
  const todayOrderDocs = (downloadedDocs['orders'] || []).filter(doc => {
    const row = fromFirestoreDocument(doc);
    const createdDate = row.created_at ? getBusinessDateFromISO(row.created_at) : '';
    const updatedDate = row.updated_at ? getBusinessDateFromISO(row.updated_at) : '';
    const dateField = row.date || '';
    return createdDate === todayStr || updatedDate === todayStr || dateField === todayStr || (row.id && String(row.id).includes(todayStr));
  });

  const todayOrderIds = new Set(todayOrderDocs.map(doc => {
    const row = fromFirestoreDocument(doc);
    return String(row.id);
  }));

  const todayOrderItemDocs = (downloadedDocs['order_items'] || []).filter(doc => {
    const row = fromFirestoreDocument(doc);
    const createdDate = row.created_at ? getBusinessDateFromISO(row.created_at) : '';
    return createdDate === todayStr || (row.order_id && todayOrderIds.has(String(row.order_id)));
  });

  const todayPaymentDocs = (downloadedDocs['payments'] || []).filter(doc => {
    const row = fromFirestoreDocument(doc);
    const createdDate = row.created_at ? getBusinessDateFromISO(row.created_at) : '';
    return createdDate === todayStr || (row.order_id && todayOrderIds.has(String(row.order_id)));
  });

  const todayExpenseDocs = (downloadedDocs['expenses'] || []).filter(doc => {
    const row = fromFirestoreDocument(doc);
    const createdDate = row.created_at ? getBusinessDateFromISO(row.created_at) : '';
    return createdDate === todayStr || (row.id && String(row.id).includes(todayStr));
  });

  const todayDeliveryDocs = (downloadedDocs['deliveries'] || []).filter(doc => {
    const row = fromFirestoreDocument(doc);
    const createdDate = row.created_at ? getBusinessDateFromISO(row.created_at) : '';
    const completedDate = row.completed_at ? getBusinessDateFromISO(row.completed_at) : '';
    return createdDate === todayStr || completedDate === todayStr || (row.id && String(row.id).includes(todayStr));
  });

  const todayDueDocs = (downloadedDocs['due_payments'] || []).filter(doc => {
    const row = fromFirestoreDocument(doc);
    const createdDate = row.created_at ? getBusinessDateFromISO(row.created_at) : '';
    return createdDate === todayStr || (row.order_id && todayOrderIds.has(String(row.order_id)));
  });

  const todayEjaDocs = (downloadedDocs['eja_history'] || []).filter(doc => {
    const row = fromFirestoreDocument(doc);
    const createdDate = row.created_at ? getBusinessDateFromISO(row.created_at) : '';
    return row.date === todayStr || createdDate === todayStr || (row.id && String(row.id).includes(todayStr));
  });

  const todaySdhDocs = (downloadedDocs['supplier_due_history'] || []).filter(doc => {
    const row = fromFirestoreDocument(doc);
    const createdDate = row.created_at ? getBusinessDateFromISO(row.created_at) : '';
    return row.date === todayStr || createdDate === todayStr;
  });

  const todayDsDocs = (downloadedDocs['daily_submit'] || []).filter(doc => {
    const row = fromFirestoreDocument(doc);
    return row.date === todayStr || String(row.id) === todayStr;
  });

  const todayDsumDocs = (downloadedDocs['daily_summary'] || []).filter(doc => {
    const row = fromFirestoreDocument(doc);
    return row.date === todayStr || String(row.id) === todayStr;
  });

  const todaySplDocs = (downloadedDocs['supplier_payment_ledger'] || []).filter(doc => {
    const row = fromFirestoreDocument(doc);
    return row.payment_date === todayStr || String(row.id) === `spl_${todayStr}`;
  });

  console.log(`[SameDay Resync] Cloud download complete. Orders: ${todayOrderDocs.length}, Items: ${todayOrderItemDocs.length}, Payments: ${todayPaymentDocs.length}, Expenses: ${todayExpenseDocs.length}, Deliveries: ${todayDeliveryDocs.length}, Submits: ${todayDsDocs.length}`);

  // 4. ATOMIC LOCAL WIPE OF TODAY'S DATA IN SQLITE (shared helper — the
  //    Supabase-primary path performs the exact same wipe).
  try {
    wipeLocalTodayScoped(todayStr);
    console.log(`[SameDay Resync] Local data for ${todayStr} cleared.`);

    // 5. INSERT FETCHED CLOUD DOCUMENTS INTO SQLITE
    await processRemoteDocsToLocal('orders', todayOrderDocs);
    await processRemoteDocsToLocal('order_items', todayOrderItemDocs);
    await processRemoteDocsToLocal('payments', todayPaymentDocs);
    await processRemoteDocsToLocal('expenses', todayExpenseDocs);
    await processRemoteDocsToLocal('deliveries', todayDeliveryDocs);
    await processRemoteDocsToLocal('due_payments', todayDueDocs);
    await processRemoteDocsToLocal('eja_history', todayEjaDocs);
    await processRemoteDocsToLocal('supplier_due_history', todaySdhDocs);
    await processRemoteDocsToLocal('daily_submit', todayDsDocs);
    await processRemoteDocsToLocal('daily_summary', todayDsumDocs);
    await processRemoteDocsToLocal('supplier_payment_ledger', todaySplDocs);
    if (restaurantTableDocs.length > 0) {
      await processRemoteDocsToLocal('restaurant_tables', restaurantTableDocs);
    }

    // Recalculate daily summary
    calculateAndSaveDailySummary(todayStr);

    // 6. Increment rate limit counter
    const newCount = status.count + 1;
    const nowIso = new Date().toISOString();
    db.runSync(
      "INSERT OR REPLACE INTO app_config (id, key, value, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, 0)",
      [`same_day_resync_count_${todayStr}`, `same_day_resync_count_${todayStr}`, String(newCount), nowIso, nowIso]
    );
    db.runSync(
      "INSERT OR REPLACE INTO app_config (id, key, value, created_at, updated_at, is_synced) VALUES (?, 'same_day_resync_last_at', ?, ?, ?, 0)",
      ['same_day_resync_last_at', nowIso, nowIso, nowIso]
    );

    const totalRestored = todayOrderDocs.length + todayOrderItemDocs.length + todayPaymentDocs.length + todayExpenseDocs.length + todayDeliveryDocs.length + todayDueDocs.length + todayEjaDocs.length + todaySdhDocs.length + todayDsDocs.length + todayDsumDocs.length + todaySplDocs.length;
    const remaining = Math.max(0, 2 - newCount);

    console.log(`[SameDay Resync] Successfully restored ${totalRestored} records for ${todayStr}. Remaining: ${remaining}`);
    return {
      success: true,
      count: totalRestored,
      remaining,
      businessDate: todayStr
    };
  } catch (err) {
    console.error("[SameDay Resync] Error during SQLite replace:", err);
    return {
      success: false,
      error: `ডাটাবেজ আপডেটে সমস্যা: ${err.message}`
    };
  }
}

// --- HISTORICAL DOWNLOAD TRACKING & LIMITS ---

export function checkHistoryDownloadStatus(type, period) {
  try {
    const row = db.getFirstSync(
      "SELECT * FROM history_download_log WHERE report_type = ? AND requested_period = ?",
      [type, period]
    );
    return !!row;
  } catch (e) {
    return false;
  }
}

/** Daily cap for a MONTH history download (Firebase reads a whole month per download). */
export const MAX_DAILY_MONTH_DOWNLOADS = 1;

export function getDailyDownloadCount(type) {
  try {
    const today = new Date().toISOString().substring(0, 10);
    const row = db.getFirstSync(
      "SELECT COUNT(*) as count FROM history_download_log WHERE report_type = ? AND date(downloaded_at) = ?",
      [type, today]
    );
    return row ? row.count : 0;
  } catch (e) {
    return 0;
  }
}

export function logHistoryDownload(type, period, user) {
  try {
    const now = new Date().toISOString();
    db.runSync(
      "INSERT INTO history_download_log (report_type, requested_period, downloaded_at, downloaded_by) VALUES (?, ?, ?, ?)",
      [type, period, now, user]
    );
    return true;
  } catch (e) {
    console.error("[DB] Failed to log history download:", e);
    return false;
  }
}

export function resetHistoryDownloadLimits() {
  try {
    const today = new Date().toISOString().substring(0, 10);
    db.runSync("DELETE FROM history_download_log WHERE date(downloaded_at) = ?", [today]);
    return true;
  } catch (e) {
    console.error("[DB] Failed to reset history download limits:", e);
    return false;
  }
}

async function processRemoteDocsToLocal(table, docs) {
  if (!docs || docs.length === 0) return;
  let validColumns = [];
  try {
    validColumns = db.getAllSync(`PRAGMA table_info(${table})`).map(c => c.name);
  } catch (err) {
    return;
  }
  for (const doc of docs) {
    const row = fromFirestoreDocument(doc);
    const filteredRow = {};
    for (const key of Object.keys(row)) {
      if (validColumns.includes(key) && key !== 'is_synced') {
        filteredRow[key] = row[key];
      }
    }
    const keys = Object.keys(filteredRow);
    if (keys.length === 0) continue;
    const placeholders = keys.map(() => "?").join(", ");
    const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(", ")}, is_synced) VALUES (${placeholders}, 1)`;
    const values = keys.map(k => filteredRow[k]);
    try {
      db.runSync(sql, values);
    } catch (e) {}
  }
}

export async function fetchHistoricalDateData(dateStr) {
  console.log('[Firebase-Read] fetchHistoricalDateData triggered');
  const collections = ['orders', 'order_items', 'payments', 'expenses', 'deliveries'];
  console.log(`[Historical Download] Fetching data for date: ${dateStr}`);
  for (const table of collections) {
    incrementReadCounter('historical', 1);
    // Upper bound = end of that day ⇒ ONE day is read, not "that day → now".
    const dayEnd = new Date(new Date(dateStr + "T00:00:00Z").getTime() + 86400000).toISOString();
    const result = await fetchChangedRecordsFromFirestore(table, dateStr + "T00:00:00Z", dayEnd);
    if (result.success) {
      const dayDocs = result.documents.filter(doc => {
        const row = fromFirestoreDocument(doc);
        const d = row.date || (row.created_at ? row.created_at.substring(0, 10) : "");
        return d === dateStr;
      });
      await processRemoteDocsToLocal(table, dayDocs);
    }
  }
}

export async function fetchHistoricalMonthData(monthStr) {
  console.log('[Firebase-Read] fetchHistoricalMonthData triggered');
  // monthStr is YYYY-MM
  const collections = ['orders', 'order_items', 'payments', 'expenses', 'daily_submit', 'daily_summary'];
  console.log(`[Historical Download] Fetching data for month: ${monthStr}`);
  
  // Use the first day of the month as the lower marker and the first day of the NEXT month
  // as the upper marker, so exactly ONE month of documents is transferred (previously the
  // query had no upper bound and pulled everything from that month up to today).
  const startOfMonth = monthStr + "-01T00:00:00Z";
  const [mYear, mMonth] = monthStr.split("-").map(Number);
  const nextMonthStart = new Date(
    Date.UTC(mMonth === 12 ? mYear + 1 : mYear, mMonth === 12 ? 0 : mMonth, 1)
  ).toISOString();

  for (const table of collections) {
     incrementReadCounter('historical', 1);
     const result = await fetchChangedRecordsFromFirestore(table, startOfMonth, nextMonthStart);
     if (result.success) {
       const monthDocs = result.documents.filter(doc => {
         const row = fromFirestoreDocument(doc);
         const d = row.date || (row.created_at ? row.created_at.substring(0, 10) : "");
         return d.startsWith(monthStr);
       });
       await processRemoteDocsToLocal(table, monthDocs);
     }
  }
}

export async function recoverMenuFromCloud() {
  console.log('[Firebase-Read] recoverMenuFromCloud triggered');
  const collections = ['menu_items', 'menu_categories'];
  for (const table of collections) {
    incrementReadCounter('menu', 1);
    const result = await fetchCollection(table);
    if (result.success) {
      await processRemoteDocsToLocal(table, result.documents);
    }
  }
  return true;
}

// ==========================================
// 6. ITEM SALES REPORT ENGINE
// ==========================================

export function getItemSalesReport(startDate, endDate) {
  try {
    // 1. Get all current menu items to ensure SECTION 2 (Not Sold) is accurate
    const menuItems = db.getAllSync("SELECT name, category, price FROM menu_items ORDER BY category ASC, name ASC");
    
    // 2. Get aggregated sales from order_items for the date range
    // We use date(created_at, 'localtime') to match the business day YYYY-MM-DD
    const sales = db.getAllSync(`
      SELECT itemName, SUM(quantity) as totalQty, SUM(quantity * unit_price) as totalRevenue
      FROM order_items
      WHERE date(created_at, 'localtime') BETWEEN ? AND ?
      GROUP BY itemName
    `, [startDate, endDate]);
    
    const salesMap = {};
    sales.forEach(s => {
      salesMap[s.itemName] = {
        qty: s.totalQty,
        rev: s.totalRevenue
      };
    });
    
    // 3. Combine menu items with sales data
    const reportData = menuItems.map(item => {
      const sale = salesMap[item.name] || { qty: 0, rev: 0 };
      const data = {
        ...item,
        quantitySold: sale.qty,
        totalSales: sale.rev
      };
      // Remove from map to track items sold that are NOT in current menu
      delete salesMap[item.name];
      return data;
    });
    
    // 4. Add items that were sold but are no longer in menu_items (if any)
    Object.keys(salesMap).forEach(itemName => {
      const sale = salesMap[itemName];
      reportData.push({
        name: itemName,
        category: 'Other',
        price: sale.qty > 0 ? (sale.rev / sale.qty) : 0,
        quantitySold: sale.qty,
        totalSales: sale.rev
      });
    });
    
    return reportData;
  } catch (err) {
    console.error("[DB] Failed to generate Item Sales Report:", err);
    return [];
  }
}

// Helper to get start and end dates for quick filters
export function getQuickFilterDates(filterType) {
  const today = getBusinessDate();
  const now = new Date();
  
  if (filterType === 'Today') {
    return { start: today, end: today };
  }
  
  if (filterType === 'Yesterday') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yesterday = d.toISOString().substring(0, 10);
    return { start: yesterday, end: yesterday };
  }
  
  if (filterType === 'This Week') {
    // Start of week (Sunday)
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day;
    const start = new Date(d.setDate(diff)).toISOString().substring(0, 10);
    return { start, end: today };
  }
  
  return { start: today, end: today };
}

// ==========================================
// 7. DICTIONARY CONNECTION TESTING
// ==========================================

export async function testFirestoreConnection() {
  const projectId = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
  const apiKey = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_API_KEY);
  const envLoaded = !!(projectId && apiKey);

  if (!envLoaded) {
    return {
      firebaseConnected: false,
      firestoreWritable: false,
      lastError: "Missing EXPO_PUBLIC_FIREBASE_PROJECT_ID or EXPO_PUBLIC_FIREBASE_API_KEY in .env file.",
      envLoaded: false
    };
  }

  const auth = await getFirestoreAuthHeaders();
  if (!auth.success) {
    return {
      firebaseConnected: false,
      firestoreWritable: false,
      lastError: `Authentication failed: ${auth.error}`,
      envLoaded: true
    };
  }

  try {
    const docId = `conn_${Date.now()}`;
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/app_test/${docId}?key=${apiKey}`;
    
    const body = {
      fields: {
        status: { stringValue: "connected" },
        createdAt: { timestampValue: new Date().toISOString() }
      }
    };

    console.log("[Diagnostics] Initiating active write test to Firestore collection 'app_test'...");
    
    let res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth.headers },
      body: JSON.stringify(body)
    });

    if (res.status === 401) {
      invalidateCurrentToken();
      const retryAuth = await getFirestoreAuthHeaders();
      if (retryAuth.success) {
        res = await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...retryAuth.headers },
          body: JSON.stringify(body)
        });
      }
    }

    if (res.ok) {
      console.log("[Diagnostics] Connection testing successfully completed! Firestore write SUCCESS!");
      firestoreWritesToday++;
      return {
        firebaseConnected: true,
        firestoreWritable: true,
        lastError: "None",
        envLoaded: true
      };
    } else {
      const errText = await res.text();
      console.error("[Diagnostics] Firestore write FAILED:", errText);
      return {
        firebaseConnected: true,
        firestoreWritable: false,
        lastError: `HTTP Write Error ${res.status}: ${errText}`,
        envLoaded: true
      };
    }
  } catch (err) {
    console.error("[Diagnostics] Network connection check failed:", err);
    return {
      firebaseConnected: false,
      firestoreWritable: false,
      lastError: `Network request failed: ${err.message}`,
      envLoaded: true
    };
  }
}

// ==========================================
// 4. WEATHER AUTO SERVICES
// ==========================================

export async function triggerWeatherFetch() {
  try {
    const todayStr = getBusinessDate();
    const cachedWeather = db.getFirstSync("SELECT * FROM weather_data WHERE date = ?", [todayStr]);
    if (cachedWeather) return;

    const url = "https://api.open-meteo.com/v1/forecast?latitude=24.8759&longitude=90.6627&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m";
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to reach weather API");

    const data = await res.json();
    const curr = data.current;
    
    const temperature = curr.temperature_2m || 30.5;
    const humidity = curr.relative_humidity_2m || 75;
    const wCode = curr.weather_code || 0;
    const windSpeed = curr.wind_speed_10m || 10.0;

    let condition = "Clear";
    let isRainy = 0;
    if (wCode >= 51 && wCode <= 67) { condition = "Rainy"; isRainy = 1; }
    else if (wCode >= 80 && wCode <= 82) { condition = "Showers"; isRainy = 1; }
    else if (wCode >= 95 && wCode <= 99) { condition = "Thunderstorm"; isRainy = 1; }
    else if (wCode >= 1 && wCode <= 3) { condition = "Partly Cloudy"; }
    else if (wCode >= 45 && wCode <= 48) { condition = "Foggy"; }

    const now = new Date().toISOString();
    
    db.runSync(
      "INSERT OR REPLACE INTO weather_data (id, date, temperature, humidity, condition, isRainy, windSpeed, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
      [todayStr, todayStr, temperature, humidity, condition, isRainy, windSpeed, now, now]
    );
    enqueueSync("weather_data", todayStr, "INSERT");

    calculateAndSaveDailySummary(todayStr);
  } catch (err) {
    console.error("[Weather] Automatic weather fetch skipped/failed:", err);
  }
}

// ==========================================
// 5. DAILY STATISTICS AGGREGATOR
// ==========================================

export function calculateAndSaveDailySummary(dateStr) {
  try {
    const todayStr = dateStr || getBusinessDate();
    
    const weather = db.getFirstSync("SELECT * FROM weather_data WHERE date = ?", [todayStr]) || {
      temperature: 30.0,
      humidity: 75.0,
      condition: "Clear",
      isRainy: 0,
      windSpeed: 10.0
    };
    
    const dateObj = new Date(todayStr);
    const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dateObj.getDay()];
    const isFriday = dateObj.getDay() === 5 ? 1 : 0;
    
    const firstDayOfMonth = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1);
    const firstDayOfWeek = firstDayOfMonth.getDay();
    const offsetDate = dateObj.getDate() + firstDayOfWeek - 1;
    const weekOfMonth = Math.floor(offsetDate / 7) + 1;
    
    const mmDd = todayStr.substring(5);
    const isHoliday = BD_HOLIDAYS[mmDd] ? 1 : 0;
    const specialDayNote = BD_HOLIDAYS[mmDd] || (isFriday ? "Friday Weekend" : "");

    const ordersToday = db.getAllSync(
      "SELECT * FROM orders WHERE date(created_at, 'localtime') = ?",
      [todayStr]
    );
    const totalOrders = ordersToday.length;
    const totalSales = ordersToday.reduce((sum, o) => sum + ((o.grand_total || 0) - (o.change_money_given || 0)), 0);
    const totalDiscount = ordersToday.reduce((sum, o) => sum + (o.discount || 0), 0);
    const totalDeliveryCharge = ordersToday.reduce((sum, o) => sum + (o.delivery_charge || 0), 0);
    const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;
    
    const hourCounts = {};
    let firstOrderTime = "";
    let lastOrderTime = "";
    ordersToday.forEach((o, index) => {
      if (index === 0) firstOrderTime = o.time || "";
      lastOrderTime = o.time || "";
      
      const hr = o.time ? o.time.split(':')[0] + (o.time.includes('PM') ? ' PM' : ' AM') : '';
      if (hr) {
        hourCounts[hr] = (hourCounts[hr] || 0) + 1;
      }
    });

    let peakHour = "";
    let maxHourCount = 0;
    for (const [hour, count] of Object.entries(hourCounts)) {
      if (count > maxHourCount) {
        maxHourCount = count;
        peakHour = hour;
      }
    }

    const expensesToday = db.getAllSync(
      "SELECT * FROM expenses WHERE date(created_at, 'localtime') = ?",
      [todayStr]
    );
    const totalExpense = expensesToday.filter(e => e.category !== 'ijara').reduce((sum, e) => sum + (e.amount || 0), 0);

    const deliveriesToday = db.getAllSync(
      "SELECT * FROM deliveries WHERE date(completed_at, 'localtime', '-1 hour') = ? AND status = 'COMPLETED'",
      [todayStr]
    );
    const totalDelivery = deliveriesToday.reduce((sum, d) => sum + (d.amount || 0), 0);

    const paymentsToday = db.getAllSync(
      "SELECT * FROM payments WHERE date(created_at, 'localtime') = ?",
      [todayStr]
    );

    let cashTotal = 0;
    let bkashTotal = 0;
    let nagadTotal = 0;
    let rocketTotal = 0;

    paymentsToday.forEach(p => {
      // Logic for new Split Payment system
      cashTotal += (p.cash_amount || 0);
      bkashTotal += (p.bkash_amount || 0);
      nagadTotal += (p.nagad_amount || 0);
      rocketTotal += (p.rocket_amount || 0);

      // Legacy fallback for records created before split payments
      if (!p.cash_amount && !p.bkash_amount && !p.nagad_amount && !p.rocket_amount) {
        const amt = p.customer_paid || 0;
        const method = String(p.payment_method).toLowerCase();
        if (method.includes('cash') || method.includes('ক্যাশ')) {
          cashTotal += amt;
        } else if (method.includes('bkash') || method.includes('বিকাশ')) {
          bkashTotal += amt;
        } else if (method.includes('nagad') || method.includes('নগদ')) {
          nagadTotal += amt;
        } else if (method.includes('rocket') || method.includes('রকেট')) {
          rocketTotal += amt;
        }
      }
    });

    const ejaRecord = db.getFirstSync(
      "SELECT SUM(eja_amount) as total_eja FROM eja_history WHERE date = ?",
      [todayStr]
    );
    const ejaAmount = ejaRecord ? (ejaRecord.total_eja || 0) : 0;

    const activeDeliveries = db.getAllSync("SELECT change_money_given FROM deliveries WHERE status = 'BUSY'");
    const ongoingChangeMoney = activeDeliveries.reduce((sum, d) => sum + (d.change_money_given || 0), 0);
    const completedChangeMoney = ordersToday.reduce((sum, o) => sum + (o.change_money_given || 0), 0);

    // Deduct returned change money from cash total (as it's just a float return)
    cashTotal = Math.max(0, cashTotal - completedChangeMoney);

    // Net cash generation only deducts ongoingChangeMoney (cash currently out of the drawer)
    const netCash = cashTotal + ejaAmount - totalExpense - ongoingChangeMoney;

    const submitRecord = db.getFirstSync("SELECT * FROM daily_submit WHERE date = ?", [todayStr]);
    const ownerDeposit = submitRecord ? (submitRecord.net_deposit || 0) : 0;

    const orderItemsToday = db.getAllSync(
      "SELECT itemName, SUM(quantity) as qty, SUM(revenue) as rev FROM order_items WHERE date(created_at, 'localtime') = ? GROUP BY itemName",
      [todayStr]
    );
    const itemSummaryList = orderItemsToday.map(oi => ({
      itemName: oi.itemName,
      quantity: oi.qty,
      revenue: oi.rev
    }));
    const itemSummary = JSON.stringify(itemSummaryList);

    const existingSummary = db.getFirstSync("SELECT * FROM daily_summary WHERE date = ?", [todayStr]);
    const now = new Date().toISOString();

    if (existingSummary) {
      db.runSync(`
        UPDATE daily_summary SET
          dayOfWeek = ?, weekOfMonth = ?, isFriday = ?, isHoliday = ?, specialDayNote = ?,
          temperature = ?, humidity = ?, condition = ?, isRainy = ?, windSpeed = ?,
          totalOrders = ?, totalSales = ?, totalDiscount = ?, totalExpense = ?, totalDelivery = ?,
          total_delivery_charge = ?, averageOrderValue = ?, peakHour = ?, firstOrderTime = ?, lastOrderTime = ?,
          cashTotal = ?, bkashTotal = ?, nagadTotal = ?, rocketTotal = ?, ejaAmount = ?,
          netCash = ?, ownerDeposit = ?, itemSummary = ?, updated_at = ?, is_synced = 0
        WHERE date = ?
      `, [
        dayOfWeek, weekOfMonth, isFriday, isHoliday, specialDayNote,
        weather.temperature, weather.humidity, weather.condition, weather.isRainy, weather.windSpeed,
        totalOrders, totalSales, totalDiscount, totalExpense, totalDelivery,
        totalDeliveryCharge, averageOrderValue, peakHour, firstOrderTime, lastOrderTime,
        cashTotal, bkashTotal, nagadTotal, rocketTotal, ejaAmount,
        netCash, ownerDeposit, itemSummary, now, todayStr
      ]);
      enqueueSync("daily_summary", todayStr, "UPDATE");
    } else {
      db.runSync(`
        INSERT INTO daily_summary (
          id, date, dayOfWeek, weekOfMonth, isFriday, isHoliday, specialDayNote,
          temperature, humidity, condition, isRainy, windSpeed, totalOrders, totalSales,
          totalDiscount, totalExpense, totalDelivery, total_delivery_charge, averageOrderValue, peakHour,
          firstOrderTime, lastOrderTime, cashTotal, bkashTotal, nagadTotal, rocketTotal,
          ejaAmount, netCash, ownerDeposit, itemSummary, created_at, updated_at, is_synced
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, 0
        )
      `, [
        todayStr, todayStr, dayOfWeek, weekOfMonth, isFriday, isHoliday, specialDayNote,
        weather.temperature, weather.humidity, weather.condition, weather.isRainy, weather.windSpeed,
        totalOrders, totalSales, totalDiscount, totalExpense, totalDelivery, totalDeliveryCharge,
        averageOrderValue, peakHour, firstOrderTime, lastOrderTime, 
        cashTotal, bkashTotal, nagadTotal, rocketTotal,
        ejaAmount, netCash, ownerDeposit, itemSummary, now, now
      ]);
      enqueueSync("daily_summary", todayStr, "INSERT");
    }
  } catch (err) {
    console.error("[DB] Failed to calculate daily summary:", err);
  }
}

// ==========================================
// 6. GOOGLE SHEET BACKUP & ML EXPORTER (UNIFIED)
// ==========================================

export async function triggerWeatherTimelineService() {
  try {
    // 1. Capture Current Weather if needed
    await captureHourlyWeather();
    
    // 2. Process Queue
    await processAIDatasetQueue();
    
    // 3. Register a timer to run this every 30 minutes (to catch up on hours)
    registerSyncTimer('ai-dataset-service', 1800000, 'triggerWeatherTimelineService');
  } catch (err) {
    console.error("[AI Dataset Sync] Service tick failed:", err);
  }
}

async function captureHourlyWeather() {
  const now = new Date();
  const hour = now.getHours();
  
  // Business Hours: 09:00 AM to 12:00 AM (00:00)
  if (hour < 9 && hour !== 0) return;
  
  const todayStr = getBusinessDate();
  const queueId = `WEATHER_${todayStr}_${String(hour).padStart(2, '0')}`;
  
  // 1. Duplicate Prevention: Check if already in queue or exported
  const existing = db.getFirstSync("SELECT id FROM ai_dataset_queue WHERE id = ?", [queueId]);
  if (existing) return;

  try {
    // 2. Fetch current weather from API
    const url = "https://api.open-meteo.com/v1/forecast?latitude=24.8759&longitude=90.6627&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m";
    const res = await fetch(url);
    if (!res.ok) throw new Error("Weather API unreachable");
    
    const data = await res.json();
    const curr = data.current;
    const wCode = curr.weather_code || 0;
    
    let condition = "Clear";
    let isRainy = "FALSE";
    if (wCode >= 51 && wCode <= 67) { condition = "Rainy"; isRainy = "TRUE"; }
    else if (wCode >= 80 && wCode <= 82) { condition = "Showers"; isRainy = "TRUE"; }
    else if (wCode >= 95 && wCode <= 99) { condition = "Thunderstorm"; isRainy = "TRUE"; }
    else if (wCode >= 1 && wCode <= 3) { condition = "Partly Cloudy"; }
    
    const isWeekend = (now.getDay() === 5 || now.getDay() === 6) ? "TRUE" : "FALSE";
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Format Display Time (e.g., 03:00 PM)
    let displayHour = hour % 12;
    if (displayHour === 0) displayHour = 12;
    const ampm = (hour >= 12 && hour < 24) ? 'PM' : 'AM';
    const displayTime = `${String(displayHour).padStart(2, '0')}:00 ${ampm}`;

    const timelineRow = {
      BusinessDate: todayStr,
      Timestamp: displayTime,
      Temperature: curr.temperature_2m || 30,
      Humidity: curr.relative_humidity_2m || 70,
      WindSpeed: curr.wind_speed_10m || 10,
      WeatherCondition: condition,
      IsRainy: isRainy,
      DayOfWeek: dayNames[now.getDay()],
      HourOfDay: hour,
      IsWeekend: isWeekend,
      Month: now.getMonth() + 1
    };

    // 3. Persistent Queue Entry (Local Only)
    const isoNow = now.toISOString();
    db.runSync(`
      INSERT OR REPLACE INTO ai_dataset_queue (id, type, business_date, payload, status, created_at, updated_at, is_synced)
      VALUES (?, 'WEATHER', ?, ?, 'PENDING', ?, ?, 0)
    `, [queueId, todayStr, JSON.stringify(timelineRow), isoNow, isoNow]);
    
    console.log(`[AI Weather] Captured hourly weather for ${displayTime}`);
    
  } catch (err) {
    console.error("[ML Weather] Capture failed:", err.message);
  }
}

// ============================================================
// PHASE 3 — AI DATASET QUEUE INTEGRATION
// ============================================================
// Connects submitDailySheet() → Phase 2 Dataset Builder → Validator → ai_dataset_queue.
//
// Pipeline:
//   submitDailySheet() [success]
//       ↓
//   buildDailyDataset()  buildItemDataset()   ← Phase 2 builder.js
//       ↓                      ↓
//   validateDailyDataset()  validateItemDataset()  ← validator.js
//       ↓                      ↓
//   ai_dataset_queue (PENDING)   ← SQLite ONLY. No transport. No HTTP.
//
// RULES:
//   - Write-only. Queue entries only. No processAIDatasetQueue() call.
//   - Idempotent: INSERT OR REPLACE on dataset_id.
//   - If validation fails → do NOT enqueue → return validation errors.
//   - Never called on: draft, failed submit, rollback, current working day.
// ============================================================

export function enqueueAIDatasetExport(dateStr) {
  // ── MASTER FEATURE FLAG GUARD ─────────────────────────────────────────
  const isEnabled = String(process.env.EXPO_PUBLIC_AI_DATASET_ENABLED || 'false').toLowerCase().trim() === 'true';
  if (!isEnabled) {
    console.log(`[AI Queue] Subsystem PAUSED (AI_DATASET_ENABLED=false). Enqueue skipped for ${dateStr}.`);
    return { success: false, reason: 'PAUSED' };
  }

  const now = new Date().toISOString();

  // ── GUARD: Only finalized business dates may be enqueued ────────────
  // submitDailySheet() already guarantees daily_submit exists before calling this,
  // but we re-verify here for defensive correctness.
  const committedSubmit = db.getFirstSync(
    'SELECT id FROM daily_submit WHERE date = ?',
    [dateStr]
  );
  if (!committedSubmit) {
    console.warn(
      `[AI Queue] Business date ${dateStr} is not finalized in daily_submit. Enqueue skipped.`
    );
    return { success: false, reason: 'NOT_FINALIZED' };
  }

  // ── STEP 1: Build Daily Dataset via Phase 2 builder ─────────────────
  let dailyDataset;
  try {
    dailyDataset = buildDailyDataset(db, dateStr);
  } catch (builderErr) {
    console.error(`[AI Queue] buildDailyDataset(${dateStr}) threw:`, builderErr);
    return { success: false, reason: 'BUILDER_EXCEPTION', error: builderErr.message };
  }

  if (dailyDataset && dailyDataset.error) {
    console.warn(`[AI Queue] buildDailyDataset(${dateStr}) error: ${dailyDataset.error}`);
    return { success: false, reason: dailyDataset.error };
  }

  // ── STEP 2: Validate Daily Dataset ──────────────────────────────────
  // Import validateDailyDataset directly from builder.js (it re-exports from validator.js)
  // Inline import to avoid circular dependency: database.js → builder.js → database.js
  // builder.js imports { db } from database.js, so we cannot import builder at module level.
  // Resolution: builder.js is already imported at the top of this file. This is safe because
  // expo-sqlite module resolution does not cause circular init issues in React Native bundler.
  let dailyValidation;
  try {
    // Re-derive validation from the frozen dataset fields
    const errors = [];
    if (!dailyDataset.business_date) errors.push('MISSING_BUSINESS_DATE');
    if (!dailyDataset.dataset_id)    errors.push('MISSING_DATASET_ID');
    if ((dailyDataset.total_sales   || 0) < 0) errors.push('NEGATIVE_TOTAL_SALES');
    if ((dailyDataset.total_expense || 0) < 0) errors.push('NEGATIVE_TOTAL_EXPENSE');
    if ((dailyDataset.total_orders  || 0) < 0) errors.push('NEGATIVE_TOTAL_ORDERS');
    const paymentSum =
      (Number(dailyDataset.cash_sales)   || 0) +
      (Number(dailyDataset.bkash_sales)  || 0) +
      (Number(dailyDataset.nagad_sales)  || 0) +
      (Number(dailyDataset.rocket_sales) || 0) +
      (Number(dailyDataset.card_sales)   || 0);
    if (Math.abs(paymentSum - (Number(dailyDataset.total_sales) || 0)) > 0.01) {
      errors.push(`PAYMENT_SUM_MISMATCH:Sum=${paymentSum},Total=${dailyDataset.total_sales}`);
    }
    dailyValidation = {
      isValid:         errors.length === 0,
      isComplete:      !errors.includes('MISSING_BUSINESS_DATE') && !errors.includes('MISSING_DATASET_ID'),
      isTrainingReady: errors.length === 0,
      errors,
    };
  } catch (valErr) {
    console.error(`[AI Queue] Daily validation threw for ${dateStr}:`, valErr);
    return { success: false, reason: 'VALIDATION_EXCEPTION', error: valErr.message };
  }

  if (!dailyValidation.isComplete) {
    console.warn(
      `[AI Queue] Daily Dataset validation FAILED for ${dateStr}:`,
      dailyValidation.errors
    );
    return {
      success:          false,
      reason:           'DAILY_VALIDATION_FAILED',
      validationErrors: dailyValidation.errors,
    };
  }

  // ── STEP 3: Build Item Datasets via Phase 2 builder ─────────────────
  let itemDatasets;
  try {
    itemDatasets = buildItemDataset(db, dateStr);
  } catch (itemBuilderErr) {
    console.error(`[AI Queue] buildItemDataset(${dateStr}) threw:`, itemBuilderErr);
    return { success: false, reason: 'ITEM_BUILDER_EXCEPTION', error: itemBuilderErr.message };
  }

  if (itemDatasets && itemDatasets.error) {
    console.warn(`[AI Queue] buildItemDataset(${dateStr}) error: ${itemDatasets.error}`);
    return { success: false, reason: itemDatasets.error };
  }

  const itemArray = Array.isArray(itemDatasets) ? itemDatasets : [];

  // ── STEP 4: Validate every Item Dataset ─────────────────────────────
  const itemValidationErrors = [];
  for (let i = 0; i < itemArray.length; i++) {
    const item = itemArray[i];
    const errors = [];
    if (!item.business_date)              errors.push('MISSING_BUSINESS_DATE');
    if (!item.item_name)                  errors.push('MISSING_ITEM_NAME');
    if ((item.total_quantity_sold || 0) < 0) errors.push('NEGATIVE_QUANTITY');
    if ((item.total_item_revenue  || 0) < 0) errors.push('NEGATIVE_REVENUE');
    if (errors.length > 0) {
      itemValidationErrors.push({ item_name: item.item_name, errors });
    }
  }

  if (itemValidationErrors.length > 0) {
    console.warn(
      `[AI Queue] Item Dataset validation FAILED for ${dateStr}:`,
      itemValidationErrors
    );
    return {
      success:          false,
      reason:           'ITEM_VALIDATION_FAILED',
      validationErrors: itemValidationErrors,
    };
  }

  // ── STEP 5: Idempotent Insert — AI_DAILY_SALES_DATASET ──────────────
  // INSERT OR REPLACE ensures this is safe to call multiple times for the same date.
  // If the record already exists it will be updated with the fresh payload.
  const dailyQueueId  = dateStr;                   // e.g. "2026-08-05"
  const itemQueueId   = `ITEM_${dateStr}`;          // e.g. "ITEM_2026-08-05"
  const dailyPayload  = JSON.stringify(dailyDataset);
  const itemPayload   = JSON.stringify(itemArray);

  try {
    // Check if daily record already exists (for structured logging)
    const existingDaily = db.getFirstSync(
      'SELECT id, status FROM ai_dataset_queue WHERE id = ?',
      [dailyQueueId]
    );

    db.runSync(
      `INSERT OR REPLACE INTO ai_dataset_queue
         (id, type, business_date, payload, status, retry_count, last_error, created_at, updated_at, is_synced)
       VALUES (?, 'AI_DAILY_SALES_DATASET', ?, ?, 'PENDING', 0, NULL,
         COALESCE((SELECT created_at FROM ai_dataset_queue WHERE id = ?), ?),
         ?, 0)`,
      [dailyQueueId, dateStr, dailyPayload, dailyQueueId, now, now]
    );

    if (existingDaily) {
      console.log(
        `[AI Queue] Duplicate Updated  — AI_DAILY_SALES_DATASET  date=${dateStr}  ` +
        `prev_status=${existingDaily.status}`
      );
    } else {
      console.log(`[AI Queue] Daily Dataset Enqueued — AI_DAILY_SALES_DATASET  date=${dateStr}`);
    }
  } catch (dailyInsertErr) {
    console.error(`[AI Queue] Failed to insert daily record for ${dateStr}:`, dailyInsertErr);
    return { success: false, reason: 'DAILY_INSERT_FAILED', error: dailyInsertErr.message };
  }

  // ── STEP 6: Idempotent Insert — AI_ITEM_SALES_DATASET ───────────────
  try {
    const existingItem = db.getFirstSync(
      'SELECT id, status FROM ai_dataset_queue WHERE id = ?',
      [itemQueueId]
    );

    db.runSync(
      `INSERT OR REPLACE INTO ai_dataset_queue
         (id, type, business_date, payload, status, retry_count, last_error, created_at, updated_at, is_synced)
       VALUES (?, 'AI_ITEM_SALES_DATASET', ?, ?, 'PENDING', 0, NULL,
         COALESCE((SELECT created_at FROM ai_dataset_queue WHERE id = ?), ?),
         ?, 0)`,
      [itemQueueId, dateStr, itemPayload, itemQueueId, now, now]
    );

    if (existingItem) {
      console.log(
        `[AI Queue] Duplicate Updated  — AI_ITEM_SALES_DATASET   date=${dateStr}  ` +
        `prev_status=${existingItem.status}  items=${itemArray.length}`
      );
    } else {
      console.log(
        `[AI Queue] Item Dataset Enqueued  — AI_ITEM_SALES_DATASET   date=${dateStr}  ` +
        `items=${itemArray.length}`
      );
    }
  } catch (itemInsertErr) {
    console.error(`[AI Queue] Failed to insert item record for ${dateStr}:`, itemInsertErr);
    return { success: false, reason: 'ITEM_INSERT_FAILED', error: itemInsertErr.message };
  }

  // ── PHASE 3 COMPLETE ─────────────────────────────────────────────────
  // Queue entries are written. STOP HERE.
  // Google Sheets transport is Phase 4 — NOT implemented here.
  // processAIDatasetQueue() is NOT called from this function.
  return {
    success:         true,
    businessDate:    dateStr,
    dailyDatasetId:  dailyQueueId,
    itemDatasetId:   itemQueueId,
    itemCount:       itemArray.length,
    queuedAt:        now,
  };
}

export async function processAIDatasetQueue() {
  // ── MASTER FEATURE FLAG GUARD ─────────────────────────────────────────
  const isEnabled = String(process.env.EXPO_PUBLIC_AI_DATASET_ENABLED || 'false').toLowerCase().trim() === 'true';
  if (!isEnabled) {
    return;
  }

  const webappUrl = cleanEnvVar(process.env.EXPO_PUBLIC_AI_DATASET_WEBAPP_URL) || cleanEnvVar(process.env.EXPO_PUBLIC_GOOGLE_SHEETS_WEBAPP_URL);
  if (!webappUrl) return;

  // 1. Crash Recovery: Reset stale IN_PROGRESS records back to RETRY if stuck from app termination
  try {
    const staleTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    db.runSync(
      "UPDATE ai_dataset_queue SET status = 'RETRY', updated_at = ? WHERE status = 'IN_PROGRESS' AND updated_at < ?",
      [new Date().toISOString(), staleTime]
    );
  } catch (e) {
    console.error("[AI Dataset Sync] Stale recovery check failed:", e.message);
  }

  // 2. Batch Selection: Fetch up to DEFAULT_BATCH_SIZE (25) pending or retryable records
  let pending;
  try {
    pending = db.getAllSync(
      `SELECT * FROM ai_dataset_queue 
       WHERE status IN ('PENDING', 'RETRY') 
       ORDER BY created_at ASC 
       LIMIT ?`,
      [DEFAULT_BATCH_SIZE]
    );
  } catch (e) {
    console.error("[AI Dataset Sync] Failed to fetch pending queue records:", e.message);
    return;
  }

  if (!pending || pending.length === 0) return;

  const nowIso = new Date().toISOString();

  // 3. Mark batch as IN_PROGRESS before transmission
  for (const record of pending) {
    try {
      db.runSync(
        "UPDATE ai_dataset_queue SET status = 'IN_PROGRESS', updated_at = ? WHERE id = ?",
        [nowIso, record.id]
      );
    } catch (e) {
      console.error(`[AI Dataset Sync] Failed to transition ${record.id} to IN_PROGRESS:`, e.message);
    }
  }

  // 4. Build lossless compact batch payload via Transport Layer
  const batchPayload = buildBatchPayload(pending);

  // 5. Transmit batch to Google Sheets WebApp via Transport Layer
  const transportResult = await transmitBatchToGoogleSheets(webappUrl, batchPayload);

  // 6. Process per-record response & update queue individually via Transport Layer
  processStructuredTransportResponse(db, pending, transportResult);
}

export async function triggerGoogleSheetExportCheck() {
  // Process any pending AI Dataset items on start
  processAIDatasetQueue();
}

// ==========================================
// 7. SQLITE INTERACTION API WRAPPERS
// ==========================================

export function verifyUserLogin(username, pin) {
  try {
    const user = db.getFirstSync("SELECT * FROM users WHERE username = ? AND pin = ?", [username.trim().toLowerCase(), pin.trim()]);
    return user || null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

export function checkUserExists(username) {
  try {
    const user = db.getFirstSync("SELECT * FROM users WHERE username = ?", [username.trim().toLowerCase()]);
    return !!user;
  } catch (err) {
    console.error(err);
    return false;
  }
}

export function getUserByUsername(username) {
  try {
    const user = db.getFirstSync("SELECT * FROM users WHERE username = ?", [username.trim().toLowerCase()]);
    return user || null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

export function changeUserPin(username, newPin) {
  try {
    const user = db.getFirstSync("SELECT * FROM users WHERE username = ?", [username.trim().toLowerCase()]);
    if (user) {
      db.runSync("UPDATE users SET pin = ?, updated_at = ?, is_synced = 0 WHERE username = ?", [newPin.trim(), new Date().toISOString(), username.trim().toLowerCase()]);
      enqueueSync("users", user.id, "UPDATE");
      return true;
    }
    return false;
  } catch (err) {
    console.error(err);
    return false;
  }
}

export function createUser(username, pin, role, displayName) {
  try {
    const cleanUsername = username.trim().toLowerCase();
    const id = `user_${cleanUsername}`;
    const now = new Date().toISOString();
    
    // Check if user already exists in SQLite
    const existing = db.getFirstSync("SELECT id FROM users WHERE id = ? OR username = ?", [id, cleanUsername]);
    if (existing) {
      db.runSync(
        "UPDATE users SET pin = ?, role = ?, display_name = ?, updated_at = ?, is_synced = 0 WHERE id = ?",
        [pin.trim(), role, displayName, now, existing.id]
      );
      enqueueSync("users", existing.id, "UPDATE");
    } else {
      db.runSync(
        "INSERT OR REPLACE INTO users (id, username, pin, role, display_name, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
        [id, cleanUsername, pin.trim(), role, displayName, now, now]
      );
      enqueueSync("users", id, "INSERT");
    }
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

export function getMenuItems() {
  try {
    return db.getAllSync("SELECT id, name, price, category FROM menu_items");
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function checkFirestoreMenuItemExists(name, category) {
  const projectId = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
  const apiKey = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_API_KEY);
  if (!projectId || !apiKey) return null;

  try {
    const auth = await getFirestoreAuthHeaders();
    if (!auth.success) return null;

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;
    const query = {
      structuredQuery: {
        from: [{ collectionId: "menu_items" }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              {
                fieldFilter: {
                  field: { fieldPath: "name" },
                  op: "EQUAL",
                  value: { stringValue: name.trim() }
                }
              },
              {
                fieldFilter: {
                  field: { fieldPath: "category" },
                  op: "EQUAL",
                  value: { stringValue: category.trim() }
                }
              }
            ]
          }
        },
        limit: 1
      }
    };

    let res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth.headers },
      body: JSON.stringify(query)
    });

    if (res.status === 401) {
      invalidateCurrentToken();
      const retryAuth = await getFirestoreAuthHeaders();
      if (retryAuth.success) {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...retryAuth.headers },
          body: JSON.stringify(query)
        });
      }
    }

    if (!res.ok) return null;
    const data = await res.json();
    
    // Track metrics
    firestoreReadsToday++;
    
    if (data && data.length > 0 && data[0].document) {
      const doc = data[0].document;
      const nameParts = doc.name.split("/");
      const id = nameParts[nameParts.length - 1];
      
      const fields = doc.fields || {};
      const price = fields.price ? Number(fields.price.doubleValue || fields.price.integerValue || 0) : 0;
      
      return { id, name: name.trim(), category: category.trim(), price };
    }
  } catch (err) {
    console.error("[Sync Check] Failed to check firestore menu item existence:", err);
  }
  return null;
}

export async function addMenuItem(newItem) {
  try {
    const now = new Date().toISOString();
    const cleanName = String(newItem.name).trim();
    const cleanCategory = String(newItem.category || '').trim();

    // Check if an item already exists using the compound key (name + category) or by ID
    let existing = null;
    if (newItem.id) {
      existing = db.getFirstSync("SELECT * FROM menu_items WHERE id = ?", [newItem.id]);
    }
    
    if (!existing) {
      existing = db.getFirstSync(
        "SELECT * FROM menu_items WHERE LOWER(TRIM(name)) = LOWER(?) AND LOWER(TRIM(category)) = LOWER(?)",
        [cleanName, cleanCategory]
      );
    }

    // If not found in SQLite, check Firestore to prevent duplicate creation
    if (!existing) {
      const firestoreExist = await checkFirestoreMenuItemExists(cleanName, cleanCategory);
      if (firestoreExist) {
        existing = firestoreExist;
        // Seed it locally in SQLite first
        db.runSync(
          "INSERT OR REPLACE INTO menu_items (id, name, price, category, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, ?, 1)",
          [existing.id, existing.name, existing.price, existing.category, now, now]
        );
      }
    }

    if (existing) {
      // Update existing record using the existing ID
      db.runSync(
        "UPDATE menu_items SET price = ?, category = ?, name = ?, updated_at = ?, is_synced = 0 WHERE id = ?",
        [newItem.price, cleanCategory, cleanName, now, existing.id]
      );
      enqueueSync("menu_items", existing.id, "UPDATE");
      return true;
    } else {
      // Create new record
      const id = newItem.id || `menu_${Date.now()}`;
      db.runSync(
        "INSERT OR REPLACE INTO menu_items (id, name, price, category, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, ?, 0)",
        [id, cleanName, newItem.price, cleanCategory, now, now]
      );
      enqueueSync("menu_items", id, "INSERT");
      return true;
    }
  } catch (err) {
    console.error(err);
    return false;
  }
}

export function updateMenuPrice(itemName, newPrice, category = null) {
  try {
    let item;
    if (category) {
      item = db.getFirstSync(
        "SELECT * FROM menu_items WHERE LOWER(TRIM(name)) = LOWER(?) AND LOWER(TRIM(category)) = LOWER(?)",
        [String(itemName).trim(), String(category).trim()]
      );
    } else {
      item = db.getFirstSync("SELECT * FROM menu_items WHERE LOWER(TRIM(name)) = LOWER(?)", [String(itemName).trim()]);
    }
    
    if (item) {
      db.runSync(
        "UPDATE menu_items SET price = ?, updated_at = ?, is_synced = 0 WHERE id = ?",
        [newPrice, new Date().toISOString(), item.id]
      );
      enqueueSync("menu_items", item.id, "UPDATE");
      return true;
    }
    return false;
  } catch (err) {
    console.error(err);
    return false;
  }
}

export function deleteMenuItem(itemName, category = null) {
  try {
    let item;
    if (category) {
      item = db.getFirstSync(
        "SELECT * FROM menu_items WHERE LOWER(TRIM(name)) = LOWER(?) AND LOWER(TRIM(category)) = LOWER(?)",
        [String(itemName).trim(), String(category).trim()]
      );
    } else {
      item = db.getFirstSync("SELECT * FROM menu_items WHERE LOWER(TRIM(name)) = LOWER(?)", [String(itemName).trim()]);
    }
    
    if (item) {
      console.log(`[MENU-DEBUG] deleteMenuItem name="${itemName}" category="${category || ''}" id=${item.id}`);
      logDeleteHistory("menu_items", item.id, "Menu Items");
      db.runSync("DELETE FROM menu_items WHERE id = ?", [item.id]);
      recordDeletion("menu_items", item.id);
      return true;
    }
    return false;
  } catch (err) {
    console.error(err);
    return false;
  }
}

export function getTables() {
  try {
    const rows = db.getAllSync("SELECT * FROM restaurant_tables");
    const mapped = rows.map(r => ({
      id: r.id,
      name: r.table_name,
      status: r.status,
      items: JSON.parse(r.items || '[]'),
      startTime: r.startTime || ''
    }));

    // Stable Numeric Sort: Extracts digits from IDs like 'table_1'
    return mapped.sort((a, b) => {
      const numA = parseInt(String(a.id).replace(/\D/g, '')) || 0;
      const numB = parseInt(String(b.id).replace(/\D/g, '')) || 0;
      return numA - numB;
    });
  } catch (err) {
    console.error(err);
    return [];
  }
}

export function updateTableState(tableId, updatedItems, status, startTime) {
  try {
    if (String(tableId).includes('table_8')) {
      console.log(`[TABLE8-DEBUG] updateTableState id=${tableId} status=${status} items=${Array.isArray(updatedItems) ? updatedItems.length : '?'}`);
    }
    const now = new Date().toISOString();
    db.runSync(
      "UPDATE restaurant_tables SET items = ?, status = ?, startTime = ?, updated_at = ?, is_synced = 0 WHERE id = ?",
      [JSON.stringify(updatedItems), status, startTime, now, tableId]
    );
    enqueueSync("restaurant_tables", tableId, "UPDATE");
  } catch (err) {
    console.error(err);
  }
}

export function updateTableName(tableId, newName) {
  try {
    if (String(tableId).includes('table_8')) {
      console.log(`[TABLE8-DEBUG] updateTableName id=${tableId} newName="${newName}"`);
    }
    const now = new Date().toISOString();
    db.runSync(
      "UPDATE restaurant_tables SET table_name = ?, updated_at = ?, is_synced = 0 WHERE id = ?",
      [newName, now, tableId]
    );
    enqueueSync("restaurant_tables", tableId, "UPDATE");
  } catch (err) {
    console.error(err);
  }
}



export function getDeliveries() {
  try {
    const rows = db.getAllSync("SELECT * FROM deliveries WHERE status != 'COMPLETED'");
    return rows.map(r => {
      const parsedItems = JSON.parse(r.items || '[]');
      const charge = parseFloat(r.delivery_charge) || 0;
      const changeMoney = parseFloat(r.change_money_given) || 0;
      const itemsSubtotal = parsedItems.reduce((sum, item) => sum + ((parseFloat(item.price) || 0) * (parseInt(item.qty, 10) || 1)), 0);
      const computedAmount = itemsSubtotal + charge;
      const canonicalAmount = (r.amount !== null && r.amount !== undefined && !isNaN(r.amount) && Number(r.amount) > 0)
        ? parseFloat(r.amount)
        : computedAmount;

      return {
        id: r.id,
        name: r.customer_name,
        status: r.status,
        items: parsedItems,
        startTime: r.startTime || '',
        deliveryCharge: charge,
        delivery_charge: charge,
        changeMoneyGiven: changeMoney,
        change_money_given: changeMoney,
        amount: canonicalAmount,
        totalAmount: canonicalAmount
      };
    });
  } catch (err) {
    console.error(err);
    return [];
  }
}

export function createDelivery(id, name, status, startTime) {
  try {
    const now = new Date().toISOString();
    const existing = db.getFirstSync("SELECT id FROM deliveries WHERE id = ?", [id]);
    if (existing) {
      db.runSync(
        "UPDATE deliveries SET customer_name = ?, status = ?, startTime = ?, updated_at = ?, is_synced = 0 WHERE id = ?",
        [name, status, startTime, now, id]
      );
      enqueueSync("deliveries", id, "UPDATE");
    } else {
      db.runSync(
        "INSERT OR REPLACE INTO deliveries (id, customer_name, amount, status, items, startTime, created_at, updated_at, is_synced) VALUES (?, ?, 0, ?, '[]', ?, ?, ?, 0)",
        [id, name, status, startTime, now, now]
      );
      enqueueSync("deliveries", id, "INSERT");
    }
  } catch (err) {
    console.error(err);
  }
}

export function updateDeliveryState(id, updatedItems, status, startTime) {
  try {
    const now = new Date().toISOString();
    const row = db.getFirstSync("SELECT delivery_charge FROM deliveries WHERE id = ?", [id]);
    const delCharge = row ? (parseFloat(row.delivery_charge) || 0) : 0;
    const itemsSubtotal = updatedItems.reduce((sum, item) => sum + ((parseFloat(item.price) || 0) * (parseInt(item.qty, 10) || 1)), 0);
    const totalAmount = itemsSubtotal + delCharge;
    db.runSync(
      "UPDATE deliveries SET items = ?, status = ?, startTime = ?, amount = ?, updated_at = ?, is_synced = 0 WHERE id = ?",
      [JSON.stringify(updatedItems), status, startTime, totalAmount, now, id]
    );
    enqueueSync("deliveries", id, "UPDATE");
  } catch (err) {
    console.error(err);
  }
}

export function updateDeliveryDetails(id, delCharge, changeMoney) {
  try {
    const now = new Date().toISOString();
    const row = db.getFirstSync("SELECT items FROM deliveries WHERE id = ?", [id]);
    let itemsSubtotal = 0;
    if (row && row.items) {
      try {
        const parsed = JSON.parse(row.items);
        itemsSubtotal = parsed.reduce((sum, item) => sum + ((parseFloat(item.price) || 0) * (parseInt(item.qty, 10) || 1)), 0);
      } catch (e) {}
    }
    const numericDelCharge = parseFloat(delCharge) || 0;
    const numericChangeMoney = parseFloat(changeMoney) || 0;
    const finalAmount = itemsSubtotal + numericDelCharge;

    db.runSync(
      "UPDATE deliveries SET delivery_charge = ?, change_money_given = ?, amount = ?, updated_at = ?, is_synced = 0 WHERE id = ?",
      [numericDelCharge, numericChangeMoney, finalAmount, now, id]
    );
    enqueueSync("deliveries", id, "UPDATE");
  } catch (err) {
    console.error(err);
  }
}

export function completeDelivery(id, finalTotal, delCharge, changeMoney) {
  try {
    const now = new Date().toISOString();
    db.runSync(
      `UPDATE deliveries 
       SET status = 'COMPLETED',
           amount = ?,
           delivery_charge = ?,
           change_money_given = ?,
           completed_at = ?,
           updated_at = ?,
           is_synced = 0 
       WHERE id = ?`,
      [finalTotal, delCharge, changeMoney, now, now, id]
    );
    enqueueSync("deliveries", id, "UPDATE");
    return true;
  } catch (err) {
    console.error("[DB] Error completing delivery:", err);
    return false;
  }
}

export function getDeliveryById(id) {
  try {
    return db.getFirstSync("SELECT * FROM deliveries WHERE id = ?", [id]);
  } catch (err) {
    console.error("[DB] Error getting delivery by id:", err);
    return null;
  }
}

export function removeDelivery(id) {
  try {
    logDeleteHistory("deliveries", id, "Others");
    db.runSync("DELETE FROM deliveries WHERE id = ?", [id]);
    recordDeletion("deliveries", id);
  } catch (err) {
    console.error(err);
  }
}

export function getCompletedOrders() {
  try {
    const rows = db.getAllSync("SELECT * FROM orders ORDER BY created_at DESC");
    return rows.map(r => ({
      id: r.id,
      tableId: r.table_id,
      items: r.items,
      totalAmount: (r.subtotal !== null && r.subtotal !== undefined) ? r.subtotal : r.grand_total,
      deliveryCharge: r.delivery_charge || 0,
      changeMoneyGiven: r.change_money_given || 0,
      cash_amount: r.cash_amount || 0,
      bkash_amount: r.bkash_amount || 0,
      nagad_amount: r.nagad_amount || 0,
      rocket_amount: r.rocket_amount || 0,
      grandTotal: r.grand_total,
      paidAmount: r.grand_total,
      method: r.payment_method,
      time: r.time,
      paymentTime: r.time,
      status: 'Done',
      fullDate: getBusinessDateFromISO(r.created_at)
    }));
  } catch (err) {
    console.error(err);
    return [];
  }
}

export function addCompletedOrder(orderRecord) {
  try {
    const idStr = String(orderRecord.id);
    const nowIso = new Date().toISOString();
    const todayStr = nowIso.substring(0, 10);
    const deliveryCharge = orderRecord.deliveryCharge || 0;
    const changeMoneyGiven = orderRecord.changeMoneyGiven || 0;

    // Breakdown Amounts (for Split Payments)
    const cashAmt = orderRecord.cashAmount || 0;
    const bkashAmt = orderRecord.bkashAmount || 0;
    const nagadAmt = orderRecord.nagadAmount || 0;
    const rocketAmt = orderRecord.rocketAmount || 0;

    const expectedGrandTotal = (orderRecord.totalAmount || 0) + deliveryCharge + changeMoneyGiven;
    const discount = Math.max(0, expectedGrandTotal - orderRecord.paidAmount);
    const finalGrandTotal = Math.min(orderRecord.paidAmount, expectedGrandTotal);

    // Check if order already exists in SQLite to prevent duplicate creation
    const existingOrder = db.getFirstSync("SELECT id FROM orders WHERE id = ?", [idStr]);
    if (existingOrder) {
      db.runSync(`
        UPDATE orders SET table_id = ?, items = ?, subtotal = ?, discount = ?, delivery_charge = ?, change_money_given = ?,
        cash_amount = ?, bkash_amount = ?, nagad_amount = ?, rocket_amount = ?,
        grand_total = ?, payment_status = 'Paid', payment_method = ?, time = ?, updated_at = ?, is_synced = 0
        WHERE id = ?
      `, [
        orderRecord.tableId,
        orderRecord.items,
        orderRecord.totalAmount,
        discount,
        deliveryCharge,
        changeMoneyGiven,
        cashAmt,
        bkashAmt,
        nagadAmt,
        rocketAmt,
        finalGrandTotal,
        orderRecord.method,
        orderRecord.time,
        nowIso,
        idStr
      ]);
      enqueueSync("orders", idStr, "UPDATE");
    } else {
      db.runSync(`
        INSERT OR REPLACE INTO orders (
          id, table_id, items, subtotal, discount, delivery_charge, change_money_given,
          cash_amount, bkash_amount, nagad_amount, rocket_amount,
          grand_total, payment_status, payment_method, time, created_at, updated_at, locked_at, is_synced
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Paid', ?, ?, ?, ?, ?, 0)
      `, [
        idStr,
        orderRecord.tableId,
        orderRecord.items,
        orderRecord.totalAmount,
        discount,
        deliveryCharge,
        changeMoneyGiven,
        cashAmt,
        bkashAmt,
        nagadAmt,
        rocketAmt,
        finalGrandTotal,
        orderRecord.method,
        orderRecord.time,
        nowIso,
        nowIso,
        nowIso
      ]);
      enqueueSync("orders", idStr, "INSERT");
    }
    const payId = `pay_${idStr}`;
    const existingPay = db.getFirstSync("SELECT id FROM payments WHERE id = ?", [payId]);
    if (existingPay) {
      db.runSync(`
        UPDATE payments SET total_amount = ?, customer_paid = ?, discount_amount = ?, delivery_charge = ?, change_money_given = ?, 
        cash_amount = ?, bkash_amount = ?, nagad_amount = ?, rocket_amount = ?,
        payment_method = ?, payment_status = 'Paid', paid_at = ?, updated_at = ?, is_synced = 0
        WHERE id = ?
      `, [expectedGrandTotal, orderRecord.paidAmount, discount, deliveryCharge, changeMoneyGiven, cashAmt, bkashAmt, nagadAmt, rocketAmt, orderRecord.method, nowIso, nowIso, payId]);
      enqueueSync("payments", payId, "UPDATE");
    } else {
      db.runSync(`
        INSERT OR REPLACE INTO payments (
          id, order_id, total_amount, customer_paid, discount_amount, delivery_charge, 
          change_money_given, cash_amount, bkash_amount, nagad_amount, rocket_amount,
          payment_method, payment_status, paid_at, created_at, updated_at, is_synced
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Paid', ?, ?, ?, 0)
      `, [
        payId,
        idStr,
        expectedGrandTotal,
        orderRecord.paidAmount,
        discount,
        deliveryCharge,
        changeMoneyGiven,
        cashAmt,
        bkashAmt,
        nagadAmt,
        rocketAmt,
        orderRecord.method,
        nowIso,
        nowIso,
        nowIso
      ]);
      enqueueSync("payments", payId, "INSERT");
    }

    const itemsArr = orderRecord.items.split(', ');
    itemsArr.forEach((itemStr, index) => {
      // Regex updated to support "Item Name xQty @Price" format
      const match = itemStr.match(/(.+) x(\d+)(?: @(\d+))?/);
      if (match) {
        const itemName = match[1];
        const qty = parseInt(match[2], 10);
        
        // If price is provided in the string (from UI), use it. 
        // Otherwise, fall back to menu lookup.
        let price = match[3] ? parseFloat(match[3]) : 0;
        
        if (!price || price === 0) {
          const menuRec = db.getFirstSync("SELECT price FROM menu_items WHERE name = ?", [itemName]);
          price = menuRec ? menuRec.price : 0;
          
          // Special fallback for Water if menu lookup fails
          if (price === 0 && itemName === 'পানি') price = 20;
        }

        const revenue = price * qty;
        const itemId = `${idStr}_item_${index}`;
        
        const existingItem = db.getFirstSync("SELECT id FROM order_items WHERE id = ?", [itemId]);
        console.log(`[ORDERITEM-DEBUG] checkout ${existingItem ? 'UPDATE' : 'INSERT'} order_items id=${itemId} order=${idStr} item="${itemName}" qty=${qty}`);
        if (existingItem) {
          db.runSync(`
            UPDATE order_items SET itemName = ?, quantity = ?, unit_price = ?, revenue = ?, updated_at = ?, is_synced = 0 WHERE id = ?
          `, [itemName, qty, price, revenue, nowIso, itemId]);
          enqueueSync("order_items", itemId, "UPDATE");
        } else {
          db.runSync(`
            INSERT OR REPLACE INTO order_items (id, order_id, itemName, quantity, unit_price, revenue, created_at, updated_at, is_synced)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
          `, [itemId, idStr, itemName, qty, price, revenue, nowIso, nowIso]);
          enqueueSync("order_items", itemId, "INSERT");
        }
      }
    });

    if (orderRecord.tableId.toString().includes('Delivery')) {
      const delName = orderRecord.tableId.trim();
      const delId = db.getFirstSync("SELECT id FROM deliveries WHERE customer_name = ? AND status = 'BUSY'", [delName]);
      if (delId) {
        db.runSync("UPDATE deliveries SET status = 'COMPLETED', completed_at = ?, updated_at = ? WHERE id = ?", [nowIso, nowIso, delId.id]);
        enqueueSync("deliveries", delId.id, "UPDATE");
      }
    }

    calculateAndSaveDailySummary(todayStr);

    // PUSH-ON-WRITE: checkout had NO immediate push (it waited for the 5s daemon).
    // Flush the just-queued rows (order + items + payments + delivery) on both clouds now.
    processSyncQueue().catch(() => {});
    try {
      const { processSupabaseSyncQueue } = require("./services/supabaseSyncQueue.js");
      processSupabaseSyncQueue().catch(() => {});
    } catch (_) {}

    return true;
  } catch (err) {
    console.error("Add completed order error:", err);
    return false;
  }
}

export function getDailyExpenses() {
  try {
    const todayStr = getBusinessDate();
    const rows = db.getAllSync("SELECT * FROM expenses WHERE date(created_at, 'localtime') = ?", [todayStr]);
    
    const expenses = {
      duduMiah: 0,
      akashChicken: 0,
      burgerBun: 0,
      bazar: 0,
      bazarNote: '',
      others: 0,
      othersNote: '',
      ijara: 0
    };

    rows.forEach(r => {
      const cat = r.category;
      const amt = r.amount || 0;
      if (cat === 'দুদু স্টোর') expenses.duduMiah = amt;
      else if (cat === 'আকাশ মুরগী') expenses.akashChicken = amt;
      else if (cat === 'বার্গার বান') expenses.burgerBun = amt;
      else if (cat === 'বাজার') {
        expenses.bazar = amt;
        expenses.bazarNote = r.note || '';
      }
      else if (cat === 'অন্যান্য') {
        expenses.others = amt;
        expenses.othersNote = r.note || '';
      }
      else if (cat === 'ijara') expenses.ijara = amt;
    });

    return expenses;
  } catch (err) {
    console.error(err);
    return { duduMiah: 0, akashChicken: 0, burgerBun: 0, bazar: 0, bazarNote: '', others: 0, othersNote: '', ijara: 0 };
  }
}

// ==========================================
// SUPPLIER DUE LEDGER
// ==========================================

export function getSupplierDueData() {
  try {
    const expenses = getDailyExpenses();
    const payments = {
      'dudu_store': expenses.duduMiah || 0,
      'akash_murgi': expenses.akashChicken || 0,
      'burger_bun': expenses.burgerBun || 0
    };

    const rows = db.getAllSync("SELECT * FROM supplier_due WHERE id IN ('dudu_store', 'akash_murgi', 'burger_bun')");
    return rows.map(r => {
      const payment = payments[r.id] || 0;
      return {
        ...r,
        payment_amount: payment
      };
    });
  } catch (err) {
    console.error("Failed to get supplier due data:", err);
    return [];
  }
}

export function saveSupplierDue(supplierId, currentDueBeforeSave, todayPurchase, note, userDisplayName) {
  try {
    const todayStr = getBusinessDate();
    const now = new Date().toISOString();
    const expenses = getDailyExpenses();
    
    let payment = 0;
    if (supplierId === 'dudu_store') payment = expenses.duduMiah || 0;
    else if (supplierId === 'akash_murgi') payment = expenses.akashChicken || 0;
    else if (supplierId === 'burger_bun') payment = expenses.burgerBun || 0;

    const newCurrentDue = currentDueBeforeSave + todayPurchase - payment;

    db.runSync(
      "UPDATE supplier_due SET current_due = ?, note = ?, updated_at = ?, is_synced = 0 WHERE id = ?",
      [newCurrentDue, note, now, supplierId]
    );
    enqueueSync("supplier_due", supplierId, "UPDATE");

    const historyId = `${supplierId}_${Date.now()}`;
    const supplierRow = db.getFirstSync("SELECT supplier_name FROM supplier_due WHERE id = ?", [supplierId]);
    const supplierName = supplierRow ? supplierRow.supplier_name : supplierId;

    db.runSync(`
      INSERT OR REPLACE INTO supplier_due_history (
        id, date, supplier_id, supplier_name, previous_due, purchase_amount, payment_amount, current_due, note, created_by, created_at, updated_at, is_synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `, [
      historyId, todayStr, supplierId, supplierName, currentDueBeforeSave, todayPurchase, payment, newCurrentDue, note, userDisplayName || 'System', now, now
    ]);
    enqueueSync("supplier_due_history", historyId, "INSERT");

    return true;
  } catch (err) {
    console.error("Save supplier due error:", err);
    return false;
  }
}

export function getSupplierDueHistory(supplierId) {
  try {
    return db.getAllSync("SELECT * FROM supplier_due_history WHERE supplier_id = ? ORDER BY date DESC", [supplierId]);
  } catch (err) {
    console.error("Get supplier due history error:", err);
    return [];
  }
}

export function deleteSupplierDueHistory(historyId) {
  try {
    logDeleteHistory("supplier_due_history", historyId, "Due Records");
    db.runSync("DELETE FROM supplier_due_history WHERE id = ?", [historyId]);
    recordDeletion("supplier_due_history", historyId);
    return true;
  } catch (err) {
    console.error("Delete supplier due history error:", err);
    return false;
  }
}

// ==========================================
// DAILY SUPPLIER PAYMENT LEDGER
// ==========================================

/**
 * Fetch all payment records for a specific month (YYYY-MM).
 */
export function getSupplierPaymentLedger(monthStr) {
  try {
    return db.getAllSync(
      "SELECT * FROM supplier_payment_ledger WHERE month = ? ORDER BY payment_date ASC",
      [monthStr]
    );
  } catch (err) {
    console.error("[DB] Failed to get supplier payment ledger:", err);
    return [];
  }
}

/**
 * Saves or updates a supplier payment amount for a specific date.
 * Enforces 48-hour lock rule.
 */
export function saveSupplierPayment(dateStr, supplierField, amount, createdBy, userRole = '') {
  try {
    const now = new Date().toISOString();
    const monthStr = dateStr.substring(0, 7);
    const yearStr = dateStr.substring(0, 4);
    const id = `spl_${dateStr}`;

    const existing = db.getFirstSync("SELECT * FROM supplier_payment_ledger WHERE payment_date = ?", [dateStr]);

    if (existing) {
      // 48 Hour Lock Check: Only lock if more than 48 hours have passed since creation
      const createdAt = new Date(existing.created_at);
      const currentTime = new Date();
      const diffHours = (currentTime - createdAt) / (1000 * 60 * 60);
      
      if (diffHours > 48 && userRole !== 'admin') {
        return { success: false, error: "Locked: 48 hours passed since entry creation." };
      }

      db.runSync(
        `UPDATE supplier_payment_ledger SET ${supplierField} = ?, updated_at = ?, is_synced = 0 WHERE id = ?`,
        [amount, now, existing.id]
      );
      enqueueSync("supplier_payment_ledger", existing.id, "UPDATE");
      syncRecordImmediately("supplier_payment_ledger", existing.id);
    } else {
      const fields = {
        variety_store_amount: 0,
        morgir_dokan_amount: 0,
        burger_ban_amount: 0
      };
      fields[supplierField] = amount;

      db.runSync(
        `INSERT INTO supplier_payment_ledger (
          id, payment_date, month, year, 
          variety_store_amount, morgir_dokan_amount, burger_ban_amount, 
          created_by, created_at, updated_at, is_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          id, dateStr, monthStr, yearStr, 
          fields.variety_store_amount, fields.morgir_dokan_amount, fields.burger_ban_amount, 
          createdBy, now, now
        ]
      );
      enqueueSync("supplier_payment_ledger", id, "INSERT");
      syncRecordImmediately("supplier_payment_ledger", id);
    }
    return { success: true };
  } catch (err) {
    console.error("[DB] Failed to save supplier payment:", err);
    return { success: false, error: err.message };
  }
}

export function updateDailyExpenses(expenses) {
  try {
    const todayStr = getBusinessDate();
    const now = new Date().toISOString();

    const categories = [
      { name: 'দুদু স্টোর', val: expenses.duduMiah },
      { name: 'আকাশ মুরগী', val: expenses.akashChicken },
      { name: 'বার্গার বান', val: expenses.burgerBun },
      { name: 'বাজার', val: expenses.bazar, note: expenses.bazarNote },
      { name: 'অন্যান্য', val: expenses.others, note: expenses.othersNote },
      { name: 'ijara', val: expenses.ijara }
    ];

    for (const cat of categories) {
      const stableId = `exp_${todayStr}_${cat.name.replace(/\s+/g, '_')}`;
      const existing = db.getFirstSync("SELECT * FROM expenses WHERE id = ? OR (date(created_at, 'localtime') = ? AND category = ?)", [stableId, todayStr, cat.name]);
      if (existing) {
        db.runSync(
          "UPDATE expenses SET amount = ?, note = ?, updated_at = ?, is_synced = 0 WHERE id = ?",
          [cat.val || 0, cat.note || '', now, existing.id]
        );
        enqueueSync("expenses", existing.id, "UPDATE");
      } else {
        db.runSync(
          "INSERT OR REPLACE INTO expenses (id, category, amount, note, is_due, given_amount, used_amount, returned_amount, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, 0)",
          [stableId, cat.name, cat.val || 0, cat.note || '', now, now]
        );
        enqueueSync("expenses", stableId, "INSERT");
      }
    }

    const ejaId = `eja_${todayStr}`;
    const existingEja = db.getFirstSync("SELECT * FROM eja_history WHERE id = ? OR date = ?", [ejaId, todayStr]);
    if (expenses.ijara > 0) {
      if (!existingEja) {
        db.runSync(
          "INSERT OR REPLACE INTO eja_history (id, date, eja_amount, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, 0)",
          [ejaId, todayStr, expenses.ijara, now, now]
        );
        enqueueSync("eja_history", ejaId, "INSERT");
      } else {
        db.runSync(
          "UPDATE eja_history SET eja_amount = ?, updated_at = ?, is_synced = 0 WHERE id = ?",
          [expenses.ijara, now, existingEja.id]
        );
        enqueueSync("eja_history", existingEja.id, "UPDATE");
      }
    } else {
      if (existingEja) {
        db.runSync(
          "UPDATE eja_history SET eja_amount = 0, updated_at = ?, is_synced = 0 WHERE id = ?",
          [now, existingEja.id]
        );
        enqueueSync("eja_history", existingEja.id, "UPDATE");
      }
    }

    calculateAndSaveDailySummary(todayStr);
  } catch (err) {
    console.error("Update expenses error:", err);
  }
}

export function getSubmissionHistory() {
  try {
    const rows = db.getAllSync("SELECT * FROM daily_submit ORDER BY date DESC");
    return rows.map(r => ({
      date: r.date,
      sell: r.total_sell,
      expense: r.total_expense,
      deposit: r.net_deposit,
      net_cash: r.net_cash || 0,
      notes: r.notes || '',
      submitted_by: r.submitted_by,
      submitted_at: r.submitted_at,
      submissionType: r.submission_type || 'MANUAL',
      isManualEntry: r.submitted_by === 'Manual Entry',
      breakdown: {
        cash: r.cash_payment,
        bkash: r.bkash_payment,
        nagad: r.nagad_payment,
        rocket: r.rocket_payment || 0,
        delivery_sell: r.delivery_sell || 0,
        delivery_charge: r.delivery_charge || 0,
        ijara: r.eja,
        dudu: r.dudu_store,
        akash: r.akash_murgi,
        burger: r.burger_bun,
        bazar: r.bazar,
        others: r.others
      }
    }));
  } catch (err) {
    console.error(err);
    return [];
  }
}

export function savePastAccount(record) {
  try {
    let dateStr = record.date;
    // Convert "DD MMM YYYY" (e.g. "17 Jun 2026") to "YYYY-MM-DD"
    if (dateStr) {
      const textMatch = String(dateStr).trim().match(/^(\d{1,2})\s+([A-Za-z]{3,10})\s+(\d{4})/);
      if (textMatch) {
        const day = String(textMatch[1]).padStart(2, '0');
        const monthName = textMatch[2].substring(0, 3).toLowerCase();
        const year = textMatch[3];
        const monthsShort = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const monthIndex = monthsShort.indexOf(monthName);
        if (monthIndex !== -1) {
          const month = String(monthIndex + 1).padStart(2, '0');
          dateStr = `${year}-${month}-${day}`;
        }
      }
    }
    const now = new Date().toISOString();
    
    db.runSync(`
      INSERT OR REPLACE INTO daily_submit (
        id, date, total_sell, cash_payment, bkash_payment, nagad_payment, rocket_payment,
        delivery_sell, delivery_charge, eja, dudu_store, akash_murgi, burger_bun, bazar, 
        others, total_expense, net_cash, net_deposit, notes,
        submitted_by, submitted_at, is_locked, created_at, updated_at, is_synced, submission_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Manual Entry', ?, 1, ?, ?, 0, 'MANUAL')
    `, [
      dateStr,
      dateStr,
      record.sell,
      record.breakdown?.cash || 0,
      record.breakdown?.bkash || 0,
      record.breakdown?.nagad || 0,
      record.breakdown?.rocket || 0,
      record.breakdown?.delivery_sell || 0,
      record.breakdown?.delivery_charge || 0,
      record.breakdown?.ijara || 0,
      record.breakdown?.dudu || 0,
      record.breakdown?.akash || 0,
      record.breakdown?.burger || 0,
      record.breakdown?.bazar || 0,
      record.breakdown?.others || 0,
      record.expense,
      record.net_cash || 0,
      record.deposit,
      record.notes || '',
      now,
      now,
      now
    ]);
    enqueueSync("daily_submit", dateStr, "INSERT");
    const role = getSessionUserRole() || 'owner';
    saveDailySubmitPriority(dateStr, 'Manual Entry', role);

    db.runSync(`
      INSERT OR REPLACE INTO daily_summary (
        id, date, dayOfWeek, weekOfMonth, isFriday, isHoliday, specialDayNote,
        temperature, humidity, condition, isRainy, windSpeed, totalOrders, totalSales,
        totalDiscount, totalExpense, totalDelivery, averageOrderValue, peakHour,
        firstOrderTime, lastOrderTime, cashTotal, bkashTotal, nagadTotal, rocketTotal,
        ejaAmount, netCash, ownerDeposit, itemSummary, created_at, updated_at, is_synced
      ) VALUES (
        ?, ?, 'Yesterday', 1, 0, 0, 'Past Manual Entry',
        30.0, 70.0, 'Clear', 0, 8.0, 10, ?,
        0.0, ?, ?, 0.0, '12:00 PM',
        '10:00 AM', '09:00 PM', ?, ?, ?, ?,
        ?, ?, ?, '[]', ?, ?, 0
      )
    `, [
      dateStr, dateStr, record.sell, record.expense, record.breakdown?.delivery_sell || 0,
      record.breakdown?.cash || 0, record.breakdown?.bkash || 0, record.breakdown?.nagad || 0, record.breakdown?.rocket || 0,
      record.breakdown?.ijara || 0, record.net_cash || 0, record.deposit, now, now
    ]);
    enqueueSync("daily_summary", dateStr, "INSERT");

    return true;
  } catch (err) {
    console.error("Save past account error:", err);
    return false;
  }
}

export function deleteSubmission(dateStr) {
  try {
    logDeleteHistory("daily_submit", dateStr, "Deposits");
    logDeleteHistory("daily_summary", dateStr, "Deposits");
    db.runSync("DELETE FROM daily_submit WHERE date = ?", [dateStr]);
    db.runSync("DELETE FROM daily_summary WHERE date = ?", [dateStr]);
    recordDeletion("daily_submit", dateStr);
    recordDeletion("daily_summary", dateStr);
    return true;
  } catch (err) {
    console.error("Delete submission error:", err);
    return false;
  }
}

export function isTodaySubmitted() {
  try {
    const todayStr = getBusinessDate();
    const row = db.getFirstSync("SELECT is_locked FROM daily_submit WHERE date = ?", [todayStr]);
    return row ? (row.is_locked === 1) : false;
  } catch (err) {
    console.error(err);
    return false;
  }
}

/**
 * Get a business date offset by N days from a given date string (YYYY-MM-DD)
 * @param {string} dateStr - Starting date in YYYY-MM-DD format
 * @param {number} days - Number of days to add (can be negative)
 * @returns {string} Date string in YYYY-MM-DD format
 */
export function getBusinessDateOffset(dateStr, days) {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (err) {
    console.error("[getBusinessDateOffset] Error:", err);
    return dateStr;
  }
}

/**
 * Calculate and store next day's opening ijara after daily submit
 * This is called from submitDailySheet() to prepare the auto-rollover
 *
 * Formula: nextDayIjara = MAX(0, (totalSales + currentIjara - totalExpense) - ownerDeposit)
 *
 * @param {object} summary - The daily submit summary object
 * @param {string} submittedDateStr - The business date that was submitted (YYYY-MM-DD)
 * @returns {object} { success, nextDayIjara, targetDate } for logging/rollback
 */
export function calculateAndStoreNextDayIjara(summary, submittedDateStr) {
  try {
    const totalSales = summary.sell || 0;
    const currentIjara = summary.breakdown?.ijara || 0;
    const totalExpense = summary.expense || 0;
    const ownerDeposit = parseFloat(summary.deposit) || 0;

    // Formula from PROJECT_ARCHITECTURE_LOG.md
    const nextDayIjara = Math.max(0, (totalSales + currentIjara - totalExpense) - ownerDeposit);

    // Calculate next business date (submitted date + 1 day)
    const targetDate = getBusinessDateOffset(submittedDateStr, 1);
    const now = new Date().toISOString();

    console.log(`[Auto Ijara] Calculated next day ijara:`);
    console.log(`  - Submitted Date: ${submittedDateStr}`);
    console.log(`  - Target Date: ${targetDate}`);
    console.log(`  - Total Sales: ৳${totalSales}`);
    console.log(`  - Current Ijara: ৳${currentIjara}`);
    console.log(`  - Total Expense: ৳${totalExpense}`);
    console.log(`  - Owner Deposit: ৳${ownerDeposit}`);
    console.log(`  - Next Day Ijara: ৳${nextDayIjara}`);

    // Store the pending ijara values in app_config
    db.runSync(
      "INSERT OR REPLACE INTO app_config (id, key, value, created_at, updated_at, is_synced) VALUES (?, 'pending_ijara_amount', ?, ?, ?, 0)",
      [`config_pending_ijara_amount`, String(nextDayIjara), now, now]
    );
    db.runSync(
      "INSERT OR REPLACE INTO app_config (id, key, value, created_at, updated_at, is_synced) VALUES (?, 'pending_ijara_date', ?, ?, ?, 0)",
      [`config_pending_ijara_date`, targetDate, now, now]
    );

    // Enqueue sync for both config values
    enqueueSync("app_config", "config_pending_ijara_amount", "INSERT");
    enqueueSync("app_config", "config_pending_ijara_date", "INSERT");

    console.log(`[Auto Ijara] Stored pending ijara: ৳${nextDayIjara} for date ${targetDate}`);

    return { success: true, nextDayIjara, targetDate };
  } catch (err) {
    console.error("[Auto Ijara] Error calculating next day ijara:", err);
    return { success: false, nextDayIjara: 0, targetDate: null };
  }
}

/**
 * Rollback the most recent auto ijara application
 * This will:
 * 1. Delete the ijara expense record for the target date
 * 2. Delete the eja_history record for the target date
 * 3. Clear any pending ijara values from app_config
 *
 * @param {string} targetDate - The date to rollback (YYYY-MM-DD), if null uses the last pending date
 * @returns {object} { success, message, rolledBackAmount }
 */
export function rollbackAutoIjara(targetDate = null) {
  try {
    let rollbackDate = targetDate;
    let rolledBackAmount = 0;

    // If no target date, try to find from pending or last ijara expense
    if (!rollbackDate) {
      const pendingDateRow = db.getFirstSync("SELECT value FROM app_config WHERE key = 'pending_ijara_date'");
      if (pendingDateRow && pendingDateRow.value) {
        rollbackDate = pendingDateRow.value;
      } else {
        // Find the most recent ijara expense
        const lastIjara = db.getFirstSync(
          "SELECT * FROM expenses WHERE category = 'ijara' ORDER BY created_at DESC LIMIT 1"
        );
        if (lastIjara) {
          // Extract date from created_at or id
          const dateMatch = lastIjara.id.match(/exp_(\d{4}-\d{2}-\d{2})_ijara/);
          if (dateMatch) {
            rollbackDate = dateMatch[1];
          }
        }
      }
    }

    if (!rollbackDate) {
      return { success: false, message: 'কোনো অটো ইজা পাওয়া যায়নি', rolledBackAmount: 0 };
    }

    console.log(`[Auto Ijara Rollback] Rolling back ijara for date: ${rollbackDate}`);

    // 1. Delete the ijara expense record
    const stableExpId = `exp_${rollbackDate}_ijara`;
    const existingExp = db.getFirstSync(
      "SELECT * FROM expenses WHERE id = ? OR (category = 'ijara' AND date(created_at, 'localtime') = ?)",
      [stableExpId, rollbackDate]
    );

    if (existingExp) {
      rolledBackAmount = Number(existingExp.amount) || 0;
      db.runSync("DELETE FROM expenses WHERE id = ?", [existingExp.id]);
      recordDeletion("expenses", existingExp.id);
      enqueueSync("expenses", existingExp.id, "DELETE");
      console.log(`[Auto Ijara Rollback] Deleted expense record: ${existingExp.id} (৳${rolledBackAmount})`);
    }

    // 2. Delete the eja_history record
    const ejaId = `eja_${rollbackDate}`;
    const existingEja = db.getFirstSync(
      "SELECT * FROM eja_history WHERE id = ? OR date = ?",
      [ejaId, rollbackDate]
    );

    if (existingEja) {
      db.runSync("DELETE FROM eja_history WHERE id = ?", [existingEja.id]);
      recordDeletion("eja_history", existingEja.id);
      enqueueSync("eja_history", existingEja.id, "DELETE");
      console.log(`[Auto Ijara Rollback] Deleted eja_history record: ${existingEja.id}`);
    }

    // 3. Clear pending ijara values from app_config
    db.runSync("DELETE FROM app_config WHERE key = 'pending_ijara_amount'");
    db.runSync("DELETE FROM app_config WHERE key = 'pending_ijara_date'");
    enqueueSync("app_config", "pending_ijara_amount", "DELETE");
    enqueueSync("app_config", "pending_ijara_date", "DELETE");

    console.log(`[Auto Ijara Rollback] Cleared pending ijara config values`);

    return {
      success: true,
      message: `ইজা ৳${rolledBackAmount.toLocaleString()} (${rollbackDate}) সফলভাবে রোলব্যাক করা হয়েছে`,
      rolledBackAmount,
      rolledBackDate: rollbackDate
    };
  } catch (err) {
    console.error("[Auto Ijara Rollback] Error:", err);
    return { success: false, message: 'রোলব্যাক ব্যর্থ হয়েছে: ' + err.message, rolledBackAmount: 0 };
  }
}

/**
 * Get the last auto ijara details for display/audit purposes
 * @returns {object|null} { amount, date, applied_at } or null
 */
export function getLastAutoIjaraDetails() {
  try {
    // Check pending first
    const pendingAmount = db.getFirstSync("SELECT value FROM app_config WHERE key = 'pending_ijara_amount'");
    const pendingDate = db.getFirstSync("SELECT value FROM app_config WHERE key = 'pending_ijara_date'");

    if (pendingAmount && pendingDate) {
      return {
        amount: parseFloat(pendingAmount.value),
        date: pendingDate.value,
        status: 'PENDING',
        message: `অপেক্ষমাণ: ৳${parseFloat(pendingAmount.value).toLocaleString()} (${pendingDate.value})`
      };
    }

    // Check last applied ijara expense
    const lastIjara = db.getFirstSync(
      "SELECT * FROM expenses WHERE category = 'ijara' ORDER BY created_at DESC LIMIT 1"
    );

    if (lastIjara) {
      const dateMatch = lastIjara.id.match(/exp_(\d{4}-\d{2}-\d{2})_ijara/);
      const ijaraDate = dateMatch ? dateMatch[1] : 'Unknown';
      return {
        amount: Number(lastIjara.amount) || 0,
        date: ijaraDate,
        status: 'APPLIED',
        message: `সর্বশেষ প্রয়োগ: ৳${(Number(lastIjara.amount) || 0).toLocaleString()} (${ijaraDate})`
      };
    }

    return null;
  } catch (err) {
    console.error("[getLastAutoIjaraDetails] Error:", err);
    return null;
  }
}

export function submitDailySheet(summary, submittedBy, submissionType = 'MANUAL') {
  try {
    const todayStr = summary.bizDate || getBusinessDate();
    const now = new Date().toISOString();
    console.log("[FORENSIC DEBUG] STEP 1 - submitDailySheet started for bizDate:", todayStr, "by:", submittedBy);
    
    db.runSync(`
      INSERT OR REPLACE INTO daily_submit (
        id, date, total_sell, cash_payment, bkash_payment, nagad_payment, rocket_payment,
        delivery_sell, delivery_charge, eja, dudu_store, akash_murgi, burger_bun, bazar, 
        others, total_expense, net_cash, net_deposit, notes,
        submitted_by, submitted_at, is_locked, created_at, updated_at, is_synced, submission_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, ?)
    `, [
      todayStr,
      todayStr,
      summary.sell,
      summary.breakdown?.cash || 0,
      summary.breakdown?.bkash || 0,
      summary.breakdown?.nagad || 0,
      summary.breakdown?.rocket || 0,
      summary.breakdown?.delivery_sell || 0,
      summary.breakdown?.delivery_charge || 0,
      summary.breakdown?.ijara || 0,
      summary.breakdown?.dudu || 0,
      summary.breakdown?.akash || 0,
      summary.breakdown?.burger || 0,
      summary.breakdown?.bazar || 0,
      summary.breakdown?.others || 0,
      summary.expense,
      summary.net_cash || 0,
      summary.deposit,
      summary.notes || '',
      submittedBy,
      now,
      now,
      now,
      submissionType
    ]);
    enqueueSync("daily_submit", todayStr, "INSERT");
    const role = getSessionUserRole() || 'manager';
    saveDailySubmitPriority(todayStr, submittedBy, role);

    // --- AUTO-FILL SUPPLIER LEDGER ---
    const monthStr = todayStr.substring(0, 7);
    const yearStr = todayStr.substring(0, 4);
    const splId = `spl_${todayStr}`;

    const existingSpl = db.getFirstSync("SELECT created_by, created_at FROM supplier_payment_ledger WHERE id = ?", [splId]);
    const finalCreatedBy = existingSpl ? existingSpl.created_by : submittedBy;
    const finalCreatedAt = existingSpl ? existingSpl.created_at : now;

    db.runSync(`
      INSERT OR REPLACE INTO supplier_payment_ledger (
        id, payment_date, month, year,
        variety_store_amount, morgir_dokan_amount, burger_ban_amount,
        created_by, created_at, updated_at, is_synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `, [
      splId, todayStr, monthStr, yearStr,
      summary.breakdown?.dudu || 0,
      summary.breakdown?.akash || 0,
      summary.breakdown?.burger || 0,
      finalCreatedBy, finalCreatedAt, now
    ]);
    enqueueSync("supplier_payment_ledger", splId, "INSERT");
    syncRecordImmediately("supplier_payment_ledger", splId);

    db.runSync("UPDATE orders SET locked_at = ? WHERE date(created_at, 'localtime') = ?", [now, todayStr]);

    calculateAndSaveDailySummary(todayStr);

    // --- AUTO IJARA: Calculate and store next day's opening ijara ---
    const ijaraResult = calculateAndStoreNextDayIjara(summary, todayStr);
    if (ijaraResult.success && ijaraResult.nextDayIjara > 0) {
      console.log(`[DailySubmit] Next day ijara calculated: ৳${ijaraResult.nextDayIjara} for ${ijaraResult.targetDate}`);
    } else {
      console.log(`[DailySubmit] Next day ijara is ৳0, no pending ijara stored`);
    }

    // Apply any previously pending ijara (from yesterday's submit)
    checkAndApplyIjaraRollover();

    // --- TRANSACTION-SAFE AI DATASET SYNC TRIGGER ---
    // Triggered ONLY after all SQLite writes, daily_submit records, supplier ledgers, 
    // summaries, and ijara rollovers have completed and committed cleanly.
    enqueueAIDatasetExport(todayStr);

    return true;
  } catch (err) {
    console.error("Failed to submit daily sheet:", err.stack || err);
    return false;
  }
}

export function checkAndApplyIjaraRollover() {
  try {
    const amountRow = db.getFirstSync("SELECT value FROM app_config WHERE key = 'pending_ijara_amount'");
    const dateRow = db.getFirstSync("SELECT value FROM app_config WHERE key = 'pending_ijara_date'");

    if (amountRow && dateRow) {
      const pendingAmount = parseFloat(amountRow.value);
      const pendingDateStr = dateRow.value;
      const todayStr = getBusinessDate();

      if (todayStr >= pendingDateStr) {
        const targetDate = pendingDateStr;
        console.log(`[Auto Ijara] Checking fallback Opening Ijara ৳${pendingAmount} for target date ${targetDate}`);
        const targetIso = `${targetDate}T00:00:00.000Z`;

        // 1. Process expenses table (idempotent fallback: INSERT, UPDATE, or SKIP)
        const stableExpId = `exp_${targetDate}_ijara`;
        const existingExp = db.getFirstSync(
          "SELECT * FROM expenses WHERE id = ? OR (category = 'ijara' AND date(created_at, 'localtime') = ?)",
          [stableExpId, targetDate]
        );

        if (!existingExp) {
          console.log(`[Auto Ijara] Expense record missing. Inserting new expense ৳${pendingAmount} for ${targetDate}`);
          db.runSync(
            "INSERT OR REPLACE INTO expenses (id, category, amount, note, is_due, given_amount, used_amount, returned_amount, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, 0)",
            [stableExpId, 'ijara', pendingAmount, 'Auto Carry Forward', targetIso, targetIso]
          );
          enqueueSync("expenses", stableExpId, "INSERT");
        } else if (Number(existingExp.amount) !== pendingAmount) {
          console.log(`[Auto Ijara] Expense amount mismatch (existing: ৳${existingExp.amount}, pending: ৳${pendingAmount}). Updating expense ID ${existingExp.id}`);
          db.runSync(
            "UPDATE expenses SET amount = ?, updated_at = ?, is_synced = 0 WHERE id = ?",
            [pendingAmount, targetIso, existingExp.id]
          );
          enqueueSync("expenses", existingExp.id, "UPDATE");
        } else {
          console.log(`[Auto Ijara] Expense record already matches pending amount ৳${pendingAmount}. Skipping expense write.`);
        }

        // 2. Process eja_history table (idempotent fallback: INSERT, UPDATE, or SKIP)
        const ejaId = `eja_${targetDate}`;
        const existingEja = db.getFirstSync(
          "SELECT * FROM eja_history WHERE id = ? OR date = ?",
          [ejaId, targetDate]
        );

        if (!existingEja) {
          console.log(`[Auto Ijara] EJA record missing. Inserting new eja_history ৳${pendingAmount} for ${targetDate}`);
          db.runSync(
            "INSERT OR REPLACE INTO eja_history (id, date, eja_amount, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, 0)",
            [ejaId, targetDate, pendingAmount, targetIso, targetIso]
          );
          enqueueSync("eja_history", ejaId, "INSERT");
        } else if (Number(existingEja.eja_amount) !== pendingAmount) {
          console.log(`[Auto Ijara] EJA amount mismatch (existing: ৳${existingEja.eja_amount}, pending: ৳${pendingAmount}). Updating eja_history ID ${existingEja.id}`);
          db.runSync(
            "UPDATE eja_history SET eja_amount = ?, updated_at = ?, is_synced = 0 WHERE id = ?",
            [pendingAmount, targetIso, existingEja.id]
          );
          enqueueSync("eja_history", existingEja.id, "UPDATE");
        } else {
          console.log(`[Auto Ijara] EJA record already matches pending amount ৳${pendingAmount}. Skipping EJA write.`);
        }

        // 3. Clear staged pending values from app_config (fallback complete)
        db.runSync("DELETE FROM app_config WHERE key = 'pending_ijara_amount'");
        db.runSync("DELETE FROM app_config WHERE key = 'pending_ijara_date'");
        
        enqueueSync("app_config", "pending_ijara_amount", "DELETE");
        enqueueSync("app_config", "pending_ijara_date", "DELETE");
        
        return true;
      }
    }
    return false;
  } catch (err) {
    console.error("[Auto Ijara] Error in checkAndApplyIjaraRollover:", err.stack || err);
    return false;
  }
}

/**
 * ==========================================
 * SYNC PAUSE/RESUME SYSTEM
 * ==========================================
 * Allows pausing all Firebase sync operations until app is updated.
 * Useful for preventing sync issues during deployment.
 */

/**
 * Check if sync is currently paused
 * @returns {boolean} true if sync is paused
 */
export function isSyncPaused() {
  try {
    const row = db.getFirstSync("SELECT value FROM app_config WHERE key = 'sync_paused'");
    return row && row.value === 'true';
  } catch (e) {
    return false;
  }
}

/**
 * Pause all sync operations
 * @param {string} reason - Why sync is being paused
 */
export function pauseSync(reason = 'Manual pause') {
  try {
    const now = new Date().toISOString();
    db.runSync(
      "INSERT OR REPLACE INTO app_config (id, key, value, created_at, updated_at, is_synced) VALUES (?, 'sync_paused', ?, ?, ?, 0)",
      ['config_sync_paused', 'true', now, now]
    );
    db.runSync(
      "INSERT OR REPLACE INTO app_config (id, key, value, created_at, updated_at, is_synced) VALUES (?, 'sync_paused_reason', ?, ?, ?, 0)",
      ['config_sync_paused_reason', reason, now, now]
    );
    db.runSync(
      "INSERT OR REPLACE INTO app_config (id, key, value, created_at, updated_at, is_synced) VALUES (?, 'sync_paused_at', ?, ?, ?, 0)",
      ['config_sync_paused_at', now, now, now]
    );
    console.log(`[Sync Control] Sync PAUSED: ${reason}`);
    return true;
  } catch (err) {
    console.error("[Sync Control] Failed to pause sync:", err);
    return false;
  }
}

/**
 * Resume all sync operations
 */
export function resumeSync() {
  try {
    db.runSync("DELETE FROM app_config WHERE key IN ('sync_paused', 'sync_paused_reason', 'sync_paused_at')");
    console.log("[Sync Control] Sync RESUMED");
    return true;
  } catch (err) {
    console.error("[Sync Control] Failed to resume sync:", err);
    return false;
  }
}

/**
 * Get sync pause status info
 * @returns {object} { isPaused, reason, pausedAt }
 */
export function getSyncPauseInfo() {
  try {
    const paused = isSyncPaused();
    const reason = db.getFirstSync("SELECT value FROM app_config WHERE key = 'sync_paused_reason'");
    const pausedAt = db.getFirstSync("SELECT value FROM app_config WHERE key = 'sync_paused_at'");
    return {
      isPaused: paused,
      reason: reason?.value || '',
      pausedAt: pausedAt?.value || ''
    };
  } catch (e) {
    return { isPaused: false, reason: '', pausedAt: '' };
  }
}

export function resetDailySubmitLock() {
  try {
    const todayStr = getBusinessDate();

    logDeleteHistory("daily_submit", todayStr, "Deposits");
    logDeleteHistory("daily_summary", todayStr, "Deposits");

    // 1. Delete from daily_submit locally and record deletion
    db.runSync("DELETE FROM daily_submit WHERE date = ?", [todayStr]);
    recordDeletion("daily_submit", todayStr);

    // 2. Delete from daily_summary locally and record deletion
    db.runSync("DELETE FROM daily_summary WHERE date = ?", [todayStr]);
    recordDeletion("daily_summary", todayStr);

    // 3. Unlock orders locally and enqueue Firestore update sync for all today's orders
    const todayOrders = db.getAllSync("SELECT id FROM orders WHERE date(created_at, 'localtime') = ?", [todayStr]);
    todayOrders.forEach(o => {
      if (o.id) {
        db.runSync("UPDATE orders SET locked_at = NULL WHERE id = ?", [String(o.id)]);
        enqueueSync("orders", String(o.id), "UPDATE");
      }
    });

    console.log("[DB] Reset Daily Submit Lock and recorded deletions successfully.");
    return true;
  } catch (err) {
    console.error("[DB] Reset daily submit lock failed:", err);
    return false;
  }
}

export function resetIjaraExpense() {
  try {
    const todayStr = getBusinessDate();
    const now = new Date().toISOString();
    
    const ijaraExpenseId = `exp_${todayStr}_ijara`;
    
    // Reset ijara expense to 0 locally in expenses and normalize to the stable sync id.
    const existingIjaraExpense = db.getFirstSync(
      "SELECT * FROM expenses WHERE id = ? OR (date(created_at, 'localtime') = ? AND category = 'ijara') ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END LIMIT 1",
      [ijaraExpenseId, todayStr, ijaraExpenseId]
    );
    if (existingIjaraExpense) {
      db.runSync(
        "UPDATE expenses SET id = ?, category = 'ijara', amount = 0, updated_at = ?, is_synced = 0 WHERE id = ?",
        [ijaraExpenseId, now, existingIjaraExpense.id]
      );
    } else {
      db.runSync(
        "INSERT OR REPLACE INTO expenses (id, category, amount, note, is_due, given_amount, used_amount, returned_amount, created_at, updated_at, is_synced) VALUES (?, 'ijara', 0, '', 0, 0, 0, 0, ?, ?, 0)",
        [ijaraExpenseId, now, now]
      );
    }
    
    // Enqueue Firestore update sync for expenses
    enqueueSync("expenses", ijaraExpenseId, "UPDATE");
    
    // ALSO reset ijara expense in eja_history table!
    const existingEja = db.getFirstSync("SELECT * FROM eja_history WHERE date = ?", [todayStr]);
    if (existingEja) {
      db.runSync("UPDATE eja_history SET eja_amount = 0, updated_at = ?, is_synced = 0 WHERE date = ?", [now, todayStr]);
      enqueueSync("eja_history", existingEja.id, "UPDATE");
    }
    
    // Recalculate daily summary (which internally enqueues daily_summary sync)
    calculateAndSaveDailySummary(todayStr);
    
    console.log("[DB] Reset Ijara Expense in both expenses and eja_history, and enqueued sync successfully.");
    return true;
  } catch (err) {
    console.error("[DB] Reset ijara expense failed:", err);
    return false;
  }
}


export function deleteCompletedOrder(orderId) {
  try {
    const orderIdStr = String(orderId);
    
    // 0. Log snapshots before deletion
    logDeleteHistory("orders", orderIdStr, "Orders");
    
    // Also log associated records if they exist
    const itemsToLog = db.getAllSync("SELECT id FROM order_items WHERE order_id = ?", [orderIdStr]);  
    itemsToLog.forEach(item => logDeleteHistory("order_items", item.id, "Orders"));
    
    const payToLog = db.getFirstSync("SELECT id FROM payments WHERE order_id = ?", [orderIdStr]);     
    if (payToLog) logDeleteHistory("payments", payToLog.id, "Orders");
    
    const dueToLog = db.getFirstSync("SELECT id FROM due_payments WHERE order_id = ?", [orderIdStr]);
    if (dueToLog) logDeleteHistory("due_payments", dueToLog.id, "Orders");

    // Check if this order is a delivery and delete the corresponding record in deliveries table      
    const ord = db.getFirstSync("SELECT table_id FROM orders WHERE id = ?", [orderIdStr]);
    if (ord && ord.table_id && String(ord.table_id).toLowerCase().includes('delivery')) {
      const delName = String(ord.table_id).trim();
      const del = db.getFirstSync("SELECT id FROM deliveries WHERE customer_name = ?", [delName]);
      if (del && del.id) {
        db.runSync("DELETE FROM deliveries WHERE id = ?", [String(del.id)]);
        recordDeletion("deliveries", String(del.id));
      }
    }
    
    // Find associated IDs for tombstone recording
    const pay = db.getFirstSync("SELECT id FROM payments WHERE order_id = ?", [orderIdStr]);
    const items = db.getAllSync("SELECT id FROM order_items WHERE order_id = ?", [orderIdStr]);
    const due = db.getFirstSync("SELECT id FROM due_payments WHERE order_id = ?", [orderIdStr]);
    
    // Delete from local DB - CHILD RECORDS FIRST
    db.runSync("DELETE FROM order_items WHERE order_id = ?", [orderIdStr]);
    db.runSync("DELETE FROM payments WHERE order_id = ?", [orderIdStr]);
    db.runSync("DELETE FROM due_payments WHERE order_id = ?", [orderIdStr]);
    
    // PARENT RECORD LAST
    db.runSync("DELETE FROM orders WHERE id = ?", [orderIdStr]);
    
    // Record deletion tombstones for Firestore sync
    recordDeletion("orders", orderIdStr);
    
    if (pay && pay.id) {
      recordDeletion("payments", String(pay.id));
    }
    
    if (due && due.id) {
      recordDeletion("due_payments", String(due.id));
    }
    
    if (items && items.length > 0) {
      console.log(`[ORDERITEM-DEBUG] deleteCompletedOrder order=${orderIdStr} → ${items.length} order_items tombstoned (recordDeletion)`);
      items.forEach(item => {
        if (item.id) {
          recordDeletion("order_items", String(item.id));
        }
      });
    }
    
    // Recalculate daily summary
    const now = new Date().toISOString();
    const todayStr = now.substring(0, 10);
    calculateAndSaveDailySummary(todayStr);

    return true;
  } catch (err) {
    console.error("[DB] Failed to delete completed order:", err);
    return false;
  }
}

export function updateCompletedOrder(orderId, updatedItems, newTotal) {
  try {
    const itemsStr = updatedItems.map(i => `${i.name} x${i.qty}`).join(', ');
    const now = new Date().toISOString();
    
    // 1. Update main order
    db.runSync(
      "UPDATE orders SET items = ?, grand_total = ?, subtotal = ?, updated_at = ?, is_synced = 0 WHERE id = ?",
      [itemsStr, newTotal, newTotal, now, String(orderId)]
    );
    enqueueSync("orders", String(orderId), "UPDATE");

    // 2. Update payment
    db.runSync(
      "UPDATE payments SET total_amount = ?, customer_paid = ?, updated_at = ?, is_synced = 0 WHERE order_id = ?",
      [newTotal, newTotal, now, String(orderId)]
    );
    // Find payment ID if possible, but for sync we might just use order_id if payments table allows.
    // Actually payments table has its own 'id'. Let's find it.
    const pay = db.getFirstSync("SELECT id FROM payments WHERE order_id = ?", [String(orderId)]);
    if (pay) {
      enqueueSync("payments", pay.id, "UPDATE");
    }

    // 3. Update order_items (Wipe and recreate). CRITICAL: tombstone the wiped
    // rows FIRST so the pull engines never resurrect them (same class as the
    // delete/resurrect fix) — otherwise old order_items reappear as duplicates.
    const wipedItemIds = db.getAllSync("SELECT id FROM order_items WHERE order_id = ?", [String(orderId)]) || [];
    wipedItemIds.forEach((r) => { if (r && r.id) recordDeletion('order_items', String(r.id)); });
    db.runSync("DELETE FROM order_items WHERE order_id = ?", [String(orderId)]);
    console.log(`[ORDERITEM-DEBUG] updateCompletedOrder WIPE order_items for order=${orderId} (tombstoned ${wipedItemIds.length}) then recreate ${updatedItems.length}`);
    
    updatedItems.forEach((item, index) => {
      const itemId = `${orderId}_item_${index}_rev`;
      db.runSync(`
        INSERT INTO order_items (id, order_id, itemName, quantity, unit_price, revenue, created_at, updated_at, is_synced)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `, [itemId, String(orderId), item.name, item.qty, item.price, item.price * item.qty, now, now]);
      console.log(`[ORDERITEM-DEBUG] updateCompletedOrder INSERT order_items id=${itemId} order=${orderId} item="${item.name}"`);
      enqueueSync("order_items", itemId, "INSERT");
    });

    const todayStr = now.substring(0, 10);
    calculateAndSaveDailySummary(todayStr);
    
    return true;
  } catch (err) {
    console.error("[DB] Failed to update completed order:", err);
    return false;
  }
}

export function verifyPinCode(pin) {
  try {
    const user = db.getFirstSync("SELECT * FROM users WHERE pin = ?", [pin.trim()]);
    return user || null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

export function getAppConfig(key) {
  try {
    const res = db.getFirstSync("SELECT value FROM app_config WHERE key = ?", [key]);
    return res ? res.value : null;
  } catch (err) {
    console.error(`Failed to get app config for key ${key}:`, err);
    return null;
  }
}

export function setAppConfig(key, value) {
  try {
    db.runSync(
      "INSERT OR REPLACE INTO app_config (id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [key, key, value, new Date().toISOString(), new Date().toISOString()]
    );
  } catch (err) {
    console.error(`Failed to set app config for key ${key}:`, err);
  }
}

export function getPendingSyncCount() {
  try {
    const pending = db.getFirstSync("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING' OR status = 'FAILED'");
    return pending?.count || 0;
  } catch (e) {
    return 0;
  }
}

export function getSyncQueueItems(limit = 50) {
  try {
    return db.getAllSync("SELECT * FROM sync_queue ORDER BY id DESC LIMIT ?", [limit]);
  } catch (e) {
    return [];
  }
}

export function inspectFailedSyncQueue(limit = 20) {
  try {
    const firstItems = db.getAllSync(
      "SELECT id as queueId, table_name as collection, record_id as recordId, action, status, retry_count as retryCount, last_error as error, created_at as createdAt, last_attempt_at as lastAttemptAt FROM sync_queue WHERE status = 'PENDING' OR status = 'FAILED' ORDER BY status DESC, id ASC LIMIT ?",
      [limit]
    );
    const oldestFailed = db.getFirstSync(
      "SELECT id as queueId, table_name as collection, record_id as recordId, action, status, retry_count as retryCount, last_error as error, created_at as createdAt, last_attempt_at as lastAttemptAt FROM sync_queue WHERE status = 'FAILED' ORDER BY datetime(created_at) ASC, id ASC LIMIT 1"
    );
    const total = db.getFirstSync(
      "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING' OR status = 'FAILED'"
    );
    console.log(`[Queue Audit] inspectFailedSyncQueue total=${total?.count || 0} first=${JSON.stringify(firstItems)} oldestFailed=${JSON.stringify(oldestFailed || null)}`);
    return {
      total: total?.count || 0,
      firstItems,
      oldestFailed: oldestFailed || null
    };
  } catch (err) {
    console.error("[Queue Audit] Failed to inspect failed sync queue:", err);
    return { total: 0, firstItems: [], oldestFailed: null, error: err.message };
  }
}

// ==========================================
// 0. DATE & BUSINESS DAY HELPERS
// ==========================================

/**
 * Returns the current business date string (YYYY-MM-DD).
 * Business Day starts at 12:00 AM Local Time.
 */
export function getBusinessDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Extracts the business date string from an ISO string (usually UTC).
 * Uses Local Time and 12:00 AM rollover to match getBusinessDate().
 */
export function getBusinessDateFromISO(isoStr) {
  if (!isoStr) return getBusinessDate();
  const d = new Date(isoStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Dhaka wall-clock date helper (Phase 4). Implementation lives in a pure module
// so both the app and the Node test suite can share it; re-exported here for
// discoverability alongside the other business-date helpers.
export { getDhakaCalendarDate } from './services/dhakaTime.js';

export function formatDisplayDate(dateInput) {
  if (!dateInput) return '';
  
  try {
    let date;
    if (dateInput instanceof Date) {
      date = dateInput;
    } else {
      let dateStr = String(dateInput).trim();
      
      // Check if it is already in the format "DD MMM YYYY" (e.g. "30 May 2026")
      const alreadyFormatted = /^\d{2} [A-Za-z]{3} \d{4}$/.test(dateStr);
      if (alreadyFormatted) return dateStr;

      // Handle simple numeric timestamps or standard date strings
      if (/^\d+$/.test(dateStr)) {
        date = new Date(Number(dateStr));
      } else {
        date = new Date(dateStr);
      }
    }

    if (isNaN(date.getTime())) {
      // Fallback: If parsing fails (e.g., dateInput was YYYY-MM-DD or standard SQL date string)
      const parts = String(dateInput).split(/[-/]/);
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          // YYYY-MM-DD
          const year = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1;
          const day = parseInt(parts[2], 10);
          date = new Date(year, month, day);
        } else if (parts[2].length === 4) {
          // DD-MM-YYYY
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1;
          const year = parseInt(parts[2], 10);
          date = new Date(year, month, day);
        }
      }
    }

    if (isNaN(date.getTime())) {
      // Try to parse textual dates manually (e.g. "29 May 2026")
      const textMatch = String(dateInput).match(/^(\d{1,2})\s+([A-Za-z]{3,10})\s+(\d{4})/);
      if (textMatch) {
        const day = parseInt(textMatch[1], 10);
        const monthName = textMatch[2].substring(0, 3).toLowerCase();
        const year = parseInt(textMatch[3], 10);
        const monthsShort = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const monthIndex = monthsShort.indexOf(monthName);
        if (monthIndex !== -1) {
          date = new Date(year, monthIndex, day);
        }
      }
    }

    if (isNaN(date.getTime())) {
      return String(dateInput); // Return raw if parsing failed
    }

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(date.getDate()).padStart(2, '0');
    const monthName = months[date.getMonth()];
    const year = date.getFullYear();

    return `${day} ${monthName} ${year}`;
  } catch (e) {
    return String(dateInput);
  }
}

export function inspectDatabaseStats() {
  const tables = [
    'users',
    'restaurant_tables',
    'menu_categories',
    'menu_items',
    'orders',
    'order_items',
    'payments',
    'expenses',
    'deliveries',
    'daily_submit',
    'daily_summary',
    'due_payments',
    'eja_history',
    'off_days',
    'weather_data',
    'supplier_payment_ledger',
    'delete_history',
    'notifications',
    'owner_employees',
    'owner_salary_ledger',
    'owner_expenses',
    'owner_deposits',
    'owner_home_deposits'
  ];
  
  const stats = {};
  for (const table of tables) {
    try {
      const res = db.getFirstSync(`SELECT COUNT(*) as count FROM ${table}`);
      stats[table] = res ? res.count : 0;
    } catch (e) {
      stats[table] = -1; // -1 indicates error or table doesn't exist
    }
  }
  return {
    stats,
    project_id: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'Configured',
    sheets_url: process.env.EXPO_PUBLIC_GOOGLE_SHEETS_WEBAPP_URL ? 'Configured' : 'Missing',
    sqlite_connected: !!db
  };
}

export function executeInspectorQuery(rawSql, params = []) {
  const normalizedSql = rawSql.trim().toUpperCase();
  const isSelect = normalizedSql.startsWith('SELECT');
  
  const allowedPragmas = [
    'PRAGMA INTEGRITY_CHECK',
    'PRAGMA FOREIGN_KEY_CHECK',
    'PRAGMA FREELIST_COUNT',
    'PRAGMA PAGE_COUNT',
    'PRAGMA QUICK_CHECK'
  ];
  const isAllowedPragma = allowedPragmas.some(pragma => normalizedSql.startsWith(pragma));

  if (!isSelect && !isAllowedPragma) {
    throw new Error('Only SELECT queries are allowed for safety and security.');
  }
  
  try {
    const results = db.getAllSync(rawSql, params);
    return results;
  } catch (e) {
    throw new Error(e.message);
  }
}

/**
 * Admin-only WRITE access to the local SQLite DB (System Tools → Database Explorer).
 * Deliberately narrow: DELETE / UPDATE / INSERT only — no DDL, no ATTACH/PRAGMA.
 * The UI shows a destructive-confirm dialog before calling this. Returns `changes`.
 */
export function executeInspectorWrite(rawSql, params = []) {
  const sql = String(rawSql || '').trim();
  if (!sql) throw new Error('Empty statement.');
  const normalized = sql.toUpperCase();
  const allowed =
    normalized.startsWith('DELETE') ||
    normalized.startsWith('UPDATE') ||
    normalized.startsWith('INSERT');
  if (!allowed) {
    throw new Error('Only DELETE / UPDATE / INSERT are allowed here.');
  }
  if (normalized.includes(';') && sql.indexOf(';') !== sql.length - 1) {
    throw new Error('Run one statement at a time.');
  }
  try {
    const res = db.runSync(sql, params);
    const changes = res && typeof res.changes === 'number' ? res.changes : null;
    console.log(`[InspectorWrite] ${sql.slice(0, 120)} → changes=${changes}`);
    return { success: true, changes };
  } catch (e) {
    throw new Error(e.message);
  }
}

export function getFirebaseUsageStats() {
  const pendingCount = getPendingSyncCount();
  
  // Calculate health
  let syncHealth = 'Good';
  if (lastSyncError !== 'None' && (lastSyncError.includes('429') || lastSyncError.includes('Quota'))) {
    syncHealth = 'Error';
  } else if (lastSyncError !== 'None' || pendingCount > 30) {
    syncHealth = 'Warning';
  }

  // Next sync calculation (based on active daemon interval of 60 seconds)
  let lastSyncTimeStr = '';
  try {
    const latestConf = db.getFirstSync("SELECT value FROM app_config WHERE key LIKE 'last_sync_time_%' ORDER BY value DESC LIMIT 1");
    if (latestConf) {
      lastSyncTimeStr = latestConf.value;
    }
  } catch (e) {}
  
  if (!lastSyncTimeStr) {
    lastSyncTimeStr = new Date(Date.now() - 10000).toISOString();
  }
  
  const lastSyncDate = new Date(lastSyncTimeStr);
  const nextSyncDate = new Date(lastSyncDate.getTime() + 60000);

  // Real-time tracking from internal variables
  const readsToday = firestoreReadsToday;
  const writesToday = firestoreWritesToday;
  const deletesToday = firestoreDeletesToday;

  // Estimate daily/monthly reads & writes (Safety padding + base usage)
  const estDailyReads = Math.max(readsToday * 1.5 + 500, 2000);
  const estDailyWrites = Math.max(writesToday * 1.2 + 100, 500);
  const estDailyDeletes = Math.max(deletesToday * 1.1, 0);

  const estMonthlyReads = estDailyReads * 30;
  const estMonthlyWrites = estDailyWrites * 30;

  // Determine Warning Level Color
  let warningColor = '#34D399'; // Green (Safe)
  if (syncHealth === 'Error' || estDailyReads >= 45000 || estDailyWrites >= 18000) {
    warningColor = '#EF4444'; // Red (Near Limit)
  } else if (estDailyReads >= 5000 || estDailyWrites >= 2000 || pendingCount > 10) {
    warningColor = '#FFB703'; // Yellow (High Usage)
  }

  // Granular next sync calculations
  const getGranularNextSync = (key, intervalMs) => {
    try {
      const row = db.getFirstSync("SELECT value FROM app_config WHERE key = ?", [`last_sync_time_${key}`]);
      if (row && row.value) {
        return formatDisplayTime(new Date(new Date(row.value).getTime() + intervalMs));
      }
    } catch (e) {}
    return formatDisplayTime(new Date(Date.now() + intervalMs));
  };

  const nextDeletionsTime = getGranularNextSync('deletions', 10000);
  const nextTablesTime = getGranularNextSync('restaurant_tables', 15000);
  const nextFullSyncTime = getGranularNextSync('orders', 30000);

  return {
    readsToday: readsToday,
    writesToday: writesToday,
    deletesToday: deletesToday,
    syncUploadsToday: syncUploadsToday,
    syncDownloadsToday: syncDownloadsToday,
    pendingQueueCount: pendingCount,
    lastSyncTime: formatDisplayTime(lastSyncDate),
    nextSyncTime: formatDisplayTime(nextSyncDate),
    nextDeletionsTime,
    nextTablesTime,
    nextFullSyncTime,
    syncHealth: syncHealth,
    estDailyReads: Math.round(estDailyReads),
    estDailyWrites: Math.round(estDailyWrites),
    estDailyDeletes: Math.round(estDailyDeletes),
    estMonthlyReads: Math.round(estMonthlyReads),
    estMonthlyWrites: Math.round(estMonthlyWrites),
    warningColor: warningColor,
    syncInterval: 30,
    pollingInterval: 30,
    firestoreMode: 'Cloud Sync (REST)'
  };
  }

function formatDisplayTime(dateObj) {
  try {
    return dateObj.toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (e) {
    return dateObj.toISOString().substring(11, 19);
  }
}

// ==========================================
// ADMIN CLEANUP TOOL
// ==========================================
export function deleteDataByDate(targetDate) {
  try {
    const now = new Date().toISOString();

    // 0. Log snapshots for history
    try {
      const orders = db.getAllSync("SELECT id FROM orders WHERE date(created_at, 'localtime') = ?", [targetDate]);
      orders.forEach(o => logDeleteHistory("orders", o.id, "Orders"));
      
      const deliveries = db.getAllSync("SELECT id FROM deliveries WHERE date(completed_at, 'localtime') = ?", [targetDate]);
      deliveries.forEach(d => logDeleteHistory("deliveries", d.id, "Others"));
      
      const expenses = db.getAllSync("SELECT id FROM expenses WHERE date(created_at, 'localtime') = ?", [targetDate]);
      expenses.forEach(e => logDeleteHistory("expenses", e.id, "Expenses"));

      logDeleteHistory("daily_submit", targetDate, "Deposits");
      logDeleteHistory("daily_summary", targetDate, "Deposits");
    } catch (e) {
      console.warn("[Admin Tool] Snapshot failed during cleanup:", e);
    }

    // 1. Order Items (CHILD)
    db.runSync("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE date(created_at, 'localtime') = ?)", [targetDate]);

    // 2. Payments (CHILD)
    db.runSync("DELETE FROM payments WHERE date(created_at, 'localtime') = ?", [targetDate]);

    // 3. Due Payments (CHILD)
    db.runSync("DELETE FROM due_payments WHERE date(created_at, 'localtime') = ?", [targetDate]);
    
    // 4. Deliveries
    db.runSync("DELETE FROM deliveries WHERE date(completed_at, 'localtime') = ?", [targetDate]);
    
    // 5. Orders (PARENT)
    db.runSync("DELETE FROM orders WHERE date(created_at, 'localtime') = ?", [targetDate]);
    
    // 6. Expenses
    db.runSync("DELETE FROM expenses WHERE date(created_at, 'localtime') = ?", [targetDate]);
    
    // 7. Daily Submit
    db.runSync("DELETE FROM daily_submit WHERE date = ?", [targetDate]);
    
    // 8. Daily Summary
    db.runSync("DELETE FROM daily_summary WHERE date = ?", [targetDate]);
    
    // Note: To clear sync_queue correctly and prevent it from trying to push deleted things 
    // or pushing these deletions to Firestore, we delete them completely.
    // If we wanted to also delete them from Firestore, we would use recordDeletion() wrapper.
    // Assuming the user just wants the local data gone or it's already a test day:
    db.runSync("DELETE FROM sync_queue WHERE record_id LIKE ?", [`%${targetDate}%`]);

    console.log(`[Admin Tool] Successfully deleted all local data for ${targetDate}`);
    return { success: true };
  } catch (err) {
    console.error("[Admin Tool] Failed to delete data:", err);
    return { success: false, error: err.message };
  }
}

// ==========================================
// 8. TOMBSTONE DELETION AND MANUAL SYNC ENGINE
// ==========================================

export function getDeleteHistory(limit = null) {
  try {
    if (limit) {
      return db.getAllSync("SELECT * FROM delete_history ORDER BY deleted_at DESC LIMIT ?", [limit]);
    }
    return db.getAllSync("SELECT * FROM delete_history ORDER BY deleted_at DESC");
  } catch (err) {
    console.error("[DB] Failed to get delete history:", err);
    return [];
  }
}

export function logDeleteHistory(tableName, recordId, recordType) {
  try {
    const recordIdStr = String(recordId);
    console.log(`[Delete History] Attempting to log snapshot for ${tableName} ID ${recordIdStr}...`);

    // 1. Fetch current record snapshot before it is deleted
    let record = null;
    try {
      record = db.getFirstSync(`SELECT * FROM ${tableName} WHERE id = ?`, [recordIdStr]);
      if (!record) {
        record = db.getFirstSync(`SELECT * FROM ${tableName} WHERE date = ?`, [recordIdStr]);
      }
    } catch (e) {
      try {
        record = db.getFirstSync(`SELECT * FROM ${tableName} WHERE date = ?`, [recordIdStr]);
      } catch (e2) {}
    }

    if (!record) {
      console.warn(`[Delete History] Snapshot failed: Record not found for ${tableName} with ID/Date ${recordIdStr}`);
      return;
    }

    const now = new Date().toISOString();
    const deletedBy = getAppConfig('login_session_user') || 'Unknown';
    
    // Extract metadata from record if available
    const createdBy = record.created_by || record.manager_name || 'System';
    const originalCreatedAt = record.created_at || record.date || now;

    const historyId = `delh_${tableName}_${recordIdStr}_${Date.now()}`;
    
    // 2. Save snapshot to local delete_history table
    db.runSync(
      `INSERT INTO delete_history (
        id, record_type, record_id, deleted_by, deleted_at, 
        created_by, original_created_at, snapshot_data, 
        created_at, updated_at, is_synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        historyId, recordType, recordIdStr, deletedBy, now,
        createdBy, originalCreatedAt, JSON.stringify(record),
        now, now
      ]
    );
    
    // 3. Enqueue for sync push to Firestore
    enqueueSync("delete_history", historyId, "INSERT");
    syncRecordImmediately("delete_history", historyId);
    console.log(`[Delete History] SUCCESSFULLY logged snapshot for ${tableName} (${recordType}) ID ${recordIdStr}`);
  } catch (err) {
    console.error("[Delete History] CRITICAL ERROR logging deletion history:", err);
  }
}

export function recordDeletion(tableName, recordId) {

  try {
    const id = `${tableName}_${recordId}`;
    const now = new Date().toISOString();
    
    // 1. Write the deletion tombstone log locally in SQLite
    db.runSync(
      "INSERT OR REPLACE INTO deletions (id, table_name, record_id, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, 0)",
      [id, tableName, recordId, now, now]
    );
    
    // 2. Enqueue the deletion log row for sync upload to 'deletions' Firestore collection
    enqueueSync("deletions", id, "INSERT");
    
    // 3. Also enqueue a delete sync action for the actual document itself on Firestore
    enqueueSync(tableName, recordId, "DELETE");

    console.log(`[Tombstone] Recorded and enqueued deletion for "${tableName}" ID/Date: ${recordId}`);
    if (tableName === 'menu_items') {
      console.log(`[MENU-DEBUG] tombstone written ("${tableName}","${recordId}") + DELETE enqueued (FB+SB)`);
    }

    // IMMEDIATE PUSH: Do not wait for 60s daemon
    syncRecordImmediately(tableName, recordId);
    syncRecordImmediately("deletions", id);
    } catch (err) {
    console.error("[DB] Failed to record deletion tombstone:", err);
  }
}

export function getRemainingPushes(role) {
  const maxLimit = role === 'manager' ? 1 : 2;
  const today = getBusinessDate();
  const lastPushDate = getAppConfig('last_push_date');
  if (lastPushDate !== today) {
    setAppConfig('last_push_date', today);
    setAppConfig('push_count_today', '0');
    return maxLimit;
  }
  const count = parseInt(getAppConfig('push_count_today') || '0', 10);
  return Math.max(0, maxLimit - count);
}

export function getRemainingPulls(role) {
  const maxLimit = role === 'manager' ? 1 : 2;
  const today = getBusinessDate();
  const lastPullDate = getAppConfig('last_pull_date');
  if (lastPullDate !== today) {
    setAppConfig('last_pull_date', today);
    setAppConfig('pull_count_today', '0');
    return maxLimit;
  }
  const count = parseInt(getAppConfig('pull_count_today') || '0', 10);
  return Math.max(0, maxLimit - count);
}

export function incrementPushCount() {
  const today = getBusinessDate();
  setAppConfig('last_push_date', today);
  const count = parseInt(getAppConfig('push_count_today') || '0', 10);
  setAppConfig('push_count_today', String(count + 1));
}

export function incrementPullCount() {
  const today = getBusinessDate();
  setAppConfig('last_pull_date', today);
  const count = parseInt(getAppConfig('pull_count_today') || '0', 10);
  setAppConfig('pull_count_today', String(count + 1));
}

export function resetPushPullCounts() {
  setAppConfig('push_count_today', '0');
  setAppConfig('pull_count_today', '0');
}

export async function executeManualPush() {
  try {
    console.log("[Manual Push] Scanning all tables for unsynced local changes...");
    const tables = [
      'users', 'restaurant_tables', 'orders', 'order_items', 'payments', 
      'expenses', 'deliveries', 'daily_submit', 'daily_summary', 
      'due_payments', 'eja_history', 'off_days', 'weather_data', 
      'supplier_payment_ledger', 'notifications', 'app_config', 'ai_dataset_history', 'deletions', 'delete_history', 'owner_employees', 'owner_salary_ledger', 'owner_expenses', 'owner_deposits', 'owner_home_deposits'
    ];
    
    let countEnqueued = 0;
    for (const table of tables) {
      try {
        let rows = [];
        if (table === 'daily_submit' || table === 'daily_summary' || table === 'ai_dataset_history') {
          rows = db.getAllSync(`SELECT date FROM ${table} WHERE is_synced = 0`);
          for (const r of rows) {
            enqueueSync(table, r.date, 'INSERT');
            countEnqueued++;
          }
        } else {
          rows = db.getAllSync(`SELECT id FROM ${table} WHERE is_synced = 0`);
          for (const r of rows) {
            enqueueSync(table, r.id, 'INSERT');
            countEnqueued++;
          }
        }
      } catch (e) {
        console.error(`[Manual Push] Failed to scan table "${table}":`, e.message);
      }
    }
    
    console.log(`[Manual Push] Enqueued ${countEnqueued} unsynced records. Starting sync daemon...`);
    
    // Process sync queue completely
    let pending = getPendingSyncCount();
    let iter = 0;
    while (pending > 0 && iter < 10) {
      await processSyncQueue();
      pending = getPendingSyncCount();
      iter++;
    }
    return true;
  } catch (err) {
    console.error("[Manual Push] Push failed:", err);
    return false;
  }
}

export async function executeManualPull() {
  try {
    console.log('[Firebase-Read] executeManualPull triggered');
    console.log("[Manual Pull] Pulling latest updates from Firestore...");
    const highFreqChanged = await syncHighFrequencyCollections();
    const tablesChanged = await syncTablesOnly();
    const lowFreqChanged = await syncLowFrequencyCollections();
    recordAutoSyncEvent('manual-pull', 'success', `highFreqChanged=${highFreqChanged} tablesChanged=${tablesChanged} lowFreqChanged=${lowFreqChanged}`);
    return { success: true, didChange: highFreqChanged || tablesChanged || lowFreqChanged };
  } catch (err) {
    console.error("[Manual Pull] Pull failed:", err);
    recordAutoSyncEvent('manual-pull', 'failure', err.message);
    return { success: false, error: err.message };
  }
}

export function updateSupplierName(supplierId, newName) {
  try {
    const now = new Date().toISOString();
    db.runSync(
      "UPDATE supplier_due SET supplier_name = ?, updated_at = ?, is_synced = 0 WHERE id = ?",
      [newName, now, supplierId]
    );
    enqueueSync("supplier_due", supplierId, "UPDATE");
    return true;
  } catch (err) {
    console.error("Update supplier name error:", err);
    return false;
  }
}

export function getSessionUserRole() {
  try {
    const username = getAppConfig('login_session_user');
    if (!username) return null;
    const user = db.getFirstSync("SELECT role FROM users WHERE username = ?", [username]);
    return user ? user.role : null;
  } catch (e) {
    return null;
  }
}

export function verifyOwnerPin(pin) {
  try {
    const owner = db.getFirstSync("SELECT pin FROM users WHERE role = 'owner'");
    return owner && owner.pin === String(pin).trim();
  } catch (e) {
    return false;
  }
}

export function getMonthlyRestaurantDeposits(monthPrefix) {
  try {
    const result = db.getFirstSync(
      "SELECT SUM(net_deposit) as total FROM daily_submit WHERE date LIKE ?",
      [`${monthPrefix}%`]
    );
    return result ? (result.total || 0) : 0;
  } catch (err) {
    console.error("getMonthlyRestaurantDeposits error:", err);
    return 0;
  }
}

export function getTodayRestaurantDeposit(todayStr) {
  try {
    const record = db.getFirstSync("SELECT net_deposit FROM daily_submit WHERE date = ?", [todayStr]);
    return record ? (record.net_deposit || 0) : 0;
  } catch (err) {
    console.error("getTodayRestaurantDeposit error:", err);
    return 0;
  }
}

// Role priority now lives in the shared module so the Firebase and Supabase
// push paths resolve conflicts identically (Phase 4). Re-exported for compat.
export { getRolePriority };

function getPersistentDeviceId() {
  try {
    const row = db.getFirstSync("SELECT value FROM app_config WHERE key = 'persistent_device_id'");
    return row && row.value ? String(row.value) : '';
  } catch (e) {
    return '';
  }
}

export function saveDailySubmitPriority(businessDate, submittedBy, role, syncSourceDevice = '') {
  try {
    const now = new Date().toISOString();
    const priority = getRolePriority(role);
    const deviceId = getPersistentDeviceId() || syncSourceDevice || Platform.OS;
    db.runSync(`
      INSERT OR REPLACE INTO daily_submit_priority (
        business_date, submitted_by, role, priority, sync_source_device, device_id, submitted_at, created_at, updated_at, is_synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `, [businessDate, submittedBy, role, priority, syncSourceDevice || Platform.OS, deviceId, now, now, now]);
    enqueueSync("daily_submit_priority", businessDate, "INSERT");
    return true;
  } catch (err) {
    console.error("saveDailySubmitPriority error:", err);
    return false;
  }
}

export function getDailySubmitPriority(businessDate) {
  try {
    const row = db.getFirstSync("SELECT * FROM daily_submit_priority WHERE business_date = ?", [businessDate]);
    return row || null;
  } catch (err) {
    console.error("getDailySubmitPriority error:", err);
    return null;
  }
}

export function saveOwnerEmployee(employee) {
  try {
    const now = new Date().toISOString();
    const id = employee.id || `emp_${Date.now()}`;
    db.runSync(
      `INSERT OR REPLACE INTO owner_employees (id, name, phone, designation, monthly_salary, joining_date, status, notes, created_at, updated_at, is_synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [id, employee.name, employee.phone || '', employee.designation || '', employee.monthly_salary, employee.joining_date || '', employee.status || 'ACTIVE', employee.notes || '', employee.created_at || now, now]
    );
    enqueueSync("owner_employees", id, "INSERT");
    syncRecordImmediately("owner_employees", id);
    return id;
  } catch (err) {
    console.error("[DB] saveOwnerEmployee error:", err);
    return null;
  }
}

export function updateOwnerEmployee(employee) {
  try {
    const now = new Date().toISOString();
    db.runSync(
      `UPDATE owner_employees SET name = ?, phone = ?, designation = ?, monthly_salary = ?, joining_date = ?, status = ?, notes = ?, updated_at = ?, is_synced = 0
       WHERE id = ?`,
      [employee.name, employee.phone || '', employee.designation || '', employee.monthly_salary, employee.joining_date || '', employee.status || 'ACTIVE', employee.notes || '', now, employee.id]
    );
    enqueueSync("owner_employees", employee.id, "UPDATE");
    syncRecordImmediately("owner_employees", employee.id);
    return true;
  } catch (err) {
    console.error("[DB] updateOwnerEmployee error:", err);
    return false;
  }
}

export function getOwnerEmployees() {
  try {
    return db.getAllSync("SELECT * FROM owner_employees ORDER BY status ASC, name ASC");
  } catch (err) {
    console.error("[DB] getOwnerEmployees error:", err);
    return [];
  }
}

export function getOwnerEmployeeById(id) {
  try {
    return db.getFirstSync("SELECT * FROM owner_employees WHERE id = ?", [id]) || null;
  } catch (err) {
    console.error("[DB] getOwnerEmployeeById error:", err);
    return null;
  }
}

export function deleteOwnerEmployee(id) {
  try {
    logDeleteHistory("owner_employees", id, "Employees");
    db.runSync("DELETE FROM owner_employees WHERE id = ?", [id]);
    recordDeletion("owner_employees", id);
    syncRecordImmediately("deletions", id);
    syncRecordImmediately("owner_employees", id);
    return true;
  } catch (err) {
    console.error("[DB] deleteOwnerEmployee error:", err);
    return false;
  }
}

export function saveSalaryLedgerEntry(entry) {
  try {
    const now = new Date().toISOString();
    const id = entry.id || `led_${Date.now()}`;
    db.runSync(
      `INSERT OR REPLACE INTO owner_salary_ledger (id, employee_id, amount, payment_type, payment_date, notes, created_at, is_synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [id, entry.employee_id, entry.amount, entry.payment_type, entry.payment_date, entry.notes || '', now]
    );
    enqueueSync("owner_salary_ledger", id, "INSERT");
    syncRecordImmediately("owner_salary_ledger", id);
    return id;
  } catch (err) {
    console.error("[DB] saveSalaryLedgerEntry error:", err);
    return null;
  }
}

export function getEmployeeSalaryLedger(employeeId) {
  try {
    return db.getAllSync(
      "SELECT * FROM owner_salary_ledger WHERE employee_id = ? ORDER BY payment_date DESC, created_at DESC",
      [employeeId]
    );
  } catch (err) {
    console.error("[DB] getEmployeeSalaryLedger error:", err);
    return [];
  }
}

export function deleteSalaryLedgerEntry(id) {
  try {
    logDeleteHistory("owner_salary_ledger", id, "SalaryLedger");
    db.runSync("DELETE FROM owner_salary_ledger WHERE id = ?", [id]);
    recordDeletion("owner_salary_ledger", id);
    return true;
  } catch (err) {
    console.error("[DB] deleteSalaryLedgerEntry error:", err);
    return false;
  }
}

export function getEmployeeMonthlySummary(employeeId, month) {
  try {
    const emp = getOwnerEmployeeById(employeeId);
    if (!emp) return { paid: 0, due: 0 };

    const row = db.getFirstSync(
      `SELECT SUM(amount) as total_paid FROM owner_salary_ledger 
       WHERE employee_id = ? 
         AND payment_type IN ('Advance', 'Salary', 'Bonus') 
         AND payment_date LIKE ?`,
      [employeeId, `${month}%`]
    );

    const paid = row ? (row.total_paid || 0) : 0;
    const due = Math.max(0, emp.monthly_salary - paid);
    return { paid, due };
  } catch (err) {
    console.error("[DB] getEmployeeMonthlySummary error:", err);
    return { paid: 0, due: 0 };
  }
}

export function getLastEmployeePayment(employeeId) {
  try {
    return db.getFirstSync(
      "SELECT * FROM owner_salary_ledger WHERE employee_id = ? ORDER BY payment_date DESC, created_at DESC LIMIT 1",
      [employeeId]
    ) || null;
  } catch (err) {
    console.error("[DB] getLastEmployeePayment error:", err);
    return null;
  }
}

export const DEFAULT_OWNER_EXPENSE_CATEGORIES = [
  { label: '🏠 দোকান ভাড়া', icon: '🏠', isCustom: false },
  { label: '⚡ বিদ্যুৎ বিল', icon: '⚡', isCustom: false },
  { label: '🔥 গ্যাস বিল', icon: '🔥', isCustom: false },
  { label: '🌐 ইন্টারনেট বিল', icon: '🌐', isCustom: false },
  { label: '🛒 বাজার', icon: '🛒', isCustom: false },
  { label: '🔧 মেরামত (Maintenance)', icon: '🔧', isCustom: false },
  { label: '📦 অন্যান্য', icon: '📦', isCustom: false }
];

/**
 * Get all available expense categories (default built-in + Owner-defined custom categories).
 * @returns {Array<{label: string, icon: string, isCustom: boolean}>}
 */
export function getExpenseCategories() {
  try {
    const raw = getAppConfig('owner_custom_expense_categories');
    let custom = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          custom = parsed.map(c => {
            if (typeof c === 'string') {
              return { label: c, icon: '📦', isCustom: true };
            }
            return {
              label: c.label || '',
              icon: c.icon || '📦',
              isCustom: true
            };
          }).filter(c => c.label.trim().length > 0);
        }
      } catch (e) {
        console.error("[DB] Error parsing owner_custom_expense_categories JSON:", e);
      }
    }
    return [...DEFAULT_OWNER_EXPENSE_CATEGORIES, ...custom];
  } catch (err) {
    console.error("[DB] getExpenseCategories error:", err);
    return [...DEFAULT_OWNER_EXPENSE_CATEGORIES];
  }
}

/**
 * Add a new custom expense category.
 * OWNER-ONLY: Strictly rejects admin, manager, guest, or invalid roles.
 * Only saves category metadata to app_config; NEVER creates an owner_expenses transaction.
 */
export function addExpenseCategory(categoryName, userRole) {
  const role = String(userRole || '').trim().toLowerCase();
  if (role !== 'owner') {
    throw new Error(`[Security] Unauthorized: Only Owner can create expense categories. Rejected role: '${userRole}'`);
  }

  const cleaned = String(categoryName || '').trim();
  if (!cleaned) {
    throw new Error("Category name cannot be empty.");
  }

  const allCategories = getExpenseCategories();
  const exists = allCategories.some(c => c.label.trim().toLowerCase() === cleaned.toLowerCase());
  if (exists) {
    return { success: false, message: "Category already exists", exists: true };
  }

  const raw = getAppConfig('owner_custom_expense_categories');
  let custom = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) custom = parsed;
    } catch (e) {}
  }

  const newEntry = { label: cleaned, icon: '📦', isCustom: true };
  const updated = [...custom, newEntry];
  setAppConfig('owner_custom_expense_categories', JSON.stringify(updated));
  enqueueSync('app_config', 'owner_custom_expense_categories', 'INSERT');

  return { success: true, category: newEntry };
}

/**
 * Delete a custom expense category.
 * OWNER-ONLY: Strictly rejects admin, manager, guest, or invalid roles.
 * Deleting a custom category does NOT delete historical owner_expenses records.
 * Default categories cannot be deleted.
 */
export function deleteExpenseCategory(categoryName, userRole) {
  const role = String(userRole || '').trim().toLowerCase();
  if (role !== 'owner') {
    throw new Error(`[Security] Unauthorized: Only Owner can delete expense categories. Rejected role: '${userRole}'`);
  }

  const cleaned = String(categoryName || '').trim();
  if (!cleaned) {
    throw new Error("Category name cannot be empty.");
  }

  // Guard against deleting built-in default categories
  const isDefault = DEFAULT_OWNER_EXPENSE_CATEGORIES.some(c => c.label.trim().toLowerCase() === cleaned.toLowerCase());
  if (isDefault) {
    throw new Error("Default categories cannot be deleted.");
  }

  const raw = getAppConfig('owner_custom_expense_categories');
  let custom = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) custom = parsed;
    } catch (e) {}
  }

  const updated = custom.filter(c => {
    const lbl = typeof c === 'string' ? c : (c.label || '');
    return lbl.trim().toLowerCase() !== cleaned.toLowerCase();
  });

  setAppConfig('owner_custom_expense_categories', JSON.stringify(updated));
  enqueueSync('app_config', 'owner_custom_expense_categories', 'INSERT');

  return { success: true };
}

export function saveOwnerExpense(expense) {
  try {
    const now = new Date().toISOString();
    const id = expense.id || `owexp_${Date.now()}`;
    db.runSync(
      `INSERT OR REPLACE INTO owner_expenses (id, category, amount, expense_date, notes, created_at, updated_at, is_synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [id, expense.category, expense.amount, expense.expense_date, expense.notes || '', expense.created_at || now, now]
    );
    enqueueSync("owner_expenses", id, "INSERT");
    syncRecordImmediately("owner_expenses", id);
    return id;
  } catch (err) {
    console.error("[DB] saveOwnerExpense error:", err);
    return null;
  }
}

export function updateOwnerExpense(expense) {
  try {
    const now = new Date().toISOString();
    db.runSync(
      `UPDATE owner_expenses SET category = ?, amount = ?, expense_date = ?, notes = ?, updated_at = ?, is_synced = 0
       WHERE id = ?`,
      [expense.category, expense.amount, expense.expense_date, expense.notes || '', now, expense.id]
    );
    enqueueSync("owner_expenses", expense.id, "UPDATE");
    syncRecordImmediately("owner_expenses", expense.id);
    return true;
  } catch (err) {
    console.error("[DB] updateOwnerExpense error:", err);
    return false;
  }
}

export function getOwnerExpenses(month = '') {
  try {
    if (month) {
      return db.getAllSync(
        "SELECT * FROM owner_expenses WHERE expense_date LIKE ? ORDER BY expense_date DESC, created_at DESC",
        [`${month}%`]
      );
    } else {
      return db.getAllSync("SELECT * FROM owner_expenses ORDER BY expense_date DESC, created_at DESC");
    }
  } catch (err) {
    console.error("[DB] getOwnerExpenses error:", err);
    return [];
  }
}

export function deleteOwnerExpense(id) {
  try {
    logDeleteHistory("owner_expenses", id, "OwnerExpenses");
    db.runSync("DELETE FROM owner_expenses WHERE id = ?", [id]);
    recordDeletion("owner_expenses", id);
    syncRecordImmediately("deletions", id);
    syncRecordImmediately("owner_expenses", id);
    return true;
  } catch (err) {
    console.error("[DB] deleteOwnerExpense error:", err);
    return false;
  }
}

export function getOwnerExpenseSummary(month) {
  try {
    // 1. Total
    const totalRow = db.getFirstSync(
      "SELECT SUM(amount) as total FROM owner_expenses WHERE expense_date LIKE ?",
      [`${month}%`]
    );
    const total = totalRow ? (totalRow.total || 0) : 0;

    // 2. Rent / Vara
    const rentRow = db.getFirstSync(
      `SELECT SUM(amount) as total FROM owner_expenses 
       WHERE expense_date LIKE ? 
         AND (category LIKE '%ভাড়া%' OR category LIKE '%ভাড়া%' OR category LIKE '%Rent%')`,
      [`${month}%`]
    );
    const rent = rentRow ? (rentRow.total || 0) : 0;

    // 3. Utilities (Electricity, Gas, Internet)
    const utilRow = db.getFirstSync(
      `SELECT SUM(amount) as total FROM owner_expenses 
       WHERE expense_date LIKE ? 
         AND category IN ('⚡ বিদ্যুৎ বিল', '🔥 গ্যাস বিল', '🌐 ইন্টারনেট বিল')`,
      [`${month}%`]
    );
    const utilities = utilRow ? (utilRow.total || 0) : 0;

    // 4. Bazar
    const bazarRow = db.getFirstSync(
      "SELECT SUM(amount) as total FROM owner_expenses WHERE expense_date LIKE ? AND category = '🛒 বাজার'",
      [`${month}%`]
    );
    const bazar = bazarRow ? (bazarRow.total || 0) : 0;

    // 5. Breakdown (Dynamic Group By)
    const breakdown = {};
    const rows = db.getAllSync(
      "SELECT category, SUM(amount) as total FROM owner_expenses WHERE expense_date LIKE ? GROUP BY category",
      [`${month}%`]
    );
    rows.forEach(r => {
      breakdown[r.category] = r.total || 0;
    });

    return { total, rent, utilities, bazar, breakdown };
  } catch (err) {
    console.error("[DB] getOwnerExpenseSummary error:", err);
    return { total: 0, rent: 0, utilities: 0, bazar: 0, breakdown: {} };
  }
}

export function getMonthlyTotalSalaryPaid(month) {
  try {
    const row = db.getFirstSync(
      `SELECT SUM(amount) as total_paid FROM owner_salary_ledger 
       WHERE payment_type IN ('Advance', 'Salary', 'Bonus') 
         AND payment_date LIKE ?`,
      [`${month}%`]
    );
    return row ? (row.total_paid || 0) : 0;
  } catch (err) {
    console.error("[DB] getMonthlyTotalSalaryPaid error:", err);
    return 0;
  }
}

export function saveOwnerDeposit(deposit) {
  try {
    const now = new Date().toISOString();
    const id = deposit.id || `owdep_${Date.now()}`;
    db.runSync(
      `INSERT OR REPLACE INTO owner_deposits (id, month, amount, created_at)
       VALUES (?, ?, ?, ?)`,
      [id, deposit.month, deposit.amount, now]
    );
    enqueueSync("owner_deposits", id, "INSERT");
    syncRecordImmediately("owner_deposits", id);
    return id;
  } catch (err) {
    console.error("[DB] saveOwnerDeposit error:", err);
    return null;
  }
}

export function getTotalOwnerDeposits() {
  try {
    const row = db.getFirstSync("SELECT SUM(amount) as total FROM owner_deposits");
    return row ? (row.total || 0) : 0;
  } catch (err) {
    console.error("[DB] getTotalOwnerDeposits error:", err);
    return 0;
  }
}

export function getOwnerDepositByMonth(month) {
  try {
    return db.getFirstSync("SELECT * FROM owner_deposits WHERE month = ?", [month]) || null;
  } catch (err) {
    console.error("[DB] getOwnerDepositByMonth error:", err);
    return null;
  }
}

export function verifyOwnerOrAdminPin(pin) {
  try {
    const user = db.getFirstSync("SELECT role FROM users WHERE pin = ? AND role IN ('owner', 'admin')", [String(pin).trim()]);
    return user ? user.role : null;
  } catch (e) {
    return null;
  }
}

export function deleteOwnerDepositByMonth(month) {
  try {
    const record = db.getFirstSync("SELECT id FROM owner_deposits WHERE month = ?", [month]);
    if (record) {
      logDeleteHistory("owner_deposits", record.id, "OwnerDeposits");
      db.runSync("DELETE FROM owner_deposits WHERE id = ?", [record.id]);
      recordDeletion("owner_deposits", record.id);
      syncRecordImmediately("deletions", record.id);
      syncRecordImmediately("owner_deposits", record.id);
      return true;
    }
    return false;
  } catch (err) {
    console.error("[DB] deleteOwnerDepositByMonth error:", err);
    return false;
  }
}

export function insertNotification(title, message) {
  try {
    const now = new Date().toISOString();
    const id = `notif_${Date.now()}`;
    db.runSync(
      `INSERT INTO notifications (id, title, message, read, created_at, updated_at, is_synced)
       VALUES (?, ?, ?, 0, ?, ?, 0)`,
      [id, title, message, now, now]
    );
    enqueueSync("notifications", id, "INSERT");
    return id;
  } catch (err) {
    console.error("[DB] insertNotification error:", err);
    return null;
  }
}

// --- OWNER HOME DEPOSIT (বাসায় জমা) FUNCTIONS ---

export function saveHomeDeposit(deposit) {
  try {
    const now = new Date().toISOString();
    const id = deposit.id || `owhdep_${Date.now()}`;
    db.runSync(
      `INSERT OR REPLACE INTO owner_home_deposits (id, amount, deposit_date, notes, created_at, updated_at, is_synced)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [id, deposit.amount, deposit.deposit_date, deposit.notes || '', deposit.created_at || now, now]
    );
    enqueueSync("owner_home_deposits", id, "INSERT");
    syncRecordImmediately("owner_home_deposits", id);
    return id;
  } catch (err) {
    console.error("[DB] saveHomeDeposit error:", err);
    return null;
  }
}

export function updateHomeDeposit(deposit) {
  try {
    const now = new Date().toISOString();
    db.runSync(
      `UPDATE owner_home_deposits SET amount = ?, deposit_date = ?, notes = ?, updated_at = ?, is_synced = 0
       WHERE id = ?`,
      [deposit.amount, deposit.deposit_date, deposit.notes || '', now, deposit.id]
    );
    enqueueSync("owner_home_deposits", deposit.id, "UPDATE");
    syncRecordImmediately("owner_home_deposits", deposit.id);
    return true;
  } catch (err) {
    console.error("[DB] updateHomeDeposit error:", err);
    return false;
  }
}

export function deleteHomeDeposit(id) {
  try {
    logDeleteHistory("owner_home_deposits", id, "HomeDeposits");
    db.runSync("DELETE FROM owner_home_deposits WHERE id = ?", [id]);
    recordDeletion("owner_home_deposits", id);
    syncRecordImmediately("deletions", id);
    syncRecordImmediately("owner_home_deposits", id);
    return true;
  } catch (err) {
    console.error("[DB] deleteHomeDeposit error:", err);
    return false;
  }
}

export function getHomeDeposits(month = '') {
  try {
    if (month) {
      return db.getAllSync(
        "SELECT * FROM owner_home_deposits WHERE deposit_date LIKE ? ORDER BY deposit_date DESC, created_at DESC",
        [`${month}%`]
      );
    } else {
      return db.getAllSync("SELECT * FROM owner_home_deposits ORDER BY deposit_date DESC, created_at DESC");
    }
  } catch (err) {
    console.error("[DB] getHomeDeposits error:", err);
    return [];
  }
}

export function getMonthlyTotalHomeDeposits(month) {
  try {
    const row = db.getFirstSync(
      "SELECT SUM(amount) as total FROM owner_home_deposits WHERE deposit_date LIKE ?",
      [`${month}%`]
    );
    return row ? (row.total || 0) : 0;
  } catch (err) {
    console.error("[DB] getMonthlyTotalHomeDeposits error:", err);
    return 0;
  }
}

// ==========================================
// ACTIVITY LOGS & AUDIT TRAIL FUNCTIONS
// ==========================================

/**
 * On-Demand Cloud Fetch for Activity Logs (Date-Partitioned)
 * Downloads activity logs for a specific business date only when explicitly viewed.
 * Saves fetched records to local SQLite so subsequent views cost 0 reads.
 */
export async function fetchActivityLogsForDate(businessDate) {
  const projectId = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
  const apiKey = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_API_KEY);
  if (!projectId || !apiKey || !businessDate) return { success: false, count: 0 };

  const auth = await getFirestoreAuthHeaders();
  if (!auth.success) {
    console.warn(`[ActivitySync] Cloud fetch skipped: Auth unavailable (${auth.error})`);
    return { success: false, count: 0 };
  }

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;
    const query = {
      structuredQuery: {
        from: [{ collectionId: 'activity_logs' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'business_date' },
            op: 'EQUAL',
            value: { stringValue: businessDate }
          }
        }
      }
    };

    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.headers },
      body: JSON.stringify(query)
    });

    if (res.status === 401) {
      invalidateCurrentToken();
      const retryAuth = await getFirestoreAuthHeaders();
      if (retryAuth.success) {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...retryAuth.headers },
          body: JSON.stringify(query)
        });
      }
    }

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[ActivitySync] Cloud fetch returned status ${res.status}: ${errText}`);
      return { success: false, count: 0 };
    }

    const data = await res.json();
    let count = 0;

    if (Array.isArray(data) && db) {
      for (const item of data) {
        if (!item.document || !item.document.fields) continue;
        const row = fromFirestoreDocument(item.document);
        if (row && row.id) {
          try {
            db.runSync(`
              INSERT OR REPLACE INTO activity_logs (
                id, business_date, timestamp, action_type, action_title,
                description, app_profile, user_role, user_name,
                device_id, device_name, device_model, device_platform,
                metadata, created_at, updated_at, is_synced
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            `, [
              String(row.id),
              String(row.business_date || businessDate),
              String(row.timestamp || row.created_at || new Date().toISOString()),
              String(row.action_type || 'SYSTEM'),
              String(row.action_title || 'Activity'),
              String(row.description || ''),
              String(row.app_profile || 'UNKNOWN'),
              String(row.user_role || ''),
              String(row.user_name || ''),
              String(row.device_id || ''),
              String(row.device_name || ''),
              String(row.device_model || ''),
              String(row.device_platform || ''),
              typeof row.metadata === 'object' ? JSON.stringify(row.metadata) : (row.metadata || ''),
              String(row.created_at || new Date().toISOString()),
              String(row.updated_at || new Date().toISOString())
            ]);
            count++;
          } catch (rowErr) {
            console.error('[ActivitySync] Error caching row:', rowErr);
          }
        }
      }
    }
    syncDownloadsToday += count;
    return { success: true, count };
  } catch (err) {
    console.error('[ActivitySync] Error fetching activity logs:', err);
    return { success: false, error: err.message, count: 0 };
  }
}

/**
 * Retrieve Activity Logs from local SQLite with optional filters
 */
export function getActivityLogsFromDb(businessDate, filters = {}) {
  try {
    if (!db || !businessDate) return [];
    let sql = "SELECT * FROM activity_logs WHERE business_date = ?";
    const params = [businessDate];

    if (filters.appProfile && filters.appProfile !== 'ALL') {
      sql += " AND app_profile = ?";
      params.push(filters.appProfile);
    }
    if (filters.actionType && filters.actionType !== 'ALL') {
      sql += " AND action_type = ?";
      params.push(filters.actionType);
    }
    if (filters.deviceId && filters.deviceId !== 'ALL') {
      sql += " AND device_id = ?";
      params.push(filters.deviceId);
    }

    sql += " ORDER BY timestamp DESC";
    return db.getAllSync(sql, params);
  } catch (err) {
    console.error('[DB] getActivityLogsFromDb error:', err);
    return [];
  }
}

/**
 * Get distinct devices present in activity_logs for filtering
 */
export function getDistinctActivityDevices(businessDate = null) {
  try {
    if (!db) return [];
    if (businessDate) {
      return db.getAllSync(
        "SELECT device_id, MAX(device_name) as device_name, MAX(device_model) as device_model, MAX(app_profile) as app_profile FROM activity_logs WHERE business_date = ? AND device_name IS NOT NULL GROUP BY device_id",
        [businessDate]
      );
    }
    return db.getAllSync(
      "SELECT device_id, MAX(device_name) as device_name, MAX(device_model) as device_model, MAX(app_profile) as app_profile FROM activity_logs WHERE device_name IS NOT NULL GROUP BY device_id"
    );
  } catch (err) {
    console.error('[DB] getDistinctActivityDevices error:', err);
    return [];
  }
}



