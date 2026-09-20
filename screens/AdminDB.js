import React, { useState, useEffect, useRef } from 'react';
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
  BackHandler,
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { exportSalesReportPDF, exportDepositReportPDF } from '../pdfHelper';
import { formatDisplayDate, getBusinessDate, inspectDatabaseStats, executeInspectorQuery, getFirebaseUsageStats, verifyPinCode, deleteDataByDate, getItemSalesReport, getDb, getOwnerEmployees } from '../database';
import { getAllRegisteredDevices } from '../services/deviceRegistry';
import { fetchMinimumVersion, setMinimumVersion, APP_VERSION, compareSemver } from '../services/firebaseAppConfig';
import * as Application from 'expo-application';
import * as LocalAuthentication from 'expo-local-authentication';
import { TodaySalesCard, TotalCashCard, ActiveTablesCard, MonthlyTotalCard } from '../components/StatCard';

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

export default function AdminDB({ onLogout, tables, deliveries = [], completedOrders = [], submissionHistory = [], onTableSelect, onCreateDelivery, onUpdateTableName, onNavigateToExpenses, onNavigateToSubmit, onNavigateToEditMenu, onNavigateToSupplierDue, onNavigateToItemSalesReport, onNavigateToSyncDiagnostics, onNavigateToDeleteHistory, onNavigateToSystemTools, onNavigateToDeviceManagement, onNavigateToAIDatasetMonitor, onNavigateToAIDatasetAuditCenter, onNavigateToAnalytics, onNavigateToEmployees, onNavigateToActivityLog, onCloudRestore, onSameDayResync, onMenuRecovery, onResetHistoryLimits, onHistoricalMonthDownload, onSavePastAccount, onDeletePastAccount, dailyExpenses, onUpdateExpenses, isDailySubmitted, onDeleteActiveOrder, onDeleteDoneOrder, onResetDailySubmit, onResetIjara, delCountdown, tabCountdown, fullCountdown }) {
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [selectedTableForRename, setSelectedTableForRename] = useState(null);
  const [newTableName, setNewTableName] = useState('');
  const [floorModalVisible, setFloorModalVisible] = useState(false);

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

  // Version Control States (Admin only)
  const [firebaseMinVersion, setFirebaseMinVersion] = useState(null);
  const [versionInput, setVersionInput] = useState('');
  const [isSavingVersion, setIsSavingVersion] = useState(false);
  const [isLoadingVersion, setIsLoadingVersion] = useState(false);
  const [versionFetchError, setVersionFetchError] = useState(false);
  const [versionPinModalVisible, setVersionPinModalVisible] = useState(false);
  const [versionPinInput, setVersionPinInput] = useState('');
  const [versionPinError, setVersionPinError] = useState('');

  // Keyboard and Scroll Handling to prevent UI from being covered
  const mainScrollRef = useRef(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setKeyboardHeight(e.endCoordinates.height);
      }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
      }
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  
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
      if (versionPinModalVisible) { setVersionPinModalVisible(false); return true; }
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
  }, [versionPinModalVisible, orderDetailVisible, calendarVisible, yearPickerVisible, monthPickerVisible, pastAccountModalVisible, cleanupModalVisible, firebaseUsageVisible, ijaraModalVisible, salesReportVisible, depositReportVisible, menuModalVisible, renameModalVisible]);

  // Load/Refresh Firebase minimum version
  const loadFirebaseVersion = async () => {
    setIsLoadingVersion(true);
    setVersionFetchError(false);
    try {
      const v = await fetchMinimumVersion();
      if (v !== null) {
        setFirebaseMinVersion(v);
        setVersionFetchError(false);
        setVersionInput(prev => prev ? prev : v);
      } else {
        setVersionFetchError(true);
      }
    } catch (e) {
      console.error("[AdminDB] Error loading version:", e);
      setVersionFetchError(true);
    } finally {
      setIsLoadingVersion(false);
    }
  };

  useEffect(() => {
    loadFirebaseVersion();
  }, []);

  // Handler for Version Update with Biometric + PIN
  const handleInitiateVersionUpdate = async () => {
    const cleanVer = (versionInput || '').trim();
    if (!cleanVer || !/^\d+(\.\d+)+$/.test(cleanVer)) {
      Alert.alert('ভুল ভার্সন নম্বর', 'সঠিক ভার্সন নম্বর লিখুন (যেমন: 1.0.3)');
      return;
    }

    // Step 1: Biometric Verification
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (hasHardware && isEnrolled) {
        const bioResult = await LocalAuthentication.authenticateAsync({
          promptMessage: 'অ্যাপ ভার্সন পরিবর্তন করতে বায়োমেট্রিক দিন',
          cancelLabel: 'বাতিল',
          disableDeviceFallback: false,
        });
        if (!bioResult.success) {
          Alert.alert('বায়োমেট্রিক ব্যর্থ', 'বায়োমেট্রিক ভেরিফিকেশন সফল হয়নি।');
          return;
        }
      }
    } catch (bioErr) {
      console.error('[AdminDB] Biometric auth error:', bioErr);
    }

    // Step 2: Open Admin PIN Security Modal
    setVersionPinInput('');
    setVersionPinError('');
    setVersionPinModalVisible(true);
  };

  const handleConfirmVersionWithPin = async () => {
    if (!versionPinInput.trim()) {
      setVersionPinError('এডমিন PIN দিন');
      return;
    }

    const user = verifyPinCode(versionPinInput.trim());
    if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
      setVersionPinError('ভুল PIN! শুধুমাত্র Admin/Owner PIN গ্রহণযোগ্য');
      return;
    }

    setVersionPinModalVisible(false);
    setVersionPinInput('');
    setIsSavingVersion(true);

    const cleanVer = versionInput.trim();
    const result = await setMinimumVersion(cleanVer);
    setIsSavingVersion(false);
    if (result.success) {
      setFirebaseMinVersion(cleanVer);
      Alert.alert('✅ সফল', `Firebase এ নিউনতম ভার্সন ${cleanVer} সেট করা হয়েছে।`);
    } else {
      Alert.alert('❌ ব্যর্থ', result.error || 'Firebase আপডেট করা সম্ভব হয়নি।');
    }
  };

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
      const countOrders = executeInspectorQuery("SELECT COUNT(*) as c FROM orders WHERE date(created_at, 'localtime') = ?", [target])[0]?.c || 0;
      const countPayments = executeInspectorQuery("SELECT COUNT(*) as c FROM payments WHERE date(created_at, 'localtime') = ?", [target])[0]?.c || 0;
      const countDeliveries = executeInspectorQuery("SELECT COUNT(*) as c FROM deliveries WHERE date(completed_at, 'localtime') = ?", [target])[0]?.c || 0;
      const countExpenses = executeInspectorQuery("SELECT COUNT(*) as c FROM expenses WHERE date(created_at, 'localtime') = ?", [target])[0]?.c || 0;
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
      Alert.alert("অডিট ত্রুটি", e.message);
    }
  };

  const handleConfirmCleanup = () => {
    Alert.alert(
      "সতর্কতা",
      `আপনি কি নিশ্চিত যে ${cleanupTargetDate} তারিখের সকল লোকাল ডাটা স্থায়ীভাবে ডিলিট করতে চান?`,
      [
        { text: "বাতিল", style: "cancel" },
        { 
          text: "ডাটা ডিলিট করুন", 
          style: "destructive",
          onPress: () => {
            const res = deleteDataByDate(cleanupTargetDate);
            if (res.success) {
              Alert.alert("সফল", "ডাটা সফলভাবে ডিলিট করা হয়েছে। ড্যাশবোর্ড রিস্টার্ট হচ্ছে...");
              setCleanupModalVisible(false);
            } else {
              Alert.alert("ত্রুটি", res.error);
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
  const cashSale = todaysOrders.reduce((sum, o) => sum + (o.cash_amount || (o.method === 'ক্যাশ' ? o.paidAmount : 0) || 0), 0);
  const dueSale = todaysOrders.reduce((sum, o) => sum + (o.due_amount || (o.method === 'বাকি' ? (o.dueAmount || o.totalAmount || 0) : 0) || 0), 0);

  // Today Discount & Delivery Sales
  const todayDiscount = todaysOrders.reduce((sum, o) => sum + (o.discount || 0), 0);
  const todayDeliverySales = todaysOrders.reduce((sum, o) => {
    const isDeliv = (o.deliveryCharge > 0) || (o.tableId && String(o.tableId).toLowerCase().includes('deliv'));
    return isDeliv ? sum + (o.paidAmount || o.grandTotal || 0) : sum;
  }, 0);

  // Peak Hour Calculation
  let calculatedPeakHour = '৮–৯ PM';
  try {
    const hourCounts = {};
    todaysOrders.forEach(o => {
      let hour = null;
      if (o.time) {
        const match = o.time.match(/(\d+):(\d+)\s*(AM|PM)?/i);
        if (match) {
          let h = parseInt(match[1], 10);
          const isPM = match[3]?.toUpperCase() === 'PM';
          const isAM = match[3]?.toUpperCase() === 'AM';
          if (isPM && h < 12) h += 12;
          if (isAM && h === 12) h = 0;
          hour = h;
        }
      }
      if (hour !== null) {
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      }
    });
    let maxHour = null;
    let maxCount = 0;
    for (const [h, count] of Object.entries(hourCounts)) {
      if (count > maxCount) {
        maxCount = count;
        maxHour = parseInt(h, 10);
      }
    }
    if (maxHour !== null) {
      const startHour12 = maxHour % 12 || 12;
      const endHour12 = (maxHour + 1) % 12 || 12;
      const ampm = maxHour >= 12 ? 'PM' : 'AM';
      calculatedPeakHour = `${startHour12}–${endHour12} ${ampm}`;
    }
  } catch (e) {}

  // Last 7 Days History
  const dayNamesShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const last7DaysData = [];
  let max7DaySale = 1;

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const dateKey = `${yyyy}-${mm}-${dd}`;
    const dayName = dayNamesShort[d.getDay()];
    const isToday = (i === 0);

    let sales = 0;
    if (isToday) {
      sales = todaySale;
    } else {
      const sub = submissionHistory?.find(s => s.date === dateKey);
      if (sub && sub.sell) {
        sales = sub.sell;
      } else {
        try {
          const db = getDb();
          const row = db?.getFirstSync("SELECT total_sell FROM daily_submit WHERE date = ?", [dateKey]);
          if (row && row.total_sell) sales = row.total_sell;
        } catch (e) {}
      }
    }
    if (sales > max7DaySale) max7DaySale = sales;
    last7DaysData.push({ dayName, dateKey, sales, isToday });
  }

  let bestDayKey = '';
  let highest7DaySale = 0;
  last7DaysData.forEach(item => {
    if (item.sales > highest7DaySale) {
      highest7DaySale = item.sales;
      bestDayKey = item.dateKey;
    }
  });

  // Weather Info
  let weatherTemp = '31°C';
  try {
    const db = getDb();
    const wRow = db?.getFirstSync("SELECT * FROM weather_data ORDER BY date DESC LIMIT 1");
    if (wRow && wRow.temperature) {
      weatherTemp = `${Math.round(wRow.temperature)}°C`;
    }
  } catch (e) {}

  // Table status helpers
  const getTableElapsedMinutes = (t) => {
    if (t.status !== 'BUSY' || !t.startTime) return null;
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

  // Segmented payment percentages
  const totalPaymentCalculated = (cashSale + bkashSale + nagadSale + rocketSale + dueSale) || todaySale || 1;
  const cashPct = Math.max(cashSale > 0 ? 5 : 0, Math.round((cashSale / totalPaymentCalculated) * 100));
  const bkashPct = Math.max(bkashSale > 0 ? 5 : 0, Math.round((bkashSale / totalPaymentCalculated) * 100));
  const nagadPct = Math.max(nagadSale > 0 ? 5 : 0, Math.round((nagadSale / totalPaymentCalculated) * 100));
  const rocketPct = Math.max(rocketSale > 0 ? 5 : 0, Math.round((rocketSale / totalPaymentCalculated) * 100));
  const duePct = Math.max(dueSale > 0 ? 5 : 0, Math.max(0, 100 - (cashPct + bkashPct + nagadPct + rocketPct)));

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
  
  // Executive Dashboard Insights: Top Selling Items for Today
  let topSellingItems = [];
  try {
    const rawReport = getItemSalesReport(todayStr, todayStr) || [];
    topSellingItems = rawReport
      .filter(item => (item.quantitySold || 0) > 0 && (item.name || '').trim().toLowerCase() !== 'পানি')
      .sort((a, b) => (b.quantitySold || 0) - (a.quantitySold || 0))
      .slice(0, 5);
  } catch (err) {
    console.error("[AdminDB] Error fetching top selling items:", err);
  }

  // POS Device Control & Security Metrics (Prioritized by Activity: most recent first, late devices last)
  let registeredDevices = [];
  try {
    registeredDevices = getAllRegisteredDevices() || [];
  } catch (err) {
    console.error("[AdminDB] Error fetching devices:", err);
  }

  const getDeviceRecency = (dev) => {
    if (!dev) return 0;
    const val = dev.last_seen || dev.updated_at || dev.created_at;
    if (!val) return 0;
    const t = new Date(val).getTime();
    return isNaN(t) ? 0 : t;
  };

  // Sort: highest recency timestamp first, oldest/late devices at the bottom ("je late se ses e")
  const sortedDevices = [...registeredDevices].sort((a, b) => {
    return getDeviceRecency(b) - getDeviceRecency(a);
  });

  const approvedDevicesCount = registeredDevices.filter(d => d.status === 'ACTIVE' || d.status === 'APPROVED').length;
  const pendingDevicesCount = registeredDevices.filter(d => d.status === 'PENDING').length;
  const blockedDevicesCount = registeredDevices.filter(d => d.status === 'BLOCKED').length;

  const formatDeviceLastSeen = (dev) => {
    const ts = dev?.last_seen || dev?.updated_at;
    if (!ts) return 'কখনও সক্রিয় হয়নি';
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return ts;
      const diffMs = Date.now() - d.getTime();
      const diffMinutes = Math.floor(diffMs / 60000);
      if (diffMinutes < 5) return '🟢 অনলাইনে আছে';
      if (diffMinutes < 60) return `${diffMinutes} মিনিট আগে`;
      if (diffMinutes < 1440) {
        let hours = d.getHours();
        let minutes = d.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        minutes = minutes < 10 ? '0' + minutes : minutes;
        return `আজ ${hours}:${minutes} ${ampm}`;
      }
      return formatDisplayDate(d);
    } catch (e) {
      return ts;
    }
  };

  // Live Sync Queue Status
  let pendingSyncCount = 0;
  try {
    const db = getDb();
    const row = db?.getFirstSync("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING' OR status = 'FAILED'");
    pendingSyncCount = row?.count || 0;
  } catch (err) {}

  // Active Staff / Employees
  let activeEmployeesCount = 0;
  try {
    const emps = getOwnerEmployees() || [];
    activeEmployeesCount = emps.filter(e => e.status !== 'INACTIVE').length;
  } catch (err) {}

  const occupancyPercentage = tables.length > 0 ? Math.round((activeTablesCount / tables.length) * 100) : 0;
  
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

      <ScrollView
        ref={mainScrollRef}
        showsVerticalScrollIndicator={false}
        style={styles.scrollBody}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: keyboardHeight > 0 ? keyboardHeight + 80 : 60, paddingTop: 12 }}
      >

        {/* ── KPI STRIP ── 2×2 grid of key metrics */}
        <View style={styles.kpiStrip}>
          <View style={[styles.kpiCard, styles.kpiCardGreen]}>
            <View style={styles.kpiIconWrap}><Text style={styles.kpiIcon}>💰</Text></View>
            <Text style={styles.kpiLabel}>আজকের বিক্রয়</Text>
            <Text style={[styles.kpiValue, { color: '#34D399' }]}>৳ {todaySale.toLocaleString()}</Text>
            <Text style={styles.kpiSub}>{totalDoneCount} টি অর্ডার</Text>
          </View>
          <View style={[styles.kpiCard, styles.kpiCardIndigo]}>
            <View style={styles.kpiIconWrap}><Text style={styles.kpiIcon}>📅</Text></View>
            <Text style={styles.kpiLabel}>মাসিক মোট</Text>
            <Text style={[styles.kpiValue, { color: '#818CF8' }]}>৳ {monthlyTotalSell.toLocaleString()}</Text>
            <Text style={styles.kpiSub}>{getBengaliMonthRange()}</Text>
          </View>
          <View style={[styles.kpiCard, styles.kpiCardAmber]}>
            <View style={styles.kpiIconWrap}><Text style={styles.kpiIcon}>🪑</Text></View>
            <Text style={styles.kpiLabel}>সক্রিয় টেবিল</Text>
            <Text style={[styles.kpiValue, { color: '#F59E0B' }]}>{activeTablesCount} / {tables.length}</Text>
            <Text style={styles.kpiSub}>{occupancyPercentage}% অকুপেন্সি</Text>
          </View>
          <View style={[styles.kpiCard, styles.kpiCardRed]}>
            <View style={styles.kpiIconWrap}><Text style={styles.kpiIcon}>📋</Text></View>
            <Text style={styles.kpiLabel}>মোট খরচ (আজ)</Text>
            <Text style={[styles.kpiValue, { color: '#F87171' }]}>৳ {totalExpenses.toLocaleString()}</Text>
            <Text style={styles.kpiSub}>সাপ্লায়ার + বাজার</Text>
          </View>
        </View>

        {/* ── 3-METRIC EXECUTIVE ROW (Image 4) ── */}
        <View style={styles.metricsRowCard}>
          <View style={styles.metricRowCol}>
            <Text style={styles.metricRowLabel}>ডিসকাউন্ট</Text>
            <Text style={styles.metricRowValue}>৳{todayDiscount.toLocaleString()}</Text>
          </View>
          <View style={styles.metricRowCol}>
            <Text style={styles.metricRowLabel}>ডেলিভারি</Text>
            <Text style={styles.metricRowValue}>৳{todayDeliverySales.toLocaleString()}</Text>
          </View>
          <View style={styles.metricRowCol}>
            <Text style={styles.metricRowLabel}>পিক টাইম</Text>
            <Text style={styles.metricRowValue}>{calculatedPeakHour}</Text>
          </View>
        </View>

        {/* ── টাকা কোন পথে এল (Image 3) ── */}
        <View style={styles.card}>
          <Text style={styles.sectionHeaderTitle}>টাকা কোন পথে এল</Text>
          {/* Segmented multi-color horizontal bar */}
          <View style={styles.segmentedBarTrack}>
            {cashPct > 0 && <View style={[styles.segmentBar, { width: `${cashPct}%`, backgroundColor: '#2DD4BF' }]} />}
            {bkashPct > 0 && <View style={[styles.segmentBar, { width: `${bkashPct}%`, backgroundColor: '#E11D48' }]} />}
            {nagadPct > 0 && <View style={[styles.segmentBar, { width: `${nagadPct}%`, backgroundColor: '#F97316' }]} />}
            {rocketPct > 0 && <View style={[styles.segmentBar, { width: `${rocketPct}%`, backgroundColor: '#8B5CF6' }]} />}
            {duePct > 0 && <View style={[styles.segmentBar, { width: `${duePct}%`, backgroundColor: '#71717A' }]} />}
          </View>
          {/* Breakdown legend */}
          <View style={styles.paymentLegendGrid}>
            <View style={styles.paymentLegendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#2DD4BF' }]} />
              <Text style={styles.legendLabel}>ক্যাশ</Text>
              <Text style={styles.legendVal}>৳{cashSale.toLocaleString()}</Text>
            </View>
            <View style={styles.paymentLegendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#E11D48' }]} />
              <Text style={styles.legendLabel}>বিকাশ</Text>
              <Text style={styles.legendVal}>৳{bkashSale.toLocaleString()}</Text>
            </View>
            <View style={styles.paymentLegendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#F97316' }]} />
              <Text style={styles.legendLabel}>নগদ</Text>
              <Text style={styles.legendVal}>৳{nagadSale.toLocaleString()}</Text>
            </View>
            <View style={styles.paymentLegendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#8B5CF6' }]} />
              <Text style={styles.legendLabel}>রকেট</Text>
              <Text style={styles.legendVal}>৳{rocketSale.toLocaleString()}</Text>
            </View>
            {dueSale > 0 && (
              <View style={styles.paymentLegendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#71717A' }]} />
                <Text style={styles.legendLabel}>বাকি</Text>
                <Text style={styles.legendVal}>৳{dueSale.toLocaleString()}</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── টেবিলের অবস্থা (Image 1) ── */}
        <View style={styles.card}>
          <View style={styles.tableHeaderRow}>
            <Text style={styles.sectionHeaderTitle}>টেবিলের অবস্থা</Text>
            <Text style={styles.tableSummaryBadge}>
              {freeTablesCount} ফাঁকা · {busyTablesCount} চলছে{activeDeliveriesCount > 0 ? ` · ${activeDeliveriesCount} ডেলিভারি` : ''}
            </Text>
          </View>

          <View style={styles.tableVisualGrid}>
            {tables.map(t => {
              const isBusy = t.status === 'BUSY';
              const m = getTableElapsedMinutes(t);
              const isLong = m && m >= 15;

              const cardBg = !isBusy ? '#0E231C' : isLong ? '#2D1518' : '#2A1F12';
              const cardBorder = !isBusy ? '#065F46' : isLong ? '#991B1B' : '#92400E';
              const textCol = !isBusy ? '#34D399' : isLong ? '#F87171' : '#FBBF24';

              return (
                <TouchableOpacity
                  key={t.id}
                  activeOpacity={0.7}
                  onPress={() => onTableSelect(t.id)}
                  style={[styles.tableVisualCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
                >
                  <Text style={[styles.tableVisualId, { color: textCol }]}>{t.name || t.id.replace('table_', 'T')}</Text>
                  <Text style={[styles.tableVisualSub, { color: textCol }]}>
                    {isBusy ? (m !== null ? `${m} মিনিট` : 'চলছে') : 'ফাঁকা'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.tableBottomHint}>যেকোনো টেবিলে চাপ দিন</Text>
        </View>

        {/* ── LAST 7 DAYS (Image 2) ── */}
        <View style={styles.terminalCard}>
          <Text style={styles.terminalTitle}>┌── LAST  7  DAYS ──────────────────────────────────┐</Text>
          <View style={styles.terminalBody}>
            {last7DaysData.map(item => {
              const pct = Math.max(10, Math.min(100, Math.round((item.sales / (max7DaySale || 1)) * 100)));
              const isBest = item.dateKey === bestDayKey && item.sales > 0;
              const kVal = (item.sales >= 1000) ? (item.sales / 1000).toFixed(1) + 'k' : item.sales.toString();

              return (
                <View key={item.dateKey} style={styles.terminalRow}>
                  <Text style={styles.terminalDayName}>│  {item.dayName}</Text>
                  <View style={styles.terminalBarTrack}>
                    <View style={[styles.terminalBarFill, { width: `${pct}%` }]} />
                    <View style={[styles.terminalBarHatch, { width: `${100 - pct}%` }]} />
                  </View>
                  <Text style={styles.terminalVal}>{kVal}</Text>
                  {isBest ? (
                    <Text style={styles.terminalBadgeBest}>⭐ best</Text>
                  ) : item.isToday ? (
                    <Text style={styles.terminalBadgeToday}>(today)</Text>
                  ) : (
                    <View style={{ width: 55 }} />
                  )}
                  <Text style={styles.terminalRightPipe}>│</Text>
                </View>
              );
            })}
            <View style={styles.terminalRowSpace}><Text style={styles.terminalBorderSide}>│</Text><Text style={styles.terminalBorderSide}>│</Text></View>
            <View style={styles.terminalFooterRow}>
              <Text style={styles.terminalBorderSide}>│  </Text>
              <Text style={styles.terminalFooterText}>Peak hour: {calculatedPeakHour}</Text>
              <Text style={styles.terminalFooterText}>Weather: ☀️ {weatherTemp}</Text>
              <Text style={styles.terminalBorderSide}>  │</Text>
            </View>
          </View>
          <Text style={styles.terminalTitle}>└───────────────────────────────────────────────────┘</Text>
        </View>

        {/* ── SECTION 1: দৈনিক হিসাব ও ক্লোজিং ── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <View style={[styles.cardIconPill, { backgroundColor: isDailySubmitted ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)' }]}>
                <Text style={styles.cardIconEmoji}>{isDailySubmitted ? '✅' : '⏳'}</Text>
              </View>
              <View style={styles.cardTitleCol}>
                <Text style={styles.cardTitle}>দৈনিক হিসাব ও ক্লোজিং</Text>
                <Text style={styles.cardSubtitle}>{isDailySubmitted ? 'আজকের ক্লোজিং সম্পন্ন' : 'চলমান ড্রাফট হিসাব'}</Text>
              </View>
            </View>
            <View style={[styles.statusPill, isDailySubmitted ? styles.statusPillGreen : styles.statusPillAmber]}>
              <Text style={[styles.statusPillText, isDailySubmitted ? { color: '#10B981' } : { color: '#F59E0B' }]}>
                {isDailySubmitted ? 'সম্পন্ন ✅' : 'চলমান ⏳'}
              </Text>
            </View>
          </View>

          {/* 4-cell financial matrix */}
          <View style={styles.financeGrid}>
            <View style={styles.financeCell}>
              <Text style={styles.financeCellLabel}>মোট বিক্রয়</Text>
              <Text style={[styles.financeCellVal, { color: '#34D399' }]}>৳ {todaySale.toLocaleString()}</Text>
            </View>
            <View style={[styles.financeCell, styles.financeCellBorderLeft]}>
              <Text style={styles.financeCellLabel}>মোট দৈনিক খরচ</Text>
              <Text style={[styles.financeCellVal, { color: '#F87171' }]}>৳ {totalExpenses.toLocaleString()}</Text>
            </View>
            <View style={[styles.financeCell, styles.financeCellBorderTop]}>
              <Text style={styles.financeCellLabel}>ক্যাশ ইন হ্যান্ড</Text>
              <Text style={[styles.financeCellVal, { color: '#60A5FA' }]}>৳ {totalCash.toLocaleString()}</Text>
            </View>
            <View style={[styles.financeCell, styles.financeCellBorderLeft, styles.financeCellBorderTop]}>
              <Text style={styles.financeCellLabel}>ডিজিটাল পেমেন্ট</Text>
              <Text style={[styles.financeCellVal, { color: '#FBBF24' }]}>৳ {(bkashSale + nagadSale + rocketSale).toLocaleString()}</Text>
            </View>
          </View>

          {/* Info row */}
          <View style={styles.cardInfoRow}>
            <View style={styles.cardInfoItem}>
              <Text style={styles.cardInfoLabel}>শুরু ক্যাশ (ইজা)</Text>
              <Text style={styles.cardInfoVal}>৳ {dailyExpenses.ijara || 0}</Text>
            </View>
            <View style={[styles.cardInfoItem, { borderLeftWidth: 1, borderColor: '#232331', paddingLeft: 12 }]}>
              <Text style={styles.cardInfoLabel}>চলমান ডেলিভারি চেঞ্জ</Text>
              <Text style={styles.cardInfoVal}>৳ {ongoingChangeMoney || 0}</Text>
            </View>
          </View>
        </View>

        {/* ── SECTION 3: শীর্ষ বিক্রিত খাবার ── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <View style={[styles.cardIconPill, { backgroundColor: 'rgba(245,158,11,0.15)' }]}>
                <Text style={styles.cardIconEmoji}>🔥</Text>
              </View>
              <View style={styles.cardTitleCol}>
                <Text style={styles.cardTitle}>শীর্ষ বিক্রিত খাবার</Text>
                <Text style={styles.cardSubtitle}>আজকের সেরা ৫টি আইটেম</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.cardOutlineBtn} onPress={onNavigateToItemSalesReport} activeOpacity={0.7}>
              <Text style={styles.cardOutlineBtnText}>পূর্ণ রিপোর্ট 📊</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.bestSellerList}>
            {topSellingItems.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateEmoji}>🍽️</Text>
                <Text style={styles.emptyStateText}>আজ এখনও কোনো খাবার বিক্রয় হয়নি</Text>
                <Text style={styles.emptyStateSub}>অর্ডার সম্পন্ন হলে এখানে লাইভ র‍্যাংকিং দেখাবে।</Text>
              </View>
            ) : (
              topSellingItems.map((item, index) => {
                const rankColors = ['#FFB703', '#94A3B8', '#F59E0B', '#64748B', '#64748B'];
                const rankColor = rankColors[index] || '#64748B';
                return (
                  <View key={item.id || item.name || index} style={styles.bestSellerRow}>
                    <View style={[styles.rankBadge, { borderColor: rankColor }]}>
                      <Text style={[styles.rankText, { color: rankColor }]}>#{index + 1}</Text>
                    </View>
                    <View style={styles.bestSellerInfo}>
                      <Text style={styles.bestSellerName} numberOfLines={1}>{item.name}</Text>
                      {item.category ? <Text style={styles.bestSellerCategory}>{item.category}</Text> : null}
                    </View>
                    <View style={styles.bestSellerMetrics}>
                      <View style={styles.qtyBadge}><Text style={styles.qtyBadgeText}>{item.quantitySold} পিস</Text></View>
                      <Text style={styles.itemSalesAmount}>৳ {(item.totalSales || 0).toLocaleString()}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </View>

        {/* ── SECTION 4: ডিভাইস ও পস কন্ট্রোল ── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <View style={[styles.cardIconPill, { backgroundColor: 'rgba(16,185,129,0.15)' }]}>
                <Text style={styles.cardIconEmoji}>🛡️</Text>
              </View>
              <View style={styles.cardTitleCol}>
                <Text style={styles.cardTitle}>ডিভাইস ও পস কন্ট্রোল</Text>
                <Text style={styles.cardSubtitle}>রেজিস্টার্ড পিওএস সিকিউরিটি</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.cardOutlineBtn} onPress={onNavigateToDeviceManagement} activeOpacity={0.7}>
              <Text style={styles.cardOutlineBtnText}>কন্ট্রোল 🔒</Text>
            </TouchableOpacity>
          </View>

          {/* Device count chips */}
          <View style={styles.deviceChipsRow}>
            <View style={[styles.deviceChip, { borderColor: 'rgba(16,185,129,0.3)', backgroundColor: 'rgba(16,185,129,0.08)' }]}>
              <View style={[styles.deviceChipDot, { backgroundColor: '#10B981' }]} />
              <Text style={styles.deviceChipLabel}>অনুমোদিত </Text>
              <Text style={[styles.deviceChipValue, { color: '#10B981' }]}>{approvedDevicesCount}</Text>
            </View>
            <View style={[styles.deviceChip, pendingDevicesCount > 0 ? { borderColor: '#F59E0B', backgroundColor: 'rgba(245,158,11,0.15)' } : { borderColor: 'rgba(245,158,11,0.3)', backgroundColor: 'rgba(245,158,11,0.08)' }]}>
              <View style={[styles.deviceChipDot, { backgroundColor: '#F59E0B' }]} />
              <Text style={styles.deviceChipLabel}>অপেক্ষায় </Text>
              <Text style={[styles.deviceChipValue, { color: '#F59E0B' }]}>{pendingDevicesCount}</Text>
            </View>
            {blockedDevicesCount > 0 && (
              <View style={[styles.deviceChip, { borderColor: 'rgba(239,68,68,0.3)', backgroundColor: 'rgba(239,68,68,0.08)' }]}>
                <View style={[styles.deviceChipDot, { backgroundColor: '#EF4444' }]} />
                <Text style={styles.deviceChipLabel}>ব্লকড </Text>
                <Text style={[styles.deviceChipValue, { color: '#EF4444' }]}>{blockedDevicesCount}</Text>
              </View>
            )}
          </View>

          {/* Pending alert */}
          {pendingDevicesCount > 0 && (
            <View style={styles.pendingAlert}>
              <Text style={styles.pendingAlertEmoji}>⚠️</Text>
              <Text style={styles.pendingAlertText}>{pendingDevicesCount}টি নতুন ডিভাইস অ্যাডমিন অনুমোদনের অপেক্ষায়!</Text>
              <TouchableOpacity style={styles.pendingAlertBtn} onPress={onNavigateToDeviceManagement}>
                <Text style={styles.pendingAlertBtnText}>রিভিউ</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Device mini list */}
          {sortedDevices.slice(0, 4).map(dev => {
            const isAppr = dev.status === 'ACTIVE' || dev.status === 'APPROVED';
            const isPend = dev.status === 'PENDING';
            return (
              <View key={dev.id || dev.device_id} style={styles.deviceMiniRow}>
                <View style={styles.deviceMiniLeft}>
                  <Text style={styles.deviceMiniEmoji}>{isAppr ? '📱' : isPend ? '⏳' : '🚫'}</Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.deviceMiniName} numberOfLines={1}>{dev.device_name || dev.model || 'POS Terminal'}</Text>
                    <Text style={styles.deviceMiniRole} numberOfLines={1}>{dev.role || 'Cashier'} • {formatDeviceLastSeen(dev)}</Text>
                  </View>
                </View>
                <View style={[styles.statusPill, isAppr ? styles.statusPillGreen : isPend ? styles.statusPillAmber : styles.statusPillRed]}>
                  <Text style={[styles.statusPillText, isAppr ? { color: '#10B981' } : isPend ? { color: '#F59E0B' } : { color: '#EF4444' }]}>{dev.status}</Text>
                </View>
              </View>
            );
          })}

          <TouchableOpacity style={styles.fullWidthBtn} onPress={onNavigateToDeviceManagement} activeOpacity={0.8}>
            <Text style={styles.fullWidthBtnText}>🔒 ডিভাইস ম্যানেজমেন্ট ও সিকিউরিটি কন্ট্রোল</Text>
          </TouchableOpacity>
        </View>

        {/* ── SECTION 5: ক্লাউড সিঙ্ক ও সিস্টেম হেলথ ── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <View style={[styles.cardIconPill, { backgroundColor: 'rgba(6,182,212,0.15)' }]}>
                <Text style={styles.cardIconEmoji}>🔄</Text>
              </View>
              <View style={styles.cardTitleCol}>
                <Text style={styles.cardTitle}>ক্লাউড সিঙ্ক ও হেলথ</Text>
                <Text style={styles.cardSubtitle}>ডাটাবেজ সিঙ্ক স্থিতি</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.cardOutlineBtn} onPress={onNavigateToSyncDiagnostics} activeOpacity={0.7}>
              <Text style={styles.cardOutlineBtnText}>ডায়াগনস্টিকস 🛠️</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.syncStatusGrid}>
            <View style={styles.syncStatusCell}>
              <Text style={styles.syncStatusLabel}>SQLite লোকাল ডাটাবেজ</Text>
              <Text style={[styles.syncStatusVal, { color: '#10B981' }]}>🟢 সক্রিয় ও সুরক্ষিত</Text>
            </View>
            <View style={[styles.syncStatusCell, { borderLeftWidth: 1, borderColor: '#232331', paddingLeft: 12 }]}>
              <Text style={styles.syncStatusLabel}>ক্লাউড সিঙ্ক কিউ</Text>
              <Text style={[styles.syncStatusVal, pendingSyncCount > 0 ? { color: '#F59E0B' } : { color: '#10B981' }]}>
                {pendingSyncCount === 0 ? 'সব ডাটা সিঙ্কড ✅' : `${pendingSyncCount} টি অপেক্ষমান 🔄`}
              </Text>
            </View>
          </View>

          <View style={styles.syncTimerBar}>
            <Text style={styles.syncTimerBarText}>
              ⏱️ অটো-সিঙ্ক টাইমার: ডেলিভারি {delCountdown}s | টেবিল {tabCountdown}s | ফুল সিঙ্ক {fullCountdown}s
            </Text>
          </View>

          {activeEmployeesCount > 0 && (
            <TouchableOpacity style={styles.employeeRow} onPress={onNavigateToEmployees} activeOpacity={0.7}>
              <Text style={styles.employeeRowEmoji}>👥</Text>
              <Text style={styles.employeeRowText}>সক্রিয় কর্মী: {activeEmployeesCount} জন</Text>
              <Text style={styles.employeeRowArrow}>→</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── SECTION 6: রিপোর্ট ও অতীত অডিট ── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <View style={[styles.cardIconPill, { backgroundColor: 'rgba(236,72,153,0.15)' }]}>
                <Text style={styles.cardIconEmoji}>📑</Text>
              </View>
              <View style={styles.cardTitleCol}>
                <Text style={styles.cardTitle}>রিপোর্ট ও অতীত অডিট</Text>
                <Text style={styles.cardSubtitle}>সেলস ও ডিপোজিট পিডিএফ</Text>
              </View>
            </View>
          </View>

          <TouchableOpacity style={styles.reportTile} onPress={() => setSalesReportVisible(true)} activeOpacity={0.7}>
            <View style={[styles.reportTileIcon, { backgroundColor: 'rgba(52,211,153,0.15)' }]}><Text style={{ fontSize: 17 }}>📋</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.reportTileTitle}>সেলস রিপোর্ট PDF</Text>
              <Text style={styles.reportTileSub}>দৈনিক ও কাস্টম তারিখ ভিত্তিক বিক্রয় তালিকা</Text>
            </View>
            <Text style={styles.reportTileArrow}>→</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.reportTile} onPress={() => setDepositReportVisible(true)} activeOpacity={0.7}>
            <View style={[styles.reportTileIcon, { backgroundColor: 'rgba(251,191,36,0.15)' }]}><Text style={{ fontSize: 17 }}>🏦</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.reportTileTitle}>ডিপোজিট রিপোর্ট PDF</Text>
              <Text style={styles.reportTileSub}>মালিকের ব্যাংক ও ক্যাশ জমা স্টেটমেন্ট</Text>
            </View>
            <Text style={styles.reportTileArrow}>→</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.reportTile} onPress={handleOpenPastAccount} activeOpacity={0.7}>
            <View style={[styles.reportTileIcon, { backgroundColor: 'rgba(168,85,247,0.15)' }]}><Text style={{ fontSize: 17 }}>📅</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.reportTileTitle}>অতীতের হিসাব অডিট</Text>
              <Text style={styles.reportTileSub}>পূর্ববর্তী যেকোনো দিনের ক্লোজড হিসাব চেক করুন</Text>
            </View>
            <Text style={styles.reportTileArrow}>→</Text>
          </TouchableOpacity>
        </View>

        {/* ── SECTION 8: অ্যাপ ভার্সন কন্ট্রোল ── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <View style={[styles.cardIconPill, { backgroundColor: 'rgba(99,102,241,0.15)' }]}>
                <Text style={styles.cardIconEmoji}>📱</Text>
              </View>
              <View style={styles.cardTitleCol}>
                <Text style={styles.cardTitle}>অ্যাপ ভার্সন কন্ট্রোল</Text>
                <Text style={styles.cardSubtitle}>Owner ও Manager অ্যাপের নিউনতম ভার্সন</Text>
              </View>
            </View>
          </View>

          <View style={styles.versionControlCard}>
            {/* Current versions row */}
            <View style={styles.versionInfoRow}>
              <View style={styles.versionInfoItem}>
                <Text style={styles.versionInfoLabel}>রানিং APK ভার্সন</Text>
                <Text style={styles.versionInfoValue}>
                  {(Application.applicationId === 'host.exp.exponent' || Application.nativeApplicationVersion?.startsWith('56.')) ? APP_VERSION : (Application.nativeApplicationVersion || APP_VERSION)}
                </Text>
                <Text style={styles.versionInfoSub}>Build {Application.nativeBuildVersion || '—'}</Text>
              </View>
              <View style={styles.versionInfoDivider} />
              <View style={styles.versionInfoItem}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={styles.versionInfoLabel}>Firebase নিউনতম</Text>
                  <TouchableOpacity onPress={loadFirebaseVersion} disabled={isLoadingVersion} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginLeft: 6 }}>
                    <Text style={{ fontSize: 12 }}>{isLoadingVersion ? '⏳' : '🔄'}</Text>
                  </TouchableOpacity>
                </View>
                {isLoadingVersion ? (
                  <ActivityIndicator size="small" color="#6366F1" style={{ marginVertical: 4 }} />
                ) : versionFetchError ? (
                  <TouchableOpacity onPress={loadFirebaseVersion} activeOpacity={0.7}>
                    <Text style={[styles.versionInfoValue, { color: '#F59E0B', fontSize: 12 }]}>⚠️ লোড হয়নি (ট্যাপ করুন)</Text>
                  </TouchableOpacity>
                ) : firebaseMinVersion !== null ? (
                  <Text style={styles.versionInfoValue}>{firebaseMinVersion}</Text>
                ) : (
                  <ActivityIndicator size="small" color="#6366F1" />
                )}
                {firebaseMinVersion !== null && !isLoadingVersion && (() => {
                  const liveVer = (Application.applicationId === 'host.exp.exponent' || Application.nativeApplicationVersion?.startsWith('56.')) ? APP_VERSION : (Application.nativeApplicationVersion || APP_VERSION);
                  const isUpToDate = compareSemver(liveVer, firebaseMinVersion) >= 0;
                  return (
                    <Text style={[styles.versionInfoSub, isUpToDate ? { color: '#10B981' } : { color: '#EF4444' }]}>
                      {isUpToDate ? '✅ আপ-টু-ডেট' : '❌ পুরনো'}
                    </Text>
                  );
                })()}
              </View>
            </View>

            <Text style={styles.versionHelpText}>
              নতুন APK বের করার পর এখানে সেই ভার্সন দিন। পুরনো ভার্সনের ডিভাইস Force Logout-এর পর login করতে পারবে না।
            </Text>

            {/* Input + Auto Pick + Save */}
            <View style={styles.versionInputRow}>
              <TextInput
                style={styles.versionInput}
                value={versionInput}
                onChangeText={setVersionInput}
                onFocus={() => {
                  setTimeout(() => {
                    mainScrollRef.current?.scrollToEnd({ animated: true });
                  }, 200);
                }}
                placeholder="যেমন: 1.0.3"
                placeholderTextColor="#555"
                keyboardType="decimal-pad"
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={styles.versionAutoPickBtn}
                onPress={() => {
                  const isExpoGo = Application.applicationId === 'host.exp.exponent' || Application.nativeApplicationVersion?.startsWith('56.');
                  const liveVer = isExpoGo ? APP_VERSION : (Application.nativeApplicationVersion || APP_VERSION);
                  setVersionInput(liveVer);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.versionAutoPickBtnText}>অটো পিক 🎯</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.versionSaveBtn, (isSavingVersion || isLoadingVersion) && { opacity: 0.6 }]}
                disabled={isSavingVersion || isLoadingVersion}
                onPress={handleInitiateVersionUpdate}
                activeOpacity={0.8}
              >
                {isSavingVersion ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.versionSaveBtnText}>আপডেট করুন</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>

      </ScrollView>


      {/* MODALS */}
      {/* Admin PIN Verification Modal for App Version Update */}
      <Modal
        visible={versionPinModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setVersionPinModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}
            activeOpacity={1}
            onPress={() => setVersionPinModalVisible(false)}
          >
            <View style={[styles.modalContent, { width: '88%', maxWidth: 360, padding: 20 }]} onStartShouldSetResponder={() => true}>
              <Text style={[styles.modalTitle, { fontSize: 16, marginBottom: 4 }]}>🔐 অ্যাডমিন নিরাপত্তা যাচাই</Text>
              <Text style={[styles.modalSubtitle, { marginBottom: 14, textAlign: 'center', lineHeight: 18 }]}>
                নিউনতম অ্যাপ ভার্সন {versionInput.trim()} সেট করতে আপনার অ্যাডমিন PIN লিখুন:
              </Text>

              {versionPinError ? (
                <View style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', borderWidth: 1, borderColor: '#ef4444', borderRadius: 8, padding: 8, marginBottom: 10, width: '100%' }}>
                  <Text style={{ color: '#ef4444', fontSize: 12, textAlign: 'center' }}>⚠️ {versionPinError}</Text>
                </View>
              ) : null}

              <TextInput
                style={{
                  width: '100%',
                  backgroundColor: '#1C1C1C',
                  borderWidth: 1,
                  borderColor: '#3F3F46',
                  borderRadius: 10,
                  color: '#FFF',
                  padding: 12,
                  fontSize: 20,
                  textAlign: 'center',
                  letterSpacing: 6,
                  marginBottom: 16
                }}
                placeholder="••••"
                placeholderTextColor="#71717A"
                keyboardType="number-pad"
                secureTextEntry={true}
                value={versionPinInput}
                onChangeText={(val) => {
                  setVersionPinInput(val);
                  if (versionPinError) setVersionPinError('');
                }}
                autoFocus={true}
              />

              <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: '#27272A', borderRadius: 8, paddingVertical: 10, alignItems: 'center' }}
                  onPress={() => setVersionPinModalVisible(false)}
                >
                  <Text style={{ color: '#E4E4E7', fontWeight: '600' }}>বাতিল</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: '#6366F1', borderRadius: 8, paddingVertical: 10, alignItems: 'center' }}
                  onPress={handleConfirmVersionWithPin}
                >
                  <Text style={{ color: '#FFF', fontWeight: 'bold' }}>নিশ্চিত করুন</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
      {/* FLOOR & TABLE MANAGEMENT MODAL */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={floorModalVisible}
        onRequestClose={() => setFloorModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { width: '94%', maxHeight: '88%', padding: 16 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'center', marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={[styles.modalIconCircle, { marginBottom: 0, width: 38, height: 38, marginRight: 10 }]}>
                  <Text style={styles.modalIconEmoji}>🗺️</Text>
                </View>
                <View>
                  <Text style={[styles.modalTitle, { marginBottom: 2 }]}>ফ্লোর ও টেবিল মনিটরিং</Text>
                  <Text style={styles.modalSubtitle}>রিনেম করতে লং প্রেস করুন, অর্ডারে যেতে ট্যাপ করুন</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setFloorModalVisible(false)} style={styles.closeCircle}>
                <Text style={styles.closeCircleText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ width: '100%' }}>
              {/* Table Grid inside modal */}
              <View style={styles.tableGrid}>
                {tables.map((table) => {
                  const isBusy = table.status === 'BUSY';
                  const amount = table.items?.reduce((sum, i) => sum + (i.price * i.qty), 0) || 0;
                  return (
                    <TouchableOpacity
                      key={table.id}
                      onPress={() => {
                        setFloorModalVisible(false);
                        onTableSelect(table.id);
                      }}
                      onLongPress={() => handleTableLongPress(table)}
                      style={[styles.tableCard, isBusy ? styles.tableBusyBorder : styles.tableFreeBorder]}
                    >
                      <Text style={styles.tableId}>{table.name || table.id}</Text>
                      <View style={styles.tableStatusRow}>
                        <View style={[styles.statusDot, isBusy ? styles.dotOrange : styles.dotGreen]} />
                        <Text style={[styles.tableStatusText, isBusy ? styles.textOrange : styles.textGreen]}>{table.status}</Text>
                      </View>
                      {isBusy ? <Text style={styles.tableAmount}>৳ {amount}</Text> : <View style={{ height: 10 }} />}
                      <Text style={styles.chairIcon}>🪑</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Deliveries inside modal */}
              <View style={{ marginTop: 20 }}>
                <Text style={[styles.sectionTitle, { fontSize: 14 }]}>সক্রিয় ডেলিভারি ({deliveries.filter(d => d.status === 'BUSY').length})</Text>
                <View style={{ marginTop: 8 }}>
                  {deliveries.filter(d => d.status === 'BUSY').map((delivery) => (
                    <TouchableOpacity
                      key={delivery.id}
                      style={[styles.deliveryCard, { marginBottom: 10 }]}
                      onPress={() => {
                        setFloorModalVisible(false);
                        onTableSelect(delivery.id);
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View>
                          <Text style={styles.deliveryTitle}>{delivery.name}</Text>
                          <Text style={styles.deliveryTime}>শুরু: {formatStartTime(delivery.startTime)}</Text>
                        </View>
                        <Text style={styles.deliveryAmount}>৳ {delivery.items.reduce((sum, i) => sum + (i.price * i.qty), 0)}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                  {deliveries.filter(d => d.status === 'BUSY').length === 0 && (
                    <Text style={{ color: '#777', fontSize: 11, textAlign: 'center', paddingVertical: 12 }}>কোনো চলমান ডেলিভারি নেই</Text>
                  )}
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

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
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalContent}><Text style={styles.modalTitle}>টেবিলের নাম পরিবর্তন</Text>
            <View style={styles.renameInputWrapper}><TextInput style={[styles.renameInput, { color: '#FFF' }]} value={newTableName} onChangeText={setNewTableName} placeholder="নাম লিখুন" placeholderTextColor="#AAA" autoFocus={true}/></View>
            <View style={styles.modalBtnRow}><TouchableOpacity style={styles.modalCancelBtn} onPress={() => setRenameModalVisible(false)}><Text style={styles.modalCancelBtnText}>বাতিল</Text></TouchableOpacity><TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveTableName}><Text style={styles.modalSaveBtnText}>সংরক্ষণ</Text></TouchableOpacity></View>
          </View>
        </KeyboardAvoidingView>
      </Modal>


      {/* 3-DOT MENU */}
      <Modal animationType="fade" transparent={true} visible={menuModalVisible} onRequestClose={() => setMenuModalVisible(false)}>
        <TouchableOpacity style={styles.menuModalOverlay} activeOpacity={1} onPress={() => setMenuModalVisible(false)}>
          <View style={styles.menuModalContent}>
            <View style={styles.syncTimerWrapper}>
              <Text style={styles.syncTimerText}>Del: {delCountdown}s | Tab: {tabCountdown}s | Full: {fullCountdown}s</Text>
            </View>

            <View style={styles.menuSectionHeader}><Text style={styles.menuSectionText}>CORE OPERATIONS</Text></View>


            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onNavigateToEditMenu(); }}><Text style={styles.menuOptionText}>🍴 Edit Menu</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); if (onNavigateToAnalytics) onNavigateToAnalytics(); }}><Text style={styles.menuOptionText}>📈 Business Analytics</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onNavigateToItemSalesReport(); }}><Text style={styles.menuOptionText}>📊 আইটেম বিক্রয় রিপোর্ট</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onNavigateToSyncDiagnostics(); }}><Text style={styles.menuOptionText}>🛠️ Sync Diagnostics</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onNavigateToDeleteHistory(); }}><Text style={styles.menuOptionText}>🗑️ Delete History</Text></TouchableOpacity>
            {String(process.env.EXPO_PUBLIC_AI_DATASET_ENABLED || 'false').toLowerCase().trim() === 'true' && (
              <>
                <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); if (onNavigateToAIDatasetMonitor) onNavigateToAIDatasetMonitor(); }}><Text style={styles.menuOptionText}>🤖 AI Dataset Monitor</Text></TouchableOpacity>
                <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); if (onNavigateToAIDatasetAuditCenter) onNavigateToAIDatasetAuditCenter(); }}><Text style={styles.menuOptionText}>🔍 AI Dataset Audit Center</Text></TouchableOpacity>
              </>
            )}
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); if (onNavigateToDeviceManagement) onNavigateToDeviceManagement(); }}><Text style={styles.menuOptionText}>📱 Device Control</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onNavigateToSystemTools(); }}><Text style={styles.menuOptionText}>🛠️ System Tools</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); if (onNavigateToActivityLog) onNavigateToActivityLog(); }}><Text style={styles.menuOptionText}>📜 Activity & Audit Logs</Text></TouchableOpacity>

            <TouchableOpacity style={styles.menuOption} onPress={handleOpenPastAccount}><Text style={styles.menuOptionText}>📅 অতীতের হিসাব</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); setSalesReportVisible(true); }}><Text style={styles.menuOptionText}>📋 Sales Report</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); setDepositReportVisible(true); }}><Text style={styles.menuOptionText}>📊 Deposit Report</Text></TouchableOpacity>

            <View style={styles.menuSectionHeader}><Text style={styles.menuSectionText}>SYSTEM TOOLS</Text></View>

            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onResetDailySubmit(); }}><Text style={[styles.menuOptionText, { color: '#FFB703' }]}>🔓 রিসেট ডেইলি লক</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onResetIjara(); }}><Text style={[styles.menuOptionText, { color: '#FFB703' }]}>🔓 রিসেট ইজা খরচ</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onResetHistoryLimits(); }}><Text style={[styles.menuOptionText, { color: '#FFB703' }]}>🔓 Reset History Limits</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); if (onSameDayResync) onSameDayResync(); }}><Text style={[styles.menuOptionText, { color: '#38BDF8' }]}>🔄 আজকের ডেটা রিসিন্ক (Same-Day Resync)</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onCloudRestore(); }}><Text style={[styles.menuOptionText, { color: '#34D399' }]}>☁️ Cloud Restore</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onMenuRecovery(); }}><Text style={[styles.menuOptionText, { color: '#34D399' }]}>🍴 Recover Menu Items</Text></TouchableOpacity>

            <View style={styles.menuDivider} />
            <TouchableOpacity style={styles.menuOption} onPress={() => { setMenuModalVisible(false); onLogout(); }}><Text style={[styles.menuOptionText, { color: '#FF4D4D' }]}>Logout</Text></TouchableOpacity>
          </View>
        </TouchableOpacity>
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

            {/* PERSISTENT CLOUD CATCH-UP OPTION */}
            {salesFilter !== 'Today' && (
              <View style={{ paddingHorizontal: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111', paddingVertical: 10, borderRadius: 8, marginHorizontal: 8, borderWidth: 1, borderColor: '#333' }}>
                <View style={{ flex: 1, marginRight: 10 }}>
                  <Text style={{ color: '#FFB703', fontSize: 10, fontWeight: 'bold' }}>⚠️ এই মাসের সম্পূর্ণ ডাটা লোকাল ডিভাইসে নাও থাকতে পারে।</Text>
                </View>
                <TouchableOpacity 
                  style={{ backgroundColor: '#34D399', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 }}
                  onPress={handleSalesCheckCloud}
                >
                  <Text style={{ color: '#000', fontSize: 11, fontWeight: 'bold' }}>☁️ ক্লাউড থেকে সম্পূর্ণ মাস ডাউনলোড করুন</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.sheetContainer}><ScrollView horizontal><View>
                  <View style={styles.sheetHeader}><Text style={[styles.sheetHeaderText, { width: 120, textAlign: 'left' }]}>তারিখ ও সময়</Text><Text style={[styles.sheetHeaderText, { width: 50 }]}>টেবিল</Text><Text style={[styles.sheetHeaderText, { width: 220, textAlign: 'left' }]}>আইটেম</Text><Text style={[styles.sheetHeaderText, { width: 70, textAlign: 'right' }]}>বিক্রয়</Text></View>
                  <ScrollView style={styles.sheetBody}>
                    {filteredSalesOrders.length === 0 ? (
                      <View style={{ width: 460, alignItems: 'center', padding: 40 }}>
                        <Text style={styles.emptySheetText}>কোনো বিক্রয় ইতিহাস পাওয়া যায়নি।</Text>
                        <TouchableOpacity 
                          style={{ marginTop: 20, backgroundColor: '#34D399', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}
                          onPress={handleSalesCheckCloud}
                        >
                          <Text style={{ color: '#000', fontWeight: 'bold' }}>☁️ ক্লাউড থেকে ডাটা আনুন</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      filteredSalesOrders.map((order, idx) => (
                        <TouchableOpacity key={idx} style={[styles.sheetRow, idx % 2 === 1 && styles.sheetRowAlt]} onPress={() => { setSelectedOrder({...order, table: order.tableId, amount: order.paidAmount, status: 'Done'}); setOrderDetailVisible(true); }}>
                          <View style={{ width: 120 }}><Text style={styles.sheetCellTextMain}>{order.fullDate ? formatDisplayDate(order.fullDate) : 'আজ'}</Text><Text style={styles.sheetCellTextSub}>{order.time}</Text></View>
                          <Text style={[styles.sheetCell, { width: 50 }]}>{order.tableId}</Text>
                          <Text style={[styles.sheetCell, { width: 220, fontSize: 9, textAlign: 'left', color: '#FFB703' }]} numberOfLines={2}>{order.items}</Text>
                          <Text style={[styles.sheetCell, { width: 70, textAlign: 'right', color: '#34D399', fontWeight: 'bold' }]}>৳{order.paidAmount}</Text>
                        </TouchableOpacity>
                      ))
                    )}
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

            {/* PERSISTENT CLOUD CATCH-UP OPTION */}
            <View style={{ paddingHorizontal: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111', paddingVertical: 10, borderRadius: 8, marginHorizontal: 8, borderWidth: 1, borderColor: '#333' }}>
               <View style={{ flex: 1, marginRight: 10 }}>
                 <Text style={{ color: '#FFB703', fontSize: 10, fontWeight: 'bold' }}>⚠️ এই মাসের সম্পূর্ণ ডাটা লোকাল ডিভাইসে নাও থাকতে পারে।</Text>
               </View>
               <TouchableOpacity 
                 style={{ backgroundColor: 'rgba(52, 211, 153, 0.15)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#34D399' }}
                 onPress={() => {
                   const monthStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;
                   onHistoricalMonthDownload(monthStr, activeFilter);
                 }}
               >
                 <Text style={{ color: '#34D399', fontSize: 11, fontWeight: 'bold' }}>☁️ ক্লাউড থেকে সম্পূর্ণ মাস ডাউনলোড করুন</Text>
               </TouchableOpacity>
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
                          <Text style={{ color: '#000', fontWeight: 'bold' }}>☁️ ক্লাউড থেকে ডাটা আনুন</Text>
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
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { width: '90%', maxHeight: '85%' }]}>
            <View style={styles.modalIconCircle}><Text style={styles.modalIconEmoji}>📅</Text></View>
            <Text style={styles.modalTitle}>অতীতের হিসাব যোগ করুন</Text>
            <ScrollView style={{ width: '100%' }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 220 }} showsVerticalScrollIndicator={false}>
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
        </View></KeyboardAvoidingView>
      </Modal>

      {/* FIREBASE USAGE */}
      <Modal animationType="slide" transparent={true} visible={firebaseUsageVisible} onRequestClose={() => setFirebaseUsageVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
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
        </KeyboardAvoidingView>
      </Modal>
      {/* DATA CLEANUP TOOL */}
      <Modal animationType="slide" transparent={true} visible={cleanupModalVisible} onRequestClose={() => setCleanupModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
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
        </KeyboardAvoidingView>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // ── ROOT ──
  container: { flex: 1, backgroundColor: '#060608' },
  scrollBody: { flex: 1 },

  // ── HEADER ──
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#12131A', backgroundColor: '#0A0B10' },
  headerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  titleBadgeRow: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#FFB703', letterSpacing: 0.4 },
  adminBadge: { backgroundColor: 'rgba(255,183,3,0.15)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginLeft: 8, borderWidth: 1, borderColor: 'rgba(255,183,3,0.3)' },
  adminBadgeText: { color: '#FFB703', fontSize: 9, fontWeight: 'bold' },
  headerDate: { fontSize: 11, color: '#6B6F85', marginTop: 2 },
  menuDotsButton: { padding: 6 },
  menuDotsIcon: { fontSize: 24, color: '#FFB703', fontWeight: 'bold' },

  // ── KPI STRIP ──
  kpiStrip: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingBottom: 4 },
  kpiCard: { width: '47%', marginHorizontal: '1.5%', marginBottom: 10, borderRadius: 14, padding: 14, borderWidth: 1 },
  kpiCardGreen:  { backgroundColor: '#0B1812', borderColor: 'rgba(52,211,153,0.25)' },
  kpiCardIndigo: { backgroundColor: '#0D0E1C', borderColor: 'rgba(99,102,241,0.25)' },
  kpiCardAmber:  { backgroundColor: '#191108', borderColor: 'rgba(245,158,11,0.25)' },
  kpiCardRed:    { backgroundColor: '#170B0B', borderColor: 'rgba(248,113,113,0.25)' },
  kpiIconWrap: { marginBottom: 6 },
  kpiIcon: { fontSize: 20 },
  kpiLabel: { color: '#8B8FA8', fontSize: 10, fontWeight: '600', marginBottom: 4, letterSpacing: 0.3 },
  kpiValue: { fontSize: 18, fontWeight: '800', marginBottom: 2 },
  kpiSub: { color: '#5A5E73', fontSize: 9, fontWeight: '500' },

  // ── CARD (universal card container) ──
  card: { backgroundColor: '#0E0F14', borderRadius: 16, borderWidth: 1, borderColor: '#1A1B24', marginHorizontal: 12, marginBottom: 12, padding: 14 },

  // ── CARD HEADER ──
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, marginRight: 8 },
  cardIconPill: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 10, flexShrink: 0 },
  cardIconEmoji: { fontSize: 17 },
  cardTitleCol: { flex: 1, minWidth: 0 },
  cardTitle: { color: '#E8E9EF', fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  cardSubtitle: { color: '#6B6F85', fontSize: 10, marginTop: 1 },
  cardOutlineBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,183,3,0.35)', backgroundColor: 'rgba(255,183,3,0.07)', flexShrink: 0 },
  cardOutlineBtnText: { color: '#FFB703', fontSize: 10, fontWeight: '600' },

  // ── STATUS PILL ──
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, flexShrink: 0 },
  statusPillGreen: { backgroundColor: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.3)' },
  statusPillAmber: { backgroundColor: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.3)' },
  statusPillRed:   { backgroundColor: 'rgba(239,68,68,0.1)',  borderColor: 'rgba(239,68,68,0.3)' },
  statusPillText: { fontSize: 10, fontWeight: '700' },

  // ── FINANCE GRID (2×2) ──
  financeGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#141520', borderRadius: 12, overflow: 'hidden', marginBottom: 10, borderWidth: 1, borderColor: '#1E2030' },
  financeCell: { width: '50%', paddingVertical: 12, paddingHorizontal: 14 },
  financeCellBorderLeft: { borderLeftWidth: 1, borderColor: '#1E2030' },
  financeCellBorderTop:  { borderTopWidth: 1, borderColor: '#1E2030' },
  financeCellLabel: { color: '#6B6F85', fontSize: 10, marginBottom: 4, fontWeight: '500' },
  financeCellVal: { fontSize: 15, fontWeight: '800' },

  // ── CARD INFO ROW ──
  cardInfoRow: { flexDirection: 'row', marginBottom: 10 },
  cardInfoItem: { flex: 1 },
  cardInfoLabel: { color: '#6B6F85', fontSize: 10 },
  cardInfoVal: { color: '#C8CAD8', fontSize: 12, fontWeight: '700', marginTop: 1 },

  // ── PAYMENT BREAKDOWN ROW ──
  paymentBreakdownRow: { flexDirection: 'row', backgroundColor: '#141520', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#1E2030' },
  payBreakItem: { flex: 1, alignItems: 'center' },
  payBreakLabel: { color: '#6B6F85', fontSize: 9, marginBottom: 3 },
  payBreakVal: { fontSize: 12, fontWeight: '700' },

  // ── OCCUPANCY ──
  occupancyWrap: { marginBottom: 10 },
  occupancyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  occupancyCountText: { color: '#8B8FA8', fontSize: 12 },
  occupancyCountBig: { color: '#E8E9EF', fontSize: 20, fontWeight: '800' },
  occupancyPct: { backgroundColor: 'rgba(16,185,129,0.15)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  occupancyPctText: { color: '#10B981', fontSize: 11, fontWeight: '700' },
  occupancyTrack: { height: 6, backgroundColor: '#1E2030', borderRadius: 3, overflow: 'hidden' },
  occupancyFill: { height: '100%', backgroundColor: '#10B981', borderRadius: 3 },

  // ── DELIVERY INDICATOR ──
  deliveryIndicatorRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderColor: '#1E2030', marginTop: 4 },
  deliveryIndicatorText: { color: '#8B8FA8', fontSize: 11, flex: 1, marginLeft: 8 },
  floorMapLink: { color: '#6366F1', fontSize: 11, fontWeight: '600' },
  dotLive: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  dotGreen: { backgroundColor: '#10B981' },
  dotOrange: { backgroundColor: '#F59E0B' },

  // ── ACTIVE TABLE CHIPS ──
  activeTblList: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 6 },
  activeTblChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#141520', borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  dotOrangeSm: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#F59E0B', marginRight: 6 },
  activeTblChipText: { color: '#E8E9EF', fontSize: 11, fontWeight: '600', marginRight: 6 },
  activeTblChipAmt: { color: '#F59E0B', fontSize: 10, fontWeight: '700' },

  // ── BEST SELLERS ──
  bestSellerList: { backgroundColor: '#141520', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#1E2030' },
  bestSellerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderColor: '#1E2030' },
  rankBadge: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.2, justifyContent: 'center', alignItems: 'center', marginRight: 10, flexShrink: 0 },
  rankText: { fontSize: 9, fontWeight: '800' },
  bestSellerInfo: { flex: 1, marginRight: 8, minWidth: 0 },
  bestSellerName: { color: '#E8E9EF', fontSize: 12, fontWeight: '600' },
  bestSellerCategory: { color: '#6B6F85', fontSize: 9, marginTop: 1 },
  bestSellerMetrics: { alignItems: 'flex-end', flexShrink: 0 },
  qtyBadge: { backgroundColor: 'rgba(16,185,129,0.12)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginBottom: 2 },
  qtyBadgeText: { color: '#10B981', fontSize: 9, fontWeight: '700' },
  itemSalesAmount: { color: '#E8E9EF', fontSize: 12, fontWeight: '700' },

  // ── DEVICE CONTROL ──
  deviceChipsRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  deviceChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, marginRight: 6, marginBottom: 6 },
  deviceChipDot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  deviceChipLabel: { color: '#8B8FA8', fontSize: 10 },
  deviceChipValue: { fontSize: 10, fontWeight: '700' },
  pendingAlert: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(245,158,11,0.1)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)', borderRadius: 8, padding: 8, marginBottom: 10 },
  pendingAlertEmoji: { fontSize: 14, marginRight: 6 },
  pendingAlertText: { color: '#F59E0B', fontSize: 10, fontWeight: '600', flex: 1 },
  pendingAlertBtn: { backgroundColor: '#F59E0B', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  pendingAlertBtnText: { color: '#000', fontSize: 10, fontWeight: '700' },
  deviceMiniRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 0.8, borderColor: '#1E2030' },
  deviceMiniLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8, minWidth: 0 },
  deviceMiniEmoji: { fontSize: 14, marginRight: 8, flexShrink: 0 },
  deviceMiniName: { color: '#E8E9EF', fontSize: 11, fontWeight: '600' },
  deviceMiniRole: { color: '#6B6F85', fontSize: 9 },
  fullWidthBtn: { backgroundColor: '#141520', borderRadius: 8, borderWidth: 1, borderColor: '#2A2B38', paddingVertical: 11, alignItems: 'center', marginTop: 8 },
  fullWidthBtnText: { color: '#FFB703', fontSize: 11, fontWeight: '700' },

  // ── SYNC HEALTH ──
  syncStatusGrid: { flexDirection: 'row', marginBottom: 10 },
  syncStatusCell: { flex: 1 },
  syncStatusLabel: { color: '#6B6F85', fontSize: 10, marginBottom: 3 },
  syncStatusVal: { fontSize: 11, fontWeight: '700' },
  syncTimerBar: { backgroundColor: '#0A0B10', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12, borderWidth: 1, borderColor: '#1A1B24', alignItems: 'center' },
  syncTimerBarText: { color: '#6B6F85', fontSize: 9.5 },
  employeeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderColor: '#1E2030' },
  employeeRowEmoji: { fontSize: 14, marginRight: 8 },
  employeeRowText: { flex: 1, color: '#8B8FA8', fontSize: 11 },
  employeeRowArrow: { color: '#6366F1', fontSize: 13, fontWeight: '700' },

  // ── 3-METRIC EXECUTIVE ROW (Image 4) ──
  metricsRowCard: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#0E0F14', borderRadius: 14, borderWidth: 1, borderColor: '#1A1B24', marginHorizontal: 12, marginBottom: 12, paddingVertical: 14, paddingHorizontal: 16 },
  metricRowCol: { flex: 1, alignItems: 'center' },
  metricRowLabel: { color: '#6B6F85', fontSize: 11, fontWeight: '600', marginBottom: 4 },
  metricRowValue: { color: '#E8E9EF', fontSize: 16, fontWeight: '800' },

  // ── PAYMENT SEGMENTED BAR (Image 3) ──
  sectionHeaderTitle: { color: '#E8E9EF', fontSize: 14, fontWeight: '700', marginBottom: 12 },
  segmentedBarTrack: { height: 16, borderRadius: 8, flexDirection: 'row', overflow: 'hidden', backgroundColor: '#141520', marginBottom: 14 },
  segmentBar: { height: '100%' },
  paymentLegendGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  paymentLegendItem: { width: '48%', flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: 10, height: 10, borderRadius: 3, marginRight: 8 },
  legendLabel: { color: '#E8E9EF', fontSize: 12, fontWeight: '600', flex: 1 },
  legendVal: { color: '#E8E9EF', fontSize: 12, fontWeight: '700' },

  // ── TABLE VISUAL GRID (Image 1) ──
  tableHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  tableSummaryBadge: { color: '#8B8FA8', fontSize: 11, fontWeight: '600' },
  tableVisualGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  tableVisualCard: { width: '18.5%', aspectRatio: 0.9, borderRadius: 10, borderWidth: 1.2, justifyContent: 'center', alignItems: 'center', padding: 4 },
  tableVisualId: { fontSize: 13, fontWeight: '800', marginBottom: 2 },
  tableVisualSub: { fontSize: 9, fontWeight: '700' },
  tableBottomHint: { color: '#6B6F85', fontSize: 11, textAlign: 'center', marginTop: 12 },

  // ── TERMINAL LAST 7 DAYS (Image 2) ──
  terminalCard: { backgroundColor: '#0A0A0A', borderRadius: 12, borderWidth: 1, borderColor: '#2A2A2A', marginHorizontal: 12, marginBottom: 12, padding: 12 },
  terminalTitle: { color: '#E4E4E7', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 11, letterSpacing: -0.5 },
  terminalBody: { paddingVertical: 4 },
  terminalRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 2 },
  terminalDayName: { color: '#E4E4E7', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 11, width: 62 },
  terminalBarTrack: { flex: 1, height: 12, flexDirection: 'row', marginHorizontal: 6 },
  terminalBarFill: { height: '100%', backgroundColor: '#E4E4E7' },
  terminalBarHatch: { height: '100%', backgroundColor: '#27272A' },
  terminalVal: { color: '#E4E4E7', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 11, width: 46, textAlign: 'right' },
  terminalBadgeBest: { color: '#FBBF24', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10, fontWeight: 'bold', width: 58, textAlign: 'center' },
  terminalBadgeToday: { color: '#A1A1AA', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 9, width: 58, textAlign: 'center' },
  terminalRightPipe: { color: '#E4E4E7', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 11 },
  terminalRowSpace: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 2 },
  terminalBorderSide: { color: '#E4E4E7', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 11 },
  terminalFooterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  terminalFooterText: { color: '#E4E4E7', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10.5 },

  // ── REPORTS ──
  reportTile: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#141520', borderRadius: 10, padding: 11, borderWidth: 1, borderColor: '#1E2030', marginBottom: 8 },
  reportTileIcon: { width: 36, height: 36, borderRadius: 9, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  reportTileTitle: { color: '#E8E9EF', fontSize: 12, fontWeight: '700' },
  reportTileSub: { color: '#6B6F85', fontSize: 9.5, marginTop: 2 },
  reportTileArrow: { color: '#FFB703', fontSize: 14, fontWeight: 'bold', marginLeft: 8 },

  // ── VERSION CONTROL ──
  versionControlCard: { backgroundColor: '#141520', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#1E2030' },
  versionInfoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  versionInfoItem: { flex: 1, alignItems: 'center' },
  versionInfoLabel: { color: '#6B6F85', fontSize: 10, marginBottom: 4 },
  versionInfoValue: { color: '#E8E9EF', fontSize: 14, fontWeight: '700' },
  versionInfoSub: { color: '#6B6F85', fontSize: 10, marginTop: 2 },
  versionInfoDivider: { width: 1, height: 36, backgroundColor: '#1E2030', marginHorizontal: 10 },
  versionHelpText: { color: '#6B6F85', fontSize: 10.5, lineHeight: 16, marginBottom: 10, textAlign: 'center' },
  versionInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  versionInput: { flex: 1, backgroundColor: '#0E0F14', borderRadius: 8, borderWidth: 1, borderColor: '#2A2B38', color: '#E8E9EF', paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, fontWeight: '600' },
  versionAutoPickBtn: { backgroundColor: 'rgba(99,102,241,0.15)', borderWidth: 1, borderColor: 'rgba(99,102,241,0.4)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, justifyContent: 'center', alignItems: 'center' },
  versionAutoPickBtnText: { color: '#818CF8', fontSize: 11, fontWeight: '700' },
  versionSaveBtn: { backgroundColor: '#6366F1', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9, justifyContent: 'center', alignItems: 'center', minWidth: 70 },
  versionSaveBtnText: { color: '#FFF', fontSize: 12, fontWeight: '700' },

  // ── EMPTY STATE ──
  emptyState: { alignItems: 'center', paddingVertical: 20 },
  emptyStateEmoji: { fontSize: 28, marginBottom: 8 },
  emptyStateText: { color: '#8B8FA8', fontSize: 12, fontWeight: '600', marginBottom: 3 },
  emptyStateSub: { color: '#5A5E73', fontSize: 10, textAlign: 'center', paddingHorizontal: 20 },

  // ── TABLE GRID (in Floor Map modal) ──
  tableGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', width: '100%', paddingBottom: 10 },
  tableCard: { width: '23.5%', aspectRatio: 0.75, borderRadius: 14, padding: 8, alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, borderWidth: 1.5, backgroundColor: '#161616', elevation: 3 },
  tableBusyBorder: { borderColor: 'rgba(251,146,60,0.5)', backgroundColor: 'rgba(36,22,14,0.6)' },
  tableFreeBorder: { borderColor: 'rgba(52,211,153,0.4)' },
  tableId: { fontSize: 13, fontWeight: 'bold', color: '#FFF' },
  tableStatusRow: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 4 },
  tableStatusText: { fontSize: 8, fontWeight: 'bold' },
  textGreen: { color: '#34D399' },
  textOrange: { color: '#FB923C' },
  tableAmount: { fontSize: 9, color: '#FFF' },
  chairIcon: { fontSize: 14, opacity: 0.3 },

  // ── DELIVERY CARDS (in Floor Map modal) ──
  deliveryCard: { backgroundColor: '#0D0D0D', borderWidth: 1, borderColor: '#262626', borderRadius: 14, padding: 16 },
  deliveryTitle: { fontSize: 14, fontWeight: 'bold', color: '#FFF' },
  deliveryTime: { fontSize: 11, color: '#A1A1AA', marginVertical: 6 },
  deliveryAmount: { fontSize: 16, fontWeight: 'bold', color: '#FFB703' },

  // ── MODALS (ALL PRESERVED EXACTLY) ──
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#0D0D0D', borderWidth: 1, borderColor: '#FFB703', borderRadius: 20, padding: 16, width: '85%', alignItems: 'center' },
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
  menuModalContent: { backgroundColor: '#161616', borderRadius: 12, marginTop: 45, marginLeft: 16, width: 200, borderWidth: 1, borderColor: '#333', overflow: 'hidden' },
  menuOption: { paddingVertical: 9, paddingHorizontal: 14 },
  menuOptionText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  menuDivider: { height: 1, backgroundColor: '#262626' },
  menuSectionHeader: { backgroundColor: '#111', paddingVertical: 4, paddingHorizontal: 14, borderBottomWidth: 1, borderColor: '#262626' },
  menuSectionText: { color: '#555', fontSize: 9, fontWeight: 'bold', letterSpacing: 1 },
  sheetContainer: { width: '100%', backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#333', overflow: 'hidden', flexShrink: 1 },
  sheetHeader: { flexDirection: 'row', backgroundColor: '#222', paddingVertical: 10, paddingHorizontal: 10, borderBottomWidth: 1, borderColor: '#444' },
  sheetHeaderText: { color: '#FFB703', fontSize: 10, fontWeight: 'bold', textAlign: 'center' },
  sheetBody: { maxHeight: 300 },
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
  renameInputWrapper: { width: '100%', backgroundColor: '#161616', borderWidth: 1, borderColor: '#262626', borderRadius: 12, height: 50, paddingHorizontal: 16, justifyContent: 'center', marginBottom: 20 },
  renameInput: { color: '#FFFFFF', fontSize: 15 },
  expenseInputGroup: { width: '100%', marginBottom: 12 },
  inputLabel: { color: '#888', fontSize: 11, marginBottom: 6, fontWeight: 'bold' },
  emptySheetText: { color: '#888', textAlign: 'center', padding: 20, fontSize: 12 },
  manualBadge: { backgroundColor: 'rgba(255,183,3,0.2)', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, marginLeft: 4 },
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

  // ── STATUS BADGES (used in modals) ──
  statusBadgeSmall: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 0.8, flexShrink: 0 },
  statusBadgeGreen: { backgroundColor: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.3)' },
  statusBadgeAmber: { backgroundColor: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.3)' },
  statusBadgeRed:   { backgroundColor: 'rgba(239,68,68,0.12)',  borderColor: 'rgba(239,68,68,0.3)' },
  statusBadgeTextSmall: { fontSize: 9, fontWeight: '700' },
  textAmber: { color: '#F59E0B' },
  textRed: { color: '#EF4444' },
});

