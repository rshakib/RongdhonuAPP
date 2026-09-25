import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
  Alert,
  BackHandler,
  StatusBar as RNStatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { APP_VERSION, checkAppVersionPolicy } from '../services/firebaseAppConfig';

export default function AppUpdateRequiredScreen({ policy, onUpdateSuccess }) {
  const [isChecking, setIsChecking] = useState(false);
  const [currentPolicy, setCurrentPolicy] = useState(policy || {});

  // Prevent back navigation to bypass the update screen
  useEffect(() => {
    const backAction = () => {
      Alert.alert(
        'অ্যাপ বন্ধ করুন',
        'অ্যাপ আপডেট না করা পর্যন্ত ব্যবহার করা সম্ভব নয়। আপনি কি অ্যাপ থেকে বের হতে চান?',
        [
          { text: 'না', style: 'cancel' },
          { text: 'হ্যাঁ', onPress: () => BackHandler.exitApp() }
        ]
      );
      return true; // Prevent default back behavior
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, []);

  const handleOpenUpdateUrl = async () => {
    const url = currentPolicy.update_url || 'https://github.com/rshakib/RongdhonuAPP/releases';
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        // Fallback open
        await Linking.openURL(url);
      }
    } catch (err) {
      Alert.alert('ত্রুটি', 'আপডেট লিঙ্ক খুলতে সমস্যা হয়েছে: ' + (err.message || 'URL Invalid'));
    }
  };

  const handleRecheck = async () => {
    setIsChecking(true);
    try {
      const res = await checkAppVersionPolicy();
      if (res.policy) {
        setCurrentPolicy(res.policy);
      }
      if (!res.updateRequired) {
        Alert.alert('✅ সফল', 'আপনার অ্যাপ সংস্করণ অনুমোদিত।', [
          { text: 'প্রবেশ করুন', onPress: () => onUpdateSuccess && onUpdateSuccess() }
        ]);
      } else {
        Alert.alert(
          '❌ আপডেট প্রয়োজন',
          `বর্তমান সংস্করণ (${APP_VERSION}) এখনো প্রয়োজনীয় সংস্করণ (${res.minimumVersion}) এর চেয়ে কম। অনুগ্রহ করে আপডেট করুন।`
        );
      }
    } catch (err) {
      Alert.alert('ত্রুটি', 'যাচাই করতে ব্যর্থ হয়েছে: ' + (err.message || 'নেটওয়ার্ক ত্রুটি'));
    } finally {
      setIsChecking(false);
    }
  };

  const minVersion = currentPolicy.minimum_required_version || '1.0.4';
  const customMessage = currentPolicy.update_message || 'একটি নতুন সংস্করণ পাওয়া গেছে। অ্যাপ্লিকেশন ব্যবহার চালিয়ে যেতে অনুগ্রহ করে আপডেট করুন।';

  return (
    <SafeAreaView style={styles.container}>
      <RNStatusBar barStyle="light-content" backgroundColor="#09090b" />

      <View style={styles.content}>
        {/* Update Icon Badge */}
        <View style={styles.iconCircle}>
          <Text style={styles.iconEmoji}>🚀</Text>
        </View>

        {/* Title */}
        <Text style={styles.title}>App Update Required</Text>
        <Text style={styles.subtitle}>অ্যাপ আপডেট প্রয়োজন</Text>

        {/* Version Info Card */}
        <View style={styles.versionCard}>
          <View style={styles.versionRow}>
            <Text style={styles.versionLabel}>ইনস্টল করা সংস্করণ (Installed):</Text>
            <View style={[styles.badge, styles.badgeOld]}>
              <Text style={styles.badgeOldText}>v{APP_VERSION}</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.versionRow}>
            <Text style={styles.versionLabel}>প্রয়োজনীয় সংস্করণ (Required):</Text>
            <View style={[styles.badge, styles.badgeRequired]}>
              <Text style={styles.badgeRequiredText}>v{minVersion}+</Text>
            </View>
          </View>
        </View>

        {/* Custom Message Card */}
        <View style={styles.messageBox}>
          <Text style={styles.messageText}>{customMessage}</Text>
        </View>

        {/* Action Buttons */}
        <View style={styles.btnGroup}>
          <TouchableOpacity
            style={styles.btnUpdate}
            onPress={handleOpenUpdateUrl}
            activeOpacity={0.85}
          >
            <Text style={styles.btnUpdateText}>📲 অ্যাপ আপডেট করুন (Update App)</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.btnRecheck}
            onPress={handleRecheck}
            disabled={isChecking}
            activeOpacity={0.85}
          >
            {isChecking ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.btnRecheckText}>🔄 পুনরায় পরীক্ষা করুন (Recheck)</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.btnExit}
            onPress={() => BackHandler.exitApp()}
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
    backgroundColor: '#09090b'
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderWidth: 2,
    borderColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20
  },
  iconEmoji: {
    fontSize: 40
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f8fafc',
    textAlign: 'center',
    letterSpacing: 0.5
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#94a3b8',
    marginTop: 4,
    marginBottom: 24
  },
  versionCard: {
    width: '100%',
    backgroundColor: '#18181b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27272a',
    padding: 16,
    marginBottom: 16
  },
  versionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  versionLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#cbd5e1'
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8
  },
  badgeOld: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)'
  },
  badgeOldText: {
    color: '#f87171',
    fontWeight: '700',
    fontSize: 13
  },
  badgeRequired: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)'
  },
  badgeRequiredText: {
    color: '#34d399',
    fontWeight: '700',
    fontSize: 13
  },
  divider: {
    height: 1,
    backgroundColor: '#27272a',
    marginVertical: 12
  },
  messageBox: {
    width: '100%',
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.25)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 28
  },
  messageText: {
    color: '#e2e8f0',
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: 'center'
  },
  btnGroup: {
    width: '100%',
    gap: 12
  },
  btnUpdate: {
    backgroundColor: '#4f46e5',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#4f46e5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4
  },
  btnUpdateText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700'
  },
  btnRecheck: {
    backgroundColor: '#27272a',
    borderWidth: 1,
    borderColor: '#3f3f46',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center'
  },
  btnRecheckText: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '600'
  },
  btnExit: {
    backgroundColor: 'transparent',
    paddingVertical: 10,
    alignItems: 'center'
  },
  btnExitText: {
    color: '#71717a',
    fontSize: 13,
    fontWeight: '500'
  }
});

