import React, { useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Dimensions,
} from 'react-native';
import {
  ClipboardList,
  X,
  Clock,
  Calendar,
  Wallet,
  Coins,
  Banknote,
  Smartphone,
  Rocket,
  Calculator,
  ClipboardPen,
  Printer,
  ChevronLeft,
  Trash2,
  Bike,
  Grid2x2,
} from 'lucide-react-native';

// ─── Helpers (UNCHANGED — do not modify) ──────────────────────────────────────

function getPaymentMethodLabel(method) {
  if (!method) return 'ক্যাশ';
  const m = String(method).toLowerCase();
  if (m.includes('bkash') || m.includes('বিকাশ')) return 'বিকাশ';
  if (m.includes('nagad') || m.includes('নগদ')) return 'নগদ';
  if (m.includes('rocket') || m.includes('রকেট')) return 'রকেট';
  if (m.includes('mixed') || m.includes('মিক্স')) return 'মিক্সড';
  return 'ক্যাশ';
}

function parseItems(items) {
  if (!items) return [];
  if (Array.isArray(items)) {
    return items.map((it, i) => ({
      key: String(i),
      name: it.name || it.item || String(it),
      qty: parseInt(it.qty || it.quantity || 1, 10),
      price: parseFloat(it.price || it.amount || 0),
    }));
  }
  try {
    const parsed = JSON.parse(items);
    if (Array.isArray(parsed)) {
      return parsed.map((it, i) => ({
        key: String(i),
        name: it.name || it.item || String(it),
        qty: parseInt(it.qty || it.quantity || 1, 10),
        price: parseFloat(it.price || it.amount || 0),
      }));
    }
  } catch (_) {}
  return String(items)
    .split(',')
    .filter((s) => s.trim())
    .map((s, i) => ({ key: String(i), name: s.trim(), qty: null, price: null }));
}

