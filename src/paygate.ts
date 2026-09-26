import { randomBytes } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import express, { type Express, type Request, type Response } from "express";
import { openState, sealState, type DurableState, type WorldPrompt } from "./durable-state";
import { RebindDesk, type RebindRequest } from "./rebind";
import { AgentBookRegistry, type AgentRecord } from "./registry";
import { signAgentRequest, verifyAgentRequest } from "./sign";
import { pullValidatedSubject, startDeviceGrant } from "./world-oidc";

export type PaygateMode = "foil" | "win";

export interface AppOptions {
  mode?: PaygateMode;
  rebindTtlMs?: number;
}

const PAID_RESOURCE = "/api/resource/premium";
const PAID_MESSAGE = `POST ${PAID_RESOURCE}`;

interface Session {
  id: string;
  agentKey: string;
  humanRef: string;
  openedAt: number;
}

export interface GrantLogEntry {
  at: number;
  agentKey: string;
  resource: string;
  granted: boolean;
  via: "session" | "lookup" | "denied";
  httpStatus: number;
  revokedInRegistry: boolean | null;
  /** False on the foil path. True when the win path actually read the revoke flag. */
  checkedRevoke: boolean;
  worldRebind: string | null;
}

interface GrantBody {
  agentKey?: unknown;
  message?: unknown;
  signature?: unknown;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  return trimmed;
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.header("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return null;
}

function redirectUri(req: Request): string {
  const host = req.get("host");
  if (!host) return "/rebind/callback";
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  return `${proto}://${host}/rebind/callback`;
}

function readFilmPage(): string {
  const candidates = [
    join(__dirname, "..", "public", "film.html"),
    join(process.cwd(), "public", "film.html"),
  ];
  for (const path of candidates) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      continue;
    }
  }
  throw new Error("film.html missing");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type DeskStep =
  | { kind: "register" }
  | { kind: "active"; key: AgentRecord }
  | { kind: "revoked"; key: AgentRecord }
  | { kind: "foil-still-pays"; key: AgentRecord }
  | { kind: "needs-world"; key: AgentRecord; pending: RebindRequest | null }
  | { kind: "ready"; key: AgentRecord };

function nextKeyName(current: string): string {
  const match = /^(.*?)(\d+)$/.exec(current);
  if (!match) return `${current}2`;
  const base = match[1] ?? current;
  const digits = match[2] ?? "1";
  return `${base}${Number(digits) + 1}`;
}

function deskStep(agents: AgentRecord[], rebinds: RebindRequest[], mode: PaygateMode): DeskStep {
  if (agents.length === 0) return { kind: "register" };
  const successors = agents.filter((agent) => agent.rotatedFrom && !agent.rotatedTo && !agent.revoked);
  const waiting = successors.find((agent) => !agent.worldRebind);
  if (waiting && mode === "win") {
    const pending =
      [...rebinds].reverse().find((item) => item.agentKey === waiting.agentKey && item.status === "pending") ??
      null;
    return { kind: "needs-world", key: waiting, pending };
  }
  const rebound = successors.find((agent) => agent.worldRebind);
  if (rebound) return { kind: "ready", key: rebound };
  const revoked = [...agents].reverse().find((agent) => agent.revoked && !agent.rotatedTo);
  if (revoked && mode === "foil") return { kind: "foil-still-pays", key: revoked };
  if (revoked) return { kind: "revoked", key: revoked };
  const current = [...agents].reverse().find((agent) => !agent.revoked && !agent.rotatedTo);
  if (current) return { kind: "active", key: current };
  return { kind: "register" };
}

function keyChip(agent: AgentRecord, mode: PaygateMode): { label: string; tone: string } {
  if (agent.rotatedTo) return { label: "Replaced", tone: "muted" };
  if (agent.revoked) return { label: mode === "foil" ? "Revoked, still pays" : "Revoked", tone: "bad" };
  if (agent.rotatedFrom && !agent.worldRebind && mode === "win") return { label: "Needs a human", tone: "wait" };
  if (agent.worldRebind) return { label: "Ready to pay", tone: "ok" };
  return { label: "Can pay", tone: "ok" };
}

type Moment =
  | { kind: "create" }
  | { kind: "pay"; key: AgentRecord }
  | { kind: "cut"; key: AgentRecord; paid: GrantLogEntry }
  | { kind: "try-denied"; key: AgentRecord }
  | { kind: "replace"; key: AgentRecord; denied: GrantLogEntry }
  | { kind: "foil"; key: AgentRecord; last: GrantLogEntry | null }
  | { kind: "world"; key: AgentRecord; pending: RebindRequest | null; last: GrantLogEntry | null }
  | { kind: "ready"; key: AgentRecord; last: GrantLogEntry | null };

function latestGrant(grants: GrantLogEntry[], agentKey: string): GrantLogEntry | null {
  for (let index = grants.length - 1; index >= 0; index -= 1) {
    const entry = grants[index];
    if (entry && entry.agentKey === agentKey) return entry;
  }
  return null;
}

