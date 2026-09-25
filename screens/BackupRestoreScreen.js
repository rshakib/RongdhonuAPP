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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
} from '../services/backupRestore';

export default function BackupRestoreScreen({ onBack, onRefreshAppState }) {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState(getBackupStatus());
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Validation modal state
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [validatedData, setValidatedData] = useState(null);

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
          'ব্যাকআপ সম্পন্ন হয়েছে (Backup Successful)',
          `ফাইলটি সফলভাবে এক্সপোর্ট করা হয়েছে:\n${result.fileName}\n\nমোট টেবিল: ${result.metadata.total_tables}\nমোট রেকর্ড: ${result.metadata.total_records.toLocaleString()}`,
          [{ text: 'ঠিক আছে (OK)' }]
        );
      } else {
        Alert.alert(
          'ব্যাকআপ ব্যর্থ হয়েছে (Backup Failed)',
          result.error || 'অজানা ত্রুটি ঘটেছে।'
        );
      }
    } catch (err) {
      Alert.alert(
        'ব্যাকআপ ত্রুটি (Backup Error)',
        err.message || 'ডাটাবেজ ব্যাকআপ সম্পন্ন করা যায়নি।'
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
        // User closed the document picker without picking a file
        return;
      }

      if (!validation.valid) {
        Alert.alert(
          'অকার্যকর ব্যাকআপ ফাইল (Invalid Backup)',
          validation.error || 'এই ফাইলটি রংপুরধনু ব্যাকআপ হিসেবে বৈধ নয়।',
          [{ text: 'ঠিক আছে (OK)' }]
        );
        return;
      }

      // Valid backup file selected — show pre-restore inspection modal
      setValidatedData(validation);
      setPreviewModalVisible(true);
    } catch (err) {
      Alert.alert(
        'ভ্যালিডেশন ত্রুটি (Validation Error)',
        err.message || 'ফাইলটি যাচাই করা যায়নি।'
      );
    } finally {
      setIsValidating(false);
    }
  };

  // ─── 3. CONFIRM & EXECUTE ATOMIC RESTORE ───────────────────────────────────

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
          'রিস্টোর সম্পন্ন হয়েছে (Restore Complete)',
          `ডাটাবেজ সফলভাবে রিস্টোর হয়েছে।\nমোট রিস্টোরকৃত রেকর্ড: ${result.totalRestored.toLocaleString()}\n\nনিরাপত্তা সতর্কতা: ইউজার লগইন এবং ডিভাইস রেজিস্ট্রেশন নিরাপদ রাখা হয়েছে।`,
          [{ text: 'ঠিক আছে (OK)' }]
        );
      } else {
        Alert.alert(
          'রিস্টোর ব্যর্থ হয়েছে (Restore Failed)',
          result.error || 'ডাটাবেজ রিস্টোর করা সম্ভব হয়নি। পূর্বের ডাটা অপরিবর্তিত রয়েছে।'
        );
      }
    } catch (err) {
      Alert.alert(
        'রিস্টোর ত্রুটি (Restore Error)',
        err.message || 'ডাটাবেজ রিস্টোর করার সময় ত্রুটি ঘটেছে।'
      );
    } finally {
      setIsRestoring(false);
      setValidatedData(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* ── HEADER ────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backButton}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ArrowLeft size={20} color="#FFB703" strokeWidth={2.5} />
          <Text style={styles.backButtonText}>পিছনে যান</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleGroup}>
          <Text style={styles.headerTitle}>ব্যাকআপ ও রিস্টোর</Text>
          <Text style={styles.headerSubtitle}>SQLite Database Manager</Text>
        </View>

        <TouchableOpacity
          onPress={refreshStatus}
          style={styles.refreshButton}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <RefreshCw size={18} color="#A1A1AA" strokeWidth={2} />
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
                  <Upload size={20} color="#60A5FA" strokeWidth={2.5} />
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

        {/* ── SECURITY & SAFETY POLICY NOTE ───────────────── */}
        <View style={styles.securityCard}>
          <View style={styles.securityHeader}>
            <ShieldCheck size={18} color="#10B981" strokeWidth={2} />
            <Text style={styles.securityTitle}>নিরাপত্তা ও ডেটা সুরক্ষার নিয়ম</Text>
          </View>
          <Text style={styles.securityText}>
            • ব্যাকআপ ফাইলে সব ধরণের সেলস, অর্ডার, পেমেন্ট, খরচ, ডেলিভারি ও মেন্যু ডাটা অন্তর্ভুক্ত থাকবে।{'\n'}
            • লগইন পিন (PIN), পাসওয়ার্ড ও ক্লাউড অথেনটিকেশন টোকেন ব্যাকআপে সুরক্ষিতভাবে বাদ দেওয়া হয়।{'\n'}
            • অন্য ডিভাইসে অ্যাপ আনইনস্টল করে নতুন করে ইনস্টল করলেও ব্যাকআপ ফাইল দিয়ে সম্পূর্ণ ডাটা ফিরিয়ে আনা সম্ভব।{'\n'}
            • রিস্টোর করার সময় ডাটাবেজ ট্রানজ্যাকশন নিরাপদে পরিচালিত হয়। কোনো ত্রুটি হলে পূর্বের ডাটা সুরক্ষিত থাকে।
          </Text>
        </View>
      </ScrollView>

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
                onPress={() => setPreviewModalVisible(false)}
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
                      <Layers size={14} color="#60A5FA" strokeWidth={2} />
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
                      <FileText size={14} color="#A78BFA" strokeWidth={2} />
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
                    onPress={() => setPreviewModalVisible(false)}
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
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
    backgroundColor: '#0D0D0D',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  backButtonText: {
    color: '#FFB703',
    fontSize: 13,
    fontWeight: '600',
  },
  headerTitleGroup: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    fontSize: 10,
    color: '#A1A1AA',
    marginTop: 1,
  },
  refreshButton: {
    padding: 6,
  },
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
    backgroundColor: '#161622',
    borderWidth: 1,
    borderColor: '#2D2D44',
  },
  btnIconWrapBlue: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#3B82F6',
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
    backgroundColor: '#1F2937',
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
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
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
});
