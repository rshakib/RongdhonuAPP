import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Platform
} from 'react-native';
import {
  getAvailableMonthsOverview,
  getAvailableWeeksOverview,
  buildAnalyticsComparison
} from '../services/analyticsService';

export default function AdminAnalyticsScreen({ onBack }) {
  const [mode, setMode] = useState('monthly'); // 'monthly' or 'weekly'
  
  const [monthsData, setMonthsData] = useState({ allMonths: [], validMonths: [] });
  const [weeksData, setWeeksData] = useState({ allWeeks: [], validWeeks: [] });

  const [currentKey, setCurrentKey] = useState('');
  const [compareKey, setCompareKey] = useState('');

  const [currentDropdownOpen, setCurrentDropdownOpen] = useState(false);
  const [compareDropdownOpen, setCompareDropdownOpen] = useState(false);

  // Load available periods overview on mount
  useEffect(() => {
    const m = getAvailableMonthsOverview();
    setMonthsData(m);
    if (m.validMonths.length >= 2) {
      setCurrentKey(m.validMonths[m.validMonths.length - 1].key); // Latest
      setCompareKey(m.validMonths[m.validMonths.length - 2].key); // Previous
    } else if (m.validMonths.length === 1) {
      setCurrentKey(m.validMonths[0].key);
      setCompareKey('');
    }

    const w = getAvailableWeeksOverview();
    setWeeksData(w);
  }, []);

  // Handle Mode Change (Monthly <-> Weekly)
  const handleModeChange = (newMode) => {
    setMode(newMode);
    setCurrentDropdownOpen(false);
    setCompareDropdownOpen(false);
    const validList = newMode === 'monthly' ? monthsData.validMonths : weeksData.validWeeks;
    if (validList.length >= 2) {
      setCurrentKey(validList[validList.length - 1].key); // Latest
      setCompareKey(validList[validList.length - 2].key); // Previous
    } else if (validList.length === 1) {
      setCurrentKey(validList[0].key);
      setCompareKey('');
    } else {
      setCurrentKey('');
      setCompareKey('');
    }
  };

  const validPeriodList = mode === 'monthly' ? monthsData.validMonths : weeksData.validWeeks;

  const currentOption = useMemo(() => validPeriodList.find(o => o.key === currentKey), [validPeriodList, currentKey]);
  const compareOption = useMemo(() => validPeriodList.find(o => o.key === compareKey), [validPeriodList, compareKey]);

  // Options available for Compare dropdown (NEVER ALLOW SELECTING CURRENT PERIOD)
  const validCompareOptions = useMemo(() => {
    return validPeriodList.filter(o => o.key !== currentKey);
  }, [validPeriodList, currentKey]);

  // Build Analytics Comparison
  const analyticsData = useMemo(() => {
    if (!currentKey || !compareKey || currentKey === compareKey) return null;
    return buildAnalyticsComparison(mode, currentKey, compareKey, currentOption?.label, compareOption?.label);
  }, [mode, currentKey, compareKey, currentOption, compareOption]);

  // Business Health Score Calculation (Pure UI derived score 0-100)
  const healthScoreInfo = useMemo(() => {
    if (!analyticsData || !analyticsData.kpis) return null;

    const { salesPct, profitPct, isRatioImproved } = analyticsData.kpis;

    // Weights: Sales (50%), Profit (35%), Ratio (15%)
    let salesScore = Math.min(100, Math.max(0, 70 + (salesPct * 1.5)));
    let profitScore = Math.min(100, Math.max(0, 70 + (profitPct * 1.5)));
    let ratioScore = isRatioImproved ? 90 : 40;

    const rawScore = Math.round((salesScore * 0.50) + (profitScore * 0.35) + (ratioScore * 0.15));
    const score = Math.min(100, Math.max(0, rawScore));

    let badge = { text: 'EXCELLENT', color: '#10B981', icon: '🟢' };
    if (score >= 90) {
      badge = { text: 'EXCELLENT', color: '#10B981', icon: '🟢' };
    } else if (score >= 75) {
      badge = { text: 'GOOD', color: '#34D399', icon: '🟢' };
    } else if (score >= 60) {
      badge = { text: 'AVERAGE', color: '#F59E0B', icon: '🟡' };
    } else if (score >= 40) {
      badge = { text: 'NEEDS ATTENTION', color: '#F97316', icon: '🟠' };
    } else {
      badge = { text: 'CRITICAL', color: '#EF4444', icon: '🔴' };
    }

    return { score, badge };
  }, [analyticsData]);

  // Pure Native Line Chart Renderer for React Native
  const renderNativeLineChart = (title, items, key1, label1, key2, label2, color1, color2, isPercent = false) => {
    if (!items || items.length === 0) return null;

    const maxVal = Math.max(
      ...items.map(i => Math.max(i[key1] || 0, key2 ? (i[key2] || 0) : 0)),
      1
    );

    const chartHeight = 140;

    return (
      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>{title}</Text>
        
        {/* Legend */}
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: color1 }]} />
            <Text style={styles.legendText}>{label1}</Text>
          </View>
          {key2 && (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: color2 }]} />
              <Text style={styles.legendText}>{label2}</Text>
            </View>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.lineChartStage}>
            {/* Horizontal Gridlines */}
            <View style={styles.gridLineContainer}>
              <View style={styles.gridLine} />
              <View style={styles.gridLine} />
              <View style={styles.gridLine} />
            </View>

            {/* Line Nodes */}
            <View style={styles.nodesRow}>
              {items.map((item, idx) => {
                const val1 = item[key1] || 0;
                const val2 = key2 ? (item[key2] || 0) : 0;

                const pos1 = Math.max(12, (val1 / maxVal) * (chartHeight - 30));
                const pos2 = key2 ? Math.max(12, (val2 / maxVal) * (chartHeight - 30)) : 0;

                return (
                  <View key={idx} style={styles.nodeColumn}>
                    <View style={[styles.lineTrackArea, { height: chartHeight }]}>
                      {/* Point 1 */}
                      <View style={[styles.lineNode, { bottom: pos1, backgroundColor: color1 }]}>
                        <Text style={styles.nodeTooltip}>
                          {isPercent ? `${val1.toFixed(0)}%` : `৳${Math.round(val1 / 1000)}k`}
                        </Text>
                      </View>

                      {/* Point 2 */}
                      {key2 && (
                        <View style={[styles.lineNode, { bottom: pos2, backgroundColor: color2 }]}>
                          <Text style={styles.nodeTooltipSecondary}>
                            ৳{Math.round(val2 / 1000)}k
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* X Axis Label */}
                    <Text style={styles.xAxisLabel}>{item.shortLabel}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        </ScrollView>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#18181B" />
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backArrow}>⬅</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Business Analytics</Text>
          <Text style={styles.headerSub}>মাসিক ও সাপ্তাহিক ব্যবসায়িক পারফরম্যান্স বিশ্লেষণ</Text>
        </View>
      </View>

      <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scrollContent}>
        {/* VIEW SELECTOR TOGGLE */}
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggleBtn, mode === 'monthly' && styles.toggleBtnActive]}
            onPress={() => handleModeChange('monthly')}
          >
            <Text style={[styles.toggleBtnText, mode === 'monthly' && styles.toggleBtnTextActive]}>Monthly View</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, mode === 'weekly' && styles.toggleBtnActive]}
            onPress={() => handleModeChange('weekly')}
          >
            <Text style={[styles.toggleBtnText, mode === 'weekly' && styles.toggleBtnTextActive]}>Weekly View</Text>
          </TouchableOpacity>
        </View>

        {/* 1. PERIOD OVERVIEW TABLE (DISPLAY ONLY VALID MONTHS/WEEKS >= 80% COVERAGE) */}
        <View style={styles.overviewCard}>
          <Text style={styles.sectionHeaderTitle}>
            📋 Valid {mode === 'monthly' ? 'Months' : 'Weeks'} Overview (≥80% Coverage)
          </Text>

          <View style={styles.tableHeader}>
            <Text style={[styles.tableTh, { width: 85 }]}>{mode === 'monthly' ? 'Month' : 'Date Range'}</Text>
            <Text style={[styles.tableTh, { width: 55, textAlign: 'center' }]}>Coverage</Text>
            <Text style={[styles.tableTh, { width: 50, textAlign: 'center' }]}>Days</Text>
            <Text style={[styles.tableTh, { width: 70, textAlign: 'right' }]}>Sales</Text>
            <Text style={[styles.tableTh, { width: 70, textAlign: 'right' }]}>Expense</Text>
            <Text style={[styles.tableTh, { width: 70, textAlign: 'right' }]}>Profit</Text>
            <Text style={[styles.tableTh, { width: 55, textAlign: 'right' }]}>Ratio</Text>
          </View>

          {validPeriodList.length === 0 ? (
            <Text style={styles.emptyTableText}>কোনো সময়কালে পর্যাপ্ত তথ্য পাওয়া যায়নি (≥80% Submitted Days)।</Text>
          ) : (
            validPeriodList.map((item, idx) => (
              <View key={item.key} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}>
                <Text style={[styles.tableTd, styles.tableTdBold, { width: 85 }]} numberOfLines={1}>{item.shortLabel}</Text>
                <Text style={[styles.tableTd, { width: 55, textAlign: 'center', color: '#10B981', fontWeight: 'bold' }]}>
                  {item.coverage.toFixed(0)}%
                </Text>
                <Text style={[styles.tableTd, { width: 50, textAlign: 'center', color: '#A1A1AA' }]}>
                  {item.submittedDays}/{item.calendarDays}d
                </Text>
                <Text style={[styles.tableTd, { width: 70, textAlign: 'right' }]}>৳{Math.round(item.sales).toLocaleString()}</Text>
                <Text style={[styles.tableTd, { width: 70, textAlign: 'right', color: '#EF4444' }]}>৳{Math.round(item.expense).toLocaleString()}</Text>
                <Text style={[styles.tableTd, styles.tableTdBold, { width: 70, textAlign: 'right', color: item.profit >= 0 ? '#34D399' : '#EF4444' }]}>
                  ৳{Math.round(item.profit).toLocaleString()}
                </Text>
                <Text style={[styles.tableTd, { width: 55, textAlign: 'right', color: '#F59E0B' }]}>{item.ratio.toFixed(1)}%</Text>
              </View>
            ))
          )}
        </View>

        {/* 5. EMPTY STATE IF LESS THAN 2 VALID PERIODS */}
        {validPeriodList.length < 2 ? (
          <View style={styles.insufficientDataCard}>
            <Text style={styles.insufficientDataIcon}>⚠️</Text>
            <Text style={styles.insufficientDataText}>
              কমপক্ষে দুটি সম্পূর্ণ {mode === 'monthly' ? 'মাসের' : 'সপ্তাহের'} তথ্য (≥80% সম্পূর্ণতা) পাওয়া গেলে তুলনা ও গ্রাফ দেখা যাবে।
            </Text>
          </View>
        ) : (
          <>
            {/* 2. COMPARISON SELECTORS */}
            <View style={styles.selectorCard}>
              <Text style={styles.selectorCardTitle}>⚖️ Select Periods for Comparative Insights</Text>

              <View style={styles.selectorRow}>
                {/* Current Period */}
                <View style={{ flex: 1, marginRight: 6 }}>
                  <Text style={styles.fieldLabel}>Current {mode === 'monthly' ? 'Month' : 'Week'}:</Text>
                  <TouchableOpacity
                    style={styles.dropdownBtn}
                    onPress={() => { setCurrentDropdownOpen(!currentDropdownOpen); setCompareDropdownOpen(false); }}
                  >
                    <Text style={styles.dropdownBtnText}>{currentOption ? currentOption.label : 'Select'} ▼</Text>
                  </TouchableOpacity>
                </View>

                {/* Compare With Period */}
                <View style={{ flex: 1, marginLeft: 6 }}>
                  <Text style={styles.fieldLabel}>Compare With:</Text>
                  <TouchableOpacity
                    style={styles.dropdownBtn}
                    onPress={() => { setCompareDropdownOpen(!compareDropdownOpen); setCurrentDropdownOpen(false); }}
                  >
                    <Text style={styles.dropdownBtnText}>{compareOption ? compareOption.label : 'Select'} ▼</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Current Dropdown */}
              {currentDropdownOpen && (
                <View style={styles.dropdownContainer}>
                  {validPeriodList.map(opt => (
                    <TouchableOpacity
                      key={opt.key}
                      style={[styles.dropdownItem, opt.key === currentKey && styles.dropdownItemActive]}
                      onPress={() => {
                        setCurrentKey(opt.key);
                        if (opt.key === compareKey) setCompareKey('');
                        setCurrentDropdownOpen(false);
                      }}
                    >
                      <Text style={[styles.dropdownItemText, opt.key === currentKey && styles.dropdownItemTextActive]}>
                        {opt.label} ({opt.coverage.toFixed(0)}% coverage)
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Compare Dropdown (NEVER ALLOWS SELECTING CURRENT PERIOD) */}
              {compareDropdownOpen && (
                <View style={styles.dropdownContainer}>
                  <Text style={styles.dropdownHeaderNote}>*(Current period is excluded to prevent self-comparison)</Text>
                  {validCompareOptions.map(opt => (
                    <TouchableOpacity
                      key={opt.key}
                      style={[styles.dropdownItem, opt.key === compareKey && styles.dropdownItemActive]}
                      onPress={() => {
                        setCompareKey(opt.key);
                        setCompareDropdownOpen(false);
                      }}
                    >
                      <Text style={[styles.dropdownItemText, opt.key === compareKey && styles.dropdownItemTextActive]}>
                        {opt.label} ({opt.coverage.toFixed(0)}% coverage)
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {!analyticsData ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>তুলনা করার জন্য দুটি ভিন্ন সময়কাল নির্বাচন করুন।</Text>
              </View>
            ) : (
              <>
                {/* NEW: BUSINESS HEALTH SUMMARY CARD (PLACED DIRECTLY ABOVE KPI CARDS) */}
                {healthScoreInfo && (
                  <View style={styles.healthCard}>
                    <Text style={styles.healthCardTitle}>📊 Business Health Score</Text>
                    
                    <View style={styles.healthScoreRow}>
                      <View style={styles.scoreCircle}>
                        <Text style={styles.healthScoreValue}>{healthScoreInfo.score}</Text>
                        <Text style={styles.healthScoreMax}>/ 100</Text>
                      </View>
                      
                      <View style={[styles.healthBadge, { backgroundColor: healthScoreInfo.badge.color }]}>
                        <Text style={styles.healthBadgeText}>
                          {healthScoreInfo.badge.icon} {healthScoreInfo.badge.text}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.healthDivider} />

                    <View style={styles.healthMetricsContainer}>
                      {/* Metric 1: Sales */}
                      <View style={styles.healthMetricItem}>
                        <Text style={styles.healthMetricLabel}>Sales</Text>
                        <Text style={[styles.healthMetricValue, { color: analyticsData.kpis.salesPct >= 0 ? '#10B981' : '#EF4444' }]}>
                          {analyticsData.kpis.salesPct >= 0 ? '▲ +' : '▼ -'}{Math.abs(analyticsData.kpis.salesPct).toFixed(2)}%
                        </Text>
                      </View>

                      {/* Metric 2: Owner Profit */}
                      <View style={styles.healthMetricItem}>
                        <Text style={styles.healthMetricLabel}>Owner Profit</Text>
                        <Text style={[styles.healthMetricValue, { color: analyticsData.kpis.profitPct >= 0 ? '#10B981' : '#EF4444' }]}>
                          {analyticsData.kpis.profitPct >= 0 ? '▲ +' : '▼ -'}{Math.abs(analyticsData.kpis.profitPct).toFixed(2)}%
                        </Text>
                      </View>

                      {/* Metric 3: Expense Ratio */}
                      <View style={styles.healthMetricItem}>
                        <Text style={styles.healthMetricLabel}>Expense Ratio</Text>
                        <Text style={[styles.healthMetricValue, { color: analyticsData.kpis.isRatioImproved ? '#10B981' : '#EF4444' }]}>
                          {analyticsData.kpis.isRatioImproved ? '✅ Improved' : '❌ Worse'}
                        </Text>
                      </View>
                    </View>
                  </View>
                )}

                {/* 4. EXISTING COMPARISON KPI CARDS (PRESERVED INTACT) */}
                <View style={styles.kpiGrid}>
                  {/* Sales Card */}
                  <View style={styles.kpiCard}>
                    <Text style={styles.kpiTitle}>💰 Total Sales</Text>
                    <Text style={styles.kpiValue}>৳{analyticsData.currentData.totalSales.toLocaleString()}</Text>
                    <View style={styles.kpiTrendRow}>
                      <Text style={[styles.kpiTrendText, { color: analyticsData.kpis.salesPct >= 0 ? '#10B981' : '#EF4444' }]}>
                        {analyticsData.kpis.salesPct >= 0 ? '▲' : '▼'} {Math.abs(analyticsData.kpis.salesPct).toFixed(2)}%
                      </Text>
                    </View>
                  </View>

                  {/* Owner Profit Card */}
                  <View style={styles.kpiCard}>
                    <Text style={styles.kpiTitle}>📈 Owner Profit</Text>
                    <Text style={styles.kpiValue}>৳{analyticsData.currentData.ownerProfit.toLocaleString()}</Text>
                    <View style={styles.kpiTrendRow}>
                      <Text style={[styles.kpiTrendText, { color: analyticsData.kpis.profitPct >= 0 ? '#10B981' : '#EF4444' }]}>
                        {analyticsData.kpis.profitPct >= 0 ? '▲' : '▼'} {Math.abs(analyticsData.kpis.profitPct).toFixed(2)}%
                      </Text>
                    </View>
                  </View>

                  {/* Expense Card */}
                  <View style={styles.kpiCard}>
                    <Text style={styles.kpiTitle}>📉 Expense</Text>
                    <Text style={styles.kpiValue}>৳{analyticsData.currentData.totalExpense.toLocaleString()}</Text>
                    <View style={styles.kpiTrendRow}>
                      <Text style={[styles.kpiTrendText, { color: analyticsData.kpis.expensePct <= 0 ? '#10B981' : '#EF4444' }]}>
                        {analyticsData.kpis.expensePct >= 0 ? '▲' : '▼'} {Math.abs(analyticsData.kpis.expensePct).toFixed(2)}%
                      </Text>
                    </View>
                  </View>

                  {/* Expense Ratio Card */}
                  <View style={styles.kpiCard}>
                    <Text style={styles.kpiTitle}>⚖️ Expense Ratio</Text>
                    <Text style={styles.kpiValue}>{analyticsData.kpis.newExpenseRatio.toFixed(2)}%</Text>
                    <View style={styles.kpiBadgeRow}>
                      <Text style={styles.kpiRatioSub}>{analyticsData.kpis.oldExpenseRatio.toFixed(1)}% → {analyticsData.kpis.newExpenseRatio.toFixed(1)}%</Text>
                      <Text style={[styles.kpiBadge, { backgroundColor: analyticsData.kpis.isRatioImproved ? '#065F46' : '#991B1B' }]}>
                        {analyticsData.kpis.isRatioImproved ? 'Improved' : 'Worse'}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* 5. LINE CHART 1: SALES VS OWNER PROFIT TREND */}
                {renderNativeLineChart(
                  `📈 Sales vs Owner Profit Trend (${mode === 'monthly' ? 'Monthly' : 'Weekly'})`,
                  validPeriodList,
                  "sales",
                  "Sales",
                  "profit",
                  "Owner Profit",
                  "#3B82F6",
                  "#10B981"
                )}

                {/* 5. LINE CHART 2: EXPENSE RATIO TREND */}
                {renderNativeLineChart(
                  `📉 Expense Ratio Trend % (${mode === 'monthly' ? 'Monthly' : 'Weekly'})`,
                  validPeriodList,
                  "ratio",
                  "Expense Ratio %",
                  null,
                  null,
                  "#EF4444",
                  null,
                  true
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 0
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#27272A',
    backgroundColor: '#18181B'
  },
  backButton: { marginRight: 12, padding: 4 },
  backArrow: { fontSize: 20, color: '#FFF' },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#FFF' },
  headerSub: { fontSize: 11, color: '#A1A1AA', marginTop: 2 },

  scrollBody: { flex: 1 },
  scrollContent: { padding: 14, paddingBottom: 40 },

  toggleRow: {
    flexDirection: 'row',
    backgroundColor: '#18181B',
    borderRadius: 8,
    padding: 4,
    marginBottom: 14
  },
  toggleBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  toggleBtnActive: { backgroundColor: '#2563EB' },
  toggleBtnText: { color: '#A1A1AA', fontWeight: 'bold', fontSize: 13 },
  toggleBtnTextActive: { color: '#FFF' },

  /* OVERVIEW TABLE */
  overviewCard: {
    backgroundColor: '#18181B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272A',
    padding: 12,
    marginBottom: 14
  },
  sectionHeaderTitle: { color: '#F4F4F5', fontWeight: 'bold', fontSize: 13, marginBottom: 10 },
  tableHeader: {
    flexDirection: 'row',
    justify: 'space-between',
    backgroundColor: '#27272A',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 6,
    marginBottom: 4
  },
  tableTh: { color: '#A1A1AA', fontSize: 10, fontWeight: 'bold' },
  tableRow: {
    flexDirection: 'row',
    justify: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#27272A'
  },
  tableRowAlt: { backgroundColor: '#111113' },
  tableTd: { color: '#E4E4E7', fontSize: 11 },
  tableTdBold: { fontWeight: 'bold' },
  emptyTableText: { color: '#71717A', fontSize: 11, padding: 10, textAlign: 'center' },

  /* INSUFFICIENT DATA CARD */
  insufficientDataCard: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 14
  },
  insufficientDataIcon: { fontSize: 24, marginBottom: 8 },
  insufficientDataText: { color: '#F59E0B', fontSize: 12, fontWeight: 'bold', textAlign: 'center', lineHeight: 18 },

  /* SELECTOR CARD */
  selectorCard: {
    backgroundColor: '#18181B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272A',
    padding: 12,
    marginBottom: 14
  },
  selectorCardTitle: { color: '#60A5FA', fontWeight: 'bold', fontSize: 12, marginBottom: 10 },
  selectorRow: { flexDirection: 'row', justifyContent: 'space-between' },
  fieldLabel: { color: '#A1A1AA', fontSize: 10, marginBottom: 4 },
  dropdownBtn: { backgroundColor: '#27272A', padding: 10, borderRadius: 6, alignItems: 'center' },
  dropdownBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 12 },

  dropdownContainer: { marginTop: 8, backgroundColor: '#27272A', borderRadius: 8, padding: 6 },
  dropdownHeaderNote: { color: '#F59E0B', fontSize: 10, fontStyle: 'italic', marginBottom: 4, paddingHorizontal: 6 },
  dropdownItem: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 4 },
  dropdownItemActive: { backgroundColor: '#3F3F46' },
  dropdownItemText: { color: '#D4D4D8', fontSize: 12 },
  dropdownItemTextActive: { color: '#60A5FA', fontWeight: 'bold' },

  emptyState: { padding: 30, alignItems: 'center' },
  emptyStateText: { color: '#71717A', fontSize: 12 },

  /* NEW: HEALTH SUMMARY CARD */
  healthCard: {
    backgroundColor: '#18181B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F59E0B',
    padding: 14,
    marginBottom: 14
  },
  healthCardTitle: { color: '#F59E0B', fontWeight: 'bold', fontSize: 13, marginBottom: 12 },
  healthScoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  scoreCircle: { flexDirection: 'row', alignItems: 'baseline' },
  healthScoreValue: { color: '#FFF', fontSize: 32, fontWeight: 'bold', marginRight: 4 },
  healthScoreMax: { color: '#71717A', fontSize: 14, fontWeight: 'bold' },
  healthBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  healthBadgeText: { color: '#FFF', fontWeight: 'bold', fontSize: 11 },

  healthDivider: { height: 1, backgroundColor: '#27272A', marginVertical: 10 },
  healthMetricsContainer: { flexDirection: 'row', justifyContent: 'space-between' },
  healthMetricItem: { flex: 1, alignItems: 'center' },
  healthMetricLabel: { color: '#A1A1AA', fontSize: 10, marginBottom: 4 },
  healthMetricValue: { fontSize: 12, fontWeight: 'bold' },

  /* KPIS */
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  kpiCard: { width: '48%', backgroundColor: '#18181B', borderWidth: 1, borderColor: '#27272A', borderRadius: 10, padding: 12 },
  kpiTitle: { color: '#A1A1AA', fontSize: 11, marginBottom: 4 },
  kpiValue: { color: '#FFF', fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  kpiTrendRow: { flexDirection: 'row', alignItems: 'center' },
  kpiTrendText: { fontSize: 12, fontWeight: 'bold' },
  kpiBadgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  kpiRatioSub: { color: '#A1A1AA', fontSize: 9 },
  kpiBadge: { color: '#FFF', fontSize: 9, fontWeight: 'bold', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },

  /* LINE CHART CARD */
  chartCard: {
    backgroundColor: '#18181B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272A',
    padding: 12,
    paddingTop: 16,
    marginBottom: 14
  },
  chartTitle: { color: '#FFF', fontWeight: 'bold', fontSize: 13, marginBottom: 8 },
  legendRow: { flexDirection: 'row', gap: 14, marginBottom: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  legendText: { color: '#A1A1AA', fontSize: 11 },

  lineChartStage: { paddingVertical: 16, paddingTop: 20 },
  gridLineContainer: { position: 'absolute', top: 20, left: 0, right: 0, bottom: 25, justifyContent: 'space-between' },
  gridLine: { borderBottomWidth: 1, borderBottomColor: '#27272A', width: '100%' },

  nodesRow: { flexDirection: 'row', gap: 28, paddingHorizontal: 14 },
  nodeColumn: { alignItems: 'center', width: 50 },
  lineTrackArea: { width: '100%', alignItems: 'center' },
  lineNode: { position: 'absolute', width: 8, height: 8, borderRadius: 4, alignItems: 'center' },
  nodeTooltip: { position: 'absolute', top: -16, color: '#FFF', fontSize: 9, fontWeight: 'bold', minWidth: 40, textAlign: 'center' },
  nodeTooltipSecondary: { position: 'absolute', bottom: -16, color: '#A1A1AA', fontSize: 9, fontWeight: 'bold', minWidth: 40, textAlign: 'center' },
  xAxisLabel: { color: '#71717A', fontSize: 10, fontWeight: 'bold', marginTop: 10 }
});
