/**
 * Shared local tombstone helpers  (R3/R4 "resurrect" fix)
 * ---------------------------------------------------------------------------
 * Pure, dependency-free wrappers over the SQLite `deletions` table. Used by
 * BOTH sync engines — the Firebase `syncCollections` merge loop (database.js)
 * and the Supabase `mergeSupabaseRows` merge (services/supabaseSync.js) — so:
 *
 *   - a pull can NEVER resurrect a locally-deleted record while the cloud still
 *     holds the old row (isTombstoned → skip the insert), and
 *   - a genuine local add/update clears any stale tombstone so a legitimate
 *     re-create is not permanently blocked (clearTombstone).
 *
 * A "tombstone" is a row in `deletions` keyed by (table_name, record_id).
 * Both helpers never throw (a missing `deletions` table just yields false/no-op).
 */

export function isTombstoned(db, tableName, recordId) {
  if (!db || !tableName || recordId === null || recordId === undefined) return false;
  try {
    const row = db.getFirstSync(
      'SELECT 1 AS t FROM deletions WHERE table_name = ? AND record_id = ?',
      [String(tableName), String(recordId)]
    );
    return !!row;
  } catch (_) {
    return false;
  }
}

export function clearTombstone(db, tableName, recordId) {
  if (!db || !tableName || recordId === null || recordId === undefined) return;
  try {
    db.runSync(
      'DELETE FROM deletions WHERE table_name = ? AND record_id = ?',
      [String(tableName), String(recordId)]
    );
  } catch (_) {}
}
