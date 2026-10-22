# Puffer Party bot — observed public results

As of 2026-10-22T23:26:55.557Z. Public party-queue attempts retained in this adaptive campaign, including its imported first seven games. Private tests and unrelated earlier attempts are excluded.

| Metric | Observed result |
| --- | --- |
| Public attempts | 17 |
| Confirmed wins | 16 / 17 (94.1%) |
| Confirmed losses / inconclusive interruptions | 0 / 1 |
| Current / best consecutive wins | 7 / 9 |
| Accepted gameplay acknowledgements | 267 / 282 (94.7%) |
| Miss / repeat rejections | 4 / 11 |
| Rare, deep-cut or Krillion answers | 91 / 267 (34.1%) |
| Category first-answer availability, median / p95 | 3,794 ms / 8,781 ms (104 observations) |
| First-turn wait, median / p95 | 82 ms / 4,226 ms (102 observations) |
| Categories without an available answer / first turns without a submission | 1 / 1 |
| Setup failures before participation | 1 |

Rarity tiers are reported by the game: tooclever: 1, plankton: 117, rare: 41, deepcut: 42, schooler: 58, krillion: 8.

Inconclusive public attempts count as non-wins and break the streak. Setup failures before participation are listed separately.

Acceptance and rarity use retained gameplay acknowledgements; they do not count model proposals as accepted. Partial interruption logs are included when available.

Category readiness includes local, cached and generated answers. The codex source can include cached model proposals; it does not mean every answer required a fresh request.

Latency percentiles exclude missing measurements. Unavailable answers, first turns without a submission, and attempts missing timing evidence are reported separately in latencyCoverage.

Player counts exclude spectators. Model prompt requests do not establish rarity; only server tiers do.

Results are a measured sample across different categories and source versions, not a guarantee of future wins.

The accompanying summary.json contains per-version results and evidence issues; matches.csv contains every public attempt. No evidence mismatches were found by this statistics pass.
