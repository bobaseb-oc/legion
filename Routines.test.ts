// Routines test
// =============
// `bun test Routines.test.ts`. The cockpit's routines (Routines.ts): a
// task a native Legion agent is started on, daily at a time, every N
// hours, or for each new review request of the user's (Herdr's inbox
// automations); what a routine may say (checked), when it's next due, how
// the terminal's /routine add reads one.

import { expect, test } from "bun:test";
import * as Routines from "./Routines.ts";

const at = (h: number, m = 0, day = 12) => new Date(2026, 10, day, h, m).getTime();
const routine = (when: Routines.When, over: Partial<Routines.Routine> = {}): Routines.Routine =>
  ({ id: 1, name: "R", task: "do it", when, tier: "worker", on: true, last: null, made: at(8), ...over });

test("a routine's check: a name, a task, a when, a tier; text cut; bad ones refused", () => {
  expect(Routines.routine_check({ name: " Morning ", task: "Triage", when: { $: "daily", at: "09:30" }, tier: "manager" })).toEqual({ name: "Morning", task: "Triage", when: { $: "daily", at: "09:30" }, tier: "manager" });
  expect(Routines.routine_check({ name: "n", task: "t", when: { $: "every", hours: 4 } })).toMatchObject({ tier: "worker" });
  expect(Routines.routine_check({ name: "n", task: "", when: { $: "review" } })).toMatchObject({ task: "" }); // a review routine's task is the review
  expect((Routines.routine_check({ name: "n".repeat(500), task: "t".repeat(9000), when: { $: "every", hours: 1 } }) as any).name.length).toBe(Routines.NAME);
  for (const bad of [
    { name: "", task: "t", when: { $: "every", hours: 1 } }, { name: "n", task: "", when: { $: "every", hours: 1 } },
    { name: "n", task: "t", when: { $: "daily", at: "25:00" } }, { name: "n", task: "t", when: { $: "every", hours: 0 } },
    { name: "n", task: "t", when: { $: "every", hours: 1000 } }, { name: "n", task: "t", when: { $: "cron" } }, { name: "n", task: "t", when: { $: "every", hours: 1 }, tier: "god" }, null,
  ]) {
    expect(typeof Routines.routine_check(bad)).toBe("string");
  }
});

test("daily at a time: due once its time passed today and it hasn't run since; made after it, tomorrow", () => {
  const r = routine({ $: "daily", at: "09:00" });
  expect(Routines.routine_next(r, at(8, 30))).toBe(at(9));
  expect(Routines.routine_due(r, at(8, 59))).toBe(false);
  expect(Routines.routine_due(r, at(9, 1))).toBe(true);
  expect(Routines.routine_due({ ...r, last: at(9, 1) }, at(15))).toBe(false);
  expect(Routines.routine_next({ ...r, last: at(9, 1) }, at(15))).toBe(at(9, 0, 13));
  expect(Routines.routine_due({ ...r, made: at(10) }, at(15))).toBe(false); // made after today's: tomorrow
  expect(Routines.routine_due({ ...r, on: false }, at(9, 1))).toBe(false);
});

test("every N hours: due N hours after it last ran (or was made); on a review request: never by the clock", () => {
  const r = routine({ $: "every", hours: 4 });
  expect(Routines.routine_next(r, at(9))).toBe(at(12));
  expect(Routines.routine_due(r, at(11, 59))).toBe(false);
  expect(Routines.routine_due(r, at(12))).toBe(true);
  expect(Routines.routine_due({ ...r, last: at(12) }, at(15))).toBe(false);
  const review = routine({ $: "review" });
  expect(Routines.routine_next(review, at(9))).toBe(null);
  expect(Routines.routine_due(review, at(23))).toBe(false);
});

test("how a when reads", () => {
  expect(Routines.when_text({ $: "daily", at: "09:00" })).toBe("daily at 09:00");
  expect(Routines.when_text({ $: "every", hours: 1 })).toBe("every hour");
  expect(Routines.when_text({ $: "every", hours: 6 })).toBe("every 6 hours");
  expect(Routines.when_text({ $: "review" })).toBe("on each new review request");
});

