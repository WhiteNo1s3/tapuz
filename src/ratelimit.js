// In-memory abuse mitigation for the admin surface (S4).
//
// ZERO external deps — plain Maps. This defends only the APPLICATION (L7)
// layer: per-IP request flooding of admin routes and login brute-force.
// It CANNOT stop a volumetric (L3/L4) DDoS — that requires a CDN / reverse
// proxy (Cloudflare, nginx) in front of the app. See docs/security.md.
//
// State lives in process memory: it resets on restart and is per-process
// (a multi-process deployment would need a shared store). That is an honest,
// documented limitation, appropriate for the single-process Tapuz server.

/**
 * Fixed-window per-key counter. Good enough for coarse admin flood control.
 */
class FixedWindowLimiter {
  constructor({ windowMs = 60000, max = 300 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map(); // key -> { count, reset }
  }

  /** Returns true if the request is allowed, false if it exceeds the window. */
  allow(key) {
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e || now > e.reset) {
      e = { count: 0, reset: now + this.windowMs };
      this.hits.set(key, e);
    }
    e.count++;
    if (this.hits.size > 10000) this._sweep(now); // bound memory
    return e.count <= this.max;
  }

  retryAfter(key) {
    const e = this.hits.get(key);
    return e ? Math.max(1, Math.ceil((e.reset - Date.now()) / 1000)) : 1;
  }

  _sweep(now) {
    for (const [k, v] of this.hits) if (now > v.reset) this.hits.delete(k);
  }
}

/**
 * Login brute-force guard with ESCALATING lockout.
 * Track by two keys (caller decides): IP and IP|username. A hit on either
 * lock stops the attempt, so a single IP cannot grind one account and a
 * single IP cannot spray many accounts.
 */
class LoginGuard {
  constructor({ freeAttempts = 5, baseLockMs = 30 * 1000, maxLockMs = 60 * 60 * 1000, forgetMs = 15 * 60 * 1000 } = {}) {
    this.freeAttempts = freeAttempts;
    this.baseLockMs = baseLockMs;
    this.maxLockMs = maxLockMs;
    this.forgetMs = forgetMs;
    this.state = new Map(); // key -> { count, lastFail, lockUntil }
  }

  /** { locked: bool, retryAfter?: seconds } */
  status(key) {
    const e = this.state.get(key);
    if (!e) return { locked: false };
    if (e.lockUntil && Date.now() < e.lockUntil) {
      return { locked: true, retryAfter: Math.ceil((e.lockUntil - Date.now()) / 1000) };
    }
    return { locked: false };
  }

  /** Record a failed attempt; escalate the lock on repeated failures. */
  fail(key) {
    const now = Date.now();
    let e = this.state.get(key);
    if (!e) e = { count: 0, lastFail: 0, lockUntil: 0 };
    // Forget stale failure streaks (only when not currently locked).
    if (e.lastFail && now - e.lastFail > this.forgetMs && !(e.lockUntil > now)) e.count = 0;
    e.count++;
    e.lastFail = now;
    if (e.count > this.freeAttempts) {
      const over = e.count - this.freeAttempts; // 1, 2, 3, ...
      const lockMs = Math.min(this.maxLockMs, this.baseLockMs * Math.pow(2, over - 1));
      e.lockUntil = now + lockMs;
    }
    this.state.set(key, e);
    if (this.state.size > 10000) this._sweep(now);
  }

  /** Clear on successful login. */
  succeed(key) {
    this.state.delete(key);
  }

  _sweep(now) {
    for (const [k, v] of this.state) {
      const dead = (!v.lockUntil || now > v.lockUntil) && now - v.lastFail > this.forgetMs;
      if (dead) this.state.delete(k);
    }
  }
}

module.exports = { FixedWindowLimiter, LoginGuard };
