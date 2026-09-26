import {
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  isAddress,
  parseEventLogs,
  stringToHex,
  verifyMessage,
  type Hex,
} from "viem";
import { ACPCore, DemoUSD, HumanRegistry } from "./chain-artifacts";
import {
  hookRevertName,
  openChain,
  subjectHash,
  type ChainScenarioConfig,
} from "./chain-scenario";
import { WORLD_ISSUER } from "./pool";

const MINT = 1_000_000_000n;
const EXPIRY_SECONDS = 45 * 60;
const ZERO_SUBJECT = `0x${"0".repeat(64)}` as Hex;
const MAX_UINT = (1n << 256n) - 1n;

export const BIND_MESSAGE_PREFIX = "Rebind binds this wallet to the World ID you just approved.";

export function bindMessage(userCode: string): string {
  return `${BIND_MESSAGE_PREFIX}\n${userCode}`;
}

export type HumanRelation = "waiting" | "same" | "distinct";

export interface PreparedTx {
  to: Hex;
  data: Hex;
  label: string;
}

export interface ChainJobView {
  id: string;
  client: Hex;
  provider: Hex;
  evaluator: Hex;
  status: string;
  budget: string;
  expiredAt: number;
  description: string;
  clientProven: boolean;
  providerProven: boolean;
  humans: HumanRelation;
}

export interface AccountView {
  address: Hex;
  eth: string;
  dusd: string;
  allowance: string;
  proven: boolean;
}

export interface SettleView {
  sent: boolean;
  settled: boolean;
  reason: string;
  tx?: Hex;
  link?: string;
}

type JobRecord = {
  client: Hex;
  provider: Hex;
  evaluator: Hex;
  budget: bigint;
  expiredAt: bigint;
  status: number;
};

const STATUS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"] as const;

function requireAddresses(config: ChainScenarioConfig): NonNullable<ChainScenarioConfig["addresses"]> {
  if (!config.addresses) throw new Error("Chain contracts are not configured");
  return config.addresses;
}

export function asAddress(value: string): Hex | null {
  if (!isAddress(value)) return null;
  return getAddress(value);
}

export function wholeDusd(value: number): bigint {
  return BigInt(value) * 1_000_000n;
}

function trimUnits(raw: string): string {
  if (!raw.includes(".")) return raw;
  return raw.replace(/0+$/, "").replace(/\.$/, "");
}

function money(value: bigint, decimals: number): string {
  return trimUnits(formatUnits(value, decimals));
}

function ethAmount(value: bigint): string {
  const raw = formatEther(value);
  const [whole, frac = ""] = raw.split(".");
  if (!frac) return whole;
  return trimUnits(`${whole}.${frac.slice(0, 6)}`);
}

function statusName(status: number): string {
  return STATUS[status] ?? "Unknown";
}

function relation(clientSubject: Hex, providerSubject: Hex): HumanRelation {
  if (clientSubject === ZERO_SUBJECT || providerSubject === ZERO_SUBJECT) return "waiting";
  if (clientSubject.toLowerCase() === providerSubject.toLowerCase()) return "same";
  return "distinct";
}

function txLink(config: ChainScenarioConfig, hash: Hex): string | undefined {
  if (!config.explorer) return undefined;
  return `${config.explorer.replace(/\/$/, "")}/tx/${hash}`;
}

async function readJobRecord(
  config: ChainScenarioConfig,
  jobId: bigint
): Promise<JobRecord | null> {
  const addresses = requireAddresses(config);
  const { publicClient } = openChain(config);
  const job = (await publicClient.readContract({
    address: addresses.acp,
    abi: ACPCore.abi,
    functionName: "getJob",
    args: [jobId],
  })) as JobRecord;
  if (job.client === "0x0000000000000000000000000000000000000000") return null;
  return job;
}

