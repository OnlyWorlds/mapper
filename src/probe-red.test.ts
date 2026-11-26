import { expect, test } from 'vitest';

test('a probe that fails on purpose: the pull request check must read red', () => {
  expect(1).toBe(2);
});
