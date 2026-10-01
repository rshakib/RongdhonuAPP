import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Animated,
  AccessibilityInfo,
  Easing,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar as RNStatusBar } from 'react-native';
import {
  auditRead,
  subscribeAudit,
  isAuditConfigured,
  isAuditSyncEnabled,
  getAuditReadSecret
} from '../services/auditClient';
import { getAuditOutboxStats } from '../services/auditLog';
import CalendarPicker from '../components/CalendarPicker';
import TimePicker, { formatTime12 } from '../components/TimePicker';

// ─── Visual language copied from screens/ActivityLogScreen.js ───────────────
const ACTION_THEME = {
  INSERT: { emoji: '➕', label: 'যোগ করেছেন', bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.4)', text: '#34D399' },
  UPDATE: { emoji: '✏️', label: 'পরিবর্তন করেছেন', bg: 'rgba(255, 183, 3, 0.15)', border: 'rgba(255, 183, 3, 0.4)', text: '#FFB703' },
  DELETE: { emoji: '🗑️', label: 'মুছে ফেলেছেন', bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.4)', text: '#EF4444' }
};

const ROLE_WORDS = { owner: 'মালিক', admin: 'অ্যাডমিন', manager: 'ম্যানেজার', waiter: 'ওয়েটার', staff: 'স্টাফ' };

const APP_WORDS = { ADMIN: 'অ্যাডমিন অ্যাপ', OWNER: 'মালিকের অ্যাপ', MANAGER: 'ম্যানেজারের অ্যাপ' };

const TABLE_WORDS = {
  users: 'ইউজার / অ্যাকাউন্ট',
  restaurant_tables: 'টেবিল',
  orders: 'অর্ডার',
  order_items: 'অর্ডারের আইটেম',
  payments: 'পেমেন্ট',
  expenses: 'খরচ',
  deliveries: 'ডেলিভারি',
  due_payments: 'বাকি টাকা',
  eja_history: 'ইজারা',
  menu_items: 'মেনু আইটেম',
  menu_categories: 'মেনু ক্যাটাগরি',
  off_days: 'বন্ধের দিন',
  weather_data: 'আবহাওয়া',
  supplier_due: 'সাপ্লায়ারের বাকি',
  supplier_due_history: 'সাপ্লায়ার বাকির হিসাব',
  supplier_payment_ledger: 'সাপ্লায়ার পেমেন্ট',
  daily_submit: 'ডেইলি সাবমিট',
  daily_summary: 'ডেইলি সামারি',
  daily_submit_priority: 'ডেইলি সাবমিট অগ্রাধিকার',
  owner_employees: 'কর্মী',
  owner_salary_ledger: 'বেতন',
  owner_expenses: 'মালিকের খরচ',
  owner_deposits: 'জমা',
  owner_home_deposits: 'বাড়ির জমা',
  notifications: 'নোটিফিকেশন',
  history_download_log: 'হিস্টরি ডাউনলোড'
};

const FIELD_WORDS = {
  name: 'নাম',
  item_name: 'আইটেমের নাম',
  table_name: 'টেবিলের নাম',
  display_name: 'নাম',
  username: 'ইউজারনেম',
  price: 'দাম',
  quantity: 'পরিমাণ',
  qty: 'পরিমাণ',
  amount: 'টাকার পরিমাণ',
  total: 'মোট',
  subtotal: 'সাবটোটাল',
  discount: 'ডিসকাউন্ট',
  delivery_charge: 'ডেলিভারি চার্জ',
  cash_amount: 'ক্যাশ',
  bkash_amount: 'বিকাশ',
  nagad_amount: 'নগদ',
  change_money_given: 'ফেরত দেওয়া টাকা',
  status: 'অবস্থা',
  category: 'ক্যাটাগরি',
  notes: 'নোট',
  role: 'ভূমিকা',
  phone: 'ফোন',
  address: 'ঠিকানা',
  payment_type: 'পেমেন্টের ধরন',
  payment_date: 'পেমেন্টের তারিখ',
  salary: 'বেতন',
  report_type: 'রিপোর্টের ধরন',
  requested_period: 'সময়কাল'
};

const MONEY_FIELDS = new Set([
  'price', 'amount', 'total', 'subtotal', 'discount', 'delivery_charge',
  'cash_amount', 'bkash_amount', 'nagad_amount', 'change_money_given', 'salary'
]);

const HIDDEN_FIELDS = new Set([
  'id', 'order_id', 'item_id', 'user_id', 'table_id', 'record_id', 'employee_id',
  'is_synced', 'is_synced_supabase', 'sync_status', 'device_id',
  'created_at', 'updated_at', 'timestamp', 'business_date'
]);

