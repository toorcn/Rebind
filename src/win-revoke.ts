import type { Server } from "http";
import { createApp } from "./app";
import { AgentBookRegistry, type AgentRecord } from "./registry";
import { signAgentRequest } from "./sign";

const RESOURCE = "/api/resource/premium";
const MESSAGE = `POST ${RESOURCE}`;
const AGENT_KEY = "K";
const ROTATED_KEY = "K2";
const HUMAN_REF = "human:demo-operator";

interface GrantResponse {
  granted?: boolean;
  error?: string;
  checkedRevoke?: boolean;
  worldRebind?: string | null;
}

interface RecordResponse {
  record?: AgentRecord | null;
  attached?: boolean;
  status?: string;
  request?: { id: string; status: string; subject: string | null };
}

function line(label: string, value: string): void {
  console.log(`    ${label.padEnd(14)} ${value}`);
}

async function startInProcess(): Promise<{ base: string; close: () => Promise<void> }> {
  const registry = new AgentBookRegistry();
  const app = createApp(registry, { mode: "win" });
  const server: Server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind win server");
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

async function postJson(base: string, path: string, body: unknown): Promise<{ status: number; body: RecordResponse }> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as RecordResponse };
}

async function grant(
  base: string,
  agentKey: string,
  sessionCookie: string | null
): Promise<{ status: number; body: GrantResponse; session: string | null }> {
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
  const body = (await response.json()) as GrantResponse;
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = /agent_session=([^;]+)/.exec(setCookie);
  return { status: response.status, body, session: match?.[1] ?? sessionCookie };
}

async function main(): Promise<number> {
  const hosted = await startInProcess();
  const base = hosted.base;
  console.log("C3 win — revoke enforced, rebind required after rotate");
  console.log(`paygate: ${base}`);
  console.log("");

  try {
    const before = await postJson(base, "/registry/register", {
      agentKey: AGENT_KEY,
      humanRef: HUMAN_REF,
    });
    if (before.status !== 201) {
      console.log("FAIL register");
      return 1;
    }
    const first = await grant(base, AGENT_KEY, null);
    console.log("[1] grant before revoke");
    line("HTTP", String(first.status));
    line("granted", String(first.body.granted === true));
    if (first.status !== 200 || first.body.granted !== true) return 1;
    console.log("");

    await postJson(base, "/registry/revoke", { agentKey: AGENT_KEY });
    const after = await grant(base, AGENT_KEY, first.session);
    const fresh = await grant(base, AGENT_KEY, null);
    console.log("[2] grant after revoke, session and fresh");
    line("session", `${after.status} ${after.body.error ?? ""}`);
    line("fresh", `${fresh.status} ${fresh.body.error ?? ""}`);
    line("checkedRevoke", String(after.body.checkedRevoke === true));
    const revokedDenied =
      after.status === 403 &&
      after.body.granted !== true &&
      after.body.error === "revoked" &&
      after.body.checkedRevoke === true &&
      fresh.status === 403 &&
      fresh.body.error === "revoked";
    if (!revokedDenied) {
      console.log("FAIL: revoked key still granted");
      return 1;
    }
    console.log("");
    console.log("REVOKE_ENFORCED");
    console.log("");

    const rotated = await postJson(base, "/registry/rotate", {
      oldKey: AGENT_KEY,
      newKey: ROTATED_KEY,
    });
    if (rotated.status !== 200) {
      console.log("FAIL: rotate");
      return 1;
    }
    const oldKey = await grant(base, AGENT_KEY, first.session);
    const newKey = await grant(base, ROTATED_KEY, null);
    console.log("[3] rotate without rebind");
    line("old K", `${oldKey.status} ${oldKey.body.error ?? ""}`);
    line("new K2", `${newKey.status} ${newKey.body.error ?? ""}`);
    if (oldKey.status !== 403 || newKey.status !== 403 || newKey.body.error !== "rebind required") {
      console.log("FAIL: rotate without rebind still granted");
      return 1;
    }
    console.log("");

    const started = await postJson(base, "/rebind/start", { agentKey: ROTATED_KEY });
    const requestId = started.body.request?.id;
    if (started.status !== 201 || !requestId) {
      console.log("FAIL: rebind start");
      return 1;
    }
    const forged = await postJson(base, "/rebind/finish", { requestId, validated: true });
    const stillBlocked = await grant(base, ROTATED_KEY, null);
    console.log("[4] client claims validated, server did not");
    line("finish", String(forged.status));
    line("K2", `${stillBlocked.status} ${stillBlocked.body.error ?? ""}`);
    if (forged.status !== 403 || stillBlocked.body.granted === true) {
      console.log("FAIL: client claim unlocked the grant");
      return 1;
    }
    console.log("");
    console.log("MUTE_WORLD_HELD");
    console.log("");

    const denied = await postJson(base, "/rebind/decide", { requestId, outcome: "denied" });
    const afterDeny = await grant(base, ROTATED_KEY, null);
    console.log("[5] IdP denied");
    line("status", String(denied.body.request?.status));
    line("K2", `${afterDeny.status} ${afterDeny.body.error ?? ""}`);
    if (denied.body.request?.status !== "denied" || afterDeny.body.granted === true) {
      console.log("FAIL: denied rebind still granted");
      return 1;
    }
    console.log("");

    const again = await postJson(base, "/rebind/start", { agentKey: ROTATED_KEY });
    const okId = again.body.request?.id;
    if (!okId) return 1;
    const validated = await postJson(base, "/rebind/decide", { requestId: okId, outcome: "validated" });
    const finished = await postJson(base, "/rebind/finish", { requestId: okId });
    const paid = await grant(base, ROTATED_KEY, null);
    console.log("[6] server-validated rebind, then grant");
    line("subject", String(validated.body.request?.subject ? "minted" : "missing"));
    line("attached", String(finished.body.attached === true));
    line("K2", `${paid.status} granted=${paid.body.granted === true}`);
    if (finished.body.attached !== true || paid.status !== 200 || paid.body.granted !== true) {
      console.log("FAIL: validated rebind did not grant");
      return 1;
    }
    if (!finished.body.record?.worldRebind?.startsWith("local-sandbox|")) {
      console.log("FAIL: proof was not server-minted");
      return 1;
    }
    console.log("");
    console.log("REBIND_GRANTED");
    console.log("K died after revoke. K2 granted only after the server validated the rebind.");
    return 0;
  } finally {
    await hosted.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "win failed");
    process.exitCode = 1;
  });
