// Tidy list
// =========
// `bun local/tidy.ts --list` (legion tidy --list): every linked worktree
// under the clone roots (UNII_SPACES, default /Volumes/dev/git and
// ~/.claude) and the tidy's extra roots (~/repos, /private/tmp/claude-501),
// one line each: repo, branch, merged or gone, changes, unpushed, stashes,
// size, age, in use, safe. Read-only: it removes nothing (only the user's
// Remove in Legion's inbox does, Device.device_tidy)

import { device_tidy_list, device_tidy_scan } from "../Device.ts";

if (process.argv[2] !== "--list") {
  console.error("legion tidy --list (read-only; remove from Legion's inbox)");
  process.exit(2);
}
console.log(device_tidy_list(await device_tidy_scan()));
