import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity, ActivityIndicator, AppState,
  Animated, Easing
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { Download, Upload, CheckCircle2, AlertTriangle, XCircle, HelpCircle } from 'lucide-react-native';
import { fetchSyncHeartbeats } from '../services/supabaseHeartbeat';
import { executeInspectorQuery } from '../database';
import {
  buildSyncHealthModel, SOURCES, SOURCE_SHORT, SOURCE_EN, formatElapsedEn
} from '../services/syncHealthModel';

/**
 * "ডেটা সেভের অবস্থা" — exactly three questions, in order:
 *   ১. are the main server and the backup in the SAME POSITION
 *   ২. the two servers — who (device + app) last read each one, and how many minutes ago
 *   ৩. per phone, when each was last read / written
 *
 * SINGLE-SUPABASE build: the two sources are SB (the one Supabase project) and FB (Firebase).
 */

// Tables written to BOTH clouds. `app_config` is Firebase-only (excluded).
// Display order: restaurant_tables first; due_payments / users / menu_items /
// supplier_due(_history) last.
const DUAL_TABLES = [
  'restaurant_tables',
  'orders', 'order_items', 'payments', 'deliveries',
  'expenses', 'daily_submit', 'daily_summary', 'eja_history',
  'weather_data', 'menu_categories',
  'supplier_payment_ledger', 'deletions', 'delete_history',
  'owner_employees', 'owner_salary_ledger', 'owner_expenses', 'owner_deposits', 'owner_home_deposits',
  'due_payments', 'users', 'menu_items', 'supplier_due_history', 'supplier_due', 'off_days'
];
const safeQ = (sql) => { try { return executeInspectorQuery(sql) || []; } catch (_) { return []; } };

/** The project ref baked into this build's Supabase URL (so "SB" is never ambiguous). */
function readDbIdentity() {
  const out = { supabase1: { ref: null, source: 'none' } };
  try {
    const url = String(process.env.EXPO_PUBLIC_SUPABASE_URL || '');
    const m = url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
    out.supabase1 = { ref: m ? m[1] : null, source: m ? 'env' : 'none' };
  } catch (_) {}
  return out;
}

/** device_id → human name, from the local device_registry (so no raw dev_uuid_… shows). */
function loadDeviceNames() {
  const map = {};
  for (const r of safeQ('SELECT device_id, device_name, model, brand FROM device_registry')) {
    if (r && r.device_id) map[r.device_id] = r.device_name || r.model || r.brand || r.device_id;
  }
  return map;
}

