import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { executeInspectorQuery } from '../database';

export default function DatabaseHealthScreen({ onBack }) {
  const [loading, setLoading] = useState(true);
  const [healthStatus, setHealthStatus] = useState(null);

  useEffect(() => {
    runIntegrityCheck();
  }, []);

  const runIntegrityCheck = () => {
    setLoading(true);
    try {
      // 1. Run PRAGMA integrity_check
      const integrity = executeInspectorQuery("PRAGMA integrity_check");
      const integrityResult = integrity[0] ? Object.values(integrity[0])[0] : 'failed';

      // 2. Run PRAGMA foreign_key_check
      const fkCheck = executeInspectorQuery("PRAGMA foreign_key_check");
      const fkCount = fkCheck.length;

      // 3. Run PRAGMA quick_check
      const quick = executeInspectorQuery("PRAGMA quick_check");
      const quickResult = quick[0] ? Object.values(quick[0])[0] : 'failed';

      // 4. Run PRAGMA freelist_count
      const freelist = executeInspectorQuery("PRAGMA freelist_count");
      const freelistCount = freelist[0] ? Object.values(freelist[0])[0] : 0;

      setHealthStatus({
        integrity: integrityResult,
        fkIssues: fkCount,
        quickCheck: quickResult,
        freelistCount: freelistCount,
        dbStatus: 'CONNECTED',
        checkedAt: new Date().toLocaleTimeString()
      });
    } catch (err) {
      console.error(err);
      setHealthStatus({
        error: err.message,
        dbStatus: 'ERROR'
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
        <Text style={styles.headerTitle}>🛡️ Database Health</Text>
        <TouchableOpacity onPress={runIntegrityCheck} style={styles.refreshBtn}>
          <Text style={styles.refreshBtnText}>Re-check</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FFB703" />
        </View>
      ) : (
        <ScrollView style={styles.content}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>SQLite Diagnostics</Text>
            
            <View style={styles.row}>
              <Text style={styles.key}>Connection Status:</Text>
              <Text style={[styles.val, healthStatus?.dbStatus === 'CONNECTED' ? styles.successText : styles.errorText]}>
                ● {healthStatus?.dbStatus || 'UNKNOWN'}
              </Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.key}>Integrity Check:</Text>
              <Text style={[styles.val, healthStatus?.integrity === 'ok' ? styles.successText : styles.errorText]}>
                {healthStatus?.integrity || 'N/A'}
              </Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.key}>Quick Check:</Text>
              <Text style={[styles.val, healthStatus?.quickCheck === 'ok' ? styles.successText : styles.errorText]}>
                {healthStatus?.quickCheck || 'N/A'}
              </Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.key}>Foreign Key Issues:</Text>
              <Text style={[styles.val, healthStatus?.fkIssues === 0 ? styles.successText : styles.warningText]}>
                {healthStatus?.fkIssues !== undefined ? `${healthStatus.fkIssues} issues found` : 'N/A'}
              </Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.key}>Freelist Pages:</Text>
              <Text style={styles.val}>{healthStatus?.freelistCount ?? 'N/A'}</Text>
            </View>

            {healthStatus?.checkedAt && (
              <Text style={styles.footerText}>Last Checked: {healthStatus.checkedAt}</Text>
            )}

            {healthStatus?.error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorBoxText}>Error details: {healthStatus.error}</Text>
              </View>
            )}
          </View>
          
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>💡 Database Health Notes</Text>
            <Text style={styles.infoBody}>
              • Integrity Check inspects the database files for corruption, malformed schemas, and incomplete tree links.{"\n"}
              • Foreign Key Check verifies constraint violations across tables.{"\n"}
              • SQLite is run locally on-device. Clean database health indicates that no device storage leaks or write crashes have occurred.
            </Text>
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
  errorBox: { backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: 12, borderRadius: 8, marginTop: 16 },
  errorBoxText: { color: '#EF4444', fontSize: 12 },
  infoCard: { backgroundColor: '#0A0A0A', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#1A1A1A' },
  infoTitle: { color: '#FFB703', fontSize: 13, fontWeight: 'bold', marginBottom: 8 },
  infoBody: { color: '#888', fontSize: 12, lineHeight: 18 }
});
