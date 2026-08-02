import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView
} from 'react-native';
import {
  getAvailableMonthsOverview,
  getAvailableWeeksOverview,
  buildAnalyticsComparison
} from '../services/analyticsService';

export default function AdminAnalyticsScreen({ onBack }) {
  const [mode, setMode] = useState('monthly'); // 'monthly' or 'weekly'
  const [monthsOverview, setMonthsOverview] = useState([]);
  const [weeksOverview, setWeeksOverview] = useState([]);
  
  const [currentKey, setCurrentKey] = useState('');
  const [compareKey, setCompareKey] = useState('');

  const [currentDropdownOpen, setCurrentDropdownOpen] = useState(false);
  const [compareDropdownOpen, setCompareDropdownOpen] = useState(false);

  // Load available periods overview on mount
  useEffect(() => {
    const m = getAvailableMonthsOverview();
    setMonthsOverview(m);
    if (m.length >= 2) {
      setCurrentKey(m[m.length - 1].key); // Latest
      setCompareKey(m[m.length - 2].key); // Previous
    } else if (m.length === 1) {
      setCurrentKey(m[0].key);
      setCompareKey('');
    }

    const w = getAvailableWeeksOverview();
    setWeeksOverview(w);
  }, []);

  // Handle Mode Change (Monthly <-> Weekly)
  const handleModeChange = (newMode) => {
    setMode(newMode);
    setCurrentDropdownOpen(false);
    setCompareDropdownOpen(false);
    const list = newMode === 'monthly' ? monthsOverview : weeksOverview;
    if (list.length >= 2) {
      setCurrentKey(list[list.length - 1].key); // Latest
      setCompareKey(list[list.length - 2].key); // Previous
    } else if (list.length === 1) {
      setCurrentKey(list[0].key);
      setCompareKey('');
    } else {
      setCurrentKey('');
      setCompareKey('');
    }
  };

  const periodList = mode === 'monthly' ? monthsOverview : weeksOverview;

  const currentOption = useMemo(() => periodList.find(o => o.key === currentKey), [periodList, currentKey]);
  const compareOption = useMemo(() => periodList.find(o => o.key === compareKey), [periodList, compareKey]);

  // Options available for Compare dropdown (NEVER ALLOW SELECTING CURRENT PERIOD)
  const validCompareOptions = useMemo(() => {
    return periodList.filter(o => o.key !== currentKey);
  }, [periodList, currentKey]);

  // Build Analytics Comparison
  const analyticsData = useMemo(() => {
    if (!currentKey || !compareKey || currentKey === compareKey) return null;
    return buildAnalyticsComparison(mode, currentKey, compareKey, currentOption?.label, compareOption?.label);
  }, [mode, currentKey, compareKey, currentOption, compareOption]);

  // Pure Native Line Chart Renderer for React Native
  const renderNativeLineChart = (title, items, key1, label1, key2, label2, color1, color2, isPercent = false) => {
    if (!items || items.length === 0) return null;

    // Calculate Max Value for Chart Height Scaling
    const maxVal = Math.max(
      ...items.map(i => Math.max(i[key1] || 0, key2 ? (i[key2] || 0) : 0)),
      1
    );

    const chartHeight = 120;

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

            {/* Line Nodes and Connecting Lines */}
            <View style={styles.nodesRow}>
              {items.map((item, idx) => {
                const val1 = item[key1] || 0;
                const val2 = key2 ? (item[key2] || 0) : 0;

                const pos1 = Math.max(8, (val1 / maxVal) * chartHeight);
                const pos2 = key2 ? Math.max(8, (val2 / maxVal) * chartHeight) : 0;

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

        {/* 1. PERIOD OVERVIEW TABLE (ALL VALID PERIODS >= 80% DAYS) */}
        <View style={styles.overviewCard}>
          <Text style={styles.sectionHeaderTitle}>
            📋 Available {mode === 'monthly' ? 'Months' : 'Weeks'} Overview (≥80% Valid Days)
          </Text>

          <View style={styles.tableHeader}>
            <Text style={[styles.tableTh, { width: 85 }]}>Period</Text>
            <Text style={[styles.tableTh, { width: 50, textAlign: 'center' }]}>Days</Text>
            <Text style={[styles.tableTh, { width: 75, textAlign: 'right' }]}>Sales</Text>
            <Text style={[styles.tableTh, { width: 75, textAlign: 'right' }]}>Expense</Text>
            <Text style={[styles.tableTh, { width: 75, textAlign: 'right' }]}>Profit</Text>
            <Text style={[styles.tableTh, { width: 60, textAlign: 'right' }]}>Ratio</Text>
          </View>

          {periodList.length === 0 ? (
            <Text style={styles.emptyTableText}>কোনো সময়কালে পর্যাপ্ত তথ্য পাওয়া যায়নি (≥80% Submitted Days)।</Text>
          ) : (
            periodList.map((item, idx) => (
              <View key={item.key} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}>
                <Text style={[styles.tableTd, styles.tableTdBold, { width: 85 }]}>{item.shortLabel}</Text>
                <Text style={[styles.tableTd, { width: 50, textAlign: 'center', color: '#10B981' }]}>{item.count}d</Text>
                <Text style={[styles.tableTd, { width: 75, textAlign: 'right' }]}>৳{Math.round(item.sales).toLocaleString()}</Text>
                <Text style={[styles.tableTd, { width: 75, textAlign: 'right', color: '#EF4444' }]}>৳{Math.round(item.expense).toLocaleString()}</Text>
                <Text style={[styles.tableTd, styles.tableTdBold, { width: 75, textAlign: 'right', color: item.profit >= 0 ? '#34D399' : '#EF4444' }]}>
                  ৳{Math.round(item.profit).toLocaleString()}
                </Text>
                <Text style={[styles.tableTd, { width: 60, textAlign: 'right', color: '#F59E0B' }]}>{item.ratio.toFixed(1)}%</Text>
              </View>
            ))
          )}
        </View>

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
              {periodList.map(opt => (
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
                    {opt.label} ({opt.count} days)
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
                    {opt.label} ({opt.count} days)
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
            {/* 4. COMPARISON KPI CARDS */}
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
              periodList,
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
              periodList,
              "ratio",
              "Expense Ratio %",
              null,
              null,
              "#EF4444",
              null,
              true
            )}

            {/* 6. AUTOMATED BENGALI BUSINESS REPORT */}
            <View style={styles.reportCard}>
              <Text style={styles.reportCardTitle}>📝 স্বয়ংক্রিয় ব্যবসায়িক রিপোর্ট (Automated Insights)</Text>
              <Text style={styles.reportCardText}>{analyticsData.reportText}</Text>
            </View>

            {/* 7. TOP 3 BUSINESS REASONS */}
            <View style={styles.reasonsCard}>
              <Text style={styles.reasonsCardTitle}>🎯 প্রধান ৩টি ব্যবসায়িক কারণ (Top Business Reasons)</Text>
              {analyticsData.reasons.length > 0 ? (
                analyticsData.reasons.map((r, i) => (
                  <View key={i} style={styles.reasonRow}>
                    <Text style={styles.reasonRowText}>{r}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.reasonRowText}>পর্যাপ্ত বৈসাদৃশ্য পাওয়া যায়নি।</Text>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#27272A',
    backgroundColor: '#18181B'
  },
  backButton: { marginRight: 12, padding: 4 },
  backArrow: { fontSize: 20, color: '#FFF' },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#FFF' },
  headerSub: { fontSize: 11, color: '#A1A1AA' },

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
    marginBottom: 14
  },
  chartTitle: { color: '#FFF', fontWeight: 'bold', fontSize: 13, marginBottom: 8 },
  legendRow: { flexDirection: 'row', gap: 14, marginBottom: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  legendText: { color: '#A1A1AA', fontSize: 11 },

  lineChartStage: { paddingVertical: 10 },
  gridLineContainer: { position: 'absolute', top: 10, left: 0, right: 0, bottom: 25, justifyContent: 'space-between' },
  gridLine: { borderBottomWidth: 1, borderBottomColor: '#27272A', width: '100%' },

  nodesRow: { flexDirection: 'row', gap: 24, paddingHorizontal: 10 },
  nodeColumn: { alignItems: 'center', width: 42 },
  lineTrackArea: { width: '100%', alignItems: 'center' },
  lineNode: { position: 'absolute', width: 8, height: 8, borderRadius: 4, alignItems: 'center' },
  nodeTooltip: { position: 'absolute', top: -14, color: '#FFF', fontSize: 8, fontWeight: 'bold', minWidth: 35, textAlign: 'center' },
  nodeTooltipSecondary: { position: 'absolute', bottom: -14, color: '#A1A1AA', fontSize: 8, fontWeight: 'bold', minWidth: 35, textAlign: 'center' },
  xAxisLabel: { color: '#71717A', fontSize: 10, fontWeight: 'bold', marginTop: 8 },

  /* REPORT CARD */
  reportCard: { backgroundColor: '#18181B', borderWidth: 1, borderColor: '#2563EB', borderRadius: 12, padding: 14, marginBottom: 14 },
  reportCardTitle: { color: '#60A5FA', fontWeight: 'bold', fontSize: 13, marginBottom: 8 },
  reportCardText: { color: '#E4E4E7', fontSize: 12, lineHeight: 18 },

  /* REASONS CARD */
  reasonsCard: { backgroundColor: '#18181B', borderWidth: 1, borderColor: '#27272A', borderRadius: 12, padding: 14 },
  reasonsCardTitle: { color: '#F59E0B', fontWeight: 'bold', fontSize: 13, marginBottom: 8 },
  reasonRow: { marginBottom: 6 },
  reasonRowText: { color: '#D4D4D8', fontSize: 12, lineHeight: 17 }
});
