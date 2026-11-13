// A small element builder. Text is always set as a text node: a stranger's words never become markup.
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

export function button(text: string, onPress: () => void, attrs: Record<string, string | boolean | undefined> = {}): HTMLButtonElement {
  const b = h('button', { type: 'button', ...attrs }, text);
  b.addEventListener('click', onPress);
  return b;
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}

/** A type slug as a word: `location` gives "Location". */
export function typeName(type: string | null): string {
  if (!type) return 'Unknown type';
  return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
}

export function isPhone(): boolean {
  return window.matchMedia('(max-width: 640px)').matches || window.matchMedia('(pointer: coarse)').matches;
}
