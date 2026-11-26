#!/usr/bin/env bash
# `bun run test [files] [flags]`: the tests in a home of their own. HOME and
# Legion's dir (LEGION_DIR) in a fresh temp root, set before bun starts (bun
# reads HOME once, at start), so no test reaches the user's real ~/.legion,
# ~/.claude or git identity; each file in its own module cache (--isolate).
# test/setup.ts (the preload) refuses a run that didn't come through here
set -euo pipefail
# one heavy suite at a time on this computer (local/heavy.sh): the lock is
# the user's, named before HOME moves to the temp root
lock="${LEGION_HEAVY_LOCK:-$HOME/.legion/heavy.lock}"
here="$(cd "$(dirname "$0")" && pwd -P)"
root="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/legion-test-XXXXXX")" && pwd -P)"
trap 'rm -rf "$root"' EXIT
mkdir -p "$root/home/.legion"
chmod 700 "$root/home/.legion"
export LEGION_TEST_ROOT="$root" HOME="$root/home" LEGION_DIR="$root/home/.legion"
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
LEGION_HEAVY_LOCK="$lock" bash "$here/../local/heavy.sh" bun test --isolate "$@"
