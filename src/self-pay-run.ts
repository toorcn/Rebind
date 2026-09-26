import { JobPool, WORLD_ISSUER, type Ledger } from "./pool";

export interface SelfPayBeat {
  stamp: string;
  title: string;
  detail: string;
  escrow: number;
  paid: number;
  refused: number;
}

export interface SelfPayReport {
  passed: boolean;
  beats: SelfPayBeat[];
  lines: string[];
}

const SAME = "sub_one_phone";
const SECOND = "sub_second_human";

function beat(stamp: string, title: string, detail: string, ledger: Ledger): SelfPayBeat {
  return {
    stamp,
    title,
    detail,
    escrow: ledger.escrow,
    paid: ledger.paid,
    refused: ledger.refused,
  };
}

/**
 * One human finishes the job, a forged "different humans" claim does nothing,
 * a local issuer does not pay, and a second World subject releases the escrow.
 * Subjects here are fixtures the server attaches itself. They are not a World App approval.
 */
export function runSelfPay(): SelfPayReport {
  const lines: string[] = [];
  const beats: SelfPayBeat[] = [];
  const pool = new JobPool();
  const job = pool.post({
    title: "Summarize the Tokyo briefing",
    brief: "Five bullets a judge can read in ten seconds.",
    reward: 40,
    buyerName: "Buyer agent",
    workerName: "Worker agent",
  });
  pool.deliver(job.id, "Five bullets, done.");
  const delivered = pool.ledger();
  beats.push(
    beat(
      "DELIVERED",
      "The work is finished",
      "Both agents are done. No human has checked in, so the credits stay in escrow.",
      delivered
    )
  );

  pool.noteClaimIgnored(job.id);
  const afterClaim = pool.get(job.id);
  const claimIgnored =
    afterClaim !== null &&
    afterClaim.buyer === null &&
    afterClaim.worker === null &&
    afterClaim.claimIgnored &&
    afterClaim.decision.released === false;
  beats.push(
    beat(
      "CLIENT_CLAIM_IGNORED",
      "The client said the humans differ",
      "differentHumans was true and two subject ids were in the body. The pool stored neither proof.",
      pool.ledger()
    )
  );

  pool.attachProof(job.id, "buyer", { subject: SAME, issuer: WORLD_ISSUER });
  pool.attachProof(job.id, "worker", { subject: SAME, issuer: WORLD_ISSUER });
  const same = pool.get(job.id);
  const sameLedger = pool.ledger();
  const sameHeld =
    same?.decision.reason === "same-human" &&
    same.decision.released === false &&
    same.decision.counted === false &&
    sameLedger.paid === 0 &&
    sameLedger.escrow === 40 &&
    sameLedger.refused === 40 &&
    sameLedger.counted === 0;
  beats.push(
    beat(
      "SAME_HUMAN",
      "One phone approved both sides",
      "The subject ids match. The job looks done. The payout stays locked and does not count.",
      sameLedger
    )
  );

  const local = new JobPool();
  const decoy = local.post({
    title: "Local stand-in",
    brief: "Subjects minted outside World App.",
    reward: 40,
    buyerName: "Buyer agent",
    workerName: "Worker agent",
  });
  local.deliver(decoy.id, "Done.");
  local.attachProof(decoy.id, "buyer", { subject: "local-a", issuer: "local-sandbox" });
  local.attachProof(decoy.id, "worker", { subject: "local-b", issuer: "local-sandbox" });
  const localJob = local.get(decoy.id);
  const notWorld =
    localJob?.decision.reason === "not-world" &&
    localJob.decision.released === false &&
    local.ledger().paid === 0;
  beats.push(
    beat(
      "NOT_A_WORLD_PROOF",
      "A local issuer cannot open the pool",
      "The subjects differ, and the issuer is local-sandbox. Paid out stays 0.",
      local.ledger()
    )
  );

  pool.attachProof(job.id, "buyer", { subject: SECOND, issuer: WORLD_ISSUER });
  const released = pool.get(job.id);
  const paidLedger = pool.ledger();
  const paidOut =
    released?.decision.reason === "released" &&
    released.decision.released === true &&
    released.decision.counted === true &&
    released.buyer?.subject === SECOND &&
    released.worker?.subject === SAME &&
    paidLedger.paid === 40 &&
    paidLedger.escrow === 0 &&
    paidLedger.refused === 0 &&
    paidLedger.counted === 40;
  beats.push(
    beat(
      "PAYOUT_RELEASED",
      "A second human proves the buyer",
      "The server checked two sandbox subjects and they differ. 40 credits leave escrow and count.",
      paidLedger
    )
  );

  const passed =
    delivered.paid === 0 &&
    delivered.escrow === 40 &&
    claimIgnored &&
    sameHeld &&
    notWorld &&
    paidOut;

  for (const item of beats) {
    lines.push(
      `${item.stamp.padEnd(22)} escrow ${item.escrow}  paid ${item.paid}  refused ${item.refused}`
    );
  }
  lines.push(passed ? "SELF_PAY_RULE_HELD" : "SELF_PAY_RULE_FAILED");

  return { passed, beats, lines };
}