const IDENTIFY_FIELDS = [
  'name', 'item_name', 'table_name', 'display_name', 'username', 'title',
  'code', 'category', 'report_type'
];

const ITEM_FIELDS = new Set(['items', 'order_items', 'item_list', 'cart', 'products']);

const TIME_RANGES = [
  { key: 'ALL', label: 'সব সময়', hours: 0 },
  { key: '1h', label: 'শেষ ১ ঘণ্টা', hours: 1 },
  { key: '6h', label: 'শেষ ৬ ঘণ্টা', hours: 6 },
  { key: '24h', label: 'শেষ ২৪ ঘণ্টা', hours: 24 }
];

const PAGE_SIZE = 500;
const POLL_MS = 10000;
const ROW_LIMIT = 30;

// ─── Wording helpers ────────────────────────────────────────────────────────
const actionTheme = (action) => ACTION_THEME[String(action || '').toUpperCase()] || ACTION_THEME.UPDATE;
const tableWord = (table) => TABLE_WORDS[String(table || '')] || 'তথ্য';
const fieldWord = (field) => FIELD_WORDS[field] || String(field).replace(/_/g, ' ');
const appWord = (app) => APP_WORDS[String(app || '').toUpperCase()] || 'App';
const roleWord = (role) => ROLE_WORDS[String(role || '').toLowerCase()] || '';

/** The person's name, with a sensible fallback so a card is never nameless. */
function whoName(row) {
  const name = row.user_name ? String(row.user_name).trim() : '';
  if (name) return name;
  const word = roleWord(row.user_role);
  if (word) return word;
  return row.app_profile ? appWord(row.app_profile) : 'অজানা';
}

