import { verifyPinCode, formatDisplayDate, getBusinessDate } from '../database';
import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  Platform,
  StatusBar as RNStatusBar,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { exportDepositReportPDF } from '../pdfHelper';

export default function DailySubmitScreen({ dailyExpenses, completedOrders = [], submissionHistory = [], onUpdateExpenses, isDailySubmitted, userRole, onBack, onSubmit }) {
  const mainScrollRef = useRef(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setKeyboardHeight(e.endCoordinates.height)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardHeight(0)
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const [depositAmount, setDepositAmount] = useState('0');
  const businessDateObj = new Date(Date.now() - 3600000);
  const [selectedMonth, setSelectedMonth] = useState(businessDateObj.getMonth());
  const [selectedYear, setSelectedYear] = useState(businessDateObj.getFullYear());
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const yearsList = [2024, 2025, 2026, 2027, 2028, 2029, 2030];
  const activeFilter = `${monthNames[selectedMonth]} ${selectedYear}`;
  
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [yearPickerVisible, setYearPickerVisible] = useState(false);

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
      // If middle part is month name
      return `${parts[1]} ${parts[2]}`;
    }
    return '';
  };

  const filteredHistory = submissionHistory.filter(item => getMonthName(item.date) === activeFilter);

  // Load from dailyExpenses props
  const [duduMiah, setDuduMiah] = useState(dailyExpenses.duduMiah.toString());
  const [akashChicken, setAkashChicken] = useState(dailyExpenses.akashChicken.toString());
  const [burgerBun, setBurgerBun] = useState(dailyExpenses.burgerBun.toString());
  const [bazar, setBazar] = useState(dailyExpenses.bazar.toString());
  const [bazarNote, setBazarNote] = useState(dailyExpenses.bazarNote || '');
  const [others, setOthers] = useState(dailyExpenses.others.toString());
  const [othersNote, setOthersNote] = useState(dailyExpenses.othersNote || '');

  // Passcode states
  const [submitModalVisible, setSubmitModalVisible] = useState(false);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [pinCode, setPinCode] = useState('');
  const [pinError, setPinError] = useState('');

  // Android Back Handler for Modals
  useEffect(() => {
    const backAction = () => {
      if (submitModalVisible) { setSubmitModalVisible(false); return true; }
      if (historyModalVisible) { setHistoryModalVisible(false); return true; }
      if (monthPickerVisible) { setMonthPickerVisible(false); return true; }
      if (yearPickerVisible) { setYearPickerVisible(false); return true; }
      return false; // Let App.js handle screen back
    };

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      backAction
    );

    return () => backHandler.remove();
  }, [submitModalVisible, historyModalVisible, monthPickerVisible, yearPickerVisible]);

  const numDudu = parseFloat(duduMiah) || 0;
  const numAkash = parseFloat(akashChicken) || 0;
  const numBurger = parseFloat(burgerBun) || 0;
  const numBazar = parseFloat(bazar) || 0;
  const numOthers = parseFloat(others) || 0;

  const totalExpenses = numDudu + numAkash + numBurger + numBazar + numOthers;

  // Date filtering helper for today
  const todayStr = getBusinessDate();

  // Filter orders for today ONLY
  const todaysOrders = completedOrders.filter(order => {
    const orderDate = order.fullDate || todayStr;
    return orderDate === todayStr;
  });

  // Real Sales Data Calculations using new breakdown fields
  const rawCashSell = todaysOrders.reduce((sum, o) => sum + (o.cash_amount || (o.method === 'ক্যাশ' ? o.paidAmount : 0) || 0), 0);
  const bkashSell = todaysOrders.reduce((sum, o) => sum + (o.bkash_amount || (o.method === 'বিকাশ' ? o.paidAmount : 0) || 0), 0);
  const nagadSell = todaysOrders.reduce((sum, o) => sum + (o.nagad_amount || (o.method === 'নগদ' ? o.paidAmount : 0) || 0), 0);
  const rocketSell = todaysOrders.reduce((sum, o) => sum + (o.rocket_amount || (o.method === 'রকেট' ? o.paidAmount : 0) || 0), 0);
  
  // Deduct returned change money from cash sales, as change money is a float return, not a sale
  const totalChangeMoney = todaysOrders.reduce((sum, o) => sum + (o.changeMoneyGiven || 0), 0);
  const cashSell = Math.max(0, rawCashSell - totalChangeMoney);

  const deliverySell = todaysOrders.filter(o => o.tableId && (o.tableId.toString().includes('D-') || o.tableId.toString().includes('Delivery'))).reduce((sum, o) => sum + ((o.paidAmount || 0) - (o.changeMoneyGiven || 0)), 0);
  const deliveryChargeTotal = todaysOrders.reduce((sum, o) => sum + (o.deliveryCharge || 0), 0);
  const totalSell = cashSell + bkashSell + nagadSell + rocketSell;
  
  // Net Cash = মোট বিক্রয় - মোট খরচ
  const netCash = totalSell - totalExpenses;
  const autoDeposit = dailyExpenses.ijara + netCash;

  // Auto-calculate deposit amount when expenses or sales change
  React.useEffect(() => {
    if (!isDailySubmitted || userRole === 'admin') {
      setDepositAmount(autoDeposit.toString());
    }
  }, [totalSell, totalExpenses, dailyExpenses.ijara, isDailySubmitted, userRole]);

  const getFormattedDate = () => {
    return formatDisplayDate(new Date());
  };

  const currentDateText = getFormattedDate();

  const handleFormSubmit = () => {
    const maxAllowedDeposit = dailyExpenses.ijara + netCash;
    const enteredDeposit = parseFloat(depositAmount) || 0;

    if (enteredDeposit > maxAllowedDeposit) {
      Alert.alert(
        "ভুল জমা পরিমাণ",
        `আপনি ইজা + নেট ক্যাশ (৳${maxAllowedDeposit.toLocaleString()}) এর বেশি টাকা জমা দিতে পারবেন না।\n\nইজা: ৳${dailyExpenses.ijara}\nনেট ক্যাশ: ৳${netCash.toLocaleString()}`
      );
      return;
    }

    // Reset pin states and trigger popup modal
    setPinCode('');
    setPinError('');
    setSubmitModalVisible(true);
  };

  const handleModalConfirm = () => {
    // PIN verification - using 1234 matching default credentials
    if (verifyPinCode(pinCode)) {
      setSubmitModalVisible(false);

      // Save to global dailyExpenses state
      onUpdateExpenses({
        duduMiah: numDudu,
        akashChicken: numAkash,
        burgerBun: numBurger,
        bazar: numBazar,
        bazarNote: bazarNote,
        others: numOthers,
        othersNote: othersNote,
        ijara: dailyExpenses.ijara 
      });

      const summary = {
        date: currentDateText,
        bizDate: todayStr,
        sell: totalSell,
        expense: totalExpenses,
        deposit: parseFloat(depositAmount) || 0,
        net_cash: netCash,
        notes: othersNote,
        breakdown: {
          cash: cashSell,
          bkash: bkashSell,
          nagad: nagadSell,
          rocket: rocketSell,
          delivery_sell: deliverySell,
          delivery_charge: deliveryChargeTotal,
          ijara: dailyExpenses.ijara,
          dudu: numDudu,
          akash: numAkash,
          burger: numBurger,
          bazar: numBazar,
          others: numOthers
        }
      };

      Alert.alert(
        "দৈনিক শিট সাবমিট সফল",
        `৳ ${depositAmount} মালিকের কাছে সফলভাবে জমা দেওয়া হয়েছে!`,
        [
          { text: "ঠিক আছে", onPress: () => onSubmit(summary) }
        ]
      );
    } else {
      setPinError('ভুল পিন নম্বর! অনুগ্রহ করে সঠিক পিন দিন।');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backArrow}>⬅</Text>
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>দৈনিক সাবমিট শীট</Text>
            <Text style={styles.headerSub}>রংধনু ক্যাফে এন্ড রেস্টুরেন্ট</Text>
          </View>
        </View>
        <View style={styles.datePickerBtn}>
          <Text style={styles.datePickerText}>📅 {currentDateText}</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          ref={mainScrollRef}
          showsVerticalScrollIndicator={false}
          style={styles.scrollBody}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scrollContent, { paddingBottom: keyboardHeight > 0 ? keyboardHeight + 80 : 80 }]}
        >
          {/* Section 1: Large Summary Card */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryCardHeader}>
            <Text style={styles.summaryDateLabel}>📅 ব্যবসায়িক তারিখ (Business Date)</Text>
            <Text style={styles.summaryDateValue}>{currentDateText}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summarySalesRow}>
            <View>
              <Text style={styles.summarySalesLabel}>💰 মোট বিক্রয় (Total Sales)</Text>
              <Text style={styles.summarySalesSubtext}>সকল পেমেন্ট গেটওয়ে সহ</Text>
            </View>
            <Text style={styles.summarySalesValue}>৳ {totalSell.toLocaleString()}</Text>
          </View>
        </View>

        {/* Section 2: Large Expense Card */}
        <View style={styles.expenseCardContainer}>
          <View style={styles.expenseHeaderRow}>
            <View>
              <Text style={styles.expenseHeaderLabel}>📉 মোট খরচ (Total Expenses)</Text>
              <Text style={styles.expenseHeaderSub}>আজকের সকল খরচের বিবরণ</Text>
            </View>
            <Text style={styles.expenseHeaderValue}>৳ {totalExpenses.toLocaleString()}</Text>
          </View>
          
          <View style={styles.expenseDivider} />

          {/* Dudu Miah */}
          <View style={styles.expenseRow}>
            <Text style={styles.expenseRowLabel}>🛍️ দুদু মিয়া খরচ</Text>
            <Text style={styles.expenseRowValue}>৳ {numDudu.toLocaleString()}</Text>
          </View>

          {/* Akash Chicken */}
          <View style={styles.expenseRow}>
            <Text style={styles.expenseRowLabel}>🐔 আকাশ মুরগী খরচ</Text>
            <Text style={styles.expenseRowValue}>৳ {numAkash.toLocaleString()}</Text>
          </View>

          {/* Burger Bun */}
          <View style={styles.expenseRow}>
            <Text style={styles.expenseRowLabel}>🍔 বার্গার বান খরচ</Text>
            <Text style={styles.expenseRowValue}>৳ {numBurger.toLocaleString()}</Text>
          </View>

          {/* Bazar */}
          <View style={styles.expenseRow}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.expenseRowLabel}>🛒 বাজার খরচ</Text>
              {bazarNote ? <Text style={styles.expenseRowNote}>📝 {bazarNote}</Text> : null}
            </View>
            <Text style={styles.expenseRowValue}>৳ {numBazar.toLocaleString()}</Text>
          </View>

          {/* Others */}
          <View style={[styles.expenseRow, { borderBottomWidth: 0 }]}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.expenseRowLabel}>📦 অন্যান্য খরচ</Text>
              {othersNote ? <Text style={styles.expenseRowNote}>📝 {othersNote}</Text> : null}
            </View>
            <Text style={styles.expenseRowValue}>৳ {numOthers.toLocaleString()}</Text>
          </View>
        </View>

        {/* Section 3: Final Calculations Grid (Net Cash & Owner Deposit Cards Side-by-Side) */}
        <View style={styles.gridContainer}>
          {/* Card 1: Net Cash */}
          <View style={styles.gridCardNetCash}>
            <Text style={styles.gridCardIcon}>💵</Text>
            <Text style={styles.gridCardLabel}>নেট ক্যাশ (Net Cash)</Text>
            <Text style={styles.gridCardValueNetCash}>৳ {netCash.toLocaleString()}</Text>
          </View>

          {/* Card 2: Owner Deposit */}
          <View style={styles.gridCardDeposit}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
              <Text style={styles.gridCardIconSmall}>🏦</Text>
              <Text style={styles.gridCardLabelDeposit}>মালিককে জমা</Text>
            </View>
            <View style={[styles.depositMiniInputRow, (isDailySubmitted && userRole !== 'admin') && styles.disabledMiniInputRow]}>
              <Text style={[styles.miniCurrencySymbol, (isDailySubmitted && userRole !== 'admin') && styles.disabledInputText]}>৳</Text>
              <TextInput
                style={[styles.miniDepositInput, (isDailySubmitted && userRole !== 'admin') && styles.disabledInputText]}
                keyboardType="numeric"
                value={depositAmount}
                onChangeText={setDepositAmount}
                placeholder="0"
                placeholderTextColor="#666666"
                editable={!isDailySubmitted || userRole === 'admin'}
              />
            </View>
          </View>
        </View>

        {/* Card 4: Next Day Opening Ija (Live Calculation Read-Only) */}
        <View style={styles.ijaraCardContainer}>
          <View style={styles.summaryCardHeader}>
            <Text style={styles.ijaraCardTitle}>✨ পরবর্তী দিনের প্রারম্ভিক ইজা (Next Day Opening Ija)</Text>
            <Text style={styles.ijaraEmoji}>🏛️</Text>
          </View>
          <Text style={styles.ijaraAmountValue}>
            ৳ {Math.max(0, (cashSell + (dailyExpenses.ijara || 0) - totalExpenses) - (parseFloat(depositAmount) || 0)).toLocaleString()}
          </Text>
          <Text style={styles.ijaraSubtext}>
            পরবর্তী ব্যবসায়িক দিনে এটি স্বয়ংক্রিয়ভাবে প্রারম্ভিক বেলেন্স হবে।
          </Text>
        </View>

        {/* Note Warning Box */}
        <View style={styles.warningCard}>
          <Text style={styles.warningIcon}>{(isDailySubmitted && userRole !== 'admin') ? '🔒' : '⚡'}</Text>
          <Text style={styles.warningText}>
            {isDailySubmitted
              ? (userRole === 'admin'
                  ? 'আজকের ডেইলি শীট জমা দেওয়া হয়েছে, কিন্তু আপনি এডমিন হওয়ায় হিসাব সংশোধন বা পুনরায় সাবমিট করতে পারবেন।'
                  : 'আজকের ডেইলি শীট সফলভাবে জমা দেওয়া হয়েছে এবং সব তথ্য লক করা আছে।')
              : 'নোট: সঠিক তথ্য দিয়ে সাবমিট করুন। সাবমিট করার পর আর পরিবর্তন করা যাবে না।'}
          </Text>
        </View>

        {/* Section 4: Submit Button */}
        {(!isDailySubmitted || userRole === 'admin') ? (
          <TouchableOpacity style={styles.submitBtn} onPress={handleFormSubmit} activeOpacity={0.85}>
            <Text style={styles.submitCheckText}>✓</Text>
            <Text style={styles.submitBtnText}>{isDailySubmitted ? 'পুনরায় সাবমিট করুন' : 'শিট সাবমিট করুন'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.lockedBtn}>
            <Text style={styles.lockedBtnText}>🔒 আজকের ডেইলি শীট জমা দেওয়া হয়েছে</Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>

      {/* PIN Verification Popup Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={submitModalVisible}
        onRequestClose={() => setSubmitModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalIconCircle}>
              <Text style={styles.modalIconEmoji}>⚠️</Text>
            </View>
            
            <Text style={styles.modalTitle}>দৈনিক শিট সাবমিট</Text>
            
            <Text style={styles.modalWarningText}>
              সাবধান! এটি দিনে মাত্র একবারই করা যাবে। সাবমিট করার পর কোনো তথ্য আর পরিবর্তন করা যাবে না।
            </Text>

            <View style={styles.pinInputWrapper}>
              <TextInput
                style={styles.pinInput}
                keyboardType="numeric"
                secureTextEntry={true}
                maxLength={4}
                value={pinCode}
                onChangeText={(text) => {
                  setPinCode(text);
                  if (pinError) setPinError('');
                }}
                placeholder="৪-সংখ্যার পিন লিখুন"
                placeholderTextColor="#666666"
                autoFocus={true}
              />
            </View>

            {pinError ? (
              <Text style={styles.pinErrorText}>{pinError}</Text>
            ) : null}

            <View style={styles.modalBtnRow}>
              <TouchableOpacity 
                style={styles.modalCancelBtn} 
                onPress={() => setSubmitModalVisible(false)}
              >
                <Text style={styles.modalCancelBtnText}>বাতিল</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.modalSaveBtn} 
                onPress={handleModalConfirm}
              >
                <Text style={styles.modalSaveBtnText}>নিশ্চিত করুন</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Monthly History Modal (Google Sheet Style) */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={historyModalVisible}
        onRequestClose={() => setHistoryModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { width: '95%', maxHeight: '90%', paddingHorizontal: 16 }]}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.modalHeaderLeft}>
                <View style={[styles.modalIconCircle, { marginBottom: 0, width: 40, height: 40, marginRight: 10 }]}>
                  <Text style={[styles.modalIconEmoji, { fontSize: 18 }]}>📊</Text>
                </View>
                <View>
                <Text style={[styles.modalTitle, { textAlign: 'left', marginBottom: 2 }]}>মাসিক জমা রিপোর্ট</Text>
                <Text style={[styles.modalSubtitle, { marginBottom: 0 }]}>রংধনু ক্যাফে এন্ড রেস্টুরেন্ট</Text>
                </View>
                </View>
                <TouchableOpacity onPress={() => setHistoryModalVisible(false)} style={styles.closeCircle}>
                <Text style={styles.closeCircleText}>✕</Text>
                </TouchableOpacity>
                </View>

                {/* Month & Year Selection */}
                <View style={{ flexDirection: 'row', gap: 8, width: '100%', marginBottom: 12 }}>
                  <TouchableOpacity 
                    style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1E1E1E', padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#333' }} 
                    onPress={() => setMonthPickerVisible(true)}
                  >
                    <Text style={{ color: '#FFF', fontSize: 13, fontWeight: 'bold' }}>{monthNames[selectedMonth]}</Text>
                    <Text style={{ color: '#FFB703', fontSize: 10 }}>মাস ▼</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1E1E1E', padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#333' }} 
                    onPress={() => setYearPickerVisible(true)}
                  >
                    <Text style={{ color: '#FFF', fontSize: 13, fontWeight: 'bold' }}>{selectedYear}</Text>
                    <Text style={{ color: '#FFB703', fontSize: 10 }}>বছর ▼</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.sheetContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={true}>
                <View>
                {/* Header Row */}
                <View style={styles.sheetHeader}>
                  <Text style={[styles.sheetHeaderText, { width: 100, textAlign: 'left' }]}>তারিখ</Text>
                  <Text style={[styles.sheetHeaderText, { width: 80 }]}>মোট বিক্রয়</Text>
                  <Text style={[styles.sheetHeaderText, { width: 70 }]}>bKash</Text>
                  <Text style={[styles.sheetHeaderText, { width: 70 }]}>Nagad</Text>
                  <Text style={[styles.sheetHeaderText, { width: 70 }]}>Cash</Text>
                  <Text style={[styles.sheetHeaderText, { width: 70 }]}>🏛️ ইজা</Text>
                  <Text style={[styles.sheetHeaderText, { width: 80 }]}>মোট খরচ</Text>
                  <Text style={[styles.sheetHeaderText, { width: 80 }]}>জমা</Text>
                </View>

                <ScrollView style={styles.sheetBody}>
                  {filteredHistory.length === 0 ? (
                    <Text style={[styles.emptySheetText, { width: 1100 }]}>কোনো জমা ইতিহাস পাওয়া যায়নি।</Text>
                  ) : (
                    filteredHistory.map((item, index) => (
                      <View key={index} style={[styles.sheetRow, index % 2 === 1 && styles.sheetRowAlt]}>
                        <Text style={[styles.sheetCell, { width: 100, textAlign: 'left' }]}>{formatDisplayDate(item.date)}</Text>
                        <Text style={[styles.sheetCell, { width: 80, fontWeight: 'bold' }]}>৳{item.sell.toLocaleString()}</Text>
                        <Text style={[styles.sheetCell, { width: 70 }]}>৳{item.breakdown?.bkash || 0}</Text>
                        <Text style={[styles.sheetCell, { width: 70 }]}>৳{item.breakdown?.nagad || 0}</Text>
                        <Text style={[styles.sheetCell, { width: 70 }]}>৳{item.breakdown?.cash || 0}</Text>
                        <Text style={[styles.sheetCell, { width: 70 }]}>৳{item.breakdown?.ijara || 0}</Text>
                        <Text style={[styles.sheetCell, { width: 80, color: '#EF4444' }]}>৳{item.expense.toLocaleString()}</Text>
                        <Text style={[styles.sheetCell, { width: 80, color: '#34D399', fontWeight: 'bold' }]}>৳{item.deposit.toLocaleString()}</Text>
                      </View>
                    ))
                  )}

                  {/* Monthly Totals Row */}
                  {filteredHistory.length > 0 && (
                    <View style={styles.sheetFooter}>
                      <Text style={[styles.sheetFooterText, { width: 100, textAlign: 'left' }]}>মোট (Total)</Text>
                      <Text style={[styles.sheetFooterText, { width: 80 }]}>
                        ৳{filteredHistory.reduce((sum, i) => sum + i.sell, 0).toLocaleString()}
                      </Text>
                      <Text style={[styles.sheetFooterText, { width: 70 }]}>
                        ৳{filteredHistory.reduce((sum, i) => sum + (i.breakdown?.bkash || 0), 0).toLocaleString()}
                      </Text>
                      <Text style={[styles.sheetFooterText, { width: 70 }]}>
                        ৳{filteredHistory.reduce((sum, i) => sum + (i.breakdown?.nagad || 0), 0).toLocaleString()}
                      </Text>
                      <Text style={[styles.sheetFooterText, { width: 70 }]}>
                        ৳{filteredHistory.reduce((sum, i) => sum + (i.breakdown?.cash || 0), 0).toLocaleString()}
                      </Text>
                      <Text style={[styles.sheetFooterText, { width: 70 }]}>
                        ৳{filteredHistory.reduce((sum, i) => sum + (i.breakdown?.ijara || 0), 0).toLocaleString()}
                      </Text>
                      <Text style={[styles.sheetFooterText, { width: 80 }]}>
                        ৳{filteredHistory.reduce((sum, i) => sum + i.expense, 0).toLocaleString()}
                      </Text>
                      <Text style={[styles.sheetFooterText, { width: 80, color: '#34D399' }]}>
                        ৳{filteredHistory.reduce((sum, i) => sum + i.deposit, 0).toLocaleString()}
                      </Text>
                    </View>
                  )}
                </ScrollView>

                </View>
                </ScrollView>
                </View>

                {/* Expense Breakdown Summary Section */}
                {filteredHistory.length > 0 && (
                <View style={styles.breakdownSummaryCard}>
                <Text style={styles.breakdownTitle}>📉 মাসিক খরচের বিবরণ (Breakdown)</Text>
                <View style={styles.breakdownGrid}>
                <View style={styles.breakdownItem}>
                  <Text style={styles.breakdownLabel}>🛍️ দুদু মিয়া:</Text>
                  <Text style={styles.breakdownValue}>৳{filteredHistory.reduce((sum, i) => sum + (i.breakdown?.dudu || 0), 0).toLocaleString()}</Text>
                </View>
                <View style={styles.breakdownItem}>
                  <Text style={styles.breakdownLabel}>🐔 আকাশ মুরগী:</Text>
                  <Text style={styles.breakdownValue}>৳{filteredHistory.reduce((sum, i) => sum + (i.breakdown?.akash || 0), 0).toLocaleString()}</Text>
                </View>
                <View style={styles.breakdownItem}>
                  <Text style={styles.breakdownLabel}>🍔 বার্গার বান:</Text>
                  <Text style={styles.breakdownValue}>৳{filteredHistory.reduce((sum, i) => sum + (i.breakdown?.burger || 0), 0).toLocaleString()}</Text>
                </View>
                <View style={styles.breakdownItem}>
                  <Text style={styles.breakdownLabel}>🛒 বাজার খরচ:</Text>
                  <Text style={styles.breakdownValue}>৳{filteredHistory.reduce((sum, i) => sum + (i.breakdown?.bazar || 0), 0).toLocaleString()}</Text>
                </View>
                <View style={styles.breakdownItem}>
                  <Text style={styles.breakdownLabel}>📦 অন্যান্য:</Text>
                  <Text style={styles.breakdownValue}>৳{filteredHistory.reduce((sum, i) => sum + (i.breakdown?.others || 0), 0).toLocaleString()}</Text>
                </View>
                </View>
                </View>
                )}

                <View style={styles.modalFooterActions}>
                <TouchableOpacity 
                style={styles.exportBtn} 
                onPress={() => exportDepositReportPDF(filteredHistory, activeFilter)}
                >
                <Text style={styles.exportBtnIcon}>📄</Text>
                <Text style={styles.exportBtnText}>PDF ডাউনলোড</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                style={styles.historyCloseBtn} 
                onPress={() => setHistoryModalVisible(false)}
                >
                <Text style={styles.historyCloseBtnText}>বন্ধ করুন</Text>
                </TouchableOpacity>
                </View>

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
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
  backButton: {
    marginRight: 16,
    padding: 4,
  },
  backArrow: {
    fontSize: 20,
    color: '#FFB703',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  headerSub: {
    fontSize: 11,
    color: '#888888',
    marginTop: 4,
  },
  datePickerBtn: {
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  datePickerText: {
    color: '#FFB703',
    fontSize: 11,
    fontWeight: 'bold',
  },
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 60,
  },
  lockedBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  lockedBannerText: {
    fontSize: 12,
    color: '#FCA5A5',
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 16,
  },
  sectionCard: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#161616',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  sectionHeaderRow: {
    marginBottom: 12,
  },
  sectionTitleGreen: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#34D399',
  },
  sectionTitleRed: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#EF4444',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  rowBorder: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#161616',
  },
  rowBorderNoBorder: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  rowLabel: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  rowValueHighlight: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  rowValueHighlightRed: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#EF4444',
  },
  rowSubLabel: {
    fontSize: 13,
    color: '#888888',
  },
  rowSubValue: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  netCashCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(52, 211, 153, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.2)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  netCashLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  walletIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  netCashTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  netCashFormula: {
    fontSize: 10,
    color: '#A7F3D0',
    marginTop: 4,
    lineHeight: 14,
  },
  netCashValueBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  netCashValueText: {
    color: '#34D399',
    fontSize: 16,
    fontWeight: 'bold',
  },
  depositCard: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#161616',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  depositLabel: {
    fontSize: 13,
    color: '#888888',
    marginBottom: 10,
  },
  depositInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    height: 52,
    paddingHorizontal: 16,
  },
  currencySymbol: {
    color: '#FFFFFF',
    fontSize: 18,
    marginRight: 6,
    fontWeight: 'bold',
  },
  depositInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    height: '100%',
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 183, 3, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 183, 3, 0.15)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  warningIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 11,
    color: '#888888',
    lineHeight: 16,
  },
  submitBtn: {
    flexDirection: 'row',
    backgroundColor: '#FFB703',
    height: 54,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFB703',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  submitCheckText: {
    color: '#000000',
    fontSize: 18,
    fontWeight: 'bold',
    marginRight: 8,
  },
  submitBtnText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: 'bold',
  },
  lockedBtn: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    height: 54,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lockedBtnText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: 'bold',
  },
  rowBorderInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#161616',
  },
  rowBorderNoBorderInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  rowSubLabelInput: {
    fontSize: 13,
    color: '#888888',
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 8,
    width: 120,
    height: 38,
    paddingHorizontal: 8,
  },
  disabledInputRow: {
    backgroundColor: '#0B0B0B',
    borderColor: '#181818',
    opacity: 0.6,
  },
  currencySymbolInput: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: 'bold',
    marginRight: 4,
  },
  disabledInputText: {
    color: '#666666',
  },
  expenseInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
    height: '100%',
    textAlign: 'right',
  },
  noteContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#1C1C1C',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 36,
    marginTop: 2,
    marginBottom: 10,
  },
  noteLabel: {
    fontSize: 11,
    color: '#FFB703',
    marginRight: 6,
    fontWeight: 'bold',
  },
  noteInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 12,
    padding: 0,
    height: '100%',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
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
    shadowColor: '#FFB703',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 15,
    elevation: 8,
  },
  modalIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 183, 3, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 183, 3, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalIconEmoji: {
    fontSize: 28,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 10,
    textAlign: 'center',
  },
  modalWarningText: {
    fontSize: 12,
    color: '#FCA5A5',
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 20,
  },
  pinInputWrapper: {
    width: '100%',
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    height: 50,
    paddingHorizontal: 16,
    justifyContent: 'center',
    marginBottom: 10,
  },
  pinInput: {
    color: '#FFFFFF',
    fontSize: 16,
    textAlign: 'center',
    fontWeight: 'bold',
    letterSpacing: 8,
  },
  pinErrorText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 14,
    textAlign: 'center',
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 10,
  },
  modalCancelBtn: {
    flex: 1,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#262626',
  },
  modalCancelBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  modalSaveBtn: {
    flex: 1,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFB703',
    borderRadius: 12,
    marginLeft: 8,
  },
  modalSaveBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: 'bold',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  closeCircle: {
    backgroundColor: '#1E1E1E',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  closeCircleText: {
    color: '#888',
    fontSize: 12,
    fontWeight: 'bold',
  },
  breakdownSummaryCard: {
    width: '100%',
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
  },
  breakdownTitle: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  breakdownGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  breakdownItem: {
    width: '48%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  breakdownLabel: {
    color: '#888',
    fontSize: 10,
  },
  breakdownValue: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '500',
  },
  modalFooterActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 20,
  },
  exportBtn: {
    flex: 1.4,
    flexDirection: 'row',
    height: 50,
    backgroundColor: '#34D399',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  exportBtnIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  exportBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: 'bold',
  },
  historyCloseBtn: {
    flex: 1,
    height: 50,
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  historyCloseBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  // Google Sheet Style Table
  sheetContainer: {
    width: '100%',
    backgroundColor: '#111111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    overflow: 'hidden',
    marginTop: 10,
  },
  sheetHeader: {
    flexDirection: 'row',
    backgroundColor: '#262626',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderColor: '#444',
  },
  sheetHeaderText: {
    color: '#FFB703',
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  sheetBody: {
    maxHeight: 350,
  },
  sheetRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderColor: '#222',
  },
  sheetRowAlt: {
    backgroundColor: '#0A0A0A',
  },
  sheetCell: {
    color: '#FFFFFF',
    fontSize: 10,
    textAlign: 'center',
  },
  sheetFooter: {
    flexDirection: 'row',
    backgroundColor: '#1A1A1A',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderTopWidth: 2,
    borderColor: '#FFB703',
  },
  sheetFooterText: {
    color: '#FFB703',
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  emptySheetText: {
    color: '#888',
    textAlign: 'center',
    padding: 20,
    fontSize: 12,
  },
  summaryCard: {
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  summaryCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryDateLabel: {
    fontSize: 12,
    color: '#a1a1aa',
    fontWeight: '500',
  },
  summaryDateValue: {
    fontSize: 13,
    color: '#ffffff',
    fontWeight: 'bold',
  },
  summaryDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginVertical: 12,
  },
  summarySalesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summarySalesLabel: {
    fontSize: 15,
    color: '#ffffff',
    fontWeight: 'bold',
  },
  summarySalesSubtext: {
    fontSize: 11,
    color: '#71717a',
    marginTop: 2,
  },
  summarySalesValue: {
    fontSize: 22,
    color: '#34d399',
    fontWeight: '900',
  },
  expenseCardContainer: {
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  expenseHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  expenseHeaderLabel: {
    fontSize: 15,
    color: '#ffffff',
    fontWeight: 'bold',
  },
  expenseHeaderSub: {
    fontSize: 11,
    color: '#71717a',
    marginTop: 2,
  },
  expenseHeaderValue: {
    fontSize: 22,
    color: '#ef4444',
    fontWeight: '900',
  },
  expenseDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginVertical: 12,
  },
  expenseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
  },
  expenseRowLabel: {
    fontSize: 13,
    color: '#d4d4d8',
    fontWeight: '500',
  },
  expenseRowNote: {
    fontSize: 11,
    color: '#f59e0b',
    marginTop: 2,
    fontStyle: 'italic',
  },
  expenseRowValue: {
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '600',
  },
  gridContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  gridCardNetCash: {
    flex: 1,
    backgroundColor: 'rgba(16, 185, 129, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.15)',
    borderRadius: 16,
    padding: 14,
    justifyContent: 'center',
  },
  gridCardDeposit: {
    flex: 1,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 14,
    justifyContent: 'center',
  },
  gridCardIcon: {
    fontSize: 20,
    marginBottom: 6,
  },
  gridCardIconSmall: {
    fontSize: 16,
    marginRight: 6,
  },
  gridCardLabel: {
    fontSize: 11,
    color: '#a1a1aa',
    fontWeight: 'bold',
    marginBottom: 6,
  },
  gridCardLabelDeposit: {
    fontSize: 11,
    color: '#a1a1aa',
    fontWeight: 'bold',
  },
  gridCardValueNetCash: {
    fontSize: 18,
    color: '#34d399',
    fontWeight: 'bold',
  },
  depositMiniInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#09090b',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    height: 38,
    paddingHorizontal: 8,
    marginTop: 4,
  },
  disabledMiniInputRow: {
    backgroundColor: '#121214',
    borderColor: 'rgba(255, 255, 255, 0.03)',
    opacity: 0.6,
  },
  miniCurrencySymbol: {
    fontSize: 14,
    color: '#FFB703',
    fontWeight: 'bold',
    marginRight: 4,
  },
  miniDepositInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    height: '100%',
    padding: 0,
  },
  ijaraCardContainer: {
    backgroundColor: '#1E1E24',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 183, 3, 0.3)',
  },
  ijaraCardTitle: {
    color: '#FFB703',
    fontSize: 13,
    fontWeight: 'bold',
    flex: 1,
  },
  ijaraEmoji: {
    fontSize: 18,
  },
  ijaraAmountValue: {
    fontSize: 24,
    color: '#FFB703',
    fontWeight: '900',
    marginVertical: 6,
  },
  ijaraSubtext: {
    color: '#A1A1AA',
    fontSize: 11,
  },
});
