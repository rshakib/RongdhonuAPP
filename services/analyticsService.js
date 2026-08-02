import { executeInspectorQuery } from '../database';

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
 * Fetch available months with at least 80% valid submitted business days (>= 22 days per month)
 * including full overview totals.
 */
export function getAvailableMonthsOverview() {
  try {
    const rows = executeInspectorQuery(`
      SELECT 
        strftime('%Y-%m', date) as month_key, 
        COUNT(DISTINCT date) as day_count,
        SUM(total_sell) as total_sales,
        SUM(total_expense) as total_expense
      FROM daily_submit
      GROUP BY month_key
      HAVING day_count >= 22
      ORDER BY month_key ASC
    `);
    
    return rows.map(r => {
      const sales = r.total_sales || 0;
      const expense = r.total_expense || 0;
      const profit = sales - expense;
      const ratio = sales > 0 ? (expense / sales) * 100 : 0;

      return {
        key: r.month_key,
        label: formatMonthLabel(r.month_key),
        shortLabel: formatMonthShortLabel(r.month_key),
        count: r.day_count,
        sales,
        expense,
        profit,
        ratio
      };
    });
  } catch (err) {
    console.error("[AnalyticsService] getAvailableMonthsOverview error:", err);
    return [];
  }
}

/**
 * Fetch available weeks with at least 80% valid submitted business days (>= 5 days per week)
 * including full overview totals.
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
        weekMap[weekKey] = {
          key: weekKey,
          year,
          week,
          shortLabel: `W${week}`,
          label: `Week ${week} (${year})`,
          dates: new Set(),
          sales: 0,
          expense: 0
        };
      }
      weekMap[weekKey].dates.add(r.date);
      weekMap[weekKey].sales += (r.total_sell || 0);
      weekMap[weekKey].expense += (r.total_expense || 0);
    });

    const validWeeks = [];
    Object.values(weekMap).forEach(w => {
      if (w.dates.size >= 5) {
        const profit = w.sales - w.expense;
        const ratio = w.sales > 0 ? (w.expense / w.sales) * 100 : 0;
        validWeeks.push({
          key: w.key,
          label: w.label,
          shortLabel: w.shortLabel,
          count: w.dates.size,
          sales: w.sales,
          expense: w.expense,
          profit,
          ratio
        });
      }
    });

    validWeeks.sort((a, b) => a.key.localeCompare(b.key));
    return validWeeks;
  } catch (err) {
    console.error("[AnalyticsService] getAvailableWeeksOverview error:", err);
    return [];
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
