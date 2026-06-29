import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
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

export default function EmployeeDetailScreen({
  userRole,
  onBack,
  employeeId,
  onEditEmployee,
  onDeleteSuccess
}) {
  const [loading, setLoading] = useState(true);
  const [employee, setEmployee] = useState(null);

  useEffect(() => {
    if (userRole === 'owner' && employeeId) {
      loadEmployee();
    } else {
      setLoading(false);
    }
  }, [userRole, employeeId]);

  const loadEmployee = () => {
    setLoading(true);
    try {
      const { getOwnerEmployeeById } = require('../database');
      const emp = getOwnerEmployeeById(employeeId);
      if (emp) {
        setEmployee(emp);
      } else {
        Alert.alert("ত্রুটি", "কর্মচারীর তথ্য পাওয়া যায়নি।");
        onBack();
      }
    } catch (err) {
      console.error("[EmployeeDetailScreen] Error loading employee:", err);
    } finally {
      setLoading(false);
    }
  };

  if (userRole !== 'owner') {
    return <AccessDenied onBack={onBack} />;
  }

  const handleDelete = () => {
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
              console.error("[EmployeeDetailScreen] Delete error:", err);
              Alert.alert("ত্রুটি", "অপসারণ করতে ব্যর্থ হয়েছে।");
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
        {/* Profile Card */}
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

          {/* Employee Meta details */}
          <View style={styles.detailsList}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>বেতন:</Text>
              <Text style={[styles.detailValue, { color: '#FFB703', fontWeight: 'bold' }]}>
                ৳{(employee.monthly_salary || 0).toLocaleString()} / মাস
              </Text>
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
              <Text style={styles.editButtonText}>📝 তথ্য পরিবর্তন (Edit)</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
              <Text style={styles.deleteButtonText}>🗑️ অপসারণ (Delete)</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Phase 2 Salary Ledger section placeholder */}
        <Text style={styles.sectionTitle}>বেতন পরিশোধের খতিয়ান (Salary Ledger)</Text>
        <View style={styles.placeholderCard}>
          <Text style={styles.placeholderEmoji}>🚧</Text>
          <Text style={styles.placeholderTitle}>বেতন খতিয়ান মডিউল</Text>
          <Text style={styles.placeholderText}>Coming in Phase 2</Text>
        </View>
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
  sectionTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginTop: 10,
    marginBottom: 6,
  },
  placeholderCard: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderEmoji: {
    fontSize: 32,
    marginBottom: 12,
  },
  placeholderTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  placeholderText: {
    fontSize: 12,
    color: '#FFB703',
    fontWeight: '600',
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
