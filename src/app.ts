// The page: the address decides what is shown, and a person's press or gesture is the only thing
// that writes it. Reads go one at a time through net/api.ts into the world store; each Map draws
// what has arrived as each read lands. A world is held by its reader and its id (the public, a
// pasted key, or the sign-in's account token), so one reading never stands in for another. Signed
// in, a world on the account's list is always read with the token, from any row or link; any other
// world is read as the public reads it.
import { detectKeyKind, ELEMENT_TYPES, type OwAccountWorld, type OwWorldMeta } from '@onlyworlds/sdk';
import { mountWaymark } from '@onlyworlds/sdk/waymark';
import { revokeToken, type SignedIn } from './auth/account';
import { beginSignIn, canSignIn, resumeFrom, signInCallbackLine, type SignInOutcome } from './auth/signin';
import { AddressWriter, type Address } from './core/address';
import { DEMOS } from './core/demos';
import { accountOrder, homeOrder, homeRow, roleWords, rungOf, type MapCard } from './core/home';
import { elementMapOrder, readMap, type MapReading } from './core/kinds';
import { elementTypeOf, isId, linkId, str } from './core/rows';
import { build, GraphCache, type ReaderRung, type Scene } from './core/scene';
import { bodiesToRead, chunks, sliceFor, zonesToRead } from './core/slice';
import { WorldStore } from './core/store';
import type { ElementInfo, Row } from './core/types';
import { plural, progressLine, type ReadStep } from './core/words';
import { Api, asFailure, ENDED_LINE, failureWords, ReadFailure, ReadQueue } from './net/api';
import { button, clear, h, isPhone, typeName } from './ui/dom';
import { allCardText, mapCardBody, worldRow } from './ui/home';
import { MapView, type MapStatus } from './ui/mapview';

/** Pin counts per Map are read only when every Pin of the world fits one read. */
export const ONE_READ = 1000;

/** Who a world is read as: the public (no key), a pasted key, or the sign-in's account token. */
export type Reader = 'public' | 'key' | 'account';

interface WorldState {
  id: string;
  reader: Reader;
  api: Api;
  store: WorldStore;
  meta: OwWorldMeta;
  rung: ReaderRung;
  /** The account's row for this world, when it is read on the token. */
  account: OwAccountWorld | null;
  /** Reads that are done, by name: `maps`, `pins`, `pins@<map>`, `markers@<map>`. */
  done: Set<string>;
  pinCounts: Map<string, number> | null;
  /** Why the counts are left out, when they are. */
  countsNote: string | null;
  graphs: GraphCache;
  elements: Map<string, { body: Row | null; type: string | null; pins: Row[]; longWay: boolean }>;
  onWait: (line: string | null) => void;
}

const HOME: Address = { world: null, type: null, element: null, map: null, at: null, measure: false };

/** The line while a 429 is waited out: a visitor's budget, or the account's. */
const waitWords = (reader: Reader, n: number) =>
  reader === 'account' ? `OnlyWorlds asks for a pause between reads; reading again in ${n} s.` : `OnlyWorlds lets a visitor read 60 times a minute; reading again in ${n} s.`;

const SIGN_IN_HINT = 'The mapper only reads and never makes keys. Your sign-in is an account token held in this page’s memory: it is removed when you sign out, tried when you leave the page, and ends by itself six hours after you signed in. A reload asks you to sign in again.';
const SIGNED_OUT_LINE = 'Signed out, and the sign-in is removed from your OnlyWorlds account. On a shared computer, sign out of onlyworlds.com too: until you do, the next Sign in here goes straight through.';
const UNCONFIRMED_LINE = 'Signed out here, but OnlyWorlds did not confirm the sign-in was removed, so it may still be live. Remove it in Account settings on onlyworlds.com.';
const LEFT_LINE = 'You left the page, so the mapper signed you out.';

function waymarkReader(ws: WorldState): 'member' | 'guest' | 'public' {
  if (ws.reader === 'public') return 'public';
  if (ws.reader === 'account' && ws.account?.role !== 'owner' && ws.account?.member_role === 'guest') return 'guest';
  return 'member';
}

export class App {
  readonly writer: AddressWriter;
  private gen = 0;
  private key: string | null = null;
  private keyWorld: string | null = null;
  private keyNote: string | null = null;
  private world: WorldState | null = null;
  map: MapView | null = null;
  private page: HTMLElement;
  /** Aborted when the page is left: its reads in flight stop, its queued reads never start. */
  private leave = new AbortController();
  /** The sign-in: one account token, in this object's memory only. */
  private session: SignedIn | null = null;
  /** The account's worlds, owned then joined, read once per sign-in. */
  private mine: OwAccountWorld[] | null = null;
  /** Every reader on the token, stopped together when the sign-in ends. */
  private onToken = new Set<Api>();
  /** The Maps lists the home read on the token, by world: handed to the world's page. */
  private homeMaps = new Map<string, Row[]>();
  /** The home's one queue: its rows are read one after another, never in a fan-out. */
  private homeQueue = new ReadQueue();
  /** A line the next home says once (signed out, the sign-in ended, a refused return). */
  private notice: string | null = null;
  /** The callback's exchange is running: nothing routes until its outcome. */
  private exchanging = false;
  /** The page has started to leave: a token that arrives now is revoked on arrival. */
  private leaving = false;
  private expiry: ReturnType<typeof setTimeout> | null = null;

  constructor(root: HTMLElement) {
    this.writer = new AddressWriter(history, () => location.search);
    this.page = h('main', { class: 'page' });
    root.append(this.page);
    window.addEventListener('popstate', () => {
      this.writer.cancelPending();
      void this.route();
    });
  }

  /** Signed in or not, for the walks: never the token. */
  get signedIn(): boolean {
    return this.session !== null;
  }

  /** A press: a new entry, then the page follows it. */
  go(next: Address, shows: string | null = next.map): void {
    this.writer.push({ ...next, measure: this.writer.current().measure }, shows);
    void this.route();
  }

  private teardown(): void {
    this.leave.abort();
    this.leave = new AbortController();
    this.map?.destroy();
    this.map = null;
    clear(this.page);
    this.page.className = 'page';
  }

