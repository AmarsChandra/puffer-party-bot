# Puffer Party bot
https://github.com/user-attachments/assets/7b69437f-7401-48e5-b8b3-d685e7ddb9fc


**Category 6: boxing movies — 2 krillion answers and 3 deep cuts.** A 41-second excerpt from the public SSFF win, recorded on October 22, 2026. This five-player match finished with **45 accepted answers, 23 deep cuts, 4 krillion answers, and 5 hearts**. [Clip evidence](media/category-06-evidence.json) · [Match result](validation/adaptive-campaign/games/017/result.json)

The video uses timestamped browser captures sampled at about 1.2 frames per second, without audio. It shows Krillion’s actual game client while the bot plays.

A Node.js bot for [Krillion Puffer Party](https://krillion.io), inspired by [this demonstration](https://www.tiktok.com/@ladiabeto/video/7699307823955447070). It prefers server-confirmed krillion, deep-cut, and rare answers, generates fresh choices for unseen categories with the signed-in Codex CLI, and learns from every accepted or rejected answer.

## Play

Requires **Node.js 22+**. There are no npm dependencies. Fresh answer generation also requires the official Codex CLI to be installed and signed in; it uses your Codex allowance and configured model.

```sh
git clone https://github.com/AmarsChandra/puffer-party-bot.git
cd puffer-party-bot
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

## Public group games and improvement

The adaptive campaign uses normal public **4–6-player matchmaking**, playing one match per invocation. It preserves every outcome and requires a review before the next game.

```sh
node adaptive-campaign.mjs --campaign runs/my-campaign --init
node adaptive-campaign.mjs --campaign runs/my-campaign --next --stats-dir runs/my-stats
```

Read `runs/my-campaign/games/001/review.json` and `result.json`. Review slow categories, misses, repeats, and actual rarity awards. Make and test a useful change when supported by the evidence; clean matches can retain the code and use their newly learned answers. Save a review file:

```json
{"summary":"Reviewed the match and retained its confirmed answers.","changes":[]}
```

```sh
node adaptive-campaign.mjs --campaign runs/my-campaign --note-file review-note.json
node adaptive-campaign.mjs --campaign runs/my-campaign --next --stats-dir runs/my-stats
node adaptive-campaign.mjs --campaign runs/my-campaign --audit
```

Each match records source hashes and a complete source snapshot. The runner retains interrupted attempts and separates setup failures before participation. Code stays fixed during each game; the learned cache updates as the server confirms answers.

## Observed statistics

Snapshot as of 2026-10-22T23:26:04.564Z. This campaign includes multiple source versions and the imported first seven party games. It excludes private tests and unrelated earlier attempts.

| Metric | Result |
| --- | --- |
| Confirmed public wins / attempts | 16 / 17 (94.1%) |
| Losses / inconclusive interruptions | 0 / 1 |
| Current / best consecutive wins | 7 / 9 |
| Accepted submissions / acknowledgements | 267 / 282 (94.7%) |
| Rare-or-better accepted answers | 91 / 267 (34.1%) |
| Category first-answer availability, median | 3,794 ms |
| First-turn wait, median | 82 ms |

[Full statistics and methodology](statistics/README-snippet.md) · [Machine-readable summary](statistics/summary.json) · [Every public attempt as CSV](statistics/matches.csv)

Only the game’s acknowledgements establish acceptance and rarity. Model proposals remain unverified until accepted. An inconclusive public attempt counts as a non-win and breaks the streak. Latency summaries report coverage and exclude missing measurements. These observed results do not guarantee future wins.

## How it improves

- **Rare answers first:** verified tiers outrank guesses. Fresh generation targets niche, established answers; common-only local pools can request rare alternatives in the background.
- **Fast first answers:** a persistent Codex worker starts before matchmaking. Unseen categories stream an initial three-answer burst, then fill more choices in the background. Known categories and spelling constraints answer locally.
- **Learning:** the cache retains canonical accepted answers, server tiers, and misses for each category. Used names and reviewed aliases are excluded.
- **Recovery:** reconnects preserve the bot’s guest identity. Usage-limit errors back off while local answers remain available.
- **Evidence:** match reviews include rarity, first-answer readiness, first-turn wait, rejected answers, and player counts. Statistics regenerate after results and reviews.

The rare-first benchmark measured a 3,584 ms median first answer versus 5,612.5 ms for the prior prompt in eight samples per condition. See [the benchmark and its conditions](validation/round-improvement-005.json). This is a measured sample using the configured model.

## Watch the live game

Run the display in one terminal and the campaign in another:

```sh
node game-screen.mjs runs/current-seat.json
node adaptive-campaign.mjs --campaign runs/my-campaign --next --watch-seat runs/current-seat.json
```

Open `http://127.0.0.1:8768/watch`. The local display loads Krillion’s own client and follows the bot into each room. It binds to localhost. Saved seat files contain generated guest credentials and belong only on your computer; `.gitignore` excludes them.

## Check the project

```sh
npm test
npm run audit
npm run stats
```

The initial publication passed **50 regression tests**. These tests use mocks and retained game evidence without entering games or using model allowance. The campaign audit verifies source snapshots, outcomes, unique game IDs, and streak accounting. `self-play.mjs` is available for private integration tests and is counted separately from public wins.

Source: `puffer-bot.mjs` handles the game connection; `answer-engine.mjs` ranks and learns answers; `codex-provider.mjs` manages generation; `adaptive-campaign.mjs` runs and records reviewed games; `statistics.mjs` derives publication statistics.

Word data attribution and redistribution terms are in [WORD-DATA-NOTICE.md](WORD-DATA-NOTICE.md) and [WORD-FREQ-LICENSE.txt](WORD-FREQ-LICENSE.txt).
