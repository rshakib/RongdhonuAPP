import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Dimensions,
  Platform,
  Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getActivityLogsFromDb,
  fetchActivityLogsForDate,
  getDistinctActivityDevices,
  getBusinessDate,
  formatDisplayDate
} from '../database';

const { width } = Dimensions.get('window');

// Category Visual Metadata (Focused exclusively on Delete, Daily Submit, Daily Expense Edit, and Ijara Edit)
const CATEGORIES = [
  { key: 'ALL', label: 'সব', emoji: '📋' },
  { key: 'DELETE', label: 'ডিলিট', emoji: '🗑️' },
  { key: 'SUBMISSION', label: 'ডেইলি সাবমিট', emoji: '🏦' },
  { key: 'EXPENSE', label: 'খরচ এডিট', emoji: '📉' },
  { key: 'IJARA', label: 'ইজারা এডিট', emoji: '📜' },
];

const ROLES = [
  { key: 'ALL', label: 'সব রোল' },
  { key: 'OWNER', label: '👑 Owner' },
  { key: 'ADMIN', label: '🛡️ Admin' },
  { key: 'MANAGER', label: '💼 Manager' },
  { key: 'WAITER', label: '📱 Waiter' },
];

const CATEGORY_COLORS = {
  DELETE: { bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.4)', text: '#EF4444', emoji: '🗑️' },
  SUBMISSION: { bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.4)', text: '#34D399', emoji: '🏦' },
  EXPENSE: { bg: 'rgba(251, 113, 133, 0.15)', border: 'rgba(251, 113, 133, 0.4)', text: '#FB7185', emoji: '📉' },
  IJARA: { bg: 'rgba(168, 85, 247, 0.15)', border: 'rgba(168, 85, 247, 0.4)', text: '#C084FC', emoji: '📜' },
  // Backward compatibility
  SECURITY: { bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.4)', text: '#EF4444', emoji: '🗑️' },
  SETTLEMENT: { bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.4)', text: '#34D399', emoji: '🏦' },
  ORDER: { bg: 'rgba(59, 130, 246, 0.12)', border: 'rgba(59, 130, 246, 0.35)', text: '#60A5FA', emoji: '🛒' },
  PAYMENT: { bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.35)', text: '#34D399', emoji: '💵' },
  MENU: { bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.35)', text: '#FBBF24', emoji: '🍽️' },
  DEVICE: { bg: 'rgba(168, 85, 247, 0.12)', border: 'rgba(168, 85, 247, 0.35)', text: '#C084FC', emoji: '🔒' },
  SYSTEM: { bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.35)', text: '#94A3B8', emoji: '⚙️' },
};

// Calendar Picker
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
    onSelectDate(`${y}-${m}-${dd}`);
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

