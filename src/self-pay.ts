import type { Server } from "http";
import { createApp } from "./paygate";
import type { Job, Ledger } from "./pool";
import { AgentBookRegistry } from "./registry";
import { runSelfPay } from "./self-pay-run";

interface PoolBody {
  job?: Job;
  ledger?: Ledger;
  ignored?: string[];
  released?: boolean;
  error?: string;
}

async function startInProcess(): Promise<{ base: string; close: () => Promise<void> }> {
  const registry = new AgentBookRegistry();
  const app = createApp(registry, { mode: "win" });
  const server: Server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind job pool");
  }
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      registry.close();
    },
  };
}

async function postJson(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function assertHttp(base: string): Promise<void> {
  const posted = await postJson(base, "/jobs", {
    title: "Summarize the Tokyo briefing",
    brief: "Five bullets a judge can read in ten seconds.",
    reward: 40,
    buyerName: "Buyer agent",
    workerName: "Worker agent",
    buyer: { subject: "forged-buyer", issuer: "https://sandbox.auth.world.org" },
    worker: { subject: "forged-worker", issuer: "https://sandbox.auth.world.org" },
    released: true,
    differentHumans: true,
  });
  const created = (await posted.json()) as PoolBody;
  if (posted.status !== 201 || !created.job) {
    throw new Error(`post job failed: ${posted.status}`);
  }
  if (created.job.buyer !== null || created.job.worker !== null || created.job.decision.released) {
    throw new Error("a client-supplied proof unlocked the job at post");
  }
  if (created.ledger?.escrow !== 40 || created.ledger.paid !== 0) {
    throw new Error("escrow did not take the reward");
  }

  const id = created.job.id;
  const delivered = await postJson(base, `/jobs/${id}/deliver`, {
    note: "Five bullets, done.",
    released: true,
    differentHumans: true,
    buyerSubject: "forged-buyer",
    workerSubject: "forged-worker",
  });
  const done = (await delivered.json()) as PoolBody;
  if (delivered.status !== 200 || !done.job?.delivered || done.job.decision.released) {
    throw new Error("delivery released the escrow");
  }

  const claim = await postJson(base, `/jobs/${id}/claim`, {
    differentHumans: true,
    buyerSubject: "forged-buyer",
    workerSubject: "forged-worker",
  });
  const claimed = (await claim.json()) as PoolBody;
  if (claim.status !== 200 || !claimed.job) {
    throw new Error(`claim failed: ${claim.status}`);
  }
  if (claimed.job.buyer !== null || claimed.job.worker !== null || claimed.released !== false) {
    throw new Error("client claim wrote proofs");
  }
  if (!claimed.ignored?.includes("differentHumans") || claimed.ledger?.paid !== 0 || claimed.ledger.escrow !== 40) {
    throw new Error("client claim moved the ledger");
  }

  const forged = await postJson(base, `/jobs/${id}/proof`, {
    role: "buyer",
    subject: "forged-buyer",
    issuer: "https://sandbox.auth.world.org",
  });
  if (forged.status !== 404) {
    throw new Error(`forged proof route responded ${forged.status}`);
  }

  const pull = await postJson(base, `/jobs/${id}/world/pull`, {
    role: "buyer",
    subject: "forged-buyer",
    differentHumans: true,
  });
  const pulled = (await pull.json()) as PoolBody;
  if (pull.status === 200 || pulled.job?.buyer) {
    throw new Error("pull attached a subject from the request body");
  }

  const pool = await fetch(`${base}/pool`);
  const view = (await pool.json()) as PoolBody;
  if (view.ledger?.paid !== 0 || view.ledger.counted !== 0 || view.ledger.escrow !== 40) {
    throw new Error("pool ledger counted the self-deal");
  }

  const home = await fetch(`${base}/`);
  const html = await home.text();
  if (home.status !== 200 || !html.includes('id="desk"')) {
    throw new Error("job desk did not render");
  }
  if (!html.includes("Only verified World IDs can unlock payment.")) {
    throw new Error("desk hid the ignored claim");
  }

  console.log("HTTP_CLAIM_IGNORED       paid 0  escrow 40");
  console.log("HTTP_NO_FORGED_RELEASE   body subject was not stored");
}

async function main(): Promise<number> {
  const report = runSelfPay();
  for (const line of report.lines) console.log(line);
  if (!report.passed) return 1;

  const server = await startInProcess();
  try {
    await assertHttp(server.base);
  } finally {
    await server.close();
  }
  console.log("SELF_PAY_PASSED");
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "self-pay failed");
    process.exitCode = 1;
  });
