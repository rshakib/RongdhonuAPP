import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import {
  STATUS,
  getStatus,
  subscribe,
  refresh,
  scanAndConnect,
  dismissBanner
} from '../services/printer';

/**
 * components/PrinterStatusBanner.js
 *
 * Shows the latest known printer status. It NEVER scans on its own — connecting
 * requires an explicit tap. Dismissible, and never blocks billing.
 */
export default function PrinterStatusBanner({ onOpenSettings, compact = false }) {
  const [status, setStatus] = useState(() => getStatus());
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribe(setStatus);
    // Only reads the known address — does not scan.
    refresh().then((s) => setStatus(s));
    return unsubscribe;
  }, []);

  const handleConnect = useCallback(async () => {
    setBusy(true);
    try {
      const result = await scanAndConnect();
      if (!result.success && result.message) {
        // Surfaced by the status refresh below; keep the banner informative.
      }
      setStatus(getStatus());
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDismiss = useCallback(async () => {
    setHidden(true);
    await dismissBanner();
  }, []);

  const { status: code, name } = status;

  // Nothing useful to show on a working, verified printer.
  if (hidden) return null;
  if (code === STATUS.CONNECTED_READY && status.verified) return null;

  const view = describe(code, name);

  return (
    <View style={[styles.banner, { borderColor: view.color, backgroundColor: view.bg }, compact && styles.compact]}>
      <View style={styles.textWrap}>
        <Text style={[styles.title, { color: view.color }]}>{view.title}</Text>
        {!!view.subtitle && <Text style={styles.subtitle}>{view.subtitle}</Text>}
      </View>

      <View style={styles.actions}>
        {view.canConnect && (
          <TouchableOpacity style={styles.connectBtn} onPress={handleConnect} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color="#000" size="small" /> : <Text style={styles.connectText}>কানেক্ট</Text>}
          </TouchableOpacity>
        )}
        {onOpenSettings && (
          <TouchableOpacity style={styles.settingsBtn} onPress={onOpenSettings} activeOpacity={0.85}>
            <Text style={styles.settingsText}>⚙️</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.dismissBtn} onPress={handleDismiss} activeOpacity={0.85}>
          <Text style={styles.dismissText}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function describe(code, name) {
  switch (code) {
    case STATUS.CONNECTED_READY:
      return { title: `✅ প্রিন্টার কানেক্টেড — প্রস্তুত`, subtitle: name || null, color: '#34D399', bg: 'rgba(16,185,129,0.10)', canConnect: false };
    case STATUS.FOUND_UNVERIFIED:
      return { title: '🟡 প্রিন্টার কানেক্টেড, তবে যাচাই করা হয়নি', subtitle: 'টেস্ট প্রিন্ট করে যাচাই করুন', color: '#FBBF24', bg: 'rgba(251,191,36,0.10)', canConnect: false };
    case STATUS.PREVIOUSLY_SELECTED_DISCONNECTED:
      return { title: '🔌 আগের প্রিন্টার সংযোগ বিচ্ছিন্ন', subtitle: name ? `নাম: ${name}` : 'আবার কানেক্ট করুন', color: '#FB923C', bg: 'rgba(251,146,60,0.10)', canConnect: true };
    case STATUS.PLATFORM_UNSUPPORTED:
      return { title: '🚫 এই ডিভাইসে ব্লুটুথ প্রিন্টার সাপোর্ট করে না', subtitle: 'Android ডিভাইসে চেষ্টা করুন', color: '#EF4444', bg: 'rgba(239,68,68,0.10)', canConnect: false };
    case STATUS.NOT_CONFIGURED:
    default:
      return { title: '🖨️ প্রিন্টার কনফিগার করা নেই', subtitle: 'কানেক্ট করতে ট্যাপ করুন', color: '#FFB703', bg: 'rgba(255,183,3,0.10)', canConnect: true };
  }
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginHorizontal: 12,
    marginTop: 8
  },
  compact: {
    paddingVertical: 6
  },
  textWrap: {
    flex: 1,
    marginRight: 8
  },
  title: {
    fontSize: 12,
    fontWeight: 'bold'
  },
  subtitle: {
    color: '#9CA3AF',
    fontSize: 10,
    marginTop: 2
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  connectBtn: {
    backgroundColor: '#FFB703',
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 6,
    minWidth: 58,
    alignItems: 'center'
  },
  connectText: {
    color: '#000000',
    fontSize: 11,
    fontWeight: 'bold'
  },
  settingsBtn: {
    paddingHorizontal: 6,
    paddingVertical: 6
  },
  settingsText: {
    fontSize: 14
  },
  dismissBtn: {
    paddingHorizontal: 6,
    paddingVertical: 6
  },
  dismissText: {
    color: '#71717A',
    fontSize: 13,
    fontWeight: 'bold'
  }
});
