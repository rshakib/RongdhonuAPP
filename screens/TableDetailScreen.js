import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Platform,
  StatusBar as RNStatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function TableDetailScreen({
  table,
  onBack,
  onUpdateTableItems,
  onPaymentDone,
  onNavigateToAddItem
}) {
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

  // Calculate live totals
  const totalAmount = items.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const totalItemsCount = items.reduce((sum, item) => sum + item.qty, 0);

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
    if (existingIndex > -1) {
      updated[existingIndex].qty += 1;
    } else {
      updated.push({ name: 'পানি', price: 20, qty: 1 });
    }
    onUpdateTableItems(table.id, updated);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backArrow}>⬅</Text>
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>টেবিল - {table.name || table.id}</Text>
            <View style={styles.statusRow}>
              <View style={styles.busyDot} />
              <Text style={styles.statusText}>BUSY</Text>
              <Text style={styles.timeText}>শুরু: {table.startTime || 'এখনি'}</Text>
            </View>
          </View>
        </View>
        <TouchableOpacity style={styles.moreButton} onPress={onBack}>
          <Text style={styles.moreIcon}>⋮</Text>
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
      </ScrollView>

      {/* Dynamic Bottom Bar */}
      <View style={styles.bottomBar}>
        <View style={styles.summaryCol}>
          <Text style={styles.summaryLabel}>মোট পরিমাণ</Text>
          <Text style={styles.summaryAmount}>৳ {totalAmount}</Text>
          <Text style={styles.summaryCount}>{totalItemsCount} টি আইটেম</Text>
        </View>
        <TouchableOpacity
          style={[styles.paymentBtn, totalAmount === 0 && styles.paymentBtnDisabled]}
          disabled={totalAmount === 0}
          onPress={() => onPaymentDone(totalAmount)}
        >
          <Text style={styles.paymentBtnCheck}>✓</Text>
          <View>
            <Text style={styles.paymentBtnTitle}>Payment Done</Text>
            <Text style={styles.paymentBtnSubtitle}>পেমেন্ট সম্পন্ন করুন</Text>
          </View>
          <Text style={styles.paymentBtnArrow}>➔</Text>
        </TouchableOpacity>
      </View>
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
  moreButton: {
    padding: 6,
  },
  moreIcon: {
    fontSize: 22,
    color: '#FFFFFF',
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
});
