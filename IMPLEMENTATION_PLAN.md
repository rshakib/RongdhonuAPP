# RONGDHONU POS — SUPABASE DUAL-DB MIGRATION · IMPLEMENTATION PLAN

> **Type:** Build/sequencing plan (no production code). 8 phases, ordered by dependency + risk.
> **Baseline docs cross-referenced:** `ARCHITECTURE_CURRENT_STATE.md`, `ARCHITECTURE_QUERY_PATTERNS.md`, `DATE_FIELD_ANALYSIS.md`, `VERSION_CONTROL_MIGRATION_NOTES.md`, `RLS_IMPLEMENTATION_PLAN.md`.
> **Generated:** 2026-09-27 · Branch: `feature/admin-dashboard-redesign`

---

## 0. CONFIRMED DESIGN DECISIONS (from clarification)

1. **Read routing = SYNC-LAYER.** Supabase becomes the primary **pull** source feeding local SQLite. Screens keep reading SQLite unchanged. Firebase pull timers stay running (15s/30s/90s/180s) as fallback. **Zero screen changes.**
2. **`daily_submit` / `daily_summary` = Firebase-only** for both pull and fresh-install restore. Dual-**write** to Supabase still happens, but these two tables are never read back from Supabase. Guarantees AdminAnalyticsScreen keeps full lifetime history.

### Non-negotiables restated
- Firebase code path 100% untouched: same collections, same `sync_queue`, same `processSyncQueue`, same intervals, same `firebaseAuth`, same `restoreDatabaseFromCloud` internals.
- Supabase is pure-additive. Any Supabase error/timeout/no-response is swallowed; app behaves exactly as today.
- Every Supabase call goes through `safeSupabaseCall()` (existing) or a **timeout-bounded wrapper**.

---

## PHASE MAP (dependency + risk order)

| Phase | Name | Risk | Depends on | Supabase needed to ship? |
|---|---|---|---|---|
| 1 | Supabase schema & tables | None (server only) | — | Yes |
| 2 | Local scaffolding + dual-write queue | Low | 1 | Yes |
| 3 | Read routing (Supabase-primary pull + Firebase fallback) | Medium | 1,2 | Yes |
| 4 | Correctness & conflict fixes (pre-retention) | Low | — (independent) | No |
| 5 | Rolling 31-day retention (pg_cron) | Low–Medium | 1,3,4 | Yes |
| 6 | Version control migration | Medium | 1,2 | Yes |
| 7 | RLS enforcement (Option B, device-gated) | **High** (lockout) | 1,2 | Yes |

Phase 4 is deliberately placed **before** Phase 5 because the retention cutoff's correctness depends on the `activity_logs` date field being fixed.

---

# PHASE 1 — SUPABASE SCHEMA & TABLES

**Goal:** Create every Supabase table with permissive RLS (no app change). Additive only.

### 1.1 Scope of tables

**Rolling 31-day (13 tables):** `orders`, `order_items`, `payments`, `expenses`, `deliveries`, `due_payments`, `eja_history`, `off_days`, `weather_data`, `supplier_due_history`, `owner_expenses`, `activity_logs`, `supplier_payment_ledger`.

**Permanent / non-windowed (also dual-written):** `menu_items`, `menu_categories`, `restaurant_tables`, `daily_submit`, `daily_summary`, `daily_submit_priority`, `users`, `supplier_due`, `deletions`, `delete_history`, `owner_employees`, `owner_salary_ledger`, `owner_deposits`, `owner_home_deposits`.

**Already exist (do not touch):** `devices`, `device_app_usage`.

**New:** `app_version_policy` (single row `id='global'`).

> Total = 28 new tables + 2 existing + 1 version = **30 tables** (matches `RLS_IMPLEMENTATION_PLAN.md §1`).

### 1.2 Files
- **Create** `supabase_full_setup.sql` — consolidated, idempotent DDL: `devices` + `device_app_usage` + 28 POS tables + `app_version_policy`, indexes, FK cascades, permissive RLS. ✅ DONE (Phase 1 complete; replaces the old `supabase_schema.sql`, now deleted).
- **Create** `supabase_schema_pos.sql` (optional split) if you prefer to keep device schema separate.

