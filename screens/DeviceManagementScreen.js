import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  StatusBar as RNStatusBar
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
  restoreDevice
} from '../services/deviceRegistry';
import { verifyPinCode } from '../database';

export default function DeviceManagementScreen({ onBack, userRole = 'ADMIN' }) {
  const [viewMode, setViewMode] = useState('ACTIVE'); // 'ACTIVE' or 'DELETED'
  const [devices, setDevices] = useState([]);
  const [deletedDevices, setDeletedDevices] = useState([]);
  const [loading, setLoading] = useState(true);

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

  const isAdmin = !userRole || String(userRole).toUpperCase().trim() === 'ADMIN';

  const loadDevices = () => {
    setLoading(true);
    try {
      if (viewMode === 'DELETED') {
        const delList = getDeletedDevices();
        setDeletedDevices(delList || []);
      } else {
        const list = getAllRegisteredDevices();
        setDevices(list || []);
      }
    } catch (err) {
      console.error('[DeviceManagement] Error loading devices:', err);
      Alert.alert('ত্রুটি', 'ডিভাইস তালিকা লোড করতে ব্যর্থ হয়েছে');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDevices();
  }, [viewMode]);

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
        { text: 'বাতিল (Cancel)', style: 'cancel' },
        {
          text: 'হ্যাঁ, মুছে ফেলুন (Delete)',
          style: 'destructive',
          onPress: () => {
            const success = softDeleteDevice(device.device_id, 'admin');
            setSelectedDevice(null);
            if (success) {
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
        { text: 'বাতিল (Cancel)', style: 'cancel' },
        {
          text: 'রিকভার করুন (Restore)',
          onPress: () => {
            const success = restoreDevice(device.device_id, 'admin');
            if (success) {
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
    const actionText = newStatus === 'ACTIVE' ? 'অনুমোদন (Approve)' : newStatus === 'BLOCKED' ? 'ব্লক (Block)' : 'পুনরায় পেন্ডিং';
    
    Alert.alert(
      'ডিভাইস স্ট্যাটাস পরিবর্তন',
      `আপনি কি নিশ্চিত যে '${deviceName || deviceId}' ডিভাইসটি ${actionText} করতে চান?`,
      [
        { text: 'বাতিল (Cancel)', style: 'cancel' },
        {
          text: 'হ্যাঁ (Confirm)',
          style: newStatus === 'BLOCKED' ? 'destructive' : 'default',
          onPress: () => {
            const success = updateDeviceStatus(deviceId, newStatus, 'admin');
            if (success) {
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
    const actionText = nextAllowed ? 'ON (অনুমোদিত)' : 'OFF (নিষ্ক্রিয়)';

    Alert.alert(
      'অফলাইন পারমিশন পরিবর্তন',
      `আপনি কি '${device.device_name || device.device_id}' ডিভাইসটির জন্য Offline Mode ${actionText} করতে চান?`,
      [
        { text: 'বাতিল (Cancel)', style: 'cancel' },
        {
          text: 'হ্যাঁ (Confirm)',
          onPress: () => {
            const success = updateDeviceOfflinePermission(device.device_id, nextAllowed, 'admin');
            if (success) {
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
      '⚠️ Block Administrator Access',
      `You are about to permanently disable Administrator access from this device ('${device.device_name || device.device_id}').\n\nAfter enabling this option:\n• Admin cannot login\n• Owner cannot login\n• Manager cannot login\n\nOnly another approved Admin device can remove this lock.\n\nContinue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
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
  const handleConfirmPinAndLock = () => {
    if (!pinInput.trim()) {
      setPinError('অ্যাডমিন পিন কোড দিন (Enter Admin PIN)');
      return;
    }

    const isValidPin = verifyPinCode(pinInput.trim(), 'admin');
    if (!isValidPin) {
      setPinError('ভুল পিন কোড! পুনরায় চেষ্টা করুন (Invalid Admin PIN)');
      return;
    }

    if (!targetLockDevice) return;

    const success = setAdminDeviceLock(targetLockDevice.device_id, true, 'admin');
    setPinModalVisible(false);
    setPinInput('');
    setTargetLockDevice(null);

    if (success) {
      Alert.alert('সফল', 'অ্যাডমিন এক্সেস স্থায়ীভাবে ব্লক করা হয়েছে (Admin Lock Enabled).');
      loadDevices();
    } else {
      Alert.alert('ত্রুটি', 'অ্যাডমিন ব্লক ব্যর্থ হয়েছে।');
    }
  };

  // Remove Admin Lock Action
  const handleRemoveAdminLock = (device) => {
    Alert.alert(
      '🔓 Remove Admin Lock',
      `আপনি কি নিশ্চিত যে '${device.device_name || device.device_id}' ডিভাইসটির অ্যাডমিন লক সরাতে চান?`,
      [
        { text: 'বাতিল (Cancel)', style: 'cancel' },
        {
          text: 'আনব্লক করুন (Confirm)',
          onPress: () => {
            const success = setAdminDeviceLock(device.device_id, false, 'admin');
            if (success) {
              Alert.alert('সফল', 'অ্যাডমিন লক সফলভাবে অপসারিত হয়েছে।');
              loadDevices();
            } else {
              Alert.alert('ত্রুটি', 'অ্যাডমিন লক অপসারণ ব্যর্থ হয়েছে।');
            }
          }
        }
      ]
    );
  };

  // Phase 5: Handle Remote Force Logout Action
  const handleForceLogoutPrompt = (device) => {
    Alert.alert(
      'Force Logout',
      `You are about to sign this device ('${device.device_name || device.device_id}') out remotely.\n\nThe current user will immediately lose access.\n\nThe next login will require Username and PIN again.\n\nContinue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Force Logout',
          style: 'destructive',
          onPress: () => {
            const success = triggerForceLogout(device.device_id, 'admin');
            if (success) {
              Alert.alert('সফল', 'ডিভাইসটিতে রিমোট Force Logout নির্দেশ পাঠানো হয়েছে।');
              loadDevices();
            } else {
              Alert.alert('ত্রুটি', 'Force Logout নির্দেশ ব্যর্থ হয়েছে।');
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
          <Text style={styles.badgeTextAdminLock}>🔒 ADMIN LOCKED</Text>
        </View>
      );
    }
    if (st === 'ACTIVE') {
      return (
        <View style={[styles.badge, styles.badgeActive]}>
          <Text style={styles.badgeTextActive}>
            {forceLogout === 1 ? '🔄 ACTIVE (Force Logout Scheduled)' : '● ACTIVE (অনুমোদিত)'}
          </Text>
        </View>
      );
    }
    if (st === 'BLOCKED') {
      return (
        <View style={[styles.badge, styles.badgeBlocked]}>
          <Text style={styles.badgeTextBlocked}>✖ BLOCKED (ব্লকড)</Text>
        </View>
      );
    }
    return (
      <View style={[styles.badge, styles.badgePending]}>
        <Text style={styles.badgeTextPending}>⏳ PENDING (অপেক্ষমাণ)</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <RNStatusBar barStyle="light-content" backgroundColor="#09090b" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>❮ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {viewMode === 'ACTIVE' ? '📱 ডিভাইস অ্যাক্সেস কন্ট্রোল' : '🗑️ মুছে ফেলা ডিভাইসসমূহ'}
        </Text>
        <View style={styles.headerRightGroup}>
          {isAdmin && (
            <TouchableOpacity
              onPress={() => setViewMode(prev => (prev === 'ACTIVE' ? 'DELETED' : 'ACTIVE'))}
              style={[styles.tabToggleBtn, viewMode === 'DELETED' ? styles.tabToggleBtnActive : null]}
            >
              <Text style={styles.tabToggleBtnText}>
                {viewMode === 'ACTIVE' ? '🗑️ Deleted' : '📱 Active'}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={loadDevices} style={styles.refreshBtn}>
            <Text style={styles.refreshBtnText}>🔄</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {viewMode === 'ACTIVE' ? (
          <>
            <View style={styles.infoBanner}>
              <Text style={styles.infoBannerTitle}>🛡️ Device Registry & Policy Control</Text>
              <Text style={styles.infoBannerText}>
                এডমিন যে কোনো ডিভাইসের অনুমোদন, ব্লক, স্টোলেন লক, রিনেম (Long Press), ডিলিট ও রিকভার নিয়ন্ত্রণ করতে পারেন।
              </Text>
            </View>

            <Text style={styles.sectionHeader}>নিবন্ধিত ডিভাইসের তালিকা ({devices.length})</Text>

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

                return (
                  <TouchableOpacity
                    key={item.id || item.device_id}
                    style={styles.deviceCard}
                    activeOpacity={0.95}
                    onLongPress={() => handleLongPressDevice(item)}
                    delayLongPress={500}
                  >
                    <View style={styles.cardHeader}>
                      <View style={styles.deviceTitleGroup}>
                        <Text style={styles.deviceIcon}>📱</Text>
                        <View>
                          <Text style={styles.deviceName}>{item.device_name || item.model || 'Unknown Device'}</Text>
                          <Text style={styles.deviceIdText}>ID: {item.device_id}</Text>
                        </View>
                      </View>
                      {renderStatusBadge(st, isLocked, forceLogoutPending)}
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.detailsGrid}>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>প্রস্তুতকারক (Brand):</Text>
                        <Text style={styles.detailValue}>{item.manufacturer || item.brand || 'Android'}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>অ্যান্ড্রয়েড ভার্সন:</Text>
                        <Text style={styles.detailValue}>{item.android_version || 'N/A'}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>অ্যাপ ভার্সন:</Text>
                        <Text style={styles.detailValue}>v{item.app_version || '1.0.0'}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>সর্বশেষ সক্রিয় (Last Seen):</Text>
                        <Text style={styles.detailValue}>
                          {item.last_seen ? new Date(item.last_seen).toLocaleString() : 'N/A'}
                        </Text>
                      </View>
                    </View>

                    {/* Phase 6: Admin Offline Permission Switch Row */}
                    {isAdmin && (
                      <View style={styles.permissionBox}>
                        <View style={styles.permissionTextGroup}>
                          <Text style={styles.permissionLabel}>⚡ Offline Mode Permission:</Text>
                          <Text style={styles.permissionSublabel}>
                            {isOfflineAllowed ? 'অফলাইন মোড চালুর অনুমতি দেওয়া আছে' : 'অফলাইন মোড নিষ্ক্রিয় করা আছে'}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.toggleSwitchBtn, isOfflineAllowed ? styles.toggleSwitchOn : styles.toggleSwitchOff]}
                          onPress={() => handleToggleOfflinePermission(item)}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.toggleSwitchText}>
                            {isOfflineAllowed ? 'ON' : 'OFF'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Admin Action Buttons */}
                    {isAdmin && (
                      <View style={styles.actionRowContainer}>
                        {/* PENDING State: Show [Approve] and [Block] */}
                        {st === 'PENDING' && !isLocked && (
                          <View style={styles.actionRow}>
                            <TouchableOpacity
                              style={[styles.btnAction, styles.btnApprove]}
                              onPress={() => handleStatusChange(item.device_id, item.device_name, 'ACTIVE')}
                            >
                              <Text style={styles.btnApproveText}>✅ অনুমোদন (Approve)</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[styles.btnAction, styles.btnBlock]}
                              onPress={() => handleStatusChange(item.device_id, item.device_name, 'BLOCKED')}
                            >
                              <Text style={styles.btnBlockText}>🚫 ব্লক (Block)</Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        {/* ACTIVE State: Show [Block] and [Force Logout] */}
                        {st === 'ACTIVE' && !isLocked && (
                          <View style={styles.actionRow}>
                            <TouchableOpacity
                              style={[styles.btnAction, styles.btnBlock]}
                              onPress={() => handleStatusChange(item.device_id, item.device_name, 'BLOCKED')}
                            >
                              <Text style={styles.btnBlockText}>🚫 ব্লক করুন (Block)</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[styles.btnAction, styles.btnForceLogout]}
                              onPress={() => handleForceLogoutPrompt(item)}
                            >
                              <Text style={styles.btnForceLogoutText}>🔄 Force Logout</Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        {/* BLOCKED State */}
                        {st === 'BLOCKED' && (
                          <View style={styles.actionRowColumn}>
                            {isLocked ? (
                              <TouchableOpacity
                                style={[styles.btnAction, styles.btnUnblockAdmin]}
                                onPress={() => handleRemoveAdminLock(item)}
                              >
                                <Text style={styles.btnUnblockAdminText}>🔓 Remove Admin Lock</Text>
                              </TouchableOpacity>
                            ) : (
                              <View style={styles.actionRowColumn}>
                                <View style={styles.actionRow}>
                                  <TouchableOpacity
                                    style={[styles.btnAction, styles.btnUnblock]}
                                    onPress={() => handleStatusChange(item.device_id, item.device_name, 'ACTIVE')}
                                  >
                                    <Text style={styles.btnUnblockText}>🔓 আনব্লক করুন</Text>
                                  </TouchableOpacity>

                                  <TouchableOpacity
                                    style={[styles.btnAction, styles.btnAdminLock]}
                                    onPress={() => handleInitiateAdminLock(item)}
                                  >
                                    <Text style={styles.btnAdminLockText}>🔒 Block Admin</Text>
                                  </TouchableOpacity>
                                </View>

                                <TouchableOpacity
                                  style={[styles.btnAction, styles.btnForceLogoutFull]}
                                  onPress={() => handleForceLogoutPrompt(item)}
                                >
                                  <Text style={styles.btnForceLogoutText}>🔄 Force Logout (সাইন-আউট)</Text>
                                </TouchableOpacity>
                              </View>
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
                এখানে পূর্বে মুছে ফেলা ডিভাইসসমূহ সংরক্ষিত আছে। ডিলিট হওয়া ডিভাইস পুনরায় রিকভার করা সম্ভব।
              </Text>
            </View>

            <Text style={styles.sectionHeader}>মুছে ফেলা ডিভাইসের তালিকা ({deletedDevices.length})</Text>

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
                <View key={item.id || item.device_id} style={styles.deletedCard}>
                  <View style={styles.cardHeader}>
                    <View style={styles.deviceTitleGroup}>
                      <Text style={styles.deviceIcon}>🗑️</Text>
                      <View>
                        <Text style={styles.deviceName}>{item.device_name || item.model || 'Unknown Device'}</Text>
                        <Text style={styles.deviceIdText}>ID: {item.device_id}</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.divider} />

                  <View style={styles.detailsGrid}>
                    <View style={styles.detailItem}>
                      <Text style={styles.detailLabel}>ডিলিট করার তারিখ (Deleted Date):</Text>
                      <Text style={styles.detailValue}>
                        {item.deleted_at ? new Date(item.deleted_at).toLocaleString() : 'N/A'}
                      </Text>
                    </View>
                    <View style={styles.detailItem}>
                      <Text style={styles.detailLabel}>ডিলিট করেছেন (Deleted By):</Text>
                      <Text style={styles.detailValue}>{item.deleted_by || 'admin'}</Text>
                    </View>
                  </View>

                  {isAdmin && (
                    <TouchableOpacity
                      style={styles.btnRestore}
                      onPress={() => handleRestoreDeviceAction(item)}
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
              <Text style={styles.contextOptionDeleteText}>🗑️ Delete Device (মুছে ফেলুন)</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.contextCancelBtn} onPress={() => setContextMenuVisible(false)}>
              <Text style={styles.contextCancelText}>বাতিল (Cancel)</Text>
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
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setRenameModalVisible(false)}
        >
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>✏️ Rename Device</Text>
            <Text style={styles.modalDesc}>
              ডিভাইসের জন্য একটি নতুন প্রদর্শন নাম লিখুন:
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
                <Text style={styles.modalCancelText}>বাতিল (Cancel)</Text>
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
      </Modal>

      {/* Admin PIN Confirmation Modal */}
      <Modal
        visible={pinModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setPinModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setPinModalVisible(false)}
        >
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>🔒 Admin Security Verification</Text>
            <Text style={styles.modalDesc}>
              অ্যাডমিন এক্সেস স্থায়ীভাবে লক করতে আপনার Administrator PIN লিখুন:
            </Text>

            {pinError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>⚠️ {pinError}</Text>
              </View>
            ) : null}

            <TextInput
              style={styles.pinInput}
              placeholder="Enter Admin PIN"
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
                <Text style={styles.modalCancelText}>বাতিল (Cancel)</Text>
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
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: '#27272a',
    backgroundColor: '#18181b',
  },
  backBtn: {
    padding: 6,
  },
  backBtnText: {
    color: '#ffb703',
    fontWeight: 'bold',
    fontSize: 15,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: 'bold',
  },
  refreshBtn: {
    padding: 6,
  },
  refreshBtnText: {
    fontSize: 18,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  infoBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
  },
  infoBannerTitle: {
    color: '#ef4444',
    fontWeight: 'bold',
    fontSize: 13,
    marginBottom: 4,
  },
  infoBannerText: {
    color: '#a1a1aa',
    fontSize: 11,
    lineHeight: 16,
  },
  sectionHeader: {
    color: '#d4d4d8',
    fontSize: 13,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  loadingBox: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    color: '#a1a1aa',
    marginTop: 12,
    fontSize: 13,
  },
  emptyBox: {
    padding: 40,
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 14,
  },
  emptyText: {
    color: '#71717a',
    fontSize: 13,
  },
  deviceCard: {
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  deviceTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  deviceIcon: {
    fontSize: 24,
    marginRight: 10,
  },
  deviceName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  deviceIdText: {
    color: '#71717a',
    fontSize: 11,
    marginTop: 2,
  },
  badge: {
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeActive: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  badgeTextActive: {
    color: '#4ade80',
    fontSize: 10,
    fontWeight: 'bold',
  },
  badgeBlocked: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  badgeTextBlocked: {
    color: '#fca5a5',
    fontSize: 10,
    fontWeight: 'bold',
  },
  badgePending: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  badgeTextPending: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: 'bold',
  },
  badgeAdminLock: {
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  badgeTextAdminLock: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  divider: {
    height: 1,
    backgroundColor: '#27272a',
    marginVertical: 12,
  },
  detailsGrid: {
    gap: 6,
  },
  detailItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailLabel: {
    color: '#71717a',
    fontSize: 11,
  },
  detailValue: {
    color: '#d4d4d8',
    fontSize: 11,
    fontWeight: '600',
  },
  permissionBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#09090b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  permissionTextGroup: {
    flex: 1,
    marginRight: 10,
  },
  permissionLabel: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  permissionSublabel: {
    color: '#71717a',
    fontSize: 10,
    marginTop: 2,
  },
  toggleSwitchBtn: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleSwitchOn: {
    backgroundColor: '#15803d',
  },
  toggleSwitchOff: {
    backgroundColor: '#3f3f46',
  },
  toggleSwitchText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 11,
  },
  actionRowContainer: {
    marginTop: 14,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionRowColumn: {
    gap: 10,
  },
  btnAction: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnApprove: {
    backgroundColor: '#15803d',
  },
  btnApproveText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  btnBlock: {
    backgroundColor: '#b91c1c',
  },
  btnBlockText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  btnUnblock: {
    backgroundColor: '#0284c7',
  },
  btnUnblockText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  btnAdminLock: {
    backgroundColor: '#7f1d1d',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  btnAdminLockText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  btnForceLogout: {
    backgroundColor: '#ea580c',
  },
  btnForceLogoutFull: {
    backgroundColor: '#ea580c',
    paddingVertical: 10,
  },
  btnForceLogoutText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  btnUnblockAdmin: {
    backgroundColor: '#16a34a',
    paddingVertical: 12,
  },
  btnUnblockAdminText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 18,
    padding: 22,
    width: '100%',
    maxWidth: 360,
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  modalDesc: {
    color: '#a1a1aa',
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
    color: '#fca5a5',
    fontSize: 12,
  },
  pinInput: {
    backgroundColor: '#09090b',
    borderWidth: 1,
    borderColor: '#3f3f46',
    borderRadius: 10,
    color: '#ffffff',
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
    backgroundColor: '#27272a',
    borderRadius: 10,
    height: 42,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCancelText: {
    color: '#a1a1aa',
    fontWeight: '600',
    fontSize: 13,
  },
  modalConfirmBtn: {
    flex: 1,
    backgroundColor: '#b91c1c',
    borderRadius: 10,
    height: 42,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalConfirmText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  headerRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tabToggleBtn: {
    backgroundColor: '#27272a',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  tabToggleBtnActive: {
    backgroundColor: '#b91c1c',
    borderColor: '#ef4444',
  },
  tabToggleBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  deletedBanner: {
    backgroundColor: 'rgba(185, 28, 28, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
  },
  deletedBannerTitle: {
    color: '#fca5a5',
    fontWeight: 'bold',
    fontSize: 13,
    marginBottom: 4,
  },
  deletedBannerText: {
    color: '#a1a1aa',
    fontSize: 11,
    lineHeight: 16,
  },
  deletedCard: {
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#3f3f46',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    opacity: 0.9,
  },
  btnRestore: {
    backgroundColor: '#16a34a',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  btnRestoreText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  contextMenuContent: {
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#3f3f46',
    borderRadius: 18,
    padding: 20,
    width: '100%',
    maxWidth: 320,
    alignItems: 'stretch',
  },
  contextMenuTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  contextMenuSub: {
    color: '#71717a',
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 18,
    marginTop: 2,
  },
  contextOptionBtn: {
    backgroundColor: '#27272a',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 10,
    alignItems: 'center',
  },
  contextOptionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  contextOptionDelete: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  contextOptionDeleteText: {
    color: '#fca5a5',
    fontSize: 14,
    fontWeight: 'bold',
  },
  contextCancelBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  contextCancelText: {
    color: '#71717a',
    fontSize: 13,
    fontWeight: '600',
  },
});
