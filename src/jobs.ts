import type { Express, Request, Response } from "express";
import type { WorldPrompt } from "./durable-state";
import { renderJobPage } from "./job-page";
import { JobPool, WORLD_ISSUER, type Seat } from "./pool";
import { runSelfPay } from "./self-pay-run";
import { pullValidatedSubject, startDeviceGrant } from "./world-oidc";

export interface JobDeskHooks {
  pool: JobPool;
  jobDevices: Map<string, string>;
  jobPrompts: Map<string, WorldPrompt>;
}

const IGNORED_CLAIM_FIELDS = ["differentHumans", "buyerSubject", "workerSubject"] as const;

function wantsJson(req: Request): boolean {
  return (req.header("content-type") ?? "").includes("application/json");
}

function readBounded(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

function readReward(value: unknown): number | null {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(raw) || raw < 1 || raw > 500) return null;
  return raw;
}

function readSeat(value: unknown): Seat | null {
  if (value === "buyer" || value === "worker") return value;
  return null;
}

function jobId(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  if (!/^job_[a-f0-9]{8}$/.test(value)) return null;
  return value;
}

function deviceKey(id: string, seat: Seat): string {
  return `${id}:${seat}`;
}

function flashOf(value: unknown): string {
  if (
    value === "waiting" ||
    value === "not-approved" ||
    value === "world-down" ||
    value === "world-error" ||
    value === "bad" ||
    value === "missing"
  ) {
    return value;
  }
  return "";
}

function sendJob(req: Request, res: Response, status: number, body: unknown, flash = ""): void {
  if (wantsJson(req)) {
    res.status(status).json(body);
    return;
  }
  const suffix = flash ? `?flash=${flash}` : "";
  res.redirect(`/${suffix}`);
}

export function mountJobDesk(app: Express, hooks: JobDeskHooks): void {
  app.get("/", (req: Request, res: Response) => {
    res.type("html").send(
      renderJobPage({
        jobs: hooks.pool.list(),
        ledger: hooks.pool.ledger(),
        prompts: hooks.jobPrompts,
        flash: flashOf(req.query.flash),
      })
    );
  });

  app.get("/pool", (_req: Request, res: Response) => {
    res.json({ ledger: hooks.pool.ledger(), jobs: hooks.pool.list() });
  });

  app.get("/jobs/:id", (req: Request, res: Response) => {
    const id = jobId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "job id is required" });
      return;
    }
    const job = hooks.pool.get(id);
    if (!job) {
      res.status(404).json({ job: null });
      return;
    }
    res.json({ job, ledger: hooks.pool.ledger() });
  });

  app.post("/jobs", (req: Request, res: Response) => {
    const title = readBounded(req.body?.title, 80);
    const brief = readBounded(req.body?.brief, 280);
    const buyerName = readBounded(req.body?.buyerName, 40);
    const workerName = readBounded(req.body?.workerName, 40);
    const reward = readReward(req.body?.reward);
    if (!title || !brief || !buyerName || !workerName || reward === null) {
      sendJob(req, res, 400, { error: "title, brief, reward, buyerName, and workerName are required" }, "bad");
      return;
    }
    const job = hooks.pool.post({ title, brief, reward, buyerName, workerName });
    sendJob(req, res, 201, { job, ledger: hooks.pool.ledger() });
  });

  app.post("/jobs/:id/deliver", (req: Request, res: Response) => {
    const id = jobId(req.params.id);
    const note = readBounded(req.body?.note, 280);
    if (!id || !note) {
      sendJob(req, res, 400, { error: "job id and note are required" }, "bad");
      return;
    }
    try {
      const job = hooks.pool.deliver(id, note);
      sendJob(req, res, 200, { job, ledger: hooks.pool.ledger() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Deliver failed";
      sendJob(req, res, 404, { error: message }, "missing");
    }
  });

  app.post("/jobs/:id/claim", (req: Request, res: Response) => {
    const id = jobId(req.params.id);
    if (!id) {
      sendJob(req, res, 400, { error: "job id is required" }, "bad");
      return;
    }
    try {
      const job = hooks.pool.noteClaimIgnored(id);
      sendJob(req, res, 200, {
        job,
        ledger: hooks.pool.ledger(),
        ignored: IGNORED_CLAIM_FIELDS,
        released: job.decision.released,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Claim failed";
      sendJob(req, res, 404, { error: message }, "missing");
    }
  });

  app.post("/jobs/:id/world/start", async (req: Request, res: Response) => {
    const id = jobId(req.params.id);
    const seat = readSeat(req.body?.role);
    if (!id || !seat) {
      sendJob(req, res, 400, { error: "job id and role are required" }, "bad");
      return;
    }
    if (!hooks.pool.get(id)) {
      sendJob(req, res, 404, { error: "Job not found" }, "missing");
      return;
    }
    try {
      const live = await startDeviceGrant();
      if (!live) {
        sendJob(
          req,
          res,
          501,
          { error: "Set WORLD_CLIENT_ID and WORLD_CLIENT_SECRET to start sandbox.auth.world.org" },
          "world-down"
        );
        return;
      }
      const key = deviceKey(id, seat);
      hooks.jobDevices.set(key, live.deviceCode);
      hooks.jobPrompts.set(key, {
        userCode: live.userCode,
        verificationUri: live.verificationUri,
        verificationUriComplete: live.verificationUriComplete ?? live.verificationUri,
      });
      if (!wantsJson(req)) {
        res.redirect("/");
        return;
      }
      res.status(201).json({
        role: seat,
        userCode: live.userCode,
        verificationUri: live.verificationUri,
        verificationUriComplete: live.verificationUriComplete,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "World grant failed";
      sendJob(req, res, 502, { error: message }, "world-error");
    }
  });

  app.post("/jobs/:id/world/pull", async (req: Request, res: Response) => {
    const id = jobId(req.params.id);
    const seat = readSeat(req.body?.role);
    if (!id || !seat) {
      sendJob(req, res, 400, { error: "job id and role are required" }, "bad");
      return;
    }
    const deviceCode = hooks.jobDevices.get(deviceKey(id, seat));
    if (!deviceCode) {
      sendJob(req, res, 404, { error: "No live device grant for this seat" }, "world-error");
      return;
    }
    const result = await pullValidatedSubject(deviceCode);
    if (result.kind === "pending") {
      sendJob(req, res, 202, { attached: false, status: "pending" }, "waiting");
      return;
    }
    if (result.kind === "denied") {
      sendJob(req, res, 403, { attached: false, error: result.error }, "not-approved");
      return;
    }
    try {
      const job = hooks.pool.attachProof(id, seat, { subject: result.subject, issuer: WORLD_ISSUER });
      hooks.jobDevices.delete(deviceKey(id, seat));
      hooks.jobPrompts.delete(deviceKey(id, seat));
      sendJob(req, res, 200, { attached: true, job, ledger: hooks.pool.ledger() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Attach failed";
      sendJob(req, res, 404, { error: message }, "missing");
    }
  });

  app.post("/demo/self-pay", (_req: Request, res: Response) => {
    const report = runSelfPay();
    res.status(report.passed ? 200 : 500).json(report);
  });
}
