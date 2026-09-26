import type { Server } from "http";
import { createApp } from "./paygate";
import { AgentBookRegistry, type AgentRecord } from "./registry";
import { signAgentRequest } from "./sign";

const RESOURCE = "/api/resource/premium";
const MESSAGE = `POST ${RESOURCE}`;
const AGENT_KEY = "K";
const ROTATED_KEY = "K2";
const HUMAN_REF = "human:demo-operator";

interface GrantResponse {
  granted?: boolean;
  via?: string;
  revokedInRegistry?: boolean | null;
  checkedRevoke?: boolean;
  worldRebind?: string | null;
  error?: string;
  foil?: string;
}

interface RecordResponse {
  record: AgentRecord | null;
}

function againstUrl(): string | null {
  const flag = process.argv.indexOf("--against");
  if (flag === -1) return null;
  const url = process.argv[flag + 1];
  if (!url) {
    throw new Error("Usage: npm run foil-revoke -- --against http://127.0.0.1:43210");
  }
  return url.replace(/\/$/, "");
}

async function startInProcess(): Promise<{ base: string; close: () => Promise<void> }> {
  const registry = new AgentBookRegistry();
  const app = createApp(registry, { mode: "foil" });
  const server: Server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind foil server");
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

async function postJson(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
  if (sessionCookie) {
    headers.cookie = `agent_session=${sessionCookie}`;
  }
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
  const session = match?.[1] ?? sessionCookie;
  return { status: response.status, body, session };
}

function line(label: string, value: string): void {
  console.log(`    ${label.padEnd(14)} ${value}`);
}

async function main(): Promise<number> {
  const external = againstUrl();
  const hosted = external ? null : await startInProcess();
  const base = external ?? hosted?.base;
  if (!base) {
    throw new Error("No foil base URL");
  }

  console.log("C3 Day 0 — revoke theater");
  console.log("spine: AgentBook revoke/rotate, app-layer foil");
  console.log(`paygate: ${base}`);
  console.log("grant decision ignores revoked and rotatedTo");
  console.log("");

  try {
    const unknown = await grant(base, "never-registered", null);
    console.log("[0] control — key that was never registered");
    line("HTTP", String(unknown.status));
    line("granted", String(unknown.body.granted === true));
    if (unknown.status !== 403 || unknown.body.granted === true) {
      console.log("FAIL control: unregistered key was granted");
      return 1;
    }
    console.log("    denied, as expected");
    console.log("");

    const registered = await postJson(base, "/registry/register", {
      agentKey: AGENT_KEY,
      humanRef: HUMAN_REF,
    });
    if (registered.status !== 201) {
      console.log(`FAIL register: HTTP ${registered.status}`);
      return 1;
    }
    console.log("[1] register");
    line("key", AGENT_KEY);
    line("human", HUMAN_REF);
    console.log("");

    const before = await grant(base, AGENT_KEY, null);
    console.log("[2] grant before revoke");
    line("HTTP", String(before.status));
    line("granted", String(before.body.granted === true));
    line("via", String(before.body.via));
    if (before.status !== 200 || before.body.granted !== true || !before.session) {
      console.log("FAIL: initial grant should succeed");
      return 1;
    }
    console.log("");

    const revokedRes = await postJson(base, "/registry/revoke", { agentKey: AGENT_KEY });
    const revokedBody = (await revokedRes.json()) as RecordResponse;
    console.log("[3] revoke");
    line("HTTP", String(revokedRes.status));
    line("revoked", String(revokedBody.record?.revoked === true));
    if (revokedRes.status !== 200 || revokedBody.record?.revoked !== true) {
      console.log("FAIL: revoke did not flip the registry flag");
      return 1;
    }

    const lookupRes = await fetch(`${base}/registry/lookup/${AGENT_KEY}`);
    const lookupBody = (await lookupRes.json()) as RecordResponse;
    line("lookup", lookupBody.record?.revoked ? "revoked=true" : "revoked=false");
    console.log("");

    const after = await grant(base, AGENT_KEY, before.session);
    console.log("[4] grant after revoke — same key K, session still open");
    line("HTTP", String(after.status));
    line("granted", String(after.body.granted === true));
    line("via", String(after.body.via));
    line("revoked", String(after.body.revokedInRegistry === true));
    line("checkedRevoke", String(after.body.checkedRevoke));
    console.log("");

    const fresh = await grant(base, AGENT_KEY, null);
    console.log("[5] grant after revoke — fresh request, no session cookie");
    line("HTTP", String(fresh.status));
    line("granted", String(fresh.body.granted === true));
    line("via", String(fresh.body.via));
    line("revoked", String(fresh.body.revokedInRegistry === true));

    const revokeIgnored =
      after.status === 200 &&
      after.body.granted === true &&
      after.body.revokedInRegistry === true &&
      after.body.checkedRevoke === false &&
      fresh.status === 200 &&
      fresh.body.granted === true &&
      fresh.body.revokedInRegistry === true;

    if (!revokeIgnored) {
      console.log("");
      console.log("FAIL: revoke stopped the grant. This script expects the Day 0 hole.");
      return 1;
    }

    console.log("");
    console.log("REVOKE_INEFFECTIVE");
    console.log("Key K is revoked in the registry and the paid grant still returned 200.");
    console.log("");

    const rotatedRes = await postJson(base, "/registry/rotate", {
      oldKey: AGENT_KEY,
      newKey: ROTATED_KEY,
    });
    const rotatedBody = (await rotatedRes.json()) as {
      newRecord?: AgentRecord;
      error?: string;
    };
    console.log("[6] rotate K → K2 with no World re-bind");
    line("HTTP", String(rotatedRes.status));
    line("newKey", ROTATED_KEY);
    line("world", String(rotatedBody.newRecord?.worldRebind ?? "null"));
    if (rotatedRes.status !== 200 || rotatedBody.newRecord?.worldRebind != null) {
      console.log("FAIL: rotate did not leave worldRebind empty");
      return 1;
    }
    console.log("");

    const oldStill = await grant(base, AGENT_KEY, before.session);
    const newKeyGrant = await grant(base, ROTATED_KEY, null);
    console.log("[7] grants after rotate");
    line("old K", `${oldStill.status} granted=${oldStill.body.granted === true}`);
    line("new K2", `${newKeyGrant.status} granted=${newKeyGrant.body.granted === true}`);
    line("K2 world", String(newKeyGrant.body.worldRebind ?? "null"));

    const rotateHole =
      oldStill.status === 200 &&
      oldStill.body.granted === true &&
      newKeyGrant.status === 200 &&
      newKeyGrant.body.granted === true &&
      newKeyGrant.body.worldRebind == null;

    if (!rotateHole) {
      console.log("");
      console.log("FAIL: rotate was enforced. Day 0 foil should still accept K and K2.");
      return 1;
    }

    console.log("");
    console.log("ROTATE_NO_REBIND");
    console.log("K2 granted with worldRebind=null. Old key K still granted too.");
    console.log("");
    console.log("Win mode denies K after revoke, and refuses K2 until a server-validated rebind.");
    return 0;
  } finally {
    if (hosted) {
      await hosted.close();
    }
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "foil failed";
    console.error(message);
    process.exitCode = 1;
  });