async function subjectOf(config: ChainScenarioConfig, account: Hex): Promise<Hex> {
  const addresses = requireAddresses(config);
  const { publicClient } = openChain(config);
  return (await publicClient.readContract({
    address: addresses.registry,
    abi: HumanRegistry.abi,
    functionName: "subjectOf",
    args: [account],
  })) as Hex;
}

export async function readAccount(config: ChainScenarioConfig, account: Hex): Promise<AccountView> {
  const addresses = requireAddresses(config);
  const { publicClient } = openChain(config);
  const [wei, rawDusd, rawAllowance, subject] = await Promise.all([
    publicClient.getBalance({ address: account }),
    publicClient.readContract({
      address: addresses.token,
      abi: DemoUSD.abi,
      functionName: "balanceOf",
      args: [account],
    }) as Promise<bigint>,
    publicClient.readContract({
      address: addresses.token,
      abi: DemoUSD.abi,
      functionName: "allowance",
      args: [account, addresses.acp],
    }) as Promise<bigint>,
    subjectOf(config, account),
  ]);
  return {
    address: account,
    eth: ethAmount(wei),
    dusd: money(rawDusd, 6),
    allowance: money(rawAllowance, 6),
    proven: subject !== ZERO_SUBJECT,
  };
}

export async function readJob(config: ChainScenarioConfig, jobId: bigint): Promise<ChainJobView | null> {
  const addresses = requireAddresses(config);
  const { publicClient } = openChain(config);
  const job = await readJobRecord(config, jobId);
  if (!job) return null;
  const [description, clientSubject, providerSubject] = await Promise.all([
    publicClient.readContract({
      address: addresses.acp,
      abi: ACPCore.abi,
      functionName: "getDescription",
      args: [jobId],
    }) as Promise<string>,
    subjectOf(config, job.client),
    subjectOf(config, job.provider),
  ]);
  return {
    id: jobId.toString(),
    client: job.client,
    provider: job.provider,
    evaluator: job.evaluator,
    status: statusName(job.status),
    budget: money(job.budget, 6),
    expiredAt: Number(job.expiredAt),
    description,
    clientProven: clientSubject !== ZERO_SUBJECT,
    providerProven: providerSubject !== ZERO_SUBJECT,
    humans: relation(clientSubject, providerSubject),
  };
}

export async function readBoard(config: ChainScenarioConfig): Promise<ChainJobView[]> {
  const addresses = requireAddresses(config);
  const { publicClient } = openChain(config);
  const count = (await publicClient.readContract({
    address: addresses.acp,
    abi: ACPCore.abi,
    functionName: "jobCount",
  })) as bigint;
  const start = count > 8n ? count - 7n : 1n;
  const views: ChainJobView[] = [];
  for (let id = count; id >= start && id > 0n; id -= 1n) {
    const view = await readJob(config, id);
    if (view) views.push(view);
  }
  return views;
}

