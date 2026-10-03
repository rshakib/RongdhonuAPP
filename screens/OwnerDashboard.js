        import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Platform,
  StatusBar as RNStatusBar,
  Modal,
  TextInput,
  Alert,
  BackHandler
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { exportSalesReportPDF, exportDepositReportPDF } from '../pdfHelper';
import { formatDisplayDate, getBusinessDate, getDb, getItemSalesReport, getTodaySubmissionDetails } from '../database';
import PrintReceiptModal from '../components/PrintReceiptModal';
import { TodaySalesCard, TotalCashCard, MonthlyTotalCard } from '../components/StatCard';
import OwnerSideMenu from '../components/OwnerSideMenu';
import DepositReportModal from '../components/DepositReportModal';
import PastAccountModal from '../components/PastAccountModal';
import SalesReportModal from '../components/SalesReportModal';
import OrderDetailModal from '../components/OrderDetailModal';

const { width } = Dimensions.get('window');

const toBengaliNumber = (num) => {
  if (num === null || num === undefined) return '';
  const bengaliDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return String(num).replace(/\d/g, d => bengaliDigits[parseInt(d, 10)]);
};

const getBengaliDate = () => {
  const days = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
  const now = new Date();
  const dayName = days[now.getDay()];
  const formattedDate = formatDisplayDate(now);
  return `${formattedDate}, ${dayName}`;
};

const getBengaliMonthRange = () => {
  const months = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
  const d = new Date(Date.now() - 3600000); // Business Day offset
  const monthName = months[d.getMonth()];
  return `(১ ${monthName} - বর্তমান)`;
};

