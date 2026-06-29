import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator
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

const PAYMENT_TYPES = ['Advance', 'Salary', 'Bonus', 'Deduction'];

export default function AddSalaryPaymentScreen({
  userRole,
  onBack,
  employeeId,
  onSaveSuccess
}) {
  const [employee, setEmployee] = useState(null);
  const [amount, setAmount] = useState('');
  const [paymentType, setPaymentType] = useState('Salary');
  const [paymentDate, setPaymentDate] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userRole === 'owner') {
      loadEmployeeDetails();
    } else {
      setLoading(false);
    }
  }, [userRole, employeeId]);

  const loadEmployeeDetails = () => {
    setLoading(true);
    try {
      const { getOwnerEmployeeById } = require('../database');
      const emp = getOwnerEmployeeById(employeeId);
      if (emp) {
        setEmployee(emp);
        
        // Pre-fill today's date
        const today = new Date().toISOString().substring(0, 10);
        setPaymentDate(today);
      } else {
        Alert.alert("ত্রুটি", "কর্মচারীর তথ্য পাওয়া যায়নি।");
        onBack();
      }
    } catch (err) {
      console.error("[AddSalaryPaymentScreen] Error loading employee details:", err);
    } finally {
      setLoading(false);
    }
  };

  if (userRole !== 'owner') {
    return <AccessDenied onBack={onBack} />;
  }

  const handleSave = () => {
    const numAmount = parseFloat(amount) || 0;
    if (numAmount <= 0) {
      Alert.alert("ইনপুট ত্রুটি", "পরিশোধের পরিমাণ অবশ্যই ০ থেকে বেশি হতে হবে।");
      return;
    }

    if (!paymentDate.trim()) {
      Alert.alert("ইনপুট ত্রুটি", "পরিশোধের তারিখ দেওয়া আবশ্যক।");
      return;
    }

    try {
      const { saveSalaryLedgerEntry } = require('../database');
      
      const payload = {
        employee_id: employeeId,
        amount: numAmount,
        payment_type: paymentType,
        payment_date: paymentDate.trim(),
        notes: notes.trim()
      };

      const newId = saveSalaryLedgerEntry(payload);
      if (newId) {
        Alert.alert("সফল", "বেতন পরিশোধ বিবরণী সফলভাবে যুক্ত হয়েছে।");
        onSaveSuccess();
      } else {
        Alert.alert("ত্রুটি", "ডাটা সংরক্ষণ করতে ব্যর্থ হয়েছে।");
      }
    } catch (err) {
      console.error("[AddSalaryPaymentScreen] Save payment error:", err);
      Alert.alert("ত্রুটি", "ডাটা সংরক্ষণ করতে ব্যর্থ হয়েছে।");
    }
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

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backButtonText}>◁ বাতিল</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>💰 বেতন পরিশোধ</Text>
          <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
            <Text style={styles.saveButtonText}>নিশ্চিত</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {employee ? (
            <View style={styles.employeeCard}>
              <Text style={styles.employeeName}>👤 {employee.name}</Text>
              <Text style={styles.employeeDes}>{employee.designation || 'পদবী নেই'}</Text>
              <Text style={styles.employeeSalary}>বেতন হার: ৳{(employee.monthly_salary || 0).toLocaleString()} / মাস</Text>
            </View>
          ) : null}

          {/* Form */}
          <View style={styles.formGroup}>
            <Text style={styles.inputLabel}>পরিশোধের পরিমাণ (৳) *</Text>
            <TextInput
              style={styles.textInput}
              value={amount}
              onChangeText={setAmount}
              placeholder="যেমন: ৫০০০"
              placeholderTextColor="#666"
              keyboardType="numeric"
              autoFocus={true}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.inputLabel}>পেমেন্ট টাইপ *</Text>
            <View style={styles.typeSelector}>
              {PAYMENT_TYPES.map((type) => {
                const isSelected = paymentType === type;
                return (
                  <TouchableOpacity
                    key={type}
                    style={[styles.typeBtn, isSelected && styles.typeBtnActive]}
                    onPress={() => setPaymentType(type)}
                  >
                    <Text style={[styles.typeBtnText, isSelected && styles.typeBtnTextActive]}>
                      {type === 'Advance' ? 'Advance' :
                       type === 'Salary' ? 'Salary' :
                       type === 'Bonus' ? 'Bonus' : 'Deduction'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.inputLabel}>পরিশোধের তারিখ</Text>
            <TextInput
              style={styles.textInput}
              value={paymentDate}
              onChangeText={setPaymentDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#666"
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.inputLabel}>নোট/মন্তব্য</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={notes}
              onChangeText={setNotes}
              placeholder="যেমন: জুন ২০২৬ এর আংশিক বেতন"
              placeholderTextColor="#666"
              multiline={true}
              numberOfLines={3}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
  saveButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#FFB703',
  },
  saveButtonText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold',
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  employeeCard: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 16,
    padding: 16,
    gap: 4,
  },
  employeeName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  employeeDes: {
    color: '#888',
    fontSize: 12,
  },
  employeeSalary: {
    color: '#FFB703',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
  },
  formGroup: {
    gap: 8,
  },
  inputLabel: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  textInput: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 16,
    color: '#FFFFFF',
    fontSize: 14,
  },
  typeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeBtn: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
  },
  typeBtnActive: {
    backgroundColor: 'rgba(255, 183, 3, 0.15)',
    borderColor: '#FFB703',
  },
  typeBtnText: {
    fontSize: 13,
    color: '#888',
    fontWeight: '600',
  },
  typeBtnTextActive: {
    color: '#FFB703',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
    paddingTop: 12,
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
