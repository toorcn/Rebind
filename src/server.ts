import { createApp } from "./app";
import { AgentBookRegistry } from "./registry";

const port = Number(process.env.PORT ?? "43210");
const host = process.env.HOST ?? "0.0.0.0";

const foil = process.env.FOIL_MODE === "1";
const registry = new AgentBookRegistry();
const app = createApp(registry, { mode: foil ? "foil" : "win" });

app.listen(port, host, () => {
  console.log(foil ? "C3 foil — revoke theater" : "C3 win — revoke enforced");
  console.log(`http://127.0.0.1:${port}`);
  console.log(
    foil
      ? "Grant path ignores revoke. This process is the foil, on purpose."
      : "Every grant checks revoke. Rotated keys need a server-validated rebind."
  );
});