### 1.3 Key schema rules
- Omit `is_synced` (SQLite-local only).
- Add FK cascades: `order_items.order_id → orders(id) ON DELETE CASCADE`, `payments.order_id → orders(id) ON DELETE CASCADE`, `owner_salary_ledger.employee_id → owner_employees(id) ON DELETE CASCADE`.
- Start with **permissive RLS** exactly like the existing `devices`/`device_app_usage` policies (`FOR ALL USING (true) WITH CHECK (true)`) so nothing is gated yet.
- Add indexes on rolling-date columns per `DATE_FIELD_ANALYSIS.md §5` (e.g. `orders(created_at)`, `daily_submit(date)`, `activity_logs(created_at)`).

### 1.4 Pending decision gate (do NOT skip)
Before Phase 5, Supabase's `daily_submit`/`daily_summary` cannot be assumed to hold history — they will be dual-written only going forward. **Supabase pull for these two tables is disabled (Phase 0 decision #2), so no backfill is required for correctness.** Document this explicitly in the schema file.

### 1.5 Firebase-untouched verification
- No app code changed. Run `npm run test:all` — must be 100% green (baseline unchanged).

### 1.6 Supabase-down test
- N/A (app not yet using Supabase). Optionally confirm existing app still boots with `EXPO_PUBLIC_SUPABASE_URL` blank (dormant mode).

### 1.7 Rollback
- `DROP TABLE` the new tables (or reset the Supabase project). Zero app impact since nothing reads them yet.

---

# PHASE 2 — LOCAL SCAFFOLDING + DUAL-WRITE QUEUE

**Goal:** Every existing write also enqueues a parallel Supabase push. Firebase `sync_queue` behavior is byte-for-byte unchanged.

### 2.1 New SQLite table
```sql
CREATE TABLE IF NOT EXISTS sync_queue_supabase (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT,
  table_name TEXT,
  action TEXT,                     -- INSERT | UPDATE | DELETE
  status TEXT DEFAULT 'PENDING',   -- PENDING | SUCCESS | FAILED
  created_at TEXT,
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,
  last_attempt_at TEXT
);
```
Add via a new `migrateSupabaseSyncQueue()` in `database.js` (mirrors `migrateSyncQueueDiagnostics()` pattern). Called from `initDatabase()`.

### 2.2 Single choke-point for dual-write
**Do NOT touch the ~180 call sites.** Extend the existing `enqueueSync(tableName, recordId, action)` in `database.js` so that **after** it does today's exact Firebase enqueue, it delegates to a new `enqueueSupabaseSync(tableName, recordId, action)`.

- Same guards as Firebase: skip `_fb_auth_*`, skip local-only tables (`ai_dataset_queue`, `ai_dataset_history`, `weather_timeline_queue`), skip `app_config` collection.
- Idempotent delete-then-insert (`DELETE ... WHERE record_id=? AND table_name=? AND status='PENDING'`).
- **Fully try/catch-isolated** — a Supabase enqueue failure must not affect the Firebase enqueue (Firebase enqueue runs first; Supabase enqueue wrapped in its own try/catch).

### 2.3 New file: `services/supabaseSyncQueue.js`
| New function | Signature | Behavior |
|---|---|---|
| `enqueueSupabaseSync(tableName, recordId, action)` | `→ void` | Insert into `sync_queue_supabase`. Never throws. |
| `processSupabaseSyncQueue(singleRecordId?, singleTableName?)` | `async → {successfulWrites, failedWrites}` | Batch ≤20 PENDING then FAILED; exponential backoff `min(10min, 2^retry*30s)`; reads SQLite row by id → upsert/delete on Supabase via `safeSupabaseCall` + timeout; on success delete queue row; on failure mark `FAILED`. |
| `startSupabaseSyncService()` | `→ void` | 5s `setInterval` (mirrors `startSyncService()`), skips when backgrounded, concurrency-locked. |
| `syncSupabaseRecordImmediately(table, id)` | `async → boolean` | Immediate single-record push (mirror of `syncRecordImmediately`). |

- Push mechanism = **parallel/independent**. Never awaited by Firebase path.
- Timeout wrapper: `withTimeout(promise, ms)` (reuse `AbortController` pattern from `firebaseAuth.js`). Suggested default **4000 ms**.
- Deletes: `supabase.from(table).delete().eq('id', recordId)`. Inserts/updates: re-read the SQLite row, strip `is_synced`, upsert (`.upsert(payload, { onConflict: <pk> })`). PK differs per table (`id` vs `date` vs `business_date`) — reuse the same special-casing already in `processSyncQueue` (L1712–L1718).

