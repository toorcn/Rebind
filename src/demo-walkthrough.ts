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
          <li id="demo-step-0" aria-current="step">1. Fund</li><li id="demo-step-1">2. Deliver</li><li id="demo-step-2">3. Buyer check</li><li id="demo-step-3">4. Worker check &amp; payout</li>
        </ol>
        <div class="demo-panel-layout"><div>
        <h3 id="demo-title">A sample job, ready to go</h3>
        <p id="demo-detail">Brief: write five bullets covering a project’s benefit, users, and next steps. Reward: 40 demo credits.</p>
        <p class="hint">Sample buyer → Sample worker · Test identities only</p>
        <p id="demo-delivery" hidden></p>
        <p id="demo-balance">Demo escrow: 0 · Demo paid: 0</p>
        <div class="actions"><button class="btn primary" id="demo-next" type="button">Create &amp; fund sample job</button><button class="btn ghost" id="demo-reset" type="button" hidden>Start again</button></div>
        <p class="hint" id="demo-feedback" role="status" aria-live="polite"></p>
        <p class="hint">This simulation does not move funds or verify real people. For wallet settlement, each person approves in their wallet and World App.</p>
        </div>${spatialView({ id: "demo-payment", mode: "demo" })}</div>
      </div>
    </section>
    <style>
      #in-app-demo { scroll-margin-top: 100px; margin-bottom: 48px; }
      .demo-panel h3 { font: 400 1.8rem/1.2 var(--serif); color: var(--navy); margin: 24px 0 12px; }
      .demo-progress { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; list-style: none; margin: 0; padding: 0; }
      .demo-progress li { border-top: 3px solid var(--line-2); padding-top: 10px; color: var(--muted); font-size: 13px; }
      .demo-progress li[aria-current] { border-color: var(--accent); color: var(--navy); }
      .demo-progress li[data-done] { border-color: var(--ok); color: var(--ok); }
      #demo-balance { font: 13px/1.5 var(--mono); padding: 14px 0; border-block: 1px solid var(--line); }
      #demo-delivery { padding: 16px; background: var(--surface-2); border-radius: 12px; }
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
        document.getElementById("demo-balance").textContent = "Demo escrow: " + (current ? current.ledger.escrow : 0) + " · Demo paid: " + (current ? current.ledger.paid : 0);
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
