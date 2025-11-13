# Guild Test Suite

This directory complements the in-function tests located under `cloudfunctions/guild/__tests__` by focusing on
cross-cutting behaviours that were required for milestone G:

- **`service-actions.spec.js`** — validates success, failure and boundary paths for guild creation, application review,
  donations, task claims, boss challenges and leaderboard refreshes.
- **`boss-randomness.spec.js`** — ensures replay determinism for identical seeds while verifying replay divergence for
  different seeds.
- **`boss-concurrency.spec.js`** — simulates parallel boss challenges and asserts that cumulative damage and ranking
  remain consistent.
- **`guild-lifecycle.e2e.spec.js`** — mirrors the production entry flow of `入会 → 捐献 → 领任务 → Boss → 榜单 → 领奖` using an
  in-memory CloudBase double so that we can run it in CI.

All tests run with Jest via the root `package.json` script:

```bash
npm test -- --runInBand
```

> **Note**: the in-memory database helper (`test-helpers.js`) is intentionally simple and only implements the subset of
> CloudBase APIs that the guild service exercises. When adding new tests make sure to extend the helper with any missing
> query operators before attempting to stub them in each spec.
