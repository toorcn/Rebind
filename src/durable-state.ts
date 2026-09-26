import { createHmac, timingSafeEqual } from "crypto";
import { jobsFromUnknown, type Job } from "./pool";
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

/** What the human needs to see. The device code itself stays out of this object. */
export interface WorldPrompt {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
}

export interface DurableState {
  agents: AgentRecord[];
  rebinds: RebindRequest[];
  deviceCodes: Record<string, string>;
  prompts: Record<string, WorldPrompt>;
  grants: DurableGrant[];
  jobs: Job[];
  jobDevices: Record<string, string>;
  jobPrompts: Record<string, WorldPrompt>;
}

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

function promptRecord(value: unknown): Record<string, WorldPrompt> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, WorldPrompt> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "object" || item === null) continue;
    const prompt = item as Partial<WorldPrompt>;
    if (
      typeof prompt.userCode !== "string" ||
      typeof prompt.verificationUri !== "string" ||
      typeof prompt.verificationUriComplete !== "string"
    ) {
      continue;
    }
    out[key] = {
      userCode: prompt.userCode,
      verificationUri: prompt.verificationUri,
      verificationUriComplete: prompt.verificationUriComplete,
    };
  }
  return out;
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
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<DurableState>;
    if (!Array.isArray(parsed.agents) || !Array.isArray(parsed.rebinds) || !Array.isArray(parsed.grants)) {
      return null;
    }
    if (typeof parsed.deviceCodes !== "object" || parsed.deviceCodes === null) return null;
    if (typeof parsed.prompts !== "object" || parsed.prompts === null) parsed.prompts = {};
    return {
      agents: parsed.agents,
      rebinds: parsed.rebinds,
      deviceCodes: parsed.deviceCodes,
      prompts: parsed.prompts,
      grants: parsed.grants,
      jobs: jobsFromUnknown(parsed.jobs),
      jobDevices: stringRecord(parsed.jobDevices),
      jobPrompts: promptRecord(parsed.jobPrompts),
    };
  } catch {
    return null;
  }
}
