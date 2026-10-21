/** Persisted, deployment-wide room creation bound. Local test runs must not exhaust the hosted allowance. */
export type CreationCounter = { day: number; count: number };
const DAY = 86400000;
const loopback = (value: string) => {
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname); }
  catch { return false; }
};
export function creationQuota(requestUrl: string, webOrigin: string, now: number, counter?: CreationCounter) {
  // Both addresses must be local: a localhost Origin alone cannot relax a hosted deployment's limit.
  const limit = loopback(requestUrl) && loopback(webOrigin) ? 1000 : 100;
  const day = Math.floor(now / DAY);
  const count = counter?.day === day ? counter.count : 0;
  return {
    allowed: count < limit,
    limit,
    next: { day, count: count + 1 },
    retryAt: (day + 1) * DAY,
    retryAfter: Math.max(1, Math.ceil(((day + 1) * DAY - now) / 1000)),
  };
}