test("the terminal's /routine add: daily HH:MM, every Nh, on review; then the name, a colon, the task", () => {
  expect(Routines.routine_parse("daily 09:00 Morning triage: look at the inbox")).toEqual({ name: "Morning triage", task: "look at the inbox", when: { $: "daily", at: "09:00" }, tier: "worker" });
  expect(Routines.routine_parse("every 4h Sweep: clean the worktrees")).toMatchObject({ when: { $: "every", hours: 4 } });
  expect(Routines.routine_parse("on review Reviews")).toMatchObject({ name: "Reviews", task: "", when: { $: "review" } });
  expect(Routines.routine_parse("manager daily 08:00 Plan: plan the day")).toMatchObject({ tier: "manager" });
  expect(typeof Routines.routine_parse("weekly Mon x: y")).toBe("string");
  expect(typeof Routines.routine_parse("daily 09:00 no colon here")).toBe("string");
});

// in the views: the Routine act as sent; the terminal's /routines and
// /routine; the web's page (Pages.routines_html)
test("views: the act sent, the terminal's commands and list, the web's page and counts", async () => {
  const View = await import("./View.ts");
  const Pages = await import("./web/src/Pages.ts");
  const Cockpit = await import("./Cockpit.ts");
  const v = View.view_new();
  const given = { name: "Sweep", task: "clean", when: { $: "every", hours: 4 } as Routines.When, tier: "worker" as const };
  expect(View.view_act(v, { $: "Routine", op: "add", routine: given })).toEqual([{ $: "routine", op: "add", routine: given }]);
  expect(View.view_act(v, { $: "Routine", op: "toggle", n: 2, on: false })).toEqual([{ $: "routine", op: "toggle", n: 2, on: false }]);
  expect(View.view_routines_note(v)).toBe("No routines. Add one: /routine add daily 09:00 Name: task (or every 4h, or on review).");
  v.routines = [routine({ $: "every", hours: 4 }, { id: 3, name: "Sweep <x>", last: at(8) }), routine({ $: "review" }, { id: 4, name: "Reviews", on: false })];
  expect(View.view_routines_note(v)).toContain("3. Sweep <x> · every 4 hours · worker · on");
  expect(View.view_routines_note(v)).toContain("4. Reviews · on each new review request · worker · off");
  expect(View.view_routine_cmd(v, "add every 4h Sweep: clean")).toEqual({ $: "Routine", op: "add", routine: given });
  expect(View.view_routine_cmd(v, "run 3")).toEqual({ $: "Routine", op: "run", n: 3 });
  expect(View.view_routine_cmd(v, "off 3")).toEqual({ $: "Routine", op: "toggle", n: 3, on: false });
  expect(View.view_routine_cmd(v, "on 4")).toEqual({ $: "Routine", op: "toggle", n: 4, on: true });
  expect(View.view_routine_cmd(v, "drop 3")).toEqual({ $: "Routine", op: "drop", n: 3 });
  expect(typeof View.view_routine_cmd(v, "run 9")).toBe("string");
  expect(typeof View.view_routine_cmd(v, "explode 3")).toBe("string");
  const html = Pages.routines_html(v, at(9)).join("");
  expect(html).toContain("Sweep &lt;x&gt;");
  expect(html).toContain("every 4 hours");
  expect(html).toContain(JSON.stringify({ $: "Routine", op: "run", n: 3 }).replace(/"/g, "&quot;"));
  expect(html).not.toContain(JSON.stringify({ $: "Routine", op: "run", n: 4 }).replace(/"/g, "&quot;")); // a review routine isn't run by hand
  expect(html).toContain(JSON.stringify({ $: "Routine", op: "toggle", n: 4, on: true }).replace(/"/g, "&quot;"));
  expect(html).toContain('<form class="radd">');
  expect(Cockpit.home_apps(v).routines).toBe("1 scheduled");
});

// weekly on a day at a time (0 Sunday … 6 Saturday, as Date.getDay): due
// once that day's time passed this week and it hasn't run since
test("weekly on a day at a time: due on that day once its time passed, then a week on", () => {
  expect(Routines.routine_check({ name: "n", task: "t", when: { $: "weekly", day: 5, at: "09:00" } })).toMatchObject({ when: { $: "weekly", day: 5, at: "09:00" } });
  for (const bad of [{ $: "weekly", day: 7, at: "09:00" }, { $: "weekly", day: 1.5, at: "09:00" }, { $: "weekly", day: 5, at: "9am" }]) {
    expect(typeof Routines.routine_check({ name: "n", task: "t", when: bad as any })).toBe("string");
  }
  const r = { ...routine({ $: "weekly", day: 5, at: "09:00" }), made: at(9, 0, 11) }; // made Wednesday
  expect(Routines.routine_next(r, at(15))).toBe(at(9, 0, 13)); // Thursday: Friday's
  expect(Routines.routine_due(r, at(15))).toBe(false);
  expect(Routines.routine_due(r, at(8, 59, 13))).toBe(false);
  expect(Routines.routine_due(r, at(9, 1, 13))).toBe(true);
  expect(Routines.routine_next({ ...r, last: at(9, 1, 13) }, at(12, 0, 13))).toBe(at(9, 0, 20));
  expect(Routines.routine_due({ ...r, last: at(9, 1, 13) }, at(9, 0, 17))).toBe(false); // Tuesday after
  expect(Routines.routine_due({ ...r, made: at(10, 0, 13) }, at(11, 0, 13))).toBe(false); // made after Friday's: next week
  expect(Routines.when_text({ $: "weekly", day: 5, at: "09:00" })).toBe("Fridays at 09:00");
  expect(Routines.routine_parse("weekly fri 09:00 Timesheet: draft the week")).toEqual({ name: "Timesheet", task: "draft the week", when: { $: "weekly", day: 5, at: "09:00" }, tier: "worker" });
  expect(Routines.routine_parse("weekly Mon 08:30 Plan: plan the week")).toMatchObject({ when: { $: "weekly", day: 1, at: "08:30" } });
  expect(typeof Routines.routine_parse("weekly funday 09:00 X: y")).toBe("string");
});

// the Mac asleep through several of its times (or the server down): on
// waking, a routine runs once, not once per slot missed, then at its next
test("missed while asleep: due once on waking, not once per slot missed", () => {
  const daily = routine({ $: "daily", at: "09:00" }, { last: at(9, 1, 9) }); // ran Monday, asleep till Thursday 15:00
  expect(Routines.routine_due(daily, at(15))).toBe(true);
  expect(Routines.routine_due({ ...daily, last: at(15) }, at(15, 1))).toBe(false);
  expect(Routines.routine_next({ ...daily, last: at(15) }, at(15, 1))).toBe(at(9, 0, 13));
  const every = routine({ $: "every", hours: 2 }, { last: at(8, 0, 11) }); // 14 slots missed
  expect(Routines.routine_due(every, at(15))).toBe(true);
  expect(Routines.routine_due({ ...every, last: at(15) }, at(16, 59))).toBe(false);
  const weekly = routine({ $: "weekly", day: 5, at: "09:00" }, { made: at(8, 0, 1), last: at(9, 1, 6) }); // three Fridays slept through
  expect(Routines.routine_due(weekly, at(10, 0, 27))).toBe(true);
  expect(Routines.routine_due({ ...weekly, last: at(10, 0, 27) }, at(11, 0, 27))).toBe(false);
});

// whether a chat's routines need it kept open with no view (Server.ts
// Chat.free, Chat.wake): one on, by the clock; a review routine runs on
// an inbox, which only a connected device sends
test("timed: a routine on, by the clock, keeps its chat open; off or on review, not", () => {
  expect(Routines.timed([routine({ $: "daily", at: "09:00" })])).toBe(true);
  expect(Routines.timed([routine({ $: "every", hours: 3 }, { on: false }), routine({ $: "weekly", day: 5, at: "09:00" })])).toBe(true);
  expect(Routines.timed([routine({ $: "daily", at: "09:00" }, { on: false })])).toBe(false);
  expect(Routines.timed([routine({ $: "review" })])).toBe(false);
  expect(Routines.timed([])).toBe(false);
});

// agents' timers (the timer tool, user's ask 2026-11-18): a note that
// wakes whoever set it, 1 minute to a day on; kept with the chat, so a
// pending one keeps it open as a routine on by the clock does
const timer = (over: Partial<Routines.Timer> = {}): Routines.Timer => ({ id: 1, who: "main", at: at(9), note: "check CI", made: at(8), ...over });

test("a timer's check: whole minutes, 1 to a day; a note, trimmed and cut; bad ones refused", () => {
  expect(Routines.timer_check({ minutes: 5, note: "  check  CI \n now " })).toEqual({ minutes: 5, note: "check CI now" });
  expect((Routines.timer_check({ minutes: 1, note: "n".repeat(9000) }) as any).note.length).toBe(Routines.TIMER_NOTE);
  expect(Routines.timer_check({ minutes: Routines.TIMER_MINUTES, note: "x" })).toMatchObject({ minutes: Routines.TIMER_MINUTES });
  for (const bad of [{ minutes: 0, note: "x" }, { minutes: Routines.TIMER_MINUTES + 1, note: "x" }, { minutes: 1.5, note: "x" }, { minutes: "5", note: "x" }, { minutes: 5, note: "  " }, { minutes: 5 }, null]) {
    expect(typeof Routines.timer_check(bad)).toBe("string");
  }
});

test("timers due: those whose time came, in order", () => {
  const list = [timer({ id: 2, at: at(10) }), timer({ id: 1, at: at(9) }), timer({ id: 3, at: at(11) })];
  expect(Routines.timers_due(list, at(8)).map((t) => t.id)).toEqual([]);
  expect(Routines.timers_due(list, at(10)).map((t) => t.id)).toEqual([1, 2]);
});

test("timed: a pending timer keeps its chat open, with no routine on", () => {
  expect(Routines.timed([], [timer()])).toBe(true);
  expect(Routines.timed([routine({ $: "review" })], [])).toBe(false);
});

// a routine an agent proposes (the routine tool, RED ZONE): added off,
// marked whose, so only the user's own Turn on starts it
test("a proposal: by the clock only, its why trimmed and cut", () => {
  expect(Routines.proposal_check({ name: "Standup", task: "Summarize PRs", when: { $: "daily", at: "09:00" }, why: "  you asked  daily " })).toEqual({ name: "Standup", task: "Summarize PRs", when: { $: "daily", at: "09:00" }, tier: "worker", why: "you asked daily" });
  expect((Routines.proposal_check({ name: "n", task: "t", when: { $: "every", hours: 2 }, why: "w".repeat(5000) }) as any).why.length).toBe(Routines.WHY);
  expect(typeof Routines.proposal_check({ name: "n", task: "t", when: { $: "review" }, why: "w" })).toBe("string");
  expect(typeof Routines.proposal_check({ name: "n", task: "t", when: { $: "daily", at: "09:00" }, why: " " })).toBe("string");
  expect(typeof Routines.proposal_check({ name: "", task: "t", when: { $: "daily", at: "09:00" }, why: "w" })).toBe("string");
});

test("pending: a proposal never turned on; one the user turned on, or the user's own, is not", () => {
  expect(Routines.pending(routine({ $: "daily", at: "09:00" }, { on: false, by: "main", why: "w" }))).toBe(true);
  expect(Routines.pending(routine({ $: "daily", at: "09:00" }, { on: false, by: "main", why: "w", last: at(9) }))).toBe(false);
  expect(Routines.pending(routine({ $: "daily", at: "09:00" }, { on: true, by: "main", why: "w" }))).toBe(false);
  expect(Routines.pending(routine({ $: "daily", at: "09:00" }, { on: false }))).toBe(false);
});

test("views: a proposal reads as proposed, its why shown (escaped), till the user turns it on", async () => {
  const View = await import("./View.ts");
  const Pages = await import("./web/src/Pages.ts");
  const v = View.view_new();
  const task = "post the <standup>\nthen push to main";
  v.routines = [routine({ $: "daily", at: "09:00" }, { id: 5, name: "Standup", task, on: false, by: "main", why: "you <asked>" }), routine({ $: "daily", at: "09:00" }, { id: 6, name: "Mine", task: "my task", on: false })];
  // the terminal: marked, the agent's name and why quoted as its words, the
  // whole task (each of its lines) over what turning it on approves
  expect(View.view_routines_note(v)).toBe([
    "Your routines:",
    "5. [proposed by Legion] “Standup” · daily at 09:00 · worker · off",
    "   Legion's words: “you <asked>”",
    "   The task:",
    "     post the <standup>",
    "     then push to main",
    "   /routine on 5 approves this task",
    "6. Mine · daily at 09:00 · worker · off",
    "/routine run|on|off|drop <n>; /routine add daily 09:00 | every 4h | on review, then name: task.",
  ].join("\n"));
  // as the terminal draws it (the routines page's lines): one row each
  const Deck = await import("./Deck.ts");
  const drawn = Deck.deck_lines(v, Deck.deck_new("routines"), 100, 40, at(9)).map((l) => l.map((r) => r.x).join(""));
  expect(drawn).toContain("   Legion's words: “you <asked>”");
  expect(drawn).toContain("     then push to main");
  // the web: the card marked (class and badge), the agent's words quoted,
  // the whole task beside Turn on, all escaped; the user's own plain
  const html = Pages.routines_html(v, at(9)).join("");
  const [mine, own] = html.split('<div class="routine').slice(1);
  expect(mine).toStartWith(' off proposed">');
  expect(mine).toContain('<span class="rbadge">Proposed by Legion</span>');
  expect(mine).toContain("<b>5. “Standup”</b>");
  expect(mine).toContain('<blockquote class="rwhy">Legion\'s words: “you &lt;asked&gt;”</blockquote>');
  expect(mine).toContain('<div class="rapprove"><p class="meta">Turn on approves this task:</p><p class="rtask">post the &lt;standup&gt;\nthen push to main</p><div class="acts">');
  expect(mine.indexOf("rapprove")).toBeLessThan(mine.indexOf("Turn on</button>"));
  expect(own).toStartWith(' off">');
  expect(own).toContain("<b>6. Mine</b>");
  expect(html.match(/Proposed by/g)?.length).toBe(1);
  expect(html).not.toContain("<standup>");
});

// security review R4 (RED ZONE: who may start unattended work): the user
// sees every pending timer (whose, when, its note) and closes any one
// from a view; the terminal's Routines page lists them too (the rows the
// deck draws) and says where to close them
test("views: pending timers, whose, when and note, each with a close (the web), listed on the terminal's Routines page", async () => {
  const View = await import("./View.ts");
  const Pages = await import("./web/src/Pages.ts");
  const Deck = await import("./Deck.ts");
  const v = View.view_new();
  expect(View.view_timers_note(v)).toBe("");
  expect(Pages.timers_html(v)).toEqual([]);
  const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
  v.timers = [{ id: 3, who: "main", at: at(14, 5), note: "check <CI>", made: at(13) }, { id: 4, who: "Wkr", at: at(15, 30), note: "poll the job", made: at(13) }];
  const note = View.view_timers_note(v);
  expect(note).toContain("3. Legion · at " + hhmm(at(14, 5)) + " · check <CI>");
  expect(note).toContain("4. Wkr · at " + hhmm(at(15, 30)) + " · poll the job");
  expect(note).toMatch(/Stop/);
  expect(View.view_act(v, { $: "Timer", n: 4 })).toEqual([{ $: "timer", n: 4 }]);
  expect(View.view_act(v, { $: "Timer", n: 9 })).toEqual([]);
  const html = Pages.timers_html(v).join("");
  expect(html).toContain("check &lt;CI&gt;");
  expect(html).toContain("Legion");
  expect(html).toContain("Wkr");
  expect(html).toContain(JSON.stringify({ $: "Timer", n: 3 }).replace(/"/g, "&quot;"));
  expect(html).toContain(JSON.stringify({ $: "Timer", n: 4 }).replace(/"/g, "&quot;"));
  const rows = Deck.deck_lines(v, Deck.deck_new("routines"), 100, 30, 0).map((l) => l.map((r) => r.x).join(""));
  expect(rows.some((l) => l.includes("3. Legion · at " + hhmm(at(14, 5)) + " · check <CI>"))).toBe(true);
  expect(rows.some((l) => l.includes("4. Wkr · at"))).toBe(true);
});