### 2.4 `services/supabaseClient.js` changes
- Add `setSupabaseDeviceId(deviceId)` (refactored `buildClient` + runtime `supabaseInstance.rest.headers['x-device-id']` mutation) — **exact code already drafted in `RLS_IMPLEMENTATION_PLAN.md §2.3`.**
- Add optional `withTimeout`/`safeSupabaseCallWithTimeout` helper for all POS reads/writes.
- Keep dormant-mode behavior identical.

### 2.5 `App.js` changes
- After `await registerDeviceIfNeeded(...)` (App.js ~L442), call `setSupabaseDeviceId(deviceRecord.device_id)` (device id from `getCurrentDeviceRecord()`).
- Start `startSupabaseSyncService()` **after** the existing `startSyncService()` call (so Firebase daemon is untouched).
- Add a kill-switch flag `EXPO_PUBLIC_SUPABASE_SYNC_ENABLED` (default `true`); when `false`, dual-write is skipped entirely.

### 2.6 Dual-write exception (sequential)
- Version-policy admin update is the ONLY sequential write (Phase 6), not parallel.

### 2.7 New local columns — decision
- **Not required.** The queue is the source of truth for unsynced Supabase writes (same model Firebase already uses). No `is_synced_supabase` flag needed initially. (Optional future diagnostics-only column noted in §Risks.)

### 2.8 Firebase-untouched verification
- `git diff database.js` → only additive lines inside `enqueueSync` (after the Firebase insert) + new migration call.
- Run `npm run test:all`. Additionally assert in a test that with Supabase unconfigured, `enqueueSync` produces **exactly one** `sync_queue` row and **zero** rows in `sync_queue_supabase` (or only PENDING rows that never process).

### 2.9 Supabase-down test
- Set `EXPO_PUBLIC_SUPABASE_URL=''` → `isSupabaseConfigured()` false → dual-write no-ops. Create an order; confirm Firebase sync_queue push + Firestore PATCH still occur; app fully functional.
- Point URL at a black-hole host (or block DNS) → `processSupabaseSyncQueue` marks FAILED, backoff; Firebase unaffected; no UI error.

### 2.10 Rollback
- Set `EXPO_PUBLIC_SUPABASE_SYNC_ENABLED=false` (instant, no code revert). Optionally `DELETE FROM sync_queue_supabase`.

---

# PHASE 3 — READ ROUTING (SUPABASE-PRIMARY PULL + FIREBASE FALLBACK)

**Goal:** Cloud→SQLite pulls prefer Supabase, fall back to Firebase, transparently. Firebase timers untouched.

### 3.1 New file: `services/supabaseSync.js`
| New function | Mirrors | Interval | Tables |
|---|---|---|---|
| `syncSupabaseTables()` | `syncTablesOnly` | Realtime + 15s fallback | `restaurant_tables` |
| `syncSupabaseHighFrequencyCollections()` | `syncHighFrequencyCollections` | 8s | `orders`,`order_items`,`payments`,`deliveries` |
| `syncSupabaseDeletions()` | `syncDeletionsOnly` | 20s | `deletions` |
| `syncSupabaseLowFrequencyCollections()` | `syncLowFrequencyCollections` | 60s | recent-window tables minus high-freq, minus `daily_submit`/`daily_summary` |
| `subscribeSupabaseTablesRealtime(onChange)` | — | websocket | `restaurant_tables` postgres_changes |
| `restoreSupabaseWindow({mode, profile})` | `restoreDatabaseFromCloud` | on install | per §5 scope |

Each function:
1. Number-guard with its own `isPullingSupabaseX` flag (mirror existing guards).
2. Query Supabase (delta via `updated_at`/`created_at` cursor stored in `app_config` as `last_sync_time_supabase_{table}`; full fetch via pagination on first run).
3. On **any** failure/timeout → **call the existing Firebase sync function as fallback in the same tick** (`syncXCollections()`), so the local DB still gets updated exactly as today.
4. Merge into SQLite **only** for tables Supabase covers; `daily_submit`/`daily_summary` are excluded and remain Firebase-pulled.

### 3.2 Merge rules (precedence)
- **Supabase row wins** when both clouds return the same row within a cycle *if* its `updated_at` is newer; otherwise keep existing local logic (only newer `updated_at` overwrites; preserve local `is_synced=0` pending edits).
- Reuse the **Schema Guardian** pattern (`PRAGMA table_info` → only insert existing columns) from `restoreDatabaseFromCloud` L2512–L2528.
- `restaurant_tables`: accept only `table_1`…`table_8`.

