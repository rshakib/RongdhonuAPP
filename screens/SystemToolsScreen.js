import React from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SystemToolsScreen({ onBack, onNavigate }) {
  const tools = [
    { title: '🛡️ Database Health', description: 'Integrity check, PRAGMA checks, freelist diagnostics', screen: 'DB_HEALTH' },
    { title: '🔄 Sync Status', description: 'Pending queue count, sync service state, queue details', screen: 'SYNC_STATUS' },
    { title: '📊 Database Stats', description: 'Row counts across all internal database tables', screen: 'DB_STATS' },
    { title: 'ℹ️ System Info', description: 'Operating system details, versioning, environment settings', screen: 'SYSTEM_INFO' },
    { title: '📂 Database Explorer', description: 'Inspect SQLite tables, row list, and raw JSON fields', screen: 'DB_EXPLORER' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>❮ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🛠️ System Tools</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content}>
        <Text style={styles.sectionTitle}>Select Diagnostic Tool</Text>
        
        {tools.map((tool) => (
          <TouchableOpacity 
            key={tool.screen} 
            style={styles.card} 
            onPress={() => onNavigate(tool.screen)}
          >
            <View>
              <Text style={styles.cardTitle}>{tool.title}</Text>
              <Text style={styles.cardDesc}>{tool.description}</Text>
            </View>
            <Text style={styles.arrow}>❯</Text>
          </TouchableOpacity>
        ))}

        <View style={styles.footerNote}>
          <Text style={styles.footerTitle}>🔒 Security & Safety Policy</Text>
          <Text style={styles.footerText}>
            Diagnostics screens operate in strict Read-Only mode. Recovery center repairs are strictly whitelisted, safe, and audited with audit trail logs written locally.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderColor: '#1A1A1A' },
  backBtn: { padding: 4 },
  backBtnText: { color: '#FFB703', fontWeight: 'bold' },
  headerTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  content: { padding: 16 },
  sectionTitle: { color: '#888', fontSize: 13, fontWeight: 'bold', marginBottom: 16, textTransform: 'uppercase' },
  card: { backgroundColor: '#111', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#222', marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: '#FFF', fontSize: 15, fontWeight: 'bold', marginBottom: 4 },
  cardDesc: { color: '#666', fontSize: 12 },
  arrow: { color: '#FFB703', fontSize: 16, fontWeight: 'bold' },
  footerNote: { marginTop: 24, backgroundColor: 'rgba(255, 183, 3, 0.05)', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: 'rgba(255, 183, 3, 0.1)' },
  footerTitle: { color: '#FFB703', fontSize: 13, fontWeight: 'bold', marginBottom: 6 },
  footerText: { color: '#888', fontSize: 11, lineHeight: 16 }
});
