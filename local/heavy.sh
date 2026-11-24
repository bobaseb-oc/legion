#!/usr/bin/env bash
# local/heavy.sh <command> [args]: run a heavy test suite (Spark, the full
# `bun run test`) one at a time on this computer. The command runs under
# /usr/bin/lockf -k on one lock file (macOS has no flock), so a second run
# waits until the first ends. UNII_HEAVY_LOCK names the file (default
# ~/.unii/heavy.lock)
set -euo pipefail
lock="${UNII_HEAVY_LOCK:-$HOME/.unii/heavy.lock}"
mkdir -p "$(dirname "$lock")"
exec /usr/bin/lockf -k "$lock" "$@"
