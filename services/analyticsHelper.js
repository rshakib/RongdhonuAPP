import { executeInspectorQuery } from '../database';

/**
 * Compare expense categories between two periods
 * Returns: [{category, categoryLabel, current, previous, change, changePct, isBad}]
 */
export function compareExpenseCategories(currentDates, compareDates) {
  try {
    const categories = [
      { key: 'dudu_store', label: '🥛 দুদু স্টোর' },
      { key: 'akash_murgi', label: '🐔 আকাশ মুরগি' },
      { key: 'burger_bun', label: '🍔 বার্গার বান' },
      { key: 'bazar', label: '🛒 বাজার' },
      { key: 'others', label: '📦 অন্যান্য' },
    ];

    if (!currentDates || currentDates.length === 0) return [];

    const currentPlaceholders = currentDates.map(() => '?').join(',');
    const currentData = executeInspectorQuery(
      `SELECT 
        COALESCE(SUM(dudu_store), 0) as dudu_store,
        COALESCE(SUM(akash_murgi), 0) as akash_murgi,
        COALESCE(SUM(burger_bun), 0) as burger_bun,
        COALESCE(SUM(bazar), 0) as bazar,
        COALESCE(SUM(others), 0) as others
      FROM daily_submit WHERE date IN (${currentPlaceholders})`,
      currentDates
    );

    let compareData = [{ dudu_store: 0, akash_murgi: 0, burger_bun: 0, bazar: 0, others: 0 }];
    if (compareDates && compareDates.length > 0) {
      const comparePlaceholders = compareDates.map(() => '?').join(',');
      compareData = executeInspectorQuery(
        `SELECT 
          COALESCE(SUM(dudu_store), 0) as dudu_store,
          COALESCE(SUM(akash_murgi), 0) as akash_murgi,
          COALESCE(SUM(burger_bun), 0) as burger_bun,
          COALESCE(SUM(bazar), 0) as bazar,
          COALESCE(SUM(others), 0) as others
        FROM daily_submit WHERE date IN (${comparePlaceholders})`,
        compareDates
      );
    }

    const cur = currentData[0] || {};
    const cmp = compareData[0] || {};

    return categories.map(cat => {
      const current = cur[cat.key] || 0;
      const previous = cmp[cat.key] || 0;
      const change = current - previous;
      const changePct = previous > 0 ? (change / previous) * 100 : 0;

      return {
        category: cat.key,
        categoryLabel: cat.label,
        current,
        previous,
        change,
        changePct,
        isBad: change > 0, // Expense increase is bad for owner
      };
    });
  } catch (err) {
    console.error("[AnalyticsHelper] compareExpenseCategories error:", err);
    return [];
  }
}

/**
 * Analyze weather impact on sales for given dates
 */
