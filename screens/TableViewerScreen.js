import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { executeInspectorQuery } from '../database';

export default function TableViewerScreen({ tableName, onBack, onSelectRow }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  
  // Filtering & Sorting State
  const [searchQuery, setSearchQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortOrder, setSortOrder] = useState('DESC'); // DESC or ASC
  
  const [dateColumn, setDateColumn] = useState(null);
  const [tableColumns, setTableColumns] = useState([]);

  // Detect Schema and Date Column on Mount
  useEffect(() => {
    detectSchema();
  }, [tableName]);

  // Reload rows when search, dates, or sorting changes
  useEffect(() => {
    loadRows();
  }, [tableName, searchQuery, fromDate, toDate, sortOrder, dateColumn, tableColumns]);

  const detectSchema = () => {
    try {
      // 1. Get Columns
      let cols = [];
      try {
        const schemaInfo = executeInspectorQuery(`SELECT name FROM pragma_table_info('${tableName}')`);
        if (schemaInfo && schemaInfo.length > 0) {
          cols = schemaInfo.map(c => c.name);
        }
      } catch (err) {
        // Fallback: Fetch a single row to inspect keys
        const oneRow = executeInspectorQuery(`SELECT * FROM ${tableName} LIMIT 1`);
        if (oneRow && oneRow.length > 0) {
          cols = Object.keys(oneRow[0]);
        }
      }
      setTableColumns(cols);

      // 2. Detect Date Column by priority
      const priorityDateCols = ['created_at', 'updated_at', 'date', 'completed_at'];
      let foundDateCol = null;
      
      for (const col of priorityDateCols) {
        if (cols.includes(col)) {
          foundDateCol = col;
          break;
        }
      }
      
      // Fallback: Try selecting columns to see if they exist
      if (!foundDateCol) {
        for (const col of priorityDateCols) {
          try {
            executeInspectorQuery(`SELECT ${col} FROM ${tableName} LIMIT 1`);
            foundDateCol = col;
            break;
          } catch (e) {}
        }
      }
      setDateColumn(foundDateCol);
    } catch (err) {
      console.error("Error detecting schema:", err);
    }
  };

  const loadRows = () => {
    setLoading(true);
    try {
      let query = `SELECT * FROM ${tableName}`;
      let whereClauses = [];
      let params = [];

      // 1. Search filter (Universal search on all columns)
      if (searchQuery.trim()) {
        const likeQuery = `%${searchQuery.trim()}%`;
        const targets = tableColumns.length > 0 ? tableColumns : ['id'];
        const clauses = targets.map(col => `${col} LIKE ?`);
        if (clauses.length > 0) {
          whereClauses.push(`(${clauses.join(' OR ')})`);
          clauses.forEach(() => params.push(likeQuery));
        }
      }

      // 2. Date filters
      if (dateColumn) {
        if (fromDate.trim()) {
          whereClauses.push(`date(${dateColumn}) >= date(?)`);
          params.push(fromDate.trim());
        }
        if (toDate.trim()) {
          whereClauses.push(`date(${dateColumn}) <= date(?)`);
          params.push(toDate.trim());
        }
      }

      if (whereClauses.length > 0) {
        query += ` WHERE ${whereClauses.join(' AND ')}`;
      }

      // 3. Sorting
      if (dateColumn) {
        query += ` ORDER BY ${dateColumn} ${sortOrder}`;
      } else {
        query += ` ORDER BY ROWID ${sortOrder}`;
      }

      // LIMIT 100
      query += ` LIMIT 100`;

      const results = executeInspectorQuery(query, params);
      setRows(results);
    } catch (err) {
      console.error("Error loading table rows:", err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  // Helper: Format today/past dates
  const formatDateString = (dateObj) => {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const setQuickDateRange = (days) => {
    const today = new Date();
    const toStr = formatDateString(today);
    
    const fromDateObj = new Date();
    fromDateObj.setDate(today.getDate() - days);
    const fromStr = formatDateString(fromDateObj);
    
    setFromDate(fromStr);
    setToDate(toStr);
  };

  const setTodayOnly = () => {
    const todayStr = formatDateString(new Date());
    setFromDate(todayStr);
    setToDate(todayStr);
  };

  const clearAllFilters = () => {
    setSearchQuery('');
    setFromDate('');
    setToDate('');
    setSortOrder('DESC');
  };

  const activeFilterCount = 
    (searchQuery ? 1 : 0) + 
    (fromDate ? 1 : 0) + 
    (toDate ? 1 : 0) + 
    (sortOrder !== 'DESC' ? 1 : 0);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>❮ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{tableName.toUpperCase()}</Text>
        <TouchableOpacity onPress={loadRows} style={styles.refreshBtn}>
          <Text style={styles.refreshBtnText}>Reload</Text>
        </TouchableOpacity>
      </View>

      {/* Filter and Settings Panel */}
      <View style={styles.filterPanel}>
        {/* Universal Search */}
        <View style={styles.searchBar}>
          <TextInput 
            style={styles.searchInput}
            placeholder="Search by ID or keyword..."
            placeholderTextColor="#666"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery ? (
            <TouchableOpacity style={styles.clearBtn} onPress={() => setSearchQuery('')}>
              <Text style={styles.clearBtnText}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Date Filters (Only visible if Date Column is detected) */}
        {dateColumn ? (
          <View style={styles.dateFilterContainer}>
            <Text style={styles.filterSubLabel}>📅 Date Range ({dateColumn})</Text>
            <View style={styles.dateInputsRow}>
              <TextInput
                style={styles.dateInput}
                placeholder="From: YYYY-MM-DD"
                placeholderTextColor="#555"
                value={fromDate}
                onChangeText={setFromDate}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextInput
                style={styles.dateInput}
                placeholder="To: YYYY-MM-DD"
                placeholderTextColor="#555"
                value={toDate}
                onChangeText={setToDate}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={styles.quickDateRow}>
              <TouchableOpacity style={styles.quickDateBtn} onPress={setTodayOnly}>
                <Text style={styles.quickDateText}>Today</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quickDateBtn} onPress={() => setQuickDateRange(7)}>
                <Text style={styles.quickDateText}>7 Days</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quickDateBtn} onPress={() => setQuickDateRange(30)}>
                <Text style={styles.quickDateText}>30 Days</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.noDateWarning}>
            <Text style={styles.noDateWarningText}>⚠️ No date fields detected for filtering in this table.</Text>
          </View>
        )}

        {/* Sort & Action Options */}
        <View style={styles.actionRow}>
          <View style={styles.sortContainer}>
            <TouchableOpacity 
              style={[styles.sortBtn, sortOrder === 'DESC' && styles.sortBtnActive]} 
              onPress={() => setSortOrder('DESC')}
            >
              <Text style={[styles.sortBtnText, sortOrder === 'DESC' && styles.sortBtnTextActive]}>Newest First</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.sortBtn, sortOrder === 'ASC' && styles.sortBtnActive]} 
              onPress={() => setSortOrder('ASC')}
            >
              <Text style={[styles.sortBtnText, sortOrder === 'ASC' && styles.sortBtnTextActive]}>Oldest First</Text>
            </TouchableOpacity>
          </View>

          {activeFilterCount > 0 && (
            <TouchableOpacity style={styles.clearAllBtn} onPress={clearAllFilters}>
              <Text style={styles.clearAllBtnText}>Clear ({activeFilterCount})</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Main Row Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FFB703" />
        </View>
      ) : (
        <ScrollView style={styles.content}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Rows Displayed ({rows.length})</Text>
            {activeFilterCount > 0 && <Text style={styles.activeFiltersIndicator}>Filtered View</Text>}
          </View>
          
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
  
  // Filter Panel styles
  filterPanel: { backgroundColor: '#0A0A0A', padding: 16, borderBottomWidth: 1, borderColor: '#1A1A1A' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderRadius: 8, borderWidth: 1, borderColor: '#222', paddingHorizontal: 12, marginBottom: 12 },
  searchInput: { flex: 1, height: 40, color: '#FFF', fontSize: 13 },
  clearBtn: { padding: 4 },
  clearBtnText: { color: '#888', fontWeight: 'bold' },
  
  filterSubLabel: { color: '#888', fontSize: 11, fontWeight: 'bold', marginBottom: 6, textTransform: 'uppercase' },
  dateFilterContainer: { marginBottom: 12 },
  dateInputsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  dateInput: { flex: 0.48, height: 36, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', borderRadius: 6, color: '#FFF', fontSize: 12, paddingHorizontal: 10, textAlign: 'center' },
  
  quickDateRow: { flexDirection: 'row', gap: 8 },
  quickDateBtn: { backgroundColor: '#1C1C1E', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 0.5, borderColor: '#2C2C2E' },
  quickDateText: { color: '#FFB703', fontSize: 11, fontWeight: '500' },
  
  noDateWarning: { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#1C1500', borderRadius: 6, marginBottom: 12, borderWidth: 0.5, borderColor: '#3D2D00' },
  noDateWarningText: { color: '#E6A23C', fontSize: 11 },
  
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sortContainer: { flexDirection: 'row', gap: 8 },
  sortBtn: { backgroundColor: '#111', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#222' },
  sortBtnActive: { borderColor: '#FFB703', backgroundColor: '#261F0D' },
  sortBtnText: { color: '#888', fontSize: 11 },
  sortBtnTextActive: { color: '#FFB703', fontWeight: 'bold' },
  
  clearAllBtn: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#EF4444', borderRadius: 6 },
  clearAllBtnText: { color: '#FFF', fontSize: 11, fontWeight: 'bold' },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: '#888', fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase' },
  activeFiltersIndicator: { color: '#34D399', fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', backgroundColor: '#064E3B', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  
  emptyText: { color: '#555', fontStyle: 'italic', fontSize: 13, textAlign: 'center', paddingVertical: 40 },
  card: { backgroundColor: '#111', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#222', marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLeft: { flex: 1, marginRight: 16 },
  cardId: { color: '#FFF', fontSize: 13, fontWeight: 'bold', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  cardLabel: { color: '#888', fontSize: 11, marginTop: 4 },
  arrow: { color: '#FFB703', fontSize: 14, fontWeight: 'bold' }
});
