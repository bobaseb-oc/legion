#!/usr/bin/env bash
# `bun run test [files] [flags]`: the tests in a home of their own. HOME and
# Legion's dir (UNII_DIR) in a fresh temp root, set before bun starts (bun
# reads HOME once, at start), so no test reaches the user's real ~/.unii,
# ~/.claude or git identity; each file in its own module cache (--isolate).
# test/setup.ts (the preload) refuses a run that didn't come through here
set -euo pipefail
# one heavy suite at a time on this computer (local/heavy.sh): the lock is
# the user's, named before HOME moves to the temp root
lock="${UNII_HEAVY_LOCK:-$HOME/.unii/heavy.lock}"
here="$(cd "$(dirname "$0")" && pwd -P)"
root="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/legion-test-XXXXXX")" && pwd -P)"
trap 'rm -rf "$root"' EXIT
mkdir -p "$root/home/.unii"
chmod 700 "$root/home/.unii"
export UNII_TEST_ROOT="$root" HOME="$root/home" UNII_DIR="$root/home/.unii"
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
UNII_HEAVY_LOCK="$lock" bash "$here/../local/heavy.sh" bun test --isolate "$@"
