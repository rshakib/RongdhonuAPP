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
const DRAWER_WIDTH = Math.min(Math.round(SCREEN_WIDTH * 0.51), 216);

/**
 * Reusable menu row matching the portable style:
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
 * Modern Portable Owner Side Menu Component
 */
export default function OwnerSideMenu({
  visible,
  onClose,
  dailyExpenses,
  onAddIjara,
  onIjaraAlreadyAdded,
  onNavigateToEditMenu,
  onNavigateToAnalytics,
  onNavigateToItemSalesReport,
  handleOpenPastAccount,
  onNavigateToSupplierDue,
  onNavigateToOwnerFinance,
  onNavigateToActivityLog,
  onOpenSalesReport,
  onOpenDepositReport,
  onSameDayResync,
  onCloudRestore,
  onMenuRecovery,
  onNavigateToPrinterSettings,
  onNavigateToBackupRestore,
  onLogout
}) {
  const insets = useSafeAreaInsets();
  const handleAction = (callback) => {
    onClose();
    if (typeof callback === 'function') {
      callback();
    }
  };

  const isIjaraAdded = Boolean(dailyExpenses && dailyExpenses.ijara > 0);

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
              <Text style={styles.headerRole}>Owner</Text>
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

            {/* Ijara Option */}
            {isIjaraAdded ? (
              <MenuRow
                iconName="lock"
                iconColor="#8E8E93"
                iconBg="rgba(142, 142, 147, 0.12)"
                title="Ijara Added"
                subtitle="Already submitted for today"
                titleColor="#8E8E93"
                onPress={() => handleAction(onIjaraAlreadyAdded)}
              />
            ) : (
              <MenuRow
                iconName="card"
                iconColor="#F59E0B"
                iconBg="rgba(245, 158, 11, 0.15)"
                title="Add Ijara"
                subtitle="Submit daily rent expense"
                titleColor="#FFB703"
                onPress={() => handleAction(onAddIjara)}
              />
            )}

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
              iconName="clock"
              iconColor="#F59E0B"
              iconBg="rgba(245, 158, 11, 0.15)"
              title="অতীতের হিসাব যোগ"
              subtitle="মিসিং দিনের হিসাব যুক্ত করুন"
              onPress={() => handleAction(handleOpenPastAccount)}
            />

            <MenuRow
              iconName="wallet"
              iconColor="#F97316"
              iconBg="rgba(249, 115, 22, 0.15)"
              title="Supplier Due"
              subtitle="Vendor payments & debts"
              onPress={() => handleAction(onNavigateToSupplierDue)}
            />

            <MenuRow
              iconName="bank"
              iconColor="#10B981"
              iconBg="rgba(16, 185, 129, 0.15)"
              title="Owner Finance"
              subtitle="Investments & capital"
              onPress={() => handleAction(onNavigateToOwnerFinance)}
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

            <MenuRow
              iconName="card"
              iconColor="#10B981"
              iconBg="rgba(16, 185, 129, 0.15)"
              title="Backup & Restore"
              subtitle="Export & restore SQLite data"
              titleColor="#34D399"
              onPress={() => handleAction(onNavigateToBackupRestore)}
            />
            <Text style={[styles.sectionHeader, { marginTop: 8 }]}>SYSTEM TOOLS</Text>

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
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
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
    backgroundColor: '#161616',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#262626',
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
    borderColor: '#262626',
    backgroundColor: '#0D0D0D'
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
    color: '#A1A1AA',
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
    color: '#A1A1AA',
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
    color: '#A1A1AA',
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
    color: '#A1A1AA',
    marginTop: 0.5
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#262626',
    marginVertical: 4.2,
    marginHorizontal: 2
  }
});

