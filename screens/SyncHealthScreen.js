import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchSyncHeartbeats } from '../services/supabaseHeartbeat';
import { executeInspectorQuery } from '../database';

/**
 * "ডেটা সেভের অবস্থা" — plain-language sync health for NON-technical users.
 * Top = one big verdict anyone can read. Details are tucked into "টেকনিক্যাল তথ্য".
 */
const SYNC_TOLERANCE_MIN = 2;   // both clouds within this → "ঠিক আছে"
const WARN_LAG_MIN = 10;        // more than this → show a warning

const CURSOR_TABLES = ['orders', 'order_items', 'payments', 'deliveries', 'daily_submit', 'restaurant_tables', 'menu_items'];
const PROFILE_BN = { ADMIN: 'অ্যাডমিন অ্যাপ', OWNER: 'মালিক অ্যাপ', MANAGER: 'ম্যানেজার অ্যাপ' };

const safeQ = (sql) => { try { return executeInspectorQuery(sql) || []; } catch (_) { return []; } };

/** 2026-09-27T... → "2 মিনিট আগে" */
function agoText(iso) {
  if (!iso) return 'তথ্য নেই';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'তথ্য নেই';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'এখনই';
  if (mins < 60) return `${mins} মিনিট আগে`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ঘন্টা আগে`;
  const days = Math.floor(hours / 24);
  return `${days} দিন আগে`;
}
function lagMin(a, b) {
  if (!a || !b) return null;
  const d = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return Number.isFinite(d) ? Math.round(d / 60000) : null;
}

function readLocalState() {
  const queues = [
    { name: 'মূল সার্ভারে পাঠানো বাকি', pending: safeQ("SELECT COUNT(*) c FROM sync_queue_supabase WHERE status='PENDING'")[0]?.c || 0, failed: safeQ("SELECT COUNT(*) c FROM sync_queue_supabase WHERE status='FAILED'")[0]?.c || 0 },
    { name: 'ব্যাকআপে পাঠানো বাকি', pending: safeQ("SELECT COUNT(*) c FROM sync_queue WHERE status='PENDING'")[0]?.c || 0, failed: safeQ("SELECT COUNT(*) c FROM sync_queue WHERE status='FAILED'")[0]?.c || 0 }
  ];
  const cursors = CURSOR_TABLES.map((t) => ({
    table: t,
    fb: safeQ(`SELECT value FROM app_config WHERE key='last_sync_time_${t}'`)[0]?.value || null,
    sb: safeQ(`SELECT value FROM app_config WHERE key='last_sync_time_supabase_${t}'`)[0]?.value || null
  }));
  return { queues, cursors };
}

export default function SyncHealthScreen({ onBack }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);
  const [local, setLocal] = useState(null);
  const [showTech, setShowTech] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    setLocal(readLocalState());
    const res = await fetchSyncHeartbeats();
    if (res && res.success) {
      setRows(res.rows || []);
    } else {
      setRows([]);
      setError((res && res.error) || 'তথ্য আনা যায়নি');
    }
    setCheckedAt(new Date().toLocaleTimeString());
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Group heartbeats per device.
  const byDevice = {};
  for (const r of rows) {
    if (!r || !r.device_id) continue;
    byDevice[r.device_id] = byDevice[r.device_id] || {};
    byDevice[r.device_id][r.backend] = r;
  }
  const devices = Object.keys(byDevice).sort();

  // Per-device plain verdict.
  const deviceViews = devices.map((dev) => {
    const fb = byDevice[dev].firebase || null;
    const sb = byDevice[dev].supabase || null;
    const lag = lagMin(fb && fb.last_push_at, sb && sb.last_push_at);
    const fbOk = !!fb && fb.last_push_ok !== false;
    const sbOk = !!sb && sb.last_push_ok !== false;
    let state = 'ok';           // ok | warn | bad
    let line = 'দুটোই ঠিকঠাক সেভ হচ্ছে';
    if (!fb || !sb) { state = 'warn'; line = 'কিছু তথ্য এখনো আসেনি'; }
    else if (!fbOk) { state = 'bad'; line = 'ব্যাকআপ সেভ হচ্ছে না'; }
    else if (lag != null && lag > WARN_LAG_MIN) { state = 'warn'; line = `ব্যাকআপ ${lag} মিনিট পিছিয়ে আছে`; }
    const profile = (sb && sb.app_profile) || (fb && fb.app_profile) || '';
    return { dev, fb, sb, fbOk, sbOk, lag, state, line, profile };
  });

  const problemCount = deviceViews.filter((d) => d.state !== 'ok').length;
  const overall = error || devices.length === 0 ? 'unknown' : (problemCount === 0 ? 'ok' : 'warn');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>❮ ফিরুন</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>☁️ ডেটা সেভের অবস্থা</Text>
        <TouchableOpacity onPress={load} style={styles.refreshBtn}>
          <Text style={styles.refreshBtnText}>আবার দেখুন</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FFB703" />
        </View>
      ) : (
        <ScrollView style={styles.content}>

          {/* ── এক নজরে অবস্থা ───────────────────────────────────────── */}
          <View style={[styles.heroCard,
            overall === 'ok' ? styles.heroOk : (overall === 'warn' ? styles.heroWarn : styles.heroUnknown)]}>
            <Text style={styles.heroIcon}>
              {overall === 'ok' ? '✅' : (overall === 'warn' ? '⚠️' : 'ℹ️')}
            </Text>
            <Text style={styles.heroTitle}>
              {overall === 'ok'
                ? 'সব ডেটা ঠিকঠাক সেভ হচ্ছে'
                : (overall === 'warn' ? 'কিছু ডেটা সেভ হতে দেরি হচ্ছে' : 'এখনো তথ্য পাওয়া যায়নি')}
            </Text>
            <Text style={styles.heroSub}>
              {overall === 'ok'
                ? 'মূল সার্ভার ও ব্যাকআপ — দুটোই ঠিক আছে। আপনার কাজ চালিয়ে যান।'
                : (overall === 'warn'
                  ? 'কাজ চলবে, কিন্তু ইন্টারনেট একবার চেক করে নিন। সমস্যা থেকে গেলে অ্যাডমিনকে জানান।'
                  : 'অ্যাপ কিছুক্ষণ চালু রাখুন, তারপর আবার দেখুন।')}
            </Text>
            {checkedAt ? <Text style={styles.heroTime}>সর্বশেষ দেখা: {checkedAt}</Text> : null}
          </View>

          {/* ── কোন কোন ডিভাইস ───────────────────────────────────────── */}
          {deviceViews.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>কোন কোন ফোন</Text>
              {deviceViews.map((d) => (
                <View key={d.dev} style={styles.deviceBlock}>
                  <Text style={styles.deviceTitle}>
                    {PROFILE_BN[String(d.profile).toUpperCase()] || 'এই ফোন'}
                  </Text>

                  <View style={styles.statusRow}>
                    <Text style={styles.statusIcon}>{d.sbOk ? '🟢' : '🔴'}</Text>
                    <Text style={styles.statusText}>
                      মূল সার্ভারে সেভ — {agoText(d.sb && d.sb.last_push_at)}
                    </Text>
                  </View>
                  <View style={styles.statusRow}>
                    <Text style={styles.statusIcon}>{d.fbOk ? '🟢' : '🔴'}</Text>
                    <Text style={styles.statusText}>
                      ব্যাকআপে সেভ — {agoText(d.fb && d.fb.last_push_at)}
                    </Text>
                  </View>

                  <Text style={[styles.verdict,
                    d.state === 'ok' ? styles.okText : (d.state === 'warn' ? styles.warnText : styles.badText)]}>
                    {d.state === 'ok' ? '✅' : (d.state === 'warn' ? '⚠️' : '🔴')} {d.line}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* ── সহজ ব্যাখ্যা ─────────────────────────────────────────── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>কীভাবে বুঝবেন</Text>
            <Text style={styles.helpText}>
              • <Text style={styles.strong}>সবুজ বাতি (🟢)</Text> = ডেটা ঠিকঠাক সেভ হয়েছে।{'\n'}
              • <Text style={styles.strong}>লাল বাতি (🔴)</Text> = এখনো সেভ হয়নি; ইন্টারনেট চেক করুন।{'\n'}
              • অ্যাপ ২টা জায়গায় ডেটা রাখে — <Text style={styles.strong}>মূল সার্ভার</Text> আর <Text style={styles.strong}>ব্যাকআপ</Text>। কোনো একটাতে সমস্যা হলেও কাজ চলবে।{'\n'}
              • উপরে <Text style={styles.strong}>“সব ডেটা ঠিকঠাক সেভ হচ্ছে”</Text> দেখলেই নিশ্চিন্ত থাকুন।
            </Text>
          </View>

          {/* ── টেকনিক্যাল (লুকানো) ──────────────────────────────────── */}
          <TouchableOpacity style={styles.techToggle} onPress={() => setShowTech((v) => !v)}>
            <Text style={styles.techToggleText}>
              {showTech ? '▲ টেকনিক্যাল তথ্য লুকান' : '🔧 টেকনিক্যাল তথ্য (অ্যাডমিনের জন্য)'}
            </Text>
          </TouchableOpacity>

          {showTech && (
            <>
              {error ? (
                <View style={styles.card}><Text style={styles.badText}>{error}</Text></View>
              ) : (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Raw heartbeat (device × backend)</Text>
                  {devices.length === 0 ? (
                    <Text style={styles.helpText}>
                      কোনো row নেই। Supabase-এ <Text style={styles.strong}>sync_heartbeat</Text> টেবিল তৈরি করুন, তারপর নতুন build চালান।
                    </Text>
                  ) : devices.map((dev) => {
                    const fb = byDevice[dev].firebase || null;
                    const sb = byDevice[dev].supabase || null;
                    return (
                      <View key={dev} style={styles.deviceBlock}>
                        <Text style={styles.deviceTitle}>{dev}</Text>
                        <Text style={styles.mono}>firebase  push={fmt(fb && fb.last_push_at)} ok={fb ? String(fb.last_push_ok !== false) : '—'}  read={fmt(fb && fb.last_read_at)}</Text>
                        <Text style={styles.mono}>supabase  push={fmt(sb && sb.last_push_at)} ok={sb ? String(sb.last_push_ok !== false) : '—'}  read={fmt(sb && sb.last_read_at)}</Text>
                        {(fb && fb.last_error) || (sb && sb.last_error) ? (
                          <Text style={styles.itemError}>err: {(fb && fb.last_error) || (sb && sb.last_error)}</Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              )}

              {local && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Local queue & cursors (this device)</Text>
                  {local.queues.map((q) => (
                    <View key={q.name} style={styles.techRow}>
                      <Text style={styles.techKey}>{q.name}</Text>
                      <Text style={styles.techVal}>pending {q.pending} · failed {q.failed}</Text>
                    </View>
                  ))}
                  {local.cursors.map((c) => {
                    const lag = lagMin(c.fb, c.sb);
                    return (
                      <View key={c.table} style={styles.techRow}>
                        <Text style={styles.techKey}>{c.table}</Text>
                        <Text style={styles.techVal}>{lag == null ? '—' : `${lag} min apart`}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </>
          )}

        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const fmt = (iso) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString(); } catch (_) { return String(iso); } };

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderColor: '#1A1A1A' },
  backBtn: { padding: 4 },
  backBtnText: { color: '#FFB703', fontWeight: 'bold' },
  headerTitle: { color: '#FFF', fontSize: 17, fontWeight: 'bold' },
  refreshBtn: { padding: 4 },
  refreshBtnText: { color: '#FFB703' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16 },

  heroCard: { borderRadius: 20, padding: 22, alignItems: 'center', borderWidth: 1, marginBottom: 16 },
  heroOk: { backgroundColor: 'rgba(16, 185, 129, 0.12)', borderColor: 'rgba(16, 185, 129, 0.5)' },
  heroWarn: { backgroundColor: 'rgba(245, 158, 11, 0.12)', borderColor: 'rgba(245, 158, 11, 0.5)' },
  heroUnknown: { backgroundColor: 'rgba(148, 163, 184, 0.10)', borderColor: 'rgba(148, 163, 184, 0.4)' },
  heroIcon: { fontSize: 40, marginBottom: 8 },
  heroTitle: { color: '#FFF', fontSize: 19, fontWeight: 'bold', textAlign: 'center' },
  heroSub: { color: '#C9C9C9', fontSize: 13, textAlign: 'center', lineHeight: 20, marginTop: 8 },
  heroTime: { color: '#777', fontSize: 11, marginTop: 12 },

  card: { backgroundColor: '#111', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: '#222', marginBottom: 14 },
  cardTitle: { color: '#FFB703', fontSize: 15, fontWeight: 'bold', marginBottom: 12 },

  deviceBlock: { borderTopWidth: 0.5, borderColor: '#222', paddingTop: 12, marginTop: 6 },
  deviceTitle: { color: '#FFF', fontSize: 15, fontWeight: 'bold', marginBottom: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  statusIcon: { fontSize: 13, marginRight: 8 },
  statusText: { color: '#DDD', fontSize: 13 },
  verdict: { fontSize: 13, fontWeight: 'bold', marginTop: 8 },

  okText: { color: '#10B981' },
  warnText: { color: '#F59E0B' },
  badText: { color: '#EF4444', fontSize: 13 },

  helpText: { color: '#AAA', fontSize: 13, lineHeight: 22 },
  strong: { color: '#FFF', fontWeight: 'bold' },

  techToggle: { paddingVertical: 12, alignItems: 'center', marginBottom: 8 },
  techToggleText: { color: '#FFB703', fontSize: 13, fontWeight: 'bold' },
  techRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  techKey: { color: '#888', fontSize: 12 },
  techVal: { color: '#DDD', fontSize: 12 },
  mono: { color: '#9CA3AF', fontSize: 11, marginTop: 4 },
  itemError: { color: '#EF4444', fontSize: 11, marginTop: 6 }
});
