import { JobPool, WORLD_ISSUER } from "./pool";
import { spatialView } from "./spatial-view";

/** Isolated fixtures: never attach these identities to a user's job or wallet. */
export function runWalkthrough() {
  const pool = new JobPool();
  const job = pool.post({
    title: "Summarize a project", brief: "Write five bullets covering the benefit, users, and next steps.",
    reward: 40, buyerName: "Sample buyer", workerName: "Sample worker",
  });
  const snapshot = (title: string, detail: string) => ({ title, detail, ledger: pool.ledger(), job: pool.get(job.id) });
  const steps = [snapshot("Sample job funded", "The sample buyer placed 40 demo credits in escrow. The brief and worker are already set up.")];
  pool.deliver(job.id, "Benefit: verified job payments. Users: buyers and workers. Flow: fund, deliver, verify. Rule: two different people. Next step: review the work.");
  steps.push(snapshot("Sample delivery submitted", "The worker’s five-point summary is ready. The 40 demo credits stay in escrow until both sample identities are checked."));
  pool.attachProof(job.id, "buyer", { subject: "demo-buyer", issuer: WORLD_ISSUER });
  steps.push(snapshot("Buyer verification simulated", "The sample buyer identity is attached. The worker still needs a different identity before payment can release."));
  pool.attachProof(job.id, "worker", { subject: "demo-worker", issuer: WORLD_ISSUER });
  steps.push(snapshot("Demo complete · 40 credits paid", "The two sample identities differ, so the payout rule released the demo reward. No wallet transaction or World App verification took place."));
  return { steps };
}

