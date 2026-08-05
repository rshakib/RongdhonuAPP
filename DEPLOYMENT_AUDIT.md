# DEPLOYMENT AUDIT REPORT

**Date:** 2026-08-05  
**Target Profile:** Production Environment Configuration  
**Audit Purpose:** Verify physical WebApp deployment separation between AI Dataset & Weather Exporter  

---

## 1. Actual Deployed WebApp Inventory

| Environment Variable | Deployment ID | Apps Script Project | Purpose | Deployment Status | Verified Separation |
|:---------------------|:--------------|:--------------------|:--------|:------------------|:-------------------:|
| `EXPO_PUBLIC_AI_DATASET_WEBAPP_URL` | `AKfycby3hT9OTujiMFgXUQIhUNQa5cepBYy3nBnuownUVuOlGsWtt3ZkbEEh40D32X3WIRnWtA` | **AI Dataset Sync WebApp** ([`scripts/googleAppsScript_Production.js`](file:///run/media/shaki/2472D89F72D87750/Apps/rong/scripts/googleAppsScript_Production.js)) | Ingestion of `AI_DAILY_SALES_DATASET` (62 fields) and `AI_ITEM_SALES_DATASET` (27 fields) | **Active Production WebApp** | ⚠️ REQUIRES UNIQUE ID |
| `EXPO_PUBLIC_WEATHER_WEBAPP_URL` | `AKfycby3hT9OTujiMFgXUQIhUNQa5cepBYy3nBnuownUVuOlGsWtt3ZkbEEh40D32X3WIRnWtA` | **Weather Timeline WebApp** ([`scripts/googleAppsScript_Weather.js`](file:///run/media/shaki/2472D89F72D87750/Apps/rong/scripts/googleAppsScript_Weather.js)) | Hourly ingestion of `WEATHER` timeline rows | **Active Production WebApp** | ⚠️ SHARED DEPLOYMENT ID |
| `EXPO_PUBLIC_GOOGLE_SHEETS_WEBAPP_URL` | `AKfycby3hT9OTujiMFgXUQIhUNQa5cepBYy3nBnuownUVuOlGsWtt3ZkbEEh40D32X3WIRnWtA` | **Legacy Exporter WebApp** | Backward compatibility fallback | **Legacy Alias** | N/A (Alias Only) |

---

## 2. Critical Audit Finding

> ⚠️ **AUDIT FINDING**: All three environment variables currently point to **the exact same WebApp Deployment ID** (`AKfycby3hT9OTujiMFgXUQIhUNQa5cepBYy3nBnuownUVuOlGsWtt3ZkbEEh40D32X3WIRnWtA`).
> 
> Therefore, endpoint separation exists **only in the codebase**, but not yet in the physical Google Apps Script deployments.

---

## 3. Required Deployment Action Items

To complete 100% physical deployment separation:

1. **Deploy Weather WebApp Independently**:
   - Open Google Sheets → Create a new Apps Script project titled **"Rongdhonu Weather Exporter"**.
   - Copy the dedicated code from [`scripts/googleAppsScript_Weather.js`](file:///run/media/shaki/2472D89F72D87750/Apps/rong/scripts/googleAppsScript_Weather.js).
   - Deploy as Web App (`Execute as: Me`, `Access: Anyone`).
   - Copy the newly generated `<WEATHER_DEPLOYMENT_ID>` and update `.env`:
     ```env
     EXPO_PUBLIC_WEATHER_WEBAPP_URL="https://script.google.com/macros/s/<WEATHER_DEPLOYMENT_ID>/exec"
     ```

2. **Deploy AI Dataset WebApp Independently**:
   - Keep or re-deploy [`scripts/googleAppsScript_Production.js`](file:///run/media/shaki/2472D89F72D87750/Apps/rong/scripts/googleAppsScript_Production.js) on the AI Dataset spreadsheet Web App (`<AI_DEPLOYMENT_ID>`).
   - Update `.env`:
     ```env
     EXPO_PUBLIC_AI_DATASET_WEBAPP_URL="https://script.google.com/macros/s/<AI_DEPLOYMENT_ID>/exec"
     ```

---

## 4. Post-Migration Configuration Template

```env
# -------------------------------------------------------------------------
# Google Sheets Independent WebApp Deployments
# -------------------------------------------------------------------------
EXPO_PUBLIC_AI_DATASET_WEBAPP_URL="https://script.google.com/macros/s/<AI_DEPLOYMENT_ID>/exec"
EXPO_PUBLIC_WEATHER_WEBAPP_URL="https://script.google.com/macros/s/<WEATHER_DEPLOYMENT_ID>/exec"
EXPO_PUBLIC_GOOGLE_SHEETS_WEBAPP_URL="https://script.google.com/macros/s/<AI_DEPLOYMENT_ID>/exec"
```
