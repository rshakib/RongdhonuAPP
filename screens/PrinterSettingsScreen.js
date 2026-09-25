import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  StatusBar as RNStatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import ReceiptPaper from '../components/ReceiptPaper';
import {
  STATUS,
  RECEIPT_RASTER_WIDTH,
  getStatus,
  subscribe,
  refresh,
  scanForDevices,
  connectDevice,
  autoConnectSavedPrinter,
  connectKnown,
  disconnect,
  forget,
  printTestReceipt,
  confirmPhysicalTest,
  openAppSettings,
  watchConnection,
  computeButtonStates,
  getDisabledReason,
  getBluetoothDetectionReport,
  isAudioDevice,
  getDiagnosticLogs,
  clearDiagnosticLogs,
  subscribeDiagnostics,
  getDiagnosticCheckpoints
} from '../services/printer';

const TEST_ORDER = {
  id: 'PRINTER-TEST',
  tableId: 'TEST',
  fullDate: new Date().toISOString().substring(0, 10),
  time: 'TEST PRINT',
  items: [
    { name: 'প্রিন্টার টেস্ট রসিদ', qty: 1, price: 0, total: 0 },
    { name: 'বাংলা লেখা পরীক্ষা', qty: 1, price: 0, total: 0 }
  ],
  totalAmount: 0,
  paidAmount: 0,
  paymentMethod: 'TEST'
};

/**
 * Format timestamp to a human-readable date and time string.
 * Example: 24 Sep 2026 • 12:52 AM
 */
function formatTestDate(timestamp) {
  if (!timestamp) return null;
  try {
    const d = new Date(timestamp);
    const day = d.getDate();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = d.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const minStr = minutes < 10 ? `0${minutes}` : minutes;
    return `${day} ${month} ${year} • ${hours}:${minStr} ${ampm}`;
  } catch (e) {
    return String(timestamp);
  }
}

/**
 * Formats a device address safely for user display.
 * Strips transport schemes and masks middle octets.
 */
function formatMaskedAddress(address) {
  if (!address) return '';
  const clean = String(address).trim().replace(/^(bt:|ble:|tcp:|lan:)/i, '');
  const parts = clean.split(':');
  if (parts.length === 6) {
    return `${parts[0]}:${parts[1]}:••:••:••:${parts[5]}`;
  }
  return clean.replace(/.(?=.{4})/g, '•');
}

