/**
 * Token-bucket rate limiter.
 * Tracks attempts per key with a sliding window.
 */
const buckets = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const attempts = buckets.get(key) ?? [];

  // Purge expired
  const valid = attempts.filter(t => now - t < windowMs);

  if (valid.length >= maxAttempts) {
    const oldestInWindow = valid[0];
    const retryAfter = Math.ceil((oldestInWindow + windowMs - now) / 1000);
    buckets.set(key, valid);
    return { allowed: false, retryAfter };
  }

  valid.push(now);
  buckets.set(key, valid);
  return { allowed: true };
}

/** Export buckets for admin inspection */
export function getRateLimitBuckets(): Map<string, number[]> {
  return buckets;
}

// Clean up stale entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, attempts] of buckets) {
    const valid = attempts.filter(t => now - t < 120_000);
    if (valid.length === 0) buckets.delete(key);
    else buckets.set(key, valid);
  }
}, 60_000);
