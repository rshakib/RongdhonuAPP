import React from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function RowDetailScreen({ rowData, onBack }) {
  const formatValue = (val) => {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    
    // Check if it's a JSON string
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          const parsed = JSON.parse(val);
          return JSON.stringify(parsed, null, 2);
        } catch (e) {}
      }
    }
    
    if (typeof val === 'object') {
      return JSON.stringify(val, null, 2);
    }
    
    return String(val);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>❮ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Row Details</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content}>
        <Text style={styles.sectionTitle}>Formatted Fields</Text>
        
        {Object.entries(rowData).map(([key, value]) => {
          const formatted = formatValue(value);
          const isNested = formatted.includes('\n');
          
          return (
            <View key={key} style={styles.fieldBlock}>
              <Text style={styles.keyText}>{key.replace(/_/g, ' ').toUpperCase()}</Text>
              <View style={[styles.valueContainer, isNested && styles.nestedContainer]}>
                <Text style={[styles.valueText, isNested && styles.nestedText]}>
                  {formatted}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderColor: '#1A1A1A' },
  backBtn: { padding: 4 },
  backBtnText: { color: '#FFB703', fontWeight: 'bold' },
  headerTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  content: { padding: 16 },
  sectionTitle: { color: '#888', fontSize: 12, fontWeight: 'bold', marginBottom: 16, textTransform: 'uppercase' },
  fieldBlock: { marginBottom: 16 },
  keyText: { color: '#FFB703', fontSize: 11, fontWeight: 'bold', marginBottom: 6 },
  valueContainer: { backgroundColor: '#111', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#222' },
  nestedContainer: { backgroundColor: '#0A0A0A', borderColor: '#333' },
  valueText: { color: '#FFF', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  nestedText: { color: '#34D399', fontSize: 11, lineHeight: 16 }
});
