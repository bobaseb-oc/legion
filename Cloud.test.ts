// Sign-in links (Cloud.link_ask): an address has at most 3 unused at once
// (a ticket used up leaves the count) and a network (Cloud.net) 100 a
// day, used or not, so /api/login can't mail a victim links or drain the
// mail quota.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";

process.env.LEGION_DIR = fs.mkdtempSync("/tmp/cloud-test-");
process.env.LEGION_SITE = "http://127.0.0.1";
const { Cloud } = await import("./Cloud.ts");
// the site, as the first test file to load Config set it (one process)
const config = await import("./Config.ts");

// accounts in a dir made anew; the last test's goes after all. local: a
// server with no mail key (S1b), else one that mails (its post a stub)
function cloud_new(local = false) {
  fs.rmSync(process.env.LEGION_DIR ?? "", { recursive: true, force: true });
  fs.mkdirSync(process.env.LEGION_DIR ?? "", { recursive: true });
  const cloud = Cloud.open(() => {}, () => {}, async () => null);
  cloud.local = local;
  return cloud;
}

afterAll(() => fs.rmSync(process.env.LEGION_DIR ?? "", { recursive: true, force: true }));

test("Cloud.net: IPv4 whole, IPv6 by its /48", () => {
  expect(Cloud.net("1.2.3.4")).toBe("1.2.3.4");
  expect(Cloud.net("::ffff:1.2.3.4")).toBe("1.2.3.4");
  expect(Cloud.net("2001:db8:0:1:aaaa::5")).toBe("2001:db8:0::/48");
  expect(Cloud.net("2001:DB8::1")).toBe("2001:db8:0::/48");
});

test("link_ask caps links by address at once and by network a day", () => {
  const cloud = cloud_new();
  const ask = (who: string, net: string) => Cloud.link_ask(cloud, who, net) ?? Cloud.ticket(cloud, { who, session: null }, 60000);
  const first = ask("a@x.com", "1.1.1.1");
  ask("a@x.com", "1.1.1.1");
  ask("a@x.com", "1.1.1.1");
  expect(Cloud.link_ask(cloud, "a@x.com", "2.2.2.2")).toContain("15 minutes");
  Cloud.ticket_read(cloud, first, true);
  expect(Cloud.link_ask(cloud, "a@x.com", "3.3.3.3")).toBeNull();
  for (let k = 0; k < 97; k++) {
    ask("b" + k + "@x.com", "1.1.1.1");
  }
  expect(Cloud.link_ask(cloud, "c@x.com", "1.1.1.1")).toContain("tomorrow");
  expect(Cloud.link_ask(cloud, "c@x.com", "2.2.2.2")).toBeNull();
  cloud.db.query("update asks set at = at - 864e5").run();
  expect(Cloud.link_ask(cloud, "c@x.com", "1.1.1.1")).toBeNull();
  // no address (a self-host, no proxy): one network, counted
  expect(Cloud.link_ask(cloud, "d@x.com", Cloud.net(""))).toBeNull();
});

test("Cloud.address", () => {
  expect(Cloud.address("@OCTOCAT on gh", true)).toBe("@octocat");
  expect(Cloud.address("o'neil@x.com, not @octocat.", false)).toBe("o'neil@x.com");
});

// A terminal sign-in signs in only when the code the terminal shows is
// typed on the page its link opens (the email's, or GitHub's, which
// brings its code): opening the link makes no session, nor
// does a wrong code; the right one does. So opening an unrequested link,
// or one an attacker forwarded, grants nothing.
test("terminal sign-in needs the code the terminal shows", async () => {
  const cloud = cloud_new();
  const key = Cloud.random();
  const session = Cloud.hash(key);
  const t = Cloud.ticket(cloud, { who: "t@x.com", session }, 60000);
  const code = Cloud.code(session);
  expect(code).toMatch(/^\d{6}$/);
  const post = (c: string) => new Request("http://127.0.0.1/auth", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, code: c }).toString() });
  const signed = () => cloud.db.query("select hash from sessions where hash = ?").get(session);
  const gh = Cloud.ticket(cloud, { who: "@x", session }, 60000);
  for (const link of [t, gh]) {
    const page = await Cloud.http(cloud, new Request("http://127.0.0.1/auth?t=" + link + "&code=" + "a".repeat(64)));
    expect(await page?.text()).toContain("Enter the code");
  }
  expect(signed()).toBeNull();
  await Cloud.confirm(cloud, post(code === "000000" ? "111111" : "000000"));
  expect(signed()).toBeNull();
  await Cloud.confirm(cloud, post(code));
  expect(signed()).not.toBeNull();
  // a terminal's session: it lasts TERM, not a cookie's AGE
  expect(cloud.db.query("select term from sessions where hash = ?").get(session)).toEqual({ term: 1 });
});

