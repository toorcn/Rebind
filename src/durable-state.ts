import { createHmac, timingSafeEqual } from "crypto";
import type { RebindRequest } from "./rebind";
import type { AgentRecord } from "./registry";

export interface DurableGrant {
  at: number;
  agentKey: string;
  resource: string;
  granted: boolean;
  via: "session" | "lookup" | "denied";
  httpStatus: number;
  revokedInRegistry: boolean | null;
  checkedRevoke: boolean;
  worldRebind: string | null;
}

export interface DurableState {
  agents: AgentRecord[];
  rebinds: RebindRequest[];
  deviceCodes: Record<string, string>;
  grants: DurableGrant[];
}

/** Signs the desk state so a browser can carry it without being able to edit it. */
export function sealState(state: DurableState, secret: string): string {
  const body = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function openState(token: string, secret: string): DurableState | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const actualBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as DurableState;
    if (!Array.isArray(parsed.agents) || !Array.isArray(parsed.rebinds) || !Array.isArray(parsed.grants)) {
      return null;
    }
    if (typeof parsed.deviceCodes !== "object" || parsed.deviceCodes === null) return null;
    return parsed;
  } catch {
    return null;
  }
}
