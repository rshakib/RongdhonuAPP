# RONGDHONU POS — SUPABASE DUAL-DB MIGRATION · PROGRESS / SESSION MEMORY

> **Purpose:** Persistent session-memory file. Update after every meaningful step so a session reset never loses context.
> **Full plan:** [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) · supporting research: [`ARCHITECTURE_CURRENT_STATE.md`](ARCHITECTURE_CURRENT_STATE.md), [`ARCHITECTURE_QUERY_PATTERNS.md`](ARCHITECTURE_QUERY_PATTERNS.md), [`DATE_FIELD_ANALYSIS.md`](DATE_FIELD_ANALYSIS.md), [`VERSION_CONTROL_MIGRATION_NOTES.md`](VERSION_CONTROL_MIGRATION_NOTES.md), [`RLS_IMPLEMENTATION_PLAN.md`](RLS_IMPLEMENTATION_PLAN.md).
> **Last updated:** 2026-09-27 (Phase 5 SQL ready — pending manual run) · Branch: `feature/admin-dashboard-redesign`

---

## 0. ▶ RESUME HERE — NEXT ACTION (read this first after any session reset)

**We are BLOCKED on a manual step, then Phase 6.** The agent must NOT start Phase 6 until the owner confirms the step below.

1. **Owner runs `supabase_cron.sql`** in the Supabase SQL Editor (schedules the Phase 5 retention job). Server-side only — no app code involved.
2. **Owner verifies:**
   ```sql
   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'rongdhonu_retention_31d';
   ```
   Expect **exactly one** row: `schedule = '30 21 * * *'`, `active = true`.
3. **Owner tells the agent it's confirmed → agent starts PHASE 6** (Version control migration, `IMPLEMENTATION_PLAN.md` §6).

> Reminder recorded 2026-09-27 at the owner's request (owner was shutting the session down and resuming later). Phase 5 status: 🟡 **SQL ready — pending manual run**. Phase 6: **NOT started**.

---

## 1. Overall Status (per IMPLEMENTATION_PLAN.md's 7 phases)

| Phase | Name | Status |
|---|---|---|
| 1 | Supabase schema & tables | ✅ Done |
| 2 | Local scaffolding + dual-write queue | ✅ Done |
| 3 | Read routing (Supabase-primary pull + Firebase fallback) | ✅ Done |
| 4 | Correctness & conflict fixes (pre-retention) | ✅ Done |
| 5 | Rolling 31-day retention (pg_cron) | 🟡 SQL ready — pending manual run |
| 6 | Version control migration | ⏳ Not Started |
| 7 | RLS enforcement (Option B, device-gated) | ⏳ Not Started |

---

## 2. Key Confirmed Decisions Log

**Architecture / scope (Phase 1 baseline)**
- **Read routing = sync-layer.** Supabase becomes the primary PULL source feeding local SQLite; screens keep reading SQLite unchanged; Firebase pull timers (15s/30s/90s/180s) stay running as fallback. **Zero screen changes.**
- **`daily_submit` / `daily_summary` = Firebase-only** for pull AND fresh-install restore. Dual-WRITTEN to Supabase but never read back (guarantees AdminAnalyticsScreen keeps full lifetime history).
- **Non-negotiable:** Firebase code path 100% untouched (same collections, `sync_queue`, `processSyncQueue`, intervals, `firebaseAuth`, `restoreDatabaseFromCloud` internals). Supabase is pure-additive; every Supabase error/timeout is swallowed.
- **RLS = Option B** (`is_device_active()` SECURITY DEFINER function + `X-Device-Id` header). **`devices` and `device_app_usage` are intentionally EXCLUDED** from gating (permissive RLS — owner decision, do not re-flag). This is Phase 7.
- **`users.pin` syncs as-is plaintext** (mirrors Firestore 1:1; login verification stays entirely local SQLite PIN check).
- **`restaurant_tables` uses 1–2s POLLING, not Realtime**, in the migration phases (no POS table added to the `supabase_realtime` publication).
- **`is_synced` is omitted from Supabase** (SQLite-local only). **No `is_synced_supabase` column** — the queue is the source of truth for unsynced Supabase writes.
- **Correctness fixes (Phase 4) precede retention (Phase 5)** because the `activity_logs` retention cutoff depends on the Dhaka-aware business-date fix.
- **Deferred / OUT OF SCOPE (documented, do NOT touch):** `expenses` stable-ID overwrite race; `supplier_payment_ledger` INSERT OR REPLACE overwrite; `supplier_due` read-modify-write running-balance race.
- **`supabase_schema.sql` deleted**; all references repointed to `supabase_full_setup.sql` (consolidated, idempotent).
- **`pg_cron` available + enabled** (v1.6.4); no retention job scheduled yet (Phase 5).

