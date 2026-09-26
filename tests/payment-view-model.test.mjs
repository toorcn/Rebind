import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paymentView } from '../src/payment-view-model.mjs';

const job = { id: '1', budget: '72', status: 'Submitted', expiredAt: Date.now() / 1000 + 3600, clientProven: true, providerProven: true, humans: 'distinct' };

test('verified delivery stays in escrow until a confirmed completion', () => {
  assert.equal(paymentView('wallet', job).phase, 'ready');
  assert.equal(paymentView('wallet', { ...job, status: 'Funded' }).phase, 'funded');
  const paid = paymentView('wallet', { ...job, status: 'Completed' });
  assert.equal(paid.phase, 'paid');
  assert.equal(paid.amount, '72');
  assert.equal(paid.unit, 'dUSD');
  assert.equal(paymentView('wallet', { ...job, status: 'Open' }).amount, '0');
});

test('same-person and missing proofs cannot look like successful payment', () => {
  assert.equal(paymentView('wallet', { ...job, humans: 'same' }).phase, 'blocked');
  const waiting = paymentView('wallet', { ...job, providerProven: false, humans: 'waiting' });
  assert.equal(waiting.phase, 'waiting');
  assert.match(waiting.detail, /worker still needs to verify/);
  assert.equal(paymentView('wallet', { ...job, status: 'Unknown' }).phase, 'closed');
});

test('an elapsed deadline does not falsely display a completed refund', () => {
  const expired = { ...job, expiredAt: 1 };
  assert.equal(paymentView('wallet', expired).phase, 'expired');
  assert.match(paymentView('wallet', expired).detail, /Funds stay in escrow/);
  assert.equal(paymentView('wallet', { ...expired, status: 'Expired' }).phase, 'refunded');
  assert.equal(paymentView('wallet', { ...expired, status: 'Completed' }).phase, 'paid');
});

test('credit and sample views follow the server decision and retain credit units', () => {
  const credits = { id: 'credit-1', reward: 19, delivered: true, buyer: {}, worker: {}, decision: { released: false, reason: 'same-human' } };
  assert.equal(paymentView('demo', credits).phase, 'blocked');
  assert.equal(paymentView('credits', credits).unit, 'credits');
  assert.equal(paymentView('demo', { ...credits, decision: { released: true, reason: 'released' } }).phase, 'paid');
  assert.equal(paymentView('demo', null).phase, 'empty');
});
