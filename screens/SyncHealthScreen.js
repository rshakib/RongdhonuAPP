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

/** LOCAL state — 3 aggregate queries total (was ~100 → this was the lag). */
function readLocalState() {
  // 1) queues, grouped by table+status
  const sbQ = safeQ("SELECT table_name, status, COUNT(*) c FROM sync_queue_supabase GROUP BY table_name, status");
  const fbQ = safeQ("SELECT table_name, status, COUNT(*) c FROM sync_queue GROUP BY table_name, status");

  const sbPerTable = {}; const fbPerTable = {};
  let sbPending = 0, sbFailed = 0, fbPending = 0, fbFailed = 0;
  for (const r of sbQ) {
    const n = Number(r.c) || 0;
    sbPerTable[r.table_name] = (sbPerTable[r.table_name] || 0) + n;
    if (r.status === 'FAILED') sbFailed += n; else sbPending += n;
  }
  for (const r of fbQ) {
    const n = Number(r.c) || 0;
    fbPerTable[r.table_name] = (fbPerTable[r.table_name] || 0) + n;
    if (r.status === 'FAILED') fbFailed += n; else fbPending += n;
  }

  // 2) every sync cursor in ONE query
  const cursors = {};
  for (const row of safeQ("SELECT key, value FROM app_config WHERE key LIKE 'last_sync_time%'")) {
    if (row && row.key) cursors[row.key] = row.value;
  }

  const tables = DUAL_TABLES.map((t) => ({
    table: t,
    sbCursor: cursors[`last_sync_time_supabase_${t}`] || null,
    fbCursor: cursors[`last_sync_time_${t}`] || null,
    sbPending: sbPerTable[t] || 0,
    fbPending: fbPerTable[t] || 0
  }));

  const queues = [
    { key: 'sb', name: 'মূল সার্ভার (Supabase)', pending: sbPending, failed: sbFailed },
    { key: 'fb', name: 'ব্যাকআপ (Firebase)', pending: fbPending, failed: fbFailed }
  ];

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

  // Freshest READ time per backend (across all devices) — shown on the top card.
  const newest = (vals) => vals.filter(Boolean).reduce((m, v) => (!m || v > m ? v : m), null);
  const lastReadFB = newest(deviceViews.map((d) => d.fb && d.fb.last_read_at));
  const lastReadSB = newest(deviceViews.map((d) => d.sb && d.sb.last_read_at));

  // ── FLEET-WIDE per-table unsent counts (every device reports its own) ───────
  const asObject = (v) => {
    if (!v) return null;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch (_) { return null; } }
    return typeof v === 'object' ? v : null;
  };
  const devName = (dev, profile) => PROFILE_BN[String(profile || '').toUpperCase()] || dev;
  const addAll = (target, devTarget, obj, name) => {
    for (const [t, n] of Object.entries(obj || {})) {
      target[t] = (target[t] || 0) + (Number(n) || 0);
      (devTarget[t] = devTarget[t] || new Set()).add(name);
    }
  };
  const fleet = { sb: {}, fb: {}, sbDev: {}, fbDev: {} };
  for (const dev of devices) {
    const sbRow = byDevice[dev].supabase || null;
    const fbRow = byDevice[dev].firebase || null;
    const name = devName(dev, (sbRow && sbRow.app_profile) || (fbRow && fbRow.app_profile));
    addAll(fleet.sb, fleet.sbDev, asObject(sbRow && sbRow.pending_tables), name);
    addAll(fleet.fb, fleet.fbDev, asObject(fbRow && fbRow.pending_tables), name);
  }
  const hasFleet = Object.keys(fleet.sb).length > 0 || Object.keys(fleet.fb).length > 0;
  const names = (set) => (set ? [...set].join(', ') : '');
  const fleetTotal = { sb: Object.values(fleet.sb).reduce((a, b) => a + b, 0), fb: Object.values(fleet.fb).reduce((a, b) => a + b, 0) };

  // ── The ONE answer: per dual table, did BOTH sides get it? ──────────────────
  // Fleet-wide when devices report their queues (new build); otherwise this device.
  const dualRows = (local?.tables || []).map((t) => {
    const sbPending = hasFleet ? (fleet.sb[t.table] || 0) : t.sbPending;
    const fbPending = hasFleet ? (fleet.fb[t.table] || 0) : t.fbPending;
    const sbWho = names(fleet.sbDev[t.table]);
    const fbWho = names(fleet.fbDev[t.table]);
    const sbOk = sbPending === 0;
    const fbOk = fbPending === 0;
    const lag = lagMin(t.fbCursor, t.sbCursor);
    const noInfo = !t.sbCursor && !t.fbCursor;
    let label = '— এখনো কিছু যায়নি';
    let tone = 'muted';
    if (!noInfo) {
      if (!sbOk && !fbOk) { label = `🔴 দুটোই বাকি${sbWho || fbWho ? ` (${[...new Set([sbWho, fbWho].filter(Boolean))].join(', ')})` : ''}`; tone = 'bad'; }
      else if (!sbOk) { label = `⚠️ মূল সার্ভারে বাকি${sbWho ? ` (${sbWho})` : ''}`; tone = 'warn'; }
      else if (!fbOk) { label = `⚠️ ব্যাকআপে বাকি${fbWho ? ` (${fbWho})` : ''}`; tone = 'warn'; }
      else if (lag != null && lag > SYNC_TOLERANCE_MIN) { label = `⚠️ ${lag} মিনিট ফারাক`; tone = 'warn'; }
      else { label = '✅ একসাথে'; tone = 'ok'; }
    }
    return { ...t, sbOk, fbOk, sbPending, fbPending, label, tone, noInfo };
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

            <View style={styles.heroReads}>
              <Text style={styles.heroReadsCaption}>সব ফোন মিলিয়ে (কে কখন পড়েছে)</Text>
              <View style={styles.heroReadRow}>
                <Text style={styles.heroReadLabel}>🔥 Firebase read</Text>
                <Text style={styles.heroReadValue}>{agoText(lastReadFB)}</Text>
              </View>
              <View style={styles.heroReadRow}>
                <Text style={styles.heroReadLabel}>⚡ Supabase read</Text>
                <Text style={styles.heroReadValue}>{agoText(lastReadSB)}</Text>
              </View>
            </View>
          </View>

          {/* ── একসাথে সেভ হচ্ছে কি? (দুই DB) ────────────────────────── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>একসাথে সেভ হচ্ছে কি? <Text style={styles.cardTitleTag}>সব ফোন</Text></Text>
            <Text style={styles.legend}>
              <Text style={styles.strong}>SB</Text> = মূল সার্ভার · <Text style={styles.strong}>FB</Text> = ব্যাকআপ{'\n'}
              <Text style={styles.strong}>✅</Text> = পাঠানো হয়েছে · <Text style={styles.strong}>❌</Text> = বাকি{'\n'}
              <Text style={styles.dim}>সব ফোন মিলিয়ে — কোন ফোনে কী বাকি আছে সেটাও পাশে লেখা থাকে।</Text>
            </Text>

            {error ? (
              <Text style={styles.badText}>{error}</Text>
            ) : dualRows.length === 0 ? (
              <Text style={styles.helpText}>কোনো তথ্য নেই।</Text>
            ) : (
              dualRows.map((r, i) => (
                <View key={r.table} style={[styles.rowLine, i % 2 === 1 && styles.rowAlt]}>
                  <Text style={styles.tableName} numberOfLines={1}>{r.table}</Text>
                  <View style={styles.flags}>
                    <Text style={[styles.badge, r.sbOk ? styles.badgeOk : styles.badgeBad]}>SB {r.sbOk ? '✅' : '❌'}</Text>
                    <Text style={[styles.badge, r.fbOk ? styles.badgeOk : styles.badgeBad]}>FB {r.fbOk ? '✅' : '❌'}</Text>
                  </View>
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
                <Text style={styles.cardTitle}>এখনো পাঠানো বাকি আছে কি? <Text style={styles.cardTitleTag}>{hasFleet ? 'সব ফোন' : 'এই ফোন'}</Text></Text>
                {(local?.queues || []).map((q) => {
                  const fleetPending = q.key === 'sb' ? fleetTotal.sb : fleetTotal.fb;
                  const pending = hasFleet ? fleetPending : q.pending;
                  const failed = hasFleet ? 0 : q.failed;
                  return (
                    <View key={q.key} style={styles.techBlock}>
                      <View style={styles.rowLine}>
                        <Text style={styles.lineLabel}>{q.name}</Text>
                        <Text style={[styles.lineValue, (pending + failed) > 0 ? styles.warnText : styles.okText]}>
                          {(pending + failed) === 0 ? 'সব পাঠানো হয়েছে' : `বাকি ${pending}${failed ? ` · ব্যর্থ ${failed}` : ''}`}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>টেবিল অনুযায়ী (সময়সহ) <Text style={styles.cardTitleTag}>এই ফোন</Text></Text>
                <Text style={styles.hintText}>সময় প্রতিটি ফোনের নিজের — তাই এটি যেই ফোনে দেখছেন তারই হিসাব।</Text>
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
                <Text style={styles.cardTitle}>প্রতিটি ফোন <Text style={styles.cardTitleTag}>সব ফোন</Text></Text>
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

  heroCard: { borderRadius: 22, padding: 22, alignItems: 'center', borderWidth: 1, marginBottom: 16 },
  heroOk: { backgroundColor: 'rgba(16, 185, 129, 0.12)', borderColor: 'rgba(16, 185, 129, 0.5)' },
  heroWarn: { backgroundColor: 'rgba(245, 158, 11, 0.12)', borderColor: 'rgba(245, 158, 11, 0.5)' },
  heroBad: { backgroundColor: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.5)' },
  heroIcon: { fontSize: 38, marginBottom: 6 },
  heroTitle: { color: '#FFF', fontSize: 18, fontWeight: '800', textAlign: 'center', letterSpacing: 0.2 },
  heroSub: { color: '#C9C9C9', fontSize: 12.5, textAlign: 'center', lineHeight: 19, marginTop: 8, paddingHorizontal: 4 },
  heroTime: { color: '#777', fontSize: 10.5, marginTop: 12 },
  heroReads: { width: '100%', marginTop: 14, borderTopWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)', paddingTop: 10 },
  heroReadsCaption: { color: '#8A8A8A', fontSize: 10.5, marginBottom: 6, textAlign: 'center' },
  heroReadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  heroReadLabel: { color: '#BBB', fontSize: 12 },
  heroReadValue: { color: '#FFF', fontSize: 12, fontWeight: 'bold' },

  card: { backgroundColor: '#111', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: '#222', marginBottom: 14 },
  cardTitle: { color: '#FFB703', fontSize: 15, fontWeight: '800', marginBottom: 10 },
  cardTitleTag: { color: '#9CA3AF', fontSize: 10.5, fontWeight: '700' },
  dim: { color: '#666' },
  legend: { color: '#888', fontSize: 11.5, lineHeight: 18, marginBottom: 10 },

  rowLine: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8, borderRadius: 10, marginBottom: 2 },
  rowAlt: { backgroundColor: '#161616' },
  tableName: { color: '#FFF', fontSize: 12.5, fontWeight: '700', flex: 1.25, paddingRight: 6 },
  flags: { flexDirection: 'row', marginRight: 8 },
  badge: { fontSize: 10.5, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden', marginRight: 4 },
  badgeOk: { backgroundColor: 'rgba(16, 185, 129, 0.16)', color: '#34D399' },
  badgeBad: { backgroundColor: 'rgba(239, 68, 68, 0.16)', color: '#F87171' },
  verdict: { fontSize: 11, fontWeight: '700', flex: 1.3, textAlign: 'right' },

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
