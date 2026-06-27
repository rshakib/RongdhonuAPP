import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { executeInspectorQuery, getLastSyncError, isSyncServiceRunning } from '../database';

export default function SyncStatusScreen({ onBack }) {
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState(null);

  useEffect(() => {
    loadSyncDetails();
  }, []);

  const loadSyncDetails = () => {
    setLoading(true);
    try {
      // 1. Get total pending count
      const pendingRes = executeInspectorQuery("SELECT COUNT(*) as c FROM sync_queue WHERE status = 'PENDING'");
      const pendingCount = pendingRes[0]?.c || 0;

      // 2. Get total failed count
      const failedRes = executeInspectorQuery("SELECT COUNT(*) as c FROM sync_queue WHERE status = 'FAILED'");
      const failedCount = failedRes[0]?.c || 0;

      // 3. Get first 15 queue items
      const queueItems = executeInspectorQuery("SELECT * FROM sync_queue ORDER BY id ASC LIMIT 15");

      // 4. Get last sync error
      const syncError = getLastSyncError();

      // 5. Get daemon status
      const daemonRunning = isSyncServiceRunning();

      setSyncStatus({
        pendingCount,
        failedCount,
        queueItems,
        lastError: syncError || 'None',
        daemonRunning: daemonRunning ? 'ACTIVE' : 'STOPPED',
        checkedAt: new Date().toLocaleTimeString()
      });
    } catch (err) {
      console.error(err);
      setSyncStatus({
        error: err.message,
        daemonRunning: 'UNKNOWN'
      });
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
        <Text style={styles.headerTitle}>🔄 Sync Status</Text>
        <TouchableOpacity onPress={loadSyncDetails} style={styles.refreshBtn}>
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
            <Text style={styles.cardTitle}>Daemon Diagnostics</Text>
            
            <View style={styles.row}>
              <Text style={styles.key}>Daemon Status:</Text>
              <Text style={[styles.val, syncStatus?.daemonRunning === 'ACTIVE' ? styles.successText : styles.warningText]}>
                ● {syncStatus?.daemonRunning || 'UNKNOWN'}
              </Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.key}>Pending Syncs:</Text>
              <Text style={styles.val}>{syncStatus?.pendingCount ?? 0} items</Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.key}>Failed Sync Retries:</Text>
              <Text style={[styles.val, (syncStatus?.failedCount ?? 0) > 0 ? styles.errorText : styles.val]}>
                {syncStatus?.failedCount ?? 0} items
              </Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.key}>Last Connection Error:</Text>
              <Text style={[styles.val, { maxWidth: '60%' }]} numberOfLines={1}>
                {syncStatus?.lastError || 'None'}
              </Text>
            </View>

            {syncStatus?.checkedAt && (
              <Text style={styles.footerText}>Last Refreshed: {syncStatus.checkedAt}</Text>
            )}
          </View>

          <View style={styles.listCard}>
            <Text style={styles.listCardTitle}>Sync Queue (Next 15 Items)</Text>
            
            {(!syncStatus?.queueItems || syncStatus.queueItems.length === 0) ? (
              <Text style={styles.emptyText}>All records are fully synchronized.</Text>
            ) : (
              syncStatus.queueItems.map((item) => (
                <View key={item.id} style={styles.queueItem}>
                  <View>
                    <Text style={styles.itemTitle}>{item.table_name.toUpperCase()} ({item.action})</Text>
                    <Text style={styles.itemSubtitle}>ID: {item.record_id}</Text>
                    {item.last_error && (
                      <Text style={styles.itemError} numberOfLines={1}>Err: {item.last_error}</Text>
                    )}
                  </View>
                  <View style={styles.itemRight}>
                    <Text style={[styles.statusBadge, item.status === 'FAILED' ? styles.statusFailed : styles.statusPending]}>
                      {item.status}
                    </Text>
                  </View>
                </View>
              ))
            )}
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
  card: { backgroundColor: '#111', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#222', marginBottom: 16 },
  cardTitle: { color: '#FFB703', fontSize: 16, fontWeight: 'bold', marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 0.5, borderColor: '#222' },
  key: { color: '#888', fontSize: 13 },
  val: { color: '#FFF', fontSize: 13, fontWeight: 'bold' },
  successText: { color: '#10B981' },
  warningText: { color: '#F59E0B' },
  errorText: { color: '#EF4444' },
  footerText: { color: '#555', fontSize: 11, marginTop: 16, textAlign: 'center' },
  listCard: { backgroundColor: '#111', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#222' },
  listCardTitle: { color: '#FFB703', fontSize: 16, fontWeight: 'bold', marginBottom: 16 },
  emptyText: { color: '#555', fontStyle: 'italic', fontSize: 13, textAlign: 'center', paddingVertical: 20 },
  queueItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderColor: '#222' },
  itemTitle: { color: '#FFF', fontSize: 12, fontWeight: 'bold' },
  itemSubtitle: { color: '#666', fontSize: 10, marginTop: 2 },
  itemError: { color: '#EF4444', fontSize: 9, marginTop: 2, maxWidth: 200 },
  itemRight: { alignItems: 'flex-end' },
  statusBadge: { fontSize: 9, fontWeight: 'bold', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  statusPending: { backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#F59E0B' },
  statusFailed: { backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#EF4444' }
});