export function analyzeWeatherImpact(dates) {
  try {
    if (!dates || dates.length === 0) {
      return { rainyDays: 0, sunnyDays: 0, avgTemp: 0, salesOnRainy: 0, salesOnSunny: 0, fridayAvg: 0, weekdayAvg: 0 };
    }

    const placeholders = dates.map(() => '?').join(',');

    // Get weather + sales data from daily_summary
    const summaryRows = executeInspectorQuery(
      `SELECT date, totalSales, isRainy, temperature, condition
       FROM daily_summary WHERE date IN (${placeholders})`,
      dates
    );

    // Get Friday info from daily_submit (dayOfWeek not in daily_submit, use date)
    const submitRows = executeInspectorQuery(
      `SELECT date, total_sell FROM daily_submit WHERE date IN (${placeholders})`,
      dates
    );

    let rainyDays = 0;
    let sunnyDays = 0;
    let rainySalesTotal = 0;
    let sunnySalesTotal = 0;
    let tempSum = 0;
    let tempCount = 0;

    summaryRows.forEach(row => {
      const sales = row.totalSales || 0;
      const isRainy = row.isRainy === 1 || (row.condition && row.condition.toLowerCase().includes('rain'));

      if (isRainy) {
        rainyDays++;
        rainySalesTotal += sales;
      } else {
        sunnyDays++;
        sunnySalesTotal += sales;
      }

      if (row.temperature) {
        tempSum += row.temperature;
        tempCount++;
      }
    });

    // Friday analysis
    let fridaySales = 0;
    let fridayCount = 0;
    let weekdaySales = 0;
    let weekdayCount = 0;

    submitRows.forEach(row => {
      if (!row.date) return;
      const d = new Date(row.date + 'T00:00:00');
      const day = d.getDay(); // 0=Sun, 5=Fri
      const sales = row.total_sell || 0;

      if (day === 5) {
        fridaySales += sales;
        fridayCount++;
      } else {
        weekdaySales += sales;
        weekdayCount++;
      }
    });

    return {
      rainyDays,
      sunnyDays,
      avgTemp: tempCount > 0 ? Math.round(tempSum / tempCount) : 0,
      salesOnRainy: rainyDays > 0 ? Math.round(rainySalesTotal / rainyDays) : 0,
      salesOnSunny: sunnyDays > 0 ? Math.round(sunnySalesTotal / sunnyDays) : 0,
      fridayAvg: fridayCount > 0 ? Math.round(fridaySales / fridayCount) : 0,
      weekdayAvg: weekdayCount > 0 ? Math.round(weekdaySales / weekdayCount) : 0,
    };
  } catch (err) {
    console.error("[AnalyticsHelper] analyzeWeatherImpact error:", err);
    return { rainyDays: 0, sunnyDays: 0, avgTemp: 0, salesOnRainy: 0, salesOnSunny: 0, fridayAvg: 0, weekdayAvg: 0 };
  }
}

/**
 * Compare top selling items between two periods
 */
export function compareTopItems(currentDates, compareDates, limit = 5) {
  try {
    if (!currentDates || currentDates.length === 0) return [];

    const currentPlaceholders = currentDates.map(() => '?').join(',');
    const currentItems = executeInspectorQuery(
      `SELECT itemName, SUM(quantity) as qty, SUM(revenue) as rev
       FROM order_items WHERE date(created_at, 'localtime') IN (${currentPlaceholders})
       GROUP BY itemName ORDER BY rev DESC LIMIT ?`,
      [...currentDates, limit * 2]
    );

    let compareMap = {};
    if (compareDates && compareDates.length > 0) {
      const comparePlaceholders = compareDates.map(() => '?').join(',');
      const compareItems = executeInspectorQuery(
        `SELECT itemName, SUM(quantity) as qty, SUM(revenue) as rev
         FROM order_items WHERE date(created_at, 'localtime') IN (${comparePlaceholders})
         GROUP BY itemName`,
        compareDates
      );
      compareItems.forEach(item => {
        compareMap[item.itemName] = { qty: item.qty || 0, rev: item.rev || 0 };
      });
    }

    return currentItems.slice(0, limit).map(item => {
      const prev = compareMap[item.itemName] || { qty: 0, rev: 0 };
      return {
        itemName: item.itemName,
        currentQty: item.qty || 0,
        currentRev: item.rev || 0,
        previousQty: prev.qty,
        previousRev: prev.rev,
        qtyChange: prev.qty > 0 ? (((item.qty || 0) - prev.qty) / prev.qty) * 100 : 0,
        revChange: prev.rev > 0 ? (((item.rev || 0) - prev.rev) / prev.rev) * 100 : 0,
      };
    });
  } catch (err) {
    console.error("[AnalyticsHelper] compareTopItems error:", err);
    return [];
  }
}

/**
 * Generate human-readable insights in Bengali
 * Returns: [{type: 'good'|'bad'|'neutral', icon, message}]
 */
