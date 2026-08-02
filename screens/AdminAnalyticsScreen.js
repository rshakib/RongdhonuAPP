import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  ActivityIndicator
} from 'react-native';
import {
  getAvailableMonthsForAnalytics,
  getAvailableWeeksForAnalytics,
  buildAnalyticsComparison
} from '../services/analyticsService';

export default function AdminAnalyticsScreen({ onBack }) {
  const [mode, setMode] = useState('monthly'); // 'monthly' or 'weekly'
  const [monthsList, setMonthsList] = useState([]);
  const [weeksList, setWeeksList] = useState([]);
  
  const [currentKey, setCurrentKey] = useState('');
  const [compareKey, setCompareKey] = useState('');

  const [monthDropdownOpen, setMonthDropdownOpen] = useState(false);
  const [compareDropdownOpen, setCompareDropdownOpen] = useState(false);

  // Load available options
  useEffect(() => {
    const m = getAvailableMonthsForAnalytics();
    setMonthsList(m);
    if (m.length >= 2) {
      setCurrentKey(m[0].key);
      setCompareKey(m[1].key);
    } else if (m.length === 1) {
      setCurrentKey(m[0].key);
      setCompareKey(m[0].key);
    }

    const w = getAvailableWeeksForAnalytics();
    setWeeksList(w);
  }, []);

  // When mode changes, switch initial keys
  const handleModeChange = (newMode) => {
    setMode(newMode);
    setMonthDropdownOpen(false);
    setCompareDropdownOpen(false);
    if (newMode === 'monthly') {
      if (monthsList.length >= 2) {
        setCurrentKey(monthsList[0].key);
        setCompareKey(monthsList[1].key);
      } else if (monthsList.length === 1) {
        setCurrentKey(monthsList[0].key);
        setCompareKey(monthsList[0].key);
      }
    } else {
      if (weeksList.length >= 2) {
        setCurrentKey(weeksList[0].key);
        setCompareKey(weeksList[1].key);
      } else if (weeksList.length === 1) {
        setCurrentKey(weeksList[0].key);
        setCompareKey(weeksList[0].key);
      }
    }
  };

  const currentOptions = mode === 'monthly' ? monthsList : weeksList;

  const currentOptionLabel = useMemo(() => {
    const found = currentOptions.find(o => o.key === currentKey);
    return found ? found.label : currentKey;
  }, [currentOptions, currentKey]);

  const compareOptionLabel = useMemo(() => {
    const found = currentOptions.find(o => o.key === compareKey);
    return found ? found.label : compareKey;
  }, [currentOptions, compareKey]);

  // Build Analytics Report Comparison
  const analyticsData = useMemo(() => {
    if (!currentKey || !compareKey) return null;
    return buildAnalyticsComparison(mode, currentKey, compareKey, currentOptionLabel, compareOptionLabel);
  }, [mode, currentKey, compareKey, currentOptionLabel, compareOptionLabel]);

  // SVG-like Bar / Line chart simulation for Vanilla React Native (Pure Native Elements)
  const renderSimpleTrendBarChart = (title, items, dataKey1, label1, dataKey2, label2, color1, color2, isPercent = false) => {
    if (!items || items.length === 0) return null;
    
    // Find max for scaling
    const maxVal = Math.max(...items.map(i => Math.max(i[dataKey1] || 0, i[dataKey2] || 0)), 1);

    return (
      <View style={styles.chartContainer}>
        <Text style={styles.chartTitle}>{title}</Text>
        <View style={styles.chartLegendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: color1 }]} />
            <Text style={styles.legendText}>{label1}</Text>
          </View>
          {dataKey2 && (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: color2 }]} />
              <Text style={styles.legendText}>{label2}</Text>
            </View>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chartScroll}>
          <View style={styles.barsRow}>
            {items.map((item, idx) => {
              const val1 = item[dataKey1] || 0;
              const val2 = dataKey2 ? (item[dataKey2] || 0) : 0;
              const h1 = Math.max(4, (val1 / maxVal) * 110);
              const h2 = dataKey2 ? Math.max(4, (val2 / maxVal) * 110) : 0;

              return (
                <View key={idx} style={styles.barGroup}>
                  <View style={styles.barPair}>
                    <View style={[styles.singleBar, { height: h1, backgroundColor: color1 }]} />
                    {dataKey2 ? <View style={[styles.singleBar, { height: h2, backgroundColor: color2 }]} /> : null}
                  </View>
                  <Text style={styles.barLabel}>{item.date}</Text>
                  <Text style={styles.barValText}>{isPercent ? `${val1.toFixed(0)}%` : `৳${Math.round(val1)}`}</Text>
                </View>
              );
            })}
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
          <Text style={styles.headerSub}>মাসের ও সপ্তাহের ব্যবসায়িক পারফরম্যান্স তুলনা</Text>
        </View>
      </View>

      <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scrollContent}>
        {/* VIEW SELECTOR TOGGLE */}
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggleBtn, mode === 'monthly' && styles.toggleBtnActive]}
            onPress={() => handleModeChange('monthly')}
          >
            <Text style={[styles.toggleBtnText, mode === 'monthly' && styles.toggleBtnTextActive]}>Monthly</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, mode === 'weekly' && styles.toggleBtnActive]}
            onPress={() => handleModeChange('weekly')}
          >
            <Text style={[styles.toggleBtnText, mode === 'weekly' && styles.toggleBtnTextActive]}>Weekly</Text>
          </TouchableOpacity>
        </View>

        {/* COMPARISON SELECTOR CARD */}
        <View style={styles.selectorCard}>
          <Text style={styles.selectorCardTitle}>📊 তুলনা সময়সীমা (Select Comparison)</Text>

          <View style={styles.selectorRow}>
            {/* Current Period Selector */}
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.fieldLabel}>Current {mode === 'monthly' ? 'Month' : 'Week'}:</Text>
              <TouchableOpacity
                style={styles.dropdownBtn}
                onPress={() => { setMonthDropdownOpen(!monthDropdownOpen); setCompareDropdownOpen(false); }}
              >
                <Text style={styles.dropdownBtnText}>{currentOptionLabel} ▼</Text>
              </TouchableOpacity>
            </View>

            {/* Compare Period Selector */}
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.fieldLabel}>Compare With:</Text>
              <TouchableOpacity
                style={styles.dropdownBtn}
                onPress={() => { setCompareDropdownOpen(!compareDropdownOpen); setMonthDropdownOpen(false); }}
              >
                <Text style={styles.dropdownBtnText}>{compareOptionLabel} ▼</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Current Dropdown List */}
          {monthDropdownOpen && (
            <View style={styles.dropdownListContainer}>
              <Text style={styles.dropdownHeader}>সঠিক তথ্য সমৃদ্ধ সময়কাল (≥80% Valid Days):</Text>
              {currentOptions.map(opt => (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.dropdownItem, opt.key === currentKey && styles.dropdownItemActive]}
                  onPress={() => { setCurrentKey(opt.key); setMonthDropdownOpen(false); }}
                >
                  <Text style={[styles.dropdownItemText, opt.key === currentKey && styles.dropdownItemTextActive]}>
                    {opt.label} ({opt.count} days)
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Compare Dropdown List */}
          {compareDropdownOpen && (
            <View style={styles.dropdownListContainer}>
              <Text style={styles.dropdownHeader}>সঠিক তথ্য সমৃদ্ধ সময়কাল (≥80% Valid Days):</Text>
              {currentOptions.map(opt => (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.dropdownItem, opt.key === compareKey && styles.dropdownItemActive]}
                  onPress={() => { setCompareKey(opt.key); setCompareDropdownOpen(false); }}
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
            <Text style={styles.emptyText}>পর্যাপ্ত সময়কাল নির্বাচন করুন (ন্যূনতম ২টি পর্ব প্রয়োজন)।</Text>
          </View>
        ) : (
          <>
            {/* SECTION 3: COMPARISON KPI CARDS */}
            <View style={styles.kpiGrid}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiTitle}>💰 Sales</Text>
                <Text style={styles.kpiValue}>৳{analyticsData.currentData.totalSales.toLocaleString()}</Text>
                <Text style={[styles.kpiPct, { color: analyticsData.kpis.salesPct >= 0 ? '#10B981' : '#EF4444' }]}>
                  {analyticsData.kpis.salesPct >= 0 ? '▲' : '▼'} {Math.abs(analyticsData.kpis.salesPct).toFixed(2)}%
                </Text>
              </View>

              <View style={styles.kpiCard}>
                <Text style={styles.kpiTitle}>📈 Owner Profit</Text>
                <Text style={styles.kpiValue}>৳{analyticsData.currentData.ownerProfit.toLocaleString()}</Text>
                <Text style={[styles.kpiPct, { color: analyticsData.kpis.profitPct >= 0 ? '#10B981' : '#EF4444' }]}>
                  {analyticsData.kpis.profitPct >= 0 ? '▲' : '▼'} {Math.abs(analyticsData.kpis.profitPct).toFixed(2)}%
                </Text>
              </View>

              <View style={styles.kpiCard}>
                <Text style={styles.kpiTitle}>📉 Expense</Text>
                <Text style={styles.kpiValue}>৳{analyticsData.currentData.totalExpense.toLocaleString()}</Text>
                <Text style={[styles.kpiPct, { color: analyticsData.kpis.expensePct <= 0 ? '#10B981' : '#EF4444' }]}>
                  {analyticsData.kpis.expensePct >= 0 ? '▲' : '▼'} {Math.abs(analyticsData.kpis.expensePct).toFixed(2)}%
                </Text>
              </View>

              <View style={styles.kpiCard}>
                <Text style={styles.kpiTitle}>⚖️ Expense Ratio</Text>
                <Text style={styles.kpiValue}>{analyticsData.kpis.oldExpenseRatio.toFixed(1)}% → {analyticsData.kpis.newExpenseRatio.toFixed(1)}%</Text>
                <Text style={[styles.kpiBadge, { backgroundColor: analyticsData.kpis.isRatioImproved ? '#065F46' : '#991B1B' }]}>
                  {analyticsData.kpis.isRatioImproved ? 'Improved' : 'Worse'}
                </Text>
              </View>
            </View>

            {/* SECTION 1: SALES VS OWNER PROFIT TREND */}
            {renderSimpleTrendBarChart(
              "📈 Sales vs Owner Profit Trend",
              analyticsData.currentData.dailyTrend,
              "sales",
              "Sales",
              "profit",
              "Owner Profit",
              "#3B82F6",
              "#10B981"
            )}

            {/* SECTION 2: EXPENSE RATIO TREND */}
            {renderSimpleTrendBarChart(
              "📉 Expense Ratio Trend (%)",
              analyticsData.currentData.dailyTrend,
              "expenseRatio",
              "Expense Ratio %",
              null,
              null,
              "#EF4444",
              null,
              true
            )}

            {/* SECTION 4: AUTOMATED BENGALI BUSINESS REPORT */}
            <View style={styles.reportCard}>
              <Text style={styles.reportTitle}>📝 স্বয়ংক্রিয় ব্যবসায়িক রিপোর্ট (Automated Insights)</Text>
              <Text style={styles.reportText}>{analyticsData.reportText}</Text>
            </View>

            {/* SECTION 5: TOP 3 BUSINESS REASONS */}
            <View style={styles.reasonsCard}>
              <Text style={styles.reasonsTitle}>🎯 প্রধান ৩টি ব্যবসায়িক কারণ (Top Business Reasons)</Text>
              {analyticsData.reasons.length > 0 ? (
                analyticsData.reasons.map((r, i) => (
                  <View key={i} style={styles.reasonRow}>
                    <Text style={styles.reasonText}>{r}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.reasonText}>পর্যাপ্ত বৈসাদৃশ্য পাওয়া যায়নি।</Text>
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
  backButton: { marginRight: 12, padding: 6 },
  backArrow: { fontSize: 20, color: '#FFF' },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#FFF' },
  headerSub: { fontSize: 11, color: '#A1A1AA' },

  scrollBody: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },

  toggleRow: {
    flexDirection: 'row',
    backgroundColor: '#18181B',
    borderRadius: 8,
    padding: 4,
    marginBottom: 16
  },
  toggleBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  toggleBtnActive: { backgroundColor: '#2563EB' },
  toggleBtnText: { color: '#A1A1AA', fontWeight: 'bold', fontSize: 13 },
  toggleBtnTextActive: { color: '#FFF' },

  selectorCard: {
    backgroundColor: '#18181B',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#27272A',
    marginBottom: 16
  },
  selectorCardTitle: { color: '#F4F4F5', fontWeight: 'bold', fontSize: 13, marginBottom: 10 },
  selectorRow: { flexDirection: 'row', justifyContent: 'space-between' },
  fieldLabel: { color: '#A1A1AA', fontSize: 11, marginBottom: 4 },
  dropdownBtn: {
    backgroundColor: '#27272A',
    padding: 10,
    borderRadius: 6,
    alignItems: 'center'
  },
  dropdownBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 12 },

  dropdownListContainer: {
    marginTop: 10,
    backgroundColor: '#27272A',
    borderRadius: 8,
    padding: 8
  },
  dropdownHeader: { color: '#F59E0B', fontSize: 10, marginBottom: 6, fontWeight: 'bold' },
  dropdownItem: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 4 },
  dropdownItemActive: { backgroundColor: '#3F3F46' },
  dropdownItemText: { color: '#D4D4D8', fontSize: 12 },
  dropdownItemTextActive: { color: '#60A5FA', fontWeight: 'bold' },

  emptyState: { padding: 30, alignItems: 'center' },
  emptyText: { color: '#71717A', fontSize: 13 },

  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  kpiCard: {
    width: '48%',
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 10,
    padding: 12
  },
  kpiTitle: { color: '#A1A1AA', fontSize: 11, marginBottom: 4 },
  kpiValue: { color: '#FFF', fontSize: 15, fontWeight: 'bold', marginBottom: 4 },
  kpiPct: { fontSize: 12, fontWeight: 'bold' },
  kpiBadge: {
    alignSelf: 'flex-start',
    color: '#FFF',
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2
  },

  chartContainer: {
    backgroundColor: '#18181B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272A',
    padding: 14,
    marginBottom: 16
  },
  chartTitle: { color: '#FFF', fontWeight: 'bold', fontSize: 13, marginBottom: 8 },
  chartLegendRow: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  legendText: { color: '#A1A1AA', fontSize: 11 },

  chartScroll: { marginTop: 6 },
  barsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingBottom: 6 },
  barGroup: { alignItems: 'center', width: 45 },
  barPair: { flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: 3 },
  singleBar: { width: 14, borderRadius: 3 },
  barLabel: { color: '#71717A', fontSize: 9, marginTop: 4 },
  barValText: { color: '#A1A1AA', fontSize: 8, fontWeight: 'bold' },

  reportCard: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#2563EB',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16
  },
  reportTitle: { color: '#60A5FA', fontWeight: 'bold', fontSize: 13, marginBottom: 8 },
  reportText: { color: '#E4E4E7', fontSize: 12, lineHeight: 18 },

  reasonsCard: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 12,
    padding: 14
  },
  reasonsTitle: { color: '#F59E0B', fontWeight: 'bold', fontSize: 13, marginBottom: 8 },
  reasonRow: { marginBottom: 6 },
  reasonText: { color: '#D4D4D8', fontSize: 12, lineHeight: 17 }
});
