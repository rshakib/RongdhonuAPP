import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Modal,
  TouchableWithoutFeedback,
} from 'react-native';

const BENGALI_MONTHS = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল',
  'মে', 'জুন', 'জুলাই', 'আগস্ট',
  'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
];

export const getCurrentBengaliMonth = () => {
  const d = new Date(Date.now() - 3600000); // 1-hour business day offset
  return BENGALI_MONTHS[d.getMonth()];
};

/**
 * Pure React Native vector glyphs — zero external packages, zero emoji.
 * Scales cleanly across all screen densities.
 */
export const VectorGlyph = ({ name, size = 16, color = '#FFFFFF' }) => {
  switch (name) {
    case 'trending-up':
      return (
        <View style={[styles.glyphContainer, { width: size, height: size }]}>
          <View style={{ width: size * 0.8, height: size * 0.8, position: 'relative' }}>
            <View
              style={{
                width: size * 0.4,
                height: size * 0.4,
                borderTopWidth: 1.8,
                borderRightWidth: 1.8,
                borderColor: color,
                position: 'absolute',
                top: 0,
                right: 0,
              }}
            />
            <View
              style={{
                width: size * 0.8,
                height: 1.8,
                backgroundColor: color,
                transform: [{ rotate: '-45deg' }],
                position: 'absolute',
                top: size * 0.35,
                left: -size * 0.05,
              }}
            />
          </View>
        </View>
      );

    case 'wallet':
      return (
        <View style={[styles.glyphContainer, { width: size, height: size }]}>
          <View
            style={{
              width: size * 0.85,
              height: size * 0.62,
              borderRadius: 2.5,
              borderWidth: 1.4,
              borderColor: color,
              position: 'relative',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: size * 0.28,
                height: size * 0.32,
                borderRadius: 1.5,
                borderWidth: 1.1,
                borderColor: color,
                borderLeftWidth: 0,
                position: 'absolute',
                right: -1,
                backgroundColor: 'transparent',
              }}
            />
          </View>
        </View>
      );

    case 'users':
      return (
        <View style={[styles.glyphContainer, { width: size, height: size }]}>
          <View style={{ width: size * 0.88, height: size * 0.85, position: 'relative' }}>
            {/* Primary figure */}
            <View
              style={{
                width: size * 0.32,
                height: size * 0.32,
                borderRadius: size * 0.16,
                borderWidth: 1.2,
                borderColor: color,
                position: 'absolute',
                top: 0,
                left: size * 0.08,
              }}
            />
            <View
              style={{
                width: size * 0.52,
                height: size * 0.32,
                borderTopLeftRadius: size * 0.26,
                borderTopRightRadius: size * 0.26,
                borderWidth: 1.2,
                borderBottomWidth: 0,
                borderColor: color,
                position: 'absolute',
                bottom: 0,
                left: 0,
              }}
            />
            {/* Secondary background figure */}
            <View
              style={{
                width: size * 0.26,
                height: size * 0.26,
                borderRadius: size * 0.13,
                borderWidth: 1.1,
                borderColor: color,
                position: 'absolute',
                top: size * 0.08,
                right: size * 0.06,
                opacity: 0.8,
              }}
            />
            <View
              style={{
                width: size * 0.42,
                height: size * 0.26,
                borderTopLeftRadius: size * 0.21,
                borderTopRightRadius: size * 0.21,
                borderWidth: 1.1,
                borderBottomWidth: 0,
                borderColor: color,
                position: 'absolute',
                bottom: 0,
                right: 0,
                opacity: 0.8,
              }}
            />
          </View>
        </View>
      );

    case 'calendar':
      return (
        <View style={[styles.glyphContainer, { width: size, height: size }]}>
          <View
            style={{
              width: size * 0.82,
              height: size * 0.82,
              borderRadius: 2.5,
              borderWidth: 1.3,
              borderColor: color,
              position: 'relative',
            }}
          >
            <View
              style={{
                width: 1.6,
                height: 3,
                backgroundColor: color,
                position: 'absolute',
                top: -2,
                left: size * 0.16,
                borderRadius: 0.8,
              }}
            />
            <View
              style={{
                width: 1.6,
                height: 3,
                backgroundColor: color,
                position: 'absolute',
                top: -2,
                right: size * 0.16,
                borderRadius: 0.8,
              }}
            />
            <View
              style={{
                width: '100%',
                height: 1.2,
                backgroundColor: color,
                position: 'absolute',
                top: size * 0.22,
              }}
            />
            <View
              style={{
                width: size * 0.15,
                height: size * 0.15,
                borderRadius: 0.5,
                backgroundColor: color,
                position: 'absolute',
                bottom: size * 0.16,
                left: size * 0.16,
                opacity: 0.8,
              }}
            />
            <View
              style={{
                width: size * 0.15,
                height: size * 0.15,
                borderRadius: 0.5,
                backgroundColor: color,
                position: 'absolute',
                bottom: size * 0.16,
                right: size * 0.16,
                opacity: 0.8,
              }}
            />
          </View>
        </View>
      );

    case 'table':
      return (
        <View style={[styles.glyphContainer, { width: size, height: size }]}>
          <View style={{ width: size * 0.85, height: size * 0.7, position: 'relative' }}>
            <View
              style={{
                width: '100%',
                height: 2,
                backgroundColor: color,
                borderRadius: 1,
                position: 'absolute',
                top: 0,
              }}
            />
            <View
              style={{
                width: 1.4,
                height: size * 0.52,
                backgroundColor: color,
                position: 'absolute',
                top: 2,
                left: size * 0.12,
              }}
            />
            <View
              style={{
                width: 1.4,
                height: size * 0.52,
                backgroundColor: color,
                position: 'absolute',
                top: 2,
                right: size * 0.12,
              }}
            />
          </View>
        </View>
      );

    case 'phone':
    case 'digital':
      return (
        <View style={[styles.glyphContainer, { width: size, height: size }]}>
          <View
            style={{
              width: size * 0.6,
              height: size * 0.9,
              borderRadius: 2,
              borderWidth: 1.2,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 1,
            }}
          >
            <View style={{ width: size * 0.25, height: 1, backgroundColor: color }} />
            <View style={{ width: size * 0.16, height: size * 0.16, borderRadius: size * 0.08, backgroundColor: color }} />
          </View>
        </View>
      );

    case 'cart':
    case 'orders':
      return (
        <View style={[styles.glyphContainer, { width: size, height: size }]}>
          <View style={{ width: size * 0.85, height: size * 0.75, position: 'relative' }}>
            <View
              style={{
                width: size * 0.65,
                height: size * 0.45,
                borderLeftWidth: 1.3,
                borderBottomWidth: 1.3,
                borderRightWidth: 1.1,
                borderColor: color,
                position: 'absolute',
                top: size * 0.06,
                left: size * 0.1,
                borderRadius: 1,
              }}
            />
            <View
              style={{
                width: size * 0.22,
                height: 1.3,
                backgroundColor: color,
                position: 'absolute',
                top: 0,
                left: 0,
              }}
            />
            <View
              style={{
                width: size * 0.16,
                height: size * 0.16,
                borderRadius: size * 0.08,
                backgroundColor: color,
                position: 'absolute',
                bottom: 0,
                left: size * 0.18,
              }}
            />
            <View
              style={{
                width: size * 0.16,
                height: size * 0.16,
                borderRadius: size * 0.08,
                backgroundColor: color,
                position: 'absolute',
                bottom: 0,
                left: size * 0.55,
              }}
            />
          </View>
        </View>
      );

    case 'check':
      return (
        <View style={[styles.glyphContainer, { width: size, height: size }]}>
          <View
            style={{
              width: size * 0.35,
              height: size * 0.65,
              borderBottomWidth: 1.5,
              borderRightWidth: 1.5,
              borderColor: color,
              transform: [{ rotate: '45deg' }],
              marginBottom: size * 0.1,
            }}
          />
        </View>
      );

    case 'clock':
      return (
        <View style={[styles.glyphContainer, { width: size, height: size }]}>
          <View
            style={{
              width: size * 0.85,
              height: size * 0.85,
              borderRadius: size * 0.425,
              borderWidth: 1.2,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            <View style={{ width: 2, height: 2, borderRadius: 1, backgroundColor: color }} />
            <View
              style={{
                width: 1.2,
                height: size * 0.28,
                backgroundColor: color,
                position: 'absolute',
                top: size * 0.16,
              }}
            />
            <View
              style={{
                width: size * 0.22,
                height: 1.2,
                backgroundColor: color,
                position: 'absolute',
                right: size * 0.18,
              }}
            />
          </View>
        </View>
      );

    default:
      return (
        <View style={[styles.glyphContainer, { width: size, height: size }]}>
          <View style={{ width: size * 0.35, height: size * 0.35, borderRadius: size * 0.175, backgroundColor: color }} />
        </View>
      );
  }
};

/**
 * Shared Digital Breakdown Popover Modal.
 * Shows only non-zero payment channels (bKash, Nagad, Rocket).
 */
export function DigitalBreakdownModal({
  visible,
  onClose,
  bkashSale = 0,
  nagadSale = 0,
  rocketSale = 0,
}) {
  const digitalTotal = (bkashSale || 0) + (nagadSale || 0) + (rocketSale || 0);

  const activeMethods = [];
  if (bkashSale > 0) activeMethods.push({ label: 'bKash', amount: bkashSale });
  if (nagadSale > 0) activeMethods.push({ label: 'Nagad', amount: nagadSale });
  if (rocketSale > 0) activeMethods.push({ label: 'Rocket', amount: rocketSale });

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.modalBackdrop}>
          <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
            <View style={styles.popoverCard}>
              <View style={styles.popoverHeader}>
                <View style={styles.popoverHeaderLeft}>
                  <VectorGlyph name="phone" size={13} color="#34D399" />
                  <Text style={styles.popoverTitle}>Digital পেমেন্ট</Text>
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.popoverCloseBtn}>✕</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.popoverDivider} />

              {activeMethods.length > 0 ? (
                activeMethods.map((m, idx) => (
                  <View key={idx} style={styles.popoverRow}>
                    <Text style={styles.methodLabel}>{m.label}</Text>
                    <Text style={styles.methodAmount}>৳ {m.amount.toLocaleString()}</Text>
                  </View>
                ))
              ) : (
                <View style={styles.emptyRow}>
                  <Text style={styles.emptyText}>কোনো ডিজিটাল পেমেন্ট নেই</Text>
                </View>
              )}

              <View style={styles.popoverDivider} />

              <View style={styles.popoverTotalRow}>
                <Text style={styles.totalLabel}>মোট ডিজিটাল</Text>
                <Text style={styles.totalAmount}>৳ {digitalTotal.toLocaleString()}</Text>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

