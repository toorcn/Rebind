/** Pure projection of confirmed data; never infer payment from a submitted tx. */
export function paymentView(mode, job) {
  const unit = mode === 'wallet' ? 'dUSD' : 'credits';
  const empty = { phase: 'empty', amount: '0', unit, buyer: false, worker: false, status: 'No payment in escrow yet.', detail: 'Create or select a job to follow its payment.', reason: 'The reward is not in escrow until funding is confirmed.' };
  if (!job) return empty;
  const model = { ...empty, amount: String(mode === 'wallet' ? job.budget : job.reward), buyer: mode === 'wallet' ? job.clientProven : !!job.buyer, worker: mode === 'wallet' ? job.providerProven : !!job.worker };
  const set = (phase, status, detail, reason = detail) => ({ ...model, phase, status, detail, reason });
  if (mode === 'wallet') {
    if (job.status === 'Completed') return set('paid', 'Worker paid', 'Settlement confirmed. Nothing remains in escrow.');
    if (job.status === 'Expired') return set('refunded', 'Refund completed', 'The job is closed. Escrow was returned to the buyer.');
    if (job.status === 'Rejected') return set('closed', 'Job rejected', 'Check the job and transaction history for the disposition of the reward.');
    if (job.status === 'Open') return { ...set('empty', 'Funding not complete', 'The reward has not entered escrow. The buyer can resume funding.'), amount: '0' };
    if (!['Funded', 'Submitted'].includes(job.status)) return set('closed', 'Payment status unavailable', 'Refresh the job to check its confirmed status.');
    if (job.expiredAt * 1000 <= Date.now()) return set('expired', 'Held · Refund available', 'The deadline passed. Funds stay in escrow until the buyer’s refund succeeds.');
    if (job.humans === 'same') return set('blocked', 'Payment blocked', 'Both wallets verified as the same person.', 'The reward remains in escrow. The buyer can claim a refund after expiry.');
    if (job.status === 'Funded') return set('funded', 'Waiting for delivery', 'The reward is held in escrow while the worker completes the job.');
    if (job.clientProven && job.providerProven && job.humans === 'distinct') return set('ready', 'Ready to release', 'Delivery received. Two different people verified.', 'The reward stays in escrow until the settlement transaction succeeds. Use Release payment below.');
  } else {
    if (job.decision?.released) return set('paid', 'Worker paid', 'The confirmed credit payout released the reward.');
    if (job.decision?.reason === 'same-human') return set('blocked', 'Payment blocked', 'Both agents verified as the same person.', 'A different person must verify as the buyer. The reward stays in escrow.');
    if (!job.delivered) return set('funded', 'Waiting for delivery', 'The reward is held in escrow while the worker completes the job.');
    if (job.decision?.reason === 'not-world') return set('invalid', 'World ID verification needed', 'The supplied proofs did not pass the World ID check.');
  }
  const who = !model.buyer && !model.worker ? 'Both people need to verify.' : !model.buyer ? 'The buyer still needs to verify.' : !model.worker ? 'The worker still needs to verify.' : 'The identity check is not complete.';
  return set('waiting', 'Payment held', `Delivery received. ${who}`);
}
