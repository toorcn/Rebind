import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { runChainScenario } from "./chain-scenario";

// Anvil's well-known first three accounts.
const REGISTRAR = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const CLIENT = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const PROVIDER = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("no ephemeral port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

function anvilPath(): string {
  const local = join(homedir(), ".foundry", "bin", "anvil");
  return process.env.ANVIL_BIN ?? local;
}

async function waitForRpc(rpcUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`anvil exited with ${child.exitCode}`);
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("anvil did not start in time");
}

async function main(): Promise<void> {
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const child = spawn(anvilPath(), ["--port", String(port), "--silent"], {
    stdio: "ignore",
  });
  try {
    await waitForRpc(rpcUrl, child);
    const report = await runChainScenario({
      rpcUrl,
      chainId: 31337,
      network: "anvil",
      explorer: "",
      registrarKey: REGISTRAR,
      clientKey: CLIENT,
      providerKey: PROVIDER,
      allowTimeTravel: true,
    });
    for (const line of report.lines) console.log(line);
    process.exitCode = report.passed ? 0 : 1;
  } finally {
    child.kill("SIGKILL");
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
