// The home's pieces: a world's row (its name, what it is to the person, its map cards in a row that
// scrolls sideways inside itself) and the cards. Names are text nodes only; the kind's mark is drawn
// here, never from a served value.
import type { MapCard } from '../core/home';
import type { MapKind } from '../core/kinds';
import { clear, h } from './dom';

const SVG = 'http://www.w3.org/2000/svg';

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** A small mark for the kind of map: a framed hill for a picture, a grid for a plan, joined dots for a layout. */
export function kindMark(kind: MapKind): SVGElement {
  const s = svg('svg', { viewBox: '0 0 20 20', width: '20', height: '20', class: `mark mark-${kind}`, 'aria-hidden': 'true', focusable: 'false' });
  const line = { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
  if (kind === 'picture') {
    s.append(svg('rect', { x: '2', y: '3', width: '16', height: '14', rx: '2', ...line }), svg('path', { d: 'M3.5 15 L8 9.5 L11 12.5 L13.5 10 L16.5 14', ...line }), svg('circle', { cx: '13.5', cy: '6.8', r: '1.4', fill: 'currentColor' }));
  } else if (kind === 'plan') {
    s.append(svg('rect', { x: '2', y: '3', width: '16', height: '14', rx: '2', ...line }), svg('path', { d: 'M7.5 3 V17 M12.5 3 V17 M2 10 H18', ...line, 'stroke-width': '1' }));
  } else {
    s.append(svg('path', { d: 'M5 14 L10 5 L15 13 Z', ...line, 'stroke-width': '1' }));
    for (const [x, y] of [[5, 14], [10, 5], [15, 13]]) s.append(svg('circle', { cx: String(x), cy: String(y), r: '2.4', fill: 'currentColor' }));
  }
  return s;
}

/** A map's card: its mark, its name (two lines at most, the whole name in its title) and its kind. */
export function mapCardBody(card: MapCard): Node[] {
  const name = h('span', { class: 'card-name', title: card.name }, card.name);
  return [kindMark(card.kind), name, h('span', { class: 'card-kind' }, card.words)];
}

export function allCardText(total: number): string {
  return total === 1 ? 'The world’s page' : `All ${total.toLocaleString('en-US')} maps`;
}

export interface WorldRowParts {
  el: HTMLElement;
  /** The row's cards, or none (the row folds to one line). */
  setCards(cards: HTMLElement[] | null): void;
  /** A line under the row's head: a progress line, a wait, or a failure with Try again. */
  setStatus(text: string | null, cls?: 'progress' | 'wait' | 'failure' | 'note', retry?: () => void): void;
}

/**
 * A world's row. `headingId` names the row for assistive technology; `role` is what the world is to
 * the person, in words.
 */
export function worldRow(o: { id: string; name: string; role: string; headingId: string; button: (text: string, onPress: () => void, attrs?: Record<string, string>) => HTMLButtonElement }): WorldRowParts {
  const title = h('h3', { class: 'world-title', id: o.headingId }, h('span', { class: 'world-title-name' }, o.name || 'A world with no name'));
  const role = h('span', { class: 'world-role' }, o.role);
  const head = h('div', { class: 'world-head' }, title, role);
  const status = h('p', { class: 'world-status' });
  status.hidden = true;
  const cards = h('ul', { class: 'cards', 'aria-labelledby': o.headingId });
  cards.hidden = true;
  const el = h('section', { class: 'world-row', 'data-world': o.id, 'aria-labelledby': o.headingId }, head, status, cards);
  return {
    el,
    setCards(list) {
      clear(cards);
      if (!list) {
        cards.hidden = true;
        el.classList.add('folded');
        return;
      }
      el.classList.remove('folded');
      for (const c of list) cards.append(h('li', {}, c));
      cards.hidden = list.length === 0;
    },
    setStatus(text, cls = 'progress', retry) {
      clear(status);
      status.className = `world-status ${cls}`;
      status.hidden = !text;
      if (!text) return;
      status.setAttribute('role', cls === 'failure' ? 'alert' : 'status');
      status.append(text);
      if (retry) status.append(' ', o.button('Try again', retry, { class: 'retry' }));
    },
  };
}