  private says(line: string): void {
    this.page.append(h('section', { class: 'intro' }, h('h1', {}, 'OnlyWorlds mapper'), h('p', { class: 'progress', role: 'status' }, line)));
  }

  // ---- the sign-in

  /** The first route: on the callback, only after the exchange's outcome, with nothing to press meanwhile. */
  async start(callback: Promise<SignInOutcome> | null): Promise<void> {
    if (callback) {
      this.exchanging = true;
      this.teardown();
      this.says('Signing in…');
      const outcome = await callback;
      this.exchanging = false;
      if (outcome.ok) {
        const s: SignedIn = { token: outcome.token, tokenId: outcome.tokenId, username: outcome.username, expiresAt: outcome.expiresAt };
        // A token that arrives after the page started to leave is revoked on arrival.
        if (this.leaving) {
          void revokeToken(s);
          this.notice = LEFT_LINE;
          this.replaceAddress('/');
        } else {
          this.beginSession(s);
          this.replaceAddress(outcome.resume ?? '/');
        }
      } else {
        this.notice = signInCallbackLine(outcome);
        this.replaceAddress('/');
      }
    }
    await this.route();
  }

  private replaceAddress(url: string): void {
    try {
      history.replaceState(null, '', url);
    } catch {
      /* the address stays */
    }
  }

  private beginSession(s: SignedIn): void {
    this.session = s;
    this.mine = null;
    // keel ends the token at its time; the page ends the sign-in then too, rather than wait for a 401.
    const left = s.expiresAt ? Date.parse(s.expiresAt) - Date.now() : Number.NaN;
    if (Number.isFinite(left) && left > 0 && left < 2 ** 31 - 1) this.expiry = setTimeout(() => this.endSession(ENDED_LINE), left);
  }

  /** Stop every read on the token, and forget the sign-in and everything read on it. */
  private dropSession(): SignedIn | null {
    const s = this.session;
    for (const api of this.onToken) api.close();
    this.onToken.clear();
    if (this.world?.reader === 'account') this.world = null;
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = null;
    this.session = null;
    this.mine = null;
    this.homeMaps.clear();
    return s;
  }

  /**
   * The sign-in ended (a 401 on the token, its time, a page back from the cache), said once: every
   * read on the token stops; the home redraws as a stranger's in place; a page read on the token
   * goes to the home; a public world's page stays where it is, and the line waits for the home.
   */
  private endSession(line: string): void {
    if (!this.session) return;
    const a = this.writer.current();
    const onTokenPage = !!a.world && (this.mine === null || this.readerFor(a.world) === 'account');
    this.dropSession();
    this.notice = line;
    if (!a.world) void this.route();
    else if (onTokenPage) this.go(HOME);
  }

  /** The page is leaving: its token is revoked as it goes. */
  pageHidden(): void {
    this.leaving = true;
    if (this.session) void revokeToken(this.session);
  }

  /** The page is shown again. Back from the back/forward cache it holds a token it revoked, so it signs out. */
  pageShown(persisted: boolean): void {
    this.leaving = false;
    if (persisted && this.session) {
      // One more revoke costs a request and covers a hide that lost its own.
      void revokeToken(this.session);
      this.endSession(LEFT_LINE);
    }
  }

  /** Sign out: the reads in flight stop first, then the token is removed, then the page says which happened. */
  private async signOut(): Promise<void> {
    const s = this.dropSession();
    if (!s) return;
    this.gen++;
    this.teardown();
    this.says('Signing out…');
    const out = await revokeToken(s);
    this.notice = out === 'revoked' ? SIGNED_OUT_LINE : UNCONFIRMED_LINE;
    if (this.writer.current().world) this.go(HOME);
    else void this.route();
  }

  /** Sign in with OnlyWorlds, offered only on the registered origin and only when signed out. */
  private signInButton(said: HTMLElement): HTMLElement | null {
    if (this.session || !canSignIn()) return null;
    return button('Sign in with OnlyWorlds', () => {
      said.hidden = false;
      said.textContent = 'Going to OnlyWorlds…';
      beginSignIn(resumeFrom(location.pathname, location.search)).catch((err: unknown) => {
        said.textContent = err instanceof Error ? err.message : 'Signing in did not start. Try again.';
      });
    }, { class: 'signin' });
  }

  private accountRow(id: string): OwAccountWorld | null {
    return (this.session && this.mine?.find((w) => w.id === id)) || null;
  }

  private readerFor(id: string): Reader {
    if (this.accountRow(id)) return 'account';
    if (this.key && this.keyWorld === id) return 'key';
    return 'public';
  }

  /** A reader on the token: stopped with the others when the sign-in ends; its first 401 ends it. */
  private tokenApi(world: string | null, opts: { queue?: ReadQueue; onWait?: (n: number) => void } = {}): Api {
    const api = new Api({ world, key: null, token: this.session!.token, onEnded: () => this.endSession(ENDED_LINE), queue: opts.queue, onWait: opts.onWait });
    this.onToken.add(api);
    return api;
  }

  private release(api: Api): void {
    api.close();
    this.onToken.delete(api);
  }

  /** The account's worlds, read once per sign-in (one call: the list is unpaged), owned then joined. */
  private async ensureMine(signal: AbortSignal): Promise<OwAccountWorld[]> {
    if (this.mine) return this.mine;
    const s = this.session;
    if (!s) throw new ReadFailure('stopped', null, 'signed out');
    const api = this.tokenApi(null);
    try {
      const got = await api.accountWorlds(signal);
      if (this.session !== s) throw new ReadFailure('stopped', null, 'signed out');
      this.mine = accountOrder((Array.isArray(got) ? got : []).filter((w) => w && isId(w.id)));
      return this.mine;
    } finally {
      this.release(api);
    }
  }