/**
 * BaseStatCard — Unified, compact container for all POS Dashboard Stat Cards.
 * Fixed compact footprint (width: 170, minHeight: 154) preventing layout shifts.
 */
export function BaseStatCard({
  iconName,
  iconColor,
  iconBgColor,
  iconBorderColor,
  cardBgColor,
  cardBorderColor,
  title,
  subtitle,
  amount,
  leftChip,
  rightChip,
}) {
  return (
    <View style={[styles.card, { backgroundColor: cardBgColor, borderColor: cardBorderColor }]}>
      {/* Top Header Row: Icon + Bengali Title + English Subtitle */}
      <View style={styles.headerRow}>
        <View style={[styles.iconBox, { backgroundColor: iconBgColor, borderColor: iconBorderColor }]}>
          <VectorGlyph name={iconName} size={16} color={iconColor} />
        </View>
        <View style={styles.titleCol}>
          <Text style={styles.bengaliTitle} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.englishSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </View>

      {/* Middle Row: Primary Amount */}
      <View style={styles.amountContainer}>
        <Text
          style={styles.amountText}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {amount}
        </Text>
      </View>

      {/* Bottom Row: 2 Side-by-Side Chips */}
      <View style={styles.bottomRow}>
        {leftChip}
        {rightChip}
      </View>
    </View>
  );
}

