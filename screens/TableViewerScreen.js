import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { executeInspectorQuery } from '../database';

export default function TableViewerScreen({ tableName, onBack, onSelectRow }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [searchId, setSearchId] = useState('');

  useEffect(() => {
    loadRows();
  }, [searchId]);

  const loadRows = () => {
    setLoading(true);
    try {
      let query = '';
      let params = [];
      
      if (searchId.trim()) {
        query = `SELECT * FROM ${tableName} WHERE id LIKE ? LIMIT 100`;
        params = [`%${searchId.trim()}%`];
      } else {
        query = `SELECT * FROM ${tableName} ORDER BY ROWID DESC LIMIT 100`;
      }
      
      const results = executeInspectorQuery(query, params);
      setRows(results);
    } catch (err) {
      console.error(err);
      setRows([]);
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
        <Text style={styles.headerTitle} numberOfLines={1}>{tableName.toUpperCase()}</Text>
        <TouchableOpacity onPress={loadRows} style={styles.refreshBtn}>
          <Text style={styles.refreshBtnText}>Reload</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchBar}>
        <TextInput 
          style={styles.searchInput}
          placeholder="Search by ID..."
          placeholderTextColor="#666"
          value={searchId}
          onChangeText={setSearchId}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchId ? (
          <TouchableOpacity style={styles.clearBtn} onPress={() => setSearchId('')}>
            <Text style={styles.clearBtnText}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FFB703" />
        </View>
      ) : (
        <ScrollView style={styles.content}>
          <Text style={styles.sectionTitle}>Latest 100 Rows</Text>
          {rows.length === 0 ? (
            <Text style={styles.emptyText}>No matching rows found.</Text>
          ) : (
            rows.map((row, idx) => {
              // Guess secondary key to display, e.g. amount, name, date, etc.
              const label = row.name || row.itemName || row.category || row.title || row.table_id || row.business_date || '';
              const id = row.id || row.date || `Row ${idx + 1}`;
              return (
                <TouchableOpacity 
                  key={idx} 
                  style={styles.card}
                  onPress={() => onSelectRow(row)}
                >
                  <View style={styles.cardLeft}>
                    <Text style={styles.cardId} numberOfLines={1}>ID: {id}</Text>
                    {label ? <Text style={styles.cardLabel} numberOfLines={1}>{label}</Text> : null}
                  </View>
                  <Text style={styles.arrow}>❯</Text>
                </TouchableOpacity>
              );
            })
          )}
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
  headerTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold', maxWidth: '60%' },
  refreshBtn: { padding: 4 },
  refreshBtnText: { color: '#FFB703' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', margin: 16, borderRadius: 8, borderWidth: 1, borderColor: '#222', paddingHorizontal: 12 },
  searchInput: { flex: 1, height: 40, color: '#FFF', fontSize: 13 },
  clearBtn: { padding: 4 },
  clearBtnText: { color: '#888', fontWeight: 'bold' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { paddingHorizontal: 16 },
  sectionTitle: { color: '#888', fontSize: 12, fontWeight: 'bold', marginBottom: 12, textTransform: 'uppercase' },
  emptyText: { color: '#555', fontStyle: 'italic', fontSize: 13, textAlign: 'center', paddingVertical: 40 },
  card: { backgroundColor: '#111', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#222', marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLeft: { flex: 1, marginRight: 16 },
  cardId: { color: '#FFF', fontSize: 13, fontWeight: 'bold', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  cardLabel: { color: '#888', fontSize: 11, marginTop: 4 },
  arrow: { color: '#FFB703', fontSize: 14, fontWeight: 'bold' }
});
