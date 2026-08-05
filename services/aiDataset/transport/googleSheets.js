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
    console.log(`[AI Transport Audit] Transmitting batch of ${batchPayload.recordIds.length} records to Google Sheets WebApp...`);

    const response = await fetch(webappUrl, {
      method: 'POST',
      headers,
      body: jsonBody,
    });

    console.log(`[AI Transport Audit] HTTP Response Status: ${response.status} (ok=${response.ok})`);

    const rawText = await response.text().catch(() => '');
    console.log(`[AI Transport Audit] Raw HTTP Response Body (first 300 chars):`, rawText.substring(0, 300));

    if (!response.ok) {
      console.error(`[AI Transport Audit] Classification: HTTP_FAILURE (Status ${response.status})`);
      return {
        success: false,
        classification: 'HTTP_FAILURE',
        status: response.status,
        rawText,
        error: `HTTP Error ${response.status}: ${rawText.substring(0, 200)}`,
      };
    }

    let parsedBody = null;
    try {
      parsedBody = JSON.parse(rawText);
      console.log(`[AI Transport Audit] Parsed JSON Body:`, JSON.stringify(parsedBody).substring(0, 300));
    } catch (parseErr) {
      console.warn(`[AI Transport Audit] Classification: JSON_PARSE_FAILURE. Raw text body is not valid JSON:`, parseErr.message);
      return {
        success: false,
        classification: 'JSON_PARSE_FAILURE',
        status: response.status,
        rawText,
        error: `JSON Parse Failure: ${parseErr.message}`,
      };
    }

    // Evaluate application-level outcome
    const appSuccess = parsedBody && (parsedBody.success === true || parsedBody.status === 'SUCCESS' || parsedBody.status === 'OK');
    const classification = appSuccess ? 'FULL_SUCCESS' : 'APP_LEVEL_FAILURE';

    console.log(`[AI Transport Audit] Validation Result — Classification: ${classification}, success: ${parsedBody?.success}, processed: ${parsedBody?.processed}, resultsCount: ${parsedBody?.results?.length || 0}`);

    return {
      success: appSuccess,
      classification,
      status: response.status,
      body: parsedBody,
      rawText,
      error: appSuccess ? null : (parsedBody?.error || parsedBody?.message || 'Application-level export failure reported by Apps Script'),
    };
  } catch (err) {
    console.error(`[AI Transport Audit] Classification: NETWORK_EXCEPTION:`, err.message);
    return {
      success: false,
      classification: 'NETWORK_EXCEPTION',
      status: 0,
      error: `Network Exception: ${err.message}`,
    };
  }
}

/**
 * Processes structured per-record response from Google Apps Script WebApp
 * and updates SQLite ai_dataset_queue individually for each dataset in the batch.
 * Supports partial batch success and retry count increments on individual failures.
 *
 * Response Format:
 * {
 *   "success": true,
 *   "processed": 25,
 *   "results": [
 *     { "dataset_id": "2026-08-05", "status": "SUCCESS", "message": "Updated successfully" },
 *     { "dataset_id": "2026-08-05_item_101", "status": "FAILED", "message": "Missing required column" }
 *   ]
 * }
 *
 * @param {Object} dbInstance - Expo SQLite database instance
 * @param {Array<Object>} queueRecords - Array of original queue records sent in the batch
 * @param {Object} transportResult - Result returned by transmitBatchToGoogleSheets()
 * @returns {Object} Processing summary { successCount, failCount, totalProcessed }
 */
