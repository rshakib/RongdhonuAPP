import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
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

export default function EmployeeListScreen({
  userRole,
  onBack,
  onAddEmployee,
  onSelectEmployee
}) {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

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
      const { getOwnerEmployees } = require('../database');
      const list = getOwnerEmployees();
      setEmployees(list);
    } catch (err) {
      console.error("[EmployeeListScreen] Error loading employees:", err);
    } finally {
      setLoading(false);
    }
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

  const renderEmployeeItem = ({ item }) => {
    const isActive = item.status === 'ACTIVE';
    return (
      <TouchableOpacity
        style={[styles.employeeCard, !isActive && styles.inactiveCardBorder]}
        onPress={() => onSelectEmployee(item.id)}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.employeeName}>👤 {item.name}</Text>
          <View style={[styles.statusBadge, isActive ? styles.activeBadge : styles.inactiveBadge]}>
            <Text style={[styles.statusText, isActive ? styles.activeText : styles.inactiveText]}>
              {isActive ? 'সক্রিয়' : 'নিষ্ক্রিয়'}
            </Text>
          </View>
        </View>

        <View style={styles.cardBody}>
          <Text style={styles.infoRow}>
            <Text style={styles.infoLabel}>পদবী: </Text>
            <Text style={styles.infoValue}>{item.designation || 'N/A'}</Text>
          </Text>
          <Text style={styles.infoRow}>
            <Text style={styles.infoLabel}>মাসিক বেতন: </Text>
            <Text style={[styles.infoValue, { color: '#FFB703', fontWeight: 'bold' }]}>
              ৳{(item.monthly_salary || 0).toLocaleString()}
            </Text>
          </Text>
          {item.phone ? (
            <Text style={styles.infoRow}>
              <Text style={styles.infoLabel}>মোবাইল: </Text>
              <Text style={styles.infoValue}>{item.phone}</Text>
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>◁ ফিরে যান</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>👥 কর্মচারী তালিকা</Text>
        <TouchableOpacity style={styles.addButton} onPress={onAddEmployee}>
          <Text style={styles.addButtonText}>➕ নতুন</Text>
        </TouchableOpacity>
      </View>

      {/* Search bar */}
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
          renderItem={renderEmployeeItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>কোনো কর্মচারী পাওয়া যায়নি।</Text>
            </View>
          }
        />
      )}
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
    gap: 12,
  },
  employeeCard: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 16,
    padding: 16,
  },
  inactiveCardBorder: {
    borderColor: 'rgba(239, 68, 68, 0.3)',
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
  cardBody: {
    gap: 6,
  },
  infoRow: {
    fontSize: 13,
    color: '#FFFFFF',
  },
  infoLabel: {
    color: '#888',
  },
  infoValue: {
    color: '#FFFFFF',
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
});
