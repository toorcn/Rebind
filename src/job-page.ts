import type { WorldPrompt } from "./durable-state";
import { focusJob, type Job, type Ledger, type Seat, type SettleReason } from "./pool";

export interface JobPageInput {
  jobs: Job[];
  ledger: Ledger;
  prompts: Map<string, WorldPrompt>;
  flash: string;
}

type Moment =
  | { kind: "post" }
  | { kind: "deliver"; job: Job }
  | { kind: "humans"; job: Job; seat: Seat }
  | { kind: "refused"; job: Job }
  | { kind: "not-world"; job: Job }
  | { kind: "paid"; job: Job };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function momentOf(job: Job | null): Moment {
  if (!job) return { kind: "post" };
  if (!job.delivered) return { kind: "deliver", job };
  switch (job.decision.reason) {
    case "not-delivered":
      return { kind: "deliver", job };
    case "awaiting-both":
    case "awaiting-buyer":
      return { kind: "humans", job, seat: "buyer" };
    case "awaiting-worker":
      return { kind: "humans", job, seat: "worker" };
    case "same-human":
      return { kind: "refused", job };
    case "not-world":
      return { kind: "not-world", job };
    case "released":
      return { kind: "paid", job };
    default: {
      const leftover: never = job.decision.reason;
      return leftover;
    }
  }
}

function railFor(moment: Moment): { current: number; done: boolean; refused: boolean } {
  switch (moment.kind) {
    case "post":
      return { current: 1, done: false, refused: false };
    case "deliver":
      return { current: 2, done: false, refused: false };
    case "humans":
    case "not-world":
      return { current: 3, done: false, refused: false };
    case "refused":
      return { current: 4, done: false, refused: true };
    case "paid":
      return { current: 4, done: true, refused: false };
    default: {
      const leftover: never = moment;
      return leftover;
    }
  }
}

function shortSubject(subject: string): string {
  if (subject.length <= 18) return subject;
  return `${subject.slice(0, 10)}…${subject.slice(-4)}`;
}

function seatLabel(seat: Seat): string {
  switch (seat) {
    case "buyer":
      return "buyer";
    case "worker":
      return "worker";
    default: {
      const leftover: never = seat;
      return leftover;
    }
  }
}

function deviceKey(jobId: string, seat: Seat): string {
  return `${jobId}:${seat}`;
}

function flashHtml(flash: string): string {
  switch (flash) {
    case "waiting":
      return `<div class="receipt wait"><p class="stamp">Still waiting</p><p>World App has not approved this code yet. Approve it there, then check again.</p></div>`;
    case "not-approved":
      return `<div class="receipt bad"><p class="stamp">Not approved</p><p>World App refused that code. Start a new one.</p></div>`;
    case "world-down":
      return `<div class="receipt wait"><p class="stamp">World App is off on this server</p><p>Sandbox credentials are not set here. The recorded take further down still runs the same payout rule.</p></div>`;
    case "world-error":
      return `<div class="receipt bad"><p class="stamp">World App did not start</p><p>The code request failed. Try again in a moment.</p></div>`;
    case "bad":
      return `<div class="receipt bad"><p class="stamp">Check the job</p><p>It needs a title, a short brief, a reward from 1 to 500, and a name for each agent.</p></div>`;
    case "missing":
      return `<div class="receipt bad"><p class="stamp">That job is gone</p><p>Post it again. The pool only keeps the latest dozen.</p></div>`;
    default:
      return "";
  }
}

function claimReceipt(job: Job): string {
  if (!job.claimIgnored || job.decision.released) return "";
  return `<div class="receipt bad"><p class="stamp">Claim ignored</p><p>The request said the humans were different and sent two subject ids. The pool did not read those fields.</p></div>`;
}

function proofLine(job: Job, seat: Seat): string {
  const proof = seat === "buyer" ? job.buyer : job.worker;
  const name = seat === "buyer" ? job.buyerName : job.workerName;
  if (!proof) return `<li><span>${escapeHtml(name)}</span><em>Waiting for World App</em></li>`;
  return `<li><span>${escapeHtml(name)}</span><code>${escapeHtml(shortSubject(proof.subject))}</code></li>`;
}

function worldPanel(job: Job, seat: Seat, prompts: Map<string, WorldPrompt>): string {
  const prompt = prompts.get(deviceKey(job.id, seat));
  const who = seatLabel(seat);
  if (!prompt) {
    return `<form method="post" action="/jobs/${escapeHtml(job.id)}/world/start">
      <input type="hidden" name="role" value="${who}" />
      <button class="primary" type="submit">Get the ${who}'s World code</button>
    </form>`;
  }
  const open = prompt.verificationUriComplete || prompt.verificationUri;
  return `<p class="code">${escapeHtml(prompt.userCode)}</p>
    <p class="hint">Approve this code in the sandbox World App as the ${who}.</p>
    <div class="actions">
      <a class="primary" href="${escapeHtml(open)}">Open World App</a>
      <form method="post" action="/jobs/${escapeHtml(job.id)}/world/pull">
        <input type="hidden" name="role" value="${who}" />
        <button type="submit">I approved it. Check now.</button>
      </form>
    </div>`;
}

