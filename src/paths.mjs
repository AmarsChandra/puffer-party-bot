import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const DATA=path.join(ROOT,'data');
export const RUNS=path.join(ROOT,'runs');
export const SOURCE_FILES=[
 'src/paths.mjs','src/puffer-bot.mjs','src/answer-engine.mjs','src/codex-provider.mjs',
 'src/regular-bank.mjs','src/streak-runner.mjs','src/game-screen.mjs',
 'src/adaptive-campaign.mjs','src/review-match.mjs','src/statistics.mjs','src/self-play.mjs',
 'data/answers.json','data/english-words.json'
];
