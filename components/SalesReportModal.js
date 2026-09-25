import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Platform,
  StatusBar as RNStatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import {
  Calendar,
  FileText,
  X,
  Printer,
  CloudDownload
} from 'lucide-react-native';
import { formatDisplayDate as defaultFormatDisplayDate } from '../database';

const { width } = Dimensions.get('window');

// Clean Delivery Scooter Vector Icon (Zero Unicode Emoji)
const ScooterIcon = ({ size = 12, color = '#FB7185' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="6" cy="18" r="3" stroke={color} strokeWidth="2" />
    <Circle cx="18" cy="18" r="3" stroke={color} strokeWidth="2" />
    <Path
      d="M6 18H10L14 10H17"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Path d="M15 6H19" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <Path d="M17 6V10" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <Path d="M9 13H13" stroke={color} strokeWidth="2" strokeLinecap="round" />
  </Svg>
);

const monthNamesShort = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

const formatCardDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const day = d.getDate();
  const month = monthNamesShort[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
};

const formatShortDayMonth = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const day = d.getDate();
  const month = monthNamesShort[d.getMonth()];
  return `${day} ${month}`;
};

// Dynamic color badge generator for table / delivery identifiers
const getTableBadgeStyle = (label, isDelivery) => {
  if (isDelivery || String(label).toLowerCase().includes('delivery')) {
    return {
      bg: 'rgba(244, 63, 94, 0.12)',
      border: 'rgba(244, 63, 94, 0.35)',
      text: '#FB7185'
    };
  }
  const clean = String(label).trim().toUpperCase();
  if (clean.includes('T-4') || clean.includes('4')) {
    return {
      bg: 'rgba(249, 115, 22, 0.12)',
      border: 'rgba(249, 115, 22, 0.35)',
      text: '#FB923C'
    };
  }
  if (clean.includes('T-2') || clean.includes('2')) {
    return {
      bg: 'rgba(16, 185, 129, 0.12)',
      border: 'rgba(16, 185, 129, 0.35)',
      text: '#34D399'
    };
  }
  if (clean.includes('T-3') || clean.includes('3')) {
    return {
      bg: 'rgba(59, 130, 246, 0.12)',
      border: 'rgba(59, 130, 246, 0.35)',
      text: '#60A5FA'
    };
  }
  if (clean.includes('T-1') || clean.includes('1')) {
    return {
      bg: 'rgba(255, 183, 3, 0.12)',
      border: 'rgba(255, 183, 3, 0.35)',
      text: '#FFB703'
    };
  }
  return {
    bg: 'rgba(255, 183, 3, 0.12)',
    border: 'rgba(255, 183, 3, 0.35)',
    text: '#FFB703'
  };
};

/**
 * SalesReportModal - বিক্রয় রিপোর্ট
 * Redesigned with Rongdhonu canonical dark & gold theme:
 * - Full-screen modal with deep dark background (#0D0D0D)
 * - Header: Golden amber badge (rgba(255,183,3,0.12)), title "বিক্রয় রিপোর্ট", subtitle "বিস্তারিত তথ্য দেখুন", circular close
 * - Date Filters: 4 horizontal cards with Golden Amber (#FFB703) highlight for active filter
 * - Modern Table: Columns for সময়, টেবিল, আইটেম, বিক্রয়, and inline vector printer buttons
 * - Delivery rows with vector Scooter icon and rose badge
 * - Table rows with Rongdhonu accent badges (T-1 gold, T-2 emerald, T-3 blue, T-4 orange)
 * - Green highlighted sales amounts (#34D399) matching deposit report & app
 * - Bottom Action Buttons: [ PDF ডাউনলোড ] (emerald button #34D399) and [ বন্ধ করুন ] (dark button #1E1E1E)
 * - Preserves all existing business logic, filters, PDF generation, printing, and cloud sync
 */
