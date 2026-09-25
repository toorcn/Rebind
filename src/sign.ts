import { createHash } from "crypto";

/**
 * Day 0 signature stub. Not a wallet signature and not AgentKit.
 * Enough to show the paygate accepts a signed request bound to an agent key.
 */
export function signAgentRequest(agentKey: string, message: string): string {
  return createHash("sha256").update(`${agentKey}:${message}`).digest("hex");
}

export function verifyAgentRequest(
  agentKey: string,
  message: string,
  signature: string
): boolean {
  const expected = signAgentRequest(agentKey, message);
  return signature.length === expected.length && signature === expected;
}
