import React, { useRef, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import ReceiptPaper from './ReceiptPaper';
import {
  STATUS,
  RECEIPT_RASTER_WIDTH,
  getStatus,
  printReceipt
} from '../services/printer';

/**
 * components/AutoReceiptPrinter.js
 *
 * Silently prints a receipt when an order completes AND the printer is already
 * connected & verified. It does nothing otherwise (no dialogs, no scanning) —
 * so it never blocks checkout and never duplicates a receipt.
 *
 * The hidden ReceiptPaper is the capture source for the printer raster.
 */
export default function AutoReceiptPrinter({ order, onDone }) {
  const paperRef = useRef(null);

  useEffect(() => {
    if (!order) return undefined;
    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        const status = getStatus();
        // Silent auto-print only for a connected, user-verified printer.
        if (status.status !== STATUS.CONNECTED_READY || !paperRef.current) return;

        const base64 = await captureRef(paperRef.current, {
          format: 'png',
          result: 'base64',
          width: RECEIPT_RASTER_WIDTH,
          quality: 1
        });
        if (cancelled) return;

        await printReceipt(order, { getBase64: async () => base64 });
      } catch (e) {
        console.log('[Printer] Auto-print skipped:', e && e.message);
      } finally {
        if (!cancelled && onDone) onDone();
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [order, onDone]);

  if (!order) return null;

  return (
    <View style={styles.hidden} pointerEvents="none">
      <ReceiptPaper ref={paperRef} order={order} width={RECEIPT_RASTER_WIDTH} />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', left: -10000, top: 0, width: RECEIPT_RASTER_WIDTH }
});
