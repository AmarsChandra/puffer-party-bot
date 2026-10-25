# Puffer Party bot

https://github.com/user-attachments/assets/7b69437f-7401-48e5-b8b3-d685e7ddb9fc

*Category 6: boxing movies. Two krillion answers and three deep cuts from a public match win.*

A Node.js bot for [Krillion Puffer Party](https://krillion.io) that picks rare answers from a local archive, learns from game feedback, and uses Codex for uncovered categories.

## Quick start

Requires **Node.js 22+**. No npm dependencies. Fresh answer generation requires an installed, signed-in Codex CLI and uses your Codex allowance.

```sh
git clone https://github.com/AmarsChandra/puffer-party-bot.git
cd puffer-party-bot
sh ./play.sh
```

The launcher plays one unrated public 1v1 as a separate guest named PufferBot.

```sh
sh ./play.sh --ai off      # Local answers only
sh ./play.sh --games 5     # Play five games
sh ./play.sh --room ABCD   # Join an existing room
sh ./play.sh --help
```

Signed-in rated play uses the separate [experimental browser adapter](docs/RATED-BROWSER.md).

## How it works

- **Archive first:** choose the rarest unused matching answer from the cached [Krillion answer archive](https://www.linkedinpinpointanswer.today/krillion-answers/archive).
- **Fallbacks:** use the local bank and learned cache, then request fresh Codex answers when needed.
- **Learning:** remember game-confirmed answers, rarity, and rejections for future matches.

The browser adapter types one character at a time and waits for the category prompt to finish appearing.

## More

- [Extended usage and historical results](docs/PROJECT-NOTES.md)
- [Answer sources and refresh instructions](docs/ANSWER-SOURCES.md)
- [Word data attribution](docs/WORD-DATA-NOTICE.md) · [License](docs/WORD-FREQ-LICENSE.txt)

Run `npm test` to check the project locally without entering games or requesting model answers.