### 3.3 Files
- **Create** `services/supabaseSync.js`.
- **Modify** `App.js` — add `setInterval` timers (8s/20s/60s) + realtime subscription **alongside** (not replacing) the existing 15s/30s/90s/180s Firebase timers. Register each with `registerSyncTimer(...)` for diagnostics.
- **Modify** `database.js` — export small helpers if needed for Schema Guardian reuse (or duplicate the helper inside `supabaseSync.js` to avoid touching `database.js` internals).
- **Modify** `restoreDatabaseFromCloud` **or** route via a new `restoreDatabaseHybrid()` — see Phase 5/§Restore.

### 3.4 Fresh-install restore behavior (per decisions)
- **ADMIN / OWNER:** restore last 31 days of **transactional** tables from **Supabase**; `menu_items`/`menu_categories` from **Firebase**; `restaurant_tables` from **Supabase**; `daily_submit`/`daily_summary` from **Firebase**.
- **MANAGER:** restore only **current business day** from Supabase (same table split).
- **Fallback:** if the Supabase window returns empty/fails (see Risk R1), fall back to existing Firebase restore path unchanged.
- `devices` self-registers; `app_version_policy` fetched live (Phase 6) — neither is a “restore” concern.

### 3.5 Firebase-untouched verification
- Firebase timer table in App.js unchanged (diff shows only additions).
- With Supabase down, all 4 Supabase sync fns fall through to the Firebase fns → identical local state to today.
- `npm run test:all` green.

### 3.6 Supabase-down test
- Blank URL → Supabase pull fns are no-ops/fail-fast and immediately call the Firebase fallbacks. Verify: create order on device A, confirm device B receives it via the **Firebase** 30s pull (unchanged latency).
- Add artificial latency (proxy/mock throwing `ETIMEDOUT`) → confirm fallback within the same tick, no UI error, no crash.
- `EXPO_PUBLIC_SUPABASE_SYNC_ENABLED=false` → Supabase pulls skipped entirely; Firebase-only behavior.

### 3.7 Rollback
- Kill switch off. Revert App.js timer additions. Local SQLite already holds Firebase data, so no data repair needed.

---

# PHASE 4 — CORRECTNESS & CONFLICT FIXES (PRE-RETENTION)

**Goal:** Fix the two in-scope conflict issues. Independent of Supabase; safe to ship alone.

### 4.1 `activity_logs` business-date UTC bug (must precede Phase 5)
- **File:** `services/activityLogger.js` L52–L54.
- **Change:** replace `now.toISOString().split('T')[0]` with an **Asia/Dhaka-aware** date computation. Reuse the pattern from `services/appUsageTracker.js` `getDhakaBusinessDate()` (the only existing Dhaka-correct helper). Extract a shared helper (e.g. add `getDhakaBusinessDate` export to `database.js`, or import from `appUsageTracker`).
- **Note / risk R5:** `DATE_FIELD_ANALYSIS.md §5` recommends the retention cutoff for `activity_logs` use `created_at` (not `business_date`) because of this exact bug. **Do both:** fix `business_date` AND have the Phase-5 cron use `(created_at AT TIME ZONE 'Asia/Dhaka')::date < cutoff`.

### 4.2 `daily_submit` same-role multi-device tie-breaker
- **Files:** `database.js` — `saveDailySubmitPriority()`, `getDailySubmitPriority()`, `getRolePriority()`, `submitDailySheet()`, and the conflict check in `processSyncQueue()` (L1729–L1762).
- **Change:** extend `daily_submit_priority` (already has `sync_source_device`) with a deterministic tie-breaker: **`device_id` + `submitted_at` timestamp**. When remote and local priority are **equal** (two managers / two admins), the higher `submitted_at` (later submit) wins; ties broken by lexicographic `device_id`. Apply the same rule in the Supabase push path (`processSupabaseSyncQueue`).
- Mirror the existing remote-priority check for the Supabase queue so both backends resolve identically.
- **Local table change:** `daily_submit_priority` needs a `submitted_at` column if not already present (it has `created_at`/`updated_at`; use `submitted_at` explicit for clarity) — add via migration.

### 4.3 Explicitly OUT OF SCOPE (note only, do not touch)
- `expenses` stable-ID overwrite race (`exp_YYYY-MM-DD_category`).
- `supplier_payment_ledger` INSERT OR REPLACE overwrite + 48h post-edit-only lock.
- `supplier_due` read-modify-write running-balance race.
Document these three in the plan header as deferred.