  async route(): Promise<void> {
    if (this.exchanging) return;
    const gen = ++this.gen;
    const a = this.writer.current();
    this.teardown();
    if (!a.world) return this.home(gen, null);
    if (!isId(a.world)) return this.home(gen, 'This is not a world id. A world id looks like 0695db52-5433-7332-8000-db7fe10da375.');
    // Signed in, which reader a world is read as waits on the account's list.
    if (this.session && !this.mine) {
      const s = this.statusPage('Opening the world');
      s.line('Reading your worlds.');
      try {
        await this.ensureMine(this.leave.signal);
      } catch (err) {
        if (gen !== this.gen) return;
        const f = asFailure(err);
        if (f.kind === 'ended' || f.kind === 'stopped') return;
        return s.fail(failureWords(f, 'account’s worlds'), () => void this.route());
      }
      if (gen !== this.gen) return;
      clear(this.page);
    }
    const ws = await this.ensureWorld(a.world, gen);
    if (!ws || gen !== this.gen) return;
    if (a.element) return this.elementPage(ws, a, gen);
    if (a.map) return this.mapPage(ws, a, gen, null, null);
    return this.mapsPage(ws, gen);
  }

  // ---- the home: worlds and their maps, then the ways in

  private home(gen: number, error: string | null): void {
    document.title = 'OnlyWorlds mapper';
    const signal = this.leave.signal;
    const notice = this.notice;
    this.notice = null;
    const said = h('p', { class: 'said', role: 'status' }, notice ?? '');
    said.hidden = !notice;
    const home = h('div', { class: 'home' },
      h('header', { class: 'home-head' },
        h('h1', {}, 'OnlyWorlds mapper'),
        h('p', {}, 'See the maps of an OnlyWorlds world: its pictured maps with their Pins and Zones, and its layouts, where linked elements are joined by lines. The mapper only reads; it never changes a world.')),
      said);
    if (this.session) home.append(this.mineSection(gen, signal));
    home.append(this.demoSection(), this.waysSection(error));
    this.page.append(home);
  }

  /** The demo worlds from the list built into the page: nothing is read until a press. */
  private demoSection(): HTMLElement {
    const mine = new Set(this.mine?.map((w) => w.id) ?? []);
    const shown = DEMOS.filter((d) => !mine.has(d.id));
    const sec = h('section', { class: 'home-section demos', 'aria-labelledby': 'demos-h' }, h('h2', { id: 'demos-h' }, this.session ? 'Public demo worlds' : 'Public worlds to try'));
    sec.hidden = shown.length === 0;
    for (const d of shown) {
      const row = worldRow({ id: d.id, name: d.name, role: d.words, headingId: `demo-${d.id}`, button });
      row.setCards(this.cardsFor(d.id, d.cards, d.total));
      sec.append(row.el);
    }
    return sec;
  }

  /** A row's cards: its first maps, then one card into the world's page; none when it has no maps. */
  private cardsFor(world: string, cards: readonly MapCard[], total: number): HTMLElement[] | null {
    if (total === 0) return null;
    const out: HTMLElement[] = cards.map((c) => this.linkTo({ ...HOME, world, map: c.id }, 'map-card', ...mapCardBody(c)));
    out.push(this.linkTo({ ...HOME, world }, 'map-card all', h('span', { class: 'card-name' }, allCardText(total)), h('span', { class: 'card-kind' }, 'every map, by name')));
    return out;
  }

  /** Signed in: who, Sign out, and the account's worlds, each row's maps read as it comes into view. */
  private mineSection(gen: number, signal: AbortSignal): HTMLElement {
    const s = this.session!;
    const status = h('p', { class: 'progress', role: 'status' }, 'Reading your worlds.');
    const count = h('p', { class: 'note' });
    count.hidden = true;
    const rows = h('div', { class: 'world-rows' });
    const sec = h('section', { class: 'home-section mine', 'aria-labelledby': 'mine-h' },
      h('div', { class: 'who' }, h('p', {}, 'Signed in as ', h('strong', {}, s.username), '.'), button('Sign out', () => void this.signOut(), { class: 'signout' })),
      h('p', { class: 'hint' }, SIGN_IN_HINT),
      h('h2', { id: 'mine-h' }, 'Your worlds'), status, count, rows);
    const load = async () => {
      clear(status);
      status.className = 'progress';
      status.setAttribute('role', 'status');
      status.append('Reading your worlds.');
      status.hidden = false;
      let mine: OwAccountWorld[];
      try {
        mine = await this.ensureMine(signal);
      } catch (err) {
        if (gen !== this.gen) return;
        const f = asFailure(err);
        if (f.kind === 'ended' || f.kind === 'stopped') return;
        clear(status);
        status.className = 'failure';
        status.setAttribute('role', 'alert');
        status.append(failureWords(f, 'account’s worlds') + ' ', button('Try again', () => void load(), { class: 'retry' }));
        return;
      }
      if (gen !== this.gen) return;
      status.hidden = true;
      // A demo world on the account's list is shown once, in the person's own rows.
      this.page.querySelector('.home-section.demos')?.replaceWith(this.demoSection());
      if (!mine.length) {
        status.hidden = false;
        status.className = 'note';
        status.textContent = 'This account has no worlds yet. Make one on onlyworlds.com.';
        return;
      }
      if (mine.length > 1) {
        count.hidden = false;
        count.textContent = `${plural(mine.length, 'world')}, yours first, then the ones you joined. A row’s maps are read when it comes into view.`;
      }
      this.drawMine(gen, mine, rows, signal);
    };
    void load();
    return sec;
  }

