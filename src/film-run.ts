import type { Server } from "http";
import { createApp, type PaygateMode } from "./paygate";
import { AgentBookRegistry } from "./registry";
import { signAgentRequest } from "./sign";

const RESOURCE = "/api/resource/premium";
const MESSAGE = `POST ${RESOURCE}`;
const HUMAN = "human:demo-operator";

export interface FilmLine {
  label: string;
  value: string;
}

export interface FilmBeat {
  n: number;
  title: string;
  judgeSees: string;
  mode: PaygateMode;
  lines: FilmLine[];
  stamp: string;
  passed: boolean;
}

export interface Film {
  passed: boolean;
  beats: FilmBeat[];
  liveWorld: "configured" | "unavailable";
  note: string;
}

interface GrantBody {
  granted?: boolean;
  error?: string;
  checkedRevoke?: boolean;
  revokedInRegistry?: boolean | null;
  foil?: string;
  worldRebind?: string | null;
}

interface RecordBody {
  attached?: boolean;
  error?: string;
  record?: { worldRebind?: string | null } | null;
  request?: { id?: string; status?: string; subject?: string | null };
}

interface Host {
  base: string;
  close: () => Promise<void>;
}

async function listen(mode: PaygateMode, rebindTtlMs: number): Promise<Host> {
  const registry = new AgentBookRegistry();
  const app = createApp(registry, { mode, rebindTtlMs });
  const server: Server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error(`Failed to bind ${mode} server`);
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

async function post(base: string, path: string, body: unknown): Promise<{ status: number; body: RecordBody }> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as RecordBody };
}

