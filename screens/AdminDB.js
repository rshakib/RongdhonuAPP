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
import { formatDisplayDate, getBusinessDate, inspectDatabaseStats, executeInspectorQuery, getFirebaseUsageStats, verifyPinCode, deleteDataByDate } from '../database';

const { width } = Dimensions.get('window');

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
const CalendarPicker = ({ visible, onClose, onSelectDate }) => {
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

export default function AdminDB({ onLogout, tables, deliveries = [], completedOrders = [], submissionHistory = [], onTableSelect, onCreateDelivery, onUpdateTableName, onNavigateToExpenses, onNavigateToSubmit, onNavigateToEditMenu, onNavigateToSupplierDue, onNavigateToItemSalesReport, onNavigateToSyncDiagnostics, onNavigateToDeleteHistory, onCloudRestore, onMenuRecovery, onResetHistoryLimits, onHistoricalMonthDownload, onSavePastAccount, onDeletePastAccount, dailyExpenses, onUpdateExpenses, isDailySubmitted, onDeleteActiveOrder, onDeleteDoneOrder, onResetDailySubmit, onResetIjara, delCountdown, tabCountdown, fullCountdown }) {
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [selectedTableForRename, setSelectedTableForRename] = useState(null);
  const [newTableName, setNewTableName] = useState('');

  // Delete History Widget State
  const [deleteHistoryWidget, setDeleteHistoryWidget] = useState([]);

  useEffect(() => {
    // Load latest 10 delete records for widget
    const { getDeleteHistory } = require('../database');
    setDeleteHistoryWidget(getDeleteHistory(10));
  }, []);

  // 3-Dot Menu and Report States
  const [menuModalVisible, setMenuModalVisible] = useState(false);
  const [ijaraModalVisible, setIjaraModalVisible] = useState(false);
  const [salesReportVisible, setSalesReportVisible] = useState(false);
  const [depositReportVisible, setDepositReportVisible] = useState(false);
  const [tempIjara, setTempIjara] = useState(dailyExpenses.ijara.toString());

  // Firebase Usage States
  const [firebaseUsageVisible, setFirebaseUsageVisible] = useState(false);
  const [isUsageAuthorized, setIsUsageAuthorized] = useState(false);
  const [usagePinInput, setUsagePinInput] = useState('');
  const [dbStatsData, setDbStatsData] = useState(null);
  const [customSqlQuery, setCustomSqlQuery] = useState('SELECT * FROM sync_queue LIMIT 5');
  const [sqlQueryResult, setSqlQueryResult] = useState(null);
  const [sqlQueryError, setSqlQueryError] = useState(null);
  const [firebaseUsageData, setFirebaseUsageData] = useState(null);

  // Data Cleanup Tool States
  const [cleanupModalVisible, setCleanupModalVisible] = useState(false);
  const [cleanupTargetDate, setCleanupTargetDate] = useState('2026-06-01');
  const [cleanupCounts, setCleanupCounts] = useState(null);
  
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
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        if (monthInt >= 1 && monthInt <= 12) return `${monthNames[monthInt - 1]} ${year}`;
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
  
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [pickDate, setPickDate] = useState('📅 তারিখ সিলেক্ট করুন');
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [yearPickerVisible, setYearPickerVisible] = useState(false);

  // Calendar State
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarTarget, setCalendarTarget] = useState(''); // 'past' or 'sales'

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderDetailVisible, setOrderDetailVisible] = useState(false);

  // Android Back Handler for Modals
  useEffect(() => {
    const backAction = () => {
      // Priority: Close modals from top to bottom
      if (orderDetailVisible) { setOrderDetailVisible(false); return true; }
      if (calendarVisible) { setCalendarVisible(false); return true; }
      if (yearPickerVisible) { setYearPickerVisible(false); return true; }
      if (monthPickerVisible) { setMonthPickerVisible(false); return true; }
      if (pastAccountModalVisible) { setPastAccountModalVisible(false); return true; }
      if (cleanupModalVisible) { setCleanupModalVisible(false); return true; }
      if (firebaseUsageVisible) { setFirebaseUsageVisible(false); return true; }
      if (ijaraModalVisible) { setIjaraModalVisible(false); return true; }
      if (salesReportVisible) { setSalesReportVisible(false); return true; }
      if (depositReportVisible) { setDepositReportVisible(false); return true; }
      if (menuModalVisible) { setMenuModalVisible(false); return true; }
      if (renameModalVisible) { setRenameModalVisible(false); return true; }

      return false; // Let App.js handle screen back
    };

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      backAction
    );

    return () => backHandler.remove();
  }, [orderDetailVisible, calendarVisible, yearPickerVisible, monthPickerVisible, pastAccountModalVisible, cleanupModalVisible, firebaseUsageVisible, ijaraModalVisible, salesReportVisible, depositReportVisible, menuModalVisible, renameModalVisible]);

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
    const dateStr = formatDisplayDate(yesterday);
    setPastDate(dateStr);
    setPastAccountModalVisible(true);
  };

  const handlePastDateChange = (date) => {
    setPastDate(date);
  };

  const handleSavePastEntry = () => {
    if (!pastDate || !pastTotalSell) {
      Alert.alert("ত্রুটি", "তারিখ এবং মোট বিক্রয় আবশ্যিক!");
      return;
    }

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
    const sell = parseFloat(pastTotalSell) || 0;

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

  const handleOpenFirebaseUsage = () => {
    setIsUsageAuthorized(false);
    setUsagePinInput('');
    setDbStatsData(null);
    setFirebaseUsageData(null);
    setFirebaseUsageVisible(true);
  };

  const handleAuthorizeUsage = () => {
    const user = verifyPinCode(usagePinInput);
    if (user && user.role === 'admin') {
      setIsUsageAuthorized(true);
      handleRefreshUsageData();
    } else {
      Alert.alert("এক্সেস ডিনাইড", "সঠিক এডমিন পিন প্রদান করুন।");
      setUsagePinInput('');
    }
  };

  const handleRefreshUsageData = () => {
    try {
      const stats = inspectDatabaseStats();
      setDbStatsData(stats);
      
      const usage = getFirebaseUsageStats();
      setFirebaseUsageData(usage);
      setSqlQueryResult(null);
      setSqlQueryError(null);
    } catch (e) {
      Alert.alert("ত্রুটি", "ডাটা লোড করা সম্ভব হয়নি: " + e.message);
    }
  };

  const handleExecuteSqlQuery = () => {
    setSqlQueryResult(null);
    setSqlQueryError(null);
    if (!customSqlQuery.trim()) {
      setSqlQueryError("অনুগ্রহ করে একটি SELECT কোয়েরি টাইপ করুন!");
      return;
    }
    try {
      const results = executeInspectorQuery(customSqlQuery);
      setSqlQueryResult(results);
      if (results.length === 0) {
        setSqlQueryError("কোয়েরি সফল হয়েছে কিন্তু কোনো তথ্য পাওয়া যায়নি (০ টি রো)।");
      }
    } catch (e) {
      setSqlQueryError(e.message);
    }
  };

  const handleRunCleanupAudit = () => {
    try {
      const target = cleanupTargetDate;
      const countOrders = executeInspectorQuery("SELECT COUNT(*) as c FROM orders WHERE date(created_at, 'localtime', '-1 hour') = ?", [target])[0]?.c || 0;
      const countPayments = executeInspectorQuery("SELECT COUNT(*) as c FROM payments WHERE date(created_at, 'localtime', '-1 hour') = ?", [target])[0]?.c || 0;
      const countDeliveries = executeInspectorQuery("SELECT COUNT(*) as c FROM deliveries WHERE date(completed_at, 'localtime', '-1 hour') = ?", [target])[0]?.c || 0;
      const countExpenses = executeInspectorQuery("SELECT COUNT(*) as c FROM expenses WHERE date(created_at, 'localtime', '-1 hour') = ?", [target])[0]?.c || 0;
      const countSubmit = executeInspectorQuery("SELECT COUNT(*) as c FROM daily_submit WHERE date = ?", [target])[0]?.c || 0;
      const countSummary = executeInspectorQuery("SELECT COUNT(*) as c FROM daily_summary WHERE date = ?", [target])[0]?.c || 0;
      const countSyncQueue = executeInspectorQuery("SELECT COUNT(*) as c FROM sync_queue WHERE record_id LIKE ?", [`%${target}%`])[0]?.c || 0;
      
      setCleanupCounts({
        orders: countOrders,
        payments: countPayments,
        deliveries: countDeliveries,
        expenses: countExpenses,
        submit: countSubmit,
        summary: countSummary,
        syncQueue: countSyncQueue
      });
    } catch (e) {
      Alert.alert("Audit Error", e.message);
    }
  };

  const handleConfirmCleanup = () => {
    Alert.alert(
      "Warning",
      `Are you sure you want to permanently delete all local data for ${cleanupTargetDate}?`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete Data", 
          style: "destructive",
          onPress: () => {
            const res = deleteDataByDate(cleanupTargetDate);
            if (res.success) {
              Alert.alert("Success", "Data deleted successfully. Restarting dashboard...");
              setCleanupModalVisible(false);
            } else {
              Alert.alert("Error", res.error);
            }
          }
        }
      ]
    );
  };

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
  
  const availableMonthsRaw = Array.from(new Set(submissionHistory.map(item => getMonthName(item.date)).filter(Boolean)));

  const sortMonths = (months) => {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return [...months].sort((a, b) => {
      const partsA = a.split(' ');
      const partsB = b.split(' ');
      if (partsA.length === 2 && partsB.length === 2) {
        const yearA = parseInt(partsA[1], 10);
        const yearB = parseInt(partsB[1], 10);
        if (yearA !== yearB) return yearB - yearA;
        const monthIdxA = monthNames.indexOf(partsA[0]);
        const monthIdxB = monthNames.indexOf(partsB[0]);
        return monthIdxB - monthIdxA;
      }
      return 0;
    });
  };

  const fullHistory = submissionHistory.filter(item => getMonthName(item.date) === activeFilter).sort((a, b) => new Date(a.date) - new Date(b.date));
  const filteredHistory = showFullHistory ? fullHistory : fullHistory.slice(-3);

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
        if (monthIdx === -1) monthIdx = monthsLong.indexOf(monthName);
        if (monthIdx !== -1) {
          const monthStr = String(monthIdx + 1).padStart(2, '0');
          return `${year}-${monthStr}-${day}`;
        }
      }
    } catch (e) {}
    return '';
  };

  const filteredSalesOrders = completedOrders.filter(order => {
    const todayStr = formatDateToYYYYMMDD(new Date());
    const orderDate = order.fullDate || todayStr;
    if (salesFilter === 'Today') return orderDate === todayStr;
    if (salesFilter === 'Yesterday') {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      return orderDate === formatDateToYYYYMMDD(yesterday);
    }
    if (salesFilter === 'Last 7 Days') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      return orderDate >= formatDateToYYYYMMDD(sevenDaysAgo) && orderDate <= todayStr;
    }
    if (salesFilter === 'Pick Date') {
      const targetDateStr = parseCustomDateToYYYYMMDD(pickDate);
      return targetDateStr ? orderDate === targetDateStr : false;
    }
    return true;
  });

  return (
    <SafeAreaView style={styles.container}>
      <CalendarPicker visible={calendarVisible} onClose={() => setCalendarVisible(false)} onSelectDate={(date) => { if (calendarTarget === 'past') handlePastDateChange(date); else setPickDate(date); }}/>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.menuDotsButton} onPress={() => setMenuModalVisible(true)}><Text style={styles.menuDotsIcon}>☰</Text></TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.titleBadgeRow}><Text style={styles.headerTitle}>Admin Dashboard</Text><View style={styles.adminBadge}><Text style={styles.adminBadgeText}>Admin</Text></View></View>
          <Text style={styles.headerDate}>{getBengaliDate()}</Text>
        </View>
        <View style={{ width: 40 }} /> 
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollBody} contentContainerStyle={{ paddingBottom: 110 }}>
        {/* Horizontal Stats Row */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsContainer}>
          <View style={[styles.statsCard, styles.cardGreen]}>
            <View style={styles.statsCardHeader}><Text style={styles.statsCardTitle}>আজকের বিক্রয়</Text><Text style={styles.statsEmoji}>📈</Text></View>
            <Text style={styles.statsCardAmount}>৳ {todaySale.toLocaleString()}</Text>
            <View style={{ marginVertical: 4 }}>
              {bkashSale > 0 && <Text style={{ color: '#34D399', fontSize: 10 }}>বিকাশ: ৳{bkashSale.toLocaleString()}</Text>}
              {nagadSale > 0 && <Text style={{ color: '#34D399', fontSize: 10 }}>নগদ: ৳{nagadSale.toLocaleString()}</Text>}
              {rocketSale > 0 && <Text style={{ color: '#34D399', fontSize: 10 }}>রকেট: ৳{rocketSale.toLocaleString()}</Text>}
            </View>
            <Text style={styles.statsCardSubGreen}>↑ {totalDoneCount} সফল অর্ডার</Text>
          </View>
          <View style={[styles.statsCard, styles.cardBlue]}>
            <View style={styles.statsCardHeader}><Text style={styles.statsCardTitle}>মোট ক্যাশ</Text><Text style={styles.statsEmoji}>💹</Text></View>
            <Text style={styles.statsCardAmount}>৳ {totalCash.toLocaleString()}</Text>
            <Text style={{ color: '#EF4444', fontSize: 11, fontWeight: 'bold', marginBottom: 2 }}>Cashbox: ৳ {(totalCash - (bkashSale + nagadSale + rocketSale)).toLocaleString()}</Text>
            <Text style={styles.statsCardSubBlue}>বিক্রয় + ইজা - খরচ</Text>
          </View>
          <View style={[styles.statsCard, styles.cardOrange]}>
            <View style={styles.statsCardHeader}><Text style={styles.statsCardTitle}>Active টেবিল</Text><Text style={styles.statsEmoji}>👥</Text></View>
            <Text style={styles.statsCardAmount}>{totalActiveCount} / {tables.length}</Text>
            <Text style={styles.statsCardSubOrange}>{totalActiveCount} টি ব্যস্ত আছে</Text>
          </View>
          <View style={[styles.statsCard, styles.cardYellow]}>
            <View style={styles.statsCardHeader}><Text style={styles.statsCardTitle}>এই মাসের মোট</Text><Text style={styles.statsEmoji}>💰</Text></View>
            <Text style={styles.statsCardAmount}>৳ {monthlyTotalSell.toLocaleString()}</Text>
            <Text style={styles.statsCardSubYellow}>{getBengaliMonthRange()}</Text>
          </View>
        </ScrollView>

        {/* Table Grid */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}><Text style={styles.sectionTitle}>টেবিল স্ট্যাটাস <Text style={styles.sectionSubtitle}>(রিনেম করতে লং প্রেস)</Text></Text><Text style={styles.infoIcon}>ℹ️</Text></View>
          <View style={styles.tableGrid}>
             {tables.map((table) => {
               const isBusy = table.status === 'BUSY';
               const amount = table.items?.reduce((sum, i) => sum + (i.price * i.qty), 0) || 0;
               return (
                 <TouchableOpacity key={table.id} onPress={() => onTableSelect(table.id)} onLongPress={() => handleTableLongPress(table)} style={[styles.tableCard, isBusy ? styles.tableBusyBorder : styles.tableFreeBorder]}>
                   <Text style={styles.tableId}>{table.name || table.id}</Text>
                   <View style={styles.tableStatusRow}><View style={[styles.statusDot, isBusy ? styles.dotOrange : styles.dotGreen]} /><Text style={[styles.tableStatusText, isBusy ? styles.textOrange : styles.textGreen]}>{table.status}</Text></View>
                   {isBusy ? <Text style={styles.tableAmount}>৳ {amount}</Text> : <View style={{height:10}} />}
                   <Text style={styles.chairIcon}>🪑</Text>
                 </TouchableOpacity>
               );
             })}
          </View>
        </View>

        <View style={styles.sectionContainer}>
          <Text style={styles.sectionTitle}>সক্রিয় ডেলিভারি ({deliveries.filter(d => d.status === 'BUSY').length})</Text>
          <View style={{ marginTop: 10 }}>
             {deliveries.filter(d => d.status === 'BUSY').map((delivery) => (
                   <TouchableOpacity key={delivery.id} style={[styles.deliveryCard, { marginBottom: 10 }]} onPress={() => onTableSelect(delivery.id)}>
                     <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                       <View><Text style={styles.deliveryTitle}>{delivery.name}</Text><Text style={styles.deliveryTime}>শুরু: {delivery.startTime}</Text></View>
                       <Text style={styles.deliveryAmount}>৳ {delivery.items.reduce((sum, i) => sum + (i.price * i.qty), 0)}</Text>
                     </View>
                   </TouchableOpacity>
             ))}
             <TouchableOpacity style={styles.emptyDeliveryPlaceholder} onPress={onCreateDelivery}><Text style={styles.emptyDeliveryText}>➕ নতুন ডেলিভারি শুরু করুন</Text></TouchableOpacity>
          </View>
        </View>

        {/* Order Log */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}><Text style={styles.sectionTitle}>আজকের অর্ডার লগ</Text></View>
          <View style={styles.orderList}>
            {filteredOrders.length === 0 ? <Text style={{ color: '#888', textAlign: 'center', padding: 20 }}>কোনো অর্ডার পাওয়া যায়নি</Text> : 
              filteredOrders.map((order) => (
                <TouchableOpacity key={order.id} style={styles.orderItem} onPress={() => { setSelectedOrder(order); setOrderDetailVisible(true); }}>
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
                      <TouchableOpacity style={styles.editBtn} onPress={() => onTableSelect(order.id)}><Text style={styles.btnIcon}>✏️</Text></TouchableOpacity>
                      <TouchableOpacity style={styles.deleteBtn} onPress={() => onDeleteDoneOrder(order.id)}><Text style={styles.btnIcon}>🗑️</Text></TouchableOpacity>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
              </View>
              </View>

              {/* SYSTEM AUDIT WIDGET */}
              <View style={styles.sectionContainer}>
              <View style={styles.sectionHeaderRow}>
              <View>
              <Text style={styles.sectionTitle}>🗑 মুছে ফেলা ইতিহাস (Delete History)</Text>
              <Text style={styles.sectionSubtitle}>সর্বশেষ ১০টি রেকর্ড</Text>
              </View>
              <TouchableOpacity onPress={onNavigateToDeleteHistory}>
              <Text style={{ color: '#FFB703', fontSize: 12, fontWeight: 'bold' }}>সব দেখুন ❯</Text>
              </TouchableOpacity>
              </View>

              <View style={styles.orderList}>
              {deleteHistoryWidget.length === 0 ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
               <Text style={{ color: '#666', fontSize: 12 }}>কোনো ডাটা পাওয়া যায়নি।</Text>
              </View>
              ) : (
              deleteHistoryWidget.map((item, index) => (
               <TouchableOpacity key={item.id} style={styles.orderItem} onPress={onNavigateToDeleteHistory}>
                 <View style={styles.orderItemLeft}>
                   <View style={[styles.tableIconCircle, { backgroundColor: 'rgba(255, 77, 77, 0.1)' }]}>
                     <Text style={[styles.tableCircleText, { color: '#EF4444' }]}>🗑</Text>
                   </View>
                   <View style={styles.orderMeta}>
                     <Text style={styles.orderTableText}>{item.record_type} Deleted</Text>
                     <Text style={styles.orderItemsText}>By: {item.deleted_by}</Text>
                   </View>
                 </View>
                 <View style={styles.amountCol}>
                   <Text style={styles.orderTimeText}>{formatDisplayDate(item.deleted_at)}</Text>
                   <Text style={[styles.orderItemStatus, { color: '#888' }]}>{item.record_id}</Text>
                 </View>
               </TouchableOpacity>
              ))
              )}
              </View>
              </View>

      </ScrollView>

      {/* Floating Buttons */}
      <View style={styles.fabContainer}>
        <TouchableOpacity style={styles.fabItemUnified} onPress={onCreateDelivery}><Text style={styles.fabIconSmall}>🛵</Text><Text style={styles.fabLabelSmall}>ডেলিভারি</Text></TouchableOpacity>
        <TouchableOpacity style={styles.fabItemUnified} onPress={onNavigateToExpenses}><Text style={styles.fabIconSmall}>📉</Text><Text style={styles.fabLabelSmall}>খরচ</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.fabItemUnified, styles.fabHighlight]} onPress={onNavigateToSubmit}><Text style={[styles.fabIconSmall, { color: '#000' }]}>📝</Text><Text style={[styles.fabLabelSmall, { color: '#000' }]}>সাবমিট</Text></TouchableOpacity>
      </View>

      {/* MODALS */}
      {/* ORDER DETAIL */}
      <Modal animationType="slide" transparent={true} visible={orderDetailVisible} onRequestClose={() => setOrderDetailVisible(false)}>
        <View style={styles.modalOverlay}><View style={[styles.modalContent, { width: '90%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'center', marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}><View style={[styles.modalIconCircle, { marginBottom: 0, width: 40, height: 40, marginRight: 12 }]}><Text style={styles.modalIconEmoji}>📋</Text></View><Text style={[styles.modalTitle, { marginBottom: 0 }]}>অর্ডার বিস্তারিত</Text></View>
              <TouchableOpacity onPress={() => setOrderDetailVisible(false)} style={styles.closeCircle}><Text style={styles.closeCircleText}>✕</Text></TouchableOpacity>
            </View>
            {selectedOrder && (
              <View style={{ width: '100%', paddingVertical: 10 }}>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>টেবিল:</Text><Text style={styles.detailValue}>{selectedOrder.table}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>সময়:</Text><Text style={styles.detailValue}>{selectedOrder.time}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>তারিখ:</Text><Text style={styles.detailValue}>{selectedOrder.fullDate ? formatDisplayDate(selectedOrder.fullDate) : 'আজ'}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>পেমেন্ট মাধ্যম:</Text><Text style={styles.detailValue}>{selectedOrder.method}</Text></View>
                
                {/* Detailed Payment Breakdown */}
                <View style={{ marginTop: 8, padding: 8, backgroundColor: '#0A0A0A', borderRadius: 8, borderWidth: 1, borderColor: '#1A1A1A' }}>
                   <Text style={{ color: '#888', fontSize: 10, marginBottom: 6, fontWeight: 'bold' }}>পেমেন্ট ব্রেকডাউন:</Text>
                   <View style={styles.detailRow}><Text style={[styles.detailLabel, { fontSize: 11 }]}>💵 ক্যাশ:</Text><Text style={[styles.detailValue, { fontSize: 11 }]}>৳ {selectedOrder.cash_amount || 0}</Text></View>
                   <View style={styles.detailRow}><Text style={[styles.detailLabel, { fontSize: 11 }]}>🐦 বিকাশ:</Text><Text style={[styles.detailValue, { fontSize: 11 }]}>৳ {selectedOrder.bkash_amount || 0}</Text></View>
                   <View style={styles.detailRow}><Text style={[styles.detailLabel, { fontSize: 11 }]}>💰 নগদ:</Text><Text style={[styles.detailValue, { fontSize: 11 }]}>৳ {selectedOrder.nagad_amount || 0}</Text></View>
                   <View style={styles.detailRow}><Text style={[styles.detailLabel, { fontSize: 11 }]}>🚀 রকেট:</Text><Text style={[styles.detailValue, { fontSize: 11 }]}>৳ {selectedOrder.rocket_amount || 0}</Text></View>
                </View>

                {selectedOrder.deliveryCharge > 0 ? (
                  <>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>অর্ডার টোটাল:</Text><Text style={styles.detailValue}>৳ {selectedOrder.totalAmount}</Text></View>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>ডেলিভারি চার্জ:</Text><Text style={styles.detailValue}>৳ {selectedOrder.deliveryCharge}</Text></View>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>সর্বমোট পরিমাণ:</Text><Text style={[styles.detailValue, { color: '#34D399', fontWeight: 'bold' }]}>৳ {selectedOrder.grandTotal || selectedOrder.paidAmount}</Text></View>
                  </>
                ) : (
                  <View style={styles.detailRow}><Text style={styles.detailLabel}>মোট পরিমাণ:</Text><Text style={[styles.detailValue, { color: '#34D399', fontWeight: 'bold' }]}>৳ {selectedOrder.amount || selectedOrder.paidAmount}</Text></View>
                )}
                <View style={{ marginTop: 10, borderTopWidth: 1, borderColor: '#262626', paddingTop: 10 }}><Text style={styles.detailLabel}>আইটেম সমূহ:</Text><Text style={[styles.detailValue, { marginTop: 4, color: '#FFB703' }]}>{selectedOrder.items}</Text></View>
              </View>
            )}
            <TouchableOpacity style={[styles.modalCancelBtn, { width: '100%', marginTop: 20 }]} onPress={() => setOrderDetailVisible(false)}><Text style={styles.modalCancelBtnText}>পিছনে যান</Text></TouchableOpacity>
        </View></View>
      </Modal>

      {/* RENAME */}
      <Modal animationType="fade" transparent={true} visible={renameModalVisible} onRequestClose={() => setRenameModalVisible(false)}>
        <View style={styles.modalOverlay}><View style={styles.modalContent}><Text style={styles.modalTitle}>টেবিলের নাম পরিবর্তন</Text>
            <View style={styles.renameInputWrapper}><TextInput style={[styles.renameInput, { color: '#FFF' }]} value={newTableName} onChangeText={setNewTableName} placeholder="নাম লিখুন" placeholderTextColor="#AAA" autoFocus={true}/></View>
            <View style={styles.modalBtnRow}><TouchableOpacity style={styles.modalCancelBtn} onPress={() => setRenameModalVisible(false)}><Text style={styles.modalCancelBtnText}>বাতিল</Text></TouchableOpacity><TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveTableName}><Text style={styles.modalSaveBtnText}>সংরক্ষণ</Text></TouchableOpacity></View>
        </View></View>
      </Modal>

      {/* IJARA */}
      <Modal animationType="slide" transparent={true} visible={ijaraModalVisible} onRequestClose={() => setIjaraModalVisible(false)}>
        <View style={styles.modalOverlay}><View style={styles.modalContent}><View style={styles.modalIconCircle}><Text style={styles.modalIconEmoji}>💰</Text></View>
            <Text style={styles.modalTitle}>ইজা যোগ করুন</Text><View style={styles.ijaraInputWrapper}><TextInput style={[styles.modalInput, { color: '#FFF' }]} keyboardType="numeric" value={tempIjara} onChangeText={setTempIjara} placeholder="ইজা পরিমাণ" placeholderTextColor="#AAA" autoFocus={true}/></View>
            <View style={styles.modalBtnRow}><TouchableOpacity style={styles.modalCancelBtn} onPress={() => setIjaraModalVisible(false)}><Text style={styles.modalCancelBtnText}>বাতিল</Text></TouchableOpacity><TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveIjara}><Text style={styles.modalSaveBtnText}>নিশ্চিত</Text></TouchableOpacity></View>
        </View></View>
      </Modal>

      {/* 3-DOT MENU */}
      <Modal animationType="fade" transparent={true} visible={menuModalVisible} onRequestClose={() => setMenuModalVisible(false)}>
        <TouchableOpacity style={styles.menuModalOverlay} activeOpacity={1} onPress={() => setMenuModalVisible(false)}>
          <View style={styles.menuModalContent}>
            <View style={styles.syncTimerWrapper}>
              <Text style={styles.syncTimerText}>Del: {delCountdown}s | Tab: {tabCountdown}s | Full: {fullCountdown}s</Text>
            </View>

            <View style={styles.menuSectionHeader}><Text style={styles.menuSectionText}>CORE OPERATIONS</Text></View>

            {dailyExpenses.ijara > 0 ? (
              <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); Alert.alert("ইতিমধ্যে যোগ করা হয়েছে", "ইজা শুধুমাত্র একবার যোগ করা যাবে!"); }}><Text style={[styles.menuOptionText, { color: '#888' }]}>🔒 ইজা যুক্ত করা হয়েছে</Text></TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); setTempIjara(''); setIjaraModalVisible(true); }}><Text style={styles.menuOptionText}>➕ Add Ijara</Text></TouchableOpacity>
            )}

            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onNavigateToEditMenu(); }}><Text style={styles.menuOptionText}>🍴 Edit Menu</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onNavigateToItemSalesReport(); }}><Text style={styles.menuOptionText}>📊 আইটেম বিক্রয় রিপোর্ট</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onNavigateToSyncDiagnostics(); }}><Text style={styles.menuOptionText}>🛠️ Sync Diagnostics</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onNavigateToDeleteHistory(); }}><Text style={styles.menuOptionText}>🗑️ Delete History</Text></TouchableOpacity>

            <TouchableOpacity style={styles.menuOption} onPress={handleOpenPastAccount}><Text style={styles.menuOptionText}>📅 অতীতের হিসাব</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onNavigateToSupplierDue(); }}><Text style={styles.menuOptionText}>📒 সাপ্লায়ার পেমেন্ট</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); setSalesReportVisible(true); }}><Text style={styles.menuOptionText}>📋 Sales Report</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); setDepositReportVisible(true); }}><Text style={styles.menuOptionText}>📊 Deposit Report</Text></TouchableOpacity>

            <View style={styles.menuSectionHeader}><Text style={styles.menuSectionText}>SYSTEM TOOLS</Text></View>

            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onResetDailySubmit(); }}><Text style={[styles.menuOptionText, { color: '#FFB703' }]}>🔓 রিসেট ডেইলি লক</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onResetIjara(); }}><Text style={[styles.menuOptionText, { color: '#FFB703' }]}>🔓 রিসেট ইজা খরচ</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onResetHistoryLimits(); }}><Text style={[styles.menuOptionText, { color: '#FFB703' }]}>🔓 Reset History Limits</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onCloudRestore(); }}><Text style={[styles.menuOptionText, { color: '#34D399' }]}>☁️ Cloud Restore</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onMenuRecovery(); }}><Text style={[styles.menuOptionText, { color: '#34D399' }]}>🍴 Recover Menu Items</Text></TouchableOpacity>

            <View style={styles.menuDivider} />
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onLogout(); }}><Text style={[styles.menuOptionText, { color: '#FF4D4D' }]}>Logout</Text></TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* IJARA */}
      <Modal animationType="slide" transparent={true} visible={ijaraModalVisible} onRequestClose={() => setIjaraModalVisible(false)}>
        <View style={styles.modalOverlay}><View style={styles.modalContent}><View style={styles.modalIconCircle}><Text style={styles.modalIconEmoji}>💰</Text></View>
            <Text style={styles.modalTitle}>ইজা যোগ করুন</Text><View style={styles.ijaraInputWrapper}><TextInput style={[styles.modalInput, { color: '#FFF' }]} keyboardType="numeric" value={tempIjara} onChangeText={setTempIjara} placeholder="ইজা পরিমাণ" placeholderTextColor="#AAA" autoFocus={true}/></View>
            <View style={styles.modalBtnRow}><TouchableOpacity style={styles.modalCancelBtn} onPress={() => setIjaraModalVisible(false)}><Text style={styles.modalCancelBtnText}>বাতিল</Text></TouchableOpacity><TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveIjara}><Text style={styles.modalSaveBtnText}>নিশ্চিত</Text></TouchableOpacity></View>
        </View></View>
      </Modal>

      {/* SALES REPORT */}
      <Modal animationType="slide" transparent={true} visible={salesReportVisible} onRequestClose={() => setSalesReportVisible(false)}>
        <View style={styles.modalOverlay}><View style={[styles.modalContent, { width: '98%', maxHeight: '92%', paddingHorizontal: 8 }]}>
            <View style={styles.modalHeaderRow}><View style={styles.modalHeaderLeft}><View style={[styles.modalIconCircle, { marginBottom: 0, width: 40, height: 40, marginRight: 10 }]}><Text style={{fontSize:18}}>📋</Text></View>
              <View><Text style={[styles.modalTitle, { textAlign: 'left', marginBottom: 2, fontSize:15 }]}>বিক্রয় রিপোর্ট</Text><Text style={styles.modalSubtitle}>বিস্তারিত তথ্য</Text></View></View>
              <TouchableOpacity onPress={() => setSalesReportVisible(false)} style={styles.closeCircle}><Text style={styles.closeCircleText}>✕</Text></TouchableOpacity>
            </View>
            <View style={styles.filterSection}><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar}>
                {['Today', 'Yesterday', 'Last 7 Days', 'Pick Date'].map((f) => (
                  <TouchableOpacity key={f} style={[styles.filterChip, salesFilter === f && styles.filterChipActive]} onPress={() => setSalesFilter(f)}><Text style={[styles.filterChipText, salesFilter === f && styles.filterChipTextActive]}>{f}</Text></TouchableOpacity>
                ))}
              </ScrollView>{salesFilter === 'Pick Date' && (
                <TouchableOpacity style={styles.pickDateWrapper} onPress={() => { setCalendarTarget('sales'); setCalendarVisible(true); }}><Text style={{color:'#FFF', fontSize:12}}>{pickDate}</Text></TouchableOpacity>
              )}</View>
            <View style={styles.sheetContainer}><ScrollView horizontal><View>
                  <View style={styles.sheetHeader}><Text style={[styles.sheetHeaderText, { width: 120, textAlign: 'left' }]}>তারিখ ও সময়</Text><Text style={[styles.sheetHeaderText, { width: 50 }]}>টেবিল</Text><Text style={[styles.sheetHeaderText, { width: 220, textAlign: 'left' }]}>আইটেম</Text><Text style={[styles.sheetHeaderText, { width: 70, textAlign: 'right' }]}>বিক্রয়</Text></View>
                  <ScrollView style={styles.sheetBody}>
                    {filteredSalesOrders.map((order, idx) => (
                      <TouchableOpacity key={idx} style={[styles.sheetRow, idx % 2 === 1 && styles.sheetRowAlt]} onPress={() => { setSelectedOrder({...order, table: order.tableId, amount: order.paidAmount, status: 'Done'}); setOrderDetailVisible(true); }}>
                        <View style={{ width: 120 }}><Text style={styles.sheetCellTextMain}>{order.fullDate ? formatDisplayDate(order.fullDate) : 'আজ'}</Text><Text style={styles.sheetCellTextSub}>{order.time}</Text></View>
                        <Text style={[styles.sheetCell, { width: 50 }]}>{order.tableId}</Text>
                        <Text style={[styles.sheetCell, { width: 220, fontSize: 9, textAlign: 'left', color: '#FFB703' }]} numberOfLines={2}>{order.items}</Text>
                        <Text style={[styles.sheetCell, { width: 70, textAlign: 'right', color: '#34D399', fontWeight: 'bold' }]}>৳{order.paidAmount}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView></View></ScrollView></View>
            <View style={styles.modalFooterActions}><TouchableOpacity style={styles.exportBtn} onPress={() => exportSalesReportPDF(filteredSalesOrders, salesFilter)}><Text style={styles.exportBtnIcon}>📄</Text><Text style={styles.exportBtnText}>PDF ডাউনলোড</Text></TouchableOpacity><TouchableOpacity style={styles.historyCloseBtn} onPress={() => setSalesReportVisible(false)}><Text style={styles.historyCloseBtnText}>বন্ধ করুন</Text></TouchableOpacity></View>
        </View></View>
      </Modal>

      {/* DEPOSIT REPORT */}
      <Modal animationType="slide" transparent={true} visible={depositReportVisible} onRequestClose={() => setDepositReportVisible(false)}>
        <View style={styles.modalOverlay}><View style={[styles.modalContent, { width: '98%', maxHeight: '92%', paddingHorizontal: 8 }]}>
            <View style={styles.modalHeaderRow}><View style={styles.modalHeaderLeft}><View style={[styles.modalIconCircle, { marginBottom: 0, width: 40, height: 40, marginRight: 10 }]}><Text style={{fontSize:18}}>📊</Text></View>
              <View><Text style={[styles.modalTitle, { textAlign: 'left', marginBottom: 2, fontSize:15 }]}>জমা রিপোর্ট</Text><Text style={styles.modalSubtitle}>পুরো মাসের দৈনিক হিসাব</Text></View></View>
              <TouchableOpacity onPress={() => setDepositReportVisible(false)} style={styles.closeCircle}><Text style={styles.closeCircleText}>✕</Text></TouchableOpacity>
            </View>
            <View style={{ width: '100%', paddingHorizontal: 12, marginBottom: 12, marginTop: 4 }}>
              <Text style={{ color: '#888', fontSize: 11, marginBottom: 4 }}>মাস ও বছর নির্বাচন করুন:</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity 
                  style={{ 
                    flex: 1,
                    flexDirection: 'row', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    backgroundColor: '#1E1E1E', 
                    paddingVertical: 10, 
                    paddingHorizontal: 14, 
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: '#333'
                  }}
                  onPress={() => setMonthPickerVisible(true)}
                >
                  <Text style={{ color: '#FFF', fontSize: 13, fontWeight: 'bold' }}>{monthNames[selectedMonth]}</Text>
                  <Text style={{ color: '#FFB703', fontSize: 10 }}>মাস ▼</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={{ 
                    flex: 1,
                    flexDirection: 'row', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    backgroundColor: '#1E1E1E', 
                    paddingVertical: 10, 
                    paddingHorizontal: 14, 
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: '#333'
                  }}
                  onPress={() => setYearPickerVisible(true)}
                >
                  <Text style={{ color: '#FFF', fontSize: 13, fontWeight: 'bold' }}>{selectedYear}</Text>
                  <Text style={{ color: '#FFB703', fontSize: 10 }}>বছর ▼</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.sheetContainer}><ScrollView horizontal><View>
                  <View style={styles.sheetHeader}>
                    <Text style={[styles.sheetHeaderText, { width: 100, textAlign: 'left' }]}>তারিখ</Text>
                    <Text style={[styles.sheetHeaderText, { width: 80 }]}>মোট বিক্রয়</Text>
                    <Text style={[styles.sheetHeaderText, { width: 70 }]}>bKash</Text>
                    <Text style={[styles.sheetHeaderText, { width: 70 }]}>Nagad</Text>
                    <Text style={[styles.sheetHeaderText, { width: 70 }]}>Cash</Text>
                    <Text style={[styles.sheetHeaderText, { width: 70 }]}>🛵 Deliv</Text>
                    <Text style={[styles.sheetHeaderText, { width: 70 }]}>🛍️ দুদু</Text>
                    <Text style={[styles.sheetHeaderText, { width: 70 }]}>🐔 আকাশ</Text>
                    <Text style={[styles.sheetHeaderText, { width: 70 }]}>🍔 বার্গার</Text>
                    <Text style={[styles.sheetHeaderText, { width: 70 }]}>🛒 বাজার</Text>
                    <Text style={[styles.sheetHeaderText, { width: 70 }]}>📦 অন্য</Text>
                    <Text style={[styles.sheetHeaderText, { width: 70 }]}>🏛️ ইজা</Text>
                    <Text style={[styles.sheetHeaderText, { width: 80 }]}>মোট খরচ</Text>
                    <Text style={[styles.sheetHeaderText, { width: 80 }]}>জমা</Text>
                  </View>
                  <ScrollView style={styles.sheetBody}>
                    {fullHistory.length === 0 ? (
                      <View style={{ width: 1100, alignItems: 'center', padding: 40 }}>
                        <Text style={styles.emptySheetText}>কোনো জমা ইতিহাস পাওয়া যায়নি।</Text>
                        <TouchableOpacity 
                          style={{ marginTop: 20, backgroundColor: '#34D399', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}
                          onPress={() => {
                            const monthStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;
                            onHistoricalMonthDownload(monthStr, activeFilter);
                          }}
                        >
                          <Text style={{ color: '#000', fontWeight: 'bold' }}>☁️ Check Cloud for {activeFilter}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <>
                        {filteredHistory.map((item, index) => (
                          <View key={index} style={[styles.sheetRow, index % 2 === 1 && styles.sheetRowAlt]}>
                            <View style={{ width: 100, flexDirection: 'row', alignItems: 'center' }}><Text style={[styles.sheetCell, { textAlign: 'left' }]}>{formatDisplayDate(item.date)}</Text>{item.isManualEntry && <View style={styles.manualBadge}><Text style={styles.manualBadgeText}>M</Text></View>}<TouchableOpacity onPress={() => handleEditPastAccount(item)} style={{ marginLeft: 6, padding: 4 }}><Text style={{ fontSize: 10 }}>✏️</Text></TouchableOpacity></View>
                            <Text style={[styles.sheetCell, { width: 80, fontWeight: 'bold' }]}>৳{item.sell.toLocaleString()}</Text>
                            <Text style={[styles.sheetCell, { width: 70 }]}>৳{item.breakdown?.bkash || 0}</Text>
                            <Text style={[styles.sheetCell, { width: 70 }]}>৳{item.breakdown?.nagad || 0}</Text>
                            <Text style={[styles.sheetCell, { width: 70 }]}>৳{item.breakdown?.cash || 0}</Text>
                            <Text style={[styles.sheetCell, { width: 70 }]}>৳{item.breakdown?.delivery_sell || 0}</Text>
                            <Text style={[styles.sheetCell, { width: 70 }]}>৳{item.breakdown?.dudu || 0}</Text>
                            <Text style={[styles.sheetCell, { width: 70 }]}>৳{item.breakdown?.akash || 0}</Text>
                            <Text style={[styles.sheetCell, { width: 70 }]}>৳{item.breakdown?.burger || 0}</Text>
                            <Text style={[styles.sheetCell, { width: 70 }]}>৳{item.breakdown?.bazar || 0}</Text>
                            <Text style={[styles.sheetCell, { width: 70 }]}>৳{item.breakdown?.others || 0}</Text>
                            <Text style={[styles.sheetCell, { width: 70 }]}>৳{item.breakdown?.ijara || 0}</Text>
                            <Text style={[styles.sheetCell, { width: 80, color: '#EF4444' }]}>৳{item.expense.toLocaleString()}</Text>
                            <Text style={[styles.sheetCell, { width: 80, color: '#34D399', fontWeight: 'bold' }]}>৳{item.deposit.toLocaleString()}</Text>
                          </View>
                        ))}
                        {fullHistory.length > 3 && !showFullHistory && (
                          <TouchableOpacity style={{ padding: 12, alignItems: 'center', backgroundColor: 'rgba(255, 183, 3, 0.05)' }} onPress={() => setShowFullHistory(true)}><Text style={{ color: '#FFB703', fontSize: 11, fontWeight: 'bold' }}>🔽 আরও {fullHistory.length - 3}টি রেকর্ড দেখুন</Text></TouchableOpacity>
                        )}
                      </>
                    )}
                    {fullHistory.length > 0 && (
                      <View style={styles.sheetFooter}>
                        <Text style={[styles.sheetFooterText, { width: 100, textAlign: 'left' }]}>মোট (Total)</Text>
                        <Text style={[styles.sheetFooterText, { width: 80 }]}>৳{fullHistory.reduce((sum, i) => sum + i.sell, 0).toLocaleString()}</Text>
                        <Text style={[styles.sheetFooterText, { width: 70 }]}>৳{fullHistory.reduce((sum, i) => sum + (i.breakdown?.bkash || 0), 0).toLocaleString()}</Text>
                        <Text style={[styles.sheetFooterText, { width: 70 }]}>৳{fullHistory.reduce((sum, i) => sum + (i.breakdown?.nagad || 0), 0).toLocaleString()}</Text>
                        <Text style={[styles.sheetFooterText, { width: 70 }]}>৳{fullHistory.reduce((sum, i) => sum + (i.breakdown?.cash || 0), 0).toLocaleString()}</Text>
                        <Text style={[styles.sheetFooterText, { width: 70 }]}>৳{fullHistory.reduce((sum, i) => sum + (i.breakdown?.delivery_sell || 0), 0).toLocaleString()}</Text>
                        <Text style={[styles.sheetFooterText, { width: 70 }]}>৳{fullHistory.reduce((sum, i) => sum + (i.breakdown?.dudu || 0), 0).toLocaleString()}</Text>
                        <Text style={[styles.sheetFooterText, { width: 70 }]}>৳{fullHistory.reduce((sum, i) => sum + (i.breakdown?.akash || 0), 0).toLocaleString()}</Text>
                        <Text style={[styles.sheetFooterText, { width: 70 }]}>৳{fullHistory.reduce((sum, i) => sum + (i.breakdown?.burger || 0), 0).toLocaleString()}</Text>
                        <Text style={[styles.sheetFooterText, { width: 70 }]}>৳{fullHistory.reduce((sum, i) => sum + (i.breakdown?.bazar || 0), 0).toLocaleString()}</Text>
                        <Text style={[styles.sheetFooterText, { width: 70 }]}>৳{fullHistory.reduce((sum, i) => sum + (i.breakdown?.others || 0), 0).toLocaleString()}</Text>
                        <Text style={[styles.sheetFooterText, { width: 70 }]}>৳{fullHistory.reduce((sum, i) => sum + (i.breakdown?.ijara || 0), 0).toLocaleString()}</Text>
                        <Text style={[styles.sheetFooterText, { width: 80 }]}>৳{fullHistory.reduce((sum, i) => sum + i.expense, 0).toLocaleString()}</Text>
                        <Text style={[styles.sheetFooterText, { width: 80, color: '#34D399' }]}>৳{fullHistory.reduce((sum, i) => sum + i.deposit, 0).toLocaleString()}</Text>
                      </View>
                    )}
                  </ScrollView></View></ScrollView></View>
            <View style={styles.modalFooterActions}><TouchableOpacity style={styles.exportBtn} onPress={() => exportDepositReportPDF(fullHistory, activeFilter)}><Text style={styles.exportBtnIcon}>📄</Text><Text style={styles.exportBtnText}>PDF ডাউনলোড</Text></TouchableOpacity><TouchableOpacity style={styles.historyCloseBtn} onPress={() => setDepositReportVisible(false)}><Text style={styles.historyCloseBtnText}>বন্ধ করুন</Text></TouchableOpacity></View>
        </View></View>
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
      <Modal animationType="slide" transparent={true} visible={pastAccountModalVisible} onRequestClose={() => setPastAccountModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { width: '90%', maxHeight: '85%' }]}>
            <View style={styles.modalIconCircle}><Text style={styles.modalIconEmoji}>📅</Text></View>
            <Text style={styles.modalTitle}>অতীতের হিসাব যোগ করুন</Text>
            <ScrollView style={{ width: '100%' }} contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
              <TouchableOpacity style={styles.expenseInputGroup} onPress={() => { setCalendarTarget('past'); setCalendarVisible(true); }}>
                <Text style={styles.inputLabel}>তারিখ</Text>
                <View style={[styles.modalInput, { justifyContent: 'center' }]}>
                  <Text style={{color:'#FFF'}}>{pastDate ? formatDisplayDate(pastDate) : "তারিখ সিলেক্ট করুন"}</Text>
                </View>
              </TouchableOpacity>
              
              <View style={styles.expenseInputGroup}><Text style={styles.inputLabel}>মোট বিক্রয়</Text><TextInput style={[styles.modalInput, { color: '#FFF' }]} keyboardType="numeric" value={pastTotalSell} onChangeText={setPastTotalSell}/></View>
              
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={[styles.expenseInputGroup, { width: '48%' }]}><Text style={styles.inputLabel}>bKash</Text><TextInput style={[styles.modalInput, { color: '#FFF' }]} keyboardType="numeric" value={pastBkash} onChangeText={setPastBkash}/></View>
                <View style={[styles.expenseInputGroup, { width: '48%' }]}><Text style={styles.inputLabel}>Nagad</Text><TextInput style={[styles.modalInput, { color: '#FFF' }]} keyboardType="numeric" value={pastNagad} onChangeText={setPastNagad}/></View>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={[styles.expenseInputGroup, { width: '48%' }]}><Text style={styles.inputLabel}>Rocket</Text><TextInput style={[styles.modalInput, { color: '#FFF' }]} keyboardType="numeric" value={pastRocket} onChangeText={setPastRocket}/></View>
                <View style={[styles.expenseInputGroup, { width: '48%' }]}><Text style={styles.inputLabel}>Cash</Text><TextInput style={[styles.modalInput, { color: '#FFF' }]} keyboardType="numeric" value={pastCash} onChangeText={setPastCash}/></View>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={[styles.expenseInputGroup, { width: '48%' }]}><Text style={styles.inputLabel}>🛵 Delivery Sell</Text><TextInput style={[styles.modalInput, { color: '#FFF' }]} keyboardType="numeric" value={pastDeliverySell} onChangeText={setPastDeliverySell}/></View>
                <View style={[styles.expenseInputGroup, { width: '48%' }]}><Text style={styles.inputLabel}>🏷️ Delivery Charge</Text><TextInput style={[styles.modalInput, { color: '#FFF' }]} keyboardType="numeric" value={pastDeliveryCharge} onChangeText={setPastDeliveryCharge}/></View>
              </View>
              
              <View style={{ marginTop: 10, marginBottom: 5 }}><Text style={{ color: '#FFB703', fontSize: 12, fontWeight: 'bold' }}>খরচসমূহ (Expenses)</Text></View>
              
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={[styles.expenseInputGroup, { width: '48%' }]}><Text style={styles.inputLabel}>🛍️ দুদু মিয়া</Text><TextInput style={[styles.modalInput, { color: '#FFF' }]} keyboardType="numeric" value={pastDudu} onChangeText={setPastDudu}/></View>
                <View style={[styles.expenseInputGroup, { width: '48%' }]}><Text style={styles.inputLabel}>🐔 আকাশ মুরগী</Text><TextInput style={[styles.modalInput, { color: '#FFF' }]} keyboardType="numeric" value={pastAkash} onChangeText={setPastAkash}/></View>
              </View>
              
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={[styles.expenseInputGroup, { width: '48%' }]}><Text style={styles.inputLabel}>🍔 বার্গার বান</Text><TextInput style={[styles.modalInput, { color: '#FFF' }]} keyboardType="numeric" value={pastBurger} onChangeText={setPastBurger}/></View>
                <View style={[styles.expenseInputGroup, { width: '48%' }]}><Text style={styles.inputLabel}>🛒 বাজার খরচ</Text><TextInput style={[styles.modalInput, { color: '#FFF' }]} keyboardType="numeric" value={pastBazar} onChangeText={setPastBazar}/></View>
              </View>
              
              <View style={styles.expenseInputGroup}><Text style={styles.inputLabel}>📦 অন্যান্য খরচ</Text><TextInput style={[styles.modalInput, { color: '#FFF' }]} keyboardType="numeric" value={pastOthers} onChangeText={setPastOthers}/></View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={[styles.expenseInputGroup, { width: '48%' }]}><Text style={styles.inputLabel}>🏛️ ইজা (Ijara)</Text><TextInput style={[styles.modalInput, { color: '#FFF' }]} keyboardType="numeric" value={pastIjara} onChangeText={setPastIjara}/></View>
                <View style={[styles.expenseInputGroup, { width: '48%' }]}><Text style={styles.inputLabel}>💵 নেট ক্যাশ (Net Cash)</Text><TextInput style={[styles.modalInput, { color: '#FFF' }]} keyboardType="numeric" value={pastNetCash} onChangeText={setPastNetCash}/></View>
              </View>

              <View style={[styles.expenseInputGroup, { backgroundColor: 'rgba(52, 211, 153, 0.05)', padding: 10, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(52, 211, 153, 0.2)' }]}>
                <Text style={[styles.inputLabel, { color: '#34D399' }]}>👤 Owner কে জমা (Deposit)</Text>
                <TextInput style={[styles.modalInput, { color: '#34D399', fontWeight: 'bold', borderColor: 'rgba(52, 211, 153, 0.4)' }]} keyboardType="numeric" value={pastDeposit} onChangeText={setPastDeposit} placeholder="0"/>
              </View>

              <View style={styles.expenseInputGroup}><Text style={styles.inputLabel}>নোট (ঐচ্ছিক)</Text><TextInput style={[styles.modalInput, { color: '#FFF' }]} value={pastNote} onChangeText={setPastNote} placeholder="অতিরিক্ত তথ্য..."/></View>
              
              {isEditingPast && (
                <TouchableOpacity 
                  style={{ 
                    backgroundColor: 'rgba(239, 68, 68, 0.1)', 
                    padding: 14, 
                    borderRadius: 12, 
                    borderWidth: 1, 
                    borderColor: 'rgba(239, 68, 68, 0.3)',
                    marginTop: 20,
                    flexDirection: 'row',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 8
                  }}
                  onPress={() => {
                    Alert.alert(
                      "হিসাব মুছে ফেলা",
                      "এই হিসাবটি স্থায়ীভাবে মুছে ফেলা হবে। আপনি কি নিশ্চিত?",
                      [
                        { text: "বাতিল", style: "cancel" },
                        { 
                          text: "হ্যাঁ, মুছে ফেলুন", 
                          style: "destructive", 
                          onPress: () => {
                            onDeletePastAccount(pastDate);
                            setPastAccountModalVisible(false);
                          } 
                        }
                      ]
                    );
                  }}
                >
                  <Text style={{ color: '#EF4444', fontWeight: 'bold' }}>🗑️ ডিলিট করুন (Admin Only)</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
            <View style={styles.modalBtnRow}><TouchableOpacity style={styles.modalCancelBtn} onPress={() => setPastAccountModalVisible(false)}><Text style={styles.modalCancelBtnText}>বাতিল</Text></TouchableOpacity><TouchableOpacity style={styles.modalSaveBtn} onPress={handleSavePastEntry}><Text style={styles.modalSaveBtnText}>সেভ করুন</Text></TouchableOpacity></View>
        </View></View>
      </Modal>

      {/* FIREBASE USAGE */}
      <Modal animationType="slide" transparent={true} visible={firebaseUsageVisible} onRequestClose={() => setFirebaseUsageVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { width: '96%', maxHeight: '90%', paddingHorizontal: 12, borderColor: '#34D399' }]}>
            <View style={styles.modalHeaderRow}><View style={styles.modalHeaderLeft}><View style={[styles.modalIconCircle, { marginBottom: 0, width: 40, height: 40, marginRight: 10, backgroundColor: 'rgba(52, 211, 153, 0.1)' }]}><Text style={{ fontSize: 18 }}>🔥</Text></View>
                <View><Text style={[styles.modalTitle, { textAlign: 'left', marginBottom: 2, fontSize: 15 }]}>ফায়ারবেস ক্লাউড ব্যবহার</Text><Text style={styles.modalSubtitle}>Usage Metrics & System Health</Text></View></View>
              <TouchableOpacity onPress={() => setFirebaseUsageVisible(false)} style={styles.closeCircle}><Text style={styles.closeCircleText}>✕</Text></TouchableOpacity>
            </View>

            {!isUsageAuthorized ? (
              <View style={{ width: '100%', alignItems: 'center', paddingVertical: 40 }}>
                <View style={[styles.modalIconCircle, { backgroundColor: 'rgba(239, 68, 68, 0.1)', width: 60, height: 60 }]}><Text style={{ fontSize: 24 }}>🔒</Text></View>
                <Text style={{ color: '#FFF', fontSize: 16, fontWeight: 'bold', marginTop: 16 }}>এডমিন পিন ভেরিফিকেশন</Text>
                <TextInput style={[styles.modalInput, { textAlign: 'center', fontSize: 20, letterSpacing: 8, width: '70%', marginTop: 20 }]} placeholder="PIN" placeholderTextColor="#333" keyboardType="numeric" secureTextEntry={true} maxLength={6} value={usagePinInput} onChangeText={setUsagePinInput}/>
                <TouchableOpacity style={[styles.modalSaveBtn, { width: '70%', marginTop: 20, marginLeft: 0 }]} onPress={handleAuthorizeUsage}><Text style={styles.modalSaveBtnText}>ভেরিফাই করুন</Text></TouchableOpacity>
              </View>
            ) : (
              <ScrollView style={{ width: '100%', marginTop: 10 }} showsVerticalScrollIndicator={false}>
                <TouchableOpacity onPress={handleRefreshUsageData} style={{ backgroundColor: 'rgba(52, 211, 153, 0.15)', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(52, 211, 153, 0.3)', alignItems: 'center', marginBottom: 16 }}><Text style={{ color: '#34D399', fontWeight: 'bold' }}>🔄 রিফ্রেশ ডাটা</Text></TouchableOpacity>
                <View style={styles.inspectorGrid}><View style={styles.inspectorCard}><Text style={styles.inspectorLabel}>SQLite Status</Text><Text style={[styles.inspectorValue, { color: '#34D399' }]}>🟢 Connected</Text></View><View style={styles.inspectorCard}><Text style={styles.inspectorLabel}>Firebase Project</Text><Text style={styles.inspectorValue} numberOfLines={1}>{dbStatsData?.project_id || 'Configured'}</Text></View></View>
                <View style={{ marginTop: 16 }}><Text style={{ color: '#FFB703', fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>📊 স্টোরেজ স্ট্যাটাস</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{dbStatsData?.stats && Object.entries(dbStatsData.stats).map(([k, v]) => (
                      <View key={k} style={{ width: '48%', backgroundColor: '#0D0D0D', padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#1E1E1E', flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: '#AAA', fontSize: 11 }}>{k}</Text><Text style={{ color: '#FFB703', fontWeight: 'bold', fontSize: 11 }}>{v}</Text></View>
                  ))}</View>
                </View>
                {/* Status and Mode Grid */}
                <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'space-between', marginBottom: 8 }}>
                  <View style={{ width: '32%', backgroundColor: '#0D0D0D', padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#1E1E1E' }}>
                    <Text style={{ color: '#888', fontSize: 9, marginBottom: 2 }}>Sync Interval</Text>
                    <Text style={{ color: '#FFF', fontSize: 11, fontWeight: 'bold' }}>30s</Text>
                  </View>
                  <View style={{ width: '32%', backgroundColor: '#0D0D0D', padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#1E1E1E' }}>
                    <Text style={{ color: '#888', fontSize: 9, marginBottom: 2 }}>Poll Interval</Text>
                    <Text style={{ color: '#FFF', fontSize: 11, fontWeight: 'bold' }}>30s</Text>
                  </View>
                  <View style={{ width: '32%', backgroundColor: '#0D0D0D', padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#1E1E1E' }}>
                    <Text style={{ color: '#888', fontSize: 9, marginBottom: 2 }}>Firestore Mode</Text>
                    <Text style={{ color: '#34D399', fontSize: 10, fontWeight: 'bold' }}>REST Sync</Text>
                  </View>
                </View>

                {/* Granular Sync Status Timers */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'space-between', marginBottom: 12 }}>
                  <View style={{ width: '48%', backgroundColor: '#0D0D0D', padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#1E1E1E' }}>
                    <Text style={{ color: '#888', fontSize: 9, marginBottom: 2 }}>Last Sync Time</Text>
                    <Text style={{ color: '#FFB703', fontSize: 10, fontWeight: 'bold' }}>{firebaseUsageData?.lastSyncTime || 'N/A'}</Text>
                  </View>
                  <View style={{ width: '48%', backgroundColor: '#0D0D0D', padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#1E1E1E' }}>
                    <Text style={{ color: '#888', fontSize: 9, marginBottom: 2 }}>Next Full Sync (30s)</Text>
                    <Text style={{ color: '#34D399', fontSize: 10, fontWeight: 'bold' }}>{firebaseUsageData?.nextFullSyncTime || 'N/A'}</Text>
                  </View>
                  <View style={{ width: '48%', backgroundColor: '#0D0D0D', padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#1E1E1E' }}>
                    <Text style={{ color: '#888', fontSize: 9, marginBottom: 2 }}>Next Delete Check</Text>
                    <Text style={{ color: '#34D399', fontSize: 10, fontWeight: 'bold' }}>{firebaseUsageData?.nextDeletionsTime || 'N/A'}</Text>
                  </View>
                  <View style={{ width: '48%', backgroundColor: '#0D0D0D', padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#1E1E1E' }}>
                    <Text style={{ color: '#888', fontSize: 9, marginBottom: 2 }}>Next Table Sync</Text>
                    <Text style={{ color: '#34D399', fontSize: 10, fontWeight: 'bold' }}>{firebaseUsageData?.nextTablesTime || 'N/A'}</Text>
                  </View>
                </View>

                <View style={{ marginTop: 24, borderTopWidth: 1, borderColor: '#1F1F1F', paddingTop: 16 }}><Text style={{ color: '#FFB703', fontSize: 13, fontWeight: 'bold', marginBottom: 12 }}>⚡ ক্লাউড হেলথ</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    <View style={{ width: '48%', backgroundColor: '#0D0D0D', padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#1E1E1E' }}><Text style={{ color: '#888', fontSize: 9 }}>Total Reads</Text><Text style={{ color: '#FFF', fontWeight: 'bold' }}>{firebaseUsageData?.readsToday || 0}</Text></View>
                    <View style={{ width: '48%', backgroundColor: '#0D0D0D', padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#1E1E1E' }}><Text style={{ color: '#888', fontSize: 9 }}>Total Writes</Text><Text style={{ color: '#FFF', fontWeight: 'bold' }}>{firebaseUsageData?.writesToday || 0}</Text></View>
                  </View>
                </View>
                <View style={{ marginTop: 20, borderTopWidth: 1, borderColor: '#1F1F1F', paddingTop: 16 }}><Text style={{ color: '#FFB703', fontSize: 13, fontWeight: 'bold', marginBottom: 4 }}>💻 SQL টার্মিনাল</Text>
                  <TextInput style={{ backgroundColor: '#0D0D0D', color: '#34D399', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 12, padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#333', minHeight: 60 }} multiline={true} value={customSqlQuery} onChangeText={setCustomSqlQuery} autoCapitalize="none"/>
                  <TouchableOpacity onPress={handleExecuteSqlQuery} style={{ backgroundColor: '#FFB703', padding: 10, borderRadius: 6, marginTop: 8, alignItems: 'center' }}><Text style={{ color: '#000', fontWeight: 'bold' }}>Execute Query</Text></TouchableOpacity>
                </View>
              </ScrollView>
            )}
            <View style={[styles.modalBtnRow, { marginTop: 12 }]}><TouchableOpacity style={[styles.modalCancelBtn, { width: '100%' }]} onPress={() => setFirebaseUsageVisible(false)}><Text style={styles.modalCancelBtnText}>বন্ধ করুন</Text></TouchableOpacity></View>
          </View>
        </View>
      </Modal>
      {/* DATA CLEANUP TOOL */}
      <Modal animationType="slide" transparent={true} visible={cleanupModalVisible} onRequestClose={() => setCleanupModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { width: '90%' }]}>
            <Text style={[styles.modalTitle, { color: '#EF4444' }]}>🗑️ Data Cleanup Tool</Text>
            
            <View style={{ marginBottom: 15 }}>
              <Text style={{ color: '#888', marginBottom: 5 }}>Target Date (YYYY-MM-DD)</Text>
              <TextInput 
                style={[styles.modalInput, { color: '#FFF', textAlign: 'center' }]} 
                value={cleanupTargetDate} 
                onChangeText={setCleanupTargetDate}
              />
            </View>

            <TouchableOpacity style={{ backgroundColor: '#1E1E1E', padding: 10, borderRadius: 6, alignItems: 'center', marginBottom: 15 }} onPress={handleRunCleanupAudit}>
              <Text style={{ color: '#34D399', fontWeight: 'bold' }}>🔍 Run Audit</Text>
            </TouchableOpacity>

            {cleanupCounts && (
              <View style={{ backgroundColor: '#0D0D0D', padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#333', marginBottom: 15 }}>
                <Text style={{ color: '#FFB703', fontWeight: 'bold', marginBottom: 5 }}>Found Records for {cleanupTargetDate}:</Text>
                <Text style={{ color: '#FFF' }}>Orders: {cleanupCounts.orders}</Text>
                <Text style={{ color: '#FFF' }}>Payments: {cleanupCounts.payments}</Text>
                <Text style={{ color: '#FFF' }}>Deliveries: {cleanupCounts.deliveries}</Text>
                <Text style={{ color: '#FFF' }}>Expenses: {cleanupCounts.expenses}</Text>
                <Text style={{ color: '#FFF' }}>Daily Submit: {cleanupCounts.submit}</Text>
                <Text style={{ color: '#FFF' }}>Daily Summary: {cleanupCounts.summary}</Text>
                <Text style={{ color: '#FFF' }}>Sync Queue: {cleanupCounts.syncQueue}</Text>
              </View>
            )}

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setCleanupModalVisible(false)}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalSaveBtn, { backgroundColor: '#EF4444' }]} onPress={handleConfirmCleanup}>
                <Text style={styles.modalSaveBtnText}>Delete All</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#FFB703' },
  titleBadgeRow: { flexDirection: 'row', alignItems: 'center' },
  adminBadge: { backgroundColor: 'rgba(255, 183, 3, 0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginLeft: 8 },
  adminBadgeText: { color: '#FFB703', fontSize: 10, fontWeight: 'bold' },
  headerDate: { fontSize: 12, color: '#888', marginTop: 2 },
  menuDotsButton: { padding: 6 },
  menuDotsIcon: { fontSize: 24, color: '#FFB703', fontWeight: 'bold' },
  scrollBody: { flex: 1 },
  statsContainer: { paddingHorizontal: 12, paddingVertical: 16 },
  statsCard: { width: 170, borderRadius: 16, padding: 16, marginHorizontal: 4, borderWidth: 1 },
  cardGreen: { backgroundColor: 'rgba(16, 37, 24, 0.6)', borderColor: 'rgba(52, 211, 153, 0.3)' },
  cardOrange: { backgroundColor: 'rgba(36, 22, 14, 0.6)', borderColor: 'rgba(251, 146, 60, 0.3)' },
  cardBlue: { backgroundColor: 'rgba(15, 23, 42, 0.6)', borderColor: 'rgba(96, 165, 250, 0.3)' },
  cardYellow: { backgroundColor: 'rgba(30, 27, 12, 0.6)', borderColor: 'rgba(253, 224, 71, 0.3)' },
  statsCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  statsCardTitle: { fontSize: 13, color: '#FFF', fontWeight: '500' },
  statsEmoji: { fontSize: 16 },
  statsCardAmount: { fontSize: 18, fontWeight: 'bold', color: '#FFF', marginVertical: 4 },
  statsCardSubGreen: { fontSize: 10, color: '#34D399' },
  statsCardSubOrange: { fontSize: 10, color: '#FB923C' },
  statsCardSubBlue: { fontSize: 10, color: '#60A5FA' },
  statsCardSubYellow: { fontSize: 10, color: '#FDE047' },
  sectionContainer: { paddingHorizontal: 16, marginBottom: 20 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: 'bold', color: '#FFF' },
  sectionSubtitle: { fontSize: 10, color: '#888', fontWeight: 'normal' },
  infoIcon: { fontSize: 16, color: '#888' },
  tableGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', width: '100%', paddingBottom: 10 },
  tableCard: { width: '23.5%', aspectRatio: 0.75, borderRadius: 12, padding: 6, alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, borderWidth: 1, backgroundColor: '#0D0D0D' },
  tableBusyBorder: { borderColor: 'rgba(251,146,60,0.4)' },
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
  chairIcon: { fontSize: 14, opacity: 0.3 },
  deliveryCard: { backgroundColor: '#0D0D0D', borderWidth: 1, borderColor: '#1A1A1A', borderRadius: 14, padding: 14 },
  deliveryTitle: { fontSize: 13, fontWeight: 'bold', color: '#FFF' },
  deliveryTime: { fontSize: 11, color: '#888', marginVertical: 6 },
  deliveryAmount: { fontSize: 16, fontWeight: 'bold', color: '#FFB703' },
  emptyDeliveryPlaceholder: { width: '100%', height: 60, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,183,3,0.3)', justifyContent: 'center', alignItems: 'center' },
  emptyDeliveryText: { color: '#FFB703', fontWeight: 'bold', fontSize: 14 },
  orderList: { backgroundColor: '#0D0D0D', borderRadius: 14, borderWidth: 1, borderColor: '#1A1A1A', paddingHorizontal: 8 },
  orderItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderColor: '#161616' },
  orderItemLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  tableIconCircle: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
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
  editBtn: { backgroundColor: 'rgba(255, 183, 3, 0.15)', width: 28, height: 28, borderRadius: 6, justifyContent: 'center', alignItems: 'center', marginRight: 4 },
  deleteBtn: { backgroundColor: 'rgba(255, 77, 77, 0.15)', width: 28, height: 28, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  btnIcon: { fontSize: 12 },
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
  menuModalContent: { backgroundColor: '#161616', borderRadius: 12, marginTop: 45, marginLeft: 16, width: 180, borderWidth: 1, borderColor: '#333', overflow: 'hidden' },
  menuOption: { paddingVertical: 8, paddingHorizontal: 14 },
  menuOptionText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  menuDivider: { height: 1, backgroundColor: '#262626' },
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
  inspectorGrid: { flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
  inspectorCard: { flex: 1, backgroundColor: '#161616', borderWidth: 1, borderColor: '#262626', borderRadius: 10, padding: 12, marginHorizontal: 4, alignItems: 'center' },
  inspectorLabel: { color: '#888', fontSize: 10, marginBottom: 4, fontWeight: 'bold' },
  inspectorValue: { color: '#FFF', fontSize: 12, fontWeight: 'bold', textAlign: 'center' },
  inspectorSub: { color: '#555', fontSize: 8, marginTop: 2 },
  syncTimerWrapper: { paddingVertical: 4, paddingHorizontal: 12, backgroundColor: '#161616', borderRadius: 8, marginHorizontal: 16, marginTop: 4, marginBottom: 4, alignItems: 'center', borderWidth: 1, borderColor: '#222' },
  syncTimerText: { color: '#FFB703', fontSize: 8, fontWeight: '600', marginVertical: 1 },
});
