/**
 * AI Dataset Sync - Production Data Mapping Documentation & Reference
 * 
 * Target Profile: ADMIN APP ONLY
 * Purpose: Document source table origins, SQL extraction rules, and derivation logic
 * for every field in the ML dataset schemas.
 * 
 * ZERO RUNTIME IMPACT: Pure architecture documentation and mapper references.
 */

export const DAILY_SALES_FIELD_MAPPING = {
  // Field Name <--- Source Origin & Extraction Logic
  dataset_id: {
    sourceTable: 'daily_submit',
    sourceColumn: 'date',
    transformation: 'Stable ID = business_date (e.g. "2026-08-05")'
  },
  business_date: {
    sourceTable: 'daily_submit',
    sourceColumn: 'date',
    fallbackTable: 'daily_summary',
    fallbackColumn: 'date',
    transformation: 'Direct YYYY-MM-DD string'
  },
  calendar_date: {
    sourceTable: 'daily_submit',
    sourceColumn: 'submitted_at',
    transformation: 'substr(submitted_at, 1, 10) or date'
  },
  schema_version: { transformation: 'Fixed string "1.0.0"' },
  dataset_version: { transformation: 'Fixed string "1.0.0"' },
  exported_at: { transformation: 'ISO Timestamp generated at export time' },

  year: {
    sourceTable: 'daily_submit',
    sourceColumn: 'date',
    transformation: "CAST(strftime('%Y', date) AS INTEGER)"
  },
  month: {
    sourceTable: 'daily_submit',
    sourceColumn: 'date',
    transformation: "CAST(strftime('%m', date) AS INTEGER)"
  },
  week_number: {
    sourceTable: 'daily_submit',
    sourceColumn: 'date',
    transformation: 'ISO-8601 Week Number: Week 1 = week containing first Thursday of year. Weeks start Monday. Range 1–53. Formula: nearest-Thursday method.'
  },
  day_of_month: {
    sourceTable: 'daily_submit',
    sourceColumn: 'date',
    transformation: "CAST(strftime('%d', date) AS INTEGER)"
  },
  day_of_week: {
    sourceTable: 'daily_summary',
    sourceColumn: 'dayOfWeek',
    transformation: "Map string or strftime('%w', date) -> 0..6"
  },
  day_name: {
    sourceTable: 'daily_summary',
    sourceColumn: 'dayOfWeek',
    transformation: "Direct string value e.g. 'Friday'"
  },
  is_friday: {
    sourceTable: 'daily_summary',
    sourceColumn: 'isFriday',
    transformation: 'CASE WHEN strftime("%w", date) = "5" THEN 1 ELSE 0 END'
  },
  is_weekend: {
    sourceTable: 'daily_summary',
    sourceColumn: 'dayOfWeek',
    transformation: 'CASE WHEN strftime("%w", date) IN ("5", "6") THEN 1 ELSE 0 END'
  },

  // Calendar & Salary Cycle Features
  is_month_start: { transformation: 'CASE WHEN strftime("%d", date) = "01" THEN 1 ELSE 0 END' },
  is_month_end: { transformation: 'CASE WHEN date = date(date, "start of month", "+1 month", "-1 day") THEN 1 ELSE 0 END' },
  days_until_salary: { transformation: 'CAST(julianday(date(date, "start of month", "+1 month")) - julianday(date) AS INTEGER)' },
  days_after_salary: { transformation: 'CAST(strftime("%d", date) AS INTEGER) - 1' },

  // Weather Features (OPTIONAL - SAFE DEFAULTS)
  temperature: {
    sourceTable: 'weather_data',
    sourceColumn: 'temperature',
    fallbackTable: 'daily_summary',
    fallbackColumn: 'temperature',
    defaultIfMissing: null
  },
  feels_like_temperature: {
    sourceTable: 'weather_data',
    sourceColumn: 'feels_like',
    defaultIfMissing: null
  },
  humidity: {
    sourceTable: 'weather_data',
    sourceColumn: 'humidity',
    fallbackTable: 'daily_summary',
    fallbackColumn: 'humidity',
    defaultIfMissing: null
  },
  rainfall_mm: {
    sourceTable: 'weather_data',
    sourceColumn: 'precipitation',
    defaultIfMissing: null
  },
  weather_condition: {
    sourceTable: 'weather_data',
    sourceColumn: 'condition',
    fallbackTable: 'daily_summary',
    fallbackColumn: 'condition',
    defaultIfMissing: 'UNKNOWN'
  },
  is_rainy: {
    sourceTable: 'weather_data',
    sourceColumn: 'isRainy',
    fallbackTable: 'daily_summary',
    fallbackColumn: 'isRainy',
    defaultIfMissing: 0
  },
  wind_speed: {
    sourceTable: 'weather_data',
    sourceColumn: 'windSpeed',
    fallbackTable: 'daily_summary',
    fallbackColumn: 'windSpeed',
    defaultIfMissing: null
  },

  // Holidays & Festival Classification
  is_holiday: {
    sourceTable: 'daily_summary',
    sourceColumn: 'isHoliday',
    transformation: 'COALESCE(isHoliday, 0)'
  },
  holiday_name: {
    sourceTable: 'daily_summary',
    sourceColumn: 'specialDayNote',
    transformation: 'COALESCE(specialDayNote, "")'
  },
  holiday_source: {
    sourceTable: 'daily_summary',
    sourceColumn: 'specialDayNote',
    transformation: 'CASE WHEN specialDayNote LIKE "%Government%" THEN "government" WHEN specialDayNote LIKE "%Calendar%" THEN "calendar" WHEN specialDayNote IS NOT NULL AND specialDayNote != "" THEN "manual" ELSE "none" END'
  },
  festival_type: {
    sourceTable: 'daily_summary',
    sourceColumn: 'specialDayNote',
    transformation: 'CASE WHEN specialDayNote LIKE "%Eid%" OR specialDayNote LIKE "%Puja%" THEN "Religious" WHEN specialDayNote LIKE "%Independence%" OR specialDayNote LIKE "%Victory%" THEN "National" WHEN specialDayNote IS NOT NULL AND specialDayNote != "" THEN "Local Event" WHEN strftime("%w", date) IN ("5","6") THEN "Weekend" ELSE "None" END'
  },
  is_off_day: {
    sourceTable: 'off_days',
    sourceColumn: 'date',
    transformation: '1 IF exists in off_days table ELSE 0'
  },
  off_day_reason: {
    sourceTable: 'off_days',
    sourceColumn: 'reason',
    transformation: 'COALESCE(off_days.reason, "")'
  },

  // Business Operations & Promotion Features (Placeholders for future operational logs)
  store_open_time: { defaultIfMissing: null },
  store_close_time: { defaultIfMissing: null },
  business_hours: { defaultIfMissing: null },
  promotion_running: { defaultIfMissing: 0 },
  promotion_name: { defaultIfMissing: null },
  promotion_discount: { defaultIfMissing: 0.0 },

  // Financial & Sales Aggregations (RAW DATASET)
  total_orders: {
    sourceTable: 'daily_summary',
    sourceColumn: 'totalOrders',
    transformation: 'COUNT(orders.id) WHERE payment_status = "Paid"'
  },
  total_sales: {
    sourceTable: 'daily_submit',
    sourceColumn: 'total_sell',
    fallbackTable: 'daily_summary',
    fallbackColumn: 'totalSales'
  },
  cash_sales: {
    sourceTable: 'daily_submit',
    sourceColumn: 'cash_payment',
    fallbackTable: 'daily_summary',
    fallbackColumn: 'cashTotal'
  },
  bkash_sales: {
    sourceTable: 'daily_submit',
    sourceColumn: 'bkash_payment',
    fallbackTable: 'daily_summary',
    fallbackColumn: 'bkashTotal'
  },
  nagad_sales: {
    sourceTable: 'daily_submit',
    sourceColumn: 'nagad_payment',
    fallbackTable: 'daily_summary',
    fallbackColumn: 'nagadTotal'
  },
  rocket_sales: {
    sourceTable: 'daily_submit',
    sourceColumn: 'rocket_payment',
    fallbackTable: 'daily_summary',
    fallbackColumn: 'rocketTotal'
  },
  card_sales: {
    sourceTable: 'orders',
    sourceColumn: 'card_amount',
    transformation: 'SUM(card_amount) grouped by business date'
  },
  delivery_sales: {
    sourceTable: 'daily_submit',
    sourceColumn: 'delivery_sell',
    fallbackTable: 'daily_summary',
    fallbackColumn: 'totalDelivery'
  },
  delivery_charge: {
    sourceTable: 'daily_submit',
    sourceColumn: 'delivery_charge',
    fallbackTable: 'daily_summary',
    fallbackColumn: 'total_delivery_charge'
  },
  total_discount: {
    sourceTable: 'daily_summary',
    sourceColumn: 'totalDiscount',
    transformation: 'SUM(orders.discount)'
  },
  net_sales: {
    sourceTable: 'daily_submit',
    sourceColumn: 'total_sell',
    transformation: 'total_sales - total_discount'
  },
  average_order_value: {
    sourceTable: 'daily_summary',
    sourceColumn: 'averageOrderValue',
    transformation: 'total_sales / NULLIF(total_orders, 0)'
  },
  peak_hour: {
    sourceTable: 'daily_summary',
    sourceColumn: 'peakHour',
    transformation: 'Hour interval with maximum order count'
  },

  // Ijara, Expense & Profit
  opening_ijara: {
    sourceTable: 'daily_submit',
    sourceColumn: 'eja',
    fallbackTable: 'eja_history',
    fallbackColumn: 'amount'
  },
  total_expense: {
    sourceTable: 'daily_submit',
    sourceColumn: 'total_expense',
    fallbackTable: 'daily_summary',
    fallbackColumn: 'totalExpense'
  },
  closing_cash: {
    sourceTable: 'daily_submit',
    sourceColumn: 'net_cash'
  },
  owner_deposit: {
    sourceTable: 'daily_submit',
    sourceColumn: 'net_deposit',
    fallbackTable: 'daily_summary',
    fallbackColumn: 'ownerDeposit'
  },
  expense_ratio: {
    sourceTable: 'daily_submit',
    transformation: '(total_expense / NULLIF(total_sell, 0)) * 100'
  },

  // Data Quality & Validation Fields
  is_complete: { transformation: '1 if required fields present, 0 otherwise' },
  is_valid: { transformation: '1 if crossField validation passes, 0 otherwise' },
  is_training_ready: { transformation: '1 ONLY if is_complete == 1 AND is_valid == 1' },
  validation_errors: { transformation: 'JSON array of validation error codes e.g. ["PAYMENT_MISMATCH"]' },

  // Target Placeholders
  target_sales: { transformation: 'NULL placeholder until ML training' }
};

