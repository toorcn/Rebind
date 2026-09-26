import { createEVMClient, type Hex } from "@metamask/connect-evm";

export interface QrConnectOptions {
  chainIdHex: string;
  rpcUrl: string;
}

export interface WalletProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
}

interface QrSession {
  accounts: string[];
  provider: WalletProvider;
}

let clientPromise: ReturnType<typeof createEVMClient> | null = null;
let clientKey = "";

function pageUrl(): string {
  const scope = globalThis as { location?: { href?: string } };
  return scope.location?.href || "https://rebind-psi.vercel.app/";
}

function asHex(value: string): Hex {
  return value as Hex;
}

function clientFor(options: QrConnectOptions): ReturnType<typeof createEVMClient> {
  const chainId = options.chainIdHex || "0x12c1";
  const rpcUrl = options.rpcUrl || "https://worldchain-sepolia.g.alchemy.com/public";
  const key = `${chainId}|${rpcUrl}`;
  if (!clientPromise || clientKey !== key) {
    clientKey = key;
    const networks: Record<Hex, string> = {
      "0x1": "https://ethereum.publicnode.com",
      [asHex(chainId)]: rpcUrl,
    };
    clientPromise = createEVMClient({
      dapp: {
        name: "Rebind",
        url: pageUrl(),
      },
      api: { supportedNetworks: networks },
      ui: { preferExtension: false },
      analytics: { enabled: false },
    });
  }
  return clientPromise;
}

/** Opens the MetaMask QR code so the phone app can scan and connect. */
export async function connectWithQr(options: QrConnectOptions): Promise<QrSession> {
  const client = await clientFor(options);
  const chainId = asHex(options.chainIdHex || "0x12c1");
  const result = await client.connect({ chainIds: [chainId] });
  return {
    accounts: result.accounts.map((account) => account),
    provider: client.getProvider() as WalletProvider,
  };
}

/** Restores a QR session without showing the code again. */
export async function restoreQrSession(options: QrConnectOptions): Promise<QrSession | null> {
  const client = await clientFor(options);
  const provider = client.getProvider() as WalletProvider;
  const accounts = (await provider.request({ method: "eth_accounts", params: [] })) as string[] | null;
  if (!accounts || accounts.length === 0) return null;
  return { accounts, provider };
}
