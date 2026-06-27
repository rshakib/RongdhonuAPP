import React, { useState, useMemo } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ── Field classification sets ──

const AMOUNT_FIELDS = new Set([
  'grand_total', 'total_amount', 'amount', 'paid_amount', 'due_amount',
  'discount', 'discount_amount', 'delivery_charge', 'change_money_given',
  'cash_amount', 'bkash_amount', 'nagad_amount', 'rocket_amount',
  'given_amount', 'used_amount', 'returned_amount', 'price', 'itemPrice',
  'totalDiscount', 'total_delivery_charge', 'ejaAmount', 'eja_amount',
  'purchase_amount', 'payment_amount', 'variety_store_amount',
  'morgir_dokan_amount', 'burger_ban_amount',
]);

const PAYMENT_FIELDS = new Set([
  'payment_status', 'payment_method', 'order_type',
  'table_id', 'customer_name', 'customer_phone',
]);

const DATE_FIELDS = new Set([
  'created_at', 'updated_at', 'locked_at', 'deleted_at',
  'date', 'business_date', 'order_date', 'payment_date',
  'submit_date', 'submitted_at',
]);

const IDENTITY_FIELDS = new Set([
  'id', 'order_id', 'item_id', 'payment_id',
]);

// ── Helpers ──

function isISODatetime(val) {
  if (typeof val !== 'string') return false;
  // Match ISO 8601 patterns: 2026-06-03T16:02:00.000Z or 2026-06-03 16:02:00
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(val.trim());
}

