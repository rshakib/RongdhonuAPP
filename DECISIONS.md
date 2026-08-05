# DECISIONS.md

> **Rongdhonu POS & Admin Management Suite — Architecture Decision Records (ADRs)**
>
> This file is the permanent record of significant architectural decisions made during development.
> Each ADR captures what was decided, why it was decided, and what alternatives were rejected.
>
> **Mandatory Rule**: Any architectural decision that affects data flow, storage, transport, security,
> naming conventions, or module boundaries MUST be recorded here.
>
> Cross-reference: [`PROJECT_ARCHITECTURE_LOG.md`](./PROJECT_ARCHITECTURE_LOG.md) | [`CHANGELOG.md`](./CHANGELOG.md)

---

## ADR-001 — SQLite as the Single Source of Truth

**Status:** ✅ Accepted  
**Date:** 2026-08-05

### Decision

SQLite is the **one and only source of truth** for all business data.

All business logic reads, financial calculations, dataset exports, and reporting
must derive data exclusively from local SQLite tables. No feature may read
Firestore, Google Sheets, React state, or UI variables as a primary data source.

### Reason

- Supports offline-first architecture — the app functions fully without internet.
- Eliminates dependency on Firestore read quotas and network latency for core business operations.
- Guarantees deterministic, reproducible results for financial reports and AI datasets.
- Enables transaction-safe daily submit with atomic SQLite writes.

### Alternatives Considered

| Alternative | Outcome | Reason Rejected |
|-------------|:-------:|-----------------|
| Firestore as source of truth | ❌ Rejected | Requires internet; read quota costs; non-deterministic offline behavior |
| Google Sheets as source of truth | ❌ Rejected | Not a database; no transaction support; network-only |
| In-memory React state as source | ❌ Rejected | Lost on app restart; not durable; non-deterministic |

### Consequences

- All features must write to SQLite first before any cloud sync.
- Google Sheets and Firestore are **output destinations only** — never read for business logic.
- The AI Dataset Builder reads strictly from SQLite — zero Firestore, zero Google Sheets reads.
- Firestore sync operates as a background replication layer, not a query source.

---

## ADR-002 — Production Architecture Freeze for AI Dataset Sync v1.0.0

**Status:** ✅ Accepted & Frozen  
**Date:** 2026-08-05  
**Version:** `v1.0.0`

### Decision

The **AI Dataset Sync Pipeline v1.0.0** is officially frozen and marked **PRODUCTION READY**.

No structural modifications, schema alterations, field name changes, or transport layer re-architecting are permitted for version `1.0.0`.

Any future schema modification (adding, removing, or renaming fields, or altering data types) **MUST** follow strict Semantic Schema Versioning rules and increment `schema_version` to `1.1.0` or higher. Existing historical exported rows must never be mutated or invalidated.

### Architecture Stack (Frozen)

| Layer | Primary Module | Responsibility |
|-------|----------------|----------------|
| **Source of Truth** | SQLite (`Rongdhonu POS DB`) | Primary local database storing `daily_submit`, `daily_summary`, `order_items`, `menu_items`, `off_days` |
| **Schema & Rules** | `services/aiDataset/schema.js` | Definitive schema locked at `schema_version = "1.0.0"`. 62 daily fields + 27 item fields |
| **Field Mapper** | `services/aiDataset/mapper.js` | Direct and derived SQL mappings, ISO-8601 week number, calendar and salary cycle logic |
| **Validation Engine** | `services/aiDataset/validator.js` | Strict mathematical validation rules (payment sum verification, bounds checks, training readiness) |
| **Dataset Builder** | `services/aiDataset/builder.js` | Exposes `buildDailyDataset()` & `buildItemDataset()`. Returns immutable `Object.freeze()` dataset objects |
| **Queue Engine** | `database.js` (`enqueueAIDatasetExport`) | Write-only SQLite queue management (`ai_dataset_queue`). Idempotent insertion on `dataset_id` |
| **Transport Layer** | `services/aiDataset/transport/googleSheets.js` | Batch Export Engine (`DEFAULT_BATCH_SIZE = 25`), compact JSON serialization, Google Apps Script WebApp communication, per-record response parser (`processStructuredTransportResponse`) |
| **Preview Helper** | `services/aiDataset/preview.js` | Read-only developer & QA preview inspector (`generateDatasetPreview()`) |

### Reason

- Guarantees 100% deterministic dataset generation for AI/ML training models.
- Prevents breaking changes in down-stream Python ML pipelines.
- Ensures zero regression risks to offline POS transactions and daily settlement flows.
- Validated via 188 automated unit tests with 100% pass rate across all layers.

### Consequences

1. Any schema modification requires incrementing `schema_version` in `schema.js`.
2. Existing exported datasets in Google Sheets tabs (`AI_Daily_Sales_Dataset`, `AI_Item_Sales_Dataset`) remain retro-compatible.
3. Transport layer supports batching up to 25 items and handles per-record partial success gracefully.

---

## ADR-003 — Transition to Long-term Data Collection Mode

**Status:** ✅ Accepted & Active  
**Date:** 2026-08-05  
**Subsystem:** AI Dataset Subsystem v1.0.0

### Decision

With the completion of **Phase 5.2 (AI Dataset Audit Center)**, the AI Dataset Subsystem officially transitions into **DATA COLLECTION MODE**.

No new architectural features, schema changes, queue modifications, or transport layer re-designs will be introduced for version `1.0.0`. The system will run autonomously in production, building and exporting high-quality ML datasets on daily submission.

### Active Guarantees

1. **SQLite Single Source of Truth**: All data reads derive from SQLite. Zero Firestore reads.
2. **Zero POS Impact**: POS transactions and daily settlements execute without performance impact.
3. **Idempotency**: All queue operations use `INSERT OR REPLACE INTO ai_dataset_queue`.
4. **Batch Transport**: Transmits up to 25 records per HTTP request to dedicated Google Sheets tabs.
5. **Per-Record Isolation**: Individual dataset success/failure handling prevents batch cascading failures.
6. **Admin-Only Monitoring & Auditing**: Full diagnostic visibility via `AIDatasetMonitorScreen` and `AIDatasetAuditCenterScreen`.

---


