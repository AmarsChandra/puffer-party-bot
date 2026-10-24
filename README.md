# Puffer Party bot

https://github.com/user-attachments/assets/7b69437f-7401-48e5-b8b3-d685e7ddb9fc

**Category 6: boxing movies — 2 krillion answers and 3 deep cuts.** A 41-second excerpt from the public SSFF win, recorded on October 22, 2026. This five-player match finished with **45 accepted answers, 23 deep cuts, 4 krillion answers, and 5 hearts**. [Clip evidence](media/category-06-evidence.json) · [Match result](validation/adaptive-campaign/games/017/result.json)

The video uses timestamped browser captures sampled at about 1.2 frames per second, without audio. It shows Krillion’s actual game client while the bot plays.

A Node.js bot for [Krillion Puffer Party](https://krillion.io), inspired by [this demonstration](https://www.tiktok.com/@ladiabeto/video/7699307823955447070). It prefers server-confirmed krillion, deep-cut, and rare answers, uses a local cache of the public answer archive and generates fresh choices for uncovered categories with the signed-in Codex CLI, and learns from every accepted or rejected answer.

## Play

Requires **Node.js 22+**. There are no npm dependencies. Fresh answer generation also requires the official Codex CLI to be installed and signed in; it uses your Codex allowance and configured model.

```sh
git clone https://github.com/AmarsChandra/puffer-party-bot.git
cd puffer-party-bot
node src/regular-bank.mjs
sh ./play.sh
```

The launcher plays one unrated public 1v1 as a separate guest named PufferBot. Options:

```sh
sh ./play.sh --games 5
sh ./play.sh --room ABCD
sh ./play.sh --ai off
sh ./play.sh --help
```

`--ai off` uses the local answer bank, learned cache, and 34,006-word dictionary. `--room` joins an existing room and waits for its host. `--codex PATH` selects a CLI executable. `--timeout MS` changes the per-game time limit. Ctrl+C leaves the room.

### Answer archive first

The engine loads `data/answer-archive.json.gz`, a bounded cache of canonical answers and published tiers from [Pinpoint Answer Hub’s Krillion archive](https://www.linkedinpinpointanswer.today/krillion-answers/archive). It selects the rarest unused matching answer locally, preserves its source URL and data hash, and skips Codex generation while archive choices remain. Puffer-confirmed answers, misses, and awarded tiers override imported expectations for that answer.

The cache covers **699 categories** from **100 daily sets**, retaining **53,794 choices** with up to 100 rare-first choices per exact prompt. In the historical overlap, 280 of 300 previously accepted choices had matching tiers; Puffer observations override the 20 differences. Local lookup measured 0.23 ms median and 0.40 ms p95 across 699 categories. [Readiness report](validation/answer-archive-readiness.json). It contains answer names and ranks, without the site’s answer quips or article prose. See [source details and refresh instructions](docs/ANSWER-SOURCES.md). Uncovered categories retain the learned/static banks and Codex fallback. Starting the worker no longer makes a warmup generation request. Match evidence records actual Codex generation-request counts; those counts exclude development work in this chat.

### Five-game public test

The next five public party games after the archive integration finished with **5/5 wins**, **95/96 accepted submissions (99.0%)**, and **84/95 rare-or-better awards (88.4%)**. Improvements were reviewed and pushed between matches, so this is an iterative sample across the source versions recorded in the evidence.

| Room (starting players) | Result | Accepted / rejected | Krillion / deep cut / rare | Fresh Codex requests |
| --- | --- | --- | --- | --- |
| HMKJ (6) | win | 26 / 0 | 8 / 16 / 0 | 4 |
| YJFM (6) | win | 13 / 1 | 4 / 5 / 3 | 5 |
| YVBE (6) | win | 18 / 0 | 4 / 3 / 6 | 7 |
| KPSG (6) | win | 24 / 0 | 4 / 14 / 5 | 8 |
| QWSF (6) | win | 14 / 0 | 3 / 3 / 6 | 5 |

The archive covered **18/36 observed categories**. Direct archive submissions: **52 accepted, 0 rejected**; **52/52 accepted choices matched the published tier**. First-answer availability for archive-covered categories was **10 ms median / 13 ms p95**.

There were **29 fresh bot generation requests**, of which **0 came from archive-covered categories**. The worker startup no longer generates answers. Request counts exclude development in this chat and do not measure tokens or billing. The archive does not cover every Puffer category; uncovered rounds keep the Codex fallback. This five-game sample does not establish a guaranteed win rate or a causal percentage reduction in allowance usage.

[Full five-game evidence, category coverage, request events, and source versions](validation/archive-five-game-test.json).

### Public regular-game answer index

`node src/regular-bank.mjs` optionally refreshes a local `data/regular-bank.json` from the current public daily reveal and the five free first dives. It retains up to 80 rare-first canonical choices per exact prompt. The initial six-source sample covered 42 prompts and retained 2,710 choices. The local index is excluded from Git.

An overlap check found identical tiers for all 54 previously observed Puffer answers that could be matched in those reveals. The engine still records these as `regular-bank` choices until Puffer accepts them. Puffer's actual tier or rejection overrides the regular-game expectation. Source URLs and data hashes are recorded with those submissions. Access-denied responses are skipped.

The isolated 42-prompt lookup benchmark measured a 0.41 ms median and a 2.48 ms p95 with no model requests. See [the comparison](validation/regular-bank-comparison.json) and [the lookup benchmark](validation/regular-bank-readiness.json). These are observed samples, not a guarantee of shared acceptance for every prompt.

## Public group games and improvement

The adaptive campaign uses normal public **4–6-player matchmaking**, playing one match per invocation. It preserves every outcome and requires a review before the next game.

```sh
node src/adaptive-campaign.mjs --campaign runs/my-campaign --init
node src/adaptive-campaign.mjs --campaign runs/my-campaign --next --stats-dir runs/my-stats
```

Read `runs/my-campaign/games/001/review.json` and `result.json`. Review slow categories, misses, repeats, and actual rarity awards. Make and test a useful change when supported by the evidence; clean matches can retain the code and use their newly learned answers. Save a review file:

```json
{"summary":"Reviewed the match and retained its confirmed answers.","changes":[]}
```

```sh
node src/adaptive-campaign.mjs --campaign runs/my-campaign --note-file review-note.json
node src/adaptive-campaign.mjs --campaign runs/my-campaign --next --stats-dir runs/my-stats
node src/adaptive-campaign.mjs --campaign runs/my-campaign --audit
```

Each match records source hashes and a complete source snapshot. The runner retains interrupted attempts and separates setup failures before participation. Code stays fixed during each game; the learned cache updates as the server confirms answers.

## Ranked browser run — in progress

The separate signed-in ranked run uses the match display name Dinosaur and does not edit the account profile. Its current retained sample is **9 wins, 7 losses, and 2 inconclusive attempts**, with a **current / best streak of 0 / 5** toward the requested target of 100. Setup and controller failures remain in the log. These results are separate from the unrated campaign below.

[Ranked clips and recording notes](media/ranked/README.md) · [Every ranked attempt](validation/ranked-browser/run.json) · [Capture coverage and gaps](validation/ranked-browser/recording-coverage.json)

The experimental browser controller runs in bounded control batches, with observed capture gaps of up to 22 seconds in the later recorded sample. It can miss turns even when a local answer is ready. This differs from the continuous event-driven unrated runner. The draft retry fix preserves unsent answers when Send is temporarily disabled; it does not remove the gaps between browser calls. [Controller latency measurements](validation/ranked-browser/controller-latency.json).

`src/browser-driver.mjs` is an experimental browser-session adapter. A caller supplies the documented browser tool interface; it uses rendered page text and normal textbox/button actions, with Enter for answer submission. It only queues with the Rated button, leaves immediately on visible elimination, and pauses in the lobby after a win to save evidence. It never reads browser credentials or session storage. Source-only CLI play remains the separate guest client described above.

## Observed statistics

Snapshot as of 2026-10-23T17:02:25.241Z. This campaign includes multiple source versions and the imported first seven party games. It excludes private tests and unrelated earlier attempts.

| Metric | Result |
| --- | --- |
| Confirmed public wins / attempts | 22 / 23 (95.7%) |
| Losses / inconclusive interruptions | 0 / 1 |
| Current / best consecutive wins | 13 / 13 |
| Accepted submissions / acknowledgements | 381 / 397 (96.0%) |
| Rare-or-better accepted answers | 194 / 381 (50.9%) |
| Category first-answer availability, median | 3,610 ms |
| First-turn wait, median | 82 ms |

[Full statistics and methodology](statistics/README-snippet.md) · [Machine-readable summary](statistics/summary.json) · [Every public attempt as CSV](statistics/matches.csv)

Only the game’s acknowledgements establish acceptance and rarity. Imported rankings and model proposals remain separate from Puffer-confirmed data. An inconclusive public attempt counts as a non-win and breaks the streak. Latency summaries report coverage and exclude missing measurements. These observed results do not guarantee future wins.

## How it improves

- **Rare answers first:** verified tiers outrank guesses. Fresh generation targets niche, established answers; common-only local pools can request rare alternatives in the background.
- **Fast first answers:** a persistent Codex worker starts before matchmaking. Uncovered categories stream an initial three-answer burst, then refill in the background when fewer than two useful choices remain. Known categories and spelling constraints answer locally. The dictionary fallback now favors lower-frequency Webster-backed words; actual Puffer tiers override this heuristic.
- **Learning:** the cache retains canonical accepted answers, server tiers, and misses for each category. Used names and reviewed aliases are excluded.
- **Recovery:** reconnects preserve the bot’s guest identity. Usage-limit errors back off while local answers remain available.
- **Evidence:** match reviews include rarity, first-answer readiness, first-turn wait, rejected answers, and player counts. Statistics regenerate after results and reviews.

The rare-first benchmark measured a 3,584 ms median first answer versus 5,612.5 ms for the prior prompt in eight samples per condition. See [the benchmark and its conditions](validation/round-improvement-005.json). This is a measured sample using the configured model.

## Watch the live game

Run the display in one terminal and the campaign in another:

```sh
node src/game-screen.mjs runs/current-seat.json
node src/adaptive-campaign.mjs --campaign runs/my-campaign --next --watch-seat runs/current-seat.json
```

Open `http://127.0.0.1:8768/watch`. The local display loads Krillion’s own client and follows the bot into each room. It binds to localhost. Saved seat files contain generated guest credentials and belong only on your computer; `.gitignore` excludes them.

## Repository layout

```text
src/          Runtime, answer engine, archive importers, and match runners
test/         Regression tests and recorded fixtures
data/         Answer bank, dictionary, and learned answers
docs/         Answer-source attribution and word-data notices
statistics/   Generated summary, CSV, and methodology
validation/   Match results, reviews, benchmarks, and historical source snapshots
media/        Category 6 clip and its evidence
```

`runs/` and the generated `data/regular-bank.json` stay local. Historical source snapshots retain their original paths so old match hashes remain verifiable.

## Check the project

```sh
npm test
npm run audit
npm run stats
```

The latest regression run passed **70 tests**. These tests use mocks and retained game evidence without entering games or using model allowance. The campaign audit verifies source snapshots, outcomes, unique game IDs, and streak accounting. `src/self-play.mjs` is available for private integration tests and is counted separately from public wins.

Source: `src/puffer-bot.mjs` handles the game connection; `src/answer-engine.mjs` ranks and learns answers; `src/codex-provider.mjs` manages generation; `src/adaptive-campaign.mjs` runs and records reviewed games; `src/statistics.mjs` derives publication statistics.

Word data attribution and redistribution terms are in [WORD-DATA-NOTICE.md](docs/WORD-DATA-NOTICE.md) and [WORD-FREQ-LICENSE.txt](docs/WORD-FREQ-LICENSE.txt).
