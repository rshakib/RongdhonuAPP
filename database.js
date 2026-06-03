import * as SQLite from 'expo-sqlite';
import { AppState } from 'react-native';

let dbInstance = null;

// Firebase Usage Monitor internal tracking variables
let firestoreReadsToday = 0;
let firestoreWritesToday = 0;
let firestoreDeletesToday = 0;
let syncUploadsToday = 0;
let syncDownloadsToday = 0;
function getDb() {
  if (!dbInstance) {
    try {
      dbInstance = SQLite.openDatabaseSync('rongdhonu.db', { useNewConnection: true });
      dbInstance.execSync("PRAGMA foreign_keys = ON;");
      console.log("[DB] Lazily opened native SQLite Database connection successfully with Foreign Key enforcement enabled.");
    } catch (e) {
      console.error("[DB] Critical: Failed to open native SQLite Database connection:", e);
      throw e;
    }
  }
  return dbInstance;
}

const db = new Proxy({}, {
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
  ml_export_history: `
    CREATE TABLE IF NOT EXISTS ml_export_history (
      id TEXT PRIMARY KEY, -- Type_Date_Hour_Item
      date TEXT,
      type TEXT, -- SUMMARY, ITEM_SALES, WEATHER
      exported_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
    );
  `,
  ml_export_queue: `
    CREATE TABLE IF NOT EXISTS ml_export_queue (
      id TEXT PRIMARY KEY, -- Type_Date_Timestamp
      type TEXT, -- SUMMARY, ITEM_SALES, WEATHER
      business_date TEXT,
      payload TEXT, -- JSON payload for the export
      status TEXT DEFAULT 'PENDING',
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
  deletions: `
    CREATE TABLE IF NOT EXISTS deletions (
      id TEXT PRIMARY KEY, -- tableName_recordId
      table_name TEXT,
      record_id TEXT,
      created_at TEXT,
      updated_at TEXT,
      is_synced INTEGER DEFAULT 0
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

    // 1. Create tables
    for (const [tableName, sql] of Object.entries(TABLE_SCHEMAS)) {
      db.execSync(sql);
    }
    migrateSyncQueueDiagnostics();
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
        { id: "owner_shakib", username: "rokib", pin: "1111", role: "owner", display_name: "মালিক (Owner)" },
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
        db.runSync("UPDATE users SET username = 'rokib', pin = '1111' WHERE role = 'owner'");
        db.runSync("UPDATE users SET username = 'm', pin = '1111' WHERE role = 'manager'");
        db.runSync("UPDATE users SET username = 'a', pin = '1323' WHERE role = 'admin'");
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
      const forbiddenTables = ['ml_export_queue', 'ml_export_history', 'weather_timeline_queue'];
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

export function enqueueSync(tableName, recordId, action) {
  try {
    // IGNORE local-only tables to prevent Firestore 403 errors
    const forbiddenTables = ['ml_export_queue', 'ml_export_history', 'weather_timeline_queue'];
    if (forbiddenTables.includes(tableName)) return;

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
  } catch (err) {
    console.error("[DB] Failed to enqueue sync:", err);
  }
}

// Helper to convert SQLite flat row objects into Google Firestore REST payload format
function toFirestoreDocument(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'is_synced') continue; // local only
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
  appState: AppState?.currentState || 'unknown'
};

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
  console.log("[Sync] Starting Background Sync Daemon...");
  registerSyncTimer('queue-push-daemon', 30000, 'processSyncQueue');
  
  syncIntervalId = setInterval(async () => {
    const timerName = 'queue-push-daemon';
    if (AppState && AppState.currentState !== 'active') {
      recordAutoSyncEvent(timerName, 'skipped', `appState=${AppState.currentState}`);
      return;
    }

    let watchdog = null;
    try {
      watchdog = setTimeout(() => {
        recordAutoSyncEvent(timerName, 'hang', 'processSyncQueue has not returned after 25000ms');
      }, 25000);
      const result = await traceSyncOperation(`${timerName}:processSyncQueue`, () => processSyncQueue());
      recordAutoSyncEvent(timerName, 'success', `writes=${result.successfulWrites || 0} failed=${result.failedWrites || 0}`);
    } catch (err) {
      recordAutoSyncEvent(timerName, 'failure', err.message);
    } finally {
      if (watchdog) clearTimeout(watchdog);
    }
  }, 30000); // Check and push changes every 30 seconds
}

export async function processSyncQueue(singleRecordId = null, singleTableName = null) {
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

  try {
    // Check if database instance is active before querying
    if (!db) {
      throw new Error("[Sync] Native SQLite Database reference 'db' is null or undefined.");
    }

    // 1. Fetch items to process
    let pendingItems = [];
    if (singleRecordId && singleTableName) {
      // Immediate mode: process only the requested record if it's in the queue
      pendingItems = db.getAllSync(
        "SELECT * FROM sync_queue WHERE record_id = ? AND table_name = ? AND (status = 'PENDING' OR status = 'FAILED') ORDER BY status DESC, id ASC",
        [String(singleRecordId), singleTableName]
      );
    } else {
      // Batch mode: fetch up to 20 pending or failed items, prioritizing PENDING before FAILED
      const beforeRes = db.getFirstSync(
        "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING' OR status = 'FAILED'"
      );
      beforeCount = beforeRes ? beforeRes.count : 0;

      pendingItems = db.getAllSync(
        "SELECT * FROM sync_queue WHERE status = 'PENDING' ORDER BY id ASC LIMIT 20"
      );

      if (pendingItems.length < 20) {
        const failedCandidates = db.getAllSync(
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
      const oldestFailed = db.getFirstSync(
        "SELECT * FROM sync_queue WHERE status = 'FAILED' ORDER BY datetime(created_at) ASC, id ASC LIMIT 1"
      );
      console.log(`[Queue Audit] First ${pendingItems.length} pending/failed records: ${JSON.stringify(queueSnapshot)}`);
      console.log(`[Queue Audit] Oldest failed queue item: ${JSON.stringify(oldestFailed || null)}`);
    }

    for (const item of pendingItems) {
      const { id: queueId, record_id: recordId, table_name: tableName, action } = item;
      
      if (!queueId) continue;

      // SURGICAL CLEANUP: Remove local-only tables from sync queue (Prevents 403 blocks)
      const forbiddenTables = ['ml_export_queue', 'ml_export_history', 'weather_timeline_queue'];
      if (forbiddenTables.includes(tableName)) {
        console.log(`[Queue Cleanup] Removing forbidden local-only item queueId=${queueId} collection=${tableName}`);
        db.runSync("DELETE FROM sync_queue WHERE id = ?", [Number(queueId)]);
        successfulWrites++;
        continue;
      }

      if (!tableName || !recordId) {
        // Delete invalid/empty sync queue records to clear them from SQLite
        console.log(`[Queue Audit] Removing invalid queue item queueId=${queueId} collection=${tableName || ''} recordId=${recordId || ''} action=${action || ''}`);
        db.runSync("DELETE FROM sync_queue WHERE id = ?", [Number(queueId)]);
        successfulWrites++;
        continue;
      }

      try {
        const attemptAt = new Date().toISOString();
        const currentRetryCount = Number(item.retry_count || 0);
        db.runSync(
          "UPDATE sync_queue SET last_attempt_at = ?, retry_count = ? WHERE id = ?",
          [attemptAt, currentRetryCount + 1, Number(queueId)]
        );
        console.log(`[Queue Audit] Attempt queueId=${queueId} collection=${tableName} recordId=${recordId} action=${action} retry=${currentRetryCount + 1}`);

        const encodedId = encodeURIComponent(recordId);
        if (action === 'DELETE') {
          const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${tableName}/${encodedId}?key=${apiKey}`;
          const res = await fetch(url, { method: 'DELETE' });
          
          if (res.ok || res.status === 404) {
            // Delete record from sync queue upon successful synchronization
            db.runSync("DELETE FROM sync_queue WHERE id = ?", [Number(queueId)]);
            lastSyncError = "None";
            successfulWrites++;
            
            // Track metrics
            firestoreDeletesToday++;
            syncUploadsToday++;
          } else {
            const errText = await res.text();
            lastSyncError = `HTTP ${res.status}: ${errText}`;
            db.runSync(
              "UPDATE sync_queue SET status = 'FAILED', last_error = ? WHERE id = ?",
              [lastSyncError, Number(queueId)]
            );
            console.log(`[Queue Audit] FAIL queueId=${queueId} collection=${tableName} recordId=${recordId} action=${action} retry=${currentRetryCount + 1} error=${lastSyncError}`);
            failedWrites++;
          }
        } else {
          let row = null;
          const rIdStr = String(recordId);
          if (tableName === 'daily_submit' || tableName === 'daily_summary' || tableName === 'ml_export_history') {
            row = db.getFirstSync(`SELECT * FROM ${tableName} WHERE date = ?`, [rIdStr]);
          } else {
            row = db.getFirstSync(`SELECT * FROM ${tableName} WHERE id = ?`, [rIdStr]);
          }

          if (!row) {
            // Record deleted locally before sync; delete it from the queue
            console.log(`[Queue Audit] Missing local row, removing queue item queueId=${queueId} collection=${tableName} recordId=${recordId} action=${action}`);
            db.runSync("DELETE FROM sync_queue WHERE id = ?", [Number(queueId)]);
            successfulWrites++;
            continue;
          }

          const firestoreDoc = toFirestoreDocument(row);
          const targetCollection = tableName === 'deletions' ? 'app_config' : tableName;
          const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${targetCollection}/${encodeURIComponent(rIdStr)}?key=${apiKey}`;
          
          const res = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(firestoreDoc)
          });

          if (res.ok) {
            // Delete record from sync queue upon successful synchronization
            db.runSync("DELETE FROM sync_queue WHERE id = ?", [Number(queueId)]);
            lastSyncError = "None";
            successfulWrites++;
            
            // Track metrics
            firestoreWritesToday++;
            syncUploadsToday++;
            
            if (tableName === 'daily_submit' || tableName === 'daily_summary' || tableName === 'ml_export_history') {
              db.runSync(`UPDATE ${tableName} SET is_synced = 1 WHERE date = ?`, [rIdStr]);
            } else {
              db.runSync(`UPDATE ${tableName} SET is_synced = 1 WHERE id = ?`, [rIdStr]);
            }
          } else {
            const errText = await res.text();
            lastSyncError = `HTTP ${res.status}: ${errText}`;
            db.runSync(
              "UPDATE sync_queue SET status = 'FAILED', last_error = ? WHERE id = ?",
              [lastSyncError, Number(queueId)]
            );
            console.log(`[Queue Audit] FAIL queueId=${queueId} collection=${tableName} recordId=${recordId} action=${action} retry=${currentRetryCount + 1} error=${lastSyncError}`);
            failedWrites++;
          }
        }
      } catch (err) {
        lastSyncError = `Sync Error: ${err.message}`;
        db.runSync(
          "UPDATE sync_queue SET status = 'FAILED', last_error = ? WHERE id = ?",
          [lastSyncError, Number(queueId)]
        );
        console.log(`[Queue Audit] FAIL queueId=${queueId} collection=${tableName} recordId=${recordId} action=${action} retry=${Number(item.retry_count || 0) + 1} error=${lastSyncError}`);
        failedWrites++;
      }
    }

    if (!singleRecordId) {
      const afterRes = db.getFirstSync(
        "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING' OR status = 'FAILED'"
      );
      afterCount = afterRes ? afterRes.count : 0;
    }

  } catch (err) {
    lastSyncError = `Daemon execution error: ${err.message}`;
    console.error("[Sync] Daemon execution error:", err);
  }

  return {
    beforeCount,
    afterCount,
    successfulWrites,
    failedWrites
  };
}

export async function syncRecordImmediately(tableName, recordId) {
  try {
    const result = await processSyncQueue(recordId, tableName);
    return result.successfulWrites > 0;
  } catch (e) {
    return false;
  }
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

async function fetchChangedRecordsFromFirestore(collectionName, lastSyncTime) {
  const projectId = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
  const apiKey = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_API_KEY);
  if (!projectId || !apiKey) return { success: false, documents: [] };

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;
    const query = {
      structuredQuery: {
        from: [{ collectionId: collectionName }],
        where: {
          fieldFilter: {
            field: { fieldPath: "updated_at" },
            op: "GREATER_THAN",
            value: { stringValue: lastSyncTime }
          }
        }
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query)
    });

    if (!res.ok) {
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
async function syncCollections(collectionsList) {
  const projectId = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
  const apiKey = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_API_KEY);
  
  if (!projectId || !apiKey) {
    console.error("[Pull Sync] Critical: Firebase configuration is missing in environment variables.");
    console.log(`[Pull Sync] Runtime Check - ProjectID: ${projectId ? 'Present' : 'MISSING'}, APIKey: ${apiKey ? 'Present' : 'MISSING'}`);
    return false;
  }

  console.log(`[Pull Sync] Starting sync for: ${collectionsList.join(', ')}`);
  let hasChanges = false;

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
      } else {
        // Fetch entire collection on first sync
        console.log(`[Pull Sync] Fetching full collection for "${table}" (first sync)...`);
        fetchResult = await fetchCollection(queryCollection);
      }

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
            if (targetTable === 'daily_submit' || targetTable === 'daily_summary' || targetTable === 'ml_export_history') {
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

        if (shouldUpdate) {
          // If table is deletions, perform local deletion of target record
          if (table === 'deletions') {
            const targetTable = row.table_name;
            const targetId = row.record_id;
            console.log(`[Pull Sync] Remote deletion pulled for table "${targetTable}", record ID/Date "${targetId}"`);
            try {
              if (targetTable === 'daily_submit' || targetTable === 'daily_summary' || targetTable === 'ml_export_history') {
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

          const placeholders = keys.map(() => '?').join(', ');
          const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}, is_synced) VALUES (${placeholders}, 1)`;
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
    return await traceSyncOperation('syncDeletionsOnly', () => syncCollections(['deletions']));
  } catch (err) {
    recordAutoSyncEvent('syncDeletionsOnly', 'failure', err.message);
    return false;
  } finally {
    isPullingSyncDeletions = false;
  }
}

export async function syncMenuOnly() {
  try {
    return await traceSyncOperation('syncMenuOnly', () => syncCollections(['menu_items', 'menu_categories']));
  } catch (err) {
    recordAutoSyncEvent('syncMenuOnly', 'failure', err.message);
    return false;
  }
}

export async function syncTablesOnly() {
  try {
    return await traceSyncOperation('syncTablesOnly', () => syncCollections(['restaurant_tables']));
  } catch (err) {
    recordAutoSyncEvent('syncTablesOnly', 'failure', err.message);
    return false;
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
    // restaurant_tables removed from 60s pool; moved to 15s dedicated pool
    const highFreq = ['orders', 'order_items', 'payments', 'deliveries', 'deletions'];
    hasChanges = await traceSyncOperation('syncHighFrequencyCollections', () => syncCollections(highFreq));
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
    // Menu collections removed from periodic polling to optimize Firestore reads.
    const lowFreq = ['users', 'daily_summary', 'due_payments', 'weather_data', 'off_days', 'app_config', 'expenses', 'eja_history', 'daily_submit', 'supplier_due', 'supplier_due_history'];
    hasChanges = await traceSyncOperation('syncLowFrequencyCollections', () => syncCollections(lowFreq));
  } catch (err) {
    recordAutoSyncEvent('syncLowFrequencyCollections', 'failure', err.message);
    return false;
  } finally {
    isPullingSyncLow = false;
  }
  return hasChanges;
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

async function fetchCollection(collectionName) {
  const projectId = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
  const apiKey = cleanEnvVar(process.env.EXPO_PUBLIC_FIREBASE_API_KEY);
  if (!projectId || !apiKey) return { success: false, documents: [] };

  let allDocuments = [];
  let nextPageToken = "";

  try {
    do {
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionName}?key=${apiKey}&pageSize=300${nextPageToken ? `&pageToken=${nextPageToken}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404) return { success: true, documents: [] }; 
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

export async function restoreDatabaseFromCloud() {
  const tables = [
    'users', 'restaurant_tables', 'menu_categories', 'menu_items', 
    'orders', 'order_items', 'payments', 'expenses', 'deliveries', 'eja_history',
    'daily_summary', 'due_payments', 'off_days', 'app_config', 'daily_submit',
    'supplier_due', 'supplier_due_history'
  ];

  console.log("[Restore] Starting full database restoration from Firestore...");

  for (const table of tables) {
    try {
      console.log(`[Restore] Restoring table: ${table}...`);
      const { success, documents: docs } = await fetchCollection(table);

      if (!success) {
        console.error(`[Restore] Failed to fetch documents for ${table}. Skipping this table.`);
        continue;
      }

      if (docs.length === 0) {
        console.log(`[Restore] No documents found for ${table}.`);
        continue;
      }
      for (const doc of docs) {
        const row = fromFirestoreDocument(doc);
        
        // --- SCHEMA GUARDIAN ---
        let validColumns = [];
        try {
          validColumns = db.getAllSync(`PRAGMA table_info(${table})`).map(c => c.name);
        } catch (err) {
          console.error(`[Restore] Failed to get schema for ${table}:`, err.message);
          continue;
        }

        const filteredRow = {};
        for (const key of Object.keys(row)) {
          if (validColumns.includes(key) && key !== 'is_synced') {
            filteredRow[key] = row[key];
          }
        }

        const keys = Object.keys(filteredRow);
        if (keys.length === 0) continue;

        const placeholders = keys.map(() => '?').join(', ');
        
        // Add is_synced = 1 since it's coming from cloud
        const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}, is_synced) VALUES (${placeholders}, 1)`;
        const values = keys.map(k => filteredRow[k]);
        
        try {
          db.runSync(sql, values);
        } catch (e) {
          console.error(`[Restore] Failed to insert row into ${table}:`, e.message);
          console.log(`[Restore] Faulty SQL: ${sql}`);
        }
      }
      console.log(`[Restore] Successfully restored ${docs.length} records into ${table}.`);
    } catch (err) {
      console.error(`[Restore] Critical error restoring ${table}:`, err);
    }
  }
  
  console.log("[Restore] Database restoration completed.");
}

// Getter for sync error
export function getLastSyncError() {
  return lastSyncError;
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
    
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

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
    const totalExpense = expensesToday.reduce((sum, e) => sum + (e.amount || 0), 0);

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
    await processMLExportQueue();
    
    // 3. Register a timer to run this every 30 minutes (to catch up on hours)
    registerSyncTimer('ml-export-service', 1800000, 'triggerWeatherTimelineService');
  } catch (err) {
    console.error("[ML Export] Service tick failed:", err);
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
  const existing = db.getFirstSync("SELECT id FROM ml_export_queue WHERE id = ?", [queueId]);
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
      INSERT OR REPLACE INTO ml_export_queue (id, type, business_date, payload, status, created_at, updated_at, is_synced)
      VALUES (?, 'WEATHER', ?, ?, 'PENDING', ?, ?, 0)
    `, [queueId, todayStr, JSON.stringify(timelineRow), isoNow, isoNow]);
    
    console.log(`[ML Weather] Captured hourly weather for ${displayTime}`);
    
  } catch (err) {
    console.error("[ML Weather] Capture failed:", err.message);
  }
}

export function enqueueDailyMLExports(dateStr) {
  try {
    const summary = db.getFirstSync("SELECT * FROM daily_summary WHERE date = ?", [dateStr]);
    if (!summary) {
      console.warn(`[ML Export] No summary found for ${dateStr}. Skipping export.`);
      return;
    }

    const now = new Date().toISOString();

    // 1. Enqueue DailySummary
    const summaryPayload = {
      Date: summary.date,
      DayOfWeek: summary.dayOfWeek,
      WeekOfMonth: summary.weekOfMonth,
      IsFriday: summary.isFriday ? "TRUE" : "FALSE",
      IsHoliday: summary.isHoliday ? "TRUE" : "FALSE",
      SpecialDay: summary.specialDayNote || "",
      Temperature: summary.temperature,
      Humidity: summary.humidity,
      WeatherCondition: summary.condition,
      IsRainy: summary.isRainy ? "TRUE" : "FALSE",
      WindSpeed: summary.windSpeed,
      TotalOrders: summary.totalOrders,
      TotalSales: summary.totalSales,
      TotalDiscount: summary.totalDiscount,
      TotalExpense: summary.totalExpense,
      TotalDelivery: summary.totalDelivery,
      AverageOrderValue: summary.averageOrderValue,
      PeakHour: summary.peakHour || "",
      FirstOrderTime: summary.firstOrderTime || "",
      LastOrderTime: summary.lastOrderTime || "",
      CashTotal: summary.cashTotal,
      BkashTotal: summary.bkashTotal,
      NagadTotal: summary.nagadTotal,
      RocketTotal: summary.rocketTotal || 0,
      EjaAmount: summary.ejaAmount,
      NetCash: summary.netCash,
      OwnerDeposit: summary.ownerDeposit
    };

    db.runSync(`
      INSERT OR REPLACE INTO ml_export_queue (id, type, business_date, payload, status, created_at, updated_at, is_synced)
      VALUES (?, 'SUMMARY', ?, ?, 'PENDING', ?, ?, 0)
    `, [`SUMMARY_${dateStr}`, dateStr, JSON.stringify(summaryPayload), now, now]);

    // 2. Enqueue Item Sales (All menu items, aggregated)
    const menuItems = db.getAllSync("SELECT name, category FROM menu_items");
    const sales = db.getAllSync(`
      SELECT itemName, SUM(quantity) as totalQty
      FROM order_items
      WHERE date(created_at, 'localtime') = ?
      GROUP BY itemName
    `, [dateStr]);

    const salesMap = {};
    sales.forEach(s => { salesMap[s.itemName] = s.totalQty; });

    const itemRows = menuItems.map(item => ({
      BusinessDate: dateStr,
      ItemName: item.name,
      Category: item.category,
      QuantitySold: salesMap[item.name] || 0
    }));

    db.runSync(`
      INSERT OR REPLACE INTO ml_export_queue (id, type, business_date, payload, status, created_at, updated_at, is_synced)
      VALUES (?, 'ITEM_SALES', ?, ?, 'PENDING', ?, ?, 0)
    `, [`ITEM_SALES_${dateStr}`, dateStr, JSON.stringify(itemRows), now, now]);

    console.log(`[ML Export] Enqueued exports for ${dateStr}`);
    
    // Process queue immediately to try and export
    processMLExportQueue();
  } catch (err) {
    console.error("[ML Export] Failed to enqueue daily exports:", err);
  }
}

async function processMLExportQueue() {
  const webappUrl = cleanEnvVar(process.env.EXPO_PUBLIC_GOOGLE_SHEETS_WEBAPP_URL);
  if (!webappUrl) return;

  const pending = db.getAllSync("SELECT * FROM ml_export_queue WHERE status = 'PENDING' LIMIT 5");
  if (pending.length === 0) return;

  for (const record of pending) {
    try {
      const payload = JSON.parse(record.payload);
      const body = { spreadsheetName: "Rongdhonu_ML_Dataset" };

      if (record.type === 'SUMMARY') {
        body.sheet1 = "DailySummary";
        body.dailyRow = payload;
      } else if (record.type === 'ITEM_SALES') {
        body.sheet2 = "ItemSales";
        body.itemRows = payload;
      } else if (record.type === 'WEATHER') {
        body.sheet3 = "WeatherTimeline";
        body.timelineRow = payload;
      }

      const res = await fetch(webappUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        const now = new Date().toISOString();
        db.runSync("UPDATE ml_export_queue SET status = 'SUCCESS', updated_at = ?, is_synced = 0 WHERE id = ?", [now, record.id]);
        
        // Mark in history for duplicate prevention audit
        db.runSync(`
          INSERT OR REPLACE INTO ml_export_history (id, date, type, exported_at, created_at, updated_at, is_synced)
          VALUES (?, ?, ?, ?, ?, ?, 0)
        `, [record.id, record.business_date, record.type, now, record.created_at, now]);
        
        console.log(`[ML Export] Successfully exported record: ${record.id}`);
      }
    } catch (err) {
      console.error(`[ML Export] POST failed for ${record.id}:`, err.message);
    }
  }
}

export async function triggerGoogleSheetExportCheck() {
  // Logic migrated to triggerWeatherTimelineService and enqueueDailyMLExports
  // We perform one final check for any PENDING items on start
  processMLExportQueue();
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

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query)
    });

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
    return rows.map(r => ({
      id: r.id,
      name: r.customer_name,
      status: r.status,
      items: JSON.parse(r.items || '[]'),
      startTime: r.startTime || '',
      deliveryCharge: r.delivery_charge || 0,
      changeMoneyGiven: r.change_money_given || 0
    }));
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
    const totalAmount = updatedItems.reduce((sum, item) => sum + (item.price * item.qty), 0);
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
    db.runSync(
      "UPDATE deliveries SET delivery_charge = ?, change_money_given = ?, updated_at = ?, is_synced = 0 WHERE id = ?",
      [delCharge, changeMoney, now, id]
    );
    enqueueSync("deliveries", id, "UPDATE");
  } catch (err) {
    console.error(err);
  }
}

