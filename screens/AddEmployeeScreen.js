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
  Platform
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

export default function AddEmployeeScreen({
  userRole,
  onBack,
  employeeId, // If provided, we are in Edit Mode
  onSaveSuccess
}) {
  const isEditMode = !!employeeId;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [designation, setDesignation] = useState('');
  const [salary, setSalary] = useState('');
  const [joiningDate, setJoiningDate] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [notes, setNotes] = useState('');
  
  // Keep track of the original record to preserve created_at
  const [originalRecord, setOriginalRecord] = useState(null);

  useEffect(() => {
    if (userRole === 'owner') {
      if (isEditMode) {
        loadEmployeeDetails();
      } else {
        // Pre-fill with today's date
        const today = new Date().toISOString().substring(0, 10);
        setJoiningDate(today);
      }
    }
  }, [userRole, employeeId]);

  const loadEmployeeDetails = () => {
    try {
      const { getOwnerEmployeeById } = require('../database');
      const emp = getOwnerEmployeeById(employeeId);
      if (emp) {
        setOriginalRecord(emp);
        setName(emp.name);
        setPhone(emp.phone || '');
        setDesignation(emp.designation || '');
        setSalary(emp.monthly_salary ? emp.monthly_salary.toString() : '');
        setJoiningDate(emp.joining_date || '');
        setStatus(emp.status || 'ACTIVE');
        setNotes(emp.notes || '');
      } else {
        Alert.alert("ত্রুটি", "কর্মচারীর তথ্য পাওয়া যায়নি।");
        onBack();
      }
    } catch (err) {
      console.error("[AddEmployeeScreen] Error loading employee details:", err);
    }
  };

  if (userRole !== 'owner') {
    return <AccessDenied onBack={onBack} />;
  }

  const handleSave = () => {
    // Validations
    if (!name.trim()) {
      Alert.alert("ইনপুট ত্রুটি", "কর্মচারীর নাম দেওয়া আবশ্যক।");
      return;
    }

    const numSalary = parseFloat(salary) || 0;
    if (numSalary <= 0) {
      Alert.alert("ইনপুট ত্রুটি", "মাসিক বেতন অবশ্যই ০ থেকে বেশি হতে হবে।");
      return;
    }

    try {
      const { saveOwnerEmployee, updateOwnerEmployee } = require('../database');
      
      const payload = {
        name: name.trim(),
        phone: phone.trim(),
        designation: designation.trim(),
        monthly_salary: numSalary,
        joining_date: joiningDate.trim(),
        status,
        notes: notes.trim(),
      };

      let success = false;
      if (isEditMode) {
        payload.id = employeeId;
        payload.created_at = originalRecord ? originalRecord.created_at : new Date().toISOString();
        success = updateOwnerEmployee(payload);
      } else {
        const newId = saveOwnerEmployee(payload);
        success = !!newId;
      }

      if (success) {
        Alert.alert("সফল", isEditMode ? "কর্মচারীর তথ্য সফলভাবে আপডেট হয়েছে।" : "নতুন কর্মচারী সফলভাবে যুক্ত হয়েছে।");
        onSaveSuccess();
      } else {
        Alert.alert("ত্রুটি", "ডাটা সংরক্ষণ করতে ব্যর্থ হয়েছে।");
      }
    } catch (err) {
      console.error("[AddEmployeeScreen] Save error:", err);
      Alert.alert("ত্রুটি", "ডাটা সংরক্ষণ করতে ব্যর্থ হয়েছে।");
    }
  };

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
          <Text style={styles.headerTitle}>
            {isEditMode ? '👤 তথ্য পরিবর্তন' : '➕ নতুন কর্মচারী'}
          </Text>
          <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
            <Text style={styles.saveButtonText}>সংরক্ষণ</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Form */}
          <View style={styles.formGroup}>
            <Text style={styles.inputLabel}>নাম *</Text>
            <TextInput
              style={styles.textInput}
              value={name}
              onChangeText={setName}
              placeholder="কর্মচারীর নাম লিখুন"
              placeholderTextColor="#666"
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.inputLabel}>পদবী</Text>
            <TextInput
              style={styles.textInput}
              value={designation}
              onChangeText={setDesignation}
              placeholder="যেমন: Chef, Waiter, Manager"
              placeholderTextColor="#666"
            />
          </View>

          <View style={styles.formRow}>
            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text style={styles.inputLabel}>মাসিক বেতন (৳) *</Text>
              <TextInput
                style={styles.textInput}
                value={salary}
                onChangeText={setSalary}
                placeholder="যেমন: ১৫০০০"
                placeholderTextColor="#666"
                keyboardType="numeric"
              />
            </View>

            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text style={styles.inputLabel}>মোবাইল নং</Text>
              <TextInput
                style={styles.textInput}
                value={phone}
                onChangeText={setPhone}
                placeholder="০১XXXXXXXXX"
                placeholderTextColor="#666"
                keyboardType="phone-pad"
              />
            </View>
          </View>

          <View style={styles.formRow}>
            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text style={styles.inputLabel}>যোগদানের তারিখ</Text>
              <TextInput
                style={styles.textInput}
                value={joiningDate}
                onChangeText={setJoiningDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#666"
              />
            </View>

            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text style={styles.inputLabel}>অবস্থা (Status)</Text>
              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[styles.toggleBtn, status === 'ACTIVE' && styles.toggleBtnActive]}
                  onPress={() => setStatus('ACTIVE')}
                >
                  <Text style={[styles.toggleText, status === 'ACTIVE' && styles.toggleTextActive]}>
                    সক্রিয়
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.toggleBtn, status === 'INACTIVE' && styles.toggleBtnInactive]}
                  onPress={() => setStatus('INACTIVE')}
                >
                  <Text style={[styles.toggleText, status === 'INACTIVE' && styles.toggleTextActive]}>
                    নিষ্ক্রিয়
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.inputLabel}>অতিরিক্ত নোট</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={notes}
              onChangeText={setNotes}
              placeholder="কর্মচারী সম্পর্কিত মন্তব্য বা তথ্য লিখুন..."
              placeholderTextColor="#666"
              multiline={true}
              numberOfLines={4}
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
  formGroup: {
    gap: 8,
  },
  formRow: {
    flexDirection: 'row',
    gap: 12,
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
  textArea: {
    height: 100,
    textAlignVertical: 'top',
    paddingTop: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    padding: 4,
    height: 48,
  },
  toggleBtn: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  toggleBtnActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  toggleBtnInactive: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  toggleText: {
    fontSize: 13,
    color: '#888',
    fontWeight: '600',
  },
  toggleTextActive: {
    color: '#10B981',
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
