/**
 * AI Dataset Sync - Production ML Dataset Schema
 * 
 * Target Profile: ADMIN APP ONLY
 * Purpose: Define frozen, production-grade schemas for ML models.
 * Strictly isolated module - zero runtime impact on POS / Daily Submit.
 */

export const DAILY_SALES_DATASET_SCHEMA = {
  tableName: 'daily_sales_dataset',
  description: 'One row per business date containing daily sales, weather, calendar, and financial KPIs.',
  fields: {
    // 1. Dataset Tracking & Primary Keys
    dataset_id: { type: 'TEXT', nullable: false, primaryKey: true, description: 'Stable ID = business_date (e.g. "2026-08-05")' },
    business_date: { type: 'DATE', nullable: false, unique: true, description: 'YYYY-MM-DD Business date string' },
    calendar_date: { type: 'DATE', nullable: false, description: 'YYYY-MM-DD Calendar date string' },
    
    // 2. Schema Metadata & Export Tracking
    schema_version: { type: 'TEXT', nullable: false, defaultValue: '1.0.0', description: 'Schema version' },
    dataset_version: { type: 'TEXT', nullable: false, defaultValue: '1.0.0', description: 'Dataset version' },
    exported_at: { type: 'TIMESTAMP', nullable: true, defaultValue: null, description: 'ISO Timestamp when exported' },

    // 3. Time & Calendar Features
    year: { type: 'INTEGER', nullable: false, derived: true, description: 'YYYY' },
    month: { type: 'INTEGER', nullable: false, derived: true, description: '1-12' },
    week_number: { type: 'INTEGER', nullable: false, derived: true, description: '1-53 Week of year' },
    day_of_month: { type: 'INTEGER', nullable: false, derived: true, description: '1-31' },
    day_of_week: { type: 'INTEGER', nullable: false, description: '0-6 (0=Sunday, 5=Friday)' },
    day_name: { type: 'TEXT', nullable: false, description: 'Sunday..Saturday' },
    is_friday: { type: 'INTEGER', nullable: false, defaultValue: 0, description: '1 if Friday, 0 otherwise' },
    is_weekend: { type: 'INTEGER', nullable: false, defaultValue: 0, description: '1 if Friday or Saturday' },

    // 4. Weather Features (OPTIONAL - Safe Defaults)
    temperature: { type: 'REAL', nullable: true, defaultValue: null, description: 'Degrees Celsius (Optional)' },
    humidity: { type: 'REAL', nullable: true, defaultValue: null, description: 'Percentage 0-100 (Optional)' },
    weather_condition: { type: 'TEXT', nullable: true, defaultValue: 'UNKNOWN', description: 'Clear, Rainy, UNKNOWN' },
    is_rainy: { type: 'INTEGER', nullable: false, defaultValue: 0, description: '1 if rainy, 0 otherwise' },
    wind_speed: { type: 'REAL', nullable: true, defaultValue: null, description: 'km/h (Optional)' },

    // 5. Calendar Events & Holiday Source Tracking
    is_holiday: { type: 'INTEGER', nullable: false, defaultValue: 0, description: '1 if government/religious holiday' },
    holiday_name: { type: 'TEXT', nullable: true, defaultValue: '', description: 'Name of holiday or festival' },
    holiday_source: { type: 'TEXT', nullable: false, defaultValue: 'none', enum: ['government', 'calendar', 'manual', 'none'], description: 'Origin of holiday flag' },
    is_off_day: { type: 'INTEGER', nullable: false, defaultValue: 0, description: '1 if restaurant was closed' },
    off_day_reason: { type: 'TEXT', nullable: true, defaultValue: '', description: 'Reason for closure' },

    // 6. Sales & Order Metrics
    total_orders: { type: 'INTEGER', nullable: false, defaultValue: 0, description: 'Total paid orders count' },
    total_sales: { type: 'REAL', nullable: false, defaultValue: 0.0, description: 'Gross sales (Cash+MFS+Card)' },
    cash_sales: { type: 'REAL', nullable: false, defaultValue: 0.0, description: 'Cash payment total' },
    bkash_sales: { type: 'REAL', nullable: false, defaultValue: 0.0, description: 'bKash MFS payment total' },
    nagad_sales: { type: 'REAL', nullable: false, defaultValue: 0.0, description: 'Nagad MFS payment total' },
    rocket_sales: { type: 'REAL', nullable: false, defaultValue: 0.0, description: 'Rocket MFS payment total' },
    card_sales: { type: 'REAL', nullable: false, defaultValue: 0.0, description: 'Card payment total' },
    delivery_sales: { type: 'REAL', nullable: false, defaultValue: 0.0, description: 'Delivery sales total' },
    delivery_charge: { type: 'REAL', nullable: false, defaultValue: 0.0, description: 'Delivery charges collected' },
    total_discount: { type: 'REAL', nullable: false, defaultValue: 0.0, description: 'Total discounts given' },
    net_sales: { type: 'REAL', nullable: false, derived: true, description: 'total_sales - total_discount' },
    average_order_value: { type: 'REAL', nullable: false, derived: true, description: 'total_sales / total_orders' },
    peak_hour: { type: 'TEXT', nullable: true, defaultValue: '', description: 'Hour with maximum sales (e.g. "14:00")' },

    // 7. Financial & Settlement Metrics
    opening_ijara: { type: 'REAL', nullable: false, defaultValue: 0.0, description: 'Carryover Ijara / Cash in hand' },
    total_expense: { type: 'REAL', nullable: false, defaultValue: 0.0, description: 'Total operational expenses' },
    closing_cash: { type: 'REAL', nullable: false, defaultValue: 0.0, description: 'Net cash remaining' },
    owner_deposit: { type: 'REAL', nullable: false, defaultValue: 0.0, description: 'Net deposit to owner (Profit)' },
    expense_ratio: { type: 'REAL', nullable: false, derived: true, description: '(total_expense / total_sales) * 100' },

    // 8. Time Series Derived Features (Window Aggregations)
    prev_day_sales: { type: 'REAL', nullable: true, derived: true, description: 'Sales on previous business day' },
    prev_week_sales: { type: 'REAL', nullable: true, derived: true, description: 'Sales on same day last week' },
    sales_7day_avg: { type: 'REAL', nullable: true, derived: true, description: '7-day rolling mean sales' },
    sales_30day_avg: { type: 'REAL', nullable: true, derived: true, description: '30-day rolling mean sales' },
    sales_growth_7d: { type: 'REAL', nullable: true, derived: true, description: 'Percentage growth over 7-day avg' },

    // 9. Data Quality & Data Validation Fields
    is_complete: { type: 'INTEGER', nullable: false, defaultValue: 1, description: '1 if all required fields are present' },
    is_valid: { type: 'INTEGER', nullable: false, defaultValue: 1, description: '1 if mathematical validation checks pass' },
    validation_errors: { type: 'TEXT', nullable: true, defaultValue: '[]', description: 'JSON array of validation error codes' },

    // 10. Future ML Target Placeholders
    target_sales: { type: 'REAL', nullable: true, defaultValue: null, description: 'Target sales label for future ML training' },

    // 11. System Timestamps
    created_at: { type: 'TIMESTAMP', nullable: false, description: 'ISO Timestamp of creation' },
    updated_at: { type: 'TIMESTAMP', nullable: false, description: 'ISO Timestamp of last update' }
  }
};

