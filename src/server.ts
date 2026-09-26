// This file must import Express itself. Vercel uses that import to pick the
// Node entry. The route table lives in paygate.ts.
import express from "express";
import { createApp } from "./paygate";
import { runFilm } from "./film-run";
import { AgentBookRegistry } from "./registry";

const port = Number(process.env.PORT ?? "43210");
const host = process.env.HOST ?? "0.0.0.0";

void express;

const foil = process.env.FOIL_MODE === "1";
const registry = new AgentBookRegistry();
const app = createApp(registry, { mode: foil ? "foil" : "win" });

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
    console.log("Job pool: payout waits for two different sandbox World IDs.");
    console.log(
      foil
        ? "Grant path ignores revoke. This process is the foil, on purpose."
        : "Every grant checks revoke. Rotated keys need a server-validated rebind."
    );
  });
}
