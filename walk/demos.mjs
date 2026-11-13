// Write the home's built-in list of public demo worlds (src/core/demos.ts): each world's name, how
// many maps it has, and the cards its row shows, in the home's own order (src/core/home.ts, loaded
// through Vite so the order has one home). A stranger's home then reads nothing from OnlyWorlds; a
// press on a card reads the world live. Run by hand when a demo world's maps change:
//   node walk/demos.mjs
// One keyless read of each world and one of its Maps list (a page of 1,000; none has more), one at
// a time. Nothing is written to OnlyWorlds.
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const BASE = 'https://www.onlyworlds.com/api/v2';
const WORLDS = [
  { id: '0695db52-5433-7332-8000-db7fe10da375', words: 'a small demo world' },
  { id: '49501a68-179b-4a3c-8eaf-7f46f73d5fd2', words: 'a large one, an island of city plans' },
  { id: '721d154b-43f3-4cc1-b7b4-7ea2b83c401e', words: "a novel's route, mapped" },
];

const read = async (url) => {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} on ${url}`);
  return r.json();
};

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { homeRow } = await vite.ssrLoadModule('/src/core/home.ts');
  const out = [];
  for (const w of WORLDS) {
    const meta = await read(`${BASE}/world/?world=${w.id}`);
    const page = await read(`${BASE}/map/?world=${w.id}&limit=1000`);
    if (page.has_more) throw new Error(`${meta.name} has more than 1,000 maps: read every page`);
    const row = homeRow(page.data);
    out.push({ id: w.id, name: meta.name, words: w.words, total: row.total, cards: row.cards });
    console.log(`${meta.name}: ${row.total} maps, cards ${row.cards.map((c) => c.name).join(' | ')}`);
  }
  const body = `// Written by walk/demos.mjs from keyless reads of OnlyWorlds on ${new Date().toISOString().slice(0, 10)}: the public demo worlds
// the home shows a stranger, with the cards their rows show (the home's order, src/core/home.ts). A
// stranger's home reads nothing; a press on a card reads the world live. Run it again when a demo
// world's maps change.
import type { MapCard } from './home';

export interface DemoWorld {
  id: string;
  name: string;
  /** A few words after the name. */
  words: string;
  /** How many maps the world has. */
  total: number;
  cards: MapCard[];
}

export const DEMOS: readonly DemoWorld[] = ${JSON.stringify(out, null, 2).replace(/"([a-z]+)":/g, '$1:')};
`;
  writeFileSync('src/core/demos.ts', body);
} finally {
  await vite.close();
}