const { height: SCREEN_H } = Dimensions.get('window');

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrderDetailModal({
  visible,
  onClose,
  order,
  onPrint,
  onDelete,
  formatDisplayDate,
}) {
  // ── Data derivation (UNCHANGED) ──────────────────────────────────────────
  const items = useMemo(() => parseItems(order?.items), [order?.items]);

  const isDelivery =
    order?.isDelivery ||
    String(order?.table || '').toLowerCase().includes('delivery') ||
    String(order?.table || '').toLowerCase().includes('ডেলিভারি');

  const tableLabel = isDelivery
    ? 'ডেলিভারি'
    : order?.table || order?.tableId || '—';

  const methodLabel = getPaymentMethodLabel(order?.method || order?.paymentMethod);

  const dateText = order?.fullDate
    ? formatDisplayDate
      ? formatDisplayDate(order.fullDate)
      : order.fullDate
    : 'আজ';

  const hasDelivery = Number(order?.deliveryCharge) > 0;
  const orderSubtotal = Number(order?.totalAmount || 0);
  const deliveryCharge = Number(order?.deliveryCharge || 0);
  const grandTotal = hasDelivery
    ? Number(order?.grandTotal || order?.paidAmount || 0)
    : Number(order?.amount || order?.paidAmount || 0);

  const cash   = Number(order?.cash_amount   || 0);
  const bkash  = Number(order?.bkash_amount  || 0);
  const nagad  = Number(order?.nagad_amount  || 0);
  const rocket = Number(order?.rocket_amount || 0);
  // ────────────────────────────────────────────────────────────────────────

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Dark overlay — centered layout so card floats over dashboard */}
      <View style={s.overlay}>
        <View style={s.card}>

          {/* ── HEADER ───────────────────────────────────────── */}
          <View style={s.header}>
            <View style={s.iconBadge}>
              <ClipboardList size={22} color="#FFB703" strokeWidth={2} />
            </View>
            <View style={s.headerTexts}>
              <Text style={s.headerTitle}>অর্ডার বিস্তারিত</Text>
              <Text style={s.headerSub}>এই অর্ডারের সম্পূর্ণ তথ্য</Text>
            </View>
            <TouchableOpacity style={s.closeBtn} onPress={onClose} activeOpacity={0.7}>
              <X size={15} color="#9CA3AF" strokeWidth={2.5} />
            </TouchableOpacity>
          </View>

          {/* ── SCROLLABLE BODY ───────────────────────────────── */}
          {/* flexShrink:1 lets this compress when card hits maxHeight */}
          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {order && (
              <>
                {/* ─ Basic Info flat rows ─ */}
                <View style={s.infoSection}>
                  <FlatRow label="টেবিল:" right={
                    <View style={s.tableBadge}>
                      <Text style={s.tableBadgeText}>{tableLabel}</Text>
                    </View>
                  } />
                  <View style={s.rowDiv} />
                  <FlatRow label="সময়:"           value={order.time || '—'} />
                  <View style={s.rowDiv} />
                  <FlatRow label="তারিখ:"          value={dateText} />
                  <View style={s.rowDiv} />
                  <FlatRow label="পেমেন্ট মাধ্যম:" value={methodLabel} valueColor="#34D399" />
                </View>

                {/* ─ Payment Breakdown ─ */}
                <View style={s.breakdownCard}>
                  <View style={s.breakdownHeader}>
                    <Coins size={13} color="#FFB703" strokeWidth={2} />
                    <Text style={s.breakdownTitle}>পেমেন্ট ব্রেকডাউন:</Text>
                  </View>
                  <PayRow Icon={Banknote}    color="#22C55E" label="ক্যাশ:"   amount={cash}   />
                  <View style={s.rowDiv} />
                  <PayRow Icon={Smartphone}  color="#60A5FA" label="বিকাশ:"  amount={bkash}  />
                  <View style={s.rowDiv} />
                  <PayRow Icon={Coins}       color="#F59E0B" label="নগদ:"    amount={nagad}  />
                  <View style={s.rowDiv} />
                  <PayRow Icon={Rocket}      color="#F87171" label="রকেট:"   amount={rocket} />
                </View>

                {/* ─ Delivery rows (if applicable) ─ */}
                {hasDelivery && (
                  <View style={s.infoSection}>
                    <FlatRow label="অর্ডার টোটাল:"    value={`৳ ${orderSubtotal}`} />
                    <View style={s.rowDiv} />
                    <FlatRow label="ডেলিভারি চার্জ:"  value={`৳ ${deliveryCharge}`} />
                  </View>
                )}

                {/* ─ Total ─ */}
                <View style={s.totalRow}>
                  <View style={s.totalLeft}>
                    <Calculator size={14} color="#34D399" strokeWidth={2} />
                    <Text style={s.totalLabel}>মোট পরিমাণ:</Text>
                  </View>
                  <View style={s.totalBadge}>
                    <Text style={s.totalValue}>৳ {grandTotal}</Text>
                  </View>
                </View>

                {/* ─ Items ─ */}
                {(items.length > 0 || order.items) && (
                  <View style={s.itemsSection}>
                    <View style={s.itemsHeader}>
                      <ClipboardPen size={13} color="#FFB703" strokeWidth={2} />
                      <Text style={s.itemsTitle}>আইটেম সমূহ:</Text>
                    </View>

                    {items.length > 0 ? (
                      items.map((it, idx) => (
                        <View key={it.key} style={s.itemRow}>
                          <Text style={s.itemNum}>{idx + 1}</Text>
                          <Text style={s.itemName} numberOfLines={2}>
                            {it.name}
                            {it.qty != null
                              ? <Text style={s.itemMeta}> x{it.qty}</Text>
                              : null}
                            {it.price != null && it.price > 0
                              ? <Text style={s.itemMeta}> @{it.price}</Text>
                              : null}
                          </Text>
                          {it.qty != null && it.price != null && it.price > 0
                            ? <Text style={s.itemTotal}>৳{Math.round(it.qty * it.price)}</Text>
                            : null}
                        </View>
                      ))
                    ) : (
                      <Text style={s.itemPlain}>{String(order.items)}</Text>
                    )}
                  </View>
                )}
              </>
            )}
          </ScrollView>

          {/* ── FIXED BOTTOM ACTION BAR ──────────────────────── */}
          <View style={s.actionBar}>
            {/* Print */}
            <TouchableOpacity
              style={s.printBtn}
              activeOpacity={0.85}
              onPress={() => onPrint && onPrint(order)}
            >
              <Printer size={16} color="#FFF" strokeWidth={2} />
              <Text style={s.printBtnText}>রসিদ প্রিন্ট করুন</Text>
            </TouchableOpacity>

            {/* Back + Delete */}
            <View style={s.twoRow}>
              <TouchableOpacity style={s.backBtn} activeOpacity={0.8} onPress={onClose}>
                <ChevronLeft size={15} color="#E5E7EB" strokeWidth={2.5} />
                <Text style={s.backBtnText}>পিছনে যান</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.deleteBtn}
                activeOpacity={0.8}
                onPress={() => onDelete && onDelete(order?.id)}
              >
                <Trash2 size={15} color="#FFF" strokeWidth={2} />
                <Text style={s.deleteBtnText}>ডিলিট করুন</Text>
              </TouchableOpacity>
            </View>
          </View>

        </View>
      </View>
    </Modal>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FlatRow({ label, value, valueColor, right }) {
  return (
    <View style={s.flatRow}>
      <Text style={s.flatLabel}>{label}</Text>
      {right
        ? right
        : <Text style={[s.flatValue, valueColor && { color: valueColor }]}>{value}</Text>}
    </View>
  );
}

