import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, TextInput, Alert, KeyboardAvoidingView, Platform, ActivityIndicator, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getSupplierDueData, saveSupplierDue, getSupplierDueHistory, deleteSupplierDueHistory, formatDisplayDate, updateSupplierName } from '../database';

const { width } = Dimensions.get('window');

export default function SupplierDueScreen({ userRole, userDisplayName, onBack }) {
  const [dueData, setDueData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState('');
  
  // Input fields state mapped by supplierId
  const [inputs, setInputs] = useState({});
  const [bakiInputs, setBakiInputs] = useState({});
  
  // History ledger state
  const [historyData, setHistoryData] = useState([]);

  // Edit Supplier Name State
  const [editNameModalVisible, setEditNameModalVisible] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState('');
  const [tempSupplierName, setTempSupplierName] = useState('');

  // Generate last 12 months for Month Filter
  const getMonthsList = () => {
    const list = [];
    const now = new Date();
    const monthsEng = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = `${monthsEng[d.getMonth()]} ${d.getFullYear()}`;
      const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      list.push({ label, prefix });
    }
    return list;
  };

  useEffect(() => {
    const list = getMonthsList();
    if (list.length > 0) {
      setSelectedMonth(list[0].prefix);
    }
    loadData();
  }, []);

  const loadData = () => {
    setLoading(true);
    // Fetch only the fixed 3 suppliers
    const data = getSupplierDueData().filter(item => 
      item.id === 'dudu_store' || item.id === 'akash_murgi' || item.id === 'burger_bun'
    );
    
    // Sort in order: 1. dudu_store (দুধ), 2. akash_murgi (মুরগী), 3. burger_bun (বার্গার)
    const orderMap = { 'dudu_store': 1, 'akash_murgi': 2, 'burger_bun': 3 };
    data.sort((a, b) => (orderMap[a.id] || 99) - (orderMap[b.id] || 99));
    
    setDueData(data);
    
    // Initialize input values
    const initInputs = {};
    const initBaki = {};
    data.forEach(item => {
      initInputs[item.id] = {
        purchaseAmount: ''
      };
      initBaki[item.id] = (item.current_due || 0).toString();
    });
    setInputs(initInputs);
    setBakiInputs(initBaki);

    // Load histories for all three suppliers
    const hDudu = getSupplierDueHistory('dudu_store');
    const hAkash = getSupplierDueHistory('akash_murgi');
    const hBurger = getSupplierDueHistory('burger_bun');
    const combined = [...hDudu, ...hAkash, ...hBurger];
    combined.sort((a, b) => b.date.localeCompare(a.date));
    setHistoryData(combined);

    setLoading(false);
  };

  const handleLongPressSupplierName = (supplierId, currentName) => {
    if (userRole !== 'admin') return; // Restriction: Admin only
    setEditingSupplierId(supplierId);
    setTempSupplierName(currentName);
    setEditNameModalVisible(true);
  };

  const handleSaveSupplierName = () => {
    const cleanName = tempSupplierName.trim();
    // Allow empty name to fallback to original
    const success = updateSupplierName(editingSupplierId, cleanName);
    if (success) {
      setEditNameModalVisible(false);
      loadData();
    } else {
      Alert.alert('ত্রুটি', 'নাম পরিবর্তন করতে সমস্যা হয়েছে।');
    }
  };

  const handleSaveIndividual = (supplierId) => {
    const bakiVal = bakiInputs[supplierId] || '';
    const bazarVal = inputs[supplierId]?.purchaseAmount || '';

    const bakiNum = parseFloat(bakiVal);
    if (isNaN(bakiNum)) {
      Alert.alert('ত্রুটি', 'বাকি পরিমাণ সঠিক সংখ্যা হতে হবে।');
      return;
    }

    const purchaseAmount = parseFloat(bazarVal) || 0;

    const success = saveSupplierDue(supplierId, bakiNum, purchaseAmount, '', userDisplayName);
    
    if (success) {
      Alert.alert('সফল', 'বাকির হিসাব সফলভাবে সংরক্ষণ করা হয়েছে।');
      // Reset purchase input and reload
      setInputs(prev => ({
        ...prev,
        [supplierId]: {
          purchaseAmount: ''
        }
      }));
      loadData();
    } else {
      Alert.alert('ত্রুটি', 'ডাটা সংরক্ষণ করতে সমস্যা হয়েছে।');
    }
  };

  const handleDeleteHistoryItem = (historyId) => {
    if (userRole !== 'admin') {
      Alert.alert("সীমাবদ্ধতা", "শুধুমাত্র অ্যাডমিন হিস্ট্রি ডিলিট করতে পারবেন।");
      return;
    }

    Alert.alert(
      "হিস্ট্রি ডিলিট",
      "আপনি কি নিশ্চিতভাবে এই রেকর্ডটি মুছে ফেলতে চান?",
      [
        { text: "বাতিল", style: "cancel" },
        { 
          text: "হ্যাঁ", 
          style: "destructive",
          onPress: () => {
            const success = deleteSupplierDueHistory(historyId);
            if (success) {
              Alert.alert('সফল', 'রেকর্ডটি মুছে ফেলা হয়েছে।');
              loadData();
            } else {
              Alert.alert('ত্রুটি', 'ডিলিট করতে সমস্যা হয়েছে।');
            }
          } 
        }
      ]
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#FFB703" />
      </View>
    );
  }

  // Calculate Total Due
  const totalDue = dueData.reduce((sum, supplier) => {
    return sum + (supplier.current_due || 0);
  }, 0);

  // Filter history based on selected month prefix (YYYY-MM)
  const filteredHistory = historyData.filter(item => item.date.startsWith(selectedMonth));

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backArrow}>❮ পিছনে</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>📒 বাকির হিসাব</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Scrollable View for Content */}
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          
          {/* Total Due Banner */}
          <View style={styles.totalBanner}>
            <Text style={styles.totalBannerLabel}>মোট বকেয়া (Total Due)</Text>
            <Text style={styles.totalBannerValue}>৳ {totalDue.toLocaleString()}</Text>
          </View>

          {/* Month Filter at Top */}
          <Text style={styles.filterTitle}>মাস সিলেক্ট করুন (Month Filter)</Text>
          <ScrollView horizontal={true} showsHorizontalScrollIndicator={false} style={styles.monthScroll} contentContainerStyle={styles.monthScrollContent}>
            {getMonthsList().map((month, index) => {
              const isSelected = selectedMonth === month.prefix;
              return (
                <TouchableOpacity 
                  key={index} 
                  style={[styles.monthButton, isSelected && styles.monthButtonSelected]}
                  onPress={() => setSelectedMonth(month.prefix)}
                >
                  <Text style={[styles.monthText, isSelected && styles.monthTextSelected]}>
                    {month.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Side-by-Side 3-Panel Layout without Horizontal Scroll */}
          <Text style={styles.sectionHeaderTitle}>দুধ, মুরগী ও বার্গার হিসাব (Supplier Panels)</Text>
          <View style={styles.rowContainer}>
            {dueData.map(supplier => {
              const isAdmin = userRole === 'admin';
              
              return (
                <View key={supplier.id} style={styles.panel}>
                  <TouchableOpacity 
                    onLongPress={() => handleLongPressSupplierName(supplier.id, supplier.supplier_name)}
                    delayLongPress={600}
                    activeOpacity={userRole === 'admin' ? 0.7 : 1}
                    disabled={userRole !== 'admin'}
                  >
                    <Text style={styles.panelTitle}>
                      {supplier.supplier_name && supplier.supplier_name.trim() !== ''
                        ? supplier.supplier_name
                        : (supplier.id === 'dudu_store' ? 'দুধ' : supplier.id === 'akash_murgi' ? 'মুরগী' : 'বার্গার')}
                    </Text>
                  </TouchableOpacity>
                  
                  {/* বাকি */}
                  <View style={styles.panelInputGroup}>
                    <Text style={styles.panelLabel}>বাকি (৳)</Text>
                    {isAdmin ? (
                      <TextInput
                        style={[styles.panelTextInput, styles.panelHighlightInput]}
                        keyboardType="numeric"
                        value={bakiInputs[supplier.id]}
                        onChangeText={(val) => setBakiInputs(prev => ({ ...prev, [supplier.id]: val }))}
                      />
                    ) : (
                      <View style={styles.panelReadOnlyBakiBox}>
                        <Text style={styles.panelReadOnlyBakiText}>
                          {parseFloat(bakiInputs[supplier.id] || 0).toLocaleString()}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* জমা */}
                  <View style={styles.panelInputGroup}>
                    <Text style={styles.panelLabel}>জমা (৳)</Text>
                    <View style={styles.panelReadOnlyBox}>
                      <Text style={styles.panelReadOnlyText}>
                        {supplier.payment_amount.toLocaleString()}
                      </Text>
                    </View>
                  </View>

                  {/* বাজার */}
                  <View style={styles.panelInputGroup}>
                    <Text style={styles.panelLabel}>বাজার (৳)</Text>
                    <TextInput
                      style={[styles.panelTextInput, styles.panelHighlightInput]}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor="#64748B"
                      value={inputs[supplier.id]?.purchaseAmount}
                      onChangeText={(val) => setInputs(prev => ({
                        ...prev,
                        [supplier.id]: { ...prev[supplier.id], purchaseAmount: val }
                      }))}
                    />
                  </View>

                  {/* Save Button */}
                  <TouchableOpacity 
                    style={styles.panelSaveBtn} 
                    onPress={() => handleSaveIndividual(supplier.id)}
                  >
                    <Text style={styles.panelSaveBtnText}>সেভ</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>

          {/* History Ledger for Selected Month */}
          <View style={styles.historySection}>
            <Text style={styles.historySectionTitle}>📜 বাকির ইতিহাস ({filteredHistory.length})</Text>
            {filteredHistory.length === 0 ? (
              <Text style={styles.emptyText}>এই মাসে কোনো বাকির রেকর্ড পাওয়া যায়নি।</Text>
            ) : (
              filteredHistory.map(item => {
                const displayName = (item.supplier_name && item.supplier_name.trim() !== '') 
                  ? item.supplier_name 
                  : (item.supplier_id === 'dudu_store' ? 'দুধ' : item.supplier_id === 'akash_murgi' ? 'মুরগী' : 'বার্গার');
                return (
                  <View key={item.id} style={styles.historyCard}>
                    <View style={styles.historyRow}>
                      <Text style={styles.historyDate}>{formatDisplayDate(item.date)} - {displayName}</Text>
                      {userRole === 'admin' && (
                        <TouchableOpacity onPress={() => handleDeleteHistoryItem(item.id)}>
                          <Text style={styles.deleteIcon}>🗑️</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={styles.historyMathRow}>
                      <Text style={styles.historyLabel}>পূর্বের বকেয়া:</Text>
                      <Text style={styles.historyValue}>৳ {item.previous_due.toLocaleString()}</Text>
                    </View>
                    <View style={styles.historyMathRow}>
                      <Text style={styles.historyLabel}>ক্রয় (বাজার):</Text>
                      <Text style={styles.historyValue}>+ ৳ {item.purchase_amount.toLocaleString()}</Text>
                    </View>
                    <View style={styles.historyMathRow}>
                      <Text style={styles.historyLabel}>জমা:</Text>
                      <Text style={styles.historyValue}>- ৳ {item.payment_amount.toLocaleString()}</Text>
                    </View>
                    <View style={styles.historyDivider} />
                    <View style={styles.historyMathRow}>
                      <Text style={styles.historyLabelBold}>বর্তমান বকেয়া:</Text>
                      <Text style={styles.historyValueBold}>৳ {item.current_due.toLocaleString()}</Text>
                    </View>
                    <Text style={styles.historyCreator}>এন্ট্রি: {item.created_by}</Text>
                  </View>
                );
              })
            )}
          </View>

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Edit Supplier Name Modal */}
      {editNameModalVisible && (
        <View style={styles.editModalOverlay}>
          <View style={styles.editModalContent}>
            <Text style={styles.editModalTitle}>নাম পরিবর্তন করুন</Text>
            <TextInput
              style={styles.editModalInput}
              value={tempSupplierName}
              onChangeText={setTempSupplierName}
              placeholder="নতুন নাম লিখুন"
              placeholderTextColor="#64748B"
              autoFocus={true}
            />
            <View style={styles.editModalBtnRow}>
              <TouchableOpacity 
                style={styles.editModalCancelBtn} 
                onPress={() => setEditNameModalVisible(false)}
              >
                <Text style={styles.editModalCancelBtnText}>বাতিল</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.editModalSaveBtn} 
                onPress={handleSaveSupplierName}
              >
                <Text style={styles.editModalSaveBtnText}>সংরক্ষণ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#161616',
    backgroundColor: '#0D0D0D',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    marginRight: 16,
    padding: 4,
  },
  backArrow: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFB703',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  body: {
    padding: 12,
  },
  totalBanner: {
    backgroundColor: 'rgba(255, 183, 3, 0.08)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 15,
    borderWidth: 1,
    borderColor: 'rgba(255, 183, 3, 0.25)',
  },
  totalBannerLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 4,
  },
  totalBannerValue: {
    color: '#FFB703',
    fontSize: 22,
    fontWeight: 'bold',
  },
  filterTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  monthScroll: {
    marginBottom: 15,
    maxHeight: 35,
  },
  monthScrollContent: {
    gap: 8,
    paddingRight: 10,
    paddingLeft: 4,
  },
  monthButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  monthButtonSelected: {
    backgroundColor: '#FFB703',
    borderColor: '#FFB703',
  },
  monthText: {
    color: '#888',
    fontSize: 11,
    fontWeight: '500',
  },
  monthTextSelected: {
    color: '#000',
    fontWeight: 'bold',
  },
  sectionHeaderTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  rowContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginBottom: 15,
  },
  panel: {
    flex: 1,
    backgroundColor: 'rgba(16, 37, 24, 0.6)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.3)',
    padding: 10,
    marginHorizontal: 3,
  },
  panelTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#FFF',
    textAlign: 'center',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(52, 211, 153, 0.15)',
    paddingBottom: 4,
  },
  panelInputGroup: {
    marginBottom: 8,
  },
  panelLabel: {
    color: '#34D399',
    fontSize: 10,
    marginBottom: 4,
    textAlign: 'center',
    fontWeight: '600',
  },
  panelTextInput: {
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 4,
    color: '#FFF',
    fontSize: 12,
    textAlign: 'center',
  },
  panelHighlightInput: {
    borderColor: '#34D399',
  },
  panelReadOnlyBakiBox: {
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 8,
    paddingVertical: 5,
  },
  panelReadOnlyBakiText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  panelReadOnlyBox: {
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 8,
    paddingVertical: 5,
  },
  panelReadOnlyText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  panelSaveBtn: {
    backgroundColor: '#FFB703',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  panelSaveBtnText: {
    color: '#000',
    fontSize: 11,
    fontWeight: 'bold',
  },
  historySection: {
    marginTop: 15,
  },
  historySectionTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#FFF',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  historyCard: {
    backgroundColor: '#0D0D0D',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#161616',
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  historyDate: {
    color: '#FFB703',
    fontSize: 12,
    fontWeight: 'bold',
  },
  deleteIcon: {
    fontSize: 14,
  },
  historyMathRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  historyLabel: {
    color: '#888',
    fontSize: 12,
  },
  historyValue: {
    color: '#FFF',
    fontSize: 12,
  },
  historyDivider: {
    height: 1,
    backgroundColor: '#161616',
    marginVertical: 6,
  },
  historyLabelBold: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  historyValueBold: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: 'bold',
  },
  historyNote: {
    color: '#888',
    fontSize: 11,
    marginTop: 6,
    fontStyle: 'italic',
  },
  historyCreator: {
    color: '#555',
    fontSize: 9,
    marginTop: 4,
    textAlign: 'right',
  },
  emptyText: {
    color: '#555',
    textAlign: 'center',
    marginTop: 20,
    fontSize: 13,
  },
  editModalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  editModalContent: {
    backgroundColor: '#0D0D0D',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FFB703',
    padding: 20,
    width: width * 0.85,
    maxWidth: 320,
  },
  editModalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFF',
    marginBottom: 15,
    textAlign: 'center',
  },
  editModalInput: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 10,
    padding: 10,
    color: '#FFF',
    fontSize: 14,
    marginBottom: 15,
  },
  editModalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  editModalCancelBtn: {
    flex: 1,
    backgroundColor: '#1E1E1E',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  editModalCancelBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  editModalSaveBtn: {
    flex: 1,
    backgroundColor: '#FFB703',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  editModalSaveBtnText: {
    color: '#000',
    fontSize: 13,
    fontWeight: 'bold',
  }
});
