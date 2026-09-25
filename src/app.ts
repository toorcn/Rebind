import { randomBytes } from "crypto";
import express, { type Express, type Request, type Response } from "express";
import { AgentBookRegistry, type AgentRecord } from "./registry";
import { verifyAgentRequest } from "./sign";

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
  /** Day 0 foil always leaves this false. The flag is observed, never enforced. */
  checkedRevoke: false;
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

function renderPage(registry: AgentBookRegistry, grants: GrantLogEntry[]): string {
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
  <title>C3 Day 0 — revoke theater</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="2" />
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
    <h1>Revoke theater</h1>
    <p class="muted">C3 Day 0 foil. AgentBook-shaped registry. Paygate does not enforce revoke.</p>
    <div class="banner">
      Marking a key revoked updates this table. The paid grant still returns GRANTED.
      That is the bug this fixture is here to show.
    </div>
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

export function createApp(registry: AgentBookRegistry): Express {
  const app = express();
  const sessions = new Map<string, Session>();
  const grants: GrantLogEntry[] = [];

  app.use(express.json());

  app.get("/", (_req: Request, res: Response) => {
    res.type("html").send(renderPage(registry, grants));
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      spine: "C3",
      day: 0,
      foil: "revoke-theater",
      enforcesRevoke: false,
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
      res.status(201).json({ record });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Register failed";
      res.status(409).json({ error: message });
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
      res.json({ record, note: "Flag flipped. Day 0 paygate does not read it." });
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
      res.json({
        ...result,
        note: "Mapping updated. No World re-bind. Day 0 paygate still accepts both keys.",
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

  app.get(PAID_RESOURCE, (_req: Request, res: Response) => {
    res.status(402).json({
      error: "payment_required",
      resource: PAID_RESOURCE,
      accepts: ["agent-signed-request"],
      message: PAID_MESSAGE,
      note: "Day 0 paygate stub. No x402 facilitator and no World ID check.",
    });
  });

  app.post(PAID_RESOURCE, (req: Request, res: Response) => {
    grantPaidResource(req, res, registry, sessions, grants);
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
function grantPaidResource(
  req: Request,
  res: Response,
  registry: AgentBookRegistry,
  sessions: Map<string, Session>,
  grants: GrantLogEntry[]
): void {
  const body: GrantBody =
    typeof req.body === "object" && req.body !== null ? (req.body as GrantBody) : {};

  const agentKey =
    readString(req.header("x-agent-key")) ?? readString(body.agentKey);
  const message = readString(body.message) ?? PAID_MESSAGE;
  const signature =
    readString(req.header("x-agent-signature")) ?? readString(body.signature);

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

  const record = registry.lookup(agentKey);
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
  }
): void {
  grants.push({
    at: Date.now(),
    agentKey: details.agentKey,
    resource: PAID_RESOURCE,
    granted: true,
    via: details.via,
    httpStatus: 200,
    revokedInRegistry: details.revokedInRegistry,
    checkedRevoke: false,
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
      checkedRevoke: false,
      worldRebind: details.worldRebind,
      foil: details.revokedInRegistry ? "REVOKE_IGNORED" : "GRANTED",
    });
}

function deny(
  res: Response,
  grants: GrantLogEntry[],
  agentKey: string,
  status: number,
  error: string
): void {
  grants.push({
    at: Date.now(),
    agentKey,
    resource: PAID_RESOURCE,
    granted: false,
    via: "denied",
    httpStatus: status,
    revokedInRegistry: null,
    checkedRevoke: false,
    worldRebind: null,
  });
  res.status(status).json({ granted: false, error });
}