function claimForm(job: Job): string {
  return `<form method="post" action="/jobs/${escapeHtml(job.id)}/claim">
    <input type="hidden" name="differentHumans" value="true" />
    <input type="hidden" name="buyerSubject" value="client-buyer" />
    <input type="hidden" name="workerSubject" value="client-worker" />
    <button class="ghost" type="submit">Say the humans are different</button>
  </form>`;
}

function postForm(): string {
  return `<form method="post" action="/jobs">
    <label>Job <input name="title" required maxlength="80" value="Summarize the Tokyo briefing" /></label>
    <label>What done looks like <input name="brief" required maxlength="280" value="Five bullets a judge can read in ten seconds." /></label>
    <label>Reward, in credits <input name="reward" required inputmode="numeric" value="40" /></label>
    <div class="pair">
      <label>Buyer agent <input name="buyerName" required maxlength="40" value="Buyer agent" /></label>
      <label>Worker agent <input name="workerName" required maxlength="40" value="Worker agent" /></label>
    </div>
    <button class="primary" type="submit">Escrow the reward</button>
  </form>`;
}

function panel(moment: Moment, prompts: Map<string, WorldPrompt>): string {
  switch (moment.kind) {
    case "post":
      return `${head("Step 1 of 4", "Escrow a reward", "Name the job. The credits move into the pool. They are not revenue yet.")}
        ${postForm()}`;
    case "deliver":
      return `${head("Step 2 of 4", "The worker finishes", `${moment.job.reward} credits are locked for “${moment.job.title}”. Finish the work. The pool still has not paid.`)}
        <form method="post" action="/jobs/${escapeHtml(moment.job.id)}/deliver">
          <label>Delivery <input name="note" required maxlength="280" value="Five bullets, ready for the judge." /></label>
          <button class="primary" type="submit">Mark the work delivered</button>
        </form>`;
    case "humans":
      return `${head(
        "Step 3 of 4",
        "Two different humans",
        `“${moment.job.title}” is delivered. ${moment.job.reward} credits are still in escrow. Each side approves in World App. This server keeps the subject ids.`
      )}
        <ul class="proofs">${proofLine(moment.job, "buyer")}${proofLine(moment.job, "worker")}</ul>
        ${worldPanel(moment.job, moment.seat, prompts)}
        ${claimForm(moment.job)}`;
    case "refused":
      return `${head(
        "Step 4 of 4",
        "Same human. The sale does not count.",
        `Both agents finished “${moment.job.title}”. The subject ids match, so ${moment.job.reward} credits stay in escrow.`
      )}
        <ul class="proofs">${proofLine(moment.job, "buyer")}${proofLine(moment.job, "worker")}</ul>
        <p class="hint">A second person approves a new code as the buyer. The same delivery can then be paid.</p>
        ${worldPanel(moment.job, "buyer", prompts)}`;
    case "not-world":
      return `${head(
        "Step 3 of 4",
        "Those ids were not issued by World App",
        "The pool only releases a reward after both tokens check out at sandbox.auth.world.org."
      )}
        <ul class="proofs">${proofLine(moment.job, "buyer")}${proofLine(moment.job, "worker")}</ul>
        ${worldPanel(moment.job, "buyer", prompts)}`;
    case "paid":
      return `${head(
        "Paid",
        `${moment.job.reward} credits left escrow`,
        `The buyer and the worker have different World IDs. “${moment.job.title}” counts as revenue.`
      )}
        <ul class="proofs">${proofLine(moment.job, "buyer")}${proofLine(moment.job, "worker")}</ul>
        <p class="hint">Post another job when you want a new escrow.</p>
        ${postForm()}`;
    default: {
      const leftover: never = moment;
      return leftover;
    }
  }
}

function head(step: string, title: string, lead: string): string {
  return `<p class="step">${escapeHtml(step)}</p><h2>${escapeHtml(title)}</h2><p class="lead">${escapeHtml(lead)}</p>`;
}

function history(jobs: Job[]): string {
  if (jobs.length === 0) return "";
  const rows = jobs
    .slice()
    .reverse()
    .map((job) => {
      const label = reasonWord(job.decision.reason);
      return `<li><span>${escapeHtml(job.title)}</span><em>${job.reward} · ${label}</em></li>`;
    })
    .join("");
  return `<h3>Jobs</h3><ul class="history">${rows}</ul>`;
}