export default function PrinterSettingsScreen({ onBack }) {
  const [status, setStatus] = useState(() => getStatus());
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const [showSettingsAction, setShowSettingsAction] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);

  // Device picker modal & scanning states
  const [deviceModalVisible, setDeviceModalVisible] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pairedDevices, setPairedDevices] = useState([]);
  const [foundDevices, setFoundDevices] = useState([]);
  const [connectingAddress, setConnectingAddress] = useState(null);
  const [scanError, setScanError] = useState(null);

  // Collapsed Developer / Advanced Diagnostics (Hidden by default)
  const [showDiag, setShowDiag] = useState(false);
  const [detectionReport, setDetectionReport] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [diagLogs, setDiagLogs] = useState(() => getDiagnosticLogs());
  const [diagCheckpoints, setDiagCheckpoints] = useState(() => getDiagnosticCheckpoints());

  const testPaperRef = useRef(null);
  const autoConnectAttemptedRef = useRef(false);

  // Subscribe to background diagnostics for developer panel
  useEffect(() => {
    const unsubDiag = subscribeDiagnostics((logs, checkpoints) => {
      setDiagLogs(logs);
      if (checkpoints) setDiagCheckpoints(checkpoints);
    });
    return () => { unsubDiag(); };
  }, []);

  // Initial status synchronization and non-blocking auto-connect on open
  useEffect(() => {
    const unsubStatus = subscribe(setStatus);
    const unsubConnection = watchConnection();

    refresh().then(async (currentStatus) => {
      setStatus(currentStatus);

      // Attempt auto-connect to saved printer once on open
      if (!autoConnectAttemptedRef.current && currentStatus.address && !currentStatus.connected) {
        autoConnectAttemptedRef.current = true;
        setBusy('autoconnect');
        try {
          const res = await autoConnectSavedPrinter({ timeout: 6000 });
          if (res && res.success) {
            setMessage('✅ প্রিন্টারের সাথে কানেক্ট হয়েছে');
          } else if (res && !res.alreadyConnected) {
            // Keep status without noisy banner
          }
        } catch (e) {
          // Silent fallback
        } finally {
          setBusy('');
          setStatus(getStatus());
        }
      }
    });

    return () => {
      unsubStatus();
      unsubConnection();
    };
  }, []);

  const runDetectionTest = useCallback(async () => {
    setDetecting(true);
    try {
      const report = await getBluetoothDetectionReport();
      setDetectionReport(report);
    } catch (err) {
      // Ignored in user UI
    } finally {
      setDetecting(false);
    }
  }, []);

  const run = useCallback(async (label, fn) => {
    setBusy(label);
    setMessage(null);
    setShowSettingsAction(false);
    try {
      const result = await fn();
      if (result && result.success === false && result.message) {
        setMessage(result.message);
        setShowSettingsAction(
          Boolean(result.canOpenSettings) ||
          result.code === 'BLUETOOTH_PERMISSION_DENIED' ||
          result.code === 'PERMISSION_BLOCKED'
        );
      } else if (result && result.message) {
        setMessage(result.message);
      }
      setStatus(getStatus());
      return result;
    } catch (err) {
      setMessage(err && err.message ? err.message : 'কিছু একটা ভুল হয়েছে');
      return null;
    } finally {
      setBusy('');
    }
  }, []);

  // Scan for Bluetooth devices
  const handleScanDevices = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    setShowSettingsAction(false);
    try {
      const result = await scanForDevices();
      if (result.success) {
        setPairedDevices(result.paired || []);
        setFoundDevices(result.found || []);
      } else {
        setScanError(result.message || 'ডিভাইস খোঁজা ব্যর্থ হয়েছে');
        setShowSettingsAction(
          Boolean(result.canOpenSettings) ||
          result.code === 'BLUETOOTH_PERMISSION_DENIED' ||
          result.code === 'PERMISSION_BLOCKED'
        );
      }
    } catch (err) {
      setScanError(err.message || 'ডিভাইস খোঁজা ব্যর্থ হয়েছে');
    } finally {
      setScanning(false);
    }
  }, []);

  // Open device picker modal
  const openDevicePicker = useCallback(() => {
    const states = computeButtonStates({ status, busy, scanning });
    if (!states.canConnect) {
      setMessage(getDisabledReason('connect', { status, busy, scanning }));
      return;
    }
    setDeviceModalVisible(true);
    handleScanDevices();
  }, [status, busy, scanning, handleScanDevices]);

  // Select device from list
  const handleSelectDevice = useCallback(async (device) => {
    if (connectingAddress) return;
    if (isAudioDevice(device)) {
      setScanError(`এটি অডিও ডিভাইস (${device.name || 'AirPods'}) — থার্মাল প্রিন্টার নয়।`);
      return;
    }
    setConnectingAddress(device.address);
    setScanError(null);
    try {
      const result = await connectDevice(device, { timeout: 12000 });
      if (result && result.success) {
        setDeviceModalVisible(false);
        setMessage(`✅ "${device.name || 'প্রিন্টার'}" সফলভাবে কানেক্ট হয়েছে`);
      } else {
        setScanError(result.message || 'প্রিন্টারের সাথে কানেক্ট করা যায়নি');
        setShowSettingsAction(
          Boolean(result.canOpenSettings) ||
          result.code === 'BLUETOOTH_PERMISSION_DENIED' ||
          result.code === 'PERMISSION_BLOCKED'
        );
      }
    } catch (err) {
      setScanError(err.message || 'কানেকশন ব্যর্থ হয়েছে');
    } finally {
      setConnectingAddress(null);
      setStatus(getStatus());
    }
  }, [connectingAddress]);

  const buttonStates = computeButtonStates({ status, busy, scanning });

  const handleReconnectPress = useCallback(() => {
    if (!buttonStates.canReconnect) {
      setMessage(getDisabledReason('reconnect', { status, busy, scanning }));
      return;
    }
    run('reconnect', () => connectKnown());
  }, [buttonStates.canReconnect, status, busy, scanning, run]);

  const handleDisconnectPress = useCallback(() => {
    if (!buttonStates.canDisconnect) {
      setMessage(getDisabledReason('disconnect', { status, busy, scanning }));
      return;
    }
    run('disconnect', async () => {
      await disconnect();
      return { success: true, message: 'প্রিন্টার সংযোগ বিচ্ছিন্ন করা হয়েছে' };
    });
  }, [buttonStates.canDisconnect, status, busy, scanning, run]);

  const handleTestPrintPress = useCallback(() => {
    if (!buttonStates.canTestPrint) {
      setMessage(getDisabledReason('test', { status, busy, scanning }));
      return;
    }
    run('test', async () => {
      const ref = testPaperRef.current;
      if (!ref) return { success: false, message: 'টেস্ট রসিদ তৈরি করা যায়নি' };
      const getBase64 = () => captureRef(ref, {
        format: 'png',
        result: 'base64',
        width: RECEIPT_RASTER_WIDTH,
        quality: 1
      });
      const result = await printTestReceipt({ getBase64 });
      if (result.success) {
        setConfirmVisible(true);
        return { success: true, message: 'টেস্ট রসিদ পাঠানো হয়েছে — কাগজ বের হয়েছে কিনা দেখুন' };
      }
      return result;
    });
  }, [buttonStates.canTestPrint, status, busy, scanning, run]);

  const handleForgetPress = useCallback(() => {
    if (!buttonStates.canForget) {
      setMessage(getDisabledReason('forget', { status, busy, scanning }));
      return;
    }
    run('forget', async () => {
      await forget();
      return { success: true, message: 'সংরক্ষিত প্রিন্টার মুছে ফেলা হয়েছে' };
    });
  }, [buttonStates.canForget, status, busy, scanning, run]);

  const handleConfirm = useCallback(async (printed) => {
    setConfirmVisible(false);
    await confirmPhysicalTest(printed);
    setStatus(getStatus());
    setMessage(printed ? '✅ প্রিন্টারের কাজ যাচাই সম্পন্ন হয়েছে' : 'যাচাই করা হয়নি — আবার চেষ্টা করুন');
  }, []);

  const isConnected = status.status === STATUS.CONNECTED_READY || status.status === STATUS.FOUND_UNVERIFIED;
  const isSavedDisconnected = status.status === STATUS.PREVIOUSLY_SELECTED_DISCONNECTED || (Boolean(status.address) && !isConnected);

  // Filter out all audio devices (AirPods, headsets, earbuds) from the user-facing device picker list
  const userPrintersPaired = useMemo(
    () => pairedDevices.filter((d) => !isAudioDevice(d)),
    [pairedDevices]
  );
  const userPrintersFound = useMemo(
    () => foundDevices.filter((d) => !isAudioDevice(d)),
    [foundDevices]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <RNStatusBar barStyle="light-content" backgroundColor="#0B0B0C" />

      {/* Screen Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.headerIconBtn} activeOpacity={0.7}>
          <Text style={styles.headerIconText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleGroup}>
          <Text style={styles.headerTitle}>প্রিন্টার সেটিংস</Text>
          <Text style={styles.headerSubtitle}>থার্মাল রসিদ প্রিন্টার (৫৮ মিমি)</Text>
        </View>
      </View>

      <ScrollView style={styles.scrollBody} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        
        {/* User Alert / Status Message */}
        {!!message && (
          <View style={styles.messageBox}>
            <Text style={styles.messageText}>{message}</Text>
            {showSettingsAction && (
              <TouchableOpacity style={styles.permissionBtn} onPress={openAppSettings} activeOpacity={0.85}>
                <Text style={styles.permissionBtnText}>⚙️ অ্যাপ সেটিংস খুলুন</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ==========================================
            1. STATUS CARD (Prominent State Indicator)
           ========================================== */}
        <View style={styles.card}>
          <Text style={styles.cardSectionLabel}>প্রিন্টার স্ট্যাটাস</Text>
          
          <View style={styles.statusHeroRow}>
            <View style={[styles.statusDot, { backgroundColor: isConnected ? '#34D399' : '#F87171' }]} />
            <Text style={[styles.statusHeroTitle, { color: isConnected ? '#34D399' : '#F87171' }]}>
              {busy === 'autoconnect'
                ? 'সংরক্ষিত প্রিন্টারে কানেক্ট করা হচ্ছে…'
                : status.connecting
                ? 'সংযোগ করা হচ্ছে…'
                : isConnected
                ? 'প্রিন্টার সংযুক্ত'
                : 'প্রিন্টার সংযুক্ত নয়'}
            </Text>
          </View>

          {/* Connected Printer Summary */}
          {Boolean(status.name || status.address) && (
            <View style={styles.statusInfoBlock}>
              <Text style={styles.statusDeviceName}>
                {status.name || 'Bluetooth Printer'}
              </Text>
              <Text style={styles.statusDeviceMeta}>
                Bluetooth Classic (SPP)
                {status.address ? ` • ${formatMaskedAddress(status.address)}` : ''}
              </Text>
            </View>
          )}

          {/* Contextual Connection Action Buttons (Only one primary action shown at a time) */}
          <View style={styles.actionButtonGroup}>
            {isConnected ? (
              <TouchableOpacity
                style={[styles.btn, styles.btnDanger]}
                onPress={handleDisconnectPress}
                activeOpacity={0.85}
                disabled={Boolean(busy)}
              >
                {busy === 'disconnect' ? (
                  <ActivityIndicator color="#F87171" />
                ) : (
                  <Text style={styles.btnDangerText}>🔌 সংযোগ বিচ্ছিন্ন করুন</Text>
                )}
              </TouchableOpacity>
            ) : isSavedDisconnected ? (
              <>
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary]}
                  onPress={handleReconnectPress}
                  activeOpacity={0.85}
                  disabled={Boolean(busy)}
                >
                  {busy === 'reconnect' ? (
                    <ActivityIndicator color="#000000" />
                  ) : (
                    <Text style={styles.btnPrimaryText}>🔄 আবার কানেক্ট করুন</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryLinkBtn}
                  onPress={openDevicePicker}
                  activeOpacity={0.7}
                  disabled={Boolean(busy)}
                >
                  <Text style={styles.secondaryLinkText}>নতুন প্রিন্টার নির্বাচন করুন →</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary]}
                onPress={openDevicePicker}
                activeOpacity={0.85}
                disabled={Boolean(busy)}
              >
                {busy === 'connect' ? (
                  <ActivityIndicator color="#000000" />
                ) : (
                  <Text style={styles.btnPrimaryText}>🔍 প্রিন্টার কানেক্ট করুন</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ==========================================
            2. PRINTER CARD (Selected Printer & Change)
           ========================================== */}
        <View style={styles.card}>
          <Text style={styles.cardSectionLabel}>নির্বাচিত প্রিন্টার</Text>
          
          <View style={styles.printerRow}>
            <View style={styles.printerIconWrap}>
              <Text style={styles.printerIconText}>🖨️</Text>
            </View>
            <View style={styles.printerDetailsWrap}>
              <Text style={styles.printerPrimaryName}>
                {status.name || (status.address ? 'সংরক্ষিত প্রিন্টার' : 'কোনো প্রিন্টার যুক্ত নেই')}
              </Text>
              <Text style={styles.printerSubMeta}>
                {status.transport
                  ? `Bluetooth ${status.transport === 'bt' ? 'Classic (SPP)' : String(status.transport).toUpperCase()}`
                  : 'Bluetooth Classic (SPP)'}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.btn, styles.btnOutline]}
            onPress={openDevicePicker}
            activeOpacity={0.85}
            disabled={Boolean(busy)}
          >
            <Text style={styles.btnOutlineText}>
              {status.name || status.address ? '🔄 পরিবর্তন করুন' : '🔍 প্রিন্টার নির্বাচন করুন'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ==========================================
            3. TEST CARD (Test Print & Verification)
           ========================================== */}
        <View style={styles.card}>
          <Text style={styles.cardSectionLabel}>প্রিন্ট পরীক্ষা</Text>
          <Text style={styles.cardDescription}>
            প্রিন্টার ঠিকভাবে কাজ করছে কিনা ও বাংলা রসিদ সঠিকভাবে প্রিন্ট হচ্ছে কিনা পরীক্ষা করুন।
          </Text>

          <TouchableOpacity
            style={[
              styles.btn,
              buttonStates.canTestPrint ? styles.btnSuccess : styles.btnDisabled
            ]}
            onPress={handleTestPrintPress}
            activeOpacity={0.85}
            disabled={!buttonStates.canTestPrint || Boolean(busy)}
          >
            {busy === 'test' ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={[styles.btnText, buttonStates.canTestPrint ? styles.btnSuccessText : styles.btnDisabledText]}>
                🧾 টেস্ট রসিদ প্রিন্ট করুন
              </Text>
            )}
          </TouchableOpacity>

          {!isConnected && (
            <Text style={styles.helperNote}>
              ⚠️ টেস্ট রসিদ প্রিন্ট করতে প্রথমে প্রিন্টার কানেক্ট করুন।
            </Text>
          )}

          {/* Last Test Information Block */}
          <View style={styles.lastTestContainer}>
            <Text style={styles.lastTestTitle}>সর্বশেষ পরীক্ষা</Text>
            
            <View style={styles.lastTestStatusRow}>
              {status.testConfirmedAt ? (
                <View style={styles.testBadgeSuccess}>
                  <Text style={styles.testBadgeSuccessText}>✓ সফল (যাচাই সম্পন্ন)</Text>
                </View>
              ) : status.testTransmittedAt ? (
                <View style={styles.testBadgePending}>
                  <Text style={styles.testBadgePendingText}>⚠️ টেস্ট পাঠানো হয়েছে (যাচাই বাকি)</Text>
                </View>
              ) : (
                <Text style={styles.testStatusMuted}>এখনো পরীক্ষা করা হয়নি</Text>
              )}
            </View>

            {(status.testConfirmedAt || status.testTransmittedAt) && (
              <Text style={styles.lastTestTime}>
                সময়: {formatTestDate(status.testConfirmedAt || status.testTransmittedAt)}
              </Text>
            )}
          </View>
        </View>

        {/* ==========================================
            4. HELP & GUIDANCE CARD
           ========================================== */}
        <View style={styles.card}>
          <Text style={styles.cardSectionLabel}>সহায়ক তথ্য</Text>
          <Text style={styles.helpText}>
            Bluetooth Classic (SPP) প্রিন্টারের ক্ষেত্রে প্রথমবার ফোনের Settings → Bluetooth থেকে প্রিন্টারটি <Text style={styles.boldText}>Pair</Text> করে নিতে হবে। পেয়ার করা থাকলে এই পেজ থেকে সরাসরি সংযুক্ত করা যাবে।
          </Text>
        </View>

        {/* ==========================================
            5. ADVANCED / DIAGNOSTICS (Collapsed by default)
           ========================================== */}
        <View style={styles.advancedCard}>
          <TouchableOpacity
            style={styles.advancedHeader}
            onPress={() => setShowDiag((prev) => !prev)}
            activeOpacity={0.8}
          >
            <View style={styles.advancedHeaderLeft}>
              <Text style={styles.advancedHeaderTitle}>🛠️ উন্নত সেটিংস ও ডায়াগনস্টিক</Text>
              <Text style={styles.advancedHeaderSubtitle}>হার্ডওয়্যার চেকলিস্ট ও লগ (টেকনিক্যাল)</Text>
            </View>
            <Text style={styles.advancedToggleChevron}>{showDiag ? '▲ লুকান' : '▼ দেখুন'}</Text>
          </TouchableOpacity>

          {showDiag && (
            <View style={styles.advancedBody}>
              {/* Forget saved printer button */}
              {buttonStates.canForget && (
                <View style={styles.advancedSubSection}>
                  <Text style={styles.advancedSubTitle}>সংরক্ষিত প্রিন্টার ব্যবস্থাপনা</Text>
                  <TouchableOpacity
                    style={styles.forgetBtn}
                    onPress={handleForgetPress}
                    activeOpacity={0.85}
                  >
                    {busy === 'forget' ? (
                      <ActivityIndicator color="#F87171" size="small" />
                    ) : (
                      <Text style={styles.forgetBtnText}>🗑️ সংরক্ষিত প্রিন্টার মুছে ফেলুন</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              {/* Hardware Connection Info */}
              <View style={styles.advancedSubSection}>
                <Text style={styles.advancedSubTitle}>হার্ডওয়্যার লিংক তথ্য</Text>
                <Text style={styles.techRow}>প্রিন্টার: <Text style={styles.techVal}>{status.name || 'নেই'}</Text></Text>
                <Text style={styles.techRow}>ঠিকানা: <Text style={styles.techVal}>{status.address || 'নেই'}</Text></Text>
                <Text style={styles.techRow}>ট্রান্সপোর্ট: <Text style={styles.techVal}>{status.transport ? String(status.transport).toUpperCase() : 'অজানা'}</Text></Text>
                <Text style={styles.techRow}>সকেট লিংক: <Text style={[styles.techVal, { color: status.connected ? '#34D399' : '#F87171' }]}>
                  {status.connected ? 'সক্রিয় (Active Socket)' : 'সংযোগহীন (Closed)'}
                </Text></Text>
              </View>

              {/* 10-Point Acceptance Checkpoints */}
              <View style={styles.advancedSubSection}>
                <Text style={styles.advancedSubTitle}>📋 ১০-দফা হার্ডওয়্যার একসেপ্টেন্স চেকলিস্ট</Text>
                {diagCheckpoints.map((cp) => {
                  let badgeBg = '#334155';
                  let badgeColor = '#94A3B8';
                  if (cp.status === 'PASS' || cp.status === 'READY') {
                    badgeBg = '#065F46';
                    badgeColor = '#34D399';
                  } else if (cp.status === 'FAIL') {
                    badgeBg = '#7F1D1D';
                    badgeColor = '#F87171';
                  } else if (cp.status === 'RUNNING') {
                    badgeBg = '#1E3A8A';
                    badgeColor = '#60A5FA';
                  }

                  return (
                    <View key={`cp-${cp.id}`} style={styles.diagCheckpointItem}>
                      <View style={styles.diagCheckpointHeader}>
                        <Text style={styles.diagCheckpointLabel}>{cp.label}</Text>
                        <View style={[styles.diagCheckpointBadge, { backgroundColor: badgeBg }]}>
                          <Text style={[styles.diagCheckpointBadgeText, { color: badgeColor }]}>{cp.status}</Text>
                        </View>
                      </View>
                      <Text style={styles.diagCheckpointDetail} selectable={true}>{cp.detail}</Text>
                    </View>
                  );
                })}
              </View>

              {/* Live Log Stream & Clear */}
              <View style={styles.advancedSubSection}>
                <View style={styles.diagLogHeaderRow}>
                  <Text style={styles.advancedSubTitle}>লাইভ হার্ডওয়্যার ইভেন্ট লগ</Text>
                  <TouchableOpacity
                    style={styles.diagClearBtn}
                    onPress={() => clearDiagnosticLogs()}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.diagClearBtnText}>🗑️ লগ মুছুন</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.diagLogsContainer}>
                  {diagLogs.length === 0 ? (
                    <Text style={styles.diagEmptyText}>কোনো লগ ইভেন্ট রেকর্ড হয়নি।</Text>
                  ) : (
                    diagLogs.slice(0, 15).map((log) => {
                      const timeStr = log.timestamp ? log.timestamp.split('T')[1].slice(0, 8) : '';
                      return (
                        <View key={log.id} style={styles.diagLogRow}>
                          <Text style={styles.diagLogLine} selectable={true}>
                            [{timeStr}] {log.type}: {log.name || log.wireAddress || ''} {log.error ? `(${log.error})` : ''}
                          </Text>
                        </View>
                      );
                    })
                  )}
                </View>
              </View>
            </View>
          )}
        </View>

      </ScrollView>

      {/* Hidden 384-dot capture source for the test receipt */}
      <View style={styles.hiddenCapture} pointerEvents="none">
        <ReceiptPaper ref={testPaperRef} order={TEST_ORDER} width={RECEIPT_RASTER_WIDTH} />
      </View>

      {/* Physical Output Confirmation Modal */}
      <Modal visible={confirmVisible} transparent animationType="fade" onRequestClose={() => setConfirmVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModalBox}>
            <Text style={styles.confirmModalTitle}>কাগজ বের হয়েছে কি?</Text>
            <Text style={styles.confirmModalMessage}>প্রিন্টার থেকে টেস্ট রসিদটি সফলভাবে বের হয়েছে কিনা নিশ্চিত করুন।</Text>
            <TouchableOpacity style={[styles.btn, styles.btnSuccess]} onPress={() => handleConfirm(true)}>
              <Text style={styles.btnSuccessText}>হ্যাঁ, রসিদ বের হয়েছে</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnOutline, { marginTop: 8 }]} onPress={() => handleConfirm(false)}>
              <Text style={styles.btnOutlineText}>না, বের হয়নি</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ========================================================
          Clean Bluetooth Printer Selection Modal (Audio filtered)
         ======================================================== */}
      <Modal
        visible={deviceModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!connectingAddress) setDeviceModalVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.devicePickerBox}>
            {/* Modal Header */}
            <View style={styles.devicePickerHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pickerTitle}>প্রিন্টার নির্বাচন করুন</Text>
                <Text style={styles.pickerSubtitle}>তালিকা থেকে আপনার থার্মাল প্রিন্টারটি বেছে নিন</Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => {
                  if (!connectingAddress) setDeviceModalVisible(false);
                }}
                disabled={Boolean(connectingAddress)}
              >
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Error Message */}
            {!!scanError && (
              <View style={styles.scanErrorBox}>
                <Text style={styles.scanErrorText}>{scanError}</Text>
                {showSettingsAction && (
                  <TouchableOpacity style={styles.permissionBtn} onPress={openAppSettings} activeOpacity={0.85}>
                    <Text style={styles.permissionBtnText}>⚙️ অ্যাপ সেটিংস খুলুন</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Scan Progress Bar & Rescan Button */}
            <View style={styles.scanActionBar}>
              <Text style={styles.scanStatusText}>
                {scanning ? '⏳ আশেপাশের ডিভাইস খোঁজা হচ্ছে…' : 'ডিভাইস স্ক্যান সম্পন্ন'}
              </Text>
              <TouchableOpacity
                style={[styles.rescanBtn, (scanning || Boolean(connectingAddress)) && styles.rescanBtnDisabled]}
                onPress={handleScanDevices}
                disabled={scanning || Boolean(connectingAddress)}
              >
                {scanning ? (
                  <ActivityIndicator size="small" color="#FFB703" />
                ) : (
                  <Text style={styles.rescanBtnText}>🔄 আবার খুঁজুন</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Filtered Printer List (Audio devices are strictly excluded) */}
            <ScrollView style={styles.deviceListScroll} showsVerticalScrollIndicator={false}>
              {/* Paired Printers */}
              {userPrintersPaired.length > 0 && (
                <View style={styles.deviceSection}>
                  <Text style={styles.deviceSectionTitle}>
                    পেয়ার করা প্রিন্টার ({userPrintersPaired.length})
                  </Text>
                  {userPrintersPaired.map((device, idx) => {
                    const isTarget = connectingAddress === device.address;
                    return (
                      <TouchableOpacity
                        key={`paired-${device.address || idx}`}
                        style={[styles.deviceItem, isTarget && styles.deviceItemActive]}
                        onPress={() => handleSelectDevice(device)}
                        disabled={Boolean(connectingAddress)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.deviceInfo}>
                          <View style={styles.deviceTitleRow}>
                            <Text style={styles.deviceItemIcon}>🖨️</Text>
                            <Text style={styles.deviceName}>{device.name || 'Bluetooth Printer'}</Text>
                          </View>
                          <Text style={styles.deviceMeta}>
                            Bluetooth Classic (SPP) • {formatMaskedAddress(device.address)}
                          </Text>
                        </View>
                        {isTarget ? (
                          <ActivityIndicator color="#34D399" />
                        ) : (
                          <View style={styles.selectBtnBadge}>
                            <Text style={styles.selectBtnBadgeText}>কানেক্ট</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Discovered / Found Printers */}
              {userPrintersFound.length > 0 && (
                <View style={styles.deviceSection}>
                  <Text style={styles.deviceSectionTitle}>
                    নতুন পাওয়া প্রিন্টার ({userPrintersFound.length})
                  </Text>
                  {userPrintersFound.map((device, idx) => {
                    const isTarget = connectingAddress === device.address;
                    return (
                      <TouchableOpacity
                        key={`found-${device.address || idx}`}
                        style={[styles.deviceItem, isTarget && styles.deviceItemActive]}
                        onPress={() => handleSelectDevice(device)}
                        disabled={Boolean(connectingAddress)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.deviceInfo}>
                          <View style={styles.deviceTitleRow}>
                            <Text style={styles.deviceItemIcon}>🖨️</Text>
                            <Text style={styles.deviceName}>{device.name || 'Bluetooth Printer'}</Text>
                          </View>
                          <Text style={styles.deviceMeta}>
                            {String(device.deviceType || 'BT').toUpperCase()} • {formatMaskedAddress(device.address)}
                          </Text>
                        </View>
                        {isTarget ? (
                          <ActivityIndicator color="#34D399" />
                        ) : (
                          <View style={styles.selectBtnBadge}>
                            <Text style={styles.selectBtnBadgeText}>কানেক্ট</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Clean Empty State */}
              {!scanning && userPrintersPaired.length === 0 && userPrintersFound.length === 0 && (
                <View style={styles.emptyStateBox}>
                  <Text style={styles.emptyStateTitle}>কোনো প্রিন্টার পাওয়া যায়নি</Text>
                  <Text style={styles.emptyStateHelp}>
                    ১. ফোনের ব্লুটুথ ও প্রিন্টার চালু আছে কিনা পরীক্ষা করুন।{'\n'}
                    ২. ফোনের Settings → Bluetooth থেকে প্রিন্টারটি আগে পেয়ার (Pair) করে নিন।{'\n'}
                    ৩. পেয়ার করার পর "আবার খুঁজুন" বাটনে চাপ দিন।
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0B0C'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#1E1E22',
    backgroundColor: '#0B0B0C'
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#161618',
    borderWidth: 1,
    borderColor: '#26262A',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12
  },
  headerIconText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold'
  },
  headerTitleGroup: {
    flex: 1
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: 'bold'
  },
  headerSubtitle: {
    color: '#71717A',
    fontSize: 12,
    marginTop: 2
  },
  scrollBody: {
    flex: 1
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 40
  },

  // Cards
  card: {
    backgroundColor: '#161618',
    borderWidth: 1,
    borderColor: '#26262A',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14
  },
  cardSectionLabel: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10
  },
  cardDescription: {
    color: '#9CA3AF',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12
  },

  // Status Card Specifics
  statusHeroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8
  },
  statusHeroTitle: {
    fontSize: 18,
    fontWeight: 'bold'
  },
  statusInfoBlock: {
    backgroundColor: '#1E1E22',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2D2D33'
  },
  statusDeviceName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold'
  },
  statusDeviceMeta: {
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 3
  },
  actionButtonGroup: {
    marginTop: 4
  },
  secondaryLinkBtn: {
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 4
  },
  secondaryLinkText: {
    color: '#60A5FA',
    fontSize: 13,
    fontWeight: '600'
  },

  // Printer Card Specifics
  printerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14
  },
  printerIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#222226',
    borderWidth: 1,
    borderColor: '#2F2F36',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12
  },
  printerIconText: {
    fontSize: 22
  },
  printerDetailsWrap: {
    flex: 1
  },
  printerPrimaryName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold'
  },
  printerSubMeta: {
    color: '#71717A',
    fontSize: 12,
    marginTop: 2
  },

  // Buttons
  btn: {
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  btnText: {
    fontSize: 14,
    fontWeight: 'bold'
  },
  btnPrimary: {
    backgroundColor: '#FFB703'
  },
  btnPrimaryText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: 'bold'
  },
  btnSuccess: {
    backgroundColor: '#059669'
  },
  btnSuccessText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold'
  },
  btnDanger: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.4)'
  },
  btnDangerText: {
    color: '#F87171',
    fontSize: 14,
    fontWeight: 'bold'
  },
  btnOutline: {
    backgroundColor: '#1E1E22',
    borderWidth: 1,
    borderColor: '#38383E'
  },
  btnOutlineText: {
    color: '#E4E4E7',
    fontSize: 13,
    fontWeight: '600'
  },
  btnDisabled: {
    backgroundColor: '#1C1C20',
    borderWidth: 1,
    borderColor: '#2A2A30'
  },
  btnDisabledText: {
    color: '#52525B'
  },

  helperNote: {
    color: '#EAB308',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center'
  },

  // Last Test Section
  lastTestContainer: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: '#242428'
  },
  lastTestTitle: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6
  },
  lastTestStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4
  },
  testBadgeSuccess: {
    backgroundColor: 'rgba(52,211,153,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.3)'
  },
  testBadgeSuccessText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: 'bold'
  },
  testBadgePending: {
    backgroundColor: 'rgba(251,191,36,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.3)'
  },
  testBadgePendingText: {
    color: '#FBBF24',
    fontSize: 12,
    fontWeight: 'bold'
  },
  testStatusMuted: {
    color: '#71717A',
    fontSize: 12
  },
  lastTestTime: {
    color: '#9CA3AF',
    fontSize: 11,
    marginTop: 2
  },

  // Messages & Alerts
  messageBox: {
    backgroundColor: 'rgba(96,165,250,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.35)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14
  },
  messageText: {
    color: '#60A5FA',
    fontSize: 13,
    fontWeight: '600'
  },
  permissionBtn: {
    marginTop: 10,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#FFB703',
    alignItems: 'center',
    justifyContent: 'center'
  },
  permissionBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: 'bold'
  },
  helpText: {
    color: '#9CA3AF',
    fontSize: 13,
    lineHeight: 19
  },
  boldText: {
    color: '#FFB703',
    fontWeight: 'bold'
  },

  // Advanced / Diagnostics Collapsible
  advancedCard: {
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#222226',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14
  },
  advancedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  advancedHeaderLeft: {
    flex: 1
  },
  advancedHeaderTitle: {
    color: '#71717A',
    fontSize: 13,
    fontWeight: 'bold'
  },
  advancedHeaderSubtitle: {
    color: '#52525B',
    fontSize: 11,
    marginTop: 2
  },
  advancedToggleChevron: {
    color: '#71717A',
    fontSize: 12,
    fontWeight: 'bold'
  },
  advancedBody: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: '#1E1E22'
  },
  advancedSubSection: {
    marginBottom: 14
  },
  advancedSubTitle: {
    color: '#A1A1AA',
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 8,
    textTransform: 'uppercase'
  },
  forgetBtn: {
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  forgetBtnText: {
    color: '#F87171',
    fontSize: 12,
    fontWeight: 'bold'
  },
  techRow: {
    color: '#71717A',
    fontSize: 11,
    marginTop: 3
  },
  techVal: {
    color: '#E4E4E7',
    fontWeight: '600'
  },
  diagCheckpointItem: {
    borderBottomWidth: 1,
    borderColor: '#1E1E22',
    paddingVertical: 5
  },
  diagCheckpointHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  diagCheckpointLabel: {
    color: '#D4D4D8',
    fontSize: 11
  },
  diagCheckpointBadge: {
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1
  },
  diagCheckpointBadgeText: {
    fontSize: 9,
    fontWeight: 'bold'
  },
  diagCheckpointDetail: {
    color: '#71717A',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 2
  },
  diagLogHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  diagClearBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#1E1E22',
    borderRadius: 6
  },
  diagClearBtnText: {
    color: '#A1A1AA',
    fontSize: 10
  },
  diagLogsContainer: {
    backgroundColor: '#09090B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E1E22',
    padding: 8,
    maxHeight: 180
  },
  diagEmptyText: {
    color: '#52525B',
    fontSize: 11,
    fontStyle: 'italic',
    padding: 6
  },
  diagLogRow: {
    paddingVertical: 2
  },
  diagLogLine: {
    color: '#9CA3AF',
    fontSize: 10,
    fontFamily: 'monospace'
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16
  },
  confirmModalBox: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#18181B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#26262A',
    padding: 18
  },
  confirmModalTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 6
  },
  confirmModalMessage: {
    color: '#A1A1AA',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16
  },

  // Device Picker Modal
  devicePickerBox: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    backgroundColor: '#161618',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2E2E32',
    padding: 16
  },
  devicePickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderColor: '#26262A'
  },
  pickerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold'
  },
  pickerSubtitle: {
    color: '#A1A1AA',
    fontSize: 12,
    marginTop: 2
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#26262A',
    alignItems: 'center',
    justifyContent: 'center'
  },
  closeBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold'
  },
  scanActionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10
  },
  scanStatusText: {
    color: '#A1A1AA',
    fontSize: 12
  },
  rescanBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#222226',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#38383E'
  },
  rescanBtnDisabled: {
    opacity: 0.5
  },
  rescanBtnText: {
    color: '#FFB703',
    fontSize: 12,
    fontWeight: 'bold'
  },
  scanErrorBox: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    marginBottom: 6
  },
  scanErrorText: {
    color: '#F87171',
    fontSize: 12,
    fontWeight: '600'
  },
  deviceListScroll: {
    maxHeight: 380
  },
  deviceSection: {
    marginTop: 8
  },
  deviceSectionTitle: {
    color: '#FFB703',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
    letterSpacing: 0.5
  },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E1E22',
    borderWidth: 1,
    borderColor: '#2D2D33',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8
  },
  deviceItemActive: {
    borderColor: '#34D399',
    backgroundColor: '#13281E'
  },
  deviceInfo: {
    flex: 1,
    marginRight: 10
  },
  deviceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  deviceItemIcon: {
    fontSize: 16,
    marginRight: 6
  },
  deviceName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold'
  },
  deviceMeta: {
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 3
  },
  selectBtnBadge: {
    backgroundColor: '#FFB703',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8
  },
  selectBtnBadgeText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: 'bold'
  },
  emptyStateBox: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 12
  },
  emptyStateTitle: {
    color: '#E4E4E7',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 6
  },
  emptyStateHelp: {
    color: '#8E8E93',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center'
  },
  hiddenCapture: {
    position: 'absolute',
    left: -10000,
    top: 0,
    width: RECEIPT_RASTER_WIDTH
  }
});