### 4.4 Firebase-untouched verification
- `activity_logs` fix changes only the local `business_date` value written (Firebase payload field `business_date` will now be Dhaka-correct — this is a **bug fix**, not a schema change; flag it in release notes).
- `daily_submit` tie-breaker adds a field; confirm Firebase push still succeeds (additive Firestore field).

### 4.5 Supabase-down test
- N/A (no Supabase dependency). Run `npm run test:activity` + `npm run test:firebase-auth`.

### 4.6 Rollback
- Revert the two commits. Data already written with old dates remains; acceptable.

---

# PHASE 5 — ROLLING 31-DAY RETENTION (pg_cron)

**Goal:** Server-side delete of >31-day rows from the 13 rolling tables. Never touches local SQLite or Firebase history.

### 5.1 New file: `supabase_cron.sql`
- Enable extension: `CREATE EXTENSION IF NOT EXISTS pg_cron;`
- cutoff = `(now AT TIME ZONE 'Asia/Dhaka')::date - INTERVAL '31 days'`.
- Per-table deletes **exactly per `DATE_FIELD_ANALYSIS.md §5`**:
  - `orders`/`order_items`/`payments`/`expenses`/`due_payments`: `(created_at AT TIME ZONE 'Asia/Dhaka')::date < cutoff`
  - `deliveries`: `COALESCE((completed_at AT TIME ZONE 'Asia/Dhaka')::date, (created_at AT TIME ZONE 'Asia/Dhaka')::date) < cutoff`
  - `eja_history`/`off_days`/`weather_data`/`supplier_due_history`/`supplier_payment_ledger`/`owner_expenses`: `<date-column>::date < cutoff`
  - `activity_logs`: `(created_at AT TIME ZONE 'Asia/Dhaka')::date < cutoff`
- Schedule ~03:30 Asia/Dhaka daily: `cron.schedule('30 21 * * *', ...)` (UTC 21:30 = 03:30 BST).
- **Explicitly exclude** the permanent set (`menu_*`, `restaurant_tables`, `devices`, `device_app_usage`, `app_version_policy`, `daily_submit`, `daily_summary`) and non-windowed tables.

### 5.2 Files
- **Create** `supabase_cron.sql` (or `database/retention.sql`).
- No app code change.

### 5.3 Firebase-untouched verification
- Firebase Firestore has **no** TTL/retention — confirm none added. Local SQLite is never rolling-deleted — confirm no `deleteDataByDate` calls introduced by this phase.

### 5.4 Supabase-down test
- N/A (server-only). Verify the cron does **not** run if extension unavailable (fails safe; no app impact).

### 5.5 Rollback
- `SELECT cron.unschedule('<jobname>')` or `DROP EXTENSION pg_cron`. Deleted rows are gone from Supabase but still exist in Firebase (Firebase remains full history). Re-pull will restore the 31-day window; history beyond 31 days is only needed by analytics, which uses Firebase.

---

# PHASE 6 — VERSION CONTROL MIGRATION

**Goal:** Supabase-first version policy, Firebase wrapper unchanged as fallback.

### 6.1 Supabase table (from Phase 1)
`app_version_policy` (single row `id='global'`, permanent, never rolling-deleted) — schema from `VERSION_CONTROL_MIGRATION_NOTES.md §6.1` (`minimum_required_version`, `minimum_version`, `latest_version`, `update_url`, `force_update_enabled`, `update_message`, `updated_at`). Public SELECT; admin UPDATE (RLS in Phase 7).

### 6.2 New/moved code: `fetchVersionPolicyDualDB()` / `setVersionPolicyDualDB()`
- **Preferred:** add to `services/firebaseAppConfig.js` (keeps `compareSemver`, `DEFAULT_VERSION_POLICY`, `checkAppVersionPolicy`, `APP_VERSION`, SQLite cache logic in one place) — exact flow in `VERSION_CONTROL_MIGRATION_NOTES.md §6.2/§6.3`.
- **Read:** Supabase `app_version_policy` with **3–4s timeout** → on success return + write SQLite `cached_version_policy` → on fail **call existing `fetchVersionPolicy()` (Firebase) unchanged** → on fail SQLite cache → on fail `DEFAULT_VERSION_POLICY`.
- `checkAppVersionPolicy(role)` public signature/output **unchanged** (ADMIN-exempt, semver, `updateRequired`, blocking screen). Only its internal `fetchVersionPolicy` call becomes the dual wrapper.
- **Write (sequential, rare admin action):** Supabase first → then best-effort Firebase `setVersionPolicy()` → then SQLite cache. Existing biometric + PIN gate in `AdminDB.js` (L445–L481) unchanged.

