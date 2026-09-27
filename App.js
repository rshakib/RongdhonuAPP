import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Alert, TouchableOpacity, Modal, ScrollView, Text, Platform, Dimensions, ActivityIndicator, AppState, BackHandler, TextInput } from 'react-native';
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

// --- pull toast plumbing ------------------------------------------------------
// A single sink (set by the pull-listener effect in App) receives
// (source, hasChanges) for every cloud pull and shows the pull toast.
let pullReportSink = null;
const reportPull = (source, hasChanges) => {
  try { if (pullReportSink) pullReportSink(source, hasChanges); } catch (_) {}
};

// Supabase is the primary read path: while it is healthy the standalone Firebase
// pull timers are skipped entirely (the Supabase syncers already fall back to
// Firebase in the same tick on any failure). Firebase is read only when Supabase
// is down/unconfigured/kill-switched-off, or for >31-day history.
const runFirebasePullIfSupabaseDown = async (name, syncFn, refreshData) => {
  let health = { healthy: false, reason: 'error' };
  try {
    const { getSupabaseHealth } = require('./services/supabaseSync.js');
    health = getSupabaseHealth();
  } catch (_) {}
  const { recordAutoSyncEvent } = require('./database');
  if (health.healthy) {
    console.log(`[Firebase-Read] ${name} SKIPPED — Supabase primary healthy (reason=${health.reason})`);
    recordAutoSyncEvent(name, 'skipped', `supabase-healthy reason=${health.reason} → Firebase read skipped`);
    return false;
  }
  console.log(`[Firebase-Read] ${name} RUNNING Firebase pull — reason=${health.reason}`);
  const didChange = await runAutoPull(name, syncFn, refreshData);
  reportPull('firebase', didChange); // this path only runs on the Firebase fallback
  return didChange;
};

// One-off lifecycle refresh (login/foreground/startup/network): prefer the Supabase
// pull; the Supabase fn falls back to Firebase on failure.
const runPullPreferSupabase = async (name, supabaseFnName, fallbackFn, refreshData) => {
  let health = { healthy: false, reason: 'error' };
  try {
    const mod = require('./services/supabaseSync.js');
    health = mod.getSupabaseHealth();
    if (health.healthy && typeof mod[supabaseFnName] === 'function') {
      // Supabase route → Firebase is NOT read. Tagged so every pull shows its source.
      console.log(`[Firebase-Read] ${name} SKIPPED — Supabase route (reason=${health.reason})`);
      return await runAutoPull(name, mod[supabaseFnName], refreshData);
    }
  } catch (_) {}
  console.log(`[Firebase-Read] ${name} RUNNING Firebase fallback pull — reason=${health.reason}`);
  const didChange = await runAutoPull(name, fallbackFn, refreshData);
  reportPull('firebase', didChange);
  return didChange;
};

// Menu refresh from cloud: Supabase-first (menu is now Supabase-backed).
const refreshMenuFromCloud = async () => {
  try {
    const { syncSupabaseMenu } = require('./services/supabaseSync.js');
    return await syncSupabaseMenu();
  } catch (_) {
    try { return await syncMenuOnly(); } catch (__) { return false; }
  }
};

