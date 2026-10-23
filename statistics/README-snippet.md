# Puffer Party bot — observed public results

As of 2026-10-23T16:42:49.036Z. Public party-queue attempts retained in this adaptive campaign, including its imported first seven games. Private tests and unrelated earlier attempts are excluded.

| Metric | Observed result |
| --- | --- |
| Public attempts | 20 |
| Confirmed wins | 19 / 20 (95.0%) |
| Confirmed losses / inconclusive interruptions | 0 / 1 |
| Current / best consecutive wins | 10 / 10 |
| Accepted gameplay acknowledgements | 325 / 341 (95.3%) |
| Miss / repeat rejections | 4 / 12 |
| Rare, deep-cut or Krillion answers | 146 / 325 (44.9%) |
| Category first-answer availability, median / p95 | 3,712 ms / 8,589 ms (125 observations) |
| First-turn wait, median / p95 | 82 ms / 4,074 ms (122 observations) |
| Categories without an available answer / first turns without a submission | 1 / 1 |
| Setup failures before participation | 1 |

Rarity tiers are reported by the game: tooclever: 1, plankton: 117, rare: 47, deepcut: 78, schooler: 61, krillion: 21.

Inconclusive public attempts count as non-wins and break the streak. Setup failures before participation are listed separately.

Acceptance and rarity use retained gameplay acknowledgements; they do not count model proposals as accepted. Partial interruption logs are included when available.

Category readiness includes local, cached and generated answers. The codex source can include cached model proposals; it does not mean every answer required a fresh request.

Latency percentiles exclude missing measurements. Unavailable answers, first turns without a submission, and attempts missing timing evidence are reported separately in latencyCoverage.

Player counts exclude spectators. Model prompt requests do not establish rarity; only server tiers do.

Codex request counts cover only matches instrumented with the ai-request counter; older missing counts are not zero. Counts exclude this development chat and are generation requests, not token or billing totals.

Results are a measured sample across different categories and source versions, not a guarantee of future wins.

The accompanying summary.json contains per-version results and evidence issues; matches.csv contains every public attempt. No evidence mismatches were found by this statistics pass.
