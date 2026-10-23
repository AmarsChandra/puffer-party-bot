# Answer sources

The primary imported source is [Pinpoint Answer Hub’s public Krillion archive](https://www.linkedinpinpointanswer.today/krillion-answers/archive). The bundled `data/answer-archive.json.gz` is a compressed JSON index; Node reads it with its built-in zlib module. The local index retains at most 100 canonical answer names per exact category, ordered by published rarity. It records the source date, URL, retrieval time and SHA-256 of each structured page export. It excludes editorial prose and answer quips. The bot’s software does not claim ownership of the source data or affiliation with either site.

Published scores map to expected tiers: 100 → krillion, 85 → deepcut, 60 → rare, 30 → schooler, 15 → tooclever, 10 → plankton. Imported tiers are predictions until Puffer acknowledges that submission. Observed Puffer acceptance, rejection and awarded rarity take precedence. Similar-looking prompts are not automatically merged beyond the engine’s explicit normalization and existing aliases.

To refresh from structured exports of publicly viewable daily pages:

```sh
node src/answer-archive.mjs /path/to/export-directory
```

Each file is named `YYYY-MM-DD.json` and has this shape:

```json
{
  "url": "https://www.linkedinpinpointanswer.today/krillion-answers/2026-10-23",
  "retrievedAt": "2026-10-23T00:00:00Z",
  "prompts": [{
    "text": "Exact category text",
    "totalAnswers": 2,
    "answers": [{"answer": "Canonical name", "score": 100}]
  }]
}
```

Exports were collected through the normal public page UI by revealing its answer tiers. The importer does not solve challenges, use account credentials, or attempt access-denied archive endpoints. It preserves the latest dated occurrence when the same normalized category repeats. `complete` is true only when the exported, eligible distinct choices cover the stated total within the retention limit.

The optional `regular-bank.mjs` importer separately reads the official current daily reveal and five free first-dive previews. Its generated index remains local. The mutable `learned-answers.json` holds gameplay observations and model proposals, identified separately by acceptance counts, misses and tiers. Statistics use actual game acknowledgements rather than imported ranks or model claims.
