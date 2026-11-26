// MCP login
// =========
// `bun local/mcp-login.ts <server> [--logout]` (legion mcp-login, legion
// mcp-logout). RED ZONE (tasks/atlassian-oauth.md): signs in to an MCP
// server that mcp.json marks oauth (Auth.ts): the browser opens at its
// authorization server, the grant goes to the Keychain (service
// "legion-mcp-<server>"), never to a file or this terminal. Logout deletes
// it. The server uses it from its next start.

import * as os from "node:os";
import { Auth } from "../Auth.ts";
import { json } from "./skills.ts";

const [name, flag] = process.argv.slice(2);
const dir = (process.env.LEGION_DIR ?? "~/.legion").replace(/^~\//, os.homedir() + "/");
const store = Auth.keychain("legion-mcp");
const server = (json(dir + "/mcp.json").servers ?? []).find((s: any) => s?.name === name && s.oauth === true && typeof s.url === "string");

if (server === undefined) {
  console.error("legion: no OAuth server " + name + " in " + dir + "/mcp.json (legion start makes it)");
  process.exit(1);
}
try {
  if (flag === "--logout") {
    console.log((await Auth.logout(name, store)) ? "legion: signed out of " + name : "legion: not signed in to " + name);
  } else {
    await Auth.login(name, server.url, store, {
      open: (url) => {
        console.log("legion: sign in to " + name + " in your browser (it should open; else open this):\n" + url);
        Bun.spawn(["open", url], { stdout: "ignore", stderr: "ignore" });
      },
    });
    console.log("legion: signed in to " + name + ". Restart legion (legion stop, then legion) to use it.");
  }
} catch (err: any) {
  console.error("legion: " + String(err?.message ?? err).split("\n")[0]);
  process.exit(1);
}
