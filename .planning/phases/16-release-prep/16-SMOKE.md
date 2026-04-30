# Phase 16 Smoke Install

## 0.7.0 smoke install

- Package: `@vitalpoint/near-phantom-auth@0.7.0`
- Local tarball: `vitalpoint-near-phantom-auth-0.7.0.tgz`
- Temp consumer: `/tmp/near-phantom-auth-smoke-jrWD2O`
- Install command: `npm install /home/vitalpointai/projects/near-phantom-auth/vitalpoint-near-phantom-auth-0.7.0.tgz typescript @types/node`
- Install result: passed
- Install warning: npm reported 8 low-severity vulnerabilities in the temp consumer dependency tree

## TypeScript Fixture

Fixture file: `/tmp/near-phantom-auth-smoke-jrWD2O/smoke.ts`

The fixture imports:

- `createAnonAuth`
- `MPCAccountManager`
- `AnonAuthConfig`
- `AfterAuthSuccessCtx`
- `BackfillKeyBundleCtx`
- `AnalyticsEvent`
- `RelatedOrigin`

The fixture validates the v0.7.0 surface:

- `hooks.afterAuthSuccess`
- `hooks.backfillKeyBundle`
- `hooks.onAuthEvent`
- `awaitAnalytics`
- `rp.relatedOrigins`

It also validates v0.6.1 backwards compatibility by instantiating:

```ts
new MPCAccountManager({
  networkId: 'testnet',
  derivationSalt: 'smoke-salt',
});
```

## Results

- `npx tsc --noEmit`: passed
- Runtime import command: `node -e "import('@vitalpoint/near-phantom-auth/server').then(...)"`
- Runtime import result: `function function`

