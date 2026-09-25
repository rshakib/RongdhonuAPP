import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Dimensions,
  Platform,
  KeyboardAvoidingView,
  StatusBar as RNStatusBar,
  Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  X,
  Send,
  BarChart3,
  Wallet,
  User,
  FileText
} from 'lucide-react-native';
import { formatDisplayDate as defaultFormatDisplayDate } from '../database';

const { width } = Dimensions.get('window');

// Brand SVG Icons for Section 1
const BkashIcon = () => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
    <Path
      d="M12.5 3L4 9.5L10 13L2.5 19.5L11.5 16.5L14.5 22L16.5 14L22.5 12L15.5 8L18.5 3.5L12.5 6.5V3Z"
      fill="#FFFFFF"
    />
  </Svg>
);

const NagadIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d="M12 2C9.5 5 7.5 7.5 7.5 11C7.5 14.3 10.2 17 13.5 17C14.2 17 14.9 16.9 15.5 16.6C15 18.6 13.2 20 11 20C8.2 20 6 17.8 6 15C6 13.1 7.1 11.4 8.7 10.5C8.3 8.8 8.8 7 9.8 5.6C5.2 7.7 2 12.5 2 18C2 20.2 3.8 22 6 22H18C20.2 22 22 20.2 22 18C22 10.8 17.5 4.8 12 2Z"
      fill="#FFFFFF"
    />
  </Svg>
);

const RocketIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d="M4.5 10.5L18.5 3.5L14 18.5L10 14L4.5 10.5Z"
      fill="#FFFFFF"
    />
    <Path
      d="M10 14L18.5 3.5"
      stroke="#8C3494"
      strokeWidth={1.5}
    />
  </Svg>
);

const CashIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="9" stroke="#FFFFFF" strokeWidth="2" />
    <Circle cx="12" cy="12" r="4" fill="#FFFFFF" />
  </Svg>
);

/**
 * PastAccountModal - অতীতের হিসাব যোগ করুন
 * Redesigned to match the reference screenshot exactly:
 * - Rounded dark modal container with top grabber pill & close (X) button
 * - Calendar icon badge header with title & subtitle
 * - Large date selector button with calendar icon & chevron
 * - Section 1: মোট বিক্রয় (আয়) - Purple themed card with 2-column grid (bKash, Nagad, Rocket, Cash, Delivery Sell, Delivery Charge)
 * - Section 2: খরচসমূহ (Expenses) - Amber themed card with 2-column grid & collapsible chevron
 * - Section 3: Owner কে জমা (Deposit) - Green highlight card with user icon badge
 * - Note Section: Rounded textarea with icon badge
 * - Bottom Action Buttons: "বাতিল" & "সেভ করুন"
 * - Preserves Admin-only delete functionality when editing
 */