export function walkthroughEmbed(): { section: string; tail: string } {
  return {
    section: `<section class="workspace" id="in-app-demo" aria-labelledby="demo-heading">
      <div class="workspace-heading">
        <div><p class="label">Guided demo · Sample identities</p><h2 id="demo-heading">Follow a sample job</h2>
        <p>Use a sample buyer, worker, and brief. Walk through funding, delivery, verification, and payout without setting up a wallet or opening another app.</p></div>
        <a class="text-link" href="/#wallet-desk">Ready to use MetaMask? Create a wallet job →</a>
      </div>
      <div class="panel demo-panel">
        <ol class="demo-progress" aria-label="Demo progress">
          <li id="demo-step-0" aria-current="step">Fund</li><li id="demo-step-1">Deliver</li><li id="demo-step-2">Buyer check</li><li id="demo-step-3">Worker check &amp; payout</li>
        </ol>
        <div class="demo-panel-layout"><div>
        <h3 id="demo-title">A sample job, ready to go</h3>
        <p id="demo-detail">Brief: write five bullets covering a project’s benefit, users, and next steps. Reward: 40 demo credits.</p>
        <p class="demo-cast"><span class="buyer">Sample buyer</span><i aria-hidden="true">→</i><span class="worker">Sample worker</span><em>Test identities only</em></p>
        <p id="demo-delivery" hidden></p>
        <div id="demo-balance" class="demo-stats" aria-live="polite"><div class="held"><small>Demo escrow</small><b id="demo-escrow">0</b></div><div class="paid"><small>Demo paid</small><b id="demo-paid">0</b></div></div>
        <div class="actions"><button class="btn primary" id="demo-next" type="button">Create &amp; fund sample job</button><button class="btn ghost" id="demo-reset" type="button" hidden>Start again</button></div>
        <p class="hint" id="demo-feedback" role="status" aria-live="polite"></p>
        <p class="hint demo-note">Simulation only: no funds move and no real people are verified.</p>
        </div>${spatialView({ id: "demo-payment", mode: "demo" })}</div>
      </div>
    </section>
    <style>
      #in-app-demo { scroll-margin-top: 100px; margin-bottom: 48px; }
      .demo-panel h3 { font: 400 1.8rem/1.2 var(--serif); color: var(--navy); margin: 24px 0 12px; }
      .demo-progress { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; list-style: none; margin: 0; padding: 0; counter-reset: dp; }
      .demo-progress li {
        counter-increment: dp;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: var(--surface-2);
        color: var(--muted);
        font-size: 13.5px;
        font-weight: 500;
        transition: all 0.3s var(--ease);
      }
      .demo-progress li::before {
        content: counter(dp);
        flex: none;
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 1px solid var(--line-2);
        background: var(--surface);
        font: 600 12px/1 var(--mono);
      }
      .demo-progress li[aria-current] { border-color: var(--accent); background: var(--surface); color: var(--navy); box-shadow: 0 0 0 4px var(--accent-soft); }
      .demo-progress li[aria-current]::before { background: var(--accent); border-color: var(--accent); color: #fff; }
      .demo-progress li[data-done] { border-color: rgba(34, 179, 122, 0.35); background: var(--ok-soft); color: var(--ok); }
      .demo-progress li[data-done]::before { content: "✓"; background: var(--ok-bright); border-color: var(--ok-bright); color: #fff; }
      #demo-detail { color: var(--text-2); }
      .demo-cast { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 14px 0 0; font-size: 13px; }
      .demo-cast span { padding: 5px 10px; border-radius: 99px; font-weight: 500; }
      .demo-cast .buyer { background: var(--accent-soft); color: var(--accent); }
      .demo-cast .worker { background: rgba(234, 107, 67, 0.12); color: #c4532f; }
      .demo-cast i { font-style: normal; color: var(--faint); }
      .demo-cast em { font-style: normal; margin-left: 4px; color: var(--muted); }
      .demo-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 20px 0 4px; }
      .demo-stats > div { padding: 12px 14px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--line); }
      .demo-stats small { display: flex; align-items: center; gap: 7px; font: 500 10.5px/1.2 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
      .demo-stats small::before { content: ""; width: 7px; height: 7px; border-radius: 2px; background: var(--sun); }
      .demo-stats .paid small::before { background: var(--ok-bright); }
      .demo-stats b { display: block; margin-top: 6px; font: 400 2rem/1 var(--serif); color: var(--navy); font-variant-numeric: tabular-nums; }
      .demo-stats .paid b { color: var(--ok); }
      #demo-delivery { margin: 16px 0 0; padding: 12px 14px; background: var(--surface-3); border-radius: 12px; font-size: 14px; color: var(--text-2); }
      .demo-note { font-size: 12.5px; }
      @media (max-width: 600px) { .demo-progress { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    </style>`,
    tail: `<script>
    (function () {
      var next = document.getElementById("demo-next");
      var reset = document.getElementById("demo-reset");
      var feedback = document.getElementById("demo-feedback");
      var steps = null;
      var position = -1;
      var labels = ["Create & fund sample job", "Submit sample delivery", "Simulate buyer verification", "Simulate worker verification & pay"];
      function render() {
        var current = steps && steps[position];
        document.getElementById("demo-payment").setAttribute("data-job", JSON.stringify(current ? current.job : null));
        document.getElementById("demo-title").textContent = current ? current.title : "A sample job, ready to go";
        document.getElementById("demo-detail").textContent = current ? current.detail : "Brief: write five bullets covering a project’s benefit, users, and next steps. Reward: 40 demo credits.";
        document.getElementById("demo-escrow").textContent = String(current ? current.ledger.escrow : 0);
        document.getElementById("demo-paid").textContent = String(current ? current.ledger.paid : 0);
        var delivery = document.getElementById("demo-delivery");
        delivery.hidden = !current || !current.job.note;
        delivery.textContent = current && current.job.note ? "Sample delivery: " + current.job.note : "";
        for (var i = 0; i < 4; i++) {
          var item = document.getElementById("demo-step-" + i);
          item.removeAttribute("aria-current");
          item.removeAttribute("data-done");
          if (i <= position) item.setAttribute("data-done", "");
          if (i === position + 1) item.setAttribute("aria-current", "step");
        }
        next.hidden = position === 3;
        next.textContent = labels[position + 1] || "Demo complete";
        reset.hidden = position < 0;
      }
      next.addEventListener("click", async function () {
        if (next.disabled) return;
        next.disabled = true;
        reset.disabled = true;
        feedback.textContent = "";
        try {
          if (!steps) {
            feedback.textContent = "Preparing the sample job…";
            var response = await fetch("/demo/walkthrough", { method: "POST" });
            if (!response.ok) throw new Error("Demo unavailable");
            var report = await response.json();
            if (!Array.isArray(report.steps) || report.steps.length !== 4 || report.steps.some(function (step) { return !step.job || !step.ledger; })) throw new Error("Invalid demo");
            steps = report.steps;
          }
          position = Math.min(position + 1, 3);
          render();
          feedback.textContent = steps[position].title;
          if (position === 3) reset.focus();
        } catch (_) {
          feedback.textContent = "Couldn’t load the demo. Try again; no funds were moved.";
        } finally {
          next.disabled = false;
          reset.disabled = false;
          if (position === 3) reset.focus();
        }
      });
      reset.addEventListener("click", function () { position = -1; steps = null; feedback.textContent = "Demo reset."; render(); next.focus(); });
    })();
    </script>`,
  };
}
