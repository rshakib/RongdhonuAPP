import React, { forwardRef } from 'react';

import { View, Text, StyleSheet } from 'react-native';
import { normalizeOrderForReceipt, RECEIPT_RASTER_WIDTH, toBengaliNumber, translatePaymentMethod } from '../services/printer';

/**
 * components/ReceiptPaper.js
 *
 * The 58mm receipt rendered as a real React Native view.
 * It is used for TWO things:
 *   1. the on-screen preview, and
 *   2. the source for the printer raster (captured with react-native-view-shot
 *      at RECEIPT_RASTER_WIDTH = 384 dots, so Bengali prints correctly).
 *
 * Field order mirrors formatReceiptText() so preview and print always agree.
 *
 * Typography targets (approved 2026-09-24):
 *   - Container: width 384px (numeric prop) or 100%, paddingHorizontal 4px, no maxWidth cap
 *   - Bengali Bold: NotoSansBengali-Bold font bundled locally in assets/fonts/
 *   - Business name: 22px bold
 *   - Items, totals, payment: sized per spec (see styles below)
 *   - Divider: borderTopWidth 2, dashed
 *
 * THERMAL CLARITY: the captured PNG is converted to a 1-bit raster by the
 * printer, and anti-aliased glyph edges are the first thing that conversion
 * drops — so the receipt comes out thinner on paper than it looks on screen.
 * THERMAL_BOLD adds a hairline, same-colour shadow to every text style, which
 * darkens those edge pixels and makes the printed strokes read as bold.
 * Tune `THERMAL_BOLD.textShadowRadius` up for heavier ink, down for finer.
 */

/** Default shop mobile shown on every receipt. */
export const DEFAULT_SHOP_PHONE = '01953838244';

/** Mobile shown on customer bill. */
export const BILL_SHOP_PHONE = '01953838244';

/**
 * Font family name registered via app.json "fonts" array.
 * Falls back gracefully to system Bengali if the asset is unavailable
 * (e.g. in Expo Go without custom fonts loaded).
 */
const BN_BOLD = 'NotoSansBengali-Bold';

/** Hairline same-colour outline — see "THERMAL CLARITY" above.
 *  Tuned down to a true hairline (0.9 → 0.72 → 0.3): a wide halo blurs into the
 *  printer's 1-bit threshold, which fattens strokes and clogs small Bengali
 *  counters. Keep this minimal — the font is already bold on its own. */
const THERMAL_BOLD = {
  textShadowColor: '#000000',
  textShadowOffset: { width: 0, height: 0 },
  textShadowRadius: 0.3
};

