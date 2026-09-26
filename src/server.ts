// This file must import Express itself. Vercel uses that import to pick the
// Node entry. The route table lives in paygate.ts.
import express from "express";
import { createApp } from "./paygate";
import { runFilm } from "./film-run";
import { AgentBookRegistry } from "./registry";
import { createHostedWallet } from "./hosted-wallet";

const port = Number(process.env.PORT ?? "43210");
const host = process.env.HOST ?? "127.0.0.1";

void express;

const foil = process.env.FOIL_MODE === "1";
const registry = new AgentBookRegistry();
const hostedWallet = !process.env.VERCEL && process.env.REBIND_HOSTED_WALLET === "1"
  ? createHostedWallet()
  : undefined;
const app = createApp(registry, { mode: foil ? "foil" : "win", hostedWallet });

app.post("/demo/film", async (_req, res) => {
  try {
    const film = await runFilm();
    res.status(film.passed ? 200 : 500).json(film);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Film failed";
    res.status(500).json({ passed: false, error: message });
  }
});

export default app;

if (!process.env.VERCEL) {
  app.listen(port, host, () => {
    console.log(foil ? "C3 foil — revoke theater" : "C3 win — revoke enforced");
    console.log(`http://127.0.0.1:${port}`);
    console.log("Wallet desk: your wallet signs escrow on World Chain Sepolia.");
    console.log(
      foil
        ? "Grant path ignores revoke. This process is the foil, on purpose."
        : "Every grant checks revoke. Rotated keys need a server-validated rebind."
    );
  });
}
