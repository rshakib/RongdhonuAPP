import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Platform,
  StatusBar as RNStatusBar,
  ActivityIndicator,
  Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { 
  getSyncRuntimeDiagnostics, 
  formatDisplayDate, 
  getDailyDownloadCount 
} from '../database';

const { width } = Dimensions.get('window');

export default function SyncDiagnosticsScreen({ onBack }) {
  const [diagnostics, setDiagnostics] = useState(null);
  const [historyStats, setHistoryStats] = useState({ itemSales: 0, deposit: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = () => {
      const data = getSyncRuntimeDiagnostics();
      setDiagnostics(data);
      
      const itemSalesCount = getDailyDownloadCount('ITEM_SALES');
      const depositCount = getDailyDownloadCount('DEPOSIT_REPORT');
      setHistoryStats({ itemSales: itemSalesCount, deposit: depositCount });
      
      setLoading(false);
    };

    loadData();
    const interval = setInterval(loadData, 2000); // Refresh every 2 seconds
    return () => clearInterval(interval);
  }, []);

  if (loading || !diagnostics) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#FFB703" />
      </View>
    );
  }

  const { readCounters, lastSuccess, lastFailure, timers, appState } = diagnostics;

  const topConsumers = Object.entries(readCounters)
    .filter(([key]) => !['total', 'background', 'foreground', 'netInfoCount', 'foregroundCount', 'netInfo'].includes(key))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const renderSection = (title, icon, children) => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionIcon}>{icon}</Text>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionBody}>
        {children}
      </View>
    </View>
  );

  const renderStatRow = (label, value, sub = '', color = '#FFF', key = null) => (
    <View style={styles.statRow} key={key}>
      <View>
        <Text style={styles.statLabel}>{label}</Text>
        {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
      </View>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );

  const formatTime = (isoString) => {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <SafeAreaView style={styles.container}>
      <RNStatusBar barStyle="light-content" />
      
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backIcon}>⬅</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Sync Diagnostics</Text>
        <TouchableOpacity 
          style={styles.refreshBtn}
          onPress={() => setDiagnostics(getSyncRuntimeDiagnostics())}
        >
          <Text style={{ fontSize: 16 }}>🔄</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollBody} contentContainerStyle={{ paddingBottom: 40 }}>
        
        {renderSection("Current Sync Status", "📡", (
          <>
            {renderStatRow("Last High Frequency", formatTime(lastSuccess['syncHighFrequencyCollections']), '', '#FFF', 'last-high')}
            {renderStatRow("Last Low Frequency", formatTime(lastSuccess['syncLowFrequencyCollections']), '', '#FFF', 'last-low')}
            {renderStatRow("Last Table Sync", formatTime(lastSuccess['syncTablesOnly']), '', '#FFF', 'last-table')}
            {renderStatRow("Last Deletion Sync", formatTime(lastSuccess['syncDeletionsOnly']), '', '#FFF', 'last-deletion')}
            {renderStatRow("App Current State", appState.toUpperCase(), '', appState === 'active' ? '#34D399' : '#F87171', 'app-state')}
          </>
        ))}

        {renderSection("Estimated Read Usage", "📊", (
          <>
            {renderStatRow("High Frequency", `${readCounters.highFrequency} Reads`, "5 per 30s poll", '#FFF', 'read-high')}
            {renderStatRow("Low Frequency", `${readCounters.lowFrequency} Reads`, "11 per 120s poll", '#FFF', 'read-low')}
            {renderStatRow("Table Sync", `${readCounters.tables} Reads`, "1 per 15s poll", '#FFF', 'read-tables')}
            {renderStatRow("Deletion Sync", `${readCounters.deletions} Reads`, "1 per 90s poll", '#FFF', 'read-deletions')}
            {renderStatRow("Recovery Sync", `${readCounters.recovery} Reads`, "Foreground/Network Wakes", '#FFF', 'read-recovery')}
            {renderStatRow("Full Restore", `${readCounters.restore} Reads`, "Fresh Install/Restore", '#FFF', 'read-restore')}
            <View style={styles.divider} />
            {renderStatRow("Total Estimated Reads", readCounters.total, "Local session only", "#FFB703", 'read-total')}
          </>
        ))}

        {renderSection("Top Read Consumers", "🔝", (
          <>
            {topConsumers.map(([key, val], idx) => (
              renderStatRow(`${idx + 1}. ${key.charAt(0).toUpperCase() + key.slice(1)}`, val, '', idx === 0 ? '#FFB703' : '#FFF', `top-${key}`)
            ))}
          </>
        ))}

        {renderSection("Background Monitoring", "🌙", (
          <>
            {renderStatRow("Background Reads", `${readCounters.background} Reads`, "Screen off / App background", '#FFF', 'bg-reads')}
            {renderStatRow("Foreground Reads", `${readCounters.foreground} Reads`, "App active", '#FFF', 'fg-reads')}
            {renderStatRow("NetInfo Reconnects", readCounters.netInfoCount, "Internet recovery events", '#FFF', 'netinfo-count')}
            {renderStatRow("Foreground Wakes", readCounters.foregroundCount, "App resumed from home/multitask", '#FFF', 'fg-wakes')}
          </>
        ))}

        {renderSection("Menu & History", "📂", (
          <>
            {renderStatRow("Menu Sync Reads", `${readCounters.menu} Reads`, "Explicit menu updates", '#FFF', 'menu-reads')}
            {renderStatRow("Item Sales Downloads", historyStats.itemSales, "Daily Limit: 7", '#FFF', 'hist-sales')}
            {renderStatRow("Deposit Downloads", historyStats.deposit, "Daily Limit: 2", '#FFF', 'hist-deposit')}
          </>
        ))}

        <TouchableOpacity 
          style={styles.exportBtn}
          onPress={() => {
            Alert.alert("Exporting", "Sync summary has been copied to clipboard (Mock)");
          }}
        >
          <Text style={styles.exportBtnText}>Export Sync Diagnostics</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: 16, 
    paddingVertical: 12, 
    borderBottomWidth: 1, 
    borderColor: '#161616', 
    backgroundColor: '#0D0D0D' 
  },
  backButton: { padding: 6 },
  backIcon: { fontSize: 20, color: '#FFB703' },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#FFB703' },
  refreshBtn: { padding: 6 },
  scrollBody: { flex: 1, padding: 16 },
  section: { 
    backgroundColor: '#0D0D0D', 
    borderRadius: 12, 
    borderWidth: 1, 
    borderColor: '#1A1A1A', 
    marginBottom: 16,
    overflow: 'hidden'
  },
  sectionHeader: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#161616', 
    padding: 12,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A'
  },
  sectionIcon: { fontSize: 16, marginRight: 10 },
  sectionTitle: { color: '#FFF', fontSize: 14, fontWeight: 'bold', letterSpacing: 0.5 },
  sectionBody: { padding: 12 },
  statRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderColor: '#1A1A1A'
  },
  statLabel: { color: '#888', fontSize: 13 },
  statSub: { color: '#555', fontSize: 10, marginTop: 2 },
  statValue: { fontSize: 14, fontWeight: 'bold' },
  divider: { height: 1, backgroundColor: '#1A1A1A', marginVertical: 8 },
  exportBtn: {
    backgroundColor: '#1E1E1E',
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
    marginTop: 8
  },
  exportBtnText: { color: '#FFB703', fontSize: 15, fontWeight: 'bold' }
});