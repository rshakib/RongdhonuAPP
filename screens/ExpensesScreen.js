import React, { useState } from 'react';
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
import { formatDisplayDate, getBusinessDate } from '../database';

export default function ExpensesScreen({ dailyExpenses, onUpdateExpenses, isDailySubmitted, userRole, onBack }) {
  // Local state initialized with dailyExpenses from App.js
  const [duduMiah, setDuduMiah] = useState(dailyExpenses?.duduMiah?.toString() || '0');
  const [akashChicken, setAkashChicken] = useState(dailyExpenses?.akashChicken?.toString() || '0');
  const [burgerBun, setBurgerBun] = useState(dailyExpenses?.burgerBun?.toString() || '0');
  const [bazar, setBazar] = useState(dailyExpenses?.bazar?.toString() || '0');
  const [bazarNote, setBazarNote] = useState(dailyExpenses?.bazarNote || '');
  const [others, setOthers] = useState(dailyExpenses?.others?.toString() || '0');
  const [othersNote, setOthersNote] = useState(dailyExpenses?.othersNote || '');
  const [ijara, setIjara] = useState(dailyExpenses?.ijara?.toString() || '0');

  // Convert inputs to numbers dynamically
  const numDudu = parseFloat(duduMiah) || 0;
  const numAkash = parseFloat(akashChicken) || 0;
  const numBurger = parseFloat(burgerBun) || 0;
  const numBazar = parseFloat(bazar) || 0;
  const numOthers = parseFloat(others) || 0;
  const numIjara = parseFloat(ijara) || 0;

  const totalExpenses = numDudu + numAkash + numBurger + numBazar + numOthers;
  const totalForPercent = totalExpenses || 1; // avoid divide by zero

  const expensesList = [
    { name: '🛍️ দুদু মিয়া খরচ', amount: numDudu, rawValue: duduMiah, setter: setDuduMiah, percent: Math.round((numDudu / totalForPercent) * 100) },
    { name: '🐔 আকাশ মুরগী খরচ', amount: numAkash, rawValue: akashChicken, setter: setAkashChicken, percent: Math.round((numAkash / totalForPercent) * 100) },
    { name: '🍔 বার্গার বান খরচ', amount: numBurger, rawValue: burgerBun, setter: setBurgerBun, percent: Math.round((numBurger / totalForPercent) * 100) },
    { name: '🛒 বাজার খরচ', amount: numBazar, rawValue: bazar, setter: setBazar, percent: Math.round((numBazar / totalForPercent) * 100) },
    { name: '📦 অন্যান্য খরচ', amount: numOthers, rawValue: others, setter: setOthers, percent: Math.round((numOthers / totalForPercent) * 100) }
  ];

  // Dynamic Date and Time from mobile clock
  const getFormattedDateTime = () => {
    const days = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
    const now = new Date();
    const dayName = days[now.getDay()];
    const formattedDate = formatDisplayDate(now);
    
    let hours = now.getHours();
    let minutes = now.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    minutes = minutes < 10 ? '0' + minutes : minutes;
    
    return `${formattedDate} | ${hours}:${minutes} ${ampm} (${dayName})`;
  };

  const currentLiveDateTimeText = getFormattedDateTime();

  const handleSaveExpenses = () => {
    if (isDailySubmitted && userRole !== 'admin') {
      Alert.alert("লকড", "আজকের হিসাব সম্পন্ন হয়েছে।\nসিস্টেম সকাল ৬:০০ টায় পুনরায় চালু হবে।");
      return;
    }

    if (onUpdateExpenses) {
      onUpdateExpenses({
        duduMiah: numDudu,
        akashChicken: numAkash,
        burgerBun: numBurger,
        bazar: numBazar,
        bazarNote: bazarNote,
        others: numOthers,
        othersNote: othersNote,
        ijara: numIjara
      });

      Alert.alert(
        "সফল",
        "আজকের খরচ সমূহ সফলভাবে সংরক্ষণ করা হয়েছে!",
        [{ text: "ঠিক আছে", onPress: onBack }]
      );
    } else {
      onBack();
    }
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
            <Text style={styles.headerTitle}>📉 খরচ সমূহ (Expenses)</Text>
            <Text style={styles.headerSub}>রংধনু ক্যাফে এন্ড রেস্টুরেন্ট</Text>
          </View>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollBody} contentContainerStyle={styles.scrollContent}>
        {/* Lock State Alert Banner */}
        {isDailySubmitted && userRole !== 'admin' && (
          <View style={styles.lockedBanner}>
            <Text style={styles.lockedBannerText}>🔒 আজকের ডেইলি শীট সাবমিট করা হয়েছে। খরচ পরিবর্তন লক করা আছে।</Text>
          </View>
        )}

        {/* Total Cost Summary Card */}
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>আজকের মোট খরচ (Auto)</Text>
          <Text style={styles.totalValue}>৳ {totalExpenses}</Text>
          <Text style={styles.totalDate}>🕒 {currentLiveDateTimeText}</Text>
        </View>

        {/* Expenses List Card */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>
            {isDailySubmitted ? 'ব্যয় বিবরণী (সংরক্ষিত/লক)' : 'ব্যয় বিবরণী ও পরিবর্তন (ট্যাপ করে লিখুন)'}
          </Text>
          
          {expensesList.map((item, index) => (
            <View key={index} style={styles.expenseRow}>
              <View style={styles.expenseHeaderRow}>
                <Text style={styles.expenseName}>{item.name}</Text>
                
                <View style={[styles.amountInputRow, (isDailySubmitted && userRole !== 'admin') && styles.disabledInputRow]}>
                  <Text style={[styles.currencySymbolInput, (isDailySubmitted && userRole !== 'admin') && styles.disabledInputText]}>৳</Text>
                  <TextInput
                    style={[styles.expenseInput, (isDailySubmitted && userRole !== 'admin') && styles.disabledInputText]}
                    keyboardType="numeric"
                    value={item.rawValue}
                    onChangeText={item.setter}
                    placeholder="0"
                    placeholderTextColor="#888888"
                    editable={!isDailySubmitted || userRole === 'admin'}
                  />
                </View>
              </View>
              
              {/* Progress bar representing share of total cost */}
              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, { width: `${item.percent}%` }]} />
              </View>
              <Text style={styles.percentText}>{item.percent}% মোট খরচের</Text>

              {/* Sleek inline note field for grocery Bazar list */}
              {item.name === '🛒 বাজার খরচ' && (
                <View style={[styles.noteContainer, (isDailySubmitted && userRole !== 'admin') && styles.disabledInputRow]}>
                  <Text style={styles.noteLabel}>📝 নোট:</Text>
                  <TextInput
                    style={[styles.noteInput, (isDailySubmitted && userRole !== 'admin') && styles.disabledInputText]}
                    value={bazarNote}
                    onChangeText={setBazarNote}
                    placeholder="বাজারের তালিকা লিখুন... (যেমন: আলু, পেঁয়াজ)"
                    placeholderTextColor="#555555"
                    editable={!isDailySubmitted || userRole === 'admin'}
                  />
                </View>
              )}

              {/* Sleek inline note field for other expenses */}
              {item.name === '📦 অন্যান্য খরচ' && (
                <View style={[styles.noteContainer, (isDailySubmitted && userRole !== 'admin') && styles.disabledInputRow]}>
                  <Text style={styles.noteLabel}>📝 নোট:</Text>
                  <TextInput
                    style={[styles.noteInput, (isDailySubmitted && userRole !== 'admin') && styles.disabledInputText]}
                    value={othersNote}
                    onChangeText={setOthersNote}
                    placeholder="খরচের বিবরণ লিখুন... (যেমন: যাতায়াত ভাড়া)"
                    placeholderTextColor="#555555"
                    editable={!isDailySubmitted || userRole === 'admin'}
                  />
                </View>
              )}
            </View>
          ))}
        </View>

        {/* Other Payments (Ijara) */}
        <View style={styles.infoCard}>
          <View style={styles.infoLeft}>
            <Text style={styles.infoIcon}>💸</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoTitle}>আজকের ইজা (Ijara)</Text>
              <Text style={styles.infoSub}>দোকান ভাড়া বাবদ বরাদ্দ</Text>
            </View>
          </View>
          
          <View style={[styles.amountInputRow, (isDailySubmitted && userRole !== 'admin') && styles.disabledInputRow]}>
            <Text style={[styles.currencySymbolInput, (isDailySubmitted && userRole !== 'admin') && styles.disabledInputText]}>৳</Text>
            <TextInput
              style={[styles.expenseInput, (isDailySubmitted && userRole !== 'admin') && styles.disabledInputText]}
              keyboardType="numeric"
              value={ijara}
              onChangeText={setIjara}
              placeholder="0"
              placeholderTextColor="#888888"
              editable={!isDailySubmitted || userRole === 'admin'}
            />
          </View>
        </View>

        {/* Buttons Row */}
        <View style={styles.btnRow}>
          {(!isDailySubmitted || userRole === 'admin') ? (
            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveExpenses} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>✓ খরচ সংরক্ষণ করুন</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.lockedBtn}>
              <Text style={styles.lockedBtnText}>🔒 খরচ লক করা আছে (ডেইলি শীট সাবমিট করা)</Text>
            </View>
          )}
          
          <TouchableOpacity style={styles.closeBtn} onPress={onBack} activeOpacity={0.85}>
            <Text style={styles.closeBtnText}>{isDailySubmitted ? 'ড্যাশবোর্ডে ফিরে যান' : 'বাতিল করুন'}</Text>
          </TouchableOpacity>
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
    padding: 16,
    paddingBottom: 60,
  },
  lockedBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  lockedBannerText: {
    fontSize: 12,
    color: '#FCA5A5',
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 16,
  },
  totalCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  totalLabel: {
    fontSize: 13,
    color: '#FCA5A5',
    marginBottom: 8,
  },
  totalValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#EF4444',
    marginBottom: 6,
  },
  totalDate: {
    fontSize: 11,
    color: '#888888',
    textAlign: 'center',
    marginTop: 4,
  },
  sectionCard: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#161616',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderColor: '#1E1E1E',
    paddingBottom: 8,
  },
  expenseRow: {
    marginBottom: 16,
  },
  expenseHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  expenseName: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 8,
    width: 100,
    height: 36,
    paddingHorizontal: 8,
  },
  disabledInputRow: {
    backgroundColor: '#0B0B0B',
    borderColor: '#181818',
    opacity: 0.6,
  },
  currencySymbolInput: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: 'bold',
    marginRight: 4,
  },
  disabledInputText: {
    color: '#666666',
  },
  expenseInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
    height: '100%',
    textAlign: 'right',
    padding: 0,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#1E1E1E',
    borderRadius: 3,
    width: '100%',
    marginBottom: 4,
    marginTop: 6,
  },
  progressBarFill: {
    height: 6,
    backgroundColor: '#EF4444',
    borderRadius: 3,
  },
  percentText: {
    fontSize: 10,
    color: '#888888',
    textAlign: 'right',
  },
  noteContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#1C1C1C',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 36,
    marginTop: 6,
    marginBottom: 4,
  },
  noteLabel: {
    fontSize: 11,
    color: '#FFB703',
    marginRight: 6,
    fontWeight: 'bold',
  },
  noteInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 12,
    padding: 0,
    height: '100%',
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
    marginBottom: 24,
  },
  infoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  infoIcon: {
    fontSize: 22,
    marginRight: 12,
  },
  infoTitle: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  infoSub: {
    fontSize: 11,
    color: '#888888',
    marginTop: 2,
  },
  btnRow: {
    gap: 12,
  },
  saveBtn: {
    backgroundColor: '#FFB703',
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFB703',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  saveBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: 'bold',
  },
  lockedBtn: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lockedBtnText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: 'bold',
  },
  closeBtn: {
    backgroundColor: '#1E1E1E',
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#262626',
  },
  closeBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
});
