import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Alert, TouchableOpacity, Modal, ScrollView, Text, Platform, Dimensions, ActivityIndicator, AppState, BackHandler } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';

const { height } = Dimensions.get('window');
const AUTO_PULL_HANG_MS = 25000;

const runAutoPull = async (name, syncFn, refreshData) => {
  const startedAtMs = Date.now();
  const timestamp = new Date(startedAtMs).toISOString();
  
  // Require dynamically because runAutoPull is defined before imports
  const { recordAutoSyncEvent } = require('./database');

  if (AppState.currentState !== 'active') {
    recordAutoSyncEvent(name, 'skipped', `timestamp=${timestamp} appState=${AppState.currentState}`);
    return false;
  }

  let watchdog = null;
  try {
    console.log(`[Auto Pull Tick] timestamp=${timestamp} timer=${name} result=started appState=${AppState.currentState}`);
    recordAutoSyncEvent(name, 'started', `timestamp=${timestamp} appState=${AppState.currentState}`);
    watchdog = setTimeout(() => {
      recordAutoSyncEvent(name, 'hang', `no-return-after-ms=${AUTO_PULL_HANG_MS}`);
      console.log(`[Auto Pull Tick] timestamp=${new Date().toISOString()} timer=${name} result=hang no-return-after-ms=${AUTO_PULL_HANG_MS}`);
    }, AUTO_PULL_HANG_MS);
    const didChange = await syncFn();
    const durationMs = Date.now() - startedAtMs;
    recordAutoSyncEvent(name, 'success', `durationMs=${durationMs} didChange=${didChange}`);
    console.log(`[Auto Pull Tick] timestamp=${new Date().toISOString()} timer=${name} result=success durationMs=${durationMs} didChange=${didChange}`);
    if (didChange) refreshData();
    return didChange;
  } catch (err) {
    const durationMs = Date.now() - startedAtMs;
    recordAutoSyncEvent(name, 'failure', `durationMs=${durationMs} error=${err.message}`);
    console.log(`[Auto Pull Tick] timestamp=${new Date().toISOString()} timer=${name} result=failure durationMs=${durationMs} error=${err.message}`);
    return false;
  } finally {
    if (watchdog) clearTimeout(watchdog);
  }
};

// Import SQLite and cloud synchronization layer
import {
  initDatabase,
  getMenuItems,
  addMenuItem,
  updateMenuPrice,
  deleteMenuItem,
  getTables,
  updateTableState,
  updateTableName,
  getDeliveries,
  createDelivery,
  updateDeliveryState,
  removeDelivery,
  updateDeliveryDetails,
  getCompletedOrders,
  addCompletedOrder,
  deleteCompletedOrder,
  updateCompletedOrder,
  getDailyExpenses,
  updateDailyExpenses,
  getSubmissionHistory,
  savePastAccount,
  deleteSubmission,
  getBusinessDate,
  isTodaySubmitted,
  submitDailySheet,
  checkAndApplyIjaraRollover,
  processSyncQueue,
  testFirestoreConnection,
  getLastSyncError,
  isSyncServiceRunning,
  isDbInitialized,
  isDatabaseEmpty,
  restoreDatabaseFromCloud,
  syncRecordImmediately,
  syncDeletionsOnly,
  syncMenuOnly,
  syncTablesOnly,
  getPendingSyncCount,
  getSyncQueueItems,
  syncHighFrequencyCollections,
  syncLowFrequencyCollections,
  startSyncService,
  registerSyncTimer,
  markSyncTimerInactive,
  recordAutoSyncEvent,
  getSyncRuntimeDiagnostics
} from './database';

// Import all 9 high-fidelity screens
import LoginScreen from './screens/LoginScreen';
import OwnerDashboard from './screens/OwnerDashboard';
import ManagerDashboard from './screens/ManagerDashboard';
import AdminDB from './screens/AdminDB';
import TableDetailScreen from './screens/TableDetailScreen';
import PaymentSuccess from './screens/PaymentSuccess';
import DailySubmitScreen from './screens/DailySubmitScreen';
import AddItemScreen from './screens/AddItemScreen';
import PaymentCheckoutScreen from './screens/PaymentCheckoutScreen';
import ExpensesScreen from './screens/ExpensesScreen';
import SupplierDueScreen from './screens/SupplierDueScreen';
import DailyItemSalesReport from './screens/DailyItemSalesReport';
import SyncDiagnosticsScreen from './screens/SyncDiagnosticsScreen';
import DeleteHistoryScreen from './screens/DeleteHistoryScreen';


// Default Restaurant Menu (56 items)
const defaultMenu = [
  // বার্গার (6)
  { name: 'স্পেশাল বার্গার', price: 90, category: 'বার্গার' },
  { name: 'স্পেশাল নাগা বার্গার', price: 100, category: 'বার্গার' },
  { name: 'সাব বার্গার', price: 100, category: 'বার্গার' },
  { name: 'বার্বিকিউ বার্গার', price: 150, category: 'বার্গার' },
  { name: 'স্পাইসি চিজ বার্গার', price: 160, category: 'বার্গার' },
  { name: 'রংধনু বার্গার', price: 170, category: 'বার্গার' },
  
  // ফ্রাই (6)
  { name: 'চাইনিজ চিকেন ফ্রাই', price: 60, category: 'ফ্রাই' },
  { name: 'থাই চিকেন ফ্রাই', price: 100, category: 'ফ্রাই' },
  { name: 'ক্রিসপি চিকেন ফ্রাই', price: 120, category: 'ফ্রাই' },
  { name: 'চিকেন হানি উইংস', price: 100, category: 'ফ্রাই' },
  { name: 'চিকেন নাগা উইংস', price: 100, category: 'ফ্রাই' },
  { name: 'ফ্রেঞ্চ ফ্রাই', price: 80, category: 'ফ্রাই' },
  
  // নুডুলস (4)
  { name: 'ম্যাগি মাসালা নুডুলস', price: 100, category: 'নুডুলস' },
  { name: 'চিকেন ম্যাগি নুডুলস', price: 120, category: 'নুডুলস' },
  { name: 'চিকেন চাউমিন', price: 150, category: 'নুডুলস' },
  { name: 'চিকেন পাস্তা', price: 150, category: 'নুডুলস' },
  
  // চিকেন (3)
  { name: 'কেসুনাটি সালাদ', price: 170, category: 'চিকেন' },
  { name: 'চিকেন রেড কারি', price: 150, category: 'চিকেন' },
  { name: 'চিকেন পপকর্ন', price: 140, category: 'চিকেন' },
  
  // রাইস (10)
  { name: 'মোরগ পোলাও+ডিম', price: 170, category: 'রাইস' },
  { name: 'চিকেন বিরিয়ানি+ডিম', price: 160, category: 'রাইস' },
  { name: 'খাসির কাচ্চি', price: 260, category: 'রাইস' },
  { name: 'চিকেন কাচ্চি', price: 200, category: 'রাইস' },
  { name: 'মিট বক্স', price: 160, category: 'রাইস' },
  { name: 'স্পেশাল মিটবক্স', price: 220, category: 'রাইস' },
  { name: 'রাইস বুল', price: 160, category: 'রাইস' },
  { name: 'চিকেন কারি রাইস', price: 160, category: 'রাইস' },
  { name: 'ফ্রাইড রাইস', price: 160, category: 'রাইস' },
  { name: 'রংধনু স্পেশাল', price: 220, category: 'রাইস' },
  
  // স্ন্যাকস (5)
  { name: 'চিকেন শর্মা', price: 150, category: 'স্ন্যাকস' },
  { name: 'চিকেন স্যান্ডউইচ', price: 130, category: 'স্ন্যাকস' },
  { name: 'চিকেন ফিংগার', price: 170, category: 'স্ন্যাকস' },
  { name: 'চকলেট ওয়াফেল', price: 170, category: 'স্ন্যাকস' },
  { name: 'আইসক্রিম ওয়াফেল', price: 220, category: 'স্ন্যাকস' },
  
  // পিজ্জা (2)
  { name: 'পিৎজা', price: 400, category: 'পিজ্জা' },
  { name: 'স্পেশাল পিৎজা', price: 500, category: 'পিজ্জা' }
];

