import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Platform,
  StatusBar as RNStatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrintReceiptModal from '../components/PrintReceiptModal';
import { BILL_SHOP_PHONE } from '../components/ReceiptPaper';

const formatStartTime = (timeStr) => {
  if (!timeStr) return '';
  if (timeStr.includes('T')) {
    try {
      const d = new Date(timeStr);
      if (!isNaN(d.getTime())) {
        let hours = d.getHours();
        let minutes = d.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        minutes = minutes < 10 ? '0' + minutes : minutes;
        return `${hours}:${minutes} ${ampm}`;
      }
    } catch (e) {}
  }
  return timeStr;
};

export default function TableDetailScreen({
  table: propTable,
  onBack,
  onUpdateTableItems,
  onUpdateDeliveryDetails,
  onPaymentDone,
  onNavigateToAddItem,
  onDeliveryBillComplete
}) {
  const lastTableRef = useRef(propTable);
  if (propTable) {
    lastTableRef.current = propTable;
  }
  const table = propTable || lastTableRef.current;

  if (!table) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: '#FFF', fontSize: 16 }}>অর্ডার পাওয়া যায়নি বা লোড হচ্ছে...</Text>
        <TouchableOpacity onPress={onBack} style={{ marginTop: 20, padding: 12, backgroundColor: '#FFB703', borderRadius: 8 }}>
          <Text style={{ color: '#000', fontWeight: 'bold' }}>ড্যাশবোর্ডে ফিরে যান</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const items = table.items || [];

  const [deliveryChargeText, setDeliveryChargeText] = useState(table.deliveryCharge?.toString() || '0');
  const [changeMoneyText, setChangeMoneyText] = useState(table.changeMoneyGiven?.toString() || '0');
  const [printOrder, setPrintOrder] = useState(null);
  const [isSubmittingBill, setIsSubmittingBill] = useState(false);
  const isSubmittingBillRef = useRef(false);

  useEffect(() => {
    if (table) {
      if (table.deliveryCharge !== undefined && table.deliveryCharge !== null) {
        setDeliveryChargeText(table.deliveryCharge.toString());
      }
      if (table.changeMoneyGiven !== undefined && table.changeMoneyGiven !== null) {
        setChangeMoneyText(table.changeMoneyGiven.toString());
      }
    }
  }, [table?.id, table?.deliveryCharge, table?.changeMoneyGiven]);

  const deliveryCharge = parseFloat(deliveryChargeText) || 0;
  const changeMoneyGiven = parseFloat(changeMoneyText) || 0;
  
  // Requirement: Only use the value already SAVED in DB for the Grand Total
  // This ensures that typing in the field doesn't change the bill until "Confirm" is pressed.
  const appliedChangeMoney = table.changeMoneyGiven || 0;

  const isDelivery = table.id && (table.id.toString().startsWith('D-') || table.id.toString().includes('Delivery') || table.name?.toString().includes('Delivery'));

  // Calculate live totals
  const totalAmount = items.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const totalItemsCount = items.reduce((sum, item) => sum + item.qty, 0);
  // Grand Total only includes appliedChangeMoney (the one deducted from cash)
  const grandTotal = totalAmount + (isDelivery ? (deliveryCharge + appliedChangeMoney) : 0);

  // Customer bill for THIS table's current order — so the customer can see the total.
  const buildBillOrder = () => ({
    id: `BILL-${table.id}`,
    tableId: table.name || table.id,
    fullDate: new Date().toISOString().substring(0, 10),
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    items: items.map((it) => ({ name: it.name, qty: it.qty, price: it.price, total: it.price * it.qty })),
    totalAmount,
    deliveryCharge: isDelivery ? deliveryCharge : 0,
    changeMoneyGiven: isDelivery ? appliedChangeMoney : 0,
    paidAmount: grandTotal,
    paymentMethod: 'বিল',
    isLiveBill: true
  });

  const handleBillPress = async () => {
    if (!items || items.length === 0) {
      Alert.alert("সতর্কতা", "কোনো আইটেম যোগ করা হয়নি।");
      return;
    }

    if (isDelivery) {
      if (isSubmittingBillRef.current) return;
      isSubmittingBillRef.current = true;
      setIsSubmittingBill(true);

      try {
        const itemsSubtotal = items.reduce((sum, item) => sum + (item.price * item.qty), 0);
        const currentDeliveryCharge = parseFloat(deliveryChargeText) || 0;
        const currentChangeMoney = appliedChangeMoney || 0;
        const finalTotal = itemsSubtotal + currentDeliveryCharge + currentChangeMoney;

        // Build receipt items list with delivery charge row included so printed receipt transparently shows items + delivery charge = সর্বমোট
        const receiptItems = items.map((it) => ({
          name: it.name,
          qty: it.qty,
          price: it.price,
          total: it.price * it.qty,
        }));
        if (currentChangeMoney > 0) {
          receiptItems.push({
            name: 'ভাঙতি টাকা',
            qty: 1,
            price: currentChangeMoney,
            total: currentChangeMoney,
          });
        }
        if (currentDeliveryCharge > 0) {
          receiptItems.push({
            name: 'ডেলিভারি চার্জ',
            qty: 1,
            price: currentDeliveryCharge,
            total: currentDeliveryCharge,
          });
        }

        const deliveryBillOrder = {
          id: `BILL-${table.id}`,
          tableId: table.name || table.id,
          fullDate: new Date().toISOString().substring(0, 10),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          items: receiptItems,
          totalAmount: finalTotal,
          deliveryCharge: 0,
          changeMoneyGiven: 0,
          paidAmount: finalTotal,
          grandTotal: finalTotal,
          paymentMethod: 'বিল',
          isLiveBill: false,
        };

        setPrintOrder(deliveryBillOrder);

        // Update delivery details and total in database while keeping delivery active
        if (onUpdateDeliveryDetails) {
          onUpdateDeliveryDetails(table.id, currentDeliveryCharge, currentChangeMoney);
        }
      } catch (err) {
        console.error("Error submitting delivery bill:", err);
      } finally {
        isSubmittingBillRef.current = false;
        setIsSubmittingBill(false);
      }
    } else {
      setPrintOrder(buildBillOrder());
    }
  };

  const handleApplyChangeMoney = () => {
    if (isDelivery && onUpdateDeliveryDetails) {
       onUpdateDeliveryDetails(table.id, deliveryCharge, changeMoneyGiven);
       Alert.alert("সফল", `৳${changeMoneyGiven} আপনার "মোট ক্যাশ" থেকে বিয়োগ করা হয়েছে এবং বিলে যোগ করা হয়েছে।`);
    }
  };

  const handleApplyDeliveryCharge = (chargeValue) => {
    const charge = chargeValue !== undefined ? (parseFloat(chargeValue) || 0) : (parseFloat(deliveryChargeText) || 0);
    setDeliveryChargeText(charge.toString());
    if (isDelivery && onUpdateDeliveryDetails) {
       onUpdateDeliveryDetails(table.id, charge, appliedChangeMoney);
    }
  };

  const handleBack = () => {
    if (isDelivery && onUpdateDeliveryDetails) {
      const currentCharge = parseFloat(deliveryChargeText) || 0;
      onUpdateDeliveryDetails(table.id, currentCharge, appliedChangeMoney);
    }
    onBack();
  };

  // Increase item quantity in cart
  const handleIncreaseQty = (index) => {
    const updated = [...items];
    updated[index].qty += 1;
    onUpdateTableItems(table.id, updated);
  };

  // Decrease item quantity in cart
  const handleDecreaseQty = (index) => {
    const updated = [...items];
    if (updated[index].qty > 1) {
      updated[index].qty -= 1;
      onUpdateTableItems(table.id, updated);
    }
  };

  // Delete item from cart
  const handleDeleteItem = (index) => {
    const updated = items.filter((_, i) => i !== index);
    onUpdateTableItems(table.id, updated);
  };

  // Quick add water (পানি ৳ 20) - Fixed quick add (Rules 2 & 3)
  const handleQuickAddWater = () => {
    const existingIndex = items.findIndex(item => item.name === 'পানি');
    const updated = [...items];
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (existingIndex > -1) {
      updated[existingIndex].qty += 1;
      if (!updated[existingIndex].time) updated[existingIndex].time = nowTime;
      if (!updated[existingIndex].addedBy) updated[existingIndex].addedBy = 'কাউন্টার';
    } else {
      updated.push({ name: 'পানি', price: 20, qty: 1, time: nowTime, addedBy: 'কাউন্টার' });
    }
    onUpdateTableItems(table.id, updated);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Text style={styles.backArrow}>⬅</Text>
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>টেবিল - {table.name || table.id}</Text>
            <View style={styles.statusRow}>
              <View style={styles.busyDot} />
              <Text style={styles.statusText}>BUSY</Text>
              <Text style={styles.timeText}>শুরু: {formatStartTime(table.startTime) || 'এখনি'}</Text>
            </View>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.headerPrintBtn, isSubmittingBill && { opacity: 0.6 }]}
          onPress={handleBillPress}
          disabled={isSubmittingBill}
          activeOpacity={0.85}
        >
          <Text style={styles.headerPrintIcon}>🖨️</Text>
          <Text style={styles.headerPrintText}>বিল</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollBody} contentContainerStyle={styles.scrollContent}>
        {/* Quick Add Section - Fixed quick-add button for Water (Rules 2 & 3) */}
        <View style={styles.quickAddCard}>
          <View style={styles.quickAddLeft}>
            <Text style={styles.waterIcon}>💧</Text>
            <View>
              <Text style={styles.quickAddTitle}>পানি ৳ 20</Text>
              <Text style={styles.quickAddSubtitle}>এক ট্যাপে যোগ করুন</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.quickAddBtn} onPress={handleQuickAddWater}>
            <Text style={styles.quickAddBtnText}>+ যোগ করুন</Text>
          </TouchableOpacity>
        </View>

        {/* Order List Title Row */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>অর্ডার লিস্ট</Text>
          <TouchableOpacity onPress={onNavigateToAddItem}>
            <Text style={styles.addItemText}>+ আইটেম যোগ করুন</Text>
          </TouchableOpacity>
        </View>

        {/* Order List Table Headers */}
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.th, styles.thItem]}>আইটেম</Text>
          <Text style={[styles.th, styles.thPrice]}>দাম</Text>
          <Text style={[styles.th, styles.thQty]}>পরিমাণ</Text>
          <Text style={[styles.th, styles.thTotal]}>মোট</Text>
          <View style={styles.thDeleteSpacer} />
        </View>

        {/* Order List Items */}
        {items.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>কোনো আইটেম যোগ করা হয়নি। নিচে ক্লিক করে আইটেম যোগ করুন।</Text>
          </View>
        ) : (
          <View style={styles.listContainer}>
            {items.map((item, index) => (
              <View key={index} style={styles.tableRow}>
                <Text style={[styles.td, styles.tdItem]} numberOfLines={1}>
                  {item.name}
                </Text>
                
                <Text style={[styles.td, styles.tdPrice]}>
                  ৳ {item.price}
                </Text>
                
                <View style={[styles.td, styles.tdQty]}>
                  <View style={styles.qtyContainer}>
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => handleDecreaseQty(index)}>
                      <Text style={styles.qtyBtnText}>-</Text>
                    </TouchableOpacity>
                    <Text style={styles.qtyValue}>{item.qty}</Text>
                    <TouchableOpacity style={[styles.qtyBtn, styles.qtyBtnPlus]} onPress={() => handleIncreaseQty(index)}>
                      <Text style={[styles.qtyBtnText, styles.qtyBtnTextPlus]}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                
                <Text style={[styles.td, styles.tdTotal]}>
                  ৳ {item.price * item.qty}
                </Text>
                
                <TouchableOpacity style={styles.deleteRowBtn} onPress={() => handleDeleteItem(index)}>
                  <Text style={styles.deleteRowText}>❌</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Dotted Add Button */}
        <TouchableOpacity style={styles.dottedAddButton} onPress={onNavigateToAddItem}>
          <Text style={styles.dottedAddText}>➕ মেনু থেকে আইটেম যোগ করুন</Text>
        </TouchableOpacity>

        {/* Delivery Charge and Change Money given (Optional for Delivery Orders) */}
        {isDelivery && (
          <View style={{ marginBottom: 20 }}>
            {/* Delivery Charge Section */}
            <View style={styles.deliveryChargeCard}>
              <View style={styles.deliveryChargeHeader}>
                <Text style={styles.deliveryChargeTitle}>🚚 ডেলিভারি চার্জ নির্ধারণ করুন</Text>
                <Text style={styles.deliveryChargeSubtitle}>ডেলিভারি চার্জ যুক্ত করতে বাটন চাপুন বা টাইপ করুন</Text>
              </View>
              
              {/* Presets Row */}
              <View style={styles.presetsRow}>
                {[20, 50, 80, 100].map((val) => (
                  <TouchableOpacity
                    key={val}
                    style={[
                      styles.presetBtn,
                      deliveryCharge === val && styles.presetBtnSelected
                    ]}
                    onPress={() => {
                      handleApplyDeliveryCharge(val);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[
                      styles.presetBtnText,
                      deliveryCharge === val && styles.presetBtnTextSelected
                    ]}>৳ {val}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[
                    styles.presetBtn,
                    ![20, 50, 80, 100, 0].includes(deliveryCharge) && styles.presetBtnSelected
                  ]}
                  onPress={() => setDeliveryChargeText('')}
                  activeOpacity={0.8}
                >
                  <Text style={[
                    styles.presetBtnText,
                    ![20, 50, 80, 100, 0].includes(deliveryCharge) && styles.presetBtnTextSelected
                  ]}>অন্যান্য</Text>
                </TouchableOpacity>
              </View>

              {/* Manual TextInput */}
              <View style={styles.manualInputRow}>
                <View style={styles.manualInputWrapper}>
                  <Text style={styles.manualCurrencySymbol}>৳</Text>
                  <TextInput
                    style={styles.manualTextInput}
                    keyboardType="numeric"
                    placeholder="অন্য পরিমাণ লিখুন"
                    placeholderTextColor="#666"
                    value={deliveryChargeText === '0' ? '' : deliveryChargeText}
                    onChangeText={(txt) => {
                      const cleanTxt = txt.replace(/[^0-9]/g, '');
                      setDeliveryChargeText(cleanTxt);
                      if (isDelivery && onUpdateDeliveryDetails) {
                        const parsed = parseFloat(cleanTxt) || 0;
                        onUpdateDeliveryDetails(table.id, parsed, appliedChangeMoney);
                      }
                    }}
                    onBlur={() => handleApplyDeliveryCharge()}
                  />
                </View>
                {deliveryCharge > 0 && (
                  <TouchableOpacity
                    style={styles.clearBtn}
                    onPress={() => {
                      handleApplyDeliveryCharge(0);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.clearBtnText}>মুছে ফেলুন ×</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Change Money Given Section (Requirement 2 with Button) */}
            <View style={[styles.deliveryChargeCard, { marginTop: 12, borderColor: 'rgba(239, 68, 68, 0.3)', backgroundColor: 'rgba(239, 68, 68, 0.02)' }]}>
              <View style={styles.deliveryChargeHeader}>
                <Text style={[styles.deliveryChargeTitle, { color: '#FCA5A5' }]}>💵 ভাঙতি টাকা (Change Money Given)</Text>
                <Text style={styles.deliveryChargeSubtitle}>ডেলিভারি বয়কে ক্যাশ থেকে কত ভাঙতি দেওয়া হয়েছে?</Text>
              </View>
              
              {/* Presets Row for Change Money */}
              <View style={styles.presetsRow}>
                {[100, 200, 500, 1000].map((val) => (
                  <TouchableOpacity
                    key={val}
                    style={[
                      styles.presetBtn,
                      changeMoneyGiven === val && { borderColor: '#EF4444', backgroundColor: 'rgba(239, 68, 68, 0.1)' }
                    ]}
                    onPress={() => setChangeMoneyText(val.toString())}
                    activeOpacity={0.8}
                  >
                    <Text style={[
                      styles.presetBtnText,
                      changeMoneyGiven === val && { color: '#EF4444' }
                    ]}>৳ {val}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Manual TextInput and Apply Button */}
              <View style={styles.manualInputRow}>
                <View style={[styles.manualInputWrapper, { flex: 1.5, borderColor: appliedChangeMoney > 0 ? '#EF4444' : '#262626' }]}>
                  <Text style={styles.manualCurrencySymbol}>৳</Text>
                  <TextInput
                    style={styles.manualTextInput}
                    keyboardType="numeric"
                    placeholder="পরিমাণ"
                    placeholderTextColor="#666"
                    value={changeMoneyText === '0' ? '' : changeMoneyText}
                    onChangeText={(txt) => {
                      const cleanTxt = txt.replace(/[^0-9]/g, '');
                      setChangeMoneyText(cleanTxt);
                    }}
                  />
                </View>
                
                <TouchableOpacity 
                  style={{ 
                    flex: 2, 
                    backgroundColor: '#EF4444', 
                    borderRadius: 10, 
                    height: 48, 
                    justifyContent: 'center', 
                    alignItems: 'center',
                    marginLeft: 8,
                    flexDirection: 'row'
                  }}
                  onPress={handleApplyChangeMoney}
                >
                   <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 11 }}>ক্যাশ থেকে বিয়োগ করুন</Text>
                </TouchableOpacity>
              </View>
              <Text style={{ color: '#F87171', fontSize: 9, marginTop: 8, opacity: 0.8 }}>
                {appliedChangeMoney > 0 
                  ? `✅ ৳${appliedChangeMoney} বর্তমানে আপনার "মোট ক্যাশ" থেকে বিয়োগ করা আছে।`
                  : '* বাটনটি টিপলে টাকাটি আপনার "মোট ক্যাশ" থেকে কমে যাবে এবং বিলে যোগ হবে।'}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Dynamic Bottom Bar */}
      <View style={styles.bottomBar}>
        <View style={styles.summaryCol}>
          <Text style={styles.summaryLabel}>{isDelivery ? "সর্বমোট (গ্র্যান্ড টোটাল)" : "মোট পরিমাণ"}</Text>
          <Text style={styles.summaryAmount}>৳ {grandTotal}</Text>
          <Text style={styles.summaryCount}>
            {totalItemsCount} টি আইটেম{isDelivery && deliveryCharge > 0 ? ` + ৳${deliveryCharge} চার্জ` : ''}
            {isDelivery && appliedChangeMoney > 0 ? ` + ৳${appliedChangeMoney} ভাঙতি` : ''}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.paymentBtn, totalAmount === 0 && styles.paymentBtnDisabled]}
          disabled={totalAmount === 0}
          onPress={() => {
            Alert.alert(
              "পেমেন্ট নিশ্চিত করুন",
              "আপনি কি কাস্টমারের কাছ থেকে পেমেন্ট বুঝে পেয়েছেন?\n\n⚠️ সতর্কতা: এই কাজটি অর্ডারটি সম্পন্ন করবে এবং এটি সহজে পরিবর্তন করা যাবে না।",
              [
                { text: "বাতিল", style: "cancel" },
                { 
                  text: "হ্যাঁ, পেমেন্ট পেয়েছি", 
                  onPress: () => onPaymentDone(totalAmount, deliveryCharge, changeMoneyGiven) 
                }
              ]
            );
          }}
        >
          <Text style={styles.paymentBtnCheck}>✓</Text>
          <View>
            <Text style={styles.paymentBtnTitle}>Payment Done</Text>
            <Text style={styles.paymentBtnSubtitle}>পেমেন্ট সম্পন্ন করুন</Text>
          </View>
          <Text style={styles.paymentBtnArrow}>➔</Text>
        </TouchableOpacity>
      </View>

      <PrintReceiptModal
        visible={!!printOrder}
        order={printOrder}
        onClose={() => {
          setPrintOrder(null);
          isSubmittingBillRef.current = false;
          setIsSubmittingBill(false);
        }}
        showPayment={false}
        phone={BILL_SHOP_PHONE}
      />
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
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  busyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FB923C',
    marginRight: 6,
  },
  statusText: {
    color: '#FB923C',
    fontSize: 10,
    fontWeight: 'bold',
    marginRight: 10,
  },
  timeText: {
    color: '#888888',
    fontSize: 11,
  },
  headerPrintBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 183, 3, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 183, 3, 0.5)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  headerPrintIcon: {
    fontSize: 15,
    marginRight: 5,
  },
  headerPrintText: {
    color: '#FFB703',
    fontSize: 12,
    fontWeight: 'bold',
  },
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 110,
  },
  quickAddCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 183, 3, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 183, 3, 0.2)',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  quickAddLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  waterIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  quickAddTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  quickAddSubtitle: {
    fontSize: 11,
    color: '#888888',
    marginTop: 2,
  },
  quickAddBtn: {
    borderWidth: 1,
    borderColor: '#FFB703',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  quickAddBtnText: {
    color: '#FFB703',
    fontSize: 12,
    fontWeight: 'bold',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  addItemText: {
    fontSize: 13,
    color: '#FFB703',
    fontWeight: '500',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#262626',
    marginBottom: 8,
  },
  th: {
    fontSize: 12,
    color: '#888888',
    fontWeight: '600',
  },
  thItem: {
    flex: 3.5,
  },
  thPrice: {
    flex: 2,
    textAlign: 'center',
  },
  thQty: {
    flex: 3,
    textAlign: 'center',
  },
  thTotal: {
    flex: 2,
    textAlign: 'right',
  },
  thDeleteSpacer: {
    width: 32,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  emptyText: {
    color: '#888888',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  listContainer: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#161616',
    borderRadius: 14,
    paddingHorizontal: 8,
    marginBottom: 16,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#161616',
  },
  td: {
    fontSize: 13,
    color: '#FFFFFF',
  },
  tdItem: {
    flex: 3.5,
    fontWeight: 'bold',
  },
  tdPrice: {
    flex: 2,
    textAlign: 'center',
  },
  tdQty: {
    flex: 3,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  qtyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#262626',
  },
  qtyBtn: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
  },
  qtyBtnPlus: {
    backgroundColor: 'rgba(52, 211, 153, 0.15)',
  },
  qtyBtnText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FF4D4D',
  },
  qtyBtnTextPlus: {
    color: '#34D399',
  },
  qtyValue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFFFFF',
    paddingHorizontal: 10,
  },
  tdTotal: {
    flex: 2,
    textAlign: 'right',
    fontWeight: 'bold',
  },
  deleteRowBtn: {
    width: 32,
    alignItems: 'flex-end',
    paddingVertical: 6,
  },
  deleteRowText: {
    fontSize: 12,
  },
  dottedAddButton: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 183, 3, 0.4)',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 183, 3, 0.02)',
  },
  dottedAddText: {
    color: '#FFB703',
    fontSize: 14,
    fontWeight: 'bold',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0D0D0D',
    borderTopWidth: 1,
    borderColor: '#161616',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryCol: {
    justifyContent: 'center',
  },
  summaryLabel: {
    fontSize: 11,
    color: '#888888',
  },
  summaryAmount: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFB703',
    marginVertical: 2,
  },
  summaryCount: {
    fontSize: 11,
    color: '#888888',
  },
  paymentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B981',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  paymentBtnDisabled: {
    backgroundColor: '#3E3E3E',
    opacity: 0.5,
    shadowOpacity: 0,
    elevation: 0,
  },
  paymentBtnCheck: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    width: 28,
    height: 28,
    borderRadius: 14,
    textAlign: 'center',
    lineHeight: 26,
    marginRight: 10,
  },
  paymentBtnTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  paymentBtnSubtitle: {
    color: '#A7F3D0',
    fontSize: 10,
    marginTop: 2,
  },
  paymentBtnArrow: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 12,
  },
  deliveryChargeCard: {
    backgroundColor: 'rgba(255, 183, 3, 0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255, 183, 3, 0.15)',
    borderRadius: 14,
    padding: 16,
    marginTop: 16,
    marginBottom: 10,
  },
  deliveryChargeHeader: {
    marginBottom: 12,
  },
  deliveryChargeTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  deliveryChargeSubtitle: {
    fontSize: 10,
    color: '#888888',
    marginTop: 4,
  },
  presetsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 8,
  },
  presetBtn: {
    flex: 1,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetBtnSelected: {
    backgroundColor: 'rgba(255, 183, 3, 0.15)',
    borderColor: '#FFB703',
  },
  presetBtnText: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '600',
  },
  presetBtnTextSelected: {
    color: '#FFB703',
    fontWeight: 'bold',
  },
  manualInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  manualInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 10,
    flex: 1,
    height: 44,
    paddingHorizontal: 12,
  },
  manualCurrencySymbol: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: 'bold',
    marginRight: 6,
  },
  manualTextInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    height: '100%',
    padding: 0,
  },
  clearBtn: {
    marginLeft: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  clearBtnText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '600',
  },
});
