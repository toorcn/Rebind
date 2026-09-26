import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { Script } from "node:vm";
import express from "express";
import { mountJobDesk } from "../src/jobs";
import { JobPool } from "../src/pool";

test("wallet and demo pages stay separate through the credit form flow", async (t) => {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  mountJobDesk(app, { pool: new JobPool(), jobDevices: new Map(), jobPrompts: new Map() });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const wallet = await (await fetch(base)).text();
  const demo = await (await fetch(`${base}/credits`)).text();
  assert.ok(wallet.includes('id="wallet-desk"'));
  assert.ok(wallet.includes('href="/credits"'));
  for (const id of ["desk", "in-app-demo", "play-take"]) assert.ok(!wallet.includes(`id="${id}"`));
  assert.ok(demo.includes('class="demo-page"'));
  assert.ok(demo.includes("These jobs do not move tokens"));
  assert.ok(demo.includes('id="desk"'));
  assert.ok(demo.includes('id="in-app-demo"'));
  for (const id of ["wallet-desk", "connect", "rebind-config", "play-chain"]) assert.ok(!demo.includes(`id="${id}"`));
  assert.ok(!demo.includes("connectWithQr"));
  assert.match(demo, /<details class="workspace advanced-demo" id="desk"\s*>/);
  for (const html of [wallet, demo]) {
    for (const [, anchor] of html.matchAll(/href="#([^"]+)"/g)) {
      assert.ok(html.includes(`id="${anchor}"`), `Missing anchor target: ${anchor}`);
    }
    for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (!match[1]?.includes("application/json")) new Script(match[2]!);
    }
  }
  const post = (path: string, body: Record<string, string>) => fetch(base + path, {
    method: "POST", body: new URLSearchParams(body), redirect: "manual",
  });
  const created = await post("/jobs", { title: "Separate credit job", brief: "Demo only", reward: "40", buyerName: "Buyer", workerName: "Worker" });
  assert.equal(created.headers.get("location"), "/credits#desk");
  const pool = await (await fetch(`${base}/pool`)).json();
  const delivered = await post(`/jobs/${pool.jobs[0].id}/deliver`, { note: "Demo delivery" });
  assert.equal(delivered.headers.get("location"), "/credits#desk");
  const page = await (await fetch(`${base}/credits`)).text();
  assert.ok(page.includes("Verify buyer"));
  assert.ok(page.includes('id="desk" open'));
  assert.ok(!(await (await fetch(base)).text()).includes("Separate credit job"));
  const invalid = await post("/jobs", { title: "" });
  assert.equal(invalid.headers.get("location"), "/credits?flash=bad#desk");
});
