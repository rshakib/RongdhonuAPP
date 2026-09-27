import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchSyncHeartbeats } from '../services/supabaseHeartbeat';

/**
 * Sync Health — dual-DB observability.
 * Reads `public.sync_heartbeat` (per device × backend) and shows, for each device,
 * the LAST PUSH time to Firebase vs Supabase plus whether the two are in sync.
 * Answers: "is Firebase really being pushed to?" / "which side lags?".
 */
const SYNC_TOLERANCE_MIN = 2; // |firebase_push - supabase_push| ≤ this ⇒ "in sync"

function fmt(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch (_) { return String(iso); }
}
function lagMin(a, b) {
  if (!a || !b) return null;
  const d = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return Number.isFinite(d) ? Math.round(d / 60000) : null;
}

export default function SyncHealthScreen({ onBack }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const res = await fetchSyncHeartbeats();
    if (res && res.success) {
      setRows(res.rows || []);
    } else {
      setRows([]);
      setError((res && res.error) || 'sync_heartbeat পড়া যায়নি (টেবিল তৈরি করা হয়েছে?)');
    }
    setCheckedAt(new Date().toLocaleTimeString());
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const byDevice = {};
  for (const r of rows) {
    if (!r || !r.device_id) continue;
    byDevice[r.device_id] = byDevice[r.device_id] || {};
    byDevice[r.device_id][r.backend] = r;
  }
  const devices = Object.keys(byDevice).sort();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>❮ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>☁️ Sync Health</Text>
        <TouchableOpacity onPress={load} style={styles.refreshBtn}>
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
            <Text style={styles.cardTitle}>Last Push — Firebase vs Supabase</Text>

            {error ? (
              <Text style={styles.errorText}>{error}</Text>
            ) : devices.length === 0 ? (
              <Text style={styles.emptyText}>
                এখনো কোনো heartbeat নেই।{'\n\n'}
                ১) Supabase-এ sync_heartbeat টেবিল তৈরি করুন{'\n'}
                ২) নতুন APK build করে চালান
              </Text>
            ) : (
              devices.map((dev) => {
                const fb = byDevice[dev].firebase || null;
                const sb = byDevice[dev].supabase || null;
                const lag = lagMin(fb && fb.last_push_at, sb && sb.last_push_at);
                const fbOk = fb ? fb.last_push_ok !== false : false;
                const sbOk = sb ? sb.last_push_ok !== false : false;

                let verdict = '—';
                let verdictStyle = styles.warningText;
                if (!fb) { verdict = '⚠️ Firebase row নেই'; }
                else if (!fbOk) { verdict = '⚠️ Firebase push FAILED'; verdictStyle = styles.errorText; }
                else if (lag == null) { verdict = '—'; }
                else if (lag <= SYNC_TOLERANCE_MIN) { verdict = '✅ IN SYNC'; verdictStyle = styles.successText; }
                else { verdict = `⚠️ LAG ${lag} min`; }

                return (
                  <View key={dev} style={styles.deviceBlock}>
                    <Text style={styles.deviceTitle}>{dev}{byDevice[dev].supabase?.app_profile ? ` · ${byDevice[dev].supabase.app_profile}` : ''}</Text>

                    <View style={styles.row}>
                      <Text style={styles.key}>Firebase push:</Text>
                      <Text style={[styles.val, fbOk ? styles.successText : styles.errorText]}>
                        {fb ? fmt(fb.last_push_at) : '—'}
                      </Text>
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.key}>Supabase push:</Text>
                      <Text style={[styles.val, sbOk ? styles.successText : styles.errorText]}>
                        {sb ? fmt(sb.last_push_at) : '—'}
                      </Text>
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.key}>Firebase read:</Text>
                      <Text style={styles.val}>{fb ? fmt(fb.last_read_at) : '—'}</Text>
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.key}>Supabase read:</Text>
                      <Text style={styles.val}>{sb ? fmt(sb.last_read_at) : '—'}</Text>
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.key}>Verdict:</Text>
                      <Text style={[styles.val, verdictStyle]}>{verdict}</Text>
                    </View>

                    {(fb && fb.last_error) || (sb && sb.last_error) ? (
                      <Text style={styles.itemError} numberOfLines={2}>
                        Err: {(fb && fb.last_error) || (sb && sb.last_error)}
                      </Text>
                    ) : null}
                  </View>
                );
              })
            )}

            {checkedAt && <Text style={styles.footerText}>Last Refreshed: {checkedAt}</Text>}
          </View>

          <View style={styles.listCard}>
            <Text style={styles.listCardTitle}>কীভাবে পড়বেন</Text>
            <Text style={styles.helpText}>
              • প্রতি ডিভাইসে দুটি row: <Text style={styles.helpStrong}>firebase</Text> ও <Text style={styles.helpStrong}>supabase</Text>{'\n'}
              • দুটির <Text style={styles.helpStrong}>last_push_at</Text> কাছাকাছি (≤ {SYNC_TOLERANCE_MIN} মিনিট) ⇒ দুটি cloud-ই ঠিকঠাক পাচ্ছে ✅{'\n'}
              • Firebase সময় পুরোনো/FAILED ⇒ Firebase push আটকে আছে (last_error দেখুন){'\n'}
              • app writes throttled (~60s) — তাই ছোট পার্থক্য স্বাভাবিক
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
  deviceBlock: { borderTopWidth: 0.5, borderColor: '#222', paddingTop: 12, marginTop: 4 },
  deviceTitle: { color: '#FFF', fontSize: 13, fontWeight: 'bold', marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
  key: { color: '#888', fontSize: 12 },
  val: { color: '#FFF', fontSize: 12, fontWeight: 'bold', maxWidth: '62%', textAlign: 'right' },
  successText: { color: '#10B981' },
  warningText: { color: '#F59E0B' },
  errorText: { color: '#EF4444', fontSize: 12 },
  emptyText: { color: '#555', fontStyle: 'italic', fontSize: 13, textAlign: 'center', paddingVertical: 20, lineHeight: 20 },
  itemError: { color: '#EF4444', fontSize: 10, marginTop: 6 },
  footerText: { color: '#555', fontSize: 11, marginTop: 16, textAlign: 'center' },
  listCard: { backgroundColor: '#111', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#222' },
  listCardTitle: { color: '#FFB703', fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  helpText: { color: '#888', fontSize: 12, lineHeight: 20 },
  helpStrong: { color: '#FFF', fontWeight: 'bold' }
});
