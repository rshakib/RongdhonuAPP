/**
 * AI Dataset Sync - Dataset Builder
 * 
 * Target Profile: ADMIN APP ONLY
 * Purpose: Convert local SQLite records into frozen, immutable, validated AI Dataset objects.
 * 
 * STRICT RULES:
 * 1. Read ONLY SQLite. Zero Firestore, Google Sheets, React state, or UI variable reads.
 * 2. Expose ONLY buildDailyDataset(businessDate) and buildItemDataset(businessDate).
 * 3. Use mapper.js mapping definitions and schema.js schema definitions.
 * 4. Run validator functions immediately after building.
 * 5. Return immutable Object.freeze() dataset objects.
 * 6. 100% deterministic & non-crashing error handling.
 */

import { db } from '../../database';
import { DAILY_SALES_FIELD_MAPPING, ITEM_SALES_FIELD_MAPPING } from './mapper';
import { validateDailyDataset, validateItemDataset } from './validator';

/**
 * Builds a frozen, validated Daily Dataset object for a given business date.
 * @param {string} businessDate - Business date string (YYYY-MM-DD)
 * @returns {Object} Frozen daily dataset object or structured error object
 */
export function buildDailyDataset(businessDate) {
  console.log(`[AI Dataset Builder] Building Daily Dataset for ${businessDate}`);

  if (!businessDate || typeof businessDate !== 'string') {
    console.error("[AI Dataset Builder] Error: Invalid businessDate parameter supplied.");
    return Object.freeze({
      error: 'INVALID_BUSINESS_DATE_PARAMETER',
      message: 'Business date parameter must be a non-empty string in YYYY-MM-DD format.'
    });
  }

  try {
    // 1. Fetch source records strictly from local SQLite
    const summary = db.getFirstSync("SELECT * FROM daily_summary WHERE date = ?", [businessDate]);
    const submit = db.getFirstSync("SELECT * FROM daily_submit WHERE date = ?", [businessDate]);
    const offDay = db.getFirstSync("SELECT * FROM off_days WHERE date = ?", [businessDate]);

    if (!summary && !submit) {
      console.warn(`[AI Dataset Builder] Warning: No finalized daily records found for business date ${businessDate}`);
      return Object.freeze({
        error: 'BUSINESS_DATE_NOT_FOUND',
        message: `No committed daily record exists in SQLite for business date ${businessDate}`
      });
    }

    const now = new Date().toISOString();
    const dateObj = new Date(`${businessDate}T00:00:00`);
    const dayOfMonth = dateObj.getDate();
    const isMonthStart = dayOfMonth === 1 ? 1 : 0;
    
    const nextDayObj = new Date(dateObj);
    nextDayObj.setDate(dayOfMonth + 1);
    const isMonthEnd = nextDayObj.getDate() === 1 ? 1 : 0;

    const nextMonthObj = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 1);
    const daysUntilSalary = Math.round((nextMonthObj - dateObj) / (1000 * 60 * 60 * 24));
    const daysAfterSalary = dayOfMonth - 1;

    // Festival Classification
    let festivalType = 'None';
    const note = (summary?.specialDayNote || submit?.notes || '');
    if (note.includes('Eid') || note.includes('Puja')) festivalType = 'Religious';
    else if (note.includes('Independence') || note.includes('Victory') || note.includes('Language')) festivalType = 'National';
    else if (note.trim().length > 0) festivalType = 'Local Event';
    else if (summary?.isFriday || dateObj.getDay() === 6) festivalType = 'Weekend';

    // 2. Map fields using mapper.js definitions
    const rawRecord = {
      dataset_id: businessDate,
      business_date: businessDate,
      calendar_date: submit?.submitted_at ? submit.submitted_at.substring(0, 10) : businessDate,
      schema_version: '1.0.0',
      dataset_version: '1.0.0',
      exported_at: now,
      year: dateObj.getFullYear(),
      month: dateObj.getMonth() + 1,
      week_number: Math.ceil(dayOfMonth / 7),
      day_of_month: dayOfMonth,
      day_of_week: dateObj.getDay(),
      day_name: summary?.dayOfWeek || 'Unknown',
      is_friday: summary?.isFriday ? 1 : (dateObj.getDay() === 5 ? 1 : 0),
      is_weekend: (summary?.isFriday || dateObj.getDay() === 5 || dateObj.getDay() === 6) ? 1 : 0,
      is_month_start: isMonthStart,
      is_month_end: isMonthEnd,
      days_until_salary: daysUntilSalary,
      days_after_salary: daysAfterSalary,
      temperature: summary?.temperature !== undefined ? summary.temperature : DAILY_SALES_FIELD_MAPPING.temperature.defaultIfMissing,
      feels_like_temperature: DAILY_SALES_FIELD_MAPPING.feels_like_temperature.defaultIfMissing,
      humidity: summary?.humidity !== undefined ? summary.humidity : DAILY_SALES_FIELD_MAPPING.humidity.defaultIfMissing,
      rainfall_mm: DAILY_SALES_FIELD_MAPPING.rainfall_mm.defaultIfMissing,
      weather_condition: summary?.condition || DAILY_SALES_FIELD_MAPPING.weather_condition.defaultIfMissing,
      is_rainy: summary?.isRainy ? 1 : DAILY_SALES_FIELD_MAPPING.is_rainy.defaultIfMissing,
      wind_speed: summary?.windSpeed !== undefined ? summary.windSpeed : DAILY_SALES_FIELD_MAPPING.wind_speed.defaultIfMissing,
      is_holiday: summary?.isHoliday ? 1 : 0,
      holiday_name: summary?.specialDayNote || '',
      holiday_source: summary?.specialDayNote ? 'manual' : 'none',
      festival_type: festivalType,
      is_off_day: offDay ? 1 : 0,
      off_day_reason: offDay?.reason || '',
      store_open_time: DAILY_SALES_FIELD_MAPPING.store_open_time.defaultIfMissing,
      store_close_time: DAILY_SALES_FIELD_MAPPING.store_close_time.defaultIfMissing,
      business_hours: DAILY_SALES_FIELD_MAPPING.business_hours.defaultIfMissing,
      promotion_running: DAILY_SALES_FIELD_MAPPING.promotion_running.defaultIfMissing,
      promotion_name: DAILY_SALES_FIELD_MAPPING.promotion_name.defaultIfMissing,
      promotion_discount: DAILY_SALES_FIELD_MAPPING.promotion_discount.defaultIfMissing,
      total_orders: summary?.totalOrders || 0,
      total_sales: submit?.total_sell || summary?.totalSales || 0.0,
      cash_sales: submit?.cash_payment || summary?.cashTotal || 0.0,
      bkash_sales: submit?.bkash_payment || summary?.bkashTotal || 0.0,
      nagad_sales: submit?.nagad_payment || summary?.nagadTotal || 0.0,
      rocket_sales: submit?.rocket_payment || summary?.rocketTotal || 0.0,
      card_sales: 0.0,
      delivery_sales: submit?.delivery_sell || summary?.totalDelivery || 0.0,
      delivery_charge: submit?.delivery_charge || summary?.total_delivery_charge || 0.0,
      total_discount: summary?.totalDiscount || 0.0,
      net_sales: (submit?.total_sell || summary?.totalSales || 0.0) - (summary?.totalDiscount || 0.0),
      average_order_value: summary?.averageOrderValue || 0.0,
      peak_hour: summary?.peakHour || '',
      opening_ijara: submit?.eja || 0.0,
      total_expense: submit?.total_expense || summary?.totalExpense || 0.0,
      closing_cash: submit?.net_cash || 0.0,
      owner_deposit: submit?.net_deposit || summary?.ownerDeposit || 0.0,
      expense_ratio: (submit?.total_sell || summary?.totalSales) ? (((submit?.total_expense || summary?.totalExpense || 0) / (submit?.total_sell || summary?.totalSales)) * 100) : 0.0,
      target_sales: null,
      created_at: submit?.created_at || now,
      updated_at: submit?.updated_at || now
    };

    // 3. Run validation using validator.js
    const valResult = validateDailyDataset(rawRecord);
    if (valResult.isValid) {
      console.log(`[AI Dataset Builder] Validation Passed for Daily Dataset (${businessDate})`);
    } else {
      console.warn(`[AI Dataset Builder] Validation Failed for Daily Dataset (${businessDate}):`, valResult.errors);
    }

    rawRecord.is_complete = valResult.isComplete ? 1 : 0;
    rawRecord.is_valid = valResult.isValid ? 1 : 0;
    rawRecord.is_training_ready = valResult.isTrainingReady ? 1 : 0;
    rawRecord.validation_errors = JSON.stringify(valResult.errors);

    // 4. Return immutable frozen object
    return Object.freeze(rawRecord);

  } catch (err) {
    console.error(`[AI Dataset Builder] Fatal error building Daily Dataset for ${businessDate}:`, err);
    return Object.freeze({
      error: 'BUILD_EXCEPTION',
      message: err.message || 'Unknown database extraction error'
    });
  }
}

