# Puffer Party bot — observed public results

As of 2026-10-23T17:03:09.845Z. Public party-queue attempts retained in this adaptive campaign, including its imported first seven games. Private tests and unrelated earlier attempts are excluded.

| Metric | Observed result |
| --- | --- |
| Public attempts | 23 |
| Confirmed wins | 22 / 23 (95.7%) |
| Confirmed losses / inconclusive interruptions | 0 / 1 |
| Current / best consecutive wins | 13 / 13 |
| Accepted gameplay acknowledgements | 381 / 397 (96.0%) |
| Miss / repeat rejections | 4 / 12 |
| Rare, deep-cut or Krillion answers | 194 / 381 (50.9%) |
| Category first-answer availability, median / p95 | 3,610 ms / 7,290 ms (147 observations) |
| First-turn wait, median / p95 | 82 ms / 4,074 ms (143 observations) |
| Categories without an available answer / first turns without a submission | 1 / 1 |
| Setup failures before participation | 1 |
| Fresh Codex generation requests | 29 across 5 measured matches; 18 historical matches unmeasured |

Rarity tiers are reported by the game: tooclever: 1, plankton: 122, rare: 64, deepcut: 98, schooler: 64, krillion: 32.

Inconclusive public attempts count as non-wins and break the streak. Setup failures before participation are listed separately.

Acceptance and rarity use retained gameplay acknowledgements; they do not count model proposals as accepted. Partial interruption logs are included when available.

Category readiness includes local, cached and generated answers. The codex source can include cached model proposals; it does not mean every answer required a fresh request.

Latency percentiles exclude missing measurements. Unavailable answers, first turns without a submission, and attempts missing timing evidence are reported separately in latencyCoverage.

Player counts exclude spectators. Model prompt requests do not establish rarity; only server tiers do.

Codex request counts cover only matches instrumented with the ai-request counter; older missing counts are not zero. Counts exclude this development chat and are generation requests, not token or billing totals.

Results are a measured sample across different categories and source versions, not a guarantee of future wins.

The accompanying summary.json contains per-version results and evidence issues; matches.csv contains every public attempt. No evidence mismatches were found by this statistics pass.
