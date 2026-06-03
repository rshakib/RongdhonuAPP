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
import { formatDisplayDate } from '../database';

export default function PaymentSuccess({ tableId, totalAmount, paidAmount, paymentMethod, onReturnHome }) {
  const orderId = `#ORD-000${Math.floor(100000 + Math.random() * 900000)}`;
  const discountAmount = Math.max(0, totalAmount - paidAmount);
  const changeAmount = Math.max(0, paidAmount - totalAmount);

  // Dynamic payment icon
  const getMethodIcon = () => {
    switch (paymentMethod) {
      case 'বিকাশ': return '🐦';
      case 'রকেট': return '🚀';
      case 'নগদ': return '💰';
      case 'ডিসকাউন্ট': return '🏷️';
      case 'বাকি': return '😡';
      default: return '💵';
    }
  };

  const getFormattedTime = () => {
    const now = new Date();
    const formattedDate = formatDisplayDate(now);
    
    // Format 12-hour clock
    let hours = now.getHours();
    let minutes = now.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    minutes = minutes < 10 ? '0' + minutes : minutes;
    const strTime = hours + ':' + minutes + ' ' + ampm;

    return `${strTime}, ${formattedDate}`;
  };

  const transactionTime = getFormattedTime();

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.backButton} onPress={onReturnHome}>
            <Text style={styles.backArrow}>⬅</Text>
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>পেমেন্ট সম্পন্ন</Text>
            <Text style={styles.headerSub}>টেবিল - {tableId}  •  BUSY</Text>
          </View>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollBody} contentContainerStyle={styles.scrollContent}>
        {/* Success Alert Box */}
        <View style={styles.successCard}>
          <View style={styles.successCheckCircle}>
            <Text style={styles.checkText}>✓</Text>
          </View>
          <Text style={styles.successTitle}>পেমেন্ট সম্পন্ন হয়েছে!</Text>
          <Text style={styles.successSubtitle}>অর্ডারটি সফলতার সাথে সম্পন্ন হয়েছে।</Text>
        </View>

        {/* Payment Summary */}
        <View style={styles.receiptCard}>
          <Text style={styles.receiptSectionTitle}>পেমেন্ট সারাংশ</Text>
          
          <View style={styles.receiptGrid}>
            <View style={styles.receiptCol}>
              <Text style={styles.receiptLabel}>মোট পরিমাণ</Text>
              <Text style={styles.receiptAmount}>৳ {totalAmount}</Text>
            </View>
            <View style={styles.receiptCol}>
              <Text style={styles.receiptLabel}>প্রদানকৃত পরিমাণ</Text>
              <Text style={[styles.receiptAmount, styles.textGreen]}>৳ {paidAmount}</Text>
            </View>
          </View>

          <View style={styles.receiptGrid}>
            <View style={styles.receiptCol}>
              <Text style={styles.receiptLabel}>{changeAmount > 0 ? 'ভাঙতি ফেরত:' : 'ডিসকাউন্ট:'}</Text>
              <Text style={[styles.receiptAmount, (discountAmount > 0 || changeAmount > 0) ? styles.textGreen : styles.textGreen]}>
                ৳ {changeAmount > 0 ? changeAmount : discountAmount}
              </Text>
            </View>
            <View style={styles.receiptCol}>
              <Text style={styles.receiptLabel}>লেনদেন সময়</Text>
              <Text style={styles.receiptTimeText}>🕒 {transactionTime}</Text>
            </View>
          </View>
        </View>

        {/* Payment Method */}
        <View style={styles.infoCard}>
          <Text style={styles.infoCardLabel}>পেমেন্ট মাধ্যম</Text>
          <View style={styles.paymentMethodValue}>
            <Text style={styles.cashIcon}>{getMethodIcon()}</Text>
            <Text style={styles.paymentMethodText}>{paymentMethod}</Text>
          </View>
        </View>



        {/* Action Button */}
        <TouchableOpacity style={styles.homeBtn} onPress={onReturnHome} activeOpacity={0.85}>
          <Text style={styles.homeIcon}>🏠</Text>
          <Text style={styles.homeBtnText}>হোমে ফিরে যান</Text>
        </TouchableOpacity>

        {/* Bottom Alert Text */}
        <View style={styles.bottomAlert}>
          <Text style={styles.bottomAlertText}>
            ℹ️ পেমেন্ট সম্পন্ন হওয়ার ৩০ মিনিট পর অর্ডারটি এডিট/ডিলিট করা যাবে না
          </Text>
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
  successCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderRadius: 16,
    paddingVertical: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  successCheckCircle: {
    backgroundColor: '#10B981',
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  checkText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
  },
  successTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#34D399',
  },
  successSubtitle: {
    fontSize: 12,
    color: '#888888',
    marginTop: 4,
  },
  receiptCard: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#161616',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  receiptSectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 14,
  },
  receiptGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  receiptCol: {
    flex: 1,
  },
  receiptLabel: {
    fontSize: 11,
    color: '#888888',
    marginBottom: 6,
  },
  receiptAmount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  receiptTimeText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginTop: 2,
  },
  textGreen: {
    color: '#34D399',
  },
  textRed: {
    color: '#FF4D4D',
  },
  infoCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#161616',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  infoCardLabel: {
    fontSize: 13,
    color: '#888888',
  },
  paymentMethodValue: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cashIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  paymentMethodText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },

  homeBtn: {
    flexDirection: 'row',
    backgroundColor: '#FFB703',
    height: 54,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFB703',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  homeIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  homeBtnText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: 'bold',
  },
  bottomAlert: {
    marginTop: 16,
    alignItems: 'center',
  },
  bottomAlertText: {
    fontSize: 10,
    color: '#888888',
    textAlign: 'center',
  },
});
