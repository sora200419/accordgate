import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PORT, resolvePort } from './port.ts';

const FIXED_WARNING = '[server] PORT is not a valid port number, using 3000.';

function withWarnings<T>(fn: () => T): { result: T; warnings: string[] } {
  const original = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(' '));
  };
  try {
    return { result: fn(), warnings };
  } finally {
    console.warn = original;
  }
}

test('deploy: a valid PORT is used, with no warning', () => {
  for (const [raw, expected] of [['4123', 4123], ['1', 1], ['65535', 65535], ['10000', 10000]] as const) {
    const { result, warnings } = withWarnings(() => resolvePort(raw));
    assert.equal(result, expected, raw);
    assert.deepEqual(warnings, [], raw);
  }
});

test('deploy: a missing or empty PORT falls back to the default without a warning', () => {
  for (const raw of [undefined, '']) {
    const { result, warnings } = withWarnings(() => resolvePort(raw));
    assert.equal(result, DEFAULT_PORT);
    assert.equal(DEFAULT_PORT, 3000);
    assert.deepEqual(warnings, []);
  }
});

test('deploy: an invalid PORT falls back to the default with one fixed warning that does not echo the value', () => {
  for (const raw of ['abc', '0', '-1', '65536', '3000.5', '12ab', ' ', 'NaN', 'Infinity']) {
    const { result, warnings } = withWarnings(() => resolvePort(raw));
    assert.equal(result, DEFAULT_PORT, raw);
    assert.equal(warnings.length, 1, raw);
    assert.equal(warnings[0], FIXED_WARNING, `warning must be the fixed text for ${JSON.stringify(raw)}`);
  }
});
