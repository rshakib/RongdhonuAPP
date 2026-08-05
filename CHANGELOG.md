# CHANGELOG

> **Rongdhonu Cafe & Restaurant — POS & Admin Management Suite**
> Maintained alongside `PROJECT_ARCHITECTURE_LOG.md`.
> Every commit that changes the project MUST update this file.

## v1.6.0 — AI Dataset Phase 3 Queue Integration

**Release Date:** 2026-08-05  
**Git Commit:** `bf699fc`

### Added
- Integrated Phase 2 Dataset Builder and Validator with `ai_dataset_queue` via `enqueueAIDatasetExport()` in `database.js`
- Automated Phase 3 unit test suite in `tests/queue.test.js` (39 tests)
- `test:queue` script in `package.json`

### Changed
- `enqueueAIDatasetExport()` in `database.js` replaced with modular implementation calling `buildDailyDataset()` and `buildItemDataset()`, running validation before insertion
- `ai_dataset_queue` insertion made strictly idempotent (`INSERT OR REPLACE INTO ai_dataset_queue`)
- `enqueueAIDatasetExport()` made write-only — removed legacy inline call to `processAIDatasetQueue()`

### Documentation
- `PROJECT_ARCHITECTURE_LOG.md` updated with Section 24 (Phase 3 Integration Pipeline, Queue Schema & Guarantees)

---

## v1.5.0 — AI Dataset Post-Release Refinements

**Release Date:** 2026-08-05  
**Git Commit:** `400b3a5`

### Added
- ISO-8601 compliant week number calculation replacing the old `ceil(day/7)` approximation
- Standalone unit test suite — 143 tests across 3 files, zero external dependencies
  - `tests/builder.test.js` — 63 tests covering ISO week, schema completeness, ranking, calendar, defaults, immutability, performance
  - `tests/validator.test.js` — 37 tests covering all validation rules and isTrainingReady logic
  - `tests/mapper.test.js` — 43 tests covering mapper coverage, source table correctness, zero-Firestore verification
- `npm run test:all` script to run the full suite in one command
- Dataset Preview Tool (`services/aiDataset/preview.js`) — read-only developer/QA inspection helper exposing `generateDatasetPreview()` and `printDatasetPreview()`
- Dataset Schema Version History section in `PROJECT_ARCHITECTURE_LOG.md`

### Changed
- `week_number` field now uses correct ISO-8601 standard (Week 1 = first Thursday of year, weeks start Monday)
- `mapper.js` documentation updated to reflect ISO-8601 derivation formula
- `package.json` test scripts added

### Documentation
- `PROJECT_ARCHITECTURE_LOG.md` updated with Sections 23, 24, 25 (Post-2.5 refinements, schema version history, updated file structure)

---

## v1.4.0 — AI Dataset Phase 2.5 Verification Suite

**Release Date:** 2026-08-05  
**Git Commit:** `9711755`

### Added
- Read-only static verification suite for the Dataset Builder
- Verified: schema completeness (62+27 fields), determinism, financial consistency, immutability, item ranking, calendar features, missing data defaults, performance (365 days @ 0.005ms/record)

### Documentation
- `PROJECT_ARCHITECTURE_LOG.md` updated with Section 22 (Phase 2.5 Verification Results — 8/8 PASS)

---

## v1.3.0 — AI Dataset Phase 2 — Dataset Builder

**Release Date:** 2026-08-05  
**Git Commit:** `418b049`

### Added
- `services/aiDataset/builder.js` — pure Dataset Builder exposing exactly two public functions:
  - `buildDailyDataset(businessDate)` — returns one frozen validated Daily Dataset object
  - `buildItemDataset(businessDate)` — returns an array of frozen validated Item Dataset objects
