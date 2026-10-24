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
