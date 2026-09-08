import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getAvailableMonthsOverview,
  getAvailableWeeksOverview,
  getDailyBreakdown,
  getExpenseCategories,
  getDatesForPeriod,
} from '../services/analyticsService';
import {
  compareExpenseCategories,
  analyzeWeatherImpact,
  compareTopItems,
  generateInsights,
} from '../services/analyticsHelper';

const BENGALI_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

function formatBengaliMonth(monthKey) {
  if (!monthKey) return '';
  const [, m] = monthKey.split('-').map(Number);
  return `${BENGALI_MONTHS[m - 1]}`;
}

function formatNumber(n) {
  if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return Math.round(n).toString();
}

export default function AdminAnalyticsScreen({ onBack }) {
  const [viewMode, setViewMode] = useState('monthly'); // 'daily', 'weekly', 'monthly'
  const [monthsData, setMonthsData] = useState({ allMonths: [], validMonths: [] });
  const [weeksData, setWeeksData] = useState({ allWeeks: [], validWeeks: [] });

  const [currentKey, setCurrentKey] = useState('');
  const [compareKey, setCompareKey] = useState('');

  const [currentDropdownOpen, setCurrentDropdownOpen] = useState(false);
  const [compareDropdownOpen, setCompareDropdownOpen] = useState(false);

  // Day comparison states
  const [compareDaysMode, setCompareDaysMode] = useState(false);
  const [day1, setDay1] = useState(null);
  const [day2, setDay2] = useState(null);
  const [daySelectTarget, setDaySelectTarget] = useState(null); // 'day1' or 'day2'

  useEffect(() => {
    const m = getAvailableMonthsOverview();
    setMonthsData(m);

    // For initial load, use allMonths if validMonths is empty (for daily view)
    const monthsToUse = m.validMonths.length > 0 ? m.validMonths : m.allMonths;

    if (monthsToUse.length >= 2) {
      setCurrentKey(monthsToUse[monthsToUse.length - 1].key);
      setCompareKey(monthsToUse[monthsToUse.length - 2].key);
    } else if (monthsToUse.length === 1) {
      setCurrentKey(monthsToUse[0].key);
      setCompareKey('');
    }

    const w = getAvailableWeeksOverview();
    setWeeksData(w);
  }, []);

  const handleViewModeChange = (newMode) => {
    setViewMode(newMode);
    setCurrentDropdownOpen(false);
    setCompareDropdownOpen(false);

    if (newMode === 'daily') {
      // Use allMonths for daily view (no coverage requirement)
      const allMonthsList = monthsData.allMonths;
      if (allMonthsList.length >= 1) {
        setCurrentKey(allMonthsList[allMonthsList.length - 1].key);
        setCompareKey(allMonthsList.length >= 2 ? allMonthsList[allMonthsList.length - 2].key : '');
      }
    } else {
      const validList = newMode === 'monthly' ? monthsData.validMonths : weeksData.validWeeks;
      if (validList.length >= 2) {
        setCurrentKey(validList[validList.length - 1].key);
        setCompareKey(validList[validList.length - 2].key);
      } else if (validList.length === 1) {
        setCurrentKey(validList[0].key);
        setCompareKey('');
      }
    }
  };

  // For daily view, use allMonths (any data); for weekly/monthly use validPeriodList (80%+ coverage)
  const validPeriodList = viewMode === 'monthly' ? monthsData.validMonths : (viewMode === 'weekly' ? weeksData.validWeeks : monthsData.validMonths);
  const monthsForDaily = monthsData.allMonths; // Use all months for daily view

  const currentOption = useMemo(() => validPeriodList.find(o => o.key === currentKey), [validPeriodList, currentKey]);
  const compareOption = useMemo(() => validPeriodList.find(o => o.key === compareKey), [validPeriodList, compareKey]);

  const validCompareOptions = useMemo(() => {
    return validPeriodList.filter(o => o.key !== currentKey);
  }, [validPeriodList, currentKey]);

  const summaryData = useMemo(() => {
    if (!currentKey) return null;
    // Use allMonths for daily view, validMonths for monthly/weekly
    const lookupList = viewMode === 'daily' ? monthsData.allMonths : (viewMode === 'monthly' ? monthsData.validMonths : weeksData.validWeeks);
    const cur = lookupList.find(o => o.key === currentKey);
    const cmp = compareKey ? lookupList.find(o => o.key === compareKey) : null;
    if (!cur) return null;

    const calcPct = (c, p) => p > 0 ? ((c - p) / p) * 100 : 0;
    return {
      current: cur,
      compare: cmp || null,
      salesPct: cmp ? calcPct(cur.sales, cmp.sales) : 0,
      profitPct: cmp ? calcPct(cur.profit, cmp.profit) : 0,
      expensePct: cmp ? calcPct(cur.expense, cmp.expense) : 0,
      salesChange: cmp ? cur.sales - cmp.sales : 0,
      profitChange: cmp ? cur.profit - cmp.profit : 0,
      expenseChange: cmp ? cur.expense - cmp.expense : 0,
    };
  }, [viewMode, currentKey, compareKey, monthsData, weeksData]);

  const whyAnalysis = useMemo(() => {
    if (!currentKey || !compareKey) return null;
    const mode = viewMode === 'daily' ? 'monthly' : viewMode;
    const curDates = getDatesForPeriod(mode, currentKey);
    const cmpDates = getDatesForPeriod(mode, compareKey);
    if (curDates.length === 0) return null;

    const expenseComparison = compareExpenseCategories(curDates, cmpDates);
    const weatherImpact = analyzeWeatherImpact(curDates);
    const itemComparison = compareTopItems(curDates, cmpDates, 5);

    // Use allMonths for daily view lookup
    const lookupList = viewMode === 'daily' ? monthsData.allMonths : (mode === 'monthly' ? monthsData.validMonths : weeksData.validWeeks);
    const cur = lookupList.find(o => o.key === currentKey);
    const cmp = lookupList.find(o => o.key === compareKey);

    if (!cur || !cmp) return null;

    const salesPct = cmp.sales > 0 ? ((cur.sales - cmp.sales) / cmp.sales) * 100 : 0;
    const profitPct = cmp.profit > 0 ? ((cur.profit - cmp.profit) / cmp.profit) * 100 : 0;

    const insights = generateInsights(
      { totalSales: cur.sales, ownerProfit: cur.profit },
      { totalSales: cmp.sales, ownerProfit: cmp.profit },
      expenseComparison, weatherImpact, itemComparison, salesPct, profitPct
    );

    return { expenseComparison, weatherImpact, itemComparison, insights };
  }, [viewMode, currentKey, compareKey, monthsData, weeksData]);

  const dailyData = useMemo(() => {
    if (viewMode !== 'daily' || !currentKey) return [];
    return getDailyBreakdown('monthly', currentKey);
  }, [viewMode, currentKey]);

  // Day comparison data
  const dayComparison = useMemo(() => {
    if (!compareDaysMode || !day1 || !day2) return null;
    const d1 = dailyData.find(d => d.date === day1);
    const d2 = dailyData.find(d => d.date === day2);
    if (!d1 || !d2) return null;

    const calcPct = (c, p) => p > 0 ? ((c - p) / p) * 100 : 0;
    const salesPct = calcPct(d1.sales, d2.sales);
    const profitPct = calcPct(d1.profit, d2.profit);
    const expensePct = calcPct(d1.expense, d2.expense);

    return {
      day1: d1,
      day2: d2,
      salesPct,
      profitPct,
      expensePct,
      salesChange: d1.sales - d2.sales,
      profitChange: d1.profit - d2.profit,
      expenseChange: d1.expense - d2.expense,
    };
  }, [compareDaysMode, day1, day2, dailyData]);

  const renderMetricCard = (label, currentVal, pctChange, changeVal, isGoodWhenUp = true) => {
    const isUp = pctChange > 0;
    const isGood = isGoodWhenUp ? isUp : !isUp;
    const color = pctChange === 0 ? '#A1A1AA' : (isGood ? '#10B981' : '#EF4444');
    const arrow = pctChange === 0 ? '→' : (isUp ? '↑' : '↓');
    const sign = changeVal >= 0 ? '+' : '';

    return (
      <View style={styles.metricCard}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={styles.metricValue}>৳{Math.round(currentVal).toLocaleString()}</Text>
        <View style={styles.metricChangeRow}>
          <Text style={[styles.metricArrow, { color }]}>{arrow}</Text>
          <Text style={[styles.metricPct, { color }]}>{Math.abs(pctChange).toFixed(1)}%</Text>
        </View>
        <Text style={styles.metricAbsChange}>({sign}৳{Math.round(Math.abs(changeVal)).toLocaleString()})</Text>
      </View>
    );
  };

  const renderInsight = (insight, idx) => {
    const bgColor = insight.type === 'good' ? 'rgba(16, 185, 129, 0.1)' : (insight.type === 'bad' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(161, 161, 170, 0.1)');
    const borderColor = insight.type === 'good' ? '#10B981' : (insight.type === 'bad' ? '#EF4444' : '#A1A1AA');
    return (
      <View key={idx} style={[styles.insightRow, { backgroundColor: bgColor, borderLeftColor: borderColor }]}>
        <Text style={styles.insightIcon}>{insight.icon}</Text>
        <Text style={styles.insightText}>{insight.message}</Text>
      </View>
    );
  };

  const renderExpenseRow = (item, idx) => {
    const color = item.change === 0 ? '#A1A1AA' : (item.isBad ? '#EF4444' : '#10B981');
    const arrow = item.change === 0 ? '→' : (item.change > 0 ? '↑' : '↓');
    return (
      <View key={idx} style={[styles.expenseRow, idx % 2 === 1 && styles.expenseRowAlt]}>
        <Text style={styles.expenseLabel}>{item.categoryLabel}</Text>
        <Text style={styles.expenseValue}>৳{Math.round(item.current).toLocaleString()}</Text>
        <View style={styles.expenseChangeCol}>
          <Text style={[styles.expenseArrow, { color }]}>{arrow}</Text>
          <Text style={[styles.expensePct, { color }]}>{Math.abs(item.changePct).toFixed(0)}%</Text>
        </View>
      </View>
    );
  };

  const renderDailyRow = (item, idx) => {
    const profitColor = item.profit >= 0 ? '#10B981' : '#EF4444';
    return (
      <View key={idx} style={[styles.dailyRow, idx % 2 === 1 && styles.dailyRowAlt]}>
        <View style={styles.dailyDateCol}>
          <Text style={styles.dailyDate}>{item.date.split('-')[2]}</Text>
          <Text style={styles.dailyDay}>{item.dayName}</Text>
        </View>
        <Text style={styles.dailyWeather}>{item.weatherIcon} {item.temp}</Text>
        <Text style={styles.dailySales}>৳{formatNumber(item.sales)}</Text>
        <Text style={[styles.dailyProfit, { color: profitColor }]}>৳{formatNumber(item.profit)}</Text>
        <Text style={styles.dailyItem} numberOfLines={1}>{item.topItem}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>◁ ফিরে যান</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>📊 ব্যবসা বিশ্লেষণ</Text>
        <View style={{ width: 80 }} />
      </View>

      {/* Month Display Bar */}
      {currentKey && (
        <View style={styles.monthBar}>
          <Text style={styles.monthBarLabel}>বর্তমান:</Text>
          <Text style={styles.monthBarValue}>{formatBengaliMonth(currentKey)} {currentKey?.split('-')[0]}</Text>
          {compareKey && (
            <>
              <Text style={styles.monthBarDivider}>vs</Text>
              <Text style={styles.monthBarCompare}>{formatBengaliMonth(compareKey)} {compareKey?.split('-')[0]}</Text>
            </>
          )}
        </View>
      )}

      <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scrollContent}>

        {/* QUICK SUMMARY CARDS */}
        {summaryData && summaryData.compare && (
          <View style={styles.summarySection}>
            <Text style={styles.sectionTitle}>📈 দ্রুত সারসংক্ষেপ</Text>
            <View style={styles.metricsRow}>
              {renderMetricCard('বিক্রি', summaryData.current.sales, summaryData.salesPct, summaryData.salesChange, true)}
              {renderMetricCard('লাভ', summaryData.current.profit, summaryData.profitPct, summaryData.profitChange, true)}
              {renderMetricCard('খরচ', summaryData.current.expense, summaryData.expensePct, summaryData.expenseChange, false)}
            </View>
          </View>
        )}

        {/* WHY ANALYSIS SECTION */}
        {whyAnalysis && whyAnalysis.insights.length > 0 && (
          <View style={styles.whySection}>
            <Text style={styles.sectionTitle}>
              {summaryData && summaryData.profitPct < 0 ? '📉 কেন লাভ কমেছে?' : '📈 কেন লাভ বেড়েছে?'}
            </Text>
            {whyAnalysis.insights.map((insight, idx) => renderInsight(insight, idx))}
          </View>
        )}

        {/* VIEW MODE SELECTOR */}
        <View style={styles.toggleSection}>
          <TouchableOpacity style={[styles.toggleBtn, viewMode === 'daily' && styles.toggleBtnActive]} onPress={() => handleViewModeChange('daily')}>
            <Text style={[styles.toggleText, viewMode === 'daily' && styles.toggleTextActive]}>দিন</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.toggleBtn, viewMode === 'weekly' && styles.toggleBtnActive]} onPress={() => handleViewModeChange('weekly')}>
            <Text style={[styles.toggleText, viewMode === 'weekly' && styles.toggleTextActive]}>সপ্তাহ</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.toggleBtn, viewMode === 'monthly' && styles.toggleBtnActive]} onPress={() => handleViewModeChange('monthly')}>
            <Text style={[styles.toggleText, viewMode === 'monthly' && styles.toggleTextActive]}>মাস</Text>
          </TouchableOpacity>
        </View>

        {/* PERIOD SELECTORS */}
        {viewMode !== 'daily' && (
          <View style={styles.selectorSection}>
            <View style={styles.selectorRow}>
              <View style={styles.selectorCol}>
                <Text style={styles.selectorLabel}>বর্তমান:</Text>
                <TouchableOpacity style={styles.dropdownBtn} onPress={() => { setCurrentDropdownOpen(!currentDropdownOpen); setCompareDropdownOpen(false); }}>
                  <Text style={styles.dropdownText}>{currentOption ? (viewMode === 'monthly' ? `${formatBengaliMonth(currentOption.key)} ${currentOption.key.split('-')[0]}` : currentOption.shortLabel) : 'নির্বাচন'} ▼</Text>
                </TouchableOpacity>
                {currentDropdownOpen && (
                  <View style={styles.dropdownList}>
                    <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                      {validPeriodList.map(item => (
                        <TouchableOpacity key={item.key} style={[styles.dropdownItem, item.key === currentKey && styles.dropdownItemActive]}
                          onPress={() => { setCurrentKey(item.key); setCurrentDropdownOpen(false); }}>
                          <Text style={[styles.dropdownItemText, item.key === currentKey && styles.dropdownItemTextActive]}>
                            {viewMode === 'monthly' ? `${formatBengaliMonth(item.key)} ${item.key.split('-')[0]}` : item.shortLabel}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>
              <View style={styles.selectorCol}>
                <Text style={styles.selectorLabel}>তুলনা:</Text>
                <TouchableOpacity style={styles.dropdownBtn} onPress={() => { setCompareDropdownOpen(!compareDropdownOpen); setCurrentDropdownOpen(false); }}>
                  <Text style={styles.dropdownText}>{compareOption ? (viewMode === 'monthly' ? `${formatBengaliMonth(compareOption.key)} ${compareOption.key.split('-')[0]}` : compareOption.shortLabel) : 'নির্বাচন'} ▼</Text>
                </TouchableOpacity>
                {compareDropdownOpen && (
                  <View style={styles.dropdownList}>
                    <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                      {validCompareOptions.map(item => (
                        <TouchableOpacity key={item.key} style={[styles.dropdownItem, item.key === compareKey && styles.dropdownItemActive]}
                          onPress={() => { setCompareKey(item.key); setCompareDropdownOpen(false); }}>
                          <Text style={[styles.dropdownItemText, item.key === compareKey && styles.dropdownItemTextActive]}>
                            {viewMode === 'monthly' ? `${formatBengaliMonth(item.key)} ${item.key.split('-')[0]}` : item.shortLabel}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>
            </View>
          </View>
        )}

        {/* DAILY VIEW TABLE */}
        {viewMode === 'daily' && currentKey && (
          <View style={styles.dailySection}>
            <Text style={styles.sectionTitle}>📅 দৈনিক বিশ্লেষণ - {formatBengaliMonth(currentKey)} {currentKey?.split('-')[0]}</Text>

            {/* Month selector for daily view */}
            <View style={styles.dailyMonthSelector}>
              <Text style={styles.dailyMonthLabel}>মাস নির্বাচন:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.monthScroll}>
                {monthsForDaily.map((item) => (
                  <TouchableOpacity
                    key={item.key}
                    style={[styles.monthChip, item.key === currentKey && styles.monthChipActive]}
                    onPress={() => setCurrentKey(item.key)}
                  >
                    <Text style={[styles.monthChipText, item.key === currentKey && styles.monthChipTextActive]}>
                      {formatBengaliMonth(item.key)} ({item.submittedDays}d)
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {dailyData.length > 0 ? (
              <>
                {/* Day Compare Toggle Button */}
                <TouchableOpacity
                  style={[styles.compareToggleBtn, compareDaysMode && styles.compareToggleBtnActive]}
                  onPress={() => {
                    setCompareDaysMode(!compareDaysMode);
                    if (!compareDaysMode) {
                      setDay1(null);
                      setDay2(null);
                    }
                  }}
                >
                  <Text style={[styles.compareToggleText, compareDaysMode && styles.compareToggleTextActive]}>
                    {compareDaysMode ? '✕ তুলনা বন্ধ করুন' : '⚖️ দুই দিনের তুলনা করুন'}
                  </Text>
                </TouchableOpacity>

                {/* Day Selection for Comparison */}
                {compareDaysMode && (
                  <View style={styles.daySelectSection}>
                    <View style={styles.daySelectRow}>
                      <TouchableOpacity
                        style={[styles.daySelectBtn, day1 && styles.daySelectBtnActive]}
                        onPress={() => setDaySelectTarget('day1')}
                      >
                        <Text style={styles.daySelectLabel}>দিন ১:</Text>
                        <Text style={styles.daySelectValue}>
                          {day1 ? dailyData.find(d => d.date === day1)?.date.split('-')[2] + ' ' + dailyData.find(d => d.date === day1)?.dayName : 'নির্বাচন'}
                        </Text>
                      </TouchableOpacity>
                      <Text style={styles.daySelectVS}>VS</Text>
                      <TouchableOpacity
                        style={[styles.daySelectBtn, day2 && styles.daySelectBtnActive]}
                        onPress={() => setDaySelectTarget('day2')}
                      >
                        <Text style={styles.daySelectLabel}>দিন ২:</Text>
                        <Text style={styles.daySelectValue}>
                          {day2 ? dailyData.find(d => d.date === day2)?.date.split('-')[2] + ' ' + dailyData.find(d => d.date === day2)?.dayName : 'নির্বাচন'}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {/* Day picker chips */}
                    {daySelectTarget && (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayChipsScroll}>
                        {dailyData.map((item) => (
                          <TouchableOpacity
                            key={item.date}
                            style={[styles.dayChip, (daySelectTarget === 'day1' ? day1 : day2) === item.date && styles.dayChipActive]}
                            onPress={() => {
                              if (daySelectTarget === 'day1') setDay1(item.date);
                              else setDay2(item.date);
                              setDaySelectTarget(null);
                            }}
                          >
                            <Text style={styles.dayChipDate}>{item.date.split('-')[2]}</Text>
                            <Text style={styles.dayChipDay}>{item.dayName}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}

                    {/* Day Comparison Results */}
                    {dayComparison && (
                      <View style={styles.dayCompareResults}>
                        <Text style={styles.dayCompareTitle}>📊 তুলনা ফলাফল</Text>
                        <View style={styles.dayCompareRow}>
                          <Text style={styles.dayCompareLabel}>বিক্রি:</Text>
                          <Text style={styles.dayCompareValue}>৳{dayComparison.day1.sales.toLocaleString()} vs ৳{dayComparison.day2.sales.toLocaleString()}</Text>
                          <Text style={[styles.dayComparePct, { color: dayComparison.salesPct >= 0 ? '#10B981' : '#EF4444' }]}>
                            {dayComparison.salesPct >= 0 ? '↑' : '↓'}{Math.abs(dayComparison.salesPct).toFixed(1)}%
                          </Text>
                        </View>
                        <View style={styles.dayCompareRow}>
                          <Text style={styles.dayCompareLabel}>লাভ:</Text>
                          <Text style={styles.dayCompareValue}>৳{dayComparison.day1.profit.toLocaleString()} vs ৳{dayComparison.day2.profit.toLocaleString()}</Text>
                          <Text style={[styles.dayComparePct, { color: dayComparison.profitPct >= 0 ? '#10B981' : '#EF4444' }]}>
                            {dayComparison.profitPct >= 0 ? '↑' : '↓'}{Math.abs(dayComparison.profitPct).toFixed(1)}%
                          </Text>
                        </View>
                        <View style={styles.dayCompareRow}>
                          <Text style={styles.dayCompareLabel}>খরচ:</Text>
                          <Text style={styles.dayCompareValue}>৳{dayComparison.day1.expense.toLocaleString()} vs ৳{dayComparison.day2.expense.toLocaleString()}</Text>
                          <Text style={[styles.dayComparePct, { color: dayComparison.expensePct <= 0 ? '#10B981' : '#EF4444' }]}>
                            {dayComparison.expensePct >= 0 ? '↑' : '↓'}{Math.abs(dayComparison.expensePct).toFixed(1)}%
                          </Text>
                        </View>
                      </View>
                    )}
                  </View>
                )}

                <View style={styles.dailyHeader}>
                  <Text style={[styles.dailyHeaderText, { width: 45 }]}>তারিখ</Text>
                  <Text style={[styles.dailyHeaderText, { width: 65 }]}>আবহাওয়া</Text>
                  <Text style={[styles.dailyHeaderText, { width: 60, textAlign: 'right' }]}>বিক্রি</Text>
                  <Text style={[styles.dailyHeaderText, { width: 55, textAlign: 'right' }]}>লাভ</Text>
                  <Text style={[styles.dailyHeaderText, { flex: 1 }]}>টপ আইটেম</Text>
                </View>
                {dailyData.map((item, idx) => renderDailyRow(item, idx))}

                {/* Daily Summary */}
                <View style={styles.dailySummary}>
                  <View style={styles.dailySummaryRow}>
                    <Text style={styles.dailySummaryLabel}>মোট বিক্রি:</Text>
                    <Text style={styles.dailySummaryValue}>৳{dailyData.reduce((sum, d) => sum + d.sales, 0).toLocaleString()}</Text>
                  </View>
                  <View style={styles.dailySummaryRow}>
                    <Text style={styles.dailySummaryLabel}>মোট লাভ:</Text>
                    <Text style={[styles.dailySummaryValue, { color: '#10B981' }]}>৳{dailyData.reduce((sum, d) => sum + d.profit, 0).toLocaleString()}</Text>
                  </View>
                  <View style={styles.dailySummaryRow}>
                    <Text style={styles.dailySummaryLabel}>দিন সংখ্যা:</Text>
                    <Text style={styles.dailySummaryValue}>{dailyData.length} দিন</Text>
                  </View>
                </View>
              </>
            ) : (
              <View style={styles.emptyDaily}>
                <Text style={styles.emptyDailyText}>এই মাসে কোনো ডেটা নেই</Text>
              </View>
            )}
          </View>
        )}

        {/* EXPENSE BREAKDOWN */}
        {whyAnalysis && whyAnalysis.expenseComparison.length > 0 && (
          <View style={styles.expenseSection}>
            <Text style={styles.sectionTitle}>💰 খরচের বিশ্লেষণ</Text>
            <View style={styles.expenseHeader}>
              <Text style={[styles.expenseHeaderText, { flex: 1 }]}>ক্যাটাগরি</Text>
              <Text style={[styles.expenseHeaderText, { width: 80, textAlign: 'right' }]}>বর্তমান</Text>
              <Text style={[styles.expenseHeaderText, { width: 50, textAlign: 'center' }]}>পরিবর্তন</Text>
            </View>
            {whyAnalysis.expenseComparison.map((item, idx) => renderExpenseRow(item, idx))}
          </View>
        )}

        {/* WEATHER IMPACT */}
        {whyAnalysis && whyAnalysis.weatherImpact && (
          <View style={styles.weatherSection}>
            <Text style={styles.sectionTitle}>🌤️ আবহাওয়ার প্রভাব</Text>
            <View style={styles.weatherCard}>
              <View style={styles.weatherRow}>
                <Text style={styles.weatherLabel}>🌧️ বৃষ্টির দিন:</Text>
                <Text style={styles.weatherValue}>{whyAnalysis.weatherImpact.rainyDays} দিন</Text>
              </View>
              <View style={styles.weatherRow}>
                <Text style={styles.weatherLabel}>☀️ রোদের দিন:</Text>
                <Text style={styles.weatherValue}>{whyAnalysis.weatherImpact.sunnyDays} দিন</Text>
              </View>
              <View style={styles.weatherRow}>
                <Text style={styles.weatherLabel}>🌡️ গড় তাপমাত্রা:</Text>
                <Text style={styles.weatherValue}>{whyAnalysis.weatherImpact.avgTemp}°C</Text>
              </View>
              {whyAnalysis.weatherImpact.salesOnRainy > 0 && whyAnalysis.weatherImpact.salesOnSunny > 0 && (
                <>
                  <View style={styles.weatherDivider} />
                  <View style={styles.weatherRow}>
                    <Text style={styles.weatherLabel}>বৃষ্টিতে গড়:</Text>
                    <Text style={[styles.weatherValue, { color: '#EF4444' }]}>৳{whyAnalysis.weatherImpact.salesOnRainy.toLocaleString()}</Text>
                  </View>
                  <View style={styles.weatherRow}>
                    <Text style={styles.weatherLabel}>রোদে গড়:</Text>
                    <Text style={[styles.weatherValue, { color: '#10B981' }]}>৳{whyAnalysis.weatherImpact.salesOnSunny.toLocaleString()}</Text>
                  </View>
                </>
              )}
              {whyAnalysis.weatherImpact.fridayAvg > 0 && whyAnalysis.weatherImpact.weekdayAvg > 0 && (
                <>
                  <View style={styles.weatherDivider} />
                  <View style={styles.weatherRow}>
                    <Text style={styles.weatherLabel}>📅 শুক্রবার:</Text>
                    <Text style={[styles.weatherValue, { color: '#F59E0B' }]}>৳{whyAnalysis.weatherImpact.fridayAvg.toLocaleString()}</Text>
                  </View>
                  <View style={styles.weatherRow}>
                    <Text style={styles.weatherLabel}>📅 সাধারণ দিন:</Text>
                    <Text style={styles.weatherValue}>৳{whyAnalysis.weatherImpact.weekdayAvg.toLocaleString()}</Text>
                  </View>
                </>
              )}
            </View>
          </View>
        )}

        {/* TOP ITEMS */}
        {whyAnalysis && whyAnalysis.itemComparison.length > 0 && (
          <View style={styles.itemsSection}>
            <Text style={styles.sectionTitle}>🍔 টপ সেলিং আইটেম</Text>
            {whyAnalysis.itemComparison.map((item, idx) => (
              <View key={idx} style={[styles.itemRow, idx % 2 === 1 && styles.itemRowAlt]}>
                <Text style={styles.itemRank}>#{idx + 1}</Text>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName} numberOfLines={1}>{item.itemName}</Text>
                  <Text style={styles.itemQty}>{item.currentQty} পিস</Text>
                </View>
                <View style={styles.itemChange}>
                  <Text style={styles.itemRevenue}>৳{Math.round(item.currentRev).toLocaleString()}</Text>
                  {item.previousRev > 0 && (
                    <Text style={[styles.itemPct, { color: item.revChange >= 0 ? '#10B981' : '#EF4444' }]}>
                      {item.revChange >= 0 ? '↑' : '↓'}{Math.abs(item.revChange).toFixed(0)}%
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* EMPTY STATE - Only show for weekly/monthly when no data */}
        {viewMode !== 'daily' && validPeriodList.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📊</Text>
            <Text style={styles.emptyText}>পর্যাপ্ত তথ্য নেই</Text>
            <Text style={styles.emptySubtext}>
              {viewMode === 'weekly' ? 'কমপক্ষে এক সপ্তাহের ডেটা প্রয়োজন' : 'কমপক্ষে একটি মাসের ডেটা প্রয়োজন'}
            </Text>
          </View>
        )}

        {/* EMPTY STATE for daily when no months at all */}
        {viewMode === 'daily' && monthsForDaily.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📅</Text>
            <Text style={styles.emptyText}>কোনো মাসের ডেটা নেই</Text>
            <Text style={styles.emptySubtext}>দৈনিক বিশ্লেষণের জন্য কমপক্ষে একটি মাসের ডেটা প্রয়োজন</Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
    backgroundColor: '#0D0D0D',
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#1E1E1E',
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#161616',
    borderBottomWidth: 1,
    borderColor: '#262626',
    gap: 8,
  },
  monthBarLabel: {
    fontSize: 13,
    color: '#A1A1AA',
  },
  monthBarValue: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#FFB703',
  },
  monthBarDivider: {
    fontSize: 12,
    color: '#71717A',
  },
  monthBarCompare: {
    fontSize: 14,
    color: '#60A5FA',
  },
  scrollBody: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 12,
    marginTop: 4,
  },
  summarySection: { marginBottom: 20 },
  metricsRow: { flexDirection: 'row', gap: 10 },
  metricCard: {
    flex: 1,
    backgroundColor: '#161616',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#262626',
  },
  metricLabel: { fontSize: 12, color: '#A1A1AA', marginBottom: 6 },
  metricValue: { fontSize: 18, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 6 },
  metricChangeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metricArrow: { fontSize: 16, fontWeight: 'bold' },
  metricPct: { fontSize: 13, fontWeight: 'bold' },
  metricAbsChange: { fontSize: 11, color: '#71717A', marginTop: 2 },
  whySection: { marginBottom: 20 },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    borderLeftWidth: 3,
  },
  insightIcon: { fontSize: 18, marginRight: 12 },
  insightText: { flex: 1, fontSize: 14, color: '#E4E4E7', lineHeight: 20 },
  toggleSection: {
    flexDirection: 'row',
    backgroundColor: '#161616',
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#262626',
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  toggleBtnActive: { backgroundColor: '#FFB703' },
  toggleText: { fontSize: 14, fontWeight: '600', color: '#A1A1AA' },
  toggleTextActive: { color: '#000000' },
  selectorSection: { marginBottom: 16 },
  selectorRow: { flexDirection: 'row', gap: 12 },
  selectorCol: { flex: 1 },
  selectorLabel: { fontSize: 12, color: '#A1A1AA', marginBottom: 6 },
  dropdownBtn: {
    backgroundColor: '#1E1E1E',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#262626',
  },
  dropdownText: { fontSize: 13, color: '#FFFFFF' },
  dropdownList: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#1E1E1E',
    borderRadius: 8,
    marginTop: 4,
    zIndex: 1000,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#262626',
  },
  dropdownItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#262626',
  },
  dropdownItemActive: { backgroundColor: 'rgba(255, 183, 3, 0.15)' },
  dropdownItemText: { fontSize: 13, color: '#E4E4E7' },
  dropdownItemTextActive: { color: '#FFB703', fontWeight: 'bold' },
  dailySection: { marginBottom: 20 },
  dailyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
    padding: 10,
    borderRadius: 8,
    marginBottom: 4,
  },
  dailyHeaderText: { fontSize: 11, fontWeight: 'bold', color: '#A1A1AA' },
  dailyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#161616',
  },
  dailyRowAlt: { backgroundColor: '#1A1A1A' },
  dailyDateCol: { width: 50 },
  dailyDate: { fontSize: 14, fontWeight: 'bold', color: '#FFFFFF' },
  dailyDay: { fontSize: 10, color: '#71717A' },
  dailyWeather: { width: 70, fontSize: 12, color: '#A1A1AA' },
  dailySales: { width: 65, fontSize: 13, color: '#FFFFFF', textAlign: 'right' },
  dailyProfit: { width: 60, fontSize: 13, fontWeight: 'bold', textAlign: 'right' },
  dailyItem: { flex: 1, fontSize: 11, color: '#71717A', marginLeft: 8 },
  dailyMonthSelector: {
    marginBottom: 12,
  },
  dailyMonthLabel: {
    fontSize: 12,
    color: '#A1A1AA',
    marginBottom: 8,
  },
  monthScroll: {
    flexDirection: 'row',
  },
  monthChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1E1E1E',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#262626',
  },
  monthChipActive: {
    backgroundColor: '#FFB703',
    borderColor: '#FFB703',
  },
  monthChipText: {
    fontSize: 12,
    color: '#A1A1AA',
    fontWeight: '600',
  },
  monthChipTextActive: {
    color: '#000000',
  },
  dailySummary: {
    backgroundColor: '#161616',
    borderRadius: 10,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#262626',
  },
  dailySummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  dailySummaryLabel: {
    fontSize: 13,
    color: '#A1A1AA',
  },
  dailySummaryValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  emptyDaily: {
    padding: 30,
    alignItems: 'center',
  },
  emptyDailyText: {
    fontSize: 14,
    color: '#71717A',
  },
  compareToggleBtn: {
    backgroundColor: '#1E1E1E',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#262626',
    alignItems: 'center',
  },
  compareToggleBtnActive: {
    backgroundColor: 'rgba(255, 183, 3, 0.15)',
    borderColor: '#FFB703',
  },
  compareToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#A1A1AA',
  },
  compareToggleTextActive: {
    color: '#FFB703',
  },
  daySelectSection: {
    backgroundColor: '#161616',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#262626',
  },
  daySelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  daySelectBtn: {
    flex: 1,
    backgroundColor: '#1E1E1E',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#262626',
    alignItems: 'center',
  },
  daySelectBtnActive: {
    borderColor: '#FFB703',
  },
  daySelectLabel: {
    fontSize: 11,
    color: '#A1A1AA',
    marginBottom: 4,
  },
  daySelectValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  daySelectVS: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFB703',
    marginHorizontal: 10,
  },
  dayChipsScroll: {
    marginBottom: 10,
  },
  dayChip: {
    width: 48,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1E1E1E',
    marginRight: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#262626',
  },
  dayChipActive: {
    backgroundColor: '#FFB703',
    borderColor: '#FFB703',
  },
  dayChipDate: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  dayChipDay: {
    fontSize: 9,
    color: '#A1A1AA',
  },
  dayCompareResults: {
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    padding: 12,
  },
  dayCompareTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFB703',
    marginBottom: 10,
  },
  dayCompareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#262626',
  },
  dayCompareLabel: {
    fontSize: 12,
    color: '#A1A1AA',
    width: 40,
  },
  dayCompareValue: {
    flex: 1,
    fontSize: 12,
    color: '#FFFFFF',
  },
  dayComparePct: {
    fontSize: 13,
    fontWeight: 'bold',
    width: 60,
    textAlign: 'right',
  },
  expenseSection: { marginBottom: 20 },
  expenseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
    padding: 10,
    borderRadius: 8,
    marginBottom: 4,
  },
  expenseHeaderText: { fontSize: 11, fontWeight: 'bold', color: '#A1A1AA' },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#161616',
  },
  expenseRowAlt: { backgroundColor: '#1A1A1A' },
  expenseLabel: { flex: 1, fontSize: 13, color: '#E4E4E7' },
  expenseValue: { width: 85, fontSize: 13, color: '#FFFFFF', textAlign: 'right' },
  expenseChangeCol: {
    width: 55,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  expenseArrow: { fontSize: 14, fontWeight: 'bold' },
  expensePct: { fontSize: 11, fontWeight: 'bold' },
  weatherSection: { marginBottom: 20 },
  weatherCard: {
    backgroundColor: '#161616',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#262626',
  },
  weatherRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  weatherLabel: { fontSize: 13, color: '#A1A1AA' },
  weatherValue: { fontSize: 14, fontWeight: 'bold', color: '#FFFFFF' },
  weatherDivider: { height: 1, backgroundColor: '#262626', marginVertical: 10 },
  itemsSection: { marginBottom: 20 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#161616',
    borderRadius: 10,
    marginBottom: 6,
  },
  itemRowAlt: { backgroundColor: '#1A1A1A' },
  itemRank: { width: 35, fontSize: 15, fontWeight: 'bold', color: '#FFB703' },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 14, color: '#FFFFFF', marginBottom: 2 },
  itemQty: { fontSize: 11, color: '#71717A' },
  itemChange: { alignItems: 'flex-end' },
  itemRevenue: { fontSize: 14, fontWeight: 'bold', color: '#FFFFFF' },
  itemPct: { fontSize: 11, fontWeight: 'bold' },
  emptyState: { alignItems: 'center', padding: 40 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 8 },
  emptySubtext: { fontSize: 13, color: '#71717A', textAlign: 'center' },
});