function momentOf(step: DeskStep, grants: GrantLogEntry[]): Moment {
  switch (step.kind) {
    case "register":
      return { kind: "create" };
    case "active": {
      const paid = latestGrant(grants, step.key.agentKey);
      if (paid?.granted) return { kind: "cut", key: step.key, paid };
      return { kind: "pay", key: step.key };
    }
    case "revoked": {
      const denied = latestGrant(grants, step.key.agentKey);
      if (denied && !denied.granted) return { kind: "replace", key: step.key, denied };
      return { kind: "try-denied", key: step.key };
    }
    case "foil-still-pays":
      return { kind: "foil", key: step.key, last: latestGrant(grants, step.key.agentKey) };
    case "needs-world":
      return {
        kind: "world",
        key: step.key,
        pending: step.pending,
        last: latestGrant(grants, step.key.agentKey),
      };
    case "ready":
      return { kind: "ready", key: step.key, last: latestGrant(grants, step.key.agentKey) };
    default: {
      const neverStep: never = step;
      return neverStep;
    }
  }
}

function railState(moment: Moment): { current: number; done: boolean } {
  switch (moment.kind) {
    case "create":
      return { current: 1, done: false };
    case "pay":
      return { current: 2, done: false };
    case "cut":
    case "try-denied":
    case "foil":
      return { current: 3, done: false };
    case "replace":
    case "world":
      return { current: 4, done: false };
    case "ready":
      return { current: 4, done: true };
    default: {
      const neverMoment: never = moment;
      return neverMoment;
    }
  }
}

