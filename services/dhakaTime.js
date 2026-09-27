/**
 * Asia/Dhaka date helpers (Phase 4)
 * ---------------------------------------------------------------------------
 * Pure, dependency-free. Bangladesh Standard Time is a fixed UTC+6 (no DST),
 * so shifting the UTC instant is an Intl-free way to read Dhaka wall-clock time.
 */

const DHAKA_UTC_OFFSET_MS = 6 * 60 * 60 * 1000;

/**
 * Returns the Asia/Dhaka (UTC+6) CALENDAR date (YYYY-MM-DD) for an instant.
 * Rolls over at 12:00 AM Bangladesh time, i.e. it agrees with getBusinessDate()
 * on a normally-configured BST device, but is immune to a mis-set device clock.
 *
 * NOTE: This is intentionally different from getDhakaBusinessDate() in
 * services/appUsageTracker.js, which uses a 06:00 AM boundary for telemetry.
 *
 * @param {number|string|Date} timestamp
 * @returns {string} YYYY-MM-DD
 */
export function getDhakaCalendarDate(timestamp = Date.now()) {
  const ms = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
  const shifted = new Date((Number.isFinite(ms) ? ms : Date.now()) + DHAKA_UTC_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
