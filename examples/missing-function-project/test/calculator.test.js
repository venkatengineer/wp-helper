import test from 'node:test';
import assert from 'node:assert/strict';
import { add, subtract } from '../src/calculator.js';

test('subtract subtracts two numbers', () => {
  assert.equal(subtract(5, 2), 3);
});

test('add adds two numbers together', () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(-1, 1), 0);
  assert.equal(add(10, -5), 5);
});