function formatDatetime(val) {
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mon = months[d.getMonth()];
    const year = d.getFullYear();
    let hours = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${day} ${mon} ${year}\n${hours}:${mins} ${ampm}`;
  } catch (e) {
    return String(val);
  }
}

function formatAmount(val) {
  const num = Number(val);
  if (isNaN(num)) return String(val);
  return `৳${num.toLocaleString()}`;
}

function formatRawValue(val) {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.stringify(JSON.parse(val), null, 2);
      } catch (e) {}
    }
  }
  if (typeof val === 'object') return JSON.stringify(val, null, 2);
  return String(val);
}

function prettyKey(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Grouping logic ──

function groupFields(rowData) {
  const amounts = [];
  const payment = [];
  const dates = [];
  const identity = [];
  const other = [];

  for (const [key, value] of Object.entries(rowData)) {
    if (IDENTITY_FIELDS.has(key)) {
      identity.push([key, value]);
    } else if (AMOUNT_FIELDS.has(key)) {
      amounts.push([key, value]);
    } else if (PAYMENT_FIELDS.has(key)) {
      payment.push([key, value]);
    } else if (DATE_FIELDS.has(key) || isISODatetime(String(value ?? ''))) {
      dates.push([key, value]);
    } else {
      other.push([key, value]);
    }
  }

  return { identity, amounts, payment, dates, other };
}

// ── Components ──

function FieldRow({ label, value, valueStyle }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, valueStyle]}>{value}</Text>
    </View>
  );
}

function SectionCard({ icon, title, children }) {
  if (!children || (Array.isArray(children) && children.length === 0)) return null;
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionCardTitle}>{icon} {title}</Text>
      <View style={styles.sectionCardBody}>
        {children}
      </View>
    </View>
  );
}

// ── Main Screen ──

export default function RowDetailScreen({ rowData, onBack }) {
  const [rawExpanded, setRawExpanded] = useState(false);

  const groups = useMemo(() => groupFields(rowData), [rowData]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>❮ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Row Details</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Identity ── */}
        {groups.identity.length > 0 && (
          <SectionCard icon="🆔" title="Identifiers">
            {groups.identity.map(([key, val]) => (
              <FieldRow key={key} label={prettyKey(key)} value={String(val ?? '—')} valueStyle={styles.monoValue} />
            ))}
          </SectionCard>
        )}

        {/* ── Amounts ── */}
        {groups.amounts.length > 0 && (
          <SectionCard icon="💰" title="Amounts">
            {groups.amounts.map(([key, val]) => (
              <FieldRow key={key} label={prettyKey(key)} value={formatAmount(val)} valueStyle={styles.amountValue} />
            ))}
          </SectionCard>
        )}

        {/* ── Payment ── */}
        {groups.payment.length > 0 && (
          <SectionCard icon="💳" title="Payment & Order Info">
            {groups.payment.map(([key, val]) => (
              <FieldRow key={key} label={prettyKey(key)} value={String(val ?? '—')} />
            ))}
          </SectionCard>
        )}

        {/* ── Date & Time ── */}
        {groups.dates.length > 0 && (
          <SectionCard icon="📅" title="Date & Time">
            {groups.dates.map(([key, val]) => {
              const raw = String(val ?? '');
              const display = isISODatetime(raw) ? formatDatetime(raw) : (raw || '—');
              return <FieldRow key={key} label={prettyKey(key)} value={display} valueStyle={styles.dateValue} />;
            })}
          </SectionCard>
        )}

        {/* ── Other readable fields ── */}
        {groups.other.length > 0 && (
          <SectionCard icon="📋" title="Other Fields">
            {groups.other.map(([key, val]) => {
              const formatted = formatRawValue(val);
              const isNested = formatted.includes('\n');
              return (
                <View key={key} style={styles.otherFieldBlock}>
                  <Text style={styles.fieldLabel}>{prettyKey(key)}</Text>
                  <View style={[styles.otherValueBox, isNested && styles.nestedBox]}>
                    <Text style={[styles.fieldValue, isNested && styles.nestedText]}>{formatted}</Text>
                  </View>
                </View>
              );
            })}
          </SectionCard>
        )}

        {/* ── Raw Technical Data (Collapsible) ── */}
        <TouchableOpacity
          style={styles.rawToggle}
          onPress={() => setRawExpanded(!rawExpanded)}
          activeOpacity={0.7}
        >
          <Text style={styles.rawToggleText}>
            {rawExpanded ? '▼' : '▶'} 🧑‍💻 Raw Technical Data
          </Text>
        </TouchableOpacity>

        {rawExpanded && (
          <View style={styles.rawContainer}>
            {Object.entries(rowData).map(([key, value]) => (
              <View key={key} style={styles.rawRow}>
                <Text style={styles.rawKey}>{key}</Text>
                <Text style={styles.rawVal} selectable>{formatRawValue(value)}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderColor: '#1A1A1A',
  },
  backBtn: { padding: 4 },
  backBtnText: { color: '#FFB703', fontWeight: 'bold' },
  headerTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  content: { padding: 16 },

  // Section cards
  sectionCard: {
    backgroundColor: '#111', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#222', marginBottom: 14,
  },
  sectionCardTitle: {
    color: '#FFB703', fontSize: 13, fontWeight: 'bold',
    marginBottom: 12, textTransform: 'uppercase',
  },
  sectionCardBody: {},

  // Field rows
  fieldRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: 8, borderBottomWidth: 0.5, borderColor: '#1A1A1A',
  },
  fieldLabel: { color: '#888', fontSize: 12, flex: 1, marginRight: 12 },
  fieldValue: {
    color: '#FFF', fontSize: 13, flex: 1.5, textAlign: 'right',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  monoValue: { color: '#60A5FA', fontSize: 11 },
  amountValue: { color: '#34D399', fontWeight: 'bold', fontSize: 14 },
  dateValue: { color: '#A78BFA', fontSize: 12, lineHeight: 18 },

  // Other fields
  otherFieldBlock: { paddingVertical: 8, borderBottomWidth: 0.5, borderColor: '#1A1A1A' },
  otherValueBox: {
    backgroundColor: '#0A0A0A', borderRadius: 6, padding: 8,
    marginTop: 4, borderWidth: 1, borderColor: '#1A1A1A',
  },
  nestedBox: { borderColor: '#333' },
  nestedText: { color: '#34D399', fontSize: 11, lineHeight: 16 },

  // Raw collapsible
  rawToggle: {
    backgroundColor: '#0A0A0A', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#222', marginTop: 8,
  },
  rawToggleText: { color: '#888', fontSize: 13, fontWeight: 'bold' },
  rawContainer: {
    backgroundColor: '#0A0A0A', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#222', marginTop: 4,
  },
  rawRow: {
    paddingVertical: 6, borderBottomWidth: 0.5, borderColor: '#1A1A1A',
  },
  rawKey: { color: '#FFB703', fontSize: 10, fontWeight: 'bold', marginBottom: 2 },
  rawVal: {
    color: '#666', fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});
