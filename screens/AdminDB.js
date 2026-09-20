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
import { formatDisplayDate, getBusinessDate, inspectDatabaseStats, executeInspectorQuery, getFirebaseUsageStats, verifyPinCode, deleteDataByDate, getItemSalesReport, getDb } from '../database';
import { getAllRegisteredDevices, getCurrentDeviceRecord } from '../services/deviceRegistry';
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

const toBengaliNumber = (num) => {
  if (num === null || num === undefined) return '';
  const bengaliDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return String(num).replace(/\d/g, d => bengaliDigits[parseInt(d, 10)]);
};

// --- DYNAMIC CIRCULAR COUNTDOWN RING (Smooth 360 to 0 Progress) ---
const CircularCountdownRing = ({ ratio, color, trackColor = '#242424', size = 72, strokeWidth = 5, children }) => {
  const percent = Math.max(0, Math.min(1, ratio || 0));
  const halfSize = size / 2;
  const rightRatio = Math.min(percent, 0.5) / 0.5;
  const rightAngle = -135 + rightRatio * 180;
  const leftRatio = Math.max(0, percent - 0.5) / 0.5;
  const leftAngle = -135 + leftRatio * 180;

  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center', position: 'relative' }}>
      {/* Background Track Circle */}
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: halfSize,
          borderWidth: strokeWidth,
          borderColor: trackColor,
        }}
      />
      {/* Right Half Container (0 to 180 deg) */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: halfSize,
          height: size,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: size,
            height: size,
            borderRadius: halfSize,
            borderWidth: strokeWidth,
            borderColor: color,
            borderBottomColor: 'transparent',
            borderLeftColor: 'transparent',
            transform: [{ rotate: `${rightAngle}deg` }],
          }}
        />
      </View>
      {/* Left Half Container (180 to 360 deg) */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: halfSize,
          height: size,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: size,
            height: size,
            borderRadius: halfSize,
            borderWidth: strokeWidth,
            borderColor: color,
            borderTopColor: 'transparent',
            borderRightColor: 'transparent',
            transform: [{ rotate: `${leftAngle}deg` }],
          }}
        />
      </View>
      {/* Center Upright Content (Number and Unit) */}
      <View
        style={{
          position: 'absolute',
          width: size - strokeWidth * 2 - 2,
          height: size - strokeWidth * 2 - 2,
          borderRadius: (size - strokeWidth * 2 - 2) / 2,
          backgroundColor: '#141414',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {children}
      </View>
    </View>
  );
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
  const [tableFilter, setTableFilter] = useState('ALL');

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
  const dayNamesShortBn = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহ', 'শুক্র', 'শনি'];
  const last7DaysData = [];
  let max7DaySale = 1;

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const dateKey = `${yyyy}-${mm}-${dd}`;
    const shortDate = `${parseInt(dd, 10)}/${parseInt(mm, 10)}`;
    const isToday = (i === 0);
    const dayName = isToday ? 'আজ' : dayNamesShortBn[d.getDay()];

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
    last7DaysData.push({ dayName, shortDate, dateKey, sales, isToday });
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

  // Table status and order amount helpers
  const getTableAmount = (t) => {
    if (!t || !t.items) return 0;
    return t.items.reduce((sum, item) => sum + ((parseFloat(item.price) || 0) * (parseInt(item.qty, 10) || 1)), 0);
  };

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
  const activeDeliveriesList = deliveries.filter(d => d.status === 'BUSY');

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
    console.error("[AdminDB] Error fetching top selling items:", err);
  }

  // POS Device Control & Security Metrics (Prioritized by Activity: most recent first, late devices last)
  let registeredDevices = [];
  try {
    registeredDevices = getAllRegisteredDevices() || [];
  } catch (err) {
    console.error("[AdminDB] Error fetching devices:", err);
  }

  let currentDeviceRecord = null;
  try {
    currentDeviceRecord = getCurrentDeviceRecord();
  } catch (err) {}

  const getDeviceRecency = (dev) => {
    if (!dev) return 0;
    const val = dev.last_seen || dev.updated_at || dev.created_at;
    if (!val) return 0;
    const t = new Date(val).getTime();
    return isNaN(t) ? 0 : t;
  };

  const isDeviceOnline = (dev) => {
    if (currentDeviceRecord && (dev.device_id === currentDeviceRecord.device_id || dev.id === currentDeviceRecord.id)) {
      return true;
    }
    const ts = dev?.last_seen || dev?.updated_at;
    if (!ts) return false;
    const diffMs = Date.now() - new Date(ts).getTime();
    return diffMs < 5 * 60000;
  };

  // Sort: highest recency timestamp first, oldest/late devices at the bottom ("je late se ses e")
  const sortedDevices = [...registeredDevices].sort((a, b) => {
    return getDeviceRecency(b) - getDeviceRecency(a);
  });

  const approvedDevicesCount = registeredDevices.filter(d => d.status === 'ACTIVE' || d.status === 'APPROVED').length;
  const pendingDevicesCount = registeredDevices.filter(d => d.status === 'PENDING').length;
  const blockedDevicesCount = registeredDevices.filter(d => d.status === 'BLOCKED').length;
  const onlineDevicesCount = registeredDevices.filter(d => isDeviceOnline(d)).length;

  const formatDeviceLastSeenText = (dev) => {
    if (currentDeviceRecord && (dev.device_id === currentDeviceRecord.device_id || dev.id === currentDeviceRecord.id)) {
      return 'এখন অনলাইনে (এই ডিভাইস)';
    }
    const ts = dev?.last_seen || dev?.updated_at;
    if (!ts) return 'অফলাইন';
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return ts;
      const diffMs = Date.now() - d.getTime();
      const diffMinutes = Math.floor(diffMs / 60000);
      if (diffMinutes < 5) return 'এখন অনলাইনে';
      if (diffMinutes < 60) return `${toBengaliNumber(diffMinutes)} মিনিট আগে`;
      if (diffMinutes < 1440) {
        let hours = d.getHours();
        let minutes = d.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        minutes = minutes < 10 ? '0' + minutes : minutes;
        return `আজ ${toBengaliNumber(hours)}:${toBengaliNumber(minutes)} ${ampm}`;
      }
      return formatDisplayDate(d);
    } catch (e) {
      return 'অফলাইন';
    }
  };

  // Only active (online) devices shown on the dashboard per user request
  const activeDevices = sortedDevices.filter(dev => 
    isDeviceOnline(dev) && dev.status !== 'BLOCKED'
  );

  // Live Sync Queue Status
  let pendingSyncCount = 0;
  try {
    const db = getDb();
    const row = db?.getFirstSync("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING' OR status = 'FAILED'");
    pendingSyncCount = row?.count || 0;
  } catch (err) {}

  // Dynamic Real-time Sync Timer Ratios (0.0 to 1.0) for live countdown rings & bars
  const delRatio = Math.max(0, Math.min(1, (delCountdown || 0) / 90));
  const tabRatio = Math.max(0, Math.min(1, (tabCountdown || 0) / 15));
  const fullRatio = Math.max(0, Math.min(1, (fullCountdown || 0) / 30));

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
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: keyboardHeight > 0 ? keyboardHeight + 80 : 90, paddingTop: 10 }}
      >

        {/* Horizontal Stats Row: Today's Sales and Monthly Total (Restored from Backup) */}
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          style={styles.statsScroll}
          contentContainerStyle={styles.statsContainer}
        >
          <TodaySalesCard
            todaySale={todaySale}
            bkashSale={bkashSale}
            nagadSale={nagadSale}
            rocketSale={rocketSale}
            totalDoneCount={totalDoneCount}
          />
          <MonthlyTotalCard
            monthlyTotalSell={monthlyTotalSell}
          />
        </ScrollView>

        {/* ── টাকা কোন পথে এল (Image 3) ── */}
        <View style={styles.card}>
          <Text style={styles.sectionHeaderTitle}>টাকা কোন পথে এল</Text>
          {/* Segmented multi-color horizontal bar */}
          <View style={styles.segmentedBarTrack}>
            {cashPct > 0 && <View style={[styles.segmentBar, { width: `${cashPct}%`, backgroundColor: '#10B981' }]} />}
            {bkashPct > 0 && <View style={[styles.segmentBar, { width: `${bkashPct}%`, backgroundColor: '#E11D48' }]} />}
            {nagadPct > 0 && <View style={[styles.segmentBar, { width: `${nagadPct}%`, backgroundColor: '#F97316' }]} />}
            {rocketPct > 0 && <View style={[styles.segmentBar, { width: `${rocketPct}%`, backgroundColor: '#8B5CF6' }]} />}
            {duePct > 0 && <View style={[styles.segmentBar, { width: `${duePct}%`, backgroundColor: '#64748B' }]} />}
          </View>
          {/* Breakdown legend */}
          <View style={styles.paymentLegendGrid}>
            <View style={styles.paymentLegendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
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
                <View style={[styles.legendDot, { backgroundColor: '#64748B' }]} />
                <Text style={styles.legendLabel}>বাকি</Text>
                <Text style={styles.legendVal}>৳{dueSale.toLocaleString()}</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── গত ৭ দিনের বিক্রয় (Last 7 Days Sales — Vertical Bar Chart matching reference image) ── */}
        <View style={styles.chartCard}>
          {/* Header Row */}
          <View style={styles.chartHeaderRow}>
            <View>
              <Text style={styles.chartCardTitle}>গত ৭ দিনের বিক্রয়</Text>
              <Text style={styles.chartCardSubtitle}>আজ: ৳{(todaySale || 0).toLocaleString()}</Text>
            </View>
            <View style={styles.chartHighestBadge}>
              <Text style={styles.chartHighestBadgeText}>
                সর্বোচ্চ ৳{highest7DaySale >= 1000 ? (highest7DaySale / 1000).toFixed(1) + 'k' : highest7DaySale}
              </Text>
            </View>
          </View>

          {/* Vertical Bar Chart Container */}
          <View style={styles.chartBarsRow}>
            {last7DaysData.map(item => {
              const barHeight = Math.max(16, Math.round((item.sales / (max7DaySale || 1)) * 105));
              const isBest = item.dateKey === bestDayKey && item.sales > 0 && !item.isToday;
              const kVal = (item.sales >= 1000)
                ? (item.sales / 1000).toFixed(1) + 'k'
                : (item.sales > 0 ? item.sales.toString() : '0');

              const barColor = item.isToday ? '#4BDD7F' : (isBest ? '#9B702C' : '#575298');

              return (
                <View key={item.dateKey} style={styles.chartCol}>
                  <View style={styles.chartBarCol}>
                    <Text style={[styles.chartBarValueText, item.isToday && styles.chartBarValueTextToday]}>
                      {kVal}
                    </Text>
                    <View style={[styles.chartBarFill, { height: barHeight, backgroundColor: barColor }]} />
                  </View>

                  <Text style={[styles.chartDayText, item.isToday && styles.chartDayTextToday]}>
                    {item.dayName}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* ── টেবিল ও সক্রিয় ডেলিভারি (Combined Table & Active Delivery Section) ── */}
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
                  activeOpacity={isBusy ? 0.7 : 0.9}
                  onPress={() => {
                    if (isBusy) {
                      onTableSelect(t.id);
                    } else {
                      Alert.alert(
                        "অ্যাডমিন এক্সেস",
                        "অ্যাডমিন শুধুমাত্র মনিটর ও ম্যানেজ করতে পারেন। নতুন অর্ডার তৈরি করার অনুমতি নেই।"
                      );
                    }
                  }}
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

                  {/* Amount Row (Formatted for busy, transparent for free to satisfy TC-02) */}
                  <Text style={[styles.tableCardAmount, { color: isBusy ? '#F59E0B' : 'transparent' }]} numberOfLines={1}>
                    {isBusy ? `৳${tblAmt.toLocaleString()}` : '-'}
                  </Text>

                  {/* Chair Icon */}
                  <Text style={styles.tableCardChairIcon}>🪑</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Bottom Hint */}
          <Text style={styles.tableBottomHint}>চলমান টেবিলে চাপ দিলে বিস্তারিত</Text>

          {/* ───── সক্রিয় ডেলিভারি ───── Divider Inside the Same Card */}
          <View style={styles.deliveryDividerContainer}>
            <View style={styles.deliveryDividerLine} />
            {/* ───── সক্রিয় ডেলিভারি ───── */}
          </View>

          {/* Active Delivery Section Header */}
          <View style={styles.activeDeliverySectionHeaderRow}>
            <Text style={styles.activeDeliverySectionTitle}>সক্রিয় ডেলিভারি</Text>
            <View style={styles.activeDeliveryCountBadge}>
              <Text style={styles.activeDeliveryCountBadgeText}>{activeDeliveriesList.length} টি</Text>
            </View>
          </View>

          {/* Active Deliveries List inside Same Card */}
          {activeDeliveriesList.length > 0 ? (
            activeDeliveriesList.map(delivery => {
              const delAmt = delivery.items ? delivery.items.reduce((s, i) => s + ((parseFloat(i.price) || 0) * (parseInt(i.qty, 10) || 1)), 0) : 0;
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
            <View style={styles.emptyDeliveryBox}>
              <Text style={styles.emptyDeliveryEmoji}>🛵</Text>
              <Text style={styles.emptyDeliveryText}>বর্তমানে কোনো সক্রিয় ডেলিভারি নেই</Text>
            </View>
          )}
        </View>
        {/* ── SECTION 3: শীর্ষ বিক্রিত খাবার (Top Selling Food Redesign) ── */}
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
              {/* #1 Top Item Hero Banner (Amber/Gold Card) - NO food emoji */}
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

              {/* Items #2 to #5 Ranked List - NO food emojis */}
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
                            ৳ {toBengaliNumber((item.totalSales || 0).toLocaleString())}
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

        {/* ── SECTION 4: ডিভাইস ও পস কন্ট্রোল (Redesigned matching mockup) ── */}
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.deviceCardHeader}>
            <Text style={styles.deviceSectionTitle}>ডিভাইস ও পস কন্ট্রোল</Text>
            <Text style={styles.deviceSectionSubtitle}>রেজিস্টার্ড পিওএস সিকিউরিটি</Text>
          </View>

          {/* Teal Hero Status Banner Card */}
          <View style={styles.deviceHeroBanner}>
            {/* Top row: Circular Gauge (Left) & Status Header (Right) */}
            <View style={styles.deviceHeroTopRow}>
              {/* Circular Gauge */}
              <View style={styles.deviceGaugeContainer}>
                <View style={styles.deviceGaugeRing}>
                  <Text style={styles.deviceGaugeNumber}>
                    {toBengaliNumber(approvedDevicesCount)}
                  </Text>
                  <Text style={styles.deviceGaugeLabel}>অনুমোদিত</Text>
                </View>
              </View>

              {/* Status Header */}
              <View style={styles.deviceHeroStatusCol}>
                <View style={styles.deviceSecurityPill}>
                  <View style={styles.deviceSecurityPillDot} />
                  <Text style={styles.deviceSecurityPillText}>সিকিউরিটি সক্রিয়</Text>
                </View>
                <Text style={styles.deviceHeroHeadline}>
                  {pendingDevicesCount > 0
                    ? `${toBengaliNumber(pendingDevicesCount)}টি ডিভাইস পেন্ডিং`
                    : 'সব ডিভাইস নিরাপদ'}
                </Text>
                <Text style={styles.deviceHeroSubhead}>
                  {toBengaliNumber(approvedDevicesCount)}টি ডিভাইস অনুমোদিত ও সুরক্ষিত
                </Text>
              </View>
            </View>

            {/* Bottom 3 Metric Sub-Tiles */}
            <View style={styles.deviceHeroTilesRow}>
              <View style={styles.deviceHeroTile}>
                <Text style={styles.deviceHeroTileEmoji}>🛡️</Text>
                <Text style={styles.deviceHeroTileNumber}>{toBengaliNumber(approvedDevicesCount)}</Text>
                <Text style={styles.deviceHeroTileLabel}>অনুমোদিত</Text>
              </View>
              <View style={styles.deviceHeroTile}>
                <Text style={styles.deviceHeroTileEmoji}>⏱️</Text>
                <Text style={styles.deviceHeroTileNumber}>{toBengaliNumber(pendingDevicesCount)}</Text>
                <Text style={styles.deviceHeroTileLabel}>অপেক্ষায়</Text>
              </View>
              <View style={styles.deviceHeroTile}>
                <Text style={styles.deviceHeroTileEmoji}>📶</Text>
                <Text style={styles.deviceHeroTileNumber}>{toBengaliNumber(onlineDevicesCount)}</Text>
                <Text style={styles.deviceHeroTileLabel}>অনলাইন</Text>
              </View>
            </View>
          </View>

          {/* Status Alert Banner */}
          {pendingDevicesCount > 0 ? (
            <TouchableOpacity
              style={[styles.deviceAlertBanner, styles.deviceAlertBannerAmber]}
              onPress={onNavigateToDeviceManagement}
              activeOpacity={0.8}
            >
              <View style={[styles.deviceAlertCircle, { backgroundColor: '#F59E0B' }]}>
                <Text style={styles.deviceAlertCircleIcon}>!</Text>
              </View>
              <Text style={[styles.deviceAlertText, { color: '#F59E0B' }]}>
                {toBengaliNumber(pendingDevicesCount)}টি নতুন ডিভাইস অ্যাডমিন অনুমোদনের অপেক্ষায়!
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={[styles.deviceAlertBanner, styles.deviceAlertBannerGreen]}>
              <View style={[styles.deviceAlertCircle, { backgroundColor: '#10B981' }]}>
                <Text style={styles.deviceAlertCircleIcon}>✓</Text>
              </View>
              <Text style={[styles.deviceAlertText, { color: '#10B981' }]}>
                সব ঠিক আছে — কোনো নতুন ডিভাইস অনুমোদনের অপেক্ষায় নেই
              </Text>
            </View>
          )}

          {/* Active Devices Subtitle / Hint */}
          <View style={styles.deviceActiveHeaderRow}>
            <Text style={styles.deviceTapHint}>কার্ডে ট্যাপ করলে আরও কন্ট্রোল দেখা যাবে</Text>
            <View style={styles.deviceActiveCountPill}>
              <View style={styles.deviceActiveDot} />
              <Text style={styles.deviceActiveCountText}>
                {toBengaliNumber(activeDevices.length)}টি সক্রিয়
              </Text>
            </View>
          </View>

          {/* Active Device Items List (Only active/online devices shown) */}
          {activeDevices.length === 0 ? (
            <View style={styles.deviceEmptyBox}>
              <Text style={styles.deviceEmptyEmoji}>📵</Text>
              <Text style={styles.deviceEmptyText}>বর্তমানে কোনো সক্রিয় ডিভাইস নেই</Text>
            </View>
          ) : (
            activeDevices.slice(0, 4).map(dev => {
              const isOnline = isDeviceOnline(dev);
              const initial = (dev.device_name || dev.model || 'P').trim().charAt(0).toUpperCase();
              return (
                <TouchableOpacity
                  key={dev.id || dev.device_id}
                  style={styles.deviceItemCard}
                  onPress={onNavigateToDeviceManagement}
                  activeOpacity={0.75}
                >
                  {/* Left Avatar with Online Dot Badge */}
                  <View style={styles.deviceAvatarContainer}>
                    <View style={styles.deviceAvatarBox}>
                      <Text style={styles.deviceAvatarLetter}>{initial}</Text>
                    </View>
                    <View style={[styles.deviceOnlineDot, { backgroundColor: isOnline ? '#10B981' : '#4B5563' }]} />
                  </View>

                  {/* Middle Info */}
                  <View style={styles.deviceInfoCol}>
                    <Text style={styles.deviceItemTitle} numberOfLines={1}>
                      {dev.device_name || dev.model || 'POS Terminal'}
                    </Text>
                    <View style={styles.deviceMetaRow}>
                      <View style={styles.deviceRoleBadge}>
                        <Text style={styles.deviceRoleBadgeText}>{dev.role || 'Cashier'}</Text>
                      </View>
                      <Text style={[styles.deviceStatusText, { color: isOnline ? '#10B981' : '#8B8FA8' }]}>
                        {isOnline ? '● এখন অনলাইনে' : `● ${formatDeviceLastSeenText(dev)}`}
                      </Text>
                    </View>
                  </View>

                  {/* Right Chevron */}
                  <Text style={styles.deviceChevron}>›</Text>
                </TouchableOpacity>
              );
            })
          )}

          {/* Centered Link */}
          <TouchableOpacity
            style={styles.deviceViewAllLink}
            onPress={onNavigateToDeviceManagement}
            activeOpacity={0.7}
          >
            <Text style={styles.deviceViewAllText}>
              সব {toBengaliNumber(registeredDevices.length)}টি ডিভাইস দেখুন ›
            </Text>
          </TouchableOpacity>

          {/* Primary Bottom Button */}
          <TouchableOpacity
            style={styles.devicePrimaryBtn}
            onPress={onNavigateToDeviceManagement}
            activeOpacity={0.85}
          >
            <Text style={styles.devicePrimaryBtnIcon}>🔒</Text>
            <Text style={styles.devicePrimaryBtnText}>ডিভাইস ম্যানেজমেন্ট ও সিকিউরিটি</Text>
          </TouchableOpacity>
        </View>

        {/* ── SECTION 5: ক্লাউড সিঙ্ক ও সিস্টেম হেলথ (Redesigned with Real App Sync) ── */}
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.syncCardHeader}>
            <View style={styles.syncHeaderLeft}>
              <Text style={styles.syncSectionTitle}>ক্লাউড সিঙ্ক ও হেলথ</Text>
              <Text style={styles.syncSectionSubtitle}>ডাটাবেজ সিঙ্ক স্থিতি</Text>
            </View>
            <TouchableOpacity
              style={styles.syncDiagLink}
              onPress={onNavigateToSyncDiagnostics}
              activeOpacity={0.7}
            >
              <Text style={styles.syncDiagLinkText}>⚡ ডায়াগনস্টিকস</Text>
            </TouchableOpacity>
          </View>

          {/* Deep Indigo / Royal Blue Hero Card */}
          <View style={styles.syncHeroBanner}>
            {/* Top Status Row */}
            <View style={styles.syncHeroTopRow}>
              <View style={styles.syncHeroIconBox}>
                <Text style={styles.syncHeroIconEmoji}>🔄</Text>
              </View>
              <View style={styles.syncHeroTitleCol}>
                <Text style={styles.syncHeroTitle}>
                  {pendingSyncCount > 0 ? 'ডাটা সিঙ্ক হচ্ছে...' : 'সিস্টেম সুস্থ আছে'}
                </Text>
                <Text style={styles.syncHeroSubtitle}>
                  {pendingSyncCount > 0
                    ? `${toBengaliNumber(pendingSyncCount)}টি ডাটা ক্লাউডে পাঠানো হচ্ছে`
                    : 'লোকাল ও ক্লাউড ডাটাবেজ সিঙ্কে আছে'}
                </Text>
              </View>
            </View>

            {/* Tile 1: SQLite Local Database */}
            <View style={styles.syncTile}>
              <View style={styles.syncTileIconWrap}>
                <Text style={styles.syncTileIconEmoji}>🗄️</Text>
              </View>
              <View style={styles.syncTileMidCol}>
                <Text style={styles.syncTileLabel}>SQLite লোকাল ডাটাবেজ</Text>
                <View style={styles.syncTileStatusRow}>
                  <View style={[styles.syncStatusDot, { backgroundColor: '#2DD4BF' }]} />
                  <Text style={styles.syncTileStatusText}>সক্রিয় ও সুরক্ষিত</Text>
                </View>
              </View>
              <View style={[styles.syncCheckCircle, { backgroundColor: '#10B981' }]}>
                <Text style={styles.syncCheckMark}>✓</Text>
              </View>
            </View>

            {/* Tile 2: Cloud Sync Queue */}
            <View style={styles.syncTile}>
              <View style={styles.syncTileIconWrap}>
                <Text style={styles.syncTileIconEmoji}>☁️</Text>
              </View>
              <View style={styles.syncTileMidCol}>
                <Text style={styles.syncTileLabel}>ক্লাউড সিঙ্ক কিউ</Text>
                <View style={styles.syncTileStatusRow}>
                  <View style={[styles.syncStatusDot, { backgroundColor: pendingSyncCount > 0 ? '#F59E0B' : '#10B981' }]} />
                  <Text style={[styles.syncTileStatusText, pendingSyncCount > 0 && { color: '#F59E0B' }]}>
                    {pendingSyncCount === 0 ? 'সব ডাটা সিঙ্কড' : `${toBengaliNumber(pendingSyncCount)}টি অপেক্ষমান`}
                  </Text>
                </View>
              </View>
              {pendingSyncCount === 0 ? (
                <View style={[styles.syncCheckCircle, { backgroundColor: '#10B981' }]}>
                  <Text style={styles.syncCheckMark}>✓</Text>
                </View>
              ) : (
                <View style={[styles.syncCheckCircle, { backgroundColor: '#F59E0B' }]}>
                  <Text style={[styles.syncCheckMark, { color: '#000' }]}>!</Text>
                </View>
              )}
            </View>
          </View>

          {/* Bottom Card: Auto-Sync Timers (Real App Timers) */}
          <View style={styles.syncTimersCard}>
            <View style={styles.syncTimersHeaderRow}>
              <Text style={styles.syncTimersHeaderIcon}>⏱️</Text>
              <Text style={styles.syncTimersTitle}>অটো-সিঙ্ক টাইমার</Text>
              <View style={styles.syncActivePill}>
                <Text style={styles.syncActivePillText}>লাইভ</Text>
              </View>
            </View>

            {/* 3 Circular Countdown Gauge Rings (Real system timers with live dynamic rings) */}
            <View style={styles.syncRingsRow}>
              {/* Delivery Timer (Real App Interval: 90s) */}
              <View style={styles.syncRingCol}>
                <CircularCountdownRing ratio={delRatio} color="#FFB703" size={72} strokeWidth={5}>
                  <Text style={styles.syncRingNumber}>{toBengaliNumber(delCountdown)}</Text>
                  <Text style={styles.syncRingUnit}>সেকেন্ড</Text>
                </CircularCountdownRing>
                <Text style={styles.syncRingName}>ডেলিভারি</Text>
                <Text style={styles.syncRingCycle}>প্রতি ৯০ সে.</Text>
                {/* Dynamic Live Progress Bar */}
                <View style={styles.syncMiniTrack}>
                  <View style={[styles.syncMiniFill, { width: `${Math.round(delRatio * 100)}%`, backgroundColor: '#FFB703' }]} />
                </View>
              </View>

              {/* Table Timer (Real App Interval: 15s) */}
              <View style={styles.syncRingCol}>
                <CircularCountdownRing ratio={tabRatio} color="#10B981" size={72} strokeWidth={5}>
                  <Text style={styles.syncRingNumber}>{toBengaliNumber(tabCountdown)}</Text>
                  <Text style={styles.syncRingUnit}>সেকেন্ড</Text>
                </CircularCountdownRing>
                <Text style={styles.syncRingName}>টেবিল</Text>
                <Text style={styles.syncRingCycle}>প্রতি ১৫ সে.</Text>
                {/* Dynamic Live Progress Bar */}
                <View style={styles.syncMiniTrack}>
                  <View style={[styles.syncMiniFill, { width: `${Math.round(tabRatio * 100)}%`, backgroundColor: '#10B981' }]} />
                </View>
              </View>

              {/* Full Sync Timer (Real App Interval: 30s) */}
              <View style={styles.syncRingCol}>
                <CircularCountdownRing ratio={fullRatio} color="#3B82F6" size={72} strokeWidth={5}>
                  <Text style={styles.syncRingNumber}>{toBengaliNumber(fullCountdown)}</Text>
                  <Text style={styles.syncRingUnit}>সেকেন্ড</Text>
                </CircularCountdownRing>
                <Text style={styles.syncRingName}>ফুল সিঙ্ক</Text>
                <Text style={styles.syncRingCycle}>প্রতি ৩০ সে.</Text>
                {/* Dynamic Live Progress Bar */}
                <View style={styles.syncMiniTrack}>
                  <View style={[styles.syncMiniFill, { width: `${Math.round(fullRatio * 100)}%`, backgroundColor: '#3B82F6' }]} />
                </View>
              </View>
            </View>

            {/* Background System Sync Engine Info Strip */}
            <View style={styles.syncEngineStrip}>
              <View style={styles.syncEngineItem}>
                <Text style={styles.syncEngineDot}>⚡</Text>
                <Text style={styles.syncEngineText}>পুশ ইঞ্জিন: প্রতি ৫ সে.</Text>
              </View>
              <View style={styles.syncEngineDivider} />
              <View style={styles.syncEngineItem}>
                <Text style={styles.syncEngineDot}>📦</Text>
                <Text style={styles.syncEngineText}>হিসাব সিঙ্ক: প্রতি ৩ মি.</Text>
              </View>
            </View>
          </View>
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

          {/* Hero Gradient Card */}
          {(() => {
            const liveVer = (Application.applicationId === 'host.exp.exponent' || Application.nativeApplicationVersion?.startsWith('56.')) ? APP_VERSION : (Application.nativeApplicationVersion || APP_VERSION);
            const buildNum = Application.nativeBuildVersion || '441';
            const isUpToDate = firebaseMinVersion !== null ? compareSemver(liveVer, firebaseMinVersion) >= 0 : true;

            return (
              <View style={styles.versionHeroCard}>
                {/* Top Row: Running APK Label + Status Pill */}
                <View style={styles.versionHeroTopRow}>
                  <View style={styles.versionHeroLabelWrap}>
                    <Text style={styles.versionHeroPhoneIcon}>📱</Text>
                    <Text style={styles.versionHeroLabel}>রানিং APK ভার্সন</Text>
                  </View>
                  <View style={[styles.versionStatusPill, isUpToDate ? styles.versionPillGreen : styles.versionPillRed]}>
                    <Text style={[styles.versionStatusPillText, isUpToDate ? styles.versionPillTextGreen : styles.versionPillTextRed]}>
                      {isUpToDate ? '✓ আপ-টু-ডেট' : '✕ পুরনো'}
                    </Text>
                  </View>
                </View>

                {/* Big Version Display with Build Badge */}
                <View style={styles.versionBigRow}>
                  <Text style={styles.versionPrefixV}>v</Text>
                  <Text style={styles.versionBigNumber}>{liveVer}</Text>
                  <View style={styles.versionBuildBadge}>
                    <Text style={styles.versionBuildText}>Build {buildNum}</Text>
                  </View>
                </View>

                {/* Dashed Divider */}
                <View style={styles.versionDashedDivider} />

                {/* Comparison Graphic: Running APK <---[✓]---> Firebase Min */}
                <View style={styles.versionCompareRow}>
                  {/* Left: Running APK */}
                  <View style={styles.versionCompareCol}>
                    <View style={styles.versionIconBox}>
                      <Text style={styles.versionBoxIcon}>📱</Text>
                    </View>
                    <Text style={styles.versionCompareLabel}>রানিং APK</Text>
                    <Text style={styles.versionCompareVal}>{liveVer}</Text>
                  </View>

                  {/* Middle Connector with Checkmark Circle */}
                  <View style={styles.versionConnectorWrap}>
                    <View style={styles.versionConnectorLine}>
                      <View style={styles.versionConnectorGlow} />
                    </View>
                    <View style={[styles.versionCenterCircle, { backgroundColor: isUpToDate ? '#10B981' : '#EF4444' }]}>
                      <Text style={styles.versionCenterCheck}>✓</Text>
                    </View>
                  </View>

                  {/* Right: Firebase Min */}
                  <View style={styles.versionCompareCol}>
                    <View style={styles.versionIconBox}>
                      <Text style={styles.versionBoxIcon}>☁️</Text>
                      <TouchableOpacity
                        style={styles.versionRefreshBadge}
                        onPress={loadFirebaseVersion}
                        disabled={isLoadingVersion}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={styles.versionRefreshIcon}>{isLoadingVersion ? '⏳' : '🔄'}</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.versionCompareLabel}>Firebase নিউনতম</Text>
                    {isLoadingVersion ? (
                      <ActivityIndicator size="small" color="#A78BFA" style={{ marginTop: 2 }} />
                    ) : versionFetchError ? (
                      <TouchableOpacity onPress={loadFirebaseVersion} activeOpacity={0.7}>
                        <Text style={[styles.versionCompareVal, { color: '#F59E0B', fontSize: 11 }]}>⚠️ এরর</Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.versionCompareVal}>{firebaseMinVersion || '—'}</Text>
                    )}
                  </View>
                </View>
              </View>
            );
          })()}

          {/* Input & Action Section */}
          <View style={styles.versionInputSection}>
            {/* Header: Label + Auto Pick Button */}
            <View style={styles.versionInputHeaderRow}>
              <Text style={styles.versionInputSectionTitle}>নতুন ভার্সন দিন</Text>
              {(() => {
                const liveVer = (Application.applicationId === 'host.exp.exponent' || Application.nativeApplicationVersion?.startsWith('56.')) ? APP_VERSION : (Application.nativeApplicationVersion || APP_VERSION);
                return (
                  <TouchableOpacity
                    style={styles.versionAutoPickPill}
                    onPress={() => setVersionInput(liveVer)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.versionAutoPickIcon}>🔄</Text>
                    <Text style={styles.versionAutoPickPillText}>অটো পিক {liveVer}</Text>
                  </TouchableOpacity>
                );
              })()}
            </View>

            {/* Big Version Input Field */}
            <View style={styles.versionBigInputBox}>
              <Text style={styles.versionInputPrefixV}>v</Text>
              <TextInput
                style={styles.versionBigTextInput}
                value={versionInput}
                onChangeText={setVersionInput}
                onFocus={() => {
                  setTimeout(() => {
                    mainScrollRef.current?.scrollToEnd({ animated: true });
                  }, 200);
                }}
                placeholder="যেমন: 1.0.3"
                placeholderTextColor="#4B5563"
                keyboardType="decimal-pad"
                autoCapitalize="none"
              />
            </View>

            {/* Warning Note */}
            <View style={styles.versionWarningRow}>
              <Text style={styles.versionWarningIcon}>⚠️</Text>
              <Text style={styles.versionWarningText}>
                নতুন APK বের করার পর এখানে সেই ভার্সন দিন। পুরনো ভার্সনের ডিভাইস <Text style={styles.versionForceLogoutHighlight}>Force Logout</Text>-এর পর login করতে পারবে না।
              </Text>
            </View>

            {/* Full-Width Primary Update Button */}
            <TouchableOpacity
              style={[styles.versionFullUpdateBtn, (isSavingVersion || isLoadingVersion) && { opacity: 0.6 }]}
              disabled={isSavingVersion || isLoadingVersion}
              onPress={handleInitiateVersionUpdate}
              activeOpacity={0.85}
            >
              {isSavingVersion ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <View style={styles.versionUpdateBtnContent}>
                  <Text style={styles.versionUpdateBtnIcon}>⤓</Text>
                  <Text style={styles.versionUpdateBtnText}>আপডেট করুন</Text>
                </View>
              )}
            </TouchableOpacity>
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
                        if (isBusy) {
                          setFloorModalVisible(false);
                          onTableSelect(table.id);
                        } else {
                          Alert.alert(
                            "অ্যাডমিন এক্সেস",
                            "অ্যাডমিন শুধুমাত্র মনিটর ও ম্যানেজ করতে পারেন। নতুন অর্ডার তৈরি করার অনুমতি নেই।"
                          );
                        }
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
                  <TouchableOpacity onPress={handleExecuteSqlQuery} style={{ backgroundColor: '#2563EB', padding: 10, borderRadius: 6, marginTop: 8, alignItems: 'center' }}><Text style={{ color: '#FFF', fontWeight: 'bold' }}>Execute Query</Text></TouchableOpacity>
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
  container: { flex: 1, backgroundColor: '#0A0A0C' },
  scrollBody: { flex: 1 },

  // ── HEADER ──
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#1F1F24', backgroundColor: '#0D0D0F' },
  headerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  titleBadgeRow: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#FFB703', letterSpacing: 0.4 },
  adminBadge: { backgroundColor: 'rgba(255,183,3,0.12)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginLeft: 8, borderWidth: 1, borderColor: 'rgba(255,183,3,0.3)' },
  adminBadgeText: { color: '#FFB703', fontSize: 9, fontWeight: 'bold' },
  headerDate: { fontSize: 11, color: '#8E8E93', marginTop: 2 },
  menuDotsButton: { padding: 6 },
  menuDotsIcon: { fontSize: 24, color: '#FFB703', fontWeight: 'bold' },

  // ── STATS CARDS (Restored from Backup) ──
  statsScroll: { marginHorizontal: -12, marginBottom: 10 },
  statsContainer: { paddingHorizontal: 12, paddingVertical: 2 },

  // ── CARD (universal card container) ──
  card: { backgroundColor: '#141416', borderRadius: 16, borderWidth: 1, borderColor: '#222226', marginBottom: 12, padding: 14, width: '100%' },

  // ── CARD HEADER ──
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, marginRight: 8 },
  cardIconPill: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 10, flexShrink: 0 },
  cardIconEmoji: { fontSize: 17 },
  cardTitleCol: { flex: 1, minWidth: 0 },
  cardTitle: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  cardSubtitle: { color: '#8E8E93', fontSize: 10, marginTop: 1 },
  cardOutlineBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,183,3,0.3)', backgroundColor: 'rgba(255,183,3,0.08)', flexShrink: 0 },
  cardOutlineBtnText: { color: '#FFB703', fontSize: 10, fontWeight: '600' },

  // ── STATUS PILL ──
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, flexShrink: 0 },
  statusPillGreen: { backgroundColor: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.25)' },
  statusPillAmber: { backgroundColor: 'rgba(255,183,3,0.1)', borderColor: 'rgba(255,183,3,0.25)' },
  statusPillRed:   { backgroundColor: 'rgba(239,68,68,0.1)',  borderColor: 'rgba(239,68,68,0.25)' },
  statusPillText: { fontSize: 10, fontWeight: '700' },

  // ── FINANCE GRID (2×2) ──
  financeGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#1E1E22', borderRadius: 12, overflow: 'hidden', marginBottom: 10, borderWidth: 1, borderColor: '#27272A' },
  financeCell: { width: '50%', paddingVertical: 12, paddingHorizontal: 14 },
  financeCellBorderLeft: { borderLeftWidth: 1, borderColor: '#27272A' },
  financeCellBorderTop:  { borderTopWidth: 1, borderColor: '#27272A' },
  financeCellLabel: { color: '#8E8E93', fontSize: 10, marginBottom: 4, fontWeight: '500' },
  financeCellVal: { fontSize: 15, fontWeight: '800' },

  // ── CARD INFO ROW ──
  cardInfoRow: { flexDirection: 'row', marginBottom: 10 },
  cardInfoItem: { flex: 1 },
  cardInfoLabel: { color: '#8E8E93', fontSize: 10 },
  cardInfoVal: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', marginTop: 1 },

  // ── PAYMENT BREAKDOWN ROW ──
  paymentBreakdownRow: { flexDirection: 'row', backgroundColor: '#1E1E22', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#27272A' },
  payBreakItem: { flex: 1, alignItems: 'center' },
  payBreakLabel: { color: '#8E8E93', fontSize: 9, marginBottom: 3 },
  payBreakVal: { fontSize: 12, fontWeight: '700' },

  // ── OCCUPANCY ──
  occupancyWrap: { marginBottom: 10 },
  occupancyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  occupancyCountText: { color: '#8E8E93', fontSize: 12 },
  occupancyCountBig: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  occupancyPct: { backgroundColor: 'rgba(16,185,129,0.12)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.25)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  occupancyPctText: { color: '#10B981', fontSize: 11, fontWeight: '700' },
  occupancyTrack: { height: 6, backgroundColor: '#242428', borderRadius: 3, overflow: 'hidden' },
  occupancyFill: { height: '100%', backgroundColor: '#10B981', borderRadius: 3 },

  // ── DELIVERY INDICATOR ──
  deliveryIndicatorRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderColor: '#222226', marginTop: 4 },
  deliveryIndicatorText: { color: '#8E8E93', fontSize: 11, flex: 1, marginLeft: 8 },
  floorMapLink: { color: '#60A5FA', fontSize: 11, fontWeight: '600' },
  dotLive: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  dotGreen: { backgroundColor: '#10B981' },
  dotOrange: { backgroundColor: '#FFB703' },

  // ── ACTIVE TABLE CHIPS ──
  activeTblList: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 6 },
  activeTblChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E1E22', borderWidth: 1, borderColor: 'rgba(255,183,3,0.25)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  dotOrangeSm: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFB703', marginRight: 6 },
  activeTblChipText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600', marginRight: 6 },
  activeTblChipAmt: { color: '#FFB703', fontSize: 10, fontWeight: '700' },

  // ── TOP SELLING FOOD REDESIGN ──
  topSellerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  topSellerSubtitle: { color: '#8E8E93', fontSize: 11, marginTop: 2 },
  topSellerReportBtn: { paddingVertical: 4, paddingHorizontal: 6 },
  topSellerReportBtnText: { color: '#FFB703', fontSize: 12, fontWeight: '700' },

  // Hero Card (#1 Item)
  topHeroCard: { backgroundColor: '#18181B', borderRadius: 16, borderWidth: 1, borderColor: '#27272A', padding: 16, marginBottom: 12, position: 'relative', overflow: 'hidden' },
  topHeroDecorCircle: { position: 'absolute', right: -25, top: -25, width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255, 183, 3, 0.04)' },
  topHeroBadge: { backgroundColor: 'rgba(255, 183, 3, 0.12)', borderWidth: 1, borderColor: 'rgba(255, 183, 3, 0.25)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, alignSelf: 'flex-start', marginBottom: 10 },
  topHeroBadgeText: { color: '#FFB703', fontSize: 11, fontWeight: '700' },
  topHeroContentRow: { flexDirection: 'row', alignItems: 'center' },
  topHeroRankBox: { width: 50, height: 50, borderRadius: 14, backgroundColor: 'rgba(255, 183, 3, 0.1)', borderWidth: 1, borderColor: 'rgba(255, 183, 3, 0.2)', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  topHeroRankNum: { color: '#FFB703', fontSize: 24, fontWeight: '900' },
  topHeroInfoCol: { flex: 1, minWidth: 0 },
  topHeroTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  topHeroSub: { color: '#8E8E93', fontSize: 12, fontWeight: '600', marginTop: 2, marginBottom: 4 },
  topHeroPrice: { color: '#FFB703', fontSize: 20, fontWeight: '900' },

  // Ranked List (#2 to #5 Items)
  rankedListCard: { backgroundColor: '#18181B', borderRadius: 14, borderWidth: 1, borderColor: '#27272A', marginBottom: 0, overflow: 'hidden' },
  rankedItemRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12 },
  rankedItemBorderBottom: { borderBottomWidth: 1, borderColor: '#27272A' },
  rankedBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#27272A', justifyContent: 'center', alignItems: 'center', marginRight: 10, flexShrink: 0 },
  rankedBadgeText: { color: '#8E8E93', fontSize: 11, fontWeight: '800' },
  rankedItemMiddleCol: { flex: 1, marginRight: 12, minWidth: 0 },
  rankedItemName: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  rankedItemSubRow: { flexDirection: 'row', alignItems: 'center' },
  rankedItemCategory: { color: '#8E8E93', fontSize: 10, marginRight: 8, maxWidth: 65 },
  rankedProgressBarTrack: { flex: 1, height: 5, borderRadius: 2.5, backgroundColor: '#27272A', overflow: 'hidden' },
  rankedProgressBarFill: { height: '100%', borderRadius: 2.5, backgroundColor: '#FFB703' },
  rankedItemRightCol: { alignItems: 'flex-end', flexShrink: 0 },
  rankedItemAmount: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  rankedItemQty: { color: '#10B981', fontSize: 11, fontWeight: '600', marginTop: 2 },

  // ── DEVICE CONTROL (Redesigned matching mockup) ──
  deviceCardHeader: { marginBottom: 14 },
  deviceSectionTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  deviceSectionSubtitle: { color: '#8E8E93', fontSize: 10.5, marginTop: 2 },

  // Hero Banner
  deviceHeroBanner: { backgroundColor: '#18181B', borderRadius: 18, borderWidth: 1, borderColor: '#27272A', padding: 16, overflow: 'hidden' },
  deviceHeroTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  deviceGaugeContainer: { marginRight: 16, justifyContent: 'center', alignItems: 'center' },
  deviceGaugeRing: { width: 84, height: 84, borderRadius: 42, borderWidth: 5, borderColor: '#10B981', justifyContent: 'center', alignItems: 'center', backgroundColor: '#1E1E22' },
  deviceGaugeNumber: { color: '#FFFFFF', fontSize: 24, fontWeight: '900' },
  deviceGaugeLabel: { color: '#10B981', fontSize: 9.5, fontWeight: '700', marginTop: 1 },
  deviceHeroStatusCol: { flex: 1, justifyContent: 'center' },
  deviceSecurityPill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderWidth: 1, borderColor: 'rgba(16, 185, 129, 0.2)', paddingHorizontal: 9, paddingVertical: 3.5, borderRadius: 12 },
  deviceSecurityPillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981', marginRight: 6 },
  deviceSecurityPillText: { color: '#10B981', fontSize: 10.5, fontWeight: '700' },
  deviceHeroHeadline: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', marginTop: 6 },
  deviceHeroSubhead: { color: '#8E8E93', fontSize: 11, fontWeight: '500', marginTop: 3 },

  // 3 Metric Sub-Tiles inside Banner
  deviceHeroTilesRow: { flexDirection: 'row', gap: 8 },
  deviceHeroTile: { flex: 1, backgroundColor: '#202024', borderRadius: 12, borderWidth: 1, borderColor: '#2C2C32', paddingVertical: 10, alignItems: 'center' },
  deviceHeroTileEmoji: { fontSize: 13, marginBottom: 2 },
  deviceHeroTileNumber: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  deviceHeroTileLabel: { color: '#8E8E93', fontSize: 9.5, fontWeight: '600', marginTop: 1 },

  // Status Alert Strip
  deviceAlertBanner: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12, borderWidth: 1, marginTop: 12 },
  deviceAlertBannerGreen: { backgroundColor: 'rgba(16, 185, 129, 0.08)', borderColor: 'rgba(16, 185, 129, 0.2)' },
  deviceAlertBannerAmber: { backgroundColor: 'rgba(255, 183, 3, 0.08)', borderColor: 'rgba(255, 183, 3, 0.2)' },
  deviceAlertCircle: { width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 9 },
  deviceAlertCircleIcon: { color: '#0A0A0C', fontSize: 11, fontWeight: '900' },
  deviceAlertText: { fontSize: 11, fontWeight: '600', flex: 1 },

  // Active Device Header & Hint
  deviceActiveHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 8 },
  deviceTapHint: { color: '#8E8E93', fontSize: 10.5, flex: 1, marginRight: 8 },
  deviceActiveCountPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(16, 185, 129, 0.12)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(16, 185, 129, 0.25)' },
  deviceActiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981', marginRight: 5 },
  deviceActiveCountText: { color: '#10B981', fontSize: 10, fontWeight: '700' },

  // Device Card Items
  deviceEmptyBox: { paddingVertical: 20, alignItems: 'center', backgroundColor: '#18181B', borderRadius: 14, borderWidth: 1, borderColor: '#27272A', marginBottom: 8 },
  deviceEmptyEmoji: { fontSize: 22, marginBottom: 6 },
  deviceEmptyText: { color: '#8E8E93', fontSize: 11, fontWeight: '600' },
  deviceItemCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#18181B', borderRadius: 14, borderWidth: 1, borderColor: '#27272A', padding: 12, marginBottom: 8 },
  deviceAvatarContainer: { position: 'relative', width: 44, height: 44, marginRight: 12 },
  deviceAvatarBox: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#27272A', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#333338' },
  deviceAvatarLetter: { color: '#FFB703', fontSize: 18, fontWeight: '900' },
  deviceOnlineDot: { position: 'absolute', bottom: -1, right: -1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#18181B' },
  deviceInfoCol: { flex: 1, minWidth: 0 },
  deviceItemTitle: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '800' },
  deviceMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 },
  deviceRoleBadge: { backgroundColor: 'rgba(255, 183, 3, 0.1)', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  deviceRoleBadgeText: { color: '#FFB703', fontSize: 10, fontWeight: '700' },
  deviceStatusText: { fontSize: 11, fontWeight: '600' },
  deviceChevron: { color: '#8E8E93', fontSize: 18, fontWeight: 'bold', marginLeft: 8 },

  // Footer Actions
  deviceViewAllLink: { alignItems: 'center', marginVertical: 12 },
  deviceViewAllText: { color: '#FFB703', fontSize: 12.5, fontWeight: '700' },
  devicePrimaryBtn: { backgroundColor: '#222226', borderWidth: 1, borderColor: '#333338', borderRadius: 24, paddingVertical: 13, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', width: '100%' },
  devicePrimaryBtnIcon: { fontSize: 14, marginRight: 8 },
  devicePrimaryBtnText: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '800' },

  // ── CLOUD SYNC & HEALTH (Redesigned with Real App Sync) ──
  syncCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  syncHeaderLeft: { flex: 1, minWidth: 0, marginRight: 8 },
  syncSectionTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  syncSectionSubtitle: { color: '#8E8E93', fontSize: 10.5, marginTop: 2 },
  syncDiagLink: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 8 },
  syncDiagLinkText: { color: '#FFB703', fontSize: 13, fontWeight: '700' },

  // Hero Banner
  syncHeroBanner: { backgroundColor: '#18181B', borderRadius: 18, borderWidth: 1, borderColor: '#27272A', padding: 16, overflow: 'hidden' },
  syncHeroTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  syncHeroIconBox: { width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(255, 183, 3, 0.1)', borderWidth: 1, borderColor: 'rgba(255, 183, 3, 0.2)', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  syncHeroIconEmoji: { fontSize: 18 },
  syncHeroTitleCol: { flex: 1, minWidth: 0 },
  syncHeroTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  syncHeroSubtitle: { color: '#8E8E93', fontSize: 11, fontWeight: '500', marginTop: 2 },

  // Hero Tiles (SQLite & Cloud Sync Queue)
  syncTile: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#202024', borderRadius: 14, borderWidth: 1, borderColor: '#2C2C32', paddingHorizontal: 12, paddingVertical: 10, marginTop: 8 },
  syncTileIconWrap: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255, 255, 255, 0.05)', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  syncTileIconEmoji: { fontSize: 15 },
  syncTileMidCol: { flex: 1, minWidth: 0 },
  syncTileLabel: { color: '#8E8E93', fontSize: 10, fontWeight: '500' },
  syncTileStatusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  syncStatusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  syncTileStatusText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '700' },
  syncCheckCircle: { width: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  syncCheckMark: { color: '#000000', fontSize: 12, fontWeight: '900' },

  // Bottom Auto-Sync Timers Card
  syncTimersCard: { backgroundColor: '#18181B', borderRadius: 16, borderWidth: 1, borderColor: '#27272A', padding: 14, marginTop: 12 },
  syncTimersHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  syncTimersHeaderIcon: { fontSize: 14, marginRight: 6 },
  syncTimersTitle: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', flex: 1 },
  syncActivePill: { backgroundColor: 'rgba(16, 185, 129, 0.15)', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(16, 185, 129, 0.3)' },
  syncActivePillText: { color: '#10B981', fontSize: 9.5, fontWeight: '700' },

  // 3 Circular Countdown Gauge Rings
  syncRingsRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginBottom: 12 },
  syncRingCol: { alignItems: 'center' },
  syncRingOuterWrap: { width: 72, height: 72, justifyContent: 'center', alignItems: 'center', position: 'relative' },
  syncCircularRing: { position: 'absolute', width: 72, height: 72, borderRadius: 36, borderWidth: 5, backgroundColor: '#141416', borderColor: '#242424' },
  syncRingCenter: { position: 'absolute', width: 62, height: 62, borderRadius: 31, backgroundColor: '#141414', justifyContent: 'center', alignItems: 'center' },
  syncRingNumber: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  syncRingUnit: { color: '#8E8E93', fontSize: 9, marginTop: 1 },
  syncRingName: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', marginTop: 8 },
  syncRingCycle: { color: '#8E8E93', fontSize: 10, marginTop: 2 },
  syncMiniTrack: { width: 62, height: 4, borderRadius: 2, backgroundColor: '#242424', marginTop: 6, overflow: 'hidden' },
  syncMiniFill: { height: '100%', borderRadius: 2 },

  // Sync Engine Background Strip
  syncEngineStrip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#202024', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12, borderWidth: 1, borderColor: '#2C2C32', marginTop: 4 },
  syncEngineItem: { flexDirection: 'row', alignItems: 'center' },
  syncEngineDot: { fontSize: 11, marginRight: 5 },
  syncEngineText: { color: '#8E8E93', fontSize: 10, fontWeight: '600' },
  syncEngineDivider: { width: 1, height: 14, backgroundColor: '#2C2C32' },

  // ── PAYMENT SEGMENTED BAR (Image 3) ──
  sectionHeaderTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', marginBottom: 12 },
  segmentedBarTrack: { height: 16, borderRadius: 8, flexDirection: 'row', overflow: 'hidden', backgroundColor: '#222226', marginBottom: 14 },
  segmentBar: { height: '100%' },
  paymentLegendGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  paymentLegendItem: { width: '48%', flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: 10, height: 10, borderRadius: 3, marginRight: 8 },
  legendLabel: { color: '#8E8E93', fontSize: 12, fontWeight: '600', flex: 1 },
  legendVal: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },

  // ── COMBINED TABLE & ACTIVE DELIVERY SECTION (Reference Image Match) ──
  tableDeliveryCard: {
    backgroundColor: '#181E25',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#242C37',
    padding: 16,
    marginBottom: 16,
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
  tableBottomHint: {
    color: '#8B95A5',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 12,
    marginBottom: 6,
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

  // ── VERTICAL BAR CHART (LAST 7 DAYS — Reference Image Match) ──
  chartCard: {
    backgroundColor: '#181E25',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#242C37',
    padding: 18,
    marginBottom: 16,
  },
  chartHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  chartCardTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  chartCardSubtitle: {
    color: '#8B95A5',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
  },
  chartHighestBadge: {
    backgroundColor: 'rgba(217, 119, 6, 0.18)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartHighestBadgeText: {
    color: '#F59E0B',
    fontSize: 12.5,
    fontWeight: '700',
  },
  chartBarsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 155,
    paddingTop: 8,
  },
  chartCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
  },
  chartBarCol: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: 125,
  },
  chartBarValueText: {
    color: '#8B95A5',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 5,
  },
  chartBarValueTextToday: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '800',
  },
  chartBarFill: {
    width: '84%',
    maxWidth: 42,
    borderRadius: 8,
  },
  chartDayText: {
    color: '#8B95A5',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },
  chartDayTextToday: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },

  // ── VERSION CONTROL (User-friendly Slate & Royal Blue Palette) ──
  versionHeroCard: {
    backgroundColor: '#18181B',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#27272A',
    padding: 16,
    overflow: 'hidden',
  },
  versionHeroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  versionHeroLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  versionHeroPhoneIcon: {
    fontSize: 13,
    marginRight: 6,
  },
  versionHeroLabel: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '600',
  },
  versionStatusPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  versionPillGreen: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  versionPillRed: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  versionStatusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  versionPillTextGreen: {
    color: '#10B981',
  },
  versionPillTextRed: {
    color: '#EF4444',
  },
  versionBigRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  versionPrefixV: {
    color: '#FFB703',
    fontSize: 22,
    fontWeight: '700',
    marginRight: 4,
    marginBottom: 4,
  },
  versionBigNumber: {
    color: '#FFFFFF',
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  versionBuildBadge: {
    backgroundColor: 'rgba(255, 183, 3, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 183, 3, 0.25)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    marginLeft: 12,
  },
  versionBuildText: {
    color: '#FFB703',
    fontSize: 11.5,
    fontWeight: '700',
  },
  versionDashedDivider: {
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderStyle: 'dashed',
    marginVertical: 14,
  },
  versionCompareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  versionCompareCol: {
    alignItems: 'center',
    width: 90,
  },
  versionIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#202024',
    borderWidth: 1,
    borderColor: '#2C2C32',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  versionBoxIcon: {
    fontSize: 20,
  },
  versionRefreshBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  versionRefreshIcon: {
    fontSize: 10,
  },
  versionCompareLabel: {
    color: '#8E8E93',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 6,
  },
  versionCompareVal: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2,
  },
  versionConnectorWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    paddingHorizontal: 8,
  },
  versionConnectorLine: {
    width: '100%',
    height: 2,
    backgroundColor: '#2C2C32',
    justifyContent: 'center',
    alignItems: 'center',
  },
  versionConnectorGlow: {
    width: '50%',
    height: 3,
    backgroundColor: '#10B981',
    borderRadius: 1.5,
    opacity: 0.8,
  },
  versionCenterCircle: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#18181B',
  },
  versionCenterCheck: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },

  // Input Section
  versionInputSection: {
    marginTop: 16,
  },
  versionInputHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  versionInputSectionTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  versionAutoPickPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.4)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  versionAutoPickIcon: {
    fontSize: 11,
    marginRight: 4,
  },
  versionAutoPickPillText: {
    color: '#A5B4FC',
    fontSize: 11.5,
    fontWeight: '700',
  },
  versionBigInputBox: {
    backgroundColor: '#202024',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2C2C32',
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  versionInputPrefixV: {
    color: '#8E8E93',
    fontSize: 18,
    fontWeight: '800',
    marginRight: 10,
  },
  versionBigTextInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 1,
  },
  versionWarningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 12,
    paddingHorizontal: 2,
  },
  versionWarningIcon: {
    fontSize: 13,
    marginRight: 6,
    marginTop: 1,
  },
  versionWarningText: {
    color: '#8E8E93',
    fontSize: 10.5,
    lineHeight: 16,
    flex: 1,
  },
  versionForceLogoutHighlight: {
    color: '#FFB703',
    fontWeight: '800',
  },
  versionFullUpdateBtn: {
    backgroundColor: '#6366F1',
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  versionUpdateBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  versionUpdateBtnIcon: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    marginRight: 8,
  },
  versionUpdateBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // ── EMPTY STATE ──
  emptyState: { alignItems: 'center', paddingVertical: 20 },
  emptyStateEmoji: { fontSize: 28, marginBottom: 8 },
  emptyStateText: { color: '#8E8E93', fontSize: 12, fontWeight: '600', marginBottom: 3 },
  emptyStateSub: { color: '#666666', fontSize: 10, textAlign: 'center', paddingHorizontal: 20 },

  // ── TABLE GRID (in Floor Map modal) ──
  tableGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', width: '100%', paddingBottom: 10 },
  tableCard: { width: '23.5%', aspectRatio: 0.75, borderRadius: 14, padding: 8, alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, borderWidth: 1.5, backgroundColor: '#18181B', borderColor: '#27272A', elevation: 3 },
  tableBusyBorder: { borderColor: 'rgba(255,183,3,0.5)', backgroundColor: 'rgba(35,27,16,0.8)' },
  tableFreeBorder: { borderColor: 'rgba(16,185,129,0.4)', backgroundColor: 'rgba(13,35,27,0.8)' },
  tableId: { fontSize: 13, fontWeight: 'bold', color: '#FFFFFF' },
  tableStatusRow: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 4 },
  tableStatusText: { fontSize: 8, fontWeight: 'bold' },
  textGreen: { color: '#10B981' },
  textOrange: { color: '#FFB703' },
  tableAmount: { fontSize: 9, color: '#FFFFFF' },
  chairIcon: { fontSize: 14, opacity: 0.3 },

  // ── DELIVERY CARDS (in Floor Map modal) ──
  deliveryCard: { backgroundColor: '#18181B', borderWidth: 1, borderColor: '#27272A', borderRadius: 14, padding: 16 },
  deliveryTitle: { fontSize: 14, fontWeight: 'bold', color: '#FFFFFF' },
  deliveryTime: { fontSize: 11, color: '#8E8E93', marginVertical: 6 },
  deliveryAmount: { fontSize: 16, fontWeight: 'bold', color: '#FFB703' },

  // ── MODALS (ALL PRESERVED EXACTLY) ──
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#141416', borderWidth: 1, borderColor: '#27272A', borderRadius: 20, padding: 16, width: '85%', alignItems: 'center' },
  modalTitle: { fontSize: 17, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 10 },
  modalSubtitle: { fontSize: 11, color: '#8E8E93', textAlign: 'center' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderColor: '#222226' },
  detailLabel: { color: '#8E8E93', fontSize: 13 },
  detailValue: { color: '#FFFFFF', fontSize: 13, fontWeight: '500' },
  modalInput: { backgroundColor: '#1E1E22', borderWidth: 1, borderColor: '#27272A', borderRadius: 12, height: 48, paddingHorizontal: 16, color: '#FFFFFF', width: '100%' },
  modalBtnRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 20 },
  modalCancelBtn: { flex: 1, height: 46, justifyContent: 'center', alignItems: 'center', backgroundColor: '#222226', borderRadius: 10, marginRight: 10 },
  modalCancelBtnText: { color: '#FFFFFF', fontSize: 14 },
  modalSaveBtn: { flex: 1, height: 46, justifyContent: 'center', alignItems: 'center', backgroundColor: '#10B981', borderRadius: 10, marginLeft: 10 },
  modalSaveBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: 'bold' },
  menuModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-start', alignItems: 'flex-start' },
  menuModalContent: { backgroundColor: '#18181B', borderRadius: 12, marginTop: 45, marginLeft: 16, width: 200, borderWidth: 1, borderColor: '#27272A', overflow: 'hidden' },
  menuOption: { paddingVertical: 9, paddingHorizontal: 14 },
  menuOptionText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  menuDivider: { height: 1, backgroundColor: '#27272A' },
  menuSectionHeader: { backgroundColor: '#141416', paddingVertical: 4, paddingHorizontal: 14, borderBottomWidth: 1, borderColor: '#27272A' },
  menuSectionText: { color: '#8E8E93', fontSize: 9, fontWeight: 'bold', letterSpacing: 1 },
  sheetContainer: { width: '100%', backgroundColor: '#141416', borderRadius: 12, borderWidth: 1, borderColor: '#27272A', overflow: 'hidden', flexShrink: 1 },
  sheetHeader: { flexDirection: 'row', backgroundColor: '#1E1E22', paddingVertical: 10, paddingHorizontal: 10, borderBottomWidth: 1, borderColor: '#27272A' },
  sheetHeaderText: { color: '#FFB703', fontSize: 10, fontWeight: 'bold', textAlign: 'center' },
  sheetBody: { maxHeight: 300 },
  sheetRow: { flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 0.5, borderColor: '#222226', alignItems: 'center' },
  sheetRowAlt: { backgroundColor: '#101012' },
  sheetCell: { color: '#FFFFFF', fontSize: 10, textAlign: 'center' },
  sheetCellTextMain: { color: '#FFFFFF', fontSize: 10, fontWeight: '500' },
  sheetCellTextSub: { color: '#8E8E93', fontSize: 8, marginTop: 1 },
  filterBar: { flexDirection: 'row', marginBottom: 12, height: 36 },
  filterChip: { paddingHorizontal: 12, borderRadius: 18, backgroundColor: '#1E1E22', borderWidth: 1, borderColor: '#27272A', marginRight: 8, height: 32, justifyContent: 'center' },
  filterChipActive: { backgroundColor: 'rgba(255, 183, 3, 0.15)', borderColor: '#FFB703' },
  filterChipText: { color: '#8E8E93', fontSize: 10, fontWeight: '500' },
  filterChipTextActive: { color: '#FFB703', fontWeight: 'bold' },
  sheetFooter: { flexDirection: 'row', backgroundColor: '#1E1E22', paddingVertical: 12, paddingHorizontal: 10, borderTopWidth: 2, borderColor: '#FFB703' },
  sheetFooterText: { color: '#FFB703', fontSize: 10, fontWeight: 'bold', textAlign: 'center' },
  closeCircle: { backgroundColor: '#222226', width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  closeCircleText: { color: '#8E8E93', fontSize: 14 },
  modalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 16 },
  modalHeaderLeft: { flexDirection: 'row', alignItems: 'center' },
  modalIconCircle: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(255,183,3,0.12)', justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  modalIconEmoji: { fontSize: 24 },
  filterSection: { width: '100%', marginBottom: 10 },
  pickDateWrapper: { flexDirection: 'row', alignItems: 'center', marginTop: 4, backgroundColor: '#1E1E22', borderRadius: 8, paddingHorizontal: 10, height: 44, borderWidth: 1, borderColor: '#27272A' },
  modalFooterActions: { flexDirection: 'row', marginTop: 16, width: '100%' },
  exportBtn: { flex: 1.2, backgroundColor: '#10B981', borderRadius: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginRight: 8, height: 44 },
  exportBtnText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 13 },
  exportBtnIcon: { marginRight: 6 },
  historyCloseBtn: { flex: 1, backgroundColor: '#222226', borderRadius: 10, justifyContent: 'center', alignItems: 'center', height: 44, borderWidth: 1, borderColor: '#27272A' },
  historyCloseBtnText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 13 },
  renameInputWrapper: { width: '100%', backgroundColor: '#1E1E22', borderWidth: 1, borderColor: '#27272A', borderRadius: 12, height: 50, paddingHorizontal: 16, justifyContent: 'center', marginBottom: 20 },
  renameInput: { color: '#FFFFFF', fontSize: 15 },
  expenseInputGroup: { width: '100%', marginBottom: 12 },
  inputLabel: { color: '#8E8E93', fontSize: 11, marginBottom: 6, fontWeight: 'bold' },
  emptySheetText: { color: '#8E8E93', textAlign: 'center', padding: 20, fontSize: 12 },
  manualBadge: { backgroundColor: 'rgba(255,183,3,0.15)', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, marginLeft: 4 },
  manualBadgeText: { color: '#FFB703', fontSize: 8, fontWeight: 'bold' },
  calendarOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  calendarContent: { backgroundColor: '#141416', width: width * 0.85, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#27272A' },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  calNav: { color: '#FFB703', fontSize: 20, paddingHorizontal: 10 },
  calTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' },
  calWeekRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 10 },
  calWeekDay: { color: '#8E8E93', fontSize: 12, width: 35, textAlign: 'center' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around' },
  calDayCell: { width: 35, height: 35, justifyContent: 'center', alignItems: 'center', marginBottom: 5, borderRadius: 17 },
  calDayText: { color: '#FFFFFF', fontSize: 13 },
  calCloseBtn: { marginTop: 20, height: 44, backgroundColor: '#222226', borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  calCloseBtnText: { color: '#8E8E93', fontSize: 14 },
  inspectorGrid: { flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
  inspectorCard: { flex: 1, backgroundColor: '#1E1E22', borderWidth: 1, borderColor: '#27272A', borderRadius: 10, padding: 12, marginHorizontal: 4, alignItems: 'center' },
  inspectorLabel: { color: '#8E8E93', fontSize: 10, marginBottom: 4, fontWeight: 'bold' },
  inspectorValue: { color: '#FFFFFF', fontSize: 12, fontWeight: 'bold', textAlign: 'center' },
  inspectorSub: { color: '#666666', fontSize: 8, marginTop: 2 },
  syncTimerWrapper: { paddingVertical: 4, paddingHorizontal: 12, backgroundColor: '#1E1E22', borderRadius: 8, marginHorizontal: 16, marginTop: 4, marginBottom: 4, alignItems: 'center', borderWidth: 1, borderColor: '#27272A' },
  syncTimerText: { color: '#FFB703', fontSize: 8, fontWeight: '600', marginVertical: 1 },

  // ── STATUS BADGES (used in modals) ──
  statusBadgeSmall: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 0.8, flexShrink: 0 },
  statusBadgeGreen: { backgroundColor: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.3)' },
  statusBadgeAmber: { backgroundColor: 'rgba(255,183,3,0.12)', borderColor: 'rgba(255,183,3,0.3)' },
  statusBadgeRed:   { backgroundColor: 'rgba(239,68,68,0.12)',  borderColor: 'rgba(239,68,68,0.3)' },
  statusBadgeTextSmall: { fontSize: 9, fontWeight: '700' },
  textAmber: { color: '#FFB703' },
  textRed: { color: '#EF4444' },
});

