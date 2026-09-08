import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Platform,
  ActivityIndicator,
  Modal,
  Alert,
  BackHandler
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDeleteHistory, formatDisplayDate, getBusinessDateFromISO, getBusinessDate } from '../database';

const { width } = Dimensions.get('window');

const recordTypes = ['সব', 'অর্ডার', 'খরচ', 'জমা', 'ডেলিভারি', 'মেনু', 'অন্যান্য'];

const recordTypeIcons = {
  Orders: "🛒",
  Expenses: "💸",
  Deposits: "🏦",
  "Daily Submit": "🏦",
  Supplier: "🚚",
  "Supplier Payment": "🚚",
  "Supplier Due": "🚚",
  "Menu Items": "🍔",
  Users: "👤",
  Deliveries: "🛵",
  Payments: "💰",
  Tables: "🪑",
  Categories: "📂",
  Weather: "🌤️",
  OffDays: "📅",
  Eja: "🏠",
};

// Map Bengali filter to English record types
const filterToRecordType = {
  'সব': null,
  'অর্ডার': 'Orders',
  'খরচ': 'Expenses',
  'জমা': ['Deposits', 'Daily Submit'],
  'ডেলিভারি': 'Deliveries',
  'মেনু': 'Menu Items',
  'অন্যান্য': ['Users', 'Payments', 'Tables', 'Categories', 'Weather', 'OffDays', 'Eja', 'Supplier', 'Supplier Payment', 'Supplier Due'],
};

// Bengali labels for record types
const recordTypeBengali = {
  Orders: "অর্ডার",
  Expenses: "খরচ",
  Deposits: "জমা",
  "Daily Submit": "দৈনিক জমা",
  Supplier: "সাপ্লায়ার",
  "Supplier Payment": "সাপ্লায়ার পেমেন্ট",
  "Supplier Due": "সাপ্লায়ার বাকি",
  "Menu Items": "মেনু আইটেম",
  Users: "ব্যবহারকারী",
  Deliveries: "ডেলিভারি",
  Payments: "পেমেন্ট",
  Tables: "টেবিল",
  Categories: "ক্যাটাগরি",
  Weather: "আবহাওয়া",
  OffDays: "ছুটির দিন",
  Eja: "ইজা",
};

