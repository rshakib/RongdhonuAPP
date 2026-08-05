# EXPORT ENDPOINT AUDIT REPORT

**Date:** 2026-08-05  
**Target Subsystem:** Google Sheets Integration & AI Dataset Pipeline  

---

## 1. Exporter Endpoint Inventory & Audit Matrix

| Exporter | Function Name | File Name | Environment Variable | Payload Format | Target Sheet Tab | Apps Script Deployment | Verification Status |
|:---------|:--------------|:----------|:---------------------|:---------------|:-----------------|:-----------------------|:-------------------:|
| **AI Daily Sales Dataset** | `processAIDatasetQueue()` | `database.js` | `EXPO_PUBLIC_AI_DATASET_WEBAPP_URL` | Structured Batch JSON (`sheets.dailySales.rows`) | `AI_Daily_Sales_Dataset` | [`scripts/googleAppsScript_Production.js`](file:///run/media/shaki/2472D89F72D87750/Apps/rong/scripts/googleAppsScript_Production.js) | ✅ SEPARATED |
| **AI Item Sales Dataset** | `processAIDatasetQueue()` | `database.js` | `EXPO_PUBLIC_AI_DATASET_WEBAPP_URL` | Structured Batch JSON (`sheets.itemSales.rows`) | `AI_Item_Sales_Dataset` | [`scripts/googleAppsScript_Production.js`](file:///run/media/shaki/2472D89F72D87750/Apps/rong/scripts/googleAppsScript_Production.js) | ✅ SEPARATED |
| **Weather Export** | `captureHourlyWeather()` | `database.js` | `EXPO_PUBLIC_WEATHER_WEBAPP_URL` | Legacy Flat Row Object (`BusinessDate`, `Temperature`, `WeatherCondition`) | `Weather_Timeline` | Dedicated Weather Apps Script | ✅ SEPARATED |
| **Sync Diagnostics Status Check** | `getDatabaseHealth()` | `database.js` | `EXPO_PUBLIC_GOOGLE_SHEETS_WEBAPP_URL` | Diagnostic Config Check | N/A (Status Only) | N/A | ✅ VERIFIED |

---

## 2. Key Endpoint Separations Implemented

1. **Dedicated AI Dataset WebApp URL**:
   - `EXPO_PUBLIC_AI_DATASET_WEBAPP_URL` configured in `.env`.
   - Used strictly by `processAIDatasetQueue()` for `AI_DAILY_SALES_DATASET` and `AI_ITEM_SALES_DATASET` batch payloads.

2. **Dedicated Weather WebApp URL**:
   - `EXPO_PUBLIC_WEATHER_WEBAPP_URL` configured in `.env`.
   - Reserved exclusively for legacy hourly `WEATHER` timeline exports.

3. **Fallback & Legacy Preservation**:
   - `EXPO_PUBLIC_GOOGLE_SHEETS_WEBAPP_URL` maintained for backward compatibility.

---

## 3. Subsystem Architecture Protection

- **Builder**: Untouched (`buildDailyDataset`, `buildItemDataset`).
- **Validator**: Untouched (`validateDailyDataset`, `validateItemDataset`).
- **Queue**: Untouched (`ai_dataset_queue`).
- **Dataset Schemas**: Frozen `1.0.0` (62 daily fields, 27 item fields).
- **Transport Logic**: Lossless batch payload formatting unchanged.
- **Unit Test Suite**: **198 / 198 PASS (0 Failures)**.
