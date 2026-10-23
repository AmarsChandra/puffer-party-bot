#!/bin/sh
set -eu
puffer_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
puffer_runtime=${PUFFER_NODE:-$(command -v node || true)}
if [ -z "$puffer_runtime" ] || ! "$puffer_runtime" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
  puffer_runtime="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [ ! -x "$puffer_runtime" ] || ! "$puffer_runtime" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
  echo 'Node.js 22 or newer is required. Set PUFFER_NODE to its executable path.' >&2
  exit 1
fi
exec "$puffer_runtime" "$puffer_dir/src/puffer-bot.mjs" "$@"