  /**
   * The account's rows. A row's Maps list is read (one call, on the token, in the home's one queue)
   * when the row comes into view, and the next row with it; a list read once is kept for the tab and
   * handed to the world's page.
   */
  private drawMine(gen: number, mine: readonly OwAccountWorld[], box: HTMLElement, signal: AbortSignal): void {
    const starts: (() => void)[] = [];
    const els: HTMLElement[] = [];
    mine.forEach((w, i) => {
      const row = worldRow({ id: w.id, name: w.name, role: roleWords(w), headingId: `mine-${i}`, button });
      row.el.dataset.index = String(i);
      els.push(row.el);
      box.append(row.el);
      const draw = (maps: Row[]) => {
        row.el.classList.remove('pending');
        const r = homeRow(maps);
        row.setStatus(r.total ? null : 'No maps this reader can see.', 'note');
        row.setCards(this.cardsFor(w.id, r.cards, r.total));
      };
      const read = async () => {
        const held = this.homeMaps.get(w.id);
        if (held) return draw(held);
        if (!this.session || signal.aborted) return;
        row.setStatus('Reading its maps.', 'progress');
        const api = this.tokenApi(w.id, { queue: this.homeQueue, onWait: (n) => gen === this.gen && row.setStatus(n ? waitWords('account', n) : 'Reading its maps.', n ? 'wait' : 'progress') });
        try {
          const maps = await api.all('map', undefined, undefined, undefined, signal);
          this.homeMaps.set(w.id, maps);
          if (gen === this.gen) draw(maps);
        } catch (err) {
          if (gen !== this.gen) return;
          const f = asFailure(err);
          if (f.kind === 'ended' || f.kind === 'stopped') return;
          // A world on the list the account can no longer read says so, never a blank.
          const text = f.kind === 'not-found' || f.status === 403 ? 'OnlyWorlds no longer lets this account read this world.' : failureWords(f, 'maps');
          row.el.classList.remove('pending');
          row.setStatus(text, 'failure', () => void read());
        } finally {
          this.release(api);
        }
      };
      let started = false;
      starts.push(() => {
        if (started) return;
        started = true;
        void read();
      });
      if (this.homeMaps.has(w.id)) starts[i]();
      else {
        // A row waiting for its read keeps a drawn row's height, so the rows in view stay the rows read.
        row.el.classList.add('pending');
        row.setStatus('Its maps are read when the row comes into view.', 'note');
      }
    });
    if (typeof IntersectionObserver !== 'function') {
      starts.slice(0, 4).forEach((go) => go());
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const i = Number((e.target as HTMLElement).dataset.index);
        starts[i]?.();
        starts[i + 1]?.();
        io.unobserve(e.target);
      }
    });
    for (const el of els) io.observe(el);
    signal.addEventListener('abort', () => io.disconnect(), { once: true });
  }

  /** The other ways in: Sign in with OnlyWorlds (signed out, on the registered origin), a world id, a key. */
  private waysSection(error: string | null): HTMLElement {
    const input = h('input', { id: 'world-id', name: 'world', autocomplete: 'off', spellcheck: 'false', placeholder: '0695db52-5433-7332-8000-db7fe10da375' });
    const msg = h('p', { class: 'error', role: 'alert' }, error ?? '');
    msg.hidden = !error;
    const form = h('form', { class: 'open-form' }, h('label', { for: 'world-id' }, 'World id'), h('div', { class: 'field' }, input, h('button', { type: 'submit' }, 'Open')));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!isId(v)) {
        msg.textContent = 'This is not a world id. A world id looks like 0695db52-5433-7332-8000-db7fe10da375.';
        msg.hidden = false;
        return;
      }
      this.go({ ...this.writer.current(), world: v, map: null, element: null, type: null, at: null });
    });
    const going = h('p', { class: 'said', role: 'status' });
    going.hidden = true;
    const signIn = this.signInButton(going);
    return h('section', { class: 'intro ways', 'aria-label': 'Other ways in' },
      signIn ? h('h2', {}, 'Your own worlds') : null,
      signIn ? h('p', {}, 'Sign in to see the worlds you own and the ones you joined, each with its maps.') : null,
      signIn,
      signIn ? going : null,
      signIn ? h('p', { class: 'hint' }, SIGN_IN_HINT) : null,
      h('h2', {}, 'Open a world by its id'),
      form, msg,
      h('h2', {}, 'A world by its key'), this.keyForm(null));
  }

  // ---- the key

  private link(text: string, to: Address): HTMLAnchorElement {
    return this.linkTo(to, undefined, text);
  }

  /** A link that is a press (a new entry) for a plain click, and an ordinary link for a new tab. */
  private linkTo(to: Address, cls: string | undefined, ...children: (Node | string)[]): HTMLAnchorElement {
    const url = new URLSearchParams();
    if (to.world) url.set('world', to.world);
    if (to.map) url.set('map', to.map);
    const q = url.toString();
    const a = h('a', { href: q ? `/?${q}` : '/', class: cls }, ...children);
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      this.go(to);
    });
    return a;
  }

  /**
   * The key form: a read key, held in this page's memory only (a reload asks again), read when its
   * button is pressed and cleared from the field at once.
   *
   * A password field, so assistive technology reads it masked: a key spoken aloud, or read by an
   * accessibility tool, is a leak the person cannot see happen. It stands outside any form and asks
   * for no autocomplete, which is the answer to the browser's offer to save it: without a submitted
   * form the offer is rarely made, and a read key a person chose to save is the smaller harm.
   */
  private keyForm(addressWorld: string | null): HTMLElement {
    const input = h('input', { id: 'world-key', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'data-lpignore': 'true', 'data-1p-ignore': 'true', placeholder: 'ow_r_…' });
    const msg = h('p', { class: 'error', role: 'alert' });
    msg.hidden = true;
    const show = button('Show', () => {
      const shown = input.type === 'password';
      input.type = shown ? 'text' : 'password';
      show.textContent = shown ? 'Hide' : 'Show';
      show.setAttribute('aria-pressed', String(shown));
    }, { class: 'show-key', 'aria-pressed': 'false', 'aria-controls': 'world-key' });
    const open = h('button', { type: 'button', class: 'open-key' }, 'Open with this key');
    const form = h('div', { class: 'key-form', role: 'group', 'aria-labelledby': 'world-key-label' },
      h('label', { for: 'world-key', id: 'world-key-label' }, 'A read key for the world'),
      h('div', { class: 'field' }, input, show, open),
      h('p', { class: 'hint' }, 'Make a read key on onlyworlds.com, on the world’s page. It starts with ow_r_. The key stays in this page while it is open and is never stored: a reload asks for it again.'),
      msg);
    const say = (text: string, extra?: Node) => {
      clear(msg);
      msg.append(text);
      if (extra) msg.append(' ', extra);
      msg.hidden = false;
    };
    const submit = async () => {
      const key = input.value.trim();
      input.value = '';
      if (input.type !== 'password') show.click();
      const kind = detectKeyKind(key);
      if (kind === 'legacy') return say('Keys of ten digits are not taken here. Make a read key on onlyworlds.com (it starts with ow_r_) and paste that.');
      if (kind === 'account') return say('This is an account token, not a world key. Paste a world’s read key (it starts with ow_r_).');
      if (kind !== 'read' && kind !== 'write') return say('This does not look like a world key. A read key starts with ow_r_.');
      say('Reading the world with this key.');
      const api = new Api({ world: null, key });
      let meta: OwWorldMeta;
      try {
        meta = await api.world();
      } catch (err) {
        const f = asFailure(err);
        return say(f.status === 401 || f.status === 403 ? 'OnlyWorlds did not take this key.' : failureWords(f, 'world'));
      } finally {
        api.close();
      }
      const want = addressWorld ?? this.writer.current().world;
      if (want && isId(want) && meta.id !== want) {
        return say(`This key opens the world “${meta.name}”, not the one in the address.`, button(`Open “${meta.name}” instead`, () => {
          this.useKey(key, meta.id, kind);
          this.go({ world: meta.id, map: null, element: null, type: null, at: null, measure: false });
        }));
      }
      this.useKey(key, meta.id, kind);
      if (want === meta.id) void this.route();
      else this.go({ world: meta.id, map: null, element: null, type: null, at: null, measure: false });
    };
    open.addEventListener('click', () => void submit());
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      void submit();
    });
    return form;
  }

  private useKey(key: string, world: string, kind: string): void {
    if (this.world) this.release(this.world.api);
    this.world = null;
    this.key = key;
    this.keyWorld = world;
    this.keyNote = kind === 'write' ? 'This is a write key. The mapper only reads, but a read key (ow_r_) is the safer one to paste.' : null;
  }

  // ---- the world

  private statusPage(title: string): { line: (text: string, cls?: string) => void; fail: (text: string, retry: () => void) => void; box: HTMLElement } {
    const box = h('div', { class: 'status-page', 'aria-live': 'polite' });
    this.page.append(h('section', { class: 'intro' }, h('h1', {}, title), box));
    return {
      box,
      line: (text, cls = 'progress') => {
        clear(box);
        box.append(h('p', { class: cls }, text));
      },
      fail: (text, retry) => {
        clear(box);
        box.append(h('p', { class: 'failure', role: 'alert' }, text + ' ', button('Try again', retry, { class: 'retry' })));
      },
    };
  }

  private async ensureWorld(id: string, gen: number): Promise<WorldState | null> {
    const reader = this.readerFor(id);
    if (this.world && this.world.id === id && this.world.reader === reader) return this.world;
    if (this.world) this.release(this.world.api);
    this.world = null;
    const account = reader === 'account' ? this.accountRow(id) : null;
    const s = this.statusPage('Opening the world');
    s.line('Reading the world.');
    let waitLine: (l: string | null) => void = () => {};
    const onWait = (n: number) => waitLine(n ? waitWords(reader, n) : null);
    const api = reader === 'account' ? this.tokenApi(id, { onWait }) : new Api({ world: id, key: reader === 'key' ? this.key : null, onWait });
    waitLine = (l) => l && s.line(l, 'wait');
    let meta: OwWorldMeta;
    try {
      meta = await api.world();
    } catch (err) {
      this.release(api);
      if (gen !== this.gen) return null;
      const f = asFailure(err);
      if (f.kind === 'ended') return null;
      if (f.kind === 'not-found' && reader === 'public') {
        this.teardown();
        this.notPublic(id);
        return null;
      }
      s.fail(failureWords(f, 'world'), () => void this.route());
      return null;
    }
    // The rung: signed in, from the account's list (an account token cannot ask /me); a pasted key
    // asks /me; the public reads as the public.
    let rung: ReaderRung = 'public';
    if (account) rung = rungOf(account);
    else if (reader === 'key') {
      try {
        const me = await api.me();
        rung = me.role === 'owner' ? 'owner' : 'guest';
      } catch {
        rung = 'guest';
      }
    }
    const ws: WorldState = {
      id, reader, api, store: new WorldStore(), meta, rung, account, done: new Set(), pinCounts: null, countsNote: null,
      graphs: new GraphCache(), elements: new Map(), onWait: () => {},
    };
    // The Maps list the home read on the token is handed over: a press from the home reads it once.
    const held = reader === 'account' ? this.homeMaps.get(id) : undefined;
    if (held) {
      ws.store.put('map', held);
      ws.done.add('maps');
    }
    waitLine = (l) => ws.onWait(l);
    if (gen !== this.gen) {
      this.world = ws;
      return null;
    }
    this.world = ws;
    clear(this.page);
    return ws;
  }

  private notPublic(id: string): void {
    document.title = 'Not opened · OnlyWorlds mapper';
    const said = h('p', { class: 'said', role: 'status' });
    said.hidden = true;
    const signIn = this.signInButton(said);
    this.page.append(h('section', { class: 'intro' },
      h('h1', {}, 'This world could not be opened'),
      h('p', { class: 'error', role: 'alert' }, this.session
        ? 'No public world has this id, and it is not one of your worlds. It may be mistyped: paste a key to open it.'
        : 'No public world has this id. It may be mistyped, or private: paste a key to open it.'),
      h('p', { class: 'mono' }, id),
      signIn ? h('p', {}, 'If this world is yours or you joined it, sign in to open it as yourself.') : null,
      signIn, signIn ? said : null,
      this.keyForm(id),
      h('p', {}, this.link('Back to the start', HOME))));
  }

  private readerNote(ws: WorldState): HTMLElement | null {
    if (ws.reader === 'key') return h('p', { class: 'note' }, ws.rung === 'owner' ? 'Read with your key, as the world’s owner.' : 'Read with your key, as this key reads it.');
    if (ws.reader === 'account' && ws.account) return h('p', { class: 'note' }, ws.account.role === 'owner' ? 'Read with your sign-in, as the world’s owner.' : `Read with your sign-in, as ${roleWords(ws.account)}.`);
    return null;
  }

  /** The Maps (one read), then each Map's Pin count when every Pin of the world fits one read. */
  private async ensureMaps(ws: WorldState, say: (l: string | null, fail?: ReadFailure) => void, signal: AbortSignal): Promise<boolean> {
    if (!ws.done.has('maps')) {
      say('Reading the maps.');
      try {
        const maps = await ws.api.all('map', undefined, undefined, undefined, signal);
        ws.store.put('map', maps);
        ws.done.add('maps');
      } catch (err) {
        say(null, asFailure(err));
        return false;
      }
    }
    return true;
  }

  private async ensureCounts(ws: WorldState, signal: AbortSignal): Promise<void> {
    if (ws.pinCounts || ws.countsNote) return;
    const total = ws.meta.counts?.types?.pin;
    if (typeof total !== 'number') {
      ws.countsNote = 'OnlyWorlds did not say how many Pins this world has, so each map’s count is left out.';
      return;
    }
    if (total > ONE_READ) {
      ws.countsNote = `This world has ${plural(total, 'Pin')}, more than one read of ${ONE_READ.toLocaleString('en-US')} holds, so each map’s count is left out.`;
      return;
    }
    if (total > 0 && !ws.done.has('pins')) {
      const pins = await ws.api.all('pin', undefined, undefined, undefined, signal);
      ws.store.put('pin', pins);
      ws.done.add('pins');
    }
    const counts = new Map<string, number>();
    for (const p of ws.store.ofType('pin')) {
      const m = linkId(p.map);
      if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    ws.pinCounts = counts;
  }

  private worldHeading(ws: WorldState): HTMLElement {
    const name = h('h1', { class: 'world-name' }, ws.meta.name || 'A world with no name');
    try {
      mountWaymark(name, { world: { id: ws.id, name: ws.meta.name || 'World' }, reader: waymarkReader(ws), tool: 'mapper', phone: isPhone() });
    } catch {
      /* the name stands alone */
    }
    return name;
  }

  private mapRow(ws: WorldState, r: MapReading, pressTo: Address, current = false): HTMLElement {
    const count = ws.pinCounts ? ws.pinCounts.get(r.id) ?? 0 : null;
    const b = button('', () => this.go(pressTo), { class: 'row map-row', 'aria-current': current ? 'true' : undefined });
    b.append(h('span', { class: 'row-name' }, r.name), h('span', { class: 'row-meta' }, [r.words, count !== null ? plural(count, 'Pin') : null].filter(Boolean).join(' · ')));
    return h('li', {}, b);
  }

  private async mapsPage(ws: WorldState, gen: number): Promise<void> {
    const signal = this.leave.signal;
    document.title = `${ws.meta.name} · OnlyWorlds mapper`;
    const status = h('div', { class: 'status-page', 'aria-live': 'polite' });
    const list = h('ul', { class: 'rows maps' });
    const countLine = h('p', { class: 'note' });
    countLine.hidden = true;
    const section = h('section', { class: 'intro wide' },
      h('p', { class: 'crumb' }, this.link('OnlyWorlds mapper', HOME)),
      this.worldHeading(ws),
      this.readerNote(ws),
      this.keyNote && ws.reader === 'key' ? h('p', { class: 'note' }, this.keyNote) : null,
      status, countLine, list);
    this.page.append(section);
    ws.onWait = (l) => {
      clear(status);
      if (l) status.append(h('p', { class: 'wait' }, l));
    };
    const draw = () => {
      clear(list);
      const maps = ws.store.ofType('map');
      const readings = maps.map((m) => readMap(m, maps));
      readings.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
      for (const r of readings) list.append(this.mapRow(ws, r, { world: ws.id, map: r.id, element: null, type: null, at: null, measure: false }));
      if (!readings.length && ws.done.has('maps')) list.append(h('li', { class: 'note' }, 'This world has no maps this reader can see.'));
    };
    const run = async () => {
      clear(status);
      const ok = await this.ensureMaps(ws, (l, fail) => {
        clear(status);
        if (fail) status.append(h('p', { class: 'failure', role: 'alert' }, failureWords(fail, 'maps') + ' ', button('Try again', () => void run(), { class: 'retry' })));
        else if (l) status.append(h('p', { class: 'progress' }, l));
      }, signal);
      if (!ok || gen !== this.gen) return;
      clear(status);
      const n = ws.store.ofType('map').length;
      status.append(h('p', { class: 'counts' }, plural(n, 'map')));
      draw();
      try {
        if (!ws.pinCounts && !ws.countsNote) {
          countLine.hidden = false;
          countLine.textContent = 'Counting each map’s Pins.';
        }
        await this.ensureCounts(ws, signal);
      } catch (err) {
        if (gen !== this.gen) return;
        countLine.hidden = false;
        clear(countLine);
        countLine.append(failureWords(asFailure(err), 'Pins') + ' The counts are left out. ', button('Try again', () => void run(), { class: 'retry' }));
        return;
      }
      if (gen !== this.gen) return;
      countLine.hidden = !ws.countsNote;
      countLine.textContent = ws.countsNote ?? '';
      draw();
    };
    await run();
  }

  // ---- one element's maps

  private async elementPage(ws: WorldState, a: Address, gen: number): Promise<void> {
    const signal = this.leave.signal;
    const id = a.element!;
    const s = this.statusPage('Reading the element');
    ws.onWait = (l) => l && s.line(l, 'wait');
    if (!isId(id)) return s.line('This is not an element id.', 'error');
    if (a.type && !(ELEMENT_TYPES as readonly string[]).includes(a.type)) return s.line(`This address names no element type called “${a.type}”.`, 'error');
    const key = `${a.type ?? ''}:${id}`;
    let got = ws.elements.get(key);
    if (!got) {
      try {
        let body: Row | null = null;
        if (a.type) {
          s.line('Reading the element.');
          try {
            body = (await ws.api.get(a.type, id, signal)) as unknown as Row;
          } catch (err) {
            const f = asFailure(err);
            if (f.kind === 'not-found') return s.line('No element with this id that this reader can see in this world.', 'error');
            throw f;
          }
        }
        s.line('Reading the maps it is on.');
        const pins = await ws.api.all('pin', { element: id }, undefined, ['map'], signal);
        let longWay = false;
        let bodyType: string | null = a.type;
        if (!a.type) {
          longWay = true;
          const t = pins.map((p) => elementTypeOf(p.element_type)).find(Boolean);
          if (!t) return s.line('This address has no type, and no Pin this reader can see places this element, so it cannot be read.', 'error');
          bodyType = t;
          try {
            body = (await ws.api.get(t, id, signal)) as unknown as Row;
          } catch (err) {
            const f = asFailure(err);
            if (f.kind !== 'not-found') throw f;
          }
        }
        got = { body, type: bodyType, pins, longWay };
        ws.elements.set(key, got);
      } catch (err) {
        if (gen !== this.gen) return;
        return s.fail(failureWords(asFailure(err), 'element'), () => void this.route());
      }
    }
    if (gen !== this.gen) return;
    if (got.body && got.type) ws.store.put(got.type, [got.body]);
    // The Pins as served carry their Map expanded; the store keeps the Map's id as the link.
    ws.store.put('pin', got.pins.map((p) => ({ ...p, map: linkId(p.map) ?? p.map })));
    const ok = await this.ensureMaps(ws, (l, f) => (f ? s.fail(failureWords(f, 'maps'), () => void this.route()) : l && s.line(l)), signal);
    if (!ok || gen !== this.gen) return;
    const maps = ws.store.ofType('map');
    const mapIds = [...new Set(got.pins.map((p) => linkId(p.map)).filter((m): m is string => !!m && ws.store.typeOf(m) === 'map'))];
    const readings = elementMapOrder(mapIds.map((m) => readMap(ws.store.get(m)!, maps)), (m) => ws.pinCounts?.get(m) ?? null);
    const name = str(got.body, 'name') ?? 'An element this reader cannot see';
    const type = got.type;
    document.title = `${name} · ${ws.meta.name} · OnlyWorlds mapper`;
    if (!readings.length) {
      // The element keeps its line, and the world's maps are listed under it, one press into any.
      clear(this.page);
      const all = homeOrder(maps).map((m) => readMap(m, maps));
      const list = h('ul', { class: 'rows maps element-maps' });
      for (const r of all) list.append(this.mapRow(ws, r, { ...HOME, world: ws.id, map: r.id }));
      this.page.append(h('section', { class: 'intro wide' },
        h('p', { class: 'crumb' }, this.link(ws.meta.name || 'The world', { ...HOME, world: ws.id })),
        h('h1', {}, name), h('p', { class: 'type' }, typeName(type)),
        h('p', {}, 'No Pin places this element on any map this reader can see.'),
        h('p', { class: 'note' }, all.length ? `The world’s ${plural(all.length, 'map')}, one press into any:` : 'This world has no maps this reader can see.'),
        all.length ? list : null));
      return;
    }
    const open = a.map && readings.some((r) => r.id === a.map) ? a.map : readings[0].id;
    if (!a.map) this.writer.markShown(open);
    const nameEl = h('strong', { class: 'el-title' }, name);
    if (got.body && type) {
      try {
        mountWaymark(nameEl, { world: { id: ws.id, name: ws.meta.name }, element: { id, type, name }, reader: waymarkReader(ws), tool: 'mapper', phone: isPhone() });
      } catch {
        /* the name stands alone */
      }
    }
    const others = h('ul', { class: 'chips', id: 'element-maps' });
    for (const r of readings) {
      const b = button(r.name, () => this.go({ world: ws.id, type: a.type, element: id, map: r.id, at: null, measure: false }), { class: 'chip', 'aria-current': r.id === open ? 'true' : undefined, title: r.words });
      others.append(h('li', {}, b));
    }
    const onMaps = `on ${plural(readings.length, 'map')}`;
    // On a phone the chips fold behind one button, so the map keeps the screen (rule 10).
    const header: HTMLElement = h('div', { class: `element-head${readings.length > 1 ? '' : ' single'}` });
    const fold = readings.length > 1
      ? button(onMaps, () => {
          const shown = header.classList.toggle('open');
          fold?.setAttribute('aria-expanded', String(shown));
          this.map?.layoutChanged();
        }, { class: 'maps-fold', 'aria-expanded': 'false', 'aria-controls': 'element-maps' })
      : null;
    header.append(
      h('p', {}, nameEl, ` · ${typeName(type)} · `, h('span', { class: 'on-maps' }, onMaps), fold),
      others);
    if (got.longWay) header.append(h('p', { class: 'note' }, 'The address has no type, so the element was found the long way, through its Pins.'));
    await this.mapPage(ws, { ...a, map: open }, gen, id, header);
  }

  // ---- a Map

  infoOf(ws: WorldState, id: string): ElementInfo {
    const b = ws.store.get(id);
    const t = ws.store.typeOf(id) ?? null;
    if (!b) return { id, type: null, name: null, hidden: false, knownOf: false };
    return { id, type: t, name: str(b, 'name'), hidden: b.hidden === true, knownOf: b.known_of === true };
  }

  private async mapPage(ws: WorldState, a: Address, gen: number, element: string | null, header: HTMLElement | null): Promise<void> {
    const signal = this.leave.signal;
    const mapId = a.map!;
    if (!element) {
      const s = this.statusPage('Opening the map');
      ws.onWait = (l) => l && s.line(l, 'wait');
      const ok = await this.ensureMaps(ws, (l, f) => (f ? s.fail(failureWords(f, 'maps'), () => void this.route()) : l && s.line(l)), signal);
      if (!ok || gen !== this.gen) return;
      if (ws.store.typeOf(mapId) !== 'map') {
        s.line('This world has no map with this id that this reader can see.', 'error');
        const said = h('p', { class: 'said', role: 'status' });
        said.hidden = true;
        const signIn = ws.reader === 'public' ? this.signInButton(said) : null;
        if (signIn) s.box.append(h('p', {}, 'If this world is yours or you joined it, sign in to see its maps as yourself.'), signIn, said);
        s.box.append(h('p', {}, this.link('See the world’s maps', { ...HOME, world: ws.id })));
        return;
      }
    }
    clear(this.page);
    this.page.className = 'page full';
    const maps = ws.store.ofType('map');
    const reading = readMap(ws.store.get(mapId)!, maps, ws.store.ofType('pin'));
    const groundRow = reading.ground ? ws.store.get(reading.ground) : undefined;
    const ground = groundRow ? readMap(groundRow, maps) : null;
    document.title = `${reading.name} · ${ws.meta.name} · OnlyWorlds mapper`;

    const notes: string[] = [];
    if (reading.kind !== 'layout3d' && reading.depth !== null) notes.push(`This map has a depth of ${reading.depth}; it is drawn flat.`);
    if (ground) {
      let where = reading.marginRead ? `at ${reading.groundOffset[0]}, ${reading.groundOffset[1]} (its margin, from the layout's own settings)` : 'at 0, 0 (the layout names no margin)';
      if (reading.kind === 'layout3d') where += reading.groundZRead ? `, at height ${reading.groundZ} in 3D (from the layout's own settings)` : ', at height 0 in 3D (the layout names no ground height)';
      const what = ground.picture ? 'its picture and Zones are drawn under the Pins' : 'it has no picture, so only its Zones are drawn';
      notes.push(`Drawn over its ground, the map ${ground.name}, placed ${where}: ${what}. The ground's own Pins are not drawn.`);
    }
    if (reading.pictureRefused) notes.push('This map names a picture that is not on a secure (https) address, so it is not drawn.');
    if (ws.reader !== 'public') notes.push('Elements marked hidden are drawn as Pins without links, as the OnlyWorlds graph rules have it.');

    let pictureSize: { w: number; h: number } | null = null;
    const host = {
      world: { id: ws.id, name: ws.meta.name },
      waymarkReader: waymarkReader(ws),
      writer: this.writer,
      measure: a.measure,
      infoOf: (id: string) => this.infoOf(ws, id),
      pinRow: (id: string) => ws.store.get(id),
      pictureSized: (url: string, size: { w: number; h: number } | null) => {
        if (url !== reading.picture) return;
        pictureSize = size;
        derive();
      },
      back: () => {
        if (this.writer.depth() > 0) history.back();
        else this.go({ world: ws.id, map: null, element: null, type: null, at: null, measure: false });
      },
    };
    const mv = new MapView(host, this.page, reading, ground, { at: a.at, element, flat: a.view === 'flat' });
    this.map = mv;
    if (header) mv.setExtra(header);

    const steps: ReadStep[] = [
      { name: 'Pins', state: 'waiting', calls: 0 },
      { name: 'Markers', state: 'waiting', calls: 0 },
      { name: 'Zones', state: 'waiting', calls: 0 },
      { name: 'elements', state: 'waiting', calls: 0 },
    ];
    const status: MapStatus = { progress: null, long: null, wait: null, failure: null, drawing: null, notes };
    const push = () => {
      status.progress = progressLine(steps);
      if (gen === this.gen) mv.setStatus({ ...status });
    };
    ws.onWait = (l) => {
      status.wait = l;
      push();
    };
    const markerMaps = [mapId, ...(ground ? [ground.id] : [])];
    let complete = false;
    // A builder or drawing error is not a read's: it is said as the map's, kept for the console, and
    // never fails the read that landed (its Try again would only repeat it).
    const derive = () => {
      if (gen !== this.gen) return;
      try {
        const slice = sliceFor(ws.store, mapId, ground?.id ?? null, {
          markersComplete: markerMaps.every((m) => ws.done.has(`markers@${m}`)),
          zonesComplete: steps[2].state === 'done',
        });
        const scene: Scene = build({ slice, reading, ground, rung: ws.rung, complete, pictureSize, versionOf: (id) => ws.store.version(id) }, ws.graphs);
        mv.setScene(scene);
        if (status.drawing) {
          status.drawing = null;
          push();
        }
      } catch (err) {
        console.error(err);
        status.drawing = 'This map could not be drawn from what was read.';
        push();
      }
    };

    const runStep = async (i: number, fn: () => Promise<void>) => {
      if (steps[i].state === 'done') return;
      steps[i].state = 'running';
      push();
      const t0 = performance.now();
      const longTimer = window.setInterval(() => {
        if (performance.now() - t0 > 4000) {
          status.long = `This read is taking a while: OnlyWorlds sends at most ${ONE_READ.toLocaleString('en-US')} rows a read, one read at a time (${plural(steps[i].calls, 'read')} so far).`;
          push();
        }
      }, 1000);
      try {
        await fn();
        steps[i].state = 'done';
      } finally {
        clearInterval(longTimer);
        status.long = null;
      }
      push();
    };

    const run = async () => {
      status.failure = null;
      for (const st of steps) if (st.state === 'failed') st.state = 'waiting';
      push();
      try {
        await runStep(0, async () => {
          if (ws.done.has('pins') || ws.done.has(`pins@${mapId}`)) return;
          await ws.api.all('pin', { map: mapId }, (rows) => {
            steps[0].calls++;
            ws.store.put('pin', rows);
            derive();
          }, undefined, signal);
          ws.done.add(`pins@${mapId}`);
        });
        derive();
        await runStep(1, async () => {
          for (const m of markerMaps) {
            if (ws.done.has(`markers@${m}`)) continue;
            await ws.api.all('marker', { map: m }, (rows) => {
              steps[1].calls++;
              ws.store.put('marker', rows);
            }, undefined, signal);
            ws.done.add(`markers@${m}`);
          }
        });
        derive();
        await runStep(2, async () => {
          for (const part of chunks(zonesToRead(ws.store, mapId, ground?.id ?? null))) {
            const got = await ws.api.byIds('zone', part, undefined, signal);
            steps[2].calls++;
            ws.store.put('zone', got);
            const seen = new Set(got.map((r) => r.id));
            for (const z of part) if (!seen.has(z)) ws.store.unseen.add(z);
            derive();
          }
        });
        derive();
        await runStep(3, async () => {
          for (const [type, ids] of bodiesToRead(ws.store, mapId)) {
            for (const part of chunks(ids)) {
              const got = await ws.api.byIds(type, part, undefined, signal);
              steps[3].calls++;
              ws.store.put(type, got);
              const seen = new Set(got.map((r) => r.id));
              for (const e of part) if (!seen.has(e)) ws.store.unseen.add(e);
              derive();
            }
          }
        });
        complete = true;
        derive();
      } catch (err) {
        if (gen !== this.gen) return;
        const f = asFailure(err);
        const i = steps.findIndex((st) => st.state === 'running');
        if (i >= 0) steps[i].state = 'failed';
        status.failure = { text: failureWords(f, i >= 0 ? steps[i].name : 'map'), retry: () => void run() };
        push();
      }
    };
    push();
    derive();
    await run();
  }
}