// --- CUSTOM CALENDAR PICKER COMPONENT ---
const CalendarPicker = ({ visible, onClose, onSelectDate, initialDate }) => {
  const [viewDate, setViewDate] = useState(new Date());
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay();

  const currentYear = viewDate.getFullYear();
  const currentMonth = viewDate.getMonth();
  
  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);

  const handlePrevMonth = () => setViewDate(new Date(currentYear, currentMonth - 1, 1));
  const handleNextMonth = () => setViewDate(new Date(currentYear, currentMonth + 1, 1));

  const handleSelect = (day) => {
    const selected = formatDisplayDate(new Date(currentYear, currentMonth, day));
    onSelectDate(selected);
    onClose();
  };

  const calendarDays = [];
  for (let i = 0; i < firstDay; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  return (
    <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.calendarOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.calendarContent}>
          <View style={styles.calendarHeader}>
            <TouchableOpacity onPress={handlePrevMonth}><Text style={styles.calNav}>◀</Text></TouchableOpacity>
            <Text style={styles.calTitle}>{months[currentMonth]} {currentYear}</Text>
            <TouchableOpacity onPress={handleNextMonth}><Text style={styles.calNav}>▶</Text></TouchableOpacity>
          </View>
          <View style={styles.calWeekRow}>
            {days.map((d, i) => <Text key={i} style={styles.calWeekDay}>{d}</Text>)}
          </View>
          <View style={styles.calGrid}>
            {calendarDays.map((day, idx) => (
              <TouchableOpacity 
                key={idx} 
                style={[styles.calDayCell, !day && { opacity: 0 }]} 
                disabled={!day}
                onPress={() => handleSelect(day)}
              >
                <Text style={styles.calDayText}>{day}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.calCloseBtn} onPress={onClose}>
            <Text style={styles.calCloseBtnText}>বন্ধ করুন</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const formatStartTime = (timeStr) => {
  if (!timeStr) return '';
  if (timeStr.includes('T')) {
    try {
      const d = new Date(timeStr);
      if (!isNaN(d.getTime())) {
        let hours = d.getHours();
        let minutes = d.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        minutes = minutes < 10 ? '0' + minutes : minutes;
        return `${hours}:${minutes} ${ampm}`;
      }
    } catch (e) {}
  }
  return timeStr;
};

export default function OwnerDashboard({ onLogout, tables, deliveries = [], completedOrders = [], submissionHistory = [], onTableSelect, onCreateDelivery, onUpdateTableName, onNavigateToExpenses, onNavigateToSubmit, onNavigateToEditMenu, onNavigateToSupplierDue, onNavigateToItemSalesReport, onNavigateToAnalytics, onCloudRestore, onSameDayResync, onMenuRecovery, onHistoricalMonthDownload, onSavePastAccount, onDeletePastAccount, dailyExpenses, onUpdateExpenses, isDailySubmitted, todaySubmissionDetails = null, onDeleteActiveOrder, onDeleteDoneOrder, delCountdown, tabCountdown, fullCountdown, onNavigateToOwnerFinance, onNavigateToActivityLog, onNavigateToPrinterSettings, onNavigateToBackupRestore }) {
  const submitInfo = todaySubmissionDetails || (isDailySubmitted ? getTodaySubmissionDetails() : null);

  const formatSubmitTime = (timeStr) => {
    if (!timeStr) return '';
    try {
      const d = new Date(timeStr);
      if (!isNaN(d.getTime())) {
        let hours = d.getHours();
        const minutes = d.getMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        return `${hours}:${minutes} ${ampm}`;
      }
    } catch (e) {}
    return String(timeStr);
  };

  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [selectedTableForRename, setSelectedTableForRename] = useState(null);
  const [newTableName, setNewTableName] = useState('');

  // 3-Dot Menu and Report States
  const [menuModalVisible, setMenuModalVisible] = useState(false);
  const [ijaraModalVisible, setIjaraModalVisible] = useState(false);
  const [salesReportVisible, setSalesReportVisible] = useState(false);
  const [depositReportVisible, setDepositReportVisible] = useState(false);
  const [dayDetailModalVisible, setDayDetailModalVisible] = useState(false);
  const [selectedReportDay, setSelectedReportDay] = useState(null);
  const [tempIjara, setTempIjara] = useState(dailyExpenses.ijara.toString());
  const [tableFilter, setTableFilter] = useState('ALL');

  // Past Account States
  const [pastAccountModalVisible, setPastAccountModalVisible] = useState(false);
  const [isEditingPast, setIsEditingPast] = useState(false);
  const [pastDate, setPastDate] = useState('');
  const [pastTotalSell, setPastTotalSell] = useState('');
  const [pastBkash, setPastBkash] = useState('');
  const [pastNagad, setPastNagad] = useState('');
  const [pastCash, setPastCash] = useState('');
  const [pastRocket, setPastRocket] = useState('');
  const [pastDudu, setPastDudu] = useState('');
  const [pastAkash, setPastAkash] = useState('');
  const [pastBurger, setPastBurger] = useState('');
  const [pastBazar, setPastBazar] = useState('');
  const [pastOthers, setPastOthers] = useState('');
  const [pastDeliverySell, setPastDeliverySell] = useState('');
  const [pastDeliveryCharge, setPastDeliveryCharge] = useState('');
  const [pastIjara, setPastIjara] = useState('');
  const [pastNetCash, setPastNetCash] = useState('');
  const [pastDeposit, setPastDeposit] = useState('');
  const [pastNote, setPastNote] = useState('');

  // Filter States
  const [salesFilter, setSalesFilter] = useState('Today'); 
  
  // Helper to get Month Year from date string
  const getMonthName = (dateStr) => {
    if (!dateStr) return '';
    const str = String(dateStr).trim();
    
    // Handle YYYY-MM-DD
    if (str.includes('-')) {
      const parts = str.split('-');
      if (parts.length >= 2 && parts[0].length === 4) {
        const year = parts[0];
        const monthInt = parseInt(parts[1], 10);
        const monthNamesList = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        if (monthInt >= 1 && monthInt <= 12) return `${monthNamesList[monthInt - 1]} ${year}`;
      }
    }
    
    // Handle DD MMM YYYY or similar
    const parts = str.split(' ');
    if (parts.length === 3) {
      return `${parts[1]} ${parts[2]}`;
    }
    return '';
  };

  const businessDateObj = new Date(Date.now() - 3600000);
  const [selectedMonth, setSelectedMonth] = useState(businessDateObj.getMonth());
  const [selectedYear, setSelectedYear] = useState(businessDateObj.getFullYear());
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const yearsList = [2024, 2025, 2026, 2027, 2028, 2029, 2030];
  const activeFilter = `${monthNames[selectedMonth]} ${selectedYear}`;
  
  const [pickDate, setPickDate] = useState('📅 তারিখ সিলেক্ট করুন');
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [yearPickerVisible, setYearPickerVisible] = useState(false);

  // Calendar State
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarTarget, setCalendarTarget] = useState(''); // 'past' or 'sales'

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderDetailVisible, setOrderDetailVisible] = useState(false);
  const [printOrder, setPrintOrder] = useState(null);

  // Android Back Handler for Modals
  useEffect(() => {
    const backAction = () => {
      // Priority: Close modals from top to bottom
      if (orderDetailVisible) { setOrderDetailVisible(false); return true; }
      if (calendarVisible) { setCalendarVisible(false); return true; }
      if (yearPickerVisible) { setYearPickerVisible(false); return true; }
      if (monthPickerVisible) { setMonthPickerVisible(false); return true; }
      if (pastAccountModalVisible) { setPastAccountModalVisible(false); return true; }
      if (ijaraModalVisible) { setIjaraModalVisible(false); return true; }
      if (salesReportVisible) { setSalesReportVisible(false); return true; }
      if (depositReportVisible) { setDepositReportVisible(false); return true; }
      if (dayDetailModalVisible) { setDayDetailModalVisible(false); return true; }
      if (menuModalVisible) { setMenuModalVisible(false); return true; }
      if (renameModalVisible) { setRenameModalVisible(false); return true; }

      return false; // Let App.js handle screen back
    };

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      backAction
    );

    return () => backHandler.remove();
  }, [orderDetailVisible, calendarVisible, yearPickerVisible, monthPickerVisible, pastAccountModalVisible, ijaraModalVisible, salesReportVisible, depositReportVisible, dayDetailModalVisible, menuModalVisible, renameModalVisible]);

  const handleTableLongPress = (table) => {
    setSelectedTableForRename(table);
    setNewTableName(table.name || table.id);
    setRenameModalVisible(true);
  };

  const handleSaveTableName = () => {
    if (!newTableName.trim()) {
      Alert.alert("ত্রুটি", "টেবিলের নাম ফাঁকা রাখা যাবে না!");
      return;
    }
    onUpdateTableName(selectedTableForRename.id, newTableName.trim());
    setRenameModalVisible(false);
    setSelectedTableForRename(null);
  };

  const handleSaveIjara = () => {
    if (dailyExpenses.ijara > 0) {
      Alert.alert("ইতিমধ্যে যোগ করা হয়েছে", "ইজা শুধুমাত্র একবার যোগ করা যাবে এবং এটি আর পরিবর্তন বা এডিট করা সম্ভব নয়!");
      return;
    }
    onUpdateExpenses({
      ...dailyExpenses,
      ijara: parseFloat(tempIjara) || 0
    });
    setIjaraModalVisible(false);
    setTempIjara(''); // blank the input
    Alert.alert("সফল", "ইজা সফলভাবে যোগ করা হয়েছে!");
  };

  const resetPastStates = () => {
    setPastDate('');
    setPastTotalSell('');
    setPastBkash('');
    setPastNagad('');
    setPastCash('');
    setPastRocket('');
    setPastDeliverySell('');
    setPastDeliveryCharge('');
    setPastIjara('');
    setPastNetCash('');
    setPastDudu('');
    setPastAkash('');
    setPastBurger('');
    setPastBazar('');
    setPastOthers('');
    setPastDeposit('');
    setPastNote('');
  };

  const handleEditPastAccount = (item) => {
    setIsEditingPast(true);
    setPastDate(item.date);
    setPastTotalSell(item.sell.toString());
    setPastBkash(item.breakdown?.bkash?.toString() || item.bkash_payment?.toString() || '');
    setPastNagad(item.breakdown?.nagad?.toString() || item.nagad_payment?.toString() || '');
    setPastCash(item.breakdown?.cash?.toString() || item.cash_payment?.toString() || '');
    setPastRocket(item.breakdown?.rocket?.toString() || item.rocket_payment?.toString() || '');
    setPastDeliverySell(item.breakdown?.delivery_sell?.toString() || item.delivery_sell?.toString() || '');
    setPastDeliveryCharge(item.breakdown?.delivery_charge?.toString() || item.delivery_charge?.toString() || '');
    setPastIjara(item.breakdown?.ijara?.toString() || item.eja?.toString() || '');
    setPastDudu(item.breakdown?.dudu?.toString() || item.dudu_store?.toString() || '');
    setPastAkash(item.breakdown?.akash?.toString() || item.akash_murgi?.toString() || '');
    setPastBurger(item.breakdown?.burger?.toString() || item.burger_bun?.toString() || '');
    setPastBazar(item.breakdown?.bazar?.toString() || item.bazar?.toString() || '');
    setPastOthers(item.breakdown?.others?.toString() || item.others?.toString() || '');
    setPastNetCash(item.net_cash?.toString() || '');
    setPastDeposit(item.deposit?.toString() || item.net_deposit?.toString() || '');
    setPastNote(item.notes || '');
    setPastAccountModalVisible(true);
  };

  const handleOpenPastAccount = () => {
    setMenuModalVisible(false);
    setIsEditingPast(false);
    resetPastStates();
    // Default to yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const y = yesterday.getFullYear();
    const m = String(yesterday.getMonth() + 1).padStart(2, '0');
    const d = String(yesterday.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    setPastDate(dateStr);
    setPastAccountModalVisible(true);
  };

  const handlePastDateChange = (date) => {
    let normalized = date;
    if (date && date.includes(' ')) {
      const match = String(date).trim().match(/^(\d{1,2})\s+([A-Za-z]{3,10})\s+(\d{4})/);
      if (match) {
        const day = String(match[1]).padStart(2, '0');
        const monthName = match[2].substring(0, 3).toLowerCase();
        const year = match[3];
        const monthsShort = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const monthIndex = monthsShort.indexOf(monthName);
        if (monthIndex !== -1) {
          const month = String(monthIndex + 1).padStart(2, '0');
          normalized = `${year}-${month}-${day}`;
        }
      }
    }
    setPastDate(normalized);
    // Auto-fill removed to allow manual entry without pre-filled data, 
    // unless explicitly editing via the edit button.
  };

  const handleSavePastEntry = () => {
    let effectiveSell = parseFloat(pastTotalSell) || 0;
    if (effectiveSell === 0) {
      effectiveSell = (parseFloat(pastCash) || 0) +
                      (parseFloat(pastBkash) || 0) +
                      (parseFloat(pastNagad) || 0) +
                      (parseFloat(pastRocket) || 0) +
                      (parseFloat(pastDeliverySell) || 0);
      if (effectiveSell > 0) {
        setPastTotalSell(String(effectiveSell));
      }
    }

    if (!pastDate || effectiveSell === 0) {
      Alert.alert("ত্রুটি", "তারিখ এবং মোট বিক্রয় আবশ্যিক!");
      return;
    }

    // Duplicate Check: Only block if ADDING a new entry (not editing an existing one)
    if (!isEditingPast) {
      const exists = submissionHistory.some(h => h.date === pastDate);
      if (exists) {
        Alert.alert("ইতিমধ্যে বিদ্যমান", "এই তারিখের হিসাব ইতিমধ্যে জমা দেওয়া আছে। আপনি চাইলে হিস্ট্রি থেকে ওই দিনের এন্ট্রিটি এডিট করতে পারেন।");
        return;
      }
    }
    
    const dudu = parseFloat(pastDudu) || 0;
    const akash = parseFloat(pastAkash) || 0;
    const burger = parseFloat(pastBurger) || 0;
    const bazar = parseFloat(pastBazar) || 0;
    const others = parseFloat(pastOthers) || 0;
    const totalExpense = dudu + akash + burger + bazar + others;
    const sell = effectiveSell;

    const record = {
      date: pastDate,
      sell: sell,
      expense: totalExpense,
      deposit: parseFloat(pastDeposit) || 0,
      net_cash: parseFloat(pastNetCash) || 0,
      isManualEntry: true,
      notes: pastNote,
      breakdown: {
        cash: parseFloat(pastCash) || 0,
        bkash: parseFloat(pastBkash) || 0,
        nagad: parseFloat(pastNagad) || 0,
        rocket: parseFloat(pastRocket) || 0,
        delivery_sell: parseFloat(pastDeliverySell) || 0,
        delivery_charge: parseFloat(pastDeliveryCharge) || 0,
        ijara: parseFloat(pastIjara) || 0,
        dudu, akash, burger, bazar, others
      }
    };
    onSavePastAccount(record);
    setPastAccountModalVisible(false);
  };

  // Real calculations
  const activeTablesCount = tables.filter(t => t.status === 'BUSY').length;
  const activeDeliveriesCount = deliveries.filter(d => d.status === 'BUSY').length;
  const totalActiveCount = activeTablesCount + activeDeliveriesCount;

  // Date filtering helper for today
  const todayStr = getBusinessDate();

  // Filter orders for today ONLY for top statistics
  const todaysOrders = completedOrders.filter(order => {
    const orderDate = order.fullDate || todayStr;
    return orderDate === todayStr;
  });

  const todaySale = todaysOrders.reduce((sum, order) => sum + ((order.paidAmount || 0) - (order.changeMoneyGiven || 0)), 0);
  const totalExpenses = (parseFloat(dailyExpenses.duduMiah) || 0) + (parseFloat(dailyExpenses.akashChicken) || 0) + (parseFloat(dailyExpenses.burgerBun) || 0) + (parseFloat(dailyExpenses.bazar) || 0) + (parseFloat(dailyExpenses.others) || 0);
  
  // Calculate change money impact
  const ongoingChangeMoney = deliveries.filter(d => d.status === 'BUSY').reduce((sum, d) => sum + (d.changeMoneyGiven || 0), 0);
  const completedChangeMoney = todaysOrders.reduce((sum, o) => sum + (o.changeMoneyGiven || 0), 0);
  
  // totalCash should only deduct ongoingChangeMoney since returned change money cancels out
  const totalCash = todaySale + dailyExpenses.ijara - totalExpenses - ongoingChangeMoney;

  const bkashSale = todaysOrders.reduce((sum, o) => sum + (o.bkash_amount || (o.method === 'বিকাশ' ? o.paidAmount : 0) || 0), 0);
  const nagadSale = todaysOrders.reduce((sum, o) => sum + (o.nagad_amount || (o.method === 'নগদ' ? o.paidAmount : 0) || 0), 0);
  const rocketSale = todaysOrders.reduce((sum, o) => sum + (o.rocket_amount || (o.method === 'রকেট' ? o.paidAmount : 0) || 0), 0);
  const cashSale = todaysOrders.reduce((sum, o) => sum + (o.cash_amount || (o.method === 'ক্যাশ' ? o.paidAmount : 0) || 0), 0);

  // Table status and order amount helpers
  const getTableAmount = (t) => {
    if (!t || !t.items) return 0;
    return t.items.reduce((sum, item) => sum + ((parseFloat(item.price) || 0) * (parseInt(item.qty, 10) || 1)), 0);
  };

  const getTableElapsedMinutes = (t) => {
    if (!t || !t.startTime) return null;
    try {
      const start = new Date(t.startTime).getTime();
      if (isNaN(start)) return null;
      return Math.max(0, Math.floor((Date.now() - start) / 60000));
    } catch (e) {
      return null;
    }
  };

  const freeTablesCount = tables.filter(t => t.status !== 'BUSY').length;
  const busyTablesCount = tables.filter(t => t.status === 'BUSY').length;
  const activeDeliveriesList = deliveries.filter(d => d.status === 'BUSY');

  // Executive Dashboard Insights: Top Selling Items for Today
  let topSellingItems = [];
  let topItemPct = 0;
  try {
    const rawReport = getItemSalesReport(todayStr, todayStr) || [];
    const validItems = rawReport
      .filter(item => (item.quantitySold || 0) > 0 && (item.name || '').trim().toLowerCase() !== 'পানি')
      .sort((a, b) => (b.quantitySold || 0) - (a.quantitySold || 0));

    topSellingItems = validItems.slice(0, 5);
    const totalFoodSalesToday = validItems.reduce((sum, it) => sum + (it.totalSales || 0), 0);
    topItemPct = totalFoodSalesToday > 0 && topSellingItems[0]
      ? Math.round(((topSellingItems[0].totalSales || 0) / totalFoodSalesToday) * 100)
      : 0;
  } catch (err) {
    console.error("[OwnerDashboard] Error fetching top selling items:", err);
  }
  const currentMonthPrefix = todayStr.substring(0, 7);
  const thisMonthSubmissions = submissionHistory?.filter(item => item.date && item.date.startsWith(currentMonthPrefix)) || [];
  const monthlyTotalSell = thisMonthSubmissions.reduce((sum, item) => sum + (item.sell || 0), 0) + todaySale;
  
  const allOrdersForLog = completedOrders.map(o => ({
    ...o,
    table: o.tableId,
    // Requirement: Show only Food Sales + Delivery Charge in log. Deduct changeMoneyGiven if it was included in the total.
    amount: (o.paidAmount || o.grandTotal || o.totalAmount) - (o.changeMoneyGiven || 0)
  }));

  const filteredOrders = allOrdersForLog.filter(o => (o.fullDate || todayStr) === todayStr);

  const totalDoneCount = todaysOrders.length;
  // Get unique months present in the history dynamically
  const availableMonthsRaw = Array.from(new Set(
    submissionHistory.map(item => getMonthName(item.date)).filter(Boolean)
  ));

  // Sort months newest to oldest helper
  const sortMonths = (months) => {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return [...months].sort((a, b) => {
      const partsA = a.split(' ');
      const partsB = b.split(' ');
      if (partsA.length === 2 && partsB.length === 2) {
        const yearA = parseInt(partsA[1], 10);
        const yearB = parseInt(partsB[1], 10);
        if (yearA !== yearB) {
          return yearB - yearA; // descending year
        }
        const monthIdxA = monthNames.indexOf(partsA[0]);
        const monthIdxB = monthNames.indexOf(partsB[0]);
        return monthIdxB - monthIdxA; // descending month
      }
      return 0;
    });
  };

  const filteredHistory = submissionHistory
    .filter(item => getMonthName(item.date) === activeFilter)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  // --- Sales Report Filter Logic ---
  const formatDateToYYYYMMDD = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const parseCustomDateToYYYYMMDD = (customDateStr) => {
    if (!customDateStr || customDateStr.includes('সিলেক্ট')) return '';
    try {
      const parts = customDateStr.trim().split(' ');
      if (parts.length === 3) {
        const day = String(parseInt(parts[0], 10)).padStart(2, '0');
        const monthName = parts[1].substring(0, 3).toLowerCase();
        const year = parts[2];
        const monthsShort = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const monthsLong = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        let monthIdx = monthsShort.indexOf(monthName);
        if (monthIdx === -1) {
          monthIdx = monthsLong.indexOf(monthName);
        }
        if (monthIdx !== -1) {
          const monthStr = String(monthIdx + 1).padStart(2, '0');
          return `${year}-${monthStr}-${day}`;
        }
      }
    } catch (e) {}
    return '';
  };

  const getFilteredSalesOrders = () => {
    const todayStr = formatDateToYYYYMMDD(new Date());
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = formatDateToYYYYMMDD(yesterday);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = formatDateToYYYYMMDD(sevenDaysAgo);

    return completedOrders.filter(order => {
      const orderDate = order.fullDate || todayStr;

      if (salesFilter === 'Today') {
        return orderDate === todayStr;
      }
      if (salesFilter === 'Yesterday') {
        return orderDate === yesterdayStr;
      }
      if (salesFilter === 'Last 7 Days') {
        return orderDate >= sevenDaysAgoStr && orderDate <= todayStr;
      }
      if (salesFilter === 'Pick Date') {
        const targetDateStr = parseCustomDateToYYYYMMDD(pickDate);
        if (!targetDateStr) return false;
        return orderDate === targetDateStr;
      }
      return true;
    });
  };

  const filteredSalesOrders = getFilteredSalesOrders();

  const handleSalesCheckCloud = () => {
    let targetDate = new Date();
    if (salesFilter === 'Yesterday') {
      targetDate.setDate(targetDate.getDate() - 1);
    } else if (salesFilter === 'Pick Date') {
      const parsed = parseCustomDateToYYYYMMDD(pickDate);
      if (parsed) {
        targetDate = new Date(parsed);
      }
    }
    
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = `${monthNames[month]} ${year}`;
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    onHistoricalMonthDownload(monthStr, monthName);
  };

  return (
    <SafeAreaView style={styles.container}>
      <CalendarPicker 
        visible={calendarVisible} 
        onClose={() => setCalendarVisible(false)} 
        onSelectDate={(date) => {
          if (calendarTarget === 'past') handlePastDateChange(date);
          else setPickDate(date);
        }}
      />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.menuDotsButton} onPress={() => setMenuModalVisible(true)}><Text style={styles.menuDotsIcon}>☰</Text></TouchableOpacity>
        
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Owner Dashboard</Text>
          <Text style={styles.headerDate}>{getBengaliDate()}</Text>
        </View>
        
        <View style={{ width: 40 }} /> 
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollBody} contentContainerStyle={{ paddingBottom: 110 }}>
        {/* Daily Submit Status Card */}
        {isDailySubmitted && submitInfo ? (
          <View style={[styles.submitStatusCardSuccess, { marginHorizontal: 16 }]}>
            <View style={styles.submitStatusHeader}>
              <View style={styles.submitBadgeSuccess}>
                <Text style={styles.submitBadgeSuccessText}>✓ আজকের দৈনিক হিসাব সাবমিট সম্পন্ন</Text>
              </View>
              {submitInfo.submitted_at ? (
                <Text style={styles.submitTimeText}>
                  সময়: {formatSubmitTime(submitInfo.submitted_at)}
                </Text>
              ) : null}
            </View>

            <View style={styles.submitDetailsGrid}>
              <View style={styles.submitDetailCol}>
                <Text style={styles.submitDetailLabel}>সাবমিট করেছেন</Text>
                <Text style={styles.submitDetailValue} numberOfLines={1}>
                  {submitInfo.submitted_by || 'ম্যানেজার'}
                </Text>
              </View>
              <View style={styles.submitDetailCol}>
                <Text style={styles.submitDetailLabel}>মোট বিক্রয়</Text>
                <Text style={[styles.submitDetailValue, { color: '#10B981' }]}>
                  ৳ {(submitInfo.total_sell || 0).toLocaleString()}
                </Text>
              </View>
              <View style={styles.submitDetailCol}>
                <Text style={styles.submitDetailLabel}>মোট খরচ</Text>
                <Text style={[styles.submitDetailValue, { color: '#EF4444' }]}>
                  ৳ {(submitInfo.total_expense || 0).toLocaleString()}
                </Text>
              </View>
              <View style={styles.submitDetailCol}>
                <Text style={styles.submitDetailLabel}>মালিকের জমা</Text>
                <Text style={[styles.submitDetailValue, { color: '#38BDF8' }]}>
                  ৳ {(submitInfo.net_deposit || 0).toLocaleString()}
                </Text>
              </View>
            </View>

            {/* Next Day Opening Ijara Callout */}
            <View style={styles.nextDayIjaraBanner}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 16, marginRight: 6 }}>💰</Text>
                <Text style={styles.nextDayIjaraTitle}>আগামীকালের প্রারম্ভিক ইজা (Opening Cash):</Text>
              </View>
              <Text style={styles.nextDayIjaraValue}>
                ৳ {(submitInfo.nextDayIjara || 0).toLocaleString()}
              </Text>
            </View>
          </View>
        ) : (
          <View style={[styles.submitStatusCardPending, { marginHorizontal: 16 }]}>
            <View style={styles.submitBadgePending}>
              <Text style={styles.submitBadgePendingText}>⏳ আজকের হিসাব এখনও সাবমিট করা হয়নি</Text>
            </View>
            <Text style={styles.submitPendingSubtext}>
              চলতি দিনের অর্ডার ও হিসাব চলমান রয়েছে
            </Text>
          </View>
        )}

        {/* ── 1. TOP SUMMARY CARDS (Active Tables Card removed) ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsContainer}>
          <TodaySalesCard
            todaySale={todaySale}
            bkashSale={bkashSale}
            nagadSale={nagadSale}
            rocketSale={rocketSale}
            totalDoneCount={totalDoneCount}
          />
          <TotalCashCard
            totalCash={totalCash}
            bkashSale={bkashSale}
            nagadSale={nagadSale}
            rocketSale={rocketSale}
          />
          <MonthlyTotalCard
            monthlyTotalSell={monthlyTotalSell}
          />
        </ScrollView>

        {/* ── 4. টেবিল ও সক্রিয় ডেলিভারি (Combined Table & Active Delivery Section) ── */}
        <View style={styles.tableDeliveryCard}>
          {/* Header */}
          <View style={styles.tableDeliveryHeaderRow}>
            <Text style={styles.tableDeliveryTitle}>টেবিল ও ডেলিভারি</Text>
            {/* Filter Toggle Pills */}
            <View style={styles.tableFilterPillGroup}>
              <TouchableOpacity
                style={[styles.tableFilterBtn, tableFilter === 'ALL' && styles.tableFilterBtnActive]}
                onPress={() => setTableFilter('ALL')}
                activeOpacity={0.7}
              >
                <Text style={[styles.tableFilterBtnText, tableFilter === 'ALL' && styles.tableFilterBtnTextActive]}>
                  সব {tables.length}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tableFilterBtn, tableFilter === 'BUSY' && styles.tableFilterBtnActive]}
                onPress={() => setTableFilter(tableFilter === 'BUSY' ? 'ALL' : 'BUSY')}
                activeOpacity={0.7}
              >
                <Text style={[styles.tableFilterBtnText, tableFilter === 'BUSY' && styles.tableFilterBtnTextActive]}>
                  চলছে {busyTablesCount}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 4-Column Responsive Table Grid */}
          <View style={styles.tableVisualGrid}>
            {tables.map(t => {
              if (tableFilter === 'BUSY' && t.status !== 'BUSY') return null;

              const isBusy = t.status === 'BUSY';
              const m = getTableElapsedMinutes(t);
              const tblAmt = getTableAmount(t);
              const tableDisplayId = t.name || String(t.id).replace('table_', 'T-');

              return (
                <TouchableOpacity
                  key={t.id}
                  activeOpacity={0.7}
                  onPress={() => onTableSelect(t.id)}
                  onLongPress={() => handleTableLongPress(t)}
                  style={[
                    styles.tableGridCard,
                    isBusy ? styles.tableGridCardBusy : styles.tableGridCardFree
                  ]}
                >
                  <Text style={[styles.tableCardTitle, isBusy ? styles.tableCardTitleBusy : styles.tableCardTitleFree]} numberOfLines={1}>
                    {tableDisplayId}
                  </Text>

                  {/* Status Indicator */}
                  <View style={styles.tableStatusIndicatorRow}>
                    <View style={[styles.tableStatusDot, { backgroundColor: isBusy ? '#F59E0B' : '#2DD4BF' }]} />
                    <Text style={[styles.tableStatusLabel, { color: isBusy ? '#F59E0B' : '#2DD4BF' }]}>
                      {isBusy ? (m !== null ? `${m} min` : 'চলছে') : 'FREE'}
                    </Text>
                  </View>

                  {/* Amount Row */}
                  <Text style={[styles.tableCardAmount, { color: isBusy ? '#F59E0B' : 'transparent' }]} numberOfLines={1}>
                    {isBusy ? `৳${tblAmt.toLocaleString()}` : '-'}
                  </Text>

                  {/* Chair Icon */}
                  <Text style={styles.tableCardChairIcon}>🪑</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ───── সক্রিয় ডেলিভারি ───── Divider Inside the Same Card */}
          <View style={styles.deliveryDividerContainer}>
            <View style={styles.deliveryDividerLine} />
          </View>

          {/* Active Delivery Section Header */}
          <View style={styles.activeDeliverySectionHeaderRow}>
            <Text style={styles.activeDeliverySectionTitle}>সক্রিয় ডেলিভারি</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity 
                style={styles.newDeliveryMiniBtn}
                onPress={onCreateDelivery}
                activeOpacity={0.7}
              >
                <Text style={styles.newDeliveryMiniBtnText}>➕ নতুন ডেলিভারি</Text>
              </TouchableOpacity>
              <View style={[styles.activeDeliveryCountBadge, { marginLeft: 8 }]}>
                <Text style={styles.activeDeliveryCountBadgeText}>{activeDeliveriesList.length} টি</Text>
              </View>
            </View>
          </View>

          {/* Active Deliveries List inside Same Card */}
          {activeDeliveriesList.length > 0 ? (
            activeDeliveriesList.map(delivery => {
              const delAmt = (delivery.amount !== undefined && delivery.amount !== null && Number(delivery.amount) > 0) ? parseFloat(delivery.amount) : ((delivery.items ? delivery.items.reduce((s, i) => s + ((parseFloat(i.price) || 0) * (parseInt(i.qty, 10) || 1)), 0) : 0) + (parseFloat(delivery.deliveryCharge || delivery.delivery_charge) || 0));
              const delElapsed = getTableElapsedMinutes(delivery);
              const timeDisplay = delElapsed !== null ? `${delElapsed} মিনিট ধরে · চলমান` : 'চলমান';

              return (
                <TouchableOpacity
                  key={delivery.id}
                  style={styles.activeDeliveryCard}
                  onPress={() => onTableSelect(delivery.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.activeDeliveryHeaderRow}>
                    <View style={styles.activeDeliveryLeft}>
                      <View style={styles.deliveryRiderIconWrap}>
                        <Text style={styles.deliveryRiderIcon}>🛵</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.activeDeliveryName} numberOfLines={1}>
                          {delivery.name || 'Delivery'}
                        </Text>
                        <Text style={styles.activeDeliverySub}>{timeDisplay}</Text>
                      </View>
                    </View>
                    <View style={styles.activeDeliveryRight}>
                      <Text style={styles.activeDeliveryAmount}>৳{delAmt.toLocaleString()}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          ) : (
            <TouchableOpacity style={styles.emptyDeliveryBox} onPress={onCreateDelivery} activeOpacity={0.7}>
              <Text style={styles.emptyDeliveryEmoji}>🛵</Text>
              <Text style={styles.emptyDeliveryText}>বর্তমানে কোনো সক্রিয় ডেলিভারি নেই</Text>
              <Text style={[styles.emptyDeliveryText, { color: '#FFB703', marginTop: 4, fontWeight: 'bold' }]}>➕ নতুন ডেলিভারি শুরু করতে ট্যাপ করুন</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── 5. শীর্ষ বিক্রিত খাবার (Top Selling Food Items) ── */}
        <View style={styles.card}>
          <View style={styles.topSellerHeader}>
            <View>
              <Text style={styles.sectionHeaderTitle}>শীর্ষ বিক্রিত খাবার</Text>
              <Text style={styles.topSellerSubtitle}>আজকের সেরা ৫টি আইটেম</Text>
            </View>
            <TouchableOpacity 
              onPress={onNavigateToItemSalesReport} 
              activeOpacity={0.7}
              style={styles.topSellerReportBtn}
            >
              <Text style={styles.topSellerReportBtnText}>পূর্ণ রিপোর্ট ❯</Text>
            </TouchableOpacity>
          </View>

          {topSellingItems.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateEmoji}>🍽️</Text>
              <Text style={styles.emptyStateText}>আজ এখনও কোনো খাবার বিক্রয় হয়নি</Text>
              <Text style={styles.emptyStateSub}>অর্ডার সম্পন্ন হলে এখানে লাইভ র‍্যাংকিং দেখাবে।</Text>
            </View>
          ) : (
            <>
              {/* #1 Top Item Hero Banner (Amber/Gold Card) */}
              {topSellingItems[0] && (
                <View style={styles.topHeroCard}>
                  <View style={styles.topHeroDecorCircle} />
                  
                  <View style={styles.topHeroBadge}>
                    <Text style={styles.topHeroBadgeText}>🥇 আজকের সেরা</Text>
                  </View>

                  <View style={styles.topHeroContentRow}>
                    <View style={styles.topHeroRankBox}>
                      <Text style={styles.topHeroRankNum}>1</Text>
                    </View>
                    <View style={styles.topHeroInfoCol}>
                      <Text style={styles.topHeroTitle} numberOfLines={1}>
                        {topSellingItems[0].name}
                      </Text>
                      <Text style={styles.topHeroSub}>
                        {toBengaliNumber(topSellingItems[0].quantitySold)} পিস · মোট বিক্রির {toBengaliNumber(topItemPct)}%
                      </Text>
                      <Text style={styles.topHeroPrice}>
                        ৳ {toBengaliNumber((topSellingItems[0].totalSales || 0).toLocaleString())}
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Items #2 to #5 Ranked List */}
              {topSellingItems.length > 1 && (
                <View style={styles.rankedListCard}>
                  {topSellingItems.slice(1, 5).map((item, index) => {
                    const rankNum = index + 2;
                    const maxSales = topSellingItems[0]?.totalSales || 1;
                    const barWidthPct = Math.max(12, Math.min(100, Math.round(((item.totalSales || 0) / maxSales) * 100)));
                    const isLast = index === topSellingItems.slice(1, 5).length - 1;

                    return (
                      <View 
                        key={item.id || item.name || index} 
                        style={[styles.rankedItemRow, !isLast && styles.rankedItemBorderBottom]}
                      >
                        <View style={styles.rankedBadge}>
                          <Text style={styles.rankedBadgeText}>{rankNum}</Text>
                        </View>

                        <View style={styles.rankedItemMiddleCol}>
                          <Text style={styles.rankedItemName} numberOfLines={1}>{item.name}</Text>
                          <View style={styles.rankedItemSubRow}>
                            {item.category ? (
                              <Text style={styles.rankedItemCategory} numberOfLines={1}>{item.category}</Text>
                            ) : null}
                            <View style={styles.rankedProgressBarTrack}>
                              <View style={[styles.rankedProgressBarFill, { width: `${barWidthPct}%` }]} />
                            </View>
                          </View>
                        </View>

                        <View style={styles.rankedItemRightCol}>
                          <Text style={styles.rankedItemAmount}>
                            ৳{toBengaliNumber((item.totalSales || 0).toLocaleString())}
                          </Text>
                          <Text style={styles.rankedItemQty}>
                            {toBengaliNumber(item.quantitySold)} পিস
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </>
          )}
        </View>

        {/* ── 6. আজকের অর্ডার লগ (Today's Order Log) ── */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}><Text style={styles.sectionTitle}>আজকের অর্ডার লগ</Text></View>
          <View style={styles.orderList}>
            {filteredOrders.length === 0 ? <Text style={{ color: '#888', textAlign: 'center', padding: 20 }}>কোনো অর্ডার পাওয়া যায়নি</Text> : 
              filteredOrders.map((order) => (
                <TouchableOpacity 
                  key={order.id} 
                  style={styles.orderItem} 
                  onPress={() => {
                    setSelectedOrder(order);
                    setOrderDetailVisible(true);
                  }}
                >
                  <View style={styles.orderItemLeft}>
                    <View style={[styles.tableIconCircle, styles.circleGreen]}><Text style={styles.tableCircleText}>{order.table}</Text></View>
                    <View style={styles.orderMeta}>
                      <View style={styles.tableTimeRow}><Text style={styles.orderTableText}>{order.table}</Text><Text style={styles.orderTimeText}>{order.time}</Text></View>
                      <Text style={styles.orderItemsText} numberOfLines={1}>{order.items}</Text>
                    </View>
                  </View>
                  <View style={styles.orderItemRight}>
                    <View style={styles.amountCol}><Text style={styles.orderItemAmount}>৳ {order.amount}</Text><Text style={[styles.orderItemStatus, styles.textGreen]}>পেমেন্ট শেষ</Text></View>
                    <View style={styles.actionRow}>
                      <TouchableOpacity 
                        style={styles.printBtn} 
                        onPress={(e) => { 
                          e.stopPropagation(); 
                          setPrintOrder(order); 
                        }}
                      >
                        <Text style={styles.btnIcon}>🖨️</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.deleteBtn} onPress={(e) => { e.stopPropagation(); onDeleteDoneOrder(order.id); }}>
                        <Text style={styles.btnIcon}>🗑️</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
          </View>
        </View>
      </ScrollView>

      {/* Floating Buttons */}
      <View style={styles.fabContainer}>
        <TouchableOpacity style={styles.fabItemUnified} onPress={onCreateDelivery}><Text style={styles.fabIconSmall}>🛵</Text><Text style={styles.fabLabelSmall}>ডেলিভারি</Text></TouchableOpacity>
        <TouchableOpacity style={styles.fabItemUnified} onPress={onNavigateToExpenses}><Text style={styles.fabIconSmall}>📉</Text><Text style={styles.fabLabelSmall}>খরচ</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.fabItemUnified, styles.fabHighlight]} onPress={onNavigateToSubmit}><Text style={[styles.fabIconSmall, { color: '#000' }]}>📝</Text><Text style={[styles.fabLabelSmall, { color: '#000' }]}>সাবমিট</Text></TouchableOpacity>
      </View>

{/* ORDER DETAIL MODAL (REDESIGNED) */}
      <OrderDetailModal
        visible={orderDetailVisible}
        onClose={() => setOrderDetailVisible(false)}
        order={selectedOrder}
        onPrint={(order) => {
          setOrderDetailVisible(false);
          setPrintOrder(order);
        }}
        onDelete={(targetId) => {
          setOrderDetailVisible(false);
          if (targetId) onDeleteDoneOrder(targetId);
        }}
        formatDisplayDate={formatDisplayDate}
      />

      {/* RENAME MODAL */}
      <Modal animationType="fade" transparent={true} visible={renameModalVisible} onRequestClose={() => setRenameModalVisible(false)}>
        <View style={styles.modalOverlay}><View style={styles.modalContent}><Text style={styles.modalTitle}>টেবিলের নাম পরিবর্তন</Text>
            <View style={styles.renameInputWrapper}><TextInput style={[styles.renameInput, { color: '#FFF' }]} value={newTableName} onChangeText={setNewTableName} placeholder="নাম লিখুন" placeholderTextColor="#AAA" autoFocus={true}/></View>
            <View style={styles.modalBtnRow}><TouchableOpacity style={styles.modalCancelBtn} onPress={() => setRenameModalVisible(false)}><Text style={styles.modalCancelBtnText}>বাতিল</Text></TouchableOpacity><TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveTableName}><Text style={styles.modalSaveBtnText}>সংরক্ষণ</Text></TouchableOpacity></View>
        </View></View>
      </Modal>

      {/* 3-DOT MENU (OWNER SIDE MENU) */}
      {/* Preserves 3-dot menu options: আজকের ডেটা রিসিন্ক (Same-Day Resync) */}
      <OwnerSideMenu
        visible={menuModalVisible}
        onClose={() => setMenuModalVisible(false)}
        dailyExpenses={dailyExpenses}
        onAddIjara={() => {
          setTempIjara('');
          setIjaraModalVisible(true);
        }}
        onIjaraAlreadyAdded={() => {
          Alert.alert("ইতিমধ্যে যোগ করা হয়েছে", "ইজা শুধুমাত্র একবার যোগ করা যাবে এবং এটি আর পরিবর্তন বা এডিট করা সম্ভব নয়!");
        }}
        onNavigateToEditMenu={onNavigateToEditMenu}
        onNavigateToAnalytics={onNavigateToAnalytics}
        onNavigateToItemSalesReport={onNavigateToItemSalesReport}
        handleOpenPastAccount={handleOpenPastAccount}
        onNavigateToSupplierDue={onNavigateToSupplierDue}
        onNavigateToOwnerFinance={onNavigateToOwnerFinance}
        onNavigateToActivityLog={onNavigateToActivityLog}
        onOpenSalesReport={() => setSalesReportVisible(true)}
        onOpenDepositReport={() => setDepositReportVisible(true)}
        onSameDayResync={onSameDayResync}
        onCloudRestore={onCloudRestore}
        onMenuRecovery={onMenuRecovery}
        onNavigateToPrinterSettings={onNavigateToPrinterSettings}
        onNavigateToBackupRestore={onNavigateToBackupRestore}
        onLogout={onLogout}
      />

      {/* IJARA MODAL */}
      <Modal animationType="slide" transparent={true} visible={ijaraModalVisible} onRequestClose={() => setIjaraModalVisible(false)}>
        <View style={styles.modalOverlay}><View style={styles.modalContent}><View style={styles.modalIconCircle}><Text style={styles.modalIconEmoji}>💰</Text></View>
            <Text style={styles.modalTitle}>ইজা যোগ করুন</Text><View style={styles.ijaraInputWrapper}><TextInput style={[styles.modalInput, { color: '#FFF' }]} keyboardType="numeric" value={tempIjara} onChangeText={setTempIjara} placeholder="ইজা পরিমাণ" placeholderTextColor="#AAA" autoFocus={true}/></View>
            <View style={styles.modalBtnRow}><TouchableOpacity style={styles.modalCancelBtn} onPress={() => setIjaraModalVisible(false)}><Text style={styles.modalCancelBtnText}>বাতিল</Text></TouchableOpacity><TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveIjara}><Text style={styles.modalSaveBtnText}>নিশ্চিত</Text></TouchableOpacity></View>
        </View></View>
      </Modal>

      {/* SALES REPORT (REDESIGNED) */}
      <SalesReportModal
        visible={salesReportVisible}
        onClose={() => setSalesReportVisible(false)}
        salesFilter={salesFilter}
        onSelectFilter={(f) => {
          setSalesFilter(f);
          if (f === 'Pick Date') {
            setCalendarTarget('sales');
            setCalendarVisible(true);
          }
        }}
        pickDate={pickDate}
        onOpenDatePicker={() => {
          setCalendarTarget('sales');
          setCalendarVisible(true);
        }}
        orders={filteredSalesOrders}
        onSelectOrder={(order) => {
          setSelectedOrder({
            id: order.id,
            table: order.tableId,
            time: order.time,
            fullDate: order.fullDate,
            method: order.method || 'Cash',
            amount: order.paidAmount || order.totalAmount,
            items: order.items,
            status: 'Done'
          });
          setOrderDetailVisible(true);
        }}
        onPrintOrder={(order) => setPrintOrder(order)}
        onExportPDF={() => exportSalesReportPDF(filteredSalesOrders, salesFilter)}
        onCloudCheck={handleSalesCheckCloud}
        formatDisplayDate={formatDisplayDate}
      />

      {/* DEPOSIT REPORT (REDESIGNED) */}
      <DepositReportModal
        visible={depositReportVisible}
        onClose={() => setDepositReportVisible(false)}
        selectedMonth={selectedMonth}
        selectedYear={selectedYear}
        monthNames={monthNames}
        onOpenMonthPicker={() => setMonthPickerVisible(true)}
        onOpenYearPicker={() => setYearPickerVisible(true)}
        history={filteredHistory}
        onHistoricalMonthDownload={onHistoricalMonthDownload}
        activeFilter={activeFilter}
        onSelectDay={(item) => {
          setSelectedReportDay(item);
          setDayDetailModalVisible(true);
        }}
        onEditPastAccount={handleEditPastAccount}
        onExportPDF={() => exportDepositReportPDF(filteredHistory, activeFilter)}
        isAdmin={false}
        breakdownSummary={true}
      />

      {/* DAY DETAIL POPUP (From Monthly Report) */}
      <Modal animationType="slide" transparent={true} visible={dayDetailModalVisible} onRequestClose={() => setDayDetailModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { width: '92%', maxHeight: '85%', padding: 16 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'center', marginBottom: 12 }}>
              <View>
                <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#FFF' }}>📅 দৈনিক অর্ডার বিস্তারিত</Text>
                <Text style={{ fontSize: 12, color: '#FFB703', marginTop: 2 }}>{selectedReportDay ? formatDisplayDate(selectedReportDay.date) : ''}</Text>
              </View>
              <TouchableOpacity onPress={() => setDayDetailModalVisible(false)} style={styles.closeCircle}>
                <Text style={styles.closeCircleText}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedReportDay && (
              <View style={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#181E25', padding: 10, borderRadius: 10, marginBottom: 14 }}>
                <View><Text style={{ color: '#888', fontSize: 10 }}>মোট বিক্রি</Text><Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 13 }}>৳{selectedReportDay.sell?.toLocaleString()}</Text></View>
                <View><Text style={{ color: '#888', fontSize: 10 }}>মোট খরচ</Text><Text style={{ color: '#EF4444', fontWeight: 'bold', fontSize: 13 }}>৳{selectedReportDay.expense?.toLocaleString()}</Text></View>
                <View><Text style={{ color: '#888', fontSize: 10 }}>জমা</Text><Text style={{ color: '#34D399', fontWeight: 'bold', fontSize: 13 }}>৳{selectedReportDay.deposit?.toLocaleString()}</Text></View>
              </View>
            )}

            <ScrollView style={{ width: '100%' }} showsVerticalScrollIndicator={false}>
              {(() => {
                const targetDate = selectedReportDay?.date;
                const dayOrders = (completedOrders || []).filter(o => {
                  const oDate = o.fullDate || (o.created_at ? o.created_at.substring(0, 10) : '');
                  return oDate === targetDate;
                });

                if (dayOrders.length === 0) {
                  return (
                    <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                      <Text style={{ color: '#888', textAlign: 'center', marginBottom: 14 }}>এই তারিখের কোনো পৃথক অর্ডার ডাটা পাওয়া যায়নি।</Text>
                      {selectedReportDay && (
                        <TouchableOpacity 
                          style={{ width: '85%', backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#3B82F6', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
                          onPress={() => {
                            const summaryOrder = {
                              tableId: 'দৈনিক সারাংশ',
                              fullDate: selectedReportDay.date,
                              time: 'Day Summary',
                              items: [
                                { name: 'মোট বিক্রয়', qty: 1, price: selectedReportDay.sell || 0, total: selectedReportDay.sell || 0 },
                                { name: 'মোট খরচ', qty: 1, price: selectedReportDay.expense || 0, total: selectedReportDay.expense || 0 },
                                { name: 'মালিকের জমা (Deposit)', qty: 1, price: selectedReportDay.deposit || 0, total: selectedReportDay.deposit || 0 }
                              ],
                              totalAmount: selectedReportDay.sell || 0,
                              paidAmount: selectedReportDay.deposit || 0,
                              paymentMethod: `Cash: ${selectedReportDay.breakdown?.cash || 0} | bKash: ${selectedReportDay.breakdown?.bkash || 0}`
                            };
                            setPrintOrder(summaryOrder);
                          }}
                        >
                          <Text style={{ color: '#60A5FA', fontSize: 13, fontWeight: 'bold' }}>🖨️ দৈনিক সারাংশ রসিদ প্রিন্ট করুন</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                }

                return dayOrders.map((order, idx) => (
                  <View 
                    key={order.id || idx}
                    style={{ 
                      flexDirection: 'row', 
                      justifyContent: 'space-between', 
                      alignItems: 'center', 
                      backgroundColor: '#161B22', 
                      padding: 12, 
                      borderRadius: 10, 
                      marginBottom: 8,
                      borderWidth: 1,
                      borderColor: '#262D38'
                    }}
                  >
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                        <Text style={{ color: '#FFB703', fontWeight: 'bold', fontSize: 13, marginRight: 8 }}>{order.tableId || order.table}</Text>
                        <Text style={{ color: '#888', fontSize: 11 }}>{order.time}</Text>
                      </View>
                      <Text style={{ color: '#CBD5E1', fontSize: 11 }} numberOfLines={1}>{order.items}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', marginRight: 10 }}>
                      <Text style={{ color: '#34D399', fontWeight: 'bold', fontSize: 13 }}>৳{order.paidAmount || order.grandTotal || order.totalAmount}</Text>
                      <Text style={{ color: '#888', fontSize: 10 }}>{order.method || order.paymentMethod || 'Paid'}</Text>
                    </View>
                    <TouchableOpacity 
                      style={{ 
                        backgroundColor: 'rgba(59, 130, 246, 0.15)', 
                        width: 36, 
                        height: 36, 
                        borderRadius: 8, 
                        justifyContent: 'center', 
                        alignItems: 'center' 
                      }}
                      onPress={() => setPrintOrder(order)}
                    >
                      <Text style={{ fontSize: 16 }}>🖨️</Text>
                    </TouchableOpacity>
                  </View>
                ));
              })()}
            </ScrollView>

            <TouchableOpacity 
              style={[styles.modalCancelBtn, { width: '100%', marginTop: 14 }]} 
              onPress={() => setDayDetailModalVisible(false)}
            >
              <Text style={styles.modalCancelBtnText}>বন্ধ করুন</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Month Picker Modal */}
      <Modal animationType="fade" transparent={true} visible={monthPickerVisible} onRequestClose={() => setMonthPickerVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setMonthPickerVisible(false)}>
          <View style={[styles.modalContent, { width: '85%', maxHeight: '60%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'center', marginBottom: 15 }}>
              <Text style={[styles.modalTitle, { marginBottom: 0, fontSize: 16 }]}>মাস সিলেক্ট করুন</Text>
              <TouchableOpacity onPress={() => setMonthPickerVisible(false)} style={styles.closeCircle}><Text style={styles.closeCircleText}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView style={{ width: '100%' }} showsVerticalScrollIndicator={false}>
              {monthNames.map((m, idx) => (
                <TouchableOpacity 
                  key={m} 
                  style={{ 
                    paddingVertical: 14, 
                    borderBottomWidth: 1, 
                    borderColor: '#262626', 
                    alignItems: 'center',
                    backgroundColor: selectedMonth === idx ? 'rgba(255, 183, 3, 0.15)' : 'transparent',
                    borderRadius: 4
                  }}
                  onPress={() => {
                    setSelectedMonth(idx);
                    setMonthPickerVisible(false);
                  }}
                >
                  <Text style={{ color: selectedMonth === idx ? '#FFB703' : '#FFF', fontSize: 15, fontWeight: selectedMonth === idx ? 'bold' : 'normal' }}>{m}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Year Picker Modal */}
      <Modal animationType="fade" transparent={true} visible={yearPickerVisible} onRequestClose={() => setYearPickerVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setYearPickerVisible(false)}>
          <View style={[styles.modalContent, { width: '85%', maxHeight: '60%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'center', marginBottom: 15 }}>
              <Text style={[styles.modalTitle, { marginBottom: 0, fontSize: 16 }]}>বছর সিলেক্ট করুন</Text>
              <TouchableOpacity onPress={() => setYearPickerVisible(false)} style={styles.closeCircle}><Text style={styles.closeCircleText}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView style={{ width: '100%' }} showsVerticalScrollIndicator={false}>
              {yearsList.map((y) => (
                <TouchableOpacity 
                  key={y} 
                  style={{ 
                    paddingVertical: 14, 
                    borderBottomWidth: 1, 
                    borderColor: '#262626', 
                    alignItems: 'center',
                    backgroundColor: selectedYear === y ? 'rgba(255, 183, 3, 0.15)' : 'transparent',
                    borderRadius: 4
                  }}
                  onPress={() => {
                    setSelectedYear(y);
                    setYearPickerVisible(false);
                  }}
                >
                  <Text style={{ color: selectedYear === y ? '#FFB703' : '#FFF', fontSize: 15, fontWeight: selectedYear === y ? 'bold' : 'normal' }}>{y}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* PAST ACCOUNT MODAL */}
      <PastAccountModal
        visible={pastAccountModalVisible}
        onClose={() => setPastAccountModalVisible(false)}
        isEditingPast={isEditingPast}
        pastDate={pastDate}
        onOpenDatePicker={() => {
          setCalendarTarget('past');
          setCalendarVisible(true);
        }}
        pastTotalSell={pastTotalSell}
        setPastTotalSell={setPastTotalSell}
        pastBkash={pastBkash}
        setPastBkash={setPastBkash}
        pastNagad={pastNagad}
        setPastNagad={setPastNagad}
        pastRocket={pastRocket}
        setPastRocket={setPastRocket}
        pastCash={pastCash}
        setPastCash={setPastCash}
        pastDeliverySell={pastDeliverySell}
        setPastDeliverySell={setPastDeliverySell}
        pastDeliveryCharge={pastDeliveryCharge}
        setPastDeliveryCharge={setPastDeliveryCharge}
        pastDudu={pastDudu}
        setPastDudu={setPastDudu}
        pastAkash={pastAkash}
        setPastAkash={setPastAkash}
        pastBurger={pastBurger}
        setPastBurger={setPastBurger}
        pastBazar={pastBazar}
        setPastBazar={setPastBazar}
        pastOthers={pastOthers}
        setPastOthers={setPastOthers}
        pastIjara={pastIjara}
        setPastIjara={setPastIjara}
        pastNetCash={pastNetCash}
        setPastNetCash={setPastNetCash}
        pastDeposit={pastDeposit}
        setPastDeposit={setPastDeposit}
        pastNote={pastNote}
        setPastNote={setPastNote}
        onSave={handleSavePastEntry}
        formatDisplayDate={formatDisplayDate}
      />

      <PrintReceiptModal
        visible={!!printOrder}
        order={printOrder}
        onClose={() => setPrintOrder(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#161616', backgroundColor: '#0D0D0D' },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  menuButton: { marginRight: 12, padding: 6 },
  menuIcon: { fontSize: 22, color: '#FFB703' },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#FFB703', letterSpacing: 0.5 },
  headerDate: { fontSize: 12, color: '#A1A1AA', marginTop: 2 },
  notificationButton: { position: 'relative', padding: 6 },
  bellIcon: { fontSize: 20 },
  badgeContainer: { position: 'absolute', top: 0, right: 0, backgroundColor: '#FF4D4D', borderRadius: 8, width: 16, height: 16, justifyContent: 'center', alignItems: 'center' },
  badgeText: { color: '#FFF', fontSize: 9, fontWeight: 'bold' },
  menuDotsButton: { padding: 6 },
  menuDotsIcon: { fontSize: 24, color: '#FFB703', fontWeight: 'bold' },
  scrollBody: { flex: 1 },
  statsContainer: { paddingHorizontal: 12, paddingVertical: 16 },
  statsCard: { width: 170, borderRadius: 16, padding: 16, marginHorizontal: 6, borderWidth: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  cardGreen: { backgroundColor: 'rgba(16, 37, 24, 0.8)', borderColor: 'rgba(52, 211, 153, 0.4)' },
  cardOrange: { backgroundColor: 'rgba(36, 22, 14, 0.8)', borderColor: 'rgba(251, 146, 60, 0.4)' },
  cardBlue: { backgroundColor: 'rgba(15, 23, 42, 0.8)', borderColor: 'rgba(96, 165, 250, 0.4)' },
  cardYellow: { backgroundColor: 'rgba(30, 27, 12, 0.8)', borderColor: 'rgba(253, 224, 71, 0.4)' },
  statsCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  statsCardTitle: { fontSize: 13, color: '#FFF', fontWeight: '500' },
  statsEmoji: { fontSize: 16 },
  statsCardAmount: { fontSize: 18, fontWeight: 'bold', color: '#FFF', marginVertical: 4 },
  statsCardSubGreen: { fontSize: 10, color: '#34D399' },
  statsCardSubOrange: { fontSize: 10, color: '#FB923C' },
  statsCardSubBlue: { fontSize: 10, color: '#60A5FA' },
  statsCardSubYellow: { fontSize: 10, color: '#FDE047' },
  sectionContainer: { paddingHorizontal: 16, marginBottom: 24 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#FFF', letterSpacing: 0.3 },
  sectionSubtitle: { fontSize: 11, color: '#A1A1AA', fontWeight: 'normal' },
  infoIcon: { fontSize: 16, color: '#888' },
  tableGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', width: '100%', paddingBottom: 10 },
  tableCard: { width: '23.5%', aspectRatio: 0.75, borderRadius: 14, padding: 8, alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, borderWidth: 1.5, backgroundColor: '#161616', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3 },
  tableBusyBorder: { borderColor: 'rgba(251,146,60,0.5)', backgroundColor: 'rgba(36, 22, 14, 0.6)' },
  tableFreeBorder: { borderColor: 'rgba(52,211,153,0.4)' },
  tableId: { fontSize: 13, fontWeight: 'bold', color: '#FFF' },
  tableStatusRow: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 4 },
  dotGreen: { backgroundColor: '#34D399' },
  dotOrange: { backgroundColor: '#FB923C' },
  tableStatusText: { fontSize: 8, fontWeight: 'bold' },
  textGreen: { color: '#34D399' },
  textOrange: { color: '#FB923C' },
  tableAmount: { fontSize: 9, color: '#FFF' },
  emptyAmountPlaceholder: { height: 12 },
  chairIcon: { fontSize: 14, opacity: 0.3 },
  deliveryCard: { backgroundColor: '#0D0D0D', borderWidth: 1, borderColor: '#262626', borderRadius: 14, padding: 16 },
  deliveryTitle: { fontSize: 14, fontWeight: 'bold', color: '#FFF' },
  deliveryTime: { fontSize: 11, color: '#A1A1AA', marginVertical: 6 },
  deliveryAmount: { fontSize: 16, fontWeight: 'bold', color: '#FFB703' },
  emptyDeliveryPlaceholder: { width: '100%', height: 60, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,183,3,0.3)', justifyContent: 'center', alignItems: 'center' },
  emptyDeliveryText: { color: '#FFB703', fontWeight: 'bold', fontSize: 14 },
  orderList: { backgroundColor: '#161616', borderRadius: 14, borderWidth: 1, borderColor: '#262626', paddingHorizontal: 10, paddingVertical: 4 },
  orderItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderColor: '#1E1E1E' },
  orderItemLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  tableIconCircle: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  circleOrange: { backgroundColor: 'rgba(251,146,60,0.1)' },
  circleGreen: { backgroundColor: 'rgba(52,211,153,0.1)' },
  tableCircleText: { fontSize: 10, fontWeight: 'bold', color: '#FFF' },
  orderMeta: { flex: 1 },
  tableTimeRow: { flexDirection: 'row', alignItems: 'center' },
  orderTableText: { fontSize: 13, fontWeight: 'bold', color: '#FFF', marginRight: 8 },
  orderTimeText: { fontSize: 10, color: '#888' },
  orderItemsText: { fontSize: 11, color: '#888', marginTop: 2 },
  orderItemRight: { flexDirection: 'row', alignItems: 'center' },
  amountCol: { alignItems: 'flex-end', marginRight: 10 },
  orderItemAmount: { fontSize: 13, fontWeight: 'bold', color: '#FFF' },
  orderItemStatus: { fontSize: 10, marginTop: 2 },
  actionRow: { flexDirection: 'row' },
  printBtn: { backgroundColor: 'rgba(59, 130, 246, 0.15)', width: 28, height: 28, borderRadius: 6, justifyContent: 'center', alignItems: 'center', marginRight: 4 },
  modalPrintBtn: { backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#3B82F6', borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  modalPrintBtnText: { color: '#60A5FA', fontSize: 14, fontWeight: 'bold' },
  editBtn: { backgroundColor: 'rgba(255, 183, 3, 0.15)', width: 28, height: 28, borderRadius: 6, justifyContent: 'center', alignItems: 'center', marginRight: 4 },
  deleteBtn: { backgroundColor: 'rgba(255, 77, 77, 0.15)', width: 28, height: 28, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  btnIcon: { fontSize: 12 },
  lockWrapper: { width: 28, height: 28, justifyContent: 'center', alignItems: 'center', opacity: 0.5 },
  lockIcon: { fontSize: 14 },
  fabContainer: { position: 'absolute', bottom: 30, right: 16, left: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0D0D0D', padding: 8, borderRadius: 35, borderWidth: 1, borderColor: '#1A1A1A' },
  fabItemUnified: { flex: 1, height: 50, backgroundColor: '#1E1E1E', borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginHorizontal: 4, borderWidth: 1, borderColor: '#FFB703' },
  fabHighlight: { backgroundColor: '#FFB703' },
  fabIconSmall: { fontSize: 16, color: '#FFB703' },
  fabLabelSmall: { fontSize: 10, fontWeight: 'bold', color: '#FFB703', marginTop: 2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#0D0D0D', borderWidth: 1, borderColor: '#FFB703', borderRadius: 20, padding: 24, width: '85%', alignItems: 'center' },
  modalTitle: { fontSize: 17, fontWeight: 'bold', color: '#FFF', marginBottom: 10 },
  modalSubtitle: { fontSize: 11, color: '#888', textAlign: 'center' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderColor: '#1A1A1A' },
  detailLabel: { color: '#888', fontSize: 13 },
  detailValue: { color: '#FFF', fontSize: 13, fontWeight: '500' },
  modalInput: { backgroundColor: '#161616', borderWidth: 1, borderColor: '#262626', borderRadius: 12, height: 48, paddingHorizontal: 16, color: '#FFF', width: '100%' },
  modalBtnRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 20 },
  modalCancelBtn: { flex: 1, height: 46, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1E1E1E', borderRadius: 10, marginRight: 10 },
  modalCancelBtnText: { color: '#FFF', fontSize: 14 },
  modalSaveBtn: { flex: 1, height: 46, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFB703', borderRadius: 10, marginLeft: 10 },
  modalSaveBtnText: { color: '#000', fontSize: 14, fontWeight: 'bold' },
  menuModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-start', alignItems: 'flex-start' },
  menuModalContent: { backgroundColor: '#161616', borderRadius: 12, marginTop: 55, marginLeft: 16, width: 170, borderWidth: 1, borderColor: '#333' },
  menuOption: { paddingVertical: 10, paddingHorizontal: 16 },
  menuOptionText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  menuSectionHeader: { backgroundColor: '#111', paddingVertical: 4, paddingHorizontal: 14, borderBottomWidth: 1, borderColor: '#262626' },
  menuSectionText: { color: '#555', fontSize: 9, fontWeight: 'bold', letterSpacing: 1 },
  sheetContainer: { width: '100%', backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#333', overflow: 'hidden' },
  sheetHeader: { flexDirection: 'row', backgroundColor: '#222', paddingVertical: 10, paddingHorizontal: 10, borderBottomWidth: 1, borderColor: '#444' },
  sheetHeaderText: { color: '#FFB703', fontSize: 10, fontWeight: 'bold', textAlign: 'center' },
  sheetBody: { maxHeight: 380 },
  sheetRow: { flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 0.5, borderColor: '#222', alignItems: 'center' },
  sheetRowAlt: { backgroundColor: '#0A0A0A' },
  sheetCell: { color: '#FFF', fontSize: 10, textAlign: 'center' },
  sheetCellTextMain: { color: '#FFF', fontSize: 10, fontWeight: '500' },
  sheetCellTextSub: { color: '#888', fontSize: 8, marginTop: 1 },
  filterBar: { flexDirection: 'row', marginBottom: 12, height: 36 },
  filterChip: { paddingHorizontal: 12, borderRadius: 18, backgroundColor: '#1E1E1E', borderWidth: 1, borderColor: '#333', marginRight: 8, height: 32, justifyContent: 'center' },
  filterChipActive: { backgroundColor: '#FFB703', borderColor: '#FFB703' },
  filterChipText: { color: '#888', fontSize: 10, fontWeight: '500' },
  filterChipTextActive: { color: '#000', fontWeight: 'bold' },
  sheetFooter: { flexDirection: 'row', backgroundColor: '#1A1A1A', paddingVertical: 12, paddingHorizontal: 10, borderTopWidth: 2, borderColor: '#FFB703' },
  sheetFooterText: { color: '#FFB703', fontSize: 10, fontWeight: 'bold', textAlign: 'center' },
  closeCircle: { backgroundColor: '#1E1E1E', width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  closeCircleText: { color: '#888', fontSize: 14 },
  modalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 16 },
  modalHeaderLeft: { flexDirection: 'row', alignItems: 'center' },
  modalIconCircle: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(255,183,3,0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  modalIconEmoji: { fontSize: 24 },
  filterSection: { width: '100%', marginBottom: 10 },
  pickDateWrapper: { flexDirection: 'row', alignItems: 'center', marginTop: 4, backgroundColor: '#161616', borderRadius: 8, paddingHorizontal: 10, height: 44, borderWidth: 1, borderColor: '#333' },
  pickDateInput: { color: '#FFF', fontSize: 12, width: 80 },
  modalFooterActions: { flexDirection: 'row', marginTop: 16, width: '100%' },
  exportBtn: { flex: 1.2, backgroundColor: '#34D399', borderRadius: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginRight: 8, height: 44 },
  exportBtnText: { color: '#000', fontWeight: 'bold', fontSize: 13 },
  exportBtnIcon: { marginRight: 6 },
  historyCloseBtn: { flex: 1, backgroundColor: '#1E1E1E', borderRadius: 10, justifyContent: 'center', alignItems: 'center', height: 44, borderWidth: 1, borderColor: '#333' },
  historyCloseBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 13 },
  ijaraInputWrapper: { width: '100%', marginBottom: 20 },
  renameInputWrapper: { width: '100%', backgroundColor: '#161616', borderWidth: 1, borderColor: '#262626', borderRadius: 12, height: 50, paddingHorizontal: 16, justifyContent: 'center', marginBottom: 20 },
  renameInput: { color: '#FFFFFF', fontSize: 15 },
  expenseInputGroup: { width: '100%', marginBottom: 12 },
  inputLabel: { color: '#888', fontSize: 11, marginBottom: 6, fontWeight: 'bold' },
  breakdownSummaryCard: { width: '100%', backgroundColor: 'rgba(239, 68, 68, 0.05)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.15)', borderRadius: 12, padding: 12, marginTop: 16 },
  breakdownTitle: { color: '#FCA5A5', fontSize: 12, fontWeight: 'bold', marginBottom: 10 },
  breakdownGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  breakdownItem: { width: '48%', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  breakdownLabel: { color: '#888', fontSize: 10 },
  breakdownValue: { color: '#FFFFFF', fontSize: 10, fontWeight: '500' },
  emptySheetText: { color: '#888', textAlign: 'center', padding: 20, fontSize: 12 },
  manualBadge: { backgroundColor: 'rgba(255, 183, 3, 0.2)', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, marginLeft: 4 },
  manualBadgeText: { color: '#FFB703', fontSize: 8, fontWeight: 'bold' },
  
  // Calendar Styles
  calendarOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  calendarContent: { backgroundColor: '#111', width: width * 0.85, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#333' },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  calNav: { color: '#FFB703', fontSize: 20, paddingHorizontal: 10 },
  calTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  calWeekRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 10 },
  calWeekDay: { color: '#666', fontSize: 12, width: 35, textAlign: 'center' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around' },
  calDayCell: { width: 35, height: 35, justifyContent: 'center', alignItems: 'center', marginBottom: 5, borderRadius: 17 },
  calDayText: { color: '#FFF', fontSize: 13 },
  calCloseBtn: { marginTop: 20, height: 44, backgroundColor: '#1E1E1E', borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  calCloseBtnText: { color: '#888', fontSize: 14 },
  syncTimerWrapper: { paddingVertical: 4, paddingHorizontal: 12, backgroundColor: '#161616', borderRadius: 8, marginHorizontal: 16, marginTop: 4, marginBottom: 4, alignItems: 'center', borderWidth: 1, borderColor: '#222' },
  syncTimerText: { color: '#FFB703', fontSize: 8, fontWeight: '600', marginVertical: 1 },

  // ── REUSED ADMIN DASHBOARD STYLES ──
  card: {
    backgroundColor: '#181E25',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#242C37',
    padding: 16,
    marginBottom: 16,
    marginHorizontal: 16,
  },
  sectionHeaderTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginBottom: 6,
  },
  // Table + Delivery Section
  tableDeliveryCard: {
    backgroundColor: '#181E25',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#242C37',
    padding: 16,
    marginBottom: 16,
    marginHorizontal: 16,
  },
  tableDeliveryHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  tableDeliveryTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  tableFilterPillGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111417',
    borderRadius: 18,
    padding: 3,
    borderWidth: 1,
    borderColor: '#242C37',
  },
  tableFilterBtn: {
    paddingHorizontal: 11,
    paddingVertical: 4.5,
    borderRadius: 14,
  },
  tableFilterBtnActive: {
    backgroundColor: '#242D38',
  },
  tableFilterBtnText: {
    color: '#8B95A5',
    fontSize: 12,
    fontWeight: '600',
  },
  tableFilterBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  tableVisualGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  tableGridCard: {
    width: '23.5%',
    aspectRatio: 0.72,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
  tableGridCardBusy: {
    backgroundColor: '#272015',
    borderColor: '#F59E0B',
  },
  tableGridCardFree: {
    backgroundColor: '#141A22',
    borderColor: '#1D5A56',
  },
  tableCardTitle: {
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  tableCardTitleBusy: {
    color: '#F59E0B',
  },
  tableCardTitleFree: {
    color: '#FFFFFF',
  },
  tableStatusIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  tableStatusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 4,
  },
  tableStatusLabel: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  tableCardAmount: {
    fontSize: 12.5,
    fontWeight: '800',
    textAlign: 'center',
    minHeight: 16,
  },
  tableCardChairIcon: {
    fontSize: 15,
    opacity: 0.35,
    textAlign: 'center',
  },
  deliveryDividerContainer: {
    marginVertical: 12,
  },
  deliveryDividerLine: {
    height: 1,
    backgroundColor: '#242C37',
    width: '100%',
  },
  activeDeliverySectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  activeDeliverySectionTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  activeDeliveryCountBadge: {
    backgroundColor: '#342410',
    paddingHorizontal: 10,
    paddingVertical: 3.5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.25)',
  },
  activeDeliveryCountBadgeText: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '700',
  },
  newDeliveryMiniBtn: {
    backgroundColor: 'rgba(255, 183, 3, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 183, 3, 0.35)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  newDeliveryMiniBtnText: {
    color: '#FFB703',
    fontSize: 11,
    fontWeight: '700',
  },
  activeDeliveryCard: {
    backgroundColor: '#111417',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#222834',
    marginBottom: 8,
  },
  activeDeliveryHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  activeDeliveryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
    minWidth: 0,
  },
  deliveryRiderIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#282314',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  deliveryRiderIcon: {
    fontSize: 22,
  },
  activeDeliveryName: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
  activeDeliverySub: {
    color: '#8B95A5',
    fontSize: 11.5,
    marginTop: 3,
  },
  activeDeliveryRight: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  activeDeliveryAmount: {
    color: '#F59E0B',
    fontSize: 16,
    fontWeight: '800',
  },
  emptyDeliveryBox: {
    alignItems: 'center',
    paddingVertical: 18,
  },
  emptyDeliveryEmoji: {
    fontSize: 26,
    marginBottom: 4,
  },
  emptyDeliveryText: {
    color: '#8E8E93',
    fontSize: 11,
    fontWeight: '600',
  },

  // Top Selling Items
  topSellerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  topSellerSubtitle: { color: '#CBD5E1', fontSize: 12, marginTop: 2 },
  topSellerReportBtn: { paddingVertical: 4, paddingHorizontal: 6 },
  topSellerReportBtnText: { color: '#FFB703', fontSize: 12, fontWeight: '700' },
  topHeroCard: { backgroundColor: '#13181F', borderRadius: 16, borderWidth: 1, borderColor: '#242C37', padding: 16, marginBottom: 12, position: 'relative', overflow: 'hidden' },
  topHeroDecorCircle: { position: 'absolute', right: -25, top: -25, width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255, 183, 3, 0.04)' },
  topHeroBadge: { backgroundColor: 'rgba(255, 183, 3, 0.12)', borderWidth: 1, borderColor: 'rgba(255, 183, 3, 0.25)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, alignSelf: 'flex-start', marginBottom: 10 },
  topHeroBadgeText: { color: '#FFB703', fontSize: 11, fontWeight: '700' },
  topHeroContentRow: { flexDirection: 'row', alignItems: 'center' },
  topHeroRankBox: { width: 50, height: 50, borderRadius: 14, backgroundColor: 'rgba(255, 183, 3, 0.1)', borderWidth: 1, borderColor: 'rgba(255, 183, 3, 0.2)', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  topHeroRankNum: { color: '#FFB703', fontSize: 24, fontWeight: '900' },
  topHeroInfoCol: { flex: 1, minWidth: 0 },
  topHeroTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  topHeroSub: { color: '#E2E8F0', fontSize: 12, fontWeight: '600', marginTop: 2, marginBottom: 4 },
  topHeroPrice: { color: '#FFB703', fontSize: 20, fontWeight: '900' },
  rankedListCard: { backgroundColor: '#13181F', borderRadius: 14, borderWidth: 1, borderColor: '#242C37', marginBottom: 0, overflow: 'hidden' },
  rankedItemRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12 },
  rankedItemBorderBottom: { borderBottomWidth: 1, borderColor: '#1E2632' },
  rankedBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#1E2632', justifyContent: 'center', alignItems: 'center', marginRight: 10, flexShrink: 0 },
  rankedBadgeText: { color: '#E2E8F0', fontSize: 11, fontWeight: '800' },
  rankedItemMiddleCol: { flex: 1, marginRight: 12, minWidth: 0 },
  rankedItemName: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  rankedItemSubRow: { flexDirection: 'row', alignItems: 'center' },
  rankedItemCategory: { color: '#94A3B8', fontSize: 10, marginRight: 8, maxWidth: 65 },
  rankedProgressBarTrack: { flex: 1, height: 5, borderRadius: 2.5, backgroundColor: '#1E2632', overflow: 'hidden' },
  rankedProgressBarFill: { height: '100%', borderRadius: 2.5, backgroundColor: '#FFB703' },
  rankedItemRightCol: { alignItems: 'flex-end', flexShrink: 0 },
  rankedItemAmount: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  rankedItemQty: { color: '#10B981', fontSize: 11, fontWeight: '600', marginTop: 2 },
  emptyState: { alignItems: 'center', paddingVertical: 20 },
  emptyStateEmoji: { fontSize: 28, marginBottom: 8 },
  emptyStateText: { color: '#8E8E93', fontSize: 12, fontWeight: '600', marginBottom: 3 },
  emptyStateSub: { color: '#666666', fontSize: 10, textAlign: 'center', paddingHorizontal: 20 },

  // ── DAILY SUBMIT STATUS BANNER ──
  submitStatusCardSuccess: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#059669',
    elevation: 2
  },
  submitStatusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10
  },
  submitBadgeSuccess: {
    backgroundColor: '#065F46',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6
  },
  submitBadgeSuccessText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: 'bold'
  },
  submitTimeText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '500'
  },
  submitDetailsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 6,
    marginBottom: 8
  },
  submitDetailCol: {
    alignItems: 'center',
    flex: 1
  },
  submitDetailLabel: {
    color: '#94A3B8',
    fontSize: 10,
    marginBottom: 3
  },
  submitDetailValue: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: 'bold'
  },
  nextDayIjaraBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#064E3B',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#10B981'
  },
  nextDayIjaraTitle: {
    color: '#A7F3D0',
    fontSize: 12,
    fontWeight: '600'
  },
  nextDayIjaraValue: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold'
  },
  submitStatusCardPending: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#D97706',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  submitBadgePending: {
    backgroundColor: '#78350F',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  submitBadgePendingText: {
    color: '#FBBF24',
    fontSize: 11,
    fontWeight: 'bold'
  },
  submitPendingSubtext: {
    color: '#94A3B8',
    fontSize: 11,
    fontStyle: 'italic'
  },
});
