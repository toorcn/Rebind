const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const BUYER = "0x" + "1".repeat(40);
const WORKER = "0x" + "2".repeat(40);
const CHAIN = "0x12c1";
const CONTRACT = "0x" + "3".repeat(40);
const source = readFileSync(join(__dirname, "../src/wallet-browser.js"), "utf8");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function makeJob(overrides = {}) {
  return {
    id: "1", status: "Funded", client: BUYER, provider: WORKER,
    budget: "40", description: "Deliver a report", expiredAt: Math.floor(Date.now() / 1000) + 2700,
    clientProven: false, providerProven: false, humans: "unknown", ...overrides,
  };
}

// Only browser primitives are mocked. The shipped event handlers, rendering,
// provider calls, persistence and API workflow run unchanged in the VM.
class Element {
  constructor(document, tagName, attributes = {}, parent = null) {
    this.document = document;
    this.tagName = tagName;
    this.attributes = { ...attributes };
    this.id = attributes.id || "";
    this.parent = parent;
    this.children = [];
    this.listeners = new Map();
    this.disabled = "disabled" in attributes;
    this.hidden = "hidden" in attributes;
    this.value = attributes.value || "";
    this.textContent = "";
    if (this.id) document.nodes.set(this.id, this);
    if (parent) parent.children.push(this);
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) || [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }
  click() {
    if (!this.disabled) for (const listener of this.listeners.get("click") || []) listener({ currentTarget: this });
  }
  scrollIntoView() {}
  focus() { this.document.activeElement = this; }
  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  querySelectorAll(selector) {
    assert.equal(selector, "button", "Add explicit support for new DOM selectors");
    return this.descendants().filter((node) => node.tagName === "button");
  }
  set innerHTML(html) {
    for (const node of this.descendants()) if (node.id) this.document.nodes.delete(node.id);
    this.children = [];
    this.html = html;
    for (const match of html.matchAll(/<(button|input|textarea|a)\b([^>]*)>/g)) {
      const attributes = {};
      for (const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) attributes[attr[1]] = attr[2];
      new Element(this.document, match[1], attributes, this);
    }
    if (this.document.onRender) this.document.onRender(this);
  }
  get innerHTML() { return this.html || ""; }
}

