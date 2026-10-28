# Qinglong offline subscription fixtures

These are **unmodified upstream sources**, not this project's runtime code.

- Upstream: https://github.com/whyour/qinglong
- Version: `v2.23.0`
- Commit: `70636900b29f1fcdabb736071e255dbb7e8bea0b`
- Source paths: `cli/src/internal/subscription/subscriptionRunner.ts` and `subscriptionFilter.ts`.
- License: Apache-2.0; the upstream license is preserved in the adjacent `LICENSE` file.
- SHA-256 runner: `1378970a2ba58bce49c844b679366d9dce7a562eace1d616b6d017d77e1e8ea2`.
- SHA-256 filter: `5686fb9285e4aa42d6ad01faac27f1efbbd47e4c7f38520649bc76c28b35dba1`.

The `.ts.fixture` suffix prevents editors from treating the partial upstream source tree as a compilable application. File contents remain byte-identical to the pinned upstream files.

`tests/qinglong-subscription.test.cjs` verifies those hashes, selects the original metadata/filter/reconcile functions and erases TypeScript types using Node 22.13+ built-in `stripTypeScriptTypes` (CI uses Node 22). It executes the official POSIX filter with local `grep`, uses temporary local files, and substitutes an **in-memory test API**, never a real user's panel. The test adds six tasks, edits a cron/name/disabled state, then imports again to verify no duplicate tasks and no overwrite of those edits.

This is an isolated source-level integration test, **not** a claim that a real Qinglong panel, every historical version, or any real Zeekr account was exercised. Account-wrapper fixtures explicitly use unsigned `alg=none` offline JWTs; decoding is not signature verification. Network transports are blocked in wrapper tests.
