import React from 'react';
import {
  Pencil,
  TrendingUp,
  BarChart3,
  RefreshCw,
  Trash2,
  ShieldCheck,
  Wrench,
  ClipboardList,
  Clock3,
  Receipt,
  Landmark,
  LockKeyhole,
  SlidersHorizontal,
  CloudDownload,
  RotateCcw,
  Printer,
  LogOut,
  CheckCircle2,
  WalletCards,
  FileText
} from 'lucide-react-native';

/**
 * Unified, professional vector icon system for Rongdhonu navigation sidebars.
 * Powered by Lucide React Native — clean outline style, uniform 2px stroke width.
 * Target: 20-22px inside 40-42px container, consistent stroke, zero emojis.
 */
export default function SidebarIcon({ name, color = '#FFFFFF', size = 21, strokeWidth = 2 }) {
  switch (name) {
    // Edit Menu: Pencil / Edit3
    case 'edit':
    case 'pencil':
    case 'edit3':
      return <Pencil size={size} color={color} strokeWidth={strokeWidth} />;

    // Business Analytics: TrendingUp / ChartNoAxesCombined
    case 'analytics':
    case 'trending-up':
      return <TrendingUp size={size} color={color} strokeWidth={strokeWidth} />;

    // Item Sales Report: BarChart3
    case 'barchart':
    case 'bar-chart':
    case 'barchart3':
      return <BarChart3 size={size} color={color} strokeWidth={strokeWidth} />;

    // Sync Diagnostics / Same-Day Resync: RefreshCw / Activity
    case 'sync':
    case 'refresh':
    case 'link':
    case 'activity':
      return <RefreshCw size={size} color={color} strokeWidth={strokeWidth} />;

    // Delete History: Trash2
    case 'trash':
    case 'trash2':
      return <Trash2 size={size} color={color} strokeWidth={strokeWidth} />;

    // Device Control: ShieldCheck
    case 'shield':
    case 'shield-check':
    case 'device':
      return <ShieldCheck size={size} color={color} strokeWidth={strokeWidth} />;

    // System Tools: Wrench / Settings2
    case 'tools':
    case 'wrench':
    case 'settings':
      return <Wrench size={size} color={color} strokeWidth={strokeWidth} />;

    // Activity & Audit Logs: ClipboardList / FileText
    case 'document':
    case 'clipboard':
    case 'clipboard-list':
    case 'file-text':
      return <ClipboardList size={size} color={color} strokeWidth={strokeWidth} />;

    // অতীতের হিসাব যোগ: History / Clock3
    case 'clock':
    case 'history':
    case 'clock3':
      return <Clock3 size={size} color={color} strokeWidth={strokeWidth} />;

    // Sales Report / Add Ijara: Receipt / CreditCard
    case 'card':
    case 'receipt':
    case 'credit-card':
      return <Receipt size={size} color={color} strokeWidth={strokeWidth} />;

    // Deposit Report / Owner Finance: Landmark / Building2
    case 'bank':
    case 'landmark':
    case 'finance':
      return <Landmark size={size} color={color} strokeWidth={strokeWidth} />;

    // Reset Daily Lock: LockKeyhole
    case 'lock':
    case 'lock-keyhole':
      return <LockKeyhole size={size} color={color} strokeWidth={strokeWidth} />;

    // Reset History Limits: SlidersHorizontal
    case 'sliders':
    case 'sliders-horizontal':
      return <SlidersHorizontal size={size} color={color} strokeWidth={strokeWidth} />;

    // Cloud Restore: CloudDownload
    case 'cloud':
    case 'cloud-download':
      return <CloudDownload size={size} color={color} strokeWidth={strokeWidth} />;

    // Recover Menu Items / Auto Ijara Rollback: RotateCcw / Undo2
    case 'recovery':
    case 'rollback':
    case 'undo':
    case 'rotate-ccw':
      return <RotateCcw size={size} color={color} strokeWidth={strokeWidth} />;

    // Printer Settings: Printer
    case 'printer':
      return <Printer size={size} color={color} strokeWidth={strokeWidth} />;

    // Logout: LogOut
    case 'logout':
      return <LogOut size={size} color={color} strokeWidth={strokeWidth} />;

    // Owner / Manager: Ijara Added (CheckCircle2 / Lock)
    case 'ijara-added':
    case 'check-circle':
      return <CheckCircle2 size={size} color={color} strokeWidth={strokeWidth} />;

    // Owner: Supplier Due (WalletCards / FileText)
    case 'wallet':
    case 'supplier-due':
      return <WalletCards size={size} color={color} strokeWidth={strokeWidth} />;

    default:
      return <FileText size={size} color={color} strokeWidth={strokeWidth} />;
  }
}