function makeDocument(config) {
  const document = {
    nodes: new Map(),
    getElementById(id) { return this.nodes.get(id) || null; },
    querySelectorAll(selector) {
      const results = selector.split(",").flatMap((part) => {
        const value = part.trim();
        if (value === "#wallet-desk button") return this.getElementById("wallet-desk").querySelectorAll("button");
        assert.match(value, /^#[\w-]+$/, "Add explicit support for new DOM selectors");
        const node = this.getElementById(value.slice(1));
        return node ? [node] : [];
      });
      return [...new Set(results)];
    },
  };
  new Element(document, "script", { id: "rebind-config" }).textContent = JSON.stringify(config);
  const desk = new Element(document, "section", { id: "wallet-desk" });
  for (const id of ["connect", "connect-browser", "mint", "switch-chain", "fill-worker", "sample-brief", "open-job"]) {
    new Element(document, "button", { id }, desk);
  }
  for (const id of ["description", "worker", "budget"]) new Element(document, "input", { id, value: id === "budget" ? "40" : "" }, desk);
  for (const id of ["description-error", "worker-error", "budget-error"]) new Element(document, "p", { id, hidden: "" }, desk);
  for (const id of ["chain-line", "account-line", "eth", "dusd", "wallet-status", "open-status", "job-status", "job-title", "board", "job", "job-body"]) {
    new Element(document, "div", { id }, desk);
  }
  return document;
}

function makeBackend(jobs = [makeJob()]) {
  return { jobs: new Map(jobs.map((job) => [String(job.id), job])), prompts: new Map(), requests: [], transactions: [], receipts: new Map(), rejectAction: "" };
}

function createHarness(options = {}) {
  const backend = options.backend || makeBackend();
  const storage = options.storage || new Map();
  const config = { configured: true, chainIdHex: CHAIN, network: "Test chain", addresses: { acp: CONTRACT }, explorer: "https://explorer.test", ...options.config };
  const document = makeDocument(config);
  const provider = {
    accounts: options.accounts || [BUYER], chainId: options.chainId || CHAIN, listeners: new Map(),
    on(name, listener) {
      const list = this.listeners.get(name) || [];
      list.push(listener);
      this.listeners.set(name, list);
    },
    emit(name, payload) {
      if (name === "accountsChanged") this.accounts = payload;
      if (name === "chainChanged") this.chainId = payload;
      for (const listener of this.listeners.get(name) || []) listener(payload);
    },
    async request(request) {
      if (app.onProviderRequest) {
        const response = app.onProviderRequest(request);
        if (response !== undefined) return response;
      }
      switch (request.method) {
        case "eth_accounts": case "eth_requestAccounts": return this.accounts;
        case "eth_chainId": return this.chainId;
        case "wallet_switchEthereumChain": this.chainId = request.params[0].chainId; return null;
        case "personal_sign": return "0xsignature";
        case "eth_getTransactionReceipt": return backend.receipts.get(request.params[0]) || null;
        case "eth_sendTransaction": {
          const tx = JSON.parse(request.params[0].data);
          backend.transactions.push(tx);
          if (backend.rejectAction === tx.action) {
            backend.rejectAction = "";
            throw Object.assign(new Error("Rejected"), { code: 4001 });
          }
          const hash = "0x" + backend.transactions.length.toString(16).padStart(64, "0");
          let jobId = String(tx.jobId || "");
          if (tx.action === "create") {
            jobId = String(backend.jobs.size + 1);
            backend.jobs.set(jobId, makeJob({ id: jobId, status: "Open", budget: "0", client: request.params[0].from, provider: tx.worker, description: tx.description }));
          }
          if (tx.action === "setBudget") backend.jobs.get(jobId).budget = String(tx.budget);
          if (tx.action === "fund") backend.jobs.get(jobId).status = "Funded";
          backend.receipts.set(hash, { status: "0x1", jobId });
          return hash;
        }
        default: throw new Error("Unexpected wallet request: " + request.method);
      }
    },
  };
  const app = {
    backend, storage, document, provider,
    node: (id) => document.getElementById(id),
    async settle(turns = 6) { for (let i = 0; i < turns; i += 1) await new Promise(setImmediate); },
    async click(id) {
      assert.ok(this.node(id), "Missing button " + id);
      assert.equal(this.node(id).disabled, false, "Button " + id + " should be available");
      this.node(id).click();
      await this.settle();
    },
    async selectJob(id = "1") {
      const button = this.node("board").querySelectorAll("button").find((node) => node.getAttribute("data-job") === id);
      assert.ok(button, "Expected job on board: " + id);
      button.click();
      await this.settle();
    },
  };
  async function fetch(path, init = {}) {
    const data = init.body ? JSON.parse(init.body) : {};
    backend.requests.push({ path, data });
    if (app.onFetch) {
      const response = app.onFetch(path, data);
      if (response !== undefined) return response;
    }
    let body;
    if (path === "/chain/board") body = { jobs: [...backend.jobs.values()] };
    else if (path.startsWith("/chain/accounts/")) body = { account: { address: path.split("/").pop(), eth: "1", dusd: "1000", allowance: "1000" } };
    else if (path.startsWith("/chain/jobs/")) {
      const job = backend.jobs.get(path.split("/").pop());
      assert.ok(job, "Unknown job " + path);
      body = { job };
    } else if (path === "/chain/prepare") body = { label: data.action, to: CONTRACT, data: JSON.stringify(data) };
    else if (path === "/chain/receipt") body = { jobId: backend.receipts.get(data.hash)?.jobId };
    else if (path === "/chain/world/start") {
      body = { userCode: "CODE-" + data.address.slice(-4), verificationUri: "https://world.test/verify", verificationUriComplete: "https://world.test/verify?code=custom" };
      backend.prompts.set(data.address, body);
    } else if (path === "/chain/world/pull") body = { attached: true };
    else if (path.startsWith("/chain/world/")) body = { pending: backend.prompts.has(path.split("/").pop()), ...backend.prompts.get(path.split("/").pop()) };
    else throw new Error("Unexpected API request: " + path);
    return Response.json(body);
  }
  const qr = {
    connectWithQr: async () => ({ accounts: provider.accounts, provider }),
    restoreQrSession: async () => options.restoreQr ? { accounts: provider.accounts, provider } : null,
  };
  // Replace the external module boundary only; this avoids both live network
  // access and node's experimental VM modules flag while exercising QR handlers.
  const runnable = source.replaceAll('import("/vendor/metamask-connect.js")', "Promise.resolve(__qr)");
  runInNewContext(runnable, {
    document, window: { ethereum: options.injectedProvider || (options.qr ? undefined : provider) }, fetch, __qr: qr,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    setTimeout: (callback) => setImmediate(callback), clearTimeout: clearImmediate,
  }, { filename: "wallet-browser.js" });
  return app;
}

test("switching browser-wallet accounts refreshes job actions and removes the previous person's World code", async () => {
  const app = createHarness();
  await app.settle();
  await app.selectJob();
  assert.ok(app.node("prove"));
  assert.equal(app.node("check-world"), null, "Approval must wait until a code exists");
  assert.equal(app.node("deliver"), null);
  await app.click("prove");
  assert.ok(app.node("check-world"));
  assert.match(app.node("job-body").innerHTML, /https:\/\/world\.test\/verify\?code=custom/);
  assert.match(app.node("job-body").innerHTML, /CODE-1111/);
  app.provider.emit("accountsChanged", [WORKER]);
  await app.settle();
  assert.equal(app.node("account-line").textContent, WORKER);
  assert.ok(app.node("deliver"), "Worker can deliver immediately after switching accounts");
  assert.ok(app.node("prove"));
  assert.equal(app.node("check-world"), null);
  assert.doesNotMatch(app.node("job-body").innerHTML, /CODE-1111/);
});

test("a failed account refresh cannot leave the previous wallet's job actions available", async () => {
  const app = createHarness({ accounts: [WORKER] });
  await app.settle();
  await app.selectJob();
  assert.ok(app.node("deliver"));
  assert.ok(app.node("prove"));
  app.onFetch = (path) => path === "/chain/accounts/" + BUYER
    ? Response.json({ error: "Account service unavailable" }, { status: 502 })
    : undefined;
  app.provider.emit("accountsChanged", [BUYER]);
  assert.equal(app.node("job").hidden, true, "Old job controls must disappear as soon as the wallet changes");
  await app.settle();
  assert.equal(app.node("deliver"), null);
  assert.equal(app.node("prove"), null);
  assert.equal(app.node("job").hidden, true);
  assert.match(app.node("wallet-status").textContent, /Account service unavailable/);
  assert.equal(app.node("connect-browser").disabled, false, "The wallet can be reconnected after the refresh failure");
});

test("QR account changes during a pending signature are refreshed after the operation", async () => {
  const app = createHarness({ qr: true });
  await app.settle();
  await app.click("connect");
  await app.selectJob();
  await app.click("prove");
  const signature = deferred();
  app.onProviderRequest = (request) => request.method === "personal_sign" ? signature.promise : undefined;
  app.node("check-world").click();
  await app.settle();
  assert.equal(app.node("check-world").disabled, true);
  app.provider.emit("accountsChanged", [WORKER]);
  signature.resolve("0xsignature");
  await app.settle();
  assert.equal(app.node("account-line").textContent, WORKER);
  assert.ok(app.node("deliver"));
  assert.equal(app.node("deliver").disabled, false);
  assert.equal(app.node("check-world"), null);
  assert.equal(app.backend.requests.some((request) => request.path === "/chain/world/pull"), false, "A signature from the old account must not bind the new wallet");
});

test("rejecting a browser-wallet connection preserves the active QR session and its events", async () => {
  const browserRequests = [];
  const injectedProvider = {
    async request({ method }) {
      browserRequests.push(method);
      if (method === "eth_accounts") return [];
      if (method === "eth_requestAccounts") throw Object.assign(new Error("Connection declined"), { code: 4001 });
      throw new Error("Unexpected browser-wallet request: " + method);
    },
  };
  const app = createHarness({ qr: true, injectedProvider });
  await app.settle();
  await app.click("connect");
  await app.selectJob();
  await app.click("connect-browser");
  assert.ok(browserRequests.includes("eth_requestAccounts"));
  assert.match(app.node("wallet-status").textContent, /cancelled/);
  app.provider.emit("accountsChanged", [WORKER]);
  await app.settle();
  assert.equal(app.node("account-line").textContent, WORKER);
  assert.ok(app.node("deliver"), "QR wallet events must remain bound after a declined browser connection");
  assert.equal(app.node("deliver").disabled, false);
});

test("account changes while preparing a transaction never send it from the newly selected wallet", async (t) => {
  const scenarios = [
    { action: "submit", button: "deliver", account: WORKER, next: BUYER, status: "job-status", job: makeJob() },
    { action: "refund", button: "refund", account: BUYER, next: WORKER, status: "job-status", job: makeJob({ expiredAt: Math.floor(Date.now() / 1000) - 60 }) },
    { action: "mint", button: "mint", account: BUYER, next: WORKER, status: "wallet-status", job: makeJob() },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.action, async () => {
      const app = createHarness({ accounts: [scenario.account], backend: makeBackend([scenario.job]) });
      await app.settle();
      await app.selectJob();
      if (app.node("note")) app.node("note").value = "Completed report";
      const prepared = deferred();
      let requestBody;
      app.onFetch = (path, body) => {
        if (path === "/chain/prepare") {
          requestBody = body;
          return prepared.promise;
        }
      };
      await app.click(scenario.button);
      assert.equal(requestBody?.action, scenario.action);
      app.provider.emit("accountsChanged", [scenario.next]);
      prepared.resolve(Response.json({ label: scenario.action, to: CONTRACT, data: JSON.stringify(requestBody) }));
      await app.settle();
      assert.equal(app.backend.transactions.length, 0, "A prepared request belongs to the original wallet");
      assert.equal(app.node("account-line").textContent, scenario.next);
      assert.match(app.node(scenario.status).textContent, /Wallet changed/);
      assert.equal(app.node("wallet-desk").getAttribute("aria-busy"), null);
    });
  }
});

