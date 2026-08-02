import { executeInspectorQuery } from '../database';

/**
 * Helper to calculate calendar days in a month.
 */
function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * Helper to get date range label for an ISO week (e.g. "01 Jul – 07 Jul").
 */
function getISOWeekDateRangeLabel(year, week) {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay();
  const ISOweekStart = simple;
  if (dow <= 4) {
    ISOweekStart.setUTCDate(simple.getUTCDate() - simple.getUTCDay() + 1);
  } else {
    ISOweekStart.setUTCDate(simple.getUTCDate() + 8 - simple.getUTCDay());
  }

  const ISOweekEnd = new Date(ISOweekStart);
  ISOweekEnd.setUTCDate(ISOweekStart.getUTCDate() + 6);

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  const startD = String(ISOweekStart.getUTCDate()).padStart(2, '0');
  const startM = months[ISOweekStart.getUTCMonth()];
  
  const endD = String(ISOweekEnd.getUTCDate()).padStart(2, '0');
  const endM = months[ISOweekEnd.getUTCMonth()];

  return `${startD} ${startM} – ${endD} ${endM}`;
}

/**
 * Helper to get year and ISO week number (1-53) for a YYYY-MM-DD date string.
 */
function getYearAndWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1, d));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
  return { year: target.getUTCFullYear(), week: weekNo };
}

/**
 * Helper to format month key YYYY-MM into display label (e.g. "July 2026")
 */
function formatMonthLabel(monthKey) {
  if (!monthKey) return '';
  const [y, m] = monthKey.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${y}`;
}

function formatMonthShortLabel(monthKey) {
  if (!monthKey) return '';
  const [, m] = monthKey.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]}`;
}

/**
 * Fetch ALL months from daily_submit without SQL filtering, compute JS coverage %,
 * and return both allMonths and validMonths (coverage >= 80%).
 * 
 * OFFICIAL BUSINESS RULE:
 * Sales = SUM(daily_submit.total_sell)
 * Expense = SUM(daily_submit.total_expense)
 * Owner Profit = SUM(daily_submit.net_deposit) (Source of Truth)
 * Expense Ratio = (Total Expense / Total Sales) * 100
 */
export function getAvailableMonthsOverview() {
  try {
    const rows = executeInspectorQuery(`
      SELECT 
        strftime('%Y-%m', date) as month_key, 
        COUNT(DISTINCT date) as submitted_days,
        SUM(total_sell) as total_sales,
        SUM(total_expense) as total_expense,
        SUM(net_deposit) as total_deposit
      FROM daily_submit
      GROUP BY month_key
      ORDER BY month_key ASC
    `);
    
    const allMonths = rows.map(r => {
      const [year, month] = r.month_key.split('-').map(Number);
      const calendarDays = getDaysInMonth(year, month);
      const submittedDays = r.submitted_days || 0;
      const coverage = (submittedDays / calendarDays) * 100;

      const sales = r.total_sales || 0;
      const expense = r.total_expense || 0;
      const profit = r.total_deposit || 0; // OFFICIAL BUSINESS RULE: Owner Profit = Net Deposit
      const ratio = sales > 0 ? (expense / sales) * 100 : 0;

      return {
        key: r.month_key,
        label: formatMonthLabel(r.month_key),
        shortLabel: formatMonthShortLabel(r.month_key),
        calendarDays,
        submittedDays,
        coverage,
        sales,
        expense,
        profit,
        ratio
      };
    });

    const validMonths = allMonths.filter(m => m.coverage >= 80.0);

    return {
      allMonths,
      validMonths
    };
  } catch (err) {
    console.error("[AnalyticsService] getAvailableMonthsOverview error:", err);
    return { allMonths: [], validMonths: [] };
  }
}

/**
 * Fetch ALL weeks from daily_submit, compute JS coverage % (out of 7 days),
 * and return both allWeeks and validWeeks (coverage >= 80%).
 * 
 * OFFICIAL BUSINESS RULE:
 * Owner Profit = SUM(daily_submit.net_deposit)
 */