// RED ZONE (K1, DRAFT awaiting the user's sign-off): a terminal's sign-in
// makes two keys, both approved by the one code: the device key (a file,
// term 1) and the terminal key (the Keychain, term 2), each lasting TERM.
// Cloud.speaks: only a browser's session or a terminal key's speaks for
// the user, never a device key's, nor one not live
test("a terminal sign-in approves its device key and its terminal key with one code; only a browser or the terminal key speaks", async () => {
  const cloud = cloud_new();
  const login = (body: object) => Cloud.http(cloud, new Request("http://127.0.0.1/api/login", { method: "POST", body: JSON.stringify(body) }));
  const key = Cloud.random();
  const termkey = Cloud.random();
  const asked = (await (await login({ who: "k@x.com", key, term: termkey }))!.json()) as { code: string };
  expect(asked.code).toBe(Cloud.code(Cloud.hash(key)));
  const row = cloud.db.query("select hash from tickets order by expires desc").get() as { hash: string };
  const data = JSON.parse((cloud.db.query("select data from tickets where hash = ?").get(row.hash) as { data: string }).data);
  expect(data.terminal).toBe(Cloud.hash(termkey));
  expect(JSON.stringify(data)).not.toContain(termkey);
  const t = Cloud.ticket(cloud, { who: "k@x.com", session: Cloud.hash(key), terminal: Cloud.hash(termkey) }, 60000);
  const post = (c: string) => new Request("http://127.0.0.1/auth", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, code: c }).toString() });
  const terms = () => cloud.db.query("select term from sessions where hash in (?, ?) order by term").all(Cloud.hash(key), Cloud.hash(termkey));
  await Cloud.confirm(cloud, post(asked.code === "000000" ? "111111" : "000000"));
  expect(terms()).toEqual([]);
  await Cloud.confirm(cloud, post(asked.code));
  expect(terms()).toEqual([{ term: 1 }, { term: 2 }]);
  const bearer = (token: string) => new Request("http://127.0.0.1/", { headers: { authorization: "Bearer " + token } });
  const cookie = Cloud.session(cloud, { id: "u9", name: "b@x.com" });
  expect(Cloud.speaks(cloud, bearer(termkey))).toBe(true);
  expect(Cloud.speaks(cloud, new Request("http://127.0.0.1/", { headers: { cookie: "legion=" + cookie } }))).toBe(true);
  // RED ZONE (rename, DRAFT awaiting the user's sign-off): the cookie's
  // name before the rename signs in no one, even with a live session
  expect(Cloud.speaks(cloud, new Request("http://127.0.0.1/", { headers: { cookie: "unii=" + cookie } }))).toBe(false);
  expect(Cloud.speaks(cloud, bearer(key))).toBe(false);
  expect(Cloud.speaks(cloud, bearer(Cloud.random()))).toBe(false);
  expect(Cloud.speaks(cloud, new Request("http://127.0.0.1/"))).toBe(false);
  expect(Cloud.browser(cloud, bearer(termkey))).toBe(false);
  // the terminal key lasts a terminal's TERM, and speaks only while live
  const age = (days: number) => cloud.db.query("update sessions set made = made - ?, seen = ? where hash = ?").run(days * 864e5, Date.now(), Cloud.hash(termkey));
  age(60);
  expect(Cloud.who(cloud, bearer(termkey))).not.toBeNull();
  age(31);
  expect(Cloud.who(cloud, bearer(termkey))).toBeNull();
  expect(Cloud.speaks(cloud, bearer(termkey))).toBe(false);
  // a terminal key the same as the device key makes no second session
  const same = Cloud.random();
  await login({ who: "s@x.com", key: same, term: same });
  const sdata = JSON.parse((cloud.db.query("select data from tickets where data ->> 'who' = 's@x.com'").get() as { data: string }).data);
  expect(sdata.terminal ?? null).toBeNull();
  // logout-all ends both
  const k2 = Cloud.random();
  const tk2 = Cloud.random();
  Cloud.login(cloud, { id: "u7", name: "z@x.com" }, Cloud.hash(k2), 1);
  Cloud.login(cloud, { id: "u7", name: "z@x.com" }, Cloud.hash(tk2), 2);
  await Cloud.http(cloud, new Request("http://127.0.0.1/api/logout-all", { method: "POST", headers: { authorization: "Bearer " + tk2 } }));
  expect(Cloud.who(cloud, bearer(k2))).toBeNull();
  expect(Cloud.who(cloud, bearer(tk2))).toBeNull();
});

