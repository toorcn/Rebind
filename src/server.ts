import { createApp } from "./app";
import { AgentBookRegistry } from "./registry";

const port = Number(process.env.PORT ?? "43210");
const host = process.env.HOST ?? "0.0.0.0";

const registry = new AgentBookRegistry();
const app = createApp(registry);

app.listen(port, host, () => {
  console.log(`C3 Day 0 revoke theater`);
  console.log(`http://127.0.0.1:${port}`);
  console.log(`Grant path ignores revoke. This process is the foil, on purpose.`);
});