test("newly rendered job buttons stay disabled while busy and become usable afterward", async () => {
  const app = createHarness();
  await app.settle();
  await app.selectJob();
  const approval = deferred();
  app.onFetch = (path) => path === "/chain/world/start" ? approval.promise : undefined;
  const duringRender = [];
  app.document.onRender = (node) => {
    if (node.id === "job-body") queueMicrotask(() => {
      duringRender.push({ busy: app.node("wallet-desk").getAttribute("aria-busy"), buttons: node.querySelectorAll("button").map((button) => button.disabled) });
    });
  };
  app.node("prove").click();
  await app.settle();
  assert.ok(app.document.querySelectorAll("#wallet-desk button").every((button) => button.disabled));
  approval.resolve(Response.json({ userCode: "READY", verificationUri: "https://world.test/approve" }));
  await app.settle();
  assert.equal(duringRender.length, 1);
  assert.equal(duringRender[0].busy, "true");
  assert.ok(duringRender[0].buttons.every(Boolean), "New buttons must inherit the operation lock");
  assert.equal(app.node("check-world").disabled, false);
  assert.equal(app.node("prove").disabled, false);
  assert.equal(app.node("wallet-desk").getAttribute("aria-busy"), null);
});

test("an expired wallet verification code restores the action to request a new code", async () => {
  const app = createHarness();
  await app.settle();
  await app.selectJob();
  await app.click("prove");
  app.onFetch = (path) => path === "/chain/world/pull" ? Response.json({ error: "expired_token" }, { status: 403 }) : undefined;
  await app.click("check-world");
  assert.equal(app.node("check-world"), null);
  assert.ok(app.node("prove"));
  assert.equal(app.node("prove").disabled, false);
  assert.doesNotMatch(app.node("job-body").innerHTML, /CODE-1111/);
  assert.match(app.node("job-status").textContent, /no longer valid/);
});

