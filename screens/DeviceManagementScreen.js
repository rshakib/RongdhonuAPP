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
import { getAllRegisteredDevices, updateDeviceStatus, setAdminDeviceLock } from '../services/deviceRegistry';
import { verifyPinCode } from '../database';

export default function DeviceManagementScreen({ onBack, userRole = 'ADMIN' }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);

  // Admin Lock Confirmation Modal State
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [targetLockDevice, setTargetLockDevice] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  const isAdmin = !userRole || String(userRole).toUpperCase().trim() === 'ADMIN';

  const loadDevices = () => {
    setLoading(true);
    try {
      const list = getAllRegisteredDevices();
      setDevices(list || []);
    } catch (err) {
      console.error('[DeviceManagement] Error loading devices:', err);
      Alert.alert('ত্রুটি', 'ডিভাইস তালিকা লোড করতে ব্যর্থ হয়েছে');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDevices();
  }, []);

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

    // Verify PIN against Admin users
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

  const renderStatusBadge = (status, adminLock) => {
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
          <Text style={styles.badgeTextActive}>● ACTIVE (অনুমোদিত)</Text>
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
        <Text style={styles.headerTitle}>📱 ডিভাইস অ্যাক্সেস কন্ট্রোল</Text>
        <TouchableOpacity onPress={loadDevices} style={styles.refreshBtn}>
          <Text style={styles.refreshBtnText}>🔄</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoBanner}>
          <Text style={styles.infoBannerTitle}>🛡️ Stolen Device Protection</Text>
          <Text style={styles.infoBannerText}>
            হারিয়ে যাওয়া/চুরি হওয়া ডিভাইসে 'Block Admin Access' ব্যবহার করলে ওই ডিভাইস থেকে অ্যাডমিন, ওনার ও ম্যানেজার কোনো এক্সেস থাকবে না।
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
            <Text style={styles.emptyText}>কোনো ডিভাইস নিবন্ধিত পাওয়া যায়নি</Text>
          </View>
        ) : (
          devices.map((item) => {
            const st = String(item.status || 'PENDING').toUpperCase().trim();
            const isLocked = Number(item.admin_lock || 0) === 1;

            return (
              <View key={item.id || item.device_id} style={styles.deviceCard}>
                <View style={styles.cardHeader}>
                  <View style={styles.deviceTitleGroup}>
                    <Text style={styles.deviceIcon}>📱</Text>
                    <View>
                      <Text style={styles.deviceName}>{item.device_name || item.model || 'Unknown Device'}</Text>
                      <Text style={styles.deviceIdText}>ID: {item.device_id}</Text>
                    </View>
                  </View>
                  {renderStatusBadge(st, isLocked)}
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

                    {/* ACTIVE State: Show [Block] */}
                    {st === 'ACTIVE' && !isLocked && (
                      <View style={styles.actionRow}>
                        <TouchableOpacity
                          style={[styles.btnAction, styles.btnBlock]}
                          onPress={() => handleStatusChange(item.device_id, item.device_name, 'BLOCKED')}
                        >
                          <Text style={styles.btnBlockText}>🚫 ব্লক করুন (Block)</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* BLOCKED State */}
                    {st === 'BLOCKED' && (
                      <View style={styles.actionRowColumn}>
                        {isLocked ? (
                          /* Admin Lock is Active: Show [Remove Admin Lock] */
                          <TouchableOpacity
                            style={[styles.btnAction, styles.btnUnblockAdmin]}
                            onPress={() => handleRemoveAdminLock(item)}
                          >
                            <Text style={styles.btnUnblockAdminText}>🔓 Remove Admin Lock</Text>
                          </TouchableOpacity>
                        ) : (
                          /* Normal Blocked: Show [Unblock] & [Block Admin Access] */
                          <View style={styles.actionRow}>
                            <TouchableOpacity
                              style={[styles.btnAction, styles.btnUnblock]}
                              onPress={() => handleStatusChange(item.device_id, item.device_name, 'ACTIVE')}
                            >
                              <Text style={styles.btnUnblockText}>🔓 আনব্লক করুন (Unblock)</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[styles.btnAction, styles.btnAdminLock]}
                              onPress={() => handleInitiateAdminLock(item)}
                            >
                              <Text style={styles.btnAdminLockText}>🔒 Block Admin</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

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
});