// An emailed link's GET only shows a page with a button: a mail app's
// preview (or a scanner) opening it signs no one in and uses nothing up.
// The button's POST signs in, once: the ticket goes with it.
test("an emailed link survives its preview; its POST signs in once", async () => {
  const cloud = cloud_new();
  const t = Cloud.ticket(cloud, { who: "p@x.com", session: null }, 60000);
  const open = async () => (await Cloud.http(cloud, new Request("http://127.0.0.1/auth?t=" + t)))!;
  const sessions = () => cloud.db.query("select count(*) n from sessions").get();
  const before = sessions();
  const post = () => Cloud.http(cloud, new Request("http://127.0.0.1/auth", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t }).toString() }));
  for (let k = 0; k < 2; k++) {
    const page = await open();
    expect(page.headers.get("set-cookie") ?? "").toBe("");
    const html = await page.text();
    expect(html).toContain('method="post" action="/auth"');
    expect(html).toContain('value="' + t + '"');
  }
  expect(sessions()).toEqual(before);
  const first = await post();
  expect(first?.status).toBe(302);
  expect(first?.headers.get("set-cookie") ?? "").toMatch(/^legion=[^;]+/);
  const again = await post();
  expect(again?.headers.get("set-cookie") ?? "").toBe("");
  expect(again?.headers.get("location")).toContain("expired=1");
  expect((await open()).headers.get("location")).toContain("expired=1");
});