const ReceiptPaper = forwardRef(function ReceiptPaper({
  order,
  width = '100%',
  showPayment = true,
  phone = DEFAULT_SHOP_PHONE
}, ref) {
  const norm = normalizeOrderForReceipt(order);
  if (!norm) return null;

  // Build the inline width style.
  // - Numeric (e.g. 384): use exactly, NO maxWidth override.
  // - '100%': full width of parent (preview mode).
  // - Anything else: treat as 100%.
  const widthStyle = typeof width === 'number'
    ? { width }
    : { width: '100%' };

  return (
    <View
      ref={ref}
      collapsable={false}
      style={[styles.paper, widthStyle]}
    >
      <View style={styles.divider} />

      <Text style={styles.title}>রংধনু ক্যাফে এন্ড রেস্টুরেন্ট</Text>
      <Text style={styles.center}>পুলিশ মোড়, দুর্গাপুর, নেত্রকোনা</Text>
      <Text style={styles.centerBold}>মোবাইল: {phone}</Text>

      <View style={styles.divider} />

      <Text style={styles.row}>
        <Text style={styles.bold}>টেবিল: </Text>{toBengaliNumber(norm.tableName)}
      </Text>
      <View style={styles.splitRow}>
        <Text style={styles.metaText}>তারিখ: {toBengaliNumber(norm.date)}</Text>
        <Text style={styles.metaText}>সময়: {toBengaliNumber(norm.time)}</Text>
      </View>

      <View style={styles.divider} />

      {norm.items.map((item, idx) => (
        <View key={idx} style={[styles.itemBlock, item.isExtra && styles.extraItemBlock]}>
          <Text style={[styles.itemName, item.isExtra && styles.extraItemName]}>
            {item.isExtra ? `↳ ${item.name}` : item.name}
          </Text>
          <View style={styles.splitRow}>
            <Text style={[styles.itemQtyPrice, item.isExtra && styles.extraItemMeta]}>{toBengaliNumber(item.qty)} × {toBengaliNumber(item.price)}</Text>
            <Text style={[styles.itemPrice, item.isExtra && styles.extraItemMeta]}>৳{toBengaliNumber(item.total)}</Text>
          </View>
        </View>
      ))}

      <View style={styles.divider} />

      {norm.serviceCharge > 0 && (
        <View style={styles.splitRow}>
          <Text style={styles.summaryLabel}>সার্ভিস চার্জ:</Text>
          <Text style={styles.summaryPrice}>৳{toBengaliNumber(norm.serviceCharge)}</Text>
        </View>
      )}
      <View style={styles.splitRow}>
        <Text style={styles.summaryLabel}>সর্বমোট:</Text>
        <Text style={styles.summaryPrice}>৳{toBengaliNumber(norm.subtotal)}</Text>
      </View>
      {norm.discount > 0 && (
        <View style={styles.splitRow}>
          <Text style={styles.summaryLabel}>ডিসকাউন্ট:</Text>
          <Text style={styles.summaryPrice}>৳{toBengaliNumber(norm.discount)}</Text>
        </View>
      )}
      {norm.deliveryCharge > 0 && (
        <View style={styles.splitRow}>
          <Text style={styles.summaryLabel}>ডেলিভারি চার্জ:</Text>
          <Text style={styles.summaryPrice}>৳{toBengaliNumber(norm.deliveryCharge)}</Text>
        </View>
      )}
      {/* Customer bill (Table Detail): no paid row — payment hasn't happened yet. */}
      {showPayment && (
        <View style={styles.splitRow}>
          <Text style={styles.totalLabel}>পরিশোধ:</Text>
          <Text style={styles.totalPrice}>৳{toBengaliNumber(norm.finalAmount)}</Text>
        </View>
      )}

      {showPayment && (
        <>
          <View style={styles.divider} />
          <View style={styles.splitRow}>
            <Text style={styles.paymentLabel}>পেমেন্ট:</Text>
            <Text style={styles.paymentValue}>{translatePaymentMethod(norm.paymentMethod)}</Text>
          </View>
          {norm.isSplit && norm.splitBreakdown && norm.splitBreakdown.length > 0 && (
            <View style={styles.splitBreakdownContainer}>
              {norm.splitBreakdown.map((item, idx) => (
                <View key={idx} style={styles.splitSubRow}>
                  <Text style={styles.splitSubLabel}>  {item.label}</Text>
                  <Text style={styles.splitSubAmount}>৳{toBengaliNumber(item.amount)}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
      <View style={styles.divider} />

      <Text style={styles.footer}>ধন্যবাদ, আবার আসবেন!</Text>
      <View style={styles.divider} />

      {/* Blank paper feed after receipt content (8.2 blank line heights of pure white paper) */}
      <View style={styles.bottomFeedSpacer} />
    </View>
  );
});

export default ReceiptPaper;

/** Every text style gets the thermal outline so the 1-bit raster stays bold. */
const T = (style) => ({ ...style, ...THERMAL_BOLD });

const styles = StyleSheet.create({
  paper: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 4,
    paddingVertical: 10,
    alignSelf: 'center',
    // NOTE: no maxWidth, no borderRadius — receipt must fill the full raster width
  },

  divider: {
    borderTopWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#000000',
    marginVertical: 5
  },

  // ── Shop header ──────────────────────────────────────────────
  // Restaurant name: 22 × 1.40 = 31
  title: T({
    color: '#000000',
    fontSize: 31,
    fontWeight: '700',
    fontFamily: BN_BOLD,
    textAlign: 'center',
    lineHeight: 39
  }),
  // Address: 14 × 1.30 = 18
  center: T({
    color: '#000000',
    fontSize: 18,
    fontFamily: BN_BOLD,
    textAlign: 'center',
    lineHeight: 25,
    marginTop: 2
  }),
  // Phone: 15 × 1.30 = 20 (rounded up)
  centerBold: T({
    color: '#000000',
    fontSize: 20,
    fontWeight: '700',
    fontFamily: BN_BOLD,
    textAlign: 'center',
    lineHeight: 25,
    marginTop: 2
  }),

  // ── Table / Date / Time ──────────────────────────────────────
  // Table row: 15 × 1.30 = 20 (rounded up)
  row: T({
    color: '#000000',
    fontSize: 20,
    fontFamily: BN_BOLD,
    lineHeight: 26
  }),
  splitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginVertical: 1
  },
  bold: T({
    fontWeight: '700',
    fontFamily: BN_BOLD,
    color: '#000000'
  }),
  // Date / Time: 14 × 1.30 = 18
  metaText: T({
    color: '#000000',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: BN_BOLD,
    lineHeight: 26
  }),

  // ── Item lines ───────────────────────────────────────────────
  itemBlock: {
    marginVertical: 2
  },
  // Item name: 17 × 1.35 = 23
  itemName: T({
    color: '#000000',
    fontSize: 23,
    fontWeight: '700',
    fontFamily: BN_BOLD,
    lineHeight: 30
  }),
  // Qty × price: 15 × 1.30 = 20 (rounded up)
  itemQtyPrice: T({
    color: '#000000',
    fontSize: 20,
    fontWeight: '700',
    fontFamily: BN_BOLD,
    lineHeight: 26
  }),
  // Item total: 17 × 1.30 = 22
  itemPrice: T({
    color: '#000000',
    fontSize: 22,
    fontWeight: '700',
    fontFamily: BN_BOLD,
    lineHeight: 29,
    letterSpacing: 0.3
  }),

  // ── Extra / add-on lines (nested + slightly smaller) ─────────
  extraItemBlock: {
    paddingLeft: 20,
    marginVertical: 0
  },
  extraItemName: T({
    color: '#000000',
    fontSize: 19,
    fontWeight: '700',
    fontFamily: BN_BOLD,
    lineHeight: 25
  }),
  extraItemMeta: T({
    color: '#000000',
    fontSize: 17,
    fontWeight: '700',
    fontFamily: BN_BOLD,
    lineHeight: 22
  }),

  // ── Subtotal / Discount / Delivery ───────────────────────────
  // সর্বমোট label: 17 × 1.40 = 24
  summaryLabel: T({
    color: '#000000',
    fontSize: 24,
    fontWeight: '700',
    fontFamily: BN_BOLD,
    lineHeight: 31
  }),
  // সর্বমোট value: 18 × 1.40 = 25
  summaryPrice: T({
    color: '#000000',
    fontSize: 25,
    fontWeight: '700',
    fontFamily: BN_BOLD,
    lineHeight: 31,
    letterSpacing: 0.3
  }),

  // ── PAYABLE (most prominent) ──────────────────────────────────
  // পরিশোধ label: 21 × 1.40 = 29
  totalLabel: T({
    color: '#000000',
    fontSize: 29,
    fontWeight: '700',
    fontFamily: BN_BOLD,
    lineHeight: 39
  }),
  // পরিশোধ value: 23 × 1.40 = 32
  totalPrice: T({
    color: '#000000',
    fontSize: 32,
    fontWeight: '700',
    fontFamily: BN_BOLD,
    lineHeight: 39,
    letterSpacing: 0.4
  }),

  // ── Payment method ───────────────────────────────────────────
  // Payment label: 16 × 1.40 = 22
  paymentLabel: T({
    color: '#000000',
    fontSize: 22,
    fontWeight: '700',
    fontFamily: BN_BOLD,
    lineHeight: 31
  }),
  // Payment value: 17 × 1.40 = 24 (rounded up)
  paymentValue: T({
    color: '#000000',
    fontSize: 24,
    fontWeight: '700',
    fontFamily: BN_BOLD,
    lineHeight: 31
  }),

  // ── Footer ───────────────────────────────────────────────────
  // Footer: 15 × 1.35 = 20
  footer: T({
    color: '#000000',
    fontSize: 20,
    fontWeight: '700',
    fontFamily: BN_BOLD,
    textAlign: 'center',
    lineHeight: 27
  }),

  // ── Split-payment breakdown ───────────────────────────────────
  splitBreakdownContainer: {
    marginTop: 2,
    marginBottom: 2
  },
  splitSubRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 1
  },
  // Split label: 14 × 1.30 = 18
  splitSubLabel: T({
    color: '#000000',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: BN_BOLD,
    lineHeight: 25
  }),
  // Split amount: 15 × 1.30 = 20 (rounded up)
  splitSubAmount: T({
    color: '#000000',
    fontSize: 20,
    fontWeight: '700',
    fontFamily: BN_BOLD,
    lineHeight: 25,
    letterSpacing: 0.3
  }),

  // Blank paper feed spacer (8.2 text line heights of pure white space after final receipt content)
  // Ensures the receipt feeds past the printer's physical tear cutter without cutting through text.
  // Calculation: 8.2 lines × 22.5px/line = 184.5px (~185px)
  bottomFeedSpacer: {
    height: 185,
    backgroundColor: '#FFFFFF'
  }
});