**Phase 2 (dual-write)**
- **Dual-write = PARALLEL / independent queues.** New SQLite table `sync_queue_supabase` mirrors `sync_queue`. One `enqueueSync()` choke-point delegates to `enqueueSupabaseSync()` **after** the Firebase INSERT, via **lazy `require` + nested try/catch** (isolation; no import cycle; Supabase failure can never affect Firebase).
- **PK special-casing:** `id` (default) · `date` (`daily_submit`, `daily_summary`) · `business_date` (`daily_submit_priority`).
- **`app_config` is fully EXCLUDED** from the Supabase mirror (Firebase-only: version policy + tombstones). `_fb_auth_*` records also excluded.
- **Independent Supabase daemon:** 5s `setInterval`, own concurrency lock, skips when backgrounded; exponential backoff `min(10min, 2^retry × 30s)` for FAILED items.
- **Timeout:** default **4000 ms** per Supabase op (`withTimeout` + `safeSupabaseCallWithTimeout`); overridable via `EXPO_PUBLIC_SUPABASE_TIMEOUT_MS`.
- **Kill switch:** `EXPO_PUBLIC_SUPABASE_SYNC_ENABLED` (default `true`; `false`/`0`/`off`/`no` disables dual-write + Supabase pull). Added to `eas.json` (all 4 profiles) + `example.env`.
- **`supabaseSyncQueue.js` test seam:** `__setSupabaseSyncDepsForTesting()` / `__resetSupabaseSyncDepsForTesting()` allow injectable `isConfigured` / `isEnabled` / `getClient` / `getDb` for unit tests (production defaults unchanged).
- **`setSupabaseDeviceId()`** wired in `App.js` right after `registerDeviceIfNeeded()`; sets `X-Device-Id` via global header + runtime `rest.headers` mutation (Realtime channels preserved). Prep for Phase 7.

**Phase 3 (read routing)**
- **Supabase-primary PULL** via `services/supabaseSync.js`; Firebase pull timers stay untouched as fallback. On ANY Supabase failure/timeout the matching Firebase fn runs **in the same tick**.
- **Timers (App.js):** Supabase `restaurant_tables` **2s polling (NOT Realtime)**, high-freq **8s**, deletions **20s**, low-freq **60s** — ADDED alongside the existing Firebase 15s/30s/90s/180s.
- **`daily_submit` / `daily_summary` never pulled from Supabase** (`LOW_FREQ_EXCLUDED`); `app_config` also excluded.
- **Supabase cursor** = `last_sync_time_supabase_{table}` in `app_config`; cursor column = `updated_at` else `created_at`; 60s read overlap, 15s marker safety (mirrors Firebase).
- **Merge = Firebase rules:** newer `updated_at` wins, local `is_synced=0` preserved, Schema Guardian (`PRAGMA table_info`), `restaurant_tables` limited to table_1..8, `deletions` tombstones applied, menu dedupe.
- **Kill switch semantics:** `EXPO_PUBLIC_SUPABASE_SYNC_ENABLED=false` → Supabase pulls are a **no-op** (no Firebase fallback — Firebase timers already handle it); unconfigured (blank URL) → **Firebase fallback** (not a no-op).
- **Restore (transition decision):** coverage < 31 days → running-day-only **Firebase** restore; ≥ 31 days → Admin/Owner 31d from Supabase, Manager today from Supabase, menu + daily_submit/daily_summary always Firebase, restaurant_tables from Supabase; empty/fail → running-day Firebase fallback. Coverage = age of oldest Supabase `orders.created_at`.
- `database.js` gained additive `syncDailyAndMenuFromFirebase()` (menu + daily summary/submit) for the Supabase restore path.