- Calendar/salary cycle derivations (`is_month_start`, `is_month_end`, `days_until_salary`, `days_after_salary`)
- Festival classification logic (`Religious`, `National`, `Local Event`, `Weekend`, `None`)
- Item popularity signals (`item_rank_today`, `item_share_percent`)
- Training readiness flag (`is_training_ready`) — only `1` if both `is_complete` and `is_valid`
- `validateDailyDataset()` and `validateItemDataset()` functions in `validator.js`
- `Object.freeze()` on every returned dataset object

### Changed
- All dataset objects are now immutable at the point of creation

### Documentation
- `PROJECT_ARCHITECTURE_LOG.md` updated with builder file structure

---

## v1.2.0 — AI Dataset Phase 1 — Schema, Mapper, Validator, Queue Architecture

**Release Date:** 2026-08-05  
**Git Commits:** `eb0fefb`, `994bbf9`, `5d7a72d`

### Added
- `services/aiDataset/schema.js` — production frozen ML dataset schemas (`DAILY_SALES_DATASET_SCHEMA`, `ITEM_SALES_DATASET_SCHEMA`) with 62 daily fields and 27 item fields
- `services/aiDataset/mapper.js` — SQL source mapping documentation for every field
- `services/aiDataset/validator.js` — dataset validation rule definitions and cross-field check documentation
- `services/aiDataset/README.md` — architectural directives and phase roadmap
- `PROJECT_ARCHITECTURE_LOG.md` — single permanent master architecture document (22+ sections)
- AI Dataset queue tables `ai_dataset_queue` and `ai_dataset_history` in SQLite
- `enqueueAIDatasetExport()` — transaction-safe trigger, called ONLY after `submitDailySheet()` succeeds
- `processAIDatasetQueue()` — status lifecycle dispatcher (`PENDING → IN_PROGRESS → SUCCESS / FAILED → RETRY`)
- Crash recovery for stale `IN_PROGRESS` records on app restart
- Raw Dataset Principle: rolling time-series features excluded from SQLite export (computed during Python ML preprocessing)

### Changed
- Legacy `ml_export_queue` → `ai_dataset_queue`
- Legacy `ml_export_history` → `ai_dataset_history`
- Legacy `enqueueDailyMLExports()` → `enqueueAIDatasetExport()`
- Legacy `processMLExportQueue()` → `processAIDatasetQueue()`
- Legacy worksheet targets (`DailySummary`, `ItemSales`, `WeatherTimeline`) retired
- AI Dataset export now targets dedicated sheets: `AI_Daily_Sales_Dataset`, `AI_Item_Sales_Dataset` only

### Deprecated
- All legacy ML Export payload formats (`SUMMARY`, `ITEM_SALES`, `WEATHER`)
- All legacy ML Export business logic and worksheet targets

### Documentation
- Full master architecture log created covering all 25+ sections

---

## v1.1.0 — Bengali Localization & Branding Standardization

**Release Date:** 2026-08-05  
**Git Commits:** `5f74b15`, `088eb6e`, `2167c13`, `760f21b`, `4ce7c72`

### Changed
- All user-facing administrator branding updated from English `Shakib` → Bengali `সাকিব`
- All warning alerts, confirmation dialogs, and permission prompts converted to natural Bengali
- Offline Mode toggle alert localized to Bengali with `সাকিব` branding

### Fixed
- `StatusBar` import crash resolved — now uses `import { StatusBar as RNStatusBar } from 'react-native'`

---

## v1.0.5 — Login UI Refinements

**Release Date:** 2026-08-05  
**Git Commits:** `22f6891`, `b25bf8c`, `ca9a4c6`, `c2967cf`

### Changed
- Login screen layout refined: logo removed, then restored in compact modern layout
- Sync mode toggle moved to top-right pill
- Control widths standardized to 88% with horizontal centering
- Vertical spacing rebalanced
- "Created by" credit footer added

### Fixed
- `RNStatusBar` import crash on safe area calculation

---

## v1.0.4 — Device Registry Normalization

**Release Date:** 2026-08-05  
**Git Commit:** `f60bb73`

