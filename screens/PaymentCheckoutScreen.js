import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform,
  StatusBar as RNStatusBar,
  Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatDisplayDate } from '../database';

export default function PaymentCheckoutScreen({
  tableId,
  totalAmount,
  totalItems,
  deliveryCharge = 0,
  changeMoneyGiven = 0,
  userRole,
  onBack,
  onCompletePayment
}) {
  const grandTotal = totalAmount + (deliveryCharge || 0) + (changeMoneyGiven || 0);
  const [amountInput, setAmountInput] = useState(grandTotal.toString());
  const [selectedMethod, setSelectedMethod] = useState('ক্যাশ'); // 'ক্যাশ', 'বিকাশ', 'রকেট', 'নগদ', 'বাকি', 'Split'

  // Split Payment States
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [breakdown, setBreakdown] = useState({
    cash: 0,
    bkash: 0,
    nagad: 0,
    rocket: 0,
    due: 0
  });

  const handleFullAmount = () => {
    setAmountInput(grandTotal.toString());
  };

  const totalEntered = Object.values(breakdown).reduce((sum, val) => sum + (parseFloat(val) || 0), 0);
  const remainingAmount = grandTotal - totalEntered;

  const handleComplete = () => {
    if (isSplitMode) {
      if (Math.abs(remainingAmount) > 0.01) {
        Alert.alert("ত্রুটি", "পেমেন্টের যোগফল গ্র্যান্ড টোটালের সমান হতে হবে!");
        return;
      }
      onCompletePayment(grandTotal, 'Split', breakdown);
      return;
    }

    const parsedAmount = parseFloat(amountInput);
    
    // Allow 0 specifically for 'Baki', but require > 0 for all other methods
    if (selectedMethod !== 'বাকি' && (isNaN(parsedAmount) || parsedAmount <= 0)) {
      Alert.alert("ত্রুটি", "সঠিক মূল্য টাইপ করুন!");
      return;
    }

    if (selectedMethod === 'বাকি' && isNaN(parsedAmount)) {
      Alert.alert("ত্রুটি", "সঠিক মূল্য টাইপ করুন!");
      return;
    }
    
    // Construct single-method breakdown
    const singleBreakdown = {
      cash: selectedMethod === 'ক্যাশ' ? parsedAmount : 0,
      bkash: selectedMethod === 'বিকাশ' ? parsedAmount : 0,
      nagad: selectedMethod === 'নগদ' ? parsedAmount : 0,
      rocket: selectedMethod === 'রকেট' ? parsedAmount : 0,
      due: selectedMethod === 'বাকি' ? parsedAmount : 0,
    };

    // Pass paid amount, method, and breakdown to completion handler
    onCompletePayment(parsedAmount, selectedMethod, singleBreakdown);
  };

  const handleSelectMethod = (methodId) => {
    if (methodId === 'Split') {
      setIsSplitMode(true);
      setSelectedMethod('Split');
      return;
    }
    setIsSplitMode(false);
    setSelectedMethod(methodId);
    if (methodId === 'বাকি') {
      setAmountInput('0'); // Default to 0 when Baki is selected
    } else if (amountInput === '0') {
      setAmountInput(grandTotal.toString()); // Revert to full total if switching back
    }
  };

  const updateBreakdown = (key, val) => {
    setBreakdown(prev => ({ ...prev, [key]: parseFloat(val) || 0 }));
  };

  const handlePrint = () => {
    Alert.alert("প্রিন্ট করুন", "রসিদ প্রিন্টারে পাঠানো হয়েছে...");
  };

  // Payment methods configuration matching mockup
  const paymentMethods = [
    { id: 'ক্যাশ', name: 'ক্যাশ', icon: '💵' },
    { id: 'বিকাশ', name: 'বিকাশ', icon: '🐦' },
    { id: 'রকেট', name: 'রকেট', icon: '🚀' },
    { id: 'নগদ', name: 'নগদ', icon: '💰' },
    { id: 'বাকি', name: 'বাকি', icon: '😡' },
    { id: 'Split', name: 'Split', icon: '🔀' }
  ].filter(method => !(userRole === 'owner' && method.id === 'বাকি'));

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backArrow}>⬅</Text>
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>পেমেন্ট</Text>
            <Text style={styles.headerSub}>টেবিল - {tableId}  •  BUSY</Text>
          </View>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollBody} contentContainerStyle={styles.scrollContent}>
        
        {/* Order Summary Box */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>অর্ডার সারাংশ</Text>
          <View style={styles.summaryGrid}>
            <View style={styles.summaryCol}>
              <Text style={styles.summaryLabel}>অর্ডার টোটাল</Text>
              <Text style={styles.summaryValue}>৳ {totalAmount}</Text>
            </View>
            <View style={styles.dividerLine} />
            <View style={styles.summaryCol}>
              <Text style={styles.summaryLabel}>ডেলিভারি চার্জ</Text>
              <Text style={[styles.summaryValue, { color: deliveryCharge > 0 ? '#FFB703' : '#666' }]}>৳ {deliveryCharge}</Text>
            </View>
            <View style={styles.dividerLine} />
            <View style={styles.summaryCol}>
              <Text style={styles.summaryLabel}>ভাঙতি টাকা</Text>
              <Text style={[styles.summaryValue, { color: changeMoneyGiven > 0 ? '#EF4444' : '#666' }]}>৳ {changeMoneyGiven}</Text>
            </View>
            <View style={styles.dividerLine} />
            <View style={styles.summaryCol}>
              <Text style={styles.summaryLabel}>গ্র্যান্ড টোটাল</Text>
              <Text style={[styles.summaryValue, { color: '#10B981' }]}>৳ {grandTotal}</Text>
            </View>
          </View>
        </View>

        {isSplitMode ? (
          /* Split Payment Breakdown UI - Enhanced Aesthetic */
          <View style={styles.sectionCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={styles.sectionTitle}>💰 পেমেন্ট ব্রেকডাউন</Text>
              <View style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                <Text style={{ color: '#10B981', fontSize: 10, fontWeight: 'bold' }}>Split Mode</Text>
              </View>
            </View>
            
            <View style={styles.splitGrid}>
              {[
                { id: 'cash', label: '💵 ক্যাশ (Cash)', color: '#FFFFFF' },
                { id: 'bkash', label: '🐦 বিকাশ (bKash)', color: '#E2136E' },
                { id: 'nagad', label: '💰 নগদ (Nagad)', color: '#F7941D' },
                { id: 'rocket', label: '🚀 রকেট (Rocket)', color: '#8C3494' },
                { id: 'due', label: '😡 বাকি (Due)', color: '#EF4444' }
              ].map((item) => (
                <View key={item.id} style={styles.splitRowEnhanced}>
                  <Text style={[styles.splitLabelEnhanced, { color: item.color }]}>{item.label}</Text>
                  <View style={[styles.splitInputWrapper, breakdown[item.id] > 0 && { borderColor: item.color, backgroundColor: 'rgba(255,255,255,0.03)' }]}>
                    <Text style={[styles.splitCurrency, { color: breakdown[item.id] > 0 ? item.color : '#444' }]}>৳</Text>
                    <TextInput 
                      style={styles.splitInputEnhanced} 
                      keyboardType="numeric" 
                      placeholder="0"
                      placeholderTextColor="#333"
                      value={breakdown[item.id] === 0 ? '' : breakdown[item.id].toString()}
                      onChangeText={(v) => updateBreakdown(item.id, v)}
                    />
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.splitSummaryContainer}>
               <View style={styles.splitStatusItem}>
                 <Text style={styles.splitStatusLabel}>মোট ইনপুট</Text>
                 <Text style={styles.splitStatusValue}>৳ {totalEntered.toLocaleString()}</Text>
               </View>
               <View style={[styles.splitStatusItem, { borderLeftWidth: 1, borderColor: '#222' }]}>
                 <Text style={styles.splitStatusLabel}>অবশিষ্ট</Text>
                 <Text style={[styles.splitStatusValue, { color: Math.abs(remainingAmount) < 0.01 ? '#10B981' : '#EF4444' }]}>
                   {remainingAmount === 0 ? '✓ সম্পন্ন' : `৳ ${remainingAmount.toFixed(0)}`}
                 </Text>
               </View>
            </View>
          </View>
        ) : (
          /* Payment Amount Input */
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>পেমেন্ট করার পরিমাণ (এডিট করতে পারবেন)</Text>
            <View style={styles.inputActionRow}>
              <View style={styles.amountInputWrapper}>
                <Text style={styles.currencySymbol}>৳</Text>
                <TextInput
                  style={styles.amountInput}
                  keyboardType="numeric"
                  value={amountInput}
                  onChangeText={setAmountInput}
                />
              </View>
              <TouchableOpacity style={styles.fullAmountBtn} onPress={handleFullAmount} activeOpacity={0.8}>
                <Text style={styles.fullAmountBtnText}>পুরো পরিমাণ</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Payment Methods */}
        <View style={styles.sectionCardNoBg}>
          <Text style={styles.sectionTitle}>পেমেন্ট পদ্ধতি</Text>
          <View style={styles.methodsGrid}>
            {paymentMethods.map((method) => {
              const isSelected = selectedMethod === method.id;
              return (
                <TouchableOpacity
                  key={method.id}
                  style={[
                    styles.methodCard,
                    isSelected && styles.methodCardSelected
                  ]}
                  onPress={() => handleSelectMethod(method.id)}
                  activeOpacity={0.8}
                >
                  <View style={styles.methodIconWrapper}>
                    <Text style={styles.methodIcon}>{method.icon}</Text>
                    {isSelected && (
                      <View style={styles.checkmarkIconCircle}>
                        <Text style={styles.checkmarkText}>✓</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.methodLabel}>{method.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>



        {/* Action Buttons */}
        <View style={styles.actionBtnRow}>
          <TouchableOpacity 
            style={[
              styles.completeBtn, 
              isSplitMode && Math.abs(remainingAmount) > 0.01 && { opacity: 0.5 }
            ]} 
            onPress={handleComplete} 
            activeOpacity={0.85}
            disabled={isSplitMode && Math.abs(remainingAmount) > 0.01}
          >
            <View style={styles.btnCheckCircle}>
              <Text style={styles.btnCheckText}>✓</Text>
            </View>
            <Text style={styles.completeBtnText}>পেমেন্ট সম্পন্ন করুন</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.printBtn} onPress={handlePrint} activeOpacity={0.8}>
            <Text style={styles.printerIcon}>🖨️</Text>
            <Text style={styles.printBtnText}>প্রিন্ট</Text>
          </TouchableOpacity>
        </View>

        {/* Footer Warning */}
        <TouchableOpacity style={styles.warningFooterRow} activeOpacity={0.8}>
          <Text style={styles.warningIcon}>ℹ️</Text>
          <Text style={styles.warningText}>
            পেমেন্ট সম্পন্ন হলে অর্ডার ৩০ মিনিট পর লক হবে
          </Text>
          <Text style={styles.warningArrow}>➔</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060606',
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
    fontSize: 20,
    color: '#FFB703',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  headerSub: {
    fontSize: 11,
    color: '#FB923C',
    marginTop: 4,
  },
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 16,
    paddingBottom: 100,
  },
  sectionCard: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#161616',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  sectionCardNoBg: {
    paddingVertical: 4,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 13,
    color: '#888888',
    marginBottom: 12,
  },
  summaryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryCol: {
    flex: 1,
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 11,
    color: '#888888',
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFB703',
    marginTop: 6,
  },
  dividerLine: {
    width: 1,
    height: 35,
    backgroundColor: '#1E1E1E',
  },
  inputActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  amountInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    flex: 1,
    height: 52,
    paddingHorizontal: 16,
    marginRight: 12,
  },
  currencySymbol: {
    fontSize: 18,
    color: '#FFFFFF',
    fontWeight: 'bold',
    marginRight: 6,
  },
  amountInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    height: '100%',
  },
  fullAmountBtn: {
    backgroundColor: '#FFB703',
    borderRadius: 12,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  fullAmountBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: 'bold',
  },
  methodsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  methodCard: {
    width: '31%',
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#161616',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    aspectRatio: 1,
  },
  methodCardSelected: {
    borderColor: '#FFB703',
  },
  methodIconWrapper: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    height: 38,
    width: 38,
  },
  methodIcon: {
    fontSize: 22,
  },
  checkmarkIconCircle: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: '#FFB703',
    width: 14,
    height: 14,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkText: {
    color: '#000000',
    fontSize: 9,
    fontWeight: 'bold',
  },
  methodLabel: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },

  actionBtnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  completeBtn: {
    flex: 2,
    flexDirection: 'row',
    backgroundColor: '#10B981',
    borderRadius: 14,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  btnCheckCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  btnCheckText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  completeBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  printBtn: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 14,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  printerIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  printBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  warningFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#161616',
    borderRadius: 12,
    padding: 12,
  },
  warningIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  warningText: {
    flex: 1,
    color: '#888888',
    fontSize: 11,
  },
  warningArrow: {
    color: '#888888',
    fontSize: 11,
  },
  /* Split Styles */
  splitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#161616',
  },
  splitLabel: {
    color: '#BBB',
    fontSize: 13,
    fontWeight: '500',
  },
  splitInput: {
    backgroundColor: '#161616',
    width: 100,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#262626',
    color: '#FFF',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: 'bold',
  },
  statusLabel: {
    color: '#888',
    fontSize: 12,
  },
  statusValue: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  totalStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  /* Enhanced Split Styles */
  splitGrid: {
    gap: 10,
  },
  splitRowEnhanced: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0A0A0A',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#161616',
  },
  splitLabelEnhanced: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  splitInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 8,
    width: 110,
    height: 38,
    paddingHorizontal: 8,
  },
  splitCurrency: {
    fontSize: 14,
    fontWeight: 'bold',
    marginRight: 4,
  },
  splitInputEnhanced: {
    flex: 1,
    color: '#FFF',
    fontSize: 15,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  splitSummaryContainer: {
    flexDirection: 'row',
    marginTop: 16,
    backgroundColor: '#0A0A0A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1A1A1A',
    overflow: 'hidden',
  },
  splitStatusItem: {
    flex: 1,
    padding: 12,
    alignItems: 'center',
  },
  splitStatusLabel: {
    color: '#666',
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  splitStatusValue: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: 'bold',
  }
});
