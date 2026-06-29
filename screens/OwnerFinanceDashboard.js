import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

// Access Denied Screen Component
const AccessDenied = ({ onBack }) => (
  <View style={styles.accessDeniedContainer}>
    <Text style={styles.accessDeniedEmoji}>🚫</Text>
    <Text style={styles.accessDeniedTitle}>প্রবেশাধিকার সংরক্ষিত</Text>
    <Text style={styles.accessDeniedSubtitle}>আপনার এই মডিউলে প্রবেশ করার অনুমতি নেই।</Text>
    <TouchableOpacity style={styles.accessDeniedButton} onPress={onBack}>
      <Text style={styles.accessDeniedButtonText}>ফিরে যান</Text>
    </TouchableOpacity>
  </View>
);

export default function OwnerFinanceDashboard({
  userRole,
  onBack,
  onNavigateToEmployees,
  onNavigateToExpenses
}) {
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState('');
  
  // Dashboard Metrics
  const [metrics, setMetrics] = useState({
    ownerWithdrawn: 0,
    salaryPaid: 0,
    ownerExpenses: 0,
    netSavings: 0,
    totalDeposit: 0,
    isClosed: false
  });

  // Employee overview stats
  const [employeeStats, setEmployeeStats] = useState({
    total: 0,
    active: 0,
    inactive: 0,
    totalSalary: 0
  });

  // Warning Modal States (Previous Month Open Warning)
  const [warningModalVisible, setWarningModalVisible] = useState(false);
  const [prevMonthName, setPrevMonthName] = useState('');
  const [prevMonthStr, setPrevMonthStr] = useState('');

  // PIN verification states
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [enteredPin, setEnteredPin] = useState('');
  const [pinAction, setPinAction] = useState('CLOSE'); // CLOSE or UNLOCK

  useEffect(() => {
    if (userRole === 'owner' || userRole === 'admin') {
      const todayMonth = new Date().toISOString().substring(0, 7);
      setCurrentMonth(todayMonth);
      checkPreviousMonthOpen(todayMonth);
    } else {
      setLoading(false);
    }
  }, [userRole]);

  useEffect(() => {
    if ((userRole === 'owner' || userRole === 'admin') && currentMonth) {
      loadDashboardData();
    }
  }, [currentMonth]);

  const getPreviousMonthString = (monthStr) => {
    if (!monthStr) return '';
    const parts = monthStr.split('-');
    let y = parseInt(parts[0]);
    let m = parseInt(parts[1]);
    m--;
    if (m === 0) {
      m = 12;
      y--;
    }
    return `${y}-${m.toString().padStart(2, '0')}`;
  };

  const checkPreviousMonthOpen = (todayMonth) => {
    try {
      const { getOwnerDepositByMonth } = require('../database');
      const prev = getPreviousMonthString(todayMonth);
      const isPrevClosed = getOwnerDepositByMonth(prev) !== null;
      if (!isPrevClosed) {
        setPrevMonthStr(prev);
        setPrevMonthName(getMonthNameBangla(prev));
        setWarningModalVisible(true);
      }
    } catch (err) {
      console.error("[OwnerFinanceDashboard] Error checking previous month:", err);
    }
  };

  const loadDashboardData = () => {
    setLoading(true);
    try {
      const {
        getOwnerEmployees,
        getMonthlyRestaurantDeposits,
        getMonthlyTotalSalaryPaid,
        getOwnerExpenseSummary,
        getTotalOwnerDeposits,
        getOwnerDepositByMonth
      } = require('../database');

      // 1. Employees overview
      const employees = getOwnerEmployees();
      const total = employees.length;
      const active = employees.filter(e => e.status === 'ACTIVE').length;
      const inactive = employees.filter(e => e.status === 'INACTIVE').length;
      const totalSalary = employees
        .filter(e => e.status === 'ACTIVE')
        .reduce((sum, e) => sum + (e.monthly_salary || 0), 0);
      setEmployeeStats({ total, active, inactive, totalSalary });

      // 2. Financial Metrics for the selected month
      const withdrawn = getMonthlyRestaurantDeposits(currentMonth);
      const salPaid = getMonthlyTotalSalaryPaid(currentMonth);
      const expSum = getOwnerExpenseSummary(currentMonth);
      const ownerExp = expSum.total;
      
      const netSave = withdrawn - salPaid - ownerExp;
      const totDeposit = getTotalOwnerDeposits();
      
      const depositRecord = getOwnerDepositByMonth(currentMonth);
      const isClosed = depositRecord !== null;

      setMetrics({
        ownerWithdrawn: withdrawn,
        salaryPaid: salPaid,
        ownerExpenses: ownerExp,
        netSavings: netSave,
        totalDeposit: totDeposit,
        isClosed
      });
    } catch (err) {
      console.error("[OwnerFinanceDashboard] Error loading data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handlePrevMonth = () => {
    const parts = currentMonth.split('-');
    let y = parseInt(parts[0]);
    let m = parseInt(parts[1]);
    m--;
    if (m === 0) {
      m = 12;
      y--;
    }
    setCurrentMonth(`${y}-${m.toString().padStart(2, '0')}`);
  };

  const handleNextMonth = () => {
    const parts = currentMonth.split('-');
    let y = parseInt(parts[0]);
    let m = parseInt(parts[1]);
    m++;
    if (m === 13) {
      m = 1;
      y++;
    }
    setCurrentMonth(`${y}-${m.toString().padStart(2, '0')}`);
  };

  const handleCloseMonthTrigger = () => {
    const todayMonth = new Date().toISOString().substring(0, 7);
    if (currentMonth >= todayMonth) {
      Alert.alert("সীমাবদ্ধতা", "মাস শেষ হওয়ার আগে মাস বন্ধ করা যাবে না");
      return;
    }

    // Trigger PIN prompt Modal
    setPinAction('CLOSE');
    setEnteredPin('');
    setPinModalVisible(true);
  };

  const handleUnlockMonthTrigger = () => {
    Alert.alert(
      "⚠️ আপনি কি নিশ্চিত?",
      "এই মাস Unlock করলে পুনরায় পরিবর্তন করা যাবে।",
      [
        {
          text: "Unlock",
          onPress: () => {
            setPinAction('UNLOCK');
            setEnteredPin('');
            setPinModalVisible(true);
          }
        },
        {
          text: "Cancel",
          style: "cancel"
        }
      ]
    );
  };

  const handleVerifyPinAndAction = () => {
    try {
      const { verifyOwnerOrAdminPin, deleteOwnerDepositByMonth, insertNotification } = require('../database');
      const role = verifyOwnerOrAdminPin(enteredPin);
      if (!role) {
        Alert.alert("ত্রুটি", "ভুল PIN");
        return;
      }

      setPinModalVisible(false);

      if (pinAction === 'CLOSE') {
        // Prompt for Deposit confirmation
        Alert.alert(
          "মাস বন্ধ নিশ্চিতকরণ",
          "Net Savings কে Owner Deposit হিসেবে সংরক্ষণ করবেন?",
          [
            {
              text: "হ্যাঁ",
              onPress: () => performMonthClose(true)
            },
            {
              text: "না",
              onPress: () => performMonthClose(false)
            },
            {
              text: "বাতিল",
              style: "cancel"
            }
          ]
        );
      } else if (pinAction === 'UNLOCK') {
        const success = deleteOwnerDepositByMonth(currentMonth);
        if (success) {
          const displayRole = role === 'owner' ? 'Owner' : 'Admin';
          insertNotification("Owner Finance", `Owner Finance: ${currentMonth} month unlocked by ${displayRole}`);
          
          Alert.alert("সফল", `${getMonthNameBangla(currentMonth)} মাস সফলভাবে আনলক করা হয়েছে।`);
          loadDashboardData();
        } else {
          Alert.alert("ত্রুটি", "মাস আনলক করতে ব্যর্থ হয়েছে।");
        }
      }
    } catch (err) {
      console.error("[OwnerFinanceDashboard] PIN verification error:", err);
      Alert.alert("ত্রুটি", "ভুল PIN");
    }
  };

  const performMonthClose = (saveDeposit) => {
    try {
      const { saveOwnerDeposit } = require('../database');
      const depositAmount = saveDeposit ? metrics.netSavings : 0;
      
      const payload = {
        month: currentMonth,
        amount: depositAmount
      };

      const successId = saveOwnerDeposit(payload);
      if (successId) {
        Alert.alert("সফল", `${getMonthNameBangla(currentMonth)} এর হিসাব বন্ধ করা হয়েছে।`);
        loadDashboardData();
      } else {
        Alert.alert("ত্রুটি", "মাস বন্ধ করতে ব্যর্থ হয়েছে।");
      }
    } catch (err) {
      console.error("[OwnerFinanceDashboard] Month close error:", err);
      Alert.alert("ত্রুটি", "মাস বন্ধ করতে ব্যর্থ হয়েছে।");
    }
  };

  const getMonthNameBangla = (monthStr) => {
    if (!monthStr) return '';
    const parts = monthStr.split('-');
    const m = parts[1];
    const y = parts[0];
    const monthNames = {
      '01': 'জানুয়ারি', '02': 'ফেব্রুয়ারি', '03': 'মার্চ', '04': 'এপ্রিল',
      '05': 'মে', '06': 'জুন', '07': 'জুলাই', '08': 'আগস্ট',
      '09': 'সেপ্টেম্বর', '10': 'অক্টোবর', '11': 'নভেম্বর', '12': 'ডিসেম্বর'
    };
    return `${monthNames[m] || ''} ${y}`;
  };

  if (userRole !== 'owner' && userRole !== 'admin') {
    return <AccessDenied onBack={onBack} />;
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FFB703" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>◁ ফিরে যান</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>💼 ওনার ফাইনান্স</Text>
        <View style={{ width: 80 }} />
      </View>

      {/* Month Picker selector */}
      <View style={styles.monthSelectorBar}>
        <TouchableOpacity style={styles.navMonthBtn} onPress={handlePrevMonth}>
          <Text style={styles.navMonthBtnText}>◀</Text>
        </TouchableOpacity>
        <View style={styles.monthLabelCol}>
          <Text style={styles.currentMonthLabel}>{getMonthNameBangla(currentMonth)}</Text>
          <View style={[styles.statusBadge, metrics.isClosed ? styles.badgeClosed : styles.badgeOpen]}>
            <Text style={[styles.statusText, metrics.isClosed ? styles.textClosed : styles.textOpen]}>
              {metrics.isClosed ? '🔒 CLOSED (মাস বন্ধ)' : '🔓 OPEN (চলমান)'}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.navMonthBtn} onPress={handleNextMonth}>
          <Text style={styles.navMonthBtnText}>▶</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Total Owner Deposit Card */}
        <View style={styles.depositBox}>
          <Text style={styles.depositLabel}>🏦 সর্বমোট ওনার ডিপোজিট (Total Owner Deposit)</Text>
          <Text style={styles.depositValue}>৳{metrics.totalDeposit.toLocaleString()}</Text>
        </View>

        {/* Monthly Summary Statistics */}
        <Text style={styles.sectionTitle}>ফাইনান্সিয়াল ওভারভিউ ({getMonthNameBangla(currentMonth)})</Text>
        <View style={styles.summaryCard}>
          <View style={styles.metricRow}>
            <View style={styles.metricLeft}>
              <Text style={styles.metricIcon}>💰</Text>
              <Text style={styles.metricLabelText}>উত্তোলন (Owner Withdrawn)</Text>
            </View>
            <Text style={[styles.metricValueText, { color: '#60A5FA' }]}>
              ৳{metrics.ownerWithdrawn.toLocaleString()}
            </Text>
          </View>

          <View style={styles.metricRow}>
            <View style={styles.metricLeft}>
              <Text style={styles.metricIcon}>👨🍳</Text>
              <Text style={styles.metricLabelText}>পরিশোধিত বেতন (Salary Paid)</Text>
            </View>
            <Text style={[styles.metricValueText, { color: '#EF4444' }]}>
              - ৳{metrics.salaryPaid.toLocaleString()}
            </Text>
          </View>

          <View style={styles.metricRow}>
            <View style={styles.metricLeft}>
              <Text style={styles.metricIcon}>💸</Text>
              <Text style={styles.metricLabelText}>ওনারের খরচ (Owner Expenses)</Text>
            </View>
            <Text style={[styles.metricValueText, { color: '#EF4444' }]}>
              - ৳{metrics.ownerExpenses.toLocaleString()}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={[styles.metricRow, { marginBottom: 0 }]}>
            <View style={styles.metricLeft}>
              <Text style={styles.metricIcon}>📈</Text>
              <Text style={[styles.metricLabelText, { fontWeight: 'bold', color: '#FFFFFF' }]}>নিট সঞ্চয় (Net Savings)</Text>
            </View>
            <Text style={[styles.metricValueText, { fontSize: 18, color: '#10B981', fontWeight: 'bold' }]}>
              ৳{metrics.netSavings.toLocaleString()}
            </Text>
          </View>
        </View>

        {/* Month Close / Unlock Action button */}
        {!metrics.isClosed ? (
          <TouchableOpacity style={styles.closeMonthBtn} onPress={handleCloseMonthTrigger}>
            <Text style={styles.closeMonthBtnText}>🔒 {getMonthNameBangla(currentMonth)} এর হিসাব বন্ধ করুন</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ gap: 12 }}>
            <View style={styles.closedMonthMessage}>
              <Text style={styles.closedMonthMessageText}>🔒 এই মাসের হিসাব স্থায়ীভাবে বন্ধ এবং আর্কাইভ করা হয়েছে।</Text>
            </View>
            {(userRole === 'owner' || userRole === 'admin') && (
              <TouchableOpacity style={styles.unlockMonthBtn} onPress={handleUnlockMonthTrigger}>
                <Text style={styles.unlockMonthBtnText}>🔓 Unlock Month</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Employees Overview Section */}
        <Text style={[styles.sectionTitle, { marginTop: 10 }]}>কর্মচারী ওভারভিউ</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statsCard}>
            <Text style={styles.cardEmoji}>👥</Text>
            <Text style={styles.cardValue}>{employeeStats.total}</Text>
            <Text style={styles.cardLabel}>মোট কর্মচারী</Text>
          </View>

          <View style={styles.statsCard}>
            <Text style={styles.cardEmoji}>💰</Text>
            <Text style={[styles.cardValue, { color: '#FFB703' }]}>৳{employeeStats.totalSalary.toLocaleString()}</Text>
            <Text style={styles.cardLabel}>মাসিক বেতন (সক্রিয়)</Text>
          </View>
        </View>

        <View style={styles.actionsBlock}>
          <TouchableOpacity style={styles.primaryButton} onPress={onNavigateToEmployees}>
            <Text style={styles.primaryButtonText}>👥 কর্মচারী ও বেতন ব্যবস্থাপনা</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.primaryButton, styles.expenseBtn]} onPress={onNavigateToExpenses}>
            <Text style={[styles.primaryButtonText, styles.expenseBtnText]}>💸 ওনার ব্যক্তিগত খরচ ব্যবস্থাপনা</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ⚠️ Warning Modal: Previous Month Open */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={warningModalVisible}
        onRequestClose={() => setWarningModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.warningModalContent}>
            <Text style={styles.warningEmoji}>⚠️</Text>
            <Text style={styles.warningTitle}>আগের মাস এখনো বন্ধ করা হয়নি</Text>
            <Text style={styles.warningSubtitle}>
              {prevMonthName} মাস এখনো Close করা হয়নি। নতুন মাস শুরু করার আগে আগের মাস Close করুন।
            </Text>

            <TouchableOpacity
              style={styles.warningCloseBtn}
              onPress={() => {
                setWarningModalVisible(false);
                setCurrentMonth(prevMonthStr); // Switch to the open month
              }}
            >
              <Text style={styles.warningCloseBtnText}>🔒 মাস Close করুন</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.warningRemindBtn}
              onPress={() => setWarningModalVisible(false)}
            >
              <Text style={styles.warningRemindBtnText}>❌ পরে মনে করিয়ে দিন</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* PIN Verification Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={pinModalVisible}
        onRequestClose={() => setPinModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.pinModalContent}
          >
            <Text style={styles.pinModalIcon}>🔒</Text>
            <Text style={styles.pinModalTitle}>পিন ভেরিফিকেশন</Text>
            <Text style={styles.pinModalLabel}>
              {pinAction === 'UNLOCK' ? 'মাস আনলক করার জন্য' : 'মাস বন্ধ করার জন্য'} ৪-ডিজিটের পিন কোড প্রদান করুন:
            </Text>
            
            <TextInput
              style={styles.pinInput}
              placeholder="••••"
              placeholderTextColor="#555"
              keyboardType="numeric"
              maxLength={4}
              secureTextEntry={true}
              value={enteredPin}
              onChangeText={setEnteredPin}
              autoFocus={true}
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setPinModalVisible(false)}
              >
                <Text style={styles.modalCancelBtnText}>বাতিল</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleVerifyPinAndAction}
              >
                <Text style={styles.modalSaveBtnText}>নিশ্চিত করুন</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
    backgroundColor: '#0D0D0D',
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#1E1E1E',
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  monthSelectorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#161616',
    borderBottomWidth: 1,
    borderColor: '#262626',
  },
  navMonthBtn: {
    padding: 10,
    backgroundColor: '#262626',
    borderRadius: 8,
  },
  navMonthBtnText: {
    color: '#FFB703',
    fontSize: 14,
    fontWeight: 'bold',
  },
  monthLabelCol: {
    alignItems: 'center',
    gap: 4,
  },
  currentMonthLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeOpen: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  badgeClosed: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  statusText: {
    fontSize: 9,
    fontWeight: 'bold',
  },
  textOpen: {
    color: '#10B981',
  },
  textClosed: {
    color: '#EF4444',
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  depositBox: {
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#FFB703',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  depositLabel: {
    color: '#FFB703',
    fontSize: 12,
    fontWeight: '600',
  },
  depositValue: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
  },
  sectionTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginTop: 8,
    marginBottom: 4,
  },
  summaryCard: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 20,
    padding: 20,
    gap: 14,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metricLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  metricIcon: {
    fontSize: 16,
  },
  metricLabelText: {
    color: '#AAA',
    fontSize: 13,
    fontWeight: '500',
  },
  metricValueText: {
    fontSize: 15,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: '#262626',
    marginVertical: 4,
  },
  closeMonthBtn: {
    backgroundColor: '#FFB703',
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeMonthBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold',
  },
  closedMonthMessage: {
    backgroundColor: '#1A1A1A',
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  closedMonthMessageText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '500',
  },
  unlockMonthBtn: {
    backgroundColor: 'rgba(255, 183, 3, 0.15)',
    borderWidth: 1,
    borderColor: '#FFB703',
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unlockMonthBtnText: {
    color: '#FFB703',
    fontSize: 13,
    fontWeight: 'bold',
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  statsCard: {
    flex: 1,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  cardEmoji: {
    fontSize: 22,
    marginBottom: 6,
  },
  cardValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  cardLabel: {
    fontSize: 10,
    color: '#888',
    fontWeight: '500',
    textAlign: 'center',
  },
  actionsBlock: {
    gap: 12,
    marginTop: 10,
  },
  primaryButton: {
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#262626',
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  expenseBtn: {
    borderColor: '#FFB703',
    backgroundColor: 'rgba(255, 183, 3, 0.03)',
  },
  expenseBtnText: {
    color: '#FFB703',
    fontWeight: 'bold',
  },
  accessDeniedContainer: {
    flex: 1,
    backgroundColor: '#0D0D0D',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  accessDeniedEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  accessDeniedTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFB703',
    marginBottom: 8,
    textAlign: 'center',
  },
  accessDeniedSubtitle: {
    fontSize: 14,
    color: '#AAA',
    marginBottom: 24,
    textAlign: 'center',
  },
  accessDeniedButton: {
    backgroundColor: '#FFB703',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  accessDeniedButtonText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  warningModalContent: {
    backgroundColor: '#0D0D0D',
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#EF4444',
    padding: 24,
    width: width * 0.9,
    maxWidth: 380,
    alignItems: 'center',
  },
  warningEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  warningTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#EF4444',
    marginBottom: 12,
    textAlign: 'center',
  },
  warningSubtitle: {
    fontSize: 13,
    color: '#AAA',
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 24,
  },
  warningCloseBtn: {
    backgroundColor: '#EF4444',
    height: 48,
    borderRadius: 10,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  warningCloseBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  warningRemindBtn: {
    height: 48,
    borderRadius: 10,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#333',
  },
  warningRemindBtnText: {
    color: '#888',
    fontWeight: '600',
    fontSize: 14,
  },
  pinModalContent: {
    backgroundColor: '#0D0D0D',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FFB703',
    padding: 24,
    width: width * 0.85,
    maxWidth: 320,
    alignItems: 'center',
  },
  pinModalIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  pinModalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  pinModalLabel: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    marginBottom: 16,
  },
  pinInput: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    width: '80%',
    height: 50,
    textAlign: 'center',
    color: '#FFFFFF',
    fontSize: 24,
    letterSpacing: 10,
    marginBottom: 20,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalCancelBtn: {
    flex: 1,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
  },
  modalCancelBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  modalSaveBtn: {
    flex: 1,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFB703',
    borderRadius: 10,
  },
  modalSaveBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