export function generateInsights(currentData, compareData, expenseComparison, weatherImpact, itemComparison, salesPct, profitPct) {
  const insights = [];

  if (!currentData || !compareData) return insights;

  // 1. Sales trend insight
  if (salesPct > 5) {
    insights.push({ type: 'good', icon: '📈', message: `বিক্রি বেড়েছে ${Math.abs(salesPct).toFixed(0)}% (৳${Math.round(Math.abs(currentData.totalSales - compareData.totalSales)).toLocaleString()} বেশি)` });
  } else if (salesPct < -5) {
    insights.push({ type: 'bad', icon: '📉', message: `বিক্রি কমেছে ${Math.abs(salesPct).toFixed(0)}% (৳${Math.round(Math.abs(currentData.totalSales - compareData.totalSales)).toLocaleString()} কম)` });
  }

  // 2. Profit trend insight
  if (profitPct > 5) {
    insights.push({ type: 'good', icon: '💰', message: `লাভ বেড়েছে ${Math.abs(profitPct).toFixed(0)}% (৳${Math.round(Math.abs(currentData.ownerProfit - compareData.ownerProfit)).toLocaleString()} বেশি)` });
  } else if (profitPct < -5) {
    insights.push({ type: 'bad', icon: '💸', message: `লাভ কমেছে ${Math.abs(profitPct).toFixed(0)}% (৳${Math.round(Math.abs(currentData.ownerProfit - compareData.ownerProfit)).toLocaleString()} কম)` });
  }

  // 3. Expense category insights (biggest changes first)
  if (expenseComparison && expenseComparison.length > 0) {
    const sorted = [...expenseComparison].sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    sorted.forEach(exp => {
      if (Math.abs(exp.change) > 500) { // Only show significant changes
        if (exp.isBad) {
          insights.push({ type: 'bad', icon: '❌', message: `${exp.categoryLabel} খরচ বেড়েছে: +৳${Math.round(exp.change).toLocaleString()}` });
        } else if (exp.change < -500) {
          insights.push({ type: 'good', icon: '✅', message: `${exp.categoryLabel} খরচ কমেছে: ৳${Math.round(Math.abs(exp.change)).toLocaleString()}` });
        }
      }
    });
  }

  // 4. Weather impact insight
  if (weatherImpact) {
    if (weatherImpact.rainyDays > 3 && weatherImpact.salesOnRainy > 0 && weatherImpact.salesOnSunny > 0) {
      const diff = weatherImpact.salesOnSunny - weatherImpact.salesOnRainy;
      const pct = weatherImpact.salesOnSunny > 0 ? (diff / weatherImpact.salesOnSunny) * 100 : 0;
      if (pct > 15) {
        insights.push({ type: 'neutral', icon: '🌧️', message: `বৃষ্টির দিনে বিক্রি কম: ${weatherImpact.rainyDays} দিন বৃষ্টি, গড়ে ৳${Math.round(diff).toLocaleString()} কম বিক্রি` });
      }
    }

    if (weatherImpact.fridayAvg > 0 && weatherImpact.weekdayAvg > 0) {
      const fridayBoost = weatherImpact.fridayAvg - weatherImpact.weekdayAvg;
      const fridayPct = weatherImpact.weekdayAvg > 0 ? (fridayBoost / weatherImpact.weekdayAvg) * 100 : 0;
      if (fridayPct > 10) {
        insights.push({ type: 'good', icon: '📅', message: `শুক্রবারে বিক্রি বেশি: গড়ে +৳${Math.round(fridayBoost).toLocaleString()} (+${fridayPct.toFixed(0)}%)` });
      }
    }
  }

  // 5. Top item insights
  if (itemComparison && itemComparison.length > 0) {
    const topItem = itemComparison[0];
    if (topItem.currentRev > 0) {
      insights.push({ type: 'neutral', icon: '🍔', message: `বেস্ট সেলার: ${topItem.itemName} (৳${Math.round(topItem.currentRev).toLocaleString()})` });
    }

    // Find biggest drop
    const biggestDrop = itemComparison.filter(i => i.revChange < -10).sort((a, b) => a.revChange - b.revChange)[0];
    if (biggestDrop) {
      insights.push({ type: 'bad', icon: '📉', message: `${biggestDrop.itemName} বিক্রি কমেছে: ${biggestDrop.revChange.toFixed(0)}%` });
    }
  }

  return insights;
}