function shortDay(day) {
  if (!day) return '';
  try {
    return new Date(`${day}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' });
  } catch (_) { return day; }
}

function asObject(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return null; }
}

function humanValue(value) {
  if (value === null || value === undefined || value === '') return 'খালি';
  const raw = typeof value === 'object' ? '' : String(value);
  if (!raw) return 'খালি';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    try { return new Date(raw).toLocaleString(); } catch (_) { return raw; }
  }
  if (raw === '0' || raw === 'false') return 'না';
  if (raw === '1' || raw === 'true') return 'হ্যাঁ';
  return raw.length > 60 ? `${raw.slice(0, 60)}…` : raw;
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return humanValue(value);
  return `৳${n % 1 === 0 ? n : n.toFixed(2)}`;
}

function fieldValue(field, value) {
  if (MONEY_FIELDS.has(field) && value !== null && value !== undefined && value !== '') return money(value);
  return humanValue(value);
}

function looksLikeJson(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  return s.length > 1 && (s.startsWith('[') || s.startsWith('{'));
}

function parseItems(value) {
  let arr = value;
  if (typeof arr === 'string') {
    if (!looksLikeJson(arr)) return null;
    try { arr = JSON.parse(arr); } catch (_) { return null; }
  }
  if (!Array.isArray(arr)) {
    if (arr && typeof arr === 'object') arr = [arr];
    else return null;
  }
  const rows = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const name = entry.name ?? entry.itemName ?? entry.item_name ?? entry.title ?? entry.item ?? '';
    const price = entry.price ?? entry.rate ?? entry.unit_price ?? entry.unitPrice ?? null;
    const qty = entry.quantity ?? entry.qty ?? entry.count ?? entry.qnt ?? entry.q ?? null;
    if (!name && qty === null && price === null) continue;
    rows.push({ name: String(name || 'আইটেম'), price, qty });
  }
  return rows.length ? rows : null;
}

function itemMeta(item) {
  const parts = [];
  if (item.price !== null && item.price !== undefined && item.price !== '') parts.push(money(item.price));
  if (item.qty !== null && item.qty !== undefined && item.qty !== '') parts.push(`×${item.qty}`);
  return parts.join('  ');
}

function eventMs(row) {
  const raw = row.event_at || row.created_at;
  const t = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(t) ? t : NaN;
}

function clockOf(row) {
  const t = eventMs(row);
  if (!Number.isFinite(t)) return '--:--';
  try { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (_) { return '--:--'; }
}

function fullTimeOf(row) {
  const t = eventMs(row);
  if (!Number.isFinite(t)) return '';
  try { return new Date(t).toLocaleString(); } catch (_) { return ''; }
}

function dayOf(row) {
  const t = eventMs(row);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function prettyDay(day) {
  if (!day) return '';
  try {
    return new Date(`${day}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (_) { return day; }
}

/** Change blocks: `{ kind:'text', text, changed }` / `{ kind:'items', rows, before }`. */
function describe(row) {
  const action = String(row.action || '').toUpperCase();
  const changes = asObject(row.changes) || {};
  const snapshot = asObject(row.snapshot) || {};
  const lines = [];
  let itemsBlock = null;

  const pushText = (field, text, changed = false) => {
    if (text && String(text).trim() && lines.length < 8) lines.push({ kind: 'text', field, text, changed });
  };

  for (const field of Object.keys(changes)) {
    if (HIDDEN_FIELDS.has(field)) continue;
    const entry = changes[field] || {};

    if (ITEM_FIELDS.has(field) || looksLikeJson(entry.from) || looksLikeJson(entry.to)) {
      const beforeRows = parseItems(entry.from);
      const afterRows = parseItems(entry.to);
      const primary = afterRows || beforeRows;
      if (primary) {
        itemsBlock = {
          kind: 'items',
          rows: primary,
          before: beforeRows && afterRows && JSON.stringify(beforeRows) !== JSON.stringify(afterRows) ? beforeRows : null
        };
        continue;
      }
    }

    if (action === 'UPDATE') {
      pushText(field, `${fieldWord(field)}  ${fieldValue(field, entry.from)}  →  ${fieldValue(field, entry.to)}`, true);
    } else if (action === 'DELETE') {
      pushText(field, `${fieldWord(field)}: ${fieldValue(field, entry.from)}`);
    } else {
      pushText(field, `${fieldWord(field)}: ${fieldValue(field, entry.to)}`);
    }
  }

  if (lines.length === 0 && !itemsBlock) {
    for (const field of Object.keys(snapshot)) {
      if (HIDDEN_FIELDS.has(field)) continue;
      const value = snapshot[field];
      if (ITEM_FIELDS.has(field) || looksLikeJson(value)) {
        const rows = parseItems(value);
        if (rows) { itemsBlock = { kind: 'items', rows, before: null }; continue; }
      }
      pushText(field, `${fieldWord(field)}: ${fieldValue(field, value)}`);
    }
  }

  return itemsBlock ? [itemsBlock, ...lines] : lines;
}

/** Target line: "মেনু আইটেম · নাম: চা". */
function targetLine(row) {
  const identity = identityOf(row);
  return `${tableWord(row.table_name)}${identity ? `  ·  ${identity}` : ''}`;
}

function identityOf(row) {
  const changes = asObject(row.changes) || {};
  const snapshot = asObject(row.snapshot) || {};
  for (const field of IDENTIFY_FIELDS) {
    if (changes[field]) {
      const entry = changes[field];
      const value = entry.from !== null && entry.from !== undefined ? entry.from : entry.to;
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        return `${fieldWord(field)}: ${humanValue(value)}`;
      }
    }
    const snap = snapshot[field];
    if (snap !== undefined && snap !== null && String(snap).trim() !== '') {
      return `${fieldWord(field)}: ${humanValue(snap)}`;
    }
  }
  return '';
}

function deviceName(row) {
  return row.device_name || row.device_model || 'POS Terminal';
}

function deviceSub(row) {
  const model = row.device_model || '';
  const platform = row.device_platform || 'Android';
  return model ? `${model} • ${platform}` : platform;
}

// ─── Motion ─────────────────────────────────────────────────────────────────
function Reveal({ index, children }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let cancelled = false;
    const run = (reduce) => {
      if (reduce || index >= 20) { anim.setValue(1); return; }
      Animated.timing(anim, {
        toValue: 1,
        duration: 240,
        delay: Math.min(index, 10) * 24,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }).start();
    };
    try {
      AccessibilityInfo.isReduceMotionEnabled().then((r) => { if (!cancelled) run(r); }).catch(() => run(false));
    } catch (_) { run(false); }
    return () => { cancelled = true; };
  }, [anim, index]);
  return (
    <Animated.View style={{ opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}

export default function ActivityStreamScreen({ onBack }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [live, setLive] = useState(true);
  const [filterDay, setFilterDay] = useState('');
  const [dateAll, setDateAll] = useState(true);
  const [filterRange, setFilterRange] = useState('ALL');
  const [filterDevice, setFilterDevice] = useState('ALL');
  const [filterAction, setFilterAction] = useState('ALL');
  const [expanded, setExpanded] = useState({});
  const [showAll, setShowAll] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [timeFrom, setTimeFrom] = useState(null);
  const [outbox, setOutbox] = useState({ total: 0, pending: 0, lastError: null });
  const unsubRef = useRef(null);

  const configured = isAuditConfigured();
  const hasSecret = !!getAuditReadSecret();
  const liveOn = live && configured && hasSecret;

  const today = dayString(new Date());
  const yesterday = dayString(new Date(Date.now() - 86400000));

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      setOutbox(getAuditOutboxStats());
      const res = await auditRead({ limit: PAGE_SIZE });
      if (res && res.ok) {
        setEvents(res.rows || []);
        setError(null);
      } else {
        setError((res && res.error) || 'তথ্য আনতে পারছি না');
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!liveOn) return undefined;
    unsubRef.current = subscribeAudit((payload) => {
      if (!payload) return;
      setEvents((prev) => {
        const id = payload.event_id;
        if (id && prev.some((r) => r.event_id === id)) return prev;
        return [payload, ...prev].slice(0, 1500);
      });
    });
    return () => {
      try { if (unsubRef.current) unsubRef.current(); } catch (_) {}
      unsubRef.current = null;
    };
  }, [liveOn]);

  useEffect(() => {
    if (!liveOn) return undefined;
    const timer = setInterval(() => load({ silent: true }), POLL_MS);
    return () => clearInterval(timer);
  }, [liveOn, load]);

  // date filter → time filter → device/action filters
  const dayFiltered = useMemo(() => {
    if (dateAll || !filterDay) return events;
    return events.filter((e) => dayOf(e) === filterDay);
  }, [events, dateAll, filterDay]);

  const timeFiltered = useMemo(() => {
    // A hand-picked time wins: show everything FROM that moment onward, on the
    // selected date (or today when "সব তারিখ" is active).
    if (timeFrom) {
      const base = (!dateAll && filterDay) ? filterDay : today;
      const [y, mo, da] = base.split('-').map(Number);
      const fromMs = new Date(y, (mo || 1) - 1, da || 1, timeFrom.hour, timeFrom.minute, 0, 0).getTime();
      return dayFiltered.filter((e) => {
        const t = eventMs(e);
        return !Number.isFinite(t) || t >= fromMs;
      });
    }
    const range = TIME_RANGES.find((r) => r.key === filterRange);
    if (!range || !range.hours) return dayFiltered;
    const from = Date.now() - range.hours * 3600000;
    return dayFiltered.filter((e) => {
      const t = eventMs(e);
      return !Number.isFinite(t) || t >= from;
    });
  }, [dayFiltered, filterRange, timeFrom, dateAll, filterDay, today]);

  const byDevice = useMemo(() => {
    const map = {};
    for (const e of timeFiltered) {
      const id = e.device_id || 'unknown';
      if (!map[id]) map[id] = { id, label: deviceName(e), count: 0 };
      map[id].count += 1;
    }
    return map;
  }, [timeFiltered]);

  const deviceOptions = useMemo(() => Object.keys(byDevice).sort(), [byDevice]);

  // Days that actually have records, newest first — so a date can be picked in one tap.
  const availableDays = useMemo(() => {
    const set = new Set();
    for (const e of events) {
      const d = dayOf(e);
      if (d) set.add(d);
    }
    return Array.from(set).sort().reverse().slice(0, 12);
  }, [events]);

  const filtered = useMemo(() => timeFiltered.filter((e) => {
    if (filterDevice !== 'ALL' && (e.device_id || 'unknown') !== filterDevice) return false;
    if (filterAction !== 'ALL' && String(e.action || '').toUpperCase() !== filterAction) return false;
    return true;
  }), [timeFiltered, filterDevice, filterAction]);

  const metrics = useMemo(() => {
    let ins = 0, upd = 0, del = 0;
    for (const e of filtered) {
      const a = String(e.action || '').toUpperCase();
      if (a === 'INSERT') ins += 1;
      else if (a === 'DELETE') del += 1;
      else upd += 1;
    }
    return { total: filtered.length, ins, upd, del, devices: Object.keys(byDevice).length };
  }, [filtered, byDevice]);

  const visibleRows = useMemo(() => (showAll ? filtered : filtered.slice(0, ROW_LIMIT)), [filtered, showAll]);

  const pickDay = (day) => {
    const same = !dateAll && filterDay === day;
    setDateAll(same);
    setFilterDay(same ? '' : day);
  };

  const toggleRow = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const chip = (label, active, onPress, key) => (
    <TouchableOpacity
      key={key}
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  const renderCard = (item, index) => {
    const theme = actionTheme(item.action);
    const id = item.event_id || `${item.table_name}-${index}`;
    const isOpen = !!expanded[id];

    return (
      <Reveal key={id} index={index}>
        <View style={styles.timelineCard}>
          <TouchableOpacity
            onPress={() => toggleRow(id)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ expanded: isOpen }}
            accessibilityLabel={`${item.user_name || 'অজানা'} ${theme.label} ${tableWord(item.table_name)}`}
          >
            <View style={styles.cardHeader}>
              <View style={styles.whoRow}>
                <Text style={styles.whoIcon}>👤</Text>
                <Text style={styles.whoName} numberOfLines={1}>{whoName(item)}</Text>
              </View>
              <View style={styles.timeBadge}>
                <Text style={styles.timeBadgeEmoji}>🕒</Text>
                <Text style={styles.timestampText}>{clockOf(item)}</Text>
                <Text style={styles.chevron}>{isOpen ? ' ▴' : ' ▾'}</Text>
              </View>
            </View>

            <View style={styles.badgeRow}>
              <View style={[styles.catBadge, { backgroundColor: theme.bg, borderColor: theme.border }]}>
                <Text style={styles.catBadgeEmoji}>{theme.emoji}</Text>
                <Text style={[styles.catBadgeText, { color: theme.text }]}>{theme.label}</Text>
              </View>
            </View>

            <Text style={styles.cardDesc} numberOfLines={isOpen ? undefined : 1}>
              {targetLine(item)}
            </Text>

            {isOpen ? (
              <View style={styles.detailBody}>
                <View style={styles.metaBadgesContainer}>
                  <View style={styles.metaBadgeChipPlain}>
                    <Text style={styles.metaBadgeChipText}>{fullTimeOf(item)}</Text>
                  </View>
                  {item.app_profile ? (
                    <View style={styles.metaBadgeChipPlain}>
                      <Text style={styles.metaBadgeChipText}>{appWord(item.app_profile)}</Text>
                    </View>
                  ) : null}
                </View>

                {describe(item).map((block, i) => {
                  if (block.kind === 'items') {
                    return (
                      <View key={i} style={styles.itemsBox}>
                        <Text style={styles.itemsTitle}>🧾 আইটেম তালিকা</Text>
                        {block.before ? (
                          <View>
                            <Text style={styles.itemsSub}>আগে ছিল</Text>
                            {block.before.slice(0, 8).map((it, j) => (
                              <View key={`b${j}`} style={styles.itemLine}>
                                <Text style={styles.itemNameOld} numberOfLines={1}>{it.name}</Text>
                                <Text style={styles.itemMetaOld}>{itemMeta(it)}</Text>
                              </View>
                            ))}
                            <Text style={styles.itemsSub}>এখন</Text>
                          </View>
                        ) : null}
                        {block.rows.slice(0, 12).map((it, j) => (
                          <View key={j} style={styles.itemLine}>
                            <Text style={styles.itemName} numberOfLines={1}>{it.name}</Text>
                            <Text style={styles.itemMeta}>{itemMeta(it)}</Text>
                          </View>
                        ))}
                      </View>
                    );
                  }
                  return (
                    <Text key={i} style={[styles.detailChange, block.changed && styles.detailChangeHot]} numberOfLines={2}>
                      {block.text}
                    </Text>
                  );
                })}
              </View>
            ) : null}
          </TouchableOpacity>

          <View style={styles.cardFooter}>
            <View style={styles.deviceInfoPill}>
              <Text style={styles.deviceInfoEmoji}>📱</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.deviceNameText} numberOfLines={1}>{deviceName(item)}</Text>
                <Text style={styles.deviceSubText} numberOfLines={1}>{deviceSub(item)}</Text>
              </View>
            </View>
          </View>
        </View>
      </Reveal>
    );
  };

  const dateLabel = dateAll || !filterDay ? 'সব তারিখ' : `${prettyDay(filterDay)} (${filterDay})`;

  return (
    <SafeAreaView style={styles.container}>
      <RNStatusBar barStyle="light-content" />

      <CalendarPicker
        visible={calendarOpen}
        value={filterDay || today}
        onSelect={(day) => { setFilterDay(day); setDateAll(false); setCalendarOpen(false); }}
        onClose={() => setCalendarOpen(false)}
      />

      <TimePicker
        visible={timePickerOpen}
        value={timeFrom}
        onSelect={(t) => { setTimeFrom(t); setFilterRange('ALL'); setTimePickerOpen(false); }}
        onClose={() => setTimePickerOpen(false)}
      />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="ফিরে যান">
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>লাইভ কে কী করল</Text>
          <Text style={styles.headerSubtitle}>ডিভাইস, রোল ও অ্যাকশন ট্র্যাকার</Text>
        </View>
        <TouchableOpacity style={styles.syncCloudBtn} onPress={() => load()} disabled={loading} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="রিফ্রেশ">
          {loading ? <ActivityIndicator size="small" color="#FFB703" /> : <Text style={styles.syncCloudBtnText}>🔄 রিফ্রেশ</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => load()} tintColor="#FFB703" />}
      >
        {/* Date selector */}
        <View style={styles.dateSelectorCard}>
          <View style={styles.dateInfoLeft}>
            <Text style={styles.dateLabel}>তারিখ:</Text>
            <Text style={styles.dateValue}>{dateLabel}</Text>
            {timeFrom ? (
              <Text style={styles.dateSub}>সময়: {formatTime12(timeFrom.hour, timeFrom.minute)} এর পর থেকে</Text>
            ) : null}
          </View>
          <TouchableOpacity style={styles.pickDateBtn} onPress={() => setCalendarOpen(true)} activeOpacity={0.7}>
            <Text style={styles.pickDateBtnText}>📅 তারিখ বদলান</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.filterSection}>
          <Text style={styles.filterSectionTitle}>তারিখ বাছুন:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {chip('সব তারিখ', dateAll, () => { setDateAll(true); setFilterDay(''); }, 'day-all')}
            {chip('আজ', !dateAll && filterDay === today, () => pickDay(today), 'day-today')}
            {chip('গতকাল', !dateAll && filterDay === yesterday, () => pickDay(yesterday), 'day-yest')}
            {availableDays.map((d) => chip(shortDay(d), !dateAll && filterDay === d, () => pickDay(d), `day-${d}`))}
          </ScrollView>
        </View>

        {/* Metrics strip */}
        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricNumber}>{metrics.total}</Text>
            <Text style={styles.metricLabel}>মোট রেকর্ড</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={[styles.metricNumber, { color: '#34D399' }]}>{metrics.ins}</Text>
            <Text style={styles.metricLabel}>➕ যোগ</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={[styles.metricNumber, { color: '#FFB703' }]}>{metrics.upd}</Text>
            <Text style={styles.metricLabel}>✏️ পরিবর্তন</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={[styles.metricNumber, { color: '#EF4444' }]}>{metrics.del}</Text>
            <Text style={styles.metricLabel}>🗑️ মুছে ফেলা</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={[styles.metricNumber, { color: '#60A5FA' }]}>{metrics.devices}</Text>
            <Text style={styles.metricLabel}>📱 ডিভাইস</Text>
          </View>
        </View>

        {/* Action category chips */}
        <View style={styles.filterSection}>
          <Text style={styles.filterSectionTitle}>অ্যাকশন ক্যাটাগরি:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {chip('📋 সব', filterAction === 'ALL', () => setFilterAction('ALL'), 'act-all')}
            {['INSERT', 'UPDATE', 'DELETE'].map((a) => {
              const t = actionTheme(a);
              return chip(`${t.emoji} ${t.label}`, filterAction === a, () => setFilterAction(a), `act-${a}`);
            })}
          </ScrollView>
        </View>

        {/* Time range chips + a custom time selector beside them */}
        <View style={styles.filterSection}>
          <Text style={styles.filterSectionTitle}>সময়:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {TIME_RANGES.map((r) =>
              chip(r.label, !timeFrom && filterRange === r.key, () => { setTimeFrom(null); setFilterRange(r.key); }, `time-${r.key}`)
            )}
            {timeFrom
              ? chip(`🕒 ${formatTime12(timeFrom.hour, timeFrom.minute)} এর পর  ✕`, true, () => setTimeFrom(null), 'time-custom')
              : chip('🕒 সময় বাছুন', false, () => setTimePickerOpen(true), 'time-pick')}
          </ScrollView>
        </View>

        {/* Device chips */}
        {deviceOptions.length > 1 ? (
          <View style={styles.filterSection}>
            <Text style={styles.filterSectionTitle}>ডিভাইস ফিল্টার:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {chip(`সকল ডিভাইস (${deviceOptions.length})`, filterDevice === 'ALL', () => setFilterDevice('ALL'), 'dev-all')}
              {deviceOptions.map((d) => chip(`📱 ${byDevice[d].label}`, filterDevice === d, () => setFilterDevice(d), `dev-${d}`))}
            </ScrollView>
          </View>
        ) : null}

        {/* Live status */}
        <View style={styles.statusStrip}>
          <View style={styles.statusLeft}>
            <View style={[styles.dot, liveOn ? styles.dotOn : styles.dotOff]} />
            <Text style={styles.statusText}>{liveOn ? 'লাইভ চলছে' : 'লাইভ বন্ধ'}</Text>
            {outbox.pending > 0 ? <Text style={styles.statusSep}>· {outbox.pending} টি পাঠানো বাকি</Text> : null}
          </View>
          <TouchableOpacity style={styles.liveBtn} onPress={() => setLive((v) => !v)} activeOpacity={0.7} accessibilityRole="button">
            <Text style={styles.liveBtnText}>{live ? 'থামান' : 'চালু করুন'}</Text>
          </TouchableOpacity>
        </View>

        {outbox.pending > 0 ? <Text style={styles.hintText}>ইন্টারনেট পেলে এগুলো নিজে থেকেই চলে যাবে, কিছু হারাবে না।</Text> : null}
        {!isAuditSyncEnabled() ? <Text style={styles.hintText}>অ্যাক্টিভিটি রাখা বন্ধ করা আছে।</Text> : null}

        {/* List */}
        <View style={styles.listContainer}>
          <View style={styles.listHeaderRow}>
            <Text style={styles.listHeaderTitle}>লাইভ অডিট রেকর্ড ({filtered.length} টি)</Text>
            {loading ? <ActivityIndicator size="small" color="#FFB703" /> : null}
          </View>

          {error ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>⚠️</Text>
              <Text style={styles.emptyTitle}>তথ্য আনতে পারছি না</Text>
              <Text style={styles.emptySub}>{error}</Text>
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📜</Text>
              <Text style={styles.emptyTitle}>
                {!configured ? 'সেটআপ বাকি' : !hasSecret ? 'শুধু অ্যাডমিন দেখতে পারবেন' : 'কোনো অ্যাক্টিভিটি পাওয়া যায়নি'}
              </Text>
              <Text style={styles.emptySub}>
                {!configured
                  ? 'অ্যাক্টিভিটি সার্ভার এখনো ঠিক করা হয়নি।'
                  : !hasSecret
                    ? 'এই পাতা শুধু অ্যাডমিন অ্যাপে চলে।'
                    : dateAll
                      ? 'কেউ কিছু যোগ, পরিবর্তন বা মুছে ফেললে এখানে সাথে সাথে দেখা যাবে।'
                      : 'এই তারিখ/ফিল্টারে কিছু নেই। অন্য তারিখ বা “সব তারিখ” বেছে নিন।'}
              </Text>
              <TouchableOpacity style={styles.emptyRefreshBtn} onPress={() => load()} activeOpacity={0.8}>
                <Text style={styles.emptyRefreshBtnText}>🔄 আবার চেক করুন</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {visibleRows.map((item, index) => renderCard(item, Math.min(index, 20)))}
              {!showAll && filtered.length > ROW_LIMIT ? (
                <TouchableOpacity style={styles.moreBtn} onPress={() => setShowAll(true)} activeOpacity={0.7} accessibilityRole="button">
                  <Text style={styles.moreBtnText}>আরও দেখান ({filtered.length - ROW_LIMIT})</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={styles.footerNote}>কার্ডে চাপ দিলে কী বদলেছে তা খুলে দেখাবে</Text>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#1F1F1F',
    backgroundColor: '#0A0A0A'
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    justifyContent: 'center',
    alignItems: 'center'
  },
  backBtnText: { color: '#FFF', fontSize: 20, fontWeight: 'bold' },
  headerTitleContainer: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
  headerSubtitle: { color: '#888', fontSize: 11, marginTop: 1 },
  syncCloudBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 183, 3, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 183, 3, 0.35)',
    borderRadius: 8
  },
  syncCloudBtnText: { color: '#FFB703', fontSize: 11, fontWeight: '600' },

  // Date selector
  dateSelectorCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#111111',
    marginHorizontal: 16,
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#222'
  },
  dateInfoLeft: { flex: 1 },
  dateLabel: { color: '#888', fontSize: 11 },
  dateValue: { color: '#FFF', fontSize: 13, fontWeight: '700', marginTop: 2 },
  dateSub: { color: '#FFB703', fontSize: 11, fontWeight: '600', marginTop: 3 },
  pickDateBtn: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#1C1C1C', borderRadius: 8, borderWidth: 1, borderColor: '#333' },
  pickDateBtnText: { color: '#34D399', fontSize: 11, fontWeight: '600' },

  // Metrics
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 14,
    gap: 8
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#0F0F0F',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: '#1C1C1C',
    alignItems: 'center'
  },
  metricNumber: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  metricLabel: { color: '#777', fontSize: 9, marginTop: 3, textAlign: 'center' },

  // Filters
  filterSection: { marginHorizontal: 16, marginBottom: 10 },
  filterSectionTitle: { color: '#888', fontSize: 11, marginBottom: 6, fontWeight: '600' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#242424',
    marginRight: 8
  },
  chipActive: { backgroundColor: 'rgba(255, 183, 3, 0.15)', borderColor: 'rgba(255, 183, 3, 0.6)' },
  chipText: { color: '#888', fontSize: 11, fontWeight: '500' },
  chipTextActive: { color: '#FFB703', fontWeight: '700' },

  // Live status
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1C1C1C',
    backgroundColor: '#0F0F0F'
  },
  statusLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  dotOn: { backgroundColor: '#34D399' },
  dotOff: { backgroundColor: '#666' },
  statusText: { color: '#CCC', fontSize: 11, fontWeight: '600' },
  statusSep: { color: '#777', fontSize: 11, marginLeft: 6 },
  liveBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: '#333', backgroundColor: '#1A1A1A' },
  liveBtnText: { color: '#FFB703', fontSize: 11, fontWeight: '700' },
  hintText: { color: '#777', fontSize: 11, marginHorizontal: 16, marginBottom: 8, lineHeight: 16 },

  // List
  listContainer: { marginHorizontal: 16, marginTop: 8 },
  listHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  listHeaderTitle: { color: '#CCC', fontSize: 13, fontWeight: '700' },
  footerNote: { color: '#666', fontSize: 10.5, textAlign: 'center', marginTop: 12 },

  emptyState: {
    backgroundColor: '#0F0F0F',
    borderRadius: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: '#1C1C1C',
    alignItems: 'center',
    marginTop: 10
  },
  emptyEmoji: { fontSize: 36, marginBottom: 8 },
  emptyTitle: { color: '#FFF', fontSize: 14, fontWeight: '700', marginBottom: 4, textAlign: 'center' },
  emptySub: { color: '#777', fontSize: 11, textAlign: 'center', lineHeight: 16, marginBottom: 14 },
  emptyRefreshBtn: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#1A1A1A', borderRadius: 8, borderWidth: 1, borderColor: '#333' },
  emptyRefreshBtnText: { color: '#FFB703', fontSize: 12, fontWeight: '600' },

  // Timeline card
  timelineCard: {
    backgroundColor: '#0D0D0D',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1C1C1C',
    marginBottom: 10
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  whoRow: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, marginRight: 8 },
  whoIcon: { fontSize: 12, marginRight: 5 },
  whoName: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '800', flex: 1, letterSpacing: 0.2 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  catBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 0.8
  },
  catBadgeEmoji: { fontSize: 12, marginRight: 4 },
  catBadgeText: { fontSize: 11, fontWeight: '700' },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161616',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 0.8,
    borderColor: '#2A2A2A'
  },
  timeBadgeEmoji: { fontSize: 10, marginRight: 4 },
  timestampText: {
    color: '#FFB703',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace'
  },
  chevron: { color: '#888', fontSize: 11, fontWeight: '700' },
  cardDesc: { color: '#E5E5E5', fontSize: 12.5, lineHeight: 17, marginBottom: 6 },

  detailBody: { marginTop: 2 },
  metaBadgesContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8, marginTop: 2 },
  metaBadgeChipPlain: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 0.8, borderColor: '#2A2A2A', backgroundColor: '#161616' },
  metaBadgeChipText: { color: '#AAA', fontSize: 11, fontWeight: '600' },
  detailChange: { color: '#AAA', fontSize: 12, marginBottom: 4, lineHeight: 17 },
  detailChangeHot: { color: '#FFB703', fontWeight: '600' },

  itemsBox: {
    marginTop: 6,
    marginBottom: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2A22',
    backgroundColor: '#0B120F',
    paddingVertical: 6,
    paddingHorizontal: 10
  },
  itemsTitle: { color: '#9AE6B4', fontSize: 11.5, fontWeight: '700', marginBottom: 4 },
  itemsSub: { color: '#7A8A82', fontSize: 10, fontWeight: '700', marginTop: 6, marginBottom: 2 },
  itemLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  itemName: { color: '#EAF7EF', fontSize: 12.5, flex: 1, fontWeight: '600' },
  itemMeta: { color: '#34D399', fontSize: 12, fontWeight: '700', marginLeft: 10 },
  itemNameOld: { color: '#8A8A8A', fontSize: 12, flex: 1, textDecorationLine: 'line-through' },
  itemMetaOld: { color: '#8A8A8A', fontSize: 11, marginLeft: 10 },

  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 0.8,
    borderColor: '#191919',
    gap: 8
  },
  deviceInfoPill: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 },
  deviceInfoEmoji: { fontSize: 13, marginRight: 6 },
  deviceNameText: { color: '#CCC', fontSize: 11, fontWeight: '600' },
  deviceSubText: { color: '#666', fontSize: 9.5 },

  moreBtn: {
    marginTop: 4,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#242424',
    backgroundColor: '#121212',
    alignItems: 'center'
  },
  moreBtnText: { color: '#FFB703', fontSize: 12, fontWeight: '700' }
});