// RED ZONE (security review SC, DRAFT awaiting the user's sign-off):
// a session ends AGE after it was made (a terminal's, TERM), or IDLE
// unused; rows made before the columns were (terminals' and launchd
// devices' Bearer ones among them, not told apart) start their age at the
// migration, a terminal's (TERM), IDLE as any; /api/logout-all (a POST) ends every session of the user
test("sessions expire by age and idleness; old rows migrate; logout-all ends them all", async () => {
  // the dir Config read (the first test file's, in one process)
  for (const end of ["", "-wal", "-shm"]) {
    fs.rmSync(config.DIR + "/cloud.db" + end, { force: true });
  }
  fs.mkdirSync(config.DIR, { recursive: true });
  const { Database } = await import("bun:sqlite");
  const old = new Database(config.DIR + "/cloud.db", { create: true });
  old.exec("create table sessions (hash text primary key, id text not null, name text not null)");
  old.query("insert into sessions values (?, ?, ?)").run(Cloud.hash("oldtoken"), "u0", "old@x.com");
  old.query("insert into sessions values (?, ?, ?)").run(Cloud.hash("olddevice"), "u0", "old@x.com");
  old.query("insert into sessions values (?, ?, ?)").run(Cloud.hash("oldidle"), "u0", "old@x.com");
  old.close();
  const cloud = Cloud.open(() => {}, () => {}, async () => null);
  const as = (token: string) => Cloud.who(cloud, new Request("http://127.0.0.1/", { headers: { cookie: "legion=" + token } }));
  const bearer = (token: string) => Cloud.who(cloud, new Request("http://127.0.0.1/", { headers: { authorization: "Bearer " + token } }));
  expect(as("oldtoken")).toEqual({ id: "u0", name: "old@x.com" });
  const day = 864e5;
  const age = (token: string, days: number) => cloud.db.query("update sessions set made = made - ?, seen = ? where hash = ?").run(days * day, Date.now(), Cloud.hash(token));
  const idle = (token: string, days: number) => cloud.db.query("update sessions set seen = seen - ? where hash = ?").run(days * day, Cloud.hash(token));
  age("olddevice", 60);
  expect(bearer("olddevice")).toEqual({ id: "u0", name: "old@x.com" });
  age("olddevice", 31);
  expect(bearer("olddevice")).toBeNull();
  idle("oldidle", 15);
  expect(bearer("oldidle")).toBeNull();
  const cookie = Cloud.session(cloud, { id: "u1", name: "me@x.com" });
  const term = Cloud.random();
  Cloud.login(cloud, { id: "u1", name: "me@x.com" }, Cloud.hash(term), 1);
  age(cookie, 29);
  age(term, 89);
  expect(as(cookie)).not.toBeNull();
  expect(bearer(term)).not.toBeNull();
  age(cookie, 2);
  age(term, 2);
  expect(as(cookie)).toBeNull();
  expect(Cloud.user(cloud, "u1")).toBeNull();
  expect(bearer(term)).toBeNull();
  const fresh = Cloud.session(cloud, { id: "u2", name: "b@x.com" });
  idle(fresh, 13);
  expect(as(fresh)).not.toBeNull();
  // the lookup marks it seen
  idle(fresh, 13);
  expect(as(fresh)).not.toBeNull();
  idle(fresh, 15);
  expect(as(fresh)).toBeNull();
  // logout-all: a POST only, every session of the user, no one else's
  const a = Cloud.session(cloud, { id: "u3", name: "c@x.com" });
  const b = Cloud.session(cloud, { id: "u3", name: "c@x.com" });
  const other = Cloud.session(cloud, { id: "u4", name: "d@x.com" });
  const all = (method: string) => Cloud.http(cloud, new Request("http://127.0.0.1/api/logout-all", { method, headers: { cookie: "legion=" + a } }));
  expect((await all("GET"))?.status).toBe(405);
  expect(as(b)).not.toBeNull();
  const out = await all("POST");
  expect(out?.status).toBe(204);
  expect(out?.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(as(a)).toBeNull();
  expect(as(b)).toBeNull();
  expect(as(other)).not.toBeNull();
  // a cookie's Max-Age is its session's age, no more
  const page = await Cloud.web_auth(cloud, Cloud.ticket(cloud, { who: "", session: null, user: { id: "u5", name: "e@x.com" } }, 60000));
  expect(page.headers.get("set-cookie")).toContain("Max-Age=2592000");
});

// the sign-in posts, read before anyone is signed in, take at most
// SMALL bytes: a bigger one (said, or streamed without saying) is 413,
// never parsed
test("sign-in posts over SMALL bytes are refused unread", async () => {
  const cloud = cloud_new();
  const big = JSON.stringify({ who: "a@x.com", pad: "x".repeat(Cloud.SMALL) });
  const said = (p: string, body: string) => Cloud.http(cloud, new Request("http://127.0.0.1" + p, { method: "POST", body }));
  const streamed = (p: string, body: string) => Cloud.http(cloud, new Request("http://127.0.0.1" + p, { method: "POST", body: new Blob([body]).stream() }));
  for (const p of ["/api/login", "/auth"]) {
    expect((await said(p, big))?.status).toBe(413);
    expect((await streamed(p, big))?.status).toBe(413);
  }
  // one that says it's bigger is refused before a byte is read (this
  // one's body never ends)
  const endless = new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode("{")) });
  const lying = new Request("http://127.0.0.1/api/login", { method: "POST", headers: { "content-length": String(Cloud.SMALL + 1) }, body: endless });
  expect((await Promise.race([Cloud.http(cloud, lying), Bun.sleep(500).then(() => null)]))?.status).toBe(413);
  expect((await said("/api/login", JSON.stringify({ who: "a@x.com" })))?.status).toBe(200);
  expect((await streamed("/api/login", JSON.stringify({ who: "b@x.com" })))?.status).toBe(200);
});

