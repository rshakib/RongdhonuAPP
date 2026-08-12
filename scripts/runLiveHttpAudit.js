/**
 * Runtime Simulation of End-to-End Daily Submit & Real HTTP Transport Execution
 * Executes against live Google Apps Script WebApp URL in .env
 */

const { buildBatchPayload, transmitBatchToGoogleSheets, processStructuredTransportResponse } = require('../services/aiDataset/transport/googleSheets');
const fetch = require('node-fetch');
global.fetch = fetch;

const webappUrl = "https://script.google.com/macros/s/AKfycby3hT9OTujiMFgXUQIhUNQa5cepBYy3nBnuownUVuOlGsWtt3ZkbEEh40D32X3WIRnWtA/exec";

// Mock SQLite state for real HTTP verification
class LiveSimDb {
  constructor() {
    const testDate = '2026-08-05';
    this.queue = [
      {
        id: testDate,
        type: 'AI_DAILY_SALES_DATASET',
        business_date: testDate,
        status: 'PENDING',
        retry_count: 0,
        last_error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        payload: JSON.stringify({
          dataset_id: testDate,
          business_date: testDate,
          schema_version: '1.0.0',
          dataset_version: '1.0.0',
          exported_at: new Date().toISOString(),
          total_sales: 18500,
          total_expense: 4200,
          total_orders: 45,
          cash_sales: 12000,
          bkash_sales: 6500,
          nagad_sales: 0, rocket_sales: 0, card_sales: 0,
          is_training_ready: 1,
          validation_errors: '[]',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
      },
      {
        id: `ITEM_${testDate}`,
        type: 'AI_ITEM_SALES_DATASET',
        business_date: testDate,
        status: 'PENDING',
        retry_count: 0,
        last_error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        payload: JSON.stringify([
          {
            dataset_id: `${testDate}_item_101`,
            business_date: testDate,
            item_id: 'item_101',
            item_name: 'Chicken Burger',
            category_name: 'Food',
            schema_version: '1.0.0',
            dataset_version: '1.0.0',
            exported_at: new Date().toISOString(),
            unit_price: 250,
            total_quantity_sold: 15,
            total_item_revenue: 3750,
            is_training_ready: 1,
            validation_errors: '[]',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        ])
      }
    ];
    this.history = [];
  }

  runSync(query, params = []) {
    const q = query.trim().toUpperCase();
    if (q.startsWith('UPDATE AI_DATASET_QUEUE SET STATUS =')) {
      if (q.includes('IS_SYNCED = 1')) {
        const [updatedAt, id] = params;
        const rec = this.queue.find(r => r.id === id);
        if (rec) {
          rec.status = 'SUCCESS';
          rec.is_synced = 1;
          rec.last_error = null;
          rec.updated_at = updatedAt;
        }
      } else {
        const [status, retryCount, lastError, updatedAt, id] = params;
        const rec = this.queue.find(r => r.id === id);
        if (rec) {
          rec.status = status;
          rec.retry_count = retryCount;
          rec.last_error = lastError;
          rec.updated_at = updatedAt;
        }
      }
    } else if (q.startsWith('INSERT OR REPLACE INTO AI_DATASET_HISTORY')) {
      const [id, date, type, exportedAt, createdAt, updatedAt] = params;
      const idx = this.history.findIndex(r => r.id === id);
      const newRec = { id, date, type, exported_at: exportedAt, created_at: createdAt, updated_at: updatedAt, is_synced: 1 };
      if (idx !== -1) this.history[idx] = newRec;
      else this.history.push(newRec);
    }
  }
}

async function runRealHttpAudit() {
  console.log('====================================================================');
  console.log('         REAL END-TO-END HTTP TRANSPORT AUDIT EXECUTION             ');
  console.log('====================================================================\n');

  const db = new LiveSimDb();

  // 1. Queue counts before transport
  const pendingCount = db.queue.filter(r => r.status === 'PENDING').length;
  const retryCount = db.queue.filter(r => r.status === 'RETRY').length;
  const inProgressCount = db.queue.filter(r => r.status === 'IN_PROGRESS').length;

  console.log('1. ai_dataset_queue counts before transport:');
  console.log(`   - PENDING: ${pendingCount}`);
  console.log(`   - RETRY: ${retryCount}`);
  console.log(`   - IN_PROGRESS: ${inProgressCount}`);

  // 2. Selected batch IDs
  const batchPayload = buildBatchPayload(db.queue);
  console.log('\n2. Selected batch IDs:');
  console.log(`   - Record IDs:`, batchPayload.recordIds);

  // 3. Exact HTTP request URL
  console.log('\n3. Exact HTTP Request URL:');
  console.log(`   - URL: ${webappUrl}`);

  // Transition to IN_PROGRESS
  db.queue.forEach(r => { r.status = 'IN_PROGRESS'; });

  // Execute real HTTP transmission
  console.log('\n--- Transmitting HTTP POST to Google Apps Script WebApp... ---');
  const result = await transmitBatchToGoogleSheets(webappUrl, batchPayload);

  // 4. HTTP status
  console.log('\n4. HTTP Status:');
  console.log(`   - Status: ${result.status}`);

  // 5. Response Content-Type
  console.log('\n5. Response Content-Type:');
  console.log(`   - Content-Type: ${result.contentType || 'N/A'}`);

  // 6. Full untruncated response body
  console.log('\n6. Full Untruncated Response Body:');
  console.log(result.rawText);

  // 7. Parsed JSON (if available)
  console.log('\n7. Parsed JSON:');
  console.log(JSON.stringify(result.body, null, 2));

  // Process response in SQLite
  processStructuredTransportResponse(db, db.queue, result);

  // 8. Queue state after processing
  console.log('\n8. Queue State After Processing:');
  db.queue.forEach(r => {
    console.log(`   - [ID: ${r.id}] Status: ${r.status} | Sync: ${r.is_synced || 0} | RetryCount: ${r.retry_count || 0} | LastError: ${r.last_error}`);
  });

  // 9. ai_dataset_history changes
  console.log('\n9. ai_dataset_history Entries Added:');
  console.log(`   - Total History Records: ${db.history.length}`);
  db.history.forEach(h => {
    console.log(`   - [ID: ${h.id}] Date: ${h.date} | Type: ${h.type} | ExportedAt: ${h.exported_at}`);
  });

  console.log('\n====================================================================');
  console.log('                    AUDIT EXECUTION COMPLETE                        ');
  console.log('====================================================================');
}

runRealHttpAudit().catch(err => {
  console.error("Audit Execution Error:", err);
});