export default function SalesReportModal({
  visible,
  onClose,
  salesFilter = 'Today',
  onSelectFilter,
  pickDate = '',
  onOpenDatePicker,
  orders = [],
  onSelectOrder,
  onPrintOrder,
  onExportPDF,
  onCloudCheck,
  formatDisplayDate = defaultFormatDisplayDate
}) {
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

  const filterCards = [
    {
      key: 'Today',
      title: 'Today',
      subtitle: formatCardDate(today)
    },
    {
      key: 'Yesterday',
      title: 'Yesterday',
      subtitle: formatCardDate(yesterday)
    },
    {
      key: 'Last 7 Days',
      title: 'Last 7 Days',
      subtitle: `${sevenDaysAgo.getDate()} - ${formatShortDayMonth(today)}`
    },
    {
      key: 'Pick Date',
      title: 'Pick Date',
      subtitle: pickDate && !pickDate.includes('সিলেক্ট') ? pickDate : 'Select Range'
    }
  ];

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
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIconBadge}>
                <FileText size={22} color="#FFB703" strokeWidth={2.2} />
              </View>
              <View style={styles.headerTextCol}>
                <Text style={styles.headerTitle}>বিক্রয় রিপোর্ট</Text>
                <Text style={styles.headerSubtitle}>বিস্তারিত তথ্য দেখুন</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.closeCircle}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <X size={16} color="#94A3B8" strokeWidth={2.2} />
            </TouchableOpacity>
          </View>

          {/* 4 Horizontal Date Filter Cards */}
          <View style={styles.filterCardsRow}>
            {filterCards.map((card) => {
              const isActive = salesFilter === card.key;
              return (
                <TouchableOpacity
                  key={card.key}
                  style={[
                    styles.filterCard,
                    isActive && styles.filterCardActive
                  ]}
                  activeOpacity={0.8}
                  onPress={() => {
                    if (onSelectFilter) {
                      onSelectFilter(card.key);
                    }
                    if (card.key === 'Pick Date' && onOpenDatePicker) {
                      onOpenDatePicker();
                    }
                  }}
                >
                  <View style={styles.filterCardTop}>
                    <Calendar
                      size={12}
                      color={isActive ? '#000000' : '#FFB703'}
                      style={{ marginRight: 4 }}
                    />
                    <Text
                      style={[
                        styles.filterCardTitle,
                        isActive && styles.filterCardTitleActive
                      ]}
                      numberOfLines={1}
                    >
                      {card.title}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.filterCardSubtitle,
                      isActive && styles.filterCardSubtitleActive
                    ]}
                    numberOfLines={1}
                  >
                    {card.subtitle}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Persistent Cloud Catch-up Banner */}
          {salesFilter !== 'Today' && onCloudCheck && (
            <View style={styles.cloudBanner}>
              <View style={styles.cloudBannerLeft}>
                <Text style={styles.cloudBannerText}>
                  এই মাসের সম্পূর্ণ ডাটা লোকাল ডিভাইসে নাও থাকতে পারে।
                </Text>
              </View>
              <TouchableOpacity
                style={styles.cloudDownloadBtn}
                onPress={onCloudCheck}
                activeOpacity={0.8}
              >
                <CloudDownload size={13} color="#000000" strokeWidth={2.2} style={{ marginRight: 5 }} />
                <Text style={styles.cloudDownloadText}>ক্লাউড ডাউনলোড</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Sales Table Container */}
          <View style={styles.tableContainer}>
            {/* Table Header Row (Shared 1:1 Grid Layout with Rows) */}
            <View style={styles.tableHeaderRow}>
              <View style={styles.colTime}>
                <Text style={[styles.thText, styles.textLeft]}>সময়</Text>
              </View>
              <View style={styles.colTable}>
                <Text style={[styles.thText, styles.textCenter]}>টেবিল</Text>
              </View>
              <View style={styles.colItem}>
                <Text style={[styles.thText, styles.textLeft]}>আইটেম</Text>
              </View>
              <View style={styles.colSale}>
                <Text style={[styles.thText, styles.textRight]}>বিক্রয়</Text>
              </View>
              <View style={styles.colAction} />
            </View>

            {/* Table Body (Vertical Scroll) */}
            <ScrollView
              style={styles.tableScrollBody}
              contentContainerStyle={styles.tableScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {orders.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <FileText size={38} color="#333333" style={{ marginBottom: 12 }} />
                  <Text style={styles.emptyText}>কোনো বিক্রয় ইতিহাস পাওয়া যায়নি।</Text>
                  {onCloudCheck && (
                    <TouchableOpacity
                      style={styles.emptyCloudBtn}
                      onPress={onCloudCheck}
                      activeOpacity={0.8}
                    >
                      <CloudDownload size={15} color="#000000" strokeWidth={2.2} style={{ marginRight: 6 }} />
                      <Text style={styles.emptyCloudBtnText}>ক্লাউড থেকে ডাটা আনুন</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                orders.map((order, idx) => {
                  const isDeliveryOrder =
                    Boolean(order.isDelivery) ||
                    (order.deliveryCharge && parseFloat(order.deliveryCharge) > 0) ||
                    String(order.tableId || order.table || '').toLowerCase().includes('delivery') ||
                    String(order.tableId || order.table || '').toLowerCase().includes('ডেলিভারি');

                  const rawTable = String(order.tableId || order.table || (isDeliveryOrder ? 'Delivery' : 'T-1')).trim();
                  const badgeStyle = getTableBadgeStyle(rawTable, isDeliveryOrder);

                  const orderTime = order.time || '--:--';
                  const orderDate = order.fullDate
                    ? formatDisplayDate(order.fullDate)
                    : 'আজ';

                  const itemSummary = Array.isArray(order.items)
                    ? order.items.map((i) => `${i.name} x${i.qty || 1}`).join(', ')
                    : String(order.items || 'আইটেম তথ্য নেই');

                  const paidAmt =
                    order.paidAmount ??
                    order.amount ??
                    order.totalAmount ??
                    order.grandTotal ??
                    0;

                  return (
                    <TouchableOpacity
                      key={order.id ? String(order.id) : `order-${idx}`}
                      style={[
                        styles.tableRow,
                        idx === orders.length - 1 && styles.tableRowLast
                      ]}
                      activeOpacity={0.7}
                      onPress={() => onSelectOrder && onSelectOrder(order)}
                    >
                      {/* 1. Time & Date */}
                      <View style={styles.colTime}>
                        <Text style={styles.timeMainText}>{orderTime}</Text>
                        <Text style={styles.timeSubText}>{orderDate}</Text>
                      </View>

                      {/* 2. Table / Delivery Badge */}
                      <View style={styles.colTable}>
                        <View
                          style={[
                            styles.badgePill,
                            {
                              backgroundColor: badgeStyle.bg,
                              borderColor: badgeStyle.border
                            }
                          ]}
                        >
                          {isDeliveryOrder ? (
                            <View style={styles.deliveryBadgeRow}>
                              <ScooterIcon size={11} color={badgeStyle.text} />
                              <Text
                                style={[
                                  styles.badgeText,
                                  { color: badgeStyle.text, marginLeft: 3 }
                                ]}
                                numberOfLines={1}
                              >
                                Delivery
                              </Text>
                            </View>
                          ) : (
                            <Text
                              style={[
                                styles.badgeText,
                                { color: badgeStyle.text }
                              ]}
                              numberOfLines={1}
                            >
                              {rawTable}
                            </Text>
                          )}
                        </View>
                      </View>

                      {/* 3. Items */}
                      <View style={styles.colItem}>
                        <Text style={styles.itemSummaryText} numberOfLines={2}>
                          {itemSummary}
                        </Text>
                      </View>

                      {/* 4. Sale Amount */}
                      <View style={styles.colSale}>
                        <Text style={styles.saleAmountText}>
                          ৳{Number(paidAmt).toLocaleString()}
                        </Text>
                      </View>

                      {/* 5. Printer Button */}
                      <View style={styles.colAction}>
                        <TouchableOpacity
                          style={styles.printerBtn}
                          activeOpacity={0.75}
                          onPress={(e) => {
                            e.stopPropagation();
                            if (onPrintOrder) {
                              onPrintOrder(order);
                            }
                          }}
                        >
                          <Printer size={15} color="#FFB703" strokeWidth={2} />
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>

          {/* Bottom Action Buttons: [ PDF ডাউনলোড ] (Large Green) & [ বন্ধ করুন ] (Dark) */}
          <View style={styles.bottomActions}>
            <TouchableOpacity
              style={styles.pdfBtn}
              onPress={onExportPDF}
              activeOpacity={0.85}
            >
              <FileText size={17} color="#000000" strokeWidth={2.2} style={{ marginRight: 6 }} />
              <Text style={styles.pdfBtnText}>PDF ডাউনলোড</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.closeActionBtn}
              onPress={onClose}
              activeOpacity={0.8}
            >
              <X size={16} color="#FFFFFF" strokeWidth={2.2} style={{ marginRight: 6 }} />
              <Text style={styles.closeActionBtnText}>বন্ধ করুন</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: Platform.OS === 'android' ? (RNStatusBar.currentHeight || 0) + 6 : 10,
    paddingBottom: Platform.OS === 'ios' ? 16 : 10,
    paddingHorizontal: 8
  },
  modalCard: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#0D0D0D',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#262626',
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 12
  },

  // Header Row
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10
  },
  headerIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: 'rgba(255, 183, 3, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 183, 3, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12
  },
  headerTextCol: {
    flex: 1
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.2
  },
  headerSubtitle: {
    color: '#94A3B8',
    fontSize: 11.5,
    marginTop: 2,
    fontWeight: '500'
  },
  closeCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center'
  },

  // 4 Horizontal Date Filter Cards
  filterCardsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10
  },
  filterCard: {
    flex: 1,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center'
  },
  filterCardActive: {
    backgroundColor: '#FFB703',
    borderColor: '#FFB703',
    elevation: 3
  },
  filterCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2
  },
  filterCardTitle: {
    color: '#CBD5E1',
    fontSize: 10.5,
    fontWeight: '700'
  },
  filterCardTitleActive: {
    color: '#000000',
    fontWeight: '800'
  },
  filterCardSubtitle: {
    color: '#8E9AA8',
    fontSize: 9,
    fontWeight: '500'
  },
  filterCardSubtitleActive: {
    color: '#262626',
    fontWeight: '700'
  },

  // Persistent Cloud Catch-up Banner
  cloudBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 10
  },
  cloudBannerLeft: {
    flex: 1,
    marginRight: 8
  },
  cloudBannerText: {
    color: '#FFB703',
    fontSize: 10,
    fontWeight: '600'
  },
  cloudDownloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#34D399',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6
  },
  cloudDownloadText: {
    color: '#000000',
    fontSize: 10.5,
    fontWeight: '800'
  },

  // Table Container
  tableContainer: {
    flex: 1,
    backgroundColor: '#121212',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#262626',
    overflow: 'hidden'
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#181818',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderColor: '#262626'
  },
  thText: {
    color: '#FFB703',
    fontSize: 11.5,
    fontWeight: '700'
  },
  textLeft: {
    textAlign: 'left'
  },
  textCenter: {
    textAlign: 'center'
  },
  textRight: {
    textAlign: 'right'
  },

  // Column Widths & Alignments (Shared 1:1 between header and data rows)
  colTime: {
    width: 78,
    alignItems: 'flex-start',
    justifyContent: 'center'
  },
  colTable: {
    width: 66,
    alignItems: 'center',
    justifyContent: 'center'
  },
  colItem: {
    flex: 1,
    paddingHorizontal: 8,
    alignItems: 'flex-start',
    justifyContent: 'center'
  },
  colSale: {
    width: 62,
    alignItems: 'flex-end',
    justifyContent: 'center'
  },
  colActionPlaceholder: {
    width: 34
  },
  colAction: {
    width: 34,
    alignItems: 'center',
    justifyContent: 'center'
  },

  // Table Body Rows
  tableScrollBody: {
    flex: 1
  },
  tableScrollContent: {
    paddingBottom: 6
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderColor: '#1F1F1F'
  },
  tableRowLast: {
    borderBottomWidth: 0
  },

  // Row Column Contents
  timeMainText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700'
  },
  timeSubText: {
    color: '#8E9AA8',
    fontSize: 9.5,
    fontWeight: '500',
    marginTop: 2
  },

  badgePill: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 3,
    alignItems: 'center',
    justifyContent: 'center'
  },
  deliveryBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  badgeText: {
    fontSize: 10.5,
    fontWeight: '800'
  },

  itemSummaryText: {
    color: '#E2E8F0',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500'
  },

  saleAmountText: {
    color: '#34D399',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'right'
  },

  printerBtn: {
    width: 30,
    height: 30,
    borderRadius: 7,
    backgroundColor: '#181818',
    borderWidth: 1,
    borderColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center'
  },

  // Empty State
  emptyContainer: {
    paddingVertical: 40,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center'
  },
  emptyText: {
    color: '#8E9AA8',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 14
  },
  emptyCloudBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#34D399',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8
  },
  emptyCloudBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800'
  },

  // Bottom Actions
  bottomActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10
  },
  pdfBtn: {
    flex: 1.2,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#34D399',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3
  },
  pdfBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '800'
  },
  closeActionBtn: {
    flex: 0.9,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#333333',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center'
  },
  closeActionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700'
  }
});