export function processStructuredTransportResponse(dbInstance, queueRecords, transportResult) {
  const nowIso = new Date().toISOString();
  let successCount = 0;
  let failCount = 0;

  if (!dbInstance || !queueRecords || queueRecords.length === 0) {
    return { successCount: 0, failCount: 0, totalProcessed: 0 };
  }

  // Handle overall transport/HTTP failure (e.g. network down, 500 server error, WebApp unreachable)
  if (!transportResult || !transportResult.success || !transportResult.body) {
    const errorMsg = transportResult?.error || `HTTP ${transportResult?.status || 0} Transport Failure`;
    console.error(`[AI Transport] Entire batch HTTP transport failed:`, errorMsg);

    for (const record of queueRecords) {
      const currentRetry = Number(record.retry_count || 0) + 1;
      const nextStatus = currentRetry >= DEFAULT_MAX_RETRIES ? 'FAILED' : 'RETRY';
      try {
        dbInstance.runSync(
          "UPDATE ai_dataset_queue SET status = ?, retry_count = ?, last_error = ?, updated_at = ? WHERE id = ?",
          [nextStatus, currentRetry, errorMsg, nowIso, record.id]
        );
        failCount++;
      } catch (e) {
        console.error(`[AI Transport DB Error] Failed to update retry status for ${record.id}:`, e.message);
      }
    }

    return { successCount: 0, failCount, totalProcessed: queueRecords.length };
  }

  const responseBody = transportResult.body;
  const resultMap = {};

  if (Array.isArray(responseBody.results)) {
    responseBody.results.forEach(res => {
      if (res && res.dataset_id) {
        resultMap[res.dataset_id] = res;
      }
    });
  }

  for (const record of queueRecords) {
    const recordResult = resultMap[record.id];

    // If script returned individual result for this record
    if (recordResult) {
      if (recordResult.status === 'SUCCESS') {
        try {
          dbInstance.runSync(
            "UPDATE ai_dataset_queue SET status = 'SUCCESS', is_synced = 1, last_error = NULL, updated_at = ? WHERE id = ?",
            [nowIso, record.id]
          );

          dbInstance.runSync(
            `INSERT OR REPLACE INTO ai_dataset_history (id, date, type, exported_at, created_at, updated_at, is_synced)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [record.id, record.business_date || '', record.type || '', nowIso, record.created_at || nowIso, nowIso]
          );

          successCount++;
          console.log(`[AI Transport] Record ${record.id} -> SUCCESS (${recordResult.message || 'Updated'})`);
        } catch (e) {
          console.error(`[AI Transport DB Error] Failed to set SUCCESS for ${record.id}:`, e.message);
        }
      } else {
        // Record failed on Apps Script (status === 'FAILED')
        const currentRetry = Number(record.retry_count || 0) + 1;
        const nextStatus = currentRetry >= DEFAULT_MAX_RETRIES ? 'FAILED' : 'RETRY';
        const failMsg = recordResult.message || 'Apps Script dataset write failed';

        try {
          dbInstance.runSync(
            "UPDATE ai_dataset_queue SET status = ?, retry_count = ?, last_error = ?, updated_at = ? WHERE id = ?",
            [nextStatus, currentRetry, failMsg, nowIso, record.id]
          );
          failCount++;
          console.warn(`[AI Transport] Record ${record.id} -> ${nextStatus} (${failMsg})`);
        } catch (e) {
          console.error(`[AI Transport DB Error] Failed to set ${nextStatus} for ${record.id}:`, e.message);
        }
      }
    } else {
      // Fallback: Apps Script returned 200 OK batch response but omitted this dataset_id from results
      // Treat as SUCCESS if overall responseBody.success is true
      if (responseBody.success) {
        try {
          dbInstance.runSync(
            "UPDATE ai_dataset_queue SET status = 'SUCCESS', is_synced = 1, last_error = NULL, updated_at = ? WHERE id = ?",
            [nowIso, record.id]
          );

          dbInstance.runSync(
            `INSERT OR REPLACE INTO ai_dataset_history (id, date, type, exported_at, created_at, updated_at, is_synced)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [record.id, record.business_date || '', record.type || '', nowIso, record.created_at || nowIso, nowIso]
          );

          successCount++;
        } catch (e) {
          console.error(`[AI Transport DB Error] Fallback SUCCESS update failed for ${record.id}:`, e.message);
        }
      } else {
        const currentRetry = Number(record.retry_count || 0) + 1;
        const nextStatus = currentRetry >= DEFAULT_MAX_RETRIES ? 'FAILED' : 'RETRY';
        dbInstance.runSync(
          "UPDATE ai_dataset_queue SET status = ?, retry_count = ?, last_error = ?, updated_at = ? WHERE id = ?",
          [nextStatus, currentRetry, 'Omitted from response results', nowIso, record.id]
        );
        failCount++;
      }
    }
  }

  console.log(`[AI Transport] Batch processing complete: ${successCount} SUCCESS, ${failCount} FAILED out of ${queueRecords.length} records`);

  return {
    successCount,
    failCount,
    totalProcessed: queueRecords.length,
  };
}

