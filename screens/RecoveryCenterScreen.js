import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { retryFailedSyncs, forceProcessSyncQueue, redownloadLast31Days, runMissingDataDetector } from '../database';

export default function RecoveryCenterScreen({ onBack }) {
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [scanResults, setScanResults] = useState(null);

  const handleAction = (title, actionFn, actionName) => {
    Alert.alert(
      "Confirm Action",
      `Are you sure you want to run: ${title}?`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Confirm", 
          onPress: async () => {
            setLoading(true);
            setLoadingText(actionName);
            setScanResults(null);
            try {
              const res = await actionFn();
              if (res.success) {
                if (res.issues) {
                  setScanResults(res.issues);
                  Alert.alert("Scan Completed", `Missing Data Detector scan complete. Found ${res.issues.length} potential issues.`);
                } else {
                  Alert.alert("Success", `${title} has completed successfully.`);
                }
              }
            } catch (err) {
              Alert.alert("Error", err.message || "Failed to execute recovery action.");
            } finally {
              setLoading(false);
              setLoadingText('');
            }
          } 
        }
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>❮ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🛠️ Recovery Center</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FFB703" />
          <Text style={styles.loadingText}>{loadingText}...</Text>
        </View>
      ) : (
        <ScrollView style={styles.content}>
          <Text style={styles.sectionTitle}>Safe Recovery Operations</Text>

          <TouchableOpacity 
            style={styles.card} 
            onPress={() => handleAction("Retry Failed Sync", retryFailedSyncs, "Resetting failed sync states")}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardIcon}>🔄</Text>
              <Text style={styles.cardTitle}>Retry Failed Sync</Text>
            </View>
            <Text style={styles.cardDesc}>
              Resets the status of failed records in the sync queue back to PENDING and triggers the queue processor immediately.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.card} 
            onPress={() => handleAction("Force Process Pending Queue", forceProcessSyncQueue, "Processing pending sync queue")}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardIcon}>⚡</Text>
              <Text style={styles.cardTitle}>Force Process Pending Queue</Text>
            </View>
            <Text style={styles.cardDesc}>
              Forces the sync queue engine to execute immediately, pushing any pending records to Google Firestore.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.card} 
            onPress={() => handleAction("Re-download Last 31 Days", redownloadLast31Days, "Downloading last 31 days data")}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardIcon}>☁️</Text>
              <Text style={styles.cardTitle}>Re-download Last 31 Days</Text>
            </View>
            <Text style={styles.cardDesc}>
              Contacts Cloud Firestore to download all transaction, delivery, order, and expense data recorded in the last 31 days.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.card} 
            onPress={() => handleAction("Missing Data Detector", runMissingDataDetector, "Running missing data scan")}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardIcon}>🔍</Text>
              <Text style={styles.cardTitle}>Missing Data Detector</Text>
            </View>
            <Text style={styles.cardDesc}>
              Performs a diagnostic integrity scan on local SQLite tables, identifying orphaned order items, unpaid records, and sync errors.
            </Text>
          </TouchableOpacity>

          {/* SCAN RESULTS CONTAINER */}
          {scanResults && (
            <View style={styles.resultsCard}>
              <Text style={styles.resultsTitle}>🔍 Scan Results</Text>
              {scanResults.length === 0 ? (
                <Text style={styles.successScan}>No integrity issues detected. Database is healthy!</Text>
              ) : (
                scanResults.map((issue, idx) => (
                  <View key={idx} style={styles.issueRow}>
                    <Text style={styles.issueType}>⚠️ {issue.type}</Text>
                    <Text style={styles.issueDesc}>{issue.description}</Text>
                    <Text style={styles.issueDetails}>{issue.details}</Text>
                  </View>
                ))
              )}
            </View>
          )}

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>🔒 Safety & Logs Policy</Text>
            <Text style={styles.infoBody}>
              • Every executed recovery action is automatically recorded in the Notifications panel for audit tracking.{"\n"}
              • Re-downloading historical dates does not replace or duplicate local records; it safely updates records with the cloud state.
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000', padding: 20 },
  loadingText: { color: '#FFB703', fontSize: 13, marginTop: 12, fontWeight: 'bold' },
  content: { padding: 16 },
  sectionTitle: { color: '#888', fontSize: 13, fontWeight: 'bold', marginBottom: 16, textTransform: 'uppercase' },
  card: { backgroundColor: '#111', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#222', marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  cardIcon: { fontSize: 18, marginRight: 8 },
  cardTitle: { color: '#FFF', fontSize: 15, fontWeight: 'bold' },
  cardDesc: { color: '#888', fontSize: 12, lineHeight: 18 },
  resultsCard: { backgroundColor: '#111', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#333', marginBottom: 16 },
  resultsTitle: { color: '#FFB703', fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  successScan: { color: '#10B981', fontSize: 13, fontStyle: 'italic' },
  issueRow: { paddingVertical: 10, borderBottomWidth: 0.5, borderColor: '#222' },
  issueType: { color: '#EF4444', fontSize: 13, fontWeight: 'bold' },
  issueDesc: { color: '#FFF', fontSize: 12, marginTop: 2 },
  issueDetails: { color: '#888', fontSize: 10, marginTop: 4, fontStyle: 'italic' },
  infoCard: { backgroundColor: '#0A0A0A', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#1A1A1A', marginTop: 12 },
  infoTitle: { color: '#FFB703', fontSize: 13, fontWeight: 'bold', marginBottom: 8 },
  infoBody: { color: '#888', fontSize: 12, lineHeight: 18 }
});
