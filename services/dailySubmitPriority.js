/**
 * Shared daily_submit priority resolution (Phase 4)
 * ---------------------------------------------------------------------------
 * Pure, dependency-free helpers used by BOTH push paths so that a
 * same-business-date `daily_submit` conflict resolves IDENTICALLY on Firebase
 * (`processSyncQueue`) and Supabase (`processSupabaseSyncQueue`).
 *
 * Resolution order (deterministic):
 *   1. Higher role `priority` wins (owner=100 > admin=50 > manager=10 > other=0).
 *   2. Equal priority -> the LATER `submitted_at` wins.
 *   3. Equal `submitted_at` -> the lexicographically GREATER `device_id` wins.
 *
 * Missing `submitted_at` falls back to `updated_at` / `created_at`; missing
 * device id falls back to the legacy `sync_source_device` field.
 */

export const ROLE_PRIORITY = { owner: 100, admin: 50, manager: 10 };

export function getRolePriority(role) {
  const r = String(role || '').trim().toLowerCase();
  return ROLE_PRIORITY[r] || 0;
}

function tsToMs(value) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function deviceIdOf(record) {
  if (!record) return '';
  const v = record.device_id != null ? record.device_id : record.sync_source_device;
  return v == null ? '' : String(v);
}

/**
 * Compare two daily_submit_priority records.
 * @returns {number} 1 if `a` outranks `b`, -1 if `b` outranks `a`, 0 if identical.
 */
export function compareDailySubmitPriority(a = {}, b = {}) {
  const pa = Number(a.priority || 0);
  const pb = Number(b.priority || 0);
  if (pa !== pb) return pa > pb ? 1 : -1;

  const ta = tsToMs(a.submitted_at || a.updated_at || a.created_at);
  const tb = tsToMs(b.submitted_at || b.updated_at || b.created_at);
  if (ta !== tb) return ta > tb ? 1 : -1;

  const da = deviceIdOf(a);
  const db = deviceIdOf(b);
  if (da !== db) return da > db ? 1 : -1;

  return 0;
}

/**
 * True when the remote record should win over the local one for the same
 * business date (i.e. the local push should be skipped).
 */
export function remotePriorityWins(local, remote) {
  return compareDailySubmitPriority(remote, local) > 0;
}
