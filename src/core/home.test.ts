import { describe, expect, it } from 'vitest';
import { DEMOS } from './demos';
import { accountOrder, HOME_CARDS, homeOrder, homeRow, roleWords, rungOf } from './home';
import { isId } from './rows';
import { id } from './fixture';
import type { Row } from './types';

const map = (n: number, name: string, extra: Partial<Row> = {}): Row => ({ id: id(n), type: 'map', name, ...extra });

describe('a world’s row on the home', () => {
  it('puts the top maps first, then by hierarchy, then by name', () => {
    const island = map(1, 'Island', { hierarchy: 0, image_url: 'https://media.example/i.webp' });
    const layout = map(2, 'Island: layout', { x_layout: { method: 'trail', settings: {} } });
    const rows = [
      map(10, 'Map of Abakainon', { parent_map: id(1), hierarchy: 1, image_url: 'https://media.example/a.webp' }),
      map(11, 'Harbour', { parent_map: { id: id(1) }, hierarchy: 2 }),
      layout,
      map(12, 'Lost child', { parent_map: id(99) }),
      island,
      map(13, 'Map of Abolla', { parent_map: id(1), hierarchy: 1 }),
    ];
    // A parent this reader is not served makes a top map too.
    expect(homeOrder(rows).map((m) => m.name)).toEqual(['Island', 'Island: layout', 'Lost child', 'Map of Abakainon', 'Map of Abolla', 'Harbour']);
    const r = homeRow(rows, 3);
    expect(r.total).toBe(6);
    expect(r.cards.map((c) => [c.name, c.kind, c.words])).toEqual([
      ['Island', 'picture', 'a picture'],
      ['Island: layout', 'layout', 'a layout'],
      ['Lost child', 'plan', 'a plan'],
    ]);
  });

  it('shows at most the fixed number of cards, and counts every map', () => {
    const many = Array.from({ length: 214 }, (_, i) => map(100 + i, `Map ${i}`));
    const r = homeRow(many);
    expect(r.cards).toHaveLength(HOME_CARDS);
    expect(r.total).toBe(214);
    expect(homeRow([]).total).toBe(0);
  });

  it('a row with no id is no card', () => {
    expect(homeRow([{ id: 'x', name: 'bad' } as Row, map(1, 'good')]).cards.map((c) => c.name)).toEqual(['good']);
  });
});

describe('a world on the account’s list', () => {
  it('says what it is to the person, and reads by the list’s role, never /me', () => {
    expect(roleWords({ role: 'owner' })).toBe('yours');
    expect(roleWords({ role: 'collaborator', member_role: 'contributor' })).toBe('a member (contributor)');
    expect(roleWords({ role: 'collaborator', member_role: 'co_builder' })).toBe('a member (co-builder)');
    expect(roleWords({ role: 'collaborator' })).toBe('a member');
    expect(rungOf({ role: 'owner' })).toBe('owner');
    expect(rungOf({ role: 'collaborator' })).toBe('guest');
  });

  it('orders owned first, then joined, each A to Z', () => {
    const w = (n: number, name: string, role: 'owner' | 'collaborator') => ({ id: id(n), name, role });
    expect(accountOrder([w(1, 'beta', 'collaborator'), w(2, 'Zed', 'owner'), w(3, 'alpha', 'collaborator'), w(4, 'Alpha', 'owner')]).map((x) => x.name)).toEqual(['Alpha', 'Zed', 'alpha', 'beta']);
  });
});

describe('the demo worlds built into the page', () => {
  it('are three public worlds, each with its cards in the home’s shape', () => {
    expect(DEMOS.map((d) => d.name.split(':')[0])).toEqual(['Moppetopia', 'Sikelia', 'Blood Meridian']);
    for (const d of DEMOS) {
      expect(isId(d.id)).toBe(true);
      expect(d.cards.length).toBeGreaterThan(0);
      expect(d.cards.length).toBeLessThanOrEqual(HOME_CARDS);
      expect(d.total).toBeGreaterThanOrEqual(d.cards.length);
      for (const c of d.cards) expect(isId(c.id) && ['picture', 'plan', 'layout', 'layout3d'].includes(c.kind)).toBe(true);
    }
    expect(DEMOS[1].total).toBe(214);
    expect(DEMOS[1].cards[0].name).toBe('Sikelia');
  });
});
