/**
 * screens/BackupRestoreScreen.js
 * SQLite Backup & Restore Screen for Rongdhonu POS
 *
 * Implements:
 * 1. "Backup Data" action: exports all local tables to user-controlled persistent storage.
 * 2. "Restore Data" action: native document picker to select .db backup file.
 * 3. Pre-flight validation modal showing backup date, version, tables, and record count.
 * 4. Transaction-safe atomic restore with explicit user confirmation.
 * 5. Strict preservation of user credentials, device registration, and auth tokens.
 * 6. "Firebase → Supabase (one day)": pull ONE business day out of Firebase and upsert it
 *    into the app's (single) Supabase project.
 *
 * NOTE: single-Supabase build — there is no DB1/DB2 choice; everything goes to the one
 * Supabase project this app is configured with.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Database,
  Download,
  Upload,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Calendar,
  Layers,
  HardDrive,
  ArrowLeft,
  RefreshCw,
  Clock,
  X,
} from 'lucide-react-native';

import {
  createBackup,
  pickAndValidateBackup,
  restoreBackup,
  getBackupStatus,
  cleanupInspectBackup,
} from '../services/backupRestore';
import {
  pushFirebaseDayToSupabase,
  previewFirebaseDay,
  todayLocal,
  yesterdayLocal,
  shiftDay,
  isValidDay,
} from '../services/firebaseDayRestore';
import { formatDayBn } from '../services/calendarGrid';
import CalendarPicker from '../components/CalendarPicker';
import { pushLocalToSupabase } from '../services/localToSupabase';

export default function BackupRestoreScreen({ onBack, onRefreshAppState }) {
  const [status, setStatus] = useState(getBackupStatus());
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Validation modal state
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [validatedData, setValidatedData] = useState(null);

  // ─── FIREBASE → SUPABASE (one day) state ───────────────────────────────────
  const [fbDay, setFbDay] = useState(todayLocal());
  const [fbBusy, setFbBusy] = useState(null);         // null | 'preview' | 'push'
  const [fbProgress, setFbProgress] = useState(null);
  const [fbPreview, setFbPreview] = useState(null);
  const [fbReport, setFbReport] = useState(null);
  const [calOpen, setCalOpen] = useState(false);

  // ─── LOCAL (SQLite) → SUPABASE (last N days) state ─────────────────────────
  const [localBusy, setLocalBusy] = useState(false);
  const [localProgress, setLocalProgress] = useState(null);
  const [localReport, setLocalReport] = useState(null);
  const LOCAL_DAYS = 31;

  const refreshStatus = useCallback(() => {
    setStatus(getBackupStatus());
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // ─── 1. HANDLE BACKUP ──────────────────────────────────────────────────────

  const handleBackup = async () => {
    if (isBackingUp || isRestoring || isValidating) return;

    setIsBackingUp(true);
    try {
      const result = await createBackup();
      if (result.success) {
        refreshStatus();
        Alert.alert(
          'ব্যাকআপ সম্পন্ন হয়েছে (Backup Successful)',
          `ফাইলটি সফলভাবে এক্সপোর্ট করা হয়েছে:\n${result.fileName}\n\nমোট টেবিল: ${result.metadata.total_tables}\nমোট রেকর্ড: ${result.metadata.total_records.toLocaleString()}`,
          [{ text: 'ঠিক আছে (OK)' }]
        );
      } else {
        Alert.alert(
          'ব্যাকআপ ব্যর্থ হয়েছে (Backup Failed)',
          result.error || 'অজানা ত্রুটি ঘটেছে।'
        );
      }
    } catch (err) {
      Alert.alert(
        'ব্যাকআপ ত্রুটি (Backup Error)',
        err.message || 'ডাটাবেজ ব্যাকআপ সম্পন্ন করা যায়নি।'
      );
    } finally {
      setIsBackingUp(false);
    }
  };

  // ─── 2. HANDLE SELECT FILE FOR RESTORE ──────────────────────────────────────

  const handlePickForRestore = async () => {
    if (isBackingUp || isRestoring || isValidating) return;

    setIsValidating(true);
    try {
      const validation = await pickAndValidateBackup();

      if (validation.canceled) {
        return;
      }

      if (!validation.valid) {
        Alert.alert(
          'অকার্যকর ব্যাকআপ ফাইল (Invalid Backup)',
          validation.error || 'এই ফাইলটি রংধনু ব্যাকআপ হিসেবে বৈধ নয়।',
          [{ text: 'ঠিক আছে (OK)' }]
        );
        return;
      }

      setValidatedData(validation);
      setPreviewModalVisible(true);
    } catch (err) {
      Alert.alert(
        'ভ্যালিডেশন ত্রুটি (Validation Error)',
        err.message || 'ফাইলটি যাচাই করা যায়নি।'
      );
    } finally {
      setIsValidating(false);
    }
  };

  // ─── 3. CONFIRM & EXECUTE ATOMIC RESTORE ───────────────────────────────────

  const handleCancelModal = () => {
    if (validatedData && validatedData.inspectDbName) {
      cleanupInspectBackup(validatedData.inspectDbName).catch(() => {});
    }
    setPreviewModalVisible(false);
    setValidatedData(null);
  };

  const handleConfirmRestore = async () => {
    if (!validatedData || !validatedData.inspectDbName) return;

    setPreviewModalVisible(false);
    setIsRestoring(true);

    try {
      const result = await restoreBackup(
        validatedData.inspectDbName,
        validatedData
      );

      if (result.success) {
        refreshStatus();
        if (onRefreshAppState) {
          try { onRefreshAppState(); } catch (_) {}
        }

        Alert.alert(
          'রিস্টোর সম্পন্ন হয়েছে (Restore Complete)',
          `ডাটাবেজ সফলভাবে রিস্টোর হয়েছে।\nমোট রিস্টোরকৃত রেকর্ড: ${result.totalRestored.toLocaleString()}\n\nনিরাপত্তা সতর্কতা: ইউজার লগইন এবং ডিভাইস রেজিস্ট্রেশন নিরাপদ রাখা হয়েছে।`,
          [{ text: 'ঠিক আছে (OK)' }]
        );
      } else {
        Alert.alert(
          'রিস্টোর ব্যর্থ হয়েছে (Restore Failed)',
          result.error || 'ডাটাবেজ রিস্টোর করা সম্ভব হয়নি। পূর্বের ডাটা অপরিবর্তিত রয়েছে।'
        );
      }
    } catch (err) {
      Alert.alert(
        'রিস্টোর ত্রুটি (Restore Error)',
        err.message || 'ডাটাবেজ রিস্টোর করার সময় ত্রুটি ঘটেছে।'
      );
    } finally {
      setIsRestoring(false);
      setValidatedData(null);
    }
  };

  // ─── 4. FIREBASE → SUPABASE: ONE DAY ───────────────────────────────────────

  // READ-ONLY: how much data Firebase actually holds for that day (writes nothing).
  const handleFbPreview = async () => {
    if (fbBusy || isBackingUp || isRestoring || isValidating) return;
    if (!isValidDay(fbDay)) {
      Alert.alert('তারিখ ঠিক নয়', 'তারিখ YYYY-MM-DD ফরম্যাটে দিন। উদাহরণ: 2026-09-30');
      return;
    }
    setFbBusy('preview');
    setFbPreview(null);
    setFbReport(null);
    setFbProgress(null);
    try {
      const res = await previewFirebaseDay({
        day: fbDay,
        onProgress: (p) => setFbProgress(`${p.table} (${p.index}/${p.totalTables})`),
      });
      setFbPreview(res);
    } catch (err) {
      Alert.alert('যাচাই ব্যর্থ', err.message || 'Firebase থেকে পড়া যায়নি।');
    } finally {
      setFbBusy(null);
      setFbProgress(null);
    }
  };

  const runFbPush = async () => {
    setFbBusy('push');
    setFbReport(null);
    setFbProgress(null);
    try {
      const res = await pushFirebaseDayToSupabase({
        day: fbDay,
        onProgress: (p) => setFbProgress(`${p.table} (${p.pushed}/${p.fetched})`),
      });
      setFbReport(res);
    } catch (err) {
      Alert.alert('পুশ ব্যর্থ', err.message || 'ডেটা পাঠানো যায়নি।');
    } finally {
      setFbBusy(null);
      setFbProgress(null);
    }
  };

  const handleFbPush = () => {
    if (fbBusy || isBackingUp || isRestoring || isValidating) return;
    if (!isValidDay(fbDay)) {
      Alert.alert('তারিখ ঠিক নয়', 'তারিখ YYYY-MM-DD ফরম্যাটে দিন। উদাহরণ: 2026-09-30');
      return;
    }
    Alert.alert(
      'নিশ্চিত করুন',
      `${fbDay} তারিখের ডেটা Firebase থেকে এনে Supabase-এ লেখা হবে।\n\nএটি upsert — একই ডেটা আবার লিখলেও কোনো ক্ষতি হবে না।`,
      [
        { text: 'বাতিল', style: 'cancel' },
        { text: 'পুশ করুন', onPress: () => { runFbPush(); } },
      ]
    );
  };

  // ─── 5. LOCAL SQLite → SUPABASE (last 31 days) ─────────────────────────────

  const runLocalPush = async () => {
    setLocalBusy(true);
    setLocalReport(null);
    setLocalProgress(null);
    try {
      const res = await pushLocalToSupabase({
        days: LOCAL_DAYS,
        onProgress: (p) => setLocalProgress(`${p.table} (${p.index}/${p.totalTables})`),
      });
      setLocalReport(res);
    } catch (err) {
      Alert.alert('Push ব্যর্থ', err.message || 'ডেটা পাঠানো যায়নি।');
    } finally {
      setLocalBusy(false);
      setLocalProgress(null);
    }
  };

  const handleLocalPush = () => {
    if (localBusy || isBackingUp || isRestoring || isValidating) return;
    Alert.alert(
      'নিশ্চিত করুন',
      `তোমার লোকাল SQLite থেকে শেষ ${LOCAL_DAYS} দিনের ডেটা Supabase-এ push করা হবে।\n\nযেগুলো Supabase-এ আগেই আছে সেগুলো skip হবে (শুধু না-থাকা row যাবে)।`,
      [
        { text: 'বাতিল', style: 'cancel' },
        { text: 'Push করুন', onPress: () => { runLocalPush(); } },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* ── HEADER ────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>❮ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>ব্যাকআপ ও রিস্টোর</Text>
        <TouchableOpacity onPress={refreshStatus} style={styles.refreshBtn}>
          <Text style={styles.refreshBtnText}>🔄</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        showsVerticalScrollIndicator={false}
      >
        {/* ── STATUS CARD ──────────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.iconCircleGold}>
              <HardDrive size={18} color="#FFB703" strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>ডাটাবেজ স্ট্যাটাস</Text>
              <Text style={styles.cardSubtitle}>
                Active Profile: {status.appProfile}
              </Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.statusRow}>
            <View style={styles.statusLeft}>
              <Clock size={14} color="#888888" strokeWidth={2} />
              <Text style={styles.statusLabel}>সর্বশেষ ব্যাকআপ:</Text>
            </View>
            <Text style={styles.statusValue}>{status.lastBackupDisplay}</Text>
          </View>

          {status.lastBackupFile !== 'None' && (
            <View style={styles.statusRow}>
              <View style={styles.statusLeft}>
                <FileText size={14} color="#888888" strokeWidth={2} />
                <Text style={styles.statusLabel}>ফাইল নাম:</Text>
              </View>
              <Text style={[styles.statusValue, styles.fileNameText]} numberOfLines={1}>
                {status.lastBackupFile}
              </Text>
            </View>
          )}

          <View style={styles.statusRow}>
            <View style={styles.statusLeft}>
              <RefreshCw size={14} color="#888888" strokeWidth={2} />
              <Text style={styles.statusLabel}>সর্বশেষ রিস্টোর:</Text>
            </View>
            <Text style={styles.statusValue}>{status.lastRestoreDisplay}</Text>
          </View>
        </View>

        {/* ── ACTION BUTTONS ───────────────────────────────── */}
        <View style={styles.actionsContainer}>
          {/* Backup Button */}
          <TouchableOpacity
            style={[styles.actionBtn, styles.backupBtn]}
            onPress={handleBackup}
            disabled={isBackingUp || isRestoring || isValidating}
            activeOpacity={0.8}
          >
            {isBackingUp ? (
              <ActivityIndicator color="#000000" size="small" />
            ) : (
              <>
                <View style={styles.btnIconWrapGold}>
                  <Download size={20} color="#000000" strokeWidth={2.5} />
                </View>
                <View style={styles.btnTextGroup}>
                  <Text style={styles.backupBtnTitle}>ডাটা ব্যাকআপ করুন</Text>
                  <Text style={styles.backupBtnSubtitle}>
                    Google Drive, Downloads বা মেমরিতে সেভ করুন
                  </Text>
                </View>
              </>
            )}
          </TouchableOpacity>

          {/* Restore Button */}
          <TouchableOpacity
            style={[styles.actionBtn, styles.restoreBtn]}
            onPress={handlePickForRestore}
            disabled={isBackingUp || isRestoring || isValidating}
            activeOpacity={0.8}
          >
            {isValidating || isRestoring ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <View style={styles.btnIconWrapBlue}>
                  <Upload size={20} color="#FFB703" strokeWidth={2.5} />
                </View>
                <View style={styles.btnTextGroup}>
                  <Text style={styles.restoreBtnTitle}>ডাটা রিস্টোর করুন</Text>
                  <Text style={styles.restoreBtnSubtitle}>
                    পূর্বে সেভ করা .db ফাইল সিলেক্ট করুন
                  </Text>
                </View>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* ── FIREBASE → SUPABASE (ONE DAY) ────────────────── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.iconCircleGold}>
              <Calendar size={18} color="#FFB703" strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Firebase থেকে একদিনের ডেটা</Text>
              <Text style={styles.cardSubtitle}>
                তারিখ বেছে নিন — শুধু ওই দিনের ডেটা Firebase থেকে এনে Supabase-এ লেখা হবে
              </Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.fbDateRow}>
            <TouchableOpacity
              style={styles.fbStepBtn}
              onPress={() => setFbDay(shiftDay(fbDay, -1))}
              activeOpacity={0.8}
            >
              <Text style={styles.fbStepBtnText}>−১</Text>
            </TouchableOpacity>

            <TextInput
              style={styles.fbInput}
              value={fbDay}
              onChangeText={setFbDay}
              placeholder="2026-09-30"
              placeholderTextColor="#666666"
              autoCorrect={false}
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
            />

            <TouchableOpacity
              style={styles.fbStepBtn}
              onPress={() => setFbDay(shiftDay(fbDay, 1))}
              activeOpacity={0.8}
            >
              <Text style={styles.fbStepBtnText}>+১</Text>
            </TouchableOpacity>

            {/* Calendar (dependency-free) — the easy way to pick a past date. */}
            <TouchableOpacity
              style={styles.fbCalBtn}
              onPress={() => setCalOpen(true)}
              activeOpacity={0.8}
            >
              <Calendar size={18} color="#000000" strokeWidth={2.5} />
            </TouchableOpacity>
          </View>

          <View style={styles.fbQuickRow}>
            <TouchableOpacity style={styles.fbQuickBtn} onPress={() => setFbDay(todayLocal())} activeOpacity={0.8}>
              <Text style={styles.fbQuickBtnText}>আজ</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.fbQuickBtn} onPress={() => setFbDay(yesterdayLocal())} activeOpacity={0.8}>
              <Text style={styles.fbQuickBtnText}>গতকাল</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.fbQuickBtn} onPress={() => setCalOpen(true)} activeOpacity={0.8}>
              <Text style={styles.fbQuickBtnText}>📅 ক্যালেন্ডার</Text>
            </TouchableOpacity>
            <Text style={styles.fbHint}>
              {isValidDay(fbDay) ? `✅ ${formatDayBn(fbDay)}` : 'YYYY-MM-DD দিন'}
            </Text>
          </View>

          <View style={styles.fbBtnRow}>
            <TouchableOpacity
              style={[styles.fbPreviewBtn, !!fbBusy && styles.fbBtnDisabled]}
              onPress={handleFbPreview}
              disabled={!!fbBusy}
              activeOpacity={0.8}
            >
              {fbBusy === 'preview' ? (
                <ActivityIndicator color="#FFB703" size="small" />
              ) : (
                <Text style={styles.fbPreviewBtnText}>যাচাই করুন</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.fbPushBtn, !!fbBusy && styles.fbBtnDisabled]}
              onPress={handleFbPush}
              disabled={!!fbBusy}
              activeOpacity={0.8}
            >
              {fbBusy === 'push' ? (
                <ActivityIndicator color="#000000" size="small" />
              ) : (
                <Text style={styles.fbPushBtnText}>Supabase-এ পুশ করুন</Text>
              )}
            </TouchableOpacity>
          </View>

          {fbProgress ? <Text style={styles.fbProgress}>⏳ {fbProgress}</Text> : null}

          {fbPreview ? (
            <View style={styles.fbResultBox}>
              <Text style={styles.fbResultTitle}>
                {fbPreview.ok
                  ? `Firebase-এ পাওয়া গেছে: ${fbPreview.totalFetched} টি রেকর্ড`
                  : (fbPreview.error || 'যাচাই করা যায়নি')}
              </Text>
              {(fbPreview.tables || []).filter((t) => t.fetched > 0 || t.error).map((t) => (
                <Text key={t.table} style={styles.fbResultLine}>
                  {t.error ? '⚠' : '•'} {t.table}: {t.fetched}{t.error ? ` — ${t.error}` : ''}
                </Text>
              ))}
              {fbPreview.ok && fbPreview.totalFetched === 0 ? (
                <Text style={styles.fbResultLine}>
                  ওই তারিখে কিছু পাওয়া যায়নি — তারিখ ঠিক আছে কিনা দেখুন।
                </Text>
              ) : null}
              <Text style={styles.fbResultLine}>এটি শুধু দেখল — কিছু লেখা হয়নি।</Text>
            </View>
          ) : null}

          {fbReport ? (
            <View style={styles.fbResultBox}>
              <Text style={[styles.fbResultTitle, fbReport.ok ? styles.fbOkText : styles.fbBadText]}>
                {fbReport.ok
                  ? `✅ সফল — ${fbReport.pushedRows || 0} টি রেকর্ড লেখা হয়েছে`
                  : (fbReport.error || '⏳ সম্পূর্ণ হয়নি — নিচের তথ্য দেখুন')}
              </Text>
              <Text style={styles.fbResultLine}>
                • Supabase: লেখা {fbReport.pushedRows || 0}
                {fbReport.failedRows ? ` · ব্যর্থ ${fbReport.failedRows}` : ''}
              </Text>
              {(fbReport.tables || []).filter((t) => t.error).map((t) => (
                <Text key={t.table} style={styles.fbResultLine}>⚠ {t.table}: {t.error}</Text>
              ))}
              {(fbReport.notes || []).map((n, i) => (
                <Text key={`note-${i}`} style={styles.fbNote}>⚠ {n}</Text>
              ))}
              <Text style={styles.fbResultLine}>
                {(fbReport.pushedRows || 0) > 0
                  ? 'এটি upsert — আবার চালালেও একই ফল আসবে।'
                  : 'কিছু লেখা হয়নি — উপরের বার্তা দেখুন।'}
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── LOCAL SQLite → SUPABASE (last 31 days) ───────── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.iconCircleGold}>
              <Database size={18} color="#FFB703" strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>লোকাল ডেটা → Supabase</Text>
              <Text style={styles.cardSubtitle}>
                তোমার ফোনের SQLite থেকে শেষ {LOCAL_DAYS} দিনের ডেটা Supabase-এ push (আগেই থাকলে skip)
              </Text>
            </View>
          </View>

          <View style={styles.divider} />

          <TouchableOpacity
            style={[styles.fbPushBtn, (!!localBusy || isBackingUp || isRestoring || isValidating) && styles.fbBtnDisabled]}
            onPress={handleLocalPush}
            disabled={!!localBusy || isBackingUp || isRestoring || isValidating}
            activeOpacity={0.8}
          >
            {localBusy ? (
              <ActivityIndicator color="#000000" size="small" />
            ) : (
              <Text style={styles.fbPushBtnText}>লোকাল → Supabase push করুন</Text>
            )}
          </TouchableOpacity>

          {localProgress ? <Text style={styles.fbProgress}>⏳ {localProgress}</Text> : null}

          {localReport ? (
            <View style={styles.fbResultBox}>
              <Text style={[styles.fbResultTitle, localReport.ok ? styles.fbOkText : styles.fbBadText]}>
                {localReport.error
                  ? localReport.error
                  : (localReport.failedRows > 0
                    ? `⚠️ push ${localReport.pushedRows} · fail ${localReport.failedRows}`
                    : `✅ ${localReport.pushedRows} push · ${localReport.skippedExisting} skip (আগেই ছিল)${localReport.orphanRows ? ` · ⚠️ বাদ ${localReport.orphanRows}` : ''}`)}
              </Text>
              {(localReport.tables || []).filter((t) => t.local > 0).map((t) => (
                <Text key={t.table} style={styles.fbResultLine}>
                  • {t.table}: local {t.local} · pushed {t.pushed}{t.existing ? ` · skip ${t.existing}` : ''}{t.orphans ? ` · বাদ ${t.orphans} (মূল রেকর্ড নেই)` : ''}{t.error ? ` — ⚠ ${t.error}` : ''}{t.skippedReason ? ` — ${t.skippedReason}` : ''}
                </Text>
              ))}
              {(localReport.notes || []).map((n, i) => (
                <Text key={`ln-${i}`} style={styles.fbNote}>⚠ {n}</Text>
              ))}
              <Text style={styles.fbResultLine}>এটি upsert — আবার চালালেও আগেই-থাকা row skip হবে।</Text>
            </View>
          ) : null}
        </View>

        {/* ── SECURITY & SAFETY POLICY NOTE ───────────────── */}
        <View style={styles.securityCard}>
          <View style={styles.securityHeader}>
            <ShieldCheck size={18} color="#10B981" strokeWidth={2} />
            <Text style={styles.securityTitle}>নিরাপত্তা ও ডেটা সুরক্ষার নিয়ম</Text>
          </View>
          <Text style={styles.securityText}>
            • ব্যাকআপ ফাইলে সব ধরণের সেলস, অর্ডার, পেমেন্ট, খরচ, ডেলিভারি ও মেন্যু ডাটা অন্তর্ভুক্ত থাকবে।{'\n'}
            • লগইন পিন (PIN), পাসওয়ার্ড ও ক্লাউড অথেনটিকেশন টোকেন ব্যাকআপে সুরক্ষিতভাবে বাদ দেওয়া হয়।{'\n'}
            • অন্য ডিভাইসে অ্যাপ আনইনস্টল করে নতুন করে ইনস্টল করলেও ব্যাকআপ ফাইল দিয়ে সম্পূর্ণ ডাটা ফিরিয়ে আনা সম্ভব।{'\n'}
            • রিস্টোর করার সময় ডাটাবেজ ট্রানজ্যাকশন নিরাপদে পরিচালিত হয়। কোনো ত্রুটি হলে পূর্বের ডাটা সুরক্ষিত থাকে।
          </Text>
        </View>
      </ScrollView>

      {/* ── CALENDAR (dependency-free date picker) ────────── */}
      <CalendarPicker
        visible={calOpen}
        value={fbDay}
        onSelect={(day) => { setFbDay(day); setCalOpen(false); }}
        onClose={() => setCalOpen(false)}
        title="Firebase থেকে কোন দিনের ডেটা?"
      />

      {/* ── PREVIEW & CONFIRMATION MODAL ────────────────── */}
      <Modal
        visible={previewModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                <View style={styles.iconCircleGold}>
                  <Database size={20} color="#FFB703" strokeWidth={2} />
                </View>
                <View>
                  <Text style={styles.modalTitle}>ব্যাকআপ যাচাইকরণ</Text>
                  <Text style={styles.modalSubtitle}>Backup File Verified</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={handleCancelModal}
                style={styles.modalCloseBtn}
                activeOpacity={0.7}
              >
                <X size={18} color="#9CA3AF" strokeWidth={2.5} />
              </TouchableOpacity>
            </View>

            {validatedData && (
              <ScrollView
                style={styles.modalBody}
                showsVerticalScrollIndicator={false}
              >
                {/* File info card */}
                <View style={styles.infoCard}>
                  <View style={styles.infoRow}>
                    <View style={styles.infoLeft}>
                      <Calendar size={14} color="#FFB703" strokeWidth={2} />
                      <Text style={styles.infoLabel}>ব্যাকআপ তারিখ:</Text>
                    </View>
                    <Text style={styles.infoValue}>{validatedData.formattedDate}</Text>
                  </View>

                  <View style={styles.infoRow}>
                    <View style={styles.infoLeft}>
                      <Layers size={14} color="#FFB703" strokeWidth={2} />
                      <Text style={styles.infoLabel}>মোট টেবিল:</Text>
                    </View>
                    <Text style={styles.infoValue}>{validatedData.totalTables}</Text>
                  </View>

                  <View style={styles.infoRow}>
                    <View style={styles.infoLeft}>
                      <CheckCircle2 size={14} color="#34D399" strokeWidth={2} />
                      <Text style={styles.infoLabel}>মোট রেকর্ড:</Text>
                    </View>
                    <Text style={[styles.infoValue, { color: '#34D399', fontWeight: 'bold' }]}>
                      {validatedData.totalRecords.toLocaleString()} টি
                    </Text>
                  </View>

                  <View style={styles.infoRow}>
                    <View style={styles.infoLeft}>
                      <FileText size={14} color="#FFB703" strokeWidth={2} />
                      <Text style={styles.infoLabel}>ফাইল নাম:</Text>
                    </View>
                    <Text style={[styles.infoValue, styles.fileNameText]} numberOfLines={1}>
                      {validatedData.fileName}
                    </Text>
                  </View>
                </View>

                {/* Warning notice */}
                <View style={styles.warningBox}>
                  <AlertTriangle size={18} color="#F59E0B" strokeWidth={2} />
                  <Text style={styles.warningText}>
                    এই ব্যাকআপ থেকে বর্তমান লোকাল ডাটাবেজের রেকর্ডসমূহ রিস্টোর করা হবে। আপনি কি নিশ্চিত?
                  </Text>
                </View>

                {/* Confirm & Cancel Buttons */}
                <View style={styles.modalBtnRow}>
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={handleCancelModal}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.cancelBtnText}>বাতিল করুন</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.confirmBtn}
                    onPress={handleConfirmRestore}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.confirmBtnText}>রিস্টোর নিশ্চিত করুন</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
    backgroundColor: '#0D0D0D',
  },
  backBtn: { padding: 4 },
  backBtnText: { color: '#FFB703', fontWeight: 'bold' },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold' },
  refreshBtn: { padding: 6 },
  refreshBtnText: { fontSize: 16 },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: 16,
    paddingBottom: 32,
    gap: 16,
  },
  card: {
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#222222',
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircleGold: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#1C1107',
    borderWidth: 1,
    borderColor: '#78350F',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  cardSubtitle: {
    color: '#A1A1AA',
    fontSize: 11,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#1F1F1F',
    marginVertical: 12,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusLabel: {
    color: '#888888',
    fontSize: 12.5,
  },
  statusValue: {
    color: '#E5E7EB',
    fontSize: 12.5,
    fontWeight: '500',
  },
  fileNameText: {
    maxWidth: 160,
    color: '#FFB703',
  },
  actionsContainer: {
    gap: 12,
  },
  actionBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  backupBtn: {
    backgroundColor: '#FFB703',
  },
  btnIconWrapGold: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backupBtnTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#000000',
  },
  backupBtnSubtitle: {
    fontSize: 11,
    color: '#422006',
    marginTop: 2,
  },
  restoreBtn: {
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#333333',
  },
  btnIconWrapBlue: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#FFB703',
    justifyContent: 'center',
    alignItems: 'center',
  },
  restoreBtnTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  restoreBtnSubtitle: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
  btnTextGroup: {
    flex: 1,
  },
  securityCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    padding: 14,
  },
  securityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  securityTitle: {
    color: '#34D399',
    fontSize: 13,
    fontWeight: 'bold',
  },
  securityText: {
    color: '#9CA3AF',
    fontSize: 11.5,
    lineHeight: 18,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxHeight: '85%',
    backgroundColor: '#0D0D0D',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#FFB703',
    padding: 18,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  modalSubtitle: {
    fontSize: 11,
    color: '#888888',
  },
  modalCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1E1E1E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBody: {
    flexShrink: 1,
  },
  infoCard: {
    backgroundColor: '#161616',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#262626',
    padding: 12,
    gap: 10,
    marginBottom: 14,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoLabel: {
    fontSize: 12.5,
    color: '#888888',
  },
  infoValue: {
    fontSize: 12.5,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  warningBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.25)',
    padding: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  warningText: {
    flex: 1,
    color: '#FBBF24',
    fontSize: 12,
    lineHeight: 17,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#333333',
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#E5E7EB',
    fontSize: 13,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#DC2626',
    alignItems: 'center',
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },

  // ─── Firebase → Supabase (one day) ─────────────────────────────────────────
  fbDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fbStepBtn: {
    width: 46,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#333333',
    alignItems: 'center',
  },
  fbStepBtnText: {
    color: '#E5E7EB',
    fontSize: 13,
    fontWeight: '700',
  },
  fbCalBtn: {
    width: 46,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#FFB703',
    alignItems: 'center',
  },
  fbInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#333333',
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 1,
    textAlign: 'center',
  },
  fbQuickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  fbQuickBtn: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#333333',
  },
  fbQuickBtnText: {
    color: '#FFB703',
    fontSize: 12,
    fontWeight: '600',
  },
  fbHint: {
    flex: 1,
    color: '#888888',
    fontSize: 11.5,
    textAlign: 'right',
  },
  fbBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  fbPreviewBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#333333',
    alignItems: 'center',
  },
  fbPreviewBtnText: {
    color: '#FFB703',
    fontSize: 13,
    fontWeight: '600',
  },
  fbPushBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#FFB703',
    alignItems: 'center',
  },
  fbPushBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold',
  },
  fbBtnDisabled: {
    opacity: 0.5,
  },
  fbProgress: {
    color: '#A1A1AA',
    fontSize: 11.5,
    marginTop: 10,
  },
  fbResultBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#262626',
    gap: 6,
  },
  fbResultTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  fbOkText: {
    color: '#34D399',
  },
  fbBadText: {
    color: '#F87171',
  },
  fbResultLine: {
    color: '#9CA3AF',
    fontSize: 11.5,
    lineHeight: 17,
  },
  fbNote: {
    color: '#FBBF24',
    fontSize: 11.5,
    lineHeight: 17,
  },
});
