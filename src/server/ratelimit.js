// Lightweight in-memory rate limiting for expensive/unsafe-to-spam routes.
// Single-instance demo protection, not a distributed limiter.
export class RateLimiter {
  constructor() { this.buckets = new Map(); }
  hit(key, limit = 30, windowMs = 60000, now = Date.now()) {
    const b = this.buckets.get(key);
    if (!b || now - b.start >= windowMs) { this.buckets.set(key, { start: now, count: 1 }); return { allowed: true, retryAfterSec: 0 }; }
    b.count += 1;
    if (b.count > limit) return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((b.start + windowMs - now) / 1000)) };
    return { allowed: true, retryAfterSec: 0 };
  }
  prune(now = Date.now(), windowMs = 3600000) { for (const [k, b] of this.buckets) if (now - b.start > windowMs) this.buckets.delete(k); }
}