// RED ZONE (security review SC, DRAFT awaiting the user's sign-off): the
// client's address behind a proxy (LEGION_PROXY=1) is the X-Forwarded-For
// entry it appended (the last), never one the client wrote; none, or no
// proxy (off, the default: the client may write the header), the socket's
test("Cloud.ip: behind a proxy its entry, else the socket's address", () => {
  const req = (xff: string | null) => new Request("http://127.0.0.1/", { headers: xff === null ? {} : { "x-forwarded-for": xff } });
  expect(config.PROXY).toBe(false);
  expect(Cloud.ip(req("6.6.6.6, 1.2.3.4"), "127.0.0.1")).toBe("127.0.0.1");
  expect(Cloud.ip(req("1.2.3.4"))).toBeNull();
  expect(Cloud.ip(req("6.6.6.6, 1.2.3.4"), null, true)).toBe("1.2.3.4");
  expect(Cloud.ip(req(" 1.2.3.4 "), null, true)).toBe("1.2.3.4");
  expect(Cloud.ip(req(null), "127.0.0.1", true)).toBe("127.0.0.1");
  expect(Cloud.ip(req(" "), "127.0.0.1", true)).toBe("127.0.0.1");
  expect(Cloud.ip(req(null), null, true)).toBeNull();
  expect(Cloud.ip(req("6.6.6.6, 1.2.3.4"), "127.0.0.1", true)).toBe("1.2.3.4");
});

// `legion web`: a terminal's Bearer session mints a ticket for its own
// account, good once for 60 s, which /auth swaps for a browser cookie.
// The cookie alone can't mint one (a page can't widen its own sign-in,
// nor a cross-site request ride it), nor can anyone signed out; the
// session it makes is the minting user's, never another's.
test("/api/web-link: Bearer only, once, briefly, for the same user", async () => {
  const cloud = cloud_new();
  const me = Cloud.session(cloud, { id: "u1", name: "me@x.com" });
  Cloud.session(cloud, { id: "u2", name: "other@x.com" });
  const mint = (headers: Record<string, string>) => Cloud.http(cloud, new Request("http://127.0.0.1/api/web-link", { method: "POST", headers }));
  expect((await mint({}))?.status).toBe(401);
  expect((await mint({ authorization: "Bearer " + Cloud.random() }))?.status).toBe(401);
  expect((await mint({ cookie: "legion=" + me }))?.status).toBe(401);
  expect((await Cloud.http(cloud, new Request("http://127.0.0.1/api/web-link", { headers: { authorization: "Bearer " + me } })))?.status).toBe(405);
  const res = await mint({ authorization: "Bearer " + me });
  expect(res?.status).toBe(200);
  const { url } = (await res?.json()) as { url: string };
  expect(url).toStartWith(config.SITE + "/auth?t=");
  const open = () => Cloud.http(cloud, new Request(url));
  const first = await open();
  expect(first?.status).toBe(302);
  expect(first?.headers.get("location")).toBe(config.SITE + "/");
  const cookie = first?.headers.get("set-cookie") ?? "";
  const token = /^legion=([^;]+)/.exec(cookie)?.[1] ?? "";
  expect(token).not.toBe("");
  expect(token).not.toBe(me);
  const browser = Cloud.who(cloud, new Request("http://127.0.0.1/", { headers: { cookie: "legion=" + token } }));
  expect(browser).toEqual({ id: "u1", name: "me@x.com" });
  // used up
  const again = await open();
  expect(again?.headers.get("set-cookie") ?? "").toBe("");
  expect(again?.headers.get("location")).toContain("expired=1");
  // expired
  const late = (await (await mint({ authorization: "Bearer " + me }))?.json()) as { url: string };
  cloud.db.query("update tickets set expires = ?").run(Date.now() - 1);
  const stale = await Cloud.http(cloud, new Request(late.url));
  expect(stale?.headers.get("set-cookie") ?? "").toBe("");
  // it lasts no more than a minute, and isn't counted as a mailed link
  for (let k = 0; k < 3; k++) {
    await mint({ authorization: "Bearer " + me });
  }
  const row = cloud.db.query("select expires from tickets order by expires desc").get() as { expires: number };
  expect(row.expires - Date.now()).toBeLessThanOrEqual(60000);
  expect(Cloud.link_ask(cloud, "me@x.com", "9.9.9.9")).toBeNull();
});

