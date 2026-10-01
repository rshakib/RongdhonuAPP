/**
 * services/calendarGrid.js — the PURE calendar math behind components/CalendarPicker.js.
 *
 * No react-native, no Date formatting libraries, no external dependency: the month grid is
 * plain array math, so it can be unit-tested in Node and cannot break a build.
 *
 * Weeks start on SUNDAY (রবিবার), which is what a Bangladeshi calendar shows, and JS
 * `Date.getDay()` is already 0 = Sunday, so the leading-blank count is just that number.
 */

export const WEEKDAYS_BN = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহ', 'শুক্র', 'শনি'];
export const MONTHS_BN = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
];

const pad2 = (n) => String(n).padStart(2, '0');

/** {y,m,d} (m is 0-based) → 'YYYY-MM-DD'. */
export function toDayString(y, m, d) {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

/** 'YYYY-MM-DD' → {y, m, d} (m is 0-based), or null when it is not a real date. */
export function parseDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return null;
  const [y, m, d] = String(day).split('-').map(Number);
  const probe = new Date(y, m - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) return null;
  return { y, m: m - 1, d };
}

/** 'YYYY-MM-DD' → "30 সেপ্টেম্বর 2026" (null when invalid). */
export function formatDayBn(day) {
  const p = parseDay(day);
  if (!p) return null;
  return `${p.d} ${MONTHS_BN[p.m]} ${p.y}`;
}

/** Month header, e.g. "সেপ্টেম্বর 2026". */
export function monthTitleBn(year, month0) {
  const m = Math.max(0, Math.min(11, Number(month0) || 0));
  return `${MONTHS_BN[m]} ${Number(year)}`;
}

/** Step a month (m is 0-based) across year boundaries. */
export function shiftMonth(year, month0, delta) {
  const total = Number(year) * 12 + (Number(month0) || 0) + Number(delta || 0);
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/**
 * Build a 6×7 grid (42 cells) for a month.
 * @param {number} year
 * @param {number} month0 0-based month
 * @param {string|null} selected 'YYYY-MM-DD'
 * @param {string|null} today    'YYYY-MM-DD' (injected so tests are deterministic)
 * @returns {{title: string, year: number, month: number, weekdays: string[], cells: object[]}}
 */
export function buildMonthGrid(year, month0, selected = null, today = null) {
  const y = Number(year);
  const m = Math.max(0, Math.min(11, Number(month0) || 0));
  const firstWeekday = new Date(y, m, 1).getDay();            // 0 = Sunday
  const daysInMonth = new Date(y, m + 1, 0).getDate();        // day 0 of next month = last day

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ day: null, dayNum: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const day = toDayString(y, m, d);
    cells.push({
      day,
      dayNum: d,
      isSelected: !!selected && day === selected,
      isToday: !!today && day === today,
      isWeekend: new Date(y, m, d).getDay() === 5 || new Date(y, m, d).getDay() === 6   // শুক্র/শনি
    });
  }
  while (cells.length < 42) cells.push({ day: null, dayNum: null });

  return {
    title: monthTitleBn(y, m),
    year: y,
    month: m,
    weekdays: WEEKDAYS_BN,
    cells
  };
}
