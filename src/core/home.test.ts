import { describe, expect, it } from 'vitest';
import { DEMOS } from './demos';
import { accountOrder, HOME_CARDS, homeOrder, homeRow, roleWords, rungOf, smallPicture } from './home';
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

  it('a picture card carries its picture; a layout or plan card none, even with an image_url', () => {
    const rows = [
      map(1, 'A', { hierarchy: 0, image_url: 'https://media.onlyworlds.com/w/a.webp' }),
      map(2, 'B', { hierarchy: 1, image_url: 'https://media.onlyworlds.com/w/b.webp', x_layout: { method: 'trail', settings: {} } }),
      map(3, 'C', { hierarchy: 2, image_url: 'http://media.onlyworlds.com/w/c.webp' }),
    ];
    expect(homeRow(rows).cards.map((c) => [c.kind, c.picture])).toEqual([
      ['picture', 'https://media.onlyworlds.com/w/a.webp'],
      ['layout', null],
      ['plan', null],
    ]);
  });

  it('a row with no id is no card', () => {
    expect(homeRow([{ id: 'x', name: 'bad' } as Row, map(1, 'good')]).cards.map((c) => c.name)).toEqual(['good']);
  });
});

describe('a picture’s small copy', () => {
  const S = 'https://media.onlyworlds.com/cdn-cgi/image/width=480,format=auto';
  it('is the media host’s one width of the same path', () => {
    expect(smallPicture('https://media.onlyworlds.com/worlds/sikelia/maps/lipara-base-clear-c417777c.png')).toBe(`${S}/worlds/sikelia/maps/lipara-base-clear-c417777c.png`);
    expect(smallPicture('https://MEDIA.onlyworlds.com/a%20b.webp')).toBe(`${S}/a%20b.webp`);
    expect(smallPicture('https://media.onlyworlds.com/a b.webp')).toBe(`${S}/a%20b.webp`);
    expect(smallPicture('https://media.onlyworlds.com:443/a.webp')).toBe(`${S}/a.webp`);
  });
  it('is never made for another host, a query, a fragment, credentials, a port or a path already under /cdn-cgi/', () => {
    for (const u of [
      null,
      undefined,
      '',
      'not a url',
      'http://media.onlyworlds.com/a.webp',
      'https://media.example/a.webp',
      'https://media.onlyworlds.com.evil.example/a.webp',
      'https://evil.example/https://media.onlyworlds.com/a.webp',
      'https://media.onlyworlds.com/a.webp?width=4000',
      'https://media.onlyworlds.com/a.webp?',
      'https://media.onlyworlds.com/a.webp#x',
      'https://media.onlyworlds.com/a.webp#',
      'https://u:p@media.onlyworlds.com/a.webp',
      'https://u@media.onlyworlds.com/a.webp',
      'https://media.onlyworlds.com:8443/a.webp',
      'https://media.onlyworlds.com/',
      'https://media.onlyworlds.com',
      'https://media.onlyworlds.com/cdn-cgi/image/width=4000/a.webp',
      'https://media.onlyworlds.com/CDN-CGI/image/width=4000/a.webp',
      'https://media.onlyworlds.com/x/../cdn-cgi/image/width=4000/a.webp',
      'https://media.onlyworlds.com/x/%2e%2e/cdn-cgi/image/width=4000/a.webp',
      'https://media.onlyworlds.com/%63dn-cgi/image/width=4000/a.webp',
      'https://media.onlyworlds.com/%43DN-cgi/image/width=4000/a.webp',
      'https://media.onlyworlds.com//cdn-cgi/image/width=4000/a.webp',
      'https://media.onlyworlds.com/%2Fcdn-cgi/image/width=4000/a.webp',
      'https://media.onlyworlds.com/%E0%A4%A.webp',
    ]) expect(smallPicture(u), String(u)).toBeNull();
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
      for (const c of d.cards) {
        expect(isId(c.id) && ['picture', 'plan', 'layout', 'layout3d'].includes(c.kind)).toBe(true);
        // Every demo picture card has its small copy; no other card carries a picture.
        expect(c.kind === 'picture' ? smallPicture(c.picture) !== null : c.picture === null, c.name).toBe(true);
      }
    }
    expect(DEMOS[1].total).toBe(214);
    expect(DEMOS[1].cards[0].name).toBe('Sikelia');
  });
});
