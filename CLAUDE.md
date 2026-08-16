# Working rules for agent sessions

Read MISSION.md and PLAN.md before writing code. The prime directive: **nothing is done until you ran its self-check here and it passed.**

1. **Self-check before "done".** Every product in PLAN.md has an executable check. Run it, paste the real output. Never report "should work".
2. **Tests are offline.** Unit/integration/e2e tests use `FixtureTransport` with recorded responses in `/fixtures/api/`. Only `scripts/record-fixtures` may hit live APIs, and only when explicitly run.
3. **Keep `/src/core` pure.** No fetch, no DOM, no device APIs, no Date.now in core logic. If you need I/O, you're in the wrong directory.
4. **Independent expectations.** Test expectations are derived analytically or from documented references — never by running the code and pasting its output back as the expectation.
5. **`archive/v1-expo/` is read-only reference.** Don't import from it, fix it, or resurrect it piecemeal.
6. **Update TODO.md in the same commit** that completes an item.
7. Branch: develop on `claude/topographic-peak-identifier-EV4ZN`; push with `git push -u origin <branch>`.
