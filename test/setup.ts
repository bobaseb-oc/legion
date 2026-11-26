// the tests' preload (bunfig.toml): a run must come through test/run.sh
// (`bun run test`), which sets HOME and Legion's dir (LEGION_DIR) in a fresh
// temp root before bun starts. A bare `bun test` would run with the user's
// real home: on 2026-11-18 one replaced ~/.legion/cloud.db with Cloud.test.ts
// fixtures. So it is refused here, before any test file loads
// (Isolation.test.ts checks the run is under the root)

import * as os from "node:os";
import * as path from "node:path";

const root = process.env.LEGION_TEST_ROOT ?? "";
const under = (p: string) => root !== "" && path.resolve(p).startsWith(path.resolve(root) + path.sep);
if (!under(os.homedir()) || !under(process.env.LEGION_DIR ?? "")) {
  console.error("legion tests: run them with `bun run test [files] [flags]` (test/run.sh), never a bare `bun test`: it would use your real ~/.legion");
  process.exit(2);
}
