import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  StatusBar as RNStatusBar,
  RefreshControl,
  Platform,
  KeyboardAvoidingView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getAllRegisteredDevices,
  getDeletedDevices,
  updateDeviceStatus,
  setAdminDeviceLock,
  triggerForceLogout,
  updateDeviceOfflinePermission,
  renameDevice,
  softDeleteDevice,
  restoreDevice,
  refreshDeviceRegistryFromSupabase,
  getCurrentDeviceRecord
} from '../services/deviceRegistry';
import { verifyPinCode, getBusinessDateOffset, formatDisplayDate } from '../database';
import {
  getDhakaBusinessDate,
  getAppLabelForRole,
  formatDurationBengali,
  getLocalAppUsageForDate,
  fetchRemoteAppUsageForDate,
  subscribeAppUsageRealtime
} from '../services/appUsageTracker.js';
import { formatDeviceActivityStatus } from '../services/supabaseDeviceControl.js';
import { APP_VERSION } from '../services/firebaseAppConfig';

// Helper to calculate time ago from a timestamp
function getTimeAgo(timestamp) {
  if (!timestamp) return 'অজানা';

  const now = new Date();
  const past = new Date(timestamp);
  const diffMs = now - past;

  if (diffMs < 0) return 'এইমাত্র';

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const remainingHours = hours % 24;
  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;

  if (days > 0) {
    return `${days} দিন ${remainingHours} ঘণ্টা ${remainingMinutes} মিনিট`;
  } else if (hours > 0) {
    return `${hours} ঘণ্টা ${remainingMinutes} মিনিট ${remainingSeconds} সেকেন্ড`;
  } else if (minutes > 0) {
    return `${minutes} মিনিট ${remainingSeconds} সেকেন্ড`;
  } else {
    return `${seconds} সেকেন্ড`;
  }
}

