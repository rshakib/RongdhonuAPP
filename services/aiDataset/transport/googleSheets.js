/**
 * AI Dataset Transport Layer — Google Sheets WebApp Transport
 *
 * Target Profile: ADMIN APP / BACKGROUND SYNC SERVICE ONLY
 * Purpose: Responsible exclusively for:
 *   1. Batching PENDING dataset queue records (configurable batch size, default: 25)
 *   2. Compact, lossless JSON serialization (excluding debug/transient fields)
 *   3. Google Apps Script WebApp REST HTTP communication
 *   4. Transport error handling & response parsing
 *   5. Future compression readiness (extensible architecture)
 *
 * STRICT BOUNDARIES:
 * - NO direct SQLite queries (passed formatted records/batches from caller).
 * - NO business logic / dataset generation (strictly handled by builder.js).
 * - NO Firestore, UI state, or React state access.
 */

// ── CONFIGURATION ──────────────────────────────────────────────────────
export const DEFAULT_BATCH_SIZE = 25;
export const DEFAULT_MAX_RETRIES = 5;
export const SPREADSHEET_NAME = 'Rongdhonu_ML_Dataset';

/**
 * Compacts and sanitizes a single dataset object or item dataset array for transport.
 * Removes debug/transient fields while maintaining 100% losslessness for ML features.
 *
 * @param {Object|Array} payloadObj - Raw dataset object or array of item dataset objects
 * @returns {Object|Array} Sanitized lossless object or array ready for transport
 */
export function optimizePayloadForTransport(payloadObj) {
  if (!payloadObj) return null;

  if (Array.isArray(payloadObj)) {
    return payloadObj.map(item => optimizePayloadForTransport(item));
  }

  if (typeof payloadObj !== 'object') return payloadObj;

  // Create clean shallow copy
  const clean = { ...payloadObj };

  // Strip transient / debug-only keys if present (none in production v1.0.0, but defensive)
  delete clean._debug;
  delete clean._temp;
  delete clean.__v;

  return clean;
}

/**
 * Builds a compact, lossless batch payload containing up to BATCH_SIZE dataset records.
 *
 * @param {Array<Object>} queueRecords - Array of queue records from SQLite
 * @returns {Object} Lossless compact batch object ready for HTTP transmission
 */
export function buildBatchPayload(queueRecords) {
  const dailyRows = [];
  const itemRows = [];
  const processedRecordIds = [];

  for (const record of queueRecords) {
    processedRecordIds.push(record.id);
    let parsedPayload;
    try {
      parsedPayload = typeof record.payload === 'string' ? JSON.parse(record.payload) : record.payload;
    } catch (e) {
      console.error(`[AI Transport] Failed to parse payload for record ${record.id}:`, e.message);
      continue;
    }

    const cleanPayload = optimizePayloadForTransport(parsedPayload);

    if (record.type === 'AI_DAILY_SALES_DATASET') {
      dailyRows.push(cleanPayload);
    } else if (record.type === 'AI_ITEM_SALES_DATASET') {
      // item payload is an array of item rows
      if (Array.isArray(cleanPayload)) {
        itemRows.push(...cleanPayload);
      } else {
        itemRows.push(cleanPayload);
      }
    }
  }

  return {
    spreadsheetName: SPREADSHEET_NAME,
    batchSize: queueRecords.length,
    timestamp: new Date().toISOString(),
    compression: 'none', // Reserved for future gzip support
    sheets: {
      dailySales: {
        targetTab: 'AI_Daily_Sales_Dataset',
        rows: dailyRows,
      },
      itemSales: {
        targetTab: 'AI_Item_Sales_Dataset',
        rows: itemRows,
      },
    },
    recordIds: processedRecordIds,
  };
}

/**
 * Sends a compact batch payload to the Google Apps Script WebApp endpoint via HTTP POST.
 *
 * @param {string} webappUrl - Google Apps Script WebApp URL
 * @param {Object} batchPayload - Structured batch payload object from buildBatchPayload()
 * @param {Object} [options={}] - Optional request overrides (e.g. custom headers/timeout)
 * @returns {Promise<{success: boolean, status: number, body?: any, error?: string}>} Response outcome
 */
export async function transmitBatchToGoogleSheets(webappUrl, batchPayload, options = {}) {
  if (!webappUrl || typeof webappUrl !== 'string') {
    return { success: false, status: 0, error: 'INVALID_WEBAPP_URL' };
  }

  if (!batchPayload || !batchPayload.recordIds || batchPayload.recordIds.length === 0) {
    return { success: false, status: 0, error: 'EMPTY_BATCH_PAYLOAD' };
  }

  // Compact JSON serialization (no extra spaces/newlines)
  const jsonBody = JSON.stringify(batchPayload);

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  try {
    const response = await fetch(webappUrl, {
      method: 'POST',
      headers,
      body: jsonBody,
    });

    if (response.ok) {
      let responseData = null;
      try {
        responseData = await response.json();
      } catch (_) {
        // Body might be plain text success message
      }
      return {
        success: true,
        status: response.status,
        body: responseData,
      };
    } else {
      const errText = await response.text().catch(() => '');
      return {
        success: false,
        status: response.status,
        error: `HTTP Error ${response.status}: ${errText.substring(0, 200)}`,
      };
    }
  } catch (err) {
    return {
      success: false,
      status: 0,
      error: `Network Exception: ${err.message}`,
    };
  }
}
