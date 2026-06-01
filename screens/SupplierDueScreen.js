import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, TextInput, Modal, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getSupplierDueData, saveSupplierDue, getSupplierDueHistory, deleteSupplierDueHistory, formatDisplayDate } from '../database';

export default function SupplierDueScreen({ userRole, userDisplayName, onBack }) {
  const [dueData, setDueData] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // History Modal State
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyData, setHistoryData] = useState([]);
  const [selectedSupplierName, setSelectedSupplierName] = useState('');

  // Editable States
  const [inputs, setInputs] = useState({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    setLoading(true);
    const data = getSupplierDueData();
    // Sort so Dudu is first, Akash is second
    data.sort((a, b) => a.id.localeCompare(b.id)).reverse(); 
    
    setDueData(data);
    
    // Initialize input states
    const initInputs = {};
    data.forEach(item => {
      initInputs[item.id] = {
        purchaseAmount: '',
        note: item.note || ''
      };
    });
    setInputs(initInputs);
    setLoading(false);
  };

  const handleInputChange = (id, field, value) => {
    setInputs(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value
      }
    }));
  };

  const handleSave = (supplier) => {
    const id = supplier.id;
    const currentDueBeforeSave = parseFloat(supplier.current_due) || 0;
    const purchaseAmount = parseFloat(inputs[id].purchaseAmount) || 0;
    const note = inputs[id].note.trim();

    const success = saveSupplierDue(id, currentDueBeforeSave, purchaseAmount, note, userDisplayName);
    
    if (success) {
      Alert.alert('সফল', `${supplier.supplier_name} এর বাকির হিসাব হালনাগাদ করা হয়েছে।`);
      loadData();
    } else {
      Alert.alert('ত্রুটি', 'ডাটা সংরক্ষণ করতে সমস্যা হয়েছে।');
    }
  };

  const handleOpenHistory = (supplier) => {
    setSelectedSupplierName(supplier.supplier_name);
    const history = getSupplierDueHistory(supplier.id);
    setHistoryData(history);
    setHistoryVisible(true);
  };

  const handleDeleteHistory = (historyId) => {
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
              setHistoryData(prev => prev.filter(item => item.id !== historyId));
            } else {
              Alert.alert('ত্রুটি', 'ডিলিট করতে সমস্যা হয়েছে।');
            }
          } 
        }
      ]
    );
  };

  const calculatePreviewDue = (supplierId, currentDue, paymentAmount) => {
    const pur = parseFloat(inputs[supplierId]?.purchaseAmount) || 0;
    return currentDue + pur - paymentAmount;
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

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backBtnText}>❮ পিছনে</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>📒 বাকির হিসাব</Text>
        <View style={{ width: 60 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 100 }}>
          
          {/* Total Due Banner */}
          <View style={styles.totalBanner}>
            <Text style={styles.totalBannerLabel}>মোট বকেয়া (Total Due)</Text>
            <Text style={styles.totalBannerValue}>৳ {totalDue.toLocaleString()}</Text>
          </View>

          {/* Supplier Cards */}
          {dueData.map(supplier => (
            <View key={supplier.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.supplierName}>{supplier.supplier_name}</Text>
                <TouchableOpacity style={styles.historyBtn} onPress={() => handleOpenHistory(supplier)}>
                  <Text style={styles.historyBtnText}>📜 হিস্ট্রি</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.cardBody}>
                {/* Current Due (Read Only) */}
                <View style={styles.resultBox}>
                  <Text style={styles.resultLabel}>বর্তমান বকেয়া (Current Due)</Text>
                  <Text style={styles.resultValue}>৳ {(supplier.current_due || 0).toLocaleString()}</Text>
                </View>

                {/* Today's Purchase */}
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>আজকের ক্রয় (Today's Purchase)</Text>
                  <TextInput
                    style={[styles.input, styles.inputHighlight]}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor="#666"
                    value={inputs[supplier.id]?.purchaseAmount}
                    onChangeText={(val) => handleInputChange(supplier.id, 'purchaseAmount', val)}
                  />
                </View>

                {/* Today's Payment (Auto from Expense) */}
                <View style={styles.inputGroup}>
                  <Text style={styles.labelAuto}>আজকের জমা (Payment - Auto)</Text>
                  <View style={styles.autoValueBox}>
                    <Text style={styles.autoValueText}>- ৳ {supplier.payment_amount.toLocaleString()}</Text>
                  </View>
                </View>

                {/* Note */}
                <View style={[styles.inputGroup, { marginTop: 5 }]}>
                  <Text style={styles.label}>নোট (ঐচ্ছিক)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="নোট লিখুন..."
                    placeholderTextColor="#666"
                    value={inputs[supplier.id]?.note}
                    onChangeText={(val) => handleInputChange(supplier.id, 'note', val)}
                  />
                </View>

                <TouchableOpacity style={styles.saveBtn} onPress={() => handleSave(supplier)}>
                  <Text style={styles.saveBtnText}>💾 সেভ করুন (New Due: ৳{calculatePreviewDue(supplier.id, supplier.current_due, supplier.payment_amount).toLocaleString()})</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

        </ScrollView>
      </KeyboardAvoidingView>

      {/* History Modal */}
      <Modal animationType="slide" transparent={true} visible={historyVisible} onRequestClose={() => setHistoryVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selectedSupplierName} - হিস্ট্রি</Text>
              <TouchableOpacity onPress={() => setHistoryVisible(false)} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.historyList}>
              {historyData.length === 0 ? (
                <Text style={styles.emptyText}>কোনো হিস্ট্রি পাওয়া যায়নি।</Text>
              ) : (
                historyData.map(item => (
                  <View key={item.id} style={styles.historyCard}>
                    <View style={styles.historyRow}>
                      <Text style={styles.historyDate}>{formatDisplayDate(item.date)}</Text>
                      {userRole === 'admin' && (
                        <TouchableOpacity onPress={() => handleDeleteHistory(item.id)}>
                          <Text style={styles.deleteIcon}>🗑️</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={styles.historyMathRow}>
                      <Text style={styles.historyLabel}>পূর্বের বকেয়া:</Text>
                      <Text style={styles.historyValue}>৳{item.previous_due}</Text>
                    </View>
                    <View style={styles.historyMathRow}>
                      <Text style={styles.historyLabel}>ক্রয়:</Text>
                      <Text style={styles.historyValue}>+ ৳{item.purchase_amount}</Text>
                    </View>
                    <View style={styles.historyMathRow}>
                      <Text style={styles.historyLabel}>জমা:</Text>
                      <Text style={styles.historyValue}>- ৳{item.payment_amount}</Text>
                    </View>
                    <View style={styles.historyDivider} />
                    <View style={styles.historyMathRow}>
                      <Text style={styles.historyLabelBold}>বর্তমান বকেয়া:</Text>
                      <Text style={styles.historyValueBold}>৳{item.current_due}</Text>
                    </View>
                    {item.note ? <Text style={styles.historyNote}>নোট: {item.note}</Text> : null}
                    <Text style={styles.historyCreator}>এন্ট্রি: {item.created_by}</Text>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingVertical: 15,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  backBtn: {
    padding: 8,
    backgroundColor: '#334155',
    borderRadius: 6,
  },
  backBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  headerTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: 'bold',
  },
  body: {
    padding: 15,
  },
  totalBanner: {
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#333',
  },
  totalBannerLabel: {
    color: '#94A3B8',
    fontSize: 14,
    marginBottom: 8,
  },
  totalBannerValue: {
    color: '#FFB703',
    fontSize: 32,
    fontWeight: 'bold',
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 15,
  },
  supplierName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  historyBtn: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.4)',
  },
  historyBtnText: {
    color: '#60A5FA',
    fontSize: 12,
    fontWeight: 'bold',
  },
  cardBody: {
    gap: 15,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    color: '#94A3B8',
    fontSize: 13,
  },
  labelAuto: {
    color: '#34D399',
    fontSize: 13,
    fontWeight: 'bold',
  },
  input: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 12,
    color: '#F8FAFC',
    fontSize: 16,
  },
  inputHighlight: {
    borderColor: '#FFB703',
    backgroundColor: 'rgba(255, 183, 3, 0.05)',
  },
  autoValueBox: {
    backgroundColor: 'rgba(52, 211, 153, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.3)',
    borderRadius: 8,
    padding: 12,
    alignItems: 'flex-end',
  },
  autoValueText: {
    color: '#34D399',
    fontSize: 16,
    fontWeight: 'bold',
  },
  mathDivider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 5,
  },
  resultBox: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 15,
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  resultLabel: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: 'bold',
  },
  resultValue: {
    color: '#FFB703',
    fontSize: 20,
    fontWeight: 'bold',
  },
  saveBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    padding: 15,
    alignItems: 'center',
    marginTop: 10,
  },
  saveBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '80%',
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 15,
  },
  modalTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeBtn: {
    backgroundColor: '#334155',
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  historyList: {
    flex: 1,
  },
  historyCard: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 15,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#334155',
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  historyDate: {
    color: '#94A3B8',
    fontSize: 12,
  },
  deleteIcon: {
    fontSize: 16,
  },
  historyMathRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  historyLabel: {
    color: '#94A3B8',
    fontSize: 13,
  },
  historyValue: {
    color: '#E2E8F0',
    fontSize: 13,
  },
  historyDivider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 8,
  },
  historyLabelBold: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: 'bold',
  },
  historyValueBold: {
    color: '#FFB703',
    fontSize: 14,
    fontWeight: 'bold',
  },
  historyNote: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 8,
    fontStyle: 'italic',
  },
  historyCreator: {
    color: '#475569',
    fontSize: 10,
    marginTop: 5,
    textAlign: 'right',
  },
  emptyText: {
    color: '#64748B',
    textAlign: 'center',
    marginTop: 30,
    fontSize: 14,
  }
});
