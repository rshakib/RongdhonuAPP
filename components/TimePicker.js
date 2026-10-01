/**
 * components/TimePicker.js — dependency-free time picker (no native module).
 * Same look as CalendarPicker. Picks an hour/minute; the caller decides what to
 * do with it (here: "show everything from this time onward").
 */

import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Modal } from 'react-native';

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

const pad = (n) => String(n).padStart(2, '0');
const to12 = (h24) => { const h = h24 % 12; return h === 0 ? 12 : h; };
const to24 = (h12, pm) => { const base = h12 % 12; return pm ? base + 12 : base; };

/** "4:30 PM" */
export function formatTime12(hour24, minute) {
  const pm = Number(hour24) >= 12;
  return `${to12(Number(hour24))}:${pad(Number(minute))} ${pm ? 'PM' : 'AM'}`;
}

export default function TimePicker({ visible, value = null, onSelect, onClose, title = 'সময় বেছে নিন' }) {
  const [hour24, setHour24] = useState(0);
  const [minute, setMinute] = useState(0);

  useEffect(() => {
    if (!visible) return;
    const now = new Date();
    setHour24(value && Number.isFinite(value.hour) ? value.hour : now.getHours());
    setMinute(value && Number.isFinite(value.minute) ? value.minute : 0);
  }, [visible, value]);

  const pm = hour24 >= 12;
  const hour12 = to12(hour24);

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{formatTime12(hour24, minute)}</Text>

          <View style={styles.ampmRow}>
            <TouchableOpacity
              style={[styles.ampmBtn, !pm && styles.ampmActive]}
              onPress={() => setHour24(to24(hour12, false))}
              activeOpacity={0.8}
            >
              <Text style={[styles.ampmText, !pm && styles.ampmTextActive]}>সকাল (AM)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.ampmBtn, pm && styles.ampmActive]}
              onPress={() => setHour24(to24(hour12, true))}
              activeOpacity={0.8}
            >
              <Text style={[styles.ampmText, pm && styles.ampmTextActive]}>বিকাল (PM)</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionLabel}>ঘণ্টা</Text>
          <View style={styles.grid}>
            {HOURS.map((h) => {
              const active = h === hour12;
              return (
                <TouchableOpacity
                  key={h}
                  style={[styles.cell, active && styles.cellActive]}
                  onPress={() => setHour24(to24(h, pm))}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.cellText, active && styles.cellTextActive]}>{h}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>মিনিট</Text>
          <View style={styles.grid}>
            {MINUTES.map((mm) => {
              const active = mm === minute;
              return (
                <TouchableOpacity
                  key={mm}
                  style={[styles.cell, active && styles.cellActive]}
                  onPress={() => setMinute(mm)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.cellText, active && styles.cellTextActive]}>{pad(mm)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.ghostBtn}
              onPress={() => { const d = new Date(); setHour24(d.getHours()); setMinute(0); }}
              activeOpacity={0.8}
            >
              <Text style={styles.ghostBtnText}>এখন</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => { if (onSelect) onSelect({ hour: hour24, minute }); }}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryBtnText}>ঠিক আছে</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ghostBtn} onPress={onClose} activeOpacity={0.8}>
              <Text style={styles.ghostBtnText}>বন্ধ</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 380, backgroundColor: '#0D0D0D', borderRadius: 18, borderWidth: 1.5, borderColor: '#FFB703', padding: 16 },
  title: { color: '#FFFFFF', fontSize: 15, fontWeight: 'bold' },
  subtitle: { color: '#FFB703', fontSize: 22, fontWeight: '800', marginTop: 6, marginBottom: 10 },

  ampmRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  ampmBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2D2D2D',
    backgroundColor: '#161616',
    alignItems: 'center'
  },
  ampmActive: { borderColor: 'rgba(255, 183, 3, 0.6)', backgroundColor: 'rgba(255, 183, 3, 0.15)' },
  ampmText: { color: '#999', fontSize: 12.5, fontWeight: '600' },
  ampmTextActive: { color: '#FFB703', fontWeight: '800' },

  sectionLabel: { color: '#888', fontSize: 11, fontWeight: '600', marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 },
  cell: { width: `${100 / 6}%`, height: 38, justifyContent: 'center', alignItems: 'center', borderRadius: 10 },
  cellActive: { backgroundColor: '#FFB703' },
  cellText: { color: '#E5E7EB', fontSize: 13, fontWeight: '600' },
  cellTextActive: { color: '#000000', fontWeight: 'bold' },

  footer: { flexDirection: 'row', gap: 10, marginTop: 4 },
  ghostBtn: { flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: '#161616', borderWidth: 1, borderColor: '#2D2D2D', alignItems: 'center' },
  ghostBtnText: { color: '#E5E7EB', fontSize: 13, fontWeight: '600' },
  primaryBtn: { flex: 1.4, paddingVertical: 11, borderRadius: 10, backgroundColor: '#FFB703', alignItems: 'center' },
  primaryBtnText: { color: '#000000', fontSize: 13, fontWeight: '800' }
});