// Import SQLite and cloud synchronization layer
import {
  db,
  enqueueSync,
  calculateAndSaveDailySummary,
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
  completeDelivery,
  getDeliveryById,
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
  getSyncRuntimeDiagnostics,
  executeInspectorQuery,
  formatDisplayDate,
  ACTIVE_APP_PROFILE
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
import PrinterSettingsScreen from './screens/PrinterSettingsScreen';
import AutoReceiptPrinter from './components/AutoReceiptPrinter';
import ExpensesScreen from './screens/ExpensesScreen';
import SupplierDueScreen from './screens/SupplierDueScreen';
import DailyItemSalesReport from './screens/DailyItemSalesReport';
import DeviceManagementScreen from './screens/DeviceManagementScreen';
import DevicePendingScreen from './screens/DevicePendingScreen';
import DeviceBlockedScreen from './screens/DeviceBlockedScreen';
import AppUpdateRequiredScreen from './screens/AppUpdateRequiredScreen';
import OfflineVerificationScreen from './screens/OfflineVerificationScreen';
import SyncDiagnosticsScreen from './screens/SyncDiagnosticsScreen';
import DeleteHistoryScreen from './screens/DeleteHistoryScreen';
import SystemToolsScreen from './screens/SystemToolsScreen';
import BackupRestoreScreen from './screens/BackupRestoreScreen';
import DatabaseHealthScreen from './screens/DatabaseHealthScreen';
import SyncStatusScreen from './screens/SyncStatusScreen';
import DatabaseStatsScreen from './screens/DatabaseStatsScreen';
import SystemInfoScreen from './screens/SystemInfoScreen';
import DatabaseExplorerScreen from './screens/DatabaseExplorerScreen';
import TableViewerScreen from './screens/TableViewerScreen';
import RowDetailScreen from './screens/RowDetailScreen';

import OwnerFinanceDashboard from './screens/OwnerFinanceDashboard';
import EmployeeListScreen from './screens/EmployeeListScreen';
import AddEmployeeScreen from './screens/AddEmployeeScreen';
import EmployeeDetailScreen from './screens/EmployeeDetailScreen';
import AddSalaryPaymentScreen from './screens/AddSalaryPaymentScreen';
import OwnerExpenseScreen from './screens/OwnerExpenseScreen';
import ActivityLogScreen from './screens/ActivityLogScreen';
import { logActivity, ACTION_TYPES } from './services/activityLogger';


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
  // Ref kept in sync so the setInterval closure always reads the CURRENT login state.
  // React state captured in a setInterval(..., []) closure is permanently stale (always false).
  const isLoggedInRef = useRef(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [pendingDeviceId, setPendingDeviceId] = useState('');
  const [pendingLoginInfo, setPendingLoginInfo] = useState(null);
  const [updatePolicy, setUpdatePolicy] = useState(null);

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

  // Pull toast (ALL apps) — identical style/size to the sync toast. Fires only
  // when a pull actually brought changes, debounced so multi-group ticks show ONE.
  const pullToastAtRef = useRef(0);
  const notifyPull = (source, hasChanges) => {
    if (!hasChanges) return;
    const now = Date.now();
    if (now - pullToastAtRef.current < 3000) return;
    pullToastAtRef.current = now;
    showToast(source === 'supabase'
      ? '⬇️ Supabase থেকে ডাটা pull হয়েছে'
      : '⬇️ Firebase থেকে ডাটা pull হয়েছে', 'sync');
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
  const [forceReauthRequired, setForceReauthRequired] = useState(() => {
    try {
      const { getAppConfig } = require('./database');
      return getAppConfig('force_reauth_required') === '1';
    } catch (e) {
      return false;
    }
  }); // true when admin force-logged out this device
  
  // Visual Sync Timer Countdowns (Shared for all roles)
  const [delCountdown, setDelCountdown] = useState(90);
  const [tabCountdown, setTabCountdown] = useState(15);
  const [fullCountdown, setFullCountdown] = useState(30);

  // Keep isLoggedInRef in sync with isLoggedIn state so the setInterval closure (which captures
  // a stale value from mount) always reads the CURRENT login state.
  useEffect(() => {
    isLoggedInRef.current = isLoggedIn;
  }, [isLoggedIn]);

  // Module-level flag: prevents overlapping async force-logout checks from stacking up.
  // Declared outside React so it persists across re-renders without causing re-renders.
  const _forceLogoutCheckRef = useRef(false);
  const _forceLogoutCheckAtRef = useRef(0);

  // Concurrency lock for ensureInitialData() so overlapping calls return immediately.
  const ensureInitialDataLockRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => {
      setDelCountdown(prev => (prev <= 0 ? 90 : prev - 1));
      setTabCountdown(prev => (prev <= 0 ? 15 : prev - 1));
      setFullCountdown(prev => (prev <= 0 ? 30 : prev - 1));

      // Periodic Device Force Logout Check (DEVICE BASED — ALL ROLES: ADMIN, OWNER, MANAGER)
      // GUARD 1: Only run when the user is currently logged in.
      //          The setInterval closure captures `isLoggedIn` at mount (always false).
      //          We use isLoggedInRef.current which is kept in sync via a useEffect above.
      // GUARD 2: Skip if a previous async check hasn't finished yet (prevents queue buildup).
      if (!isLoggedInRef.current) return;
      if (_forceLogoutCheckRef.current) {
        // Watchdog: a hung check must not disable the 1s poll forever (e.g. a fetch that never
        // settles after a network change). Force-release after 20s so the next tick retries.
        if (Date.now() - _forceLogoutCheckAtRef.current > 20000) {
          console.warn('[ForceLogout] stage=periodic_check watchdog release (previous check hung)');
          _forceLogoutCheckRef.current = false;
        } else {
          return;
        }
      }

      _forceLogoutCheckRef.current = true;
      _forceLogoutCheckAtRef.current = Date.now();
      ;(async () => {
        try {
          const { checkAndExecuteForceLogout } = require('./services/deviceRegistry');
          const t0 = Date.now();
          console.log(`[ForceLogout] stage=periodic_check_start isLoggedIn=${isLoggedInRef.current} elapsed=0ms`);
          const forceRes = await checkAndExecuteForceLogout();
          if (forceRes && forceRes.triggered) {
            console.log(`[ForceLogout] stage=periodic_check result=triggered elapsed=${Date.now()-t0}ms`);
            isLoggedInRef.current = false;
            setIsLoggedIn(false);
            setUserRole('');
            setUserDisplayName('');
            setPendingLoginInfo(null);
            setCurrentScreen('LOGIN');
            setForceReauthRequired(true);
            Alert.alert(
              'সেশন বাতিল',
              forceRes.message || 'প্রশাসক আপনার সেশন বন্ধ করেছেন।\nঅনুগ্রহ করে আবার লগইন করুন।',
              [{ text: 'ঠিক আছে' }]
            );
          }
        } catch (e) {
          console.warn('[ForceLogout] stage=periodic_check error:', e.message);
        } finally {
          _forceLogoutCheckRef.current = false;
        }
      })();
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Navigation State
  const [currentScreen, setCurrentScreen] = useState('DASHBOARD'); // 'DASHBOARD', 'TABLE_DETAIL', 'PAYMENT_SUCCESS', 'DAILY_SUBMIT', 'ADD_ITEM', 'PAYMENT_CHECKOUT'
  const currentScreenRef = useRef(currentScreen);
  currentScreenRef.current = currentScreen;
  const pendingLoginInfoRef = useRef(pendingLoginInfo);
  pendingLoginInfoRef.current = pendingLoginInfo;
  const [selectedTableId, setSelectedTableId] = useState(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState(0); // Total due amount
  const [deliveryCharge, setDeliveryCharge] = useState(0); // Optional delivery charge
  const [changeMoneyGiven, setChangeMoneyGiven] = useState(0); // Change money given to rider
  const [paidAmount, setPaidAmount] = useState(0);       // User entered paid amount
  const [paymentMethod, setPaymentMethod] = useState('ক্যাশ');
  const [lastCompletedOrder, setLastCompletedOrder] = useState(null);
  const [autoPrintOrder, setAutoPrintOrder] = useState(null);

  // Global Dynamic Menu State
  const [menuItems, setMenuItems] = useState([]);

  // Track if daily sheet is submitted
  const [isDailySubmitted, setIsDailySubmitted] = useState(false);
  const [isMandatorySubmit, setIsMandatorySubmit] = useState(false);


  // Mandatory Previous Day Submit states
  const [showMandatoryPreviousSubmitModal, setShowMandatoryPreviousSubmitModal] = useState(false);
  const [missingSubmitDate, setMissingSubmitDate] = useState('');
  const [missingSubmitSummary, setMissingSubmitSummary] = useState(null);

  // Database Explorer states
  const [selectedDBTable, setSelectedDBTable] = useState('');
  const [selectedDBRow, setSelectedDBRow] = useState(null);

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


        // 0. Mandatory Version Policy Check (ADMIN profile exempt from startup gating)
        if (ACTIVE_APP_PROFILE !== 'ADMIN') {
          try {
            const { checkAppVersionPolicy } = require('./services/firebaseAppConfig');
            const verRes = await checkAppVersionPolicy(ACTIVE_APP_PROFILE);
            if (verRes && verRes.updateRequired) {
              setUpdatePolicy(verRes.policy);
              setCurrentScreen('APP_UPDATE_REQUIRED');
              return;
            }
          } catch (verErr) {
            console.warn("[App] Version policy startup check error:", verErr);
          }
        }

        // Device Registration Check (Phase 1 Access Control) & App Usage Table
        try {
          const { registerDeviceIfNeeded, reconcileAdminFleet, verifyDeviceAccessOnStartupOrResume } = require('./services/deviceRegistry');
          const { initAppUsageTable } = require('./services/appUsageTracker.js');
          initAppUsageTable();
          const coldStartEventId = 'cold_start_' + Date.now();
          await registerDeviceIfNeeded({ eventId: coldStartEventId, isColdStart: true });

          // PHASE 2: inject X-Device-Id so every Supabase call is attributable (RLS Option B prep).
          try {
            const { setSupabaseDeviceId } = require('./services/supabaseClient.js');
            const { getCurrentDeviceRecord } = require('./services/deviceRegistry');
            const currentDeviceRec = getCurrentDeviceRecord();
            if (currentDeviceRec && currentDeviceRec.device_id) {
              setSupabaseDeviceId(currentDeviceRec.device_id);
            }
          } catch (supaDeviceErr) {
            console.warn("[App] setSupabaseDeviceId skipped (isolated):", supaDeviceErr?.message || supaDeviceErr);
          }

          // TODO: If OWNER is granted Device Control screen access in the future, enable full device fleet fetching and reconciliation for OWNER here.
          if (ACTIVE_APP_PROFILE === 'ADMIN') {
            await reconcileAdminFleet();
          }

          // Authoritative Device Access Gate on Startup
          const devAccess = await verifyDeviceAccessOnStartupOrResume();
          if (devAccess && devAccess.blocked) {
            setIsLoggedIn(false);
            setUserRole('');
            setUserDisplayName('');
            setPendingDeviceId(devAccess.deviceId || '');
            setPendingLoginInfo({ isAdminLock: Boolean(devAccess.isAdminLock) });
            setCurrentScreen('DEVICE_BLOCKED');
            return;
          }
          if (devAccess && devAccess.forceLogout) {
            setIsLoggedIn(false);
            setUserRole('');
            setUserDisplayName('');
            setPendingLoginInfo(null);
            setCurrentScreen('LOGIN');
            setForceReauthRequired(true);
            Alert.alert(
              'সেশন বাতিল',
              devAccess.message || 'Your session has been terminated by the administrator. Please log in again.'
            );
            return;
          }
          if (devAccess && devAccess.verificationRequired) {
            setIsLoggedIn(false);
            setCurrentScreen('OFFLINE_VERIFICATION');
            return;
          }
        } catch (devErr) {
          console.error("[App] Device registration check failed:", devErr);
        }

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

        // Unfinished-restore marker (set by ensureInitialData, cleared on finish). Retry happens post-login.
        const { getAppConfig, setAppConfig, restoreUsersOnlyForProfile } = require('./database');
        const restoreInProgress = getAppConfig('restore_in_progress');
        if (restoreInProgress) {
          console.warn(`[App] Detected unfinished initial restore (restore_in_progress=${restoreInProgress}). Will retry after login.`);
        }

        // Fresh install: download ONLY this profile's users (role-filtered) so login works pre-approval.
        const usersEmpty = (executeInspectorQuery("SELECT COUNT(*) as c FROM users")[0]?.c || 0) === 0;
        if (usersEmpty) {
          console.log(`[App] No local users. Running users-only bootstrap for profile ${ACTIVE_APP_PROFILE}...`);
          // Genuine fresh install: mark it so ensureInitialData() performs the one-time restore.
          setAppConfig('initial_restore_required', 'true');
          await restoreUsersOnlyForProfile();
        } else {
          // Regular launch: existing data found
          initDatabase(false);
          refreshData();
        }

        // Start background sync service daemon automatically
        startSyncService();

        // PHASE 2: start the independent Supabase dual-write daemon (no-op if
        // disabled via EXPO_PUBLIC_SUPABASE_SYNC_ENABLED or Supabase unconfigured).
        try {
          const { startSupabaseSyncService } = require('./services/supabaseSyncQueue.js');
          startSupabaseSyncService();
        } catch (supaQueueErr) {
          console.warn("[App] startSupabaseSyncService skipped (isolated):", supaQueueErr?.message || supaQueueErr);
        }

        // Check if there are any pending midnight rollovers to apply
        const didRollover = checkAndApplyIjaraRollover();
        if (didRollover) refreshData();

        // Set interval to check for midnight rollovers every minute
        setInterval(() => {
          const rollover = checkAndApplyIjaraRollover();
          if (rollover) refreshData();
        }, 60000);

        // Pull low frequency collections (excluding menu) in the background on startup.
        // Only for devices that already have data; a fresh install downloads post-login (ensureInitialData).
        if (!usersEmpty) {
          runPullPreferSupabase('startup-low-frequency-pull', 'syncSupabaseLowFrequencyCollections', syncLowFrequencyCollections, refreshData)
            .catch(e => console.log("[Startup Sync] Offline, skipped low frequency pull:", e.message));
        }
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
       await runFirebasePullIfSupabaseDown('auto-high-frequency-pull', syncHighFrequencyCollections, refreshData);
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
       await runFirebasePullIfSupabaseDown('auto-deletions-pull', syncDeletionsOnly, refreshData);
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
       await runFirebasePullIfSupabaseDown('auto-tables-pull', syncTablesOnly, refreshData);
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
      await runFirebasePullIfSupabaseDown('auto-low-frequency-pull', syncLowFrequencyCollections, refreshData);
    }, 180000); // Check every 3 minutes (180s)

    return () => {
      clearInterval(lowFrequencyPoll);
      markSyncTimerInactive('auto-low-frequency-pull');
    };
  }, [isLoggedIn]);

  // --- SUPABASE-PRIMARY PULL (the Firebase timers above are health-gated) ---
  // While Supabase is healthy these are the ONLY read path: the Firebase timers
  // above skip themselves via runFirebasePullIfSupabaseDown. Each Supabase fn calls
  // its Firebase counterpart on any failure/timeout. restaurant_tables uses polling.
  useEffect(() => {
    if (!isLoggedIn) return;

    const {
      syncSupabaseTables,
      syncSupabaseHighFrequencyCollections,
      syncSupabaseDeletions,
      syncSupabaseLowFrequencyCollections,
      syncSupabaseMenu
    } = require('./services/supabaseSync.js');

    registerSyncTimer('supabase-tables-poll', 2000, 'syncSupabaseTables');
    const supabaseTablesPoll = setInterval(async () => {
      await runAutoPull('supabase-tables-poll', syncSupabaseTables, refreshData);
    }, 2000);

    registerSyncTimer('supabase-high-frequency-poll', 5000, 'syncSupabaseHighFrequencyCollections');
    const supabaseHighPoll = setInterval(async () => {
      await runAutoPull('supabase-high-frequency-poll', syncSupabaseHighFrequencyCollections, refreshData);
    }, 5000);

    registerSyncTimer('supabase-deletions-poll', 15000, 'syncSupabaseDeletions');
    const supabaseDeletionsPoll = setInterval(async () => {
      await runAutoPull('supabase-deletions-poll', syncSupabaseDeletions, refreshData);
    }, 15000);

    registerSyncTimer('supabase-low-frequency-poll', 45000, 'syncSupabaseLowFrequencyCollections');
    const supabaseLowPoll = setInterval(async () => {
      await runAutoPull('supabase-low-frequency-poll', syncSupabaseLowFrequencyCollections, refreshData);
    }, 45000);

    registerSyncTimer('supabase-menu-poll', 45000, 'syncSupabaseMenu');
    const supabaseMenuPoll = setInterval(async () => {
      await runAutoPull('supabase-menu-poll', syncSupabaseMenu, refreshData);
    }, 45000);

    return () => {
      clearInterval(supabaseTablesPoll);
      markSyncTimerInactive('supabase-tables-poll');
      clearInterval(supabaseHighPoll);
      markSyncTimerInactive('supabase-high-frequency-poll');
      clearInterval(supabaseDeletionsPoll);
      markSyncTimerInactive('supabase-deletions-poll');
      clearInterval(supabaseLowPoll);
      markSyncTimerInactive('supabase-low-frequency-poll');
      clearInterval(supabaseMenuPoll);
      markSyncTimerInactive('supabase-menu-poll');
    };
  }, [isLoggedIn]);

  // --- SUPABASE REALTIME DEVICE TRACKING & INSTANT REMOTE COMMANDS ---
  // Tracks device presence every 1 second (in-memory WebSocket) while app is active.
  // Receives instant remote commands: Admin Lock, Force Logout, and Status Changes with sub-second latency.
  useEffect(() => {
    let stopPresence = null;
    let appStateSub = null;

    const initSupabaseTracking = () => {
      try {
        const { getCurrentDeviceRecord, checkAndExecuteForceLogout, syncRemoteDeviceToLocal } = require('./services/deviceRegistry');
        const { startDevicePresence } = require('./services/supabaseDeviceControl.js');
        const deviceRecord = getCurrentDeviceRecord();
        if (!deviceRecord || !deviceRecord.device_id) return;

        const metadataProvider = () => {
          const rec = getCurrentDeviceRecord() || {};
          return {
            deviceName: rec.device_name || rec.model || '',
            status: rec.status || 'PENDING',
            userRole: userRole || 'Guest',
            username: userDisplayName || 'Anonymous'
          };
        };

        const onRemoteCommand = async (remoteRecord) => {
          const cmdT0 = Date.now();
          const cmdId = remoteRecord.force_logout_token || remoteRecord.updated_at || 'unknown';
          const cmdDeviceId = remoteRecord.device_id || 'unknown';
          try {
            console.log(`[ForceLogout] stage=realtime_received deviceId=${cmdDeviceId} commandId=${cmdId} force_logout=${remoteRecord.force_logout} elapsed=0ms`);
            // Immediately sync remote state to local SQLite database
            syncRemoteDeviceToLocal(remoteRecord);

            // Handle remote Force Logout
            if (remoteRecord.force_logout) {
              console.log(`[ForceLogout] stage=executing_check deviceId=${cmdDeviceId} commandId=${cmdId} elapsed=${Date.now()-cmdT0}ms`);
              const res = await checkAndExecuteForceLogout(remoteRecord);
              if (res && res.triggered) {
                console.log(`[ForceLogout] stage=triggered_navigation deviceId=${cmdDeviceId} commandId=${cmdId} elapsed=${Date.now()-cmdT0}ms`);
                setIsLoggedIn(false);
                setUserRole('');
                setUserDisplayName('');
                setPendingLoginInfo(null);
                setCurrentScreen('LOGIN');
                setForceReauthRequired(true);
                Alert.alert(
                  'সেশন বাতিল',
                  res.message || 'প্রশাসক আপনার সেশন বন্ধ করেছেন। অনুগ্রহ করে আবার লগইন করুন।'
                );
                console.log(`[ForceLogout] stage=complete deviceId=${cmdDeviceId} commandId=${cmdId} elapsed=${Date.now()-cmdT0}ms`);
                return;
              } else {
                console.log(`[ForceLogout] stage=check_not_triggered deviceId=${cmdDeviceId} commandId=${cmdId} elapsed=${Date.now()-cmdT0}ms reason=already_handled_or_no_flag`);
              }
            }

            // Handle remote Admin Lock or Block (Applies regardless of login state)
            if (remoteRecord.admin_lock || remoteRecord.status === 'BLOCKED') {
              setIsLoggedIn(false);
              setUserRole('');
              setUserDisplayName('');
              setPendingLoginInfo({ isAdminLock: Boolean(remoteRecord.admin_lock) });
              setPendingDeviceId(remoteRecord.device_id);
              setCurrentScreen('DEVICE_BLOCKED');
              return;
            } else if (remoteRecord.status === 'ACTIVE') {
              // ─── BUG-2 / BUG-6 FIX ─────────────────────────────────────
              // Previously only acted if screen was exactly 'DEVICE_PENDING'.
              // Now we handle approval from: DEVICE_PENDING, DEVICE_BLOCKED, LOGIN.
              // ─────────────────────────────────────────────────────────────
              const approvalScreens = ['DEVICE_PENDING', 'DEVICE_BLOCKED', 'LOGIN'];
              const onApprovableScreen = approvalScreens.includes(currentScreenRef.current);
              const alreadyLoggedIn = isLoggedIn;

              if (!alreadyLoggedIn && onApprovableScreen) {
                if (pendingLoginInfoRef.current) {
                  const { role, displayName, mode } = pendingLoginInfoRef.current;
                  const initStatus = await ensureInitialData();
                  if (initStatus === 'failed') {
                    setPendingLoginInfo({ role, displayName, mode });
                    setIsLoggedIn(false);
                    setCurrentScreen('INITIAL_DATA_FAILED');
                    return;
                  }
                  if (initStatus === 'running') {
                    console.log('[App] ensureInitialData already running; skipping realtime approval routing.');
                    return;
                  }
                  refreshData();
                  handleLoginSuccess(role, displayName, mode);
                } else {
                  if (currentScreenRef.current !== 'LOGIN') {
                    setCurrentScreen('LOGIN');
                  }
                }
              }
            }
          } catch (err) {
            console.error('[SupabaseDeviceControl] Error handling remote command:', err);
          }
        };

        if (AppState.currentState === 'active') {
          stopPresence = startDevicePresence(deviceRecord.device_id, metadataProvider, onRemoteCommand);
        }
      } catch (e) {
        console.warn('[SupabaseDeviceControl] Init error:', e.message);
      }
    };

    initSupabaseTracking();

    let appWasBackgrounded = false;

    appStateSub = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active') {
        const isReturningFromBackground = appWasBackgrounded;
        appWasBackgrounded = false;

        initSupabaseTracking();

        // Check version and authoritative device access on every return to foreground
        if (isReturningFromBackground) {
          try {
            // 1. Mandatory version check on foreground resume
            const { checkAppVersionPolicy } = require('./services/firebaseAppConfig');
            const effectiveCheckRole = userRole || (ACTIVE_APP_PROFILE === 'ADMIN' ? 'ADMIN' : ACTIVE_APP_PROFILE);
            const verPolicyRes = await checkAppVersionPolicy(effectiveCheckRole);
            if (verPolicyRes && verPolicyRes.updateRequired) {
              setUpdatePolicy(verPolicyRes.policy);
              setCurrentScreen('APP_UPDATE_REQUIRED');
              return;
            }

            // 2. Authoritative self-check on foreground resume for all roles
            const { verifyDeviceAccessOnStartupOrResume, registerDeviceIfNeeded, reconcileAdminFleet } = require('./services/deviceRegistry');
            
            // TODO: If OWNER is granted Device Control screen access in the future, enable full device fleet fetching and reconciliation for OWNER here.
            if (ACTIVE_APP_PROFILE === 'ADMIN') {
              const resumeEventId = 'resume_' + Date.now();
              await registerDeviceIfNeeded({ eventId: resumeEventId, isResume: true });
              await reconcileAdminFleet();
              refreshData();
            }

            const devAccess = await verifyDeviceAccessOnStartupOrResume(userRole);
            if (devAccess && devAccess.blocked) {
              setIsLoggedIn(false);
              setUserRole('');
              setUserDisplayName('');
              setPendingDeviceId(devAccess.deviceId || '');
              setPendingLoginInfo({ isAdminLock: Boolean(devAccess.isAdminLock) });
              setCurrentScreen('DEVICE_BLOCKED');
              return;
            }
            if (devAccess && devAccess.forceLogout) {
              setIsLoggedIn(false);
              setUserRole('');
              setUserDisplayName('');
              setPendingLoginInfo(null);
              setCurrentScreen('LOGIN');
              setForceReauthRequired(true);
              Alert.alert(
                'সেশন বাতিল',
                devAccess.message || 'Your session has been terminated by the administrator. Please log in again.'
              );
              return;
            }
            if (devAccess && devAccess.verificationRequired) {
              setIsLoggedIn(false);
              setCurrentScreen('OFFLINE_VERIFICATION');
              return;
            }
          } catch (resumeErr) {
            console.warn('[App] Error on foreground resume verification:', resumeErr.message);
          }
        }
      } else if (nextState === 'background' || nextState === 'inactive') {
        appWasBackgrounded = true;
        if (typeof stopPresence === 'function') {
          stopPresence();
          stopPresence = null;
        }
        try {
          const { checkAndFlushLastSeen } = require('./services/deviceRegistry');
          checkAndFlushLastSeen();
        } catch (_) {}
      }
    });

    return () => {
      if (typeof stopPresence === 'function') {
        stopPresence();
      }
      if (appStateSub) {
        appStateSub.remove();
      }
    };
  }, [userRole, userDisplayName, isLoggedIn]);

  // --- FOREGROUND APP USAGE TRACKING (Day-wise Business Day Telemetry) ---
  // Tracks active foreground usage only when authenticated (counts zero in background or on login screen)
  useEffect(() => {
    let appStateSub = null;
    try {
      const { startAppUsageTracker, stopAppUsageTracker, handleUsageAppStateChange } = require('./services/appUsageTracker.js');
      const { getCurrentDeviceRecord } = require('./services/deviceRegistry');
      const deviceRecord = getCurrentDeviceRecord();
      const deviceId = deviceRecord?.device_id;

      if (isLoggedIn && userRole && deviceId) {
        startAppUsageTracker({
          deviceId,
          userRole,
          appProfile: ACTIVE_APP_PROFILE,
          isLoggedIn
        });

        appStateSub = AppState.addEventListener('change', (nextState) => {
          handleUsageAppStateChange(nextState);
        });
      } else {
        stopAppUsageTracker();
      }
    } catch (err) {
      console.warn('[App] Usage tracker hook warning:', err.message);
    }

    return () => {
      try {
        const { stopAppUsageTracker } = require('./services/appUsageTracker.js');
        stopAppUsageTracker();
      } catch (e) {}
      if (appStateSub) {
        appStateSub.remove();
      }
    };
  }, [isLoggedIn, userRole]);

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
        const { checkAndFlushLastSeen } = require('./services/deviceRegistry');
        incrementForegroundRecoveryCount();
        await runPullPreferSupabase('foreground-tables-pull', 'syncSupabaseTables', syncTablesOnly, refreshData);
        await runPullPreferSupabase('foreground-high-frequency-pull', 'syncSupabaseHighFrequencyCollections', syncHighFrequencyCollections, refreshData);
        await runPullPreferSupabase('foreground-low-frequency-pull', 'syncSupabaseLowFrequencyCollections', syncLowFrequencyCollections, refreshData);
        checkAndFlushLastSeen();
      }
      previousState = nextState;
    });

    return () => {
      subscription.remove();
      markSyncTimerInactive('foreground-recovery-pull');
    };
  }, [isLoggedIn]);

  // --- FORCE LOGOUT POLLING (every 60s + on app resume) ---
  // Checks if admin has remotely logged out this device
  useEffect(() => {
    if (!isLoggedIn) return;

    const executeForceLogoutCheck = async () => {
      try {
        const { checkAndExecuteForceLogout } = require('./services/deviceRegistry');
        const result = await checkAndExecuteForceLogout();
        if (result && result.triggered) {
          isLoggedInRef.current = false;
          setIsLoggedIn(false);
          setUserRole('');
          setUserDisplayName('');
          setPendingLoginInfo(null);
          setCurrentScreen('LOGIN');
          setForceReauthRequired(true);
          Alert.alert(
            'সেশন বাতিল',
            result.message || 'প্রশাসক আপনার সেশন বন্ধ করেছেন। অনুগ্রহ করে পুনরায় ইউজারনেম ও PIN দিয়ে লগইন করুন।'
          );
        }
      } catch (e) {
        console.error('[ForceLogout Polling] Error:', e);
      }
    };

    // Poll every 60 seconds
    const pollInterval = setInterval(executeForceLogoutCheck, 60000);

    // Also check on every app foreground resume
    const appStateSubscription = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active') {
        await executeForceLogoutCheck();
      }
    });

    return () => {
      clearInterval(pollInterval);
      appStateSubscription.remove();
    };
  }, [isLoggedIn]);

  // --- NETWORK RECOVERY & DEVICE HARDWARE / APP VERSION SYNC ---
  // Instantly syncs device hardware & app version to Supabase (overwriting SQLite if different),
  // catches force logout issued while offline, processes queue, and pulls delta sync when internet returns
  useEffect(() => {
    let wasOffline = !isOnline;
    
    const unsubscribe = NetInfo.addEventListener(async state => {
      // isInternetReachable can be null initially, we treat explicitly false as offline
      const isOnlineState = state.isConnected && state.isInternetReachable !== false;
      setIsOnline(isOnlineState);
      
      const { setSystemOnline } = require('./database');
      setSystemOnline(isOnlineState);

      // Latch offline unless connectivity AND internet reachability are BOTH confirmed true.
      // isInternetReachable is often null while WiFi/cellular is "connected" but the internet is
      // unreachable; the old check treated null as online, so wasOffline stayed false and the
      // recovery (force-logout) branch below never ran when the connection actually returned.
      if (state.isConnected !== true || state.isInternetReachable !== true) {
        wasOffline = true;
        return;
      }

      if (wasOffline) {
        wasOffline = false; // Reset to prevent duplicate recovery loops
        console.log("[Network Recovery] Internet RECONNECTED. Starting device and data recovery...");

        try {
          const { syncDeviceHardwareAndVersion, checkAndExecuteForceLogout } = require('./services/deviceRegistry');

          // 1. Authoritative force-logout check FIRST — ensures a slow/failed hardware sync
          //    cannot skip the check when connectivity returns.
          const forceRes = await checkAndExecuteForceLogout();
          if (forceRes && forceRes.triggered) {
            console.log("[Network Recovery] Force logout detected upon reconnecting! Triggering full logout...");
            isLoggedInRef.current = false;
            setIsLoggedIn(false);
            setUserRole('');
            setUserDisplayName('');
            setPendingLoginInfo(null);
            setCurrentScreen('LOGIN');
            setForceReauthRequired(true);
            Alert.alert(
              'সেশন বাতিল',
              forceRes.message || 'প্রশাসক আপনার সেশন বন্ধ করেছেন। অনুগ্রহ করে পুনরায় ইউজারনেম ও PIN দিয়ে লগইন করুন।'
            );
            return;
          }

          // 2. Hardware & App Version check & push to Supabase (overwrites SQLite if different)
          await syncDeviceHardwareAndVersion();
        } catch (devRecoveryErr) {
          console.warn("[Network Recovery] Device check warning on reconnect:", devRecoveryErr.message);
        }

        // 3. Only run database delta pulls and upload queue if user is logged in
        if (isLoggedInRef.current) {
          try {
            console.log("[Network Recovery] 1/4: Processing pending upload queue...");
            const { incrementNetInfoRecoveryCount } = require('./database');
            incrementNetInfoRecoveryCount();
            const uploadResult = await processSyncQueue();
            console.log(`[Network Recovery] Upload finished. Writes: ${uploadResult.successfulWrites}, Failed: ${uploadResult.failedWrites}`);

            // 2. High Frequency Pull (Orders, Order Items, Payments, Deliveries)
            console.log("[Network Recovery] 2/4: Running High Frequency pull sync...");
            await runPullPreferSupabase('recovery-high-frequency-pull', 'syncSupabaseHighFrequencyCollections', syncHighFrequencyCollections, refreshData);

            // 3. Low Frequency Pull (Expenses, Ijara, Users, Summaries)
            console.log("[Network Recovery] 3/4: Running Low Frequency pull sync...");
            await runPullPreferSupabase('recovery-low-frequency-pull', 'syncSupabaseLowFrequencyCollections', syncLowFrequencyCollections, refreshData);

            // 4. Tables & Deletions
            console.log("[Network Recovery] 4/4: Running Tables and Deletions sync...");
            await runPullPreferSupabase('recovery-tables-pull', 'syncSupabaseTables', syncTablesOnly, refreshData);
            await runPullPreferSupabase('recovery-deletions-pull', 'syncSupabaseDeletions', syncDeletionsOnly, refreshData);

            console.log("[Network Recovery] Instant recovery cycle COMPLETED successfully.");
            refreshData();
          } catch (err) {
            console.error("[Network Recovery] Critical error during instant recovery:", err.message);
          }
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // Pull low-frequency collections when the menu management screens are opened
  useEffect(() => {
    if (!isLoggedIn) return;

    if (currentScreen === 'EDIT_MENU' || currentScreen === 'ADD_ITEM') {
       console.log("[Screen Sync] Menu screen opened. Syncing low frequency collections...");
       runPullPreferSupabase('menu-screen-low-frequency-pull', 'syncSupabaseLowFrequencyCollections', syncLowFrequencyCollections, refreshData)
         .catch(e => console.log("[Screen Sync] Offline, skipped low frequency pull:", e.message));
    }
  }, [currentScreen, isLoggedIn]);

  // Handle Toast for Background Sync Success (ADMIN app only)
  useEffect(() => {
    if (!isLoggedIn) return;
    if (String(ACTIVE_APP_PROFILE).toUpperCase() !== 'ADMIN') return;
    
    let lastUnsyncedCount = 0;
    const syncToastCheck = setInterval(() => {
      try {
        const count = getPendingSyncCount();
        
        if (lastUnsyncedCount > 0 && count === 0) {
           showToast(`☁️ ${lastUnsyncedCount} টি ডাটা সিঙ্ক হয়েছে`, 'sync');
        }
        lastUnsyncedCount = count;
      } catch (e) {}
    }, 3000);

    return () => clearInterval(syncToastCheck);
  }, [isLoggedIn]);

  // Report every cloud PULL as a toast for ALL apps (source = backend actually read).
  useEffect(() => {
    if (!isLoggedIn) return;
    const { setPullListener, clearPullListener } = require('./services/supabaseSync.js');
    pullReportSink = (source, hasChanges) => notifyPull(source, hasChanges);
    setPullListener((e) => reportPull(e && e.source, e && e.hasChanges));
    return () => { clearPullListener(); pullReportSink = null; };
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

  const checkMissingPreviousSubmit = () => {
    try {
      const today = getBusinessDate();
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const yesterday = `${y}-${m}-${day}`;

      // 4c: If this install only holds today's data (today-only restore), skip the check entirely.
      try {
        const { getAppConfig } = require('./database');
        if (getAppConfig('initial_restore_done_v1') === 'true') {
          const olderCount =
            (executeInspectorQuery("SELECT COUNT(*) as c FROM orders WHERE date(created_at, 'localtime') < ?", [today])[0]?.c || 0) +
            (executeInspectorQuery("SELECT COUNT(*) as c FROM payments WHERE date(created_at, 'localtime') < ?", [today])[0]?.c || 0) +
            (executeInspectorQuery("SELECT COUNT(*) as c FROM expenses WHERE date(created_at, 'localtime') < ?", [today])[0]?.c || 0) +
            (executeInspectorQuery("SELECT COUNT(*) as c FROM deliveries WHERE date(created_at, 'localtime') < ? OR date(completed_at, 'localtime') < ?", [today, today])[0]?.c || 0);
          if (olderCount === 0) {
            return false;
          }
        }
      } catch (guardErr) {
        console.warn('[checkMissingPreviousSubmit] Guard check failed:', guardErr.message);
      }
      
      // 1. Check if yesterday exists in daily_submit
      const history = getSubmissionHistory();
      const exists = history.some(h => h.date === yesterday);
      if (exists) {
        return false;
      }

      // 2. Check yesterday's activity (orders, payments, expenses, deliveries)
      const ordersCount = executeInspectorQuery("SELECT COUNT(*) as c FROM orders WHERE date(created_at, 'localtime') = ?", [yesterday])[0]?.c || 0;
      const paymentsCount = executeInspectorQuery("SELECT COUNT(*) as c FROM payments WHERE date(created_at, 'localtime') = ?", [yesterday])[0]?.c || 0;
      const expensesCount = executeInspectorQuery("SELECT COUNT(*) as c FROM expenses WHERE date(created_at, 'localtime') = ?", [yesterday])[0]?.c || 0;
      const deliveriesCount = executeInspectorQuery("SELECT COUNT(*) as c FROM deliveries WHERE date(created_at, 'localtime') = ? OR date(completed_at, 'localtime') = ?", [yesterday, yesterday])[0]?.c || 0;

      const totalActivity = ordersCount + paymentsCount + expensesCount + deliveriesCount;
      if (totalActivity === 0) {
        // Yesterday has zero business activity - do not block
        return false;
      }

      // Calculate submission summary for the modal
      const orders = executeInspectorQuery("SELECT * FROM orders WHERE date(created_at, 'localtime') = ?", [yesterday]);
      let cash_payment = 0, bkash_payment = 0, nagad_payment = 0, rocket_payment = 0;
      let delivery_sell = 0, delivery_charge = 0;
      let total_sell = 0;

      orders.forEach(o => {
        cash_payment += o.cash_amount || 0;
        bkash_payment += o.bkash_amount || 0;
        nagad_payment += o.nagad_amount || 0;
        rocket_payment += o.rocket_amount || 0;
        
        const sub = o.subtotal !== null && o.subtotal !== undefined ? o.subtotal : o.grand_total;
        
        if (String(o.table_id).toLowerCase().includes('delivery')) {
          delivery_sell += sub;
        }
        delivery_charge += o.delivery_charge || 0;
        total_sell += sub;
      });

      // Query expenses for yesterday
      const expenses = executeInspectorQuery("SELECT * FROM expenses WHERE date(created_at, 'localtime') = ?", [yesterday]);
      let dudu = 0, akash = 0, burger = 0, bazar = 0, others = 0, ijara = 0;
      expenses.forEach(e => {
        const amt = e.amount || 0;
        if (e.category === 'দুদু স্টোর') dudu = amt;
        else if (e.category === 'আকাশ মুরগী') akash = amt;
        else if (e.category === 'বার্গার বান') burger = amt;
        else if (e.category === 'বাজার') bazar = amt;
        else if (e.category === 'অন্যান্য') others = amt;
        else if (e.category === 'ijara') ijara = amt;
      });

      const total_expense = dudu + akash + burger + bazar + others;
      const net_cash = cash_payment + ijara - total_expense;

      setMissingSubmitDate(yesterday);
      setMissingSubmitSummary({
        sell: total_sell,
        expense: total_expense,
        net_cash: net_cash,
        notes: '',
        deposit: '', // editable
        breakdown: {
          cash: cash_payment,
          bkash: bkash_payment,
          nagad: nagad_payment,
          rocket: rocket_payment,
          delivery_sell,
          delivery_charge,
          ijara,
          dudu,
          akash,
          burger,
          bazar,
          others
        }
      });
      setShowMandatoryPreviousSubmitModal(true);
      return true;
    } catch (e) {
      console.error("checkMissingPreviousSubmit error:", e);
      return false;
    }
  };

  const handleLoginSuccess = async (role, displayName, mode = 'online_only') => {
    // Clear force reauth flag on any successful login
    setForceReauthRequired(false);
    try {
      const { setAppConfig } = require('./database');
      setAppConfig('force_reauth_required', '0');
    } catch (e) {}

    // --- MANDATORY VERSION CHECK ON LOGIN ---
    try {
      const { checkAppVersionPolicy } = require('./services/firebaseAppConfig');
      const verRes = await checkAppVersionPolicy(role);
      if (verRes && verRes.updateRequired) {
        setUpdatePolicy(verRes.policy);
        setIsLoggedIn(false);
        setCurrentScreen('APP_UPDATE_REQUIRED');
        return;
      }
    } catch (verErr) {
      console.warn("[App] Login version check error:", verErr);
    }

    // --- APP PROFILE LOGIN VALIDATION ---
    const userRoleNormalized = String(role || '').toUpperCase().trim();

    if (ACTIVE_APP_PROFILE === 'MANAGER' && userRoleNormalized !== 'MANAGER') {
      return;
    }

    if (ACTIVE_APP_PROFILE === 'OWNER' && userRoleNormalized !== 'OWNER') {
      return;
    }

    // --- DEVICE ACCESS CONTROL (AUTHORITATIVE VERIFICATION, post-login) ---
    try {
      const { verifyDeviceAccessOnStartupOrResume } = require('./services/deviceRegistry');
      const devAccess = await verifyDeviceAccessOnStartupOrResume(role);
      if (devAccess && devAccess.blocked) {
        setPendingDeviceId(devAccess.deviceId || '');
        setPendingLoginInfo({ role, displayName, mode, isAdminLock: Boolean(devAccess.isAdminLock) });
        setIsLoggedIn(false);
        setCurrentScreen('DEVICE_BLOCKED');
        return;
      }
      if (devAccess && devAccess.forceLogout) {
        setIsLoggedIn(false);
        setUserRole('');
        setUserDisplayName('');
        setPendingLoginInfo(null);
        setCurrentScreen('LOGIN');
        setForceReauthRequired(true);
        Alert.alert(
          'সেশন বাতিল',
          devAccess.message || 'Your session has been terminated by the administrator. Please log in again.'
        );
        return;
      }
      if (devAccess && devAccess.verificationRequired) {
        setIsLoggedIn(false);
        setCurrentScreen('OFFLINE_VERIFICATION');
        return;
      }
      if (devAccess && devAccess.status === 'PENDING' && ACTIVE_APP_PROFILE !== 'ADMIN') {
        setPendingDeviceId(devAccess.deviceId || '');
        setPendingLoginInfo({ role, displayName, mode, isAdminLock: false });
        setIsLoggedIn(false);
        setCurrentScreen('DEVICE_PENDING');
        return;
      }
    } catch (devErr) {
      console.error("[App] Device login permission check error:", devErr);
    }

    // --- INITIAL DATA DOWNLOAD (today only) — required before app access ---
    const initStatus = await ensureInitialData();
    if (initStatus === 'failed') {
      setPendingLoginInfo({ role, displayName, mode });
      setIsLoggedIn(false);
      setCurrentScreen('INITIAL_DATA_FAILED');
      return;
    }
    if (initStatus === 'running') {
      console.log('[App] ensureInitialData already running; not entering app yet.');
      return;
    }

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
      await runPullPreferSupabase('login-high-frequency-pull', 'syncSupabaseHighFrequencyCollections', syncHighFrequencyCollections, refreshData);
      
      // 3. Tables State
      await runPullPreferSupabase('login-tables-pull', 'syncSupabaseTables', syncTablesOnly, refreshData);
      
      // 4. Low Frequency (Expenses, Ijara, Users, Daily Submit)
      await runPullPreferSupabase('login-low-frequency-pull', 'syncSupabaseLowFrequencyCollections', syncLowFrequencyCollections, refreshData);

      // 5. Deletions
      await runPullPreferSupabase('login-deletions-pull', 'syncSupabaseDeletions', syncDeletionsOnly, refreshData);

      // 6. Final refresh to update UI with newly downloaded data
      refreshData();
      console.log("[Startup Sync] Initial delta sync completed successfully.");
    } catch (err) {
      console.log("[Startup Sync] Delta sync failed (possibly offline):", err.message);
    }

    // Run the previous day submission check
    checkMissingPreviousSubmit();
  };

  const handleLogout = () => {
    try {
      const { stopAppUsageTracker } = require('./services/appUsageTracker.js');
      stopAppUsageTracker();
    } catch (e) {}
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

  // Android Back Button Handler
  useEffect(() => {
    const backAction = () => {
      // If not logged in, show exit confirmation
      if (!isLoggedIn) {
        Alert.alert(
          'অ্যাপ বন্ধ করুন',
          'আপনি কি অ্যাপ থেকে বের হতে চান?',
          [
            { text: 'না', style: 'cancel' },
            { text: 'হ্যাঁ', onPress: () => BackHandler.exitApp() }
          ]
        );
        return true;
      }

      // If on a sub-screen, go back to dashboard
      const subScreens = [
        'TABLE_DETAIL', 'PAYMENT_SUCCESS', 'PAYMENT_CHECKOUT',
        'DAILY_SUBMIT', 'ADD_ITEM', 'EXPENSES', 'EDIT_MENU',
        'SUPPLIER_DUE', 'ITEM_SALES_REPORT', 'SYNC_DIAGNOSTICS',
        'DELETE_HISTORY', 'SYSTEM_TOOLS', 'DEVICE_MANAGEMENT',
        'ADMIN_ANALYTICS', 'OWNER_FINANCE_DASHBOARD', 'EMPLOYEE_LIST',
        'OWNER_EXPENSES', 'DATABASE_STATS', 'DATABASE_EXPLORER',
        'PRINTER_SETTINGS'
      ];

      if (subScreens.includes(currentScreen)) {
        setCurrentScreen('DASHBOARD');
        return true;
      }

      // If on DASHBOARD, show exit confirmation
      if (currentScreen === 'DASHBOARD') {
        Alert.alert(
          'অ্যাপ বন্ধ করুন',
          'আপনি কি অ্যাপ থেকে বের হতে চান?',
          [
            { text: 'না', style: 'cancel' },
            { text: 'হ্যাঁ', onPress: () => BackHandler.exitApp() }
          ]
        );
        return true;
      }

      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);

    return () => backHandler.remove();
  }, [isLoggedIn, currentScreen]);

  // Navigates to a table detail billing screen
  const handleTableSelect = (tableId) => {
    const roleNormalized = String(userRole || '').toLowerCase().trim();
    if (roleNormalized === 'admin') {
      const isDelivery = String(tableId || '').startsWith('D-');
      if (isDelivery) {
        const del = deliveries.find(d => d.id === tableId);
        if (!del || del.status !== 'BUSY') {
          Alert.alert("অ্যাডমিন এক্সেস", "অ্যাডমিন নতুন ডেলিভারি তৈরি করতে পারবেন না।");
          return;
        }
      } else {
        const tbl = tables.find(t => t.id === tableId || `table_${t.id}` === tableId || t.name === tableId);
        const isBusy = tbl && tbl.status === 'BUSY';
        const isDoneOrder = completedOrders.some(o => o.id === tableId);
        if (!isBusy && !isDoneOrder) {
          Alert.alert("অ্যাডমিন এক্সেস", "অ্যাডমিন শুধুমাত্র মনিটর ও ম্যানেজ করতে পারেন। নতুন অর্ডার তৈরি করার অনুমতি নেই।");
          return;
        }
      }
    }
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
    const roleNormalized = String(userRole || '').toLowerCase().trim();
    if (roleNormalized === 'admin') {
      Alert.alert("অ্যাডমিন এক্সেস", "অ্যাডমিন নতুন ডেলিভারি তৈরি করতে পারবেন না।");
      return;
    }
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

    logActivity({
      actionType: ACTION_TYPES.DELETE,
      actionTitle: 'অতীতের হিসাব ডিলিট',
      description: `${dateStr} তারিখের দৈনিক হিসাব মুছে ফেলা হয়েছে`,
      userRole: userRole,
      userName: userDisplayName
    }).catch(() => {});
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
       // Refresh menu from cloud (Supabase-first)
       refreshMenuFromCloud();
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
       // Refresh menu from cloud (Supabase-first)
       refreshMenuFromCloud();
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
               // Refresh menu from cloud (Supabase-first)
               refreshMenuFromCloud();
            }

            logActivity({
              actionType: ACTION_TYPES.DELETE,
              actionTitle: 'মেনু আইটেম ডিলিট',
              description: `মেনু আইটেম "${itemName}" মুছে ফেলা হয়েছে${category ? ' (' + category + ')' : ''}`,
              userRole: userRole,
              userName: userDisplayName
            }).catch(() => {});
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

  const handleDeliveryBillComplete = async (deliveryId, orderItems, delCharge = 0, changeMoney = 0) => {
    try {
      // Guard against duplicate execution
      const existing = getDeliveryById(deliveryId);
      if (existing && existing.status === 'COMPLETED') {
        console.warn(`[DeliveryBill] Delivery ${deliveryId} is already marked COMPLETED.`);
        return;
      }

      const activeDelivery = deliveries.find(d => d.id === deliveryId) || existing || { id: deliveryId };
      const baseStartTime = activeDelivery.startTime || (existing && existing.startTime) || new Date().toISOString();
      const cleanStartTime = baseStartTime.replace(/[:.]/g, '-');
      const orderId = `${deliveryId}_${cleanStartTime}`;

      const itemsSubtotal = (orderItems || []).reduce((sum, i) => sum + (i.price * i.qty), 0);
      const finalTotal = itemsSubtotal + delCharge + changeMoney;
      const nowIso = new Date().toISOString();
      const todayStr = getBusinessDate();
      const tableName = (existing && existing.customer_name) || activeDelivery.name || deliveryId;

      // 1. Update deliveries table in SQLite: status='COMPLETED', amount=finalTotal, delivery_charge=delCharge
      completeDelivery(deliveryId, finalTotal, delCharge, changeMoney);

      // 2. Format order record and record completed order in orders, payments, order_items
      const orderRecord = {
        id: orderId,
        tableId: tableName,
        items: (orderItems || []).map(i => `${i.name} x${i.qty} @${i.price}`).join(', '),
        totalAmount: itemsSubtotal,
        deliveryCharge: delCharge,
        changeMoneyGiven: changeMoney,
        cashAmount: finalTotal,
        bkashAmount: 0,
        nagadAmount: 0,
        rocketAmount: 0,
        paidAmount: finalTotal,
        grandTotal: finalTotal,
        method: 'বিল',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        paymentTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: todayStr,
        fullDate: todayStr,
        status: 'Done'
      };

      addCompletedOrder(orderRecord);
      setLastCompletedOrder(orderRecord);

      // 3. Recalculate daily summary
      calculateAndSaveDailySummary(todayStr);

      // 4. Refresh React states so active deliveries count decrements & daily summary updates
      refreshData();

      // 5. Cloud sync immediately
      syncRecordImmediately('orders', orderRecord.id).catch(() => {});
      syncRecordImmediately('deliveries', deliveryId).catch(() => {});
    } catch (err) {
      console.error("[DeliveryBill] Error completing delivery bill:", err);
    }
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
        paymentTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: new Date().toISOString().substring(0, 10),
        fullDate: new Date().toISOString().substring(0, 10),
        status: 'Done'
      };

      addCompletedOrder(orderRecord);
      setLastCompletedOrder(orderRecord);

      // Auto-print receipt if a verified printer is connected (silent, deduped).
      setAutoPrintOrder(orderRecord);

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
    setLastCompletedOrder(null);
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
    const isDelivery = tableId.toString().startsWith('D-');
    const delItem = isDelivery && Array.isArray(deliveries) ? deliveries.find(d => d.id === tableId) : null;
    const cleanNum = tableId.toString().replace(/^table_/i, '');
    const tableObj = !isDelivery && Array.isArray(tables) ? tables.find(t => String(t.id).replace(/^table_/i, '') === cleanNum) : null;
    const friendlyName = isDelivery
      ? (delItem?.name ? `ডেলিভারি (${delItem.name})` : 'ডেলিভারি অর্ডার')
      : (tableObj?.name || `টেবিল ${cleanNum}`);

    // Collect items before deletion
    let activeItems = [];
    let totalAmount = 0;
    if (isDelivery && delItem) {
      if (Array.isArray(delItem.items)) activeItems = delItem.items;
      totalAmount = activeItems.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 1), 0);
    } else if (tableObj) {
      if (Array.isArray(tableObj.items)) activeItems = tableObj.items;
      totalAmount = activeItems.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 1), 0);
    }

    // Map items to clean shape
    const parsedItems = activeItems.map(it => ({
      name: it.name || it.item_name || it.itemName || 'আইটেম',
      qty: it.quantity || it.qty || 1,
      price: it.price || it.unit_price || 0,
    }));

    const amountStr = totalAmount > 0 ? ` • মোট: ৳${totalAmount}` : '';
    const itemsStr = parsedItems.length > 0
      ? parsedItems.map(it => `${it.name} ×${it.qty}`).join(', ')
      : '';
    const fullDesc = itemsStr
      ? `${friendlyName} এর রানিং অর্ডার মুছে ফেলা হয়েছে${amountStr} | আইটেম: ${itemsStr}`
      : `${friendlyName} এর রানিং অর্ডার মুছে ফেলা হয়েছে${amountStr}`;

    Alert.alert(
      "অর্ডার ডিলিট",
      "আপনি কি নিশ্চিতভাবে এই সক্রিয় অর্ডারটি মুছে ফেলতে চান?",
      [
        { text: "না", style: "cancel" },
        {
          text: "হ্যাঁ",
          onPress: async () => {
            if (isDelivery) {
              removeDelivery(tableId);
              await syncRecordImmediately('deliveries', tableId);
            } else {
              updateTableState(tableId, [], 'FREE', '');
              const cleanId = tableId.toString().startsWith('table_') ? tableId : `table_${tableId}`;
              await syncRecordImmediately('restaurant_tables', cleanId);
            }
            refreshData();
            showToast("✅ ডাটা ডিলিট হয়েছে", 'online');

            logActivity({
              actionType: ACTION_TYPES.DELETE,
              actionTitle: 'রানিং অর্ডার ডিলিট',
              description: fullDesc,
              metadata: parsedItems.length > 0 ? {
                table: friendlyName,
                total: totalAmount,
                items: parsedItems,
                itemCount: parsedItems.length,
              } : undefined,
              userRole: userRole,
              userName: userDisplayName
            }).catch(() => {});
          }
        }
      ]
    );
  };

  // Deletes a completed order from history
  const handleDeleteDoneOrder = (orderId) => {
    if (['admin', 'owner'].includes(userRole)) {
      const targetOrder = Array.isArray(completedOrders) ? completedOrders.find(o => o.id === orderId) : null;
      let friendlyName = 'অর্ডার';
      let totalAmount = 0;
      let paymentMethod = '';
      let parsedItems = [];

      if (targetOrder) {
        const tId = targetOrder.table_id || targetOrder.tableId || '';
        if (tId.toString().startsWith('D-')) {
          friendlyName = 'ডেলিভারি অর্ডার';
        } else if (tId) {
          const cleanNum = tId.toString().replace(/^table_/i, '');
          friendlyName = `টেবিল ${cleanNum}`;
        } else if (orderId.startsWith('table_')) {
          const match = orderId.match(/^table_([a-zA-Z0-9]+)/);
          friendlyName = match ? `টেবিল ${match[1]}` : 'টেবিল অর্ডার';
        } else if (orderId.startsWith('D-')) {
          friendlyName = 'ডেলিভারি অর্ডার';
        }
        totalAmount = targetOrder.grand_total ?? targetOrder.grandTotal ?? targetOrder.totalAmount ?? 0;
        paymentMethod = targetOrder.method || targetOrder.payment_method || '';

        // Parse item list — stored as text: "বার্গার x1 @90, কোক x1 @40"
        if (targetOrder.items) {
          try {
            // Try JSON array first
            const raw = typeof targetOrder.items === 'string' ? JSON.parse(targetOrder.items) : targetOrder.items;
            if (Array.isArray(raw)) {
              parsedItems = raw.map(it => ({
                name: it.name || it.item_name || it.itemName || 'আইটেম',
                qty: it.quantity || it.qty || 1,
                price: it.price || it.unit_price || 0,
              }));
            }
          } catch (e) {
            // Fallback: parse text format "বার্গার x1 @90, কোক x2 @40"
            if (typeof targetOrder.items === 'string' && targetOrder.items.trim()) {
              parsedItems = targetOrder.items.split(',').map(part => {
                part = part.trim();
                const priceMatch = part.match(/@(\d+(\.\d+)?)$/);
                const qtyMatch = part.match(/x(\d+)/i);
                const price = priceMatch ? parseFloat(priceMatch[1]) : 0;
                const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
                const name = part.replace(/@\d+(\.\d+)?$/, '').replace(/x\d+/i, '').trim() || 'আইটেম';
                return { name, qty, price };
              }).filter(it => it.name && it.name !== 'আইটেম' || it.price > 0);
            }
          }
        }
      } else {
        if (orderId.startsWith('table_')) {
          const match = orderId.match(/^table_([a-zA-Z0-9]+)/);
          friendlyName = match ? `টেবিল ${match[1]}` : 'টেবিল অর্ডার';
        } else if (orderId.startsWith('D-')) {
          friendlyName = 'ডেলিভারি অর্ডার';
        }
      }

      // Build human-readable description
      const amountStr = totalAmount > 0 ? ` • মোট: ৳${totalAmount}` : '';
      const methodStr = paymentMethod ? ` • ${paymentMethod}` : '';
      const itemsStr = parsedItems.length > 0
        ? parsedItems.map(it => `${it.name} ×${it.qty}`).join(', ')
        : '';
      const fullDesc = itemsStr
        ? `${friendlyName} এর সম্পন্ন অর্ডার মুছে ফেলা হয়েছে${amountStr}${methodStr} | আইটেম: ${itemsStr}`
        : `${friendlyName} এর সম্পন্ন অর্ডার মুছে ফেলা হয়েছে${amountStr}${methodStr}`;

      Alert.alert(
        "অর্ডার ডিলিট করুন?",
        "এই অর্ডারটির পেমেন্ট সম্পন্ন হয়েছে। ডিলিট করলে এর সাথে সম্পর্কিত সকল রেকর্ড এবং রিপোর্ট আপডেট হয়ে যাবে।\n\nআপনি কি নিশ্চিতভাবে এই অর্ডারটি স্থায়ীভাবে মুছে ফেলতে চান?",
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
                showToast("✅ ডাটা ডিলিট হয়েছে", 'online');

                logActivity({
                  actionType: ACTION_TYPES.DELETE,
                  actionTitle: 'সম্পন্ন অর্ডার ডিলিট',
                  description: fullDesc,
                  metadata: parsedItems.length > 0 ? {
                    table: friendlyName,
                    total: totalAmount,
                    method: paymentMethod,
                    items: parsedItems,
                    itemCount: parsedItems.length,
                  } : undefined,
                  userRole: userRole,
                  userName: userDisplayName
                }).catch(() => {});
              }
            }
          }
        ]
      );
    } else {
      Alert.alert(
        "অর্ডার ডিলিট সীমাবদ্ধ",
        "এই কাজের জন্য আপনার পর্যাপ্ত অনুমতি নেই।",
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

    const totalExp = (parseFloat(expenses?.duduMiah) || 0) + 
                     (parseFloat(expenses?.akashChicken) || 0) + 
                     (parseFloat(expenses?.burgerBun) || 0) + 
                     (parseFloat(expenses?.bazar) || 0) + 
                     (parseFloat(expenses?.others) || 0);
    const items = [];
    if (parseFloat(expenses?.duduMiah) > 0) items.push(`দুধ ৳${expenses.duduMiah}`);
    if (parseFloat(expenses?.akashChicken) > 0) items.push(`মুরগি ৳${expenses.akashChicken}`);
    if (parseFloat(expenses?.burgerBun) > 0) items.push(`বান ৳${expenses.burgerBun}`);
    if (parseFloat(expenses?.bazar) > 0) items.push(`বাজার ৳${expenses.bazar}`);
    if (parseFloat(expenses?.others) > 0) items.push(`অন্যান্য ৳${expenses.others}`);
    if (parseFloat(expenses?.ijara) > 0) items.push(`ইজারা ৳${expenses.ijara}`);
    let desc = `মোট খরচ: ৳${totalExp}`;
    if (items.length > 0) {
      desc += ` (${items.join(', ')})`;
    }
    logActivity({
      actionType: ACTION_TYPES.EXPENSE,
      actionTitle: 'দৈনিক খরচ এডিট',
      description: desc,
      metadata: { totalExp, ...expenses },
      userRole: userRole,
      userName: userDisplayName
    }).catch(() => {});
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
              logActivity({
                actionType: ACTION_TYPES.SUBMISSION,
                actionTitle: 'ডেইলি লক রিসেট',
                description: 'আজকের দৈনিক সাবমিট লক মুছে ফেলা হয়েছে (পুনরায় সাবমিট করা যাবে)',
                userRole: userRole,
                userName: userDisplayName
              }).catch(() => {});
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
      "আপনি কি নিশ্চিতভাবে আজকের ইজারার হিসাব ডিলিট করতে চান? ইজা রিসেট করলে বাকিরা পুনরায় নতুন করে ইজা এন্ট্রি করতে পারবে।",
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
              logActivity({
                actionType: ACTION_TYPES.IJARA,
                actionTitle: 'ইজারা রিসেট',
                description: 'আজকের ইজারার হিসাব মুছে ফেলা হয়েছে',
                userRole: userRole,
                userName: userDisplayName
              }).catch(() => {});
              Alert.alert("সফল", "আজকের ইজারার হিসাব সফলভাবে ডিলিট করা হয়েছে!");
            } else {
              Alert.alert("ব্যর্থ", "ইজা ডিলিট করতে সমস্যা হয়েছে।");
            }
          }
        }
      ]
    );
  };

  // Rollback the last auto ijara application (Admin/Owner privilege)
  const handleRollbackAutoIjara = () => {
    const { getLastAutoIjaraDetails, rollbackAutoIjara } = require('./database');

    // Get last ijara details for confirmation
    const lastDetails = getLastAutoIjaraDetails();

    if (!lastDetails) {
      Alert.alert("তথ্য নেই", "কোনো অটো ইজা পাওয়া যায়নি।");
      return;
    }

    Alert.alert(
      "🔄 অটো ইজা রোলব্যাক",
      `সর্বশেষ অটো ইজা:\n${lastDetails.message}\n\nএই অপারেশনটি:\n• ইজা খরচ রেকর্ড মুছে ফেলবে\n• ইজা হিস্ট্রি মুছে ফেলবে\n• পেন্ডিং ইজা ক্লিয়ার করবে\n\nরোলব্যাক করতে চান?`,
      [
        { text: "বাতিল", style: "cancel" },
        {
          text: "রোলব্যাক করুন",
          style: "destructive",
          onPress: () => {
            const result = rollbackAutoIjara(lastDetails.date);
            if (result.success) {
              refreshData();
              logActivity({
                actionType: ACTION_TYPES.IJARA,
                actionTitle: 'অটো ইজা রোলব্যাক',
                description: `${lastDetails.date} তারিখের অটো ইজা রোলব্যাক করা হয়েছে`,
                userRole: userRole,
                userName: userDisplayName
              }).catch(() => {});
              Alert.alert("সফল", result.message);
            } else {
              Alert.alert("ব্যর্থ", result.message);
            }
          }
        }
      ]
    );
  };

  const handleSameDayResync = async () => {
    const { getSameDayResyncStatus, resyncSameDayFromCloud } = require('./database');
    const status = getSameDayResyncStatus();

    if (status.limitReached) {
      Alert.alert(
        "দৈনিক সীমা শেষ",
        "আজকের জন্য ক্লাউড রিসিন্ক সীমা (সর্বোচ্চ ২ বার) শেষ হয়ে গেছে। আবার আগামীকাল করতে পারবেন।"
      );
      return;
    }

    Alert.alert(
      "আজকের ডেটা রিসিন্ক (Same-Day Resync)",
      `এটি শুধুমাত্র আজকের দিনের স্থানীয় ডাটা মুছে ক্লাউড (Firebase) থেকে ফ্রেশ ডাটা পুনরায় ডাউনলোড করবে।\n\nআজকের অবশিষ্ট সুযোগ: ${status.remaining} বার।\n\nআপনি কি চালিয়ে যেতে চান?`,
      [
        { text: "বাতিল", style: "cancel" },
        {
          text: "রিসিন্ক করুন",
          onPress: async () => {
            showToast("🔄 আজকের ডেটা রিসিন্ক করা হচ্ছে...", "sync");
            try {
              const res = await resyncSameDayFromCloud();
              if (res.success) {
                refreshData();
                const srcLabel = res.source === 'supabase' ? 'Supabase' : 'Firebase';
                logActivity({
                  actionType: ACTION_TYPES.SYNC,
                  actionTitle: 'আজকের ডেটা রিসিন্ক',
                  description: `ক্লাউড (${srcLabel}) থেকে আজকের ডেটা পুনরায় সিন্ক করা হয়েছে${res.count != null ? ` (${res.count} টি রেকর্ড)` : ''} (অবশিষ্ট সুযোগ: ${res.remaining} বার)`,
                  metadata: { count: res.count, remaining: res.remaining, date: res.businessDate, source: res.source || 'firebase' },
                  userRole: userRole,
                  userName: userDisplayName
                }).catch(() => {});
                Alert.alert(
                  "সফল",
                  `Cloud (${srcLabel}) থেকে আজকের ডেটা সফলভাবে রিসিন্ক করা হয়েছে।${res.count != null ? `\nমোট রিস্টোর: ${res.count} টি রেকর্ড।` : ''}\nআজকের অবশিষ্ট সুযোগ: ${res.remaining} বার।`
                );
              } else {
                Alert.alert("ব্যর্থ", res.error || res.message || "ডাটা রিসিন্ক করতে সমস্যা হয়েছে। দয়া করে নেটওয়ার্ক কানেকশন চেক করুন।");
              }
            } catch (err) {
              console.error("[SameDay Resync] Error:", err);
              Alert.alert("ব্যর্থ", "একটি অপ্রত্যাশিত ত্রুটি ঘটেছে।");
            }
          }
        }
      ]
    );
  };

  const handleCloudRestore = async () => {
    Alert.alert(
      "Cloud Restore",
      "Cloud থেকে সম্পূর্ণ ডাটা পুনরায় ডাউনলোড করা হবে — মাস্টার টেবিল (সম্পূর্ণ) + গত ৩১ দিনের লেনদেন (mode: full)।\n\nচালিয়ে যেতে চান?",
      [
        { text: "বাতিল", style: "cancel" },
        {
          text: "Restore",
          onPress: async () => {
            showToast("🔄 রিস্টোর করা হচ্ছে...", "sync");
            try {
              const restoreResult = await restoreDatabaseFromCloud({ mode: 'full', supabaseFirst: true });
              if (restoreResult && restoreResult.success) {
                refreshData();
                Alert.alert("সফল", "Cloud থেকে ডাটা সফলভাবে রিস্টোর করা হয়েছে।");
              } else {
                const failedList = ((restoreResult && restoreResult.failedCollections) || []).join(', ');
                Alert.alert("ব্যর্থ", `ডাটা রিস্টোর করতে সমস্যা হয়েছে। দয়া করে নেটওয়ার্ক কানেকশন চেক করুন।${failedList ? `\n\nব্যর্থ Collection: ${failedList}` : ''}`);
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

  const ensureInitialData = async () => {
    if (ensureInitialDataLockRef.current) return 'running';
    ensureInitialDataLockRef.current = true;
    try {
      const { getAppConfig, setAppConfig } = require('./database');

      if (getAppConfig('initial_restore_done_v1') === 'true') {
        console.log('[ensureInitialData] Skipped: initial_restore_done_v1 already set.');
        return 'done';
      }

      // Only a genuine fresh install (marked at startup when local users were empty) gets an initial
      // restore. Existing installs — including app updates — must NOT re-download; delta sync covers them.
      if (getAppConfig('initial_restore_required') !== 'true') {
        setAppConfig('initial_restore_done_v1', 'true');
        console.log('[ensureInitialData] Existing install — no initial restore needed.');
        return 'done';
      }

      setAppConfig('restore_in_progress', new Date().toISOString());
      setIsRestoring(true);

      const { restoreHybridDatabaseFromCloud } = require('./services/supabaseSync.js');
      const result = await restoreHybridDatabaseFromCloud({ mode: 'today' });

      if (result && result.success) {
        setAppConfig('initial_restore_done_v1', 'true');
        setAppConfig('initial_restore_required', '');
        console.log('[ensureInitialData] Success. initial_restore_done_v1 set.');
        return 'done';
      }

      console.warn(`[ensureInitialData] Failed. Failed collections: ${((result && result.failedCollections) || []).join(', ') || 'unknown'}`);
      return 'failed';
    } catch (err) {
      console.error('[ensureInitialData] Error:', err);
      return 'failed';
    } finally {
      try { require('./database').setAppConfig('restore_in_progress', ''); } catch (e) {}
      setIsRestoring(false);
      ensureInitialDataLockRef.current = false;
    }
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
      Alert.alert("সফল", "দৈনিক ইতিহাস ডাউনলোডের সীমা রিসেট করা হয়েছে।");
    } else {
      Alert.alert("ত্রুটি", "সীমা রিসেট করতে ব্যর্থ হয়েছে।");
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
    const roleUpper = String(userRole || '').toUpperCase().trim();
    const isAuthenticatedAdmin = isLoggedIn && roleUpper === 'ADMIN';

    // Critical Server/Policy Gate Screens (enforced regardless of isLoggedIn)
    if (currentScreen === 'APP_UPDATE_REQUIRED') {
      if (!isAuthenticatedAdmin) {
        return (
          <AppUpdateRequiredScreen
            policy={updatePolicy}
            onUpdateSuccess={() => {
              setUpdatePolicy(null);
              checkAndInitialize();
            }}
          />
        );
      }
    }

    if (currentScreen === 'OFFLINE_VERIFICATION') {
      return (
        <OfflineVerificationScreen
          onRetry={async () => {
            await checkAndInitialize();
          }}
          onExit={() => BackHandler.exitApp()}
        />
      );
    }

    if (currentScreen === 'DEVICE_BLOCKED') {
      return (
        <DeviceBlockedScreen
          deviceId={pendingDeviceId}
          isAdminLock={pendingLoginInfo?.isAdminLock}
          onRecheck={async () => {
            const { verifyDeviceAccessOnStartupOrResume } = require('./services/deviceRegistry');
            const res = await verifyDeviceAccessOnStartupOrResume(userRole);
            if (res && res.allowed) {
              setPendingDeviceId('');
              setPendingLoginInfo(null);
              setCurrentScreen('LOGIN');
              Alert.alert('✅ অনুমোদিত', 'ডিভাইসটি সফলভাবে আনব্লক করা হয়েছে। এখন লগইন করতে পারেন।');
            } else {
              Alert.alert('❌ ব্লকড', 'ডিভাইসটি এখনো সার্ভার থেকে আনব্লক করা হয়নি।');
            }
          }}
          onExit={() => BackHandler.exitApp()}
        />
      );
    }

    if (currentScreen === 'INITIAL_DATA_FAILED') {
      return (
        <OfflineVerificationScreen
          onRetry={async () => {
            const info = pendingLoginInfoRef.current;
            if (info && info.role) {
              await handleLoginSuccess(info.role, info.displayName, info.mode);
            }
          }}
          onExit={() => BackHandler.exitApp()}
        />
      );
    }

    if (!isLoggedIn) {
      if (currentScreen === 'DEVICE_PENDING') {
        return (
          <DevicePendingScreen
            deviceId={pendingDeviceId}
            onApproved={async () => {
              if (pendingLoginInfo) {
                const { role, displayName, mode } = pendingLoginInfo;
                const initStatus = await ensureInitialData();
                if (initStatus === 'failed') {
                  setPendingLoginInfo({ role, displayName, mode });
                  setIsLoggedIn(false);
                  setCurrentScreen('INITIAL_DATA_FAILED');
                  return;
                }
                if (initStatus === 'running') {
                  console.log('[App] ensureInitialData already running; skipping pending-screen approval.');
                  return;
                }
                refreshData();
                handleLoginSuccess(role, displayName, mode);
              } else {
                const initStatus = await ensureInitialData();
                if (initStatus === 'failed') {
                  setCurrentScreen('LOGIN');
                  return;
                }
                if (initStatus === 'running') {
                  return;
                }
                setIsLoggedIn(true);
                setCurrentScreen('DASHBOARD');
              }
            }}
            onExit={() => {
              setIsLoggedIn(false);
              setPendingLoginInfo(null);
              setCurrentScreen('LOGIN');
            }}
          />
        );
      }

      return <LoginScreen onLoginSuccess={(role, name, mode) => handleLoginSuccess(role, name, mode)} forceReauth={forceReauthRequired} />;
    }

    const effectiveScreen = (currentScreen === 'APP_UPDATE_REQUIRED' && isAuthenticatedAdmin)
      ? 'DASHBOARD'
      : currentScreen;

    switch (effectiveScreen) {
      case 'DASHBOARD':
        if (ACTIVE_APP_PROFILE === 'ADMIN') {
          const roleNormalized = String(userRole || '').toLowerCase().trim();
          if (roleNormalized === 'admin') {
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
                onUpdateTableName={handleUpdateTableName}
                onNavigateToExpenses={() => setCurrentScreen('EXPENSES')}
                onNavigateToSubmit={(mandatory = false) => { setIsMandatorySubmit(mandatory); setCurrentScreen('DAILY_SUBMIT'); }}
                onNavigateToEditMenu={() => setCurrentScreen('EDIT_MENU')}
                onNavigateToSupplierDue={() => setCurrentScreen('SUPPLIER_DUE')}
                onNavigateToItemSalesReport={() => setCurrentScreen('ITEM_SALES_REPORT')}
                onNavigateToSyncDiagnostics={() => setCurrentScreen('SYNC_DIAGNOSTICS')}
                onNavigateToDeleteHistory={() => setCurrentScreen('DELETE_HISTORY')}
                onNavigateToSystemTools={() => setCurrentScreen('SYSTEM_TOOLS')}
                onNavigateToBackupRestore={() => setCurrentScreen('BACKUP_RESTORE')}
                onNavigateToDeviceManagement={() => setCurrentScreen('DEVICE_MANAGEMENT')}
                onNavigateToPrinterSettings={() => setCurrentScreen('PRINTER_SETTINGS')}
                onNavigateToBackupRestore={() => setCurrentScreen('BACKUP_RESTORE')}
                onNavigateToAIDatasetMonitor={() => setCurrentScreen('AI_DATASET_MONITOR')}
                onNavigateToAIDatasetAuditCenter={() => setCurrentScreen('AI_DATASET_AUDIT_CENTER')}
                onNavigateToAnalytics={() => setCurrentScreen('ADMIN_ANALYTICS')}
                onNavigateToEmployees={() => setCurrentScreen('EMPLOYEE_LIST')}
                onNavigateToActivityLog={() => setCurrentScreen('ACTIVITY_LOG')}
                onCloudRestore={handleCloudRestore}
                onSameDayResync={handleSameDayResync}
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
                onRollbackAutoIjara={handleRollbackAutoIjara}
              />
            );
          } else if (roleNormalized === 'owner') {
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
                onNavigateToSubmit={(mandatory = false) => { setIsMandatorySubmit(mandatory); setCurrentScreen('DAILY_SUBMIT'); }}
                onNavigateToEditMenu={() => setCurrentScreen('EDIT_MENU')}
                onNavigateToSupplierDue={() => setCurrentScreen('SUPPLIER_DUE')}
                onNavigateToItemSalesReport={() => setCurrentScreen('ITEM_SALES_REPORT')}
                onNavigateToAnalytics={() => setCurrentScreen('ADMIN_ANALYTICS')}
                onNavigateToActivityLog={() => setCurrentScreen('ACTIVITY_LOG')}
                onNavigateToPrinterSettings={() => setCurrentScreen('PRINTER_SETTINGS')}
                onNavigateToBackupRestore={() => setCurrentScreen('BACKUP_RESTORE')}
                onCloudRestore={handleCloudRestore}
                onSameDayResync={handleSameDayResync}

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
                onNavigateToOwnerFinance={() => setCurrentScreen('OWNER_FINANCE_DASHBOARD')}
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
                onNavigateToSubmit={(mandatory = false) => { setIsMandatorySubmit(mandatory); setCurrentScreen('DAILY_SUBMIT'); }}
                submissionHistory={submissionHistory}
                onSavePastAccount={handleSavePastAccount}
                onDeletePastAccount={handleDeletePastAccount}
                onUpdateTableName={handleUpdateTableName}
                onNavigateToExpenses={() => setCurrentScreen('EXPENSES')}
                onNavigateToSupplierDue={() => setCurrentScreen('SUPPLIER_DUE')}
                onNavigateToItemSalesReport={() => setCurrentScreen('ITEM_SALES_REPORT')}
                onNavigateToPrinterSettings={() => setCurrentScreen('PRINTER_SETTINGS')}
                onNavigateToBackupRestore={() => setCurrentScreen('BACKUP_RESTORE')}
                onCloudRestore={handleCloudRestore}
                onSameDayResync={handleSameDayResync}
                onMenuRecovery={handleMenuRecovery}

                dailyExpenses={dailyExpenses}
                onUpdateExpenses={handleUpdateExpenses}
                isDailySubmitted={isDailySubmitted}
                onDeleteActiveOrder={handleDeleteActiveOrder}
                onDeleteDoneOrder={handleDeleteDoneOrder}
                userRole={userRole}
              />
            );
          }
        } else if (ACTIVE_APP_PROFILE === 'OWNER') {
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
              onNavigateToSubmit={(mandatory = false) => { setIsMandatorySubmit(mandatory); setCurrentScreen('DAILY_SUBMIT'); }}
              onNavigateToEditMenu={() => setCurrentScreen('EDIT_MENU')}
              onNavigateToSupplierDue={() => setCurrentScreen('SUPPLIER_DUE')}
              onNavigateToItemSalesReport={() => setCurrentScreen('ITEM_SALES_REPORT')}
              onNavigateToAnalytics={() => setCurrentScreen('ADMIN_ANALYTICS')}
              onNavigateToActivityLog={() => setCurrentScreen('ACTIVITY_LOG')}
              onNavigateToPrinterSettings={() => setCurrentScreen('PRINTER_SETTINGS')}
                onNavigateToBackupRestore={() => setCurrentScreen('BACKUP_RESTORE')}
              onCloudRestore={handleCloudRestore}
              onSameDayResync={handleSameDayResync}

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
              onNavigateToOwnerFinance={() => setCurrentScreen('OWNER_FINANCE_DASHBOARD')}
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
              onNavigateToSubmit={(mandatory = false) => { setIsMandatorySubmit(mandatory); setCurrentScreen('DAILY_SUBMIT'); }}
              submissionHistory={submissionHistory}
              onSavePastAccount={handleSavePastAccount}
              onDeletePastAccount={handleDeletePastAccount}
              onUpdateTableName={handleUpdateTableName}
              onNavigateToExpenses={() => setCurrentScreen('EXPENSES')}
              onNavigateToSupplierDue={() => setCurrentScreen('SUPPLIER_DUE')}
              onNavigateToItemSalesReport={() => setCurrentScreen('ITEM_SALES_REPORT')}
              onNavigateToPrinterSettings={() => setCurrentScreen('PRINTER_SETTINGS')}
                onNavigateToBackupRestore={() => setCurrentScreen('BACKUP_RESTORE')}
              onCloudRestore={handleCloudRestore}
              onSameDayResync={handleSameDayResync}
              onMenuRecovery={handleMenuRecovery}

              dailyExpenses={dailyExpenses}
              onUpdateExpenses={handleUpdateExpenses}
              isDailySubmitted={isDailySubmitted}
              onDeleteActiveOrder={handleDeleteActiveOrder}
              onDeleteDoneOrder={handleDeleteDoneOrder}
              onResetIjara={handleResetIjara}
              onRollbackAutoIjara={handleRollbackAutoIjara}
              userRole={userRole}
            />
          );
        }

      case 'TABLE_DETAIL': {
        let activeTable = null;
        if (selectedTableId && selectedTableId.toString().startsWith('D-')) {
          const del = getDeliveryById(selectedTableId);
          if (del) {
            const parsedItems = typeof del.items === 'string' ? JSON.parse(del.items || '[]') : (del.items || []);
            const charge = parseFloat(del.delivery_charge) || 0;
            const changeMoney = parseFloat(del.change_money_given) || 0;
            const itemsSubtotal = parsedItems.reduce((sum, item) => sum + ((parseFloat(item.price) || 0) * (parseInt(item.qty, 10) || 1)), 0);
            const canonicalAmount = (del.amount !== null && del.amount !== undefined && !isNaN(del.amount) && Number(del.amount) > 0)
              ? parseFloat(del.amount)
              : (itemsSubtotal + charge);
            activeTable = {
              id: del.id,
              name: del.customer_name,
              status: del.status,
              items: parsedItems,
              startTime: del.startTime || '',
              deliveryCharge: charge,
              delivery_charge: charge,
              changeMoneyGiven: changeMoney,
              change_money_given: changeMoney,
              amount: canonicalAmount,
              totalAmount: canonicalAmount,
            };
          }
        }

        if (!activeTable) {
          const allActiveOrders = [...tables, ...deliveries];
          activeTable = allActiveOrders.find(t => t.id === selectedTableId);
        }

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
                const existing = getDeliveryById(selectedTableId);
                if (existing && existing.status !== 'COMPLETED') {
                  const parsed = JSON.parse(existing.items || '[]');
                  if (!parsed || parsed.length === 0) {
                    removeDelivery(selectedTableId);
                    await syncRecordImmediately('deliveries', selectedTableId);
                  }
                }
              }
              setCurrentScreen('DASHBOARD');
              refreshData();
            }}
            onUpdateTableItems={handleUpdateTableItems}
            onUpdateDeliveryDetails={handleUpdateDeliveryDetails}
            onPaymentDone={handleNavigateToCheckout}
            onNavigateToAddItem={() => setCurrentScreen('ADD_ITEM')}
            onDeliveryBillComplete={handleDeliveryBillComplete}
          />
        );
      }
      
      case 'ADD_ITEM': {
        let activeItemTable = null;
        if (selectedTableId && selectedTableId.toString().startsWith('D-')) {
          const del = getDeliveryById(selectedTableId);
          if (del) {
            const parsedItems = typeof del.items === 'string' ? JSON.parse(del.items || '[]') : (del.items || []);
            const charge = parseFloat(del.delivery_charge) || 0;
            const changeMoney = parseFloat(del.change_money_given) || 0;
            const itemsSubtotal = parsedItems.reduce((sum, item) => sum + ((parseFloat(item.price) || 0) * (parseInt(item.qty, 10) || 1)), 0);
            const canonicalAmount = (del.amount !== null && del.amount !== undefined && !isNaN(del.amount) && Number(del.amount) > 0)
              ? parseFloat(del.amount)
              : (itemsSubtotal + charge);
            activeItemTable = {
              id: del.id,
              name: del.customer_name,
              status: del.status,
              items: parsedItems,
              startTime: del.startTime || '',
              deliveryCharge: charge,
              delivery_charge: charge,
              changeMoneyGiven: changeMoney,
              change_money_given: changeMoney,
              amount: canonicalAmount,
              totalAmount: canonicalAmount,
            };
          }
        }
        if (!activeItemTable) {
          const allActiveItems = [...tables, ...deliveries];
          activeItemTable = allActiveItems.find(t => t.id === selectedTableId);
        }
        return (
          <AddItemScreen
            table={activeItemTable}
            menuItems={menuItems}
            userRole={userRole}
            userDisplayName={userDisplayName}
            onBack={() => setCurrentScreen('TABLE_DETAIL')}
            onUpdateTableItems={handleUpdateTableItems}
            onUpdateMenuPrice={handleUpdateMenuPrice}
          />
        );
      }

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
            items={checkoutTable ? checkoutTable.items : []}
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
           order={lastCompletedOrder}
           items={successTable ? successTable.items : []}
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
            isMandatory={isMandatorySubmit}
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

                logActivity({
                  actionType: ACTION_TYPES.SUBMISSION,
                  actionTitle: 'দৈনিক শিট সাবমিট',
                  description: `আজকের দৈনিক হিসাব সাবমিট সম্পন্ন (মোট বিক্রয়: ৳${summary?.totalSell || 0}, নিট জমা: ৳${summary?.netCashAfterExpenses || 0})`,
                  metadata: { totalSell: summary?.totalSell, totalExpenses: summary?.totalExpenses, netCash: summary?.netCashAfterExpenses },
                  userRole: userRole,
                  userName: userDisplayName
                }).catch(() => {});
                
                const todayStr = getBusinessDate();
                const success = await syncRecordImmediately('daily_submit', todayStr);
                showToast(success ? "✅ ডাটা সেভ হয়েছে" : "📱 অফলাইনে সেভ হয়েছে", success ? 'online' : 'offline');
              }
              setIsMandatorySubmit(false);
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

      case 'ADMIN_ANALYTICS':
        const analyticsRole = String(userRole || '').toLowerCase().trim();
        const isAuthorizedAdmin = ACTIVE_APP_PROFILE === 'ADMIN' && analyticsRole === 'admin';
        const isAuthorizedOwner = (ACTIVE_APP_PROFILE === 'OWNER' || ACTIVE_APP_PROFILE === 'ADMIN') && analyticsRole === 'owner';
        if (isAuthorizedAdmin || isAuthorizedOwner) {
          const AdminAnalyticsScreen = require('./screens/AdminAnalyticsScreen').default;
          return (
            <AdminAnalyticsScreen
              onBack={() => setCurrentScreen('DASHBOARD')}
            />
          );
        }
        return null;

      case 'SYNC_DIAGNOSTICS':
        if (ACTIVE_APP_PROFILE === 'ADMIN' && String(userRole || '').toLowerCase().trim() === 'admin') {
          return (
            <SyncDiagnosticsScreen
              onBack={() => setCurrentScreen('DASHBOARD')}
            />
          );
        } else {
          return null;
        }

      case 'DELETE_HISTORY':
        if (ACTIVE_APP_PROFILE === 'ADMIN' && String(userRole || '').toLowerCase().trim() === 'admin') {
          return (
            <DeleteHistoryScreen
              onBack={() => setCurrentScreen('DASHBOARD')}
            />
          );
        } else {
          return null;
        }

      case 'AI_DATASET_MONITOR':
        if (ACTIVE_APP_PROFILE === 'ADMIN' && String(userRole || '').toLowerCase().trim() === 'admin') {
          const AIDatasetMonitorScreen = require('./screens/AIDatasetMonitorScreen').default;
          return (
            <AIDatasetMonitorScreen
              onBack={() => setCurrentScreen('DASHBOARD')}
            />
          );
        } else {
          return null;
        }

      case 'AI_DATASET_AUDIT_CENTER':
        if (ACTIVE_APP_PROFILE === 'ADMIN' && String(userRole || '').toLowerCase().trim() === 'admin') {
          const AIDatasetAuditCenterScreen = require('./screens/AIDatasetAuditCenterScreen').default;
          return (
            <AIDatasetAuditCenterScreen
              onBack={() => setCurrentScreen('DASHBOARD')}
            />
          );
        } else {
          return null;
        }

      case 'DEVICE_MANAGEMENT':
        // TODO: If OWNER is granted Device Control screen access in the future, enable full device fleet fetching and reconciliation for OWNER here.
        if (ACTIVE_APP_PROFILE === 'ADMIN' && String(userRole || '').toLowerCase().trim() === 'admin') {
          return (
            <DeviceManagementScreen
              onBack={() => setCurrentScreen('DASHBOARD')}
              userRole={userRole}
            />
          );
        } else {
          return null;
        }

      case 'BACKUP_RESTORE':
        return (
          <BackupRestoreScreen
            onBack={() => setCurrentScreen('DASHBOARD')}
            onRefreshAppState={refreshData}
          />
        );

      case 'SYSTEM_TOOLS':
        if (ACTIVE_APP_PROFILE === 'ADMIN' && String(userRole || '').toLowerCase().trim() === 'admin') {
          return (
            <SystemToolsScreen
              onBack={() => setCurrentScreen('DASHBOARD')}
              onNavigate={(screen) => setCurrentScreen(screen)}
            />
          );
        } else {
          return null;
        }

      case 'PRINTER_SETTINGS':
        return (
          <PrinterSettingsScreen
            onBack={() => setCurrentScreen('DASHBOARD')}
            userRole={userRole}
          />
        );

      case 'DB_HEALTH':
        if (ACTIVE_APP_PROFILE === 'ADMIN' && String(userRole || '').toLowerCase().trim() === 'admin') {
          return (
            <DatabaseHealthScreen
              onBack={() => setCurrentScreen('SYSTEM_TOOLS')}
            />
          );
        } else {
          return null;
        }

      case 'SYNC_STATUS':
        if (ACTIVE_APP_PROFILE === 'ADMIN' && String(userRole || '').toLowerCase().trim() === 'admin') {
          return (
            <SyncStatusScreen
              onBack={() => setCurrentScreen('SYSTEM_TOOLS')}
            />
          );
        } else {
          return null;
        }

      case 'DB_STATS':
        if (ACTIVE_APP_PROFILE === 'ADMIN' && String(userRole || '').toLowerCase().trim() === 'admin') {
          return (
            <DatabaseStatsScreen
              onBack={() => setCurrentScreen('SYSTEM_TOOLS')}
            />
          );
        } else {
          return null;
        }

      case 'SYSTEM_INFO':
        if (ACTIVE_APP_PROFILE === 'ADMIN' && String(userRole || '').toLowerCase().trim() === 'admin') {
          return (
            <SystemInfoScreen
              onBack={() => setCurrentScreen('SYSTEM_TOOLS')}
            />
          );
        } else {
          return null;
        }

      case 'DB_EXPLORER':
        if (ACTIVE_APP_PROFILE === 'ADMIN' && String(userRole || '').toLowerCase().trim() === 'admin') {
          return (
            <DatabaseExplorerScreen
              onBack={() => setCurrentScreen('SYSTEM_TOOLS')}
              onSelectTable={(table) => {
                setSelectedDBTable(table);
                setCurrentScreen('TABLE_VIEWER');
              }}
            />
          );
        } else {
          return null;
        }

      case 'TABLE_VIEWER':
        if (ACTIVE_APP_PROFILE === 'ADMIN' && String(userRole || '').toLowerCase().trim() === 'admin') {
          return (
            <TableViewerScreen
              tableName={selectedDBTable}
              onBack={() => setCurrentScreen('DB_EXPLORER')}
              onSelectRow={(row) => {
                setSelectedDBRow(row);
                setCurrentScreen('ROW_DETAIL');
              }}
            />
          );
        } else {
          return null;
        }

      case 'ROW_DETAIL':
        if (ACTIVE_APP_PROFILE === 'ADMIN' && String(userRole || '').toLowerCase().trim() === 'admin') {
          return (
            <RowDetailScreen
              rowData={selectedDBRow}
              onBack={() => setCurrentScreen('TABLE_VIEWER')}
            />
          );
        } else {
          return null;
        }

      case 'OWNER_FINANCE_DASHBOARD':
        return (
          <OwnerFinanceDashboard
            userRole={userRole}
            onBack={() => setCurrentScreen('DASHBOARD')}
            onNavigateToEmployees={() => setCurrentScreen('EMPLOYEE_LIST')}
            onNavigateToExpenses={() => setCurrentScreen('OWNER_EXPENSE')}
          />
        );

      case 'OWNER_EXPENSE':
        return (
          <OwnerExpenseScreen
            userRole={userRole}
            onBack={() => setCurrentScreen('OWNER_FINANCE_DASHBOARD')}
            refreshData={refreshData}
          />
        );

      case 'EMPLOYEE_LIST':
        return (
          <EmployeeListScreen
            userRole={userRole}
            onBack={() => setCurrentScreen(String(userRole || '').toLowerCase().trim() === 'admin' ? 'DASHBOARD' : 'OWNER_FINANCE_DASHBOARD')}
            onAddEmployee={() => {
              setSelectedEmployeeId(null);
              setCurrentScreen('ADD_EMPLOYEE');
            }}
            onSelectEmployee={(empId) => {
              setSelectedEmployeeId(empId);
              setCurrentScreen('EMPLOYEE_DETAIL');
            }}
            onEditEmployee={(empId) => {
              setSelectedEmployeeId(empId);
              setCurrentScreen('ADD_EMPLOYEE');
            }}
            refreshData={refreshData}
          />
        );

      case 'ADD_EMPLOYEE':
        return (
          <AddEmployeeScreen
            userRole={userRole}
            employeeId={selectedEmployeeId}
            onBack={() => {
              setSelectedEmployeeId(null);
              setCurrentScreen('EMPLOYEE_LIST');
            }}
            onSaveSuccess={() => {
              setSelectedEmployeeId(null);
              setCurrentScreen('EMPLOYEE_LIST');
              refreshData();
            }}
          />
        );

      case 'EMPLOYEE_DETAIL':
        return (
          <EmployeeDetailScreen
            userRole={userRole}
            employeeId={selectedEmployeeId}
            onBack={() => setCurrentScreen('EMPLOYEE_LIST')}
            onEditEmployee={() => setCurrentScreen('ADD_EMPLOYEE')}
            onDeleteSuccess={() => {
              setSelectedEmployeeId(null);
              setCurrentScreen('EMPLOYEE_LIST');
              refreshData();
            }}
            onAddPayment={() => setCurrentScreen('ADD_SALARY_PAYMENT')}
          />
        );

      case 'ADD_SALARY_PAYMENT':
        return (
          <AddSalaryPaymentScreen
            userRole={userRole}
            employeeId={selectedEmployeeId}
            onBack={() => setCurrentScreen('EMPLOYEE_DETAIL')}
            onSaveSuccess={() => {
              setCurrentScreen('EMPLOYEE_DETAIL');
              refreshData();
            }}
          />
        );

      case 'ACTIVITY_LOG':
        if (['admin', 'owner'].includes(String(userRole || '').toLowerCase().trim())) {
          return (
            <ActivityLogScreen
              onBack={() => setCurrentScreen('DASHBOARD')}
              userRole={userRole}
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

        {/* Silent auto-print host (only when a verified printer is connected) */}
        <AutoReceiptPrinter order={autoPrintOrder} onDone={() => setAutoPrintOrder(null)} />



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

        {/* MANDATORY PREVIOUS DAY SUBMIT WARNING OVERLAY */}
        <Modal
          visible={showMandatoryPreviousSubmitModal}
          transparent={true}
          animationType="fade"
          onRequestClose={() => {}}
        >
          <View style={styles.blockOverlay}>
            <View style={[styles.blockContent, { width: '95%', maxWidth: 480, padding: 20, borderColor: '#FFB703', borderRadius: 16 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ fontSize: 24, marginRight: 8 }}>🚨</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#FFB703', fontSize: 16, fontWeight: 'bold' }}>পূর্ববর্তী দিনের হিসাব বকেয়া!</Text>
                  <Text style={{ color: '#A1A1AA', fontSize: 12 }}>ব্যবসায়িক তারিখ: {missingSubmitDate ? formatDisplayDate(missingSubmitDate) : ''}</Text>
                </View>
              </View>

              <Text style={{ color: '#E4E4E7', fontSize: 12, marginBottom: 14, lineHeight: 18 }}>
                এই দিনের হিসাব সাবমিট না করা পর্যন্ত ড্যাশবোর্ড লক থাকবে। হিসাব পরীক্ষা করে এগিয়ে যান।
              </Text>

              {missingSubmitSummary && (
                <ScrollView style={{ width: '100%', maxHeight: 320, marginBottom: 16 }} showsVerticalScrollIndicator={false}>
                  <View style={{ backgroundColor: '#18181B', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#27272A', gap: 10 }}>
                    
                    {/* 1. Total Cash Card */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, borderBottomWidth: 1, borderColor: '#27272A' }}>
                      <Text style={{ color: '#A1A1AA', fontSize: 12, fontWeight: 'bold' }}>💰 মোট ক্যাশ (Total Cash):</Text>
                      <Text style={{ color: '#34D399', fontSize: 16, fontWeight: 'bold' }}>৳{Number(missingSubmitSummary.breakdown?.cash || 0).toLocaleString()}</Text>
                    </View>

                    {/* 2. Expense Breakdown (Editable Inputs) */}
                    <Text style={{ color: '#FFB703', fontSize: 12, fontWeight: 'bold', marginTop: 4 }}>📉 খরচ বিবরণী (Expense Breakdown):</Text>
                    
                    {/* Dudu Store */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: '#D4D4D8', fontSize: 11 }}>🛍️ দুদু মিয়া খরচ:</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#09090B', borderWidth: 1, borderColor: '#3F3F46', borderRadius: 6, paddingHorizontal: 8, height: 32, width: 110 }}>
                        <Text style={{ color: '#FFB703', fontSize: 11, fontWeight: 'bold', marginRight: 4 }}>৳</Text>
                        <TextInput
                          style={{ flex: 1, color: '#FFF', fontSize: 11, fontWeight: 'bold', padding: 0 }}
                          keyboardType="numeric"
                          value={String(missingSubmitSummary.breakdown?.dudu || 0)}
                          onChangeText={(text) => {
                            const val = parseFloat(text) || 0;
                            setMissingSubmitSummary(prev => {
                              const newDudu = val;
                              const newExp = newDudu + (prev.breakdown.akash||0) + (prev.breakdown.burger||0) + (prev.breakdown.bazar||0) + (prev.breakdown.others||0);
                              return {
                                ...prev,
                                expense: newExp,
                                breakdown: { ...prev.breakdown, dudu: newDudu }
                              };
                            });
                          }}
                        />
                      </View>
                    </View>

                    {/* Akash Chicken */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: '#D4D4D8', fontSize: 11 }}>🐔 আকাশ মুরগী খরচ:</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#09090B', borderWidth: 1, borderColor: '#3F3F46', borderRadius: 6, paddingHorizontal: 8, height: 32, width: 110 }}>
                        <Text style={{ color: '#FFB703', fontSize: 11, fontWeight: 'bold', marginRight: 4 }}>৳</Text>
                        <TextInput
                          style={{ flex: 1, color: '#FFF', fontSize: 11, fontWeight: 'bold', padding: 0 }}
                          keyboardType="numeric"
                          value={String(missingSubmitSummary.breakdown?.akash || 0)}
                          onChangeText={(text) => {
                            const val = parseFloat(text) || 0;
                            setMissingSubmitSummary(prev => {
                              const newAkash = val;
                              const newExp = (prev.breakdown.dudu||0) + newAkash + (prev.breakdown.burger||0) + (prev.breakdown.bazar||0) + (prev.breakdown.others||0);
                              return {
                                ...prev,
                                expense: newExp,
                                breakdown: { ...prev.breakdown, akash: newAkash }
                              };
                            });
                          }}
                        />
                      </View>
                    </View>

                    {/* Burger Bun */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: '#D4D4D8', fontSize: 11 }}>🍔 বার্গার বান খরচ:</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#09090B', borderWidth: 1, borderColor: '#3F3F46', borderRadius: 6, paddingHorizontal: 8, height: 32, width: 110 }}>
                        <Text style={{ color: '#FFB703', fontSize: 11, fontWeight: 'bold', marginRight: 4 }}>৳</Text>
                        <TextInput
                          style={{ flex: 1, color: '#FFF', fontSize: 11, fontWeight: 'bold', padding: 0 }}
                          keyboardType="numeric"
                          value={String(missingSubmitSummary.breakdown?.burger || 0)}
                          onChangeText={(text) => {
                            const val = parseFloat(text) || 0;
                            setMissingSubmitSummary(prev => {
                              const newBurger = val;
                              const newExp = (prev.breakdown.dudu||0) + (prev.breakdown.akash||0) + newBurger + (prev.breakdown.bazar||0) + (prev.breakdown.others||0);
                              return {
                                ...prev,
                                expense: newExp,
                                breakdown: { ...prev.breakdown, burger: newBurger }
                              };
                            });
                          }}
                        />
                      </View>
                    </View>

                    {/* Bazar */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: '#D4D4D8', fontSize: 11 }}>🛒 বাজার খরচ:</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#09090B', borderWidth: 1, borderColor: '#3F3F46', borderRadius: 6, paddingHorizontal: 8, height: 32, width: 110 }}>
                        <Text style={{ color: '#FFB703', fontSize: 11, fontWeight: 'bold', marginRight: 4 }}>৳</Text>
                        <TextInput
                          style={{ flex: 1, color: '#FFF', fontSize: 11, fontWeight: 'bold', padding: 0 }}
                          keyboardType="numeric"
                          value={String(missingSubmitSummary.breakdown?.bazar || 0)}
                          onChangeText={(text) => {
                            const val = parseFloat(text) || 0;
                            setMissingSubmitSummary(prev => {
                              const newBazar = val;
                              const newExp = (prev.breakdown.dudu||0) + (prev.breakdown.akash||0) + (prev.breakdown.burger||0) + newBazar + (prev.breakdown.others||0);
                              return {
                                ...prev,
                                expense: newExp,
                                breakdown: { ...prev.breakdown, bazar: newBazar }
                              };
                            });
                          }}
                        />
                      </View>
                    </View>

                    {/* Others */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: '#D4D4D8', fontSize: 11 }}>📦 অন্যান্য খরচ:</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#09090B', borderWidth: 1, borderColor: '#3F3F46', borderRadius: 6, paddingHorizontal: 8, height: 32, width: 110 }}>
                        <Text style={{ color: '#FFB703', fontSize: 11, fontWeight: 'bold', marginRight: 4 }}>৳</Text>
                        <TextInput
                          style={{ flex: 1, color: '#FFF', fontSize: 11, fontWeight: 'bold', padding: 0 }}
                          keyboardType="numeric"
                          value={String(missingSubmitSummary.breakdown?.others || 0)}
                          onChangeText={(text) => {
                            const val = parseFloat(text) || 0;
                            setMissingSubmitSummary(prev => {
                              const newOthers = val;
                              const newExp = (prev.breakdown.dudu||0) + (prev.breakdown.akash||0) + (prev.breakdown.burger||0) + (prev.breakdown.bazar||0) + newOthers;
                              return {
                                ...prev,
                                expense: newExp,
                                breakdown: { ...prev.breakdown, others: newOthers }
                              };
                            });
                          }}
                        />
                      </View>
                    </View>

                    {/* 3. Owner Deposit (Editable Input) */}
                    <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderColor: '#27272A' }}>
                      <Text style={{ color: '#A1A1AA', fontSize: 11, fontWeight: 'bold', marginBottom: 4 }}>🏦 মালিকের জমা (Owner Deposit):</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#09090B', borderWidth: 1, borderColor: '#3B82F6', borderRadius: 8, paddingHorizontal: 10, height: 38 }}>
                        <Text style={{ color: '#3B82F6', fontSize: 14, fontWeight: 'bold', marginRight: 6 }}>৳</Text>
                        <TextInput
                          style={{ flex: 1, color: '#FFF', fontSize: 14, fontWeight: 'bold', padding: 0 }}
                          keyboardType="numeric"
                          placeholder="0"
                          placeholderTextColor="#666"
                          value={String(missingSubmitSummary.deposit || '')}
                          onChangeText={(text) => {
                            setMissingSubmitSummary(prev => ({
                              ...prev,
                              deposit: text
                            }));
                          }}
                        />
                      </View>
                    </View>

                    {/* 4. Live Next Day Opening Ija (Read-Only Display) */}
                    <View style={{ backgroundColor: '#09090B', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: 'rgba(255, 183, 3, 0.25)', marginTop: 4 }}>
                      <Text style={{ color: '#FFB703', fontSize: 11, fontWeight: 'bold' }}>✨ পরবর্তী দিনের প্রারম্ভিক ইজা (Next Day Opening Ija):</Text>
                      <Text style={{ color: '#FFB703', fontSize: 20, fontWeight: '900', marginVertical: 2 }}>
                        ৳ {Math.max(0, (Number(missingSubmitSummary.breakdown?.cash || 0) + Number(missingSubmitSummary.breakdown?.ijara || 0) - (missingSubmitSummary.expense || 0)) - (parseFloat(missingSubmitSummary.deposit) || 0)).toLocaleString()}
                      </Text>
                    </View>

                  </View>
                </ScrollView>
              )}

              {/* Direct Submit Action Button */}
              <TouchableOpacity
                style={{ backgroundColor: '#D90429', width: '100%', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginTop: 4 }}
                onPress={async () => {
                  if (!missingSubmitSummary || missingSubmitSummary.deposit === undefined || missingSubmitSummary.deposit === '') {
                    Alert.alert("ত্রুটি", "মালিকের জমা টাকার পরিমাণ আবশ্যিক!");
                    return;
                  }
                  const enteredDeposit = parseFloat(missingSubmitSummary.deposit) || 0;
                  const maxAllowedDeposit = (missingSubmitSummary.breakdown?.cash || 0) + (missingSubmitSummary.breakdown?.ijara || 0);

                  if (enteredDeposit > maxAllowedDeposit) {
                    Alert.alert(
                      "ভুল জমা পরিমাণ",
                      `আপনি ইজা + ক্যাশ (৳${maxAllowedDeposit.toLocaleString()}) এর বেশি টাকা জমা দিতে পারবেন না।`
                    );
                    return;
                  }

                  const summary = {
                    bizDate: missingSubmitDate,
                    sell: missingSubmitSummary.sell,
                    expense: missingSubmitSummary.expense,
                    deposit: enteredDeposit,
                    net_cash: missingSubmitSummary.net_cash,
                    notes: missingSubmitSummary.notes || '',
                    breakdown: {
                      cash: missingSubmitSummary.breakdown?.cash || 0,
                      bkash: missingSubmitSummary.breakdown?.bkash || 0,
                      nagad: missingSubmitSummary.breakdown?.nagad || 0,
                      rocket: missingSubmitSummary.breakdown?.rocket || 0,
                      delivery_sell: missingSubmitSummary.breakdown?.delivery_sell || 0,
                      delivery_charge: missingSubmitSummary.breakdown?.delivery_charge || 0,
                      ijara: missingSubmitSummary.breakdown?.ijara || 0,
                      dudu: missingSubmitSummary.breakdown?.dudu || 0,
                      akash: missingSubmitSummary.breakdown?.akash || 0,
                      burger: missingSubmitSummary.breakdown?.burger || 0,
                      bazar: missingSubmitSummary.breakdown?.bazar || 0,
                      others: missingSubmitSummary.breakdown?.others || 0
                    }
                  };

                  const saved = submitDailySheet(summary, userDisplayName);
                  if (saved) {
                    refreshData();
                    const success = await syncRecordImmediately('daily_submit', missingSubmitDate);
                    showToast(success ? "✅ পূর্ববর্তী দিনের ডাটা সেভ হয়েছে" : "📱 অফলাইনে সেভ হয়েছে", success ? 'online' : 'offline');
                    setShowMandatoryPreviousSubmitModal(false);
                    setMissingSubmitDate(null);
                    setMissingSubmitSummary(null);
                    setCurrentScreen('DASHBOARD');
                    Alert.alert("সফল", "পূর্ববর্তী দিনের হিসাব সফলভাবে সাবমিট করা হয়েছে।");
                  } else {
                    Alert.alert("ত্রুটি", "পূর্ববর্তী দিনের হিসাব সাবমিট করা সম্ভব হয়নি।");
                  }
                }}
              >
                <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 14 }}>শিট সাবমিট করুন (Submit Daily Sheet) ✓</Text>
              </TouchableOpacity>
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