export function prepareTx(
  config: ChainScenarioConfig,
  action:
    | { action: "mint"; account: Hex }
    | { action: "approve" }
    | { action: "create"; worker: Hex; description: string; budget: number }
    | { action: "setBudget"; jobId: bigint; budget: number }
    | { action: "fund"; jobId: bigint; budget: number }
    | { action: "submit"; jobId: bigint; note: string }
    | { action: "refund"; jobId: bigint }
): PreparedTx {
  const addresses = requireAddresses(config);
  const { registrar } = openChain(config);
  if (action.action === "mint") {
    return {
      to: addresses.token,
      label: "Mint 1,000 dUSD",
      data: encodeFunctionData({
        abi: DemoUSD.abi,
        functionName: "mint",
        args: [action.account, MINT],
      }),
    };
  }
  if (action.action === "approve") {
    return {
      to: addresses.token,
      label: "Approve escrow",
      data: encodeFunctionData({
        abi: DemoUSD.abi,
        functionName: "approve",
        args: [addresses.acp, MAX_UINT],
      }),
    };
  }
  if (action.action === "create") {
    const expiredAt = BigInt(Math.floor(Date.now() / 1000) + EXPIRY_SECONDS);
    return {
      to: addresses.acp,
      label: "Create job",
      data: encodeFunctionData({
        abi: ACPCore.abi,
        functionName: "createJob",
        args: [action.worker, registrar.address, expiredAt, action.description, addresses.hook],
      }),
    };
  }
  if (action.action === "setBudget") {
    return {
      to: addresses.acp,
      label: "Set budget",
      data: encodeFunctionData({
        abi: ACPCore.abi,
        functionName: "setBudget",
        args: [action.jobId, wholeDusd(action.budget), "0x"],
      }),
    };
  }
  if (action.action === "fund") {
    return {
      to: addresses.acp,
      label: "Fund escrow",
      data: encodeFunctionData({
        abi: ACPCore.abi,
        functionName: "fund",
        args: [action.jobId, wholeDusd(action.budget), "0x"],
      }),
    };
  }
  if (action.action === "submit") {
    return {
      to: addresses.acp,
      label: "Submit delivery",
      data: encodeFunctionData({
        abi: ACPCore.abi,
        functionName: "submit",
        args: [action.jobId, stringToHex(action.note), "0x"],
      }),
    };
  }
  return {
    to: addresses.acp,
    label: "Claim refund",
    data: encodeFunctionData({
      abi: ACPCore.abi,
      functionName: "claimRefund",
      args: [action.jobId],
    }),
  };
}

export async function jobIdFromReceipt(config: ChainScenarioConfig, hash: Hex): Promise<string | null> {
  const { publicClient } = openChain(config);
  const receipt = await publicClient.getTransactionReceipt({ hash });
  const logs = parseEventLogs({
    abi: ACPCore.abi,
    logs: receipt.logs,
    eventName: "JobCreated",
  });
  const created = logs[0];
  if (!created) return null;
  return created.args.jobId.toString();
}

export async function signatureMatches(account: Hex, userCode: string, signature: Hex): Promise<boolean> {
  return verifyMessage({ address: account, message: bindMessage(userCode), signature });
}

export async function registerVerifiedWallet(
  config: ChainScenarioConfig,
  account: Hex,
  subject: string
): Promise<{ tx: Hex; link?: string }> {
  const addresses = requireAddresses(config);
  const { registrarWallet, publicClient } = openChain(config);
  const tx = await registrarWallet.writeContract({
    address: addresses.registry,
    abi: HumanRegistry.abi,
    functionName: "register",
    args: [account, subjectHash(WORLD_ISSUER, subject)],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") throw new Error("Register transaction reverted");
  return { tx, link: txLink(config, tx) };
}

export async function settleWalletJob(config: ChainScenarioConfig, jobId: bigint): Promise<SettleView> {
  const addresses = requireAddresses(config);
  const job = await readJob(config, jobId);
  if (!job) return { sent: false, settled: false, reason: "no-job" };
  if (job.status === "Completed") return { sent: false, settled: true, reason: "already-complete" };
  if (job.status !== "Submitted") return { sent: false, settled: false, reason: "not-submitted" };
  if (job.humans === "waiting") return { sent: false, settled: false, reason: "unproven" };

  const { registrarWallet, publicClient } = openChain(config);
  try {
    const tx = await registrarWallet.writeContract({
      address: addresses.acp,
      abi: ACPCore.abi,
      functionName: "complete",
      args: [jobId, stringToHex("rebind:settle"), "0x"],
      gas: 500_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
    const settled = receipt.status === "success";
    return {
      sent: true,
      settled,
      reason: settled ? "DistinctHumans" : job.humans === "same" ? "SameHuman" : "reverted",
      tx,
      link: txLink(config, tx),
    };
  } catch (err) {
    return { sent: false, settled: false, reason: hookRevertName(err) };
  }
}
