import { randomBytes } from "crypto";
import express, { type Express, type Request, type Response } from "express";
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPage(
  registry: AgentBookRegistry,
  grants: GrantLogEntry[],
  mode: PaygateMode,
  rebinds: RebindRequest[]
): string {
  const agents = registry.listAll();
  const agentRows =
    agents.length === 0
      ? `<tr><td colspan="6">No agents yet. The registry is empty.</td></tr>`
      : agents
          .map((agent) => {
            const status = agent.revoked ? "REVOKED" : "active";
            const statusClass = agent.revoked ? "bad" : "ok";
            return `<tr>
              <td><code>${escapeHtml(agent.agentKey)}</code></td>
              <td>${escapeHtml(agent.humanRef)}</td>
              <td class="${statusClass}">${status}</td>
              <td>${agent.rotatedTo ? `<code>${escapeHtml(agent.rotatedTo)}</code>` : "—"}</td>
              <td>${agent.rotatedFrom ? `<code>${escapeHtml(agent.rotatedFrom)}</code>` : "—"}</td>
              <td>${agent.worldRebind ? escapeHtml(agent.worldRebind) : "null"}</td>
            </tr>`;
          })
          .join("");

  const grantRows =
    grants.length === 0
      ? `<tr><td colspan="5">No grant attempts yet.</td></tr>`
      : grants
          .slice()
          .reverse()
          .map((entry) => {
            const decision = entry.granted ? "GRANTED" : "DENIED";
            const decisionClass = entry.granted ? "ok" : "bad";
            const revoked =
              entry.revokedInRegistry === null
                ? "—"
                : entry.revokedInRegistry
                  ? "yes"
                  : "no";
            return `<tr>
              <td>${new Date(entry.at).toISOString()}</td>
              <td><code>${escapeHtml(entry.agentKey)}</code></td>
              <td class="${decisionClass}">${decision}</td>
              <td>${escapeHtml(entry.via)}</td>
              <td>${revoked}</td>
            </tr>`;
          })
          .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${mode === "foil" ? "C3 foil — revoke theater" : "C3 win — revoke enforced"}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font: 15px/1.45 ui-sans-serif, system-ui, sans-serif; background: #12140f; color: #f4f1e8; }
    main { max-width: 960px; margin: 0 auto; padding: 28px 20px 64px; }
    h1 { font-size: 1.4rem; margin: 0 0 8px; }
    p { margin: 0 0 12px; }
    .banner { border: 1px solid #e3b341; background: #2a2416; padding: 12px 14px; margin: 16px 0 28px; }
    h2 { font-size: 1rem; margin: 28px 0 8px; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 640px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #2c3128; vertical-align: top; }
    th { color: #b7b2a6; font-weight: 600; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .ok { color: #8fdf7a; font-weight: 700; }
    .bad { color: #ff6b6b; font-weight: 700; }
    .muted { color: #b7b2a6; }
  </style>
</head>
<body>
  <main>
    <h1>${mode === "foil" ? "Revoke theater" : "Revoke enforced"}</h1>
    <p class="muted">${
      mode === "foil"
        ? "Foil mode. The registry records revoke. The paygate does not enforce it."
        : "Win mode. Every grant re-reads the registry. A rotated key pays only after the server validates a rebind."
    }</p>
    <div class="banner">
      ${
        mode === "foil"
          ? "Marking a key revoked updates this table. The paid grant still returns GRANTED."
          : "After revoke, the same key is DENIED. K2 stays DENIED until a validated rebind is attached by the server."
      }
    </div>
    ${mode === "win" ? renderWinForms(rebinds) : ""}
    <h2>Registry</h2>
    <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Agent key</th><th>Human</th><th>Status</th><th>Rotated to</th><th>Rotated from</th><th>World re-bind</th></tr>
      </thead>
      <tbody>${agentRows}</tbody>
    </table>
    </div>
    <h2>Grant log</h2>
    <div class="table-wrap">
    <table>
      <thead>
        <tr><th>When</th><th>Agent key</th><th>Decision</th><th>Via</th><th>Revoked in registry</th></tr>
      </thead>
      <tbody>${grantRows}</tbody>
    </table>
    </div>
    <p class="muted">Debug JSON: <code>/debug/registry</code> · <code>/debug/grants</code> · <code>/debug/sessions</code></p>
  </main>
</body>
</html>`;
}

function renderWinForms(rebinds: RebindRequest[]): string {
  const latest = rebinds[rebinds.length - 1];
  const latestLine = latest
    ? `<p class="muted">Latest rebind <code>${escapeHtml(latest.id)}</code> for <code>${escapeHtml(latest.agentKey)}</code> is ${escapeHtml(latest.status)}.</p>`
    : `<p class="muted">No rebind request yet.</p>`;
  return `<h2>Drive the win path</h2>
    <form method="post" action="/registry/register">
      <p>Register <input name="agentKey" value="K" /> for <input name="humanRef" value="human:demo-operator" /> <button>Register</button></p>
    </form>
    <form method="post" action="/registry/revoke">
      <p>Revoke <input name="agentKey" value="K" /> <button>Revoke</button></p>
    </form>
    <form method="post" action="/registry/rotate">
      <p>Rotate <input name="oldKey" value="K" /> to <input name="newKey" value="K2" /> <button>Rotate</button></p>
    </form>
    <form method="post" action="/demo/grant">
      <p>Signed grant for <input name="agentKey" value="K" /> <button>Grant</button></p>
    </form>
    ${latestLine}
    <form method="post" action="/rebind/start">
      <p>Start rebind for <input name="agentKey" value="K2" /> <button>Start rebind</button></p>
    </form>
    <form method="post" action="/rebind/decide">
      <p>IdP decision <input name="requestId" value="${latest ? escapeHtml(latest.id) : ""}" />
        <button name="outcome" value="validated">Validated</button>
        <button name="outcome" value="denied">Denied</button>
        <button name="outcome" value="cancelled">Cancelled</button>
      </p>
    </form>
    <form method="post" action="/rebind/finish">
      <p>Server finish <input name="requestId" value="${latest ? escapeHtml(latest.id) : ""}" /> <button>Attach if validated</button></p>
    </form>`;
}

export function createApp(registry: AgentBookRegistry, options: AppOptions = {}): Express {
  const mode: PaygateMode = options.mode ?? "win";
  const app = express();
  const sessions = new Map<string, Session>();
  const grants: GrantLogEntry[] = [];
  const desk = new RebindDesk(options.rebindTtlMs ?? 10 * 60 * 1000);
  const deviceCodes = new Map<string, string>();

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.get("/", (_req: Request, res: Response) => {
    res.type("html").send(renderPage(registry, grants, mode, desk.list()));
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
      res.status(400).json({ error: "agentKey is required" });
      return;
    }
    const record = registry.lookup(agentKey);
    if (!record?.rotatedFrom) {
      res.status(409).json({ error: "Rebind is only for a rotated-in key" });
      return;
    }
    try {
      const live = await startDeviceGrant();
      if (!live) {
        res.status(501).json({
          error: "Set WORLD_CLIENT_ID and WORLD_CLIENT_SECRET to start sandbox.auth.world.org",
        });
        return;
      }
      const request = desk.start(agentKey);
      deviceCodes.set(request.id, live.deviceCode);
      res.status(201).json({
        requestId: request.id,
        userCode: live.userCode,
        verificationUri: live.verificationUri,
        verificationUriComplete: live.verificationUriComplete,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Live rebind failed";
      res.status(502).json({ error: message });
    }
  });

  app.post("/rebind/live/pull", async (req: Request, res: Response) => {
    const requestId = readString(req.body?.requestId);
    if (!requestId) {
      res.status(400).json({ error: "requestId is required" });
      return;
    }
    const deviceCode = deviceCodes.get(requestId);
    if (!deviceCode) {
      res.status(404).json({ error: "No live device grant for this request" });
      return;
    }
    const subject = await pullValidatedSubject(deviceCode);
    if (!subject) {
      res.status(202).json({ attached: false, status: "pending" });
      return;
    }
    const request = desk.markValidated(requestId, subject, "https://sandbox.auth.world.org");
    const record = registry.attachWorldRebind(request.agentKey, `${request.issuer}|${subject}`);
    res.json({ attached: true, record });
  });

  app.post("/demo/grant", (req: Request, res: Response) => {
    const agentKey = readString(req.body?.agentKey);
    if (!agentKey) {
      reply(req, res, 400, { error: "agentKey is required" });
      return;
    }
    const signature = signAgentRequest(agentKey, PAID_MESSAGE);
    grantPaidResource(req, res, registry, sessions, grants, mode, agentKey, signature);
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
function reply(req: Request, res: Response, status: number, body: unknown): void {
  const type = req.header("content-type") ?? "";
  if (type.includes("application/json")) {
    res.status(status).json(body);
    return;
  }
  res.redirect("/");
}

function grantPaidResource(
  req: Request,
  res: Response,
  registry: AgentBookRegistry,
  sessions: Map<string, Session>,
  grants: GrantLogEntry[],
  mode: PaygateMode,
  signedKey?: string,
  signedValue?: string
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
    deny(res, grants, agentKey ?? "(missing)", 400, "missing agentKey or signature");
    return;
  }

  if (!verifyAgentRequest(agentKey, message, signature)) {
    deny(res, grants, agentKey, 401, "invalid signature");
    return;
  }

  const sessionId = readCookie(req, "agent_session");
  const session = sessionId ? sessions.get(sessionId) : undefined;
  const record = registry.lookup(agentKey);

  if (mode === "win") {
    grantWin(res, grants, sessions, agentKey, record);
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
    });
    return;
  }

  if (!record) {
    deny(res, grants, agentKey, 403, "agent key is not registered");
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
  });
}

function grantWin(
  res: Response,
  grants: GrantLogEntry[],
  sessions: Map<string, Session>,
  agentKey: string,
  record: AgentRecord | null
): void {
  if (!record) {
    deny(res, grants, agentKey, 403, "agent key is not registered", true, null);
    return;
  }
  if (record.revoked) {
    deny(res, grants, agentKey, 403, "revoked", true, true);
    return;
  }
  if (record.rotatedTo) {
    deny(res, grants, agentKey, 403, "rotated away", true, false);
    return;
  }
  if (record.rotatedFrom && !record.worldRebind) {
    deny(res, grants, agentKey, 403, "rebind required", true, false);
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

  res
    .cookie("agent_session", details.sessionId, { httpOnly: true, sameSite: "lax" })
    .json({
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
  revokedInRegistry: boolean | null = null
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
  res.status(status).json({ granted: false, error, checkedRevoke, revokedInRegistry });
}
