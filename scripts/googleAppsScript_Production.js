/**
 * GOOGLE APPS SCRIPT PRODUCTION BACKEND CODE (v1.0.0)
 * 
 * Instructions:
 * 1. Open Google Sheets -> Extensions -> Apps Script
 * 2. Replace Code.gs with this exact audited code.
 * 3. Click Deploy -> New deployment -> Select Web app:
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the WebApp deployment URL.
 */

function doPost(e) {
  try {
    console.log("=== RECEIVED INCOMING POST REQUEST ===");

    // 1. Validate Event & PostData Object
    if (!e) {
      throw new Error("Invalid request event: 'e' is null or undefined.");
    }
    if (!e.postData || !e.postData.contents) {
      throw new Error("Invalid postData: 'e.postData.contents' is missing or empty.");
    }

    // 2. Parse JSON Payload
    var payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      throw new Error("Failed to parse JSON postData: " + parseErr.message);
    }

    // 3. Object Validation Helper
    function assertObject(obj, name) {
      if (!obj || typeof obj !== 'object') {
        throw new Error("Invalid object at " + name + ": " + JSON.stringify(obj));
      }
    }

    assertObject(payload, "doPost (payload)");

    // 4. Log Detailed Diagnostic Telemetry
    console.log("Received Payload:", JSON.stringify({
      spreadsheetName: payload.spreadsheetName,
      batchSize: payload.batchSize,
      recordIdsCount: payload.recordIds ? payload.recordIds.length : 0,
      hasSheets: !!payload.sheets
    }));

    // 5. Validate Root Payload Structure
    if (!payload.recordIds || !Array.isArray(payload.recordIds)) {
      throw new Error("Invalid payload: 'recordIds' is missing or not an array.");
    }
    assertObject(payload.sheets, "payload.sheets");
    assertObject(payload.sheets.dailySales, "payload.sheets.dailySales");
    assertObject(payload.sheets.itemSales, "payload.sheets.itemSales");

    var dailyRows = payload.sheets.dailySales.rows || [];
    var itemRows = payload.sheets.itemSales.rows || [];

    // --- TEMPORARY DIAGNOSTIC LOGS FOR RUNTIME PAYLOAD SHAPE PROOF ---
    Logger.log(JSON.stringify({
      dailyRowsIsArray: Array.isArray(payload.sheets.dailySales.rows),
      dailyRowsLength: payload.sheets.dailySales.rows ? payload.sheets.dailySales.rows.length : null,
      dailyFirstRowType: typeof (payload.sheets.dailySales.rows && payload.sheets.dailySales.rows[0]),

      itemRowsIsArray: Array.isArray(payload.sheets.itemSales.rows),
      itemRowsLength: payload.sheets.itemSales.rows ? payload.sheets.itemSales.rows.length : null,
      itemFirstRowIsArray: Array.isArray(payload.sheets.itemSales.rows && payload.sheets.itemSales.rows[0]),
      itemFirstRowType: typeof (payload.sheets.itemSales.rows && payload.sheets.itemSales.rows[0])
    }));

    Logger.log("ITEM ROWS PAYLOAD PROOF: " + JSON.stringify(payload.sheets.itemSales.rows));
    // -----------------------------------------------------------------

    console.log("Daily Dataset Count:", dailyRows.length);
    console.log("Item Dataset Count:", itemRows.length);
    console.log("Target Sheet Names:", [payload.sheets.dailySales.targetTab, payload.sheets.itemSales.targetTab]);

    var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create(payload.spreadsheetName || "AI_Sales_Datasets");
    
    // 6. Write Daily Sales Rows
    writeRowsToSheet(ss, payload.sheets.dailySales.targetTab || "AI_Daily_Sales_Dataset", dailyRows);

    // 7. Write Item Sales Rows
    writeRowsToSheet(ss, payload.sheets.itemSales.targetTab || "AI_Item_Sales_Dataset", itemRows);

    // 8. Construct Individual Per-Record Results
    var results = payload.recordIds.map(function(id) {
      return {
        dataset_id: id,
        status: "SUCCESS",
        message: "Updated successfully"
      };
    });

    var responseObj = {
      success: true,
      processed: payload.recordIds.length,
      results: results
    };

    return ContentService
      .createTextOutput(JSON.stringify(responseObj))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.error("CRITICAL APPS SCRIPT EXCEPTION:", err.message);

    var recordIds = [];
    try {
      if (e && e.postData && e.postData.contents) {
        var parsed = JSON.parse(e.postData.contents);
        if (parsed && Array.isArray(parsed.recordIds)) recordIds = parsed.recordIds;
      }
    } catch (_) {}

    var errorResults = recordIds.map(function(id) {
      return {
        dataset_id: id,
        status: "FAILED",
        message: err.message
      };
    });

    var errorResponse = {
      success: false,
      error: err.message,
      processed: 0,
      results: errorResults
    };

    return ContentService
      .createTextOutput(JSON.stringify(errorResponse))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Safely writes tabular JSON row objects to a target sheet tab
 */
function writeRowsToSheet(ss, tabName, rows) {
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    console.log("No rows to write for tab:", tabName);
    return;
  }

  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }

  // Safe Header Extraction without bare Object.keys call on null
  var sampleRow = rows[0];
  if (!sampleRow || typeof sampleRow !== 'object') {
    throw new Error("Invalid row object at writeRowsToSheet (" + tabName + "): " + JSON.stringify(sampleRow));
  }

  var headers = Object.keys(sampleRow);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }

  var dataMatrix = rows.map(function(row) {
    if (!row || typeof row !== 'object') {
      throw new Error("Invalid row in matrix mapping (" + tabName + "): " + JSON.stringify(row));
    }
    return headers.map(function(header) {
      var val = row[header];
      return (val === null || val === undefined) ? "" : val;
    });
  });

  sheet.getRange(sheet.getLastRow() + 1, 1, dataMatrix.length, headers.length).setValues(dataMatrix);
}
