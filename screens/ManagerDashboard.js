import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Platform,
  StatusBar as RNStatusBar,
  Alert,
  Dimensions,
  Modal,
  TextInput,
  BackHandler
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { 
  formatDisplayDate, 
  getBusinessDate,
  getTodaySubmissionDetails
} from '../database';
import PrintReceiptModal from '../components/PrintReceiptModal';
import { TodaySalesCard, TotalCashCard } from '../components/StatCard';
import ManagerSideMenu from '../components/ManagerSideMenu';
import PastAccountModal from '../components/PastAccountModal';
import OrderDetailModal from '../components/OrderDetailModal';

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

export default function ManagerDashboard({ onLogout, tables, deliveries = [], completedOrders = [], submissionHistory = [], onTableSelect, onCreateDelivery, onNavigateToSubmit, onUpdateTableName, onNavigateToExpenses, onNavigateToSupplierDue, onNavigateToItemSalesReport, onCloudRestore, onSameDayResync, onMenuRecovery, onSavePastAccount, onDeletePastAccount, dailyExpenses, onUpdateExpenses, isDailySubmitted, todaySubmissionDetails, onDeleteActiveOrder, onDeleteDoneOrder, onResetIjara, onRollbackAutoIjara, onNavigateToPrinterSettings, onNavigateToBackupRestore, delCountdown, tabCountdown, fullCountdown, userRole = 'manager' }) {
  const submitInfo = todaySubmissionDetails || (isDailySubmitted ? getTodaySubmissionDetails() : null);

  const formatSubmitTime = (isoStr) => {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  };

  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [selectedTableForRename, setSelectedTableForRename] = useState(null);
  const [newTableName, setNewTableName] = useState('');

  // Menu Modal state
  const [menuModalVisible, setMenuModalVisible] = useState(false);
  const [ijaraModalVisible, setIjaraModalVisible] = useState(false);
  const [tempIjara, setTempIjara] = useState(dailyExpenses.ijara.toString());

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

  // Calendar State
  const [calendarVisible, setCalendarVisible] = useState(false);

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderDetailVisible, setOrderDetailVisible] = useState(false);
  const [printOrder, setPrintOrder] = useState(null);

  // Android Back Handler for Modals
  useEffect(() => {
    const backAction = () => {
      // Priority: Close modals from top to bottom
      if (orderDetailVisible) { setOrderDetailVisible(false); return true; }
      if (calendarVisible) { setCalendarVisible(false); return true; }
      if (pastAccountModalVisible) { setPastAccountModalVisible(false); return true; }
      if (ijaraModalVisible) { setIjaraModalVisible(false); return true; }
      if (menuModalVisible) { setMenuModalVisible(false); return true; }
      if (renameModalVisible) { setRenameModalVisible(false); return true; }

      return false; // Let App.js handle screen back
    };

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      backAction
    );

    return () => backHandler.remove();
  }, [orderDetailVisible, calendarVisible, pastAccountModalVisible, ijaraModalVisible, menuModalVisible, renameModalVisible]);

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
    // Auto-fill removed to allow manual entry without pre-filled data.
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
        Alert.alert("ইতিমধ্যে বিদ্যমান", "এই তারিখের হিসাব ইতিমধ্যে জমা দেওয়া আছে। আপনি চাইলে ওই দিনের এন্ট্রিটি এডিট করতে পারেন।");
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
  
  const allOrdersForLog = completedOrders.map(o => ({
    ...o,
    table: o.tableId,
    // Requirement: Show only Food Sales + Delivery Charge in log. Deduct changeMoneyGiven if it was included in the total.
    amount: (o.paidAmount || o.grandTotal || o.totalAmount) - (o.changeMoneyGiven || 0)
  }));

  const filteredOrders = allOrdersForLog.filter(o => (o.fullDate || todayStr) === todayStr);

  const totalDoneCount = todaysOrders.length;
  const currentMonthPrefix = todayStr.substring(0, 7);
  const thisMonthSubmissions = submissionHistory?.filter(item => item.date && item.date.startsWith(currentMonthPrefix)) || [];
  const monthlyTotalSell = thisMonthSubmissions.reduce((sum, item) => sum + (item.sell || 0), 0) + todaySale;

  return (
    <SafeAreaView style={styles.container}>
      <CalendarPicker 
        visible={calendarVisible} 
        onClose={() => setCalendarVisible(false)} 
        onSelectDate={(date) => handlePastDateChange(date)}
      />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.menuDotsButton} onPress={() => setMenuModalVisible(true)}>
          <Text style={styles.menuDotsIcon}>☰</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <View style={styles.titleBadgeRow}>
            <Text style={styles.headerTitle}>Manager Dashboard</Text>
            <View style={styles.managerBadge}>
              <Text style={styles.managerBadgeText}>Manager</Text>
            </View>
          </View>
          <Text style={styles.headerDate}>{getBengaliDate()}</Text>
        </View>

        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollBody} contentContainerStyle={{ paddingBottom: 110 }}>
        {/* IF SUBMITTED: Post-Submit Locked Screen (Tables & Orders Locked, Only Sidebar works) */}
        {isDailySubmitted && submitInfo ? (
          <View style={styles.postSubmitContainer}>
            {/* Header Lock Status Card */}
            <View style={styles.lockHeaderCard}>
              <View style={styles.lockIconCircle}>
                <Text style={styles.lockIconEmoji}>🔒</Text>
              </View>
              <Text style={styles.lockTitle}>আজকের দৈনিক হিসাব ক্লোজ ও সাবমিট সম্পন্ন</Text>
              <Text style={styles.lockSubtitle}>
                আজকের জন্য রেস্টুরেন্ট টেবিল ও নতুন অর্ডার গ্রহণ বন্ধ রয়েছে।
              </Text>
              {submitInfo.submitted_at ? (
                <View style={styles.submittedByPill}>
                  <Text style={styles.submittedByPillText}>
                    সাবমিট করেছেন: {submitInfo.submitted_by || 'ম্যানেজার'} ({formatSubmitTime(submitInfo.submitted_at)})
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Card 1: Next Day Opening Ijara (Highlighted) */}
            <View style={styles.nextDayIjaraCard}>
              <View style={styles.nextDayIjaraHeader}>
                <Text style={styles.nextDayIjaraEmoji}>💰</Text>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.nextDayIjaraCardTitle}>আগামীকালের প্রারম্ভিক ক্যাশ (ইজা)</Text>
                  <Text style={styles.nextDayIjaraCardSubtitle}>Next Day Opening Cash</Text>
                </View>
              </View>
              <Text style={styles.nextDayIjaraCardAmount}>
                ৳ {(submitInfo.nextDayIjara || 0).toLocaleString()}
              </Text>
              <Text style={styles.nextDayIjaraCardNote}>
                ✓ এই টাকা আগামীকালের ড্রয়ার ক্যাশ হিসেবে স্বয়ংক্রিয়ভাবে যোগ করা হয়েছে।
              </Text>
            </View>

            {/* Card 2: Submitted Day Details */}
            <View style={styles.summaryBreakdownCard}>
              <Text style={styles.summaryBreakdownTitle}>📊 আজকের সাবমিটকৃত হিসাবের বিবরণ</Text>
              
              <View style={styles.summaryRow}>
                <Text style={styles.summaryRowLabel}>তারিখ</Text>
                <Text style={styles.summaryRowValue}>{formatDisplayDate(submitInfo.date)}</Text>
              </View>
              <View style={styles.summaryDivider} />

              <View style={styles.summaryRow}>
                <Text style={styles.summaryRowLabel}>মোট বিক্রয়</Text>
                <Text style={[styles.summaryRowValue, { color: '#10B981', fontWeight: 'bold' }]}>
                  ৳ {(submitInfo.total_sell || 0).toLocaleString()}
                </Text>
              </View>
              <View style={styles.summarySubrow}>
                <Text style={styles.summarySubrowText}>
                  ক্যাশ: ৳{(submitInfo.cash_payment || 0).toLocaleString()} | বিকাশ: ৳{(submitInfo.bkash_payment || 0).toLocaleString()} | নগদ: ৳{(submitInfo.nagad_payment || 0).toLocaleString()}
                </Text>
              </View>
              <View style={styles.summaryDivider} />

              <View style={styles.summaryRow}>
                <Text style={styles.summaryRowLabel}>মোট খরচ</Text>
                <Text style={[styles.summaryRowValue, { color: '#EF4444', fontWeight: 'bold' }]}>
                  ৳ {(submitInfo.total_expense || 0).toLocaleString()}
                </Text>
              </View>
              <View style={styles.summaryDivider} />

              <View style={styles.summaryRow}>
                <Text style={styles.summaryRowLabel}>মালিকের কাছে নিট জমা</Text>
                <Text style={[styles.summaryRowValue, { color: '#38BDF8', fontWeight: 'bold' }]}>
                  ৳ {(submitInfo.net_deposit || 0).toLocaleString()}
                </Text>
              </View>
              <View style={styles.summaryDivider} />

              <View style={styles.summaryRow}>
                <Text style={styles.summaryRowLabel}>নিট ক্লোজিং ক্যাশ</Text>
                <Text style={[styles.summaryRowValue, { color: '#F59E0B', fontWeight: 'bold' }]}>
                  ৳ {(submitInfo.net_cash || 0).toLocaleString()}
                </Text>
              </View>
            </View>

            {/* Sidebar Helper Banner */}
            <View style={styles.sidebarNoticeBox}>
              <Text style={styles.sidebarNoticeIcon}>ℹ️</Text>
              <Text style={styles.sidebarNoticeText}>
                পূর্বের দিনের হিসাব, খরচের তালিকা বা অন্যান্য রিপোর্ট দেখতে উপরে বাম পাশের মেনু (☰) ব্যবহার করুন।
              </Text>
            </View>
          </View>
        ) : (
          <>
            {/* Horizontal Stats Row */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.statsContainer}
            >
              {/* Card 1: Today's Sale */}
              <TodaySalesCard
                todaySale={todaySale}
                bkashSale={bkashSale}
                nagadSale={nagadSale}
                rocketSale={rocketSale}
                totalDoneCount={totalDoneCount}
                title="আজকের মোট বিক্রয়"
              />

              {/* Card 2: Total Cash */}
              <TotalCashCard
                totalCash={totalCash}
                bkashSale={bkashSale}
                nagadSale={nagadSale}
                rocketSale={rocketSale}
              />
            </ScrollView>

            {/* Table Status Section */}
            <View style={styles.sectionContainer}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>
                  টেবিল স্ট্যাটাস <Text style={styles.sectionSubtitle}>(নাম পরিবর্তন করতে দীর্ঘ চাপ দিন)</Text>
                </Text>
                <TouchableOpacity onPress={() => Alert.alert("সাহায্য", "সবুজ = খালি, কমলা = ব্যস্ত। টেবিল সিলেক্ট করে অর্ডার দিন।")}>
                  <Text style={styles.infoIcon}>ℹ️</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.tableGrid}>
                 {tables.map((table) => {
                   const isBusy = table.status === 'BUSY';
                   const tableAmount = table.items ? table.items.reduce((sum, item) => sum + (item.price * item.qty), 0) : 0;
                   return (
                     <TouchableOpacity
                       key={table.id}
                       onPress={() => onTableSelect(table.id)}
                       onLongPress={() => handleTableLongPress(table)}
                       activeOpacity={0.8}
                       style={[
                         styles.tableCard,
                         isBusy ? styles.tableBusyBorder : styles.tableFreeBorder,
                       ]}
                     >
                       <Text style={styles.tableId}>{table.name || table.id}</Text>
                       <View style={styles.tableStatusRow}>
                         <View style={[styles.statusDot, isBusy ? styles.dotOrange : styles.dotGreen]} />
                         <Text style={[styles.tableStatusText, isBusy ? styles.textOrange : styles.textGreen]}>
                           {table.status}
                         </Text>
                       </View>
                       {isBusy ? (
                         <Text style={styles.tableAmount}>৳ {tableAmount}</Text>
                       ) : (
                         <View style={{ height: 12 }} />
                       )}
                       <Text style={styles.chairIcon}>🪑</Text>
                     </TouchableOpacity>
                   );
                 })}
              </View>
            </View>

            {/* Active Delivery Section */}
            <View style={styles.sectionContainer}>
              <Text style={styles.sectionTitle}>সক্রিয় ডেলিভারি ({deliveries.filter(d => d.status === 'BUSY').length})</Text>
              <View style={{ marginTop: 10 }}>
                 {deliveries.filter(d => d.status === 'BUSY').length > 0 ? (
                   deliveries.filter(d => d.status === 'BUSY').map((delivery) => (
                       <TouchableOpacity key={delivery.id} style={[styles.deliveryCard, { marginBottom: 10 }]} onPress={() => onTableSelect(delivery.id)}>
                         <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                           <View>
                             <Text style={styles.deliveryTitle}>{delivery.name}</Text>
                             <Text style={styles.deliveryTime}>শুরু: {formatStartTime(delivery.startTime)}</Text>
                           </View>
                           <Text style={styles.deliveryAmount}>৳ {(delivery.amount !== undefined && delivery.amount !== null && Number(delivery.amount) > 0) ? parseFloat(delivery.amount) : ((delivery.items ? delivery.items.reduce((sum, i) => sum + ((parseFloat(i.price) || 0) * (parseInt(i.qty, 10) || 1)), 0) : 0) + (parseFloat(delivery.deliveryCharge || delivery.delivery_charge) || 0))}</Text>
                         </View>
                       </TouchableOpacity>
                   ))
                 ) : null}
                 <TouchableOpacity style={styles.emptyDeliveryPlaceholder} onPress={onCreateDelivery}>
                   <Text style={styles.emptyDeliveryText}>➕ নতুন ডেলিভারি শুরু করুন</Text>
                 </TouchableOpacity>
              </View>
            </View>

            {/* Order Log Section */}
            <View style={styles.sectionContainer}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>আজকের অর্ডার লগ</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <TouchableOpacity>
                    <Text style={styles.seeAllText}>সব দেখুন</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.orderList}>
                {filteredOrders.length === 0 ? (
                  <Text style={{ color: '#888888', textAlign: 'center', padding: 20 }}>কোনো অর্ডার পাওয়া যায়নি</Text>
                ) : (
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
                        <View style={[styles.tableIconCircle, styles.circleGreen]}>
                          <Text style={styles.tableCircleText}>{order.table}</Text>
                        </View>
                        <View style={styles.orderMeta}>
                          <View style={styles.tableTimeRow}>
                            <Text style={styles.orderTableText}>{order.table}</Text>
                            <Text style={styles.orderTimeText}>{order.time}</Text>
                          </View>
                          <Text style={styles.orderItemsText} numberOfLines={1}>{order.items}</Text>
                        </View>
                      </View>
                      <View style={styles.orderItemRight}>
                        <View style={styles.amountCol}>
                          <Text style={styles.orderItemAmount}>৳ {order.amount}</Text>
                          <Text style={[styles.orderItemStatus, styles.textGreen]}>পেমেন্ট শেষ</Text>
                        </View>
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
                          {(userRole === 'owner' || userRole === 'admin') && (
                            <TouchableOpacity style={styles.deleteBtn} onPress={(e) => { e.stopPropagation(); onDeleteDoneOrder(order.id); }}>
                              <Text style={styles.btnIcon}>🗑️</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    </TouchableOpacity>
                  ))
                )}
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {/* Floating Action Buttons - Hidden when daily submit is completed */}
      {!isDailySubmitted && (
        <View style={styles.fabContainer}>
          <TouchableOpacity style={styles.fabItemUnified} onPress={onCreateDelivery}>
            <Text style={styles.fabIconSmall}>🛵</Text>
            <Text style={styles.fabLabelSmall}>ডেলিভারি</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.fabItemUnified}
            onPress={onNavigateToExpenses}
          >
            <Text style={styles.fabIconSmall}>📉</Text>
            <Text style={styles.fabLabelSmall}>খরচ</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.fabItemUnified, styles.fabHighlight]}
            onPress={onNavigateToSubmit}
          >
            <Text style={[styles.fabIconSmall, { color: '#000000' }]}>📝</Text>
            <Text style={[styles.fabLabelSmall, { color: '#000000' }]}>সাবমিট</Text>
          </TouchableOpacity>
        </View>
      )}

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
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>টেবিলের নাম পরিবর্তন</Text>
            <View style={styles.renameInputWrapper}>
              <TextInput style={styles.renameInput} value={newTableName} onChangeText={setNewTableName} placeholder="নতুন নাম লিখুন" placeholderTextColor="#888" autoFocus={true}/>
            </View>
            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setRenameModalVisible(false)}><Text style={styles.modalCancelBtnText}>বাতিল</Text></TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveTableName}><Text style={styles.modalSaveBtnText}>সংরক্ষণ</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 3-DOT MENU (MANAGER SIDE MENU) */}
      {/* Preserves 3-dot menu options: আজকের ডেটা রিসিন্ক (Same-Day Resync) */}
      <ManagerSideMenu
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
        handleOpenPastAccount={handleOpenPastAccount}
        showAutoIjaraRollback={(userRole === 'owner' || userRole === 'admin') && Boolean(onRollbackAutoIjara)}
        onRollbackAutoIjara={onRollbackAutoIjara}
        onSameDayResync={onSameDayResync}
        onCloudRestore={onCloudRestore}
        onMenuRecovery={onMenuRecovery}
        onNavigateToPrinterSettings={onNavigateToPrinterSettings}
        onNavigateToBackupRestore={onNavigateToBackupRestore}
        onLogout={onLogout}
      />

      {/* IJARA MODAL */}
      <Modal animationType="slide" transparent={true} visible={ijaraModalVisible} onRequestClose={() => setIjaraModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalIconCircle}><Text style={styles.modalIconEmoji}>💰</Text></View>
            <Text style={styles.modalTitle}>ইজা যোগ করুন</Text>
            <View style={styles.ijaraInputWrapper}>
              <TextInput style={[styles.modalInput, { color: '#FFF' }]} keyboardType="numeric" value={tempIjara} onChangeText={setTempIjara} placeholder="ইজা পরিমাণ" placeholderTextColor="#AAA" autoFocus={true}/>
            </View>
            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setIjaraModalVisible(false)}><Text style={styles.modalCancelBtnText}>বাতিল</Text></TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveIjara}><Text style={styles.modalSaveBtnText}>নিশ্চিত</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* PAST ACCOUNT MODAL */}
      <PastAccountModal
        visible={pastAccountModalVisible}
        onClose={() => setPastAccountModalVisible(false)}
        isEditingPast={isEditingPast}
        pastDate={pastDate}
        onOpenDatePicker={() => setCalendarVisible(true)}
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
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },

  // ── POST-SUBMIT LOCKED SCREEN STYLES ──
  postSubmitContainer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 15
  },
  lockHeaderCard: {
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#374151'
  },
  lockIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10
  },
  lockIconEmoji: {
    fontSize: 24
  },
  lockTitle: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 6
  },
  lockSubtitle: {
    color: '#9CA3AF',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 18
  },
  submittedByPill: {
    backgroundColor: '#1F2937',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#4B5563'
  },
  submittedByPillText: {
    color: '#D1D5DB',
    fontSize: 11,
    fontWeight: '600'
  },
  nextDayIjaraCard: {
    backgroundColor: '#064E3B',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#10B981'
  },
  nextDayIjaraHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8
  },
  nextDayIjaraEmoji: {
    fontSize: 22
  },
  nextDayIjaraCardTitle: {
    color: '#A7F3D0',
    fontSize: 14,
    fontWeight: 'bold'
  },
  nextDayIjaraCardSubtitle: {
    color: '#6EE7B7',
    fontSize: 10
  },
  nextDayIjaraCardAmount: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: 'bold',
    marginVertical: 4
  },
  nextDayIjaraCardNote: {
    color: '#D1FAE5',
    fontSize: 11,
    marginTop: 4,
    lineHeight: 16
  },
  summaryBreakdownCard: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#334155'
  },
  summaryBreakdownTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 12
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4
  },
  summaryRowLabel: {
    color: '#94A3B8',
    fontSize: 13
  },
  summaryRowValue: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600'
  },
  summarySubrow: {
    paddingVertical: 2,
    paddingLeft: 4
  },
  summarySubrowText: {
    color: '#64748B',
    fontSize: 11
  },
  summaryDivider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 6
  },
  sidebarNoticeBox: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#475569'
  },
  sidebarNoticeIcon: {
    fontSize: 18,
    marginRight: 8
  },
  sidebarNoticeText: {
    color: '#94A3B8',
    fontSize: 11,
    flex: 1,
    lineHeight: 16
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#161616',
    backgroundColor: '#0D0D0D',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuButton: {
    marginRight: 12,
    padding: 6,
  },
  menuIcon: {
    fontSize: 22,
    color: '#FFB703',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFB703',
    letterSpacing: 0.5,
  },
  managerBadge: {
    backgroundColor: 'rgba(255, 183, 3, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 183, 3, 0.3)',
  },
  managerBadgeText: {
    color: '#FFB703',
    fontSize: 10,
    fontWeight: 'bold',
  },
  titleBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerDate: {
    fontSize: 12,
    color: '#A1A1AA',
    marginTop: 2,
  },
  notificationButton: {
    position: 'relative',
    padding: 6,
  },
  bellIcon: {
    fontSize: 20,
  },
  badgeContainer: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#FF4D4D',
    borderRadius: 8,
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: 'bold',
  },
  menuDotsButton: {
    padding: 6,
  },
  menuDotsIcon: {
    fontSize: 24,
    color: '#FFB703',
    fontWeight: 'bold',
  },
  scrollBody: {
    flex: 1,
  },
  statsContainer: {
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  statsCard: {
    width: 170,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 6,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  cardGreen: {
    backgroundColor: 'rgba(16, 37, 24, 0.8)',
    borderColor: 'rgba(52, 211, 153, 0.4)',
  },
  cardOrange: {
    backgroundColor: 'rgba(36, 22, 14, 0.8)',
    borderColor: 'rgba(251, 146, 60, 0.4)',
  },
  cardRed: {
    backgroundColor: 'rgba(69, 10, 10, 0.6)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  cardBlue: {
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderColor: 'rgba(96, 165, 250, 0.4)',
  },
  statsCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  statsCardTitle: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  statsEmoji: {
    fontSize: 14,
  },
  statsCardAmount: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  statsCardSubGreen: {
    fontSize: 10,
    color: '#34D399',
  },
  statsCardSubOrange: {
    fontSize: 10,
    color: '#FB923C',
  },
  statsCardSubRed: {
    fontSize: 10,
    color: '#FCA5A5',
  },
  statsCardSubBlue: {
    fontSize: 10,
    color: '#60A5FA',
  },
  sectionContainer: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  sectionSubtitle: {
    fontSize: 11,
    color: '#A1A1AA',
    fontWeight: 'normal',
  },
  infoIcon: {
    fontSize: 16,
    color: '#888888',
  },
  tableGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', width: '100%', paddingBottom: 10 },
  tableCard: {
    width: '23.5%',
    aspectRatio: 0.75,
    borderRadius: 14,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    borderWidth: 1.5,
    backgroundColor: '#161616',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  tableBusyBorder: {
    borderColor: 'rgba(251, 146, 60, 0.5)',
    backgroundColor: 'rgba(36, 22, 14, 0.6)',
  },
  tableFreeBorder: {
    borderColor: 'rgba(52, 211, 153, 0.4)',
  },
  tableId: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  tableStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  dotGreen: {
    backgroundColor: '#34D399',
  },
  dotOrange: {
    backgroundColor: '#FB923C',
  },
  tableStatusText: {
    fontSize: 9,
    fontWeight: 'bold',
  },
  textGreen: {
    color: '#34D399',
  },
  textOrange: {
    color: '#FB923C',
  },
  tableAmount: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  chairIcon: {
    fontSize: 14,
    opacity: 0.3,
  },
  deliveryCard: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 14,
    padding: 16,
  },
  deliveryTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  deliveryTime: {
    fontSize: 11,
    color: '#A1A1AA',
    marginTop: 4,
  },
  deliveryAmount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFB703',
  },
  emptyDeliveryPlaceholder: {
    width: '100%',
    height: 60,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 183, 3, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyDeliveryText: {
    color: '#FFB703',
    fontWeight: 'bold',
    fontSize: 14,
  },
  seeAllText: {
    fontSize: 12,
    color: '#FFB703',
  },
  filterContainer: {
    flexDirection: 'row',
    backgroundColor: '#0D0D0D',
    padding: 4,
    borderRadius: 8,
    marginBottom: 12,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  filterTabActive: {
    backgroundColor: '#FFB703',
  },
  filterTabText: {
    fontSize: 12,
    color: '#888888',
    fontWeight: '600',
  },
  filterTabTextActive: {
    color: '#000000',
  },
  orderList: {
    backgroundColor: '#161616',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#262626',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  orderItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: '#1E1E1E',
  },
  orderItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  tableIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  circleOrange: {
    backgroundColor: 'rgba(251, 146, 60, 0.15)',
  },
  circleGreen: {
    backgroundColor: 'rgba(52, 211, 153, 0.15)',
  },
  tableCircleText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  orderMeta: {
    flex: 1,
    justifyContent: 'center',
  },
  tableTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  orderTableText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginRight: 8,
  },
  orderTimeText: {
    fontSize: 11,
    color: '#888888',
  },
  orderItemsText: {
    fontSize: 12,
    color: '#888888',
    marginTop: 4,
  },
  orderItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  amountCol: {
    alignItems: 'flex-end',
    marginRight: 10,
  },
  orderItemAmount: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  orderItemStatus: {
    fontSize: 10,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
  },
  printBtn: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    width: 28,
    height: 28,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  modalPrintBtn: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#3B82F6',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrintBtnText: {
    color: '#60A5FA',
    fontSize: 14,
    fontWeight: 'bold',
  },
  editBtn: {
    backgroundColor: 'rgba(255, 183, 3, 0.15)',
    width: 28,
    height: 28,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  deleteBtn: {
    backgroundColor: 'rgba(255, 77, 77, 0.15)',
    width: 28,
    height: 28,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnIcon: {
    fontSize: 12,
  },
  lockWrapper: { width: 28, height: 28, justifyContent: 'center', alignItems: 'center', opacity: 0.5 },
  lockIcon: { fontSize: 14 },
  fabContainer: {
    position: 'absolute',
    bottom: 30,
    right: 16,
    left: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
    padding: 8,
    borderRadius: 35,
    borderWidth: 1,
    borderColor: '#1A1A1A',
  },
  fabItemUnified: {
    flex: 1,
    height: 50,
    backgroundColor: '#1E1E1E',
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#FFB703',
  },
  fabHighlight: {
    backgroundColor: '#FFB703',
  },
  fabIconSmall: {
    fontSize: 16,
    color: '#FFB703',
  },
  fabLabelSmall: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#FFB703',
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#FFB703',
    borderRadius: 20,
    padding: 24,
    width: '85%',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 10,
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#888888',
    textAlign: 'center',
  },
  detailRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    paddingVertical: 6, 
    borderBottomWidth: 1, 
    borderColor: '#1A1A1A' 
  },
  detailLabel: { 
    color: '#888888', 
    fontSize: 13 
  },
  detailValue: { 
    color: '#FFFFFF', 
    fontSize: 13, 
    fontWeight: '500' 
  },
  renameInputWrapper: {
    width: '100%',
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    height: 50,
    paddingHorizontal: 16,
    justifyContent: 'center',
    marginVertical: 20,
  },
  renameInput: {
    color: '#FFFFFF',
    fontSize: 15,
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  modalCancelBtn: {
    flex: 1,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    marginRight: 10,
  },
  modalCancelBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
  },
  modalSaveBtn: {
    flex: 1,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFB703',
    borderRadius: 12,
    marginLeft: 10,
  },
  modalSaveBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: 'bold',
  },
  menuModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  menuModalContent: {
    backgroundColor: '#161616',
    borderRadius: 12,
    marginTop: 55,
    marginLeft: 16,
    width: 170,
    borderWidth: 1,
    borderColor: '#333333',
  },
  menuOption: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  menuOptionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#262626',
    width: '100%',
  },
  menuSectionHeader: { backgroundColor: '#111', paddingVertical: 4, paddingHorizontal: 14, borderBottomWidth: 1, borderColor: '#262626' },
  menuSectionText: { color: '#555', fontSize: 9, fontWeight: 'bold', letterSpacing: 1 },
  modalIconCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,183,3,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  modalIconEmoji: {
    fontSize: 24,
  },
  modalInput: { backgroundColor: '#161616', borderWidth: 1, borderColor: '#262626', borderRadius: 12, height: 48, paddingHorizontal: 16, color: '#FFF', width: '100%' },
  ijaraInputWrapper: {
    width: '100%',
    marginBottom: 20,
  },
  expenseInputGroup: { width: '100%', marginBottom: 12 },
  inputLabel: { color: '#888', fontSize: 11, marginBottom: 6, fontWeight: 'bold' },
  
  // Calendar Styles
  calendarOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  calendarContent: { backgroundColor: '#111', width: width * 0.85, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#333' },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  calNav: { color: '#FFB703', fontSize: 20, paddingHorizontal: 10 },
  calTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  calWeekRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 10 },
  closeCircle: { backgroundColor: '#1E1E1E', width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  closeCircleText: { color: '#888', fontSize: 14 },
  calWeekDay: { color: '#666', fontSize: 12, width: 35, textAlign: 'center' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around' },
  calDayCell: { width: 35, height: 35, justifyContent: 'center', alignItems: 'center', marginBottom: 5, borderRadius: 17 },
  calDayText: { color: '#FFF', fontSize: 13 },
  calCloseBtn: { marginTop: 20, height: 44, backgroundColor: '#1E1E1E', borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  calCloseBtnText: { color: '#888', fontSize: 14 },
  syncTimerWrapper: { paddingVertical: 4, paddingHorizontal: 12, backgroundColor: '#161616', borderRadius: 8, marginHorizontal: 16, marginTop: 4, marginBottom: 4, alignItems: 'center', borderWidth: 1, borderColor: '#222' },
  syncTimerText: { color: '#FFB703', fontSize: 8, fontWeight: '600', marginVertical: 1 },
});
