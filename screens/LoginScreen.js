import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableWithoutFeedback,
  Keyboard,
  Vibration,
  Alert,
  StatusBar as RNStatusBar,
  ActivityIndicator
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import NetInfo from '@react-native-community/netinfo';
import * as LocalAuthentication from 'expo-local-authentication';
import { verifyUserLogin, checkUserExists, getAppConfig, setAppConfig, getPendingSyncCount } from '../database';
import { checkAppVersion, verifyForceReauthLocally } from '../services/firebaseAppConfig';

const BUTTON_SIZE = 72; // Circular buttons sized perfectly to fit all displays

export default function LoginScreen({ onLoginSuccess, forceReauth = false }) {
  const [username, setUsername] = useState('');
  const [isFirstLogin, setIsFirstLogin] = useState(true);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [syncMode, setSyncMode] = useState('online_only');
  const [isVerifying, setIsVerifying] = useState(false);
  const [requiresOnlineCheck, setRequiresOnlineCheck] = useState(false);

  // Fetch remembered user and mode on mount
  useEffect(() => {
    try {
      const savedUser = getAppConfig('remembered_username');
      if (savedUser && savedUser.trim() !== '') {
        setUsername(savedUser);
        setIsFirstLogin(false);
        setRequiresOnlineCheck(false);
      } else {
        setIsFirstLogin(true);
        setRequiresOnlineCheck(true);
      }
    } catch (err) {
      console.error("Failed to load remembered user from SQLite:", err);
      setIsFirstLogin(true);
      setRequiresOnlineCheck(true);
    }

    try {
      const savedMode = getAppConfig('sync_mode');
      if (savedMode === 'hybrid') {
        setSyncMode('hybrid');
      } else {
        setSyncMode('online_only');
      }
    } catch (e) {
      console.error("Failed to load sync_mode:", e);
    }
  }, []);

  const handleModeChange = (newMode) => {
    if (newMode === syncMode) return;

    if (newMode === 'hybrid') {
      try {
        const { checkDeviceOfflinePermission } = require('../services/deviceRegistry');
        const cleanUser = username ? username.trim().toLowerCase() : '';
        let role = '';
        if (cleanUser) {
          const userObj = checkUserExists(cleanUser);
          if (userObj) role = userObj.role;
        }

        const isAllowed = checkDeviceOfflinePermission(role);
        if (!isAllowed) {
          Alert.alert(
            "অফলাইন মোড বন্ধ",
            "অফলাইন মোড সাকিব কর্তৃক বন্ধ করা হয়েছে।\n\nঅনুগ্রহ করে অনলাইন মোড ব্যবহার করুন।",
            [{ text: "ঠিক আছে" }]
          );
          setSyncMode('online_only');
          setAppConfig('sync_mode', 'online_only');
          return;
        }
      } catch (err) {
        console.error("[LoginScreen] Error checking offline permission:", err);
      }
    }
    
    const pendingCount = getPendingSyncCount();
    if (pendingCount > 0) {
      Alert.alert(
        "সতর্কবার্তা",
        `বর্তমানে ${pendingCount} টি Sync Pending আছে।\n\nMode পরিবর্তন করলে কোনো Data Loss হবে না।\n\nPending Sync স্বয়ংক্রিয়ভাবে চলতে থাকবে।`,
        [
          { 
            text: "ঠিক আছে", 
            onPress: () => {
              setSyncMode(newMode);
              setAppConfig('sync_mode', newMode);
            } 
          }
        ]
      );
    } else {
      setSyncMode(newMode);
      setAppConfig('sync_mode', newMode);
    }
  };

  const handleUsernameNext = () => {
    Keyboard.dismiss();
    const cleanUsername = username.trim().toLowerCase();
    if (!cleanUsername) {
      setError('ইউজারনেম লিখুন!');
      return;
    }

    if (!checkUserExists(cleanUsername)) {
      Vibration.vibrate(100);
      setError('ভুল ইউজারনেম! সঠিক নাম লিখুন।');
      return;
    }

    setError('');
    setIsFirstLogin(false);
  };

  const handleKeyPress = (num) => {
    if (pin.length >= 4) return;
    const newPin = pin + num;
    setPin(newPin);

    // Auto-login when the 4th digit is entered
    if (newPin.length === 4) {
      handlePinSubmit(newPin);
    }
  };

  const handleBackspace = () => {
    if (pin.length === 0) return;
    setPin(pin.slice(0, -1));
  };

  const handlePinSubmit = async (enteredPin) => {
    const cleanUsername = username.trim().toLowerCase();
    const cleanPin = enteredPin.trim();

    if (!cleanUsername) {
      setError('ইউজারনেম প্রয়োজন!');
      setPin('');
      return;
    }

    if (syncMode === 'online_only') {
      const state = await NetInfo.fetch();
      const isOnline = state.isConnected && state.isInternetReachable !== false;
      if (!isOnline) {
        Alert.alert(
          "ইন্টারনেট সংযোগ নেই।",
          "এই ডিভাইসটি Online Only মোডে চলছে।\n\nদয়া করে ইন্টারনেট সংযোগ চালু করুন।",
          [{ text: "ঠিক আছে", onPress: () => setPin('') }]
        );
        return;
      }
    }

    // ── ONLINE & VERSION CHECK PATH (New Install, First Login, or Force Reauth) ──
    const isOnlineVersionCheckRequired = forceReauth || requiresOnlineCheck;
    if (isOnlineVersionCheckRequired) {
      setIsVerifying(true);
      try {
        // 1. Must be online
        const state = await NetInfo.fetch();
        const isOnline = state.isConnected && state.isInternetReachable !== false;
        if (!isOnline) {
          setError(
            forceReauth
              ? 'ইন্টারনেট সংযোগ প্রয়োজন। Admin আপনাকে লগ আউট করেছে — পুনরায় লগইন করতে ইন্টারনেট চালু করুন।'
              : 'ইন্টারনেট সংযোগ প্রয়োজন। নতুন অ্যাপে প্রথমবার লগইন করতে ইন্টারনেট চালু করুন।'
          );
          setPin('');
          setIsVerifying(false);
          return;
        }

        // 2. First verify PIN locally — if wrong, reject immediately
        const localUser = verifyUserLogin(cleanUsername, cleanPin);
        if (!localUser) {
          Vibration.vibrate(100);
          setError('ভুল PIN নম্বর! আবার চেষ্টা করুন।');
          setPin('');
          setIsVerifying(false);
          return;
        }

        // 3. Version check — skip for admin
        const userRole = localUser.role;
        if (userRole !== 'admin') {
          const versionResult = await checkAppVersion(userRole);
          if (!versionResult.allowed) {
            Alert.alert(
              "অ্যাপ আপডেট প্রয়োজন 📱",
              `আপনার অ্যাপের ভার্সন (${versionResult.currentVersion}) পুরনো হয়ে গেছে।\n\nনিউনতম প্রয়োজনীয় ভার্সন: ${versionResult.minimumVersion}\n\nঅনুগ্রহ করে অ্যাপটি আপডেট করুন এবং আবার লগইন করুন।`,
              [{ text: "ঠিক আছে", onPress: () => setPin('') }]
            );
            setIsVerifying(false);
            return;
          }
        }

        // 4. Firebase connectivity verify (confirms internet + Firebase up)
        const firebaseResult = await verifyForceReauthLocally(cleanUsername, cleanPin);
        if (!firebaseResult.verified) {
          setError(`Firebase সংযোগ ব্যর্থ: ${firebaseResult.reason || 'পুনরায় চেষ্টা করুন'}`);
          setPin('');
          setIsVerifying(false);
          return;
        }

        // 5. All checks passed — proceed with normal login flow
        setIsVerifying(false);
        // Continue to biometric + session save below using localUser
        const user = localUser;

        if (user.role === 'owner' || user.role === 'admin') {
          try {
            const hasHardware = await LocalAuthentication.hasHardwareAsync();
            const isEnrolled = await LocalAuthentication.isEnrolledAsync();
            if (hasHardware && isEnrolled) {
              const biometricResult = await LocalAuthentication.authenticateAsync({
                promptMessage: 'বায়োমেট্রিক ভেরিফিকেশন প্রয়োজন',
                cancelLabel: 'বাতিল',
                disableDeviceFallback: false,
              });
              if (!biometricResult.success) {
                Alert.alert(
                  "বায়োমেট্রিক ব্যর্থ",
                  "Owner/Admin হিসেবে লগইন করতে বায়োমেট্রিক ভেরিফিকেশন আবশ্যক।",
                  [{ text: "ঠিক আছে", onPress: () => setPin('') }]
                );
                return;
              }
            }
          } catch (e) {
            console.error("[LoginScreen] Biometric auth error:", e);
          }
        }

        try {
          setAppConfig('remembered_username', cleanUsername);
          setAppConfig('login_session_user', cleanUsername);
          setAppConfig('force_reauth_required', '0');
        } catch (e) {
          console.error("Failed to save session:", e);
        }
        setRequiresOnlineCheck(false);
        setError('');
        onLoginSuccess(user.role, user.display_name, syncMode);
        return;

      } catch (err) {
        console.error('[LoginScreen] Reauth / Version check error:', err);
        setError('লগইন প্রক্রিয়ায় ত্রুটি হয়েছে। আবার চেষ্টা করুন।');
        setPin('');
        setIsVerifying(false);
        return;
      }
    }
    // ── END FORCE RE-AUTH PATH ──────────────────────────────────────

    const user = verifyUserLogin(cleanUsername, cleanPin);
    if (user) {
      // Biometric authentication required for owner and admin roles
      if (user.role === 'owner' || user.role === 'admin') {
        try {
          const hasHardware = await LocalAuthentication.hasHardwareAsync();
          const isEnrolled = await LocalAuthentication.isEnrolledAsync();
          
          if (hasHardware && isEnrolled) {
            const biometricResult = await LocalAuthentication.authenticateAsync({
              promptMessage: 'বায়োমেট্রিক ভেরিফিকেশন প্রয়োজন',
              cancelLabel: 'বাতিল',
              disableDeviceFallback: false,
            });
            
            if (!biometricResult.success) {
              Alert.alert(
                "বায়োমেট্রিক ব্যর্থ",
                "Owner/Admin হিসেবে লগইন করতে বায়োমেট্রিক ভেরিফিকেশন আবশ্যক।",
                [{ text: "ঠিক আছে", onPress: () => setPin('') }]
              );
              return;
            }
          } else {
            Alert.alert(
              "বায়োমেট্রিক পাওয়া যায়নি",
              "এই ডিভাইসে বায়োমেট্রিক (ফিঙ্গারপ্রিন্ট/Face ID) সেটআপ করা নেই।\n\nOwner/Admin হিসেবে লগইন করতে বায়োমেট্রিক সেটআপ করুন।",
              [{ text: "ঠিক আছে", onPress: () => setPin('') }]
            );
            return;
          }
        } catch (e) {
          console.error("[LoginScreen] Biometric auth error:", e);
        }
      }

      if (syncMode === 'hybrid') {
        try {
          const { checkDeviceOfflinePermission } = require('../services/deviceRegistry');
          const isAllowed = checkDeviceOfflinePermission(user.role);
          if (!isAllowed) {
            Alert.alert(
              "অফলাইন মোড নিষ্ক্রিয়",
              "অফলাইন মোড সাকিব কর্তৃক নিষ্ক্রিয় করা হয়েছে।\n\nঅনুগ্রহ করে অনলাইন মোড ব্যবহার করুন।",
              [{ text: "ঠিক আছে", onPress: () => setPin('') }]
            );
            setSyncMode('online_only');
            setAppConfig('sync_mode', 'online_only');
            return;
          }
        } catch (e) {}
      }

      try {
        // Save locally for auto-remember
        setAppConfig('remembered_username', cleanUsername);
        setAppConfig('login_session_user', cleanUsername);
      } catch (e) {
        console.error("Failed to save session:", e);
      }
      setError('');
      onLoginSuccess(user.role, user.display_name, syncMode);
    } else {
      Vibration.vibrate(100);
      setError('ভুল PIN নম্বর! আবার চেষ্টা করুন।');
      setPin(''); // Reset keypad dots
    }
  };

  const handleSwitchUser = () => {
    try {
      setAppConfig('remembered_username', '');
      setAppConfig('login_session_user', '');
    } catch (e) {
      console.error("Failed to clear session on Switch User:", e);
    }
    setUsername('');
    setPin('');
    setError('');
    setIsFirstLogin(true);
    setRequiresOnlineCheck(true);
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={styles.container}>
        <StatusBar style="light" />

        {/* Outline doodles background */}
        <View style={styles.doodleOverlay} pointerEvents="none">
          <Text style={[styles.doodle, { top: 60, left: 35 }]}>🍔</Text>
          <Text style={[styles.doodle, { top: 90, right: 140 }]}>🍕</Text>
          <Text style={[styles.doodle, { top: 200, left: 25 }]}>🥤</Text>
          <Text style={[styles.doodle, { top: 220, right: 25 }]}>🍟</Text>
          <Text style={[styles.doodle, { top: 340, left: 30 }]}>🍜</Text>
          <Text style={[styles.doodle, { top: 380, right: 30 }]}>☕</Text>
        </View>

        {/* Top Header Bar with Compact Top-Right Sync Mode Segmented Control */}
        <View style={styles.topHeaderBar}>
          <View style={styles.topHeaderSpacer} />
          <View style={styles.compactSyncPill}>
            <TouchableOpacity 
              style={[styles.compactSyncBtn, syncMode === 'online_only' && styles.compactSyncBtnActive]}
              onPress={() => handleModeChange('online_only')}
              activeOpacity={0.7}
            >
              <Text style={[styles.compactSyncText, syncMode === 'online_only' && styles.compactSyncTextActive]}>
                Online
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.compactSyncBtn, syncMode === 'hybrid' && styles.compactSyncBtnActive]}
              onPress={() => handleModeChange('hybrid')}
              activeOpacity={0.7}
            >
              <Text style={[styles.compactSyncText, syncMode === 'hybrid' && styles.compactSyncTextActive]}>
                Offline
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContainer}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.centerCardArea}>
              {/* 1. Brand Header (Logo, App Name & Subtitle) */}
              <View style={styles.headerBlock}>
                <View style={styles.logoContainer}>
                  <Image
                    source={require('../image/logo.jpeg')}
                    style={styles.logoImg}
                    resizeMode="cover"
                  />
                </View>
                <Text style={styles.brandTitle}>রংধনু</Text>
                <Text style={styles.brandSubtitle}>ক্যাফে এন্ড রেস্টুরেন্ট</Text>
              </View>

              {/* Force Reauth Warning Banner */}
              {forceReauth && (
                <View style={styles.forceReauthBanner}>
                  <Text style={styles.forceReauthBannerIcon}>🔒</Text>
                  <Text style={styles.forceReauthBannerText}>
                    Admin আপনাকে লগ আউট করেছে।{'\n'}পুনরায় লগইন করুন (ইন্টারনেট প্রয়োজন)
                  </Text>
                </View>
              )}

              {/* Verifying Overlay */}
              {isVerifying && (
                <View style={styles.verifyingOverlay}>
                  <ActivityIndicator size="large" color="#FFB703" />
                  <Text style={styles.verifyingText}>Firebase যাচাই করা হচ্ছে...</Text>
                </View>
              )}

              {/* 2. Crossed Fork & Spoon Divider */}
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <View style={styles.dividerIconContainer}>
                  <Text style={styles.dividerIcon}>🍴</Text>
                </View>
                <View style={styles.dividerLine} />
              </View>

              {/* 3. Login Section Area */}
              {isFirstLogin ? (
                /* USERNAME FORM STEP (First Login) */
                <View style={styles.usernameForm}>
                  <Text style={styles.promptText}>ইউজারনেম দিন (Username)</Text>

                  {error ? <Text style={styles.errorText}>{error}</Text> : null}

                  <View style={styles.inputWrapper}>
                    <Text style={styles.inputIcon}>👤</Text>
                    <TextInput
                      style={styles.inputField}
                      placeholder="ইউজারনেম লিখুন"
                      placeholderTextColor="#555555"
                      value={username}
                      onChangeText={(t) => {
                        setUsername(t);
                        setError('');
                      }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="next"
                      onSubmitEditing={handleUsernameNext}
                    />
                  </View>

                  <TouchableOpacity
                    style={styles.nextBtn}
                    onPress={handleUsernameNext}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.nextBtnText}>পরবর্তী ধাপ (Next)</Text>
                    <Text style={styles.nextBtnIcon}>➔</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                /* PIN CODE KEYPAD STEP (Returning Login / PIN Unlock) */
                <View style={styles.keypadForm}>
                  <Text style={styles.promptText}>PIN দিন</Text>

                  {error ? <Text style={styles.errorText}>{error}</Text> : null}

                  {/* 4-Dot PIN Indicator */}
                  <View style={styles.pinDotsRow}>
                    {[1, 2, 3, 4].map((dotIndex) => {
                      const isFilled = pin.length >= dotIndex;
                      return (
                        <View
                          key={dotIndex}
                          style={[
                            styles.pinDot,
                            isFilled ? styles.pinDotFilled : styles.pinDotEmpty,
                          ]}
                        />
                      );
                    })}
                  </View>

                  {/* Grid Keypad */}
                  <View style={styles.keypadGrid}>
                    {/* Row 1 */}
                    <View style={styles.keypadRow}>
                      <TouchableOpacity style={styles.keypadCell} onPress={() => handleKeyPress('1')}>
                        <Text style={styles.keypadNumber}>1</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.keypadCell} onPress={() => handleKeyPress('2')}>
                        <Text style={styles.keypadNumber}>2</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.keypadCell} onPress={() => handleKeyPress('3')}>
                        <Text style={styles.keypadNumber}>3</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Row 2 */}
                    <View style={styles.keypadRow}>
                      <TouchableOpacity style={styles.keypadCell} onPress={() => handleKeyPress('4')}>
                        <Text style={styles.keypadNumber}>4</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.keypadCell} onPress={() => handleKeyPress('5')}>
                        <Text style={styles.keypadNumber}>5</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.keypadCell} onPress={() => handleKeyPress('6')}>
                        <Text style={styles.keypadNumber}>6</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Row 3 */}
                    <View style={styles.keypadRow}>
                      <TouchableOpacity style={styles.keypadCell} onPress={() => handleKeyPress('7')}>
                        <Text style={styles.keypadNumber}>7</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.keypadCell} onPress={() => handleKeyPress('8')}>
                        <Text style={styles.keypadNumber}>8</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.keypadCell} onPress={() => handleKeyPress('9')}>
                        <Text style={styles.keypadNumber}>9</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Row 4 */}
                    <View style={styles.keypadRow}>
                      {/* Dummy Cell */}
                      <View style={[styles.keypadCell, { borderColor: 'transparent', backgroundColor: 'transparent' }]} />
                      
                      <TouchableOpacity style={styles.keypadCell} onPress={() => handleKeyPress('0')}>
                        <Text style={styles.keypadNumber}>0</Text>
                      </TouchableOpacity>

                      <TouchableOpacity style={styles.keypadCell} onPress={handleBackspace}>
                        <Text style={styles.backspaceIcon}>⌫</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Bottom Switch User button */}
                  <TouchableOpacity
                    style={styles.switchUserBtn}
                    onPress={handleSwitchUser}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.switchUserIcon}>👥</Text>
                    <Text style={styles.switchUserText}>Switch User</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Footer / Created By */}
            <View style={styles.footerBlock}>
              <Text style={styles.createdText}>Created by <Text style={styles.createdName}>রিয়াজুল হাসান সাকিব</Text></Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060606', // Premium rich pure black background
  },
  keyboardView: {
    flex: 1,
  },
  topHeaderBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 54 : (RNStatusBar?.currentHeight ? RNStatusBar.currentHeight + 8 : 40),
    paddingBottom: 4,
    zIndex: 10,
  },
  topHeaderSpacer: {
    flex: 1,
  },
  compactSyncPill: {
    flexDirection: 'row',
    backgroundColor: '#121212',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#262626',
    padding: 3,
  },
  compactSyncBtn: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  compactSyncBtnActive: {
    backgroundColor: '#FFD700',
  },
  compactSyncText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#888888',
  },
  compactSyncTextActive: {
    color: '#000000',
    fontWeight: 'bold',
  },
  centerCardArea: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 'auto',
  },
  doodleOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.04, // Ultra subtle doodles for elite look
  },
  doodle: {
    position: 'absolute',
    fontSize: 28,
    color: '#FFD700', // Gold doodle accent
  },
  headerBlock: {
    alignItems: 'center',
    width: '100%',
  },
  logoContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#FFD700',
    backgroundColor: '#0D0D0D',
    marginBottom: 10,
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  logoImg: {
    width: '100%',
    height: '100%',
  },
  brandTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFD700', // True golden color
    letterSpacing: 1.5,
    marginTop: 0,
    textShadowColor: 'rgba(255, 215, 0, 0.2)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  brandSubtitle: {
    fontSize: 14,
    color: '#CCCCCC',
    marginTop: 2,
    fontWeight: '500',
    opacity: 0.9,
    letterSpacing: 0.5,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 14,
    width: '65%',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#FFD700',
    opacity: 0.3,
  },
  dividerIconContainer: {
    borderWidth: 1,
    borderColor: '#FFD700',
    borderRadius: 14,
    padding: 4,
    marginHorizontal: 12,
    opacity: 0.7,
  },
  dividerIcon: {
    fontSize: 12,
    color: '#FFD700',
  },
  promptText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  currentUserLabel: {
    fontSize: 13,
    color: '#FFD700',
    textAlign: 'center',
    fontWeight: 'bold',
    backgroundColor: 'rgba(255, 215, 0, 0.08)',
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 14,
    alignSelf: 'center',
    marginBottom: 10,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 215, 0, 0.2)',
  },
  errorText: {
    color: '#FF4D4D',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 10,
    fontWeight: '600',
    lineHeight: 18,
  },
  forceReauthBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.5)',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    width: '90%',
    gap: 10,
  },
  forceReauthBannerIcon: {
    fontSize: 20,
  },
  forceReauthBannerText: {
    color: '#FCA5A5',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    lineHeight: 19,
  },
  verifyingOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 183, 3, 0.12)',
    borderColor: 'rgba(255, 183, 3, 0.3)',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 10,
    width: '90%',
    gap: 12,
  },
  verifyingText: {
    color: '#FFB703',
    fontSize: 13,
    fontWeight: '600',
  },
  usernameForm: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 4,
  },
  inputWrapper: {
    width: '88%',
    maxWidth: 320,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
    borderWidth: 1.2,
    borderColor: '#262626',
    borderRadius: 14,
    height: 52,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  inputIcon: {
    marginRight: 10,
    fontSize: 16,
    color: '#888',
  },
  inputField: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    height: '100%',
  },
  nextBtn: {
    width: '88%',
    maxWidth: 320,
    flexDirection: 'row',
    backgroundColor: '#FFD700', // Gold filled button
    height: 50,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 3,
  },
  nextBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: 'bold',
    marginRight: 6,
  },
  nextBtnIcon: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
  },
  keypadForm: {
    width: '100%',
    alignItems: 'center',
  },
  pinDotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  pinDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginHorizontal: 12,
  },
  pinDotEmpty: {
    borderWidth: 1.5,
    borderColor: 'rgba(255, 215, 0, 0.4)',
    backgroundColor: 'transparent',
  },
  pinDotFilled: {
    backgroundColor: '#FFD700', // Solid gold dot
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 4,
  },
  keypadGrid: {
    width: '90%',
    maxWidth: 290,
  },
  keypadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  keypadCell: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    borderWidth: 1,
    borderColor: '#262626', // Premium low light circular borders
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
  },
  keypadNumber: {
    fontSize: 26,
    color: '#FFFFFF',
    fontWeight: '400',
  },
  backspaceIcon: {
    fontSize: 20,
    color: '#FFD700', // Gold backspace cross icon
  },
  switchUserBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  switchUserIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  switchUserText: {
    color: '#FFD700',
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  footerBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 8,
  },
  createdText: {
    color: '#555555',
    fontSize: 11,
    letterSpacing: 0.3,
  },
  createdName: {
    color: '#777777',
    fontWeight: '600',
  },
});
