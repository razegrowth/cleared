import { assert, test } from 'vitest';
import { foldThread } from '../src/ui/Reader.tsx';
import { stepScale } from '../src/ui/hooks.ts';

const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}` }));
const ids = (out: ({ id: string } | number)[]) => out.map((x) => (typeof x === 'number' ? x : x.id));

test('a long thread keeps its first message, a count, then the last folded one and the open ones', () => {
  assert.deepEqual(ids(foldThread(msgs(8), new Set(['m7']), false)), ['m0', 5, 'm6', 'm7']);
  assert.deepEqual(ids(foldThread(msgs(8), new Set(['m5', 'm7']), false)), ['m0', 3, 'm4', 'm5', 'm6', 'm7']);
});

test('short threads, and a thread opened out, show every message', () => {
  assert.deepEqual(ids(foldThread(msgs(3), new Set(['m2']), false)), ['m0', 'm1', 'm2']);
  assert.deepEqual(ids(foldThread(msgs(4), new Set(['m3']), false)), ['m0', 'm1', 'm2', 'm3']);
  assert.deepEqual(ids(foldThread(msgs(8), new Set(['m7']), true)), ids(msgs(8)));
});

test('text size steps through the scale and stops at its ends', () => {
  assert.equal(stepScale(1, 1), 1.08);
  assert.equal(stepScale(1, -1), 0.92);
  assert.equal(stepScale(1.5, 1), 1.5);
  assert.equal(stepScale(0.85, -1), 0.85);
});
