import { describe, it } from 'vitest';

describe('OAuth cookie-parser guard (INFRA-05)', () => {
  it.todo('returns 500 with clear error when req.cookies is undefined');
  it.todo('logs error message mentioning cookie-parser middleware');
  it.todo('proceeds normally when req.cookies is populated');
});