### 6.3 Files
- **Modify** `services/firebaseAppConfig.js` — add dual read/write wrappers; keep all existing exports.
- **Modify** `screens/AdminDB.js` — the save call (currently `setMinimumVersion(cleanVer)` ~L487) routes to the dual writer. **Keep biometric + PIN unchanged.**
- **Modify** `App.js` — no call-site change needed (still calls `checkAppVersionPolicy`), unless you prefer to swap to the explicit dual fn at the 5 call sites (`VERSION_CONTROL_MIGRATION_NOTES.md §3`).

### 6.4 Firebase-untouched verification
- `checkAppVersionPolicy` return contract unchanged → all 5 call sites behave identically.
- With Supabase down, read path falls to Firebase exactly as today.

### 6.5 Supabase-down test
- Blank/invalid URL + 4s-timeout host → confirm the app still gets the policy from Firebase, still blocks outdated non-admin, ADMIN still exempt.
- Also test: Supabase returns valid policy → confirm it is used and cached.

### 6.6 Rollback
- Kill switch / revert the wrapper so `fetchVersionPolicy` = Firebase only. Table can stay.

---

# PHASE 7 — RLS ENFORCEMENT (OPTION B, DEVICE-GATED)

**Goal:** Every POS business table requires a valid `X-Device-Id` resolving to an ACTIVE device. **Highest-risk phase — do last.**

### 7.1 Supabase SQL (from `RLS_IMPLEMENTATION_PLAN.md §5`)
- `CREATE FUNCTION public.is_device_active(p_device_id TEXT)` (`SECURITY DEFINER`, `STABLE`) — copy verbatim (§5.1).
- Apply the PL/pgSQL generator across the **27 POS tables** (§5.3) — copy verbatim.
- `app_version_policy`: public SELECT + admin-gated UPDATE (§5.2).
- **`devices` + `device_app_usage`: intentionally left un-gated per owner decision — do NOT add extra protection, do NOT flag again.**
- **Create** `supabase_rls.sql`.

### 7.2 Client-side header injection
- `setSupabaseDeviceId()` already added in Phase 2; ensure it is called after `registerDeviceIfNeeded()` (App.js ~L442) — hook point from `RLS_IMPLEMENTATION_PLAN.md §3.2`.
- Additionally ensure `getSupabaseClient()` lazily re-applies the ID from SQLite `app_config.persistent_device_id` on warm start (per §2.3).

### 7.3 Ordering / lockout safety
- Device approval happens **before** POS restore; verify the restore/dual-write path is not attempted while device is `PENDING` (else RLS rejects). Ensure `X-Device-Id` header is present on every PostgREST call (including restore + dual-write).
- **Stage rollout:** enable RLS per-table starting with low-traffic tables, monitor, then roll across all 27.

### 7.4 ⚠️ Known risk — Realtime vs RLS (see R6)
- `X-Device-Id` is a **PostgREST header**, not a Realtime auth credential. Supabase Realtime (`postgres_changes`) authorizes via the anon JWT, not custom headers. Under strict RLS, the Phase-3 `restaurant_tables` realtime subscription (and any POS realtime) may be **blocked**.
- **Mitigations to decide before Phase 7:** (a) keep Phase-3 realtime limited to `restaurant_tables` only if Realtime RLS is configured to allow active devices (requires custom JWT claims or a Realtime authorization setup), or (b) fall back to polling `restaurant_tables` at 8s under RLS. Device-control Realtime (devices/presence) is unaffected (un-gated).

### 7.5 Firebase-untouched verification
- All RLS is server-side; Firebase has no equivalent. Confirm no Firebase policy/schema change.
- Run `npm run test:all`.

### 7.6 Supabase-down test
- RLS-blocked (non-active device) → Supabase returns empty/403 → app falls back to Firebase, works normally.
- Active device → normal.
- `PENDING` device → can select `app_version_policy` + own `devices` row + write `device_app_usage`, but cannot read/write POS tables (fail-closed).

### 7.7 Rollback
- Drop the 27 policies + `is_device_active` (revert to permissive `USING(true)`). Header injection is harmless if left in.

