import assert from "node:assert/strict";
import { test } from "node:test";
import { runWalkthrough } from "../src/demo-walkthrough";

test("the walkthrough holds payment through delivery and the buyer check, then pays distinct sample identities", () => {
  const { steps } = runWalkthrough();
  assert.equal(steps.length, 4);
  assert.deepEqual(steps.map(step => step.ledger.paid), [0, 0, 0, 40]);
  assert.deepEqual(steps.map(step => step.ledger.escrow), [40, 40, 40, 0]);
  assert.deepEqual(steps.map(step => step.job?.delivered), [false, true, true, true]);
  assert.equal(steps[2]!.job?.worker, null);
  assert.notEqual(steps[3]!.job?.buyer?.subject, steps[3]!.job?.worker?.subject);
  assert.equal(steps[3]!.job?.decision.released, true);
  const another = runWalkthrough();
  assert.equal(another.steps[0]!.ledger.paid, 0);
  assert.notEqual(another.steps[0]!.job?.id, steps[0]!.job?.id);
});