export const ITEM_SALES_DATASET_SCHEMA = {
  tableName: 'item_sales_dataset',
  description: 'One row per menu item per business date capturing quantity, revenue, and category demand.',
  fields: {
    // 1. Dataset Tracking & Primary Keys
    dataset_id: { type: 'TEXT', nullable: false, primaryKey: true, description: 'Stable ID = business_date + "_" + item_id' },
    business_date: { type: 'DATE', nullable: false, description: 'YYYY-MM-DD Business date' },
    item_id: { type: 'TEXT', nullable: false, description: 'Menu item ID' },
    item_name: { type: 'TEXT', nullable: false, description: 'Exact menu item name' },
    category_name: { type: 'TEXT', nullable: false, defaultValue: 'Uncategorized', description: 'Item category' },

    // 2. Schema Metadata & Export Tracking
    schema_version: { type: 'TEXT', nullable: false, defaultValue: '1.0.0', description: 'Schema version' },
    dataset_version: { type: 'TEXT', nullable: false, defaultValue: '1.0.0', description: 'Dataset version' },
    exported_at: { type: 'TIMESTAMP', nullable: true, defaultValue: null, description: 'ISO Timestamp when exported' },

    // 3. Pricing & Sales Quantities
    unit_price: { type: 'REAL', nullable: false, defaultValue: 0.0, description: 'Unit selling price' },
    total_quantity_sold: { type: 'INTEGER', nullable: false, defaultValue: 0, description: 'Quantity sold on date' },
    total_item_revenue: { type: 'REAL', nullable: false, defaultValue: 0.0, description: 'Total revenue generated by item' },

    // 4. Contextual Factors
    day_of_week: { type: 'INTEGER', nullable: false, description: '0-6' },
    is_friday: { type: 'INTEGER', nullable: false, defaultValue: 0, description: '1 if Friday' },
    is_holiday: { type: 'INTEGER', nullable: false, defaultValue: 0, description: '1 if holiday' },
    is_rainy: { type: 'INTEGER', nullable: false, defaultValue: 0, description: '1 if rainy' },

    // 5. Time Series Item Demand Metrics
    item_prev_week_qty: { type: 'INTEGER', nullable: true, derived: true, description: 'Quantity sold on same day last week' },
    item_7day_avg_qty: { type: 'REAL', nullable: true, derived: true, description: '7-day rolling avg quantity' },
    item_30day_avg_qty: { type: 'REAL', nullable: true, derived: true, description: '30-day rolling avg quantity' },

    // 6. Data Quality & Validation Fields
    is_complete: { type: 'INTEGER', nullable: false, defaultValue: 1, description: '1 if complete' },
    is_valid: { type: 'INTEGER', nullable: false, defaultValue: 1, description: '1 if valid' },
    validation_errors: { type: 'TEXT', nullable: true, defaultValue: '[]', description: 'JSON array of validation error codes' },

    // 7. Future ML Target Placeholders
    target_quantity: { type: 'INTEGER', nullable: true, defaultValue: null, description: 'Target quantity label for ML training' },

    // 8. Metadata
    created_at: { type: 'TIMESTAMP', nullable: false, description: 'ISO Timestamp' },
    updated_at: { type: 'TIMESTAMP', nullable: false, description: 'ISO Timestamp' }
  }
};
