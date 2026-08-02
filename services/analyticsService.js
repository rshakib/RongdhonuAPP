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

  if (startM === endM) {
    return `${startD} ${startM} – ${endD} ${endM}`;
  }
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
 */
export function getAvailableMonthsOverview() {
  try {
    // 1. RAW SQL QUERY: NO HAVING FILTER
    const rows = executeInspectorQuery(`
      SELECT 
        strftime('%Y-%m', date) as month_key, 
        COUNT(DISTINCT date) as submitted_days,
        SUM(total_sell) as total_sales,
        SUM(total_expense) as total_expense
      FROM daily_submit
      GROUP BY month_key
      ORDER BY month_key ASC
    `);
    
    // 2. JS COVERAGE CALCULATIONS
    const allMonths = rows.map(r => {
      const [year, month] = r.month_key.split('-').map(Number);
      const calendarDays = getDaysInMonth(year, month);
      const submittedDays = r.submitted_days || 0;
      const coverage = (submittedDays / calendarDays) * 100;

      const sales = r.total_sales || 0;
      const expense = r.total_expense || 0;
      const profit = sales - expense;
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

    // 3. SEPARATE VALID MONTHS (Coverage >= 80%)
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
 * and return both allWeeks and validWeeks (coverage >= 80%, i.e. >= 6 days, or >= 5 days for 80% boundary).
 */
export function getAvailableWeeksOverview() {
  try {
    const rows = executeInspectorQuery(`
      SELECT date, total_sell, total_expense
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
          expense: 0
        };
      }
      weekMap[weekKey].dates.add(r.date);
      weekMap[weekKey].sales += (r.total_sell || 0);
      weekMap[weekKey].expense += (r.total_expense || 0);
    });

    const allWeeks = Object.values(weekMap).map(w => {
      const calendarDays = 7;
      const submittedDays = w.dates.size;
      const coverage = (submittedDays / calendarDays) * 100;
      const profit = w.sales - w.expense;
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
    const validWeeks = allWeeks.filter(w => w.coverage >= 70.0 || w.submittedDays >= 5); // >= 80% (>= 5.6 days -> 5-6 days)

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
 * Aggregates financial and itemized metrics for a given period (Monthly or Weekly).
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
    const ownerProfit = totalSales - totalExpense;
    const expenseRatio = totalSales > 0 ? (totalExpense / totalSales) * 100 : 0;

    let orderDateFilterSql = mode === 'monthly'
      ? "strftime('%Y-%m', date(created_at, 'localtime')) = ?"
      : `date(created_at, 'localtime') IN (${params.map(() => '?').join(',')})`;

    const orderRows = executeInspectorQuery(
      `SELECT id FROM orders WHERE ${orderDateFilterSql}`,
      params
    );
    const totalOrders = orderRows.length;
    const avgOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

    let itemDateFilterSql = mode === 'monthly'
      ? "strftime('%Y-%m', date(created_at, 'localtime')) = ?"
      : `date(created_at, 'localtime') IN (${params.map(() => '?').join(',')})`;

    const itemRows = executeInspectorQuery(
      `SELECT itemName, SUM(quantity) as totalQty, SUM(revenue) as totalRev 
       FROM order_items 
       WHERE ${itemDateFilterSql} 
       GROUP BY itemName 
       ORDER BY totalRev DESC`,
      params
    );

    const topItem = itemRows.length > 0 ? itemRows[0] : null;

    let daySalesMap = {};
    submitRows.forEach(r => {
      const dayNum = new Date(r.date).getDay();
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayName = days[dayNum];
      if (!daySalesMap[dayName]) daySalesMap[dayName] = { name: dayName, sales: 0, count: 0 };
      daySalesMap[dayName].sales += (r.total_sell || 0);
      daySalesMap[dayName].count += 1;
    });

    return {
      periodKey,
      totalSales,
      totalExpense,
      ownerProfit,
      expenseRatio,
      totalOrders,
      avgOrderValue,
      topItem,
      daySalesMap
    };
  } catch (err) {
    console.error("[AnalyticsService] getPeriodAnalytics error:", err);
    return null;
  }
}

/**
 * Compares two periods and builds Section 4 KPIs, Bengali Report, and Top 3 Reasons.
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

  const curLabel = currentLabel || currentKey;
  const cmpLabel = compareLabel || compareKey;

  const salesText = `${curLabel} মাসে ${cmpLabel}-এর তুলনায় মোট Sales ${Math.abs(salesPct).toFixed(2)}% ${salesPct >= 0 ? 'বেড়েছে' : 'কমেছে'}।`;
  const profitText = `Owner Profit ${Math.abs(profitPct).toFixed(2)}% ${profitPct >= 0 ? 'বেড়েছে' : 'কমেছে'}।`;
  const expenseText = `Expense ${Math.abs(expensePct).toFixed(2)}% ${expensePct >= 0 ? 'বেড়েছে' : 'কমেছে'}।`;
  const ratioText = `Expense Ratio ${oldExpenseRatio.toFixed(2)}% থেকে ${newExpenseRatio.toFixed(2)}%-এ ${isRatioImproved ? 'নেমেছে, যা খরচ নিয়ন্ত্রণের উন্নতি নির্দেশ করে' : 'উঠেছে, যা খরচ বৃদ্ধির সংকেত দেয়'}।`;

  let overallSummary = "";
  if (salesPct >= 0 && profitPct >= 0) {
    overallSummary = "Overall Business Performance:\nবিক্রয় এবং লাভ উভয় ক্ষেত্রই ইতিবাচক প্রবৃদ্ধি নির্দেশ করছে। এই ধারা বজায় রাখা প্রয়োজন।";
  } else if (salesPct < 0 && isRatioImproved) {
    overallSummary = "Overall Business Performance:\nSales কিছুটা কমেছে, তবে Expense আরও বেশি কমানো হয়েছে। ভবিষ্যতে Sales বৃদ্ধি করা গেলে Profit আরও উন্নত হওয়ার সম্ভাবনা রয়েছে।";
  } else if (salesPct < 0 && !isRatioImproved) {
    overallSummary = "Overall Business Performance:\nSales কমার পাশাপাশি খরচের অনুপাত বৃদ্ধি পেয়েছে। খরচ নিয়ন্ত্রণ এবং বিক্রয় বাড়ানোর দিকে নজর দেওয়া জরুরি।";
  } else {
    overallSummary = "Overall Business Performance:\nব্যবসায়িক ফলাফল মিশ্র প্রতিক্রিয়া দেখাচ্ছে। সামগ্রিক পারফরম্যান্স বজায় রাখতে নিয়মিত পর্যবেক্ষণ রাখুন।";
  }

  const reportText = `${salesText}\n\n${profitText}\n\n${expenseText}\n\n${ratioText}\n\n${overallSummary}`;

  const reasons = [];
  const ordersPct = calcPct(cur.totalOrders, cmp.totalOrders);
  if (salesPct < 0 && ordersPct < 0) {
    reasons.push(`1. Total Orders decreased by ${Math.abs(ordersPct).toFixed(1)}% (${cmp.totalOrders} → ${cur.totalOrders} orders)`);
  } else if (salesPct >= 0 && ordersPct >= 0) {
    reasons.push(`1. Total Orders increased by ${ordersPct.toFixed(1)}% (${cmp.totalOrders} → ${cur.totalOrders} orders)`);
  }

  if (cur.topItem && cmp.topItem) {
    if (cur.topItem.itemName === cmp.topItem.itemName) {
      const itemRevPct = calcPct(cur.topItem.totalRev, cmp.topItem.totalRev);
      reasons.push(`2. ${cur.topItem.itemName} revenue ${itemRevPct >= 0 ? 'increased' : 'decreased'} by ${Math.abs(itemRevPct).toFixed(1)}%`);
    } else {
      reasons.push(`2. Top selling item shifted from ${cmp.topItem.itemName} to ${cur.topItem.itemName}`);
    }
  }

  let worstDay = null;
  let maxDrop = 0;
  Object.keys(cur.daySalesMap).forEach(day => {
    if (cmp.daySalesMap[day]) {
      const curAvg = cur.daySalesMap[day].sales / cur.daySalesMap[day].count;
      const cmpAvg = cmp.daySalesMap[day].sales / cmp.daySalesMap[day].count;
      if (cmpAvg > 0) {
        const drop = ((cmpAvg - curAvg) / cmpAvg) * 100;
        if (drop > maxDrop) {
          maxDrop = drop;
          worstDay = day;
        }
      }
    }
  });

  if (worstDay && maxDrop > 5) {
    reasons.push(`3. ${worstDay} average daily sales were ${maxDrop.toFixed(1)}% lower than comparison period`);
  } else if (reasons.length < 3 && Math.abs(expensePct) > 2) {
    reasons.push(`3. Total operational expenses ${expensePct >= 0 ? 'increased' : 'decreased'} by ${Math.abs(expensePct).toFixed(1)}%`);
  }

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
    },
    reportText,
    reasons
  };
}