async function grant(
  base: string,
  agentKey: string,
  sessionCookie: string | null
): Promise<{ status: number; body: GrantBody; session: string | null }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-agent-key": agentKey,
  };
  if (sessionCookie) headers.cookie = `agent_session=${sessionCookie}`;
  const response = await fetch(`${base}${RESOURCE}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      agentKey,
      message: MESSAGE,
      signature: signAgentRequest(agentKey, MESSAGE),
    }),
  });
  const body = (await response.json()) as GrantBody;
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = /agent_session=([^;]+)/.exec(setCookie);
  return { status: response.status, body, session: match?.[1] ?? sessionCookie };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function beat(
  n: number,
  title: string,
  judgeSees: string,
  mode: PaygateMode,
  lines: FilmLine[],
  stamp: string,
  passed: boolean
): FilmBeat {
  return { n, title, judgeSees, mode, lines, stamp, passed };
}

/**
 * The 90-second cut. Foil and win are separate processes-in-process so the
 * before shot cannot leak into the enforce path. The success subject is minted
 * by our server. It is not a World App proof.
 */
export async function runFilm(): Promise<Film> {
  const foil = await listen("foil", 10 * 60 * 1000);
  const win = await listen("win", 2000);
  const beats: FilmBeat[] = [];

  try {
    const registered = await post(win.base, "/registry/register", { agentKey: "K", humanRef: HUMAN });
    const first = await grant(win.base, "K", null);
    beats.push(
      beat(
        1,
        "Register K. The paid request is granted.",
        "An integrator registers agent key K. The first signed request for the paid resource returns 200.",
        "win",
        [
          { label: "register", value: String(registered.status) },
          { label: "grant", value: `${first.status} granted=${first.body.granted === true}` },
        ],
        "GRANTED",
        registered.status === 201 && first.status === 200 && first.body.granted === true
      )
    );

    const foilReg = await post(foil.base, "/registry/register", { agentKey: "K", humanRef: HUMAN });
    const foilFirst = await grant(foil.base, "K", null);
    await post(foil.base, "/registry/revoke", { agentKey: "K" });
    const foilSession = await grant(foil.base, "K", foilFirst.session);
    const foilFresh = await grant(foil.base, "K", null);
    const foilHole =
      foilReg.status === 201 &&
      foilSession.status === 200 &&
      foilSession.body.granted === true &&
      foilSession.body.revokedInRegistry === true &&
      foilSession.body.checkedRevoke === false &&
      foilFresh.status === 200 &&
      foilFresh.body.granted === true &&
      foilFresh.body.revokedInRegistry === true;
    beats.push(
      beat(
        2,
        "Foil: revoke is recorded. K still pays.",
        "The registry says revoked. The open session and a brand-new signature both still get the paid resource. This is the hole.",
        "foil",
        [
          { label: "session", value: `${foilSession.status} revoked=${String(foilSession.body.revokedInRegistry)}` },
          { label: "fresh", value: `${foilFresh.status} revoked=${String(foilFresh.body.revokedInRegistry)}` },
          { label: "checkedRevoke", value: String(foilSession.body.checkedRevoke === true) },
        ],
        "REVOKE_INEFFECTIVE",
        foilHole
      )
    );

    await post(win.base, "/registry/revoke", { agentKey: "K" });
    const after = await grant(win.base, "K", first.session);
    const fresh = await grant(win.base, "K", null);
    const revokedDenied =
      after.status === 403 &&
      after.body.error === "revoked" &&
      after.body.checkedRevoke === true &&
      fresh.status === 403 &&
      fresh.body.error === "revoked";
    beats.push(
      beat(
        3,
        "Win: the same key dies mid-loop.",
        "Revoke K. The session that already paid, and a fresh signature, both return 403. The cookie is not authority.",
        "win",
        [
          { label: "session", value: `${after.status} ${after.body.error ?? ""}` },
          { label: "fresh", value: `${fresh.status} ${fresh.body.error ?? ""}` },
          { label: "checkedRevoke", value: String(after.body.checkedRevoke === true) },
        ],
        "REVOKE_ENFORCED",
        revokedDenied
      )
    );

    const rotated = await post(win.base, "/registry/rotate", { oldKey: "K", newKey: "K2" });
    const oldKey = await grant(win.base, "K", null);
    const newKey = await grant(win.base, "K2", null);
    const rotateBlocked =
      rotated.status === 200 &&
      oldKey.status === 403 &&
      newKey.status === 403 &&
      newKey.body.error === "rebind required";
    beats.push(
      beat(
        4,
        "Rotate without a human proof. K2 cannot pay.",
        "K is pointed at K2. K2 is registered and still has no server-side rebind, so the paid grant stays 403.",
        "win",
        [
          { label: "old K", value: `${oldKey.status} ${oldKey.body.error ?? ""}` },
          { label: "new K2", value: `${newKey.status} ${newKey.body.error ?? ""}` },
        ],
        "REBIND_REQUIRED",
        rotateBlocked
      )
    );

    const started = await post(win.base, "/rebind/start", { agentKey: "K2" });
    const okId = started.body.request?.id;
    const validated = okId
      ? await post(win.base, "/rebind/decide", { requestId: okId, outcome: "validated" })
      : { status: 0, body: {} };
    const finished = okId ? await post(win.base, "/rebind/finish", { requestId: okId }) : { status: 0, body: {} };
    const paid = await grant(win.base, "K2", null);
    const proof = finished.body.record?.worldRebind ?? "";
    const rebound =
      started.status === 201 &&
      validated.body.request?.status === "validated" &&
      typeof validated.body.request.subject === "string" &&
      finished.body.attached === true &&
      proof.startsWith("local-sandbox|") &&
      paid.status === 200 &&
      paid.body.granted === true;
    beats.push(
      beat(
        5,
        "Server validates, then K2 pays.",
        "The server mints the subject. The client never supplies it. Finish attaches local-sandbox|subject, and only then does K2 get 200. This stand-in is not a World App approval.",
        "win",
        [
          { label: "subject", value: validated.body.request?.subject ? "minted on server" : "missing" },
          { label: "proof", value: proof.startsWith("local-sandbox|") ? "local-sandbox|…" : proof || "none" },
          { label: "K2", value: `${paid.status} granted=${paid.body.granted === true}` },
        ],
        "REBIND_GRANTED",
        rebound
      )
    );

    const toK3 = await post(win.base, "/registry/rotate", { oldKey: "K2", newKey: "K3" });
    const deniedStart = await post(win.base, "/rebind/start", { agentKey: "K3" });
    const deniedId = deniedStart.body.request?.id;
    const denied = deniedId
      ? await post(win.base, "/rebind/decide", { requestId: deniedId, outcome: "denied" })
      : { status: 0, body: {} };
    const afterDeny = await grant(win.base, "K3", null);

    const cancelStart = await post(win.base, "/rebind/start", { agentKey: "K3" });
    const cancelId = cancelStart.body.request?.id;
    const cancelled = cancelId
      ? await post(win.base, "/rebind/decide", { requestId: cancelId, outcome: "cancelled" })
      : { status: 0, body: {} };
    const afterCancel = await grant(win.base, "K3", null);

    const expireStart = await post(win.base, "/rebind/start", { agentKey: "K3" });
    const expireId = expireStart.body.request?.id;
    await sleep(2300);
    const expired = expireId ? await post(win.base, "/rebind/finish", { requestId: expireId }) : { status: 0, body: {} };
    const afterExpire = await grant(win.base, "K3", null);
    const failHeld =
      toK3.status === 200 &&
      denied.body.request?.status === "denied" &&
      afterDeny.status === 403 &&
      afterDeny.body.granted !== true &&
      cancelled.body.request?.status === "cancelled" &&
      afterCancel.status === 403 &&
      afterCancel.body.granted !== true &&
      expired.status === 403 &&
      afterExpire.status === 403 &&
      afterExpire.body.granted !== true;
    beats.push(
      beat(
        6,
        "Denied, cancelled, or expired. K3 does not pay.",
        "A new key with a failed human proof stays dark. Denied, cancelled, and a request that expires before validation all leave the grant at 403.",
        "win",
        [
          { label: "denied", value: `${denied.body.request?.status ?? "missing"} → ${afterDeny.status}` },
          { label: "cancelled", value: `${cancelled.body.request?.status ?? "missing"} → ${afterCancel.status}` },
          { label: "expired", value: `${expired.status} then grant ${afterExpire.status}` },
        ],
        "NO_GRANT",
        failHeld
      )
    );

    const muteStart = await post(win.base, "/rebind/start", { agentKey: "K3" });
    const muteId = muteStart.body.request?.id;
    const forged = muteId
      ? await post(win.base, "/rebind/finish", { requestId: muteId, validated: true })
      : { status: 0, body: {} };
    const stillBlocked = await grant(win.base, "K3", null);
    const muteHeld =
      muteStart.status === 201 &&
      forged.status === 403 &&
      forged.body.attached !== true &&
      stillBlocked.status === 403 &&
      stillBlocked.body.granted !== true &&
      stillBlocked.body.error === "rebind required";
    beats.push(
      beat(
        7,
        "A client that says validated does not unlock the grant.",
        "The body includes validated: true. The server has not decided that. Finish returns 403 and K3 still cannot pay.",
        "win",
        [
          { label: "finish", value: String(forged.status) },
          { label: "K3", value: `${stillBlocked.status} ${stillBlocked.body.error ?? ""}` },
        ],
        "MUTE_WORLD_HELD",
        muteHeld
      )
    );

    const liveWorld =
      process.env.WORLD_CLIENT_ID && process.env.WORLD_CLIENT_SECRET ? "configured" : "unavailable";
    return {
      passed: beats.every((item) => item.passed),
      beats,
      liveWorld,
      note:
        liveWorld === "configured"
          ? "Sandbox client credentials are set. The film above still uses the local stand-in. A person has to approve the device code in World App for a live proof."
          : "Live World App is not wired. WORLD_CLIENT_ID and WORLD_CLIENT_SECRET are unset, so beat 5 is a server-minted local-sandbox subject.",
    };
  } finally {
    await foil.close();
    await win.close();
  }
}
