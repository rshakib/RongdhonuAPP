import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchSyncHeartbeats } from '../services/supabaseHeartbeat';
import { executeInspectorQuery } from '../database';

/**
 * "ডেটা সেভের অবস্থা" — ONE question answered: for the things that must be saved to
 * BOTH databases, is it happening together — or is one side failing?
 * Everything else lives behind the "টেকনিক্যাল তথ্য" toggle.
 */
const SYNC_TOLERANCE_MIN = 2;   // both sides within this → "একসাথে"
const WARN_LAG_MIN = 10;        // device-level: more than this → warn

// Tables written to BOTH clouds. `app_config` is Firebase-only (excluded).
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

function agoText(iso) {
  if (!iso) return 'তথ্য নেই';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'তথ্য নেই';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'এখনই';
  if (mins < 60) return `${mins} মিনিট আগে`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ঘন্টা আগে`;
  return `${Math.floor(hours / 24)} দিন আগে`;
}
function lagMin(a, b) {
  if (!a || !b) return null;
  const d = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return Number.isFinite(d) ? Math.round(d / 60000) : null;
}

/** LOCAL state — per-cloud queues + per-table dual cursors. No cloud call. */
function readLocalState() {
  const queues = [
    { key: 'sb', name: 'মূল সার্ভার (Supabase)', pending: safeQ("SELECT COUNT(*) c FROM sync_queue_supabase WHERE status='PENDING'")[0]?.c || 0, failed: safeQ("SELECT COUNT(*) c FROM sync_queue_supabase WHERE status='FAILED'")[0]?.c || 0 },
    { key: 'fb', name: 'ব্যাকআপ (Firebase)', pending: safeQ("SELECT COUNT(*) c FROM sync_queue WHERE status='PENDING'")[0]?.c || 0, failed: safeQ("SELECT COUNT(*) c FROM sync_queue WHERE status='FAILED'")[0]?.c || 0 }
  ];
  const tables = DUAL_TABLES.map((t) => ({
    table: t,
    sbCursor: safeQ(`SELECT value FROM app_config WHERE key='last_sync_time_supabase_${t}'`)[0]?.value || null,
    fbCursor: safeQ(`SELECT value FROM app_config WHERE key='last_sync_time_${t}'`)[0]?.value || null,
    sbPending: safeQ(`SELECT COUNT(*) c FROM sync_queue_supabase WHERE table_name='${t}' AND status IN ('PENDING','FAILED')`)[0]?.c || 0,
    fbPending: safeQ(`SELECT COUNT(*) c FROM sync_queue WHERE table_name='${t}' AND status IN ('PENDING','FAILED')`)[0]?.c || 0
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
    if (res && res.success) setRows(res.rows || []);
    else { setRows([]); setError((res && res.error) || 'তথ্য আনা যায়নি'); }
    setCheckedAt(new Date().toLocaleTimeString());
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Heartbeats grouped per device (used for the device-level check + tech view).
  const byDevice = {};
  for (const r of rows) {
    if (!r || !r.device_id) continue;
    byDevice[r.device_id] = byDevice[r.device_id] || {};
    byDevice[r.device_id][r.backend] = r;
  }
  const devices = Object.keys(byDevice).sort();

  const deviceViews = devices.map((dev) => {
    const fb = byDevice[dev].firebase || null;
    const sb = byDevice[dev].supabase || null;
    const lag = lagMin(fb && fb.last_push_at, sb && sb.last_push_at);
    const fbOk = !!fb && fb.last_push_ok !== false;
    const sbOk = !!sb && sb.last_push_ok !== false;
    let state = 'ok';
    let line = 'দুটোই ঠিকঠাক সেভ হচ্ছে';
    if (!fb || !sb) { state = 'warn'; line = 'কিছু তথ্য এখনো আসেনি'; }
    else if (!fbOk) { state = 'bad'; line = 'ব্যাকআপ সেভ হচ্ছে না'; }
    else if (lag != null && lag > WARN_LAG_MIN) { state = 'warn'; line = `ব্যাকআপ ${lag} মিনিট পিছিয়ে আছে`; }
    return { dev, fb, sb, fbOk, sbOk, lag, state, line, profile: (sb && sb.app_profile) || (fb && fb.app_profile) || '' };
  });

  // ── The ONE answer: per dual table, did BOTH sides get it? ──────────────────
  const dualRows = (local?.tables || []).map((t) => {
    const sbOk = t.sbPending === 0;
    const fbOk = t.fbPending === 0;
    const lag = lagMin(t.fbCursor, t.sbCursor);
    const noInfo = !t.sbCursor && !t.fbCursor;
    let label = '— এখনো কিছু যায়নি';
    let tone = 'muted';
    if (!noInfo) {
      if (!sbOk && !fbOk) { label = '🔴 দুটোই বাকি'; tone = 'bad'; }
      else if (!sbOk) { label = '⚠️ মূল সার্ভারে বাকি'; tone = 'warn'; }
      else if (!fbOk) { label = '⚠️ ব্যাকআপে বাকি'; tone = 'warn'; }
      else if (lag != null && lag > SYNC_TOLERANCE_MIN) { label = `⚠️ ${lag} মিনিট ফারাক`; tone = 'warn'; }
      else { label = '✅ একসাথে'; tone = 'ok'; }
    }
    return { ...t, sbOk, fbOk, label, tone, noInfo };
  });
  const problemTables = dualRows.filter((r) => r.tone !== 'ok' && !r.noInfo);
  const badDevices = deviceViews.filter((d) => d.state !== 'ok');

  const overall = error ? 'unknown'
    : (problemTables.length > 0 || badDevices.some((d) => d.state === 'bad')) ? 'bad'
      : (badDevices.length > 0 || dualRows.some((r) => r.noInfo)) ? 'warn'
        : 'ok';

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

          {/* ── এক নজরে ─────────────────────────────────────────────── */}
          <View style={[styles.heroCard, overall === 'ok' ? styles.heroOk : (overall === 'bad' ? styles.heroBad : styles.heroWarn)]}>
            <Text style={styles.heroIcon}>
              {overall === 'ok' ? '✅' : (overall === 'bad' ? '🔴' : (overall === 'warn' ? '⚠️' : 'ℹ️'))}
            </Text>
            <Text style={styles.heroTitle}>
              {overall === 'ok' ? 'দুই জায়গাতেই একসাথে সেভ হচ্ছে'
                : (overall === 'bad' ? 'কিছু ডেটা এক দিকে সেভ হয়নি'
                  : (overall === 'warn' ? 'কিছু জিনিসে দেরি হচ্ছে' : 'এখনো তথ্য পাওয়া যায়নি'))}
            </Text>
            <Text style={styles.heroSub}>
              {overall === 'ok' ? 'মূল সার্ভার ও ব্যাকআপ — দুটোতেই একই সময়ে যাচ্ছে। নিশ্চিন্ত থাকুন।'
                : (overall === 'bad' ? 'নিচের তালিকায় লাল চিহ্ন দেখুন। ইন্টারনেট চেক করুন, না হলে অ্যাডমিনকে জানান।'
                  : (overall === 'warn' ? 'কাজ চলবে, তবে ইন্টারনেট একবার চেক করে নিন।' : 'অ্যাপ কিছুক্ষণ চালু রাখুন, তারপর আবার দেখুন।'))}
            </Text>
            {checkedAt ? <Text style={styles.heroTime}>সর্বশেষ দেখা: {checkedAt}</Text> : null}
          </View>

          {/* ── একসাথে সেভ হচ্ছে কি? (দুই DB) ────────────────────────── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>একসাথে সেভ হচ্ছে কি?</Text>
            <Text style={styles.legend}>
              <Text style={styles.strong}>SB</Text> = মূল সার্ভার · <Text style={styles.strong}>FB</Text> = ব্যাকআপ{'\n'}
              <Text style={styles.strong}>✅</Text> = পাঠানো হয়েছে · <Text style={styles.strong}>❌</Text> = বাকি
            </Text>

            {error ? (
              <Text style={styles.badText}>{error}</Text>
            ) : dualRows.length === 0 ? (
              <Text style={styles.helpText}>কোনো তথ্য নেই।</Text>
            ) : (
              dualRows.map((r) => (
                <View key={r.table} style={styles.rowLine}>
                  <Text style={styles.tableName} numberOfLines={1}>{r.table}</Text>
                  <Text style={styles.flags}>
                    <Text style={r.sbOk ? styles.okText : styles.badText}>SB {r.sbOk ? '✅' : '❌'}</Text>
                    <Text>  </Text>
                    <Text style={r.fbOk ? styles.okText : styles.badText}>FB {r.fbOk ? '✅' : '❌'}</Text>
                  </Text>
                  <Text style={[styles.verdict, r.tone === 'ok' ? styles.okText : (r.tone === 'bad' ? styles.badText : (r.tone === 'warn' ? styles.warnText : styles.mutedText))]}>
                    {r.label}
                  </Text>
                </View>
              ))
            )}

            <Text style={styles.hintText}>
              সবুজ “একসাথে” মানে দুটো সার্ভারেই একই জিনিস একই সময়ে সেভ হয়েছে। কোনো একটিতে ❌ থাকলে সেটা ইন্টারনেট ফিরলে নিজেই পাঠিয়ে দেবে।
            </Text>
          </View>

          {/* ── টেকনিক্যাল (লুকানো) ──────────────────────────────────── */}
          <TouchableOpacity style={styles.techToggle} onPress={() => setShowTech((v) => !v)}>
            <Text style={styles.techToggleText}>
              {showTech ? '▲ টেকনিক্যাল তথ্য লুকান' : '🔧 টেকনিক্যাল তথ্য'}
            </Text>
          </TouchableOpacity>

          {showTech && (
            <>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>এখনো পাঠানো বাকি আছে কি?</Text>
                {(local?.queues || []).map((q) => (
                  <View key={q.key} style={styles.techBlock}>
                    <View style={styles.rowLine}>
                      <Text style={styles.lineLabel}>{q.name}</Text>
                      <Text style={[styles.lineValue, (q.pending + q.failed) > 0 ? styles.warnText : styles.okText]}>
                        {(q.pending + q.failed) === 0 ? 'সব পাঠানো হয়েছে' : `বাকি ${q.pending} · ব্যর্থ ${q.failed}`}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>টেবিল অনুযায়ী (সময়সহ)</Text>
                {dualRows.map((t) => (
                  <View key={t.table} style={styles.techBlock}>
                    <View style={styles.rowLine}>
                      <Text style={styles.tableName} numberOfLines={1}>{t.table}</Text>
                      <Text style={[styles.lineValue, t.tone === 'ok' ? styles.okText : (t.tone === 'bad' ? styles.badText : styles.warnText)]}>{t.label}</Text>
                    </View>
                    <Text style={styles.lineSub}>
                      SB {agoText(t.sbCursor)} · FB {agoText(t.fbCursor)}
                      {(t.sbPending + t.fbPending) > 0 ? `   ·   বাকি ${t.sbPending + t.fbPending}` : ''}
                    </Text>
                  </View>
                ))}
                <Text style={styles.hintText}>app_config শুধু ব্যাকআপে থাকে (Firebase-only), তাই এখানে নেই।</Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>প্রতিটি ফোন</Text>
                {devices.length === 0 ? (
                  <Text style={styles.helpText}>কোনো heartbeat নেই। Supabase-এ sync_heartbeat টেবিল তৈরি করুন, তারপর নতুন build চালান।</Text>
                ) : deviceViews.map((d) => (
                  <View key={d.dev} style={styles.techBlock}>
                    <View style={styles.rowLine}>
                      <Text style={styles.tableName}>{PROFILE_BN[String(d.profile).toUpperCase()] || 'ফোন'}</Text>
                      <Text style={[styles.lineValue, d.state === 'ok' ? styles.okText : styles.warnText]}>{d.line}</Text>
                    </View>
                    <Text style={styles.mono}>FB শেষ সেভ {fmt(d.fb && d.fb.last_push_at)} · SB শেষ সেভ {fmt(d.sb && d.sb.last_push_at)}</Text>
                    {(d.fb && d.fb.last_error) || (d.sb && d.sb.last_error) ? (
                      <Text style={styles.badText}>সমস্যা: {(d.fb && d.fb.last_error) || (d.sb && d.sb.last_error)}</Text>
                    ) : null}
                  </View>
                ))}
              </View>
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
  headerTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  refreshBtn: { padding: 4 },
  refreshBtnText: { color: '#FFB703' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16 },

  heroCard: { borderRadius: 20, padding: 20, alignItems: 'center', borderWidth: 1, marginBottom: 16 },
  heroOk: { backgroundColor: 'rgba(16, 185, 129, 0.12)', borderColor: 'rgba(16, 185, 129, 0.5)' },
  heroWarn: { backgroundColor: 'rgba(245, 158, 11, 0.12)', borderColor: 'rgba(245, 158, 11, 0.5)' },
  heroBad: { backgroundColor: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.5)' },
  heroIcon: { fontSize: 34, marginBottom: 6 },
  heroTitle: { color: '#FFF', fontSize: 17, fontWeight: 'bold', textAlign: 'center' },
  heroSub: { color: '#C9C9C9', fontSize: 12.5, textAlign: 'center', lineHeight: 19, marginTop: 6 },
  heroTime: { color: '#777', fontSize: 11, marginTop: 10 },

  card: { backgroundColor: '#111', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#222', marginBottom: 14 },
  cardTitle: { color: '#FFB703', fontSize: 15, fontWeight: 'bold', marginBottom: 10 },
  legend: { color: '#888', fontSize: 11.5, lineHeight: 18, marginBottom: 10 },

  rowLine: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderTopWidth: 0.5, borderColor: '#1C1C1C' },
  tableName: { color: '#FFF', fontSize: 12.5, fontWeight: 'bold', flex: 1.2, paddingRight: 6 },
  flags: { fontSize: 11, marginRight: 8 },
  verdict: { fontSize: 11, fontWeight: 'bold', flex: 1.4, textAlign: 'right' },

  okText: { color: '#10B981' },
  warnText: { color: '#F59E0B' },
  badText: { color: '#EF4444', fontSize: 11.5 },
  mutedText: { color: '#666' },

  helpText: { color: '#AAA', fontSize: 12.5, lineHeight: 20 },
  strong: { color: '#FFF', fontWeight: 'bold' },
  hintText: { color: '#555', fontSize: 10.5, marginTop: 10, lineHeight: 15 },

  techToggle: { paddingVertical: 12, alignItems: 'center', marginBottom: 8 },
  techToggleText: { color: '#FFB703', fontSize: 13, fontWeight: 'bold' },
  techBlock: { borderTopWidth: 0.5, borderColor: '#222', paddingTop: 8, marginTop: 6 },
  lineLabel: { color: '#DDD', fontSize: 12.5, flex: 1.2, paddingRight: 6 },
  lineValue: { fontSize: 11.5, fontWeight: 'bold', flex: 1.4, textAlign: 'right' },
  lineSub: { color: '#777', fontSize: 11, marginTop: 3 },
  mono: { color: '#9CA3AF', fontSize: 10.5, marginTop: 3 }
});