function reasonWord(reason: SettleReason): string {
  switch (reason) {
    case "not-delivered":
      return "in escrow";
    case "awaiting-both":
    case "awaiting-buyer":
    case "awaiting-worker":
      return "delivered, unpaid";
    case "same-human":
      return "same human, unpaid";
    case "not-world":
      return "not a World proof";
    case "released":
      return "paid";
    default: {
      const leftover: never = reason;
      return leftover;
    }
  }
}

export function renderJobPage(input: JobPageInput): string {
  const focus = focusJob(input.jobs);
  const moment = momentOf(focus);
  const rail = railFor(moment);
  const steps = ["Post", "Deliver", "Two humans", "Pay"];
  const railHtml = steps
    .map((label, index) => {
      const number = index + 1;
      const cls =
        rail.done || number < rail.current ? "done" : number === rail.current ? (rail.refused ? "bad" : "on") : "";
      return `<li class="${cls}">${number} ${label}</li>`;
    })
    .join("");
  const claim = focus ? claimReceipt(focus) : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Rebind — the pool pays two humans</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 16px/1.45 ui-sans-serif, system-ui, sans-serif;
      background: #12140f;
      color: #f4f1e8;
    }
    main { max-width: 760px; margin: 0 auto; padding: 28px 20px 80px; }
    .kicker {
      margin: 0 0 8px;
      font-size: 12px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #b7b2a6;
    }
    h1 {
      margin: 0;
      font-family: Palatino, Georgia, serif;
      font-weight: 500;
      font-size: clamp(1.8rem, 4.4vw, 2.6rem);
      line-height: 1.08;
      letter-spacing: -0.03em;
    }
    .deck { margin: 14px 0 0; color: #d9d3c5; max-width: 40rem; }
    .ledger { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 22px; }
    .ledger article {
      background: #181b15;
      border: 1px solid #2c3128;
      border-radius: 16px;
      padding: 14px 16px;
    }
    .ledger span { display: block; color: #b7b2a6; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; }
    .ledger strong {
      display: block;
      margin-top: 4px;
      font-family: Palatino, Georgia, serif;
      font-size: 2rem;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }
    .ledger .paid strong { color: #8fdf7a; }
    .ledger .refused strong { color: #ff8d8d; }
    .ledger em { display: block; margin-top: 4px; color: #8d887c; font-style: normal; font-size: 0.85rem; }
    .rail { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; list-style: none; margin: 22px 0 0; padding: 0; }
    .rail li { padding: 8px 10px; border-radius: 999px; background: #181b15; color: #8d887c; font-size: 13px; text-align: center; }
    .rail li.on { background: #e3b341; color: #12140f; font-weight: 700; }
    .rail li.done { background: #24301f; color: #8fdf7a; }
    .rail li.bad { background: #3a1c1c; color: #ff8d8d; font-weight: 700; }
    .panel {
      margin-top: 16px;
      background: #181b15;
      border: 1px solid #2c3128;
      border-radius: 18px;
      padding: 18px 18px 16px;
    }
    .step { margin: 0; color: #e3b341; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; }
    h2 { margin: 6px 0 0; font-size: 1.45rem; font-weight: 600; letter-spacing: -0.02em; }
    .lead { margin: 8px 0 0; color: #d9d3c5; }
    form { margin-top: 16px; display: grid; gap: 10px; }
    label { display: grid; gap: 4px; color: #b7b2a6; font-size: 0.92rem; }
    input {
      font: inherit; color: inherit; background: #12140f;
      border: 1px solid #3a4034; border-radius: 10px; padding: 10px 12px;
    }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 12px; }
    button, a.primary, a.ghost {
      font: inherit; cursor: pointer; border-radius: 999px; padding: 10px 16px; text-decoration: none;
    }
    button.primary, a.primary { background: #e3b341; color: #12140f; border: 1px solid #e3b341; font-weight: 700; }
    button.ghost, a.ghost { background: transparent; color: #f4f1e8; border: 1px solid #3a4034; }
    button:disabled { opacity: 0.55; cursor: wait; }
    .code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 1.8rem; letter-spacing: 0.14em; margin: 12px 0 0;
    }
    .hint { margin: 8px 0 0; color: #b7b2a6; }
    .proofs, .history { list-style: none; margin: 14px 0 0; padding: 0; }
    .proofs li, .history li {
      display: flex; justify-content: space-between; gap: 12px;
      padding: 8px 0; border-top: 1px solid #2c3128;
    }
    .proofs em, .history em { color: #b7b2a6; font-style: normal; }
    .receipt { margin-top: 12px; border-radius: 12px; padding: 12px 14px; }
    .receipt p { margin: 4px 0 0; }
    .receipt .stamp { margin: 0; font-size: 12px; letter-spacing: 0.08em; font-weight: 700; }
    .receipt.bad { background: #2a1818; }
    .receipt.bad .stamp { color: #ff8d8d; }
    .receipt.wait { background: #2a2618; }
    .receipt.wait .stamp { color: #e3b341; }
    .take { margin-top: 28px; }
    .take h2 { font-size: 1.2rem; }
    .beats { display: grid; gap: 10px; margin-top: 12px; }
    .beats article { border: 1px solid #2c3128; border-radius: 14px; padding: 12px 14px; background: #181b15; }
    .stamp { margin: 0; font-size: 12px; letter-spacing: 0.08em; font-weight: 700; }
    .stamp.ok { color: #8fdf7a; }
    .stamp.bad { color: #ff8d8d; }
    .stamp.wait { color: #e3b341; }
    .beats h3 { margin: 4px 0 0; font-size: 1rem; }
    .beats p { margin: 4px 0 0; color: #d9d3c5; }
    .nums { margin-top: 6px; color: #b7b2a6; font-variant-numeric: tabular-nums; }
    h3 { margin: 28px 0 0; font-size: 0.78rem; letter-spacing: 0.1em; text-transform: uppercase; color: #b7b2a6; }
    .foot { margin-top: 28px; color: #b7b2a6; }
    a { color: #e3b341; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    @media (max-width: 640px) {
      .ledger, .pair, .rail { grid-template-columns: 1fr 1fr; }
      .rail { grid-template-columns: 1fr 1fr; }
      button, a.primary, a.ghost { width: 100%; text-align: center; }
      .actions { display: grid; }
    }
  </style>
</head>
<body>
  <main>
    <p class="kicker">Rebind · job pool</p>
    <h1>The pool pays two different humans.</h1>
    <p class="deck">One person can run the buyer and the worker and finish the job. The credits stay in escrow, and that sale does not count. A second person proves the buyer, and the same delivery gets paid.</p>
    <section class="ledger" aria-label="Pool balances">
      <article>
        <span>In escrow</span>
        <strong>${input.ledger.escrow}</strong>
        <em>Held until two humans differ</em>
      </article>
      <article class="paid">
        <span>Paid out</span>
        <strong>${input.ledger.paid}</strong>
        <em>The only revenue that counts</em>
      </article>
      <article class="refused">
        <span>Refused</span>
        <strong>${input.ledger.refused}</strong>
        <em>Same human. Still in escrow.</em>
      </article>
    </section>
    <ol class="rail" aria-label="Progress">${railHtml}</ol>
    <section class="panel" aria-label="Next action">
      ${flashHtml(input.flash)}
      ${claim}
      ${panel(moment, input.prompts)}
    </section>
    ${history(input.jobs)}
    <section class="take" id="take">
      <h2>Recorded take</h2>
      <p class="deck">No second phone in the room? The server runs the payout rule on fixture subjects. This does not move the credits above. A fixture is not a World App approval.</p>
      <button class="ghost" id="play-take" type="button">Play the recorded take</button>
      <div class="beats" id="take-stage"></div>
    </section>
    <p class="foot">Earlier cut: <a href="/desk">revoke a key</a> · <a href="/film">90-second film</a></p>
  </main>
  <script>
    const play = document.getElementById("play-take");
    const stage = document.getElementById("take-stage");
    play.addEventListener("click", async () => {
      play.disabled = true;
      stage.textContent = "Running the payout rule…";
      try {
        const response = await fetch("/demo/self-pay", { method: "POST" });
        const report = await response.json();
        stage.replaceChildren();
        const beats = Array.isArray(report.beats) ? report.beats : [];
        for (const beat of beats) {
          const article = document.createElement("article");
          const stamp = document.createElement("p");
          const title = document.createElement("h3");
          const detail = document.createElement("p");
          const nums = document.createElement("p");
          const name = typeof beat.stamp === "string" ? beat.stamp : "";
          stamp.className = "stamp " + (name === "PAYOUT_RELEASED" ? "ok" : name === "DELIVERED" ? "wait" : "bad");
          stamp.textContent = name;
          title.textContent = typeof beat.title === "string" ? beat.title : "";
          detail.textContent = typeof beat.detail === "string" ? beat.detail : "";
          nums.className = "nums";
          nums.textContent = "Escrow " + beat.escrow + "  ·  Paid " + beat.paid + "  ·  Refused " + beat.refused;
          article.append(stamp, title, detail, nums);
          stage.appendChild(article);
        }
        if (!report.passed) {
          const fail = document.createElement("p");
          fail.className = "stamp bad";
          fail.textContent = "The take failed.";
          stage.appendChild(fail);
        }
      } catch (error) {
        stage.textContent = "The take could not run.";
      }
      play.disabled = false;
    });
  </script>
</body>
</html>`;
}