function PayRow({ Icon, color, label, amount }) {
  const hasValue = Number(amount) > 0;
  return (
    <View style={s.payRow}>
      <View style={s.payLeft}>
        <Icon size={14} color={hasValue ? color : '#374151'} strokeWidth={2} />
        <Text style={[s.payLabel, !hasValue && { color: '#374151' }]}>{label}</Text>
      </View>
      <Text style={[s.payValue, hasValue && { color: '#E5E7EB' }]}>৳ {amount}</Text>
    </View>
  );
}

// ─── Styles (Image 2 reference: gold border, dark bg, flat rows) ──────────────

const s = StyleSheet.create({
  // Centered overlay — card floats over dashboard like Image 2
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 20,
  },

  // Floating card — gold border, all corners rounded, maxHeight caps content
  card: {
    width: '100%',
    backgroundColor: '#0D0D0D',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#FFB703',
    maxHeight: SCREEN_H * 0.88,
    overflow: 'hidden',
  },

  // ── Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  iconBadge: {
    width: 42,
    height: 42,
    borderRadius: 11,
    backgroundColor: '#1C1107',
    borderWidth: 1.5,
    borderColor: '#78350F',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTexts: { flex: 1 },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerSub: {
    fontSize: 10.5,
    color: '#6B7280',
    marginTop: 1,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Scroll — flexShrink:1 is the key: compresses when card hits maxHeight
  scroll: { flexShrink: 1 },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
  },

  // ── Flat info section (like Image 2 — no card wrappers, just rows)
  infoSection: {
    backgroundColor: '#0D0D0D',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E1E1E',
    marginBottom: 8,
    overflow: 'hidden',
  },
  flatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  flatLabel: {
    fontSize: 13,
    color: '#888888',
  },
  flatValue: {
    fontSize: 13,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  rowDiv: {
    height: 1,
    backgroundColor: '#1A1A1A',
    marginHorizontal: 12,
  },

  // Table badge (gold, like Image 2)
  tableBadge: {
    backgroundColor: '#1C1107',
    borderWidth: 1,
    borderColor: '#92400E',
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  tableBadgeText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#FFB703',
  },

  // ── Payment breakdown card
  breakdownCard: {
    backgroundColor: '#111111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#262626',
    marginBottom: 8,
    overflow: 'hidden',
  },
  breakdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  breakdownTitle: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#FFB703',
  },
  payRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  payLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  payLabel: {
    fontSize: 12.5,
    color: '#888888',
  },
  payValue: {
    fontSize: 12.5,
    color: '#374151',
  },

  // ── Total row (flat, like Image 2)
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E1E1E',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  totalLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  totalLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E5E7EB',
  },
  totalBadge: {
    backgroundColor: '#052E16',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#166534',
  },
  totalValue: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#34D399',
  },

  // ── Items section
  itemsSection: {
    backgroundColor: '#111111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#262626',
    overflow: 'hidden',
    marginBottom: 4,
  },
  itemsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  itemsTitle: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#FFB703',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  itemNum: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7280',
    width: 16,
    textAlign: 'center',
  },
  itemName: {
    flex: 1,
    fontSize: 12.5,
    color: '#F3F4F6',
    lineHeight: 17,
  },
  itemMeta: {
    color: '#FFB703',
    fontSize: 12.5,
  },
  itemTotal: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  itemPlain: {
    fontSize: 12.5,
    color: '#FFB703',
    paddingHorizontal: 12,
    paddingVertical: 8,
    lineHeight: 18,
  },

  // ── Action bar
  actionBar: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#1A1A1A',
    backgroundColor: '#0D0D0D',
  },
  printBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: '#3730A3',
    borderWidth: 1,
    borderColor: '#4F46E5',
  },
  printBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFF',
  },
  twoRow: {
    flexDirection: 'row',
    gap: 8,
  },
  backBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
  },
  backBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E5E7EB',
  },
  deleteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#DC2626',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  deleteBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFF',
  },
});
