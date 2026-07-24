// Streak and retention. The streak is forgiving by design: one grace
// day per rolling week, so a single missed commute never zeroes it.
// Retention (rolling % of review grades that were "good") is the
// headline number; the streak is secondary.

export const RETENTION_WINDOW = 200;

/** @param {string} a @param {string} b YYYY-MM-DD */
export function dayDiff(a, b) {
  return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
}

/**
 * Update streak state for a session completed on `today` (YYYY-MM-DD).
 * meta fields used: streakCount, streakLastDay, streakGraceDay.
 */
export function updateStreak(meta, today) {
  const m = { ...meta };
  if (!m.streakLastDay) {
    m.streakCount = 1;
    m.streakLastDay = today;
    return m;
  }
  const gap = dayDiff(m.streakLastDay, today);
  if (gap <= 0) return m; // same day, nothing to do
  if (gap === 1) {
    m.streakCount += 1;
  } else if (
    gap === 2 &&
    (!m.streakGraceDay || dayDiff(m.streakGraceDay, today) > 7)
  ) {
    m.streakCount += 1; // grace covers the single missed day
    m.streakGraceDay = today;
  } else {
    m.streakCount = 1;
  }
  m.streakLastDay = today;
  return m;
}

/**
 * Mark a study day done, once per day, from ANY session (the daily vocab
 * session or a Review deck). Updates the streak and counters in place.
 * Returns true if this was the first completed session today. Idempotent:
 * a second session the same day is a no-op, so vocab and review share one
 * honest "did you study today" streak.
 */
export function markSessionDone(meta, today) {
  if (meta.sessionDoneDay === today) return false;
  Object.assign(meta, updateStreak(meta, today));
  meta.sessionDoneDay = today;
  meta.sessionsCompleted = (meta.sessionsCompleted || 0) + 1;
  return true;
}

/** Append a review outcome (true = good) to the rolling window. */
export function recordOutcome(recent, good) {
  const next = [...(recent || []), good ? 1 : 0];
  return next.length > RETENTION_WINDOW ? next.slice(-RETENTION_WINDOW) : next;
}

/** Rolling retention as a 0-100 integer, or null with no data. */
export function retention(recent) {
  if (!recent || recent.length === 0) return null;
  return Math.round((recent.reduce((a, b) => a + b, 0) / recent.length) * 100);
}
