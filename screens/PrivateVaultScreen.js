import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, TextInput, Alert, Modal, KeyboardAvoidingView, Platform, ActivityIndicator, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { 
  getPrivateEmployees, addPrivateEmployee, updatePrivateEmployee, deletePrivateEmployee,
  getPrivateCategories, addPrivateCategory, updatePrivateCategory, deletePrivateCategory,
  getPrivateExpenses, addPrivateExpense, updatePrivateExpense, deletePrivateExpense,
  verifyOwnerPin, formatDisplayDate 
} from '../database';

const { width, height } = Dimensions.get('window');

export default function PrivateVaultScreen({ onBack }) {
  // Screen States: 'WARN', 'PIN', 'VAULT'
  const [screenState, setScreenState] = useState('WARN');
  const [pinInput, setPinInput] = useState('');
  const [activeTab, setActiveTab] = useState('DASHBOARD'); // 'DASHBOARD', 'EMPLOYEES', 'CATEGORIES', 'EXPENSES'
  
  // Data States
  const [employees, setEmployees] = useState([]);
  const [categories, setCategories] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(false);

  // Month & Year Filter States
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [yearsList, setYearsList] = useState([]);

  // Modal States
  const [employeeModalVisible, setEmployeeModalVisible] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [empName, setEmpName] = useState('');
  const [empSalary, setEmpSalary] = useState('');
  const [empNote, setEmpNote] = useState('');
  const [empPayDate, setEmpPayDate] = useState('');

  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [catName, setCatName] = useState('');

  const [expenseModalVisible, setExpenseModalVisible] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [expCategory, setExpCategory] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expDate, setExpDate] = useState('');
  const [expNote, setExpNote] = useState('');

  // Initial Filter Setup
  useEffect(() => {
    const now = new Date();
    const currentMonthPrefix = String(now.getMonth() + 1).padStart(2, '0');
    const currentYearPrefix = String(now.getFullYear());
    
    setSelectedMonth(currentMonthPrefix);
    setSelectedYear(currentYearPrefix);

    const years = [];
    for (let y = now.getFullYear() - 2; y <= now.getFullYear() + 1; y++) {
      years.push(String(y));
    }
    setYearsList(years);
  }, []);

  const loadData = () => {
    setLoading(true);
    setEmployees(getPrivateEmployees());
    setCategories(getPrivateCategories());
    setExpenses(getPrivateExpenses());
    setLoading(false);
  };

  const getEmployeeSalaryStats = (empId, empSalary) => {
    const now = new Date();
    const thisMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const paidThisMonth = expenses
      .filter(item => {
        const isThisMonth = item.date.startsWith(thisMonthPrefix);
        const isSalaryCat = item.category.toLowerCase().trim() === 'বেতন' || item.category.toLowerCase().trim() === 'salary';
        const matchesEmp = item.note && item.note.includes(empId);
        return isThisMonth && isSalaryCat && matchesEmp;
      })
      .reduce((sum, item) => sum + (item.amount || 0), 0);

    const remainingSalary = Math.max(0, empSalary - paidThisMonth);
    return { paidThisMonth, remainingSalary };
  };

  const handlePayEmployeeSalary = (emp, remainingSalary) => {
    setSelectedExpense(null);
    setExpCategory('বেতন');
    setExpAmount(String(remainingSalary > 0 ? remainingSalary : emp.salary));
    setExpDate(new Date().toISOString().split('T')[0]);
    setExpNote(`[${emp.id}] ${emp.name} এর বেতন`);
    setExpenseModalVisible(true);
  };

  const handleVerifyPin = () => {
    const isCorrect = verifyOwnerPin(pinInput);
    if (isCorrect) {
      setScreenState('VAULT');
      loadData();
    } else {
      Alert.alert('অ্যাক্সেস প্রত্যাখ্যান', 'ভুল PIN নম্বর! পুনরায় চেষ্টা করুন।');
      setPinInput('');
    }
  };

  const handlePinKeyPress = (num) => {
    if (pinInput.length >= 4) return;
    const newPin = pinInput + num;
    setPinInput(newPin);
  };

  const handlePinBackspace = () => {
    setPinInput(pinInput.slice(0, -1));
  };

  // EMPLOYEE ACTIONS
  const handleOpenAddEmployee = () => {
    setSelectedEmployee(null);
    setEmpName('');
    setEmpSalary('');
    setEmpNote('');
    setEmpPayDate(new Date().toISOString().split('T')[0]);
    setEmployeeModalVisible(true);
  };

  const handleOpenEditEmployee = (emp) => {
    setSelectedEmployee(emp);
    setEmpName(emp.name);
    setEmpSalary(String(emp.salary || 0));
    setEmpNote(emp.note || '');
    setEmpPayDate(emp.last_payment_date || new Date().toISOString().split('T')[0]);
    setEmployeeModalVisible(true);
  };

  const handleSaveEmployee = () => {
    if (!empName.trim()) {
      Alert.alert('ত্রুটি', 'কর্মচারীর নাম অবশ্যই দিতে হবে।');
      return;
    }
    const salaryVal = parseFloat(empSalary) || 0;

    let success = false;
    if (selectedEmployee) {
      success = updatePrivateEmployee(selectedEmployee.id, empName.trim(), salaryVal, empNote.trim(), empPayDate);
    } else {
      success = addPrivateEmployee(empName.trim(), salaryVal, empNote.trim());
    }

    if (success) {
      setEmployeeModalVisible(false);
      loadData();
    } else {
      Alert.alert('ত্রুটি', 'কর্মচারী তথ্য সংরক্ষণ করতে সমস্যা হয়েছে।');
    }
  };

  const handleDeleteEmployeeItem = (id) => {
    Alert.alert(
      "কর্মচারী মুছে ফেলুন",
      "আপনি কি নিশ্চিতভাবে এই কর্মচারীকে মুছে ফেলতে চান?",
      [
        { text: "বাতিল", style: "cancel" },
        { 
          text: "মুছে ফেলুন", 
          style: "destructive",
          onPress: () => {
            const success = deletePrivateEmployee(id);
            if (success) loadData();
            else Alert.alert('ত্রুটি', 'মুছে ফেলতে সমস্যা হয়েছে।');
          } 
        }
      ]
    );
  };

  // CATEGORY ACTIONS
  const handleOpenAddCategory = () => {
    setSelectedCategory(null);
    setCatName('');
    setCategoryModalVisible(true);
  };

  const handleOpenEditCategory = (cat) => {
    setSelectedCategory(cat);
    setCatName(cat.name);
    setCategoryModalVisible(true);
  };

  const handleSaveCategory = () => {
    if (!catName.trim()) {
      Alert.alert('ত্রুটি', 'ক্যাটাগরি নাম অবশ্যই দিতে হবে।');
      return;
    }

    let success = false;
    if (selectedCategory) {
      success = updatePrivateCategory(selectedCategory.id, catName.trim());
    } else {
      success = addPrivateCategory(catName.trim());
    }

    if (success) {
      setCategoryModalVisible(false);
      loadData();
    } else {
      Alert.alert('ত্রুটি', 'ক্যাটাগরি সংরক্ষণ করতে সমস্যা হয়েছে (নামটি ইউনিক হতে হবে)।');
    }
  };

  const handleDeleteCategoryItem = (id) => {
    Alert.alert(
      "ক্যাটাগরি মুছে ফেলুন",
      "আপনি কি নিশ্চিতভাবে এই ক্যাটাগরি মুছে ফেলতে চান?",
      [
        { text: "বাতিল", style: "cancel" },
        { 
          text: "মুছে ফেলুন", 
          style: "destructive",
          onPress: () => {
            const success = deletePrivateCategory(id);
            if (success) loadData();
            else Alert.alert('ত্রুটি', 'মুছে ফেলতে সমস্যা হয়েছে।');
          } 
        }
      ]
    );
  };

  // EXPENSE ACTIONS
  const handleOpenAddExpense = () => {
    setSelectedExpense(null);
    setExpCategory(categories.length > 0 ? categories[0].name : '');
    setExpAmount('');
    setExpDate(new Date().toISOString().split('T')[0]);
    setExpNote('');
    setExpenseModalVisible(true);
  };

  const handleOpenEditExpense = (exp) => {
    setSelectedExpense(exp);
    setExpCategory(exp.category);
    setExpAmount(String(exp.amount || 0));
    setExpDate(exp.date);
    setExpNote(exp.note || '');
    setExpenseModalVisible(true);
  };

  const handleSaveExpense = () => {
    if (!expCategory) {
      Alert.alert('ত্রুটি', 'ক্যাটাগরি সিলেক্ট করুন। আগে ক্যাটাগরি যোগ করুন।');
      return;
    }
    const amtVal = parseFloat(expAmount) || 0;
    if (amtVal <= 0) {
      Alert.alert('ত্রুটি', 'খরচের পরিমাণ সঠিক হতে হবে।');
      return;
    }

    let success = false;
    if (selectedExpense) {
      success = updatePrivateExpense(selectedExpense.id, expCategory, amtVal, expDate, expNote.trim());
    } else {
      success = addPrivateExpense(expCategory, amtVal, expDate, expNote.trim());
    }

    if (success) {
      const isSalaryCat = expCategory.toLowerCase().trim() === 'বেতন' || expCategory.toLowerCase().trim() === 'salary';
      if (isSalaryCat) {
        const empIdMatch = expNote.match(/\[(emp_\d+)\]/);
        if (empIdMatch) {
          const empId = empIdMatch[1];
          const emp = employees.find(e => e.id === empId);
          if (emp) {
            updatePrivateEmployee(emp.id, emp.name, emp.salary, emp.note, expDate);
          }
        }
      }
      setExpenseModalVisible(false);
      loadData();
    } else {
      Alert.alert('ত্রুটি', 'খরচ সংরক্ষণ করতে সমস্যা হয়েছে।');
    }
  };

  const handleDeleteExpenseItem = (id) => {
    Alert.alert(
      "খরচ মুছে ফেলুন",
      "আপনি কি নিশ্চিতভাবে এই খরচ মুছে ফেলতে চান?",
      [
        { text: "বাতিল", style: "cancel" },
        { 
          text: "মুছে ফেলুন", 
          style: "destructive",
          onPress: () => {
            const success = deletePrivateExpense(id);
            if (success) loadData();
            else Alert.alert('ত্রুটি', 'মুছে ফেলতে সমস্যা হয়েছে।');
          } 
        }
      ]
    );
  };

  // Dashboard Stats Calculations
  const getDashboardStats = () => {
    const now = new Date();
    const thisMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const todayStr = now.toISOString().split('T')[0];

    let previousBalance = 0;
    let currentMonthDeposits = 0;
    let currentMonthWithdrawals = 0;
    let currentMonthSalary = 0;
    let currentMonthPersonal = 0;
    let todayDeposits = 0;
    let todayWithdrawals = 0;

    expenses.forEach(item => {
      const isThisMonth = item.date.startsWith(thisMonthPrefix);
      const isToday = item.date === todayStr;
      const amount = Number(item.amount || 0);
      const catLower = item.category.toLowerCase().trim();

      // Categorize the transaction type
      let type = 'personal';
      if (catLower === 'deposit' || catLower === 'জমা') {
        type = 'deposit';
      } else if (catLower === 'withdrawal' || catLower === 'উত্তোলন') {
        type = 'withdrawal';
      } else if (catLower === 'salary' || catLower === 'বেতন' || catLower.startsWith('salary:') || catLower.startsWith('বেতন:')) {
        type = 'salary';
      }

      if (isThisMonth) {
        if (type === 'deposit') currentMonthDeposits += amount;
        else if (type === 'withdrawal') currentMonthWithdrawals += amount;
        else if (type === 'salary') currentMonthSalary += amount;
        else currentMonthPersonal += amount;
      } else {
        // Transactions before this month
        if (type === 'deposit') previousBalance += amount;
        else previousBalance -= amount; // salary, withdrawal, and personal expenses reduce balance
      }

      if (isToday) {
        if (type === 'deposit') todayDeposits += amount;
        else if (type === 'withdrawal') todayWithdrawals += amount;
      }
    });

    const ownerBalance = previousBalance + currentMonthDeposits - currentMonthSalary - currentMonthPersonal - currentMonthWithdrawals;

    return {
      previousBalance,
      currentMonthDeposits,
      currentMonthWithdrawals,
      currentMonthSalary,
      currentMonthPersonal,
      todayDeposits,
      todayWithdrawals,
      ownerBalance
    };
  };

  const stats = getDashboardStats();

  // Filtered Expenses List for the EXPENSES tab
  const filterDatePrefix = `${selectedYear}-${selectedMonth}`;
  const filteredExpenses = expenses.filter(item => item.date.startsWith(filterDatePrefix));

  // RENDER: WARNING SCREEN
  if (screenState === 'WARN') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.warnContent}>
          <View style={styles.warnIconCircle}>
            <Text style={styles.warnIconEmoji}>⚠️</Text>
          </View>
          <Text style={styles.warnTitle}>ব্যক্তিগত ভল্ট (Private Vault)</Text>
          <Text style={styles.warnMessage}>
            "এই তথ্য শুধুমাত্র মালিকের ব্যক্তিগত ব্যবহারের জন্য।"
          </Text>
          <Text style={styles.warnSubtitle}>
            এখানে কর্মচারীদের বেতন এবং আপনার ব্যক্তিগত খরচ ট্র্যাক করতে পারবেন। এই তথ্যগুলি ড্যাশবোর্ড রিপোর্ট, বিক্রয় বা অন্য কোনো সাধারণ হিসাবের সাথে যুক্ত হবে না।
          </Text>
          <TouchableOpacity style={styles.warnBtn} onPress={() => setScreenState('PIN')}>
            <Text style={styles.warnBtnText}>অ্যাক্সেস করতে PIN দিন 🔐</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.warnCancelBtn} onPress={onBack}>
            <Text style={styles.warnCancelBtnText}>পিছনে যান</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // RENDER: PIN PROTECTION SCREEN
  if (screenState === 'PIN') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.pinContent}>
          <Text style={styles.pinTitle}>মালিকের ভল্ট PIN দিন</Text>
          <Text style={styles.pinLabel}>Owner Verification Required</Text>
          
          <View style={styles.pinDotsRow}>
            {[0, 1, 2, 3].map((idx) => (
              <View 
                key={idx} 
                style={[
                  styles.pinDot, 
                  pinInput.length > idx && styles.pinDotActive
                ]} 
              />
            ))}
          </View>

          {/* Verification auto fires when PIN length is 4 */}
          {pinInput.length === 4 && (
            <TouchableOpacity style={styles.pinVerifyBtn} onPress={handleVerifyPin}>
              <Text style={styles.pinVerifyBtnText}>ভল্ট আনলক করুন 🔓</Text>
            </TouchableOpacity>
          )}

          {/* Circular Button Pin Pad */}
          <View style={styles.pinPad}>
            {[
              ['1', '2', '3'],
              ['4', '5', '6'],
              ['7', '8', '9'],
              ['cancel', '0', 'backspace']
            ].map((row, rIdx) => (
              <View key={rIdx} style={styles.pinRow}>
                {row.map((btn, bIdx) => {
                  if (btn === 'cancel') {
                    return (
                      <TouchableOpacity key={bIdx} style={styles.pinBtnSpecial} onPress={onBack}>
                        <Text style={styles.pinBtnSpecialText}>বাতিল</Text>
                      </TouchableOpacity>
                    );
                  }
                  if (btn === 'backspace') {
                    return (
                      <TouchableOpacity key={bIdx} style={styles.pinBtnSpecial} onPress={handlePinBackspace}>
                        <Text style={styles.pinBtnSpecialText}>⌫</Text>
                      </TouchableOpacity>
                    );
                  }
                  return (
                    <TouchableOpacity 
                      key={bIdx} 
                      style={styles.pinBtnNum} 
                      onPress={() => handlePinKeyPress(btn)}
                    >
                      <Text style={styles.pinBtnNumText}>{btn}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // RENDER: MAIN PRIVATE VAULT
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backArrow}>❮ পিছনে</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>🔐 মালিকের প্রাইভেট ভল্ট</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        {['DASHBOARD', 'EMPLOYEES', 'CATEGORIES', 'EXPENSES'].map((tab) => {
          const tabLabels = {
            'DASHBOARD': 'ড্যাশবোর্ড',
            'EMPLOYEES': 'কর্মচারী',
            'CATEGORIES': 'ক্যাটাগরি',
            'EXPENSES': 'ব্যক্তিগত খরচ'
          };
          const isActive = activeTab === tab;
          return (
            <TouchableOpacity 
              key={tab} 
              style={[styles.tabButton, isActive && styles.tabButtonActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {tabLabels[tab]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {loading ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#FFB703" />
          </View>
        ) : (
          <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
            
            {/* TAB: DASHBOARD */}
            {activeTab === 'DASHBOARD' && (
              <View style={styles.dashboardSection}>
                {/* SECTION 1: OWNER CASH POSITION */}
                <View style={[styles.statsCard, { borderColor: '#34D399', width: '100%', marginBottom: 20 }]}>
                  <View style={styles.cardHeaderRow}>
                    <Text style={styles.statsLabel}>এই মাসে মালিকের হাতে মোট টাকা (Owner Balance)</Text>
                    <Text style={styles.warnIconEmoji}>💰</Text>
                  </View>
                  <Text style={[styles.statsValue, { fontSize: 30, color: '#34D399', marginVertical: 6 }]}>
                    ৳ {stats.ownerBalance.toLocaleString()}
                  </Text>
                  <Text style={{ color: '#888', fontSize: 10, lineHeight: 14 }}>
                    হিসাব: পূর্বের ব্যালেন্স + চলতি মাসের জমা - বেতন - খরচ - উত্তোলন
                  </Text>
                </View>

                {/* SECTION 4: OWNER CASH MOVEMENT */}
                <Text style={[styles.sectionTitle, { marginBottom: 12 }]}>💸 ক্যাশ মুভমেন্ট (Cash Movement)</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                  <View style={[styles.statsCard, { flex: 1, marginRight: 6, marginBottom: 0 }]}>
                    <Text style={[styles.statsLabel, { fontSize: 11, marginBottom: 4 }]}>আজ জমা (Today Deposit)</Text>
                    <Text style={[styles.statsValue, { color: '#34D399', fontSize: 18 }]}>৳ {stats.todayDeposits.toLocaleString()}</Text>
                  </View>
                  <View style={[styles.statsCard, { flex: 1, marginLeft: 6, marginBottom: 0 }]}>
                    <Text style={[styles.statsLabel, { fontSize: 11, marginBottom: 4 }]}>আজ উত্তোলন (Today Withdrawal)</Text>
                    <Text style={[styles.statsValue, { color: '#FB923C', fontSize: 18 }]}>৳ {stats.todayWithdrawals.toLocaleString()}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
                  <View style={[styles.statsCard, { flex: 1, marginRight: 6, marginBottom: 0 }]}>
                    <Text style={[styles.statsLabel, { fontSize: 11, marginBottom: 4 }]}>মাসিক জমা (Monthly Deposit)</Text>
                    <Text style={[styles.statsValue, { color: '#34D399', fontSize: 18 }]}>৳ {stats.currentMonthDeposits.toLocaleString()}</Text>
                  </View>
                  <View style={[styles.statsCard, { flex: 1, marginLeft: 6, marginBottom: 0 }]}>
                    <Text style={[styles.statsLabel, { fontSize: 11, marginBottom: 4 }]}>মাসিক উত্তোলন (Monthly Withdrawal)</Text>
                    <Text style={[styles.statsValue, { color: '#FB923C', fontSize: 18 }]}>৳ {stats.currentMonthWithdrawals.toLocaleString()}</Text>
                  </View>
                </View>

                {/* SECTION 5: MONTHLY SUMMARY */}
                <Text style={[styles.sectionTitle, { marginBottom: 12 }]}>📊 মাসিক সারসংক্ষেপ (Monthly Summary)</Text>
                <View style={[styles.dataCard, { marginBottom: 20 }]}>
                  <View style={styles.cardDetailRow}>
                    <Text style={styles.detailLabel}>পূর্বের ব্যালেন্স (Previous Month Balance):</Text>
                    <Text style={[styles.detailValue, { color: stats.previousBalance >= 0 ? '#34D399' : '#EF4444' }]}>
                      ৳ {stats.previousBalance.toLocaleString()}
                    </Text>
                  </View>
                  <View style={styles.cardDetailRow}>
                    <Text style={styles.detailLabel}>চলতি মাসের জমা (Total Deposits):</Text>
                    <Text style={[styles.detailValue, { color: '#34D399' }]}>+ ৳ {stats.currentMonthDeposits.toLocaleString()}</Text>
                  </View>
                  <View style={styles.cardDetailRow}>
                    <Text style={styles.detailLabel}>পরিশোধিত বেতন (Total Salary Paid):</Text>
                    <Text style={[styles.detailValue, { color: '#EF4444' }]}>- ৳ {stats.currentMonthSalary.toLocaleString()}</Text>
                  </View>
                  <View style={styles.cardDetailRow}>
                    <Text style={styles.detailLabel}>ব্যক্তিগত খরচ (Total Personal Expense):</Text>
                    <Text style={[styles.detailValue, { color: '#EF4444' }]}>- ৳ {stats.currentMonthPersonal.toLocaleString()}</Text>
                  </View>
                  <View style={styles.cardDetailRow}>
                    <Text style={styles.detailLabel}>চলতি উত্তোলন (Total Withdrawals):</Text>
                    <Text style={[styles.detailValue, { color: '#EF4444' }]}>- ৳ {stats.currentMonthWithdrawals.toLocaleString()}</Text>
                  </View>
                  <View style={[styles.historyDivider, { height: 1, backgroundColor: '#161616', marginVertical: 10 }]} />
                  <View style={styles.cardDetailRow}>
                    <Text style={[styles.detailLabel, { fontWeight: 'bold', color: '#FFF' }]}>মালিকের মোট টাকা (Owner Balance):</Text>
                    <Text style={[styles.detailValue, { fontWeight: 'bold', color: '#FFB703', fontSize: 16 }]}>
                      ৳ {stats.ownerBalance.toLocaleString()}
                    </Text>
                  </View>
                </View>

                <Text style={[styles.infoBannerText, { marginTop: 5 }]}>
                  🔒 এই সেকশনের সমস্ত ডাটা মালিকের ডিভাইস সমূহে নিজস্ব Firestore ক্লাউড কানেকশন দ্বারা সিঙ্ক করা হয়। ম্যানেজার ও স্টাফদের মোবাইলে এই ডাটা ডাউনলোড বা অ্যাক্সেস হবে না।
                </Text>
              </View>
            )}

            {/* TAB: EMPLOYEES */}
            {activeTab === 'EMPLOYEES' && (
              <View style={styles.tabContent}>
                <View style={styles.tabSectionHeader}>
                  <Text style={styles.sectionTitle}>👥 কর্মচারী তালিকা ({employees.length})</Text>
                  <TouchableOpacity style={styles.addButton} onPress={handleOpenAddEmployee}>
                    <Text style={styles.addButtonText}>➕ নতুন যোগ</Text>
                  </TouchableOpacity>
                </View>

                {employees.length === 0 ? (
                  <Text style={styles.emptyText}>কোনো কর্মচারী পাওয়া যায়নি।</Text>
                ) : (
                  employees.map(emp => {
                    const stats = getEmployeeSalaryStats(emp.id, emp.salary);
                    return (
                      <View key={emp.id} style={styles.dataCard}>
                        <View style={styles.cardHeaderRow}>
                          <Text style={styles.cardMainTitle}>{emp.name}</Text>
                          <View style={styles.cardBtnRow}>
                            <TouchableOpacity 
                              onPress={() => handlePayEmployeeSalary(emp, stats.remainingSalary)} 
                              style={[styles.actionIconBtn, { backgroundColor: 'rgba(255, 183, 3, 0.15)', paddingHorizontal: 8 }]}
                            >
                              <Text style={[styles.editIcon, { color: '#FFB703', fontWeight: 'bold', fontSize: 10 }]}>বেতন দিন 💵</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => handleOpenEditEmployee(emp)} style={styles.actionIconBtn}>
                              <Text style={styles.editIcon}>✏️</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => handleDeleteEmployeeItem(emp.id)} style={styles.actionIconBtn}>
                              <Text style={styles.deleteIcon}>🗑️</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                        <View style={styles.cardDetailRow}>
                          <Text style={styles.detailLabel}>মাসিক বেতন:</Text>
                          <Text style={styles.detailValue}>৳ {emp.salary.toLocaleString()}</Text>
                        </View>
                        <View style={styles.cardDetailRow}>
                          <Text style={styles.detailLabel}>এই মাসে পরিশোধ:</Text>
                          <Text style={[styles.detailValue, { color: '#34D399', fontWeight: 'bold' }]}>৳ {stats.paidThisMonth.toLocaleString()}</Text>
                        </View>
                        <View style={styles.cardDetailRow}>
                          <Text style={styles.detailLabel}>বাকি বেতন:</Text>
                          <Text style={[styles.detailValue, { color: stats.remainingSalary > 0 ? '#FB923C' : '#888', fontWeight: 'bold' }]}>৳ {stats.remainingSalary.toLocaleString()}</Text>
                        </View>
                        <View style={styles.cardDetailRow}>
                          <Text style={styles.detailLabel}>সর্বশেষ পরিশোধ তারিখ:</Text>
                          <Text style={styles.detailValue}>
                            {emp.last_payment_date ? formatDisplayDate(emp.last_payment_date) : 'N/A'}
                          </Text>
                        </View>
                        {emp.note ? (
                          <Text style={styles.cardNoteText}>নোট: {emp.note}</Text>
                        ) : null}
                      </View>
                    );
                  })
                )}
              </View>
            )}

            {/* TAB: CATEGORIES */}
            {activeTab === 'CATEGORIES' && (
              <View style={styles.tabContent}>
                <View style={styles.tabSectionHeader}>
                  <Text style={styles.sectionTitle}>📂 খরচের ক্যাটাগরি তালিকা ({categories.length})</Text>
                  <TouchableOpacity style={styles.addButton} onPress={handleOpenAddCategory}>
                    <Text style={styles.addButtonText}>➕ নতুন যোগ</Text>
                  </TouchableOpacity>
                </View>

                {categories.length === 0 ? (
                  <Text style={styles.emptyText}>কোনো ক্যাটাগরি পাওয়া যায়নি।</Text>
                ) : (
                  categories.map(cat => (
                    <View key={cat.id} style={styles.dataCardCompact}>
                      <Text style={styles.cardMainTitle}>{cat.name}</Text>
                      <View style={styles.cardBtnRow}>
                        <TouchableOpacity onPress={() => handleOpenEditCategory(cat)} style={styles.actionIconBtn}>
                          <Text style={styles.editIcon}>✏️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleDeleteCategoryItem(cat.id)} style={styles.actionIconBtn}>
                          <Text style={styles.deleteIcon}>🗑️</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}
              </View>
            )}

            {/* TAB: EXPENSES */}
            {activeTab === 'EXPENSES' && (
              <View style={styles.tabContent}>
                <View style={styles.tabSectionHeader}>
                  <Text style={styles.sectionTitle}>💸 খরচের খতিয়ান</Text>
                  <TouchableOpacity style={styles.addButton} onPress={handleOpenAddExpense}>
                    <Text style={styles.addButtonText}>➕ খরচ এন্ট্রি</Text>
                  </TouchableOpacity>
                </View>

                {/* Filters */}
                <View style={styles.expenseFiltersRow}>
                  {/* Month Selection */}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.filterInputLabel}>মাস সিলেক্ট</Text>
                    <ScrollView horizontal={true} showsHorizontalScrollIndicator={false} style={styles.smallMonthScroll}>
                      {['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m) => {
                        const isSelected = selectedMonth === m;
                        const mNames = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুল', 'আগস্ট', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'];
                        return (
                          <TouchableOpacity 
                            key={m} 
                            style={[styles.smallFilterBtn, isSelected && styles.smallFilterBtnActive]}
                            onPress={() => setSelectedMonth(m)}
                          >
                            <Text style={[styles.smallFilterText, isSelected && styles.smallFilterTextActive]}>
                              {mNames[parseInt(m) - 1]}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                  
                  {/* Year Selection */}
                  <View style={{ width: 120 }}>
                    <Text style={styles.filterInputLabel}>বছর সিলেক্ট</Text>
                    <ScrollView horizontal={true} showsHorizontalScrollIndicator={false} style={styles.smallMonthScroll}>
                      {yearsList.map((y) => {
                        const isSelected = selectedYear === y;
                        return (
                          <TouchableOpacity 
                            key={y} 
                            style={[styles.smallFilterBtn, isSelected && styles.smallFilterBtnActive]}
                            onPress={() => setSelectedYear(y)}
                          >
                            <Text style={[styles.smallFilterText, isSelected && styles.smallFilterTextActive]}>
                              {y}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                </View>

                {filteredExpenses.length === 0 ? (
                  <Text style={styles.emptyText}>এই মেয়াদে কোনো খরচের হিসাব পাওয়া যায়নি।</Text>
                ) : (
                  filteredExpenses.map(exp => (
                    <View key={exp.id} style={styles.dataCard}>
                      <View style={styles.cardHeaderRow}>
                        <View>
                          <Text style={styles.cardMainTitle}>{exp.category}</Text>
                          <Text style={styles.cardSubTitleText}>{formatDisplayDate(exp.date)}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <Text style={styles.cardPriceText}>৳ {exp.amount.toLocaleString()}</Text>
                          <View style={styles.cardBtnRow}>
                            <TouchableOpacity onPress={() => handleOpenEditExpense(exp)} style={styles.actionIconBtn}>
                              <Text style={styles.editIcon}>✏️</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => handleDeleteExpenseItem(exp.id)} style={styles.actionIconBtn}>
                              <Text style={styles.deleteIcon}>🗑️</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                      {exp.note ? (
                        <Text style={styles.cardNoteText}>নোট: {exp.note}</Text>
                      ) : null}
                    </View>
                  ))
                )}
              </View>
            )}

          </ScrollView>
        )}
      </KeyboardAvoidingView>

      {/* MODAL: EMPLOYEE */}
      <Modal animationType="slide" transparent={true} visible={employeeModalVisible}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {selectedEmployee ? 'কর্মচারী তথ্য পরিবর্তন' : 'নতুন কর্মচারী যোগ করুন'}
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>কর্মচারীর নাম</Text>
              <TextInput 
                style={styles.modalInput} 
                value={empName} 
                onChangeText={setEmpName}
                placeholder="যেমন: পিয়াস"
                placeholderTextColor="#64748B"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>মাসিক বেতন (৳)</Text>
              <TextInput 
                style={styles.modalInput} 
                keyboardType="numeric"
                value={empSalary} 
                onChangeText={setEmpSalary}
                placeholder="যেমন: 15000"
                placeholderTextColor="#64748B"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>সর্বশেষ বেতন প্রদানের তারিখ (YYYY-MM-DD)</Text>
              <TextInput 
                style={styles.modalInput} 
                value={empPayDate} 
                onChangeText={setEmpPayDate}
                placeholder="2026-06-01"
                placeholderTextColor="#64748B"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>নোট (ঐচ্ছিক)</Text>
              <TextInput 
                style={styles.modalInput} 
                value={empNote} 
                onChangeText={setEmpNote}
                placeholder="যোগাযোগ বা কাজের বিবরণ"
                placeholderTextColor="#64748B"
              />
            </View>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setEmployeeModalVisible(false)}>
                <Text style={styles.modalCancelBtnText}>বাতিল</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveEmployee}>
                <Text style={styles.modalSaveBtnText}>সংরক্ষণ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: CATEGORY */}
      <Modal animationType="fade" transparent={true} visible={categoryModalVisible}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {selectedCategory ? 'ক্যাটাগরি পরিবর্তন' : 'নতুন ক্যাটাগরি যোগ'}
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>ক্যাটাগরি নাম</Text>
              <TextInput 
                style={styles.modalInput} 
                value={catName} 
                onChangeText={setCatName}
                placeholder="যেমন: বাসা ভাড়া"
                placeholderTextColor="#64748B"
                autoFocus={true}
              />
            </View>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setCategoryModalVisible(false)}>
                <Text style={styles.modalCancelBtnText}>বাতিল</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveCategory}>
                <Text style={styles.modalSaveBtnText}>সংরক্ষণ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: EXPENSE ENTRY */}
      <Modal animationType="slide" transparent={true} visible={expenseModalVisible}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {selectedExpense ? 'খরচের বিবরণ পরিবর্তন' : 'নতুন খরচ এন্ট্রি'}
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>ক্যাটাগরি সিলেক্ট করুন</Text>
              <ScrollView horizontal={true} showsHorizontalScrollIndicator={false} style={{ marginVertical: 5 }}>
                {categories.map((cat) => {
                  const isSelected = expCategory === cat.name;
                  return (
                    <TouchableOpacity
                      key={cat.id}
                      style={[styles.smallFilterBtn, isSelected && styles.smallFilterBtnActive]}
                      onPress={() => setExpCategory(cat.name)}
                    >
                      <Text style={[styles.smallFilterText, isSelected && styles.smallFilterTextActive]}>
                        {cat.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              {categories.length === 0 && (
                <Text style={{ color: '#F87171', fontSize: 11 }}>ক্যাটাগরি ট্যাব থেকে ক্যাটাগরি যোগ করুন!</Text>
              )}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>খরচের পরিমাণ (৳)</Text>
              <TextInput 
                style={styles.modalInput} 
                keyboardType="numeric"
                value={expAmount} 
                onChangeText={setExpAmount}
                placeholder="0"
                placeholderTextColor="#64748B"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>তারিখ (YYYY-MM-DD)</Text>
              <TextInput 
                style={styles.modalInput} 
                value={expDate} 
                onChangeText={setExpDate}
                placeholder="2026-06-01"
                placeholderTextColor="#64748B"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>নোট (ঐচ্ছিক)</Text>
              <TextInput 
                style={styles.modalInput} 
                value={expNote} 
                onChangeText={setExpNote}
                placeholder="খরচের বিবরণ বা রসিদ নোট"
                placeholderTextColor="#64748B"
              />
            </View>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setExpenseModalVisible(false)}>
                <Text style={styles.modalCancelBtnText}>বাতিল</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveExpense}>
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
    padding: 15,
  },
  warnContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#000000',
  },
  warnIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 183, 3, 0.1)',
    borderWidth: 2,
    borderColor: '#FFB703',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 25,
  },
  warnIconEmoji: {
    fontSize: 40,
  },
  warnTitle: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  warnMessage: {
    color: '#FFB703',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 15,
    paddingHorizontal: 10,
  },
  warnSubtitle: {
    color: '#888',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 35,
  },
  warnBtn: {
    backgroundColor: '#FFB703',
    borderRadius: 12,
    paddingVertical: 15,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
    marginBottom: 15,
  },
  warnBtnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: 'bold',
  },
  warnCancelBtn: {
    paddingVertical: 12,
    width: '100%',
    alignItems: 'center',
  },
  warnCancelBtnText: {
    color: '#888',
    fontSize: 14,
    fontWeight: 'bold',
  },
  pinContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#000000',
  },
  pinTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFF',
    marginBottom: 8,
  },
  pinLabel: {
    fontSize: 13,
    color: '#888',
    marginBottom: 30,
  },
  pinDotsRow: {
    flexDirection: 'row',
    gap: 15,
    marginBottom: 30,
  },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#333',
    backgroundColor: 'transparent',
  },
  pinDotActive: {
    backgroundColor: '#FFB703',
    borderColor: '#FFB703',
  },
  pinVerifyBtn: {
    backgroundColor: '#FFB703',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 25,
    marginBottom: 20,
  },
  pinVerifyBtnText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 14,
  },
  pinPad: {
    width: width * 0.8,
    gap: 12,
    marginTop: 10,
  },
  pinRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  pinBtnNum: {
    width: 65,
    height: 65,
    borderRadius: 32.5,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pinBtnNumText: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: 'bold',
  },
  pinBtnSpecial: {
    width: 65,
    height: 65,
    borderRadius: 32.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pinBtnSpecialText: {
    color: '#888',
    fontSize: 14,
    fontWeight: 'bold',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#0D0D0D',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderColor: '#161616',
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    marginHorizontal: 4,
    borderRadius: 8,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#333',
  },
  tabButtonActive: {
    backgroundColor: '#FFB703',
    borderColor: '#FFB703',
  },
  tabText: {
    color: '#888',
    fontSize: 10,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#000',
    fontWeight: 'bold',
  },
  dashboardSection: {
    padding: 10,
  },
  sectionTitle: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  statsCard: {
    backgroundColor: 'rgba(16, 37, 24, 0.6)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.3)',
    padding: 16,
    marginBottom: 12,
  },
  statsLabel: {
    color: '#34D399',
    fontSize: 12,
    marginBottom: 6,
    fontWeight: '500',
  },
  statsValue: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  infoBannerText: {
    color: '#888',
    fontSize: 11,
    lineHeight: 18,
    backgroundColor: 'rgba(255, 183, 3, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 183, 3, 0.15)',
    borderRadius: 8,
    padding: 10,
    fontStyle: 'italic',
  },
  tabContent: {
    padding: 10,
  },
  tabSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  addButton: {
    backgroundColor: '#FFB703',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  addButtonText: {
    color: '#000',
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptyText: {
    color: '#555',
    textAlign: 'center',
    marginTop: 40,
    fontSize: 14,
  },
  dataCard: {
    backgroundColor: '#0D0D0D',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1A1A1A',
    padding: 15,
    marginBottom: 12,
  },
  dataCardCompact: {
    backgroundColor: '#0D0D0D',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1A1A1A',
    paddingVertical: 12,
    paddingHorizontal: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardMainTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: 'bold',
  },
  cardSubTitleText: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  cardPriceText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: 'bold',
  },
  cardBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionIconBtn: {
    padding: 4,
    backgroundColor: '#0F172A',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#334155',
  },
  editIcon: {
    fontSize: 12,
  },
  deleteIcon: {
    fontSize: 12,
  },
  cardDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  detailLabel: {
    color: '#94A3B8',
    fontSize: 12,
  },
  detailValue: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '500',
  },
  cardNoteText: {
    color: '#888',
    fontSize: 11,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#161616',
    paddingTop: 8,
    fontStyle: 'italic',
  },
  expenseFiltersRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
    backgroundColor: '#0D0D0D',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#1A1A1A',
  },
  filterInputLabel: {
    color: '#888',
    fontSize: 10,
    marginBottom: 6,
    fontWeight: 'bold',
  },
  smallMonthScroll: {
    maxHeight: 30,
  },
  smallFilterBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#333',
    marginRight: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  smallFilterBtnActive: {
    backgroundColor: '#FFB703',
    borderColor: '#FFB703',
  },
  smallFilterText: {
    color: '#888',
    fontSize: 10,
  },
  smallFilterTextActive: {
    color: '#000',
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#FFB703',
    borderRadius: 20,
    padding: 24,
    width: '85%',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#FFF',
    marginBottom: 20,
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: 15,
    width: '100%',
  },
  inputLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 6,
  },
  modalInput: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 16,
    color: '#FFF',
    width: '100%',
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 20,
  },
  modalCancelBtn: {
    flex: 1,
    height: 46,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
    borderRadius: 10,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#333',
  },
  modalCancelBtnText: {
    color: '#FFF',
    fontSize: 14,
  },
  modalSaveBtn: {
    flex: 1,
    height: 46,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFB703',
    borderRadius: 10,
    marginLeft: 10,
  },
  modalSaveBtnText: {
    color: '#000',
    fontSize: 14,
    fontWeight: 'bold',
  }
});