export function getAvailableWeeksOverview() {
  try {
    const rows = executeInspectorQuery(`
      SELECT date, total_sell, total_expense, net_deposit
      FROM daily_submit
      ORDER BY date ASC
    `);

    const weekMap = {};
    rows.forEach(r => {
      if (!r.date) return;
      const { year, week } = getYearAndWeek(r.date);
      const weekKey = `${year}-W${String(week).padStart(2, '0')}`;
      if (!weekMap[weekKey]) {
        const dateRangeLabel = getISOWeekDateRangeLabel(year, week);
        weekMap[weekKey] = {
          key: weekKey,
          year,
          week,
          shortLabel: dateRangeLabel,
          label: `${dateRangeLabel} (${year})`,
          dates: new Set(),
          sales: 0,
          expense: 0,
          deposit: 0
        };
      }
      weekMap[weekKey].dates.add(r.date);
      weekMap[weekKey].sales += (r.total_sell || 0);
      weekMap[weekKey].expense += (r.total_expense || 0);
      weekMap[weekKey].deposit += (r.net_deposit || 0);
    });

    const allWeeks = Object.values(weekMap).map(w => {
      const calendarDays = 7;
      const submittedDays = w.dates.size;
      const coverage = (submittedDays / calendarDays) * 100;
      const profit = w.deposit; // OFFICIAL BUSINESS RULE: Owner Profit = Net Deposit
      const ratio = w.sales > 0 ? (w.expense / w.sales) * 100 : 0;

      return {
        key: w.key,
        label: w.label,
        shortLabel: w.shortLabel,
        calendarDays,
        submittedDays,
        coverage,
        sales: w.sales,
        expense: w.expense,
        profit,
        ratio
      };
    });

    allWeeks.sort((a, b) => a.key.localeCompare(b.key));
    const validWeeks = allWeeks.filter(w => w.coverage >= 70.0 || w.submittedDays >= 5);

    return {
      allWeeks,
      validWeeks
    };
  } catch (err) {
    console.error("[AnalyticsService] getAvailableWeeksOverview error:", err);
    return { allWeeks: [], validWeeks: [] };
  }
}

/**
 * Aggregates financial metrics for a given period (Monthly or Weekly).
 * 
 * OFFICIAL BUSINESS RULE:
 * Sales = SUM(total_sell)
 * Expense = SUM(total_expense)
 * Owner Profit = SUM(net_deposit)
 */
export function getPeriodAnalytics(mode, periodKey) {
  try {
    if (!periodKey) return null;

    let dateFilterSql = "";
    const params = [];

    if (mode === 'monthly') {
      dateFilterSql = "strftime('%Y-%m', date) = ?";
      params.push(periodKey);
    } else {
      const [yearStr, weekStr] = periodKey.split('-W');
      const year = parseInt(yearStr, 10);
      const week = parseInt(weekStr, 10);

      const allSubmits = executeInspectorQuery("SELECT date FROM daily_submit");
      const matchingDates = allSubmits
        .filter(r => {
          if (!r.date) return false;
          const yw = getYearAndWeek(r.date);
          return yw.year === year && yw.week === week;
        })
        .map(r => r.date);

      if (matchingDates.length === 0) return null;

      const placeholders = matchingDates.map(() => '?').join(',');
      dateFilterSql = `date IN (${placeholders})`;
      params.push(...matchingDates);
    }

    const submitRows = executeInspectorQuery(
      `SELECT date, total_sell, total_expense, net_cash, net_deposit FROM daily_submit WHERE ${dateFilterSql} ORDER BY date ASC`,
      params
    );

    const totalSales = submitRows.reduce((sum, r) => sum + (r.total_sell || 0), 0);
    const totalExpense = submitRows.reduce((sum, r) => sum + (r.total_expense || 0), 0);
    const ownerProfit = submitRows.reduce((sum, r) => sum + (r.net_deposit || 0), 0); // OFFICIAL BUSINESS RULE: Owner Profit = Net Deposit
    const expenseRatio = totalSales > 0 ? (totalExpense / totalSales) * 100 : 0;

    return {
      periodKey,
      totalSales,
      totalExpense,
      ownerProfit,
      expenseRatio
    };
  } catch (err) {
    console.error("[AnalyticsService] getPeriodAnalytics error:", err);
    return null;
  }
}

/**
 * Compares two periods and builds Section 4 KPIs.
 */
export function buildAnalyticsComparison(mode, currentKey, compareKey, currentLabel, compareLabel) {
  if (!currentKey || !compareKey || currentKey === compareKey) return null;

  const cur = getPeriodAnalytics(mode, currentKey);
  const cmp = getPeriodAnalytics(mode, compareKey);

  if (!cur || !cmp) return null;

  const calcPct = (c, p) => p > 0 ? ((c - p) / p) * 100 : 0;

  const salesPct = calcPct(cur.totalSales, cmp.totalSales);
  const profitPct = calcPct(cur.ownerProfit, cmp.ownerProfit);
  const expensePct = calcPct(cur.totalExpense, cmp.totalExpense);

  const oldExpenseRatio = cmp.expenseRatio;
  const newExpenseRatio = cur.expenseRatio;
  const isRatioImproved = newExpenseRatio <= oldExpenseRatio;

  return {
    currentData: cur,
    compareData: cmp,
    kpis: {
      salesPct,
      profitPct,
      expensePct,
      oldExpenseRatio,
      newExpenseRatio,
      isRatioImproved
    }
  };
}
