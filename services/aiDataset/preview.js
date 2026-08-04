/**
 * AI Dataset Preview Tool
 *
 * Target Profile: ADMIN APP ONLY — Developer/QA use only.
 * Purpose: Inspect fully-built dataset objects for debugging, verification, and QA.
 *
 * STRICT RULES:
 * 1. Read-only. No writes. No mutations.
 * 2. SQLite ONLY. Zero Firestore, Google Sheets, React state.
 * 3. No queue operations. No Google Sheets transport.
 * 4. No export history written.
 * 5. Developer/QA tool ONLY — never called from POS workflow.
 */

import { buildDailyDataset, buildItemDataset } from './builder';

/**
 * Generates a read-only dataset preview for inspection and debugging.
 *
 * @param {string} businessDate - Business date string (YYYY-MM-DD)
 * @returns {Object} Frozen preview object containing dailyDataset and itemDatasets
 *
 * @example
 * const preview = generateDatasetPreview('2026-08-05');
 * console.log(preview.dailyDataset.total_sales);
 * console.log(preview.itemDatasets.length);
 * console.log(preview.summary);
 */
export function generateDatasetPreview(businessDate) {
  console.log(`[AI Dataset Preview] Generating preview for ${businessDate}`);

  if (!businessDate || typeof businessDate !== 'string') {
    return Object.freeze({
      error: 'INVALID_BUSINESS_DATE_PARAMETER',
      message: 'businessDate must be a non-empty YYYY-MM-DD string.',
      dailyDataset: null,
      itemDatasets: [],
      summary: null,
    });
  }

  // ── Build Daily Dataset ──────────────────────────────────────────────
  const dailyDataset = buildDailyDataset(businessDate);

  // ── Build Item Datasets ──────────────────────────────────────────────
  const itemDatasets = buildItemDataset(businessDate);

  // ── Handle build errors ──────────────────────────────────────────────
  if (dailyDataset.error) {
    return Object.freeze({
      error: dailyDataset.error,
      message: dailyDataset.message,
      businessDate,
      dailyDataset: null,
      itemDatasets: [],
      summary: null,
    });
  }

  const itemArray = Array.isArray(itemDatasets) ? itemDatasets : [];

  // ── Build Summary Metadata ───────────────────────────────────────────
  const topSellers = itemArray
    .filter(i => i.item_rank_today > 0)
    .sort((a, b) => a.item_rank_today - b.item_rank_today)
    .slice(0, 5)
    .map(i => ({
      rank: i.item_rank_today,
      name: i.item_name,
      qty: i.total_quantity_sold,
      revenue: i.total_item_revenue,
      share: i.item_share_percent.toFixed(2) + '%',
    }));

  const summary = Object.freeze({
    businessDate,
    isoWeekNumber:      dailyDataset.week_number,
    dayName:            dailyDataset.day_name,
    isFriday:           dailyDataset.is_friday === 1,
    isHoliday:          dailyDataset.is_holiday === 1,
    isOffDay:           dailyDataset.is_off_day === 1,
    festivalType:       dailyDataset.festival_type,
    totalSales:         dailyDataset.total_sales,
    totalOrders:        dailyDataset.total_orders,
    netSales:           dailyDataset.net_sales,
    totalExpense:       dailyDataset.total_expense,
    expenseRatio:       dailyDataset.expense_ratio.toFixed(2) + '%',
    ownerDeposit:       dailyDataset.owner_deposit,
    openingIjara:       dailyDataset.opening_ijara,
    weatherCondition:   dailyDataset.weather_condition,
    temperature:        dailyDataset.temperature,
    totalMenuItems:     itemArray.length,
    totalItemsSold:     itemArray.filter(i => i.total_quantity_sold > 0).length,
    topSellers,
    isTrainingReady:    dailyDataset.is_training_ready === 1,
    isValid:            dailyDataset.is_valid === 1,
    validationErrors:   JSON.parse(dailyDataset.validation_errors || '[]'),
    schemaVersion:      dailyDataset.schema_version,
    previewGeneratedAt: new Date().toISOString(),
  });

  console.log(`[AI Dataset Preview] Preview ready for ${businessDate}:`);
  console.log(`  totalSales=${dailyDataset.total_sales}  orders=${dailyDataset.total_orders}  items=${itemArray.length}  trainingReady=${summary.isTrainingReady}`);

  return Object.freeze({
    businessDate,
    dailyDataset,
    itemDatasets: itemArray,
    summary,
  });
}

/**
 * Prints a human-readable formatted preview to the console.
 * For developer inspection only.
 *
 * @param {string} businessDate - Business date string (YYYY-MM-DD)
 */
export function printDatasetPreview(businessDate) {
  const preview = generateDatasetPreview(businessDate);

  if (preview.error) {
    console.log('\n[AI Dataset Preview] ERROR:', preview.error, '-', preview.message);
    return;
  }

  const s = preview.summary;
  console.log('\n════════════════════════════════════════════════════════');
  console.log('  AI DATASET PREVIEW — ' + businessDate);
  console.log('════════════════════════════════════════════════════════');
  console.log('  Day:           ' + s.dayName + (s.isFriday ? ' (Friday)' : ''));
  console.log('  ISO Week:      ' + s.isoWeekNumber);
  console.log('  Festival:      ' + s.festivalType);
  console.log('  Holiday:       ' + (s.isHoliday ? 'Yes' : 'No') + (s.isOffDay ? ' (OFF DAY)' : ''));
  console.log('  Weather:       ' + s.weatherCondition + (s.temperature !== null ? ' ' + s.temperature + '°C' : ''));
  console.log('────────────────────────────────────────────────────────');
  console.log('  Total Sales:   ৳' + s.totalSales.toLocaleString());
  console.log('  Net Sales:     ৳' + s.netSales.toLocaleString());
  console.log('  Total Orders:  ' + s.totalOrders);
  console.log('  Total Expense: ৳' + s.totalExpense.toLocaleString() + ' (' + s.expenseRatio + ')');
  console.log('  Owner Deposit: ৳' + s.ownerDeposit.toLocaleString());
  console.log('  Opening Ijara: ৳' + s.openingIjara.toLocaleString());
  console.log('────────────────────────────────────────────────────────');
  console.log('  Menu Items:    ' + s.totalMenuItems + ' total  |  ' + s.totalItemsSold + ' sold today');
  if (s.topSellers.length > 0) {
    console.log('  Top Sellers:');
    s.topSellers.forEach(function(item) {
      console.log('    #' + item.rank + ' ' + item.name + ' — qty=' + item.qty + '  rev=৳' + item.revenue + '  share=' + item.share);
    });
  }
  console.log('────────────────────────────────────────────────────────');
  console.log('  Training Ready:  ' + (s.isTrainingReady ? 'YES' : 'NO'));
  console.log('  Valid:           ' + (s.isValid ? 'YES' : 'NO'));
  if (s.validationErrors.length > 0) {
    console.log('  Validation Errors: ' + s.validationErrors.join(', '));
  }
  console.log('  Schema Version:  ' + s.schemaVersion);
  console.log('  Preview At:      ' + s.previewGeneratedAt);
  console.log('════════════════════════════════════════════════════════\n');
}
