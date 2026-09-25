import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  Dimensions,
  Platform
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import SidebarIcon from './SidebarIcon';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Ultra-compact responsive drawer width (~51% width, reduced by 7%)
const DRAWER_WIDTH = Math.min(Math.round(SCREEN_WIDTH * 0.51), 216);

/**
 * Reusable menu row matching the reference style:
 * [rounded icon container]  TITLE
 *                           subtitle
 */
function MenuRow({
  iconName,
  iconColor,
  iconBg,
  title,
  subtitle,
  titleColor = '#FFFFFF',
  onPress
}) {
  return (
    <TouchableOpacity
      style={styles.menuRow}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.iconBox, { backgroundColor: iconBg }]}>
        <SidebarIcon name={iconName} color={iconColor} size={15} strokeWidth={2} />
      </View>
      <View style={styles.textStack}>
        <Text style={[styles.rowTitle, { color: titleColor }]} numberOfLines={1}>
          {title}
        </Text>
        {Boolean(subtitle) && (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

/**
 * Modern Admin Side Menu Component
 * Follows the dark, premium layout of the reference image.
 */
export default function AdminSideMenu({
  visible,
  onClose,
  delCountdown,
  tabCountdown,
  fullCountdown,
  onNavigateToEditMenu,
  onNavigateToAnalytics,
  onNavigateToItemSalesReport,
  onNavigateToSyncDiagnostics,
  onNavigateToDeleteHistory,
  onNavigateToAIDatasetMonitor,
  onNavigateToAIDatasetAuditCenter,
  onNavigateToDeviceManagement,
  onNavigateToSystemTools,
  onNavigateToActivityLog,
  handleOpenPastAccount,
  onOpenSalesReport,
  onOpenDepositReport,
  onResetDailySubmit,
  onResetIjara,
  onResetHistoryLimits,
  onSameDayResync,
  onCloudRestore,
  onMenuRecovery,
  onNavigateToPrinterSettings,
  onNavigateToBackupRestore,
  onLogout
}) {
  const insets = useSafeAreaInsets();
  const isAIDatasetEnabled = String(process.env.EXPO_PUBLIC_AI_DATASET_ENABLED || 'false').toLowerCase().trim() === 'true';

  const handleAction = (callback) => {
    onClose();
    if (typeof callback === 'function') {
      callback();
    }
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={[styles.modalBackdrop, { paddingTop: insets.top || 20, paddingBottom: insets.bottom || 0 }]}>
        {/* Full backdrop touchable for outside tap */}
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFillObject} />
        </TouchableWithoutFeedback>

        {/* Floating Portable Drawer Card */}
        <View style={styles.floatingCard}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleGroup}>
              <Text style={styles.headerBrand}>Rongdhonu POS</Text>
              <Text style={styles.headerRole}>Administrator</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.drawerScroll}
            contentContainerStyle={styles.drawerContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Section 1: CORE OPERATIONS ── */}
            <Text style={styles.sectionHeader}>CORE OPERATIONS</Text>

            <MenuRow
              iconName="edit"
              iconColor="#F59E0B"
              iconBg="rgba(245, 158, 11, 0.15)"
              title="Edit Menu"
              subtitle="Manage food items"
              onPress={() => handleAction(onNavigateToEditMenu)}
            />

            <MenuRow
              iconName="analytics"
              iconColor="#8B5CF6"
              iconBg="rgba(139, 92, 246, 0.15)"
              title="Business Analytics"
              subtitle="Performance insights"
              onPress={() => handleAction(onNavigateToAnalytics)}
            />

            <MenuRow
              iconName="barchart"
              iconColor="#38BDF8"
              iconBg="rgba(56, 189, 248, 0.15)"
              title="Item Sales Report"
              subtitle="Item sales trends"
              onPress={() => handleAction(onNavigateToItemSalesReport)}
            />

            <MenuRow
              iconName="link"
              iconColor="#0EA5E9"
              iconBg="rgba(14, 165, 233, 0.15)"
              title="Sync Diagnostics"
              subtitle="Database health check"
              onPress={() => handleAction(onNavigateToSyncDiagnostics)}
            />

            <MenuRow
              iconName="trash"
              iconColor="#F97316"
              iconBg="rgba(249, 115, 22, 0.15)"
              title="Delete History"
              subtitle="Deleted records log"
              onPress={() => handleAction(onNavigateToDeleteHistory)}
            />

            {/* AI Dataset Items (Preserved if flag is enabled) */}
            {isAIDatasetEnabled && (
              <>
                <MenuRow
                  iconName="analytics"
                  iconColor="#38BDF8"
                  iconBg="rgba(56, 189, 248, 0.15)"
                  title="AI Dataset Monitor"
                  subtitle="Database telemetry"
                  onPress={() => handleAction(onNavigateToAIDatasetMonitor)}
                />
                <MenuRow
                  iconName="tools"
                  iconColor="#38BDF8"
                  iconBg="rgba(56, 189, 248, 0.15)"
                  title="AI Dataset Audit Center"
                  subtitle="Audit & validation"
                  onPress={() => handleAction(onNavigateToAIDatasetAuditCenter)}
                />
              </>
            )}

            <MenuRow
              iconName="shield"
              iconColor="#10B981"
              iconBg="rgba(16, 185, 129, 0.15)"
              title="Device Control"
              subtitle="Terminal access & security"
              onPress={() => handleAction(onNavigateToDeviceManagement)}
            />

            <MenuRow
              iconName="tools"
              iconColor="#A855F7"
              iconBg="rgba(168, 85, 247, 0.15)"
              title="System Tools"
              subtitle="Reset & maintenance"
              onPress={() => handleAction(onNavigateToSystemTools)}
            />

            <MenuRow
              iconName="card"
              iconColor="#10B981"
              iconBg="rgba(16, 185, 129, 0.15)"
              title="Backup & Restore"
              subtitle="Export & restore SQLite data"
              titleColor="#34D399"
              onPress={() => handleAction(onNavigateToBackupRestore)}
            />

            <MenuRow
              iconName="document"
              iconColor="#3B82F6"
              iconBg="rgba(59, 130, 246, 0.15)"
              title="Activity & Audit Logs"
              subtitle="Staff action history"
              onPress={() => handleAction(onNavigateToActivityLog)}
            />

            <MenuRow
              iconName="clock"
              iconColor="#F59E0B"
              iconBg="rgba(245, 158, 11, 0.15)"
              title="অতীতের হিসাব যোগ"
              subtitle="মিসিং দিনের হিসাব যুক্ত করুন"
              onPress={() => handleAction(handleOpenPastAccount)}
            />

            <MenuRow
              iconName="card"
              iconColor="#14B8A6"
              iconBg="rgba(20, 184, 166, 0.15)"
              title="Sales Report"
              subtitle="Revenue breakdown"
              onPress={() => handleAction(onOpenSalesReport)}
            />

            <MenuRow
              iconName="bank"
              iconColor="#3B82F6"
              iconBg="rgba(59, 130, 246, 0.15)"
              title="Deposit Report"
              subtitle="Cash deposits & bank"
              onPress={() => handleAction(onOpenDepositReport)}
            />

            {/* ── Section 2: SYSTEM TOOLS ── */}
            <Text style={[styles.sectionHeader, { marginTop: 8 }]}>SYSTEM TOOLS</Text>

            <MenuRow
              iconName="lock"
              iconColor="#F59E0B"
              iconBg="rgba(245, 158, 11, 0.15)"
              title="Reset Daily Lock"
              subtitle="Reopen today's session"
              titleColor="#FFB703"
              onPress={() => handleAction(onResetDailySubmit)}
            />

            {/* Note: 'Reset Ijara Cost' removed per user request */}

            <MenuRow
              iconName="sliders"
              iconColor="#F59E0B"
              iconBg="rgba(245, 158, 11, 0.15)"
              title="Reset History Limits"
              subtitle="Reset pagination limits"
              titleColor="#FFB703"
              onPress={() => handleAction(onResetHistoryLimits)}
            />

            <MenuRow
              iconName="refresh"
              iconColor="#38BDF8"
              iconBg="rgba(56, 189, 248, 0.15)"
              title="Same-Day Resync"
              subtitle="Force cloud re-download"
              titleColor="#38BDF8"
              onPress={() => handleAction(onSameDayResync)}
            />

            <MenuRow
              iconName="cloud"
              iconColor="#10B981"
              iconBg="rgba(16, 185, 129, 0.15)"
              title="Cloud Restore"
              subtitle="Restore from backup"
              titleColor="#34D399"
              onPress={() => handleAction(onCloudRestore)}
            />

            <MenuRow
              iconName="recovery"
              iconColor="#10B981"
              iconBg="rgba(16, 185, 129, 0.15)"
              title="Recover Menu Items"
              subtitle="Restore deleted items"
              titleColor="#34D399"
              onPress={() => handleAction(onMenuRecovery)}
            />

            <MenuRow
              iconName="printer"
              iconColor="#38BDF8"
              iconBg="rgba(56, 189, 248, 0.15)"
              title="Printer Settings"
              subtitle="Thermal printer setup"
              titleColor="#FFFFFF"
              onPress={() => handleAction(onNavigateToPrinterSettings)}
            />

            {/* ── Section 3: Logout ── */}
            <View style={styles.menuDivider} />

            <MenuRow
              iconName="logout"
              iconColor="#EF4444"
              iconBg="rgba(239, 68, 68, 0.15)"
              title="Logout"
              subtitle="Sign out of terminal"
              titleColor="#EF4444"
              onPress={() => handleAction(onLogout)}
            />

            <View style={{ height: 14 }} />
          </ScrollView>
        </View>

        {/* Dedicated right side area for easy outside dismiss */}
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdropRightArea} />
        </TouchableWithoutFeedback>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.70)',
    flexDirection: 'row',
    alignItems: 'flex-start',
    // paddingTop applied dynamically via insets (see JSX)
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    paddingLeft: 10
  },
  backdropRightArea: {
    flex: 1,
    height: '100%'
  },
  floatingCard: {
    width: DRAWER_WIDTH,
    maxHeight: '100%',
    backgroundColor: '#181E25',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#242C37',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 3, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 16
  },
  header: {
    height: 39.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderColor: '#242C37',
    backgroundColor: '#13181F'
  },
  headerTitleGroup: {
    flex: 1
  },
  headerBrand: {
    color: '#FFB703',
    fontSize: 11.5,
    fontWeight: 'bold',
    letterSpacing: 0.2
  },
  headerRole: {
    color: '#8E8E93',
    fontSize: 8.8,
    marginTop: 0.5,
    fontWeight: '500'
  },
  closeBtn: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  closeBtnText: {
    color: '#8E8E93',
    fontSize: 10,
    fontWeight: 'bold'
  },
  drawerScroll: {
    flexGrow: 0
  },
  drawerContent: {
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 14
  },
  sectionHeader: {
    color: '#8E8E93',
    fontSize: 8.7,
    fontWeight: '700',
    letterSpacing: 0.35,
    marginBottom: 2.8,
    marginTop: 2.8
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 35.2,
    paddingVertical: 1.9,
    paddingHorizontal: 2,
    borderRadius: 5.7
  },
  iconBox: {
    width: 24.7,
    height: 24.7,
    borderRadius: 6.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7.6
  },
  textStack: {
    flex: 1,
    justifyContent: 'center'
  },
  rowTitle: {
    fontSize: 10.9,
    fontWeight: '600',
    letterSpacing: 0
  },
  rowSubtitle: {
    fontSize: 8.4,
    color: '#8E8E93',
    marginTop: 0.5
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#242C37',
    marginVertical: 4.2,
    marginHorizontal: 2
  }
});