export default function ActivityLogScreen({ onBack, userRole }) {
  const [selectedDate, setSelectedDate] = useState(() => {
    try { return getBusinessDate(); } catch (e) { return new Date().toISOString().split('T')[0]; }
  });
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedRole, setSelectedRole] = useState('ALL');
  const [selectedDevice, setSelectedDevice] = useState('ALL');
  const [deviceList, setDeviceList] = useState([]);

  // Load logs from local SQLite
  const loadLocalData = useCallback((date) => {
    try {
      const dbLogs = getActivityLogsFromDb(date);
      setLogs(dbLogs || []);
      const devices = getDistinctActivityDevices(date);
      setDeviceList(devices || []);
      return dbLogs ? dbLogs.length : 0;
    } catch (e) {
      console.error('[ActivityScreen] loadLocalData error:', e);
      return 0;
    }
  }, []);

  // Fetch on-demand from Firestore
  const handleSyncCloud = async (targetDate) => {
    setLoading(true);
    try {
      const result = await fetchActivityLogsForDate(targetDate);
      loadLocalData(targetDate);
      if (result.count > 0) {
        // Updated
      }
    } catch (err) {
      console.error('[ActivityScreen] Cloud sync error:', err);
    } finally {
      setLoading(false);
    }
  };

  // On mount and date change
  useEffect(() => {
    const localCount = loadLocalData(selectedDate);
    // If local has 0 records, automatically fetch from cloud once
    if (localCount === 0) {
      handleSyncCloud(selectedDate);
    }
  }, [selectedDate, loadLocalData]);

  // The 4 core action types we care about (hides old ORDER, PAYMENT, MENU etc.)
  const CORE_ACTION_TYPES = new Set(['DELETE', 'SECURITY', 'SUBMISSION', 'SETTLEMENT', 'EXPENSE', 'IJARA']);

  // Filtered Logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Category filter
      if (selectedCategory === 'ALL') {
        // Only show our 4 core categories — hide old ORDER, PAYMENT, MENU, DEVICE, SYSTEM logs
        if (!CORE_ACTION_TYPES.has(log.action_type)) return false;
      } else if (selectedCategory === 'DELETE') {
        if (log.action_type !== 'DELETE' && log.action_type !== 'SECURITY') return false;
      } else if (selectedCategory === 'SUBMISSION') {
        if (log.action_type !== 'SUBMISSION' && log.action_type !== 'SETTLEMENT') return false;
      } else if (selectedCategory === 'EXPENSE') {
        if (log.action_type !== 'EXPENSE') return false;
      } else if (selectedCategory === 'IJARA') {
        if (log.action_type !== 'IJARA') return false;
      } else if (log.action_type !== selectedCategory) {
        return false;
      }
      // Role filter
      if (selectedRole !== 'ALL') {
        const logRole = String(log.user_role || log.app_profile || '').toUpperCase();
        if (logRole !== selectedRole) {
          return false;
        }
      }
      // Device filter
      if (selectedDevice !== 'ALL' && log.device_id !== selectedDevice) {
        return false;
      }
      return true;
    });
  }, [logs, selectedCategory, selectedRole, selectedDevice]);

  // Metrics for current day
  const metrics = useMemo(() => {
    const total = logs.length;
    const deleteCount = logs.filter(l => l.action_type === 'DELETE' || l.action_type === 'SECURITY').length;
    const submissionCount = logs.filter(l => l.action_type === 'SUBMISSION' || l.action_type === 'SETTLEMENT').length;
    const expenseCount = logs.filter(l => l.action_type === 'EXPENSE').length;
    const ijaraCount = logs.filter(l => l.action_type === 'IJARA').length;
    return { total, deleteCount, submissionCount, expenseCount, ijaraCount };
  }, [logs]);

  // Clean human-friendly description generator for activity logs
  const formatHumanDescription = (desc, actionType, actionTitle) => {
    if (!desc) return '';
    let clean = String(desc).trim();

    // 1. Active order delete patterns
    clean = clean.replace(/অর্ডার মুছে ফেলা হয়েছে:\s*(?:active-)?(?:table_)?([a-zA-Z0-9_-]+)/gi, (m, p1) => {
      if (p1.toUpperCase().startsWith('D-') || p1.toUpperCase().startsWith('DELIVERY')) {
        return 'ডেলিভারি অর্ডার মুছে ফেলা হয়েছে';
      }
      return `টেবিল ${p1.replace(/^table_/i, '')} এর রানিং অর্ডার মুছে ফেলা হয়েছে`;
    });

    // 2. Completed order delete with full composite ID (table_4_2026-09-16T11-56-00-106Z or D-178956...)
    clean = clean.replace(/অর্ডার\s*আইডি:\s*table_([a-zA-Z0-9]+)(?:_[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:\.-]+Z?)?/gi, 'টেবিল $1 এর সম্পন্ন অর্ডার মুছে ফেলা হয়েছে');
    clean = clean.replace(/অর্ডার\s*আইডি:\s*D-[0-9a-zA-Z_.-]+/gi, 'ডেলিভারি সম্পন্ন অর্ডার মুছে ফেলা হয়েছে');
    clean = clean.replace(/অর্ডার\s*আইডি:\s*([a-zA-Z0-9_-]+)/gi, 'অর্ডার $1');

    // 3. Convert table identifiers
    clean = clean.replace(/টেবিল\s+table_([a-zA-Z0-9]+)/gi, 'টেবিল $1');
    clean = clean.replace(/\btable_([a-zA-Z0-9]+)\b/gi, 'টেবিল $1');
    clean = clean.replace(/\bT-([a-zA-Z0-9]+):/g, 'টেবিল $1:');
    clean = clean.replace(/\bactive-/gi, '');

    return clean;
  };

  // Extract human-readable tags/chips from metadata, omitting raw IDs & technical keys
  const extractHumanMetaBadges = (metadata) => {
    if (!metadata) return [];
    let metaObj = null;
    if (typeof metadata === 'object') {
      metaObj = metadata;
    } else if (typeof metadata === 'string') {
      try {
        metaObj = JSON.parse(metadata);
      } catch (e) {
        return [];
      }
    }
    if (!metaObj || typeof metaObj !== 'object') return [];

    const badges = [];

    // Financial / Daily submission details
    if (metaObj.totalSell !== undefined && metaObj.totalSell !== null) {
      badges.push({ label: `বিক্রয়: ৳${metaObj.totalSell}`, color: '#34D399', bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.3)' });
    }
    if (metaObj.totalExpenses !== undefined && metaObj.totalExpenses !== null) {
      badges.push({ label: `খরচ: ৳${metaObj.totalExpenses}`, color: '#FB7185', bg: 'rgba(251, 113, 133, 0.12)', border: 'rgba(251, 113, 133, 0.3)' });
    }
    if (metaObj.netCash !== undefined && metaObj.netCash !== null) {
      badges.push({ label: `জমা: ৳${metaObj.netCash}`, color: '#60A5FA', bg: 'rgba(59, 130, 246, 0.12)', border: 'rgba(59, 130, 246, 0.3)' });
    }

    // Itemized Expenses
    if (metaObj.duduMiah && parseFloat(metaObj.duduMiah) > 0) {
      badges.push({ label: `দুধ: ৳${metaObj.duduMiah}`, color: '#FBBF24', bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.3)' });
    }
    if (metaObj.akashChicken && parseFloat(metaObj.akashChicken) > 0) {
      badges.push({ label: `মুরগি: ৳${metaObj.akashChicken}`, color: '#FBBF24', bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.3)' });
    }
    if (metaObj.burgerBun && parseFloat(metaObj.burgerBun) > 0) {
      badges.push({ label: `বান: ৳${metaObj.burgerBun}`, color: '#FBBF24', bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.3)' });
    }
    if (metaObj.bazar && parseFloat(metaObj.bazar) > 0) {
      badges.push({ label: `বাজার: ৳${metaObj.bazar}`, color: '#FBBF24', bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.3)' });
    }
    if (metaObj.others && parseFloat(metaObj.others) > 0) {
      badges.push({ label: `অন্যান্য: ৳${metaObj.others}`, color: '#94A3B8', bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.3)' });
    }
    if (metaObj.ijara && parseFloat(metaObj.ijara) > 0) {
      badges.push({ label: `ইজারা: ৳${metaObj.ijara}`, color: '#C084FC', bg: 'rgba(168, 85, 247, 0.12)', border: 'rgba(168, 85, 247, 0.3)' });
    }

    // Amount
    if (badges.length === 0 && metaObj.amount !== undefined && metaObj.amount !== null && !isNaN(metaObj.amount)) {
      badges.push({ label: `পরিমাণ: ৳${metaObj.amount}`, color: '#FFB703', bg: 'rgba(255, 183, 3, 0.12)', border: 'rgba(255, 183, 3, 0.3)' });
    }

    // Notes
    if (metaObj.notes && typeof metaObj.notes === 'string' && metaObj.notes.trim()) {
      badges.push({ label: `নোট: ${metaObj.notes.trim()}`, color: '#38BDF8', bg: 'rgba(56, 189, 248, 0.12)', border: 'rgba(56, 189, 248, 0.3)' });
    }

    // ---- Deleted Order Details (for completed order deletes) ----
    // Show total
    if (metaObj.total !== undefined && metaObj.total !== null && Number(metaObj.total) > 0) {
      badges.push({ label: `মোট: ৳${metaObj.total}`, color: '#34D399', bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.3)' });
    }
    // Show payment method
    if (metaObj.method && typeof metaObj.method === 'string' && metaObj.method.trim()) {
      badges.push({ label: `💳 ${metaObj.method.trim()}`, color: '#60A5FA', bg: 'rgba(59, 130, 246, 0.12)', border: 'rgba(59, 130, 246, 0.3)' });
    }
    // Show item count badge
    if (metaObj.itemCount && Number(metaObj.itemCount) > 0) {
      badges.push({ label: `${metaObj.itemCount} টি আইটেম`, color: '#FBBF24', bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.3)' });
    }
    // Show each item
    if (Array.isArray(metaObj.items) && metaObj.items.length > 0) {
      metaObj.items.forEach(it => {
        const name = it.name || it.item_name || it.itemName || 'আইটেম';
        const qty = it.qty || it.quantity || 1;
        const price = it.price || it.unit_price || 0;
        const priceStr = price > 0 ? ` (৳${price}×${qty})` : ` ×${qty}`;
        badges.push({ label: `🍽 ${name}${priceStr}`, color: '#E5E5E5', bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)' });
      });
    }

    // Raw IDs (orderId, tableId, etc.) are omitted to prevent raw JSON dumps
    return badges;
  };

  const formatLogTime = (isoString) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      let hours = d.getHours();
      let minutes = d.getMinutes();
      let seconds = d.getSeconds();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      minutes = minutes < 10 ? '0' + minutes : minutes;
      seconds = seconds < 10 ? '0' + seconds : seconds;
      return `${hours}:${minutes}:${seconds} ${ampm}`;
    } catch (e) {
      return isoString;
    }
  };

  const getRoleBadgeInfo = (roleStr, appProfile) => {
    const r = String(roleStr || appProfile || '').toLowerCase().trim();
    if (r === 'owner') return { label: '👑 Owner', color: '#FFB703', bg: 'rgba(255, 183, 3, 0.15)', border: 'rgba(255, 183, 3, 0.35)' };
    if (r === 'admin') return { label: '🛡️ Admin', color: '#C084FC', bg: 'rgba(168, 85, 247, 0.15)', border: 'rgba(168, 85, 247, 0.35)' };
    if (r === 'manager') return { label: '💼 Manager', color: '#60A5FA', bg: 'rgba(59, 130, 246, 0.15)', border: 'rgba(59, 130, 246, 0.35)' };
    return { label: '📱 Waiter', color: '#34D399', bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.35)' };
  };

  return (
    <SafeAreaView style={styles.container}>
      <CalendarPicker 
        visible={calendarVisible} 
        onClose={() => setCalendarVisible(false)} 
        onSelectDate={(date) => setSelectedDate(date)} 
      />

      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>অ্যাক্টিভিটি ও অডিট লগ</Text>
          <Text style={styles.headerSubtitle}>ডিভাইস, রোল ও অ্যাকশন ট্র্যাকার</Text>
        </View>
        <TouchableOpacity 
          style={styles.syncCloudBtn} 
          onPress={() => handleSyncCloud(selectedDate)}
          disabled={loading}
          activeOpacity={0.7}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#FFB703" />
          ) : (
            <Text style={styles.syncCloudBtnText}>🔄 রিফ্রেশ</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Date Selector Row */}
        <View style={styles.dateSelectorCard}>
          <View style={styles.dateInfoLeft}>
            <Text style={styles.dateLabel}>অডিট তারিখ:</Text>
            <Text style={styles.dateValue}>{formatDisplayDate(selectedDate)} ({selectedDate})</Text>
          </View>
          <TouchableOpacity 
            style={styles.pickDateBtn} 
            onPress={() => setCalendarVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.pickDateBtnText}>📅 তারিখ বদলান</Text>
          </TouchableOpacity>
        </View>

        {/* Metrics Summary Strip */}
        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricNumber}>{metrics.total}</Text>
            <Text style={styles.metricLabel}>মোট রেকর্ড</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={[styles.metricNumber, { color: '#EF4444' }]}>{metrics.deleteCount}</Text>
            <Text style={styles.metricLabel}>🗑️ ডিলিট</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={[styles.metricNumber, { color: '#10B981' }]}>{metrics.submissionCount}</Text>
            <Text style={styles.metricLabel}>🏦 সাবমিট</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={[styles.metricNumber, { color: '#FB7185' }]}>{metrics.expenseCount}</Text>
            <Text style={styles.metricLabel}>📉 খরচ এডিট</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={[styles.metricNumber, { color: '#C084FC' }]}>{metrics.ijaraCount}</Text>
            <Text style={styles.metricLabel}>📜 ইজারা</Text>
          </View>
        </View>

        {/* Role Filters */}
        <View style={styles.filterSection}>
          <Text style={styles.filterSectionTitle}>রোল ফিল্টার:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
            {ROLES.map((r) => {
              const active = selectedRole === r.key;
              return (
                <TouchableOpacity
                  key={r.key}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setSelectedRole(r.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{r.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Category Filters */}
        <View style={styles.filterSection}>
          <Text style={styles.filterSectionTitle}>অ্যাকশন ক্যাটাগরি:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
            {CATEGORIES.map((c) => {
              const active = selectedCategory === c.key;
              return (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setSelectedCategory(c.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {c.emoji} {c.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Device Filter (if devices available) */}
        {deviceList.length > 1 && (
          <View style={styles.filterSection}>
            <Text style={styles.filterSectionTitle}>ডিভাইস ফিল্টার:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
              <TouchableOpacity
                style={[styles.chip, selectedDevice === 'ALL' && styles.chipActive]}
                onPress={() => setSelectedDevice('ALL')}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, selectedDevice === 'ALL' && styles.chipTextActive]}>সকল ডিভাইস ({deviceList.length})</Text>
              </TouchableOpacity>
              {deviceList.map((d, dIdx) => {
                const active = selectedDevice === d.device_id;
                return (
                  <TouchableOpacity
                    key={`${d.device_id || 'dev'}-${dIdx}`}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setSelectedDevice(d.device_id)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      📱 {d.device_name || d.device_model}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Activity Timeline List */}
        <View style={styles.listContainer}>
          <View style={styles.listHeaderRow}>
            <Text style={styles.listHeaderTitle}>লাইভ অডিট রেকর্ড ({filteredLogs.length} টি)</Text>
            {loading && <ActivityIndicator size="small" color="#FFB703" />}
          </View>

          {filteredLogs.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📜</Text>
              <Text style={styles.emptyTitle}>কোনো অ্যাক্টিভিটি পাওয়া যায়নি</Text>
              <Text style={styles.emptySub}>
                {selectedDate} তারিখে ফিল্টারের সাথে মিলে এমন কোনো অ্যাকশন রেকর্ড নেই।
              </Text>
              <TouchableOpacity 
                style={styles.emptyRefreshBtn} 
                onPress={() => handleSyncCloud(selectedDate)}
                activeOpacity={0.8}
              >
                <Text style={styles.emptyRefreshBtnText}>🔄 ক্লাউড থেকে চেক করুন</Text>
              </TouchableOpacity>
            </View>
          ) : (
            filteredLogs.map((item) => {
              const catTheme = CATEGORY_COLORS[item.action_type] || CATEGORY_COLORS.SYSTEM;
              const roleBadge = getRoleBadgeInfo(item.user_role, item.app_profile);

              return (
                <View key={item.id} style={styles.timelineCard}>
                  {/* Card Header: Category Badge + Timestamp */}
                  <View style={styles.cardHeader}>
                    <View style={[styles.catBadge, { backgroundColor: catTheme.bg, borderColor: catTheme.border }]}>
                      <Text style={styles.catBadgeEmoji}>{catTheme.emoji}</Text>
                      <Text style={[styles.catBadgeText, { color: catTheme.text }]}>{item.action_title}</Text>
                    </View>
                    <View style={styles.timeBadge}>
                      <Text style={styles.timeBadgeEmoji}>🕒</Text>
                      <Text style={styles.timestampText}>{formatLogTime(item.timestamp)}</Text>
                    </View>
                  </View>

                  {/* Card Body: Description */}
                  {item.description ? (
                    <Text style={styles.cardDesc}>
                      {formatHumanDescription(item.description, item.action_type, item.action_title)}
                    </Text>
                  ) : null}

                  {/* Human-friendly Metadata Badges (No raw JSON) */}
                  {(() => {
                    const badges = extractHumanMetaBadges(item.metadata);
                    if (!badges || badges.length === 0) return null;
                    return (
                      <View style={styles.metaBadgesContainer}>
                        {badges.map((b, bIdx) => (
                          <View key={bIdx} style={[styles.metaBadgeChip, { backgroundColor: b.bg, borderColor: b.border }]}>
                            <Text style={[styles.metaBadgeChipText, { color: b.color }]}>{b.label}</Text>
                          </View>
                        ))}
                      </View>
                    );
                  })()}

                  {/* Card Footer: Device Info + Role Badge */}
                  <View style={styles.cardFooter}>
                    <View style={styles.deviceInfoPill}>
                      <Text style={styles.deviceInfoEmoji}>📱</Text>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.deviceName} numberOfLines={1}>
                          {item.device_name || 'POS Terminal'}
                        </Text>
                        <Text style={styles.deviceSub} numberOfLines={1}>
                          {item.device_model ? `${item.device_model} • ` : ''}{item.device_platform || 'Android'}
                        </Text>
                      </View>
                    </View>

                    <View style={[styles.roleBadge, { backgroundColor: roleBadge.bg, borderColor: roleBadge.border }]}>
                      <Text style={[styles.roleBadgeText, { color: roleBadge.color }]}>{roleBadge.label}</Text>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#1F1F1F',
    backgroundColor: '#0A0A0A',
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backBtnText: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  headerSubtitle: {
    color: '#888',
    fontSize: 11,
    marginTop: 1,
  },
  syncCloudBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 183, 3, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 183, 3, 0.35)',
    borderRadius: 8,
  },
  syncCloudBtnText: {
    color: '#FFB703',
    fontSize: 11,
    fontWeight: '600',
  },

  // Date Selector Card
  dateSelectorCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#111111',
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#222',
  },
  dateInfoLeft: {
    flex: 1,
  },
  dateLabel: {
    color: '#888',
    fontSize: 11,
  },
  dateValue: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  pickDateBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#1C1C1C',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  pickDateBtnText: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '600',
  },

  // Metrics
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 14,
    gap: 8,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#0F0F0F',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: '#1C1C1C',
    alignItems: 'center',
  },
  metricNumber: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
  },
  metricLabel: {
    color: '#777',
    fontSize: 9.5,
    marginTop: 3,
    textAlign: 'center',
  },

  // Filters
  filterSection: {
    marginHorizontal: 16,
    marginBottom: 10,
  },
  filterSectionTitle: {
    color: '#888',
    fontSize: 11,
    marginBottom: 6,
    fontWeight: '600',
  },
  chipsScroll: {
    flexDirection: 'row',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#242424',
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: 'rgba(255, 183, 3, 0.15)',
    borderColor: 'rgba(255, 183, 3, 0.6)',
  },
  chipText: {
    color: '#888',
    fontSize: 11,
    fontWeight: '500',
  },
  chipTextActive: {
    color: '#FFB703',
    fontWeight: '700',
  },

  // List
  listContainer: {
    marginHorizontal: 16,
    marginTop: 8,
  },
  listHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  listHeaderTitle: {
    color: '#CCC',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyState: {
    backgroundColor: '#0F0F0F',
    borderRadius: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: '#1C1C1C',
    alignItems: 'center',
    marginTop: 10,
  },
  emptyEmoji: {
    fontSize: 36,
    marginBottom: 8,
  },
  emptyTitle: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptySub: {
    color: '#777',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: 14,
  },
  emptyRefreshBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  emptyRefreshBtnText: {
    color: '#FFB703',
    fontSize: 12,
    fontWeight: '600',
  },

  // Timeline Card
  timelineCard: {
    backgroundColor: '#0D0D0D',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1C1C1C',
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  catBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 0.8,
  },
  catBadgeEmoji: {
    fontSize: 12,
    marginRight: 4,
  },
  catBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161616',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 0.8,
    borderColor: '#2A2A2A',
  },
  timeBadgeEmoji: {
    fontSize: 10,
    marginRight: 4,
  },
  timestampText: {
    color: '#FFB703',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  cardDesc: {
    color: '#E5E5E5',
    fontSize: 12.5,
    lineHeight: 17,
    marginBottom: 6,
  },
  metaBadgesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
    marginTop: 2,
  },
  metaBadgeChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 0.8,
  },
  metaBadgeChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 0.8,
    borderColor: '#191919',
    gap: 8,
  },
  deviceInfoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  deviceInfoEmoji: {
    fontSize: 13,
    marginRight: 6,
  },
  deviceName: {
    color: '#CCC',
    fontSize: 11,
    fontWeight: '600',
  },
  deviceSub: {
    color: '#666',
    fontSize: 9.5,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 0.8,
    flexShrink: 0,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },

  // Calendar Modal
  calendarOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  calendarContent: { backgroundColor: '#141414', borderRadius: 16, padding: 16, width: '90%', maxWidth: 360, borderWidth: 1, borderColor: '#333' },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  calNav: { color: '#FFB703', fontSize: 18, paddingHorizontal: 10 },
  calTitle: { color: '#FFF', fontSize: 15, fontWeight: 'bold' },
  calWeekRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 },
  calWeekDay: { color: '#888', fontSize: 12, width: 32, textAlign: 'center' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around' },
  calDayCell: { width: 34, height: 34, justifyContent: 'center', alignItems: 'center', marginBottom: 4, borderRadius: 17 },
  calDayText: { color: '#FFF', fontSize: 12 },
  calCloseBtn: { marginTop: 12, backgroundColor: '#222', paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  calCloseBtnText: { color: '#FFF', fontSize: 12 }
});

