import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Modal,
  ActivityIndicator,
  Platform,
  StatusBar as RNStatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getItemSalesReport, getBusinessDate, formatDisplayDate, getQuickFilterDates } from '../database';

const { width } = Dimensions.get('window');

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
    const selectedDate = new Date(currentYear, currentMonth, day);
    // Format to YYYY-MM-DD for database query
    const y = selectedDate.getFullYear();
    const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const d = String(selectedDate.getDate()).padStart(2, '0');
    onSelectDate(`${y}-${m}-${d}`);
    onClose();
  };

  const calendarDays = [];
  for (let i = 0; i < firstDay; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  return (
    <Modal visible={visible} transparent={true} animationType="fade">
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

export default function DailyItemSalesReport({ onBack }) {
  const today = getBusinessDate();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [activeFilter, setActiveFilter] = useState('Today');
  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [calendarVisible, setCalendarVisible] = useState(false);

  useEffect(() => {
    loadReport();
    
    // Auto-refresh every 15 seconds to support Live Update requirement
    const interval = setInterval(() => {
      loadReport();
    }, 15000);
    
    return () => clearInterval(interval);
  }, [startDate, endDate]);

  const loadReport = () => {
    setLoading(true);
    // Using a timeout to ensure UI thread is free if data set is large
    setTimeout(() => {
      const data = getItemSalesReport(startDate, endDate);
      setReportData(data);
      setLoading(false);
    }, 100);
  };

  const handleFilterChange = (filter) => {
    setActiveFilter(filter);
    const dates = getQuickFilterDates(filter);
    setStartDate(dates.start);
    setEndDate(dates.end);
  };

  const handleDateSelect = (dateStr) => {
    setActiveFilter('Custom');
    setStartDate(dateStr);
    setEndDate(dateStr);
  };

  // Sections
  const soldItems = reportData
    .filter(item => item.quantitySold > 0)
    .sort((a, b) => b.quantitySold - a.quantitySold);

  const notSoldItems = reportData
    .filter(item => item.quantitySold === 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Summary Card calculations
  const totalMenuItems = reportData.length;
  const itemsSold = soldItems.length;
  const itemsNotSold = notSoldItems.length;
  const totalPiecesSold = soldItems.reduce((sum, item) => sum + item.quantitySold, 0);
  const totalSalesAmount = soldItems.reduce((sum, item) => sum + item.totalSales, 0);

  const displayDateRange = startDate === endDate 
    ? formatDisplayDate(startDate) 
    : `${formatDisplayDate(startDate)} - ${formatDisplayDate(endDate)}`;

  return (
    <SafeAreaView style={styles.container}>
      <RNStatusBar barStyle="light-content" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backIcon}>⬅</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>আইটেম বিক্রয় রিপোর্ট</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollBody} showsVerticalScrollIndicator={false}>
        
        {/* Filter Section */}
        <View style={styles.filterSection}>
          <View style={styles.dateDisplayRow}>
            <TouchableOpacity 
              style={styles.datePickerBtn} 
              onPress={() => setCalendarVisible(true)}
            >
              <Text style={styles.dateIcon}>📅</Text>
              <Text style={styles.dateText}>{displayDateRange}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.filterBar}>
            {['Today', 'Yesterday', 'This Week'].map((f) => (
              <TouchableOpacity
                key={f}
                style={[styles.filterChip, activeFilter === f && styles.filterChipActive]}
                onPress={() => handleFilterChange(f)}
              >
                <Text style={[styles.filterChipText, activeFilter === f && styles.filterChipTextActive]}>
                  {f === 'Today' ? 'আজ' : f === 'Yesterday' ? 'গতকাল' : 'এই সপ্তাহ'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#FFB703" style={{ marginTop: 50 }} />
        ) : (
          <>
            {/* Summary Card */}
            <View style={styles.summaryCard}>
              <View style={styles.summaryHeader}>
                <Text style={styles.summaryTitle}>সারসংক্ষেপ</Text>
                <Text style={styles.summaryEmoji}>📊</Text>
              </View>
              
              <View style={styles.summaryGrid}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>মোট মেনু আইটেম</Text>
                  <Text style={styles.summaryValue}>{totalMenuItems}</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>বিক্রি হয়েছে</Text>
                  <Text style={[styles.summaryValue, { color: '#34D399' }]}>{itemsSold}</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>বিক্রি হয়নি</Text>
                  <Text style={[styles.summaryValue, { color: '#FB923C' }]}>{itemsNotSold}</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>মোট পিস বিক্রি</Text>
                  <Text style={styles.summaryValue}>{totalPiecesSold} pcs</Text>
                </View>
              </View>

              <View style={styles.summaryFooter}>
                <Text style={styles.totalSalesLabel}>মোট বিক্রয় পরিমাণ</Text>
                <Text style={styles.totalSalesValue}>৳{totalSalesAmount}</Text>
              </View>
            </View>

            {/* Section 1: Sold Items */}
            <View style={styles.sectionContainer}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>🔥 বিক্রি হওয়া আইটেম</Text>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{soldItems.length}</Text>
                </View>
              </View>

              <View style={styles.reportList}>
                <View style={styles.listHeader}>
                  <Text style={[styles.listHeaderText, { flex: 2, textAlign: 'left' }]}>আইটেম নাম</Text>
                  <Text style={[styles.listHeaderText, { flex: 1 }]}>পরিমাণ</Text>
                  <Text style={[styles.listHeaderText, { flex: 1.2, textAlign: 'right' }]}>মোট বিক্রয়</Text>
                </View>

                {soldItems.length > 0 ? (
                  soldItems.map((item, index) => (
                    <View key={index} style={[styles.listItem, index === soldItems.length - 1 && { borderBottomWidth: 0 }]}>
                      <View style={{ flex: 2 }}>
                        <Text style={styles.itemName}>{item.name}</Text>
                        <Text style={styles.itemCategory}>{item.category}</Text>
                      </View>
                      <Text style={[styles.itemQty, { flex: 1 }]}>{item.quantitySold} pcs</Text>
                      <Text style={[styles.itemTotal, { flex: 1.2 }]}>৳{item.totalSales}</Text>
                    </View>
                  ))
                ) : (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyText}>কোনো আইটেম বিক্রি হয়নি</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Section 2: Not Sold Items */}
            <View style={styles.sectionContainer}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>⭕ বিক্রি হয়নি</Text>
                <View style={[styles.badge, { backgroundColor: 'rgba(251, 146, 60, 0.15)' }]}>
                  <Text style={[styles.badgeText, { color: '#FB923C' }]}>{notSoldItems.length}</Text>
                </View>
              </View>

              <View style={styles.reportList}>
                {notSoldItems.length > 0 ? (
                  <View style={styles.notSoldGrid}>
                    {notSoldItems.map((item, index) => (
                      <View key={index} style={styles.notSoldItem}>
                        <Text style={styles.notSoldName}>{item.name}</Text>
                        <Text style={styles.notSoldQty}>0 pcs</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyText}>সব আইটেম বিক্রি হয়েছে!</Text>
                  </View>
                )}
              </View>
            </View>

            <View style={{ height: 40 }} />
          </>
        )}
      </ScrollView>

      <CalendarPicker 
        visible={calendarVisible} 
        onClose={() => setCalendarVisible(false)} 
        onSelectDate={handleDateSelect}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: 16, 
    paddingVertical: 12, 
    borderBottomWidth: 1, 
    borderColor: '#161616', 
    backgroundColor: '#0D0D0D' 
  },
  backButton: { padding: 6 },
  backIcon: { fontSize: 20, color: '#FFB703' },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#FFB703' },
  scrollBody: { flex: 1 },
  filterSection: { padding: 16 },
  dateDisplayRow: { marginBottom: 16 },
  datePickerBtn: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#0D0D0D', 
    paddingVertical: 12, 
    paddingHorizontal: 16, 
    borderRadius: 12, 
    borderWidth: 1, 
    borderColor: '#1A1A1A' 
  },
  dateIcon: { fontSize: 16, marginRight: 10 },
  dateText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  filterBar: { flexDirection: 'row', height: 36 },
  filterChip: { 
    paddingHorizontal: 16, 
    borderRadius: 18, 
    backgroundColor: '#1E1E1E', 
    borderWidth: 1, 
    borderColor: '#333', 
    marginRight: 8, 
    height: 32, 
    justifyContent: 'center' 
  },
  filterChipActive: { backgroundColor: '#FFB703', borderColor: '#FFB703' },
  filterChipText: { color: '#888', fontSize: 12, fontWeight: '500' },
  filterChipTextActive: { color: '#000', fontWeight: 'bold' },
  
  // Summary Card
  summaryCard: { 
    backgroundColor: 'rgba(15, 23, 42, 0.6)', 
    marginHorizontal: 16, 
    borderRadius: 20, 
    padding: 20, 
    borderWidth: 1, 
    borderColor: 'rgba(96, 165, 250, 0.3)',
    marginBottom: 24
  },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  summaryTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  summaryEmoji: { fontSize: 18 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  summaryItem: { width: '48%', marginBottom: 16 },
  summaryLabel: { color: '#888', fontSize: 11, marginBottom: 4 },
  summaryValue: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  summaryFooter: { 
    borderTopWidth: 1, 
    borderColor: 'rgba(255, 255, 255, 0.1)', 
    paddingTop: 16, 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center' 
  },
  totalSalesLabel: { color: '#888', fontSize: 13, fontWeight: '600' },
  totalSalesValue: { color: '#FFB703', fontSize: 24, fontWeight: 'bold' },

  // List Styles
  sectionContainer: { paddingHorizontal: 16, marginBottom: 24 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#FFF', marginRight: 10 },
  badge: { 
    backgroundColor: 'rgba(52, 211, 153, 0.15)', 
    paddingHorizontal: 10, 
    paddingVertical: 2, 
    borderRadius: 12 
  },
  badgeText: { color: '#34D399', fontSize: 12, fontWeight: 'bold' },
  reportList: { 
    backgroundColor: '#0D0D0D', 
    borderRadius: 16, 
    borderWidth: 1, 
    borderColor: '#1A1A1A', 
    overflow: 'hidden' 
  },
  listHeader: { 
    flexDirection: 'row', 
    backgroundColor: '#161616', 
    paddingVertical: 12, 
    paddingHorizontal: 16, 
    borderBottomWidth: 1, 
    borderColor: '#1A1A1A' 
  },
  listHeaderText: { color: '#888', fontSize: 11, fontWeight: 'bold', textAlign: 'center' },
  listItem: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingVertical: 14, 
    paddingHorizontal: 16, 
    borderBottomWidth: 1, 
    borderColor: '#161616' 
  },
  itemName: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  itemCategory: { color: '#666', fontSize: 10, marginTop: 2 },
  itemQty: { color: '#FFF', fontSize: 14, fontWeight: 'bold', textAlign: 'center' },
  itemTotal: { color: '#34D399', fontSize: 14, fontWeight: 'bold', textAlign: 'right' },
  emptyState: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#666', fontSize: 14 },

  // Not Sold Grid
  notSoldGrid: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    padding: 8, 
    justifyContent: 'space-between' 
  },
  notSoldItem: { 
    width: '48%', 
    backgroundColor: '#161616', 
    borderRadius: 12, 
    padding: 12, 
    marginBottom: 8, 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center' 
  },
  notSoldName: { color: '#888', fontSize: 12, flex: 1, marginRight: 4 },
  notSoldQty: { color: '#444', fontSize: 11, fontWeight: 'bold' },

  // Calendar Styles
  calendarOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  calendarContent: { backgroundColor: '#111', width: width * 0.85, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#333' },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  calNav: { color: '#FFB703', fontSize: 20, paddingHorizontal: 10 },
  calTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  calWeekRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 10 },
  calWeekDay: { color: '#666', fontSize: 12, width: 35, textAlign: 'center' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around' },
  calDayCell: { width: 35, height: 35, justifyContent: 'center', alignItems: 'center', marginBottom: 5, borderRadius: 17 },
  calDayText: { color: '#FFF', fontSize: 13 },
  calCloseBtn: { marginTop: 20, height: 48, backgroundColor: '#1E1E1E', borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  calCloseBtnText: { color: '#888', fontSize: 14, fontWeight: 'bold' },
});
