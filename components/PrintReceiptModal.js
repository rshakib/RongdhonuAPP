import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import ReceiptPaper from './ReceiptPaper';
import {
  STATUS,
  RECEIPT_RASTER_WIDTH,
  getStatus,
  subscribe,
  refresh,
  scanAndConnect,
  printReceipt,
  openAppSettings
} from '../services/printer';

/**
 * components/PrintReceiptModal.js
 *
 * Preview → confirm → print.
 * The Bengali receipt is captured from the on-screen ReceiptPaper at 384 dots
 * and sent to the thermal printer as an image (the printer has no Bengali font).
 * Never opens a browser print dialog.
 *
 * Reprinting: a manual press ALWAYS prints (force) and the modal stays open, so
 * the same receipt can be printed as many times as needed. The duplicate guard
 * still protects the silent AUTO print, which must never fire twice for one order.
 */
export default function PrintReceiptModal({ visible, order, onClose, showPayment = true, phone }) {
  const [status, setStatus] = useState(() => getStatus());
  const [busy, setBusy] = useState(false);
  const [printed, setPrinted] = useState(false);
  const [copies, setCopies] = useState(0);
  const [error, setError] = useState(null);
  const [needsSettings, setNeedsSettings] = useState(false);

  const paperRef = useRef(null);

  useEffect(() => {
    if (!visible) return;

    setPrinted(false);
    setCopies(0);
    setBusy(false);
    setError(null);
    setStatus(getStatus());

    const unsubscribe = subscribe(setStatus);
    refresh().then(setStatus);

    return unsubscribe;
  }, [visible, order]);

  const getBase64 = useCallback(async () => {
    const ref = paperRef.current;
    if (!ref) throw Object.assign(new Error('Receipt not rendered'), { code: 'CAPTURE_FAILED' });
    return captureRef(ref, {
      format: 'png',
      result: 'base64',
      width: RECEIPT_RASTER_WIDTH,
      quality: 1
    });
  }, []);

  const handlePrint = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const isLiveBill = Boolean(order && (order.isLiveBill || order.paymentMethod === 'বিল' || String(order.id || '').startsWith('BILL-')));
      const orderToPrint = isLiveBill
        ? {
            ...order,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            fullDate: new Date().toISOString().substring(0, 10)
          }
        : order;
      const result = await printReceipt(orderToPrint, { getBase64, force: true });
      if (result.success) {
        setPrinted(true);
        setCopies((c) => c + 1);
      } else {
        setError(result.message || 'প্রিন্ট করা যায়নি');
      }
    } finally {
      setBusy(false);
      setStatus(getStatus());
    }
  }, [order, getBase64]);

  const handleConnect = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNeedsSettings(false);
    try {
      const result = await scanAndConnect();
      if (!result.success) {
        setError(result.message || null);
        setNeedsSettings(
          Boolean(result.canOpenSettings) ||
          result.code === 'BLUETOOTH_PERMISSION_DENIED' ||
          result.code === 'PERMISSION_BLOCKED'
        );
      }
      setStatus(getStatus());
    } finally {
      setBusy(false);
    }
  }, []);

  if (!visible || !order) return null;

  const connected = status.status === STATUS.CONNECTED_READY || status.status === STATUS.FOUND_UNVERIFIED;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>🖨️ রসিদ প্রিন্ট করুন</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeCircle} disabled={busy}>
              <Text style={styles.closeCircleText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Printer status */}
          <View style={[styles.statusBanner, connected ? styles.statusOk : styles.statusOff]}>
            <View style={styles.statusTextWrap}>
              <Text style={[styles.statusTitle, connected ? styles.statusOkText : styles.statusOffText]}>
                {connected ? '✅ প্রিন্টার কানেক্টেড' : '⚠️ প্রিন্টার কানেক্টেড নেই'}
              </Text>
              {connected && !!status.name && <Text style={styles.statusName}>নাম: {status.name}</Text>}
              {connected && !status.verified && (
                <Text style={styles.statusName}>সেটিংস থেকে টেস্ট প্রিন্ট করে যাচাই করুন</Text>
              )}
            </View>
            {!connected && (
              <TouchableOpacity style={styles.connectBtn} onPress={handleConnect} disabled={busy}>
                <Text style={styles.connectBtnText}>কানেক্ট করুন</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.previewLabel}>যা প্রিন্ট হবে:</Text>
          <ScrollView
            style={styles.paperScroll}
            contentContainerStyle={styles.paperScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <ReceiptPaper order={order} width="100%" showPayment={showPayment} phone={phone} />
          </ScrollView>

          {/* Hidden 384px capture source for exact 1:1 thermal head printing */}
          <View style={styles.hiddenCapture} pointerEvents="none">
            <ReceiptPaper ref={paperRef} order={order} width={RECEIPT_RASTER_WIDTH} showPayment={showPayment} phone={phone} />
          </View>

          {!!error && <Text style={styles.errorNote}>⚠️ {error}</Text>}

          {needsSettings && (
            <TouchableOpacity style={styles.settingsBtn} onPress={openAppSettings} activeOpacity={0.85}>
              <Text style={styles.settingsBtnText}>⚙️ অ্যাপ সেটিংস খুলুন</Text>
            </TouchableOpacity>
          )}

          {printed && (
            <Text style={styles.printedNote}>
              ✅ প্রিন্ট সম্পন্ন হয়েছে{copies > 1 ? ` (${copies} কপি)` : ''} — চাইলে আবার প্রিন্ট করুন
            </Text>
          )}

          <TouchableOpacity
            style={[styles.printBtn, busy && styles.btnDisabled]}
            onPress={handlePrint}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy
              ? <ActivityIndicator color="#60A5FA" />
              : <Text style={styles.printBtnText}>{printed ? '🖨️ আরেক কপি প্রিন্ট করুন' : '🖨️ প্রিন্ট করুন'}</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={busy}>
            <Text style={styles.cancelBtnText}>বন্ধ করুন</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16
  },
  card: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '92%',
    backgroundColor: '#0D0D0D',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1F2937',
    padding: 16
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold'
  },
  closeCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center'
  },
  closeCircleText: {
    color: '#888888',
    fontSize: 14,
    fontWeight: 'bold'
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12
  },
  statusOk: {
    backgroundColor: 'rgba(16, 185, 129, 0.10)',
    borderColor: 'rgba(16, 185, 129, 0.4)'
  },
  statusOff: {
    backgroundColor: 'rgba(255, 183, 3, 0.08)',
    borderColor: 'rgba(255, 183, 3, 0.4)'
  },
  statusTextWrap: {
    flex: 1,
    marginRight: 8
  },
  statusTitle: {
    fontSize: 13,
    fontWeight: 'bold'
  },
  statusOkText: {
    color: '#34D399'
  },
  statusOffText: {
    color: '#FFB703'
  },
  statusName: {
    color: '#9CA3AF',
    fontSize: 11,
    marginTop: 2
  },
  connectBtn: {
    backgroundColor: '#FFB703',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  connectBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: 'bold'
  },
  previewLabel: {
    color: '#888888',
    fontSize: 11,
    marginBottom: 6
  },
  paperScroll: {
    maxHeight: 320,
    borderRadius: 10,
    width: '100%'
  },
  paperScrollContent: {
    paddingBottom: 2,
    width: '100%',
    alignItems: 'center'
  },
  errorNote: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 12
  },
  settingsBtn: {
    height: 42,
    borderRadius: 12,
    backgroundColor: '#FFB703',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10
  },
  settingsBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold'
  },
  printedNote: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 12
  },
  printBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14
  },
  btnDisabled: {
    opacity: 0.6
  },
  printBtnText: {
    color: '#60A5FA',
    fontSize: 15,
    fontWeight: 'bold'
  },
  cancelBtn: {
    height: 46,
    borderRadius: 14,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10
  },
  cancelBtnText: {
    color: '#9CA3AF',
    fontSize: 14,
    fontWeight: 'bold'
  },
  hiddenCapture: {
    position: 'absolute',
    left: -10000,
    top: 0,
    width: RECEIPT_RASTER_WIDTH
  }
});
