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

/**
 * Timestamp of the tombstone for (table, id), or null when there is none.
 */
export function getTombstoneTime(db, tableName, recordId) {
  if (!db || !tableName || recordId === null || recordId === undefined) return null;
  try {
    const row = db.getFirstSync(
      'SELECT updated_at, created_at FROM deletions WHERE table_name = ? AND record_id = ?',
      [String(tableName), String(recordId)]
    );
    if (!row) return null;
    return String(row.updated_at || row.created_at || '') || null;
  } catch (_) {
    return null;
  }
}

/**
 * FINAL-RESURRECT-2 fix: a tombstone must not block a LEGITIMATE RE-CREATE.
 *
 * Returns true when the pull-insert should be SKIPPED. It skips only while the
 * tombstone is at least as new as the incoming cloud row. If the cloud row is
 * STRICTLY NEWER than its tombstone, the record was deleted and then re-created
 * (e.g. Daily Submit for a date that was deleted, then submitted again by another
 * device) → the stale tombstone is cleared and the insert is allowed.
 *
 * Missing/unparseable cloud timestamps keep the old (safe) behavior: block.
 */
export function isResurrectBlocked(db, tableName, recordId, cloudTimestamp) {
  if (!isTombstoned(db, tableName, recordId)) return false; // no tombstone → allow
  const tomb = getTombstoneTime(db, tableName, recordId);
  // A tombstone WITHOUT a usable timestamp keeps the old, safe behavior: block.
  if (!tomb) return true;
  const cloud = String(cloudTimestamp || '');
  if (cloud && cloud > tomb) {
    clearTombstone(db, tableName, recordId);
    console.log(`[Sync] Stale tombstone cleared (cloud re-created after delete): ${tableName}/${recordId} tomb=${tomb} cloud=${cloud}`);
    return false;
  }
  return true;
}
