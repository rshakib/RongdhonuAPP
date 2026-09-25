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

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(Math.round(SCREEN_WIDTH * 0.51), 216);

/**
 * Pure React Native vector icons matching the portable reference style.
 */
function MenuIcon({ name, color }) {
  switch (name) {
    case 'card':
      return (
        <View style={{ width: 16, height: 12, borderWidth: 1.5, borderColor: color, borderRadius: 2, justifyContent: 'flex-start' }}>
          <View style={{ width: '100%', height: 2, backgroundColor: color, marginTop: 1.5 }} />
          <View style={{ width: 3, height: 2, backgroundColor: color, marginLeft: 2, marginTop: 2, borderRadius: 0.5 }} />
        </View>
      );

    case 'clock':
      return (
        <View style={{ width: 15, height: 15, borderRadius: 7.5, borderWidth: 1.5, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 1.5, height: 4.5, backgroundColor: color, position: 'absolute', top: 2 }} />
          <View style={{ width: 4, height: 1.5, backgroundColor: color, position: 'absolute', right: 2.5 }} />
        </View>
      );

    case 'lock':
      return (
        <View style={{ alignItems: 'center', width: 14, height: 15 }}>
          <View style={{ width: 8, height: 6, borderTopLeftRadius: 4, borderTopRightRadius: 4, borderWidth: 1.5, borderColor: color, borderBottomWidth: 0, marginBottom: -0.5 }} />
          <View style={{ width: 12, height: 8.5, backgroundColor: color, borderRadius: 2, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 2, height: 3, backgroundColor: '#161616', borderRadius: 1 }} />
          </View>
        </View>
      );

    case 'refresh':
      return (
        <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 13, height: 13, borderRadius: 6.5, borderWidth: 1.5, borderColor: color, borderTopColor: 'transparent' }} />
          <View style={{ width: 0, height: 0, borderLeftWidth: 2.5, borderRightWidth: 2.5, borderBottomWidth: 3.5, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color, position: 'absolute', top: 0, right: 3, transform: [{ rotate: '45deg' }] }} />
        </View>
      );

    case 'cloud':
      return (
        <View style={{ width: 16, height: 14, justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: color, position: 'absolute', top: 1, left: 3 }} />
          <View style={{ width: 6, height: 6, borderRadius: 3, borderWidth: 1.5, borderColor: color, position: 'absolute', top: 4, left: 0 }} />
          <View style={{ width: 6, height: 6, borderRadius: 3, borderWidth: 1.5, borderColor: color, position: 'absolute', top: 4, right: 0 }} />
          <View style={{ width: 14, height: 1.5, backgroundColor: color, position: 'absolute', bottom: 1.5 }} />
        </View>
      );

    case 'edit':
      return (
        <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 14, height: 14, transform: [{ rotate: '45deg' }], alignItems: 'center' }}>
            <View style={{ width: 4.5, height: 9, borderWidth: 1.5, borderColor: color, borderTopLeftRadius: 1, borderTopRightRadius: 1 }} />
            <View style={{ width: 0, height: 0, borderLeftWidth: 2.25, borderRightWidth: 2.25, borderTopWidth: 3.5, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: color }} />
          </View>
        </View>
      );

    case 'printer':
      return (
        <View style={{ width: 16, height: 15, alignItems: 'center' }}>
          <View style={{ width: 9, height: 3, backgroundColor: color, borderTopLeftRadius: 1, borderTopRightRadius: 1 }} />
          <View style={{ width: 15, height: 8, borderWidth: 1.5, borderColor: color, borderRadius: 2, marginVertical: -0.5, justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ width: 7, height: 1.5, backgroundColor: color }} />
          </View>
          <View style={{ width: 9, height: 3.5, backgroundColor: color, borderBottomLeftRadius: 1, borderBottomRightRadius: 1 }} />
        </View>
      );

    case 'logout':
      return (
        <View style={{ width: 16, height: 15, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 8, height: 13, borderLeftWidth: 1.5, borderTopWidth: 1.5, borderBottomWidth: 1.5, borderColor: color, borderTopLeftRadius: 2, borderBottomLeftRadius: 2 }} />
          <View style={{ width: 7, height: 1.5, backgroundColor: color, marginLeft: -2 }} />
          <View style={{ width: 0, height: 0, borderTopWidth: 3, borderBottomWidth: 3, borderLeftWidth: 3.5, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: color, marginLeft: -1 }} />
        </View>
      );

    default:
      return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />;
  }
}

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
        <View style={{ transform: [{ scale: 0.63 }] }}>
          <MenuIcon name={iconName} color={iconColor} />
        </View>
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
 * Modern Portable Manager Side Menu Component
 */
export default function ManagerSideMenu({
  visible,
  onClose,
  dailyExpenses,
  onAddIjara,
  onIjaraAlreadyAdded,
  handleOpenPastAccount,
  showAutoIjaraRollback = false,
  onRollbackAutoIjara,
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
              <Text style={styles.headerRole}>Manager</Text>
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
              iconName="clock"
              iconColor="#F59E0B"
              iconBg="rgba(245, 158, 11, 0.15)"
              title="অতীতের হিসাব যোগ"
              subtitle="মিসিং দিনের হিসাব যুক্ত করুন"
              onPress={() => handleAction(handleOpenPastAccount)}
            />

            {/* Auto Ijara Rollback Option */}
            {showAutoIjaraRollback && (
              <MenuRow
                iconName="refresh"
                iconColor="#F59E0B"
                iconBg="rgba(245, 158, 11, 0.15)"
                title="Auto Ijara Rollback"
                subtitle="Revert automated rent"
                titleColor="#FFB703"
                onPress={() => handleAction(onRollbackAutoIjara)}
              />
            )}

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
              iconName="edit"
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
    fontSize: 9.2,
    fontWeight: '700',
    letterSpacing: 0.35,
    marginBottom: 3,
    marginTop: 3
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 37,
    paddingVertical: 2,
    paddingHorizontal: 2,
    borderRadius: 6
  },
  iconBox: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8
  },
  textStack: {
    flex: 1,
    justifyContent: 'center'
  },
  rowTitle: {
    fontSize: 11.5,
    fontWeight: '600',
    letterSpacing: 0
  },
  rowSubtitle: {
    fontSize: 8.8,
    color: '#A1A1AA',
    marginTop: 0.5
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#262626',
    marginVertical: 4.5,
    marginHorizontal: 2
  }
});