function renderPage(
  registry: AgentBookRegistry,
  grants: GrantLogEntry[],
  mode: PaygateMode,
  rebinds: RebindRequest[],
  redirectUri: string,
  prompts: Map<string, WorldPrompt>,
  flash: string
): string {
  const agents = registry.listAll();
  const moment = momentOf(deskStep(agents, rebinds, mode), grants);
  const rail = railState(moment);
  const steps = ["Create", "Pay", "Revoke", "Rebind"];
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Rebind</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 16px/1.5 ui-sans-serif, system-ui, sans-serif;
      background:
        radial-gradient(900px 420px at 50% -80px, #3a3424 0%, transparent 60%),
        #10120e;
      color: #f4f1e8;
    }
    main { max-width: 680px; margin: 0 auto; padding: 28px 20px 80px; }
    .top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-end; }
    .kicker { margin: 0; font-family: Palatino, Georgia, serif; font-size: 1.7rem; letter-spacing: -0.03em; }
    .tag { margin: 6px 0 0; color: #b7b2a6; max-width: 28rem; }
    a.ghost, button.ghost {
      background: transparent; color: #f4f1e8; border: 1px solid #3a4034; text-decoration: none;
    }
    button, a.primary, a.ghost { font: inherit; }
    button, a.ghost, a.primary {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 14px 18px; border-radius: 12px; cursor: pointer; text-decoration: none;
    }
    button.primary, a.primary { background: #e3b341; color: #12140f; border: 0; font-weight: 650; }
    button.danger { background: transparent; color: #ffb4b4; border: 1px solid #6b3030; }
    .rail { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 22px 0 0; padding: 0; list-style: none; }
    .rail li {
      text-align: center; font-size: 13px; color: #8d887c;
      border: 1px solid #34392e; border-radius: 999px; padding: 8px 6px;
    }
    .rail li.on { background: #e3b341; color: #12140f; border-color: #e3b341; font-weight: 650; }
    .rail li.done { color: #d9d3c5; border-color: #6a5c3e; }
    .panel {
      margin-top: 16px; background: #181b15; border: 1px solid #34392e;
      border-radius: 18px; padding: 22px; box-shadow: 0 24px 50px rgba(0,0,0,.28);
    }
    .eyebrow { margin: 0; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #e3b341; }
    h1 { margin: 8px 0 0; font-family: Palatino, Georgia, serif; font-weight: 500; font-size: clamp(1.8rem, 4vw, 2.4rem); line-height: 1.08; letter-spacing: -0.03em; }
    .lead { margin: 10px 0 0; color: #d9d3c5; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; align-items: center; }
    label { display: block; font-size: 13px; color: #b7b2a6; margin: 16px 0 6px; }
    input {
      width: min(100%, 360px); background: #10120e; color: inherit;
      border: 1px solid #3a4034; border-radius: 10px; padding: 12px 14px; font: inherit;
    }
    .receipt { border-radius: 12px; padding: 12px 14px; margin-bottom: 16px; }
    .receipt p { margin: 0; }
    .receipt .stamp { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; margin-bottom: 4px; }
    .receipt.ok { background: #1b2a18; }
    .receipt.ok .stamp { color: #8fdf7a; }
    .receipt.bad { background: #2a1818; }
    .receipt.bad .stamp { color: #ff8d8d; }
    .receipt.wait { background: #2a2618; }
    .receipt.wait .stamp { color: #e3b341; }
    .code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 1.8rem; letter-spacing: 0.14em; margin: 8px 0 0;
    }
    .mini { margin: 14px 0 0; padding-left: 1.2rem; color: #d9d3c5; }
    .mini li { margin: 4px 0; }
    h2 { margin: 28px 0 8px; font-size: 0.78rem; letter-spacing: 0.1em; text-transform: uppercase; color: #b7b2a6; }
    .keys, .charges { list-style: none; margin: 0; padding: 0; }
    .keys li, .charges li {
      display: flex; justify-content: space-between; gap: 12px; align-items: baseline;
      padding: 10px 0; border-top: 1px solid #2c3128;
    }
    .chip { font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; font-weight: 700; }
    .ok { color: #8fdf7a; } .bad { color: #ff6b6b; } .wait { color: #e3b341; } .muted { color: #b7b2a6; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    details { margin-top: 28px; color: #b7b2a6; }
    summary { cursor: pointer; color: #f4f1e8; }
    details a { color: #e3b341; }
    @media (max-width: 640px) {
      .top { flex-direction: column; align-items: stretch; }
      .rail { grid-template-columns: 1fr 1fr; }
      button, a.primary, a.ghost { width: 100%; }
    }
  </style>
</head>
<body>
  <main>
    <div class="top">
      <div>
        <p class="kicker">Rebind</p>
        <p class="tag">${mode === "foil" ? "This server still takes payment after revoke. That is the bug." : "Revoke a key, and the next payment fails."}</p>
      </div>
      <a class="ghost" href="/">Watch the 90-second cut</a>
    </div>
    <ol class="rail" aria-label="Progress">
      ${steps
        .map((label, index) => {
          const number = index + 1;
          const cls = rail.done || number < rail.current ? "done" : number === rail.current ? "on" : "";
          return `<li class="${cls}">${number} ${label}</li>`;
        })
        .join("")}
    </ol>
    <section class="panel" aria-label="Next action">
      ${flashHtml(flash)}
      ${renderMoment(moment, prompts)}
    </section>
    ${renderKeys(agents, mode)}
    ${renderCharges(grants, mode)}
    <details>
      <summary>Practice the same steps without World App</summary>
      ${mode === "win" ? renderLocalSandbox(rebinds) : `<p>This server is the foil. Revoke is recorded and the charge still goes through.</p>`}
      <p>World redirect on file: <code>${escapeHtml(redirectUri)}</code></p>
      <p><a href="/debug/registry">Registry</a> · <a href="/debug/grants">Charges</a></p>
    </details>
  </main>
</body>
</html>`;
}

function flashHtml(flash: string): string {
  switch (flash) {
    case "waiting":
      return `<div class="receipt wait"><p class="stamp">Still waiting</p><p>World App has not approved this code yet. Approve it, then check again.</p></div>`;
    case "not-approved":
      return `<div class="receipt bad"><p class="stamp">Not approved</p><p>World App refused this code. Send a fresh one.</p></div>`;
    case "world-down":
      return `<div class="receipt wait"><p class="stamp">No World client</p><p>This server cannot ask World App yet. Open the practice section below to walk the same steps.</p></div>`;
    case "world-error":
      return `<div class="receipt bad"><p class="stamp">World did not answer</p><p>The approval request failed. Try again in a moment.</p></div>`;
    default:
      return "";
  }
}

function chargeForm(agentKey: string, label: string, tone: "primary" | "ghost"): string {
  return `<form method="post" action="/demo/grant"><input type="hidden" name="agentKey" value="${escapeHtml(agentKey)}" /><button class="${tone}" type="submit">${escapeHtml(label)}</button></form>`;
}

function replaceForm(agentKey: string, tone: "primary" | "ghost"): string {
  const next = nextKeyName(agentKey);
  return `<form method="post" action="/registry/rotate">
    <input type="hidden" name="oldKey" value="${escapeHtml(agentKey)}" />
    <label for="newKey">Name the new key</label>
    <input id="newKey" name="newKey" value="${escapeHtml(next)}" autocomplete="off" />
    <div class="actions"><button class="${tone}" type="submit">Issue ${escapeHtml(next)}</button></div>
  </form>`;
}

function panelHead(step: string, title: string, lead: string): string {
  return `<p class="eyebrow">${escapeHtml(step)}</p><h1>${escapeHtml(title)}</h1><p class="lead">${escapeHtml(lead)}</p>`;
}

function receiptHtml(entry: GrantLogEntry, mode: PaygateMode): string {
  const when = new Date(entry.at).toISOString().slice(11, 19);
  const key = escapeHtml(entry.agentKey);
  if (entry.granted && entry.revokedInRegistry && mode === "foil") {
    return `<div class="receipt bad"><p class="stamp">Still paid</p><p>${key} is revoked, and this server charged it anyway at ${when} UTC.</p></div>`;
  }
  if (entry.granted) {
    return `<div class="receipt ok"><p class="stamp">Paid</p><p>${key} was accepted at ${when} UTC.</p></div>`;
  }
  if (entry.revokedInRegistry) {
    return `<div class="receipt bad"><p class="stamp">Refused</p><p>${key} is revoked. The server checked, then said no at ${when} UTC.</p></div>`;
  }
  return `<div class="receipt bad"><p class="stamp">Refused</p><p>${key} cannot pay yet. A human still has to approve it. ${when} UTC.</p></div>`;
}

function renderMoment(moment: Moment, prompts: Map<string, WorldPrompt>): string {
  switch (moment.kind) {
    case "create":
      return `${panelHead("Step 1 of 4", "Name the key.", "This is the name the agent sends when it asks to pay.")}
        <form method="post" action="/registry/register">
          <label for="agentKey">Key name</label>
          <input id="agentKey" name="agentKey" value="K" autocomplete="off" />
          <label for="humanRef">Who is responsible</label>
          <input id="humanRef" name="humanRef" value="Demo operator" autocomplete="off" />
          <div class="actions"><button class="primary" type="submit">Create key</button></div>
        </form>`;
    case "pay":
      return `${panelHead("Step 2 of 4", `Charge ${moment.key.agentKey}.`, "One real payment. You should see Paid on this page when you come back.")}
        <div class="actions">${chargeForm(moment.key.agentKey, `Charge ${moment.key.agentKey}`, "primary")}</div>`;
    case "cut":
      return `${receiptHtml(moment.paid, "win")}
        ${panelHead("Step 3 of 4", `Revoke ${moment.key.agentKey}.`, "After this, the same key must be refused, including a session that is already open.")}
        <div class="actions">
          <form method="post" action="/registry/revoke"><input type="hidden" name="agentKey" value="${escapeHtml(moment.key.agentKey)}" /><button class="primary" type="submit">Revoke ${escapeHtml(moment.key.agentKey)}</button></form>
          ${chargeForm(moment.key.agentKey, "Charge again", "ghost")}
        </div>`;
    case "try-denied":
      return `${panelHead("Step 3 of 4", `${moment.key.agentKey} is revoked. Try to charge it.`, "The result stays on this page. Win mode says no.")}
        <div class="actions">${chargeForm(moment.key.agentKey, `Try to charge ${moment.key.agentKey}`, "primary")}</div>`;
    case "replace":
      return `${receiptHtml(moment.denied, "win")}
        ${panelHead("Step 4 of 4", "Issue a new key.", "The old key stays refused. The new one will not pay until a human approves it in World App.")}
        ${replaceForm(moment.key.agentKey, "primary")}`;
    case "foil": {
      const showedHole = Boolean(moment.last?.granted && moment.last.revokedInRegistry);
      return `${moment.last ? receiptHtml(moment.last, "foil") : ""}
        ${panelHead(
          "Step 3 of 4",
          showedHole ? "That charge should have failed." : `Charge revoked ${moment.key.agentKey}.`,
          showedHole
            ? "The registry says revoked. This server ignored it. Issue a new key, or charge it again."
            : "The registry already says revoked. This server will still take the money."
        )}
        ${showedHole ? replaceForm(moment.key.agentKey, "primary") : ""}
        <div class="actions">${chargeForm(moment.key.agentKey, showedHole ? "Charge it again" : `Charge ${moment.key.agentKey} anyway`, showedHole ? "ghost" : "primary")}</div>
        ${showedHole ? "" : replaceForm(moment.key.agentKey, "ghost")}`;
    }
    case "world": {
      const prompt = moment.pending ? prompts.get(moment.pending.id) ?? null : null;
      const tried = moment.last && !moment.last.granted ? receiptHtml(moment.last, "win") : "";
      if (!prompt || !moment.pending) {
        return `${tried}
          ${panelHead("Step 4 of 4", `${moment.key.agentKey} needs a human.`, "A new key does not pay until you approve it in the sandbox World App. A button in this browser is not enough.")}
          <div class="actions">
            <form method="post" action="/rebind/live/start"><input type="hidden" name="agentKey" value="${escapeHtml(moment.key.agentKey)}" /><button class="primary" type="submit">Get a World App code</button></form>
            ${chargeForm(moment.key.agentKey, `Try to charge ${moment.key.agentKey}`, "ghost")}
          </div>`;
      }
      const link = prompt.verificationUriComplete || prompt.verificationUri;
      return `${tried}
        ${panelHead("Step 4 of 4", "Approve this code in World App.", "Then come back here. The server checks the token before this key can pay.")}
        <p class="code">${escapeHtml(prompt.userCode)}</p>
        <ol class="mini">
          <li>Open World App and approve the code above.</li>
          <li>Come back and check. Until then, ${escapeHtml(moment.key.agentKey)} cannot pay.</li>
        </ol>
        <div class="actions">
          <a class="primary" href="${escapeHtml(link)}" target="_blank" rel="noreferrer">Open World App</a>
          <form method="post" action="/rebind/live/pull"><input type="hidden" name="requestId" value="${escapeHtml(moment.pending.id)}" /><button class="ghost" type="submit">I approved it. Check now.</button></form>
          <form method="post" action="/rebind/live/start"><input type="hidden" name="agentKey" value="${escapeHtml(moment.key.agentKey)}" /><button class="ghost" type="submit">Send a fresh code</button></form>
        </div>`;
    }
    case "ready":
      return `${moment.last?.granted ? receiptHtml(moment.last, "win") : `<div class="receipt ok"><p class="stamp">Approved</p><p>The server checked a World ID token for ${escapeHtml(moment.key.agentKey)}.</p></div>`}
        ${panelHead("Done", `${moment.key.agentKey} can pay again.`, "Revoke it whenever you want the next charge to fail.")}
        <div class="actions">
          ${chargeForm(moment.key.agentKey, `Charge ${moment.key.agentKey}`, "primary")}
          <form method="post" action="/registry/revoke"><input type="hidden" name="agentKey" value="${escapeHtml(moment.key.agentKey)}" /><button class="danger" type="submit">Revoke ${escapeHtml(moment.key.agentKey)}</button></form>
        </div>`;
    default: {
      const neverMoment: never = moment;
      return neverMoment;
    }
  }
}

function renderKeys(agents: AgentRecord[], mode: PaygateMode): string {
  if (agents.length === 0) return "";
  const rows = agents
    .map((agent) => {
      const chip = keyChip(agent, mode);
      return `<li><span><code>${escapeHtml(agent.agentKey)}</code> <span class="muted">${escapeHtml(agent.humanRef)}</span></span><span class="chip ${chip.tone}">${escapeHtml(chip.label)}</span></li>`;
    })
    .join("");
  return `<h2>Keys on this desk</h2><ul class="keys">${rows}</ul>`;
}

function renderCharges(grants: GrantLogEntry[], mode: PaygateMode): string {
  if (grants.length === 0) return "";
  const rows = grants
    .slice(-5)
    .reverse()
    .map((entry) => {
      const when = new Date(entry.at).toISOString().slice(11, 19);
      const hole = entry.granted && entry.revokedInRegistry && mode === "foil";
      const word = hole ? "Still paid" : entry.granted ? "Paid" : "Refused";
      const tone = entry.granted && !hole ? "ok" : "bad";
      return `<li><span><span class="${tone}">${word}</span> <code>${escapeHtml(entry.agentKey)}</code></span><span class="muted">${when} UTC</span></li>`;
    })
    .join("");
  return `<h2>What happened</h2><ul class="charges">${rows}</ul>`;
}

function renderLocalSandbox(rebinds: RebindRequest[]): string {
  const latest = rebinds[rebinds.length - 1];
  const id = latest ? escapeHtml(latest.id) : "";
  return `<p>This path mints a stand-in subject. It is not a World App approval.</p>
    <form method="post" action="/rebind/start"><p><input name="agentKey" value="K2" /> <button class="ghost" type="submit">Start local rebind</button></p></form>
    <form method="post" action="/rebind/decide"><p><input name="requestId" value="${id}" />
      <button class="ghost" name="outcome" value="validated">Validated</button>
      <button class="ghost" name="outcome" value="denied">Denied</button>
      <button class="ghost" name="outcome" value="cancelled">Cancelled</button>
    </p></form>
    <form method="post" action="/rebind/finish"><p><input name="requestId" value="${id}" /> <button class="ghost" type="submit">Attach if the server validated</button></p></form>`;
}

function isWorldPrompt(value: unknown): value is WorldPrompt {
  if (typeof value !== "object" || value === null) return false;
  const prompt = value as WorldPrompt;
  return (
    typeof prompt.userCode === "string" &&
    typeof prompt.verificationUri === "string" &&
    typeof prompt.verificationUriComplete === "string"
  );
}

function rememberDesk(
  app: Express,
  registry: AgentBookRegistry,
  desk: RebindDesk,
  deviceCodes: Map<string, string>,
  prompts: Map<string, WorldPrompt>,
  grants: GrantLogEntry[],
  secret: string
): void {
  app.use((req, res, next) => {
    const token = readCookie(req, "rebind_state");
    const state = token ? openState(token, secret) : null;
    registry.replaceAll(state?.agents ?? []);
    desk.replaceAll(state?.rebinds ?? []);
    deviceCodes.clear();
    prompts.clear();
    grants.length = 0;
    if (state) {
      for (const [id, code] of Object.entries(state.deviceCodes)) {
        if (typeof code === "string") deviceCodes.set(id, code);
      }
      for (const [id, prompt] of Object.entries(state.prompts)) {
        if (isWorldPrompt(prompt)) prompts.set(id, prompt);
      }
      for (const entry of state.grants.slice(-30)) {
        grants.push(entry);
      }
    }

    let saved = false;
    const originalEnd = res.end;
    res.end = function persistEnd(this: Response, ...args: unknown[]) {
      if (!saved) {
        saved = true;
        const nextState: DurableState = {
          agents: registry.listAll(),
          rebinds: desk.list(),
          deviceCodes: Object.fromEntries(deviceCodes),
          prompts: Object.fromEntries(prompts),
          grants: grants.slice(-30).map((entry) => ({ ...entry })),
        };
        res.cookie("rebind_state", sealState(nextState, secret), {
          httpOnly: true,
          sameSite: "lax",
          secure: true,
          path: "/",
          maxAge: 60 * 60 * 1000,
        });
      }
      return originalEnd.apply(this, args as never);
    } as Response["end"];
    next();
  });
}

export function createApp(registry: AgentBookRegistry, options: AppOptions = {}): Express {
  const mode: PaygateMode = options.mode ?? "win";
  const app = express();
  const sessions = new Map<string, Session>();
  const grants: GrantLogEntry[] = [];
  const desk = new RebindDesk(options.rebindTtlMs ?? 10 * 60 * 1000);
  const deviceCodes = new Map<string, string>();
  const prompts = new Map<string, WorldPrompt>();
  const stateSecret = process.env.WORLD_CLIENT_SECRET ?? "";

  app.use(express.json());
  if (stateSecret) {
    rememberDesk(app, registry, desk, deviceCodes, prompts, grants, stateSecret);
  }
  app.use(express.urlencoded({ extended: false }));

  app.get("/", (_req: Request, res: Response) => {
    res.type("html").send(readFilmPage());
  });

  app.get("/desk", (req: Request, res: Response) => {
    res.type("html").send(
      renderPage(registry, grants, mode, desk.list(), redirectUri(req), prompts, deskFlash(req.query.flash))
    );
  });

  app.get("/rebind/callback", (req: Request, res: Response) => {
    const hasCode = typeof req.query.code === "string";
    res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>Rebind callback</title></head>
<body>
  <p>This is the registered World redirect. The live rebind uses the device grant, so the human approves on World’s verification page and this URL is not where the proof returns.</p>
  <p>${hasCode ? "An authorization code arrived. This demo does not exchange it." : "No authorization code on this request."}</p>
</body>
</html>`);
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      spine: "C3",
      mode,
      enforcesRevoke: mode === "win",
      worldIssuer: "https://sandbox.auth.world.org",
    });
  });

  app.post("/registry/register", (req: Request, res: Response) => {
    const agentKey = readString(req.body?.agentKey);
    const humanRef = readString(req.body?.humanRef);
    if (!agentKey || !humanRef) {
      res.status(400).json({ error: "agentKey and humanRef are required" });
      return;
    }
    try {
      const record = registry.register(agentKey, humanRef);
      reply(req, res, 201, { record });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Register failed";
      reply(req, res, 409, { error: message });
    }
  });

  app.get("/registry/lookup/:agentKey", (req: Request, res: Response) => {
    const agentKey = readString(req.params.agentKey);
    if (!agentKey) {
      res.status(400).json({ error: "agentKey is required" });
      return;
    }
    const record = registry.lookup(agentKey);
    if (!record) {
      res.status(404).json({ record: null });
      return;
    }
    res.json({ record });
  });

  app.post("/registry/revoke", (req: Request, res: Response) => {
    const agentKey = readString(req.body?.agentKey);
    if (!agentKey) {
      res.status(400).json({ error: "agentKey is required" });
      return;
    }
    try {
      const record = registry.revoke(agentKey);
      reply(req, res, 200, {
        record,
        note:
          mode === "foil"
            ? "Flag flipped. Foil paygate does not read it."
            : "Flag flipped. The next grant will deny this key.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Revoke failed";
      res.status(404).json({ error: message });
    }
  });

  app.post("/registry/rotate", (req: Request, res: Response) => {
    const oldKey = readString(req.body?.oldKey);
    const newKey = readString(req.body?.newKey);
    if (!oldKey || !newKey) {
      res.status(400).json({ error: "oldKey and newKey are required" });
      return;
    }
    try {
      const result = registry.rotate(oldKey, newKey);
      reply(req, res, 200, {
        ...result,
        note:
          mode === "foil"
            ? "Mapping updated. No World re-bind. Foil paygate still accepts both keys."
            : "Mapping updated. K2 cannot grant until the server attaches a validated rebind.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Rotate failed";
      const status = message.includes("not found") ? 404 : 409;
      res.status(status).json({ error: message });
    }
  });

  app.get("/debug/registry", (_req: Request, res: Response) => {
    const records = registry.listAll();
    res.json({ records, count: records.length });
  });

  app.get("/debug/grants", (_req: Request, res: Response) => {
    res.json({ grants, count: grants.length });
  });

  app.get("/debug/sessions", (_req: Request, res: Response) => {
    res.json({
      sessions: [...sessions.values()],
      count: sessions.size,
    });
  });

  app.get("/debug/rebinds", (_req: Request, res: Response) => {
    const requests = desk.list();
    res.json({ requests, count: requests.length });
  });

  app.post("/rebind/start", (req: Request, res: Response) => {
    const agentKey = readString(req.body?.agentKey);
    if (!agentKey) {
      reply(req, res, 400, { error: "agentKey is required" });
      return;
    }
    const record = registry.lookup(agentKey);
    if (!record) {
      reply(req, res, 404, { error: "Agent key not found" });
      return;
    }
    if (!record.rotatedFrom) {
      reply(req, res, 409, { error: "Rebind is only for a rotated-in key" });
      return;
    }
    const request = desk.start(agentKey);
    reply(req, res, 201, { request, issuer: request.issuer });
  });

  app.post("/rebind/decide", (req: Request, res: Response) => {
    const requestId = readString(req.body?.requestId);
    const outcome = readString(req.body?.outcome);
    if (!requestId || (outcome !== "validated" && outcome !== "denied" && outcome !== "cancelled")) {
      reply(req, res, 400, { error: "requestId and outcome (validated|denied|cancelled) are required" });
      return;
    }
    try {
      const request = desk.decide(requestId, outcome);
      reply(req, res, 200, { request });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Decide failed";
      reply(req, res, 404, { error: message });
    }
  });

  app.post("/rebind/finish", (req: Request, res: Response) => {
    const requestId = readString(req.body?.requestId);
    if (!requestId) {
      reply(req, res, 400, { error: "requestId is required" });
      return;
    }
    const request = desk.get(requestId);
    if (!request) {
      reply(req, res, 404, { error: "Rebind request not found" });
      return;
    }
    if (request.status !== "validated" || !request.subject) {
      reply(req, res, 403, {
        attached: false,
        status: request.status,
        error: "Rebind is not validated. A client claim is not accepted.",
      });
      return;
    }
    try {
      const record = registry.attachWorldRebind(
        request.agentKey,
        `${request.issuer}|${request.subject}`
      );
      reply(req, res, 200, { attached: true, record });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Finish failed";
      reply(req, res, 409, { attached: false, error: message });
    }
  });

  app.post("/rebind/live/start", async (req: Request, res: Response) => {
    const agentKey = readString(req.body?.agentKey);
    if (!agentKey) {
      reply(req, res, 400, { error: "agentKey is required" });
      return;
    }
    const record = registry.lookup(agentKey);
    if (!record?.rotatedFrom) {
      reply(req, res, 409, { error: "Rebind is only for a rotated-in key" });
      return;
    }
    try {
      const live = await startDeviceGrant();
      if (!live) {
        if (!wantsJson(req)) {
          res.redirect("/desk?flash=world-down");
          return;
        }
        res.status(501).json({
          error: "Set WORLD_CLIENT_ID and WORLD_CLIENT_SECRET to start sandbox.auth.world.org",
        });
        return;
      }
      const request = desk.start(agentKey);
      deviceCodes.set(request.id, live.deviceCode);
      prompts.set(request.id, {
        userCode: live.userCode,
        verificationUri: live.verificationUri,
        verificationUriComplete: live.verificationUriComplete ?? live.verificationUri,
      });
      if (!wantsJson(req)) {
        res.redirect("/desk");
        return;
      }
      res.status(201).json({
        requestId: request.id,
        userCode: live.userCode,
        verificationUri: live.verificationUri,
        verificationUriComplete: live.verificationUriComplete,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Live rebind failed";
      if (!wantsJson(req)) {
        res.redirect("/desk?flash=world-error");
        return;
      }
      res.status(502).json({ error: message });
    }
  });

  app.post("/rebind/live/pull", async (req: Request, res: Response) => {
    const requestId = readString(req.body?.requestId);
    if (!requestId) {
      reply(req, res, 400, { error: "requestId is required" });
      return;
    }
    const deviceCode = deviceCodes.get(requestId);
    if (!deviceCode) {
      if (!wantsJson(req)) {
        res.redirect("/desk?flash=world-error");
        return;
      }
      res.status(404).json({ error: "No live device grant for this request" });
      return;
    }
    const result = await pullValidatedSubject(deviceCode);
    if (result.kind === "pending") {
      if (!wantsJson(req)) {
        res.redirect("/desk?flash=waiting");
        return;
      }
      res.status(202).json({ attached: false, status: "pending" });
      return;
    }
    if (result.kind === "denied") {
      if (!wantsJson(req)) {
        res.redirect("/desk?flash=not-approved");
        return;
      }
      res.status(403).json({ attached: false, error: result.error });
      return;
    }
    const request = desk.markValidated(requestId, result.subject, "https://sandbox.auth.world.org");
    const record = registry.attachWorldRebind(request.agentKey, `${request.issuer}|${result.subject}`);
    if (!wantsJson(req)) {
      res.redirect("/desk");
      return;
    }
    res.json({ attached: true, record });
  });

  app.post("/demo/grant", (req: Request, res: Response) => {
    const agentKey = readString(req.body?.agentKey);
    if (!agentKey) {
      reply(req, res, 400, { error: "agentKey is required" });
      return;
    }
    const signature = signAgentRequest(agentKey, PAID_MESSAGE);
    grantPaidResource(req, res, registry, sessions, grants, mode, agentKey, signature, !wantsJson(req));
  });

  app.get(PAID_RESOURCE, (_req: Request, res: Response) => {
    res.status(402).json({
      error: "payment_required",
      resource: PAID_RESOURCE,
      accepts: ["agent-signed-request"],
      message: PAID_MESSAGE,
      note: "Paid resource. Send a signed agent key. Win mode also enforces revoke and rebind.",
    });
  });

  app.post(PAID_RESOURCE, (req: Request, res: Response) => {
    grantPaidResource(req, res, registry, sessions, grants, mode);
  });

  return app;
}

/**
 * DAY 0 FOIL — intentional.
 *
 * A key that was registered once keeps getting the paid resource after revoke.
 * Open sessions skip the registry. A fresh request looks the key up and then
 * ignores `revoked` and `rotatedTo`. World re-bind is never required.
 *
 * Day 1 replaces this decision with a mid-loop deny and a World re-bind gate.
 */
function wantsJson(req: Request): boolean {
  return (req.header("content-type") ?? "").includes("application/json");
}

function deskFlash(value: unknown): string {
  if (value === "waiting" || value === "not-approved" || value === "world-down" || value === "world-error") {
    return value;
  }
  return "";
}

function reply(req: Request, res: Response, status: number, body: unknown): void {
  if (wantsJson(req)) {
    res.status(status).json(body);
    return;
  }
  res.redirect("/desk");
}

function grantPaidResource(
  req: Request,
  res: Response,
  registry: AgentBookRegistry,
  sessions: Map<string, Session>,
  grants: GrantLogEntry[],
  mode: PaygateMode,
  signedKey?: string,
  signedValue?: string,
  deskReturn = false
): void {
  const body: GrantBody =
    typeof req.body === "object" && req.body !== null ? (req.body as GrantBody) : {};

  const agentKey =
    signedKey ?? readString(req.header("x-agent-key")) ?? readString(body.agentKey);
  const message = readString(body.message) ?? PAID_MESSAGE;
  const signature =
    signedValue ??
    readString(req.header("x-agent-signature")) ??
    readString(body.signature);

  if (!agentKey || !signature) {
    deny(res, grants, agentKey ?? "(missing)", 400, "missing agentKey or signature", false, null, deskReturn);
    return;
  }

  if (!verifyAgentRequest(agentKey, message, signature)) {
    deny(res, grants, agentKey, 401, "invalid signature", false, null, deskReturn);
    return;
  }

  const sessionId = readCookie(req, "agent_session");
  const session = sessionId ? sessions.get(sessionId) : undefined;
  const record = registry.lookup(agentKey);

  if (mode === "win") {
    grantWin(res, grants, sessions, agentKey, record, deskReturn);
    return;
  }

  // Mute M3: a session opened at first lookup is trusted for the rest of the loop.
  if (session && session.agentKey === agentKey) {
    const observed = registry.lookup(agentKey);
    allow(res, grants, {
      agentKey,
      humanRef: session.humanRef,
      via: "session",
      revokedInRegistry: observed?.revoked ?? null,
      worldRebind: observed?.worldRebind ?? null,
      sessionId: session.id,
      deskReturn,
    });
    return;
  }

  if (!record) {
    deny(res, grants, agentKey, 403, "agent key is not registered", false, null, deskReturn);
    return;
  }

  // Fresh request still grants. `record.revoked` and `record.rotatedTo` are not consulted.
  const opened = openSession(sessions, record);
  allow(res, grants, {
    agentKey,
    humanRef: record.humanRef,
    via: "lookup",
    revokedInRegistry: record.revoked,
    worldRebind: record.worldRebind,
    sessionId: opened.id,
    deskReturn,
  });
}

function grantWin(
  res: Response,
  grants: GrantLogEntry[],
  sessions: Map<string, Session>,
  agentKey: string,
  record: AgentRecord | null,
  deskReturn = false
): void {
  if (!record) {
    deny(res, grants, agentKey, 403, "agent key is not registered", true, null, deskReturn);
    return;
  }
  if (record.revoked) {
    deny(res, grants, agentKey, 403, "revoked", true, true, deskReturn);
    return;
  }
  if (record.rotatedTo) {
    deny(res, grants, agentKey, 403, "rotated away", true, false, deskReturn);
    return;
  }
  if (record.rotatedFrom && !record.worldRebind) {
    deny(res, grants, agentKey, 403, "rebind required", true, false, deskReturn);
    return;
  }

  const opened = openSession(sessions, record);
  allow(res, grants, {
    agentKey,
    humanRef: record.humanRef,
    via: "lookup",
    revokedInRegistry: false,
    worldRebind: record.worldRebind,
    sessionId: opened.id,
    checkedRevoke: true,
    deskReturn,
  });
}

function openSession(sessions: Map<string, Session>, record: AgentRecord): Session {
  const session: Session = {
    id: randomBytes(16).toString("hex"),
    agentKey: record.agentKey,
    humanRef: record.humanRef,
    openedAt: Date.now(),
  };
  sessions.set(session.id, session);
  return session;
}

function allow(
  res: Response,
  grants: GrantLogEntry[],
  details: {
    agentKey: string;
    humanRef: string;
    via: "session" | "lookup";
    revokedInRegistry: boolean | null;
    worldRebind: string | null;
    sessionId: string;
    checkedRevoke?: boolean;
    deskReturn?: boolean;
  }
): void {
  const checkedRevoke = details.checkedRevoke ?? false;
  grants.push({
    at: Date.now(),
    agentKey: details.agentKey,
    resource: PAID_RESOURCE,
    granted: true,
    via: details.via,
    httpStatus: 200,
    revokedInRegistry: details.revokedInRegistry,
    checkedRevoke,
    worldRebind: details.worldRebind,
  });

  res.cookie("agent_session", details.sessionId, { httpOnly: true, sameSite: "lax" });
  if (details.deskReturn) {
    res.redirect("/desk");
    return;
  }
  res.json({
      granted: true,
      resource: PAID_RESOURCE,
      agentKey: details.agentKey,
      humanRef: details.humanRef,
      via: details.via,
      revokedInRegistry: details.revokedInRegistry,
      checkedRevoke,
      worldRebind: details.worldRebind,
      foil: details.revokedInRegistry ? "REVOKE_IGNORED" : "GRANTED",
    });
}

function deny(
  res: Response,
  grants: GrantLogEntry[],
  agentKey: string,
  status: number,
  error: string,
  checkedRevoke = false,
  revokedInRegistry: boolean | null = null,
  deskReturn = false
): void {
  grants.push({
    at: Date.now(),
    agentKey,
    resource: PAID_RESOURCE,
    granted: false,
    via: "denied",
    httpStatus: status,
    revokedInRegistry,
    checkedRevoke,
    worldRebind: null,
  });
  if (deskReturn) {
    res.redirect("/desk");
    return;
  }
  res.status(status).json({ granted: false, error, checkedRevoke, revokedInRegistry });
}