---

## NEW ENVIRONMENT VARIABLES / CONFIG

| Variable | Status | Purpose |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | **Already exists** (`supabaseClient.js`, `eas.json`) | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | **Already exists** | Supabase anon key |
| `EXPO_PUBLIC_SUPABASE_SYNC_ENABLED` | **NEW (recommended)** | Kill switch for dual-write + Supabase pull. Default `true`. Set `false` to revert to Firebase-only instantly. |
| `EXPO_PUBLIC_SUPABASE_TIMEOUT_MS` | **NEW (optional)** | Per-op timeout (default 4000). |
| `EXPO_PUBLIC_SUPABASE_VERSION_TIMEOUT_MS` | **NEW (optional)** | Version-policy read timeout (default 3500). |

All must be added to `eas.json` (admin/owner/manager/production env blocks) and `example.env`/`.env`.

---

## NEW SQLITE TABLES / COLUMNS

| Object | Type | Purpose |
|---|---|---|
| `sync_queue_supabase` | NEW table | Independent Supabase outbound queue (mirrors `sync_queue`). |
| `daily_submit_priority.submitted_at` | NEW column (if absent) | Tie-breaker for same-role multi-device submit (Phase 4). |
| `app_config` keys `last_sync_time_supabase_{table}` | NEW rows | Supabase pull cursors. |
| `app_config` key `persistent_device_id` | Already exists | Reused for `X-Device-Id`. |
| `is_synced_supabase` on data tables | **NOT NEEDED** (decision) | Queue is source of truth; add later only for diagnostics. |

Migrations added to `database.js` `initDatabase()`: `migrateSupabaseSyncQueue()`, `migrateDailySubmitPriorityTiebreaker()`.

---

## CROSS-PHASE TESTING CHECKLIST

### Simulating “Supabase is down” (use in every phase from 2 onward)
1. **Dormant mode:** set `EXPO_PUBLIC_SUPABASE_URL=''` → `isSupabaseConfigured()` false.
2. **Black-hole host:** point URL to a non-resolving host → exercises timeouts.
3. **Hard-offline:** airplane mode → both clouds unreachable; confirm Firebase-only mode = today’s behavior.
4. **Kill switch:** `EXPO_PUBLIC_SUPABASE_SYNC_ENABLED=false`.
5. **Unit mock:** in `tests/`, mock the Supabase client to throw/timeout and assert Firebase paths complete.

### “Firebase is untouched” verification (every phase)
1. `git diff` review — Firebase files (`firebaseAuth.js`, Firebase block of `processSyncQueue`, `syncCollections`, `fetchChangedRecordsFromFirestore`, timer intervals in App.js) unchanged except explicitly-scoped additive lines.
2. `npm run test:all` must stay green (baseline first).
3. Firestore field parity: after Phase 2/3, confirm pushed Firestore documents contain the same fields as before.
4. Firestore read/write counters (`getFirebaseUsageStats`) within expected range.

### Per-phase gate
- **Phase 1:** tables exist; existing test suite green.
- **Phase 2:** dual-write works with Supabase up; Firebase unaffected with Supabase down; kill switch works.
- **Phase 3:** Supabase pull works; instant fallback to Firebase on Supabase failure; `daily_submit`/`daily_summary` still Firebase-sourced; fresh-install restore works with Supabase empty (falls back).
- **Phase 4:** `activity_logs` between 00:00–05:59 BST gets today's date; two same-role submits resolve deterministically.
- **Phase 5:** >31-day rows deleted in Supabase; ≤31-day retained; permanent tables untouched; local SQLite + Firebase unchanged.
- **Phase 6:** Supabase-first read, Firebase fallback, cache, default — all four layers proven; ADMIN exempt; blocking screen intact.
- **Phase 7:** PENDING device fail-closed on POS tables; ACTIVE device normal; RLS failure → Firebase fallback; Realtime behavior confirmed.

---

## OPEN TECHNICAL QUESTIONS & RISKS (not covered by the decisions)

**R1 — Bootstrap gap for fresh-install Supabase restore (HIGH).** Existing deployments have **no** Supabase POS history until dual-write accumulates. A fresh install that restores “from Supabase” during rollout would restore an **empty** 31-day window → apparent data loss. *Mitigation:* hybrid restore (Supabase first, then Firebase fallback to fill the window), or a one-time backfill script from Firebase→Supabase before enabling Supabase restore. Decide which.

