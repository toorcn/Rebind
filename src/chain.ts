import type { Express, Request, Response } from "express";
import { isHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainConfigFromEnv, runChainScenario, type ChainReport } from "./chain-scenario";
import type { WorldPrompt } from "./durable-state";
import { pullValidatedSubject, startDeviceGrant } from "./world-oidc";
import {
  asAddress,
  jobIdFromReceipt,
  prepareTx,
  readAccount,
  readBoard,
  readJob,
  registerVerifiedWallet,
  settleWalletJob,
  signatureMatches,
} from "./wallet-chain";

export interface ChainStatus {
  configured: boolean;
  demoAvailable?: boolean;
  network: string;
  chainId: number;
  chainIdHex: string;
  explorer: string;
  rpcUrl: string;
  registrar: string | null;
  addresses: Record<string, string> | null;
}

export interface ChainDeskHooks {
  devices: Map<string, string>;
  prompts: Map<string, WorldPrompt>;
}

function walletKey(address: Hex): string {
  return `wallet:${address.toLowerCase()}`;
}

export function chainStatus(): ChainStatus {
  const config = chainConfigFromEnv(process.env);
  if (!config) {
    return {
      configured: false,
      network: "",
      chainId: 0,
      chainIdHex: "0x0",
      explorer: "",
      rpcUrl: "",
      registrar: null,
      addresses: null,
    };
  }
  let registrar: string | null = null;
  try {
    registrar = privateKeyToAccount(config.registrarKey).address;
  } catch {
    registrar = null;
  }
  return {
    configured: Boolean(config.addresses && registrar),
    network: config.network,
    chainId: config.chainId,
    chainIdHex: `0x${config.chainId.toString(16)}`,
    explorer: config.explorer,
    rpcUrl: config.rpcUrl,
    registrar,
    addresses: config.addresses ? { ...config.addresses } : null,
  };
}

function readText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

function readBudget(value: unknown): number | null {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(raw) || raw < 1 || raw > 1000) return null;
  return raw;
}

function readJobId(value: unknown): bigint | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value < 1_000_000_000_000) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^[1-9][0-9]{0,11}$/.test(value)) return BigInt(value);
  return null;
}

function readTxHash(value: unknown): Hex | null {
  if (typeof value !== "string" || !isHex(value) || value.length !== 66) return null;
  return value;
}

function readSignature(value: unknown): Hex | null {
  if (typeof value !== "string" || !isHex(value) || value.length < 132) return null;
  return value;
}

let running = false;

/**
 * Live World Chain desk. The browser wallet signs mint, approve, create, fund,
 * submit, and refund. This server only registers a World subject after that
 * wallet signs the bind message, and it is the evaluator that calls complete().
 */