**Phase 4 (correctness & conflict fixes)**
- **`activity_logs` business_date = Asia/Dhaka CALENDAR date (12:00 AM rollover), NOT the plan-literal `getDhakaBusinessDate()`.** Discovered the plan's §4.1 instruction was self-contradictory: `getDhakaBusinessDate()` returns the **UTC calendar date**, which is *identical to the old buggy value* during 00:00–05:59 BST, so reusing it would have been a no-op and would fail the §4 gate. Confirmed with the owner; implemented the intent instead (`getDhakaCalendarDate`, fixed UTC+6, 12 AM rollover) — matches `ActivityLogScreen`'s `getBusinessDate()` query filter. Telemetry's `getDhakaBusinessDate()` (06:00 cutoff) is untouched.
- **New pure module `services/dhakaTime.js`** (`getDhakaCalendarDate`) — Intl-free, unit-testable in Node; re-exported from `database.js`; used by `services/activityLogger.js`.
- **New pure module `services/dailySubmitPriority.js`** — single source of truth for `getRolePriority` (moved out of `database.js`, re-exported for compat) + `compareDailySubmitPriority` / `remotePriorityWins`. Resolution order: higher `priority` → later `submitted_at` → lexicographically greater `device_id`.
- **`daily_submit_priority`** gained `submitted_at` + `device_id` columns (SQLite `migrateDailySubmitPriorityTiebreaker()` + idempotent Supabase `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). `saveDailySubmitPriority()` populates both (`device_id` = `app_config.persistent_device_id`).
- **Same tie-breaker applied on BOTH push paths** using the shared comparator: Firebase `processSyncQueue` remote-priority check, and the new check in `processSupabaseSyncQueue` (reads the cloud `daily_submit_priority` row, fail-open on error — mirrors Firebase). Both backends now resolve equal-priority conflicts identically.
- **OUT OF SCOPE / deferred (unchanged, do NOT touch):** `expenses` stable-ID overwrite race; `supplier_payment_ledger` insert-or-replace overwrite; `supplier_due` read-modify-write running-balance race.
- **Historical `activity_logs` rows are NOT backfilled** (per instruction) — the fix affects only NEW logs going forward.

**Phase 5 (rolling 31-day retention)**
- **`supabase_cron.sql` (new, server-side only — no app code).** One `pg_cron` job `rongdhonu_retention_31d` at `30 21 * * *` (21:30 UTC = 03:30 Asia/Dhaka) deletes rows older than a `(now() AT TIME ZONE 'Asia/Dhaka')::date - 31 days` cutoff from the **13 rolling tables only**.
- **TEXT→timestamptz cast correction.** Supabase timestamp columns are `TEXT` (ISO-8601), so the plan's literal `col AT TIME ZONE 'Asia/Dhaka'` would ERROR; each is cast `(col::timestamptz AT TIME ZONE 'Asia/Dhaka')::date`. Pure date columns use `::date`. `deliveries` uses `COALESCE(NULLIF(completed_at,'')::timestamptz, NULLIF(created_at,'')::timestamptz)`.
- **`activity_logs` deletes by `created_at`, not `business_date`** — historical `business_date` predates the Phase 4 fix and was not backfilled (§R5: do both).
- **Excluded (17 permanent/non-windowed, confirmed complete):** menu_items, menu_categories, restaurant_tables, devices, device_app_usage, app_version_policy, daily_submit, daily_summary, daily_submit_priority, users, supplier_due, deletions, delete_history, owner_employees, owner_salary_ledger, owner_deposits, owner_home_deposits. **13 + 17 = 30 = full table set.**
- **Idempotent:** guarded `cron.unschedule('rongdhonu_retention_31d')` (only if it exists) then `cron.schedule(...)`. File also embeds verification queries + an optional dry-run preview.

---

## 3. Current Phase Detail — Phase 4 ✅ Done → Phase 5 (SQL ready, pending manual run)

### Phase 2 — Local scaffolding + dual-write queue ✅
Delivered (all per IMPLEMENTATION_PLAN.md §2):
1. **`database.js`** — new `migrateSupabaseSyncQueue()` (CREATE TABLE IF NOT EXISTS `sync_queue_supabase`), called from `initDatabase()` right after `migrateSyncQueueDiagnostics()`. *(purely additive; 3 hunks)*
2. **`database.js` `enqueueSync()`** — Firebase enqueue unchanged; new isolated delegation block added **after** the Firebase INSERT. *(additive only)*
3. **`services/supabaseSyncQueue.js`** (new) — `enqueueSupabaseSync`, `processSupabaseSyncQueue`, `startSupabaseSyncService`/`stopSupabaseSyncService`, `syncSupabaseRecordImmediately`, plus pure helpers `getSupabaseConflictKey` / `getSupabaseFailedRetryDelayMs`.
4. **`services/supabaseClient.js`** — added `setSupabaseDeviceId()`, `withTimeout()`, `safeSupabaseCallWithTimeout()`, `isSupabaseSyncEnabled()`, `SUPABASE_TIMEOUT_MS`; preserved `persistSession: false` + existing exports.
5. **`App.js`** — `setSupabaseDeviceId()` after `registerDeviceIfNeeded()`; `startSupabaseSyncService()` after `startSyncService()`. *(additive only)*
6. **Config** — `eas.json` (+`EXPO_PUBLIC_SUPABASE_SYNC_ENABLED` in all 4 profiles), `example.env` (+kill switch +timeout), `package.json` (+`test:supabase-dualwrite`, added to `test:all`).

**Verification**
- `npm run test:all` → **exit 0, 0 failures** (added `tests/supabaseDualWrite.test.js`, **17 tests**; `supabaseDeviceControl` 81/81).
- **Firebase-untouched:** `git diff` shows only additive lines in `enqueueSync`; `App.js` additive only (2 blocks); `supabaseClient.js` rewritten additively (existing behavior preserved).
- **Supabase-down Scenario A (blank URL):** real module probe → `{configured:false, enqueued:false, processed:{0,0}, safeSupabaseCall→fallback}`; DB never touched.
- **Supabase-down Scenario B (black-hole `http://127.0.0.1:9`):** real `supabase-js` client through `processSupabaseSyncQueue` → upsert fails (`fetch failed`), queue row `FAILED`, `retry_count=1`, backoff timestamp set, returns `{successfulWrites:0, failedWrites:1}`, **no throw**. Backoff proven to skip the not-yet-due failure on the next cycle.

### Phase 3 — Read routing (Supabase-primary pull + Firebase fallback) ✅
Delivered:
1. **`services/supabaseSync.js`** (new) — `syncSupabaseTables()` (restaurant_tables, 2s polling), `syncSupabaseHighFrequencyCollections()` (orders/order_items/payments/deliveries), `syncSupabaseDeletions()`, `syncSupabaseLowFrequencyCollections()`; `restoreHybridDatabaseFromCloud()` + `restoreSupabaseWindow()` + `getSupabaseCoverageDays()`. Each sync fn has its own concurrency guard + Firebase fallback.
2. **`database.js`** — additive `syncDailyAndMenuFromFirebase()`.
3. **`App.js`** — additive Supabase timer block (2s/8s/20s/60s) alongside untouched Firebase timers; `ensureInitialData` routes through `restoreHybridDatabaseFromCloud({ mode: 'today' })` (the ONE non-additive line).

**Verification**
- `npm run test:all` → **exit 0, 0 failures** (`tests/supabaseSync.test.js`, **19 tests**; Phase 2 suite 17; device control 81).
- **Firebase-untouched:** `database.js` diff = 0 deletions (pure additive); `App.js` = exactly 1 replaced line (restore call-site) + additive timer block.
- **§3.6 Supabase-down:** kill switch OFF → no-op, no fallback; blank URL → Firebase fallback per group in same tick; error/timeout client → Firebase fallback, no throw; healthy → merges Supabase rows, Firebase untouched.

### Phase 4 — Correctness & conflict fixes ✅
Delivered (all per IMPLEMENTATION_PLAN.md §4, with the §4.1 correction noted in §2):
1. **`services/dhakaTime.js`** (new, pure) — `getDhakaCalendarDate()` = Asia/Dhaka calendar date (12 AM rollover). Re-exported from `database.js`.
2. **`services/activityLogger.js`** — default `business_date` now `getDhakaCalendarDate(now)` instead of `now.toISOString().split('T')[0]` (`~L52-56`). New logs only; no backfill.
3. **`services/dailySubmitPriority.js`** (new, pure) — `getRolePriority` (moved from `database.js`; re-exported) + `compareDailySubmitPriority` / `remotePriorityWins`.
4. **`database.js`** — `daily_submit_priority` schema + `migrateDailySubmitPriorityTiebreaker()` (called in `initDatabase` after `migrateSupabaseSyncQueue`); `saveDailySubmitPriority()` writes `submitted_at` + `device_id`; Firebase `processSyncQueue` conflict check extended with the tie-breaker.
5. **`services/supabaseSyncQueue.js`** — new `daily_submit` conflict check mirroring Firebase (`shouldSkipDailySubmit`, reads cloud `daily_submit_priority`, fail-open).
6. **`supabase_full_setup.sql`** — `daily_submit_priority` gains `device_id` + `submitted_at` (CREATE + idempotent `ADD COLUMN IF NOT EXISTS`).
7. **`tests/phase4Correctness.test.js`** (new, 18 tests) wired into `test:all`.

**Verification**
- `npm run test:all` → **exit 0, 0 failures** (Phase 4 suite **18/18**; prior suites unchanged — device control 81, dual-write 17, sync 19).
- **§4 gate — activity_logs 00:00–05:59 BST:** `getDhakaCalendarDate('…T00:30:00+06:00')` → **today** (`2026-09-28`); raw UTC (old code) → yesterday — asserted.
- **§4 gate — same-role tie-breaker:** proven deterministic + identical on the Supabase path (remote-higher → skip; equal+remote-later → skip; equal+local-later → upload; exact-tie by `device_id`); Firebase path shares the same comparator (asserted by source + unit tests).
- **Firebase-untouched:** `App.js`, `firebaseAuth.js`, `supabaseSync.js`, `appUsageTracker.js` untouched this phase; the only Firebase-path change is the in-scope `daily_submit` conflict block (refactor to the shared comparator; higher-remote-priority still skips). `test:activity` 9/9, `test:firebase-auth` 21/21.
- New Firestore fields (`submitted_at`, `device_id`) flow additively via generic `toFirestoreDocument`.

### Phase 5 — Rolling 31-day retention (pg_cron) 🟡 SQL ready — pending manual run
Delivered:
1. **`supabase_cron.sql`** (new) — idempotent pg_cron registration of one job `rongdhonu_retention_31d` (`'30 21 * * *'`, i.e. 21:30 UTC = **03:30 Asia/Dhaka**) whose command is a `DO` block deleting `cutoff = ((now() AT TIME ZONE 'Asia/Dhaka')::date - INTERVAL '31 days')::date`-and-older rows from the **13 rolling tables**.
2. Verification queries (`cron.job` / `cron.job_run_details`) + an optional dry-run count preview are embedded in the file.

**Status:** server-side only — **no app code changed**. Awaiting the owner to run it in the Supabase SQL Editor and confirm the job shows in `cron.job`. **Phase 6 not started** (held until Phase 5 is confirmed).

**Pre-run checks already satisfied:** `pg_cron` v1.6.4 available/enabled (Phase 1); Phase 4 delivered first so the `activity_logs`/Dhaka-date premise holds.

---

## 4. Manual Actions Pending on the Human (app owner)

- ✅ **Supabase project RESOLVED (2026-09-27).** `.env` + `eas.json` (×4) both carry `gdqnfwccohxgaywzoysc` (URL host == anon-key `ref`, verified). **Live check:** project reachable; **all 30 tables present**; `app_version_policy` seeded (`1.0.5`). Only remaining: the parent **shell export** still holds the old `zdruassdewwjbexximkj` — restart the terminal / Command Code to clear it (a tool subshell cannot mutate the parent env).
- _Stale old-ref leftovers (not config, harmless):_ `.expo/dev/logs/*` (regenerated on next `expo start`) and `.commandcode/settings.json` (tooling permission cache).
- ✅ **`example.env` is a template and must keep PLACEHOLDERS only** (owner decision) — do NOT put the real Supabase URL/anon key there. Real values live in `.env` + `eas.json` only.
- ✅ **DONE (2026-09-27) — Phase 4 `daily_submit_priority` column adds on Supabase** (`device_id`, `submitted_at`). Owner ran them in the SQL Editor; Supabase upserts of `daily_submit_priority` now succeed.
- **NOW (Phase 5): run `supabase_cron.sql` in the Supabase SQL Editor** to schedule the 31-day retention job. Then verify with:
  ```sql
  SELECT jobid, jobname, schedule, active, command FROM cron.job WHERE jobname = 'rongdhonu_retention_31d';
  ```
  Expect exactly one row, `schedule = '30 21 * * *'`, `active = true`. Confirm to the agent to proceed to Phase 6. Deleted rows remain in Firebase (full history) and local SQLite (never rolling-deleted).
- **Later (Phase 7):** run `supabase_rls.sql` to create `is_device_active()` and apply device-gated policies.

---

## Changelog
- **2026-09-27 (Phase 5 SQL ready)** — Added `supabase_cron.sql` (server-side only): idempotent `pg_cron` job `rongdhonu_retention_31d` (`30 21 * * *` = 03:30 Asia/Dhaka) deleting >31-day rows from the 13 rolling tables keyed on the DATE_FIELD_ANALYSIS §5 columns. Corrected the plan's `AT TIME ZONE` expressions to `::timestamptz` casts (Supabase timestamp columns are TEXT). `activity_logs` retention uses `created_at` (historical `business_date` un-backfilled). 17 permanent tables explicitly excluded (13+17=30). Includes verification + dry-run queries. **Pending manual execution by owner.** No app code changed. Phase 6 held.
- **2026-09-27 (Phase 4 complete)** — Correctness & conflict fixes. `activity_logs` default `business_date` switched to a new Dhaka **calendar**-date helper (`services/dhakaTime.js` `getDhakaCalendarDate`, fixed UTC+6, 12 AM rollover) — the plan's literal `getDhakaBusinessDate()` reuse was rejected as a no-op (it returns the UTC date); confirmed with owner. Deterministic same-role `daily_submit` tie-breaker (priority → later `submitted_at` → greater `device_id`) centralized in `services/dailySubmitPriority.js` and applied identically on the Firebase (`processSyncQueue`) and Supabase (`processSupabaseSyncQueue`) push paths; `daily_submit_priority` gains `submitted_at` + `device_id` (SQLite migration + Supabase DDL). Skipped expenses / supplier_payment_ledger / supplier_due (documented deferred). `tests/phase4Correctness.test.js` 18 tests; `npm run test:all` green (21 files). No historical backfill.
- **2026-09-27 (Phase 3 complete)** — Supabase-primary pull (`services/supabaseSync.js`): 4 group sync fns + Firebase fallback on any failure, Supabase cursors, Firebase-equivalent merge rules (Schema Guardian, is_synced=0 preservation, tombstones, table_1..8 filter); App.js 2s/8s/20s/60s timers added alongside untouched Firebase timers; hybrid fresh-install restore (transition = running-day Firebase until 31d coverage). `tests/supabaseSync.test.js` 19 tests; `npm run test:all` green. Project ID issue resolved (all 30 tables confirmed live on gdqnfwccohxgaywzoysc).
- **2026-09-27 (config)** — Real `gdqnfwccohxgaywzoysc` URL + anon key live in `.env` + `eas.json` (×4) only; `example.env` intentionally kept as PLACEHOLDERS (owner decision). Shell env still stale (old project) — restart before dev runs.
- **2026-09-27 (Phase 2 complete)** — Built the isolated Supabase dual-write queue: `sync_queue_supabase` + migration, `services/supabaseSyncQueue.js`, `enqueueSync()` delegation, `setSupabaseDeviceId`/`withTimeout` in `supabaseClient.js`, App.js wiring, kill switch. Added `tests/supabaseDualWrite.test.js` (17 tests). `npm run test:all` green. Both Supabase-down scenarios (blank URL, black-hole host) verified with real module probes. Firebase diff = additive only.
- **2026-09-27 (Phase 1 complete)** — Session restored from reset. Phase 1 confirmed (30 tables, pg_cron enabled, `supabase_full_setup.sql` single source). Stale test assertions cleaned (`admin_device_action`, `persistSession`, async harness, `ensureAnonymousAuth`/`auth_user_id`); `npm run test:all` green.