export default function PastAccountModal({
  visible,
  onClose,
  isEditingPast = false,
  pastDate = '',
  onOpenDatePicker,
  // Income fields
  pastTotalSell = '',
  setPastTotalSell,
  pastBkash = '',
  setPastBkash,
  pastNagad = '',
  setPastNagad,
  pastRocket = '',
  setPastRocket,
  pastCash = '',
  setPastCash,
  pastDeliverySell = '',
  setPastDeliverySell,
  pastDeliveryCharge = '',
  setPastDeliveryCharge,
  // Expense fields
  pastDudu = '',
  setPastDudu,
  pastAkash = '',
  setPastAkash,
  pastBurger = '',
  setPastBurger,
  pastBazar = '',
  setPastBazar,
  pastOthers = '',
  setPastOthers,
  pastIjara = '',
  setPastIjara,
  pastNetCash = '',
  setPastNetCash,
  // Deposit & Note
  pastDeposit = '',
  setPastDeposit,
  pastNote = '',
  setPastNote,
  // Actions
  onSave,
  onDelete, // (date) => void
  formatDisplayDate = defaultFormatDisplayDate
}) {
  const [isExpensesExpanded, setIsExpensesExpanded] = useState(true);

  // Helper to ensure pastTotalSell is synced if user modifies breakdown
  const handlePaymentChange = (setter, val, currentVal) => {
    setter(val);
    if (setPastTotalSell) {
      const numVal = parseFloat(val) || 0;
      const prevVal = parseFloat(currentVal) || 0;
      const curTotal = parseFloat(pastTotalSell) || 0;
      const nextTotal = Math.max(0, curTotal + (numVal - prevVal));
      setPastTotalSell(nextTotal > 0 ? String(nextTotal) : '');
    }
  };

  const handleSavePress = () => {
    // Check if totalSell is missing but user entered payment methods
    const breakdownSum =
      (parseFloat(pastCash) || 0) +
      (parseFloat(pastBkash) || 0) +
      (parseFloat(pastNagad) || 0) +
      (parseFloat(pastRocket) || 0) +
      (parseFloat(pastDeliverySell) || 0);

    if ((!pastTotalSell || parseFloat(pastTotalSell) === 0) && breakdownSum > 0 && setPastTotalSell) {
      setPastTotalSell(String(breakdownSum));
    }

    if (onSave) {
      onSave();
    }
  };

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent={true}
    >
      <SafeAreaView
        style={styles.modalRoot}
        edges={Platform.OS === 'ios' ? ['top', 'bottom', 'left', 'right'] : ['bottom', 'left', 'right']}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalCard}
        >
          {/* Top Grabber Bar */}
          <View style={styles.grabberBar} />

          {/* Modal Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIconBadge}>
                <Calendar size={20} color="#FFB703" />
              </View>
              <View style={styles.headerTextGroup}>
                <Text style={styles.headerTitle}>অতীতের হিসাব যোগ করুন</Text>
                <Text style={styles.headerSubtitle}>
                  নির্দিষ্ট তারিখের আয়, খরচ ও অন্যান্য তথ্য দিন
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <X size={16} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Scrollable Form Body */}
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* DATE SELECTOR */}
            <View style={styles.dateSection}>
              <Text style={styles.fieldLabel}>তারিখ</Text>
              <TouchableOpacity
                style={styles.dateSelector}
                onPress={onOpenDatePicker}
                activeOpacity={0.7}
              >
                <View style={styles.dateLeft}>
                  <Calendar size={16} color="#FFB703" />
                  <Text style={styles.dateText}>
                    {pastDate ? formatDisplayDate(pastDate) : 'তারিখ সিলেক্ট করুন'}
                  </Text>
                </View>
                <ChevronDown size={16} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {/* SECTION 1: মোট বিক্রয় (আয়) */}
            <View style={styles.sectionSales}>
              <View style={styles.sectionHeaderSales}>
                <View style={styles.badgeSales}>
                  <BarChart3 size={15} color="#FFB703" />
                </View>
                <Text style={styles.sectionTitleSales}>মোট বিক্রয় (আয়)</Text>
              </View>

              <View style={styles.gridContainer}>
                {/* Row 1: bKash & Nagad */}
                <View style={styles.gridItem}>
                  <View style={[styles.itemIconBadge, { backgroundColor: '#E2136E' }]}>
                    <BkashIcon />
                  </View>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemLabel}>bKash</Text>
                    <View style={styles.inputContainer}>
                      <Text style={styles.currencyPrefix}>৳</Text>
                      <TextInput
                        style={styles.numericInput}
                        keyboardType="numeric"
                        value={pastBkash}
                        onChangeText={(v) => handlePaymentChange(setPastBkash, v, pastBkash)}
                        placeholder="0"
                        placeholderTextColor="#555555"
                      />
                    </View>
                  </View>
                </View>

                <View style={styles.gridItem}>
                  <View style={[styles.itemIconBadge, { backgroundColor: '#EA580C' }]}>
                    <NagadIcon />
                  </View>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemLabel}>Nagad</Text>
                    <View style={styles.inputContainer}>
                      <Text style={styles.currencyPrefix}>৳</Text>
                      <TextInput
                        style={styles.numericInput}
                        keyboardType="numeric"
                        value={pastNagad}
                        onChangeText={(v) => handlePaymentChange(setPastNagad, v, pastNagad)}
                        placeholder="0"
                        placeholderTextColor="#555555"
                      />
                    </View>
                  </View>
                </View>

                {/* Row 2: Rocket & Cash */}
                <View style={styles.gridItem}>
                  <View style={[styles.itemIconBadge, { backgroundColor: '#7E22CE' }]}>
                    <RocketIcon />
                  </View>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemLabel}>Rocket</Text>
                    <View style={styles.inputContainer}>
                      <Text style={styles.currencyPrefix}>৳</Text>
                      <TextInput
                        style={styles.numericInput}
                        keyboardType="numeric"
                        value={pastRocket}
                        onChangeText={(v) => handlePaymentChange(setPastRocket, v, pastRocket)}
                        placeholder="0"
                        placeholderTextColor="#555555"
                      />
                    </View>
                  </View>
                </View>

                <View style={styles.gridItem}>
                  <View style={[styles.itemIconBadge, { backgroundColor: '#10B981' }]}>
                    <CashIcon />
                  </View>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemLabel}>Cash</Text>
                    <View style={styles.inputContainer}>
                      <Text style={styles.currencyPrefix}>৳</Text>
                      <TextInput
                        style={styles.numericInput}
                        keyboardType="numeric"
                        value={pastCash}
                        onChangeText={(v) => handlePaymentChange(setPastCash, v, pastCash)}
                        placeholder="0"
                        placeholderTextColor="#555555"
                      />
                    </View>
                  </View>
                </View>

                {/* Row 3: Delivery Sell & Delivery Charge */}
                <View style={styles.gridItem}>
                  <View style={[styles.itemIconBadge, { backgroundColor: '#222222', borderWidth: 1, borderColor: '#333333' }]}>
                    <Text style={styles.emojiIcon}>🛵</Text>
                  </View>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemLabel} numberOfLines={1}>Delivery Sell</Text>
                    <View style={styles.inputContainer}>
                      <Text style={styles.currencyPrefix}>৳</Text>
                      <TextInput
                        style={styles.numericInput}
                        keyboardType="numeric"
                        value={pastDeliverySell}
                        onChangeText={(v) => handlePaymentChange(setPastDeliverySell, v, pastDeliverySell)}
                        placeholder="0"
                        placeholderTextColor="#555555"
                      />
                    </View>
                  </View>
                </View>

                <View style={styles.gridItem}>
                  <View style={[styles.itemIconBadge, { backgroundColor: '#222222', borderWidth: 1, borderColor: '#333333' }]}>
                    <Text style={styles.emojiIcon}>🏷️</Text>
                  </View>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemLabel} numberOfLines={1}>Delivery Charge</Text>
                    <View style={styles.inputContainer}>
                      <Text style={styles.currencyPrefix}>৳</Text>
                      <TextInput
                        style={styles.numericInput}
                        keyboardType="numeric"
                        value={pastDeliveryCharge}
                        onChangeText={setPastDeliveryCharge}
                        placeholder="0"
                        placeholderTextColor="#555555"
                      />
                    </View>
                  </View>
                </View>
              </View>
            </View>

            {/* SECTION 2: খরচসমূহ (Expenses) */}
            <View style={styles.sectionExpenses}>
              <TouchableOpacity
                style={styles.sectionHeaderExpenses}
                onPress={() => setIsExpensesExpanded(!isExpensesExpanded)}
                activeOpacity={0.8}
              >
                <View style={styles.sectionHeaderLeft}>
                  <View style={styles.badgeExpenses}>
                    <Wallet size={15} color="#FFB703" />
                  </View>
                  <Text style={styles.sectionTitleExpenses}>খরচসমূহ (Expenses)</Text>
                </View>
                {isExpensesExpanded ? (
                  <ChevronUp size={18} color="#FFB703" />
                ) : (
                  <ChevronDown size={18} color="#FFB703" />
                )}
              </TouchableOpacity>

              {isExpensesExpanded && (
                <View style={[styles.gridContainer, { marginTop: 6 }]}>
                  {/* Row 1: দুধ মিয়া & আকাশ মুরগী */}
                  <View style={[styles.gridItem, styles.gridItemExpenses]}>
                    <View style={[styles.itemIconBadge, { backgroundColor: '#222222', borderWidth: 1, borderColor: '#333333' }]}>
                      <Text style={styles.emojiIcon}>🛍️</Text>
                    </View>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemLabel} numberOfLines={1}>দুধ মিয়া</Text>
                      <View style={[styles.inputContainer, styles.inputContainerExpenses]}>
                        <Text style={styles.currencyPrefix}>৳</Text>
                        <TextInput
                          style={styles.numericInput}
                          keyboardType="numeric"
                          value={pastDudu}
                          onChangeText={setPastDudu}
                          placeholder="0"
                          placeholderTextColor="#555555"
                        />
                      </View>
                    </View>
                  </View>

                  <View style={[styles.gridItem, styles.gridItemExpenses]}>
                    <View style={[styles.itemIconBadge, { backgroundColor: '#222222', borderWidth: 1, borderColor: '#333333' }]}>
                      <Text style={styles.emojiIcon}>🐔</Text>
                    </View>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemLabel} numberOfLines={1}>আকাশ মুরগী</Text>
                      <View style={[styles.inputContainer, styles.inputContainerExpenses]}>
                        <Text style={styles.currencyPrefix}>৳</Text>
                        <TextInput
                          style={styles.numericInput}
                          keyboardType="numeric"
                          value={pastAkash}
                          onChangeText={setPastAkash}
                          placeholder="0"
                          placeholderTextColor="#555555"
                        />
                      </View>
                    </View>
                  </View>

                  {/* Row 2: বার্গার বান & বাজার খরচ */}
                  <View style={[styles.gridItem, styles.gridItemExpenses]}>
                    <View style={[styles.itemIconBadge, { backgroundColor: '#222222', borderWidth: 1, borderColor: '#333333' }]}>
                      <Text style={styles.emojiIcon}>🍔</Text>
                    </View>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemLabel} numberOfLines={1}>বার্গার বান</Text>
                      <View style={[styles.inputContainer, styles.inputContainerExpenses]}>
                        <Text style={styles.currencyPrefix}>৳</Text>
                        <TextInput
                          style={styles.numericInput}
                          keyboardType="numeric"
                          value={pastBurger}
                          onChangeText={setPastBurger}
                          placeholder="0"
                          placeholderTextColor="#555555"
                        />
                      </View>
                    </View>
                  </View>

                  <View style={[styles.gridItem, styles.gridItemExpenses]}>
                    <View style={[styles.itemIconBadge, { backgroundColor: '#222222', borderWidth: 1, borderColor: '#333333' }]}>
                      <Text style={styles.emojiIcon}>🛒</Text>
                    </View>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemLabel} numberOfLines={1}>বাজার খরচ</Text>
                      <View style={[styles.inputContainer, styles.inputContainerExpenses]}>
                        <Text style={styles.currencyPrefix}>৳</Text>
                        <TextInput
                          style={styles.numericInput}
                          keyboardType="numeric"
                          value={pastBazar}
                          onChangeText={setPastBazar}
                          placeholder="0"
                          placeholderTextColor="#555555"
                        />
                      </View>
                    </View>
                  </View>

                  {/* Row 3: অন্যান্য খরচ & ইজারা (Ijara) */}
                  <View style={[styles.gridItem, styles.gridItemExpenses]}>
                    <View style={[styles.itemIconBadge, { backgroundColor: '#222222', borderWidth: 1, borderColor: '#333333' }]}>
                      <Text style={styles.emojiIcon}>📦</Text>
                    </View>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemLabel} numberOfLines={1}>অন্যান্য খরচ</Text>
                      <View style={[styles.inputContainer, styles.inputContainerExpenses]}>
                        <Text style={styles.currencyPrefix}>৳</Text>
                        <TextInput
                          style={styles.numericInput}
                          keyboardType="numeric"
                          value={pastOthers}
                          onChangeText={setPastOthers}
                          placeholder="0"
                          placeholderTextColor="#555555"
                        />
                      </View>
                    </View>
                  </View>

                  <View style={[styles.gridItem, styles.gridItemExpenses]}>
                    <View style={[styles.itemIconBadge, { backgroundColor: '#222222', borderWidth: 1, borderColor: '#333333' }]}>
                      <Text style={styles.emojiIcon}>🏛️</Text>
                    </View>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemLabel} numberOfLines={1}>ইজারা (Ijara)</Text>
                      <View style={[styles.inputContainer, styles.inputContainerExpenses]}>
                        <Text style={styles.currencyPrefix}>৳</Text>
                        <TextInput
                          style={styles.numericInput}
                          keyboardType="numeric"
                          value={pastIjara}
                          onChangeText={setPastIjara}
                          placeholder="0"
                          placeholderTextColor="#555555"
                        />
                      </View>
                    </View>
                  </View>
                </View>
              )}
            </View>

            {/* SECTION 3: Owner কে জমা (Deposit) */}
            <View style={styles.depositCard}>
              <View style={styles.depositLeft}>
                <View style={styles.depositIconBadge}>
                  <User size={17} color="#34D399" />
                </View>
                <Text style={styles.depositTitle}>Owner কে জমা (Deposit)</Text>
              </View>
              <View style={styles.depositInputContainer}>
                <Text style={styles.depositCurrency}>৳</Text>
                <TextInput
                  style={styles.depositInput}
                  keyboardType="numeric"
                  value={pastDeposit}
                  onChangeText={setPastDeposit}
                  placeholder="0"
                  placeholderTextColor="#059669"
                />
              </View>
            </View>

            {/* NOTE SECTION */}
            <View style={styles.noteSection}>
              <View style={styles.noteHeader}>
                <View style={styles.noteBadge}>
                  <FileText size={13} color="#FFB703" />
                </View>
                <Text style={styles.noteLabel}>নোট (ঐচ্ছিক)</Text>
              </View>
              <TextInput
                style={styles.noteInput}
                value={pastNote}
                onChangeText={setPastNote}
                placeholder="অতিরিক্ত তথ্য লিখুন..."
                placeholderTextColor="#555555"
                multiline
                numberOfLines={3}
              />
            </View>

            {/* ADMIN ONLY DELETE BUTTON (WHEN EDITING) */}
            {isEditingPast && onDelete && (
              <TouchableOpacity
                style={styles.deleteButton}
                activeOpacity={0.8}
                onPress={() => {
                  Alert.alert(
                    "হিসাব মুছে ফেলা",
                    "এই হিসাবটি স্থায়ীভাবে মুছে ফেলা হবে। আপনি কি নিশ্চিত?",
                    [
                      { text: "বাতিল", style: "cancel" },
                      {
                        text: "হ্যাঁ, মুছে ফেলুন",
                        style: "destructive",
                        onPress: () => {
                          onDelete(pastDate);
                          onClose();
                        }
                      }
                    ]
                  );
                }}
              >
                <Text style={styles.deleteButtonText}>🗑️ ডিলিট করুন (Admin Only)</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {/* BOTTOM ACTIONS */}
          <View style={styles.bottomActions}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onClose}
              activeOpacity={0.8}
            >
              <X size={16} color="#FFFFFF" />
              <Text style={styles.cancelBtnText}>বাতিল</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.saveBtn}
              onPress={handleSavePress}
              activeOpacity={0.85}
            >
              <Send size={16} color="#000000" />
              <Text style={styles.saveBtnText}>সেভ করুন</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#0D0D0D',
    paddingTop: Platform.OS === 'android' ? (RNStatusBar.currentHeight || 0) : 0,
  },
  modalCard: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#0D0D0D',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 12 : 12,
  },
  grabberBar: {
    width: 36,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: '#374151',
    alignSelf: 'center',
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10
  },
  headerIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 183, 3, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 183, 3, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10
  },
  headerTextGroup: {
    flex: 1
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2
  },
  headerSubtitle: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 1
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center'
  },
  scrollArea: {
    width: '100%'
  },
  scrollContent: {
    paddingBottom: 10
  },

  // Date Section
  dateSection: {
    marginBottom: 8
  },
  fieldLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 3
  },
  dateSelector: {
    height: 40,
    borderRadius: 10,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  dateLeft: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  dateText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
    marginLeft: 8
  },

  // Section 1: Sales
  sectionSales: {
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 14,
    padding: 8,
    marginBottom: 8
  },
  sectionHeaderSales: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6
  },
  badgeSales: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 183, 3, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7
  },
  sectionTitleSales: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700'
  },

  // Grid
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8
  },
  gridItem: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 9,
    padding: 5
  },
  gridItemExpenses: {
    backgroundColor: '#1A1A1A',
    borderColor: '#262626'
  },
  itemIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6
  },
  emojiIcon: {
    fontSize: 16
  },
  itemInfo: {
    flex: 1
  },
  itemLabel: {
    color: '#94A3B8',
    fontSize: 10.5,
    fontWeight: '600',
    marginBottom: 2
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 6,
    height: 26,
    paddingHorizontal: 5
  },
  inputContainerExpenses: {
    backgroundColor: '#0D0D0D',
    borderColor: '#262626'
  },
  currencyPrefix: {
    color: '#94A3B8',
    fontSize: 10.5,
    fontWeight: '600',
    marginRight: 2
  },
  numericInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    padding: 0,
    height: '100%'
  },

  // Section 2: Expenses
  sectionExpenses: {
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 14,
    padding: 8,
    marginBottom: 8
  },
  sectionHeaderExpenses: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  badgeExpenses: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 183, 3, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7
  },
  sectionTitleExpenses: {
    color: '#FFB703',
    fontSize: 13,
    fontWeight: '700'
  },

  // Section 3: Deposit
  depositCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  depositLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8
  },
  depositIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8
  },
  depositTitle: {
    color: '#34D399',
    fontSize: 12.5,
    fontWeight: '700'
  },
  depositInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    borderRadius: 7,
    height: 28,
    width: 100,
    paddingHorizontal: 6
  },
  depositCurrency: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '700',
    marginRight: 2
  },
  depositInput: {
    flex: 1,
    color: '#34D399',
    fontSize: 12,
    fontWeight: '700',
    padding: 0,
    height: '100%'
  },

  // Note Section
  noteSection: {
    marginBottom: 8
  },
  noteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4
  },
  noteBadge: {
    width: 22,
    height: 22,
    borderRadius: 5,
    backgroundColor: 'rgba(255, 183, 3, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6
  },
  noteLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600'
  },
  noteInput: {
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 10,
    padding: 8,
    minHeight: 52,
    color: '#FFFFFF',
    fontSize: 12,
    textAlignVertical: 'top'
  },

  // Admin Delete
  deleteButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
    marginBottom: 6
  },
  deleteButtonText: {
    color: '#EF4444',
    fontWeight: '700',
    fontSize: 12
  },

  // Bottom Actions
  bottomActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2
  },
  cancelBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#333333',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6
  },
  cancelBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700'
  },
  saveBtn: {
    flex: 1.4,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#FFB703',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6
  },
  saveBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700'
  }
});