**R2 — `daily_submit`/`daily_summary` are NOT `alwaysFull` today.** They sit in `APP_PROFILES.recentOnly`, so fresh installs only restore **31 days**, yet `AdminAnalyticsScreen` claims all-time comparison. (Note: `ARCHITECTURE_QUERY_PATTERNS.md` incorrectly calls them `alwaysFull` — flag as a doc error.) *Question:* on fresh install, should these two be restored **fully** from Firebase (paginated full fetch) so analytics works immediately? Today they are not. This is a pre-existing limitation the migration makes visible.

**R3 — Dual-pull merge precedence / thrash.** Both Firebase and Supabase now pull into the same SQLite. Need an explicit, tested precedence rule (Supabase wins only within its covered window; Firebase authoritative for `daily_submit`/`daily_summary` and as fallback) to avoid two clouds overwriting each other each cycle. Confirm the merge rule in §3.2 is acceptable.

**R4 — Delete-tombstone dual-write.** Firebase stores tombstones inside the `app_config` **collection**; Supabase would use a real `deletions` table. Both must be written on every delete, and the pull engines must reconcile them into the local `deletions` table. Design detail not yet specified — needs a small spec before Phase 3.

**R5 — `activity_logs` cutoff field.** User asked to fix `business_date`; `DATE_FIELD_ANALYSIS.md` recommends the cutoff use `created_at`. Plan does both — confirm that's acceptable (it is the safest).

**R6 — Realtime + RLS interaction (HIGH for Phase 7).** Custom `X-Device-Id` headers don't authenticate Realtime/`postgres_changes`; strict RLS may block POS Realtime. Device-control Realtime is unaffected (un-gated). Needs a decision before Phase 7 (see §7.4). *Mitigation option:* keep only `restaurant_tables` realtime and fall back to 8s polling if RLS blocks it.

**R7 — `pg_cron` availability.** Requires the `pg_cron` extension enabled on the Supabase project (plan-dependent). Confirm it's available before Phase 5, else use `pg_net`/scheduled Edge Function.

**R8 — Timestamp type mismatch in merge.** Firestore stores `updated_at` as **string**; Supabase `timestamptz`. Ensure the SQLite merge compares consistently (normalize to ISO strings before comparing).

**R9 — `app_config` collection excluded from Supabase.** Firebase dual-uses `app_config` for tombstones + version + (locally) auth. Confirm POS `app_config` sync is intentionally **not** dual-written (only `deletions` tombstones need a Supabase home). If any non-tombstone `app_config` rows must sync, re-scope.

**R10 — Dual-write idempotency for deletes.** If a row is deleted locally before the Supabase push runs, the push must delete (not upsert) — reuse the “missing local row → delete queue item” logic from `processSyncQueue` L1720–L1726.

**R11 — Realtime concurrent connections & free-tier limits.** Many POS devices each holding Realtime channels (presence + `device_cmd` + new `restaurant_tables` + admin monitor) may hit connection/plan limits. Verify capacity.

**R12 — Restore ordering vs device approval (Phase 7).** POS restore must run only after the device is `ACTIVE`, or RLS blocks the restore. Confirm the ordering in App.js init/`handleLoginSuccess`.

**R13 — `checkAppVersionPolicy` runs pre-approval.** Version check (and now its Supabase read) executes before device approval; `app_version_policy` is public-read so it works — but the device has no `X-Device-Id` yet at cold start. Ensure the version read is un-gated (it is, per §7.1). Same for the very first `setSupabaseDeviceId()` call timing.

**R14 — Deviation from suggested phase order.** This plan places correctness fixes (Phase 4) **before** retention (Phase 5) because the cutoff depends on the `activity_logs` fix. Intentional; confirm.

---

## SUGGESTED COMMIT SEQUENCE

1. `feat(supabase): add POS schema + app_version_policy tables` (Phase 1)
2. `feat(supabase): dual-write queue + setSupabaseDeviceId + push daemon` (Phase 2)
3. `feat(supabase): supabase-primary pull sync + realtime tables + hybrid restore` (Phase 3)
4. `fix(activity): Dhaka-aware business_date` + `feat(daily-submit): same-role tie-breaker` (Phase 4)
5. `chore(supabase): 31-day rolling retention pg_cron` (Phase 5)
6. `feat(version): supabase-first version policy with firebase fallback` (Phase 6)
7. `feat(supabase): device-gated RLS option B` (Phase 7)
