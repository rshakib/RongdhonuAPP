import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Dimensions,
  Platform
} from 'react-native';
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Search,
  SlidersHorizontal,
  FileText,
  X,
  Wallet,
  ShoppingBag,
  Coins,
  TrendingUp,
  BarChart3,
  CloudDownload,
  Pencil,
  Milk,
  Drumstick,
  Sandwich,
  Package,
  Landmark
} from 'lucide-react-native';
import { formatDisplayDate } from '../database';

const monthNamesBangla = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
];

/**
 * Modern Deposit Report Modal (জমা রিপোর্ট)
 * UI redesigned to match reference design:
 * - Premium dark header with rounded top handle and icon
 * - Modern 2-column Month & Year selectors
 * - 2x2 pastel summary cards (মোট বিক্রয়, মোট খরচ, মোট জমা, মোট দিন)
 * - Rounded search bar with date filtering + filter toggle
 * - Clean report table with primary columns & horizontal scroll for all columns
 * - Prominent monthly total row
 * - Vibrant purple "PDF ডাউনলোড" and secondary dark action buttons
 * - 100% preservation of all existing data, queries, calculations, and handlers
 */
export default function DepositReportModal({
  visible,
  onClose,
  selectedMonth = 0,
  selectedYear = 2026,
  monthNames = [],
  onOpenMonthPicker,
  onOpenYearPicker,
  history = [],
  onHistoricalMonthDownload,
  activeFilter = '',
  onSelectDay,
  onEditPastAccount,
  onExportPDF,
  isAdmin = false,
  breakdownSummary = true
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllColumns, setShowAllColumns] = useState(false);

  // Month calculations strictly reusing existing data logic
  const totalSell = useMemo(() => {
    return history.reduce((sum, i) => sum + (Number(i.sell) || 0), 0);
  }, [history]);

  const totalExpense = useMemo(() => {
    return history.reduce((sum, i) => sum + (Number(i.expense) || 0), 0);
  }, [history]);

  const totalDeposit = useMemo(() => {
    return history.reduce((sum, i) => sum + (Number(i.deposit) || 0), 0);
  }, [history]);

  const totalDays = history.length;

  // Breakdown totals for all columns
  const totalBkash = useMemo(() => history.reduce((s, i) => s + (Number(i.breakdown?.bkash ?? i.bkash_payment) || 0), 0), [history]);
  const totalNagad = useMemo(() => history.reduce((s, i) => s + (Number(i.breakdown?.nagad ?? i.nagad_payment) || 0), 0), [history]);
  const totalCash = useMemo(() => history.reduce((s, i) => s + (Number(i.breakdown?.cash ?? i.cash_payment) || 0), 0), [history]);
  const totalDeliv = useMemo(() => history.reduce((s, i) => s + (Number(i.breakdown?.delivery_sell ?? i.delivery_sell) || 0), 0), [history]);
  const totalDudu = useMemo(() => history.reduce((s, i) => s + (Number(i.breakdown?.dudu ?? i.dudu_store ?? i.dudu) || 0), 0), [history]);
  const totalAkash = useMemo(() => history.reduce((s, i) => s + (Number(i.breakdown?.akash ?? i.akash_murgi ?? i.akash) || 0), 0), [history]);
  const totalBurger = useMemo(() => history.reduce((s, i) => s + (Number(i.breakdown?.burger ?? i.burger_bun ?? i.burger) || 0), 0), [history]);
  const totalBazar = useMemo(() => history.reduce((s, i) => s + (Number(i.breakdown?.bazar ?? i.bazar) || 0), 0), [history]);
  const totalOthers = useMemo(() => history.reduce((s, i) => s + (Number(i.breakdown?.others ?? i.others) || 0), 0), [history]);
  const totalIjara = useMemo(() => history.reduce((s, i) => s + (Number(i.breakdown?.ijara ?? i.eja ?? i.ijara) || 0), 0), [history]);

  // Structured Expense Breakdown Categories (2-column grid)
  const expenseCategories = useMemo(() => [
    {
      id: 'dudu',
      name: 'দুধ মিয়া',
      amount: totalDudu,
      Icon: Milk,
      color: '#38BDF8'
    },
    {
      id: 'akash',
      name: 'আকাশ মুরগী',
      amount: totalAkash,
      Icon: Drumstick,
      color: '#F87171'
    },
    {
      id: 'burger',
      name: 'বার্গার বান',
      amount: totalBurger,
      Icon: Sandwich,
      color: '#FBBF24'
    },
    {
      id: 'bazar',
      name: 'বাজার খরচ',
      amount: totalBazar,
      Icon: ShoppingBag,
      color: '#34D399'
    },
    {
      id: 'others',
      name: 'অন্যান্য',
      amount: totalOthers,
      Icon: Package,
      color: '#A78BFA'
    },
    {
      id: 'ijara',
      name: 'ইজারা',
      amount: totalIjara,
      Icon: Landmark,
      color: '#60A5FA'
    }
  ], [totalDudu, totalAkash, totalBurger, totalBazar, totalOthers, totalIjara]);

  // Search filtering strictly preserves records
  const filteredRecords = useMemo(() => {
    if (!searchQuery.trim()) return history;
    const q = searchQuery.trim().toLowerCase();
    return history.filter(item => {
      const displayDate = formatDisplayDate(item.date).toLowerCase();
      const rawDate = String(item.date || '').toLowerCase();
      return displayDate.includes(q) || rawDate.includes(q);
    });
  }, [history, searchQuery]);

  const monthLabel = monthNames[selectedMonth] || 'মাস';
  const banglaMonth = monthNamesBangla[selectedMonth] || monthLabel;

  // Expense and Deposit percentages based on actual numbers
  const expensePct = totalSell > 0 ? Math.round((totalExpense / totalSell) * 100) : 0;
  const depositPct = totalSell > 0 ? Math.round((totalDeposit / totalSell) * 100) : 0;

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent={true}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Top Grabber Handle */}
          <View style={styles.grabberBar} />

          {/* Header Row */}
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIconContainer}>
                <BarChart3 size={24} color="#FFB703" strokeWidth={2.2} />
              </View>
              <View>
                <Text style={styles.headerTitle}>জমা রিপোর্ট</Text>
                <Text style={styles.headerSubtitle}>পুরো মাসের দৈনিক হিসাব</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <X size={18} color="#94A3B8" strokeWidth={2.2} />
            </TouchableOpacity>
          </View>

          {/* Main Scrollable View for Content */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollBody}
            keyboardShouldPersistTaps="handled"
            style={{ flex: 1 }}
          >
            {/* Month & Year Selection Row */}
            <View style={styles.selectorRow}>
              <View style={styles.selectorCol}>
                <Text style={styles.selectorLabel}>মাস নির্বাচন করুন</Text>
                <TouchableOpacity
                  style={styles.selectorCard}
                  onPress={onOpenMonthPicker}
                  activeOpacity={0.75}
                >
                  <View style={styles.selectorCardLeft}>
                    <Calendar size={16} color="#FFB703" strokeWidth={2} />
                    <Text style={styles.selectorValue} numberOfLines={1}>{monthLabel}</Text>
                  </View>
                  <ChevronDown size={16} color="#94A3B8" strokeWidth={2} />
                </TouchableOpacity>
              </View>

              <View style={styles.selectorCol}>
                <Text style={styles.selectorLabel}>বছর নির্বাচন করুন</Text>
                <TouchableOpacity
                  style={styles.selectorCard}
                  onPress={onOpenYearPicker}
                  activeOpacity={0.75}
                >
                  <View style={styles.selectorCardLeft}>
                    <Calendar size={16} color="#FFB703" strokeWidth={2} />
                    <Text style={styles.selectorValue} numberOfLines={1}>{selectedYear}</Text>
                  </View>
                  <ChevronDown size={16} color="#94A3B8" strokeWidth={2} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Persistent Cloud Catch-up Banner */}
            {Boolean(onHistoricalMonthDownload) && (
              <View style={styles.cloudBanner}>
                <View style={styles.cloudBannerTextContainer}>
                  <Text style={styles.cloudBannerText}>
                    ⚠️ এই মাসের সম্পূর্ণ ডাটা লোকাল ডিভাইসে নাও থাকতে পারে।
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.cloudDownloadBtn}
                  onPress={() => {
                    const monthStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;
                    onHistoricalMonthDownload(monthStr, activeFilter);
                  }}
                  activeOpacity={0.8}
                >
                  <CloudDownload size={13} color="#34D399" strokeWidth={2} style={{ marginRight: 5 }} />
                  <Text style={styles.cloudDownloadText}>ক্লাউড সিঙ্ক</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* 2x2 Summary Cards Grid */}
            <View style={styles.summaryGrid}>
              {/* Row 1 */}
              <View style={styles.summaryRow}>
                {/* Card 1: মোট বিক্রয় */}
                <View style={[styles.summaryCard, styles.cardSales]}>
                  <View style={[styles.cardIconBox, styles.iconBoxSales]}>
                    <Wallet size={20} color="#34D399" strokeWidth={2.2} />
                  </View>
                  <View style={styles.cardContent}>
                    <Text style={styles.cardLabel}>মোট বিক্রয়</Text>
                    <Text style={[styles.cardAmount, styles.amountSales]}>
                      ৳ {totalSell.toLocaleString()}
                    </Text>
                  </View>
                </View>

                {/* Card 2: মোট খরচ */}
                <View style={[styles.summaryCard, styles.cardExpense]}>
                  <View style={[styles.cardIconBox, styles.iconBoxExpense]}>
                    <ShoppingBag size={20} color="#EF4444" strokeWidth={2.2} />
                  </View>
                  <View style={styles.cardContent}>
                    <Text style={styles.cardLabel}>মোট খরচ</Text>
                    <Text style={[styles.cardAmount, styles.amountExpense]}>
                      ৳ {totalExpense.toLocaleString()}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Row 2 */}
              <View style={styles.summaryRow}>
                {/* Card 3: মোট জমা */}
                <View style={[styles.summaryCard, styles.cardDeposit]}>
                  <View style={[styles.cardIconBox, styles.iconBoxDeposit]}>
                    <Coins size={20} color="#FFB703" strokeWidth={2.2} />
                  </View>
                  <View style={styles.cardContent}>
                    <Text style={styles.cardLabel}>মোট জমা</Text>
                    <Text style={[styles.cardAmount, styles.amountDeposit]}>
                      ৳ {totalDeposit.toLocaleString()}
                    </Text>
                  </View>
                </View>

                {/* Card 4: মোট দিন */}
                <View style={[styles.summaryCard, styles.cardDays]}>
                  <View style={[styles.cardIconBox, styles.iconBoxDays]}>
                    <Calendar size={20} color="#60A5FA" strokeWidth={2.2} />
                  </View>
                  <View style={styles.cardContent}>
                    <Text style={styles.cardLabel}>মোট দিন</Text>
                    <Text style={[styles.cardAmount, styles.amountDays]}>
                      {totalDays}
                    </Text>
                    <Text style={styles.cardSubDays} numberOfLines={1}>
                      {banglaMonth} {selectedYear}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Search & Filter Bar */}
            <View style={styles.searchBarRow}>
              <View style={styles.searchField}>
                <Search size={16} color="#64748B" strokeWidth={2} style={{ marginRight: 8 }} />
                <TextInput
                  placeholder="তারিখ দিয়ে সার্চ করুন..."
                  placeholderTextColor="#64748B"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  style={styles.searchInput}
                  returnKeyType="search"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setSearchQuery('')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <X size={14} color="#94A3B8" />
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity
                style={[styles.filterToggleBtn, showAllColumns && styles.filterToggleBtnActive]}
                onPress={() => setShowAllColumns(!showAllColumns)}
                activeOpacity={0.75}
              >
                <SlidersHorizontal
                  size={18}
                  color={showAllColumns ? '#FFB703' : '#94A3B8'}
                  strokeWidth={2}
                />
              </TouchableOpacity>
            </View>

            {/* Daily Report Table Section */}
            <View style={styles.tableCard}>
              {showAllColumns ? (
                <ScrollView
                  horizontal={true}
                  scrollEnabled={showAllColumns}
                  showsHorizontalScrollIndicator={true}
                  nestedScrollEnabled={true}
                >
                  <View style={{ minWidth: 1160 }}>
                    {/* Table Header Row (All Columns) */}
                    <View style={styles.tableHeader}>
                      {/* Primary Column 1: তারিখ */}
                      <View style={[styles.thCell, { width: 95 }]}>
                        <Calendar size={11} color="#818CF8" strokeWidth={2} style={{ marginRight: 4 }} />
                        <Text style={styles.thText}>তারিখ</Text>
                      </View>

                      {/* Primary Column 2: মোট বিক্রয় */}
                      <View style={[styles.thCell, { width: 75, justifyContent: 'flex-end' }]}>
                        <BarChart3 size={11} color="#34D399" strokeWidth={2} style={{ marginRight: 4 }} />
                        <Text style={styles.thText}>মোট বিক্রয়</Text>
                      </View>

                      {/* Breakdown Columns (when showAllColumns is true) */}
                      <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                        <Text style={styles.thText}>bKash</Text>
                      </View>
                      <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                        <Text style={styles.thText}>Nagad</Text>
                      </View>
                      <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                        <Text style={styles.thText}>Cash</Text>
                      </View>
                      <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                        <Text style={styles.thText}>🛵 Deliv</Text>
                      </View>
                      <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                        <Text style={styles.thText}>🛍️ দুদু</Text>
                      </View>
                      <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                        <Text style={styles.thText}>🐔 আকাশ</Text>
                      </View>
                      <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                        <Text style={styles.thText}>🍔 বার্গার</Text>
                      </View>
                      <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                        <Text style={styles.thText}>🛒 বাজার</Text>
                      </View>
                      <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                        <Text style={styles.thText}>📦 অন্য</Text>
                      </View>
                      <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                        <Text style={styles.thText}>🏛️ ইজা</Text>
                      </View>

                      {/* Primary Column 3: মোট খরচ */}
                      <View style={[styles.thCell, { width: 75, justifyContent: 'flex-end' }]}>
                        <ShoppingBag size={11} color="#F87171" strokeWidth={2} style={{ marginRight: 4 }} />
                        <Text style={styles.thText}>মোট খরচ</Text>
                      </View>

                      {/* Primary Column 4: জমা */}
                      <View style={[styles.thCell, { width: 85, justifyContent: 'flex-end' }]}>
                        <Coins size={11} color="#60A5FA" strokeWidth={2} style={{ marginRight: 4 }} />
                        <Text style={styles.thText}>জমা</Text>
                      </View>
                    </View>

                    {/* Table Rows Body (All Columns) */}
                    <ScrollView
                      style={{ maxHeight: 200 }}
                      nestedScrollEnabled={true}
                      showsVerticalScrollIndicator={true}
                    >
                      {filteredRecords.length === 0 ? (
                        <View style={styles.emptyTableContainer}>
                          <Text style={styles.emptyTableText}>
                            {searchQuery
                              ? 'সার্চে কোনো রেকর্ড পাওয়া যায়নি।'
                              : 'কোনো জমা ইতিহাস পাওয়া যায়নি।'}
                          </Text>
                          {Boolean(onHistoricalMonthDownload) && (
                            <TouchableOpacity
                              style={styles.emptyDownloadBtn}
                              onPress={() => {
                                const monthStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;
                                onHistoricalMonthDownload(monthStr, activeFilter);
                              }}
                            >
                              <CloudDownload size={14} color="#000" strokeWidth={2} style={{ marginRight: 6 }} />
                              <Text style={styles.emptyDownloadBtnText}>ক্লাউড থেকে ডাটা আনুন</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      ) : (
                        filteredRecords.map((item, index) => {
                          const isAlt = index % 2 === 1;
                          return (
                            <TouchableOpacity
                              key={item.id || item.date || index}
                              style={[styles.tableRow, isAlt && styles.tableRowAlt]}
                              activeOpacity={0.75}
                              onPress={() => onSelectDay && onSelectDay(item)}
                            >
                              {/* Date Cell */}
                              <View style={[styles.tdCell, { width: 95 }]}>
                                <Text style={styles.tdDateText} numberOfLines={1}>
                                  {formatDisplayDate(item.date)}
                                </Text>
                                {Boolean(item.isManualEntry) && (
                                  <View style={styles.manualBadge}>
                                    <Text style={styles.manualBadgeText}>M</Text>
                                  </View>
                                )}
                                {Boolean(onEditPastAccount) && (
                                  <TouchableOpacity
                                    onPress={(e) => {
                                      e.stopPropagation();
                                      onEditPastAccount(item);
                                    }}
                                    style={styles.inlineEditBtn}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  >
                                    <Pencil size={11} color="#FFB703" strokeWidth={2} />
                                  </TouchableOpacity>
                                )}
                              </View>

                              {/* Sell Cell */}
                              <View style={[styles.tdCell, { width: 75, justifyContent: 'flex-end' }]}>
                                <Text style={styles.tdSalesText} numberOfLines={1}>
                                  ৳ {(Number(item.sell) || 0).toLocaleString()}
                                </Text>
                              </View>

                              {/* Breakdown Cells */}
                              <View style={[styles.tdCell, { width: 70, justifyContent: 'flex-end' }]}>
                                <Text style={styles.tdMutedText} numberOfLines={1}>৳ {(Number(item.breakdown?.bkash) || 0).toLocaleString()}</Text>
                              </View>
                              <View style={[styles.tdCell, { width: 70, justifyContent: 'flex-end' }]}>
                                <Text style={styles.tdMutedText} numberOfLines={1}>৳ {(Number(item.breakdown?.nagad) || 0).toLocaleString()}</Text>
                              </View>
                              <View style={[styles.tdCell, { width: 70, justifyContent: 'flex-end' }]}>
                                <Text style={styles.tdMutedText} numberOfLines={1}>৳ {(Number(item.breakdown?.cash) || 0).toLocaleString()}</Text>
                              </View>
                              <View style={[styles.tdCell, { width: 70, justifyContent: 'flex-end' }]}>
                                <Text style={styles.tdMutedText} numberOfLines={1}>৳ {(Number(item.breakdown?.delivery_sell) || 0).toLocaleString()}</Text>
                              </View>
                              <View style={[styles.tdCell, { width: 70, justifyContent: 'flex-end' }]}>
                                <Text style={styles.tdMutedText} numberOfLines={1}>৳ {(Number(item.breakdown?.dudu) || 0).toLocaleString()}</Text>
                              </View>
                              <View style={[styles.tdCell, { width: 70, justifyContent: 'flex-end' }]}>
                                <Text style={styles.tdMutedText} numberOfLines={1}>৳ {(Number(item.breakdown?.akash) || 0).toLocaleString()}</Text>
                              </View>
                              <View style={[styles.tdCell, { width: 70, justifyContent: 'flex-end' }]}>
                                <Text style={styles.tdMutedText} numberOfLines={1}>৳ {(Number(item.breakdown?.burger) || 0).toLocaleString()}</Text>
                              </View>
                              <View style={[styles.tdCell, { width: 70, justifyContent: 'flex-end' }]}>
                                <Text style={styles.tdMutedText} numberOfLines={1}>৳ {(Number(item.breakdown?.bazar) || 0).toLocaleString()}</Text>
                              </View>
                              <View style={[styles.tdCell, { width: 70, justifyContent: 'flex-end' }]}>
                                <Text style={styles.tdMutedText} numberOfLines={1}>৳ {(Number(item.breakdown?.others) || 0).toLocaleString()}</Text>
                              </View>
                              <View style={[styles.tdCell, { width: 70, justifyContent: 'flex-end' }]}>
                                <Text style={styles.tdMutedText} numberOfLines={1}>৳ {(Number(item.breakdown?.ijara) || 0).toLocaleString()}</Text>
                              </View>

                              {/* Expense Cell */}
                              <View style={[styles.tdCell, { width: 75, justifyContent: 'flex-end' }]}>
                                <Text style={styles.tdExpenseText} numberOfLines={1}>
                                  ৳ {(Number(item.expense) || 0).toLocaleString()}
                                </Text>
                              </View>

                              {/* Deposit Cell with Chevron */}
                              <View style={[styles.tdCell, { width: 85, justifyContent: 'flex-end', flexDirection: 'row', alignItems: 'center' }]}>
                                <Text style={styles.tdDepositText} numberOfLines={1}>
                                  ৳ {(Number(item.deposit) || 0).toLocaleString()}
                                </Text>
                                <ChevronRight size={11} color="#64748B" strokeWidth={2.2} style={{ marginLeft: 3 }} />
                              </View>
                            </TouchableOpacity>
                          );
                        })
                      )}
                    </ScrollView>

                    {/* Table Footer (All Columns) */}
                    {history.length > 0 && (
                      <View style={styles.tableFooter}>
                        <View style={[styles.thCell, { width: 95 }]}>
                          <BarChart3 size={11} color="#818CF8" strokeWidth={2} style={{ marginRight: 4 }} />
                          <Text style={styles.footerLabel} numberOfLines={1}>মোট (Total)</Text>
                        </View>

                        <View style={[styles.thCell, { width: 75, justifyContent: 'flex-end' }]}>
                          <Text style={styles.footerSales} numberOfLines={1}>
                            ৳ {totalSell.toLocaleString()}
                          </Text>
                        </View>

                        <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                          <Text style={styles.footerMuted} numberOfLines={1}>৳ {totalBkash.toLocaleString()}</Text>
                        </View>
                        <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                          <Text style={styles.footerMuted} numberOfLines={1}>৳ {totalNagad.toLocaleString()}</Text>
                        </View>
                        <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                          <Text style={styles.footerMuted} numberOfLines={1}>৳ {totalCash.toLocaleString()}</Text>
                        </View>
                        <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                          <Text style={styles.footerMuted} numberOfLines={1}>৳ {totalDeliv.toLocaleString()}</Text>
                        </View>
                        <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                          <Text style={styles.footerMuted} numberOfLines={1}>৳ {totalDudu.toLocaleString()}</Text>
                        </View>
                        <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                          <Text style={styles.footerMuted} numberOfLines={1}>৳ {totalAkash.toLocaleString()}</Text>
                        </View>
                        <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                          <Text style={styles.footerMuted} numberOfLines={1}>৳ {totalBurger.toLocaleString()}</Text>
                        </View>
                        <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                          <Text style={styles.footerMuted} numberOfLines={1}>৳ {totalBazar.toLocaleString()}</Text>
                        </View>
                        <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                          <Text style={styles.footerMuted} numberOfLines={1}>৳ {totalOthers.toLocaleString()}</Text>
                        </View>
                        <View style={[styles.thCell, { width: 70, justifyContent: 'flex-end' }]}>
                          <Text style={styles.footerMuted} numberOfLines={1}>৳ {totalIjara.toLocaleString()}</Text>
                        </View>

                        <View style={[styles.thCell, { width: 75, justifyContent: 'flex-end' }]}>
                          <Text style={styles.footerExpense} numberOfLines={1}>
                            ৳ {totalExpense.toLocaleString()}
                          </Text>
                        </View>

                        <View style={[styles.thCell, { width: 85, justifyContent: 'flex-end' }]}>
                          <Text style={styles.footerDeposit} numberOfLines={1}>
                            ৳ {totalDeposit.toLocaleString()}
                          </Text>
                        </View>
                      </View>
                    )}
                  </View>
                </ScrollView>
              ) : (
                <View style={styles.tableInnerCard}>
                  {/* Table Header Row (4 Primary Columns) */}
                  <View style={styles.tableHeader}>
                    {/* Primary Column 1: তারিখ */}
                    <View style={[styles.thCell, styles.col1]}>
                      <Calendar size={11} color="#818CF8" strokeWidth={2} style={{ marginRight: 4 }} />
                      <Text style={styles.thText}>তারিখ</Text>
                    </View>

                    {/* Primary Column 2: মোট বিক্রয় */}
                    <View style={[styles.thCell, styles.col2, { justifyContent: 'flex-end' }]}>
                      <BarChart3 size={11} color="#34D399" strokeWidth={2} style={{ marginRight: 4 }} />
                      <Text style={styles.thText}>মোট বিক্রয়</Text>
                    </View>

                    {/* Primary Column 3: মোট খরচ */}
                    <View style={[styles.thCell, styles.col3, { justifyContent: 'flex-end' }]}>
                      <ShoppingBag size={11} color="#F87171" strokeWidth={2} style={{ marginRight: 4 }} />
                      <Text style={styles.thText}>মোট খরচ</Text>
                    </View>

                    {/* Primary Column 4: জমা */}
                    <View style={[styles.thCell, styles.col4, { justifyContent: 'flex-end' }]}>
                      <Coins size={11} color="#60A5FA" strokeWidth={2} style={{ marginRight: 4 }} />
                      <Text style={styles.thText}>জমা</Text>
                    </View>
                  </View>

                  {/* Table Rows Body (4 Primary Columns) */}
                  <ScrollView
                    style={{ maxHeight: 200 }}
                    nestedScrollEnabled={true}
                    showsVerticalScrollIndicator={true}
                  >
                    {filteredRecords.length === 0 ? (
                      <View style={styles.emptyTableContainer}>
                        <Text style={styles.emptyTableText}>
                          {searchQuery
                            ? 'সার্চে কোনো রেকর্ড পাওয়া যায়নি।'
                            : 'কোনো জমা ইতিহাস পাওয়া যায়নি।'}
                        </Text>
                        {Boolean(onHistoricalMonthDownload) && (
                          <TouchableOpacity
                            style={styles.emptyDownloadBtn}
                            onPress={() => {
                              const monthStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;
                              onHistoricalMonthDownload(monthStr, activeFilter);
                            }}
                          >
                            <CloudDownload size={14} color="#000" strokeWidth={2} style={{ marginRight: 6 }} />
                            <Text style={styles.emptyDownloadBtnText}>ক্লাউড থেকে ডাটা আনুন</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ) : (
                      filteredRecords.map((item, index) => {
                        const isAlt = index % 2 === 1;
                        return (
                          <TouchableOpacity
                            key={item.id || item.date || index}
                            style={[styles.tableRow, isAlt && styles.tableRowAlt]}
                            activeOpacity={0.75}
                            onPress={() => onSelectDay && onSelectDay(item)}
                          >
                            {/* Date Cell */}
                            <View style={[styles.tdCell, styles.col1]}>
                              <Text style={styles.tdDateText} numberOfLines={1}>
                                {formatDisplayDate(item.date)}
                              </Text>
                              {Boolean(item.isManualEntry) && (
                                <View style={styles.manualBadge}>
                                  <Text style={styles.manualBadgeText}>M</Text>
                                </View>
                              )}
                              {Boolean(onEditPastAccount) && (
                                <TouchableOpacity
                                  onPress={(e) => {
                                    e.stopPropagation();
                                    onEditPastAccount(item);
                                  }}
                                  style={styles.inlineEditBtn}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                >
                                  <Pencil size={11} color="#FFB703" strokeWidth={2} />
                                </TouchableOpacity>
                              )}
                            </View>

                            {/* Sell Cell */}
                            <View style={[styles.tdCell, styles.col2, { justifyContent: 'flex-end' }]}>
                              <Text style={styles.tdSalesText} numberOfLines={1}>
                                ৳ {(Number(item.sell) || 0).toLocaleString()}
                              </Text>
                            </View>

                            {/* Expense Cell */}
                            <View style={[styles.tdCell, styles.col3, { justifyContent: 'flex-end' }]}>
                              <Text style={styles.tdExpenseText} numberOfLines={1}>
                                ৳ {(Number(item.expense) || 0).toLocaleString()}
                              </Text>
                            </View>

                            {/* Deposit Cell with Chevron */}
                            <View style={[styles.tdCell, styles.col4, { justifyContent: 'flex-end', flexDirection: 'row', alignItems: 'center' }]}>
                              <Text style={styles.tdDepositText} numberOfLines={1}>
                                ৳ {(Number(item.deposit) || 0).toLocaleString()}
                              </Text>
                              <ChevronRight size={11} color="#64748B" strokeWidth={2.2} style={{ marginLeft: 3 }} />
                            </View>
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </ScrollView>

                  {/* Monthly Total Row (Bottom of Table) */}
                  {history.length > 0 && (
                    <View style={styles.tableFooter}>
                      <View style={[styles.thCell, styles.col1]}>
                        <BarChart3 size={11} color="#818CF8" strokeWidth={2} style={{ marginRight: 4 }} />
                        <Text style={styles.footerLabel} numberOfLines={1}>মোট (Total)</Text>
                      </View>

                      <View style={[styles.thCell, styles.col2, { justifyContent: 'flex-end' }]}>
                        <Text style={styles.footerSales} numberOfLines={1}>
                          ৳ {totalSell.toLocaleString()}
                        </Text>
                      </View>

                      <View style={[styles.thCell, styles.col3, { justifyContent: 'flex-end' }]}>
                        <Text style={styles.footerExpense} numberOfLines={1}>
                          ৳ {totalExpense.toLocaleString()}
                        </Text>
                      </View>

                      <View style={[styles.thCell, styles.col4, { justifyContent: 'flex-end' }]}>
                        <Text style={styles.footerDeposit} numberOfLines={1}>
                          ৳ {totalDeposit.toLocaleString()}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Monthly Expense Breakdown Section (মাসিক খরচের বিবরণ) */}
            {Boolean(breakdownSummary || isAdmin) && (
              <View style={styles.breakdownCard}>
                <View style={styles.breakdownHeaderRow}>
                  <BarChart3 size={15} color="#FFB703" strokeWidth={2.2} style={{ marginRight: 6 }} />
                  <Text style={styles.breakdownTitle}>মাসিক খরচের বিবরণ (Breakdown)</Text>
                </View>
                <View style={styles.breakdownGrid}>
                  {expenseCategories.map((cat) => {
                    const CategoryIcon = cat.Icon;
                    return (
                      <View key={cat.id} style={styles.breakdownItem}>
                        <View style={styles.breakdownItemTop}>
                          <View style={[styles.breakdownIconWrap, { backgroundColor: `${cat.color}18` }]}>
                            <CategoryIcon size={12} color={cat.color} strokeWidth={2.2} />
                          </View>
                          <Text style={styles.breakdownLabel} numberOfLines={1}>
                            {cat.name}
                          </Text>
                        </View>
                        <Text style={styles.breakdownValue} numberOfLines={1}>
                          ৳ {Number(cat.amount || 0).toLocaleString()}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </ScrollView>

          {/* Bottom Actions Row */}
          <View style={styles.bottomActionsRow}>
            {/* Primary Action: PDF ডাউনলোড */}
            <TouchableOpacity
              style={styles.pdfDownloadBtn}
              onPress={onExportPDF}
              activeOpacity={0.85}
            >
              <FileText size={17} color="#000000" strokeWidth={2.2} style={{ marginRight: 8 }} />
              <Text style={styles.pdfDownloadBtnText}>PDF ডাউনলোড</Text>
            </TouchableOpacity>

            {/* Secondary Action: বন্ধ করুন */}
            <TouchableOpacity
              style={styles.secondaryActionBtn}
              onPress={onClose}
              activeOpacity={0.75}
            >
              <X size={15} color="#FFFFFF" strokeWidth={2.2} style={{ marginRight: 6 }} />
              <Text style={styles.secondaryActionBtnText}>বন্ধ করুন</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  modalContent: {
    width: '100%',
    height: '94%',
    backgroundColor: '#0D0D0D',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: '#262626',
    paddingHorizontal: 11,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 14,
  },
  grabberBar: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#374151',
    alignSelf: 'center',
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 183, 3, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 183, 3, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 11.5,
    color: '#94A3B8',
    marginTop: 2,
    fontWeight: '500',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollBody: {
    paddingBottom: 8,
  },

  /* Month & Year Selectors */
  selectorRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  selectorCol: {
    flex: 1,
  },
  selectorLabel: {
    fontSize: 11,
    color: '#888888',
    marginBottom: 4,
    fontWeight: '600',
  },
  selectorCard: {
    backgroundColor: '#161616',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#262626',
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectorCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  selectorValue: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#FFFFFF',
    flexShrink: 1,
  },

  /* Cloud Catch-up Banner */
  cloudBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  cloudBannerTextContainer: {
    flex: 1,
    marginRight: 8,
  },
  cloudBannerText: {
    color: '#FFB703',
    fontSize: 10.5,
    fontWeight: '600',
  },
  cloudDownloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 183, 3, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FFB703',
  },
  cloudDownloadText: {
    color: '#FFB703',
    fontSize: 10.5,
    fontWeight: '700',
  },

  /* 2x2 Summary Cards */
  summaryGrid: {
    gap: 8,
    marginBottom: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 14,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
  },
  cardIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  cardContent: {
    flex: 1,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  cardAmount: {
    fontSize: 15,
    fontWeight: '800',
    marginVertical: 1,
    letterSpacing: -0.3,
  },

  /* Card 1 - Sales (Mint) */
  cardSales: {
    backgroundColor: '#161616',
    borderColor: 'rgba(52, 211, 153, 0.3)',
  },
  iconBoxSales: {
    backgroundColor: 'rgba(52, 211, 153, 0.12)',
  },
  amountSales: {
    color: '#34D399',
  },

  /* Card 2 - Expense (Red) */
  cardExpense: {
    backgroundColor: '#161616',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  iconBoxExpense: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  amountExpense: {
    color: '#EF4444',
  },

  /* Card 3 - Deposit (Amber/Gold) */
  cardDeposit: {
    backgroundColor: '#161616',
    borderColor: 'rgba(255, 183, 3, 0.3)',
  },
  iconBoxDeposit: {
    backgroundColor: 'rgba(255, 183, 3, 0.12)',
  },
  amountDeposit: {
    color: '#FFB703',
  },

  /* Card 4 - Days (Blue) */
  cardDays: {
    backgroundColor: '#161616',
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  iconBoxDays: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
  },
  amountDays: {
    color: '#FFFFFF',
  },
  cardSubDays: {
    fontSize: 10,
    fontWeight: '600',
    color: '#888888',
  },

  /* Search & Filter Bar */
  searchBarRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  searchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161616',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#262626',
    paddingHorizontal: 10,
    height: 38,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 12.5,
    padding: 0,
  },
  filterToggleBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterToggleBtnActive: {
    borderColor: '#FFB703',
    backgroundColor: 'rgba(255, 183, 3, 0.15)',
  },

  /* Table Container */
  tableCard: {
    backgroundColor: '#141414',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#262626',
    overflow: 'hidden',
    marginBottom: 8,
    width: '100%',
  },
  tableInnerCard: {
    width: '100%',
  },
  col1: {
    flex: 1.35,
    minWidth: 88,
  },
  col2: {
    flex: 0.9,
    minWidth: 64,
  },
  col3: {
    flex: 0.88,
    minWidth: 64,
  },
  col4: {
    flex: 0.87,
    minWidth: 64,
  },
  tableHeader: {
    backgroundColor: '#1A1A1A',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderColor: '#262626',
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  thCell: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#E5E7EB',
  },
  tableRow: {
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderColor: '#202020',
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  tableRowAlt: {
    backgroundColor: '#171717',
  },
  tdCell: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tdDateText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  tdSalesText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#34D399',
  },
  tdExpenseText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#EF4444',
  },
  tdDepositText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFB703',
  },
  tdMutedText: {
    fontSize: 11.5,
    color: '#9CA3AF',
  },
  manualBadge: {
    backgroundColor: '#333333',
    borderRadius: 3,
    paddingHorizontal: 3.5,
    paddingVertical: 1,
    marginLeft: 4,
  },
  manualBadgeText: {
    color: '#FFF',
    fontSize: 8.5,
    fontWeight: 'bold',
  },
  inlineEditBtn: {
    marginLeft: 5,
    padding: 2,
  },
  emptyTableContainer: {
    paddingVertical: 32,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTableText: {
    color: '#888888',
    fontSize: 13,
    marginBottom: 14,
  },
  emptyDownloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#34D399',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
  },
  emptyDownloadBtnText: {
    color: '#000000',
    fontSize: 12.5,
    fontWeight: '700',
  },

  /* Table Footer (Total Row) */
  tableFooter: {
    backgroundColor: '#1A1A1A',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderColor: '#2E2E2E',
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  footerLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#FFB703',
  },
  footerSales: {
    fontSize: 12,
    fontWeight: '800',
    color: '#34D399',
  },
  footerExpense: {
    fontSize: 12,
    fontWeight: '800',
    color: '#EF4444',
  },
  footerDeposit: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFB703',
  },
  footerMuted: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#9CA3AF',
  },

  /* Monthly Expense Breakdown Card */
  breakdownCard: {
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    padding: 10,
    marginTop: 8,
    marginBottom: 6,
  },
  breakdownHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  breakdownTitle: {
    color: '#E5E7EB',
    fontSize: 12,
    fontWeight: '700',
  },
  breakdownGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
  },
  breakdownItem: {
    width: '48.5%',
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  breakdownItemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  breakdownIconWrap: {
    width: 20,
    height: 20,
    borderRadius: 5,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  breakdownLabel: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  breakdownValue: {
    color: '#FFB703',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 1,
  },

  /* Bottom Actions */
  bottomActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  pdfDownloadBtn: {
    flex: 1.2,
    backgroundColor: '#34D399',
    borderRadius: 10,
    paddingVertical: 11,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#34D399',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  pdfDownloadBtnText: {
    color: '#000000',
    fontSize: 13.5,
    fontWeight: 'bold',
  },
  secondaryActionBtn: {
    flex: 0.9,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#333333',
    borderRadius: 10,
    paddingVertical: 11,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryActionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
