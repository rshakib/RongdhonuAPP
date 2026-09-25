import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  BackHandler,
  ActivityIndicator,
  Alert,
  StatusBar as RNStatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function DeviceBlockedScreen({ deviceId, isAdminLock = false, onRecheck, onExit }) {
  const [isChecking, setIsChecking] = useState(false);

  // Prevent back navigation to bypass the block screen
  useEffect(() => {
    const backAction = () => {
      Alert.alert(
        'অ্যাপ বন্ধ করুন',
        'ডিভাইসটি ব্লক করা অবস্থায় ব্যবহারের অনুমতি নেই। আপনি কি অ্যাপ থেকে বের হতে চান?',
        [
          { text: 'না', style: 'cancel' },
          { text: 'হ্যাঁ', onPress: () => BackHandler.exitApp() }
        ]
      );
      return true; // Block hardware back action
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, []);

  const handleRecheckStatus = async () => {
    if (typeof onRecheck === 'function') {
      setIsChecking(true);
      try {
        await onRecheck();
      } catch (err) {
        Alert.alert('ত্রুটি', 'স্ট্যাটাস যাচাই করতে সমস্যা হয়েছে: ' + (err.message || 'নেটওয়ার্ক সমস্যা'));
      } finally {
        setIsChecking(false);
      }
    } else {
      Alert.alert('অপেক্ষারত', 'অ্যাডমিনিস্ট্রেটর আনব্লক না করা পর্যন্ত অপেক্ষা করুন।');
    }
  };

  const handleExitApp = () => {
    if (typeof onExit === 'function') {
      onExit();
    } else {
      BackHandler.exitApp();
    }
  };

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
        <Text style={styles.title}>ডিভাইস ব্লক করা হয়েছে</Text>

        {/* Status Pill */}
        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>
            {isAdminLock ? '✖ স্ট্যাটাস: অ্যাডমিন লকড (হারানো/চুরি ডিভাইস)' : '✖ স্ট্যাটাস: ব্লকড'}
          </Text>
        </View>

        {/* Body Message */}
        <View style={styles.bodyCard}>
          {isAdminLock ? (
            <>
              <Text style={styles.bodyText}>
                এই ডিভাইসের অ্যাক্সেস স্থায়ীভাবে নিষ্ক্রিয় করা হয়েছে।
              </Text>
              <Text style={[styles.bodyText, { marginTop: 8 }]}>
                ডিভাইসটি হারানো অথবা চুরি হিসেবে চিহ্নিত করা হয়েছে।
              </Text>
              <Text style={[styles.bodyText, { marginTop: 10, color: '#a1a1aa' }]}>
                অনুগ্রহ করে সিস্টেম অ্যাডমিনিস্ট্রেটরের সাথে যোগাযোগ করুন।
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.bodyText}>
                এই ডিভাইসটি অ্যাডমিনিস্ট্রেটর কর্তৃক ব্লক করা হয়েছে।
              </Text>
              <Text style={[styles.bodyText, { marginTop: 8 }]}>
                এই ডিভাইস থেকে লগইন বা কোনো অপারেশন পরিচালনা করা যাবে না।
              </Text>
              <Text style={[styles.bodyText, { marginTop: 10, color: '#a1a1aa' }]}>
                পুনরায় সচল করতে অ্যাডমিনিস্ট্রেটরের সাথে যোগাযোগ করুন।
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

        {/* Action Buttons */}
        <View style={styles.btnGroup}>
          <TouchableOpacity
            style={styles.btnRecheck}
            onPress={handleRecheckStatus}
            disabled={isChecking}
            activeOpacity={0.85}
          >
            {isChecking ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.btnRecheckText}>🔄 পুনরায় স্ট্যাটাস যাচাই করুন (Recheck)</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.btnExit}
            onPress={handleExitApp}
            activeOpacity={0.85}
          >
            <Text style={styles.btnExitText}>🚪 অ্যাপ বন্ধ করুন (Exit App)</Text>
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
    gap: 12,
  },
  btnRecheck: {
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  btnRecheckText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  btnExit: {
    backgroundColor: '#27272a',
    borderWidth: 1,
    borderColor: '#3f3f46',
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  btnExitText: {
    color: '#f87171',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
