import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  AppState,
  StatusBar as RNStatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getCurrentDeviceRecord, syncRemoteDeviceToLocal } from '../services/deviceRegistry';
import { fetchSupabaseDevices, fetchSingleSupabaseDevice } from '../services/supabaseDeviceControl';
import { ACTIVE_APP_PROFILE } from '../database';

export default function DevicePendingScreen({ deviceId, onApproved, onExit }) {
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState('');
  const inFlightRef = useRef(false);
  const stoppedRef = useRef(false);

  const handleRefresh = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setChecking(true);
    setMsg('');
    try {
      // ─── BUG-3 FIX ────────────────────────────────────────────────────────
      // Old code: read stale local SQLite only — missed any Supabase approvals.
      // New code: fetch the authoritative device record from Supabase by device
      // ID, sync it into local SQLite, then re-check local state.
      // Falls back gracefully when device is offline.
      // ──────────────────────────────────────────────────────────────────────
      const localRecord = getCurrentDeviceRecord();
      const resolvedDeviceId = deviceId || localRecord?.device_id;

      if (!resolvedDeviceId) {
        setMsg('ডিভাইস আইডি পাওয়া যায়নি।');
        return;
      }

      let remoteStatus = null;
      try {
        let remoteRecord = null;
        // TODO: If OWNER is granted Device Control screen access in the future, enable full device fleet fetching and reconciliation for OWNER here.
        if (ACTIVE_APP_PROFILE === 'ADMIN') {
          const remoteList = await fetchSupabaseDevices('ADMIN');
          remoteRecord = remoteList.find(r => r.device_id === resolvedDeviceId);
        } else {
          // Manager & Owner: strictly query own single device — NEVER download fleet
          const singleRes = await fetchSingleSupabaseDevice(resolvedDeviceId);
          if (singleRes.success && singleRes.record) {
            remoteRecord = singleRes.record;
          } else if (!singleRes.success) {
            throw new Error(singleRes.error || 'Network error');
          }
        }

        if (remoteRecord) {
          syncRemoteDeviceToLocal(remoteRecord);
          remoteStatus = String(remoteRecord.status || 'PENDING').toUpperCase().trim();
        }
      } catch (netErr) {
        // Offline — fall back to local SQLite and stop here so the message is not overwritten
        console.warn('[DevicePendingScreen] Offline during refresh, using local record:', netErr.message);
        setMsg('নেটওয়ার্ক সংযোগ নেই। স্থানীয় তথ্য দেখানো হচ্ছে।');
        return; // R-1 fix: preserve offline message — do not fall through to status check
      }

      // Re-read local state (now up-to-date if remote fetch succeeded)
      const updatedRecord = getCurrentDeviceRecord();
      const status = remoteStatus || String(updatedRecord?.status || 'PENDING').toUpperCase().trim();

      if (status === 'ACTIVE') {
        stoppedRef.current = true;
        if (onApproved) {
          onApproved();
        }
      } else if (status === 'BLOCKED') {
        setMsg('এই ডিভাইসটি ব্লক করা হয়েছে। অ্যাডমিনের সাথে যোগাযোগ করুন।');
      } else {
        setMsg('ডিভাইসটি এখনো Administrator-এর অনুমোদনের অপেক্ষায় আছে।');
      }
    } catch (err) {
      console.error('[DevicePendingScreen] Error checking status:', err);
      setMsg('স্ট্যাটাস পরীক্ষা করতে ব্যর্থ হয়েছে।');
    } finally {
      setChecking(false);
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      if (stoppedRef.current) return;
      if (AppState.currentState !== 'active') return;
      if (inFlightRef.current) return;
      handleRefresh();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <RNStatusBar barStyle="light-content" backgroundColor="#09090b" />

      <View style={styles.content}>
        {/* Brand Icon */}
        <View style={styles.badgeContainer}>
          <View style={styles.iconCircle}>
            <Text style={styles.iconEmoji}>⏳</Text>
          </View>
        </View>

        {/* Title */}
        <Text style={styles.title}>ডিভাইস অনুমোদন আবশ্যক</Text>

        {/* Status Pill */}
        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>● স্ট্যাটাস: অপেক্ষমাণ (PENDING)</Text>
        </View>

        {/* Body Message */}
        <View style={styles.bodyCard}>
          <Text style={styles.bodyText}>
            এই ডিভাইসটি এখনো অ্যাডমিন কর্তৃক অনুমোদিত হয়নি।
          </Text>
          <Text style={[styles.bodyText, { marginTop: 10 }]}>
            অনুগ্রহ করে অ্যাডমিনের সাথে যোগাযোগ করুন।
          </Text>
        </View>

        {/* Device ID Card */}
        {deviceId ? (
          <View style={styles.deviceIdBox}>
            <Text style={styles.deviceIdLabel}>Device ID:</Text>
            <Text style={styles.deviceIdValue} numberOfLines={1}>{deviceId}</Text>
          </View>
        ) : null}

        {/* Feedback Message */}
        {msg ? (
          <View style={styles.msgCard}>
            <Text style={styles.msgText}>{msg}</Text>
          </View>
        ) : null}

        {/* Action Buttons */}
        <View style={styles.btnGroup}>
          <TouchableOpacity
            style={[styles.btn, styles.btnRefresh]}
            onPress={handleRefresh}
            disabled={checking}
            activeOpacity={0.85}
          >
            {checking ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <Text style={styles.btnRefreshText}>🔄 রিফ্রেশ করুন</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.btnExit]}
            onPress={onExit}
            activeOpacity={0.85}
          >
            <Text style={styles.btnExitText}>🚪 প্রস্থান / লগইনে ফিরে যান</Text>
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
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(245, 158, 11, 0.35)',
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
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
    marginBottom: 24,
  },
  statusPillText: {
    color: '#fbbf24',
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
    color: '#d4d4d8',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
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
    marginBottom: 20,
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
  msgCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
    width: '100%',
  },
  msgText: {
    color: '#fca5a5',
    fontSize: 12,
    textAlign: 'center',
  },
  btnGroup: {
    width: '100%',
    gap: 12,
  },
  btn: {
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  btnRefresh: {
    backgroundColor: '#ffb703',
  },
  btnRefreshText: {
    color: '#000000',
    fontWeight: 'bold',
    fontSize: 14,
  },
  btnExit: {
    backgroundColor: '#27272a',
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  btnExitText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
});
