# AI Dataset Sync & ML Export Module Architecture

## Overview

The **AI Dataset Sync** module is a dedicated, production-grade architecture designed for building, validating, and exporting Machine Learning (ML) training datasets for sales forecasting, item demand prediction, and inventory planning.

---

> ⚠️ **ADMIN APP ONLY & PERMANENT DATA SOURCE HIERARCHY DIRECTIVE**
> 
> This entire module and all future ML export features are **strictly restricted to the Admin App (`EXPO_PUBLIC_APP_PROFILE=ADMIN`)**.
> 
> **PERMANENT DATA SOURCE HIERARCHY**:
> - **Level 1 (Only Data Source)**: **✓ Local SQLite Database**
> - **Forbidden Sources**:
>   - ✗ Firestore
>   - ✗ Google Sheets
>   - ✗ REST APIs
>   - ✗ Cloud Functions
>   - ✗ Sync Queue
>   - ✗ Cached Cloud Responses
> - **Google Sheets is an OUTPUT destination ONLY**. It must NEVER be treated as an INPUT or Source of Truth.
> - **SQLite is the one and only source used to build ML datasets**.
> 
> **ZERO REGRESSION POLICY**:
> - Owner App, Manager App, and POS billing workflows are **100% UNTOUCHED**.
> - `submitDailySheet()`, `submitDailySubmit()`, Ijara calculations, deposit calculations, and existing POS analytics remain **100% INDEPENDENT AND UNMODIFIED**.
> - **OPTIONAL WEATHER**: If weather data is unavailable, defaults are set to `NULL` / `UNKNOWN` without failing dataset generation.
> - **FINANCIAL PROTECTION**: Validation rules flag mismatches (`PAYMENT_SUM_CHECK`) in `validation_errors` but NEVER mutate raw financial data.

---

## Module Structure

```
services/
└── aiDataset/
    ├── schema.js       # Production frozen schemas for Daily Sales & Item Sales ML datasets
    ├── mapper.js       # Comprehensive field origins, SQL source tables, & window derivations
    ├── validator.js    # Data cleanliness, anomaly detection, & mathematical consistency rules
    └── README.md       # Architecture documentation, workflow, & roadmap
```

---

## Dataset Specifications

### 1. `daily_sales_dataset.csv`
* **Granularity**: One row per Business Date (`business_date`).
* **Feature Categories**:
  * Date & Calendar (Year, Month, Day, Week, Day of Week, Is Friday, Is Weekend)
  * Weather Features (Temperature, Humidity, Condition, Is Rainy, Wind Speed)
  * Holidays & Events (Is Holiday, Holiday Name, Is Off Day, Reason)
  * Sales KPIs (Total Sales, Payment Method Breakdown, Delivery Sales, Discounts, Net Sales, AOV, Peak Hour)
  * Financial Settlement (Opening Ijara, Expenses, Net Cash, Owner Deposit / Profit, Expense Ratio)
  * Time Series Lag Features (Previous Day Sales, Previous Week Sales, 7-Day Moving Avg, 30-Day Moving Avg, 7-Day Growth %)

### 2. `item_sales_dataset.csv`
* **Granularity**: One row per Menu Item per Business Date (`business_date`, `item_name`).
* **Feature Categories**:
  * Item Identification & Taxonomy (Item Name, Item ID, Category Name)
  * Item Economics (Unit Price, Total Quantity Sold, Total Item Revenue)
  * Contextual Factors (Day of Week, Is Friday, Is Holiday, Is Rainy)
  * Time Series Demand (Previous Week Quantity, 7-Day Moving Avg Quantity, 30-Day Moving Avg Quantity)

---

## Existing Google Sheets Infrastructure Audit & Isolated Worksheet Tab Strategy

> ⚠️ **REUSE INFRASTRUCTURE WITH DEDICATED AI WORKSHEET TABS DIRECTIVE**
> 
> The project **reuses the existing operational Google Sheets sync pipeline**:
> 1. **Endpoint**: Defined via `EXPO_PUBLIC_GOOGLE_SHEETS_WEBAPP_URL`.
> 2. **Target Spreadsheet**: `"Rongdhonu_ML_Dataset"` (Google Apps Script WebApp receiver).
> 3. **Queue Architecture**: `ai_dataset_queue` SQLite table for offline queuing and retry safety.
> 4. **Audit History**: `ai_dataset_history` SQLite table for duplicate prevention.
> 5. **Export Runner**: `processAIDatasetQueue()` in `database.js`.
> 
> ### MANDATORY BUSINESS RULES:
> * **RULE 1 — EXPORT ONLY FINALIZED BUSINESS DAYS**:
>   - The AI Dataset system NEVER exports draft, pending, partial, or working day data.
>   - Export triggers ONLY after a `daily_submit` record has been successfully committed to SQLite.
> * **RULE 2 — IMMUTABLE DATASET POLICY & OVERWRITE MECHANISM**:
>   - Exported business day dataset rows are immutable.
>   - If a business day is legitimately overwritten via `submitDailySheet()`, the existing dataset row is updated via its stable `dataset_id`.
>   - Duplicate rows are NEVER created; exactly 1 row exists per business date in `AI_Daily_Sales_Dataset` and 1 row per date + item in `AI_Item_Sales_Dataset`.
> 
> ### STRICT ISOLATION OF WORKSHEET TABS:
> * **NO Interference with Production Tabs**: AI Dataset Sync MUST NEVER write to, modify, or append to existing production tabs (`"DailySummary"`, `"ItemSales"`, `"WeatherTimeline"`).
> * **Dedicated AI Worksheet Tabs**: All future AI Dataset payloads will target **NEW DEDICATED WORKSHEETS** inside the spreadsheet:
>   - Sheet 1: `"AI_Daily_Sales_Dataset"` (Targeting AI Daily Sales Dataset tab)
>   - Sheet 2: `"AI_Item_Sales_Dataset"` (Targeting AI Item Sales Dataset tab)
> * **NO Parallel API Implementation**: Reuses existing authentication, webapp URL, queue, and dispatch runner.
> * **Output-Only Policy**: Google Sheets is strictly an **OUTPUT destination**. The AI Dataset module will NEVER query, read from, or depend on Google Sheets as an input or source of truth.

---

## Phase Roadmap

* **Phase 1 (Current)**: Architecture & Read-Only Preparation (Isolated module creation, schema freezing, mapper documentation, validation rules definition, Google Sheets infrastructure audit, dedicated AI tab specification, finalized submit & immutability rule enforcement).
* **Phase 2 (Future)**: Read-Only SQL Query Builders & Data Exporters (Admin App CSV / SQLite payload generator targeting `"AI_Daily_Sales_Dataset"` & `"AI_Item_Sales_Dataset"`).
* **Phase 3 (Future)**: Admin Google Sheets Sync Trigger (Reusing existing `processAIDatasetQueue()`).