test("network switching is only offered for a connected wallet on the wrong chain", async () => {
  const app = createHarness();
  await app.settle();
  assert.equal(app.node("switch-chain").hidden, true);
  app.provider.emit("chainChanged", "0x1");
  await app.settle();
  assert.equal(app.node("switch-chain").hidden, false);
  await app.click("switch-chain");
  assert.equal(app.provider.chainId, CHAIN);
  assert.equal(app.node("switch-chain").hidden, true);
  app.provider.emit("accountsChanged", []);
  await app.settle();
  assert.equal(app.node("switch-chain").hidden, true);
});

test("cancelled funding resumes the existing job, including after a page reload", async (t) => {
  for (const [action, reload] of [["setBudget", false], ["fund", true]]) {
    await t.test(`${action} cancellation${reload ? " and reload" : ""}`, async () => {
      let app = createHarness({ backend: makeBackend([]) });
      await app.settle();
      app.backend.rejectAction = action;
      app.node("description").value = "Create a report";
      app.node("worker").value = WORKER;
      app.node("budget").value = "75";
      await app.click("open-job");
      assert.match(app.node("open-status").textContent, /Resume funding/);
      assert.equal(app.node("open-job").textContent, "Resume funding");
      assert.equal(app.backend.jobs.get("1").status, "Open");
      assert.ok(app.node("resume-funding"));
      assert.equal(app.node("description").disabled, true);
      if (reload) {
        app = createHarness({ backend: app.backend, storage: app.storage });
        await app.settle();
        assert.equal(app.node("open-job").textContent, "Resume funding");
        assert.ok(app.node("resume-funding"));
      }
      await app.click("open-job");
      assert.equal(app.backend.jobs.get("1").status, "Funded");
      assert.equal(app.backend.jobs.get("1").budget, "75");
      assert.equal(app.backend.transactions.filter((tx) => tx.action === "create").length, 1, "Retry must not create a second job");
      assert.equal(app.node("open-job").textContent, "Fund job");
      assert.equal(app.node("description").disabled, false);
      assert.equal([...app.storage.keys()].some((key) => key.startsWith("rebind.funding:")), false);
    });
  }
});