// a browser session speaks for the user, so only what speaks for them
// mints one: the terminal's own key, not the device key (a file within
// an agent shell's reach)
test("/api/web-link: the terminal key mints one, the device key doesn't", async () => {
  const cloud = cloud_new();
  const user = { id: "u1", name: "me@x.com" };
  const device = Cloud.random();
  const terminal = Cloud.random();
  Cloud.login(cloud, user, Cloud.hash(device), 1);
  Cloud.login(cloud, user, Cloud.hash(terminal), 2);
  const mint = (key: string) => Cloud.http(cloud, new Request("http://127.0.0.1/api/web-link", { method: "POST", headers: { authorization: "Bearer " + key } }));
  expect((await mint(device))?.status).toBe(403);
  expect((await mint(terminal))?.status).toBe(200);
});

// a web ticket never reaches the code-confirm path, so it can't sign a
// terminal in either
test("a web ticket can't confirm a terminal", async () => {
  const cloud = cloud_new();
  const me = Cloud.session(cloud, { id: "u1", name: "me@x.com" });
  const res = await Cloud.http(cloud, new Request("http://127.0.0.1/api/web-link", { method: "POST", headers: { authorization: "Bearer " + me } }));
  const t = new URL(((await res?.json()) as { url: string }).url).searchParams.get("t") ?? "";
  const post = new Request("http://127.0.0.1/auth", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, code: "000000" }).toString() });
  const out = await Cloud.confirm(cloud, post);
  expect(out.headers.get("location")).toContain("expired=1");
});

// Phones (APNs pushes, push tokens, the iOS app's AASA) are off unless
// LEGION_PHONE=1: no route answers and nothing is stored or sent.
test("phone features are off by default", async () => {
  const cloud = cloud_new();
  expect(cloud.phone).toBe(false);
  const me = Cloud.session(cloud, { id: "u1", name: "me@x.com" });
  const token = "a".repeat(64);
  const push = () => Cloud.http(cloud, new Request("http://127.0.0.1/api/push", { method: "POST", headers: { authorization: "Bearer " + me }, body: token }));
  const stored = () => cloud.db.query("select count(*) n from pushes").get() as { n: number };
  expect(await push()).toBeNull();
  expect(stored().n).toBe(0);
  expect(await Cloud.http(cloud, new Request("http://127.0.0.1/.well-known/apple-app-site-association"))).toBeNull();
  cloud.phone = true;
  expect((await push())?.status).toBe(200);
  expect(stored().n).toBe(1);
});

