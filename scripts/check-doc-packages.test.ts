// Tests for the F-001 doc package check. Fixed inputs only; does not read the repo.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findProblems } from './check-doc-packages.ts';

const direct = new Set(['firebase', '@concordium/web-sdk', 'tsx']);
const installed = new Set(['firebase', '@concordium/web-sdk', 'tsx', 'left-pad', 'picomatch']);

test('direct dependencies pass', () => {
  assert.deepEqual(findProblems('d.md', 'Uses `firebase` and `@concordium/web-sdk` via `tsx`.', direct, installed), []);
});

test('(a) installed but not direct is reported', () => {
  const p = findProblems('d.md', 'line one\nWe use `left-pad`.', direct, installed);
  assert.equal(p.length, 1);
  assert.match(p[0], /^d\.md:2: left-pad — not a direct dependency/);
});

test('(a) scoped package missing everywhere is reported', () => {
  const p = findProblems('d.md', 'Calls `@acme/sdk`.', direct, installed);
  assert.equal(p.length, 1);
  assert.match(p[0], /@acme\/sdk — not a direct dependency/);
});

test('(a) allowlisted names pass', () => {
  assert.deepEqual(findProblems('d.md', '`@google/genai` removed; advisory in `picomatch`.', direct, installed), []);
});

test('code words that are not installed packages are ignored', () => {
  assert.deepEqual(findProblems('d.md', 'Uses `fetch`, `mode`, `server.ts`.', direct, installed), []);
});

test('(b) F-001: a direct dependency described as not in package.json is reported', () => {
  const p = findProblems('d.md', '`firebase` is used but not in package.json.', direct, installed);
  assert.equal(p.length, 1);
  assert.match(p[0], /firebase — line says it is not in package\.json/);
  const q = findProblems('d.md', '`tsx` was removed from package.json', direct, installed);
  assert.equal(q.length, 1);
});
