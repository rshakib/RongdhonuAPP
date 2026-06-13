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
  Alert
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import NetInfo from '@react-native-community/netinfo';
import { verifyUserLogin, checkUserExists, getAppConfig, setAppConfig, getPendingSyncCount } from '../database';

const BUTTON_SIZE = 72; // Circular buttons sized perfectly to fit all displays

export default function LoginScreen({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [isFirstLogin, setIsFirstLogin] = useState(true);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [syncMode, setSyncMode] = useState('online_only');

  // Fetch remembered user and mode on mount
  useEffect(() => {
    try {
      const savedUser = getAppConfig('remembered_username');
      if (savedUser && savedUser.trim() !== '') {
        setUsername(savedUser);
        setIsFirstLogin(false);
      } else {
        setIsFirstLogin(true);
      }
    } catch (err) {
      console.error("Failed to load remembered user from SQLite:", err);
      setIsFirstLogin(true);
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
      setError('ইউজারনেম প্রয়োজন!');
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

    const user = verifyUserLogin(cleanUsername, cleanPin);
    if (user) {
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
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={styles.container}>
        <StatusBar style="light" />

        {/* Outline doodles mimicking the visual references background vectors */}
        <View style={styles.doodleOverlay} pointerEvents="none">
          <Text style={[styles.doodle, { top: 60, left: 35 }]}>🍔</Text>
          <Text style={[styles.doodle, { top: 90, right: 35 }]}>🍕</Text>
          <Text style={[styles.doodle, { top: 200, left: 25 }]}>🥤</Text>
          <Text style={[styles.doodle, { top: 220, right: 25 }]}>🍟</Text>
          <Text style={[styles.doodle, { top: 340, left: 30 }]}>🍜</Text>
          <Text style={[styles.doodle, { top: 380, right: 30 }]}>☕</Text>
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
            
            {/* 1. Header (Logo & Brand Names) */}
            <View style={styles.headerBlock}>
              <View style={styles.logoRingOuter}>
                <View style={styles.logoRingInner}>
                  <Image
                    source={require('../image/logo.jpeg')}
                    style={styles.logoImg}
                    resizeMode="cover"
                  />
                </View>
              </View>

              <Text style={styles.brandTitle}>রংধনু</Text>
              <Text style={styles.brandSubtitle}>ক্যাফে এন্ড রেস্টুরেন্ট</Text>
            </View>

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

            {/* Mode Selector Card */}
            <View style={styles.modeSelectorCard}>
              <Text style={styles.modeSelectorTitle}>সিঙ্ক মোড নির্বাচন করুন (Select Sync Mode)</Text>
              <View style={styles.modeSelectorRow}>
                <TouchableOpacity 
                  style={[styles.modeOption, syncMode === 'online_only' && styles.modeOptionActive]}
                  onPress={() => handleModeChange('online_only')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.modeOptionCheck, syncMode === 'online_only' && styles.modeOptionCheckActive]}>
                    {syncMode === 'online_only' ? '☑' : '☐'}
                  </Text>
                  <Text style={[styles.modeOptionText, syncMode === 'online_only' && styles.modeOptionTextActive]}>
                    Online Only
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.modeOption, syncMode === 'hybrid' && styles.modeOptionActive]}
                  onPress={() => handleModeChange('hybrid')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.modeOptionCheck, syncMode === 'hybrid' && styles.modeOptionCheckActive]}>
                    {syncMode === 'hybrid' ? '☑' : '☐'}
                  </Text>
                  <Text style={[styles.modeOptionText, syncMode === 'hybrid' && styles.modeOptionTextActive]}>
                    Online + Offline
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Footer */}
            <Text style={styles.footerText}>ধন্যবাদ আমাদের সাথে থাকার জন্য 💛</Text>
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
  scrollContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 24,
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
  logoRingOuter: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 1.5,
    borderColor: '#FFD700', // Premium Gold boundary
    justifyContent: 'center',
    alignItems: 'center',
    padding: 3,
  },
  logoRingInner: {
    width: '100%',
    height: '100%',
    borderRadius: 50,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#262626',
    backgroundColor: '#0D0D0D',
  },
  logoImg: {
    width: '100%',
    height: '100%',
  },
  brandTitle: {
    fontSize: 34,
    fontWeight: 'bold',
    color: '#FFD700', // True golden color
    letterSpacing: 1.5,
    marginTop: 14,
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
  usernameForm: {
    width: '100%',
    paddingVertical: 10,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
    borderWidth: 1.2,
    borderColor: '#262626',
    borderRadius: 14,
    height: 52,
    marginBottom: 18,
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
    marginBottom: 24,
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
    marginBottom: 14,
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
    marginTop: 20,
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
  footerText: {
    color: '#555555',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 18,
    letterSpacing: 0.5,
  },
  modeSelectorCard: {
    width: '100%',
    backgroundColor: '#0D0D0D',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1F1F1F',
    padding: 16,
    marginTop: 20,
    marginBottom: 10,
    alignItems: 'center',
  },
  modeSelectorTitle: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  modeSelectorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    gap: 10,
  },
  modeOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  modeOptionActive: {
    backgroundColor: 'rgba(255, 215, 0, 0.08)',
    borderColor: '#FFD700',
  },
  modeOptionCheck: {
    fontSize: 16,
    color: '#555555',
    marginRight: 6,
  },
  modeOptionCheckActive: {
    color: '#FFD700',
  },
  modeOptionText: {
    fontSize: 11,
    color: '#888888',
    fontWeight: '500',
  },
  modeOptionTextActive: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
});