// RED ZONE (S1a, S1b, security review 4 F1, signed off by the user 2026-11-25): a local Legion (no mail key) prints no link: the terminal
// that asked gets its ticket and confirms with code and the sign-in
// secret. No request registers one (register=1 is refused, none made):
// the user's own `legion login` writes its hash to signin-hash itself;
// then only that secret signs in; a missing or wrong one is refused and
// uses the link up. A browser's sign-in there is refused (legion web),
// and nothing is printed
test("a local Legion's sign-in needs the sign-in secret: never registered over HTTP, then required; no link printed", async () => {
  const cloud = cloud_new(true);
  const said: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a: any[]) => said.push(a.join(" "));
  console.error = (...a: any[]) => said.push(a.join(" "));
  try {
    const ask = async (body: object) => (await Cloud.http(cloud, new Request("http://127.0.0.1/api/login", { method: "POST", body: JSON.stringify(body) })))!;
    const begin = async () => {
      const key = Cloud.random();
      const term = Cloud.random();
      const res = await ask({ who: "me@x.com", key, term });
      expect(res.status).toBe(200);
      return { key, term, ...(await res.json()) as { t: string; code: string; secret: boolean } };
    };
    const confirm = (t: string, code: string, more: Record<string, string>) => Cloud.confirm(cloud, new Request("http://127.0.0.1/auth", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, code, ...more }).toString() }));
    const live = (token: string) => Cloud.live(cloud, Cloud.hash(token)) !== null;
    // a browser's (no key): refused, no ticket
    const browser = await ask({ who: "me@x.com" });
    expect(browser.status).toBe(400);
    expect(((await browser.json()) as { error: string }).error).toContain("legion login");
    expect(cloud.db.query("select count(*) n from tickets").get()).toEqual({ n: 0 });
    // none registered yet: without one, refused, the link used up
    const a = await begin();
    expect(a.secret).toBe(false);
    expect(a.code).toBe(Cloud.code(Cloud.hash(a.key)));
    expect((await confirm(a.t, a.code, {})).status).toBe(403);
    expect(live(a.key)).toBe(false);
    expect((await confirm(a.t, a.code, { secret: Cloud.random(), register: "1" })).headers.get("location")).toContain("expired=1");
    // a well-formed secret, none registered: refused; a weak one never
    // registers
    for (const more of [{ secret: Cloud.random() }, { secret: "short", register: "1" }]) {
      const n = await begin();
      expect((await confirm(n.t, n.code, more)).status).toBe(403);
      expect(live(n.key)).toBe(false);
    }
    expect(fs.existsSync(config.DIR + "/signin-hash")).toBe(false);
    // F1: a well-formed secret with register=1 (what an agent on the
    // socket would send first): refused, nothing registered, its keys
    // signed in nowhere, the link used up
    const secret = Cloud.random();
    const b = await begin();
    expect((await confirm(b.t, b.code, { secret, register: "1" })).status).toBe(403);
    expect(live(b.key)).toBe(false);
    expect(live(b.term)).toBe(false);
    expect(fs.existsSync(config.DIR + "/signin-hash")).toBe(false);
    expect((await confirm(b.t, b.code, { secret })).headers.get("location")).toContain("expired=1");
    // the user's `legion login` writes the hash itself (Term.ts
    // login_local): then that secret signs in, both keys
    const file = config.DIR + "/signin-hash";
    fs.writeFileSync(file, Cloud.hash(secret) + "\n", { flag: "wx", mode: 0o600 });
    const r = await begin();
    expect(r.secret).toBe(true);
    expect((await confirm(r.t, r.code, { secret })).status).toBe(200);
    expect(live(r.key)).toBe(true);
    expect(live(r.term)).toBe(true);
    // once one is: register=1 is refused, even with the right secret, and
    // so are no secret, a wrong one, and a right one after the link was
    // used up; the hash stays as it was
    for (const more of [{ secret: Cloud.random(), register: "1" }, { secret, register: "1" }]) {
      const c = await begin();
      expect((await confirm(c.t, c.code, more)).status).toBe(403);
      expect(live(c.key)).toBe(false);
    }
    expect(fs.readFileSync(file, "utf8").trim()).toBe(Cloud.hash(secret));
    for (const more of [{}, { secret: Cloud.random() }, { secret: "short" }] as Record<string, string>[]) {
      const d = await begin();
      expect((await confirm(d.t, d.code, more)).status).toBe(403);
      expect((await confirm(d.t, d.code, { secret })).headers.get("location")).toContain("expired=1");
      expect(live(d.key)).toBe(false);
    }
    // the right one, with the code: signed in
    const e = await begin();
    expect((await confirm(e.t, e.code, { secret })).status).toBe(200);
    expect(live(e.key)).toBe(true);
    expect(Cloud.speaks(cloud, new Request("http://127.0.0.1/", { headers: { authorization: "Bearer " + e.term } }))).toBe(true);
    // an emailed link's ticket (one from before, or forged) signs no
    // browser in there
    const mailed = Cloud.ticket(cloud, { who: "me@x.com", session: null }, 60000);
    const pressed = await Cloud.http(cloud, new Request("http://127.0.0.1/auth", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t: mailed }).toString() }));
    expect(pressed?.headers.get("set-cookie") ?? "").toBe("");
    // nothing printed, no link, no ticket
    expect(said).toEqual([]);
  } finally {
    console.log = log;
    console.error = err;
  }
});

// a server with a mail key mails the link (cloud.post), as before: no
// ticket in the answer, no sign-in secret asked
test("a server that mails: the link goes by mail, never in the answer", async () => {
  const cloud = cloud_new();
  const mails: any[] = [];
  cloud.post = async (m: object) => (mails.push(m), null);
  const key = Cloud.random();
  const res = await Cloud.http(cloud, new Request("http://127.0.0.1/api/login", { method: "POST", body: JSON.stringify({ who: "m@x.com", key }) }));
  const out = (await res!.json()) as Record<string, unknown>;
  expect(out.t).toBeUndefined();
  expect(mails).toHaveLength(1);
  expect(mails[0].text).toContain(config.SITE + "/auth?t=");
});
