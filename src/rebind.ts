import { randomBytes } from "crypto";

export type RebindStatus = "pending" | "validated" | "denied" | "expired" | "cancelled";

export interface RebindRequest {
  id: string;
  agentKey: string;
  status: RebindStatus;
  createdAt: number;
  expiresAt: number;
  /** Set by the server when status becomes validated. Never taken from the client. */
  subject: string | null;
  issuer: string;
}

const LOCAL_ISSUER = "local-sandbox";

/**
 * Server-side rebind desk. The grant path reads this; a client body cannot
 * mark a request validated.
 *
 * Live World ID for Agents (sandbox.auth.world.org device flow) is a separate
 * pull in world-oidc.ts. This desk is the filmable IdP double with the same
 * states: pending, validated, denied, expired, cancelled.
 */
export class RebindDesk {
  private readonly requests = new Map<string, RebindRequest>();

  constructor(private readonly ttlMs: number) {}

  start(agentKey: string, now = Date.now()): RebindRequest {
    const request: RebindRequest = {
      id: randomBytes(16).toString("hex"),
      agentKey,
      status: "pending",
      createdAt: now,
      expiresAt: now + this.ttlMs,
      subject: null,
      issuer: LOCAL_ISSUER,
    };
    this.requests.set(request.id, request);
    return request;
  }

  get(id: string, now = Date.now()): RebindRequest | null {
    const request = this.requests.get(id);
    if (!request) return null;
    if (request.status === "pending" && now >= request.expiresAt) {
      request.status = "expired";
    }
    return request;
  }

  /**
   * IdP decision. `validated` mints a subject here. The caller cannot supply one.
   */
  decide(
    id: string,
    outcome: "validated" | "denied" | "cancelled",
    now = Date.now()
  ): RebindRequest {
    const request = this.get(id, now);
    if (!request) {
      throw new Error("Rebind request not found");
    }
    if (request.status === "expired") {
      return request;
    }
    if (request.status !== "pending") {
      throw new Error(`Rebind request is already ${request.status}`);
    }
    request.status = outcome;
    if (outcome === "validated") {
      request.subject = `sub_${randomBytes(12).toString("hex")}`;
    }
    return request;
  }

  /** Records a subject the server verified from an ID token. */
  markValidated(id: string, subject: string, issuer: string, now = Date.now()): RebindRequest {
    const request = this.get(id, now);
    if (!request) {
      throw new Error("Rebind request not found");
    }
    if (request.status === "expired") {
      return request;
    }
    if (request.status !== "pending") {
      throw new Error(`Rebind request is already ${request.status}`);
    }
    request.status = "validated";
    request.subject = subject;
    request.issuer = issuer;
    return request;
  }

  list(): RebindRequest[] {
    return [...this.requests.values()];
  }
}
