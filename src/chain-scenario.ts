import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeErrorResult,
  defineChain,
  formatUnits,
  http,
  keccak256,
  parseEther,
  parseEventLogs,
  stringToHex,
  type Account,
  type Chain,
  type Hash,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ACPCore, DemoUSD, HumanRegistry, TwoHumansHook } from "./chain-artifacts";
import { WORLD_ISSUER } from "./pool";

export interface ChainAddresses {
  token: Hex;
  registry: Hex;
  hook: Hex;
  acp: Hex;
}

export interface ChainScenarioConfig {
  rpcUrl: string;
  chainId: number;
  network: string;
  explorer: string;
  registrarKey: Hex;
  clientKey?: Hex;
  providerKey?: Hex;
  addresses?: ChainAddresses;
  allowTimeTravel: boolean;
}

export interface ChainBeat {
  stamp: string;
  title: string;
  detail: string;
  tx?: Hash;
  link?: string;
}

export interface ChainReport {
  passed: boolean;
  network: string;
  chainId: number;
  addresses: ChainAddresses;
  beats: ChainBeat[];
  lines: string[];
}

const BUDGET = 40_000_000n; // 40 dUSD, 6 decimals
const MINT = 1_000_000_000n; // 1,000 dUSD
const SUB_ONE_PHONE = subjectHash(WORLD_ISSUER, "sub_one_phone");
const SUB_SECOND_HUMAN = subjectHash(WORLD_ISSUER, "sub_second_human");
const JOB_STATUS_COMPLETED = 3;

export function subjectHash(issuer: string, subject: string): Hex {
  return keccak256(stringToHex(`${issuer}|${subject}`));
}

export function chainConfigFromEnv(env: NodeJS.ProcessEnv): ChainScenarioConfig | null {
  const rpcUrl = env.CHAIN_RPC_URL;
  const registrarKey = env.CHAIN_REGISTRAR_KEY;
  if (!rpcUrl || !registrarKey) return null;
  const token = env.CHAIN_TOKEN_ADDRESS;
  const registry = env.CHAIN_REGISTRY_ADDRESS;
  const hook = env.CHAIN_HOOK_ADDRESS;
  const acp = env.CHAIN_ACP_ADDRESS;
  const addresses =
    token && registry && hook && acp
      ? { token: token as Hex, registry: registry as Hex, hook: hook as Hex, acp: acp as Hex }
      : undefined;
  return {
    rpcUrl,
    chainId: Number(env.CHAIN_ID ?? 4801),
    network: env.CHAIN_NETWORK ?? "World Chain Sepolia",
    explorer: env.CHAIN_EXPLORER ?? "",
    registrarKey: registrarKey as Hex,
    clientKey: env.CHAIN_CLIENT_KEY as Hex | undefined,
    providerKey: env.CHAIN_PROVIDER_KEY as Hex | undefined,
    addresses,
    allowTimeTravel: env.CHAIN_TIME_TRAVEL === "1",
  };
}

type Clients = ReturnType<typeof buildClients>;

