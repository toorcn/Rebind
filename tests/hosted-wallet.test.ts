import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { createHostedWallet } from "../src/hosted-wallet";
import { renderJobPage } from "../src/job-page";

function response() {
  const state = { code: 200, body: undefined as unknown, cookie: "" };
  const res = {
    status(code: number) { state.code = code; return this; },
    json(body: unknown) { state.body = body; return this; },
    send(body: unknown) { state.body = body; return this; },
    type() { return this; },
    setHeader() { return this; },
    cookie(name: string, value: string) { state.cookie = `${name}=${value}`; return this; },
  } as unknown as Response;
  return { res, state };
}

test("hosted wallet keeps verification state isolated and forwards signed requests", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls: RequestInit[] = [];
  globalThis.fetch = (async (_input, init) => {
    calls.push(init!);
    return new globalThis.Response(JSON.stringify({ attached: true }), {
      headers: { "set-cookie": `rebind_state=state-${calls.length}; Secure; HttpOnly; Path=/` },
    });
  }) as typeof fetch;
  const backend = createHostedWallet();
  const request = async (cookie: string, body: object) => {
    const result = response();
    await backend.relay({ method: "POST", originalUrl: "/chain/world/pull", headers: { cookie, authorization: "must-not-forward" }, body } as Request, result.res, () => {});
    return result.state;
  };
  const signed = { address: "0x1111111111111111111111111111111111111111", signature: "test-signature" };
  const first = await request("rebind_state=local-credit-state; unrelated=private", signed);
  assert.equal((calls[0]!.headers as Record<string, string>).cookie, undefined);
  assert.equal((calls[0]!.headers as Record<string, string>).authorization, undefined);
  assert.equal(calls[0]!.body, JSON.stringify(signed));
  assert.ok(!first.cookie.includes("state-1"));
  await request(first.cookie, signed);
  assert.equal((calls[1]!.headers as Record<string, string>).cookie, "rebind_state=state-1");
  await request("", signed);
  assert.equal((calls[2]!.headers as Record<string, string>).cookie, undefined);
});

test("connected page enables MetaMask and prioritises the real wallet workflow", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = (async () => globalThis.Response.json({
    configured: true, network: "World Chain Sepolia", chainId: 4801, chainIdHex: "0x12c1",
    rpcUrl: "https://example.test/rpc", explorer: "https://example.test", registrar: "0x1",
    addresses: { token: "0x1", registry: "0x2", hook: "0x3", acp: "0x4" },
  })) as typeof fetch;
  const chain = await createHostedWallet().status();
  const html = renderJobPage({ jobs: [], ledger: { escrow: 0, refused: 0, paid: 0, counted: 0 }, prompts: new Map(), flash: "", chain });
  assert.ok(html.includes('href="#wallet-desk">Create a wallet job'));
  assert.ok(html.includes('id="wallet-desk"'));
  assert.ok(!html.includes('id="desk"'));
  assert.ok(!html.includes('id="in-app-demo"'));
  for (const id of ["connect", "connect-browser", "mint", "open-job"]) {
    const button = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(button, id);
    assert.ok(!button.includes("disabled"), `${id} must be enabled`);
  }
  assert.equal(chain.demoAvailable, false);
});

test("hosted wallet fails closed on invalid paths and backend failures", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("offline"); }) as typeof fetch;
  const backend = createHostedWallet();
  for (const originalUrl of ["//another.example/chain", "/chain/../other"]) {
    const result = response();
    await backend.relay({ method: "GET", originalUrl, headers: {} } as Request, result.res, () => {});
    assert.equal(result.state.code, 400);
  }
  assert.equal(calls, 0);
  const result = response();
  await backend.relay({ method: "GET", originalUrl: "/chain/board", headers: {} } as Request, result.res, () => {});
  assert.equal(result.state.code, 502);
});
