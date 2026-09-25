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

export default function OfflineVerificationScreen({ onRetry, onExit }) {
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    const backAction = () => {
      Alert.alert(
        'অ্যাপ বন্ধ করুন',
        'সার্ভার সংযোগ নিশ্চিত না হওয়া পর্যন্ত অ্যাপ ব্যবহার করা যাবে না। আপনি কি বের হতে চান?',
        [
          { text: 'না', style: 'cancel' },
          { text: 'হ্যাঁ', onPress: () => BackHandler.exitApp() }
        ]
      );
      return true;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, []);

  const handleRetry = async () => {
    if (typeof onRetry === 'function') {
      setIsRetrying(true);
      try {
        await onRetry();
      } catch (err) {
        Alert.alert('ত্রুটি', 'পুনরায় যাচাই ব্যর্থ হয়েছে: ' + (err.message || 'ইন্টারনেট সমস্যা'));
      } finally {
        setIsRetrying(false);
      }
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <RNStatusBar barStyle="light-content" backgroundColor="#09090b" />

      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Text style={styles.iconEmoji}>📡</Text>
        </View>

        <Text style={styles.title}>সার্ভার সংযোগ প্রয়োজন</Text>
        <Text style={styles.subtitle}>Verification Required (Offline)</Text>

        <View style={styles.bodyCard}>
          <Text style={styles.bodyText}>
            আপনার ডিভাইসের সক্রিয় অনুমতি ও নিরাপত্তা স্ট্যাটাস যাচাই করতে ইন্টারনেট সংযোগ প্রয়োজন।
          </Text>
          <Text style={[styles.bodyText, { marginTop: 8, color: '#94a3b8' }]}>
            সার্ভারের সাথে সংযোগ স্থাপন করা যায়নি। অনুগ্রহ করে আপনার ওয়াইফাই বা মোবাইল ডেটা চেক করুন এবং আবার চেষ্টা করুন।
          </Text>
          <Text style={[styles.noteText, { marginTop: 12 }]}>
            (লক্ষণীয়: আপনার ডিভাইসটি ব্লক করা হয়নি, কেবলমাত্র সংযোগ ব্যর্থ হয়েছে।)
          </Text>
        </View>

        <View style={styles.btnGroup}>
          <TouchableOpacity
            style={styles.btnRetry}
            onPress={handleRetry}
            disabled={isRetrying}
            activeOpacity={0.85}
          >
            {isRetrying ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.btnRetryText}>🔄 পুনরায় চেষ্টা করুন (Retry)</Text>
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
    backgroundColor: '#09090b',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(234, 179, 8, 0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(234, 179, 8, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  iconEmoji: {
    fontSize: 40,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f8fafc',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#94a3b8',
    marginTop: 4,
    marginBottom: 24,
  },
  bodyCard: {
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 16,
    padding: 18,
    width: '100%',
    marginBottom: 28,
  },
  bodyText: {
    color: '#f1f5f9',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    fontWeight: '500',
  },
  noteText: {
    color: '#eab308',
    fontSize: 12.5,
    textAlign: 'center',
    fontWeight: '600',
  },
  btnGroup: {
    width: '100%',
    gap: 12,
  },
  btnRetry: {
    backgroundColor: '#eab308',
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  btnRetryText: {
    color: '#09090b',
    fontWeight: '800',
    fontSize: 15,
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
    color: '#94a3b8',
    fontWeight: '600',
    fontSize: 14,
  },
});