function agoText(iso) {
  if (!iso) return 'no data';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'no data';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour ago`;
  return `${Math.floor(hours / 24)} day ago`;
}

/** Compact "how long ago": 45s / 3m / 2h / 4d ('' when unknown). */
function shortAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Which revision of THIS screen is running — shown in the header as `bN`. */
export const SCREEN_BUILD = 2;

/** Tone → the colours used by the ring, the panel and the pills (one source of truth). */
const TONE = {
  ok: { line: '#34D399', tint: 'rgba(52, 211, 153, 0.09)', border: 'rgba(52, 211, 153, 0.32)' },
  warn: { line: '#F59E0B', tint: 'rgba(245, 158, 11, 0.09)', border: 'rgba(245, 158, 11, 0.34)' },
  bad: { line: '#EF4444', tint: 'rgba(239, 68, 68, 0.09)', border: 'rgba(239, 68, 68, 0.34)' },
  unknown: { line: '#8E8E93', tint: 'rgba(255, 255, 255, 0.03)', border: '#262626' }
};
const toneOf = (t) => TONE[t] || TONE.unknown;

/**
 * The status ring: how much of what we track is in step, as one arc.
 */
function StatusRing({ inStep, total, tone, size = 116 }) {
  const stroke = 11;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = total > 0 ? Math.max(0, Math.min(1, inStep / total)) : 0;
  const col = toneOf(tone).line;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="#27272A" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={col}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - ratio)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.ringCenter} pointerEvents="none">
        <Text style={[styles.ringValue, { color: col }]}>{inStep}</Text>
        <Text style={styles.ringOf}>/ {total}</Text>
        <Text style={styles.ringLabel}>in step</Text>
      </View>
    </View>
  );
}

/** Exact clock time for a timestamp, e.g. "10:42 PM" ('' when unknown). */
function clockOf(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Error state for this screen, so a crash shows a readable card instead of a white screen. */
class ScreenBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  render() {
    if (this.state.err) {
      return (
        <View style={styles.center}>
          <Text style={styles.helpText}>This screen could not be shown.</Text>
          <Text style={styles.badText}>
            {String((this.state.err && this.state.err.message) || this.state.err)}
          </Text>
          <Text style={styles.helpText}>
            Reload the app once. If it still happens, install a fresh build (an old bundle causes this).
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

/** LOCAL state — 3 aggregate queries total. */
function readLocalState() {
  const sbQ = safeQ("SELECT table_name, status, COUNT(*) c FROM sync_queue_supabase GROUP BY table_name, status");
  const fbQ = safeQ("SELECT table_name, status, COUNT(*) c FROM sync_queue GROUP BY table_name, status");

  const perTable = { supabase1: {} };
  const tally = { supabase1: { pending: 0, failed: 0 } };
  for (const r of sbQ) {
    const n = Number(r.c) || 0;
    perTable.supabase1[r.table_name] = (perTable.supabase1[r.table_name] || 0) + n;
    if (r.status === 'FAILED') tally.supabase1.failed += n; else tally.supabase1.pending += n;
  }
  const fbPerTable = {};
  let fbPending = 0, fbFailed = 0;
  for (const r of fbQ) {
    const n = Number(r.c) || 0;
    fbPerTable[r.table_name] = (fbPerTable[r.table_name] || 0) + n;
    if (r.status === 'FAILED') fbFailed += n; else fbPending += n;
  }

  const cursors = {};
  for (const row of safeQ("SELECT key, value FROM app_config WHERE key LIKE 'last_sync_time%'")) {
    if (row && row.key) cursors[row.key] = row.value;
  }

  const tables = DUAL_TABLES.map((t) => ({
    table: t,
    targets: ['supabase1', 'firebase'],
    cursors: {
      supabase1: cursors[`last_sync_time_supabase_${t}`] || null,
      firebase: cursors[`last_sync_time_${t}`] || null
    },
    pending: {
      supabase1: perTable.supabase1[t] || 0,
      firebase: fbPerTable[t] || 0
    }
  }));

  const queues = [
    { key: 'supabase1', name: SOURCE_EN.supabase1, pending: tally.supabase1.pending, failed: tally.supabase1.failed },
    { key: 'firebase', name: SOURCE_EN.firebase, pending: fbPending, failed: fbFailed }
  ];

  return { queues, tables };
}

/**
 * Per table, the most recent row CONFIRMED pushed to each backend, read from the LOCAL
 * per-backend sync flags (is_synced = Firebase, is_synced_supabase = Supabase). This is
 * the "last push value" for that table on that backend, on THIS phone.
 */
function readLastPushed() {
  const pkFor = (t) => (t === 'daily_submit' || t === 'daily_summary')
    ? 'date'
    : (t === 'daily_submit_priority' ? 'business_date' : 'id');
  const pick = (table, pk, col) => {
    try {
      const rows = executeInspectorQuery(
        `SELECT updated_at, created_at, ${pk} AS rid FROM ${table} WHERE ${col} = 1 ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 1`
      );
      return (rows && rows[0]) ? rows[0] : null;
    } catch (_) {
      return null;
    }
  };
  return DUAL_TABLES.map((table) => {
    const pk = pkFor(table);
    return { table, fb: pick(table, pk, 'is_synced'), sb: pick(table, pk, 'is_synced_supabase') };
  });
}

/** How often the LIVE screen re-reads the heartbeats. */
export const LIVE_REFRESH_MS = 15000;

export default function SyncHealthScreen({ onBack }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);
  const [local, setLocal] = useState(null);
  const [deviceNames, setDeviceNames] = useState({});
  const [lastPushed, setLastPushed] = useState([]);
  const [live, setLive] = useState(true);
  const [, setTick] = useState(0);
  const panelIn = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  const load = async ({ silent = false } = {}) => {
    if (!silent) { setLoading(true); setError(null); }
    setLocal(readLocalState());
    setDeviceNames(loadDeviceNames());
    setLastPushed(readLastPushed());
    const res = await fetchSyncHeartbeats();
    if (res && res.success) { setRows(res.rows || []); setError(null); }
    else { setRows([]); setError((res && res.error) || 'could not load data'); }
    setCheckedAt(new Date().toLocaleTimeString());
    if (!silent) setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // LIVE DOT — a slow breath while the screen is live.
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true })
    ]));
    if (live) loop.start(); else { loop.stop(); pulse.setValue(0); }
    return () => loop.stop();
  }, [live]);

  // TIMER TICK — ages are computed at render time, so a 1s re-render makes them count up.
  useEffect(() => {
    if (!live) return undefined;
    let timer = null;
    const start = () => { if (!timer) timer = setInterval(() => setTick((t) => t + 1), 1000); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    start();
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
    return () => { stop(); if (sub && sub.remove) sub.remove(); };
  }, [live]);

  // LIVE refresh — pauses while backgrounded.
  useEffect(() => {
    if (!live) return undefined;
    let timer = null;
    const start = () => { if (!timer) timer = setInterval(() => { load({ silent: true }); }, LIVE_REFRESH_MS); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    start();
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
    return () => { stop(); if (sub && sub.remove) sub.remove(); };
  }, [live]);

  const dbIdent = readDbIdentity();
  const sbRef = (dbIdent && dbIdent.supabase1 && dbIdent.supabase1.ref) || '(none)';
  const model = buildSyncHealthModel({ heartbeats: rows, local, deviceNames, dbRefs: dbIdent });
  const {
    deviceViews = [], dbCards = [], problemCards = [],
    positionSummary = { total: 0, same: 0, different: 0, missing: 0, none: 0, allSame: false },
    positionVerdict = {
      tone: 'unknown',
      titleEn: 'Not enough data yet',
      hintEn: 'Keep the app open, then press Refresh.'
    }
  } = model || {};
  const srcName = (s) => SOURCE_SHORT[s] || s;

  // ── Normal-flow check (card 1): is the INTENDED flow actually working? ──────
  // Reads should come from Supabase; Firebase is manual-only. So: is Supabase being read,
  // is anything failing (push/realtime), and has anyone read Firebase (manual pull)?
  const byDev = {};
  for (const r of rows || []) {
    if (!r || !r.device_id) continue;
    const norm = String(r.backend || '').toLowerCase() === 'firebase' ? 'firebase' : 'supabase1';
    byDev[r.device_id] = byDev[r.device_id] || {};
    byDev[r.device_id][norm] = r;
  }
  const nowMs = Date.now();
  const nameFor = (id) => deviceNames[id] || (String(id).length > 12 ? `${String(id).slice(0, 12)}…` : id);
  const flowDevices = Object.keys(byDev).sort().map((dev) => {
    const sb = byDev[dev].supabase1 || null;
    const fb = byDev[dev].firebase || null;
    const rOk = sb ? (sb.realtime_ok === true ? true : (sb.realtime_ok === false ? false : null)) : null;
    return {
      dev,
      deviceLabel: nameFor(dev),
      profile: (sb && sb.app_profile) || (fb && fb.app_profile) || '',
      version: (sb && sb.app_version) || (fb && fb.app_version) || '',
      realtimeOk: rOk,
      sbReadAt: (sb && sb.last_read_at) || null,
      fbReadAt: (fb && fb.last_read_at) || null,
      pushOk: [sb, fb].every((x) => !x || x.last_push_ok !== false)
    };
  });
  const within = (iso, days) => !!iso && Number.isFinite(new Date(iso).getTime()) && (nowMs - new Date(iso).getTime()) <= days * 86400000;
  const newestIso = (vals) => vals.filter(Boolean).sort().slice(-1)[0] || null;
  const sbReadAt = newestIso(flowDevices.map((d) => d.sbReadAt));
  const fbReadAt = newestIso(flowDevices.map((d) => d.fbReadAt));
  const anyRealtimeFail = flowDevices.some((d) => d.realtimeOk === false);
  const anyRealtimeKnown = flowDevices.some((d) => d.realtimeOk !== null);
  const anyPushFail = flowDevices.some((d) => !d.pushOk) || !!(model && model.anyPushFailed);
  const supabaseReadOk = within(sbReadAt, 0.25);   // a Supabase read within the last ~6h
  const firebaseRead31d = within(fbReadAt, 31);    // Firebase was read in the last 31 days
  const manualPull = within(fbReadAt, 1);          // Firebase read within the last day = manual pull
  const flowTone = (anyRealtimeFail || anyPushFail) ? 'bad' : (!supabaseReadOk ? 'warn' : 'ok');
  const flow = {
    tone: flowTone,
    title: flowTone === 'ok' ? 'Normal flow ঠিক আছে'
      : flowTone === 'bad' ? 'কিছু fail করছে'
        : 'স্বাভাবিক read চোখে পড়ছে না',
    sub: flowTone === 'ok'
      ? 'Read গুলো Supabase থেকেই আসছে; push ও realtime ঠিক আছে।'
      : flowTone === 'bad'
        ? 'নিচে দেখো — Realtime বা push fail করছে।'
        : 'কোনো device থেকে সম্প্রতি Supabase read দেখা যায়নি (device বন্ধ থাকলে স্বাভাবিক)।',
    supabaseReadOk,
    pushOk: !anyPushFail,
    realtimeOk: !anyRealtimeFail,
    realtimeKnown: anyRealtimeKnown,
    realtimeRows: (rows || []).length,
    realtimeWithValue: flowDevices.filter((d) => d.realtimeOk !== null).length,
    firebaseRead31d,
    manualPull,
    fbReadAt
  };
  // Card 4 shows ONLY tables that have actually been pushed to at least one backend.
  const pushedRows = lastPushed.filter((r) => r.fb || r.sb);

  // ENTRANCE — the panel settles in when it first appears or when the tone changes.
  useEffect(() => {
    panelIn.setValue(0);
    Animated.timing(panelIn, {
      toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true
    }).start();
  }, [positionVerdict.tone]);

  return (
    <ScreenBoundary>
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>❮ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Data Save Status</Text>
        <View style={styles.headerRight}>
          <Text style={styles.buildTag}>b{SCREEN_BUILD}</Text>
          <TouchableOpacity onPress={() => setLive((v) => !v)} style={styles.liveBtn}>
            <Text style={[styles.liveBtnText, live ? styles.liveOn : styles.liveOff]}>
              {live ? '🟢 Live' : '⏸ Paused'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => load()} style={styles.refreshBtn}>
            <Text style={styles.refreshBtnText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FFB703" />
        </View>
      ) : (
        <ScrollView style={styles.content}>

          {error ? <Text style={styles.badText}>{error}</Text> : null}

          {/* ── 1. STATUS: is the normal flow working? ─────────────────── */}
          <View style={styles.sectionHead}>
            <View style={styles.sectionNum}><Text style={styles.sectionNumText}>1</Text></View>
            <Text style={styles.sectionTitle}>Normal flow status</Text>
          </View>
          <View style={[styles.flowBanner, flow.tone === 'ok' ? styles.flowOk : (flow.tone === 'bad' ? styles.flowBad : styles.flowWarn)]}>
            <Text style={styles.flowIcon}>{flow.tone === 'ok' ? '✅' : (flow.tone === 'bad' ? '🔴' : '⚠️')}</Text>
            <Text style={styles.flowTitle}>{flow.title}</Text>
            <Text style={styles.flowSub}>{flow.sub}</Text>
            <View style={styles.flowChecks}>
              <Text style={styles.flowCheck}>{flow.supabaseReadOk ? '✅' : '❌'} Supabase read (as expected){sbReadAt ? ` · ${shortAgo(sbReadAt)}` : ''}</Text>
              <Text style={styles.flowCheck}>{flow.pushOk ? '✅' : '❌'} Push (Supabase + Firebase)</Text>
              <Text style={styles.flowCheck}>{flow.realtimeKnown ? (flow.realtimeOk ? '✅' : '❌') : '•'} Realtime channel{flow.realtimeKnown ? '' : ` — report আসেনি (rows: ${flow.realtimeRows}, rt: ${flow.realtimeWithValue})`}</Text>
              <Text style={styles.flowCheck}>{flow.firebaseRead31d ? '⚠️' : '✅'} Firebase read (last 31 days){flow.firebaseRead31d ? ` · ${shortAgo(fbReadAt)}` : ' · none'}</Text>
              <Text style={styles.flowCheck}>{flow.manualPull ? '⚠️' : '✅'} Manual Firebase pull{flow.manualPull ? ` · ${shortAgo(fbReadAt)}` : ' · none'}</Text>
              <Text style={styles.flowCheck}>• Supabase project: {sbRef}</Text>
            </View>
          </View>

          {/* ── 1b. Per device: realtime / Supabase read / Firebase read ── */}
          <View style={styles.flatPanel}>
            <View style={[styles.lpRow, styles.lpHead]}>
              <Text style={styles.lpTableHead}>Device</Text>
              <Text style={styles.lpColHead}>Realtime</Text>
              <Text style={styles.lpColHead}>SB read</Text>
              <Text style={styles.lpColHead}>FB read</Text>
            </View>
            {flowDevices.length === 0 ? (
              <Text style={[styles.helpText, { padding: 14 }]}>No heartbeat yet.</Text>
            ) : flowDevices.map((d, i) => (
              <View key={d.dev} style={[styles.lpRow, i % 2 === 1 && styles.lpRowAlt]}>
                <Text style={styles.lpTable} numberOfLines={1}>{d.deviceLabel}{d.version ? ` · ${d.version}` : ''}</Text>
                <Text style={[styles.flowCell, d.realtimeOk === false ? styles.badText : (d.realtimeOk ? styles.okText : styles.mutedText)]}>
                  {d.realtimeOk === false ? '❌' : (d.realtimeOk ? '✅' : '—')}
                </Text>
                <Text style={[styles.flowCell, d.sbReadAt ? styles.readText : styles.mutedText]}>{d.sbReadAt ? shortAgo(d.sbReadAt) : 'no'}</Text>
                <Text style={[styles.flowCell, d.fbReadAt ? styles.warnText : styles.mutedText]}>{d.fbReadAt ? shortAgo(d.fbReadAt) : 'no'}</Text>
              </View>
            ))}
            <Text style={styles.lpHint}>Realtime ❌ = ওই device-এর signal channel fail (fast-fallback polling চলবে)। FB read = manual Firebase pull (policy: Firebase auto-read নেই)।</Text>
          </View>

          {/* ── 2. The two servers ───────────────────────────────────── */}
          <View style={styles.sectionHead}>
            <View style={styles.sectionNum}><Text style={styles.sectionNumText}>2</Text></View>
            <Text style={styles.sectionTitle}>Servers</Text>
          </View>
          {dbCards.map((d) => {
            const has = !!d.lastReadAt || !!d.lastPushAt;
            const tone = d.pushOk === false ? 'bad' : (has ? 'ok' : 'idle');
            return (
              <View
                key={d.key}
                style={[
                  styles.dbCard,
                  tone === 'bad' ? styles.dbCardBad : (tone === 'ok' ? styles.dbCardOk : styles.dbCardIdle),
                  tone === 'bad' ? styles.accentBad : (tone === 'ok' ? styles.accentOk : styles.accentIdle)
                ]}
              >
                <View style={styles.dbTop}>
                  <View style={styles.dbBadge}>
                    <Text style={styles.dbBadgeText}>{d.short}</Text>
                  </View>
                  <Text style={styles.dbName}>{d.nameEn}</Text>
                  <View style={[styles.pill, tone === 'bad' ? styles.pillBad : (tone === 'ok' ? styles.pillOk : styles.pillIdle)]}>
                    <Text style={styles.pillText}>
                      {tone === 'bad' ? '🔴 Problem' : (tone === 'ok' ? '✅ OK' : '○ Idle')}
                    </Text>
                  </View>
                </View>

                <Text style={styles.dbSub}>
                  {d.devices} phone(s) reporting{d.ref ? ` · ${d.ref}${d.refSource === 'override' ? ' (app override)' : ''}` : ''}
                </Text>

                <View style={styles.dbPair}>
                  {/* WRITE — last write to this server */}
                  <View style={[styles.dbHalf, styles.dbHalfFirst]}>
                    <View style={styles.iRow}>
                      <Upload size={13} color="#A78BFA" strokeWidth={2.5} />
                      <Text style={styles.dbLineLabel}>Written</Text>
                    </View>
                    <Text style={[styles.dbBig, d.pushOk === false ? styles.badText : (d.lastPushAt ? styles.writeText : styles.mutedText)]}>
                      {d.lastPush ? formatElapsedEn(d.lastPush.at) : 'never written'}
                    </Text>
                    <Text style={styles.dbClock}>{d.lastPush ? clockOf(d.lastPush.at) : ''}</Text>
                    <Text style={styles.dbWho}>
                      {d.lastPush ? `${d.lastPush.deviceLabel} · ${d.lastPush.appLabelEn}` : '—'}
                    </Text>
                  </View>

                  {/* READ — last read from this server */}
                  <View style={styles.dbHalf}>
                    <View style={styles.iRow}>
                      <Download size={13} color="#60A5FA" strokeWidth={2.5} />
                      <Text style={styles.dbLineLabel}>Read</Text>
                    </View>
                    <Text style={[styles.dbBig, d.lastReadAt ? styles.readText : styles.mutedText]}>
                      {d.lastRead ? formatElapsedEn(d.lastRead.at) : 'never read'}
                    </Text>
                    <Text style={styles.dbClock}>{d.lastRead ? clockOf(d.lastRead.at) : ''}</Text>
                    <Text style={styles.dbWho}>
                      {d.lastRead ? `${d.lastRead.deviceLabel} · ${d.lastRead.appLabelEn}` : '—'}
                    </Text>
                  </View>
                </View>

                {d.pushOk === false ? (
                  <Text style={styles.dbRetired}>🔴 The last push failed — check the internet</Text>
                ) : null}
              </View>
            );
          })}

          {/* ── 3. Every phone: read and write per server ─────────────── */}
          <View style={styles.sectionHead}>
            <View style={styles.sectionNum}><Text style={styles.sectionNumText}>3</Text></View>
            <Text style={styles.sectionTitle}>Which phone read / wrote when</Text>
          </View>
          {deviceViews.length === 0 ? (
            <View style={styles.panel}>
              <Text style={styles.helpText}>
                No phone has reported yet. Keep the app open, then press Refresh.
              </Text>
            </View>
          ) : (
            <View style={styles.flatPanel}>
              {/* column legend — write first, read second (same as the server cards) */}
              <View style={styles.pLegend}>
                <Text style={styles.pLegendSpacer} />
                <Text style={[styles.pLegendText, styles.writeText]}>⬆ Written</Text>
                <Text style={[styles.pLegendText, styles.readText]}>⬇ Read</Text>
              </View>
              {deviceViews.map((d, idx) => {
                const live = SOURCES
                  .map((s) => ({ s, r: s === 'supabase1' ? d.p1 : d.fb }))
                  .filter(({ r }) => r && (r.last_read_at || r.last_push_at));
                const bad = live.some(({ r }) => r.last_error);
                const badRow = live.find(({ r }) => r.last_error);
                return (
                  <View key={d.dev} style={[styles.phoneRow, idx > 0 && styles.phoneRowBorder]}>
                    <View style={styles.phoneHead}>
                      <View style={[styles.phoneAvatar, bad && styles.phoneAvatarBad]}>
                        <Text style={[styles.phoneAvatarText, bad && styles.badText]}>
                          {String(d.deviceLabel).slice(0, 1)}
                        </Text>
                      </View>
                      <View style={styles.groupBody}>
                        <Text style={styles.phoneName}>{d.deviceLabel}</Text>
                        <Text style={styles.phoneApp}>
                          {d.appLabelEn}{live.length ? ` · ${live.length} servers` : ''}
                        </Text>
                      </View>
                      <View style={[styles.pill, bad ? styles.pillBad : styles.pillOk]}>
                        <Text style={styles.pillText}>{bad ? '🔴 Problem' : '✅ OK'}</Text>
                      </View>
                    </View>

                    {live.length ? (
                      live.map(({ s, r }) => (
                        <View key={s} style={styles.pRow}>
                          <Text style={styles.pSrc}>{srcName(s)}</Text>
                          <View style={styles.pCell}>
                            <Upload size={12} color={r.last_push_at ? '#A78BFA' : '#3F3F46'} strokeWidth={2.5} />
                            <Text style={[styles.pTime, r.last_push_at ? styles.writeText : styles.mutedText]}>
                              {r.last_push_at ? formatElapsedEn(r.last_push_at) : '—'}
                            </Text>
                          </View>
                          <View style={styles.pCell}>
                            <Download size={12} color={r.last_read_at ? '#60A5FA' : '#3F3F46'} strokeWidth={2.5} />
                            <Text style={[styles.pTime, r.last_read_at ? styles.readText : styles.mutedText]}>
                              {r.last_read_at ? formatElapsedEn(r.last_read_at) : '—'}
                            </Text>
                          </View>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.phoneEmpty}>nothing yet</Text>
                    )}
                    {badRow ? (
                      <Text style={styles.badText}>Problem: {badRow.r.last_error}</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}

          {/* ── 4. Per-table last push (Firebase vs Supabase) ─────────── */}
          <View style={styles.sectionHead}>
            <View style={styles.sectionNum}><Text style={styles.sectionNumText}>4</Text></View>
            <Text style={styles.sectionTitle}>Table-wise last push (Firebase vs Supabase)</Text>
          </View>
          <View style={styles.lpPanel}>
            <View style={[styles.lpRow, styles.lpHead]}>
              <Text style={styles.lpTableHead}>Table</Text>
              <Text style={styles.lpColHead}>Firebase</Text>
              <Text style={styles.lpColHead}>Supabase</Text>
            </View>
            {pushedRows.length === 0 ? (
              <Text style={[styles.helpText, { padding: 14 }]}>এখনো কোনো table push হয়নি।</Text>
            ) : pushedRows.map((r, i) => {
              const both = !!(r.fb && r.sb);
              const same = both && (r.fb.updated_at || r.fb.created_at) === (r.sb.updated_at || r.sb.created_at);
              const tone = both ? (same ? styles.okText : styles.badText) : styles.mutedText;
              return (
                <View key={r.table} style={[styles.lpRow, i % 2 === 1 && styles.lpRowAlt]}>
                  <Text style={styles.lpTable} numberOfLines={1}>{r.table}</Text>
                  <View style={styles.lpCell}>
                    <Text style={[styles.lpTime, tone]}>{r.fb ? shortAgo(r.fb.updated_at || r.fb.created_at) : 'no'}</Text>
                    <Text style={styles.lpVal}>{r.fb ? clockOf(r.fb.updated_at || r.fb.created_at) : ''}</Text>
                  </View>
                  <View style={styles.lpCell}>
                    <Text style={[styles.lpTime, tone]}>{r.sb ? shortAgo(r.sb.updated_at || r.sb.created_at) : 'no'}</Text>
                    <Text style={styles.lpVal}>{r.sb ? clockOf(r.sb.updated_at || r.sb.created_at) : ''}</Text>
                  </View>
                </View>
              );
            })}
            <Text style={styles.lpHint}>এই ফোনে push-confirmed সর্বশেষ row-এর সময় (is_synced / is_synced_supabase flag থেকে)।</Text>
          </View>

          {checkedAt ? (
            <Text style={styles.hintText}>
              Last updated: {checkedAt}{live ? ' · 🟢 live' : ''}
            </Text>
          ) : null}

        </ScrollView>
      )}
    </SafeAreaView>
    </ScreenBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#0D0D0D', borderBottomWidth: 1, borderColor: '#262626' },
  backBtn: { padding: 4 },
  backBtnText: { color: '#FFB703', fontWeight: 'bold' },
  headerTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  liveBtn: { padding: 4, marginRight: 10 },
  liveBtnText: { fontSize: 11.5, fontWeight: '700' },
  liveOn: { color: '#34D399' },
  liveOff: { color: '#8E8E93' },
  refreshBtn: { padding: 4 },
  refreshBtnText: { color: '#FFB703' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16 },

  // ─── section headings + cards (owner-facing) ───────────────────────────────
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, marginBottom: 10 },
  sectionNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 183, 3, 0.18)',
    borderWidth: 1,
    borderColor: '#FFB703',
    justifyContent: 'center',
    alignItems: 'center'
  },
  sectionNumText: { color: '#FFB703', fontSize: 12, fontWeight: '800' },
  sectionTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', letterSpacing: 0.2 },

  // status pill (top-right of every card)
  pill: { borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1 },
  pillOk: { backgroundColor: 'rgba(52, 211, 153, 0.12)', borderColor: 'rgba(52, 211, 153, 0.5)' },
  pillBad: { backgroundColor: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.5)' },
  pillIdle: { backgroundColor: '#1E1E1E', borderColor: '#262626' },
  pillText: { color: '#FFFFFF', fontSize: 10.5, fontWeight: '700' },
  dbCard: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderLeftWidth: 4,
    marginBottom: 10
  },
  accentOk: { borderLeftColor: '#34D399' },
  accentBad: { borderLeftColor: '#EF4444' },
  accentIdle: { borderLeftColor: '#374151' },
  dbCardOk: { backgroundColor: 'rgba(52, 211, 153, 0.07)', borderColor: 'rgba(52, 211, 153, 0.35)' },
  dbCardIdle: { backgroundColor: '#161616', borderColor: '#262626' },
  dbCardBad: { backgroundColor: 'rgba(239, 68, 68, 0.09)', borderColor: 'rgba(239, 68, 68, 0.4)' },
  dbTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dbBadge: {
    backgroundColor: 'rgba(255, 183, 3, 0.15)',
    borderColor: '#FFB703',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 3
  },
  dbBadgeText: { color: '#FFB703', fontSize: 11.5, fontWeight: '800' },
  dbName: { flex: 1, color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  dbSub: { color: '#8E8E93', fontSize: 10.5, marginTop: 6 },
  dbRetired: { color: '#EF4444', fontSize: 12, marginTop: 6, fontWeight: '600' },
  dbPair: { flexDirection: 'row', marginTop: 12 },
  dbHalf: { flex: 1, paddingLeft: 12 },
  dbHalfFull: { flex: 1 },
  dbHalfFirst: { paddingLeft: 0, borderRightWidth: 1, borderRightColor: '#262626', paddingRight: 12 },
  dbLineLabel: { color: '#8E8E93', fontSize: 11, fontWeight: '700' },
  buildTag: { color: '#3F3F46', fontSize: 10, fontWeight: '700', marginRight: 8 },
  dbBig: { fontSize: 15, fontWeight: '800', marginTop: 4, lineHeight: 20 },
  dbClock: { color: '#8E8E93', fontSize: 10.5, marginTop: 1 },
  dbWho: { color: '#94A3B8', fontSize: 11, marginTop: 4, lineHeight: 16 },
  dbMeta: { color: '#8E8E93', fontSize: 10.5, marginTop: 10 },
  dbWarnMeta: { color: '#F59E0B', fontSize: 11, marginTop: 10, lineHeight: 16 },
  verdictHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12 },
  verdictTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  verdictHint: { color: '#94A3B8', fontSize: 12.5, textAlign: 'center', lineHeight: 20, marginTop: 6, paddingHorizontal: 8 },

  // the status ring (card ১)
  panel: {
    borderRadius: 22,
    borderWidth: 1,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 10
  },
  ringCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  ringValue: { fontSize: 26, fontWeight: '800', lineHeight: 30 },
  ringOf: { color: '#8E8E93', fontSize: 11, fontWeight: '700' },
  ringLabel: { color: '#8E8E93', fontSize: 9.5, marginTop: 2, letterSpacing: 0.2 },

  // three plain numbers under the ring, split by hairlines
  statRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginTop: 20 },
  statBox: { flex: 1, alignItems: 'center', gap: 3 },
  statDivider: { width: 1, height: 26, backgroundColor: 'rgba(255, 255, 255, 0.10)' },
  statNum: { color: '#FFFFFF', fontSize: 19, fontWeight: '800' },
  statLabel: { color: '#8E8E93', fontSize: 10, fontWeight: '600' },

  // an icon + its label on one line
  iRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  groupCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    marginBottom: 8
  },
  groupCardWarn: { backgroundColor: 'rgba(245, 158, 11, 0.08)', borderColor: 'rgba(245, 158, 11, 0.4)' },
  groupCardBad: { backgroundColor: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.4)' },
  groupEmoji: { fontSize: 22 },
  groupBody: { flex: 1 },
  groupTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  groupLine: { color: '#FFFFFF', fontSize: 12.5, marginTop: 3, lineHeight: 18 },
  groupMeta: { color: '#8E8E93', fontSize: 10.5, marginTop: 5 },

  // card ৩ — ONE flat panel with divided rows
  flatPanel: {
    backgroundColor: '#161616',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#262626',
    overflow: 'hidden',
    marginBottom: 10
  },
  phoneRow: { paddingHorizontal: 16, paddingVertical: 14 },
  phoneRowBorder: { borderTopWidth: 1, borderTopColor: '#262626' },
  phoneHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  phoneAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1E1E1E',
    borderWidth: 2,
    borderColor: 'rgba(52, 211, 153, 0.55)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  phoneAvatarBad: { borderColor: 'rgba(239, 68, 68, 0.6)' },
  phoneAvatarText: { color: '#FFB703', fontSize: 15, fontWeight: '800' },
  phoneName: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700' },
  phoneApp: { color: '#8E8E93', fontSize: 11, marginTop: 2 },
  phoneEmpty: { color: '#8E8E93', fontSize: 11.5, marginTop: 8 },

  // per-phone, per-database rows: read (download) and write (upload) side by side
  pRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  pSrc: { width: 34, color: '#FFB703', fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  pLegend: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 2, gap: 8 },
  pLegendSpacer: { width: 34 },
  pLegendText: { flex: 1, color: '#8E8E93', fontSize: 10, fontWeight: '700' },
  pCell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  pTime: { flex: 1, color: '#94A3B8', fontSize: 10.5, lineHeight: 14 },
  okText: { color: '#34D399' },
  writeText: { color: '#A78BFA' },
  readText: { color: '#60A5FA' },
  warnText: { color: '#F59E0B' },
  badText: { color: '#EF4444', fontSize: 11.5 },
  mutedText: { color: '#666' },
  helpText: { color: '#94A3B8', fontSize: 12.5, lineHeight: 20 },
  hintText: { color: '#555', fontSize: 10.5, marginTop: 10, lineHeight: 15 },

  // card ৪ — per-table last push (Firebase vs Supabase)
  lpPanel: {
    backgroundColor: '#161616',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#262626',
    overflow: 'hidden',
    marginBottom: 10,
    paddingBottom: 8
  },
  lpRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9 },
  lpRowAlt: { backgroundColor: 'rgba(255, 255, 255, 0.02)' },
  lpHead: { backgroundColor: '#1E1E1E', borderBottomWidth: 1, borderBottomColor: '#262626' },
  lpTableHead: { flex: 1.2, color: '#FFB703', fontSize: 11, fontWeight: '800' },
  lpColHead: { flex: 1, color: '#FFB703', fontSize: 11, fontWeight: '800', textAlign: 'center' },
  lpTable: { flex: 1.2, color: '#E5E7EB', fontSize: 11.5, fontWeight: '600', paddingRight: 6 },
  lpCell: { flex: 1, alignItems: 'center' },
  lpTime: { fontSize: 12, fontWeight: '800' },
  lpVal: { color: '#8E8E93', fontSize: 9.5, marginTop: 1 },
  lpHint: { color: '#555', fontSize: 10, marginTop: 8, marginHorizontal: 14, lineHeight: 14 },

  // card ১ — normal-flow status banner + per-device report
  flowBanner: { borderRadius: 22, borderWidth: 1, paddingVertical: 22, paddingHorizontal: 18, alignItems: 'center', marginBottom: 10 },
  flowOk: { backgroundColor: 'rgba(52, 211, 153, 0.10)', borderColor: 'rgba(52, 211, 153, 0.35)' },
  flowWarn: { backgroundColor: 'rgba(245, 158, 11, 0.10)', borderColor: 'rgba(245, 158, 11, 0.35)' },
  flowBad: { backgroundColor: 'rgba(239, 68, 68, 0.10)', borderColor: 'rgba(239, 68, 68, 0.35)' },
  flowIcon: { fontSize: 34, marginBottom: 4 },
  flowTitle: { color: '#FFF', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  flowSub: { color: '#94A3B8', fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 6 },
  flowChecks: { alignSelf: 'stretch', marginTop: 14, borderTopWidth: 0.5, borderColor: 'rgba(255, 255, 255, 0.12)', paddingTop: 10, gap: 6 },
  flowCheck: { color: '#E5E7EB', fontSize: 12, lineHeight: 16 },
  flowCell: { flex: 1, textAlign: 'center', fontSize: 11.5, fontWeight: '700' }
});
