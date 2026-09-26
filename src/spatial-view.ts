import type { Job } from "./pool";

function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Presentation only. No scene control can submit a proof or move funds. */
export function spatialView(options: {
  id: string;
  mode: "people" | "wallet" | "credits" | "demo";
  job?: Job;
}): string {
  const people = options.mode === "people";
  const amount = options.job?.reward ?? 0;
  const paid = options.job?.decision.released ?? false;
  const label = people ? "Try the payment rule · Illustration" : options.mode === "wallet" ? "Payment location · On-chain" : "Payment location · Demo credits";
  return `<section class="spatial-view" id="${options.id}" data-spatial="${options.mode}" data-job="${escape(JSON.stringify(options.job ?? null))}" aria-label="${people ? "People behind the agents" : "Where is the payment?"}">
    <div class="sv-head"><p class="label">${label}</p><h3>${people ? "Two agents. How many people?" : "Where is the payment?"}</h3></div>
    ${people ? `<div class="sv-switch" role="group" aria-label="People behind the agents"><button type="button" data-people="same" aria-pressed="true">Same person</button><button type="button" data-people="different" aria-pressed="false">Different people</button></div>` : ""}
    <div class="sv-scene" role="group" aria-label="${people ? "Both agents connect to one person" : "Payment location"}">
      <div class="sv-fallback"><span>${people ? "One person → two agents" : "Buyer → Escrow → Worker"}</span><span>${people ? "Two wallets can belong to the same person." : options.job ? `${amount} credits ${paid ? "paid to the worker" : "held in escrow"}.` : "Create or select a job to follow its payment."}</span></div>
      <span class="sv-label" data-label="human-a" hidden></span><span class="sv-label" data-label="human-b" hidden></span>
      <span class="sv-label" data-label="buyer" hidden></span><span class="sv-label" data-label="worker" hidden></span>
      <span class="sv-label sv-money" data-label="money" hidden></span><span class="sv-label" data-label="received" hidden></span>
    </div>
    <div class="sv-summary" aria-live="polite" aria-atomic="true"><p class="sv-status">${people ? "Two agents, one person. Payment stays locked." : options.job ? `${amount} credits ${paid ? "paid" : "in escrow"}` : "No payment in escrow yet."}</p><p class="sv-detail">${people ? "Delivery alone is not enough. Two different people must verify." : "The view follows the job’s confirmed payment state."}</p></div>
    ${people ? '<a class="sv-link" href="/credits">Follow a sample payment →</a>' : '<details class="sv-inspect"><summary>Inspect payment</summary><p class="sv-reason">Select a job to see its payment status.</p></details>'}
  </section>`;
}