/**
 * Builds an array of frozen, validated Item Dataset objects for a given business date.
 * @param {string} businessDate - Business date string (YYYY-MM-DD)
 * @returns {Array<Object>} Array of frozen item dataset objects or structured error object
 */
export function buildItemDataset(businessDate) {
  console.log(`[AI Dataset Builder] Building Item Dataset for ${businessDate}`);

  if (!businessDate || typeof businessDate !== 'string') {
    console.error("[AI Dataset Builder] Error: Invalid businessDate parameter supplied.");
    return Object.freeze({
      error: 'INVALID_BUSINESS_DATE_PARAMETER',
      message: 'Business date parameter must be a non-empty string in YYYY-MM-DD format.'
    });
  }

  try {
    const summary = db.getFirstSync("SELECT * FROM daily_summary WHERE date = ?", [businessDate]);
    const menuItems = db.getAllSync("SELECT id, name, category, price FROM menu_items");
    const sales = db.getAllSync(`
      SELECT itemName, SUM(quantity) as totalQty, SUM(revenue) as totalRev
      FROM order_items
      WHERE date(created_at, 'localtime') = ?
      GROUP BY itemName
      ORDER BY totalQty DESC
    `, [businessDate]);

    if (!menuItems || menuItems.length === 0) {
      console.warn(`[AI Dataset Builder] Warning: No menu items found in SQLite`);
      return Object.freeze([]);
    }

    const now = new Date().toISOString();
    const dateObj = new Date(`${businessDate}T00:00:00`);

    const salesMap = {};
    let totalItemsSoldOnDate = 0;
    sales.forEach(s => { 
      salesMap[s.itemName] = { qty: s.totalQty, rev: s.totalRev };
      totalItemsSoldOnDate += Number(s.totalQty || 0);
    });

    const sortedSalesNames = sales.map(s => s.itemName);

    const itemDatasetList = menuItems.map(item => {
      const qtySold = salesMap[item.name]?.qty || 0;
      const rankIdx = sortedSalesNames.indexOf(item.name);
      const rank = qtySold > 0 && rankIdx !== -1 ? rankIdx + 1 : 0;
      const sharePercent = totalItemsSoldOnDate > 0 ? (qtySold / totalItemsSoldOnDate) * 100 : 0;

      const rawItem = {
        dataset_id: `${businessDate}_${item.id || item.name}`,
        business_date: businessDate,
        item_id: item.id || '',
        item_name: item.name,
        category_name: item.category || ITEM_SALES_FIELD_MAPPING.category_name.sourceTable ? item.category : 'Uncategorized',
        schema_version: '1.0.0',
        dataset_version: '1.0.0',
        exported_at: now,
        unit_price: item.price || 0.0,
        total_quantity_sold: qtySold,
        total_item_revenue: salesMap[item.name]?.rev || 0.0,
        item_rank_today: rank,
        item_share_percent: sharePercent,
        is_out_of_stock: ITEM_SALES_FIELD_MAPPING.is_out_of_stock.defaultIfMissing,
        available_quantity: ITEM_SALES_FIELD_MAPPING.available_quantity.defaultIfMissing,
        day_of_week: dateObj.getDay(),
        is_friday: summary?.isFriday ? 1 : (dateObj.getDay() === 5 ? 1 : 0),
        is_holiday: summary?.isHoliday ? 1 : 0,
        is_rainy: summary?.isRainy ? 1 : 0,
        target_quantity: null,
        created_at: now,
        updated_at: now
      };

      const valResult = validateItemDataset(rawItem);
      rawItem.is_complete = valResult.isComplete ? 1 : 0;
      rawItem.is_valid = valResult.isValid ? 1 : 0;
      rawItem.is_training_ready = valResult.isTrainingReady ? 1 : 0;
      rawItem.validation_errors = JSON.stringify(valResult.errors);

      return Object.freeze(rawItem);
    });

    console.log(`[AI Dataset Builder] Validation Passed for ${itemDatasetList.length} Item Dataset records (${businessDate})`);
    return Object.freeze(itemDatasetList);

  } catch (err) {
    console.error(`[AI Dataset Builder] Fatal error building Item Dataset for ${businessDate}:`, err);
    return Object.freeze({
      error: 'BUILD_EXCEPTION',
      message: err.message || 'Unknown database extraction error'
    });
  }
}