test("an unfunded job can be recovered from the board without local funding history", async () => {
  const app = createHarness({ backend: makeBackend([makeJob({ status: "Open", budget: "0" })]) });
  await app.settle();
  await app.selectJob();
  assert.ok(app.node("resume-funding"));
  app.node("fund-budget").value = "90";
  await app.click("resume-funding");
  assert.equal(app.backend.jobs.get("1").status, "Funded");
  assert.equal(app.backend.jobs.get("1").budget, "90");
  assert.deepEqual(app.backend.transactions.map((tx) => tx.action), ["setBudget", "fund"]);
});

test("a create transaction still awaiting confirmation can be resumed after reload without another create", async () => {
  let app = createHarness({ backend: makeBackend([]) });
  await app.settle();
  app.node("description").value = "Create a report";
  app.node("worker").value = WORKER;
  app.onProviderRequest = (request) => request.method === "eth_getTransactionReceipt" ? Promise.resolve(null) : undefined;
  app.node("open-job").click();
  await app.settle(60);
  assert.equal(app.node("wallet-desk").getAttribute("aria-busy"), null);
  assert.equal(app.node("open-job").textContent, "Resume funding");
  assert.match(app.node("open-status").textContent, /Still waiting/);
  app = createHarness({ backend: app.backend, storage: app.storage });
  await app.settle();
  await app.click("open-job");
  assert.equal(app.backend.jobs.get("1").status, "Funded");
  assert.equal(app.backend.transactions.filter((tx) => tx.action === "create").length, 1);
});

test("pending funding belongs to its buyer, chain, and contract", async () => {
  const app = createHarness({ backend: makeBackend([]) });
  await app.settle();
  app.backend.rejectAction = "setBudget";
  app.node("description").value = "Create a report";
  app.node("worker").value = WORKER;
  await app.click("open-job");
  assert.equal(app.node("open-job").textContent, "Resume funding");
  app.provider.emit("accountsChanged", [WORKER]);
  await app.settle();
  assert.equal(app.node("open-job").textContent, "Fund job");
  app.provider.emit("accountsChanged", [BUYER]);
  await app.settle();
  assert.equal(app.node("open-job").textContent, "Resume funding");
  for (const config of [{ chainIdHex: "0x99" }, { addresses: { acp: "0x" + "4".repeat(40) } }]) {
    const other = createHarness({ storage: app.storage, backend: app.backend, config });
    await other.settle();
    assert.equal(other.node("open-job").textContent, "Fund job");
  }
});

test("an empty brief identifies and focuses that field without prompting a disconnected wallet", async () => {
  const app = createHarness({ accounts: [] });
  await app.settle();
  let prompts = 0;
  app.onProviderRequest = () => { prompts++; };
  app.node("worker").value = WORKER;
  await app.click("open-job");
  assert.match(app.node("open-status").textContent, /Add a brief/);
  assert.doesNotMatch(app.node("open-status").textContent, /and worker wallet/);
  assert.equal(app.node("description").getAttribute("aria-invalid"), "true");
  assert.equal(app.document.activeElement, app.node("description"));
  assert.equal(prompts, 0);
  assert.equal(app.backend.transactions.length, 0);
  await app.click("sample-brief");
  assert.ok(app.node("description").value.length > 0);
  assert.equal(app.node("description-error").hidden, true);
  assert.equal(app.node("description").getAttribute("aria-invalid"), null);
});

test("worker and budget validation never sends a transaction", async (t) => {
  for (const [worker, budget, field, message] of [
    ["", "40", "worker", /Add the worker/],
    ["bad", "40", "worker", /valid worker/],
    ["0x" + "0".repeat(40), "40", "worker", /valid worker/],
    [BUYER, "40", "worker", /Connect the buyer/],
    [WORKER, "0", "budget", /whole number/],
  ]) {
    await t.test(`${worker || "missing"} / ${budget}`, async () => {
      const app = createHarness();
      await app.settle();
      app.node("description").value = "Write a report";
      app.node("worker").value = worker;
      app.node("budget").value = budget;
      await app.click("open-job");
      assert.match(app.node("open-status").textContent, message);
      assert.equal(app.document.activeElement, app.node(field));
      assert.equal(app.backend.transactions.length, 0);
    });
  }
});
