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

// Tables that are written to BOTH clouds (dual-DB). `app_config` is deliberately
// EXCLUDED (Firebase-only: version policy + tombstones), and the ai_dataset/queue
// tables are local-only — so they are not shown here.
const DUAL_TABLES = [
  'orders', 'order_items', 'payments', 'deliveries', 'expenses',
  'daily_submit', 'daily_summary', 'due_payments', 'eja_history',
  'restaurant_tables', 'menu_items', 'menu_categories', 'users',
  'supplier_due', 'supplier_due_history', 'supplier_payment_ledger',
  'deletions', 'delete_history',
  'owner_employees', 'owner_salary_ledger', 'owner_expenses', 'owner_deposits', 'owner_home_deposits',
  'off_days', 'weather_data'
];
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

/** LOCAL state (no cloud call, no schema change): per-cloud queues + per-table dual cursors. */
function readLocalState() {
  const queues = [
    {
      key: 'sb',
      name: 'মূল সার্ভার (Supabase)',
      sub: 'এখানে যে সংখ্যা বাকি — সেগুলো এখনো মূল সার্ভারে পাঠানো হয়নি',
      pending: safeQ("SELECT COUNT(*) c FROM sync_queue_supabase WHERE status='PENDING'")[0]?.c || 0,
      failed: safeQ("SELECT COUNT(*) c FROM sync_queue_supabase WHERE status='FAILED'")[0]?.c || 0
    },
    {
      key: 'fb',
      name: 'ব্যাকআপ (Firebase)',
      sub: 'এখানে যে সংখ্যা বাকি — সেগুলো এখনো ব্যাকআপে পাঠানো হয়নি',
      pending: safeQ("SELECT COUNT(*) c FROM sync_queue WHERE status='PENDING'")[0]?.c || 0,
      failed: safeQ("SELECT COUNT(*) c FROM sync_queue WHERE status='FAILED'")[0]?.c || 0
    }
  ];

  const tables = DUAL_TABLES.map((t) => ({
    table: t,
    fbCursor: safeQ(`SELECT value FROM app_config WHERE key='last_sync_time_${t}'`)[0]?.value || null,
    sbCursor: safeQ(`SELECT value FROM app_config WHERE key='last_sync_time_supabase_${t}'`)[0]?.value || null,
    fbPending: safeQ(`SELECT COUNT(*) c FROM sync_queue WHERE table_name='${t}' AND status IN ('PENDING','FAILED')`)[0]?.c || 0,
    sbPending: safeQ(`SELECT COUNT(*) c FROM sync_queue_supabase WHERE table_name='${t}' AND status IN ('PENDING','FAILED')`)[0]?.c || 0
  }));

  return { queues, tables };
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
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>সংযোগের তথ্য</Text>
                  <Text style={styles.badText}>{error}</Text>
                  <Text style={styles.helpText}>
                    Supabase-এ sync_heartbeat টেবিল তৈরি করা হয়েছে কি না দেখুন, তারপর নতুন build চালান।
                  </Text>
                </View>
              ) : (
                <>
                  {/* ১) এখনো পাঠানো বাকি আছে কি? */}
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>১) এখনো পাঠানো বাকি আছে কি?</Text>
                    {(local?.queues || []).map((q) => (
                      <View key={q.key} style={styles.block}>
                        <View style={styles.lineRow}>
                          <Text style={styles.lineLabel}>{q.name}</Text>
                          <Text style={[styles.lineValue, (q.pending + q.failed) > 0 ? styles.warnText : styles.okText]}>
                            {(q.pending + q.failed) === 0 ? '✅ সব পাঠানো হয়েছে' : `বাকি ${q.pending} · ব্যর্থ ${q.failed}`}
                          </Text>
                        </View>
                        <Text style={styles.lineSub}>{q.sub}</Text>
                      </View>
                    ))}
                  </View>

                  {/* ২) টেবিল অনুযায়ী (dual-DB) */}
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>২) কোন টেবিল কোথায় পৌঁছেছে</Text>
                    <Text style={styles.helpText}>
                      শুধু সেই টেবিলগুলো যেগুলো <Text style={styles.strong}>দুই জায়গাতেই</Text> যায়।{'\n'}
                      <Text style={styles.strong}>FB</Text> = ব্যাকআপ · <Text style={styles.strong}>SB</Text> = মূল সার্ভার ·{' '}
                      <Text style={styles.strong}>“বাকি”</Text> = এখনো পাঠানো হয়নি।
                    </Text>
                    {(local?.tables || []).map((t) => {
                      const lag = lagMin(t.fbCursor, t.sbCursor);
                      const nothing = !t.fbCursor && !t.sbCursor;
                      const pendingTotal = t.fbPending + t.sbPending;
                      let verdict = '— এখনো কিছু যায়নি';
                      let vStyle = styles.mutedText;
                      if (!nothing) {
                        if (t.fbCursor && !t.sbCursor) { verdict = '⚠️ শুধু ব্যাকআপে গেছে'; vStyle = styles.warnText; }
                        else if (t.sbCursor && !t.fbCursor) { verdict = '⚠️ শুধু মূল সার্ভারে গেছে'; vStyle = styles.warnText; }
                        else if (lag != null && lag <= SYNC_TOLERANCE_MIN) { verdict = '✅ দুটোই সমান'; vStyle = styles.okText; }
                        else if (lag != null) { verdict = `⚠️ ${lag} মিনিট ফারাক`; vStyle = styles.warnText; }
                      }
                      return (
                        <View key={t.table} style={styles.block}>
                          <View style={styles.lineRow}>
                            <Text style={styles.tableName}>{t.table}</Text>
                            <Text style={[styles.lineValue, vStyle]}>{verdict}</Text>
                          </View>
                          <Text style={styles.lineSub}>
                            FB {agoText(t.fbCursor)} · SB {agoText(t.sbCursor)}
                            {pendingTotal > 0 ? `   ·   বাকি ${pendingTotal}` : ''}
                          </Text>
                        </View>
                      );
                    })}
                    <Text style={styles.hintText}>
                      নোট: app_config শুধু ব্যাকআপে থাকে (Firebase-only), তাই এখানে নেই।
                    </Text>
                  </View>

                  {/* ৩) খাঁটি তথ্য */}
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>৩) প্রতিটি ফোনের সর্বশেষ সেভ (খাঁটি তথ্য)</Text>
                    {devices.length === 0 ? (
                      <Text style={styles.helpText}>
                        কোনো তথ্য নেই। Supabase-এ <Text style={styles.strong}>sync_heartbeat</Text> টেবিল তৈরি করুন, তারপর নতুন build চালান।
                      </Text>
                    ) : devices.map((dev) => {
                      const fb = byDevice[dev].firebase || null;
                      const sb = byDevice[dev].supabase || null;
                      const label = PROFILE_BN[String((sb && sb.app_profile) || (fb && fb.app_profile) || '').toUpperCase()] || 'ফোন';
                      return (
                        <View key={dev} style={styles.block}>
                          <Text style={styles.tableName}>{label}</Text>
                          <Text style={styles.mono}>{dev}</Text>
                          <Text style={styles.mono}>FB — শেষ সেভ: {fmt(fb && fb.last_push_at)} · শেষ পড়া: {fmt(fb && fb.last_read_at)} · ঠিক আছে: {fb ? String(fb.last_push_ok !== false) : '—'}</Text>
                          <Text style={styles.mono}>SB — শেষ সেভ: {fmt(sb && sb.last_push_at)} · শেষ পড়া: {fmt(sb && sb.last_read_at)} · ঠিক আছে: {sb ? String(sb.last_push_ok !== false) : '—'}</Text>
                          {(fb && fb.last_error) || (sb && sb.last_error) ? (
                            <Text style={styles.itemError}>সমস্যা: {(fb && fb.last_error) || (sb && sb.last_error)}</Text>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                </>
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
  block: { borderTopWidth: 0.5, borderColor: '#222', paddingTop: 10, marginTop: 8 },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineLabel: { color: '#DDD', fontSize: 13, flex: 1, paddingRight: 8 },
  tableName: { color: '#FFF', fontSize: 13, fontWeight: 'bold', flex: 1, paddingRight: 8 },
  lineValue: { fontSize: 12, fontWeight: 'bold', textAlign: 'right', maxWidth: '48%' },
  lineSub: { color: '#777', fontSize: 11, marginTop: 3 },
  mutedText: { color: '#666' },
  mono: { color: '#9CA3AF', fontSize: 10.5, marginTop: 3 },
  itemError: { color: '#EF4444', fontSize: 11, marginTop: 6 }
});
