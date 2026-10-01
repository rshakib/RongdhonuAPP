/**
 * components/CalendarPicker.js — a dependency-free calendar (no @react-native-community/
 * datetimepicker, no native module, nothing to rebuild for). Pure JS grid from
 * services/calendarGrid.js; weeks start Sunday, Bengali month names, tap a day to pick it.
 */

import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Modal } from 'react-native';
import { buildMonthGrid, shiftMonth, parseDay, formatDayBn, toDayString } from '../services/calendarGrid';

/** Today in DEVICE-LOCAL time (matches how the app computes business days). */
function todayLocalString() {
  const d = new Date();
  return toDayString(d.getFullYear(), d.getMonth(), d.getDate());
}

export default function CalendarPicker({ visible, value = null, onSelect, onClose, title = 'তারিখ বেছে নিন' }) {
  const today = todayLocalString();
  const start = parseDay(value) || parseDay(today);
  const [cursor, setCursor] = useState({ year: start.y, month: start.m });

  // Re-open on the month of the current value each time it is shown.
  useEffect(() => {
    if (!visible) return;
    const p = parseDay(value) || parseDay(todayLocalString());
    setCursor({ year: p.y, month: p.m });
  }, [visible, value]);

  const grid = buildMonthGrid(cursor.year, cursor.month, value, today);
  const pretty = formatDayBn(value);

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {pretty ? <Text style={styles.subtitle}>{pretty}</Text> : null}

          <View style={styles.monthRow}>
            <TouchableOpacity
              style={styles.navBtn}
              onPress={() => setCursor((c) => shiftMonth(c.year, c.month, -1))}
              activeOpacity={0.8}
            >
              <Text style={styles.navBtnText}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.monthTitle}>{grid.title}</Text>
            <TouchableOpacity
              style={styles.navBtn}
              onPress={() => setCursor((c) => shiftMonth(c.year, c.month, 1))}
              activeOpacity={0.8}
            >
              <Text style={styles.navBtnText}>›</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.weekRow}>
            {grid.weekdays.map((w) => (
              <Text key={w} style={styles.weekday}>{w}</Text>
            ))}
          </View>

          <View style={styles.grid}>
            {grid.cells.map((c, i) => (
              <TouchableOpacity
                key={c.day || `blank-${i}`}
                style={[styles.cell, c.isSelected && styles.cellSelected, c.isToday && !c.isSelected && styles.cellToday]}
                onPress={() => { if (c.day && onSelect) onSelect(c.day); }}
                disabled={!c.day}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.cellText,
                    c.isWeekend && styles.cellWeekend,
                    c.isSelected && styles.cellTextSelected
                  ]}
                >
                  {c.dayNum || ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.todayBtn}
              onPress={() => { if (onSelect) onSelect(today); }}
              activeOpacity={0.8}
            >
              <Text style={styles.todayBtnText}>আজ</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8}>
              <Text style={styles.closeBtnText}>বন্ধ করুন</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#0D0D0D',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#FFB703',
    padding: 16
  },
  title: { color: '#FFFFFF', fontSize: 15, fontWeight: 'bold' },
  subtitle: { color: '#FFB703', fontSize: 12, marginTop: 3, marginBottom: 4 },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 8
  },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
    justifyContent: 'center',
    alignItems: 'center'
  },
  navBtnText: { color: '#E5E7EB', fontSize: 18, fontWeight: '700', lineHeight: 22 },
  monthTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekday: { flex: 1, textAlign: 'center', color: '#888888', fontSize: 10.5, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10
  },
  cellSelected: { backgroundColor: '#FFB703' },
  cellToday: { borderWidth: 1, borderColor: '#FFB703' },
  cellText: { color: '#E5E7EB', fontSize: 12.5, fontWeight: '600' },
  cellWeekend: { color: '#FCA5A5' },
  cellTextSelected: { color: '#000000', fontWeight: 'bold' },
  footer: { flexDirection: 'row', gap: 10, marginTop: 12 },
  todayBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#161622',
    borderWidth: 1,
    borderColor: '#2D2D44',
    alignItems: 'center'
  },
  todayBtnText: { color: '#93C5FD', fontSize: 13, fontWeight: '600' },
  closeBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center'
  },
  closeBtnText: { color: '#E5E7EB', fontSize: 13, fontWeight: '600' }
});