### Fixed
- Device registry primary key normalized from `id` to `device_id` to eliminate duplicate device entries on app reinstall

---

## v1.0.3 — Opening Ijara Calculation Update

**Release Date:** 2026-08-05  
**Git Commit:** `9bb97bd`

### Changed
- Next Day Opening Ijara now calculated as `Total Sales (cash + all digital modes) − expenses − deposit`
- Aligns Ijara carry-forward with total revenue, not cash-only revenue

---

## v1.0.2 — Analytics & UI Polish

**Release Date:** 2026-08-02  
**Git Commits:** `b35be09`, `f097e31`, `04d16f7`

### Added
- Business Health Score summary card above KPI section in Analytics screen

### Fixed
- Side menu item label updated to `📱 Device Control`
- Android status bar safe area and chart tooltip padding adjusted

---

## v1.0.1 — Daily Submit & Ijara Improvements

**Release Date:** 2026-06-27 – 2026-07-31  
**Git Commits:** `a674b98`, `b626d86`, `cdc6005`, `6445e22`, `556c1a6`, `f050a3e`

### Added
- Persistent Eja (Ijara) carry-forward system
- Mandatory previous-day submit enforcement before current-day access
- Daily Submit priority enforcement (POS blocked until submit completed)
- Delete history icons and improved filtering in transaction history

### Changed
- Auto daily submit replaced with enforced manual submission for all roles
- Supplier due ledger rolling `current_due` logic simplified

---

## v1.0.0 — Admin Tools, Database Explorer & Stable Pre-Release

**Release Date:** 2026-06-27  
**Git Commits:** `a967dc5`, `dea93e6`, `892253a`, `b5ba32c`, `449c71e`, `574696b`

### Added
- Admin System Tools Phase 1
- Admin Database Explorer Phase 3 with full filter system
- Row Detail Screen with grouped cards, datetime formatting, taka amounts, and collapsible raw data
- Read-only PRAGMA statements allowed in inspector query executor

### Removed
- Recovery Center module removed from Admin menu

---

## v0.9.0 — POS Core, Sync Engine & ML Export Foundation

**Release Date:** 2026-05-31 – 2026-06-14  
**Git Commits:** `f1e9868`, `732dff0`, `cfee8ea`, `5e090f6`, `5792139`, `9fd4e0b`, `d13803f`, `5f7bf8d`, `320791e`

### Added
- Split payment system (Cash + bKash + Nagad + Rocket)
- Under-payment support with cashbox display
- Supplier Due Ledger system
- Auto midnight Ijara rollover
- Smart History Download — optimized Firestore reads with daily download limits
- Instant sequential sync recovery on network reconnect
- Per-collection sync cycle analytics in diagnostics panel
- Unified past account system and startup delta sync
- Initial ML Export pipeline (WeatherTimeline, persistent queue) — later replaced by AI Dataset Sync

### Fixed
- Water sales calculation: added `unit_price` column, passing price from UI
- Delivery charge money accounting correctly separated from sales
- Monthly sales calculation strictly filters by current month
- 403 sync error: ML export metadata made local-only
- Sync marker gap resolved with production diagnostics
- Split bill: total allowed to exceed bill amount; actual received amount recorded

### Removed
- Firebase Usage and Cleanup Tool from Admin menu
- Legacy auto-submit system replaced with enforced manual submission

---

## v0.1.0 — Initial Commit

**Release Date:** 2026-05-30  
**Git Commit:** `e367d35`

### Added
- Initial project scaffold: React Native (Expo SDK v56), SQLite, Firebase Firestore integration
- Base POS order entry, daily summary, and admin screens

---

*This changelog is maintained alongside `PROJECT_ARCHITECTURE_LOG.md` and `DECISIONS.md`.*
*Future policy: every commit → update code + PROJECT_ARCHITECTURE_LOG.md + CHANGELOG.md + DECISIONS.md (if applicable) + git commit.*
