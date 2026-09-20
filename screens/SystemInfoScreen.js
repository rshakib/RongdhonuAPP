import React from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SystemInfoScreen({ onBack }) {
  const localTime = new Date().toString();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>❮ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>ℹ️ System Info</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Environment Details</Text>
          
          <View style={styles.row}>
            <Text style={styles.key}>Operating System:</Text>
            <Text style={styles.val}>{Platform.OS.toUpperCase()}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.key}>Platform Version:</Text>
            <Text style={styles.val}>{String(Platform.Version)}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.key}>Local Time:</Text>
            <Text style={[styles.val, { fontSize: 11, maxWidth: '60%' }]} numberOfLines={2}>
              {localTime}
            </Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.key}>Timezone:</Text>
            <Text style={styles.val}>{timezone}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.key}>Database Engine:</Text>
            <Text style={styles.val}>SQLite (expo-sqlite)</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.key}>Cloud Provider:</Text>
            <Text style={styles.val}>Google Firestore REST</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.key}>App Version:</Text>
            <Text style={styles.val}>v1.0.0 (stable-v1)</Text>
          </View>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>💡 System Admin Notice</Text>
          <Text style={styles.infoBody}>
            This environment module executes on the client device. It communicates directly with Google Cloud services using HTTP REST protocols and records offline states locally on the device disk. All operations are read-only.
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
  card: { backgroundColor: '#111', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#222', marginBottom: 16 },
  cardTitle: { color: '#FFB703', fontSize: 16, fontWeight: 'bold', marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 0.5, borderColor: '#222' },
  key: { color: '#888', fontSize: 13 },
  val: { color: '#FFF', fontSize: 13, fontWeight: 'bold' },
  infoCard: { backgroundColor: '#0A0A0A', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#1A1A1A' },
  infoTitle: { color: '#FFB703', fontSize: 13, fontWeight: 'bold', marginBottom: 8 },
  infoBody: { color: '#888', fontSize: 12, lineHeight: 18 }
});
