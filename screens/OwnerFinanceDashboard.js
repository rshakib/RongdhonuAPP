import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator
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

export default function OwnerFinanceDashboard({ userRole, onBack, onNavigateToEmployees }) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    inactive: 0,
    totalSalary: 0
  });

  useEffect(() => {
    if (userRole === 'owner') {
      loadStats();
    } else {
      setLoading(false);
    }
  }, [userRole]);

  const loadStats = () => {
    setLoading(true);
    try {
      const { getOwnerEmployees } = require('../database');
      const employees = getOwnerEmployees();
      
      const total = employees.length;
      const active = employees.filter(e => e.status === 'ACTIVE').length;
      const inactive = employees.filter(e => e.status === 'INACTIVE').length;
      const totalSalary = employees
        .filter(e => e.status === 'ACTIVE')
        .reduce((sum, e) => sum + (e.monthly_salary || 0), 0);

      setStats({ total, active, inactive, totalSalary });
    } catch (err) {
      console.error("[OwnerFinanceDashboard] Error loading stats:", err);
    } finally {
      setLoading(false);
    }
  };

  if (userRole !== 'owner') {
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

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionTitle}>ফাইনান্সিয়াল ওভারভিউ</Text>
        
        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statsCard}>
            <Text style={styles.cardEmoji}>👥</Text>
            <Text style={styles.cardValue}>{stats.total}</Text>
            <Text style={styles.cardLabel}>মোট কর্মচারী</Text>
          </View>

          <View style={styles.statsCard}>
            <Text style={styles.cardEmoji}>💰</Text>
            <Text style={[styles.cardValue, { color: '#FFB703' }]}>৳{stats.totalSalary.toLocaleString()}</Text>
            <Text style={styles.cardLabel}>মাসিক বেতন (সক্রিয়)</Text>
          </View>

          <View style={[styles.statsCard, { borderColor: '#10B981' }]}>
            <Text style={styles.cardEmoji}>🟢</Text>
            <Text style={[styles.cardValue, { color: '#10B981' }]}>{stats.active}</Text>
            <Text style={styles.cardLabel}>সক্রিয় কর্মচারী</Text>
          </View>

          <View style={[styles.statsCard, { borderColor: '#EF4444' }]}>
            <Text style={styles.cardEmoji}>🔴</Text>
            <Text style={[styles.cardValue, { color: '#EF4444' }]}>{stats.inactive}</Text>
            <Text style={styles.cardLabel}>নিষ্ক্রিয় কর্মচারী</Text>
          </View>
        </View>

        {/* Main Action Button */}
        <TouchableOpacity style={styles.primaryButton} onPress={onNavigateToEmployees}>
          <Text style={styles.primaryButtonText}>👥 কর্মচারী ব্যবস্থাপনা (Manage)</Text>
        </TouchableOpacity>

        {/* Informative placeholder card */}
        <View style={styles.infoCard}>
          <Text style={styles.infoCardTitle}>ℹ️ ফাইনান্স ম্যানেজার ফেজ ২</Text>
          <Text style={styles.infoCardText}>
            পরবর্তী ধাপে কর্মচারীদের বেতন প্রদান (Salary Ledger) এবং ওনারের ব্যক্তিগত খরচ ট্র্যাকার (Owner Expenses) যুক্ত করা হবে।
          </Text>
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
  },
  sectionTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 24,
  },
  statsCard: {
    width: (width - 44) / 2,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  cardEmoji: {
    fontSize: 24,
    marginBottom: 8,
  },
  cardValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  cardLabel: {
    fontSize: 11,
    color: '#888',
    fontWeight: '500',
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: '#FFB703',
    height: 56,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#FFB703',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  primaryButtonText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: 'bold',
  },
  infoCard: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 14,
    padding: 16,
  },
  infoCardTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  infoCardText: {
    color: '#888',
    fontSize: 12,
    lineHeight: 18,
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