export const ITEM_SALES_FIELD_MAPPING = {
  dataset_id: { transformation: 'Stable ID = business_date + "_" + item_id (e.g. "2026-08-05_item_123")' },
  business_date: { sourceTable: 'orders', sourceColumn: 'created_at', transformation: 'substr(created_at, 1, 10)' },
  item_id: { sourceTable: 'menu_items', sourceColumn: 'id', transformation: 'JOIN ON menu_items.name = order_items.itemName' },
  item_name: { sourceTable: 'order_items', sourceColumn: 'itemName' },
  category_name: { sourceTable: 'menu_items', sourceColumn: 'category', transformation: 'COALESCE(menu_items.category, "Uncategorized")' },
  schema_version: { transformation: 'Fixed string "1.0.0"' },
  dataset_version: { transformation: 'Fixed string "1.0.0"' },
  exported_at: { transformation: 'ISO Timestamp generated at export time' },
  unit_price: { sourceTable: 'order_items', sourceColumn: 'unit_price', fallbackColumn: 'menu_items.price' },
  total_quantity_sold: { sourceTable: 'order_items', sourceColumn: 'quantity', transformation: 'SUM(order_items.quantity)' },
  total_item_revenue: { sourceTable: 'order_items', sourceColumn: 'revenue', transformation: 'SUM(order_items.revenue)' },
  item_rank_today: { transformation: 'DENSE_RANK() OVER (PARTITION BY business_date ORDER BY SUM(quantity) DESC)' },
  item_share_percent: { transformation: '(SUM(quantity) / NULLIF(SUM(SUM(quantity)) OVER (PARTITION BY business_date), 0)) * 100' },
  is_out_of_stock: { defaultIfMissing: null },
  available_quantity: { defaultIfMissing: null },
  day_of_week: { sourceTable: 'daily_summary', sourceColumn: 'dayOfWeek' },
  is_friday: { sourceTable: 'daily_summary', sourceColumn: 'isFriday' },
  is_holiday: { sourceTable: 'daily_summary', sourceColumn: 'isHoliday' },
  is_rainy: { sourceTable: 'daily_summary', sourceColumn: 'isRainy' },
  is_complete: { transformation: '1 if required fields present, 0 otherwise' },
  is_valid: { transformation: '1 if valid' },
  is_training_ready: { transformation: '1 ONLY if is_complete == 1 AND is_valid == 1' },
  validation_errors: { transformation: 'JSON array of validation error codes' },
  target_quantity: { transformation: 'NULL placeholder until ML training' }
};
