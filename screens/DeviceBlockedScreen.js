import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  StatusBar as RNStatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function DeviceBlockedScreen({ deviceId, isAdminLock = false, onExit }) {
  return (
    <SafeAreaView style={styles.container}>
      <RNStatusBar barStyle="light-content" backgroundColor="#09090b" />

      <View style={styles.content}>
        {/* Brand Icon */}
        <View style={styles.badgeContainer}>
          <View style={styles.iconCircle}>
            <Text style={styles.iconEmoji}>🔒</Text>
          </View>
        </View>

        {/* Title */}
        <Text style={styles.title}>Device Blocked</Text>

        {/* Status Pill */}
        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>
            {isAdminLock ? '✖ STATUS: ADMIN LOCKED (STOLEN DEVICE)' : '✖ STATUS: BLOCKED'}
          </Text>
        </View>

        {/* Body Message */}
        <View style={styles.bodyCard}>
          {isAdminLock ? (
            <>
              <Text style={styles.bodyText}>
                Administrator access has been disabled for this device.
              </Text>
              <Text style={[styles.bodyText, { marginTop: 8 }]}>
                This device has been marked as lost/stolen.
              </Text>
              <Text style={[styles.bodyText, { marginTop: 10, color: '#a1a1aa' }]}>
                Please contact another Administrator.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.bodyText}>
                এই ডিভাইসটি Administrator ব্লক করেছেন।
              </Text>
              <Text style={[styles.bodyText, { marginTop: 8 }]}>
                এই ডিভাইস থেকে Login করা যাবে না।
              </Text>
              <Text style={[styles.bodyText, { marginTop: 10, color: '#a1a1aa' }]}>
                অনুগ্রহ করে Administrator-এর সাথে যোগাযোগ করুন।
              </Text>
            </>
          )}
        </View>

        {/* Device ID Card */}
        {deviceId ? (
          <View style={styles.deviceIdBox}>
            <Text style={styles.deviceIdLabel}>Device ID:</Text>
            <Text style={styles.deviceIdValue} numberOfLines={1}>{deviceId}</Text>
          </View>
        ) : null}

        {/* Action Button */}
        <View style={styles.btnGroup}>
          <TouchableOpacity
            style={styles.btnExit}
            onPress={onExit}
            activeOpacity={0.85}
          >
            <Text style={styles.btnExitText}>🚪 Exit / Back to Login</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  badgeContainer: {
    marginBottom: 20,
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconEmoji: {
    fontSize: 40,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 10,
  },
  statusPill: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
    marginBottom: 24,
  },
  statusPillText: {
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  bodyCard: {
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    marginBottom: 20,
  },
  bodyText: {
    color: '#ef4444',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    fontWeight: '600',
  },
  deviceIdBox: {
    backgroundColor: '#111113',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  deviceIdLabel: {
    color: '#71717a',
    fontSize: 12,
  },
  deviceIdValue: {
    color: '#a1a1aa',
    fontSize: 11,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'right',
    marginLeft: 10,
  },
  btnGroup: {
    width: '100%',
  },
  btnExit: {
    backgroundColor: '#b91c1c',
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  btnExitText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
