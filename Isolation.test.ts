// `bun test Isolation.test.ts`. Every test runs in a home of its own: the
// preload (bunfig.toml, test/setup.ts) sets HOME and LEGION_DIR in a fresh
// temp dir before any test file loads, so no test reads or writes the
// user's real ~/.legion (on 2026-11-18 a full run replaced its cloud.db)

import { expect, test } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";

const config = await import("./Config.ts");

test("the tests' home, Legion's dir and LEGION_DIR are all under the preload's temp root", () => {
  const root = process.env.LEGION_TEST_ROOT ?? "";
  expect(root).not.toBe("");
  const under = (p: string) => path.resolve(p).startsWith(path.resolve(root) + path.sep);
  expect(under(os.homedir())).toBe(true);
  expect(under(config.DIR)).toBe(true);
  expect(under(process.env.LEGION_DIR ?? "")).toBe(true);
});
