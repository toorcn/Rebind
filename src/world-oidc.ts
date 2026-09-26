import { createPublicKey, createVerify } from "crypto";

interface RsaJwk {
  kty?: string;
  n?: string;
  e?: string;
  kid?: string;
  alg?: string;
  use?: string;
}

const ISSUER = "https://sandbox.auth.world.org";
const DEVICE_ENDPOINT = `${ISSUER}/api/v1/device_authorization`;
const TOKEN_ENDPOINT = `${ISSUER}/api/v1/token`;
const JWKS_URI = `${ISSUER}/.well-known/jwks.json`;

export interface LiveDeviceGrant {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresIn: number;
  interval: number;
}

interface Jwks {
  keys: RsaJwk[];
}

function clientCredentials(): { id: string; secret: string } | null {
  const id = process.env.WORLD_CLIENT_ID;
  const secret = process.env.WORLD_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { id, secret };
}

/** Device authorization accepts HTTP Basic. A secret in the form body is rejected. */
function basicAuth(client: { id: string; secret: string }): string {
  return `Basic ${Buffer.from(`${client.id}:${client.secret}`).toString("base64")}`;
}

/** Starts a real device-authorization grant when a sandbox OIDC client is configured. */
export async function startDeviceGrant(): Promise<LiveDeviceGrant | null> {
  const client = clientCredentials();
  if (!client) return null;

  const response = await fetch(DEVICE_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: basicAuth(client),
    },
    body: new URLSearchParams({ client_id: client.id, scope: "openid" }),
  });
  if (!response.ok) {
    const detail = (await response.text()).replaceAll(client.secret, "[redacted]");
    throw new Error(`World device authorization failed: ${response.status} ${detail}`);
  }
  const body = (await response.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    verification_uri_complete?: string;
    expires_in?: number;
    interval?: number;
  };
  if (!body.device_code || !body.user_code || !body.verification_uri) {
    throw new Error("World device authorization response was incomplete");
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    verificationUriComplete: body.verification_uri_complete ?? null,
    expiresIn: body.expires_in ?? 300,
    interval: body.interval ?? 5,
  };
}

export type PullResult =
  | { kind: "pending" }
  | { kind: "validated"; subject: string }
  | { kind: "denied"; error: string };

const STILL_PENDING = new Set(["authorization_pending", "slow_down"]);

/**
 * Polls the token endpoint once and checks the ID token on the server.
 * The pairwise subject is returned only after signature, issuer, audience, and expiry check out.
 */
export async function pullValidatedSubject(deviceCode: string): Promise<PullResult> {
  const client = clientCredentials();
  if (!client) return { kind: "denied", error: "World client is not configured" };

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: basicAuth(client),
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: client.id,
    }),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    const error = detail?.error ?? "token_failed";
    if (STILL_PENDING.has(error)) return { kind: "pending" };
    return { kind: "denied", error };
  }
  const body = (await response.json()) as { id_token?: string };
  if (!body.id_token) return { kind: "denied", error: "missing_id_token" };
  const subject = await verifyIdToken(body.id_token, client.id);
  if (!subject) return { kind: "denied", error: "id_token_rejected" };
  return { kind: "validated", subject };
}

async function verifyIdToken(idToken: string, audience: string): Promise<string | null> {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) return null;

  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as {
    alg?: string;
    kid?: string;
  };
  if (header.alg !== "RS256") return null;

  const jwksResponse = await fetch(JWKS_URI);
  if (!jwksResponse.ok) return null;
  const jwks = (await jwksResponse.json()) as Jwks;
  const jwk = jwks.keys.find((key) => key.kid === header.kid) ?? jwks.keys[0];
  if (!jwk) return null;

  const signature = Buffer.from(encodedSignature, "base64url");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();
  const publicKey = createPublicKey({ key: jwk, format: "jwk" } as Parameters<
    typeof createPublicKey
  >[0]);
  if (!verifier.verify(publicKey, signature)) return null;

  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
    iss?: string;
    aud?: string | string[];
    exp?: number;
    sub?: string;
  };
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== ISSUER) return null;
  if (!audiences.includes(audience)) return null;
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) return null;
  if (!payload.sub) return null;
  return payload.sub;
}
