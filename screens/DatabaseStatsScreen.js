import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { executeInspectorQuery } from '../database';

export default function DatabaseStatsScreen({ onBack }) {
  const [loading, setLoading] = useState(true);
  const [tableStats, setTableStats] = useState([]);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = () => {
    setLoading(true);
    try {
      const tablesList = [
        'users', 'menu_categories', 'menu_items', 'restaurant_tables',
        'orders', 'order_items', 'payments', 'expenses', 'deliveries',
        'daily_submit', 'daily_summary', 'due_payments', 'eja_history',
        'supplier_due', 'supplier_due_history', 'supplier_payment_ledger',
        'deletions', 'delete_history', 'sync_queue', 'history_download_log'
      ];

      const stats = [];
      for (const table of tablesList) {
        try {
          const res = executeInspectorQuery(`SELECT COUNT(*) as c FROM ${table}`);
          const count = res[0]?.c ?? 0;
          stats.push({ table, count, status: 'OK' });
        } catch (e) {
          stats.push({ table, count: 'N/A', status: 'ERROR' });
        }
      }

      setTableStats(stats);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>❮ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>📊 Database Stats</Text>
        <TouchableOpacity onPress={loadStats} style={styles.refreshBtn}>
          <Text style={styles.refreshBtnText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FFB703" />
        </View>
      ) : (
        <ScrollView style={styles.content}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>SQLite Row Counts</Text>
            
            {tableStats.map((item) => (
              <View key={item.table} style={styles.row}>
                <Text style={styles.key}>{item.table}</Text>
                <Text style={[styles.val, item.status === 'ERROR' && styles.errorText]}>
                  {item.count}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderColor: '#1A1A1A' },
  backBtn: { padding: 4 },
  backBtnText: { color: '#FFB703', fontWeight: 'bold' },
  headerTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  refreshBtn: { padding: 4 },
  refreshBtnText: { color: '#FFB703' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16 },
  card: { backgroundColor: '#111', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#222' },
  cardTitle: { color: '#FFB703', fontSize: 16, fontWeight: 'bold', marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 0.5, borderColor: '#222' },
  key: { color: '#FFF', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  val: { color: '#888', fontSize: 13, fontWeight: 'bold' },
  errorText: { color: '#EF4444' }
});
