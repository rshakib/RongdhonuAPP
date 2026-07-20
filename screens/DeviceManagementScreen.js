import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StatusBar as RNStatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAllRegisteredDevices, updateDeviceStatus } from '../services/deviceRegistry';

export default function DeviceManagementScreen({ onBack, userRole = 'ADMIN' }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fallback to true if userRole is missing or matches ADMIN / admin
  const isAdmin = !userRole || String(userRole).toUpperCase().trim() === 'ADMIN';

  const loadDevices = () => {
    setLoading(true);
    try {
      const list = getAllRegisteredDevices();
      console.log(`[DeviceManagement UI Audit] Loaded ${list ? list.length : 0} registered devices.`);
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
    console.log("[DeviceManagement UI Audit] Approve/Block button clicked");
    console.log("[DeviceManagement UI Audit] deviceId:", deviceId);
    console.log("[DeviceManagement UI Audit] newStatus:", newStatus);

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

  const renderStatusBadge = (status) => {
    const st = String(status || 'PENDING').toUpperCase().trim();
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
          <Text style={styles.infoBannerTitle}>🛡️ Device Registry Policy</Text>
          <Text style={styles.infoBannerText}>
            এডমিন যে কোনো ডিভাইস অনুমোদন বা ব্লক করতে পারেন। ম্যানেজার একাউন্ট দিয়ে লগইনের জন্য ডিভাইসটির স্ট্যাটাস 'ACTIVE' হতে হবে।
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

            console.log(`[DeviceCard Render Audit] userRole="${userRole}" device.status="${st}" isAdmin=${isAdmin} currentBranch="${st === 'PENDING' ? 'PENDING ([Approve], [Block])' : st === 'ACTIVE' ? 'ACTIVE ([Block])' : 'BLOCKED ([Unblock])'}"`);

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
                  {renderStatusBadge(st)}
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
                  <View style={styles.actionRow}>
                    {/* PENDING State: Show [Approve] and [Block] */}
                    {st === 'PENDING' && (
                      <>
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
                      </>
                    )}

                    {/* ACTIVE State: Show [Block] */}
                    {st === 'ACTIVE' && (
                      <TouchableOpacity
                        style={[styles.btnAction, styles.btnBlock]}
                        onPress={() => handleStatusChange(item.device_id, item.device_name, 'BLOCKED')}
                      >
                        <Text style={styles.btnBlockText}>🚫 ব্লক করুন (Block)</Text>
                      </TouchableOpacity>
                    )}

                    {/* BLOCKED State: Show [Unblock] */}
                    {st === 'BLOCKED' && (
                      <TouchableOpacity
                        style={[styles.btnAction, styles.btnUnblock]}
                        onPress={() => handleStatusChange(item.device_id, item.device_name, 'ACTIVE')}
                      >
                        <Text style={styles.btnUnblockText}>🔓 আনব্লক করুন (Unblock)</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
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
    backgroundColor: 'rgba(255, 183, 3, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 183, 3, 0.25)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
  },
  infoBannerTitle: {
    color: '#ffb703',
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
  actionRow: {
    flexDirection: 'row',
    marginTop: 14,
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
});
