import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  FlatList,
  Modal,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

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

export default function EmployeeListScreen({
  userRole,
  onBack,
  onAddEmployee,
  onSelectEmployee,
  onEditEmployee,
  refreshData
}) {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // UX Refactor States
  const [summaries, setSummaries] = useState({}); // empId -> { paid, due }
  const [expandedEmployees, setExpandedEmployees] = useState({}); // empId -> boolean
  const [ledgers, setLedgers] = useState({}); // empId -> ledgerArray

  // Pay Modal States
  const [payModalVisible, setPayModalVisible] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payType, setPayType] = useState('Salary');
  const [payNotes, setPayNotes] = useState('');

  useEffect(() => {
    if (userRole === 'owner') {
      loadEmployees();
    } else {
      setLoading(false);
    }
  }, [userRole]);

  const loadEmployees = () => {
    setLoading(true);
    try {
      const { getOwnerEmployees, getEmployeeMonthlySummary } = require('../database');
      const list = getOwnerEmployees();
      setEmployees(list);

      // Load summaries for each employee for the current month
      const currentMonth = new Date().toISOString().substring(0, 7);
      const tempSummaries = {};
      list.forEach(emp => {
        tempSummaries[emp.id] = getEmployeeMonthlySummary(emp.id, currentMonth);
      });
      setSummaries(tempSummaries);
    } catch (err) {
      console.error("[EmployeeListScreen] Error loading employees:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleLedger = (empId) => {
    const isExpanded = !expandedEmployees[empId];
    setExpandedEmployees(prev => ({ ...prev, [empId]: isExpanded }));

    if (isExpanded) {
      loadLedgerForEmployee(empId);
    }
  };

  const loadLedgerForEmployee = (empId) => {
    try {
      const { getEmployeeSalaryLedger } = require('../database');
      const ledgerList = getEmployeeSalaryLedger(empId);
      setLedgers(prev => ({ ...prev, [empId]: ledgerList }));
    } catch (err) {
      console.error("[EmployeeListScreen] Error loading ledger:", err);
    }
  };

  const handleOpenPayModal = (emp) => {
    setSelectedEmp(emp);
    setPayAmount('');
    setPayType('Salary');
    setPayNotes('');
    setPayModalVisible(true);
  };

  const handleSavePayment = () => {
    const numAmount = parseFloat(payAmount) || 0;
    if (numAmount <= 0) {
      Alert.alert("ইনপুট ত্রুটি", "পরিশোধের পরিমাণ অবশ্যই ০ থেকে বেশি হতে হবে।");
      return;
    }

    try {
      const { saveSalaryLedgerEntry } = require('../database');
      const today = new Date().toISOString().substring(0, 10);
      
      const payload = {
        employee_id: selectedEmp.id,
        amount: numAmount,
        payment_type: payType,
        payment_date: today,
        notes: payNotes.trim()
      };

      const newId = saveSalaryLedgerEntry(payload);
      if (newId) {
        Alert.alert("সফল", "পেমেন্ট সফলভাবে সম্পন্ন হয়েছে।");
        setPayModalVisible(false);
        
        // Reload data
        loadEmployees();
        // If the ledger was expanded, reload it
        if (expandedEmployees[selectedEmp.id]) {
          loadLedgerForEmployee(selectedEmp.id);
        }
        
        if (refreshData) {
          refreshData();
        }
      } else {
        Alert.alert("ত্রুটি", "পেমেন্ট সংরক্ষণ করতে ব্যর্থ হয়েছে।");
      }
    } catch (err) {
      console.error("[EmployeeListScreen] Save payment error:", err);
      Alert.alert("ত্রুটি", "পেমেন্ট সংরক্ষণ করতে ব্যর্থ হয়েছে।");
    }
  };

  const handleDeleteEmployee = (emp) => {
    Alert.alert(
      "কর্মচারী অপসারণ",
      `আপনি কি নিশ্চিতভাবে ${emp.name}-কে তালিকা থেকে বাদ দিতে চান?`,
      [
        { text: "বাতিল", style: "cancel" },
        {
          text: "অপসারণ করুন",
          style: "destructive",
          onPress: () => {
            try {
              const { deleteOwnerEmployee } = require('../database');
              const success = deleteOwnerEmployee(emp.id);
              if (success) {
                Alert.alert("সফল", "কর্মচারী সফলভাবে অপসারিত হয়েছে।");
                loadEmployees();
                if (refreshData) {
                  refreshData();
                }
              } else {
                Alert.alert("ত্রুটি", "অপসারণ করতে ব্যর্থ হয়েছে।");
              }
            } catch (err) {
              console.error("[EmployeeListScreen] Delete employee error:", err);
              Alert.alert("ত্রুটি", "অপসারণ করতে ব্যর্থ হয়েছে।");
            }
          }
        }
      ]
    );
  };

  const handleLongPressCard = (emp) => {
    Alert.alert(
      "কর্মচারী ব্যবস্থাপনা",
      `${emp.name} (${emp.designation || 'পদবী উল্লেখ নেই'})`,
      [
        {
          text: "✏️ Edit Employee",
          onPress: () => {
            if (onEditEmployee) {
              onEditEmployee(emp.id);
            }
          }
        },
        {
          text: "🗑 Delete Employee",
          style: "destructive",
          onPress: () => handleDeleteEmployee(emp)
        },
        {
          text: "❌ Cancel",
          style: "cancel"
        }
      ]
    );
  };

  const handleLongPressLedgerItem = (entry, empId) => {
    Alert.alert(
      "পেমেন্ট এন্ট্রি ডিলিট",
      `আপনি কি নিশ্চিতভাবে ${entry.payment_date} তারিখের ${entry.payment_type} এন্ট্রিটি (৳${entry.amount}) মুছে ফেলতে চান?`,
      [
        { text: "বাতিল", style: "cancel" },
        {
          text: "মুছে ফেলুন",
          style: "destructive",
          onPress: () => {
            try {
              const { deleteSalaryLedgerEntry } = require('../database');
              const success = deleteSalaryLedgerEntry(entry.id);
              if (success) {
                Alert.alert("সফল", "বেতন বিবরণী এন্ট্রিটি সফলভাবে মুছে ফেলা হয়েছে।");
                loadEmployees();
                loadLedgerForEmployee(empId);
                if (refreshData) {
                  refreshData();
                }
              } else {
                Alert.alert("ত্রুটি", "এন্ট্রি মুছে ফেলতে ব্যর্থ হয়েছে।");
              }
            } catch (err) {
              console.error("[EmployeeListScreen] Delete ledger entry error:", err);
              Alert.alert("ত্রুটি", "এন্ট্রি মুছে ফেলতে ব্যর্থ হয়েছে।");
            }
          }
        }
      ]
    );
  };

  if (userRole !== 'owner') {
    return <AccessDenied onBack={onBack} />;
  }

  const filteredEmployees = employees.filter(emp => {
    const q = searchQuery.toLowerCase();
    const nameMatch = emp.name ? emp.name.toLowerCase().includes(q) : false;
    const phoneMatch = emp.phone ? emp.phone.includes(q) : false;
    const desMatch = emp.designation ? emp.designation.toLowerCase().includes(q) : false;
    return nameMatch || phoneMatch || desMatch;
  });

  const renderEmployeeCard = ({ item }) => {
    const isActive = item.status === 'ACTIVE';
    const summary = summaries[item.id] || { paid: 0, due: item.monthly_salary };
    const isExpanded = !!expandedEmployees[item.id];
    const employeeLedger = ledgers[item.id] || [];

    return (
      <View style={[styles.employeeCard, !isActive && styles.inactiveCardBorder]}>
        {/* Main Tappable Card Body (Opens detailed profile) */}
        <TouchableOpacity
          style={styles.cardInfoSection}
          onPress={() => handleToggleLedger(item.id)}
          onLongPress={() => handleLongPressCard(item)}
          activeOpacity={0.7}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.employeeName}>👤 {item.name}</Text>
            <View style={[styles.statusBadge, isActive ? styles.activeBadge : styles.inactiveBadge]}>
              <Text style={[styles.statusText, isActive ? styles.activeText : styles.inactiveText]}>
                {isActive ? 'সক্রিয়' : 'নিষ্ক্রিয়'}
              </Text>
            </View>
          </View>

          <View style={styles.cardMetaGrid}>
            <View style={styles.metaCol}>
              <Text style={styles.metaLabel}>পদবী:</Text>
              <Text style={styles.metaValue}>{item.designation || 'N/A'}</Text>
            </View>
            <View style={styles.metaCol}>
              <Text style={styles.metaLabel}>মাসিক বেতন:</Text>
              <Text style={[styles.metaValue, { color: '#FFB703', fontWeight: 'bold' }]}>
                ৳{item.monthly_salary.toLocaleString()}
              </Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Month progress */}
          <View style={styles.financeSummaryGrid}>
            <View style={styles.summaryCol}>
              <Text style={styles.summaryLabel}>এই মাসে পরিশোধ:</Text>
              <Text style={styles.summaryValuePaid}>৳{summary.paid.toLocaleString()}</Text>
            </View>
            <View style={styles.summaryCol}>
              <Text style={styles.summaryLabel}>অবশিষ্ট বকেয়া:</Text>
              <Text style={styles.summaryValueDue}>৳{summary.due.toLocaleString()}</Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Card Action Buttons Row */}
        <View style={styles.cardActionsRow}>
          <TouchableOpacity
            style={styles.payBtn}
            onPress={() => handleOpenPayModal(item)}
            activeOpacity={0.8}
          >
            <Text style={styles.payBtnText}>💰 Pay</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.ledgerBtn, isExpanded && styles.ledgerBtnActive]}
            onPress={() => handleToggleLedger(item.id)}
            activeOpacity={0.8}
          >
            <Text style={[styles.ledgerBtnText, isExpanded && styles.ledgerBtnTextActive]}>
              {isExpanded ? '▲ Hide' : '📜 Ledger'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Collapsible Salary history section */}
        {isExpanded ? (
          <View style={styles.inlineLedgerSection}>
            <View style={styles.ledgerHeaderRow}>
              <Text style={styles.ledgerSectionTitle}>▼ Salary History (Ledger)</Text>
              <Text style={styles.ledgerHelperText}>মুছতে লং-প্রেস করে রাখুন</Text>
            </View>
            {employeeLedger.length === 0 ? (
              <Text style={styles.emptyLedgerText}>কোনো লেনদেনের তথ্য পাওয়া যায়নি।</Text>
            ) : (
              <View style={styles.ledgerList}>
                {employeeLedger.map((entry) => {
                  const isDeduction = entry.payment_type === 'Deduction';
                  return (
                    <TouchableOpacity
                      key={entry.id}
                      style={styles.ledgerRow}
                      onLongPress={() => handleLongPressLedgerItem(entry, item.id)}
                      delayLongPress={800}
                    >
                      <View>
                        <Text style={styles.ledgerRowDate}>{entry.payment_date}</Text>
                        <Text style={styles.ledgerRowType}>{entry.payment_type}</Text>
                        {entry.notes ? <Text style={styles.ledgerRowNotes}>{entry.notes}</Text> : null}
                      </View>
                      <Text style={[styles.ledgerRowAmount, isDeduction ? styles.amountDeduction : styles.amountPositive]}>
                        {isDeduction ? '-' : '+'} ৳{entry.amount.toLocaleString()}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>◁ ফিরে যান</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>👥 বেতন ও কর্মচারী</Text>
        <TouchableOpacity style={styles.addButton} onPress={onAddEmployee}>
          <Text style={styles.addButtonText}>➕ নতুন</Text>
        </TouchableOpacity>
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="নাম, পদবী বা ফোন দিয়ে খুঁজুন..."
          placeholderTextColor="#888"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FFB703" />
        </View>
      ) : (
        <FlatList
          data={filteredEmployees}
          keyExtractor={item => item.id}
          renderItem={renderEmployeeCard}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>কোনো কর্মচারী পাওয়া যায়নি।</Text>
            </View>
          }
        />
      )}

      {/* Pay Modal Sheet */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={payModalVisible}
        onRequestClose={() => setPayModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalContent}
          >
            <View style={styles.modalHeaderCircle}>
              <Text style={styles.modalHeaderIcon}>💰</Text>
            </View>
            <Text style={styles.modalTitle}>বেতন পরিশোধ করুন</Text>
            {selectedEmp ? (
              <Text style={styles.modalEmpName}>👤 {selectedEmp.name}</Text>
            ) : null}

            {/* Form Fields */}
            <View style={styles.modalForm}>
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>পরিশোধের পরিমাণ (৳) *</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="পরিমাণ"
                  placeholderTextColor="#666"
                  keyboardType="numeric"
                  value={payAmount}
                  onChangeText={setPayAmount}
                  autoFocus={true}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>পেমেন্ট টাইপ *</Text>
                <View style={styles.typeSelector}>
                  {['Salary', 'Advance', 'Bonus', 'Deduction'].map((type) => {
                    const isSelected = payType === type;
                    return (
                      <TouchableOpacity
                        key={type}
                        style={[styles.typeBtn, isSelected && styles.typeBtnActive]}
                        onPress={() => setPayType(type)}
                      >
                        <Text style={[styles.typeBtnText, isSelected && styles.typeBtnTextActive]}>
                          {type}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>মন্তব্য/নোট</Text>
                <TextInput
                  style={[styles.modalInput, styles.textArea]}
                  placeholder="নোট যোগ করুন (যেমন: বোনাস)"
                  placeholderTextColor="#666"
                  value={payNotes}
                  onChangeText={setPayNotes}
                  multiline={true}
                  numberOfLines={2}
                />
              </View>
            </View>

            {/* Modal Actions */}
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setPayModalVisible(false)}
              >
                <Text style={styles.modalCancelBtnText}>বাতিল</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSavePayment}
              >
                <Text style={styles.modalSaveBtnText}>সংরক্ষণ</Text>
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
  addButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#FFB703',
  },
  addButtonText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold',
  },
  searchContainer: {
    padding: 16,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
  },
  searchInput: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 16,
    color: '#FFFFFF',
    fontSize: 14,
  },
  listContent: {
    padding: 16,
    gap: 16,
  },
  employeeCard: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 20,
    overflow: 'hidden',
  },
  inactiveCardBorder: {
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  cardInfoSection: {
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  employeeName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  activeBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  inactiveBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  statusText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  activeText: {
    color: '#10B981',
  },
  inactiveText: {
    color: '#EF4444',
  },
  cardMetaGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  metaCol: {
    gap: 4,
  },
  metaLabel: {
    color: '#888',
    fontSize: 11,
  },
  metaValue: {
    color: '#FFFFFF',
    fontSize: 13,
  },
  divider: {
    height: 1,
    backgroundColor: '#262626',
    marginBottom: 12,
  },
  financeSummaryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryCol: {
    gap: 4,
  },
  summaryLabel: {
    color: '#888',
    fontSize: 11,
  },
  summaryValuePaid: {
    color: '#10B981',
    fontSize: 14,
    fontWeight: 'bold',
  },
  summaryValueDue: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: 'bold',
  },
  cardActionsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderColor: '#262626',
    height: 48,
  },
  payBtn: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 183, 3, 0.05)',
    borderRightWidth: 1,
    borderColor: '#262626',
  },
  payBtnText: {
    color: '#FFB703',
    fontWeight: 'bold',
    fontSize: 14,
  },
  ledgerBtn: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ledgerBtnActive: {
    backgroundColor: '#1E1E1E',
  },
  ledgerBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  ledgerBtnTextActive: {
    color: '#FFB703',
  },
  inlineLedgerSection: {
    backgroundColor: '#0D0D0D',
    borderTopWidth: 1,
    borderColor: '#262626',
    padding: 16,
  },
  ledgerHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  ledgerSectionTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: 'bold',
  },
  ledgerHelperText: {
    color: '#444',
    fontSize: 10,
    fontStyle: 'italic',
  },
  emptyLedgerText: {
    color: '#666',
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 12,
  },
  ledgerList: {
    gap: 10,
  },
  ledgerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#161616',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#222',
  },
  ledgerRowDate: {
    color: '#888',
    fontSize: 10,
  },
  ledgerRowType: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  ledgerRowNotes: {
    color: '#888',
    fontSize: 11,
    fontStyle: 'italic',
  },
  ledgerRowAmount: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  amountPositive: {
    color: '#10B981',
  },
  amountDeduction: {
    color: '#EF4444',
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#888',
    fontSize: 14,
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
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#0D0D0D',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FFB703',
    padding: 24,
    width: width * 0.9,
    maxWidth: 380,
  },
  modalHeaderCircle: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFB703',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalHeaderIcon: {
    fontSize: 24,
    color: '#000000',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 4,
  },
  modalEmpName: {
    fontSize: 14,
    color: '#FFB703',
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
  },
  modalForm: {
    gap: 14,
    marginBottom: 20,
  },
  formGroup: {
    gap: 6,
  },
  inputLabel: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  modalInput: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 16,
    color: '#FFFFFF',
    fontSize: 15,
  },
  typeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  typeBtn: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  typeBtnActive: {
    backgroundColor: 'rgba(255, 183, 3, 0.15)',
    borderColor: '#FFB703',
  },
  typeBtnText: {
    fontSize: 12,
    color: '#888',
    fontWeight: '600',
  },
  typeBtnTextActive: {
    color: '#FFB703',
  },
  textArea: {
    height: 60,
    textAlignVertical: 'top',
    paddingTop: 10,
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
