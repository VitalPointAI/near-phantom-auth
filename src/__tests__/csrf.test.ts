import { describe, it } from 'vitest';

describe('CSRF Protection (SEC-03)', () => {
  describe('when csrf enabled', () => {
    it.todo('state-changing POST without CSRF token returns 403');
    it.todo('state-changing POST with valid CSRF token succeeds');
    it.todo('GET /csrf-token returns a token');
    it.todo('GET requests are not CSRF-protected');
  });

  describe('when csrf disabled (default)', () => {
    it.todo('no behavior change - POST requests succeed without CSRF token');
  });

  describe('OAuth exemption', () => {
    it.todo('OAuth callback route is exempt from CSRF even when enabled');
  });
});