export function removeDelivery(id) {
  try {
    db.runSync("DELETE FROM deliveries WHERE id = ?", [id]);
    recordDeletion("deliveries", id);
  } catch (err) {
    console.error(err);
  }
}

export function getCompletedOrders() {
  try {
    const rows = db.getAllSync("SELECT * FROM orders ORDER BY id DESC");
    return rows.map(r => ({
      id: Number(r.id),
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
        0.0,
        deliveryCharge,
        changeMoneyGiven,
        cashAmt,
        bkashAmt,
        nagadAmt,
        rocketAmt,
        orderRecord.paidAmount,
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
        0.0,
        deliveryCharge,
        changeMoneyGiven,
        cashAmt,
        bkashAmt,
        nagadAmt,
        rocketAmt,
        orderRecord.paidAmount,
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
        UPDATE payments SET total_amount = ?, customer_paid = ?, discount_amount = 0.0, delivery_charge = ?, change_money_given = ?, 
        cash_amount = ?, bkash_amount = ?, nagad_amount = ?, rocket_amount = ?,
        payment_method = ?, payment_status = 'Paid', paid_at = ?, updated_at = ?, is_synced = 0
        WHERE id = ?
      `, [orderRecord.paidAmount, orderRecord.paidAmount, deliveryCharge, changeMoneyGiven, cashAmt, bkashAmt, nagadAmt, rocketAmt, orderRecord.method, nowIso, nowIso, payId]);
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
        orderRecord.paidAmount,
        orderRecord.paidAmount,
        0.0,
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
    db.runSync("DELETE FROM supplier_due_history WHERE id = ?", [historyId]);
    recordDeletion("supplier_due_history", historyId);
    return true;
  } catch (err) {
    console.error("Delete supplier due history error:", err);
    return false;
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
    const dateStr = record.date;
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

export function submitDailySheet(summary, submittedBy, submissionType = 'MANUAL') {
  try {
    const todayStr = summary.bizDate || getBusinessDate();
    const now = new Date().toISOString();
    
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

    db.runSync("UPDATE orders SET locked_at = ? WHERE date(created_at, 'localtime') = ?", [now, todayStr]);

    calculateAndSaveDailySummary(todayStr);

    // --- ML EXPORT TRIGGER ---
    // Enqueue summary and item sales exports after locking the day
    enqueueDailyMLExports(todayStr);

    // --- PENDING NEXT-DAY IJARA ---
    const currentIjara = summary.breakdown?.ijara || 0;
    const nextDayIjara = (summary.sell + currentIjara - summary.expense) - summary.deposit;

    if (nextDayIjara > 0) {
      // Calculate next business date string (Tomorrow)
      const nextD = new Date(Date.now() + 86400000);
      const nY = nextD.getFullYear();
      const nM = String(nextD.getMonth() + 1).padStart(2, '0');
      const nDay = String(nextD.getDate()).padStart(2, '0');
      const nextBizDateStr = `${nY}-${nM}-${nDay}`;

      db.runSync("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)", ['pending_ijara_amount', nextDayIjara.toString()]);
      db.runSync("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)", ['pending_ijara_date', nextBizDateStr]);
      
      // We do not enqueue these because it's purely a local staging table waiting for midnight.
      // Or we CAN enqueue them if we want other devices to know about the pending state, but 
      // since rollover happens locally on whichever device is active, we just enqueue the final result.
      // To ensure multi-device consistency, syncing the app_config state is safe.
      enqueueSync("app_config", "pending_ijara_amount", "UPDATE");
      enqueueSync("app_config", "pending_ijara_date", "UPDATE");
      console.log(`[Auto Ijara] Calculated next_day_ijara = ৳${nextDayIjara} pending for ${nextBizDateStr}`);
    }

    return true;
  } catch (err) {
    console.error("Submit daily sheet error:", err);
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

      // If today is the pending date (or we missed it and it's in the past), apply it.
      if (todayStr >= pendingDateStr) {
        console.log(`[Auto Ijara] Midnight Rollover: Applying ৳${pendingAmount} for ${todayStr}`);
        const now = new Date().toISOString();

        // 1. Set as Current Ijara in expenses
        const stableExpId = `exp_${todayStr}_ijara`;
        db.runSync(
          "INSERT OR REPLACE INTO expenses (id, category, amount, note, is_due, given_amount, used_amount, returned_amount, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, 0)",
          [stableExpId, 'ijara', pendingAmount, 'Auto Carry Forward', now, now]
        );
        enqueueSync("expenses", stableExpId, "INSERT");

        // 2. Set as Current Ijara in eja_history
        const ejaId = `eja_${todayStr}`;
        db.runSync(
          "INSERT OR REPLACE INTO eja_history (id, date, eja_amount, created_at, updated_at, is_synced) VALUES (?, ?, ?, ?, ?, 0)",
          [ejaId, todayStr, pendingAmount, now, now]
        );
        enqueueSync("eja_history", ejaId, "INSERT");

        // 3. Clear pending states so it only runs once
        db.runSync("DELETE FROM app_config WHERE key = 'pending_ijara_amount'");
        db.runSync("DELETE FROM app_config WHERE key = 'pending_ijara_date'");
        
        enqueueSync("app_config", "pending_ijara_amount", "DELETE");
        enqueueSync("app_config", "pending_ijara_date", "DELETE");
        
        return true;
      }
    }
    return false;
    } catch (err) {
    console.error("[Auto Ijara] Rollover check failed:", err);
    return false;
    }
    }

    export function resetDailySubmitLock() {

  try {
    const todayStr = getBusinessDate();
    
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
    
    // Check if this order is a delivery and delete the corresponding record in deliveries table
    const ord = db.getFirstSync("SELECT table_id FROM orders WHERE id = ?", [orderIdStr]);
    if (ord && ord.table_id && ord.table_id.toString().includes('Delivery')) {
      const delName = ord.table_id.trim();
      const del = db.getFirstSync("SELECT id FROM deliveries WHERE customer_name = ?", [delName]);
      if (del && del.id) {
        db.runSync("DELETE FROM deliveries WHERE id = ?", [String(del.id)]);
        recordDeletion("deliveries", String(del.id));
      }
    }
    
    // Find payment ID
    const pay = db.getFirstSync("SELECT id FROM payments WHERE order_id = ?", [orderIdStr]);
    
    // Find order item IDs
    const items = db.getAllSync("SELECT id FROM order_items WHERE order_id = ?", [orderIdStr]);
    
    // Delete from local DB
    db.runSync("DELETE FROM orders WHERE id = ?", [orderIdStr]);
    db.runSync("DELETE FROM order_items WHERE order_id = ?", [orderIdStr]);
    db.runSync("DELETE FROM payments WHERE order_id = ?", [orderIdStr]);
    
    // Record deletion tombstone for main order
    recordDeletion("orders", orderIdStr);
    
    // Record deletion tombstone for payment
    if (pay && pay.id) {
      recordDeletion("payments", String(pay.id));
    }
    
    // Record deletion tombstone for all order items
    if (items && items.length > 0) {
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

    // 3. Update order_items (Wipe and recreate for simplicity)
    db.runSync("DELETE FROM order_items WHERE order_id = ?", [String(orderId)]);
    
    updatedItems.forEach((item, index) => {
      const itemId = `${orderId}_item_${index}_rev`;
      db.runSync(`
        INSERT INTO order_items (id, order_id, itemName, quantity, unit_price, revenue, created_at, updated_at, is_synced)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `, [itemId, String(orderId), item.name, item.qty, item.price, item.price * item.qty, now, now]);
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
    'notifications',
    'app_config',
    'sync_queue'
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
  if (!rawSql.trim().toUpperCase().startsWith('SELECT')) {
    throw new Error('Only SELECT queries are allowed for safety and security.');
  }
  
  try {
    const results = db.getAllSync(rawSql, params);
    return results;
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

    // 1. Orders
    db.runSync("DELETE FROM orders WHERE date(created_at, 'localtime') = ?", [targetDate]);
    
    // 2. Payments
    db.runSync("DELETE FROM payments WHERE date(created_at, 'localtime') = ?", [targetDate]);
    
    // 3. Deliveries
    db.runSync("DELETE FROM deliveries WHERE date(completed_at, 'localtime') = ?", [targetDate]);
    
    // 4. Expenses
    db.runSync("DELETE FROM expenses WHERE date(created_at, 'localtime') = ?", [targetDate]);
    
    // 5. Daily Submit
    db.runSync("DELETE FROM daily_submit WHERE date = ?", [targetDate]);
    
    // 6. Daily Summary
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
      'notifications', 'app_config', 'ml_export_history', 'deletions'
    ];
    
    let countEnqueued = 0;
    for (const table of tables) {
      try {
        let rows = [];
        if (table === 'daily_submit' || table === 'daily_summary' || table === 'ml_export_history') {
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
