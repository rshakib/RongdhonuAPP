import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  FlatList
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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

export default function EmployeeDetailScreen({
  userRole,
  onBack,
  employeeId,
  onEditEmployee,
  onDeleteSuccess,
  onAddPayment
}) {
  const [loading, setLoading] = useState(true);
  const [employee, setEmployee] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [summary, setSummary] = useState({ paid: 0, due: 0 });
  const [lastPaymentDate, setLastPaymentDate] = useState('N/A');

  useEffect(() => {
    if (userRole === 'owner' && employeeId) {
      loadAllData();
    } else {
      setLoading(false);
    }
  }, [userRole, employeeId]);

  const loadAllData = () => {
    setLoading(true);
    try {
      const {
        getOwnerEmployeeById,
        getEmployeeSalaryLedger,
        getEmployeeMonthlySummary,
        getLastEmployeePayment
      } = require('../database');

      const emp = getOwnerEmployeeById(employeeId);
      if (emp) {
        setEmployee(emp);

        // Load ledger list
        const ledgerList = getEmployeeSalaryLedger(employeeId);
        setLedger(ledgerList);

        // Load monthly summary (for current month YYYY-MM)
        const currentMonth = new Date().toISOString().substring(0, 7);
        const monthlySum = getEmployeeMonthlySummary(employeeId, currentMonth);
        setSummary(monthlySum);

        // Load last payment
        const lastPay = getLastEmployeePayment(employeeId);
        setLastPaymentDate(lastPay ? lastPay.payment_date : 'N/A');
      } else {
        Alert.alert("ত্রুটি", "কর্মচারীর তথ্য পাওয়া যায়নি।");
        onBack();
      }
    } catch (err) {
      console.error("[EmployeeDetailScreen] Error loading data:", err);
    } finally {
      setLoading(false);
    }
  };

  if (userRole !== 'owner') {
    return <AccessDenied onBack={onBack} />;
  }

  const handleDeleteEmployee = () => {
    Alert.alert(
      "কর্মচারী অপসারণ",
      `আপনি কি নিশ্চিতভাবে ${employee.name}-কে তালিকা থেকে বাদ দিতে চান?`,
      [
        { text: "বাতিল", style: "cancel" },
        {
          text: "অপসারণ করুন",
          style: "destructive",
          onPress: () => {
            try {
              const { deleteOwnerEmployee } = require('../database');
              const success = deleteOwnerEmployee(employeeId);
              if (success) {
                Alert.alert("সফল", "কর্মচারী সফলভাবে অপসারিত হয়েছে।");
                onDeleteSuccess();
              } else {
                Alert.alert("ত্রুটি", "অপসারণ করতে ব্যর্থ হয়েছে।");
              }
            } catch (err) {
              console.error("[EmployeeDetailScreen] Delete employee error:", err);
              Alert.alert("ত্রুটি", "অপসারণ করতে ব্যর্থ হয়েছে।");
            }
          }
        }
      ]
    );
  };

  const handleLongPressLedger = (entry) => {
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
                loadAllData(); // Reload stats and list
              } else {
                Alert.alert("ত্রুটি", "এন্ট্রি মুছে ফেলতে ব্যর্থ হয়েছে।");
              }
            } catch (err) {
              console.error("[EmployeeDetailScreen] Delete ledger entry error:", err);
              Alert.alert("ত্রুটি", "এন্ট্রি মুছে ফেলতে ব্যর্থ হয়েছে।");
            }
          }
        }
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FFB703" />
        </View>
      </SafeAreaView>
    );
  }

  if (!employee) return null;

  const isActive = employee.status === 'ACTIVE';

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>◁ ফিরে যান</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>👤 কর্মচারীর প্রোফাইল</Text>
        <View style={{ width: 80 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Profile Details Card */}
        <View style={styles.profileCard}>
          <View style={styles.profileHeader}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {employee.name ? employee.name.charAt(0).toUpperCase() : '👤'}
              </Text>
            </View>
            <View style={styles.headerInfo}>
              <Text style={styles.employeeName}>{employee.name}</Text>
              <Text style={styles.employeeDes}>{employee.designation || 'পদবী উল্লেখ নেই'}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Employee stats */}
          <View style={styles.detailsList}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>বেতন:</Text>
              <Text style={[styles.detailValue, { color: '#FFB703', fontWeight: 'bold' }]}>
                ৳{(employee.monthly_salary || 0).toLocaleString()}
              </Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>এই মাসে পরিশোধ:</Text>
              <Text style={[styles.detailValue, { color: '#10B981', fontWeight: 'bold' }]}>
                ৳{summary.paid.toLocaleString()}
              </Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>অবশিষ্ট বকেয়া:</Text>
              <Text style={[styles.detailValue, { color: '#EF4444', fontWeight: 'bold' }]}>
                ৳{summary.due.toLocaleString()}
              </Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>সর্বশেষ পরিশোধ:</Text>
              <Text style={styles.detailValue}>{lastPaymentDate}</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>অবস্থা:</Text>
              <View style={[styles.statusBadge, isActive ? styles.activeBadge : styles.inactiveBadge]}>
                <Text style={[styles.statusText, isActive ? styles.activeText : styles.inactiveText]}>
                  {isActive ? 'সক্রিয়' : 'নিষ্ক্রিয়'}
                </Text>
              </View>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>যোগদান:</Text>
              <Text style={styles.detailValue}>{employee.joining_date || 'N/A'}</Text>
            </View>

            {employee.phone ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>মোবাইল:</Text>
                <Text style={styles.detailValue}>{employee.phone}</Text>
              </View>
            ) : null}

            {employee.notes ? (
              <View style={[styles.detailRow, { flexDirection: 'column', alignItems: 'flex-start', gap: 6 }]}>
                <Text style={styles.detailLabel}>অতিরিক্ত নোট:</Text>
                <Text style={styles.notesText}>{employee.notes}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.editButton} onPress={onEditEmployee}>
              <Text style={styles.editButtonText}>📝 এডিট</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.deleteButton} onPress={handleDeleteEmployee}>
              <Text style={styles.deleteButtonText}>🗑️ ডিলিট</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Action Button: Add Payment */}
        <TouchableOpacity style={styles.addPaymentBtn} onPress={onAddPayment}>
          <Text style={styles.addPaymentBtnText}>💰 বেতন পরিশোধ (Add Payment)</Text>
        </TouchableOpacity>

        {/* Salary History list */}
        <Text style={styles.sectionTitle}>বেতন বিবরণীর খতিয়ান (Salary Ledger)</Text>
        {ledger.length === 0 ? (
          <View style={styles.emptyLedgerCard}>
            <Text style={styles.emptyLedgerText}>কোনো লেনদেনের তথ্য পাওয়া যায়নি।</Text>
          </View>
        ) : (
          <View style={styles.ledgerListContainer}>
            <Text style={styles.helperTip}>💡 মুছতে চাইলে পেমেন্ট রোটির উপর দীর্ঘক্ষণ টিপে (Long Press) ধরে রাখুন।</Text>
            {ledger.map((item) => {
              const isDeduction = item.payment_type === 'Deduction';
              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.ledgerItem}
                  onLongPress={() => handleLongPressLedger(item)}
                  delayLongPress={800}
                >
                  <View style={styles.ledgerLeft}>
                    <Text style={styles.ledgerDate}>{item.payment_date}</Text>
                    <Text style={styles.ledgerType}>{item.payment_type}</Text>
                    {item.notes ? <Text style={styles.ledgerNotes}>{item.notes}</Text> : null}
                  </View>
                  <View style={styles.ledgerRight}>
                    <Text style={[styles.ledgerAmount, isDeduction ? styles.amountDeduction : styles.amountPositive]}>
                      {isDeduction ? '-' : '+'} ৳{item.amount.toLocaleString()}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
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
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  profileCard: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 20,
    padding: 20,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFB703',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#000000',
    fontSize: 24,
    fontWeight: 'bold',
  },
  headerInfo: {
    flex: 1,
  },
  employeeName: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  employeeDes: {
    color: '#888',
    fontSize: 13,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#262626',
    marginVertical: 16,
  },
  detailsList: {
    gap: 12,
    marginBottom: 20,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  detailValue: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
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
  notesText: {
    color: '#AAA',
    fontSize: 12,
    lineHeight: 18,
    backgroundColor: '#1E1E1E',
    width: '100%',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  editButton: {
    flex: 1,
    backgroundColor: '#FFB703',
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editButtonText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold',
  },
  deleteButton: {
    flex: 1,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#EF4444',
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButtonText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: 'bold',
  },
  addPaymentBtn: {
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#FFB703',
    height: 54,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPaymentBtnText: {
    color: '#FFB703',
    fontSize: 14,
    fontWeight: 'bold',
  },
  sectionTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginTop: 10,
    marginBottom: 6,
  },
  emptyLedgerCard: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLedgerText: {
    color: '#888',
    fontSize: 13,
  },
  helperTip: {
    color: '#888',
    fontSize: 11,
    fontStyle: 'italic',
    marginBottom: 10,
  },
  ledgerListContainer: {
    gap: 12,
  },
  ledgerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 14,
    padding: 16,
  },
  ledgerLeft: {
    flex: 1,
    gap: 4,
  },
  ledgerDate: {
    color: '#888',
    fontSize: 11,
    fontWeight: '500',
  },
  ledgerType: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  ledgerNotes: {
    color: '#AAA',
    fontSize: 12,
    fontStyle: 'italic',
  },
  ledgerRight: {
    alignItems: 'flex-end',
  },
  ledgerAmount: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  amountPositive: {
    color: '#10B981',
  },
  amountDeduction: {
    color: '#EF4444',
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
});