function buildClients(config: ChainScenarioConfig) {
  const chain: Chain = defineChain({
    id: config.chainId,
    name: config.network,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
  const transport = http(config.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const registrar = privateKeyToAccount(config.registrarKey);
  const wallet = (account: Account) =>
    createWalletClient({ account, chain, transport });
  return {
    chain,
    publicClient,
    registrar,
    registrarWallet: wallet(registrar),
    wallet,
    testClient: config.allowTimeTravel
      ? createTestClient({ chain, mode: "anvil", transport })
      : null,
  };
}

async function deploy(
  clients: Clients,
  artifact: { abi: readonly unknown[]; bytecode: Hex },
  args: readonly unknown[]
): Promise<{ address: Hex; tx: Hash }> {
  const hash = await clients.registrarWallet.deployContract({
    abi: artifact.abi as never,
    bytecode: artifact.bytecode,
    args: args as never,
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error("deployment returned no contract address");
  return { address: receipt.contractAddress, tx: hash };
}

interface RevertInfo {
  name: string;
  args: readonly unknown[];
}

function findRevertData(err: unknown): Hex | null {
  let cur: unknown = err;
  while (cur instanceof Error) {
    const data = (cur as { data?: unknown }).data;
    if (typeof data === "string" && data.startsWith("0x") && data.length > 10) {
      return data as Hex;
    }
    cur = cur.cause;
  }
  return null;
}

function decodeRevert(err: unknown): RevertInfo {
  const data = findRevertData(err);
  if (data) {
    try {
      const decoded = decodeErrorResult({ abi: TwoHumansHook.abi, data });
      return { name: decoded.errorName, args: decoded.args ?? [] };
    } catch {
      // fall through to the generic label
    }
  }
  return { name: "unknown", args: [] };
}

export function openChain(config: ChainScenarioConfig): Clients {
  return buildClients(config);
}

export function hookRevertName(err: unknown): string {
  return decodeRevert(err).name;
}

/**
 * The on-chain take: escrow locks, settlement refuses one human, and pays two.
 *
 * Job A registers the buyer and the worker to the same World subject and the
 * evaluator's complete() reverts with SameHuman. On a local chain the client
 * then recovers the escrow through claimRefund after expiry. Job B re-registers
 * the buyer seat to a second subject and the same lifecycle pays the worker.
 *
 * Subjects are fixtures written by the registrar key. On a live deployment the
 * registrar only writes after the server-side World device check passes.
 */
export async function runChainScenario(config: ChainScenarioConfig): Promise<ChainReport> {
  const clients = buildClients(config);
  const { publicClient, registrarWallet } = clients;
  const beats: ChainBeat[] = [];
  const lines: string[] = [];
  const link = (tx: Hash | undefined): string | undefined =>
    tx && config.explorer ? `${config.explorer}/tx/${tx}` : undefined;
  const push = (beat: ChainBeat) => {
    beats.push(beat);
    lines.push(
      `${beat.stamp.padEnd(22)} ${beat.tx ? `${beat.tx}  ` : ""}${beat.title}`
    );
  };

  const clientAccount = config.clientKey
    ? privateKeyToAccount(config.clientKey)
    : privateKeyToAccount(generatePrivateKey());
  const providerAccount = config.providerKey
    ? privateKeyToAccount(config.providerKey)
    : privateKeyToAccount(generatePrivateKey());
  const clientWallet = clients.wallet(clientAccount);
  const providerWallet = clients.wallet(providerAccount);

  if (!config.clientKey || !config.providerKey) {
    for (const account of [clientAccount, providerAccount]) {
      const funding = await registrarWallet.sendTransaction({
        to: account.address,
        value: parseEther("0.0001"),
      });
      await publicClient.waitForTransactionReceipt({ hash: funding });
    }
  }

  let addresses: ChainAddresses;
  if (config.addresses) {
    addresses = config.addresses;
    push({
      stamp: "ROOM_ATTACHED",
      title: "Settlement contracts already live",
      detail: `ACP ${addresses.acp}, hook ${addresses.hook}, registry ${addresses.registry}.`,
    });
  } else {
    const token = await deploy(clients, DemoUSD, []);
    const registry = await deploy(clients, HumanRegistry, [clients.registrar.address]);
    const hook = await deploy(clients, TwoHumansHook, [registry.address]);
    const acp = await deploy(clients, ACPCore, [token.address]);
    addresses = { token: token.address, registry: registry.address, hook: hook.address, acp: acp.address };
    push({
      stamp: "ROOM_DEPLOYED",
      title: "DemoUSD, registry, hook, and ACP core deployed",
      detail: `ACP ${acp.address} settles through TwoHumansHook ${hook.address}.`,
      tx: acp.tx,
      link: link(acp.tx),
    });
  }

  const tokenBalance = (owner: Hex): Promise<bigint> =>
    publicClient.readContract({
      address: addresses.token,
      abi: DemoUSD.abi,
      functionName: "balanceOf",
      args: [owner],
    }) as Promise<bigint>;

  const register = async (account: Hex, subject: Hex): Promise<Hash> => {
    const hash = await registrarWallet.writeContract({
      address: addresses.registry,
      abi: HumanRegistry.abi,
      functionName: "register",
      args: [account, subject],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  };

  const runJob = async (
    description: string
  ): Promise<{ jobId: bigint; fundTx: Hash; submitTx: Hash }> => {
    const block = await publicClient.getBlock();
    const expiredAt = block.timestamp + (config.allowTimeTravel ? 60n : 86_400n);
    const createTx = await clientWallet.writeContract({
      address: addresses.acp,
      abi: ACPCore.abi,
      functionName: "createJob",
      args: [providerAccount.address, clients.registrar.address, expiredAt, description, addresses.hook],
    });
    await publicClient.waitForTransactionReceipt({ hash: createTx });
    const jobId = (await publicClient.readContract({
      address: addresses.acp,
      abi: ACPCore.abi,
      functionName: "jobCount",
    })) as bigint;
    const budgetTx = await clientWallet.writeContract({
      address: addresses.acp,
      abi: ACPCore.abi,
      functionName: "setBudget",
      args: [jobId, BUDGET, "0x"],
    });
    await publicClient.waitForTransactionReceipt({ hash: budgetTx });
    const fundTx = await clientWallet.writeContract({
      address: addresses.acp,
      abi: ACPCore.abi,
      functionName: "fund",
      args: [jobId, BUDGET, "0x"],
    });
    await publicClient.waitForTransactionReceipt({ hash: fundTx });
    const submitTx = await providerWallet.writeContract({
      address: addresses.acp,
      abi: ACPCore.abi,
      functionName: "submit",
      args: [jobId, stringToHex("ipfs://delivery"), "0x"],
    });
    await publicClient.waitForTransactionReceipt({ hash: submitTx });
    return { jobId, fundTx, submitTx };
  };

  // Fund the buyer and open the escrow allowance.
  const mintTx = await clientWallet.writeContract({
    address: addresses.token,
    abi: DemoUSD.abi,
    functionName: "mint",
    args: [clientAccount.address, MINT],
  });
  await publicClient.waitForTransactionReceipt({ hash: mintTx });
  const approveTx = await clientWallet.writeContract({
    address: addresses.token,
    abi: DemoUSD.abi,
    functionName: "approve",
    args: [addresses.acp, MINT],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  // Job A: one human on both seats.
  await register(clientAccount.address, SUB_ONE_PHONE);
  await register(providerAccount.address, SUB_ONE_PHONE);
  const jobA = await runJob("ipfs://same-human-job");
  const escrowed = await tokenBalance(addresses.acp);
  push({
    stamp: "ESCROW_LOCKED",
    title: `Job #${jobA.jobId} funded, ${formatUnits(BUDGET, 6)} dUSD in escrow`,
    detail: "The work is delivered. Settlement is the only step left.",
    tx: jobA.fundTx,
    link: link(jobA.fundTx),
  });

  let revert = { name: "unknown", args: [] as readonly unknown[] };
  try {
    await publicClient.simulateContract({
      address: addresses.acp,
      abi: ACPCore.abi,
      functionName: "complete",
      args: [jobA.jobId, stringToHex("ipfs://receipt"), "0x"],
      account: clients.registrar.address,
    });
  } catch (err) {
    revert = decodeRevert(err);
  }

  let failedTx: Hash | undefined;
  try {
    failedTx = await registrarWallet.writeContract({
      address: addresses.acp,
      abi: ACPCore.abi,
      functionName: "complete",
      args: [jobA.jobId, stringToHex("ipfs://receipt"), "0x"],
      gas: 500_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: failedTx });
    if (receipt.status !== "reverted") failedTx = undefined;
  } catch {
    failedTx = undefined;
  }

  const stillEscrowed = await tokenBalance(addresses.acp);
  const providerAfterA = await tokenBalance(providerAccount.address);
  const sameHumanHeld =
    revert.name === "SameHuman" &&
    stillEscrowed === escrowed &&
    providerAfterA === 0n;
  push({
    stamp: "SAME_HUMAN",
    title: "complete() reverted: SameHuman",
    detail: failedTx
      ? `Mined as a failed transaction. Escrow untouched at ${formatUnits(stillEscrowed, 6)} dUSD.`
      : `The node refused the transaction before mining. Escrow untouched at ${formatUnits(stillEscrowed, 6)} dUSD.`,
    tx: failedTx,
    link: link(failedTx),
  });

  let refundOk: boolean | null = null;
  if (clients.testClient) {
    await clients.testClient.increaseTime({ seconds: 172_800 });
    await clients.testClient.mine({ blocks: 1 });
    const refundTx = await clientWallet.writeContract({
      address: addresses.acp,
      abi: ACPCore.abi,
      functionName: "claimRefund",
      args: [jobA.jobId],
    });
    await publicClient.waitForTransactionReceipt({ hash: refundTx });
    const clientAfterRefund = await tokenBalance(clientAccount.address);
    refundOk = clientAfterRefund === MINT && (await tokenBalance(addresses.acp)) === 0n;
    push({
      stamp: "REFUNDED",
      title: "claimRefund made the buyer whole",
      detail: "The sale never counted and nobody's funds stayed hostage.",
      tx: refundTx,
      link: link(refundTx),
    });
  }

  // Job B: a second human takes the buyer seat.
  await register(clientAccount.address, SUB_SECOND_HUMAN);
  const jobB = await runJob("ipfs://two-humans-job");
  const completeTx = await registrarWallet.writeContract({
    address: addresses.acp,
    abi: ACPCore.abi,
    functionName: "complete",
    args: [jobB.jobId, stringToHex("ipfs://receipt"), "0x"],
  });
  const completeReceipt = await publicClient.waitForTransactionReceipt({ hash: completeTx });
  const events = parseEventLogs({
    abi: TwoHumansHook.abi,
    logs: completeReceipt.logs,
    eventName: "DistinctHumans",
  });
  const providerPaid = await tokenBalance(providerAccount.address);
  const jobBState = (await publicClient.readContract({
    address: addresses.acp,
    abi: ACPCore.abi,
    functionName: "getJob",
    args: [jobB.jobId],
  })) as { status: number };
  const distinctPaid =
    events.length === 1 &&
    providerPaid === BUDGET &&
    jobBState.status === JOB_STATUS_COMPLETED;
  push({
    stamp: "DISTINCT_HUMANS",
    title: `Job #${jobB.jobId} settled, ${formatUnits(providerPaid, 6)} dUSD to the worker`,
    detail: "Two different subjects on record. DistinctHumans emitted; the sale counts.",
    tx: completeTx,
    link: link(completeTx),
  });

  const passed =
    sameHumanHeld && distinctPaid && (refundOk === null || refundOk === true);
  lines.push(passed ? "CHAIN_SELF_PAY_PASSED" : "CHAIN_SELF_PAY_FAILED");

  return {
    passed,
    network: config.network,
    chainId: config.chainId,
    addresses,
    beats,
    lines,
  };
}