// --- CUSTOM CALENDAR PICKER COMPONENT ---
const CalendarPicker = ({ visible, onClose, onSelectDate }) => {
  const [viewDate, setViewDate] = useState(new Date());
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay();

  const currentYear = viewDate.getFullYear();
  const currentMonth = viewDate.getMonth();
  
  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);

  const handlePrevMonth = () => setViewDate(new Date(currentYear, currentMonth - 1, 1));
  const handleNextMonth = () => setViewDate(new Date(currentYear, currentMonth + 1, 1));

  const handleSelect = (day) => {
    const d = new Date(currentYear, currentMonth, day);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const selected = `${y}-${m}-${dd}`;
    onSelectDate(selected);
    onClose();
  };

  const calendarDays = [];
  for (let i = 0; i < firstDay; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  return (
    <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.calendarOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.calendarContent}>
          <View style={styles.calendarHeader}>
            <TouchableOpacity onPress={handlePrevMonth}><Text style={styles.calNav}>◀</Text></TouchableOpacity>
            <Text style={styles.calTitle}>{months[currentMonth]} {currentYear}</Text>
            <TouchableOpacity onPress={handleNextMonth}><Text style={styles.calNav}>▶</Text></TouchableOpacity>
          </View>
          <View style={styles.calWeekRow}>
            {days.map((d, i) => <Text key={i} style={styles.calWeekDay}>{d}</Text>)}
          </View>
          <View style={styles.calGrid}>
            {calendarDays.map((day, idx) => (
              <TouchableOpacity 
                key={idx} 
                style={[styles.calDayCell, !day && { opacity: 0 }]} 
                disabled={!day}
                onPress={() => handleSelect(day)}
              >
                <Text style={styles.calDayText}>{day}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.calCloseBtn} onPress={onClose}>
            <Text style={styles.calCloseBtnText}>বন্ধ করুন</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

export default function DeleteHistoryScreen({ onBack }) {
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [filterType, setFilterType] = useState('All');
  const [filterDate, setFilterDate] = useState(''); // YYYY-MM-DD
  const [selectedItem, setSelectedItem] = useState(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [calendarVisible, setCalendarVisible] = useState(false);

  // Android Back Handler for Modals
  useEffect(() => {
    const backAction = () => {
      if (detailVisible) { setDetailVisible(false); return true; }
      if (calendarVisible) { setCalendarVisible(false); return true; }
      return false; // Let App.js handle screen back
    };

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      backAction
    );

    return () => backHandler.remove();
  }, [detailVisible, calendarVisible]);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = () => {
    setLoading(true);
    try {
      const data = getDeleteHistory(); // Fetch all
      setHistory(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const filteredHistory = history.filter(item => {
    // Hide associated order rows (order_items, payments, due_payments) from list UI
    if (
      item.id.startsWith('delh_order_items_') ||
      item.id.startsWith('delh_payments_') ||
      item.id.startsWith('delh_due_payments_')
    ) {
      return false;
    }

    // Type Filter (Bengali to English mapping)
    const mappedType = filterToRecordType[filterType];
    let matchesType = false;
    if (filterType === 'সব') {
      matchesType = true;
    } else if (Array.isArray(mappedType)) {
      matchesType = mappedType.includes(item.record_type);
    } else {
      matchesType = item.record_type === mappedType;
    }
    
    // Date Filter
    let matchesDate = true;
    if (filterDate) {
      const itemDate = getBusinessDateFromISO(item.deleted_at);
      matchesDate = itemDate === filterDate;
    }
    
    return matchesType && matchesDate;
  });

  const handleShowDetail = (item) => {
    setSelectedItem(item);
    setDetailVisible(true);
  };

  const renderDetailContent = () => {
    if (!selectedItem) return null;
    let snapshot = {};
    try {
      snapshot = JSON.parse(selectedItem.snapshot_data);
    } catch (e) {
      console.error(e);
    }

    const isOrder = selectedItem.record_type === 'Orders';
    let parsedItems = [];
    if (isOrder && snapshot.items) {
      try {
        parsedItems = JSON.parse(snapshot.items);
      } catch (err) {
        parsedItems = [];
      }
    }

    const icon = recordTypeIcons[selectedItem.record_type] || "🗑️";
    const typeLabel = recordTypeBengali[selectedItem.record_type] || selectedItem.record_type;

    return (
      <View style={styles.detailCard}>
        <Text style={styles.detailTitle}>{icon} মুছে ফেলা হয়েছে</Text>
        <Text style={styles.detailSubtitle}>{typeLabel}</Text>

        <View style={styles.detailDivider} />

        <ScrollView style={styles.detailScroll}>
          {isOrder ? (
            <View style={{ width: '100%' }}>
              <View style={styles.detailRow}>
                <Text style={styles.detailKey}>টেবিল:</Text>
                <Text style={styles.detailValue}>{snapshot.table_id || 'N/A'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailKey}>মোট টাকা:</Text>
                <Text style={[styles.detailValue, { color: '#34D399', fontWeight: 'bold' }]}>৳{snapshot.grand_total || 0}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailKey}>পেমেন্ট মাধ্যম:</Text>
                <Text style={styles.detailValue}>{snapshot.payment_method || 'N/A'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailKey}>সময়:</Text>
                <Text style={styles.detailValue}>{snapshot.time || 'N/A'}</Text>
              </View>

              <Text style={[styles.detailKey, { marginTop: 16, marginBottom: 8, color: '#FFB703' }]}>অর্ডার আইটেম:</Text>
              <View style={{ backgroundColor: '#1A1A1A', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#333' }}>
                {parsedItems.map((item, idx) => {
                  const name = item.name || item.itemName || 'Unknown Item';
                  const qty = item.quantity || 1;
                  const amt = item.revenue || (qty * (item.unitPrice || 0));
                  return (
                    <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                      <Text style={{ color: '#FFF', fontSize: 12 }}>• {name} x{qty}</Text>
                      <Text style={{ color: '#888', fontSize: 12 }}>৳{amt}</Text>
                    </View>
                  );
                })}
                {parsedItems.length === 0 && (
                  <Text style={{ color: '#666', fontStyle: 'italic', fontSize: 11 }}>কোনো আইটেম নেই।</Text>
                )}
              </View>
            </View>
          ) : (
            Object.entries(snapshot).map(([key, value]) => {
              if (key === 'is_synced' || key === 'id' || key === 'snapshot_data') return null;
              return (
                <View key={key} style={styles.detailRow}>
                  <Text style={styles.detailKey}>{key.replace(/_/g, ' ').toUpperCase()}:</Text>
                  <Text style={styles.detailValue}>{String(value)}</Text>
                </View>
              );
            })
          )}
        </ScrollView>

        <View style={styles.detailDivider} />

        <View style={styles.detailFooter}>
          <Text style={styles.footerText}>মুছেছেন: {selectedItem.deleted_by}</Text>
          <Text style={styles.footerText}>সময়: {formatDisplayDate(selectedItem.deleted_at)}</Text>
        </View>

        <TouchableOpacity 
          style={styles.detailCloseBtn} 
          onPress={() => setDetailVisible(false)}
        >
          <Text style={styles.detailCloseBtnText}>বন্ধ করুন</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>◁ ফিরে যান</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🗑️ মুছে ফেলার ইতিহাস</Text>
        <TouchableOpacity onPress={loadHistory} style={styles.refreshBtn}>
          <Text style={styles.refreshBtnText}>🔄</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {recordTypes.map(type => (
            <TouchableOpacity 
              key={type} 
              style={[styles.filterBtn, filterType === type && styles.filterBtnActive]}
              onPress={() => setFilterType(type)}
            >
              <Text style={[styles.filterBtnText, filterType === type && styles.filterBtnTextActive]}>
                {type}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.dateFilterRow}>
        <TouchableOpacity 
          style={styles.datePickerBtn}
          onPress={() => setCalendarVisible(true)}
        >
          <Text style={styles.datePickerBtnText}>
            📅 {filterDate ? formatDisplayDate(filterDate) : 'তারিখ নির্বাচন'}
          </Text>
        </TouchableOpacity>
        {filterDate ? (
          <TouchableOpacity 
            style={styles.clearDateBtn}
            onPress={() => setFilterDate('')}
          >
            <Text style={styles.clearDateText}>✕ মুছুন</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FFB703" />
        </View>
      ) : (
        <ScrollView style={styles.list}>
          {filteredHistory.length === 0 ? (
            <Text style={styles.emptyText}>কোনো মুছে ফেলার রেকর্ড পাওয়া যায়নি।</Text>
          ) : (
            filteredHistory.map((item, idx) => {
              // Parse snapshot to show meaningful info
              let snapshot = {};
              try { snapshot = JSON.parse(item.snapshot_data); } catch (e) {}
              
              // Build description based on type
              let description = '';
              let amount = null;
              
              if (item.record_type === 'Orders') {
                amount = snapshot.grand_total;
                description = `টেবিল ${snapshot.table_id || '-'}`;
                if (snapshot.items) {
                  try {
                    const items = JSON.parse(snapshot.items);
                    if (items.length > 0) {
                      const firstItem = items[0].name || items[0].itemName || '';
                      description += ` • ${firstItem}${items.length > 1 ? ` +${items.length - 1}` : ''}`;
                    }
                  } catch (e) {}
                }
              } else if (item.record_type === 'Expenses') {
                amount = snapshot.amount;
                description = snapshot.category || 'খরচ';
                if (snapshot.note) description += ` • ${snapshot.note}`;
              } else if (item.record_type === 'Deposits' || item.record_type === 'Daily Submit') {
                amount = snapshot.amount || snapshot.total_sell;
                description = `${snapshot.month || snapshot.date || ''}`;
              } else if (item.record_type === 'Deliveries') {
                amount = snapshot.amount;
                description = snapshot.customer_name || 'ডেলিভারি';
              } else if (item.record_type === 'Menu Items') {
                description = snapshot.name || 'মেনু আইটেম';
                if (snapshot.price) amount = snapshot.price;
              } else if (item.record_type === 'Payments') {
                amount = snapshot.total_amount;
                description = `অর্ডার ${snapshot.order_id || '-'}`;
              } else {
                description = item.record_id;
              }

              return (
                <TouchableOpacity 
                  key={item.id} 
                  style={styles.historyCard}
                  onPress={() => handleShowDetail(item)}
                >
                  <View style={styles.cardIconContainer}>
                    <Text style={styles.cardIcon}>{recordTypeIcons[item.record_type] || "🗑️"}</Text>
                  </View>
                  <View style={styles.cardContent}>
                    <View style={styles.cardTopRow}>
                      <Text style={styles.cardType}>{recordTypeBengali[item.record_type] || item.record_type}</Text>
                      {amount != null && (
                        <Text style={styles.cardAmount}>৳{Number(amount).toLocaleString()}</Text>
                      )}
                    </View>
                    <Text style={styles.cardDescription} numberOfLines={1}>{description}</Text>
                    <Text style={styles.cardTime}>{formatDisplayDate(item.deleted_at)} • {item.deleted_by}</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}

      <Modal visible={detailVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          {renderDetailContent()}
        </View>
      </Modal>

      <CalendarPicker 
        visible={calendarVisible}
        onClose={() => setCalendarVisible(false)}
        onSelectDate={(date) => setFilterDate(date)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
    backgroundColor: '#0D0D0D',
  },
  backBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#1E1E1E',
  },
  backBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  refreshBtn: {
    padding: 4,
  },
  refreshBtnText: {
    color: '#FFB703',
  },
  filterBar: {
    paddingVertical: 12,
    paddingLeft: 16,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
  },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  filterBtnActive: {
    backgroundColor: '#FFB703',
    borderColor: '#FFB703',
  },
  filterBtnText: {
    color: '#888',
    fontSize: 12,
    fontWeight: 'bold',
  },
  filterBtnTextActive: {
    color: '#000',
  },
  dateFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#0A0A0A',
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
    gap: 12,
  },
  datePickerBtn: {
    flex: 1,
    height: 40,
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  datePickerBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  clearDateBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  clearDateText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: 'bold',
  },
  list: {
    flex: 1,
    padding: 16,
  },
  historyCard: {
    flexDirection: 'row',
    backgroundColor: '#161616',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#262626',
    alignItems: 'center',
  },
  cardIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#1E1E1E',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  cardIcon: {
    fontSize: 20,
  },
  cardContent: {
    flex: 1,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardType: {
    color: '#FFB703',
    fontWeight: 'bold',
    fontSize: 14,
  },
  cardAmount: {
    color: '#EF4444',
    fontWeight: 'bold',
    fontSize: 14,
  },
  cardDescription: {
    color: '#FFFFFF',
    fontSize: 13,
    marginBottom: 4,
  },
  cardTime: {
    color: '#A1A1AA',
    fontSize: 11,
  },
  emptyText: {
    color: '#666',
    textAlign: 'center',
    marginTop: 40,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  detailCard: {
    backgroundColor: '#0D0D0D',
    borderRadius: 20,
    width: '100%',
    maxHeight: '80%',
    padding: 20,
    borderWidth: 1,
    borderColor: '#FFB703',
  },
  detailTitle: {
    color: '#FFB703',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  detailSubtitle: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
  detailDivider: {
    height: 1,
    backgroundColor: '#1A1A1A',
    marginVertical: 16,
  },
  detailScroll: {
    flexGrow: 0,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderColor: '#080808',
  },
  detailKey: {
    color: '#888',
    fontSize: 11,
    fontWeight: 'bold',
    flex: 1,
  },
  detailValue: {
    color: '#FFF',
    fontSize: 11,
    flex: 2,
    textAlign: 'right',
  },
  detailFooter: {
    gap: 4,
  },
  footerText: {
    color: '#666',
    fontSize: 10,
  },
  detailCloseBtn: {
    marginTop: 20,
    backgroundColor: '#FFB703',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  detailCloseBtnText: {
    color: '#000',
    fontWeight: 'bold',
  },
  calendarOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  calendarContent: {
    backgroundColor: '#111',
    width: width * 0.85,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#333',
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  calNav: {
    color: '#FFB703',
    fontSize: 20,
    paddingHorizontal: 10,
  },
  calTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  calWeekRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 10,
  },
  calWeekDay: {
    color: '#666',
    fontSize: 12,
    width: 35,
    textAlign: 'center',
  },
  calGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
  },
  calDayCell: {
    width: 35,
    height: 35,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 5,
    borderRadius: 17,
  },
  calDayText: {
    color: '#FFF',
    fontSize: 13,
  },
  calCloseBtn: {
    marginTop: 20,
    height: 44,
    backgroundColor: '#1E1E1E',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  calCloseBtnText: {
    color: '#888',
    fontSize: 14,
  }
});
