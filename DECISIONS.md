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
