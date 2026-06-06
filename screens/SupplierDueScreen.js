import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Dimensions,
  Modal,
  KeyboardAvoidingView,
  Platform,
  BackHandler
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getSupplierPaymentLedger, saveSupplierPayment, formatDisplayDate } from '../database';

const { width } = Dimensions.get('window');

// Helper to get month name in Bengali or English (English as per user example)
const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function SupplierDueScreen({ userRole, userDisplayName, onBack }) {
  const [loading, setLoading] = useState(true);
  const [selectedMonthStr, setSelectedMonthStr] = useState(''); // YYYY-MM
  const [ledgerData, setLedgerData] = useState({}); // payment_date -> record
  
  // Modal State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingDate, setEditingDate] = useState('');
  const [editingSupplierField, setEditingSupplierField] = useState(''); // variety_store_amount, etc.
  const [editingSupplierName, setEditingSupplierName] = useState('');
  const [editAmount, setEditAmount] = useState('');

  // Android Back Handler for Modals
  useEffect(() => {
    const backAction = () => {
      if (editModalVisible) { setEditModalVisible(false); return true; }
      return false; // Let App.js handle screen back
    };

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      backAction
    );

    return () => backHandler.remove();
  }, [editModalVisible]);

  // Generate Month List for Filter
  const getMonthsList = () => {
    const list = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
      const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      list.push({ label, prefix });
    }
    return list;
  };

  useEffect(() => {
    const list = getMonthsList();
    if (list.length > 0) {
      setSelectedMonthStr(list[0].prefix);
    }
  }, []);

  useEffect(() => {
    if (selectedMonthStr) {
      loadData();
    }
  }, [selectedMonthStr]);

  const loadData = () => {
    setLoading(true);
    try {
      const data = getSupplierPaymentLedger(selectedMonthStr);
      const map = {};
      data.forEach(item => {
        map[item.payment_date] = item;
      });
      setLedgerData(map);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const getDatesInMonth = (monthStr) => {
    const [year, month] = monthStr.split('-').map(Number);
    const dates = [];
    const lastDay = new Date(year, month, 0).getDate();
    for (let i = 1; i <= lastDay; i++) {
      const day = String(i).padStart(2, '0');
      dates.push(`${monthStr}-${day}`);
    }
    // Reverse to show latest first or keep sequential as per spreadsheet requirement
    // User example showed 01 Jun, 02 Jun... so sequential
    return dates;
  };

  const handleCellPress = (date, field, supplierName, currentVal) => {
    // Permission check
    if (userRole !== 'admin' && userRole !== 'owner' && userRole !== 'manager') {
      Alert.alert("সীমাবদ্ধতা", "আপনার এই তথ্য পরিবর্তন করার অনুমতি নেই।");
      return;
    }

    const record = ledgerData[date];
    if (record) {
      // 48 Hour Lock Check
      const createdAt = new Date(record.created_at);
      const currentTime = new Date();
      const diffHours = (currentTime - createdAt) / (1000 * 60 * 60);
      
      if (diffHours > 48) {
        Alert.alert("লক করা হয়েছে", "৪৮ ঘণ্টা পার হয়ে যাওয়ায় এই এন্ট্রিটি আর পরিবর্তন করা সম্ভব নয়।");
        return;
      }
    } else {
      // If no record exists yet, check if the date is in the future (optional safety)
      const today = new Date().toISOString().substring(0, 10);
      if (date > today) {
        Alert.alert("সতর্কবার্তা", "ভবিষ্যতের তারিখের জন্য এন্ট্রি করা সম্ভব নয়।");
        return;
      }
    }

    setEditingDate(date);
    setEditingSupplierField(field);
    setEditingSupplierName(supplierName);
    setEditAmount(currentVal > 0 ? currentVal.toString() : '');
    setEditModalVisible(true);
  };

  const handleSaveAmount = () => {
    const amount = parseFloat(editAmount) || 0;
    const result = saveSupplierPayment(editingDate, editingSupplierField, amount, userDisplayName);
    
    if (result.success) {
      setEditModalVisible(false);
      loadData();
    } else {
      Alert.alert("ত্রুটি", result.error || "ডাটা সেভ করতে সমস্যা হয়েছে।");
    }
  };

  const calculateTotals = (dates) => {
    let totalVariety = 0;
    let totalMorgir = 0;
    let totalBurger = 0;

    dates.forEach(date => {
      const record = ledgerData[date];
      if (record) {
        totalVariety += (record.variety_store_amount || 0);
        totalMorgir += (record.morgir_dokan_amount || 0);
        totalBurger += (record.burger_ban_amount || 0);
      }
    });

    return { totalVariety, totalMorgir, totalBurger };
  };

  const dates = selectedMonthStr ? getDatesInMonth(selectedMonthStr) : [];
  const totals = calculateTotals(dates);

  const formatShortDate = (dateStr) => {
    // Input: YYYY-MM-DD, Output: DD MMM
    const [y, m, d] = dateStr.split('-');
    const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${d} ${monthsShort[parseInt(m, 10) - 1]}`;
  };

  const isRowLocked = (date) => {
    const record = ledgerData[date];
    if (!record) return false;
    const createdAt = new Date(record.created_at);
    const currentTime = new Date();
    const diffHours = (currentTime - createdAt) / (1000 * 60 * 60);
    return diffHours > 48;
  };

  if (loading && !selectedMonthStr) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#FFB703" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backArrow}>❮ পিছনে</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>📒 সাপ্লায়ার পেমেন্ট হিসাব</Text>
        </View>
      </View>

      <View style={styles.body}>
        {/* Month Filter */}
        <View style={styles.filterSection}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.monthScrollContent}>
            {getMonthsList().map((month, index) => {
              const isSelected = selectedMonthStr === month.prefix;
              return (
                <TouchableOpacity 
                  key={index} 
                  style={[styles.monthButton, isSelected && styles.monthButtonSelected]}
                  onPress={() => setSelectedMonthStr(month.prefix)}
                >
                  <Text style={[styles.monthText, isSelected && styles.monthTextSelected]}>
                    {month.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Ledger Table */}
        <View style={styles.tableContainer}>
          {/* Table Header */}
          <View style={styles.tableHeader}>
            <Text style={[styles.columnHeader, styles.colDate]}>তারিখ</Text>
            <Text style={[styles.columnHeader, styles.colSupplier]}>ভারাইটি স্টোর</Text>
            <Text style={[styles.columnHeader, styles.colSupplier]}>মোরগীর দোকান</Text>
            <Text style={[styles.columnHeader, styles.colSupplier]}>বার্গার বান</Text>
          </View>

          <ScrollView style={styles.ledgerScroll} showsVerticalScrollIndicator={false}>
            {dates.map((date, idx) => {
              const record = ledgerData[date] || {};
              const locked = isRowLocked(date);
              
              return (
                <View key={date} style={[styles.tableRow, idx % 2 === 1 && styles.rowAlt]}>
                  {/* Date Column */}
                  <View style={[styles.cell, styles.colDate, { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={styles.dateText}>{formatShortDate(date)}</Text>
                    {locked && <Text style={styles.lockIcon}> 🔒</Text>}
                  </View>

                  {/* Variety Store Column */}
                  <TouchableOpacity 
                    style={[styles.cell, styles.colSupplier]}
                    onPress={() => handleCellPress(date, 'variety_store_amount', 'ভারাইটি স্টোর', record.variety_store_amount || 0)}
                  >
                    <Text style={[styles.amountText, (record.variety_store_amount || 0) > 0 && styles.activeAmount]}>
                      {record.variety_store_amount ? record.variety_store_amount.toLocaleString() : '0'}
                    </Text>
                  </TouchableOpacity>

                  {/* Morgir Dokan Column */}
                  <TouchableOpacity 
                    style={[styles.cell, styles.colSupplier]}
                    onPress={() => handleCellPress(date, 'morgir_dokan_amount', 'মোরগীর দোকান', record.morgir_dokan_amount || 0)}
                  >
                    <Text style={[styles.amountText, (record.morgir_dokan_amount || 0) > 0 && styles.activeAmount]}>
                      {record.morgir_dokan_amount ? record.morgir_dokan_amount.toLocaleString() : '0'}
                    </Text>
                  </TouchableOpacity>

                  {/* Burger Ban Column */}
                  <TouchableOpacity 
                    style={[styles.cell, styles.colSupplier]}
                    onPress={() => handleCellPress(date, 'burger_ban_amount', 'বার্গার বান', record.burger_ban_amount || 0)}
                  >
                    <Text style={[styles.amountText, (record.burger_ban_amount || 0) > 0 && styles.activeAmount]}>
                      {record.burger_ban_amount ? record.burger_ban_amount.toLocaleString() : '0'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>

          {/* Totals Row */}
          <View style={styles.totalsRow}>
            <Text style={[styles.totalLabel, styles.colDate]}>মোট</Text>
            <Text style={[styles.totalValue, styles.colSupplier]}>{totals.totalVariety.toLocaleString()}</Text>
            <Text style={[styles.totalValue, styles.colSupplier]}>{totals.totalMorgir.toLocaleString()}</Text>
            <Text style={[styles.totalValue, styles.colSupplier]}>{totals.totalBurger.toLocaleString()}</Text>
          </View>
        </View>
      </View>

      {/* Edit Modal */}
      <Modal visible={editModalVisible} transparent={true} animationType="fade" onRequestClose={() => setEditModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity 
            style={styles.modalOverlay} 
            activeOpacity={1} 
            onPress={() => setEditModalVisible(false)}
          >
            <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
              <Text style={styles.modalTitle}>{editingSupplierName}</Text>
              <Text style={styles.modalSubtitle}>{formatDisplayDate(editingDate)}</Text>
              
              <TextInput
                style={styles.modalInput}
                keyboardType="numeric"
                value={editAmount}
                onChangeText={setEditAmount}
                placeholder="পেমেন্ট পরিমাণ লিখুন"
                placeholderTextColor="#64748B"
                autoFocus={true}
              />
              
              <View style={styles.modalBtnRow}>
                <TouchableOpacity 
                  style={styles.modalCancelBtn} 
                  onPress={() => setEditModalVisible(false)}
                >
                  <Text style={styles.modalCancelBtnText}>বাতিল</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.modalSaveBtn} 
                  onPress={handleSaveAmount}
                >
                  <Text style={styles.modalSaveBtnText}>সংরক্ষণ</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
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
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFB703',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  body: {
    flex: 1,
    padding: 12,
  },
  filterSection: {
    marginBottom: 15,
  },
  monthScrollContent: {
    gap: 8,
    paddingRight: 10,
  },
  monthButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#333',
  },
  monthButtonSelected: {
    backgroundColor: '#FFB703',
    borderColor: '#FFB703',
  },
  monthText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  monthTextSelected: {
    color: '#000',
    fontWeight: 'bold',
  },
  tableContainer: {
    flex: 1,
    backgroundColor: '#0D0D0D',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1A1A1A',
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#161616',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#262626',
  },
  columnHeader: {
    color: '#FFB703',
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  ledgerScroll: {
    flex: 1,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#161616',
    height: 48,
  },
  rowAlt: {
    backgroundColor: '#0A0A0A',
  },
  cell: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  colDate: {
    width: '20%',
    borderRightWidth: 1,
    borderColor: '#161616',
  },
  colSupplier: {
    flex: 1,
    borderRightWidth: 1,
    borderColor: '#161616',
  },
  dateText: {
    color: '#888',
    fontSize: 11,
    fontWeight: '500',
  },
  amountText: {
    color: '#444',
    fontSize: 12,
    fontWeight: '500',
  },
  activeAmount: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  lockIcon: {
    fontSize: 10,
    color: '#888',
  },
  totalsRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 183, 3, 0.1)',
    paddingVertical: 14,
    borderTopWidth: 2,
    borderColor: '#FFB703',
  },
  totalLabel: {
    color: '#FFB703',
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  totalValue: {
    color: '#FFB703',
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#0D0D0D',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FFB703',
    padding: 24,
    width: width * 0.85,
    maxWidth: 340,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#888',
    marginBottom: 20,
    textAlign: 'center',
  },
  modalInput: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    height: 54,
    paddingHorizontal: 16,
    color: '#FFFFFF',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 24,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelBtn: {
    flex: 1,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
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
  },
  modalSaveBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
