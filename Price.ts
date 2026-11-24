// Price
// =====
// What a call costs, in micro-USD: its usage, as its vendor tells it, at
// its model's RATES (the catalog's list prices, USD per million tokens;
// LONG past a long prompt) times SPEEDS, plus web searches; a recording, at
// MINUTES. A request's payer books it (AskAI.ts Bill; Billing.ts), and
// an import's estimate is priced by it.

import { CATALOG, type Rate } from "./Models.ts";

// Types
// =====

export type Usage = Rate & { searches: number; seconds: number; speed: string };

// Constants
// =========

// USD per web search (Anthropic and OpenAI: $10 per 1,000)
const SEARCH = 0.01;

// each model's list rates by its id, and LONG's for its models with
// one: the catalog's (Models.ts, local/models.json)
const ENTRIES = Object.values(CATALOG).flat();

const RATES: Record<string, Rate> = Object.fromEntries(ENTRIES.map((m) => [m.id, m.rate]));

// a prompt (its input, cache writes and reads) over PROMPT tokens costs a
// model with `long` rates those, for all its tokens (Anthropic prices
// Haiku 5.5 so)
const PROMPT = 100000;

const LONG: Record<string, Rate> = Object.fromEntries(ENTRIES.flatMap((m) => (m.long === undefined ? [] : [[m.id, m.long]])));

const MINUTES: Record<string, number> = {
  "gpt-transcribe" : 0.0045,
};

const SPEEDS: Record<string, number> = { slow: 1, fast: 2, ultrafast: 6 };

// Price
// =====

export namespace Price {

  export function usage(speed: string): Usage {
    return { input: 0, write: 0, read: 0, output: 0, searches: 0, seconds: 0, speed };
  }

  // a model's list rates (by its id; undefined: none), a speed's factor
  export function rate(model: string): Rate | undefined {
    return RATES[model];
  }

  export function times(speed: string): number {
    return SPEEDS[speed] ?? 1;
  }

  export function cost(model: string, use: Usage): number {
    const long   = use.input + use.write + use.read > PROMPT ? LONG[model] : undefined;
    const rate   = long ?? RATES[model];
    const minute = MINUTES[model];
    if (rate === undefined && minute === undefined) {
      throw new Error("no price for " + model);
    }
    const tokens = rate === undefined ? 0 : use.input * rate.input + use.write * rate.write + use.read * rate.read + use.output * rate.output;
    const audio  = minute === undefined ? 0 : (use.seconds / 60) * minute * 1e6;
    return Math.ceil(tokens * Price.times(use.speed) + use.searches * SEARCH * 1e6 + audio);
  }

}
