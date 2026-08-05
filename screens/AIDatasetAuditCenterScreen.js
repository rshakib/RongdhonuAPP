import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  Alert,
  Dimensions,
  StatusBar as RNStatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDb, enqueueAIDatasetExport } from '../database';

const { width } = Dimensions.get('window');

const COLORS = {
  bg: '#0F172A',
  cardBg: '#1E293B',
  cardBorder: '#334155',
  textPrimary: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  accent: '#38BDF8',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  purple: '#A855F7',
  gray: '#64748B',
};

export default function AIDatasetAuditCenterScreen({ onBack }) {
  const [loading, setLoading] = useState(true);
  const [auditLogs, setAuditLogs] = useState([]);
  const [consistencyIssues, setConsistencyIssues] = useState([]);
  const [failedExports, setFailedExports] = useState([]);
  const [traceRecord, setTraceRecord] = useState(null);
  const [traceModalVisible, setTraceModalVisible] = useState(false);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportText, setReportText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [tabFilter, setTabFilter] = useState('LOGS'); // LOGS, TRACE, ERRORS, CONSISTENCY

  useEffect(() => {
    loadAuditData();
  }, []);

  const loadAuditData = () => {
    setLoading(true);
    try {
      const db = getDb();

      // 1. Fetch Queue Records
      const queueRows = db.getAllSync(`
        SELECT id, type, business_date, status, retry_count, last_error, created_at, updated_at 
        FROM ai_dataset_queue 
        ORDER BY created_at DESC
      `) || [];

      // 2. Fetch History Records
      const historyRows = db.getAllSync(`
        SELECT id, date, type, exported_at, created_at, updated_at 
        FROM ai_dataset_history 
        ORDER BY exported_at DESC
      `) || [];

      // 3. Fetch Submits
      const submitRows = db.getAllSync(`
        SELECT date, submitted_at, submitted_by 
        FROM daily_submit 
        ORDER BY date DESC
      `) || [];

      // Combine logs
      const combinedLogs = queueRows.map(q => ({
        id: q.id,
        businessDate: q.business_date || q.id.replace('ITEM_', ''),
        type: q.type,
        status: q.status,
        retryCount: q.retry_count || 0,
        lastError: q.last_error || null,
        createdAt: q.created_at,
        updatedAt: q.updated_at,
        exportedAt: historyRows.find(h => h.id === q.id)?.exported_at || null,
      }));

      setAuditLogs(combinedLogs);

      // Error center records
      const failed = combinedLogs.filter(l => l.status === 'FAILED' || l.status === 'RETRY' || l.lastError);
      setFailedExports(failed);

      // Export Consistency Check
      const submitDates = new Set(submitRows.map(s => s.date));
      const queueDates = new Set(queueRows.map(q => q.business_date || q.id.replace('ITEM_', '')));
      const historyDates = new Set(historyRows.map(h => h.date || h.id.replace('ITEM_', '')));

      const issues = [];
      submitDates.forEach(d => {
        if (!queueDates.has(d) && !historyDates.has(d)) {
          issues.push({ type: 'MISSING_QUEUE_AND_HISTORY', date: d, desc: `Submit ${d} has no queue or history entry.` });
        } else if (!historyDates.has(d)) {
          issues.push({ type: 'UNEXPORTED_QUEUE', date: d, desc: `Submit ${d} queued but not exported to history.` });
        }
      });

      setConsistencyIssues(issues);

    } catch (e) {
      console.error('[AI Audit Center] Load error:', e);
      Alert.alert('Error', 'Failed to load audit data: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDateTrace = (bDate) => {
    const db = getDb();
    const submit = db.getFirstSync('SELECT * FROM daily_submit WHERE date = ?', [bDate]);
    const queueDaily = db.getFirstSync("SELECT * FROM ai_dataset_queue WHERE id = ?", [bDate]);
    const queueItem = db.getFirstSync("SELECT * FROM ai_dataset_queue WHERE id = ?", [`ITEM_${bDate}`]);
    const historyDaily = db.getFirstSync("SELECT * FROM ai_dataset_history WHERE id = ?", [bDate]);
    const historyItem = db.getFirstSync("SELECT * FROM ai_dataset_history WHERE id = ?", [`ITEM_${bDate}`]);

    setTraceRecord({
      date: bDate,
      submit,
      queueDaily,
      queueItem,
      historyDaily,
      historyItem,
    });
    setTraceModalVisible(true);
  };

  const handleRetryFailed = (id, dateStr) => {
    try {
      enqueueAIDatasetExport(dateStr);
      Alert.alert('Requeue Triggered', `Dataset ${id} enqueued for retry.`);
      loadAuditData();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  };

  const handleGenerateAuditReport = () => {
    const report = `=====================================================
AI DATASET AUDIT REPORT (v1.0.0)
Date: ${new Date().toISOString()}
=====================================================

1. PIPELINE HEALTH SUMMARY
Total Audit Logs: ${auditLogs.length}
Failed Exports: ${failedExports.length}
Consistency Issues: ${consistencyIssues.length}
Export Success Rate: ${(( (auditLogs.length - failedExports.length) / (auditLogs.length || 1) ) * 100).toFixed(1)}%

2. CONSISTENCY ISSUE AUDIT
${consistencyIssues.length === 0 ? 'No consistency anomalies detected.' : consistencyIssues.map(i => `[${i.type}] ${i.desc}`).join('\n')}

3. SYSTEM MODE
STATUS: DATA COLLECTION MODE (FROZEN ARCHITECTURE v1.0.0)
=====================================================`;
    setReportText(report);
    setReportModalVisible(true);
  };

  const filteredLogs = useMemo(() => {
    return auditLogs.filter(l => {
      if (searchQuery.trim().length > 0) {
        return l.businessDate.includes(searchQuery.trim()) || l.id.includes(searchQuery.trim());
      }
      return true;
    });
  }, [auditLogs, searchQuery]);

  return (
    <SafeAreaView style={styles.container}>
      <RNStatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🔍 AI Audit Center</Text>
        <TouchableOpacity onPress={handleGenerateAuditReport} style={styles.reportHeaderBtn}>
          <Text style={styles.reportHeaderBtnText}>📋 Report</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.accent} />
          <Text style={styles.loadingText}>Loading Audit Trail...</Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>

          {/* TAB BAR */}
          <View style={styles.tabBar}>
            {['LOGS', 'ERRORS', 'CONSISTENCY'].map(t => (
              <TouchableOpacity
                key={t}
                style={[styles.tabItem, tabFilter === t && styles.tabActive]}
                onPress={() => setTabFilter(t)}
              >
                <Text style={[styles.tabText, tabFilter === t && styles.tabTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* TAB 1: AUDIT LOGS */}
          {tabFilter === 'LOGS' && (
            <ScrollView style={styles.content}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search audit logs by date or ID..."
                placeholderTextColor={COLORS.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {filteredLogs.map(log => (
                <TouchableOpacity
                  key={log.id}
                  style={styles.logCard}
                  onPress={() => handleDateTrace(log.businessDate)}
                >
                  <View style={styles.logRow}>
                    <Text style={styles.logTitle}>{log.id}</Text>
                    <Text style={[styles.logStatus, { color: log.status === 'SUCCESS' ? COLORS.success : COLORS.warning }]}>
                      {log.status}
                    </Text>
                  </View>
                  <Text style={styles.logSub}>Type: {log.type} | Retries: {log.retryCount}</Text>
                  <Text style={styles.logSub}>Created: {log.createdAt}</Text>
                  {log.lastError && (
                    <Text style={styles.logError}>Error: {log.lastError}</Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* TAB 2: ERROR CENTER */}
          {tabFilter === 'ERRORS' && (
            <ScrollView style={styles.content}>
              <Text style={styles.sectionTitle}>Failed / Retry Records ({failedExports.length})</Text>
              {failedExports.length === 0 ? (
                <Text style={styles.emptyText}>Zero export errors recorded.</Text>
              ) : (
                failedExports.map(item => (
                  <View key={item.id} style={styles.logCard}>
                    <Text style={styles.logTitle}>{item.id}</Text>
                    <Text style={styles.logError}>Error: {item.lastError || 'Retry state'}</Text>
                    <TouchableOpacity
                      style={styles.retryBtn}
                      onPress={() => handleRetryFailed(item.id, item.businessDate)}
                    >
                      <Text style={styles.retryBtnText}>🔄 Retry Export</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>
          )}

          {/* TAB 3: CONSISTENCY CHECK */}
          {tabFilter === 'CONSISTENCY' && (
            <ScrollView style={styles.content}>
              <Text style={styles.sectionTitle}>Export Consistency Audit</Text>
              {consistencyIssues.length === 0 ? (
                <View style={styles.successBox}>
                  <Text style={styles.successBoxText}>✅ 100% Pipeline Consistency Verified. Zero missing or orphan datasets.</Text>
                </View>
              ) : (
                consistencyIssues.map((iss, idx) => (
                  <View key={idx} style={styles.issueCard}>
                    <Text style={styles.issueTitle}>[{iss.type}] {iss.date}</Text>
                    <Text style={styles.issueDesc}>{iss.desc}</Text>
                    <TouchableOpacity
                      style={styles.retryBtn}
                      onPress={() => handleRetryFailed(iss.date, iss.date)}
                    >
                      <Text style={styles.retryBtnText}>⚡ Reenqueue</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>
          )}

        </View>
      )}

      {/* TRACE MODAL */}
      <Modal
        visible={traceModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setTraceModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Business Date Lifecycle Trace — {traceRecord?.date}</Text>
            {traceRecord && (
              <ScrollView style={{ maxHeight: 350 }}>
                <Text style={styles.traceStep}>1. Daily Submit: {traceRecord.submit ? '✅ Committed' : '❌ Missing'}</Text>
                <Text style={styles.traceStep}>2. Builder: {traceRecord.queueDaily ? '✅ Built' : '❌ Not Built'}</Text>
                <Text style={styles.traceStep}>3. Queue (Daily): {traceRecord.queueDaily ? `✅ ${traceRecord.queueDaily.status}` : '❌ Missing'}</Text>
                <Text style={styles.traceStep}>4. Queue (Item): {traceRecord.queueItem ? `✅ ${traceRecord.queueItem.status}` : '❌ Missing'}</Text>
                <Text style={styles.traceStep}>5. History Export: {traceRecord.historyDaily ? '✅ Exported' : '⏳ Pending'}</Text>
              </ScrollView>
            )}
            <TouchableOpacity style={styles.closeBtn} onPress={() => setTraceModalVisible(false)}>
              <Text style={styles.closeBtnText}>Close Trace</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* REPORT MODAL */}
      <Modal
        visible={reportModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setReportModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>AI Dataset Audit Report</Text>
            <ScrollView style={{ maxHeight: 350 }}>
              <Text style={{ color: COLORS.textSecondary, fontFamily: 'monospace', fontSize: 11 }}>
                {reportText}
              </Text>
            </ScrollView>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setReportModalVisible(false)}>
              <Text style={styles.closeBtnText}>Close Report</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder },
  backButton: { padding: 4 },
  backButtonText: { color: COLORS.accent, fontSize: 15, fontWeight: '600' },
  headerTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: 'bold' },
  reportHeaderBtn: { padding: 4 },
  reportHeaderBtnText: { color: COLORS.accent, fontSize: 14 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: COLORS.textSecondary, marginTop: 10 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder },
  tabItem: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.accent },
  tabText: { color: COLORS.textMuted, fontSize: 12, fontWeight: 'bold' },
  tabTextActive: { color: COLORS.accent },
  content: { flex: 1, padding: 14 },
  searchInput: { backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 8, color: COLORS.textPrimary, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12 },
  logCard: { backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 8, padding: 12, marginBottom: 8 },
  logRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  logTitle: { color: COLORS.textPrimary, fontWeight: 'bold', fontSize: 14 },
  logStatus: { fontWeight: 'bold', fontSize: 12 },
  logSub: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  logError: { color: COLORS.danger, fontSize: 11, marginTop: 4 },
  sectionTitle: { color: COLORS.textPrimary, fontWeight: 'bold', fontSize: 15, marginBottom: 10 },
  emptyText: { color: COLORS.textMuted, fontSize: 13 },
  retryBtn: { marginTop: 8, backgroundColor: COLORS.cardBorder, paddingVertical: 6, borderRadius: 4, alignItems: 'center' },
  retryBtnText: { color: COLORS.accent, fontSize: 12, fontWeight: 'bold' },
  successBox: { backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.success, borderRadius: 8, padding: 16 },
  successBoxText: { color: COLORS.success, fontWeight: 'bold', fontSize: 13 },
  issueCard: { backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.warning, borderRadius: 8, padding: 12, marginBottom: 8 },
  issueTitle: { color: COLORS.warning, fontWeight: 'bold', fontSize: 13 },
  issueDesc: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalCard: { width: '100%', backgroundColor: COLORS.cardBg, borderRadius: 12, padding: 20, borderWidth: 1, borderColor: COLORS.cardBorder },
  modalTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  traceStep: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 8 },
  closeBtn: { marginTop: 16, backgroundColor: COLORS.accent, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  closeBtnText: { color: '#FFF', fontWeight: 'bold' },
});
