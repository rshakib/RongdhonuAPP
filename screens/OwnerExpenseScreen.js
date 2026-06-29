import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

const AccessDenied = ({ onBack }) => (
  <View style={styles.accessDeniedContainer}>
    <Text style={styles.accessDeniedEmoji}>🚫</Text>
    <Text style={styles.accessDeniedTitle}>প্রবেশাধিকার সংরক্ষিত</Text>
    <Text style={styles.accessDeniedSubtitle}>আপনার এই মডিউলে প্রবেশ করার অনুমতি নেই।</Text>
    <TouchableOpacity style={styles.accessDeniedButton} onPress={onBack}>
      <Text style={styles.accessDeniedButtonText}>ফিরে যান</Text>
    </TouchableOpacity>
  </View>
);

const DEFAULT_CATEGORIES = [
  { label: '⚡ বিদ্যুৎ বিল', icon: '⚡' },
  { label: '🔥 গ্যাস বিল', icon: '🔥' },
  { label: '🌐 ইন্টারনেট বিল', icon: '🌐' },
  { label: '🛒 বাজার', icon: '🛒' },
  { label: '🔧 মেরামত (Maintenance)', icon: '🔧' },
  { label: '📦 অন্যান্য', icon: '📦' }
];

export default function OwnerExpenseScreen({
  userRole,
  onBack,
  refreshData
}) {
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState('');
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState({ total: 0, utilities: 0, bazar: 0, breakdown: {} });
  const [searchQuery, setSearchQuery] = useState('');
  const [customCategories, setCustomCategories] = useState([]);
  const [isClosed, setIsClosed] = useState(false);

  // Modal form states
  const [modalVisible, setModalVisible] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [formCategory, setFormCategory] = useState('🛒 বাজার');
  const [formAmount, setFormAmount] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // Custom category modal states
  const [newCatModalVisible, setNewCatModalVisible] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  useEffect(() => {
    if (userRole === 'owner' || userRole === 'admin') {
      const todayMonth = new Date().toISOString().substring(0, 7);
      setCurrentMonth(todayMonth);
      loadCustomCategories();
    } else {
      setLoading(false);
    }
  }, [userRole]);

  useEffect(() => {
    if ((userRole === 'owner' || userRole === 'admin') && currentMonth) {
      loadData();
    }
  }, [currentMonth]);

  const loadCustomCategories = () => {
    try {
      const { getAppConfig } = require('../database');
      const val = getAppConfig('owner_custom_expense_categories');
      if (val) {
        setCustomCategories(JSON.parse(val));
      }
    } catch (err) {
      console.error("[OwnerExpenseScreen] Load custom categories error:", err);
    }
  };

  const loadData = () => {
    setLoading(true);
    try {
      const { getOwnerExpenses, getOwnerExpenseSummary, getOwnerDepositByMonth } = require('../database');
      const list = getOwnerExpenses(currentMonth);
      setExpenses(list);

      const sum = getOwnerExpenseSummary(currentMonth);
      setSummary(sum);

      const closed = getOwnerDepositByMonth(currentMonth) !== null;
      setIsClosed(closed);
    } catch (err) {
      console.error("[OwnerExpenseScreen] Error loading data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handlePrevMonth = () => {
    const parts = currentMonth.split('-');
    let y = parseInt(parts[0]);
    let m = parseInt(parts[1]);
    m--;
    if (m === 0) {
      m = 12;
      y--;
    }
    setCurrentMonth(`${y}-${m.toString().padStart(2, '0')}`);
  };

  const handleNextMonth = () => {
    const parts = currentMonth.split('-');
    let y = parseInt(parts[0]);
    let m = parseInt(parts[1]);
    m++;
    if (m === 13) {
      m = 1;
      y++;
    }
    setCurrentMonth(`${y}-${m.toString().padStart(2, '0')}`);
  };

  const handleOpenAddModal = () => {
    if (isClosed) {
      Alert.alert("সীমাবদ্ধতা", "এই মাসের হিসাব বন্ধ করা হয়েছে (Read-Only)");
      return;
    }
    setEditingExpenseId(null);
    setFormCategory('🛒 বাজার');
    setFormAmount('');
    setFormDate(new Date().toISOString().substring(0, 10));
    setFormNotes('');
    setModalVisible(true);
  };

  const handleOpenEditModal = (item) => {
    if (isClosed) {
      Alert.alert("সীমাবদ্ধতা", "এই মাসের হিসাব বন্ধ করা হয়েছে (Read-Only)");
      return;
    }
    setEditingExpenseId(item.id);
    setFormCategory(item.category);
    setFormAmount(item.amount.toString());
    setFormDate(item.expense_date);
    setFormNotes(item.notes || '');
    setModalVisible(true);
  };

  const handleSave = () => {
    if (isClosed) {
      Alert.alert("সীমাবদ্ধতা", "এই মাসের হিসাব বন্ধ করা হয়েছে (Read-Only)");
      return;
    }

    const amountNum = parseFloat(formAmount) || 0;
    if (amountNum <= 0) {
      Alert.alert("ইনপুট ত্রুটি", "খরচের পরিমাণ অবশ্যই ০ থেকে বেশি হতে হবে।");
      return;
    }

    if (!formDate.trim()) {
      Alert.alert("ইনপুট ত্রুটি", "খরচের তারিখ দেওয়া আবশ্যক।");
      return;
    }

    try {
      const { saveOwnerExpense, updateOwnerExpense } = require('../database');
      
      const payload = {
        category: formCategory,
        amount: amountNum,
        expense_date: formDate.trim(),
        notes: formNotes.trim()
      };

      let success = false;
      if (editingExpenseId) {
        payload.id = editingExpenseId;
        success = updateOwnerExpense(payload);
      } else {
        const newId = saveOwnerExpense(payload);
        success = !!newId;
      }

      if (success) {
        Alert.alert("সফল", "খরচের তথ্য সংরক্ষণ করা হয়েছে।");
        setModalVisible(false);
        loadData();
        if (refreshData) {
          refreshData();
        }
      } else {
        Alert.alert("ত্রুটি", "সংরক্ষণ করতে ব্যর্থ হয়েছে।");
      }
    } catch (err) {
      console.error("[OwnerExpenseScreen] Save expense error:", err);
      Alert.alert("ত্রুটি", "সংরক্ষণ করতে ব্যর্থ হয়েছে।");
    }
  };

  const handleDelete = (item) => {
    if (isClosed) {
      Alert.alert("সীমাবদ্ধতা", "এই মাসের হিসাব বন্ধ করা হয়েছে (Read-Only)");
      return;
    }

    Alert.alert(
      "খরচ অপসারণ",
      `আপনি কি নিশ্চিতভাবে এই খরচটি (${item.category} - ৳${item.amount}) মুছে ফেলতে চান?`,
      [
        { text: "বাতিল", style: "cancel" },
        {
          text: "মুছে ফেলুন",
          style: "destructive",
          onPress: () => {
            try {
              const { deleteOwnerExpense } = require('../database');
              const success = deleteOwnerExpense(item.id);
              if (success) {
                Alert.alert("সফল", "খরচ সফলভাবে মুছে ফেলা হয়েছে।");
                loadData();
                if (refreshData) {
                  refreshData();
                }
              } else {
                Alert.alert("ত্রুটি", "মুছে ফেলতে ব্যর্থ হয়েছে।");
              }
            } catch (err) {
              console.error("[OwnerExpenseScreen] Delete expense error:", err);
              Alert.alert("ত্রুটি", "মুছে ফেলতে ব্যর্থ হয়েছে।");
            }
          }
        }
      ]
    );
  };

  const handleSaveCustomCategory = () => {
    if (isClosed) {
      Alert.alert("সীমাবদ্ধতা", "এই মাসের হিসাব বন্ধ করা হয়েছে (Read-Only)");
      return;
    }

    const cleanedName = newCatName.trim();
    if (!cleanedName) {
      Alert.alert("ইনপুট ত্রুটি", "ক্যাটাগরির নাম দেওয়া আবশ্যক।");
      return;
    }

    const allCategories = [...DEFAULT_CATEGORIES, ...customCategories];
    const nameExists = allCategories.some(c => c.label.toLowerCase() === cleanedName.toLowerCase());
    if (nameExists) {
      Alert.alert("ইনপুট ত্রুটি", "এই ক্যাটাগরি অলরেডি রয়েছে।");
      return;
    }

    const newCat = { label: cleanedName, icon: '📦' };
    const updated = [...customCategories, newCat];
    
    try {
      const { setAppConfig } = require('../database');
      setAppConfig('owner_custom_expense_categories', JSON.stringify(updated));
      
      setCustomCategories(updated);
      setFormCategory(cleanedName);
      setNewCatName('');
      setNewCatModalVisible(false);
      
      Alert.alert("সফল", "নতুন ক্যাটাগরি সফলভাবে যুক্ত করা হয়েছে।");
      
      if (refreshData) {
        refreshData();
      }
    } catch (err) {
      console.error("[OwnerExpenseScreen] Save custom category error:", err);
      Alert.alert("ত্রুটি", "ক্যাটাগরি সংরক্ষণ করতে ব্যর্থ হয়েছে।");
    }
  };

  const getCategoryIcon = (catName) => {
    const found = DEFAULT_CATEGORIES.find(c => c.label === catName);
    return found ? found.icon : '📦';
  };

  const getMonthNameBangla = (monthStr) => {
    if (!monthStr) return '';
    const parts = monthStr.split('-');
    const m = parts[1];
    const y = parts[0];
    const monthNames = {
      '01': 'জানুয়ারি', '02': 'ফেব্রুয়ারি', '03': 'মার্চ', '04': 'এপ্রিল',
      '05': 'মে', '06': 'জুন', '07': 'জুলাই', '08': 'আগস্ট',
      '09': 'সেপ্টেম্বর', '10': 'অক্টোবর', '11': 'নভেম্বর', '12': 'ডিসেম্বর'
    };
    return `${monthNames[m] || ''} ${y}`;
  };

  // Filter list by search query
  const filteredExpenses = expenses.filter(exp => {
    const q = searchQuery.toLowerCase();
    const catMatch = exp.category ? exp.category.toLowerCase().includes(q) : false;
    const notesMatch = exp.notes ? exp.notes.toLowerCase().includes(q) : false;
    const amtMatch = exp.amount ? exp.amount.toString().includes(q) : false;
    return catMatch || notesMatch || amtMatch;
  });

  const allCategoriesList = [...DEFAULT_CATEGORIES, ...customCategories];

  if (userRole !== 'owner' && userRole !== 'admin') {
    return <AccessDenied onBack={onBack} />;
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>◁ ফিরে যান</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1} ellipsizeMode="tail">ওনার খরচ</Text>
        
        {!isClosed ? (
          <TouchableOpacity style={styles.addButton} onPress={handleOpenAddModal}>
            <Text style={styles.addButtonText}>➕ খরচ যোগ করুন</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.closedHeaderBadge}>
            <Text style={styles.closedHeaderBadgeText}>🔒 CLOSED</Text>
          </View>
        )}
      </View>

      {/* Month Selector bar */}
      <View style={styles.monthSelectorBar}>
        <TouchableOpacity style={styles.navMonthBtn} onPress={handlePrevMonth}>
          <Text style={styles.navMonthBtnText}>◀</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Text style={styles.currentMonthLabel}>{getMonthNameBangla(currentMonth)}</Text>
          {isClosed && (
            <Text style={{ fontSize: 9, color: '#EF4444', fontWeight: 'bold' }}>🔒 READ ONLY (বন্ধ)</Text>
          )}
        </View>
        <TouchableOpacity style={styles.navMonthBtn} onPress={handleNextMonth}>
          <Text style={styles.navMonthBtnText}>▶</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Large monthly summary card on top (Modern UI redesign) */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>📊 {getMonthNameBangla(currentMonth)} এর হিসাব বিবরণী</Text>
          <View style={styles.summaryStatsGrid}>
            <View style={styles.summaryStatBox}>
              <Text style={styles.statLabel}>মোট খরচ</Text>
              <Text style={[styles.statValue, { color: '#FFB703' }]}>৳{summary.total.toLocaleString()}</Text>
            </View>
            <View style={styles.summaryStatBox}>
              <Text style={styles.statLabel}>ইউটিলিটি বিল</Text>
              <Text style={[styles.statValue, { color: '#60A5FA' }]}>৳{summary.utilities.toLocaleString()}</Text>
            </View>
            <View style={styles.summaryStatBox}>
              <Text style={styles.statLabel}>মোট বাজার</Text>
              <Text style={[styles.statValue, { color: '#34D399' }]}>৳{summary.bazar.toLocaleString()}</Text>
            </View>
          </View>

          {/* Breakdown thin progress bars */}
          <Text style={styles.breakdownHeader}>ক্যাটাগরি ভিত্তিক খরচ</Text>
          <View style={styles.breakdownList}>
            {Object.keys(summary.breakdown).map(catLabel => {
              const amount = summary.breakdown[catLabel] || 0;
              const pct = summary.total > 0 ? (amount / summary.total) * 100 : 0;
              if (amount === 0) return null;
              return (
                <View key={catLabel} style={styles.breakdownRow}>
                  <View style={styles.breakdownLabelRow}>
                    <Text style={styles.breakdownName}>{catLabel}</Text>
                    <Text style={styles.breakdownAmt}>৳{amount.toLocaleString()}</Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressBar, { width: `${pct}%` }]} />
                  </View>
                </View>
              );
            })}
            {summary.total === 0 ? (
              <Text style={styles.noBreakdownText}>এই মাসে কোনো খরচ এন্ট্রি নেই।</Text>
            ) : null}
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="বিভাগ বা নোট দিয়ে খুঁজুন..."
            placeholderTextColor="#888"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* Modern cards list */}
        <Text style={styles.sectionTitle}>ব্যক্তিগত খরচ তালিকা</Text>
        {loading ? (
          <ActivityIndicator size="large" color="#FFB703" style={{ marginVertical: 20 }} />
        ) : filteredExpenses.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyEmoji}>📦</Text>
            <Text style={styles.emptyText}>কোনো খরচের এন্ট্রি পাওয়া যায়নি।</Text>
          </View>
        ) : (
          <View style={styles.expenseList}>
            {filteredExpenses.map((item) => (
              <View key={item.id} style={styles.expenseCard}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardLeft}>
                    <View style={styles.iconCircle}>
                      <Text style={styles.iconText}>{getCategoryIcon(item.category)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.categoryName} numberOfLines={1}>{item.category}</Text>
                      <Text style={styles.expenseDate}>{item.expense_date}</Text>
                    </View>
                  </View>
                  <Text style={styles.expenseAmount}>৳{item.amount.toLocaleString()}</Text>
                </View>

                {item.notes ? (
                  <View style={styles.notesContainer}>
                    <Text style={styles.notesText}>{item.notes}</Text>
                  </View>
                ) : null}

                {!isClosed ? (
                  <View style={styles.cardActions}>
                    <TouchableOpacity style={styles.editBtn} onPress={() => handleOpenEditModal(item)}>
                      <Text style={styles.editBtnText}>✏️ Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item)}>
                      <Text style={styles.deleteBtnText}>🗑️ Delete</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Add/Edit Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalContent}
          >
            <View style={styles.modalHeaderCircle}>
              <Text style={styles.modalHeaderIcon}>💸</Text>
            </View>
            <Text style={styles.modalTitle}>
              {editingExpenseId ? "খরচের বিবরণ পরিবর্তন" : "নতুন খরচ যুক্ত করুন"}
            </Text>

            <ScrollView contentContainerStyle={styles.modalForm}>
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>বিভাগ / ক্যাটাগরি *</Text>
                <View style={styles.categoryPickerGrid}>
                  {allCategoriesList.map(cat => {
                    const isSelected = formCategory === cat.label;
                    return (
                      <TouchableOpacity
                        key={cat.label}
                        style={[styles.catGridBtn, isSelected && styles.catGridBtnActive]}
                        onPress={() => setFormCategory(cat.label)}
                      >
                        <Text style={styles.catGridIcon}>{cat.icon}</Text>
                        <Text style={[styles.catGridLabel, isSelected && styles.catGridLabelActive]}>
                          {cat.label.replace(cat.icon + ' ', '')}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  {/* Add New Category trigger option */}
                  <TouchableOpacity
                    style={[styles.catGridBtn, { borderColor: '#FFB703', borderStyle: 'dashed' }]}
                    onPress={() => setNewCatModalVisible(true)}
                  >
                    <Text style={styles.catGridIcon}>➕</Text>
                    <Text style={[styles.catGridLabel, { color: '#FFB703' }]}>নতুন যোগ</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>খরচের পরিমাণ (৳) *</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="পরিমাণ"
                  placeholderTextColor="#666"
                  keyboardType="numeric"
                  value={formAmount}
                  onChangeText={setFormAmount}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>খরচের তারিখ *</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#666"
                  value={formDate}
                  onChangeText={setFormDate}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>অতিরিক্ত বিবরণ / নোট</Text>
                <TextInput
                  style={[styles.modalInput, styles.textArea]}
                  placeholder="খরচের বিবরণ যেমন: বিদ্যুৎ বিল পরিশোধ"
                  placeholderTextColor="#666"
                  value={formNotes}
                  onChangeText={setFormNotes}
                  multiline={true}
                  numberOfLines={2}
                />
              </View>
            </ScrollView>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.modalCancelBtnText}>বাতিল</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSave}
              >
                <Text style={styles.modalSaveBtnText}>সংরক্ষণ</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Add Custom Category Sub-Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={newCatModalVisible}
        onRequestClose={() => setNewCatModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.subModalContent}>
            <Text style={styles.subModalTitle}>নতুন খরচ ক্যাটাগরি</Text>
            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>নতুন ক্যাটাগরির নাম *</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="যেমন: 🚗 যাতায়াত খরচ"
                placeholderTextColor="#666"
                value={newCatName}
                onChangeText={setNewCatName}
                autoFocus={true}
              />
            </View>
            <View style={[styles.modalBtnRow, { marginTop: 20 }]}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setNewCatName('');
                  setNewCatModalVisible(false);
                }}
              >
                <Text style={styles.modalCancelBtnText}>বাতিল</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSaveCustomCategory}
              >
                <Text style={styles.modalSaveBtnText}>সংরক্ষণ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
    backgroundColor: '#0D0D0D',
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#1E1E1E',
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 12,
  },
  addButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#FFB703',
  },
  addButtonText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: 'bold',
  },
  closedHeaderBadge: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  closedHeaderBadgeText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: 'bold',
  },
  monthSelectorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#161616',
    borderBottomWidth: 1,
    borderColor: '#262626',
  },
  navMonthBtn: {
    padding: 10,
    backgroundColor: '#262626',
    borderRadius: 8,
  },
  navMonthBtnText: {
    color: '#FFB703',
    fontSize: 14,
    fontWeight: 'bold',
  },
  currentMonthLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 16,
  },
  summaryCard: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 16,
    padding: 16,
  },
  summaryTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  summaryStatsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 16,
  },
  summaryStatBox: {
    flex: 1,
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
  },
  statLabel: {
    color: '#888',
    fontSize: 9,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  breakdownHeader: {
    color: '#888',
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  breakdownList: {
    gap: 8,
  },
  breakdownRow: {
    gap: 4,
  },
  breakdownLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  breakdownName: {
    color: '#AAA',
    fontSize: 11,
  },
  breakdownAmt: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  progressTrack: {
    height: 4,
    backgroundColor: '#262626',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#FFB703',
    borderRadius: 2,
  },
  noBreakdownText: {
    color: '#666',
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 6,
  },
  searchContainer: {
    marginVertical: 2,
  },
  searchInput: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    height: 46,
    paddingHorizontal: 16,
    color: '#FFFFFF',
    fontSize: 14,
  },
  sectionTitle: {
    color: '#888',
    fontSize: 11,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  expenseList: {
    gap: 10,
  },
  expenseCard: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1E1E1E',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  iconText: {
    fontSize: 16,
  },
  categoryName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  expenseDate: {
    color: '#666',
    fontSize: 10,
    marginTop: 1,
  },
  expenseAmount: {
    color: '#FFB703',
    fontSize: 15,
    fontWeight: 'bold',
  },
  notesContainer: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#222',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  notesText: {
    color: '#AAA',
    fontSize: 11,
    lineHeight: 16,
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    borderTopWidth: 1,
    borderColor: '#222',
    paddingTop: 8,
  },
  editBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#444',
  },
  editBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  deleteBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  deleteBtnText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '600',
  },
  emptyContainer: {
    paddingVertical: 32,
    alignItems: 'center',
    gap: 6,
  },
  emptyEmoji: {
    fontSize: 32,
  },
  emptyText: {
    color: '#666',
    fontSize: 13,
  },
  accessDeniedContainer: {
    flex: 1,
    backgroundColor: '#0D0D0D',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  accessDeniedEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  accessDeniedTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFB703',
    marginBottom: 8,
    textAlign: 'center',
  },
  accessDeniedSubtitle: {
    fontSize: 14,
    color: '#AAA',
    marginBottom: 24,
    textAlign: 'center',
  },
  accessDeniedButton: {
    backgroundColor: '#FFB703',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  accessDeniedButtonText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#0D0D0D',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FFB703',
    padding: 24,
    width: width * 0.9,
    maxHeight: '90%',
  },
  subModalContent: {
    backgroundColor: '#0D0D0D',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FFB703',
    padding: 24,
    width: width * 0.85,
    maxWidth: 320,
  },
  subModalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 16,
  },
  modalHeaderCircle: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFB703',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalHeaderIcon: {
    fontSize: 24,
    color: '#000000',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 16,
  },
  modalForm: {
    gap: 14,
    paddingBottom: 20,
  },
  formGroup: {
    gap: 6,
  },
  inputLabel: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  categoryPickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    backgroundColor: '#161616',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#262626',
  },
  catGridBtn: {
    width: '31%',
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#222',
    height: 54,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    gap: 4,
  },
  catGridBtnActive: {
    backgroundColor: 'rgba(255, 183, 3, 0.15)',
    borderColor: '#FFB703',
  },
  catGridIcon: {
    fontSize: 16,
  },
  catGridLabel: {
    fontSize: 9,
    color: '#888',
    fontWeight: '600',
    textAlign: 'center',
  },
  catGridLabelActive: {
    color: '#FFB703',
  },
  modalInput: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 16,
    color: '#FFFFFF',
    fontSize: 15,
  },
  textArea: {
    height: 60,
    textAlignVertical: 'top',
    paddingTop: 10,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
  },
  modalCancelBtn: {
    flex: 1,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  modalCancelBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  modalSaveBtn: {
    flex: 1,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFB703',
    borderRadius: 12,
  },
  modalSaveBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