/**
 * Card 1: TodaySalesCard (আজকের বিক্রয় / Today's Sales)
 */
export function TodaySalesCard({
  todaySale = 0,
  bkashSale = 0,
  nagadSale = 0,
  rocketSale = 0,
  totalDoneCount = 0,
  title = 'আজকের বিক্রয়',
  subtitle = "Today's Sales",
}) {
  const [modalVisible, setModalVisible] = useState(false);
  const digitalTotal = (bkashSale || 0) + (nagadSale || 0) + (rocketSale || 0);

  const leftChip = (
    <TouchableOpacity
      style={[styles.chip, styles.digitalChip]}
      activeOpacity={0.7}
      onPress={() => setModalVisible(true)}
    >
      <View style={styles.chipTopRow}>
        <View style={styles.chipIconLabel}>
          <VectorGlyph name="phone" size={9} color="#34D399" />
          <Text style={styles.chipLabel}>Digital</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>
      <Text
        style={styles.digitalValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        ৳ {digitalTotal.toLocaleString()}
      </Text>
    </TouchableOpacity>
  );

  const rightChip = (
    <View style={[styles.chip, styles.neutralChip]}>
      <View style={styles.chipTopRow}>
        <View style={styles.chipIconLabel}>
          <VectorGlyph name="cart" size={9} color="#34D399" />
          <Text style={styles.chipLabel}>সফল অর্ডার</Text>
        </View>
      </View>
      <Text
        style={styles.whiteValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {totalDoneCount} টি
      </Text>
    </View>
  );

  return (
    <>
      <BaseStatCard
        iconName="trending-up"
        iconColor="#34D399"
        iconBgColor="rgba(16, 185, 129, 0.18)"
        iconBorderColor="rgba(52, 211, 153, 0.35)"
        cardBgColor="rgba(16, 37, 24, 0.85)"
        cardBorderColor="rgba(52, 211, 153, 0.35)"
        title={title}
        subtitle={subtitle}
        amount={`৳ ${todaySale.toLocaleString()}`}
        leftChip={leftChip}
        rightChip={rightChip}
      />
      <DigitalBreakdownModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        bkashSale={bkashSale}
        nagadSale={nagadSale}
        rocketSale={rocketSale}
      />
    </>
  );
}

/**
 * Card 2: TotalCashCard (মোট ক্যাশ / Total Cash)
 */
export function TotalCashCard({
  totalCash = 0,
  bkashSale = 0,
  nagadSale = 0,
  rocketSale = 0,
  title = 'মোট ক্যাশ',
  subtitle = 'Total Cash',
}) {
  const [modalVisible, setModalVisible] = useState(false);
  const digitalTotal = (bkashSale || 0) + (nagadSale || 0) + (rocketSale || 0);
  const cashboxAmount = totalCash - digitalTotal;

  const leftChip = (
    <View style={[styles.chip, styles.blueChip]}>
      <View style={styles.chipTopRow}>
        <View style={styles.chipIconLabel}>
          <VectorGlyph name="wallet" size={9} color="#60A5FA" />
          <Text style={styles.chipLabel}>Cashbox</Text>
        </View>
      </View>
      <Text
        style={styles.blueValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        ৳ {cashboxAmount.toLocaleString()}
      </Text>
    </View>
  );

  const rightChip = (
    <TouchableOpacity
      style={[styles.chip, styles.digitalChip]}
      activeOpacity={0.7}
      onPress={() => setModalVisible(true)}
    >
      <View style={styles.chipTopRow}>
        <View style={styles.chipIconLabel}>
          <VectorGlyph name="phone" size={9} color="#34D399" />
          <Text style={styles.chipLabel}>ডিজিটাল</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>
      <Text
        style={styles.digitalValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        ৳ {digitalTotal.toLocaleString()}
      </Text>
    </TouchableOpacity>
  );

  return (
    <>
      <BaseStatCard
        iconName="wallet"
        iconColor="#60A5FA"
        iconBgColor="rgba(59, 130, 246, 0.18)"
        iconBorderColor="rgba(96, 165, 250, 0.35)"
        cardBgColor="rgba(15, 23, 42, 0.85)"
        cardBorderColor="rgba(96, 165, 250, 0.35)"
        title={title}
        subtitle={subtitle}
        amount={`৳ ${totalCash.toLocaleString()}`}
        leftChip={leftChip}
        rightChip={rightChip}
      />
      <DigitalBreakdownModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        bkashSale={bkashSale}
        nagadSale={nagadSale}
        rocketSale={rocketSale}
      />
    </>
  );
}

/**
 * Card 3: ActiveTablesCard (Active টেবিল / Active Tables) — AdminDB & OwnerDashboard
 */
export function ActiveTablesCard({
  activeCount = 0,
  totalTables = 0,
  title = 'Active টেবিল',
  subtitle = 'Active Tables',
}) {
  const freeCount = Math.max(0, totalTables - activeCount);

  const leftChip = (
    <View style={[styles.chip, styles.orangeChip]}>
      <View style={styles.chipTopRow}>
        <View style={styles.chipIconLabel}>
          <VectorGlyph name="table" size={9} color="#FB923C" />
          <Text style={styles.chipLabel}>ব্যস্ত</Text>
        </View>
      </View>
      <Text
        style={styles.orangeValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {activeCount} টি
      </Text>
    </View>
  );

  const rightChip = (
    <View style={[styles.chip, styles.neutralChip]}>
      <View style={styles.chipTopRow}>
        <View style={styles.chipIconLabel}>
          <VectorGlyph name="check" size={9} color="#34D399" />
          <Text style={styles.chipLabel}>খালি</Text>
        </View>
      </View>
      <Text
        style={styles.whiteValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {freeCount} টি
      </Text>
    </View>
  );

  return (
    <BaseStatCard
      iconName="users"
      iconColor="#FB923C"
      iconBgColor="rgba(249, 115, 22, 0.18)"
      iconBorderColor="rgba(251, 146, 60, 0.35)"
      cardBgColor="rgba(36, 22, 14, 0.85)"
      cardBorderColor="rgba(251, 146, 60, 0.35)"
      title={title}
      subtitle={subtitle}
      amount={`${activeCount} / ${totalTables}`}
      leftChip={leftChip}
      rightChip={rightChip}
    />
  );
}

/**
 * Card 3 (Manager): ActiveOrdersCard (Active অর্ডার / Active Orders) — ManagerDashboard
 */
export function ActiveOrdersCard({
  totalActiveCount = 0,
  activeTablesCount = 0,
  activeDeliveriesCount = 0,
  title = 'Active অর্ডার',
  subtitle = 'Active Orders',
}) {
  const leftChip = (
    <View style={[styles.chip, styles.orangeChip]}>
      <View style={styles.chipTopRow}>
        <View style={styles.chipIconLabel}>
          <VectorGlyph name="table" size={9} color="#FB923C" />
          <Text style={styles.chipLabel}>টেবিল</Text>
        </View>
      </View>
      <Text
        style={styles.orangeValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {activeTablesCount} টি
      </Text>
    </View>
  );

  const rightChip = (
    <View style={[styles.chip, styles.neutralChip]}>
      <View style={styles.chipTopRow}>
        <View style={styles.chipIconLabel}>
          <VectorGlyph name="cart" size={9} color="#FB923C" />
          <Text style={styles.chipLabel}>ডেলিভারি</Text>
        </View>
      </View>
      <Text
        style={styles.whiteValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {activeDeliveriesCount} টি
      </Text>
    </View>
  );

  return (
    <BaseStatCard
      iconName="users"
      iconColor="#FB923C"
      iconBgColor="rgba(249, 115, 22, 0.18)"
      iconBorderColor="rgba(251, 146, 60, 0.35)"
      cardBgColor="rgba(36, 22, 14, 0.85)"
      cardBorderColor="rgba(251, 146, 60, 0.35)"
      title={title}
      subtitle={subtitle}
      amount={`${totalActiveCount} টি`}
      leftChip={leftChip}
      rightChip={rightChip}
    />
  );
}

/**
 * Card 4: MonthlyTotalCard (এই মাসের মোট / Monthly Total) — AdminDB & OwnerDashboard
 */
export function MonthlyTotalCard({
  monthlyTotalSell = 0,
  title = 'এই মাসের মোট',
  subtitle = 'Monthly Total',
}) {
  const currentMonth = getCurrentBengaliMonth();

  const leftChip = (
    <View style={[styles.chip, styles.amberChip]}>
      <View style={styles.chipTopRow}>
        <View style={styles.chipIconLabel}>
          <VectorGlyph name="calendar" size={9} color="#FBBF24" />
          <Text style={styles.chipLabel}>মাস</Text>
        </View>
      </View>
      <Text
        style={styles.amberValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {currentMonth}
      </Text>
    </View>
  );

  const rightChip = (
    <View style={[styles.chip, styles.neutralChip]}>
      <View style={styles.chipTopRow}>
        <View style={styles.chipIconLabel}>
          <VectorGlyph name="clock" size={9} color="#FBBF24" />
          <Text style={styles.chipLabel}>সময়কাল</Text>
        </View>
      </View>
      <Text
        style={styles.whiteValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        ১লা - আজ
      </Text>
    </View>
  );

  return (
    <BaseStatCard
      iconName="calendar"
      iconColor="#FBBF24"
      iconBgColor="rgba(245, 158, 11, 0.18)"
      iconBorderColor="rgba(253, 224, 71, 0.35)"
      cardBgColor="rgba(30, 27, 12, 0.85)"
      cardBorderColor="rgba(253, 224, 71, 0.35)"
      title={title}
      subtitle={subtitle}
      amount={`৳ ${monthlyTotalSell.toLocaleString()}`}
      leftChip={leftChip}
      rightChip={rightChip}
    />
  );
}

const styles = StyleSheet.create({
  glyphContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: 170,
    minHeight: 154,
    borderRadius: 16,
    padding: 12,
    marginHorizontal: 5,
    borderWidth: 1,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  titleCol: {
    flex: 1,
    justifyContent: 'center',
  },
  bengaliTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#FFF',
    letterSpacing: 0.2,
    lineHeight: 16,
  },
  englishSubtitle: {
    fontSize: 9.5,
    color: '#9CA3AF',
    marginTop: 1,
    fontWeight: '400',
  },
  amountContainer: {
    marginVertical: 4,
    justifyContent: 'center',
  },
  amountText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFF',
    letterSpacing: 0.3,
  },
  bottomRow: {
    flexDirection: 'row',
    gap: 6,
    width: '100%',
  },
  chip: {
    flex: 1,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
  },
  digitalChip: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(52, 211, 153, 0.3)',
  },
  blueChip: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderColor: 'rgba(96, 165, 250, 0.3)',
  },
  orangeChip: {
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderColor: 'rgba(251, 146, 60, 0.3)',
  },
  amberChip: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(253, 224, 71, 0.3)',
  },
  neutralChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  chipTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  chipIconLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexShrink: 1,
  },
  chipLabel: {
    fontSize: 8.5,
    color: '#9CA3AF',
    fontWeight: '600',
  },
  chevron: {
    fontSize: 10,
    color: '#34D399',
    fontWeight: 'bold',
    marginLeft: 2,
  },
  digitalValue: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#34D399',
  },
  blueValue: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#60A5FA',
  },
  orangeValue: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#FB923C',
  },
  amberValue: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#FBBF24',
  },
  whiteValue: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#FFF',
  },

  // Popover modal styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  popoverCard: {
    width: 220,
    borderRadius: 14,
    padding: 14,
    backgroundColor: '#0D1A12',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.4)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  popoverHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  popoverHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  popoverTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#FFF',
  },
  popoverCloseBtn: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: 'bold',
    padding: 2,
  },
  popoverDivider: {
    height: 1,
    backgroundColor: 'rgba(52, 211, 153, 0.2)',
    marginVertical: 8,
  },
  popoverRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  methodLabel: {
    fontSize: 11.5,
    color: '#D1D5DB',
  },
  methodAmount: {
    fontSize: 11.5,
    fontWeight: 'bold',
    color: '#34D399',
  },
  emptyRow: {
    paddingVertical: 4,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 11,
    color: '#9CA3AF',
    fontStyle: 'italic',
  },
  popoverTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '600',
  },
  totalAmount: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#34D399',
  },
});

export default TodaySalesCard;