// REUSABLE NOTIFICATION TOAST COMPONENT
const NotificationToast = ({ visible, message, type }) => {
  if (!visible) return null;
  return (
    <View style={styles.toastContainer}>
      <View style={[styles.toastContent, type === 'offline' ? styles.toastOffline : (type === 'sync' ? styles.toastSync : styles.toastOnline)]}>
        <Text style={styles.toastText}>{message}</Text>
      </View>
    </View>
  );
};

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Toast State
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState('online'); // 'online', 'offline', 'sync'

  const showToast = (msg, type = 'online') => {
    setToastMessage(msg);
    setToastType(type);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 1500);
  };

  const [queueItems, setQueueItems] = useState([]);
  const [queueStats, setQueueStats] = useState({
    beforeCount: 0,
    afterCount: 0,
    successfulWrites: 0,
    failedWrites: 0,
    hasRun: false
  });
  const [processingQueue, setProcessingQueue] = useState(false);
  const [queueLogs, setQueueLogs] = useState([]);
  const [testingConnection, setTestingConnection] = useState(false);
  const [diagInfo, setDiagInfo] = useState({
    firebaseConnected: false,
    firestoreWritable: false,
    lastError: 'None',
    envLoaded: false,
    pendingCount: 0,
    daemonStatus: 'Stopped',
    dbInitialized: 'Error',
    queueProcessorStatus: 'Idle',
    firestoreSyncStatus: 'Block Write'
  });
  const [userRole, setUserRole] = useState(''); // 'owner', 'manager' or 'admin'
  const [userDisplayName, setUserDisplayName] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  const [isOnlineOnlyMode, setIsOnlineOnlyMode] = useState(true);
  
  // Visual Sync Timer Countdowns (Shared for all roles)
  const [delCountdown, setDelCountdown] = useState(90);
  const [tabCountdown, setTabCountdown] = useState(15);
  const [fullCountdown, setFullCountdown] = useState(30);

  useEffect(() => {
    const t = setInterval(() => {
      setDelCountdown(prev => (prev <= 1 ? 90 : prev - 1));
      setTabCountdown(prev => (prev <= 1 ? 15 : prev - 1));
      setFullCountdown(prev => (prev <= 1 ? 30 : prev - 1));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Navigation State
  const [currentScreen, setCurrentScreen] = useState('DASHBOARD'); // 'DASHBOARD', 'TABLE_DETAIL', 'PAYMENT_SUCCESS', 'DAILY_SUBMIT', 'ADD_ITEM', 'PAYMENT_CHECKOUT'
  const [selectedTableId, setSelectedTableId] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState(0); // Total due amount
  const [deliveryCharge, setDeliveryCharge] = useState(0); // Optional delivery charge
  const [changeMoneyGiven, setChangeMoneyGiven] = useState(0); // Change money given to rider
  const [paidAmount, setPaidAmount] = useState(0);       // User entered paid amount
  const [paymentMethod, setPaymentMethod] = useState('ক্যাশ');

  // Global Dynamic Menu State
  const [menuItems, setMenuItems] = useState([]);

  // Track if daily sheet is submitted
  const [isDailySubmitted, setIsDailySubmitted] = useState(false);

  // Submission History for the month
  const [submissionHistory, setSubmissionHistory] = useState([]);

  // History of all completed (paid) orders
  const [completedOrders, setCompletedOrders] = useState([]);

  // Global Daily Expenses State (Owner & Manager can edit/view)
  const [dailyExpenses, setDailyExpenses] = useState({
    duduMiah: 0,
    akashChicken: 0,
    burgerBun: 0,
    bazar: 0,
    bazarNote: '',
    others: 0,
    othersNote: '',
    ijara: 0
  });

  // State for Tables (7 tables)
  const [tables, setTables] = useState([]);

  // Delivery state (can have multiple active deliveries)
  const [deliveries, setDeliveries] = useState([]);

  // Push/Pull Manual Sync limits state
  const [remainingPushes, setRemainingPushes] = useState(2);
  const [remainingPulls, setRemainingPulls] = useState(2);

  // Database initialization and state loading on mount
  useEffect(() => {
    recordAutoSyncEvent('app-startup', 'started', `appState=${AppState.currentState}`);
    const previousHandler = global.ErrorUtils?.getGlobalHandler?.();
    global.ErrorUtils?.setGlobalHandler?.((error, isFatal) => {
      recordAutoSyncEvent('global-js-error', 'uncaught', `fatal=${!!isFatal} message=${error?.message || String(error)}`);
      if (previousHandler) previousHandler(error, isFatal);
    });

    const checkAndInitialize = async () => {
      try {
        console.log(`[App] Startup Initializing... Platform: ${Platform.OS}, Build: ${__DEV__ ? 'Development/ExpoGo' : 'Production/APK'}`);
        console.log(`[App] Firebase Config Check - ID: ${process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ? 'OK' : 'MISSING'}, Key: ${process.env.EXPO_PUBLIC_FIREBASE_API_KEY ? 'OK' : 'MISSING'}`);

        // 1. Just create schemas (no seeding yet)
        initDatabase(true);

        // Fetch current online status and mode preference
        try {
          const netState = await NetInfo.fetch();
          setIsOnline(netState.isConnected && netState.isInternetReachable !== false);
          
          const { getAppConfig } = require('./database');
          const savedMode = getAppConfig('sync_mode');
          setIsOnlineOnlyMode(savedMode !== 'hybrid');
        } catch (netErr) {
          console.error("[App] Failed to fetch network state or mode on startup:", netErr);
        }

        // --- DB MAINTENANCE ---
        const { clearDeadQueueItems } = require('./database');
        clearDeadQueueItems();

        // 2. Check if the database is actually empty (fresh install)
        const isEmpty = isDatabaseEmpty();
        if (isEmpty) {
          console.log("[App] Database is empty. Initiating cloud restoration...");
          setIsRestoring(true);
          
          // Download all collections from Firestore and insert into SQLite
          await restoreDatabaseFromCloud();
          
          // Now that data is restored, run full init (refresh and seed if still missing)
          initDatabase(false);
          refreshData();
          setIsRestoring(false);
        } else {
          // Regular launch: existing data found
          initDatabase(false);
          refreshData();
        }

        // Start background sync service daemon automatically
        startSyncService();

        // Check if there are any pending midnight rollovers to apply
        const didRollover = checkAndApplyIjaraRollover();
        if (didRollover) refreshData();

        // Set interval to check for midnight rollovers every minute
        setInterval(() => {
          const rollover = checkAndApplyIjaraRollover();
          if (rollover) refreshData();
        }, 60000);

        // Pull low frequency collections (excluding menu) in the background asynchronously on startup
        syncLowFrequencyCollections().then((didChange) => {
          if (didChange) refreshData();
        }).catch(e => console.log("[Startup Sync] Offline, skipped low frequency pull:", e.message));
      } catch (err) {
        console.error("[App] Critical Initialization error:", err);
        setIsRestoring(false);
      }
    };

    checkAndInitialize();
  }, []);

  // Runtime event-loop lag monitor. Large lag means synchronous work may be blocking timer ticks.
  useEffect(() => {
    let expectedAt = Date.now() + 5000;
    registerSyncTimer('event-loop-lag-monitor', 5000, 'setInterval drift check');
    const lagTimer = setInterval(() => {
      const now = Date.now();
      const lagMs = now - expectedAt;
      if (lagMs > 2000) {
        recordAutoSyncEvent('event-loop-lag-monitor', 'event-loop-lag', `lagMs=${lagMs}`);
        console.log(`[Sync Runtime] event-loop-lag-monitor lagMs=${lagMs} at ${new Date(now).toISOString()}`);
      }
      expectedAt = now + 5000;
    }, 5000);

    return () => {
      clearInterval(lagTimer);
      markSyncTimerInactive('event-loop-lag-monitor');
    };
  }, []);

  // --- REALTIME SYNC ENGINE ---
  // Periodically check for remote changes (Simulating Firestore Listeners via REST)
  useEffect(() => {
    if (!isLoggedIn) return;

    registerSyncTimer('auto-high-frequency-pull', 30000, 'syncHighFrequencyCollections');
    const realtimePoll = setInterval(async () => {
       await runAutoPull('auto-high-frequency-pull', syncHighFrequencyCollections, refreshData);
    }, 30000); // Check every 30 seconds

    return () => {
      clearInterval(realtimePoll);
      markSyncTimerInactive('auto-high-frequency-pull');
    };
  }, [isLoggedIn]);

  // --- HYBRID SYNC: FAST DELETIONS CHANNEL (90s) ---
  useEffect(() => {
    if (!isLoggedIn) return;

    registerSyncTimer('auto-deletions-pull', 90000, 'syncDeletionsOnly');
    const deletionsChannel = setInterval(async () => {
       await runAutoPull('auto-deletions-pull', syncDeletionsOnly, refreshData);
    }, 90000); // Check every 90 seconds

    return () => {
      clearInterval(deletionsChannel);
      markSyncTimerInactive('auto-deletions-pull');
    };
  }, [isLoggedIn]);

  // --- HYBRID SYNC: FAST TABLES CHANNEL (15s) ---
  useEffect(() => {
    if (!isLoggedIn) return;

    registerSyncTimer('auto-tables-pull', 15000, 'syncTablesOnly');
    const tablesChannel = setInterval(async () => {
       await runAutoPull('auto-tables-pull', syncTablesOnly, refreshData);
    }, 15000); // Check every 15 seconds

    return () => {
      clearInterval(tablesChannel);
      markSyncTimerInactive('auto-tables-pull');
    };
  }, [isLoggedIn]);

  // --- LOW FREQUENCY AUTO PULL ---
  // Keeps owner/admin data such as expenses and eja_history alive without requiring Manual Pull.
  useEffect(() => {
    if (!isLoggedIn) return;

    registerSyncTimer('auto-low-frequency-pull', 180000, 'syncLowFrequencyCollections');
    const lowFrequencyPoll = setInterval(async () => {
      await runAutoPull('auto-low-frequency-pull', syncLowFrequencyCollections, refreshData);
    }, 180000); // Check every 3 minutes (180s)

    return () => {
      clearInterval(lowFrequencyPoll);
      markSyncTimerInactive('auto-low-frequency-pull');
    };
  }, [isLoggedIn]);

  // --- FOREGROUND RECOVERY ---
  // React Native may suspend JS timers in background; run one pull immediately when app returns active.
  useEffect(() => {
    if (!isLoggedIn) return;

    registerSyncTimer('foreground-recovery-pull', 0, 'syncHighFrequencyCollections + syncLowFrequencyCollections + syncTablesOnly');
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', async (nextState) => {
      console.log(`[AppState Sync] STATE CHANGED: ${previousState} -> ${nextState} at ${new Date().toISOString()}`);
      recordAutoSyncEvent('app-state', 'appstate', nextState);
      if (previousState !== 'active' && nextState === 'active') {
        console.log("[AppState Sync] Device woke up in Foreground! Triggering immediate recovery pull...");
        const { incrementForegroundRecoveryCount } = require('./database');
        incrementForegroundRecoveryCount();
        await runAutoPull('foreground-tables-pull', syncTablesOnly, refreshData);
        await runAutoPull('foreground-high-frequency-pull', syncHighFrequencyCollections, refreshData);
        await runAutoPull('foreground-low-frequency-pull', syncLowFrequencyCollections, refreshData);
      }
      previousState = nextState;
    });

    return () => {
      subscription.remove();
      markSyncTimerInactive('foreground-recovery-pull');
    };
  }, [isLoggedIn]);

  // --- NETWORK RECOVERY SYNC ---
  // Instantly process queue and pull delta sync when internet returns
  useEffect(() => {
    if (!isLoggedIn) return;

    let wasOffline = !isOnline;
    
    const unsubscribe = NetInfo.addEventListener(async state => {
      // isInternetReachable can be null initially, we treat explicitly false as offline
      const isOnlineState = state.isConnected && state.isInternetReachable !== false;
      setIsOnline(isOnlineState);
      
      const { setSystemOnline } = require('./database');
      setSystemOnline(isOnlineState);

      if (!isOnlineState) {
        wasOffline = true;
        return;
      }

      if (wasOffline && isOnline) {
        wasOffline = false; // Reset to prevent duplicate recovery loops
        console.log("[Network Recovery] Internet RECONNECTED. Starting instant recovery cycle...");
        const { incrementNetInfoRecoveryCount } = require('./database');
        incrementNetInfoRecoveryCount();
        
        try {
          // 1. Process Upload Queue First (Clear local changes to Firestore)
          console.log("[Network Recovery] 1/4: Processing pending upload queue...");
          const uploadResult = await processSyncQueue();
          console.log(`[Network Recovery] Upload finished. Writes: ${uploadResult.successfulWrites}, Failed: ${uploadResult.failedWrites}`);

          // 2. High Frequency Pull (Orders, Order Items, Payments, Deliveries)
          console.log("[Network Recovery] 2/4: Running High Frequency pull sync...");
          await syncHighFrequencyCollections();

          // 3. Low Frequency Pull (Expenses, Ijara, Users, Summaries)
          console.log("[Network Recovery] 3/4: Running Low Frequency pull sync...");
          await syncLowFrequencyCollections();

          // 4. Tables & Deletions
          console.log("[Network Recovery] 4/4: Running Tables and Deletions sync...");
          await syncTablesOnly();
          await syncDeletionsOnly();

          console.log("[Network Recovery] Instant recovery cycle COMPLETED successfully.");
          
          // 5. Final UI Refresh to reflect all changes
          refreshData();
        } catch (err) {
          console.error("[Network Recovery] Critical error during instant recovery:", err.message);
        }
      }
    });

    return () => unsubscribe();
  }, [isLoggedIn]);

  // Pull low-frequency collections when the menu management screens are opened
  useEffect(() => {
    if (!isLoggedIn) return;

    if (currentScreen === 'EDIT_MENU' || currentScreen === 'ADD_ITEM') {
       console.log("[Screen Sync] Menu screen opened. Syncing low frequency collections...");
       syncLowFrequencyCollections().then((didChange) => {
         if (didChange) refreshData();
       }).catch(e => console.log("[Screen Sync] Offline, skipped low frequency pull:", e.message));
    }
  }, [currentScreen, isLoggedIn]);

  // Handle Toast for Background Sync Success
  useEffect(() => {
    if (!isLoggedIn) return;
    
    let lastUnsyncedCount = 0;
    const syncToastCheck = setInterval(() => {
      try {
        const count = getPendingSyncCount();
        
        if (lastUnsyncedCount > 0 && count === 0) {
           showToast(`☁️ ${lastUnsyncedCount} টি ডাটা সিঙ্ক হয়েছে`, 'sync');
        }
        lastUnsyncedCount = count;
      } catch (e) {}
    }, 3000);

    return () => clearInterval(syncToastCheck);
  }, [isLoggedIn]);

  const loadQueueData = () => {
    try {
      const items = getSyncQueueItems(50);
      setQueueItems(items);
    } catch (e) {
      console.error("Failed to load sync queue items:", e);
    }
  };

  const handleProcessQueueNow = async () => {
    setProcessingQueue(true);
    setQueueLogs(["🔄 Initiating manual sync processing..."]);
    try {
      const result = await processSyncQueue();
      setQueueStats({
        beforeCount: result.beforeCount || 0,
        afterCount: result.afterCount || 0,
        successfulWrites: result.successfulWrites || 0,
        failedWrites: result.failedWrites || 0,
        hasRun: true
      });
      
      const newLogs = [
        `📊 Sync process finished.`,
        `🔹 Queue size before: ${result.beforeCount || 0}`,
        `🔹 Queue size after: ${result.afterCount || 0}`,
        `✅ Successful writes: ${result.successfulWrites || 0}`,
        `❌ Failed writes: ${result.failedWrites || 0}`
      ];
      if (result.error) {
        newLogs.push(`🚨 Error: ${result.error}`);
      }
      setQueueLogs(prev => [...prev, ...newLogs]);

      loadQueueData();
      refreshData();
    } catch (err) {
      setQueueLogs(prev => [...prev, `🚨 Execution error: ${err.message}`]);
    } finally {
      setProcessingQueue(false);
    }
  };

  const handleForceSync = async () => {
    try {
      await processSyncQueue();
      loadQueueData();
      refreshData();
      Alert.alert("সফল", "সিঙ্ক প্রক্রিয়া সম্পন্ন হয়েছে!");
    } catch (err) {
      console.error(err);
    }
  };

  const refreshData = () => {
    try {
      // 1. Menu Items (if empty, setMenuItems([]) so "No Menu Data Found" shows up)
      const items = getMenuItems();
      setMenuItems(items);

      // 2. Tables State
      const tbls = getTables();
      if (tbls && tbls.length > 0) {
        setTables(tbls);
      }

      // 3. Deliveries
      const dels = getDeliveries();
      setDeliveries(dels);

      // 4. Completed Orders
      const doneOrders = getCompletedOrders();
      setCompletedOrders(doneOrders);

      // 5. Daily Expenses
      const expenses = getDailyExpenses();
      setDailyExpenses(expenses);

      // 6. Submission History
      const history = getSubmissionHistory();
      setSubmissionHistory(history);

      // 7. Today Submission Lock
      const submitted = isTodaySubmitted();
      setIsDailySubmitted(submitted);

      // 8. Manual Push/Pull remaining counts
      const { getRemainingPushes, getRemainingPulls } = require('./database');
      setRemainingPushes(getRemainingPushes(userRole));
      setRemainingPulls(getRemainingPulls(userRole));
    } catch (err) {
      console.error("[App] Failed to refresh local state from SQLite:", err);
    }
  };

  const handleLoginSuccess = async (role, displayName, mode = 'online_only') => {
    setUserRole(role);
    setUserDisplayName(displayName);
    setIsOnlineOnlyMode(mode === 'online_only');
    setIsLoggedIn(true);
    setCurrentScreen('DASHBOARD');

    // --- STARTUP DELTA SYNC ---
    // Automatically fetch changes since last_sync_time for all collections immediately after login
    try {
      console.log("[Startup Sync] PIN Login successful. Initiating delta sync...");
      
      // 1. Initial local refresh to show what we have
      refreshData();

      // 2. High Frequency (Orders, Payments, Deliveries)
      await syncHighFrequencyCollections();
      
      // 3. Tables State
      await syncTablesOnly();
      
      // 4. Low Frequency (Expenses, Ijara, Users, Daily Submit)
      await syncLowFrequencyCollections();

      // 5. Deletions
      await syncDeletionsOnly();

      // 6. Final refresh to update UI with newly downloaded data
      refreshData();
      console.log("[Startup Sync] Initial delta sync completed successfully.");
    } catch (err) {
      console.log("[Startup Sync] Delta sync failed (possibly offline):", err.message);
    }
  };

  const handleLogout = () => {
    try {
      const { setAppConfig } = require('./database');
      setAppConfig('remembered_username', '');
      setAppConfig('login_session_user', '');
    } catch (e) {
      console.error("[App] Failed to clear config on logout:", e);
    }
    setIsLoggedIn(false);
    setUserRole('');
    setUserDisplayName('');
    setCurrentScreen('DASHBOARD');
  };

  // Navigates to a table detail billing screen
  const handleTableSelect = (tableId) => {
    setSelectedTableId(tableId);
    setCurrentScreen('TABLE_DETAIL');
  };

  // Dynamically updates a table's or delivery's list items
  const handleUpdateTableItems = async (tableId, updatedItems) => {
    const isDoneOrder = completedOrders.some(o => o.id === tableId);
    if (isDoneOrder && userRole === 'admin') {
      const newTotal = updatedItems.reduce((sum, i) => sum + (i.price * i.qty), 0);
      updateCompletedOrder(tableId, updatedItems, newTotal);
      refreshData();
      
      const success = await syncRecordImmediately('orders', tableId);
      showToast(success ? "✅ ডাটা সেভ হয়েছে" : "📱 অফলাইনে সেভ হয়েছে", success ? 'online' : 'offline');
      return;
    }

    if (tableId.toString().startsWith('D-')) {
      const activeDelivery = deliveries.find(d => d.id === tableId);
      if (activeDelivery) {
        if (updatedItems.length === 0) {
          removeDelivery(tableId);
        } else {
          const status = 'BUSY';
          let newStartTime = activeDelivery.startTime;
          
          // If it was FREE (no items) and now getting items, set the start time
          if (!activeDelivery.items || activeDelivery.items.length === 0) {
             newStartTime = new Date().toISOString();
          }
          updateDeliveryState(tableId, updatedItems, status, newStartTime);
        }
      }
    } else {
      const activeTable = tables.find(t => t.id === tableId);
      if (activeTable) {
        const isTransitionToBusy = activeTable.status === 'FREE' && updatedItems.length > 0;
        let newStartTime = activeTable.startTime;
        if (isTransitionToBusy) {
          newStartTime = new Date().toISOString();
        }
        const status = updatedItems.length > 0 ? 'BUSY' : 'FREE';
        updateTableState(tableId, updatedItems, status, updatedItems.length > 0 ? newStartTime : '');
      }
    }
    refreshData();
    
    // Immediate Sync
    const tableIdClean = tableId.toString().startsWith('D-') ? tableId : (tableId.toString().startsWith('table_') ? tableId : `table_${tableId}`);
    const collection = tableId.toString().startsWith('D-') ? 'deliveries' : 'restaurant_tables';
    const success = await syncRecordImmediately(collection, tableIdClean);
    showToast(success ? "✅ ডাটা সেভ হয়েছে" : "📱 অফলাইনে সেভ হয়েছে", success ? 'online' : 'offline');
  };

  // Creates a new delivery order with a unique ID in SQLite
  const handleCreateDelivery = async () => {
    const uniqueId = `D-${Date.now()}`;
    const newName = `🛵 Delivery`;

    createDelivery(uniqueId, newName, 'FREE', '');
    refreshData();
    
    await syncRecordImmediately('deliveries', uniqueId);

    setSelectedTableId(uniqueId);
    setCurrentScreen('TABLE_DETAIL');
  };

  // Saves a manual past entry to SQLite history
  const handleSavePastAccount = async (record) => {
    savePastAccount(record);
    refreshData();

    const success = await syncRecordImmediately('daily_submit', record.date);
    showToast(success ? "✅ ডাটা সেভ হয়েছে" : "📱 অফলাইনে সেভ হয়েছে", success ? 'online' : 'offline');
  };

  // Deletes a manual past entry or submission from SQLite and Cloud
  const handleDeletePastAccount = async (dateStr) => {
    deleteSubmission(dateStr);
    refreshData();

    const success = await syncRecordImmediately('deletions', `daily_submit_${dateStr}`);
    showToast(success ? "🗑️ ডাটা ডিলিট হয়েছে" : "📱 অফলাইনে ডিলিট হয়েছে", success ? 'online' : 'offline');
  };
  // Owner Price editing trigger
  const handleUpdateMenuPrice = async (itemName, newPrice, category = null) => {
    updateMenuPrice(itemName, newPrice, category);
    refreshData();
    
    // Find item ID
    const item = menuItems.find(mi => mi.name === itemName && (!category || mi.category === category));
    if (item) {
       const success = await syncRecordImmediately('menu_items', item.id);
       showToast(success ? "✅ ডাটা সেভ হয়েছে" : "📱 অফলাইনে সেভ হয়েছে", success ? 'online' : 'offline');
       // Refresh menu from Firestore for other devices
       syncMenuOnly();
    }
  };

  // Adds a new item to the menu in SQLite
  const handleAddMenuItem = async (newItem) => {
    await addMenuItem(newItem);
    refreshData();
    const items = getMenuItems();
    const added = items.find(i => i.name === newItem.name && (!newItem.category || i.category === newItem.category));
    if (added) {
       const success = await syncRecordImmediately('menu_items', added.id);
       showToast(success ? "✅ ডাটা সেভ হয়েছে" : "📱 অফলাইনে সেভ হয়েছে", success ? 'online' : 'offline');
       // Refresh menu from Firestore for other devices
       syncMenuOnly();
    }
  };

  // Deletes an item from the menu in SQLite
  const handleDeleteMenuItem = (itemName, category = null) => {
    const itemToDelete = menuItems.find(mi => mi.name === itemName && (!category || mi.category === category));
    Alert.alert(
      "আইটেম ডিলিট",
      `আপনি কি নিশ্চিতভাবে "${itemName}" মেনু থেকে মুছে ফেলতে চান?`,
      [
        { text: "না", style: "cancel" },
        { 
          text: "হ্যাঁ", 
          onPress: async () => {
            deleteMenuItem(itemName, category);
            refreshData();
            if (itemToDelete) {
               await syncRecordImmediately('menu_items', itemToDelete.id);
               showToast("✅ ডাটা সেভ হয়েছে", 'online');
               // Refresh menu from Firestore for other devices
               syncMenuOnly();
            }
          } 
        }
      ]
    );
  };

  const handleUpdateDeliveryDetails = async (id, delCharge, changeMoney) => {
    updateDeliveryDetails(id, delCharge, changeMoney);
    refreshData();
    // Immediate Sync
    await syncRecordImmediately('deliveries', id);
  };

  // Triggers navigation to the Checkout Page (Screen 8)
  const handleNavigateToCheckout = (amount, delCharge = 0, changeMoney = 0) => {
    setPaymentAmount(amount);
    setDeliveryCharge(delCharge);
    setChangeMoneyGiven(changeMoney);
    setCurrentScreen('PAYMENT_CHECKOUT');
  };

  // Triggered inside Screen 8 when clicking "পেমেন্ট সম্পন্ন করুন"
  const handleCompletePayment = async (paid, method, breakdown = {}) => {
    const activeTable = tables.find(t => t.id === selectedTableId) || deliveries.find(d => d.id === selectedTableId);
    if (activeTable) {
      const baseStartTime = activeTable.startTime || new Date().toISOString();
      const cleanStartTime = baseStartTime.replace(/[:.]/g, '-');
      const orderId = `${selectedTableId}_${cleanStartTime}`;
      const orderRecord = {
        id: orderId,
        tableId: activeTable.name || activeTable.id,
        items: activeTable.items.map(i => `${i.name} x${i.qty} @${i.price}`).join(', '),
        totalAmount: paymentAmount,

        deliveryCharge: deliveryCharge,
        changeMoneyGiven: changeMoneyGiven,
        // Split payment breakdown (Due removed)
        cashAmount: breakdown.cash || 0,
        bkashAmount: breakdown.bkash || 0,
        nagadAmount: breakdown.nagad || 0,
        rocketAmount: breakdown.rocket || 0,
        paidAmount: paid,
        method: method,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'Done'
      };

      addCompletedOrder(orderRecord);

      setPaidAmount(paid);
      setPaymentMethod(method);
      setCurrentScreen('PAYMENT_SUCCESS');
      
      const success = await syncRecordImmediately('orders', orderRecord.id);
      showToast(success ? "✅ ডাটা সেভ হয়েছে" : "📱 অফলাইনে সেভ হয়েছে", success ? 'online' : 'offline');
    }
  };

  // Resets a table's state from BUSY to FREE and clears its bill on return home
  const handleReturnHome = async () => {
    const tid = selectedTableId;
    if (tid) {
      if (tid.toString().startsWith('D-')) {
        const activeDelivery = deliveries.find(d => d.id === tid);
        if (activeDelivery) {
          updateDeliveryState(tid, activeDelivery.items, 'COMPLETED', activeDelivery.startTime);
        }
      } else {
        updateTableState(tid, [], 'FREE', '');
      }
    }
    refreshData();
    setSelectedTableId(null);
    setPaymentAmount(0);
    setDeliveryCharge(0);
    setChangeMoneyGiven(0);
    setPaidAmount(0);
    setCurrentScreen('DASHBOARD');
    
    if (tid) {
       const collection = tid.toString().startsWith('D-') ? 'deliveries' : 'restaurant_tables';
       const cleanId = tid.toString().startsWith('D-') ? tid : (tid.toString().startsWith('table_') ? tid : `table_${tid}`);
       await syncRecordImmediately(collection, cleanId);
    }
  };

  // Long press rename table option in SQLite
  const handleUpdateTableName = async (tableId, newName) => {
    updateTableName(tableId, newName);
    refreshData();
    const cleanId = tableId.toString().startsWith('table_') ? tableId : `table_${tableId}`;
    const success = await syncRecordImmediately('restaurant_tables', cleanId);
    showToast(success ? "✅ ডাটা সেভ হয়েছে" : "📱 অফলাইনে সেভ হয়েছে", success ? 'online' : 'offline');
  };



  // Deletes an active order (clears table or removes delivery)
  const handleDeleteActiveOrder = (id) => {
    const tableId = id.replace('active-', '');
    Alert.alert(
      "অर्डर ডিলিট",
      "আপনি কি নিশ্চিতভাবে এই সক্রিয় অর্ডারটি মুছে ফেলতে চান?",
      [
        { text: "না", style: "cancel" },
        { 
          text: "হ্যাঁ", 
          onPress: async () => {
            if (tableId.toString().startsWith('D-')) {
              removeDelivery(tableId);
              await syncRecordImmediately('deliveries', tableId);
            } else {
              updateTableState(tableId, [], 'FREE', '');
              const cleanId = tableId.toString().startsWith('table_') ? tableId : `table_${tableId}`;
              await syncRecordImmediately('restaurant_tables', cleanId);
            }
            refreshData();
            showToast("✅ ডাটা ডিলিট হয়েছে", 'online');
          }
        }
      ]
    );
  };

  // Deletes a completed order from history
  const handleDeleteDoneOrder = (orderId) => {
    if (userRole === 'admin') {
      Alert.alert(
        "অর্ডার ডিলিট",
        "আপনি কি নিশ্চিতভাবে এই সম্পন্ন হওয়া অর্ডারটি ডিলিট করতে চান?",
        [
          { text: "বাতিল", style: "cancel" },
          {
            text: "হ্যাঁ, ডিলিট করুন",
            style: "destructive",
            onPress: async () => {
              const success = deleteCompletedOrder(orderId);
              if (success) {
                refreshData();
                await syncRecordImmediately('orders', orderId);
                showToast("✅ ডাটা ডিলিট হয়েছে", 'online');
              }
            }
          }
        ]
      );
    } else {
      Alert.alert(
        "অর্ডার ডিলিট সীমাবদ্ধ",
        "পেমেন্ট সম্পন্ন হওয়ার পর কোনো বিক্রয় রেকর্ড মুছে ফেলা সম্ভব নয়।",
        [{ text: "ঠিক আছে", style: "default" }]
      );
    }
  };

  // General wrapper to update expenses in SQLite
  const handleUpdateExpenses = async (expenses) => {
    updateDailyExpenses(expenses);
    refreshData();
    // Sync all 5 expense categories
    const cats = ['দুদু স্টোর', 'আকাশ মুরগী', 'বার্গার বান', 'বাজার', 'অন্যান্য', 'ijara'];
    const today = getBusinessDate();
    let anySuccess = false;
    for (const c of cats) {
       const sid = `exp_${today}_${c.replace(/\s+/g, '_')}`;
       const s = await syncRecordImmediately('expenses', sid);
       if (s) anySuccess = true;
    }
    showToast(anySuccess ? "✅ ডাটা সেভ হয়েছে" : "📱 অফলাইনে সেভ হয়েছে", anySuccess ? 'online' : 'offline');
  };

  // Resets daily submission lock for today (Admin special privilege)
  const handleResetDailySubmit = () => {
    Alert.alert(
      "ডেইলি লক রিসেট নিশ্চিতকরণ",
      "আপনি কি নিশ্চিতভাবে আজকের দৈনিক সাবমিট লক মুছে দিতে চান? লক মুছে দিলে বাকিরা পুনরায় হিসাব সংশোধন ও সাবমিট করতে পারবে।",
      [
        { text: "বাতিল করুন", style: "cancel" },
        {
          text: "হ্যাঁ, লক মুছুন",
          style: "destructive",
          onPress: () => {
            const { resetDailySubmitLock } = require('./database');
            const success = resetDailySubmitLock();
            if (success) {
              refreshData();
              Alert.alert("সফল", "আজকের দৈনিক সাবমিট লক সফলভাবে মুছে ফেলা হয়েছে!");
            } else {
              Alert.alert("ব্যর্থ", "লক রিসেট করতে সমস্যা হয়েছে।");
            }
          }
        }
      ]
    );
  };

  // Resets daily lease/ijara for today (Admin special privilege)
  const handleResetIjara = () => {
    Alert.alert(
      "ইজা রিসেট নিশ্চিতকরণ",
      "আপনি কি নিশ্চিতভাবে আজকের ইজারার হিসাব ডিলিট করতে চান? ইজা রিসেট করলে বাকিরা পুনরায় নতুন করে ইজা এন্ট্রি করতে পারবে।",
      [
        { text: "বাতিল করুন", style: "cancel" },
        {
          text: "হ্যাঁ, ডিলিট করুন",
          style: "destructive",
          onPress: () => {
            const { resetIjaraExpense } = require('./database');
            const success = resetIjaraExpense();
            if (success) {
              refreshData();
              Alert.alert("সফল", "আজকের ইজারার হিসাব সফলভাবে ডিলিট করা হয়েছে!");
            } else {
              Alert.alert("ব্যর্থ", "ইজা ডিলিট করতে সমস্যা হয়েছে।");
            }
          }
        }
      ]
    );
  };

  const handleCloudRestore = async () => {
    Alert.alert(
      "Cloud Restore",
      "Cloud থেকে আজকের এবং গতকালের তথ্য পুনরায় ডাউনলোড করা হবে।\n\nচালিয়ে যেতে চান?",
      [
        { text: "বাতিল", style: "cancel" },
        {
          text: "Restore",
          onPress: async () => {
            showToast("🔄 রিস্টোর করা হচ্ছে...", "sync");
            try {
              const success = await restoreDatabaseFromCloud();
              if (success) {
                refreshData();
                Alert.alert("সফল", "Cloud থেকে ডাটা সফলভাবে রিস্টোর করা হয়েছে।");
              } else {
                Alert.alert("ব্যর্থ", "ডাটা রিস্টোর করতে সমস্যা হয়েছে। দয়া করে নেটওয়ার্ক কানেকশন চেক করুন।");
              }
            } catch (err) {
              console.error("[Cloud Restore] Error:", err);
              Alert.alert("ব্যর্থ", "একটি অপ্রত্যাশিত ত্রুটি ঘটেছে।");
            }
          }
        }
      ]
    );
  };

  const handleMenuRecovery = async () => {
    Alert.alert(
      "মেনু রিকভার করুন",
      "এটি ক্লাউড থেকে সর্বশেষ মেনু ডেটা ডাউনলোড করবে। এতে ক্লাউড রিড (Cloud Read) খরচ বাড়তে পারে। আপনি কি চালিয়ে যেতে চান?",
      [
        { text: "বাতিল", style: "cancel" },
        {
          text: "মেনু রিকভার",
          onPress: async () => {
            showToast("🔄 মেনু রিকভার করা হচ্ছে...", "sync");
            const { recoverMenuFromCloud } = require('./database');
            const success = await recoverMenuFromCloud();
            if (success) {
              refreshData();
              Alert.alert("সফল", "Cloud থেকে মেনু সফলভাবে ডাউনলোড করা হয়েছে।");
            } else {
              Alert.alert("ব্যর্থ", "মেনু ডাউনলোড করতে সমস্যা হয়েছে।");
            }
          }
        }
      ]
    );
  };

  const handleResetHistoryLimits = () => {
    const { resetHistoryDownloadLimits } = require('./database');
    const success = resetHistoryDownloadLimits();
    if (success) {
      Alert.alert("Success", "Daily historical download limits have been reset.");
    } else {
      Alert.alert("Error", "Failed to reset limits.");
    }
  };

  const handleHistoricalMonthDownload = async (monthStr, monthName) => {
    const { getDailyDownloadCount, checkHistoryDownloadStatus, fetchHistoricalMonthData, logHistoryDownload } = require('./database');
    
    // Check if already downloaded
    if (checkHistoryDownloadStatus('DEPOSIT_REPORT', monthStr)) return;

    // Check limit
    if (getDailyDownloadCount('DEPOSIT_REPORT') >= 2) {
      Alert.alert("সীমা অতিক্রম হয়েছে", "আজকের ক্লাউড ডাউনলোড সীমা অতিক্রম হয়েছে। অ্যাডমিনের সাথে যোগাযোগ করুন।");
      return;
    }

    Alert.alert(
      "ক্লাউড ডাউনলোড",
      "এই মাসের ডাটা লোকাল ডিভাইসে নেই।\n\nআপনি কি ক্লাউড থেকে ডাটা ডাউনলোড করতে চান?",
      [
        { text: "বাতিল", style: "cancel" },
        {
          text: "ডাউনলোড",
          onPress: async () => {
            showToast(`🔄 ${monthName} ডাটা ডাউনলোড হচ্ছে...`, "sync");
            try {
              await fetchHistoricalMonthData(monthStr);
              logHistoryDownload('DEPOSIT_REPORT', monthStr, 'System');
              refreshData();
              Alert.alert("ডাউনলোড সফল", "মাসের ডাটা সফলভাবে ডাউনলোড হয়েছে।");
            } catch (err) {
              Alert.alert("ত্রুটি", "ডাটা ডাউনলোড করতে ব্যর্থ হয়েছে।");
            }
          }
        }
      ]
    );
  };

  // Renders screen content based on custom router state
  const renderScreen = () => {
    if (!isLoggedIn) {
      return <LoginScreen onLoginSuccess={(role, name, mode) => handleLoginSuccess(role, name, mode)} />;
    }

    switch (currentScreen) {
      case 'DASHBOARD':
        if (userRole === 'admin') {
          return (
            <AdminDB
              onLogout={handleLogout}
              tables={tables}
              deliveries={deliveries}
              completedOrders={completedOrders}
              delCountdown={delCountdown}
              tabCountdown={tabCountdown}
              fullCountdown={fullCountdown}
              onTableSelect={handleTableSelect}
              onCreateDelivery={handleCreateDelivery}
              onUpdateTableName={handleUpdateTableName}
              onNavigateToExpenses={() => setCurrentScreen('EXPENSES')}
              onNavigateToSubmit={() => setCurrentScreen('DAILY_SUBMIT')}
              onNavigateToEditMenu={() => setCurrentScreen('EDIT_MENU')}
              onNavigateToSupplierDue={() => setCurrentScreen('SUPPLIER_DUE')}
              onNavigateToItemSalesReport={() => setCurrentScreen('ITEM_SALES_REPORT')}
              onNavigateToSyncDiagnostics={() => setCurrentScreen('SYNC_DIAGNOSTICS')}
              onNavigateToDeleteHistory={() => setCurrentScreen('DELETE_HISTORY')}
              onCloudRestore={handleCloudRestore}
              onMenuRecovery={handleMenuRecovery}
              onResetHistoryLimits={handleResetHistoryLimits}
              onHistoricalMonthDownload={handleHistoricalMonthDownload}

              submissionHistory={submissionHistory}
              onSavePastAccount={handleSavePastAccount}
              onDeletePastAccount={handleDeletePastAccount}

              dailyExpenses={dailyExpenses}
              onUpdateExpenses={handleUpdateExpenses}
              isDailySubmitted={isDailySubmitted}
              onDeleteActiveOrder={handleDeleteActiveOrder}
              onDeleteDoneOrder={handleDeleteDoneOrder}
              onResetDailySubmit={handleResetDailySubmit}
              onResetIjara={handleResetIjara}
            />
          );
        } else if (userRole === 'owner') {
          return (
            <OwnerDashboard
              onLogout={handleLogout}
              tables={tables}
              deliveries={deliveries}
              completedOrders={completedOrders}
              delCountdown={delCountdown}
              tabCountdown={tabCountdown}
              fullCountdown={fullCountdown}
              onTableSelect={handleTableSelect}
              onCreateDelivery={handleCreateDelivery}
              onUpdateTableName={handleUpdateTableName}
              onNavigateToExpenses={() => setCurrentScreen('EXPENSES')}
              onNavigateToSubmit={() => setCurrentScreen('DAILY_SUBMIT')}
              onNavigateToEditMenu={() => setCurrentScreen('EDIT_MENU')}
              onNavigateToSupplierDue={() => setCurrentScreen('SUPPLIER_DUE')}
              onNavigateToItemSalesReport={() => setCurrentScreen('ITEM_SALES_REPORT')}
              onCloudRestore={handleCloudRestore}

              onMenuRecovery={handleMenuRecovery}
              onHistoricalMonthDownload={handleHistoricalMonthDownload}

              submissionHistory={submissionHistory}
              onSavePastAccount={handleSavePastAccount}
              onDeletePastAccount={handleDeletePastAccount}

              dailyExpenses={dailyExpenses}
              onUpdateExpenses={handleUpdateExpenses}
              isDailySubmitted={isDailySubmitted}
              onDeleteActiveOrder={handleDeleteActiveOrder}
              onDeleteDoneOrder={handleDeleteDoneOrder}
            />
          );
        } else {
          return (
            <ManagerDashboard
              onLogout={handleLogout}
              tables={tables}
              deliveries={deliveries}
              completedOrders={completedOrders}
              delCountdown={delCountdown}
              tabCountdown={tabCountdown}
              fullCountdown={fullCountdown}
              onTableSelect={handleTableSelect}
              onCreateDelivery={handleCreateDelivery}
              onNavigateToSubmit={() => setCurrentScreen('DAILY_SUBMIT')}
              submissionHistory={submissionHistory}
              onSavePastAccount={handleSavePastAccount}
              onDeletePastAccount={handleDeletePastAccount}
              onUpdateTableName={handleUpdateTableName}
              onNavigateToExpenses={() => setCurrentScreen('EXPENSES')}
              onNavigateToSupplierDue={() => setCurrentScreen('SUPPLIER_DUE')}
              onNavigateToItemSalesReport={() => setCurrentScreen('ITEM_SALES_REPORT')}
              onCloudRestore={handleCloudRestore}
              onMenuRecovery={handleMenuRecovery}

              dailyExpenses={dailyExpenses}
              onUpdateExpenses={handleUpdateExpenses}
              isDailySubmitted={isDailySubmitted}
              onDeleteActiveOrder={handleDeleteActiveOrder}
              onDeleteDoneOrder={handleDeleteDoneOrder}
            />
          );
        }

      case 'TABLE_DETAIL':
        const allActiveOrders = [...tables, ...deliveries];
        let activeTable = allActiveOrders.find(t => t.id === selectedTableId);
        
        // If not found in active, look in completed (Admin edit mode)
        if (!activeTable && userRole === 'admin') {
          const doneOrder = completedOrders.find(o => o.id === selectedTableId);
          if (doneOrder) {
            // Transform Done order to Table format for the detail screen
            const items = doneOrder.items.split(', ').map(itemStr => {
               const match = itemStr.match(/(.+) x(\d+)/);
               if (match) {
                 const name = match[1];
                 const qty = parseInt(match[2], 10);
                 const menuItem = menuItems.find(mi => mi.name === name);
                 return {
                   name,
                   qty,
                   price: menuItem ? menuItem.price : (doneOrder.totalAmount / qty) // fallback
                 };
               }
               return null;
            }).filter(Boolean);

            activeTable = {
              id: doneOrder.id,
              name: doneOrder.tableId,
              status: 'Done', // Special status
              items: items
            };
          }
        }

        return (
          <TableDetailScreen
            table={activeTable}
            onBack={async () => {
              if (selectedTableId && selectedTableId.toString().startsWith('D-')) {
                const delOrder = deliveries.find(d => d.id === selectedTableId);
                if (!delOrder || !delOrder.items || delOrder.items.length === 0) {
                  removeDelivery(selectedTableId);
                  await syncRecordImmediately('deliveries', selectedTableId);
                }
              }
              setCurrentScreen('DASHBOARD');
              refreshData();
            }}
            onUpdateTableItems={handleUpdateTableItems}
            onUpdateDeliveryDetails={handleUpdateDeliveryDetails}
            onPaymentDone={handleNavigateToCheckout}
            onNavigateToAddItem={() => setCurrentScreen('ADD_ITEM')}
          />
        );
      
      case 'ADD_ITEM':
        const allActiveItems = [...tables, ...deliveries];
        const activeItemTable = allActiveItems.find(t => t.id === selectedTableId);
        return (
          <AddItemScreen
            table={activeItemTable}
            menuItems={menuItems}
            userRole={userRole}
            onBack={() => setCurrentScreen('TABLE_DETAIL')}
            onUpdateTableItems={handleUpdateTableItems}
            onUpdateMenuPrice={handleUpdateMenuPrice}
          />
        );

      case 'EDIT_MENU':
        return (
          <AddItemScreen
            table={{ items: [] }}
            menuItems={menuItems}
            userRole={userRole}
            onBack={() => setCurrentScreen('DASHBOARD')}
            onUpdateTableItems={() => {}}
            onUpdateMenuPrice={handleUpdateMenuPrice}
            onAddMenuItem={handleAddMenuItem}
            onDeleteMenuItem={handleDeleteMenuItem}
            editMode={true}
          />
        );

      case 'PAYMENT_CHECKOUT':
        const allCheckoutOrders = [...tables, ...deliveries];
        const checkoutTable = allCheckoutOrders.find(t => t.id === selectedTableId);
        const totalItemsCount = checkoutTable ? checkoutTable.items.reduce((sum, item) => sum + item.qty, 0) : 0;
        return (
          <PaymentCheckoutScreen
            tableId={checkoutTable ? (checkoutTable.name || checkoutTable.id) : selectedTableId}
            totalAmount={paymentAmount}
            deliveryCharge={deliveryCharge}
            changeMoneyGiven={changeMoneyGiven}
            totalItems={totalItemsCount}
            userRole={userRole}
            onBack={() => setCurrentScreen('TABLE_DETAIL')}
            onCompletePayment={handleCompletePayment}
          />
        );

      case 'PAYMENT_SUCCESS':
       const allSuccessOrders = [...tables, ...deliveries];
       const successTable = allSuccessOrders.find(t => t.id === selectedTableId);
       return (
         <PaymentSuccess
           tableId={successTable ? (successTable.name || successTable.id) : selectedTableId}
           totalAmount={paymentAmount + deliveryCharge + changeMoneyGiven}
           paidAmount={paidAmount}
           paymentMethod={paymentMethod}
           onReturnHome={handleReturnHome}
         />
       );
      case 'DAILY_SUBMIT':
        return (
          <DailySubmitScreen
            dailyExpenses={dailyExpenses}
            completedOrders={completedOrders}
            submissionHistory={submissionHistory}
            onUpdateExpenses={handleUpdateExpenses}
            isDailySubmitted={isDailySubmitted}
            userRole={userRole}
            onBack={() => setCurrentScreen('DASHBOARD')}
            onSubmit={async (summary) => {
              if (isDailySubmitted && userRole !== 'admin') {
                Alert.alert("ইতিমধ্যে সাবমিট করা হয়েছে", "আজকের হিসাব ইতিমধ্যে সাবমিট করা হয়ে গেছে।");
                return;
              }
              if (summary) {
                submitDailySheet(summary, userDisplayName);
                refreshData();
                
                const todayStr = getBusinessDate();
                const success = await syncRecordImmediately('daily_submit', todayStr);
                showToast(success ? "✅ ডাটা সেভ হয়েছে" : "📱 অফলাইনে সেভ হয়েছে", success ? 'online' : 'offline');
              }
              setCurrentScreen("DASHBOARD");
              Alert.alert("সফল", "আজকের হিসাব সফলভাবে সাবমিট করা হয়েছে এবং দিনটি ক্লোজ করা হয়েছে।");
            }}
          />
        );
      
      case 'EXPENSES':
        return (
          <ExpensesScreen
            dailyExpenses={dailyExpenses}
            onUpdateExpenses={handleUpdateExpenses}
            isDailySubmitted={isDailySubmitted}
            userRole={userRole}
            onBack={() => setCurrentScreen('DASHBOARD')}
          />
        );

      case 'SUPPLIER_DUE':
        return (
          <SupplierDueScreen
            userRole={userRole}
            userDisplayName={userDisplayName}
            onBack={() => setCurrentScreen('DASHBOARD')}
          />
        );

      case 'ITEM_SALES_REPORT':
        return (
          <DailyItemSalesReport
            onBack={() => setCurrentScreen('DASHBOARD')}
          />
        );

      case 'SYNC_DIAGNOSTICS':
        return (
          <SyncDiagnosticsScreen
            onBack={() => setCurrentScreen('DASHBOARD')}
          />
        );

      case 'DELETE_HISTORY':
        if (userRole === 'admin') {
          return (
            <DeleteHistoryScreen
              onBack={() => setCurrentScreen('DASHBOARD')}
            />
          );
        } else {
          return null;
        }

      default:
        return null;
    }
  };

  return (
    <SafeAreaProvider style={{ flex: 1 }}>
      <View style={styles.container}>
        <StatusBar style="light" translucent={true} backgroundColor="transparent" />
        {renderScreen()}

        {/* RUNTIME ONLINE ONLY BLOCKING OVERLAY */}
        <Modal 
          visible={isLoggedIn && isOnlineOnlyMode && !isOnline} 
          transparent={true} 
          animationType="fade"
          onRequestClose={() => {}}
        >
          <View style={styles.blockOverlay}>
            <View style={styles.blockContent}>
              <Text style={styles.blockIcon}>⚠️</Text>
              <Text style={styles.blockTitle}>ইন্টারনেট সংযোগ বিচ্ছিন্ন।</Text>
              <Text style={styles.blockSubtitle}>Online Only মোড সক্রিয়।</Text>
              <Text style={styles.blockMessage}>
                ইন্টারনেট পুনরায় সংযুক্ত না হওয়া পর্যন্ত কাজ করা যাবে না।
              </Text>
            </View>
          </View>
        </Modal>

        {/* NOTIFICATION TOAST */}
        <NotificationToast visible={toastVisible} message={toastMessage} type={toastType} />

        {/* CLOUD DATA RESTORATION OVERLAY */}
        <Modal visible={isRestoring} transparent={true} animationType="fade">
          <View style={styles.restoreOverlay}>
            <View style={styles.restoreContent}>
              <ActivityIndicator size="large" color="#FFB703" />
              <Text style={styles.restoreTitle}>পুনরুদ্ধার করা হচ্ছে...</Text>
              <Text style={styles.restoreSubtitle}>Cloud থেকে আপনার সব তথ্য লোড করা হচ্ছে। দয়া করে অপেক্ষা করুন।</Text>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  restoreOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  restoreContent: {
    alignItems: 'center',
    width: '100%',
  },
  restoreTitle: {
    color: '#FFB703',
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 20,
  },
  restoreSubtitle: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 20,
  },
  // TOAST STYLES
  toastContainer: {
    position: 'absolute',
    bottom: 85,
    left: 40,
    right: 40,
    alignItems: 'center',
    zIndex: 9999,
  },
  toastContent: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 4,
  },
  toastOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.9)', // Semi-transparent Green
  },
  toastOffline: {
    backgroundColor: 'rgba(245, 158, 11, 0.9)', // Semi-transparent Orange
  },
  toastSync: {
    backgroundColor: 'rgba(59, 130, 246, 0.9)', // Semi-transparent Blue
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  blockOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  blockContent: {
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#FFB703',
    padding: 32,
    width: '90%',
    maxWidth: 360,
  },
  blockIcon: {
    fontSize: 48,
    marginBottom: 20,
  },
  blockTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  blockSubtitle: {
    color: '#FFB703',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 16,
  },
  blockMessage: {
    color: '#A0AEC0',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
});
