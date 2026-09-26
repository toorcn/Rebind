import assert from "node:assert/strict";
import { once } from "node:events";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import express from "express";
import { mountJobDesk, type JobDeskHooks } from "../src/jobs";
import { JobPool, WORLD_ISSUER, type Seat } from "../src/pool";

test("credit World verification can recover from terminal and replaced codes", async (t) => {
  const originalFetch = globalThis.fetch;
  const previousId = process.env.WORLD_CLIENT_ID;
  const previousSecret = process.env.WORLD_CLIENT_SECRET;
  process.env.WORLD_CLIENT_ID = "test-client";
  process.env.WORLD_CLIENT_SECRET = "test-secret";
  let worldResponse = async (_url: string, _init?: RequestInit): Promise<Response> => {
    throw new Error("Unexpected World request");
  };
  globalThis.fetch = ((input, init) => {
    const url = String(input);
    if (url.startsWith("https://sandbox.auth.world.org/")) return worldResponse(url, init);
    throw new Error(`Unexpected external request: ${url}`);
  }) as typeof fetch;

  const hooks: JobDeskHooks = {
    pool: new JobPool(),
    jobDevices: new Map(),
    jobPrompts: new Map(),
  };
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  mountJobDesk(app, hooks);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousId === undefined) delete process.env.WORLD_CLIENT_ID;
    else process.env.WORLD_CLIENT_ID = previousId;
    if (previousSecret === undefined) delete process.env.WORLD_CLIENT_SECRET;
    else process.env.WORLD_CLIENT_SECRET = previousSecret;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const request = (path: string, body?: object) => originalFetch(base + path, body ? {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  } : undefined);
  function pendingJob(seat: Seat = "buyer") {
    hooks.pool = new JobPool();
    hooks.jobDevices.clear();
    hooks.jobPrompts.clear();
    const job = hooks.pool.post({ title: "Summary", brief: "Summarize a report", reward: 40, buyerName: "Buyer", workerName: "Worker" });
    hooks.pool.deliver(job.id, "Report delivered");
    if (seat === "worker") hooks.pool.attachProof(job.id, "buyer", { subject: "buyer-subject", issuer: WORLD_ISSUER });
    const key = `${job.id}:${seat}`;
    hooks.jobDevices.set(key, "old-device");
    hooks.jobPrompts.set(key, {
      userCode: "OLD-CODE",
      verificationUri: "https://example.test/verify",
      verificationUriComplete: "https://example.test/verify?code=OLD-CODE",
    });
    return { job, key, seat };
  }

  for (const [error, seat] of [["access_denied", "buyer"], ["expired_token", "worker"]] as const) {
    await t.test(`${error} removes the code and restores Verify ${seat}`, async () => {
      const { job, key } = pendingJob(seat);
      worldResponse = async () => Response.json({ error }, { status: 400 });
      const response = await request(`/jobs/${job.id}/world/pull`, { role: seat });
      assert.equal(response.status, 403);
      assert.equal(hooks.jobDevices.has(key), false);
      assert.equal(hooks.jobPrompts.has(key), false);
      const page = await (await request("/credits?flash=not-approved")).text();
      assert.ok(page.includes(`Verify ${seat}`));
      assert.ok(!page.includes('class="poll" data-poll'));
      assert.ok(!page.includes('aria-label="OLD-CODE"'));
      assert.ok(page.includes('class="diagnostics"><summary>Test verification</summary>'));
    });
  }

  await t.test("pending approval retains the code and offers replacement", async () => {
    const { job, key } = pendingJob();
    worldResponse = async () => Response.json({ error: "authorization_pending" }, { status: 400 });
    const response = await request(`/jobs/${job.id}/world/pull`, { role: "buyer" });
    assert.equal(response.status, 202);
    assert.equal(hooks.jobDevices.get(key), "old-device");
    const page = await (await request("/credits")).text();
    assert.ok(page.includes('aria-label="OLD-CODE"'));
    assert.ok(page.includes("Start a new code</button>"));
    assert.ok(page.includes(`action="/jobs/${job.id}/world/start"`));
    assert.ok(page.includes('class="poll" data-poll'));
  });

  await t.test("an orphaned prompt is removed before rendering recovery", async () => {
    const { job, key } = pendingJob();
    hooks.jobDevices.delete(key);
    const response = await request(`/jobs/${job.id}/world/pull`, { role: "buyer" });
    assert.equal(response.status, 404);
    assert.equal(hooks.jobPrompts.has(key), false);
    assert.ok((await (await request("/credits")).text()).includes("Verify buyer"));
  });

  await t.test("a temporary World outage retains the current code for retry", async () => {
    const { job, key } = pendingJob();
    worldResponse = async () => Response.json({}, { status: 502 });
    const response = await request(`/jobs/${job.id}/world/pull`, { role: "buyer" });
    assert.equal(response.status, 502);
    assert.equal(hooks.jobDevices.get(key), "old-device");
    assert.equal(hooks.jobPrompts.get(key)?.userCode, "OLD-CODE");
  });

  await t.test("a delayed denial cannot erase a newly requested code", async () => {
    const { job, key } = pendingJob();
    let resolveOld!: (response: Response) => void;
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => { requestStarted = resolve; });
    worldResponse = async (url) => {
      if (url.endsWith("/token")) {
        requestStarted();
        return new Promise<Response>((resolve) => { resolveOld = resolve; });
      }
      return Response.json({
        device_code: "new-device", user_code: "NEW-CODE",
        verification_uri: "https://example.test/verify", expires_in: 300, interval: 5,
      });
    };
    const oldPull = request(`/jobs/${job.id}/world/pull`, { role: "buyer" });
    await started;
    const replacement = await request(`/jobs/${job.id}/world/start`, { role: "buyer" });
    assert.equal(replacement.status, 201);
    resolveOld(Response.json({ error: "expired_token" }, { status: 400 }));
    const result = await oldPull;
    assert.equal(result.status, 409);
    assert.deepEqual(await result.json(), { attached: false, status: "replaced" });
    assert.equal(hooks.jobDevices.get(key), "new-device");
    assert.equal(hooks.jobPrompts.get(key)?.userCode, "NEW-CODE");
  });

  await t.test("polling retries transient failures in place and stops on denial", async () => {
    pendingJob();
    const page = await (await request("/credits")).text();
    const start = page.indexOf('const poll = document.querySelector("[data-poll]")');
    const end = page.indexOf("function beatTone", start);
    assert.ok(start > 0 && end > start);
    const timers = new Map<number, () => Promise<void>>();
    const listeners = new Map<string, () => void>();
    const navigations: string[] = [];
    const poll = { dataset: { job: "job_12345678", role: "buyer" }, textContent: "", setAttribute() {}, removeAttribute() {} };
    let nextTimer = 0;
    let status = 502;
    runInNewContext(page.slice(start, end), {
      document: {
        hidden: false,
        querySelector: () => poll,
        addEventListener: (event: string, listener: () => void) => listeners.set(event, listener),
      },
      location: { replace: (url: string) => navigations.push(url) },
      setTimeout: (callback: () => Promise<void>) => { timers.set(++nextTimer, callback); return nextTimer; },
      clearTimeout: (id: number) => timers.delete(id),
      fetch: async () => Response.json({ error: "failure" }, { status }),
    });
    async function tick() {
      const entry = timers.entries().next().value;
      assert.ok(entry, "Expected a scheduled approval check");
      timers.delete(entry[0]);
      await entry[1]();
    }
    await tick();
    assert.deepEqual(navigations, []);
    assert.equal(timers.size, 1);
    assert.match(poll.textContent, /Retrying/);
    status = 403;
    await tick();
    assert.deepEqual(navigations, ["/credits?flash=not-approved#desk"]);
    assert.equal(timers.size, 0);
    listeners.get("visibilitychange")?.();
    assert.equal(timers.size, 0, "A terminal code must not restart polling on tab focus");
  });
});
