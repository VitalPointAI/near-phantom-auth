import { describe, it } from 'vitest';

describe('Rate Limiting (SEC-02)', () => {
  describe('auth limiter', () => {
    it.todo('returns 429 after exceeding auth limit from same IP');
    it.todo('resets count after window expires');
    it.todo('uses configurable windowMs and limit from RateLimitConfig.auth');
    it.todo('applies to /register/start, /register/finish, /login/start, /login/finish, /logout');
  });

  describe('recovery limiter', () => {
    it.todo('returns 429 after exceeding recovery limit from same IP');
    it.todo('recovery limiter fires before auth limiter at equal request rate');
    it.todo('uses configurable windowMs and limit from RateLimitConfig.recovery');
    it.todo('applies to all /recovery/* routes');
  });

  describe('defaults', () => {
    it.todo('applies default rate limits when rateLimiting config is omitted');
    it.todo('does not rate limit GET /session');
  });
});
