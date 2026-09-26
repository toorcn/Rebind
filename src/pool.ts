import { randomBytes } from "crypto";

/** Pairwise subjects count only when the sandbox issuer signed them. */
export const WORLD_ISSUER = "https://sandbox.auth.world.org";

export type Seat = "buyer" | "worker";

export interface Proof {
  subject: string;
  issuer: string;
}

export type SettleReason =
  | "not-delivered"
  | "awaiting-both"
  | "awaiting-buyer"
  | "awaiting-worker"
  | "not-world"
  | "same-human"
  | "released";

export interface Decision {
  released: boolean;
  counted: boolean;
  reason: SettleReason;
}

export interface Job {
  id: string;
  title: string;
  brief: string;
  reward: number;
  buyerName: string;
  workerName: string;
  note: string | null;
  delivered: boolean;
  buyer: Proof | null;
  worker: Proof | null;
  claimIgnored: boolean;
  decision: Decision;
}

export interface JobDraft {
  title: string;
  brief: string;
  reward: number;
  buyerName: string;
  workerName: string;
}

export interface Ledger {
  escrow: number;
  paid: number;
  refused: number;
  counted: number;
}

const MAX_JOBS = 12;

/** The only payout rule. Client claims are not an argument. */
export function decidePayout(job: Pick<Job, "delivered" | "buyer" | "worker">): Decision {
  if (!job.delivered) {
    return { released: false, counted: false, reason: "not-delivered" };
  }
  const buyer = job.buyer;
  const worker = job.worker;
  if (!buyer && !worker) {
    return { released: false, counted: false, reason: "awaiting-both" };
  }
  if (!buyer) {
    return { released: false, counted: false, reason: "awaiting-buyer" };
  }
  if (!worker) {
    return { released: false, counted: false, reason: "awaiting-worker" };
  }
  if (buyer.issuer !== WORLD_ISSUER || worker.issuer !== WORLD_ISSUER) {
    return { released: false, counted: false, reason: "not-world" };
  }
  if (buyer.subject === worker.subject) {
    return { released: false, counted: false, reason: "same-human" };
  }
  return { released: true, counted: true, reason: "released" };
}

function settle(job: Omit<Job, "decision">): Job {
  return { ...job, decision: decidePayout(job) };
}

function copyProof(proof: Proof | null): Proof | null {
  if (!proof) return null;
  return { subject: proof.subject, issuer: proof.issuer };
}

export function jobsFromUnknown(value: unknown): Job[] {
  if (!Array.isArray(value)) return [];
  const jobs: Job[] = [];
  for (const item of value) {
    const job = parseJob(item);
    if (job) jobs.push(job);
  }
  return jobs;
}

function parseJob(value: unknown): Job | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Partial<Job>;
  if (typeof raw.id !== "string" || typeof raw.title !== "string") return null;
  if (typeof raw.brief !== "string" || typeof raw.reward !== "number") return null;
  if (typeof raw.buyerName !== "string" || typeof raw.workerName !== "string") return null;
  if (typeof raw.delivered !== "boolean" || typeof raw.claimIgnored !== "boolean") return null;
  return settle({
    id: raw.id,
    title: raw.title,
    brief: raw.brief,
    reward: raw.reward,
    buyerName: raw.buyerName,
    workerName: raw.workerName,
    note: typeof raw.note === "string" ? raw.note : null,
    delivered: raw.delivered,
    buyer: parseProof(raw.buyer),
    worker: parseProof(raw.worker),
    claimIgnored: raw.claimIgnored,
  });
}

function parseProof(value: unknown): Proof | null {
  if (typeof value !== "object" || value === null) return null;
  const proof = value as Partial<Proof>;
  if (typeof proof.subject !== "string" || proof.subject.length === 0) return null;
  if (typeof proof.issuer !== "string" || proof.issuer.length === 0) return null;
  return { subject: proof.subject, issuer: proof.issuer };
}

export function focusJob(jobs: Job[]): Job | null {
  if (jobs.length === 0) return null;
  return jobs[jobs.length - 1] ?? null;
}

/**
 * Escrow for agent jobs. Proofs are attached only by the server after it
 * checks a token. A stored decision is recomputed from those proofs.
 */
export class JobPool {
  private jobs: Job[] = [];

  post(draft: JobDraft): Job {
    const job = settle({
      id: `job_${randomBytes(4).toString("hex")}`,
      title: draft.title,
      brief: draft.brief,
      reward: draft.reward,
      buyerName: draft.buyerName,
      workerName: draft.workerName,
      note: null,
      delivered: false,
      buyer: null,
      worker: null,
      claimIgnored: false,
    });
    this.jobs.push(job);
    if (this.jobs.length > MAX_JOBS) {
      this.jobs.splice(0, this.jobs.length - MAX_JOBS);
    }
    return this.public(job);
  }

  deliver(id: string, note: string): Job {
    const job = this.require(id);
    job.delivered = true;
    job.note = note;
    job.decision = decidePayout(job);
    return this.public(job);
  }

  attachProof(id: string, seat: Seat, proof: Proof): Job {
    if (proof.subject.trim().length === 0 || proof.subject.length > 300) {
      throw new Error("Subject is missing");
    }
    if (proof.issuer.trim().length === 0 || proof.issuer.length > 200) {
      throw new Error("Issuer is missing");
    }
    const job = this.require(id);
    const stored = { subject: proof.subject, issuer: proof.issuer };
    if (seat === "buyer") job.buyer = stored;
    else job.worker = stored;
    job.decision = decidePayout(job);
    return this.public(job);
  }

  /** Records that a client tried to declare the humans. Proofs stay as they were. */
  noteClaimIgnored(id: string): Job {
    const job = this.require(id);
    job.claimIgnored = true;
    job.decision = decidePayout(job);
    return this.public(job);
  }

  get(id: string): Job | null {
    const job = this.jobs.find((item) => item.id === id);
    return job ? this.public(job) : null;
  }

  list(): Job[] {
    return this.jobs.map((job) => this.public(job));
  }

  ledger(): Ledger {
    let escrow = 0;
    let paid = 0;
    let refused = 0;
    for (const job of this.jobs) {
      const decision = decidePayout(job);
      if (decision.released) paid += job.reward;
      else escrow += job.reward;
      if (decision.reason === "same-human") refused += job.reward;
    }
    return { escrow, paid, refused, counted: paid };
  }

  replaceAll(jobs: Job[]): void {
    this.jobs = jobs.map((job) =>
      settle({
        id: job.id,
        title: job.title,
        brief: job.brief,
        reward: job.reward,
        buyerName: job.buyerName,
        workerName: job.workerName,
        note: job.note,
        delivered: job.delivered,
        buyer: copyProof(job.buyer),
        worker: copyProof(job.worker),
        claimIgnored: job.claimIgnored,
      })
    );
  }

  private require(id: string): Job {
    const job = this.jobs.find((item) => item.id === id);
    if (!job) throw new Error("Job not found");
    return job;
  }

  private public(job: Job): Job {
    return {
      ...job,
      buyer: copyProof(job.buyer),
      worker: copyProof(job.worker),
      decision: { ...job.decision },
    };
  }
}
