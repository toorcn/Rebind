import type { Express, Request, Response } from "express";
import {
  chainConfigFromEnv,
  runChainScenario,
  type ChainReport,
} from "./chain-scenario";

export interface ChainStatus {
  configured: boolean;
  network: string;
  chainId: number;
  explorer: string;
  addresses: Record<string, string> | null;
}

export function chainStatus(): ChainStatus {
  const config = chainConfigFromEnv(process.env);
  if (!config) {
    return { configured: false, network: "", chainId: 0, explorer: "", addresses: null };
  }
  return {
    configured: true,
    network: config.network,
    chainId: config.chainId,
    explorer: config.explorer,
    addresses: config.addresses ? { ...config.addresses } : null,
  };
}

let running = false;

/**
 * The on-chain counterpart of /demo/self-pay. The payout rule is the same;
 * here it is enforced by an ERC-8183 hook that reverts complete() when the
 * buyer and the worker resolve to one World subject.
 */
export function mountChainDesk(app: Express): void {
  app.get("/chain", (_req: Request, res: Response) => {
    res.json(chainStatus());
  });

  app.post("/demo/chain-self-pay", async (_req: Request, res: Response) => {
    const config = chainConfigFromEnv(process.env);
    if (!config) {
      res.status(501).json({
        error: "no-chain",
        detail:
          "This server has no chain configured. Locally, npm run chain-self-pay boots anvil and runs the same take.",
      });
      return;
    }
    if (running) {
      res.status(409).json({ error: "busy", detail: "A chain take is already running." });
      return;
    }
    running = true;
    try {
      const report: ChainReport = await runChainScenario(config);
      res.status(report.passed ? 200 : 500).json(report);
    } catch (err) {
      res.status(502).json({
        error: "chain-run-failed",
        detail: err instanceof Error ? err.message : "unknown chain error",
      });
    } finally {
      running = false;
    }
  });
}
