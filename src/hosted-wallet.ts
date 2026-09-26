import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import type { ChainStatus } from "./chain";

const ORIGIN = "https://rebind-psi.vercel.app";
const SESSION_COOKIE = "rebind_wallet_session";
const SESSION_TTL = 60 * 60 * 1000;

export interface HostedWallet {
  status: () => Promise<ChainStatus>;
  relay: RequestHandler;
}

/** Local UI, existing hosted wallet API. Deployment secrets never leave the backend. */
export function createHostedWallet(): HostedWallet {
  const sessions = new Map<string, { cookie: string; expires: number }>();
  let cached: { value: ChainStatus; expires: number } | undefined;

  const status = async (): Promise<ChainStatus> => {
    if (cached && cached.expires > Date.now()) return cached.value;
    const response = await fetch(`${ORIGIN}/chain`, { signal: AbortSignal.timeout(15_000), redirect: "error" });
    if (!response.ok) throw new Error("The hosted wallet service is unavailable. Try again shortly.");
    const value = await response.json() as ChainStatus;
    if (typeof value.configured !== "boolean" || !value.chainIdHex || !value.rpcUrl) {
      throw new Error("The hosted wallet service returned invalid network settings.");
    }
    value.demoAvailable = false;
    cached = { value, expires: Date.now() + 30_000 };
    return value;
  };

  const relay: RequestHandler = async (req, res) => {
    if (req.method !== "GET" && req.method !== "POST") {
      res.status(405).json({ error: "method-not-allowed" });
      return;
    }
    const url = new URL(req.originalUrl, ORIGIN);
    if (url.origin !== ORIGIN || !/^\/chain(?:\/|$)/.test(url.pathname)) {
      res.status(400).json({ error: "invalid-wallet-path" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/chain") {
      try {
        res.setHeader("Cache-Control", "no-store");
        res.json(await status());
      } catch {
        res.status(502).json({ error: "wallet-service-unavailable" });
      }
      return;
    }
    for (const [id, session] of sessions) {
      if (session.expires <= Date.now()) sessions.delete(id);
    }
    const suppliedId = req.headers.cookie?.split(";").map(part => part.trim())
      .find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    const id = suppliedId && sessions.has(suppliedId) ? suppliedId : randomUUID();
    const session = sessions.get(id) ?? { cookie: "", expires: Date.now() + SESSION_TTL };
    sessions.set(id, session);
    res.cookie(SESSION_COOKIE, id, { httpOnly: true, sameSite: "strict", path: "/chain", maxAge: SESSION_TTL });
    res.setHeader("Cache-Control", "no-store");
    try {
      const headers: Record<string, string> = { accept: "application/json" };
      if (session.cookie) headers.cookie = session.cookie;
      if (req.method === "POST") headers["content-type"] = "application/json";
      const upstream = await fetch(url, {
        method: req.method,
        headers,
        body: req.method === "POST" ? JSON.stringify(req.body ?? {}) : undefined,
        signal: AbortSignal.timeout(90_000),
        redirect: "error",
      });
      // Keep World device-grant state on this server, isolated from local credit cookies.
      // Read-only responses must not overwrite a concurrent verification update.
      if (req.method === "POST" || !session.cookie) {
        const cookie = upstream.headers.getSetCookie().find(value => value.startsWith("rebind_state="));
        if (cookie) session.cookie = cookie.split(";", 1)[0]!;
      }
      session.expires = Date.now() + SESSION_TTL;
      res.status(upstream.status).type("application/json").send(await upstream.text());
    } catch {
      res.status(502).json({ error: "wallet-service-unavailable", detail: "The hosted wallet service could not be reached. Try again shortly." });
    }
  };
  return { status, relay };
}
