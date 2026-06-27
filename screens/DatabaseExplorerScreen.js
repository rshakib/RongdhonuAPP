import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { executeInspectorQuery } from '../database';

export default function DatabaseExplorerScreen({ onBack, onSelectTable }) {
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState([]);

  useEffect(() => {
    loadTables();
  }, []);

  const loadTables = () => {
    setLoading(true);
    try {
      const tablesList = [
        'users', 'menu_categories', 'menu_items', 'restaurant_tables',
        'orders', 'order_items', 'payments', 'expenses', 'deliveries',
        'daily_submit', 'daily_summary', 'due_payments', 'eja_history',
        'supplier_due', 'supplier_due_history', 'supplier_payment_ledger',
        'deletions', 'delete_history', 'sync_queue', 'history_download_log',
        'daily_submit_priority'
      ];

      const list = [];
      for (const t of tablesList) {
        try {
          const res = executeInspectorQuery(`SELECT COUNT(*) as c FROM ${t}`);
          const count = res[0]?.c ?? 0;
          list.push({ name: t, count });
        } catch (e) {
          list.push({ name: t, count: 'N/A' });
        }
      }
      setTables(list);
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
        <Text style={styles.headerTitle}>📂 Database Explorer</Text>
        <TouchableOpacity onPress={loadTables} style={styles.refreshBtn}>
          <Text style={styles.refreshBtnText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FFB703" />
        </View>
      ) : (
        <ScrollView style={styles.content}>
          <Text style={styles.sectionTitle}>Local SQLite Tables</Text>
          {tables.map((table) => (
            <TouchableOpacity 
              key={table.name} 
              style={styles.card}
              onPress={() => onSelectTable(table.name)}
            >
              <View>
                <Text style={styles.cardTitle}>{table.name}</Text>
                <Text style={styles.cardDesc}>{table.count} rows stored</Text>
              </View>
              <Text style={styles.arrow}>❯</Text>
            </TouchableOpacity>
          ))}
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
  sectionTitle: { color: '#888', fontSize: 13, fontWeight: 'bold', marginBottom: 16, textTransform: 'uppercase' },
  card: { backgroundColor: '#111', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#222', marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: '#FFF', fontSize: 15, fontWeight: 'bold' },
  cardDesc: { color: '#888', fontSize: 12, marginTop: 4 },
  arrow: { color: '#FFB703', fontSize: 16, fontWeight: 'bold' }
});
