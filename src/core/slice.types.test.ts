import { ELEMENT_TYPES } from '@onlyworlds/sdk';
import { describe, expect, it } from 'vitest';
import { id } from './fixture';
import { elementTypeOf } from './rows';
import { bodiesToRead } from './slice';
import { WorldStore } from './store';

// A Pin's element_type is a stranger's word: it becomes a request path (on the account token too),
// so only the 22 element types are ever taken from it.
describe('a served element type', () => {
  it('is taken only when it is one of the 22 element types, lower-cased', () => {
    for (const t of ELEMENT_TYPES) expect(elementTypeOf(t)).toBe(t);
    expect(elementTypeOf('Location')).toBe('location');
    for (const bad of ['account', 'world', 'account/tokens', '../account', 'me', 'auth', '', ' location', null, 42, undefined]) expect(elementTypeOf(bad)).toBeNull();
  });

  it('never names an account route among the bodies to read', () => {
    const store = new WorldStore();
    const MAP = id(1);
    store.put('map', [{ id: MAP, type: 'map', name: 'm' }]);
    store.put('pin', [
      { id: id(10), type: 'pin', map: MAP, element_type: 'account', element_id: id(20), x: 0, y: 0 },
      { id: id(11), type: 'pin', map: MAP, element_type: 'world', element_id: id(21), x: 0, y: 0 },
      { id: id(12), type: 'pin', map: MAP, element_type: 'Location', element_id: id(22), x: 0, y: 0 },
    ]);
    expect([...bodiesToRead(store, MAP).entries()]).toEqual([['location', [id(22)]]]);
  });
});