export function mountChainDesk(app: Express, hooks: ChainDeskHooks): void {
  app.get("/chain", (_req: Request, res: Response) => {
    res.json(chainStatus());
  });

  app.get("/chain/board", async (_req: Request, res: Response) => {
    const config = chainConfigFromEnv(process.env);
    if (!config?.addresses) {
      res.status(501).json({ error: "no-chain", detail: "This server has no chain configured." });
      return;
    }
    try {
      const jobs = await readBoard(config);
      res.json({ jobs });
    } catch (err) {
      res.status(502).json({ error: "chain-read-failed", detail: err instanceof Error ? err.message : "read failed" });
    }
  });

  app.get("/chain/jobs/:id", async (req: Request, res: Response) => {
    const config = chainConfigFromEnv(process.env);
    const jobId = readJobId(req.params.id);
    if (!config?.addresses) {
      res.status(501).json({ error: "no-chain", detail: "This server has no chain configured." });
      return;
    }
    if (!jobId) {
      res.status(400).json({ error: "bad-job", detail: "Job id must be a positive integer." });
      return;
    }
    try {
      const job = await readJob(config, jobId);
      if (!job) {
        res.status(404).json({ error: "missing", detail: "No job with that id." });
        return;
      }
      res.json({ job });
    } catch (err) {
      res.status(502).json({ error: "chain-read-failed", detail: err instanceof Error ? err.message : "read failed" });
    }
  });

  app.get("/chain/accounts/:address", async (req: Request, res: Response) => {
    const config = chainConfigFromEnv(process.env);
    const account = typeof req.params.address === "string" ? asAddress(req.params.address) : null;
    if (!config?.addresses) {
      res.status(501).json({ error: "no-chain", detail: "This server has no chain configured." });
      return;
    }
    if (!account) {
      res.status(400).json({ error: "bad-address", detail: "That is not a wallet address." });
      return;
    }
    try {
      res.json({ account: await readAccount(config, account) });
    } catch (err) {
      res.status(502).json({ error: "chain-read-failed", detail: err instanceof Error ? err.message : "read failed" });
    }
  });

  app.post("/chain/prepare", (req: Request, res: Response) => {
    const config = chainConfigFromEnv(process.env);
    if (!config?.addresses) {
      res.status(501).json({ error: "no-chain", detail: "This server has no chain configured." });
      return;
    }
    const action = req.body?.action;
    try {
      if (action === "mint") {
        const account = typeof req.body?.account === "string" ? asAddress(req.body.account) : null;
        if (!account) {
          res.status(400).json({ error: "bad-address", detail: "Mint needs your wallet address." });
          return;
        }
        res.json(prepareTx(config, { action: "mint", account }));
        return;
      }
      if (action === "approve") {
        res.json(prepareTx(config, { action: "approve" }));
        return;
      }
      if (action === "create") {
        const worker = typeof req.body?.worker === "string" ? asAddress(req.body.worker) : null;
        const description = readText(req.body?.description, 280);
        const budget = readBudget(req.body?.budget);
        if (!worker || !description || budget === null) {
          res.status(400).json({
            error: "bad-job",
            detail: "A worker address, a description, and a budget from 1 to 1000 dUSD are required.",
          });
          return;
        }
        res.json(prepareTx(config, { action: "create", worker, description, budget }));
        return;
      }
      if (action === "setBudget" || action === "fund") {
        const jobId = readJobId(req.body?.jobId);
        const budget = readBudget(req.body?.budget);
        if (!jobId || budget === null) {
          res.status(400).json({ error: "bad-job", detail: "Job id and budget are required." });
          return;
        }
        res.json(prepareTx(config, { action, jobId, budget }));
        return;
      }
      if (action === "submit") {
        const jobId = readJobId(req.body?.jobId);
        const note = readText(req.body?.note, 280);
        if (!jobId || !note) {
          res.status(400).json({ error: "bad-job", detail: "Job id and a delivery note are required." });
          return;
        }
        res.json(prepareTx(config, { action: "submit", jobId, note }));
        return;
      }
      if (action === "refund") {
        const jobId = readJobId(req.body?.jobId);
        if (!jobId) {
          res.status(400).json({ error: "bad-job", detail: "Job id is required." });
          return;
        }
        res.json(prepareTx(config, { action: "refund", jobId }));
        return;
      }
      res.status(400).json({ error: "bad-action", detail: "Unknown wallet action." });
    } catch (err) {
      res.status(500).json({ error: "prepare-failed", detail: err instanceof Error ? err.message : "prepare failed" });
    }
  });

  app.post("/chain/receipt", async (req: Request, res: Response) => {
    const config = chainConfigFromEnv(process.env);
    const hash = readTxHash(req.body?.hash);
    if (!config?.addresses) {
      res.status(501).json({ error: "no-chain", detail: "This server has no chain configured." });
      return;
    }
    if (!hash) {
      res.status(400).json({ error: "bad-tx", detail: "A transaction hash is required." });
      return;
    }
    try {
      const jobId = await jobIdFromReceipt(config, hash);
      if (!jobId) {
        res.status(404).json({ error: "no-job", detail: "That receipt did not create a job." });
        return;
      }
      res.json({ jobId, hash });
    } catch (err) {
      res.status(502).json({ error: "receipt-failed", detail: err instanceof Error ? err.message : "receipt failed" });
    }
  });

  app.get("/chain/world/:address", (req: Request, res: Response) => {
    const account = typeof req.params.address === "string" ? asAddress(req.params.address) : null;
    if (!account) {
      res.status(400).json({ error: "bad-address", detail: "That is not a wallet address." });
      return;
    }
    const prompt = hooks.prompts.get(walletKey(account)) ?? null;
    res.json({
      pending: Boolean(prompt),
      userCode: prompt?.userCode ?? null,
      verificationUri: prompt?.verificationUri ?? null,
      verificationUriComplete: prompt?.verificationUriComplete ?? null,
    });
  });

  app.post("/chain/world/start", async (req: Request, res: Response) => {
    const account = typeof req.body?.address === "string" ? asAddress(req.body.address) : null;
    if (!account) {
      res.status(400).json({ error: "bad-address", detail: "Connect a wallet before starting World ID." });
      return;
    }
    try {
      const live = await startDeviceGrant();
      if (!live) {
        res.status(501).json({
          error: "world-down",
          detail: "Set WORLD_CLIENT_ID and WORLD_CLIENT_SECRET to start sandbox.auth.world.org.",
        });
        return;
      }
      const key = walletKey(account);
      hooks.devices.set(key, live.deviceCode);
      hooks.prompts.set(key, {
        userCode: live.userCode,
        verificationUri: live.verificationUri,
        verificationUriComplete: live.verificationUriComplete ?? live.verificationUri,
      });
      res.status(201).json({
        userCode: live.userCode,
        verificationUri: live.verificationUri,
        verificationUriComplete: live.verificationUriComplete,
      });
    } catch (err) {
      res.status(502).json({ error: "world-error", detail: err instanceof Error ? err.message : "World grant failed" });
    }
  });

  app.post("/chain/world/pull", async (req: Request, res: Response) => {
    const config = chainConfigFromEnv(process.env);
    const account = typeof req.body?.address === "string" ? asAddress(req.body.address) : null;
    const signature = readSignature(req.body?.signature);
    if (!account || !signature) {
      res.status(400).json({
        error: "bad-proof",
        detail: "The wallet address and its signature of the bind message are required.",
      });
      return;
    }
    if (!config?.addresses) {
      res.status(501).json({ error: "no-chain", detail: "This server has no chain configured." });
      return;
    }
    const key = walletKey(account);
    const deviceCode = hooks.devices.get(key);
    const prompt = hooks.prompts.get(key);
    if (!deviceCode || !prompt) {
      res.status(404).json({ error: "no-grant", detail: "Start a World ID check for this wallet first." });
      return;
    }
    const signed = await signatureMatches(account, prompt.userCode, signature);
    if (!signed) {
      res.status(401).json({
        error: "bad-signature",
        detail: "That signature was not from this wallet over the World code.",
      });
      return;
    }
    const result = await pullValidatedSubject(deviceCode);
    if (hooks.devices.get(key) !== deviceCode) {
      res.status(409).json({ attached: false, error: "code-replaced", detail: "A newer World ID code is available. Check the new code instead." });
      return;
    }
    if (result.kind === "pending") {
      res.status(202).json({ attached: false, status: "pending" });
      return;
    }
    if (result.kind === "denied") {
      if (["token_failed", "server_error", "temporarily_unavailable"].includes(result.error)) {
        res.status(502).json({ attached: false, error: "world-error", detail: "World ID is temporarily unavailable. Try checking this code again." });
        return;
      }
      hooks.devices.delete(key);
      hooks.prompts.delete(key);
      res.status(403).json({ attached: false, error: "not-approved", detail: result.error });
      return;
    }
    try {
      const registered = await registerVerifiedWallet(config, account, result.subject);
      hooks.devices.delete(key);
      hooks.prompts.delete(key);
      res.json({ attached: true, tx: registered.tx, link: registered.link ?? null });
    } catch (err) {
      res.status(502).json({ error: "register-failed", detail: err instanceof Error ? err.message : "register failed" });
    }
  });

  app.post("/chain/settle", async (req: Request, res: Response) => {
    const config = chainConfigFromEnv(process.env);
    const jobId = readJobId(req.body?.jobId);
    if (!config?.addresses) {
      res.status(501).json({ error: "no-chain", detail: "This server has no chain configured." });
      return;
    }
    if (!jobId) {
      res.status(400).json({ error: "bad-job", detail: "Job id is required." });
      return;
    }
    try {
      const outcome = await settleWalletJob(config, jobId);
      const status = outcome.settled ? 200 : outcome.reason === "no-job" ? 404 : 409;
      res.status(status).json(outcome);
    } catch (err) {
      res.status(502).json({ error: "settle-failed", detail: err instanceof Error ? err.message : "settle failed" });
    }
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
