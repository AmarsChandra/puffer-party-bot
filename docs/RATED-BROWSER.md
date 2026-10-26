# Rated browser controller

Use `playRatedMatch()` for live play. It stays inside one fully awaited browser-control call through a complete match, then returns after the result and leaves the table. This avoids the 5–22-second gaps observed when a caller repeatedly ran short `drive()` windows and processed chat/tool results between them.

The caller supplies an existing browser tab through the documented browser-tool interface. The adapter reads rendered page text and uses ordinary textbox and keyboard actions. It does not read credentials, browser session storage, or private game state, and it does not edit the account username.

```js
const driver = await import('/absolute/path/to/src/browser-driver.mjs');
const run = driver.createRun('/absolute/path/to/recording-directory');
const engine = await driver.createBrowserEngine(
  '/absolute/path/to/worker-directory',
  '/absolute/path/to/puffer-party-bot',
);
const result = await driver.playRatedMatch(run, tab, engine, {
  maxSeconds: 900,
  onProgress: progress => console.log(progress),
});
```

Initialize the worker and recording paths before entering Rated. Keep the entire `playRatedMatch()` promise awaited in the same browser-tool call, with a tool timeout longer than `maxSeconds`. Do not start it in the background across separate REPL calls. Save evidence and publish updates between matches. The low-level `drive()` function remains available for bounded inspection and tests; repeatedly calling it for a live match reintroduces the handoff gaps.

The controller uses the Rated queue, returns after a visible loss, and preserves interrupted attempts as inconclusive. The watchdog leaves an active table if its maximum duration expires. Unsent drafts survive temporary Send-button disablement. Failed screenshots are logged and retried with backoff, so that failure alone does not stop answer submission. Progress callbacks should be fast and local; a slow callback can delay the loop.

## Observed live validation

[JNMB evidence](../validation/ranked-browser/whole-match-validation.json) and [recording](../media/ranked/ranked-JNMB-win.mp4): six-player rated win as Dinosaur, four hearts remaining, displayed rating change +18.

| Measurement | Observed result |
| --- | --- |
| Controller windows for the whole match | 1 |
| Controller duration, including queue and exit | 269.4 seconds |
| Page observations | 2,220 |
| Largest interval between observations | 503 ms |
| Observed own turns with a submission | 12 / 12 |
| Submission attempts, including retries | 19 |
| Choice-to-Enter delay, median | 72 ms |
| Largest sampled recording frame gap | 924 ms |
| Recording failures | 0 |

These measurements cover one live rated match. External browser interruptions, slow browser-tool calls, and generation for uncovered categories can still delay answers. Sampled screenshots have no audio and are separate from smooth native screen video. UI submission counts do not establish server acknowledgement acceptance or rarity.

## Disabling screenshots

Set `run.state.recording.enabled = false` before starting a match. The setting persists in `run.json` and skips both routine frames and result-screen captures. Text result and submission logs continue.

## Experimental two-table play

`playParallelRatedMatches()` controls one complete rated match in each of two existing tabs. Keep the whole call awaited in one browser-tool execution. Each table needs a separate run directory and answer engine; sharing an engine would let a category change on one table cancel answer generation on the other.

```js
const engineA = await driver.createBrowserEngine(rootA, repo, {
  localFirst: true, trackStats: false,
});
const engineB = await driver.createBrowserEngine(rootB, repo, {
  localFirst: true, trackStats: false, sharedCacheFrom: engineA,
});
try {
  const result = await driver.playParallelRatedMatches([
    {run: runA, tab: tabA, engine: engineA},
    {run: runB, tab: tabB, engine: engineB},
  ]);
} finally {
  engineA.close();
  engineB.close();
}
```

The engines share learned answer data in the same JavaScript runtime, while keeping turn state and generation cancellation separate. The second queue starts after the first table is seated. If both tabs reach the same room, the second controller stops before typing or counting that room as another result. `overlapObserved` reports whether two distinct rooms were active together; it does not establish two wins or continued support by the game service.

Disable screenshots on both runs before starting if recording is unwanted. Results remain in each run's local ledger. When tracking an account-wide streak, combine distinct match outcomes in completion order and reset on any loss or inconclusive result; do not add the two independent streak counters.

## Continuous play

`playRatedPool()` in `src/rated-pool.mjs` refills each supplied slot independently after its match finishes. With one slot it continuously plays one game at a time. It does not stop at the old per-table streak target.

```js
const {playRatedPool} = await import('/absolute/path/to/src/rated-pool.mjs');
await playRatedPool([{run, tab, engine}], {
  controlPath: '/absolute/path/to/control.json',
  onStatus: status => saveLocalStatus(status),
});
```

Create the control file with `{"continue":true}`. Set `{"continue":false}` to stop; the controller checks it during live play, stops typing, and leaves the current game. Keep the whole promise awaited in the browser-tool call, and close engines in the caller's `finally` block. Status callbacks must be fast and local.

For multiple slots, the pool staggers queue admission and falls back to one healthy slot after controller errors, repeated observation delays, or a queue timeout. Other active games finish without replacement. An optional `retireLane` callback can close idle extra tabs to reduce browser load. A `recoverLane` callback can restore the retained tab after a failure.

Two simultaneous rated wins were observed in the initial experiment. Later ten-tab preparation coincided with an account rating drop and an additional non-winning rated result, before the continuous pool entered games. The cause was not established. The live setup therefore uses one slot; the earlier two-tab result does not establish reliable account support for concurrent play.

## Optional taunting drafts

Set `run.state.taunting = true` before a match to briefly type “I'm going to win” before the prepared answer. The phrase is typed one character at a time, held for one second, and cleared. Enter is reserved for the real answer.

Taunts start only when the visible fuse bar is fresh. An inflated or unreadable bar skips them, and longer answers leave less room for a phrase. Rising inflation or a slow browser interrupts the taunt and moves to the answer. The number beside Send is lives, not a countdown. Prompt reveal and turn ownership checks still apply. This feature uses local timing and makes no model requests.
