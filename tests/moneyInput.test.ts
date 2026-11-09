import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoneyInput } from '../src/lib/moneyInput';

test('parses common Russian price formats', () => {
  const examples: Array<[string, number]> = [
    ['19.900', 19900], ['19 900', 19900], ['19\u00a0900', 19900],
    ['19,900', 19900], ['19900,50', 19900.5], ['19900.50', 19900.5],
  ];
  examples.forEach(([source, expected]) => assert.equal(parseMoneyInput(source), expected));
});

test('returns null for an empty field', () => {
  assert.equal(parseMoneyInput(''), null);
});