export default function DeviceManagementScreen({ onBack, userRole = 'ADMIN' }) {
  const [viewMode, setViewMode] = useState('ACTIVE'); // 'ACTIVE' or 'DELETED'
  const [devices, setDevices] = useState([]);
  const [deletedDevices, setDeletedDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const devicesRef = useRef([]);
  devicesRef.current = devices;
  const currentDeviceRecord = getCurrentDeviceRecord();
  const currentDeviceId = currentDeviceRecord?.device_id || null;

  // Context Menu State (Long Press)
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(null);

  // Rename Modal State
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameInput, setRenameInput] = useState('');
  const [renameError, setRenameError] = useState('');

  // Admin Lock Confirmation Modal State
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [targetLockDevice, setTargetLockDevice] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  // Custom Dark Theme Alert State (Replaces native white Alert.alert to match Admin UI)
  const [darkAlert, setDarkAlert] = useState(null);

  const Alert = {
    alert: (title, message, buttons) => {
      setDarkAlert({
        title: title || '',
        message: message || '',
        buttons: buttons && buttons.length > 0
          ? buttons
          : [{ text: 'ঠিক আছে', onPress: () => setDarkAlert(null) }]
      });
    }
  };

  // Live Supabase Presence State (Event-driven realtime tracking)
  const [livePresenceMap, setLivePresenceMap] = useState({});

  // Local 1-second UI timer for smooth live active duration display (Zero network writes)
  const [currentUiTime, setCurrentUiTime] = useState(Date.now());
  useEffect(() => {
    const uiTimer = setInterval(() => {
      setCurrentUiTime(Date.now());
    }, 1000);
    return () => clearInterval(uiTimer);
  }, []);

  const formatLiveActiveDuration = (activeSinceMs) => {
    if (!activeSinceMs) return '';
    const parsed = Number(activeSinceMs);
    if (isNaN(parsed) || parsed <= 0) return '';
    const totalSec = Math.max(0, Math.floor((currentUiTime - parsed) / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  };

  // Day-wise App Usage State (Asia/Dhaka 06:00 AM business day cutoff)
  const todayDhakaDate = getDhakaBusinessDate();
  const [selectedUsageDate, setSelectedUsageDate] = useState(todayDhakaDate);
  const [usageMap, setUsageMap] = useState({});
  const [loadingUsage, setLoadingUsage] = useState(false);

  const isAdmin = !userRole || String(userRole).toUpperCase().trim() === 'ADMIN';

  if (!isAdmin) {
    return null;
  }

  const loadUsageData = useCallback(async (targetDate) => {
    setLoadingUsage(true);
    try {
      const localData = getLocalAppUsageForDate(targetDate);
      if (localData) {
        setUsageMap(localData);
      }
      const remoteData = await fetchRemoteAppUsageForDate(targetDate);
      if (remoteData) {
        setUsageMap(remoteData);
      }
    } catch (err) {
      console.warn('[DeviceManagement] Error loading usage data:', err.message);
    } finally {
      setLoadingUsage(false);
    }
  }, []);

  const loadDevices = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else if (!devicesRef.current || devicesRef.current.length === 0) {
      setLoading(true);
    }
    try {
      if (viewMode === 'DELETED') {
        const delList = getDeletedDevices();
        setDeletedDevices(delList || []);
      } else {
        const list = getAllRegisteredDevices();
        setDevices(list || []);
      }

      // Sync all registered devices from Supabase into local SQLite (initial load path)
      try {
        const { fetchSupabaseDevices } = require('../services/supabaseDeviceControl.js');
        const { syncRemoteDeviceToLocal } = require('../services/deviceRegistry');
        const remoteDevices = await fetchSupabaseDevices();
        if (Array.isArray(remoteDevices) && remoteDevices.length > 0) {
          for (const rem of remoteDevices) {
            syncRemoteDeviceToLocal(rem);
          }
          if (viewMode === 'DELETED') {
            const updatedDel = getDeletedDevices();
            setDeletedDevices(updatedDel || []);
          } else {
            const updatedList = getAllRegisteredDevices();
            setDevices(updatedList || []);
          }
        }
      } catch (remoteErr) {
        // Silently keep local list on remote fetch failure
      }
    } catch (err) {
      console.error('[DeviceManagement] Error loading devices:', err);
      Alert.alert('ত্রুটি', 'ডিভাইস তালিকা লোড করতে ব্যর্থ হয়েছে');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [viewMode]);

  /**
   * onRefresh — triggered by the top-right Refresh button and pull-to-refresh.
   *
   * Uses the safe transactional path: Fetch Supabase → Validate → SQLite transaction
   * (DELETE old records + INSERT new records) → COMMIT → Refresh UI.
   * Previous cache is NEVER deleted before a successful validated fetch.
   */
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // ── Device Control cache: transactional safe replace ──────────────────
      const result = await refreshDeviceRegistryFromSupabase();

      if (result.success) {
        // Refresh UI from the freshly-committed SQLite records
        if (viewMode === 'DELETED') {
          setDeletedDevices(getDeletedDevices() || []);
        } else {
          setDevices(getAllRegisteredDevices() || []);
        }
        Alert.alert('সফল ✅', `${result.count}টি ডিভাইস রেকর্ড Supabase থেকে আপডেট হয়েছে।`);
      } else {
        // Cache is intact; alert the admin of the failure reason
        const reason = result.error || 'অজানা কারণ';
        Alert.alert(
          'রিফ্রেশ ব্যর্থ ⚠️',
          `ডিভাইস তালিকা আপডেট করা সম্ভব হয়নি — পূর্ববর্তী ডেটা সংরক্ষিত আছে।\n\nকারণ: ${reason}`
        );
      }
    } catch (err) {
      console.error('[DeviceManagement] Unexpected error during refresh:', err);
      Alert.alert('ত্রুটি', 'রিফ্রেশ করতে অপ্রত্যাশিত সমস্যা হয়েছে — পূর্ববর্তী ডেটা সংরক্ষিত আছে।');
    } finally {
      setRefreshing(false);
      // Also reload usage data for the selected date
      loadUsageData(selectedUsageDate);
    }
  }, [viewMode, selectedUsageDate, loadUsageData]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);


  // Load day-wise app usage and subscribe to Realtime updates for selected business date
  useEffect(() => {
    loadUsageData(selectedUsageDate);

    const unsubscribeUsage = subscribeAppUsageRealtime(selectedUsageDate, (updatedMap) => {
      if (updatedMap) {
        setUsageMap(updatedMap);
      }
    });

    return () => {
      if (typeof unsubscribeUsage === 'function') {
        unsubscribeUsage();
      }
    };
  }, [selectedUsageDate, loadUsageData]);

  // Connect to Supabase Realtime Presence & Database Changes
  useEffect(() => {
    let unsubscribe = null;
    try {
      const { subscribeAdminDeviceMonitor } = require('../services/supabaseDeviceControl.js');
      const { syncRemoteDeviceToLocal, getCurrentDeviceRecord } = require('../services/deviceRegistry');

      // ─── BUG-5 FIX: pass real Admin device ID so presence key is correct ─
      const adminRecord = getCurrentDeviceRecord();
      const adminDeviceId = adminRecord?.device_id || null;

      unsubscribe = subscribeAdminDeviceMonitor(
        (presenceMap) => {
          setLivePresenceMap(presenceMap || {});
        },
        (changePayload) => {
          if (changePayload && changePayload.new) {
            syncRemoteDeviceToLocal(changePayload.new);
            const updated = changePayload.new;
            const isDel = changePayload.eventType === 'DELETE' || Number(updated.is_deleted || 0) === 1;

            if (isDel) {
              setDevices(prev => (prev || []).filter(d => d.device_id !== updated.device_id));
              setDeletedDevices(prev => {
                const list = prev || [];
                const exists = list.some(d => d.device_id === updated.device_id);
                return exists ? list.map(d => d.device_id === updated.device_id ? { ...d, ...updated } : d) : [updated, ...list];
              });
            } else {
              setDevices(prev => {
                const list = prev || [];
                const exists = list.some(d => d.device_id === updated.device_id);
                if (exists) {
                  return list.map(d => d.device_id === updated.device_id ? { ...d, ...updated } : d);
                } else {
                  return [updated, ...list];
                }
              });
              setDeletedDevices(prev => (prev || []).filter(d => d.device_id !== updated.device_id));
            }
          }
        },
        adminDeviceId
      );
    } catch (e) {
      console.warn('[DeviceManagement] Supabase Realtime subscription error:', e.message);
    }

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  // FEATURE 1: Long Press Context Menu Trigger
  const handleLongPressDevice = (device) => {
    if (!isAdmin) return;
    setSelectedDevice(device);
    setContextMenuVisible(true);
  };

  // FEATURE 2: Open Rename Modal
  const handleInitiateRename = () => {
    setContextMenuVisible(false);
    if (!selectedDevice) return;
    setRenameInput(selectedDevice.device_name || selectedDevice.model || '');
    setRenameError('');
    setRenameModalVisible(true);
  };

  // FEATURE 2: Confirm Rename Execution
  const handleConfirmRename = () => {
    const cleanName = renameInput.trim();
    if (!cleanName) {
      setRenameError('ডিভাইসের নাম খালি রাখা যাবে না (Enter valid device name)');
      return;
    }
    if (!selectedDevice) return;

    const success = renameDevice(selectedDevice.device_id, cleanName, 'admin');
    setRenameModalVisible(false);
    setRenameInput('');
    setSelectedDevice(null);

    if (success) {
      Alert.alert('সফল', 'ডিভাইসের নাম পরিবর্তন করা হয়েছে।');
      loadDevices();
    } else {
      Alert.alert('ত্রুটি', 'নাম পরিবর্তন ব্যর্থ হয়েছে।');
    }
  };

  // FEATURE 3: Initiate Soft Delete with Confirmation
  const handleInitiateSoftDelete = () => {
    setContextMenuVisible(false);
    if (!selectedDevice) return;
    const device = selectedDevice;

    Alert.alert(
      '🗑️ ডিভাইস ডিলিট নিশ্চিতকরণ',
      `আপনি কি নিশ্চিত যে '${device.device_name || device.device_id}' ডিভাইসটি মুছে ফেলতে চান?\n\nএটি মুছে ফেললে ডিভাইসটি সাধারণ তালিকা থেকে সরিয়ে ফেলা হবে, তবে 'Deleted Devices' থেকে পুনরায় রিকভার করা যাবে।`,
      [
        { text: 'বাতিল', style: 'cancel' },
        {
          text: 'হ্যাঁ, মুছে ফেলুন',
          style: 'destructive',
          onPress: () => {
            const success = softDeleteDevice(device.device_id, 'admin');
            setSelectedDevice(null);
            if (success) {
              try {
                const { logActivity, ACTION_TYPES } = require('../services/activityLogger');
                logActivity({
                  actionType: ACTION_TYPES.DEVICE,
                  actionTitle: 'ডিভাইস অপসারণ (রিসাইকেল বিন)',
                  description: `${device.device_name || device.device_id}`,
                  metadata: { deviceId: device.device_id, deviceName: device.device_name },
                  userRole: userRole,
                  userName: 'Admin'
                });
              } catch (e) {}
              Alert.alert('সফল', 'ডিভাইসটি মুছে ফেলা হয়েছে এবং "Deleted Devices" তালিকায় রাখা হয়েছে।');
              loadDevices();
            } else {
              Alert.alert('ত্রুটি', 'ডিভাইস মোছা ব্যর্থ হয়েছে।');
            }
          }
        }
      ]
    );
  };

  // FEATURE 5: Confirm Device Restoration
  const handleRestoreDeviceAction = (device) => {
    Alert.alert(
      '🔄 ডিভাইস রিকভার নিশ্চিতকরণ',
      `আপনি কি '${device.device_name || device.device_id}' ডিভাইসটি পুনরায় পূর্ববর্তী অবস্থায় রিকভার করতে চান?`,
      [
        { text: 'বাতিল', style: 'cancel' },
        {
          text: 'রিকভার করুন',
          onPress: () => {
            const success = restoreDevice(device.device_id, 'admin');
            if (success) {
              try {
                const { logActivity, ACTION_TYPES } = require('../services/activityLogger');
                logActivity({
                  actionType: ACTION_TYPES.DEVICE,
                  actionTitle: 'ডিভাইস পুনরুদ্ধার',
                  description: `${device.device_name || device.device_id}`,
                  metadata: { deviceId: device.device_id, deviceName: device.device_name },
                  userRole: userRole,
                  userName: 'Admin'
                });
              } catch (e) {}
              Alert.alert('সফল', 'ডিভাইসটি সফলভাবে পূর্বের কনফিগারেশনে রিকভার করা হয়েছে।');
              loadDevices();
            } else {
              Alert.alert('ত্রুটি', 'ডিভাইস রিকভার ব্যর্থ হয়েছে।');
            }
          }
        }
      ]
    );
  };

  const handleStatusChange = (deviceId, deviceName, newStatus) => {
    const actionText = newStatus === 'ACTIVE' ? 'অনুমোদন' : newStatus === 'BLOCKED' ? 'ব্লক' : 'পুনরায় পেন্ডিং';
    
    Alert.alert(
      'ডিভাইস স্ট্যাটাস পরিবর্তন',
      `আপনি কি নিশ্চিত যে '${deviceName || deviceId}' ডিভাইসটি ${actionText} করতে চান?`,
      [
        { text: 'বাতিল', style: 'cancel' },
        {
          text: 'হ্যাঁ',
          style: newStatus === 'BLOCKED' ? 'destructive' : 'default',
          onPress: () => {
            const success = updateDeviceStatus(deviceId, newStatus, 'admin');
            if (success) {
              try {
                const { logActivity, ACTION_TYPES } = require('../services/activityLogger');
                logActivity({
                  actionType: ACTION_TYPES.DEVICE,
                  actionTitle: `ডিভাইস স্ট্যাটাস: ${actionText}`,
                  description: `${deviceName || deviceId} (${newStatus})`,
                  metadata: { deviceId, deviceName, newStatus },
                  userRole: userRole,
                  userName: 'Admin'
                });
              } catch (e) {}
              Alert.alert('সফল', `ডিভাইস স্ট্যাটাস '${newStatus}' এ পরিবর্তন করা হয়েছে।`);
              loadDevices();
            } else {
              Alert.alert('ত্রুটি', 'স্ট্যাটাস পরিবর্তন ব্যর্থ হয়েছে।');
            }
          }
        }
      ]
    );
  };

  // Phase 6: Handle Offline Permission Toggle (allow_offline)
  const handleToggleOfflinePermission = (device) => {
    const currentAllowed = Number(device.allow_offline || 0) === 1;
    const nextAllowed = !currentAllowed;
    const actionText = nextAllowed ? 'চালু (ON)' : 'বন্ধ (OFF)';

    Alert.alert(
      'অফলাইন পারমিশন পরিবর্তন',
      `আপনি কি '${device.device_name || device.device_id}' ডিভাইসটির জন্য Offline Mode ${actionText} করতে চান?`,
      [
        { text: 'বাতিল', style: 'cancel' },
        {
          text: 'হ্যাঁ',
          onPress: () => {
            const success = updateDeviceOfflinePermission(device.device_id, nextAllowed, 'admin');
            if (success) {
              try {
                const { logActivity, ACTION_TYPES } = require('../services/activityLogger');
                logActivity({
                  actionType: ACTION_TYPES.DEVICE,
                  actionTitle: `অফলাইন পারমিশন ${actionText}`,
                  description: `${device.device_name || device.device_id}`,
                  metadata: { deviceId: device.device_id, allowOffline: nextAllowed },
                  userRole: userRole,
                  userName: 'Admin'
                });
              } catch (e) {}
              Alert.alert('সফল', `ডিভাইসটির Offline Permission ${actionText} করা হয়েছে।`);
              loadDevices();
            } else {
              Alert.alert('ত্রুটি', 'Offline Permission পরিবর্তন ব্যর্থ হয়েছে।');
            }
          }
        }
      ]
    );
  };

  // Phase 4: Handle Admin Lock Warning Dialog
  const handleInitiateAdminLock = (device) => {
    Alert.alert(
      '⚠️ ডিভাইস অ্যাক্সেস ব্লক',
      `'${device.device_name || device.device_id}' ডিভাইসের সকল অ্যাক্সেস স্থায়ীভাবে ব্লক করতে চান?\n\nএটি চালু করলে:\n• Admin লগইন করতে পারবেন না\n• Owner লগইন করতে পারবেন না\n• Manager লগইন করতে পারবেন না\n\nশুধুমাত্র অন্য অনুমোদিত Admin ডিভাইস থেকে এই লক সরানো যাবে।\n\nচালিয়ে যেতে চান?`,
      [
        { text: 'বাতিল', style: 'cancel' },
        {
          text: 'চালিয়ে যান',
          style: 'destructive',
          onPress: () => {
            setTargetLockDevice(device);
            setPinInput('');
            setPinError('');
            setPinModalVisible(true);
          }
        }
      ]
    );
  };

  // Confirm PIN and execute Admin Lock
  const handleConfirmPinAndLock = async () => {
    if (!pinInput.trim()) {
      setPinError('PIN দিন');
      return;
    }

    const user = verifyPinCode(pinInput.trim());
    if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
      setPinError('ভুল PIN! শুধুমাত্র Admin/Owner PIN গ্রহণযোগ্য');
      return;
    }

    if (!targetLockDevice) return;

    const res = await setAdminDeviceLock(targetLockDevice.device_id, true, 'admin');
    setPinModalVisible(false);
    setPinInput('');
    const lockedDevice = targetLockDevice;
    setTargetLockDevice(null);

    if (res && res.success) {
      try {
        const { logActivity, ACTION_TYPES } = require('../services/activityLogger');
        logActivity({
          actionType: ACTION_TYPES.DEVICE,
          actionTitle: 'ডিভাইস অ্যাডমিন লক',
          description: `${lockedDevice.device_name || lockedDevice.device_id}`,
          metadata: { deviceId: lockedDevice.device_id },
          userRole: userRole,
          userName: 'Admin'
        });
      } catch (e) {}
      Alert.alert('✅ সফল', 'ডিভাইসটি সফলভাবে ব্লক করা হয়েছে (সার্ভার নিশ্চিত)।');
      loadDevices();
    } else {
      Alert.alert('❌ ত্রুটি', (res && res.error) || 'ডিভাইস ব্লক ব্যর্থ হয়েছে। নেটওয়ার্ক চেক করুন।');
    }
  };

  // Remove Admin Lock Action
  const handleRemoveAdminLock = (device) => {
    Alert.alert(
      '🔓 ডিভাইস আনব্লক',
      `আপনি কি নিশ্চিত যে '${device.device_name || device.device_id}' ডিভাইসটির ব্লক অপসারণ করতে চান?`,
      [
        { text: 'বাতিল', style: 'cancel' },
        {
          text: 'আনব্লক করুন',
          onPress: async () => {
            const res = await setAdminDeviceLock(device.device_id, false, 'admin');
            if (res && res.success) {
              try {
                const { logActivity, ACTION_TYPES } = require('../services/activityLogger');
                logActivity({
                  actionType: ACTION_TYPES.DEVICE,
                  actionTitle: 'ডিভাইস আনলক',
                  description: `${device.device_name || device.device_id}`,
                  metadata: { deviceId: device.device_id },
                  userRole: userRole,
                  userName: 'Admin'
                });
              } catch (e) {}
              Alert.alert('✅ সফল', 'ডিভাইসটি সফলভাবে আনব্লক করা হয়েছে (সার্ভার নিশ্চিত)।');
              loadDevices();
            } else {
              Alert.alert('❌ ত্রুটি', (res && res.error) || 'ডিভাইস আনব্লক ব্যর্থ হয়েছে।');
            }
          }
        }
      ]
    );
  };

  // Phase 5: Handle Remote Force Logout Action
  const handleForceLogoutPrompt = (device) => {
    Alert.alert(
      '🔄 রিমোট লগআউট',
      `'${device.device_name || device.device_id}' ডিভাইস থেকে রিমোটভাবে সাইন আউট করতে চান?\n\nবর্তমান ব্যবহারকারী সাথে সাথে অ্যাক্সেস হারাবেন।\n\nপরবর্তী লগইনের জন্য আবার ইউজারনেম ও PIN লাগবে।\n\nচালিয়ে যেতে চান?`,
      [
        { text: 'বাতিল', style: 'cancel' },
        {
          text: 'লগআউট করুন',
          style: 'destructive',
          onPress: async () => {
            const cmdT0 = Date.now();
            const res = await triggerForceLogout(device.device_id, 'admin');
            if (res && res.success) {
              console.log(`[ForceLogout] stage=admin_write deviceId=${device.device_id} commandId=${res.token || 'unknown'} elapsed=${Date.now()-cmdT0}ms`);
              try {
                const { logActivity, ACTION_TYPES } = require('../services/activityLogger');
                logActivity({
                  actionType: ACTION_TYPES.DEVICE,
                  actionTitle: 'ফোর্স লগআউট প্রেরিত',
                  description: `${device.device_name || device.device_id}`,
                  metadata: { deviceId: device.device_id, commandId: res.token },
                  userRole: userRole,
                  userName: 'Admin'
                });
              } catch (e) {}
              // Honest message: command was written to server — target device will log out
              // when it receives the Realtime signal or on its next periodic check (≤1 second).
              Alert.alert(
                '📡 লগআউট নির্দেশ প্রেরিত',
                `'${device.device_name || device.device_id}' ডিভাইসে লগআউট নির্দেশ সার্ভারে পাঠানো হয়েছে।\n\nডিভাইসটি অনলাইনে থাকলে কয়েক সেকেন্ডের মধ্যে লগআউট হবে।\n\nডিভাইসটি অফলাইনে থাকলে পরবর্তী সংযোগে লগআউট কার্যকর হবে।`
              );
              loadDevices();
            } else {
              Alert.alert('❌ ত্রুটি', (res && res.error) || 'রিমোট লগআউট সার্ভারে পাঠাতে ব্যর্থ হয়েছে।');
            }
          }
        }
      ]
    );
  };

  const renderStatusBadge = (status, adminLock, forceLogout) => {
    const st = String(status || 'PENDING').toUpperCase().trim();
    if (adminLock === 1) {
      return (
        <View style={[styles.badge, styles.badgeAdminLock]}>
          <Text style={styles.badgeTextAdminLock}>🔒 LOCKED</Text>
        </View>
      );
    }
    if (st === 'ACTIVE') {
      return (
        <View style={[styles.badge, styles.badgeActive]}>
          <Text style={styles.badgeTextActive}>
            {forceLogout === 1 ? '🔄 LOGOUT' : '● ACTIVE'}
          </Text>
        </View>
      );
    }
    if (st === 'BLOCKED') {
      return (
        <View style={[styles.badge, styles.badgeBlocked]}>
          <Text style={styles.badgeTextBlocked}>✖ BLOCKED</Text>
        </View>
      );
    }
    return (
      <View style={[styles.badge, styles.badgePending]}>
        <Text style={styles.badgeTextPending}>⏳ PENDING</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <RNStatusBar barStyle="light-content" backgroundColor="#0B0B0C" />

      {/* Redesigned Compact Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          onPress={onBack} 
          style={styles.headerIconBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.7}
        >
          <Text style={styles.headerIconText}>←</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleGroup}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {viewMode === 'ACTIVE' ? 'ডিভাইস কন্ট্রোল' : 'মুছে ফেলা ডিভাইস'}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {viewMode === 'ACTIVE' 
              ? `${devices.length}টি নিবন্ধিত ডিভাইস` 
              : `${deletedDevices.length}টি আর্কাইভ ডিভাইস`}
          </Text>
        </View>

        <View style={styles.headerRightGroup}>
          {isAdmin && (
            <TouchableOpacity
              onPress={() => setViewMode(prev => (prev === 'ACTIVE' ? 'DELETED' : 'ACTIVE'))}
              style={[styles.headerIconBtn, viewMode === 'DELETED' ? styles.headerIconBtnActive : null]}
              hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
              activeOpacity={0.7}
            >
              <Text style={styles.headerTabIcon}>
                {viewMode === 'ACTIVE' ? '🗑️' : '📱'}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity 
            onPress={onRefresh} 
            style={styles.headerIconBtn}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 10 }}
            activeOpacity={0.7}
          >
            <Text style={styles.headerRefreshIcon}>🔄</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scrollBody}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#FFB703']}
            tintColor="#FFB703"
          />
        }
      >
        {viewMode === 'ACTIVE' ? (
          <>
            {/* Quick Context Hint */}
            <View style={styles.hintBar}>
              <Text style={styles.hintBarText}>
                💡 ডিভাইসে লং প্রেস অথবা <Text style={styles.hintBold}>•••</Text> চেপে নাম পরিবর্তন ও ডিলিট অপশন পাবেন
              </Text>
            </View>

            {/* Responsive 3+2 Metrics Grid */}
            {!loading && devices.length > 0 && (
              <View style={styles.metricsContainer}>
                {/* Row 1: 3 Metrics */}
                <View style={styles.metricsRow}>
                  <View style={styles.metricCard}>
                    <Text style={styles.metricCount}>{devices.length}</Text>
                    <Text style={styles.metricLabel}>মোট</Text>
                  </View>
                  <View style={styles.metricCard}>
                    <Text style={[styles.metricCount, { color: '#10B981' }]}>
                      {devices.filter(d => String(d.status || '').toUpperCase() === 'ACTIVE').length}
                    </Text>
                    <Text style={styles.metricLabel}>অনুমোদিত</Text>
                  </View>
                  <View style={styles.metricCard}>
                    <Text style={[styles.metricCount, { color: '#F59E0B' }]}>
                      {devices.filter(d => String(d.status || '').toUpperCase() === 'PENDING').length}
                    </Text>
                    <Text style={styles.metricLabel}>অপেক্ষমাণ</Text>
                  </View>
                </View>

                {/* Row 2: 2 Metrics */}
                <View style={styles.metricsRow}>
                  <View style={styles.metricCard}>
                    <Text style={[styles.metricCount, { color: '#EF4444' }]}>
                      {devices.filter(d => String(d.status || '').toUpperCase() === 'BLOCKED').length}
                    </Text>
                    <Text style={styles.metricLabel}>ব্লকড</Text>
                  </View>
                  <View style={styles.metricCard}>
                    <Text style={[styles.metricCount, { color: '#059669' }]}>
                      🟢 {Object.values(livePresenceMap).filter(p => p.online).length}
                    </Text>
                    <Text style={styles.metricLabel}>লাইভ অ্যাক্টিভ</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Business Date Selector Bar */}
            <View style={styles.dateSelectorContainer}>
              <TouchableOpacity
                style={styles.dateNavBtn}
                onPress={() => setSelectedUsageDate(prev => getBusinessDateOffset(prev, -1))}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={0.7}
              >
                <Text style={styles.dateNavBtnIcon}>◀</Text>
                <Text style={styles.dateNavBtnLabel}>আগের দিন</Text>
              </TouchableOpacity>

              <View style={styles.dateCenterDisplay}>
                <Text style={styles.dateMainText}>{selectedUsageDate}</Text>
                <View style={styles.dateSubRow}>
                  {selectedUsageDate === todayDhakaDate ? (
                    <View style={styles.todayPill}>
                      <Text style={styles.todayPillDot}>●</Text>
                      <Text style={styles.todayPillText}>আজ</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.todayResetBtn}
                      onPress={() => setSelectedUsageDate(todayDhakaDate)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.todayResetBtnText}>আজকের দিন</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <TouchableOpacity
                style={styles.dateNavBtn}
                onPress={() => setSelectedUsageDate(prev => getBusinessDateOffset(prev, 1))}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={0.7}
              >
                <Text style={styles.dateNavBtnLabel}>পরের দিন</Text>
                <Text style={styles.dateNavBtnIcon}>▶</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeader}>নিবন্ধিত ডিভাইসের তালিকা</Text>
              <Text style={styles.sectionHeaderCount}>{devices.length} টি ডিভাইস</Text>
            </View>

            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color="#FFB703" />
                <Text style={styles.loadingText}>ডিভাইস তথ্য লোড হচ্ছে...</Text>
              </View>
            ) : devices.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>কোনো সক্রিয় ডিভাইস নিবন্ধিত পাওয়া যায়নি</Text>
              </View>
            ) : (
              devices.map((item) => {
                const st = String(item.status || 'PENDING').toUpperCase().trim();
                const isLocked = Number(item.admin_lock || 0) === 1;
                const forceLogoutPending = Number(item.force_logout || 0) === 1;
                const isOfflineAllowed = Number(item.allow_offline || 0) === 1;
                const isCurrentDevice = Boolean(currentDeviceId && item.device_id === currentDeviceId);
                let livePresence = livePresenceMap[item.device_id];
                if (isCurrentDevice && (!livePresence || !livePresence.online)) {
                  livePresence = {
                    device_id: item.device_id,
                    online: true,
                    active_since: livePresence?.active_since || currentUiTime,
                    user_role: userRole || 'ADMIN',
                    last_heartbeat: currentUiTime
                  };
                }
                const activityStatus = formatDeviceActivityStatus(livePresence, item.last_seen, currentUiTime);
                const isLiveNow = activityStatus.isOnline;
                const deviceUsage = usageMap[item.device_id];

                return (
                  <TouchableOpacity
                    key={item.id || item.device_id}
                    style={styles.deviceCard}
                    activeOpacity={0.95}
                    onLongPress={() => handleLongPressDevice(item)}
                    delayLongPress={500}
                  >
                    {/* Header: Icon, Name, ID, Badge, Menu */}
                    <View style={styles.cardHeader}>
                      <View style={styles.deviceIdentityGroup}>
                        <View style={styles.deviceIconBox}>
                          <Text style={styles.deviceIconText}>📱</Text>
                        </View>
                        <View style={styles.deviceNamesColumn}>
                          <Text style={styles.deviceName} numberOfLines={1}>
                            {item.device_name || item.model || 'Unknown Device'}
                            {isCurrentDevice ? ' (এই ডিভাইস)' : ''}
                          </Text>
                          <Text style={styles.deviceIdText} numberOfLines={1}>
                            {item.device_id}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.cardHeaderRight}>
                        {renderStatusBadge(st, isLocked, forceLogoutPending)}
                        {isAdmin && (
                          <TouchableOpacity
                            style={styles.moreOptionsBtn}
                            onPress={() => handleLongPressDevice(item)}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.moreOptionsText}>•••</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>

                    <View style={styles.hairlineDivider} />

                    {/* 2-Column Hardware Specs Grid */}
                    <View style={styles.specsGrid}>
                      <View style={styles.specsRow}>
                        <View style={styles.specsCol}>
                          <Text style={styles.specsLabel}>প্রস্তুতকারক (Brand)</Text>
                          <Text style={styles.specsValue} numberOfLines={1}>
                            {item.manufacturer || item.brand || 'Android'}
                          </Text>
                        </View>
                        <View style={styles.specsCol}>
                          <Text style={styles.specsLabel}>অ্যান্ড্রয়েড ভার্সন</Text>
                          <Text style={styles.specsValue} numberOfLines={1}>
                            {item.android_version ? `Android ${item.android_version}` : 'N/A'}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.specsRow}>
                        <View style={[styles.specsCol, styles.specsColVersion]}>
                          <Text style={styles.specsLabel}>অ্যাপ ভার্সন</Text>
                          <Text style={styles.specsValue} numberOfLines={1}>
                            v{item.app_version || APP_VERSION || '1.0.3'}
                          </Text>
                        </View>
                        <View style={[styles.specsCol, styles.specsColStatus]}>
                          <View style={styles.specsStatusHeader}>
                            <Text style={styles.specsLabel}>সর্বশেষ সক্রিয়</Text>
                            {isLiveNow && Boolean(activityStatus.subtext) && (
                              <View style={styles.specsLiveBadge}>
                                <Text style={styles.specsLiveBadgeText}>
                                  {activityStatus.subtext}
                                </Text>
                              </View>
                            )}
                          </View>
                          <Text 
                            style={[styles.specsValue, isLiveNow ? styles.specsLiveText : null]} 
                            numberOfLines={1}
                          >
                            {activityStatus.text}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Day-wise App Usage Summary (Clean Tabular Layout) */}
                    <View style={styles.usageContainer}>
                      <View style={styles.usageTitleRow}>
                        <Text style={styles.usageTitle}>⚡ App Usage</Text>
                        {deviceUsage && deviceUsage.total_seconds > 0 && (
                          <View style={styles.usageDurationBadge}>
                            <Text style={styles.usageDurationBadgeText}>
                              {formatDurationBengali(deviceUsage.total_seconds)}
                            </Text>
                          </View>
                        )}
                      </View>

                      {deviceUsage && Array.isArray(deviceUsage.roles) && deviceUsage.roles.length > 0 ? (
                        <View style={styles.usageTable}>
                          {deviceUsage.roles.map((r, rIdx) => (
                            <View key={`${r.role || 'ROLE'}_${rIdx}`} style={styles.usageTableRow}>
                              <Text style={styles.usageAppLabel} numberOfLines={1}>
                                {r.app_label || getAppLabelForRole(r.role)}
                              </Text>
                              <Text style={styles.usageAppTime}>
                                {formatDurationBengali(r.total_seconds)}
                              </Text>
                            </View>
                          ))}
                          <View style={styles.usageTotalDivider} />
                          <View style={styles.usageTableRow}>
                            <Text style={styles.usageTotalTitle}>মোট Active Time:</Text>
                            <Text style={styles.usageTotalValue}>
                              {formatDurationBengali(deviceUsage.total_seconds)}
                            </Text>
                          </View>
                        </View>
                      ) : (
                        <View style={styles.usageEmptyRow}>
                          <Text style={styles.usageEmptyText}>
                            ⏱️ কোনো সক্রিয় ব্যবহারের রেকর্ড নেই
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Offline Mode Permission (Slim Integrated Row) */}
                    {isAdmin && (
                      <View style={styles.offlineRow}>
                        <View style={styles.offlineTextGroup}>
                          <Text style={styles.offlineLabel}>⚡ Offline Mode Permission</Text>
                          <Text style={styles.offlineSublabel}>
                            {isOfflineAllowed ? 'অফলাইন মোড চালুর অনুমতি দেওয়া আছে' : 'অফলাইন মোড নিষ্ক্রিয় করা আছে'}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.offlineToggleBtn, isOfflineAllowed ? styles.offlineToggleOn : styles.offlineToggleOff]}
                          onPress={() => handleToggleOfflinePermission(item)}
                          hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.offlineToggleText}>
                            {isOfflineAllowed ? 'ON' : 'OFF'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Action Buttons (Consistent 44dp Touch Targets) */}
                    {isAdmin && (
                      <View style={styles.actionButtonsContainer}>
                        {/* PENDING State */}
                        {st === 'PENDING' && !isLocked && (
                          <View style={styles.actionBtnRow}>
                            <TouchableOpacity
                              style={[styles.btnBase, styles.btnApprove]}
                              onPress={() => handleStatusChange(item.device_id, item.device_name, 'ACTIVE')}
                              activeOpacity={0.8}
                            >
                              <Text style={styles.btnApproveText}>✅ অনুমোদন</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[styles.btnBase, styles.btnBlock]}
                              onPress={() => handleStatusChange(item.device_id, item.device_name, 'BLOCKED')}
                              activeOpacity={0.8}
                            >
                              <Text style={styles.btnBlockText}>🚫 ব্লক</Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        {/* ACTIVE State */}
                        {st === 'ACTIVE' && !isLocked && (
                          <View style={styles.actionBtnRow}>
                            <TouchableOpacity
                              style={[styles.btnBase, styles.btnBlock]}
                              onPress={() => handleStatusChange(item.device_id, item.device_name, 'BLOCKED')}
                              activeOpacity={0.8}
                            >
                              <Text style={styles.btnBlockText}>🚫 ব্লক করুন</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[styles.btnBase, styles.btnForceLogout]}
                              onPress={() => handleForceLogoutPrompt(item)}
                              activeOpacity={0.8}
                            >
                              <Text style={styles.btnForceLogoutText}>🔄 লগআউট</Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        {/* BLOCKED State */}
                        {st === 'BLOCKED' && (
                          <View style={styles.actionColumn}>
                            {isLocked ? (
                              <TouchableOpacity
                                style={[styles.btnBase, styles.btnUnblockAdmin]}
                                onPress={() => handleRemoveAdminLock(item)}
                                activeOpacity={0.8}
                              >
                                <Text style={styles.btnUnblockAdminText}>🔓 অ্যাডমিন লক সরান</Text>
                              </TouchableOpacity>
                            ) : (
                              <>
                                <View style={styles.actionBtnRow}>
                                  <TouchableOpacity
                                    style={[styles.btnBase, styles.btnUnblock]}
                                    onPress={() => handleStatusChange(item.device_id, item.device_name, 'ACTIVE')}
                                    activeOpacity={0.8}
                                  >
                                    <Text style={styles.btnUnblockText}>🔓 আনব্লক</Text>
                                  </TouchableOpacity>

                                  <TouchableOpacity
                                    style={[styles.btnBase, styles.btnAdminLock]}
                                    onPress={() => handleInitiateAdminLock(item)}
                                    activeOpacity={0.8}
                                  >
                                    <Text style={styles.btnAdminLockText}>🔒 অ্যাডমিন লক</Text>
                                  </TouchableOpacity>
                                </View>

                                <TouchableOpacity
                                  style={[styles.btnBase, styles.btnForceLogoutFull]}
                                  onPress={() => handleForceLogoutPrompt(item)}
                                  activeOpacity={0.8}
                                >
                                  <Text style={styles.btnForceLogoutText}>🔄 রিমোট লগআউট</Text>
                                </TouchableOpacity>
                              </>
                            )}
                          </View>
                        )}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </>
        ) : (
          /* FEATURE 4: FULL-SCREEN DELETED DEVICES LIST */
          <>
            <View style={styles.deletedBanner}>
              <Text style={styles.deletedBannerTitle}>🗑️ Soft-Deleted Device Archive</Text>
              <Text style={styles.deletedBannerText}>
                পূর্বে মুছে ফেলা ডিভাইসসমূহ এখানে সংরক্ষিত আছে। যে কোনো সময় রিকভার করা সম্ভব।
              </Text>
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeader}>মুছে ফেলা ডিভাইসের তালিকা</Text>
              <Text style={styles.sectionHeaderCount}>{deletedDevices.length} টি ডিভাইস</Text>
            </View>

            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color="#FFB703" />
                <Text style={styles.loadingText}>মুছে ফেলা ডিভাইস লোড হচ্ছে...</Text>
              </View>
            ) : deletedDevices.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>কোনো মুছে ফেলা ডিভাইস পাওয়া যায়নি</Text>
              </View>
            ) : (
              deletedDevices.map((item) => (
                <View key={item.id || item.device_id} style={styles.deviceCard}>
                  <View style={styles.cardHeader}>
                    <View style={styles.deviceIdentityGroup}>
                      <View style={[styles.deviceIconBox, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}>
                        <Text style={styles.deviceIconText}>🗑️</Text>
                      </View>
                      <View style={styles.deviceNamesColumn}>
                        <Text style={styles.deviceName} numberOfLines={1}>
                          {item.device_name || item.model || 'Unknown Device'}
                        </Text>
                        <Text style={styles.deviceIdText} numberOfLines={1}>
                          {item.device_id}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.hairlineDivider} />

                  <View style={styles.specsGrid}>
                    <View style={styles.specsRow}>
                      <View style={styles.specsCol}>
                        <Text style={styles.specsLabel}>মুছে ফেলার তারিখ</Text>
                        <Text style={styles.specsValue} numberOfLines={1}>
                          {item.deleted_at ? new Date(item.deleted_at).toLocaleDateString() : 'N/A'}
                        </Text>
                      </View>
                      <View style={styles.specsCol}>
                        <Text style={styles.specsLabel}>মুছেছেন</Text>
                        <Text style={styles.specsValue} numberOfLines={1}>
                          {item.deleted_by || 'admin'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {isAdmin && (
                    <TouchableOpacity
                      style={[styles.btnBase, styles.btnRestore]}
                      onPress={() => handleRestoreDeviceAction(item)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.btnRestoreText}>🔄 Restore Device (পুনরুদ্ধার করুন)</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* FEATURE 1: Context Menu Modal (Long Press Action) */}
      <Modal
        visible={contextMenuVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setContextMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setContextMenuVisible(false)}
        >
          <View style={styles.contextMenuContent} onStartShouldSetResponder={() => true}>
            <Text style={styles.contextMenuTitle}>
              📱 {selectedDevice?.device_name || selectedDevice?.model || 'Device Options'}
            </Text>
            <Text style={styles.contextMenuSub}>ID: {selectedDevice?.device_id}</Text>

            <TouchableOpacity style={styles.contextOptionBtn} onPress={handleInitiateRename}>
              <Text style={styles.contextOptionText}>✏️ Rename Device (নাম পরিবর্তন)</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.contextOptionBtn, styles.contextOptionDelete]} onPress={handleInitiateSoftDelete}>
              <Text style={styles.contextOptionDeleteText}>🗑️ ডিভাইস মুছুন</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.contextCancelBtn} onPress={() => setContextMenuVisible(false)}>
              <Text style={styles.contextCancelText}>বাতিল</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* FEATURE 2: Rename Device Modal */}
      <Modal
        visible={renameModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setRenameModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}
            activeOpacity={1}
            onPress={() => setRenameModalVisible(false)}
          >
            <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
              <Text style={styles.modalTitle}>✏️ ডিভাইসের নাম পরিবর্তন</Text>
              <Text style={styles.modalDesc}>
                ডিভাইসটির জন্য একটি নতুন পরিচিতি নাম লিখুন:
              </Text>

              {renameError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>⚠️ {renameError}</Text>
                </View>
              ) : null}

              <TextInput
                style={styles.pinInput}
                placeholder="Enter new device name"
                placeholderTextColor="#71717a"
                value={renameInput}
                onChangeText={(val) => {
                  setRenameInput(val);
                  if (renameError) setRenameError('');
                }}
                autoFocus={true}
              />

              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setRenameModalVisible(false)}
                >
                  <Text style={styles.modalCancelText}>বাতিল</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalConfirmBtn, { backgroundColor: '#16a34a' }]}
                  onPress={handleConfirmRename}
                >
                  <Text style={styles.modalConfirmText}>সেভ করুন</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {/* Admin PIN Confirmation Modal */}
      <Modal
        visible={pinModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setPinModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}
            activeOpacity={1}
            onPress={() => setPinModalVisible(false)}
          >
            <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
              <Text style={styles.modalTitle}>🔒 সাকিব নিরাপত্তা যাচাই</Text>
              <Text style={styles.modalDesc}>
                সাকিব এক্সেস স্থায়ীভাবে লক করতে আপনার সাকিব PIN লিখুন:
              </Text>

              {pinError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>⚠️ {pinError}</Text>
                </View>
              ) : null}

              <TextInput
                style={styles.pinInput}
                placeholder="সাকিব PIN লিখুন"
                placeholderTextColor="#71717a"
                keyboardType="number-pad"
                secureTextEntry={true}
                value={pinInput}
                onChangeText={(val) => {
                  setPinInput(val);
                  if (pinError) setPinError('');
                }}
                autoFocus={true}
              />

              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setPinModalVisible(false)}
                >
                  <Text style={styles.modalCancelText}>বাতিল</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalConfirmBtn}
                  onPress={handleConfirmPinAndLock}
                >
                  <Text style={styles.modalConfirmText}>লক নিশ্চিত করুন</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── CUSTOM DARK THEME ALERT / NOTIFICATION MODAL (Matches Admin App Theme #181E25) ── */}
      <Modal
        visible={!!darkAlert}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setDarkAlert(null)}
      >
        <View style={styles.darkAlertBackdrop}>
          <View style={styles.darkAlertBox}>
            {/* Top Icon Badge */}
            {(() => {
              const title = darkAlert?.title || '';
              const isSuccess = title.includes('সফল') || title.includes('✅');
              const isDanger = title.includes('লগআউট') || title.includes('🔄') || title.includes('ব্লক') || title.includes('🚫') || title.includes('ত্রুটি') || title.includes('❌') || title.includes('মুছুন') || title.includes('🗑️');
              const isLock = title.includes('লক') || title.includes('🔒') || title.includes('নিরাপত্তা');

              const iconBg = isSuccess 
                ? 'rgba(16, 185, 129, 0.15)' 
                : isDanger 
                ? 'rgba(239, 68, 68, 0.15)' 
                : isLock 
                ? 'rgba(245, 158, 11, 0.15)' 
                : 'rgba(99, 102, 241, 0.15)';
              
              const iconBorder = isSuccess 
                ? 'rgba(16, 185, 129, 0.35)' 
                : isDanger 
                ? 'rgba(239, 68, 68, 0.35)' 
                : isLock 
                ? 'rgba(245, 158, 11, 0.35)' 
                : 'rgba(99, 102, 241, 0.35)';

              const iconSymbol = isSuccess
                ? '✅'
                : title.includes('লগআউট')
                ? '🔄'
                : title.includes('ব্লক')
                ? '🚫'
                : title.includes('মুছুন')
                ? '🗑️'
                : title.includes('ত্রুটি') || title.includes('❌')
                ? '❌'
                : isLock
                ? '🔒'
                : '📡';

              return (
                <View style={[styles.darkAlertIconCircle, { backgroundColor: iconBg, borderColor: iconBorder }]}>
                  <Text style={{ fontSize: 24 }}>{iconSymbol}</Text>
                </View>
              );
            })()}

            {/* Title */}
            <Text style={styles.darkAlertTitle}>
              {(darkAlert?.title || '').replace(/^[✅❌🔄🚫⚠️🔒📡\s]+/, '').trim() || darkAlert?.title}
            </Text>

            {/* Message Body */}
            <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.darkAlertMessage}>
                {darkAlert?.message}
              </Text>
            </ScrollView>

            {/* Button Actions */}
            <View style={styles.darkAlertBtnRow}>
              {(darkAlert?.buttons || [{ text: 'ঠিক আছে', onPress: () => setDarkAlert(null) }]).map((btn, index) => {
                const isCancel = btn.style === 'cancel' || btn.text === 'বাতিল';
                const isDestructive = btn.style === 'destructive' || btn.text.includes('লগআউট') || btn.text.includes('ব্লক') || btn.text.includes('মুছুন');
                const isSingle = (darkAlert?.buttons || []).length <= 1;

                let btnBg = '#6366F1';
                let btnBorder = 'transparent';
                let textColor = '#FFFFFF';

                if (isCancel) {
                  btnBg = '#202630';
                  btnBorder = '#2D3748';
                  textColor = '#94A3B8';
                } else if (isDestructive) {
                  btnBg = '#EF4444';
                } else if (isSingle) {
                  const title = darkAlert?.title || '';
                  if (title.includes('সফল') || title.includes('✅')) {
                    btnBg = '#10B981';
                  } else if (title.includes('ত্রুটি') || title.includes('❌')) {
                    btnBg = '#EF4444';
                  } else {
                    btnBg = '#6366F1';
                  }
                }

                return (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.darkAlertBtn,
                      {
                        backgroundColor: btnBg,
                        borderColor: btnBorder,
                        borderWidth: btnBorder !== 'transparent' ? 1 : 0,
                        flex: isSingle ? 0 : 1,
                        width: isSingle ? '100%' : undefined,
                      }
                    ]}
                    activeOpacity={0.8}
                    onPress={() => {
                      const handler = btn.onPress;
                      setDarkAlert(null);
                      if (typeof handler === 'function') {
                        setTimeout(() => {
                          handler();
                        }, 70);
                      }
                    }}
                  >
                    <Text style={[styles.darkAlertBtnText, { color: textColor }]}>
                      {btn.text}
                    </Text>
                  </TouchableOpacity>
                );
              })}
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
    backgroundColor: '#0B0B0C',
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#1A1A1E',
    backgroundColor: '#0B0B0C',
    zIndex: 10,
    elevation: 4,
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#161618',
    borderWidth: 1,
    borderColor: '#26262A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerIconBtnActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: '#EF4444',
  },
  headerIconText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  headerTitleGroup: {
    flex: 1,
    marginHorizontal: 12,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: '#71717A',
    fontSize: 11,
    marginTop: 1,
  },
  headerRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTabIcon: {
    fontSize: 16,
  },
  headerRefreshIcon: {
    fontSize: 16,
  },
  // Scrollable Body
  scrollBody: {
    flex: 1,
    overflow: 'hidden',
  },
  // Main Content
  content: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 40,
  },
  hintBar: {
    backgroundColor: 'rgba(255, 183, 3, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 183, 3, 0.15)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  hintBarText: {
    color: '#A1A1AA',
    fontSize: 11,
    lineHeight: 16,
  },
  hintBold: {
    fontWeight: 'bold',
    color: '#FFB703',
  },
  // Responsive 3+2 Metrics Grid
  metricsContainer: {
    marginBottom: 12,
    gap: 6,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#161618',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#26262A',
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricCount: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  metricLabel: {
    fontSize: 10,
    color: '#A1A1AA',
    marginTop: 2,
    fontWeight: '500',
  },
  // Business Date Selector
  dateSelectorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#161618',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#26262A',
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 14,
  },
  dateNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#202024',
    borderWidth: 1,
    borderColor: '#2E2E34',
  },
  dateNavBtnIcon: {
    color: '#A1A1AA',
    fontSize: 11,
  },
  dateNavBtnLabel: {
    color: '#E4E4E7',
    fontSize: 11,
    fontWeight: '600',
    marginHorizontal: 4,
  },
  dateCenterDisplay: {
    alignItems: 'center',
  },
  dateMainText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  dateSubRow: {
    marginTop: 2,
  },
  todayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  todayPillDot: {
    color: '#10B981',
    fontSize: 8,
    marginRight: 4,
  },
  todayPillText: {
    color: '#34D399',
    fontSize: 10,
    fontWeight: 'bold',
  },
  todayResetBtn: {
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  todayResetBtnText: {
    color: '#FFB703',
    fontSize: 10,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  // Section Header
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  sectionHeader: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeaderCount: {
    color: '#71717A',
    fontSize: 11,
    fontWeight: '500',
  },
  loadingBox: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    color: '#A1A1AA',
    marginTop: 12,
    fontSize: 13,
  },
  emptyBox: {
    padding: 40,
    alignItems: 'center',
    backgroundColor: '#161618',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#26262A',
  },
  emptyText: {
    color: '#71717A',
    fontSize: 13,
  },
  // Device Card
  deviceCard: {
    backgroundColor: '#161618',
    borderWidth: 1,
    borderColor: '#26262A',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  deviceIdentityGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  deviceIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#202024',
    borderWidth: 1,
    borderColor: '#2C2C32',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  deviceIconText: {
    fontSize: 18,
  },
  deviceNamesColumn: {
    flex: 1,
  },
  deviceName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  deviceIdText: {
    color: '#71717A',
    fontSize: 10,
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  cardHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  moreOptionsBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#202024',
    borderWidth: 1,
    borderColor: '#2E2E34',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  moreOptionsText: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: 'bold',
  },
  // Status Badges
  badge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  badgeTextActive: {
    color: '#34D399',
    fontSize: 10,
    fontWeight: 'bold',
  },
  badgeBlocked: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  badgeTextBlocked: {
    color: '#F87171',
    fontSize: 10,
    fontWeight: 'bold',
  },
  badgePending: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  badgeTextPending: {
    color: '#FBBF24',
    fontSize: 10,
    fontWeight: 'bold',
  },
  badgeAdminLock: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  badgeTextAdminLock: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  hairlineDivider: {
    height: 1,
    backgroundColor: '#222226',
    marginVertical: 10,
  },
  // Hardware Specs Grid
  specsGrid: {
    gap: 6,
    marginBottom: 10,
  },
  specsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  specsCol: {
    flex: 1,
    backgroundColor: '#1A1A1D',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  specsColVersion: {
    flex: 0.85,
  },
  specsColStatus: {
    flex: 1.45,
  },
  specsStatusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  specsLiveBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  specsLiveBadgeText: {
    color: '#34D399',
    fontSize: 9,
    fontWeight: 'bold',
  },
  specsLabel: {
    fontSize: 10,
    color: '#71717A',
    marginBottom: 2,
  },
  specsValue: {
    fontSize: 11,
    color: '#E4E4E7',
    fontWeight: '600',
  },
  specsLiveText: {
    color: '#10B981',
    fontWeight: 'bold',
  },
  // App Usage Section
  usageContainer: {
    backgroundColor: '#121214',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#222226',
    padding: 10,
    marginBottom: 10,
  },
  usageTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  usageTitle: {
    color: '#FFB703',
    fontSize: 11,
    fontWeight: 'bold',
  },
  usageDurationBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  usageDurationBadgeText: {
    color: '#34D399',
    fontSize: 10,
    fontWeight: 'bold',
  },
  usageTable: {
    gap: 4,
  },
  usageTableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  usageAppLabel: {
    color: '#A1A1AA',
    fontSize: 11,
    flex: 1,
  },
  usageAppTime: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  usageTotalDivider: {
    height: 1,
    backgroundColor: '#222226',
    marginVertical: 4,
  },
  usageTotalTitle: {
    color: '#D4D4D8',
    fontSize: 11,
    fontWeight: '600',
  },
  usageTotalValue: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: 'bold',
  },
  usageEmptyRow: {
    paddingVertical: 2,
  },
  usageEmptyText: {
    color: '#71717A',
    fontSize: 11,
    fontStyle: 'italic',
  },
  // Offline Mode Switch
  offlineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#131315',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#222226',
    marginBottom: 10,
  },
  offlineTextGroup: {
    flex: 1,
    marginRight: 8,
  },
  offlineLabel: {
    color: '#E4E4E7',
    fontSize: 11,
    fontWeight: '600',
  },
  offlineSublabel: {
    color: '#71717A',
    fontSize: 10,
    marginTop: 1,
  },
  offlineToggleBtn: {
    minHeight: 32,
    minWidth: 48,
    borderRadius: 16,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  offlineToggleOn: {
    backgroundColor: '#16A34A',
  },
  offlineToggleOff: {
    backgroundColor: '#2E2E34',
  },
  offlineToggleText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
  // Action Buttons
  actionButtonsContainer: {
    marginTop: 2,
  },
  actionBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionColumn: {
    gap: 8,
  },
  btnBase: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnApprove: {
    backgroundColor: '#16A34A',
  },
  btnApproveText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  btnBlock: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  btnBlockText: {
    color: '#F87171',
    fontWeight: 'bold',
    fontSize: 12,
  },
  btnForceLogout: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  btnForceLogoutFull: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  btnForceLogoutText: {
    color: '#FBBF24',
    fontWeight: 'bold',
    fontSize: 12,
  },
  btnUnblock: {
    backgroundColor: 'rgba(22, 163, 74, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.35)',
  },
  btnUnblockText: {
    color: '#4ADE80',
    fontWeight: 'bold',
    fontSize: 12,
  },
  btnAdminLock: {
    backgroundColor: '#B91C1C',
  },
  btnAdminLockText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  btnUnblockAdmin: {
    backgroundColor: '#16A34A',
  },
  btnUnblockAdminText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  // Deleted Archive
  deletedBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  deletedBannerTitle: {
    color: '#F87171',
    fontWeight: 'bold',
    fontSize: 12,
    marginBottom: 2,
  },
  deletedBannerText: {
    color: '#A1A1AA',
    fontSize: 11,
    lineHeight: 16,
  },
  btnRestore: {
    backgroundColor: '#16A34A',
    marginTop: 8,
  },
  btnRestoreText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 18,
    padding: 22,
    width: '100%',
    maxWidth: 360,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  modalDesc: {
    color: '#A1A1AA',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 16,
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderRadius: 8,
    padding: 8,
    marginBottom: 12,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 12,
  },
  pinInput: {
    backgroundColor: '#09090B',
    borderWidth: 1,
    borderColor: '#3F3F46',
    borderRadius: 10,
    color: '#FFFFFF',
    paddingHorizontal: 14,
    height: 48,
    fontSize: 16,
    marginBottom: 18,
    textAlign: 'center',
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: '#27272A',
    borderRadius: 10,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCancelText: {
    color: '#A1A1AA',
    fontWeight: '600',
    fontSize: 13,
  },
  modalConfirmBtn: {
    flex: 1,
    backgroundColor: '#B91C1C',
    borderRadius: 10,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalConfirmText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  // Context Menu Modal (••• and Long Press)
  contextMenuContent: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#3F3F46',
    borderRadius: 18,
    padding: 20,
    width: '100%',
    maxWidth: 320,
    alignItems: 'stretch',
  },
  contextMenuTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  contextMenuSub: {
    color: '#71717A',
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 18,
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  contextOptionBtn: {
    backgroundColor: '#27272A',
    borderRadius: 10,
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contextOptionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  contextOptionDelete: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  contextOptionDeleteText: {
    color: '#FCA5A5',
    fontSize: 13,
    fontWeight: 'bold',
  },
  contextCancelBtn: {
    minHeight: 44,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  contextCancelText: {
    color: '#71717A',
    fontSize: 13,
    fontWeight: '600',
  },

  // ── CUSTOM DARK ALERT MODAL STYLES (Admin Theme #181E25) ──
  darkAlertBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  darkAlertBox: {
    backgroundColor: '#181E25',
    borderWidth: 1,
    borderColor: '#242C37',
    borderRadius: 22,
    padding: 22,
    width: '90%',
    maxWidth: 360,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 12,
  },
  darkAlertIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  darkAlertTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
  },
  darkAlertMessage: {
    color: '#94A3B8',
    fontSize: 13.5,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 20,
  },
  darkAlertBtnRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
    marginTop: 4,
  },
  darkAlertBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  darkAlertBtnText: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
});
