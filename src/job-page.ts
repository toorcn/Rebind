import type { ChainStatus } from "./chain";
import type { WorldPrompt } from "./durable-state";
import { focusJob, type Job, type Ledger, type Seat, type SettleReason } from "./pool";
import { walletHomeEmbed } from "./wallet-page";
import { walkthroughEmbed } from "./demo-walkthrough";
import { spatialView } from "./spatial-view";

export interface JobPageInput {
  view?: "wallet" | "credits";
  jobs: Job[];
  ledger: Ledger;
  prompts: Map<string, WorldPrompt>;
  flash: string;
  chain: ChainStatus;
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

const ICON_WAIT = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 6v4.25l2.75 1.75" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const ICON_BAD = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 6v5M10 13.6v.1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function notice(tone: "wait" | "bad", title: string, body: string): string {
  return `<div class="notice ${tone}" role="status">
      <span class="notice-icon">${tone === "wait" ? ICON_WAIT : ICON_BAD}</span>
      <div><p class="notice-title">${title}</p><p>${body}</p></div>
      <button class="notice-close" type="button" aria-label="Dismiss" data-dismiss>×</button>
    </div>`;
}

function flashHtml(flash: string): string {
  switch (flash) {
    case "waiting":
      return notice("wait", "Still waiting", "Approve the code in World App, then check again.");
    case "not-approved":
      return notice("bad", "Not approved", "Start a new code to try again.");
    case "world-down":
      return notice(
        "wait",
        "Verification unavailable",
        "World ID verification is unavailable. Open “Explore payment checks” below to try a simulation."
      );
    case "world-error":
      return notice("bad", "Couldn’t start verification", "Try again in a moment.");
    case "bad":
      return notice("bad", "Check the job", "Add a title, brief, agent names, and a reward of 1–500 credits.");
    case "missing":
      return notice("bad", "Job not found", "This job is no longer available. Create a new job.");
    default:
      return "";
  }
}

function claimReceipt(job: Job): string {
  if (!job.claimIgnored || job.decision.released) return "";
  return notice(
    "bad",
    "Verification required",
    "Only verified World IDs can unlock payment."
  );
}

function seatCard(job: Job, seat: Seat, active: boolean): string {
  const proof = seat === "buyer" ? job.buyer : job.worker;
  const name = seat === "buyer" ? job.buyerName : job.workerName;
  const status = proof
    ? `<p class="seat-status ok">${ICON_CHECK}<span>World ID verified</span></p><code class="seat-sub" title="${escapeHtml(proof.subject)}">${escapeHtml(shortSubject(proof.subject))}</code>`
    : `<p class="seat-status">${active ? '<i class="pulse"></i>' : '<i class="dot"></i>'}<span>Not verified</span></p>`;
  return `<article class="seat${proof ? " verified" : ""}${active ? " active" : ""}">
      <p class="seat-role">${seatLabel(seat)}</p>
      <h3>${escapeHtml(name)}</h3>
      ${status}
    </article>`;
}

function seatsHtml(job: Job, activeSeat: Seat | null): string {
  const both = job.buyer && job.worker;
  const match = !both ? "pending" : job.buyer!.subject === job.worker!.subject ? "same" : "differ";
  const glyph = match === "same" ? "=" : match === "differ" ? "≠" : "?";
  const caption = match === "same" ? "Same human" : match === "differ" ? "Distinct" : "Pending";
  return `<div class="seats" data-match="${match}">
      ${seatCard(job, "buyer", activeSeat === "buyer")}
      <div class="versus" aria-label="${caption}"><span>${glyph}</span><small>${caption}</small></div>
      ${seatCard(job, "worker", activeSeat === "worker")}
    </div>`;
}

function codeCells(code: string): string {
  return Array.from(code)
    .map((char) =>
      /[A-Za-z0-9]/.test(char) ? `<span>${escapeHtml(char)}</span>` : `<span class="sep">${escapeHtml(char)}</span>`
    )
    .join("");
}

function worldPanel(job: Job, seat: Seat, prompts: Map<string, WorldPrompt>): string {
  const prompt = prompts.get(deviceKey(job.id, seat));
  const who = seatLabel(seat);
  if (!prompt) {
    return `<form class="world-start" method="post" action="/jobs/${escapeHtml(job.id)}/world/start">
      <input type="hidden" name="role" value="${who}" />
      <button class="btn primary lg" type="submit">
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="10" r="2.6" fill="currentColor"/></svg>
        Verify ${who}
      </button>
      <p class="hint">Continue in World App.</p>
    </form>`;
  }
  const open = prompt.verificationUriComplete || prompt.verificationUri;
  return `<div class="code-block">
      <div class="code-head">
        <p class="label">${who} code</p>
        <button class="copy" type="button" data-copy="${escapeHtml(prompt.userCode)}">Copy</button>
      </div>
      <p class="code" aria-label="${escapeHtml(prompt.userCode)}">${codeCells(prompt.userCode)}</p>
      <p class="hint">Approve this code in World App as the ${who}.</p>
      <div class="actions">
        <a class="btn primary" href="${escapeHtml(open)}" target="_blank" rel="noopener">Open World App <span aria-hidden="true">↗</span></a>
        <form method="post" action="/jobs/${escapeHtml(job.id)}/world/pull">
          <input type="hidden" name="role" value="${who}" />
          <button class="btn ghost" type="submit">Check approval</button>
        </form>
        <form method="post" action="/jobs/${escapeHtml(job.id)}/world/start">
          <input type="hidden" name="role" value="${who}" />
          <button class="btn ghost" type="submit">Start a new code</button>
        </form>
      </div>
      <p class="poll" data-poll data-job="${escapeHtml(job.id)}" data-role="${who}" aria-live="polite"></p>
    </div>`;
}

function claimForm(job: Job): string {
  return `<details class="diagnostics"><summary>Test verification</summary><div class="tamper">
      <div>
        <p class="label">Stress test</p>
        <p>Unverified identities cannot release payment.</p>
      </div>
      <form method="post" action="/jobs/${escapeHtml(job.id)}/claim">
        <input type="hidden" name="differentHumans" value="true" />
        <input type="hidden" name="buyerSubject" value="client-buyer" />
        <input type="hidden" name="workerSubject" value="client-worker" />
        <button class="btn ghost sm" type="submit">Send test claim</button>
      </form>
    </div></details>`;
}

function postForm(): string {
  return `<form class="post" method="post" action="/jobs">
    <label class="field">
      <span>Job title</span>
      <input name="title" required maxlength="80" placeholder="e.g. Summarize the weekly briefing" autocomplete="off" />
    </label>
    <label class="field">
      <span>Brief</span>
      <input name="brief" required maxlength="280" placeholder="Describe the expected delivery" autocomplete="off" />
    </label>
    <div class="field">
      <label for="reward">Reward</label>
      <div class="reward">
        <input id="reward" name="reward" required type="number" min="1" max="500" step="1" inputmode="numeric" value="40" />
        <span class="suffix">credits</span>
      </div>
      <div class="chips" role="group" aria-label="Reward presets">
        <button type="button" class="chip" data-reward="10">10</button>
        <button type="button" class="chip" data-reward="40">40</button>
        <button type="button" class="chip" data-reward="120">120</button>
        <button type="button" class="chip" data-reward="500">500</button>
      </div>
    </div>
    <div class="pair">
      <label class="field"><span>Buyer agent</span><input name="buyerName" required maxlength="40" value="Buyer agent" autocomplete="off" /></label>
      <label class="field"><span>Worker agent</span><input name="workerName" required maxlength="40" value="Worker agent" autocomplete="off" /></label>
    </div>
    <div class="submit-row">
      <button class="btn primary lg" type="submit">Create job <span aria-hidden="true">→</span></button>
      <p class="hint">Sandbox credits only. Payment releases after delivery and verification.</p>
    </div>
  </form>`;
}

function panel(moment: Moment, prompts: Map<string, WorldPrompt>): string {
  switch (moment.kind) {
    case "post":
      return `${head("Step 1 of 4", "Create a job", "Describe the work, choose a credit reward, and name both agents.")}
        ${postForm()}`;
    case "deliver":
      return `${head("Step 2 of 4", "Submit delivery", `${moment.job.reward} credits in escrow.`)}
        <form class="post" method="post" action="/jobs/${escapeHtml(moment.job.id)}/deliver">
          <label class="field"><span>Delivery</span><input name="note" required maxlength="280" placeholder="Add the completed work or a link" autocomplete="off" /></label>
          <div class="submit-row">
            <button class="btn primary lg" type="submit">Submit delivery <span aria-hidden="true">→</span></button>
          </div>
        </form>`;
    case "humans":
      return `${head(
        "Step 3 of 4",
        "Verify both people",
        "Verify the buyer first, then the worker. Each must be a different person with World App."
      )}
        ${seatsHtml(moment.job, moment.seat)}
        ${worldPanel(moment.job, moment.seat, prompts)}
        ${claimForm(moment.job)}`;
    case "refused":
      return `${head(
        "Step 4 of 4",
        "Payment blocked",
        `Both agents belong to the same person. ${moment.job.reward} credits remain in escrow.`,
        "bad"
      )}

        ${seatsHtml(moment.job, "buyer")}
        <p class="hint">A different person must verify as the buyer to release payment.</p>
        ${worldPanel(moment.job, "buyer", prompts)}`;
    case "not-world":
      return `${head(
        "Step 3 of 4",
        "Verify with World ID",
        "Both people need a valid World ID to release payment.",
        "bad"
      )}
        ${seatsHtml(moment.job, "buyer")}
        ${worldPanel(moment.job, "buyer", prompts)}`;
    case "paid":
      return `${head(
        "Paid",
        `${moment.job.reward} credits paid`,
        `Payment released for “${moment.job.title}”.`,
        "ok"
      )}

        ${seatsHtml(moment.job, null)}
        <details class="again">
          <summary>Create another job</summary>
          ${postForm()}
        </details>`;
    default: {
      const leftover: never = moment;
      return leftover;
    }
  }
}

function head(step: string, title: string, lead: string, tone: "" | "ok" | "bad" = ""): string {
  return `<p class="step${tone ? ` ${tone}` : ""}">${escapeHtml(step)}</p><h2>${escapeHtml(title)}</h2><p class="lead">${escapeHtml(lead)}</p>`;
}

function reasonTone(reason: SettleReason): "ok" | "bad" | "wait" | "idle" {
  switch (reason) {
    case "released":
      return "ok";
    case "same-human":
    case "not-world":
      return "bad";
    case "awaiting-both":
    case "awaiting-buyer":
    case "awaiting-worker":
      return "wait";
    case "not-delivered":
      return "idle";
    default: {
      const leftover: never = reason;
      return leftover;
    }
  }
}

function history(jobs: Job[], focusId: string | null): string {
  if (jobs.length === 0) return "";
  const rows = jobs
    .slice()
    .reverse()
    .map((job) => {
      const label = reasonWord(job.decision.reason);
      const tone = reasonTone(job.decision.reason);
      return `<li${job.id === focusId ? ' class="current"' : ""}>
        <div class="h-title"><span>${escapeHtml(job.title)}</span><code>${escapeHtml(job.id)}</code></div>
        <span class="chip-status ${tone}"><i></i>${label}</span>
        <span class="h-reward">${job.reward}<small>cr</small></span>
      </li>`;
    })
    .join("");
  return `<section class="section reveal" style="--d:5" aria-labelledby="jobs-h">
      <div class="section-head">
        <h2 id="jobs-h">Sandbox job history</h2>
        <p>${jobs.length} recent</p>
      </div>
      <ul class="history">${rows}</ul>
    </section>`;
}

function reasonWord(reason: SettleReason): string {
  switch (reason) {
    case "not-delivered":
      return "in escrow";
    case "awaiting-both":
    case "awaiting-buyer":
    case "awaiting-worker":
      return "Awaiting verification";
    case "same-human":
      return "Payment blocked";
    case "not-world":
      return "Verification needed";
    case "released":
      return "paid";
    default: {
      const leftover: never = reason;
      return leftover;
    }
  }
}

function focusCard(job: Job | null): string {
  if (!job) {
    return `<div class="focus empty"><p class="label">Current job</p><p>Create a job to begin. Then submit the work and verify both people to release the reward.</p></div>`;
  }
  return `<div class="focus">
      <div class="focus-top"><p class="label">Current job</p><code>${escapeHtml(job.id)}</code></div>
      <h3>${escapeHtml(job.title)}</h3>
      <p>${escapeHtml(job.brief)}</p>
      <dl>
        <div><dt>Reward</dt><dd>${job.reward} cr</dd></div>
        <div><dt>Status</dt><dd class="${reasonTone(job.decision.reason)}">${reasonWord(job.decision.reason)}</dd></div>
      </dl>
    </div>`;
}

function ledgerBar(ledger: Ledger): string {
  const total = ledger.escrow + ledger.paid;
  if (total === 0) return `<div class="bar empty"><span style="--w:100%"></span></div>`;
  const pct = (value: number) => `${((value / total) * 100).toFixed(2)}%`;
  const held = Math.max(0, ledger.escrow - ledger.refused);
  return `<div class="bar" role="img" aria-label="${ledger.paid} paid, ${held} held, ${ledger.refused} refused">
      <span class="paid" style="--w:${pct(ledger.paid)}"></span>
      <span class="held" style="--w:${pct(held)}"></span>
      <span class="refused" style="--w:${pct(ledger.refused)}"></span>
    </div>`;
}

export function renderJobPage(input: JobPageInput): string {
  const isDemo = input.view === "credits";
  const focus = focusJob(input.jobs);
  const moment = momentOf(focus);
  const rail = railFor(moment);
  const steps: [string, string][] = [
    ["Create", "Set the reward"],
    ["Deliver", "Submit the work"],
    ["Verify", "Both people verify"],
    ["Pay", "Release the reward"],
  ];
  const railHtml = steps
    .map(([label, sub], index) => {
      const number = index + 1;
      const cls =
        rail.done || number < rail.current ? "done" : number === rail.current ? (rail.refused ? "bad" : "on") : "";
      const current = number === rail.current && !rail.done ? ' aria-current="step"' : "";
      const mark = cls === "done" ? ICON_CHECK : cls === "bad" ? "×" : String(number);
      return `<li class="${cls}"${current}><span class="num">${mark}</span><div><strong>${label}</strong><small>${sub}</small></div></li>`;
    })
    .join("");
  const claim = focus ? claimReceipt(focus) : "";
  const wallet = walletHomeEmbed(input.chain);
  const walkthrough = walkthroughEmbed();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#f5f6fd" />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='12' cy='16' r='10' fill='none' stroke='%23ea6b43' stroke-width='2'/%3E%3Ccircle cx='21' cy='16' r='10' fill='none' stroke='%235869eb' stroke-width='2'/%3E%3C/svg%3E" />
  <title>${isDemo ? "Rebind — Guided demo" : "Rebind — Wallet jobs"}</title>
  <meta name="description" content="${isDemo ? "Explore the payment rule using demo credits. No wallet transactions." : "Fund a job with MetaMask, verify both people with World ID, and settle on-chain."}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="stylesheet" href="/vendor/spatial.css" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap" />
  <style>
    @view-transition { navigation: auto; }
    :root {
      color-scheme: light;
      /* Navy ink, one periwinkle accent, green and red only for status. */
      --bg: #f5f6fd;
      --surface: #ffffff;
      --surface-2: #fafbff;
      --surface-3: #eef0fb;
      --line: rgba(28, 41, 82, 0.08);
      --line-2: rgba(28, 41, 82, 0.15);
      --text: #111a3d;
      --text-2: #394369;
      --muted: #535c84;
      --faint: #6f7799;
      --navy: #1c2952;
      --navy-2: #294481;
      --accent: #5869eb;
      --accent-soft: rgba(88, 105, 235, 0.1);
      --coral: var(--accent);
      --sun: var(--accent);
      --sun-ink: var(--accent);
      --sun-soft: var(--accent-soft);
      --ok: #138a5c;
      --ok-bright: #22b37a;
      --ok-soft: rgba(34, 179, 122, 0.11);
      --bad: #d63d55;
      --bad-soft: rgba(214, 61, 85, 0.09);
      --serif: "Instrument Serif", "Iowan Old Style", Palatino, Georgia, serif;
      --sans: "Geist", ui-sans-serif, system-ui, -apple-system, sans-serif;
      --mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      --ease: cubic-bezier(0.22, 1, 0.36, 1);
      --r: 20px;
      --shadow: 0 1px 2px rgba(17, 26, 61, 0.04), 0 12px 32px -12px rgba(17, 26, 61, 0.14);
      --shadow-lg: 0 1px 2px rgba(17, 26, 61, 0.04), 0 30px 60px -28px rgba(28, 41, 82, 0.28);
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    summary { cursor: pointer; font-weight: 500; }
    summary:hover { color: var(--accent); }
    .demos > summary { padding: 16px 0; }
    .diagnostics { margin-top: 24px; color: var(--muted); font-size: 13px; }
    .diagnostics .tamper { margin-top: 12px; }
    #desk, #wallet-desk { scroll-margin-top: 100px; }
    .skip { position: absolute; top: -80px; left: 20px; max-width: calc(100% - 40px); z-index: 30; }
    .skip:focus { top: 12px; }
    .btn.skip { position: absolute; }
    .btn:disabled, .wallet-connect:disabled { cursor: wait; opacity: 0.6; }
    .nav nav a[aria-current] { color: var(--text); background: var(--surface-3); }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-height: 100dvh;
      font: 15px/1.55 var(--sans);
      background: var(--bg);
      color: var(--text);
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      overflow-x: hidden;
    }
    body::before {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 820px;
      pointer-events: none;
      z-index: 0;
      background:
        radial-gradient(900px 520px at 85% -10%, rgba(88, 105, 235, 0.07), transparent 70%);
    }
    body::after {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 820px;
      pointer-events: none;
      z-index: 0;
      opacity: 0.55;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'><g fill='none' stroke='%231c2952' stroke-opacity='0.07' stroke-width='1'><circle cx='0' cy='0' r='32'/><circle cx='64' cy='0' r='32'/><circle cx='0' cy='64' r='32'/><circle cx='64' cy='64' r='32'/><circle cx='32' cy='32' r='32'/></g></svg>");
      -webkit-mask-image: linear-gradient(180deg, #000 0%, rgba(0, 0, 0, 0.5) 45%, transparent 100%);
      mask-image: linear-gradient(180deg, #000 0%, rgba(0, 0, 0, 0.5) 45%, transparent 100%);
    }
    .wrap { position: relative; z-index: 1; max-width: 1160px; margin: 0 auto; padding: 0 28px; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { color: var(--navy-2); }
    code { font-family: var(--mono); font-size: 0.86em; }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 8px; }
    ::selection { background: rgba(88, 105, 235, 0.22); }

    /* nav */
    .nav {
      position: sticky;
      top: 0;
      z-index: 20;
      backdrop-filter: saturate(160%) blur(14px);
      -webkit-backdrop-filter: saturate(160%) blur(14px);
      background: rgba(245, 246, 253, 0.78);
      border-bottom: 1px solid var(--line);
    }
    .nav .wrap { display: flex; align-items: center; gap: 28px; height: 60px; }
    .brand { display: inline-flex; align-items: center; gap: 10px; color: var(--text); font-weight: 600; letter-spacing: -0.01em; }
    .brand:hover { color: var(--text); }
    .brand svg { width: 26px; height: 18px; }
    .nav nav { display: flex; gap: 4px; }
    .nav nav a { color: var(--muted); font-size: 14px; padding: 6px 10px; border-radius: 8px; transition: color 0.2s, background 0.2s; }
    .nav nav a:hover { color: var(--text); background: rgba(28, 41, 82, 0.05); }
    .nav-end { margin-left: auto; display: flex; align-items: center; gap: 10px; }
    .wallet-connect {
      border: 1px solid var(--line-2);
      background: var(--navy);
      color: #fff;
      border-radius: 999px;
      padding: 8px 14px;
      font: 600 13px/1 var(--sans);
      cursor: pointer;
      white-space: nowrap;
    }
    .wallet-connect:hover { background: var(--navy-2); }
    .wallet-connect.ghost { background: var(--surface); color: var(--navy); }
    .wallet-connect.ghost:hover { background: var(--surface-3); }
    .net {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font: 12px/1 var(--mono);
      color: var(--muted);
      background: var(--surface);
      border: 1px solid var(--line-2);
      padding: 7px 11px;
      border-radius: 999px;
      white-space: nowrap;
    }
    .net i { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); }
    .net[data-state="on"] i { background: var(--ok-bright); animation: ping 2.4s var(--ease) infinite; }
    .net[data-state="off"] i { background: var(--faint); }

    /* hero */
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.9fr);
      gap: 56px;
      align-items: end;
      padding: 48px 0 36px;
    }
    .eyebrow {
      margin: 0 0 22px;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font: 500 12px/1 var(--mono);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .eyebrow::before { content: ""; width: 22px; height: 2px; border-radius: 2px; background: var(--accent); }
    h1 {
      margin: 0;
      font-family: var(--serif);
      font-weight: 400;
      font-size: clamp(2.8rem, 6.4vw, 5.2rem);
      line-height: 0.98;
      letter-spacing: -0.025em;
      color: var(--navy);
    }
    h1 em { font-style: normal; color: var(--accent); }
    .deck { margin: 24px 0 0; color: var(--text-2); max-width: 34rem; font-size: 1.06rem; line-height: 1.6; }
    .hero-cta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 30px; }

    .ledger-card {
      position: relative;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--r);
      padding: 22px 22px 18px;
      box-shadow: var(--shadow-lg);
    }
    .ledger-card::before {
      content: "";
      position: absolute;
      inset: -1px;
      border-radius: inherit;
      padding: 1px;
      background: none;
      -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
    }
    .ledger-top { display: flex; justify-content: space-between; align-items: center; }
    .label {
      margin: 0;
      font: 500 11px/1.2 var(--mono);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .live { display: inline-flex; align-items: center; gap: 6px; font: 11px/1 var(--mono); color: var(--muted); }
    .live i { width: 6px; height: 6px; border-radius: 50%; background: var(--sun); animation: blink 2s ease-in-out infinite; }
    .big { display: flex; align-items: baseline; gap: 10px; margin: 18px 0 2px; }
    .big strong { font: 400 4rem/1 var(--serif); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--ok); }
    .big span { color: var(--muted); font-size: 14px; }
    .ledger-card .sub { margin: 0; color: var(--faint); font-size: 13px; }
    .bar { display: flex; gap: 3px; height: 8px; margin: 20px 0 16px; border-radius: 99px; overflow: hidden; background: var(--surface-3); }
    .bar span { width: 0; flex: none; border-radius: 2px; animation: grow 1.1s var(--ease) 0.35s forwards; }
    .bar .paid { background: var(--ok-bright); }
    .bar .held { background: var(--sun); }
    .bar .refused { background: repeating-linear-gradient(-45deg, var(--bad) 0 3px, rgba(214, 61, 85, 0.45) 3px 6px); }
    .bar.empty span { background: transparent; }
    .rows { list-style: none; margin: 0; padding: 0; }
    .rows li { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); font-size: 14px; }
    .rows li i { width: 8px; height: 8px; border-radius: 2px; flex: none; }
    .rows li span { color: var(--text-2); }
    .rows li small { color: var(--faint); font-size: 12.5px; margin-left: 2px; }
    .rows li b { margin-left: auto; font: 500 15px/1 var(--mono); font-variant-numeric: tabular-nums; color: var(--text); }
    .rows .paid i { background: var(--ok-bright); }
    .rows .held i { background: var(--sun); }
    .rows .refused i { background: var(--bad); }
    .rows .refused b { color: var(--bad); }

    /* buttons */
    .btn {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font: 500 14px/1 var(--sans);
      padding: 12px 18px;
      border-radius: 12px;
      border: 1px solid transparent;
      cursor: pointer;
      text-decoration: none;
      transition: transform 0.16s var(--ease), background 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s;
      -webkit-tap-highlight-color: transparent;
    }
    .btn svg { width: 16px; height: 16px; }
    .btn:active { transform: scale(0.97); }
    .btn.primary {
      background: var(--navy);
      color: #fff;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 10px 24px -12px rgba(28, 41, 82, 0.7);
    }
    .btn.primary:hover { background: var(--navy-2); color: #fff; }
    .btn.ghost { background: var(--surface); color: var(--text); border-color: var(--line-2); box-shadow: 0 1px 2px rgba(17, 26, 61, 0.05); }
    .btn.ghost:hover { border-color: rgba(88, 105, 235, 0.45); color: var(--navy); }
    .btn.lg { padding: 14px 20px; font-size: 15px; }
    .btn.sm { padding: 9px 13px; font-size: 13px; border-radius: 10px; }
    .btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; box-shadow: none; }
    .btn[aria-busy="true"] { color: transparent !important; pointer-events: none; }
    .btn[aria-busy="true"]::after {
      content: "";
      position: absolute;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 2px solid;
      border-color: #fff rgba(255, 255, 255, 0.25) rgba(255, 255, 255, 0.25);
      animation: spin 0.7s linear infinite;
    }
    .btn.ghost[aria-busy="true"]::after { border-color: var(--navy) rgba(28, 41, 82, 0.18) rgba(28, 41, 82, 0.18); }

    /* desk */
    .desk {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: 28px;
      padding: 8px 0 0;
      scroll-margin-top: 80px;
    }
    .desk-side > :only-child { grid-column: 1 / -1; }
    .desk-side { align-self: start; display: grid; gap: 18px; }
    .steps { list-style: none; margin: 0 0 24px; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
    .steps li { position: relative; display: flex; gap: 14px; padding: 0; color: var(--faint); }
    .steps li:last-child { padding-bottom: 0; }
    .num {
      flex: none;
      display: grid;
      place-items: center;
      width: 31px;
      height: 31px;
      border-radius: 50%;
      border: 1px solid var(--line-2);
      background: var(--surface);
      font: 500 13px/1 var(--mono);
      transition: all 0.3s var(--ease);
    }
    .num svg { width: 15px; height: 15px; }
    .steps strong { display: block; font-weight: 500; font-size: 14.5px; color: inherit; margin-top: 5px; }
    .steps small { display: block; font-size: 12.5px; color: var(--faint); margin-top: 1px; }
    .steps li.done { color: var(--text-2); }
    .steps li.done .num { border-color: rgba(34, 179, 122, 0.45); background: var(--ok-soft); color: var(--ok); }
    .steps li.on { color: var(--text); }
    .steps li.on .num { border-color: var(--accent); background: var(--accent); color: #fff; box-shadow: 0 0 0 5px var(--accent-soft); }
    .steps li.on small { color: var(--muted); }
    .steps li.bad { color: var(--bad); }
    .steps li.bad .num { border-color: var(--bad); background: var(--bad-soft); color: var(--bad); font-size: 16px; box-shadow: 0 0 0 5px var(--bad-soft); }

    .focus { border: 1px solid var(--line); border-radius: 16px; padding: 16px; background: var(--surface); box-shadow: var(--shadow); }
    .focus.empty p:last-child { margin: 8px 0 0; color: var(--muted); font-size: 13.5px; }
    .focus-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .focus-top code { color: var(--faint); font-size: 11.5px; }
    .focus h3 { margin: 10px 0 0; font: 400 1.35rem/1.15 var(--serif); letter-spacing: -0.01em; color: var(--navy); }
    .focus > p { margin: 6px 0 0; color: var(--muted); font-size: 13.5px; }
    .focus dl { display: grid; grid-template-columns: auto 1fr; gap: 8px; margin: 14px 0 0; }
    .focus dl div { background: var(--surface-3); border-radius: 10px; padding: 8px 10px; }
    .focus dt { font: 10.5px/1.2 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); }
    .focus dd { margin: 4px 0 0; font-size: 13px; font-weight: 500; }
    .focus dd.ok { color: var(--ok); }
    .focus dd.bad { color: var(--bad); }
    .focus dd.wait { color: var(--sun-ink); }

    .panel {
      view-transition-name: panel;
      position: relative;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 34px 36px 32px;
      box-shadow: var(--shadow-lg);
      overflow: hidden;
    }
    .panel::before {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 3px;
      background: none;
    }
    .step {
      margin: 0;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font: 500 11.5px/1 var(--mono);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--accent);
    }
    .step::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .step.ok { color: var(--ok); }
    .step.bad { color: var(--bad); }
    .panel h2 { margin: 14px 0 0; font: 400 clamp(2rem, 3.6vw, 2.7rem)/1.05 var(--serif); letter-spacing: -0.02em; max-width: 30rem; color: var(--navy); }
    .lead { margin: 12px 0 0; color: var(--text-2); max-width: 36rem; }
    .hint { margin: 10px 0 0; color: var(--muted); font-size: 13.5px; }
    .verdict {
      position: absolute;
      top: 30px;
      right: 30px;
      margin: 0;
      padding: 8px 14px;
      font: 600 13px/1 var(--mono);
      letter-spacing: 0.22em;
      text-transform: uppercase;
      border: 2px solid currentColor;
      border-radius: 8px;
      transform: rotate(-6deg);
      animation: stamp 0.55s var(--ease) 0.25s both;
    }
    .verdict.ok { color: var(--ok); background: var(--ok-soft); }
    .verdict.bad { color: var(--bad); background: var(--bad-soft); }

    /* forms */
    form { margin: 0; }
    .post { display: grid; gap: 16px; margin-top: 28px; }
    .field { display: grid; gap: 7px; }
    .field > span, .field > label { font-size: 13px; color: var(--text-2); font-weight: 500; }
    input, textarea {
      width: 100%;
      font: 15px/1.3 var(--sans);
      color: var(--text);
      background: var(--surface-2);
      border: 1px solid var(--line-2);
      border-radius: 12px;
      padding: 13px 14px;
      transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
    }
    textarea { min-height: 88px; resize: vertical; line-height: 1.5; }
    input::placeholder, textarea::placeholder { color: var(--faint); }
    input:hover, textarea:hover { border-color: rgba(28, 41, 82, 0.26); }
    textarea:focus, input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); background: var(--surface); }
    input:user-invalid { border-color: var(--bad); box-shadow: 0 0 0 4px var(--bad-soft); }
    .reward { position: relative; }
    .reward input { font-family: var(--mono); font-size: 17px; padding-right: 84px; -moz-appearance: textfield; }
    .reward input::-webkit-outer-spin-button, .reward input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .suffix { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); color: var(--faint); font: 12px var(--mono); letter-spacing: 0.06em; pointer-events: none; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .chip {
      font: 500 12.5px/1 var(--mono);
      color: var(--muted);
      background: var(--surface);
      border: 1px solid var(--line-2);
      border-radius: 99px;
      padding: 7px 11px;
      cursor: pointer;
      transition: all 0.18s var(--ease);
    }
    .chip:hover { color: var(--text); border-color: rgba(88, 105, 235, 0.45); }
    .chip[aria-pressed="true"] { color: #fff; background: var(--accent); border-color: var(--accent); }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .submit-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 18px; margin-top: 6px; }
    .submit-row .hint { margin: 0; }
    .again { margin-top: 30px; padding-top: 24px; border-top: 1px dashed var(--line-2); }
    .again .post { margin-top: 16px; }

    /* seats */
    .seats { display: grid; grid-template-columns: 1fr 84px 1fr; align-items: stretch; margin-top: 28px; }
    .seat {
      border: 1px solid var(--line-2);
      border-radius: 16px;
      padding: 16px 16px 14px;
      background: var(--surface-2);
      transition: border-color 0.3s, box-shadow 0.3s;
      min-width: 0;
    }
    .seat.active { border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); background: var(--surface); }
    .seat.verified { border-color: rgba(34, 179, 122, 0.4); }
    .seat-role { margin: 0; font: 500 10.5px/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--faint); }
    .seat h3 { margin: 8px 0 0; font-size: 16px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .seat-status { display: flex; align-items: center; gap: 7px; margin: 10px 0 0; font-size: 13px; color: var(--muted); }
    .seat-status svg { width: 15px; height: 15px; }
    .seat-status.ok { color: var(--ok); }
    .seat-status .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); }
    .pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: ping-accent 1.8s var(--ease) infinite; }
    .seat-sub { display: block; margin-top: 8px; color: var(--text-2); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .seat-sub.empty { color: var(--faint); }
    .versus { display: grid; place-items: center; align-content: center; gap: 4px; }
    .versus span {
      display: grid;
      place-items: center;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      font: 400 22px/1 var(--serif);
      border: 1px solid var(--line-2);
      background: var(--surface);
      color: var(--faint);
    }
    .versus small { font: 10px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); white-space: nowrap; }
    .seats + .hint { margin-top: 16px; }
    .seats[data-match="same"] .versus span { color: var(--bad); border-color: var(--bad); background: var(--bad-soft); animation: shake 0.5s var(--ease) 0.2s; }
    .seats[data-match="same"] .versus small, .seats[data-match="same"] .seat-sub { color: var(--bad); }
    .seats[data-match="same"] .seat { border-color: rgba(214, 61, 85, 0.35); }
    .seats[data-match="differ"] .versus span { color: var(--ok); border-color: var(--ok-bright); background: var(--ok-soft); }
    .seats[data-match="differ"] .versus small { color: var(--ok); }

    /* world code */
    .world-start { margin-top: 24px; }
    .code-block { margin-top: 20px; border: 1px solid var(--line-2); border-radius: 18px; padding: 18px; background: linear-gradient(180deg, #f3f5ff, var(--surface-2)); }
    .code-head { display: flex; justify-content: space-between; align-items: center; }
    .copy {
      font: 500 12px/1 var(--mono);
      color: var(--muted);
      background: var(--surface);
      border: 1px solid var(--line-2);
      border-radius: 8px;
      padding: 6px 9px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .copy:hover { color: var(--text); }
    .copy[data-done] { color: var(--ok); border-color: rgba(34, 179, 122, 0.45); }
    .code { display: flex; flex-wrap: wrap; gap: 6px; margin: 14px 0 0; }
    .code span {
      display: grid;
      place-items: center;
      min-width: 44px;
      height: 56px;
      padding: 0 6px;
      font: 500 26px/1 var(--mono);
      color: var(--navy);
      background: var(--surface);
      border: 1px solid var(--line-2);
      border-bottom-width: 2px;
      border-radius: 10px;
      animation: rise 0.5s var(--ease) both;
    }
    .code span:nth-child(2) { animation-delay: 0.04s; } .code span:nth-child(3) { animation-delay: 0.08s; }
    .code span:nth-child(4) { animation-delay: 0.12s; } .code span:nth-child(5) { animation-delay: 0.16s; }
    .code span:nth-child(6) { animation-delay: 0.2s; } .code span:nth-child(7) { animation-delay: 0.24s; }
    .code span:nth-child(8) { animation-delay: 0.28s; } .code span:nth-child(9) { animation-delay: 0.32s; }
    .code span.sep { min-width: 14px; background: none; border: none; color: var(--faint); }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 16px; }
    .poll { margin: 12px 0 0; display: flex; align-items: center; gap: 8px; font: 12px/1.4 var(--mono); color: var(--muted); min-height: 1.4em; }
    .poll:empty { display: none; }
    .poll[data-live]::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: blink 1.4s ease-in-out infinite; }

    .tamper {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      margin-top: 22px;
      padding: 14px 16px;
      border: 1px dashed var(--line-2);
      border-radius: 14px;
    }
    .tamper p:last-child { margin: 5px 0 0; color: var(--muted); font-size: 13.5px; }
    .tamper form { flex: none; }

    /* notices */
    .notice {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 12px;
      align-items: start;
      margin: -8px 0 24px;
      padding: 13px 14px;
      border-radius: 14px;
      border: 1px solid;
      animation: rise 0.45s var(--ease) both;
    }
    .notice + .notice { margin-top: -14px; }
    .notice p { margin: 0; font-size: 13.5px; color: var(--text-2); }
    .notice .notice-title { font-weight: 600; font-size: 14px; margin-bottom: 2px; }
    .notice-icon svg { width: 20px; height: 20px; display: block; }
    .notice.wait { background: var(--accent-soft); border-color: rgba(88, 105, 235, 0.28); }
    .notice.wait .notice-title, .notice.wait .notice-icon { color: var(--sun-ink); }
    .notice.bad { background: var(--bad-soft); border-color: rgba(214, 61, 85, 0.3); }
    .notice.bad .notice-title, .notice.bad .notice-icon { color: var(--bad); }
    .notice-close { background: none; border: 0; color: var(--muted); font-size: 20px; line-height: 1; cursor: pointer; padding: 0 2px; }
    .notice-close:hover { color: var(--text); }
    .notice.leaving { animation: fade-out 0.25s var(--ease) forwards; }

    /* sections */
    .section { padding: 72px 0 0; }
    .section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 20px; margin-bottom: 18px; flex-wrap: wrap; }
    .section-head h2 { margin: 0; font: 400 2rem/1.1 var(--serif); letter-spacing: -0.015em; color: var(--navy); }
    .section-head p { margin: 0; color: var(--faint); font: 12px var(--mono); }
    .history { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 18px; overflow: hidden; background: var(--surface); box-shadow: var(--shadow); }
    .history li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto 84px;
      align-items: center;
      gap: 18px;
      padding: 14px 18px;
      border-top: 1px solid var(--line);
      transition: background 0.2s;
    }
    .history li:first-child { border-top: 0; }
    .history li:hover { background: var(--surface-2); }
    .history li.current { background: linear-gradient(90deg, var(--accent-soft), transparent 60%); box-shadow: inset 3px 0 0 var(--accent); }
    .h-title { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
    .h-title span { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .h-title code { color: var(--faint); font-size: 11.5px; flex: none; }
    .h-reward { text-align: right; font: 500 15px var(--mono); font-variant-numeric: tabular-nums; }
    .h-reward small { color: var(--faint); font-size: 11px; margin-left: 3px; }
    .chip-status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-size: 12.5px;
      font-weight: 500;
      padding: 5px 10px;
      border-radius: 99px;
      background: var(--surface-3);
      color: var(--muted);
      white-space: nowrap;
    }
    .chip-status i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .chip-status.ok { color: var(--ok); background: var(--ok-soft); }
    .chip-status.bad { color: var(--bad); background: var(--bad-soft); }
    .chip-status.wait { color: var(--sun-ink); background: var(--sun-soft); }

    .takes { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .take {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--line);
      border-radius: 22px;
      padding: 24px;
      background: var(--surface);
      box-shadow: var(--shadow);
      min-width: 0;
    }
    .take-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .tag { font: 11px/1 var(--mono); color: var(--muted); background: var(--surface-3); border-radius: 99px; padding: 6px 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tag.on { color: var(--ok); background: var(--ok-soft); }
    .take h3 { margin: 16px 0 0; font: 400 1.7rem/1.1 var(--serif); letter-spacing: -0.01em; color: var(--navy); }
    .take > p { margin: 10px 0 0; color: var(--muted); font-size: 14px; }
    .take > p code { color: var(--navy-2); background: var(--surface-3); padding: 1px 5px; border-radius: 5px; }
    .take > p:last-of-type { flex: 1 0 auto; }
    .take .btn { margin-top: 20px; align-self: flex-start; }
    .beats { list-style: none; margin: 0; padding: 0; }
    .beats:not(:empty) { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--line); }
    .beats li { position: relative; padding: 0 0 18px 26px; animation: rise 0.5s var(--ease) both; animation-delay: calc(var(--i) * 110ms); }
    .beats li::before { content: ""; position: absolute; left: 4px; top: 7px; width: 9px; height: 9px; border-radius: 50%; background: var(--faint); box-shadow: 0 0 0 4px var(--surface); z-index: 1; }
    .beats li::after { content: ""; position: absolute; left: 8px; top: 14px; bottom: -4px; width: 1px; background: var(--line-2); }
    .beats li:last-child::after { display: none; }
    .beats li.ok::before { background: var(--ok-bright); }
    .beats li.bad::before { background: var(--bad); }
    .beats li.wait::before { background: var(--sun); }
    .beat-stamp { display: inline-block; font: 500 10.5px/1 var(--mono); letter-spacing: 0.08em; padding: 4px 7px; border-radius: 6px; background: var(--surface-3); color: var(--muted); }
    .ok > .beat-stamp { color: var(--ok); background: var(--ok-soft); }
    .bad > .beat-stamp { color: var(--bad); background: var(--bad-soft); }
    .wait > .beat-stamp { color: var(--sun-ink); background: var(--sun-soft); }
    .beats h4 { margin: 8px 0 0; font-size: 14.5px; font-weight: 500; }
    .beats p { margin: 4px 0 0; color: var(--muted); font-size: 13.5px; }
    .beats .nums { font: 12px var(--mono); color: var(--faint); font-variant-numeric: tabular-nums; }
    .beats .nums a { color: var(--accent); }
    .result { display: flex; align-items: center; gap: 8px; margin: 4px 0 0; font: 500 12.5px var(--mono); animation: rise 0.5s var(--ease) both; }
    .result.ok { color: var(--ok); }
    .result.bad { color: var(--bad); }
    .result svg { width: 16px; height: 16px; }
    .skeleton { display: grid; gap: 10px; margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--line); }
    .skeleton i { display: block; height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--surface-3), #f7f8ff, var(--surface-3)); background-size: 200% 100%; animation: shimmer 1.3s linear infinite; }
    .skeleton i:nth-child(2) { width: 82%; } .skeleton i:nth-child(3) { width: 64%; }
    .skeleton p { margin: 4px 0 0; color: var(--faint); font: 12px var(--mono); }

    footer { margin-top: 96px; border-top: 1px solid var(--line); background: var(--surface); }
    footer .wrap { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 14px; padding-top: 26px; padding-bottom: 40px; color: var(--faint); font-size: 13px; }
    footer nav { display: flex; gap: 18px; flex-wrap: wrap; }
    footer a { color: var(--muted); }
    footer a:hover { color: var(--navy); }

    /* motion */
    .reveal { animation: rise 1.1s var(--ease) both; animation-delay: calc(var(--d, 0) * 90ms); }
    .reveal[data-reveal-pending] { animation-play-state: paused; }
    @keyframes rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
    @keyframes fade-out { to { opacity: 0; transform: translateY(-6px); } }
    @keyframes grow { to { width: var(--w); } }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes blink { 50% { opacity: 0.3; } }
    @keyframes shimmer { to { background-position: -200% 0; } }
    @keyframes ping { 0% { box-shadow: 0 0 0 0 rgba(34, 179, 122, 0.5); } 70%, 100% { box-shadow: 0 0 0 7px rgba(34, 179, 122, 0); } }
    @keyframes ping-accent { 0% { box-shadow: 0 0 0 0 rgba(88, 105, 235, 0.5); } 70%, 100% { box-shadow: 0 0 0 7px rgba(88, 105, 235, 0); } }
    @keyframes stamp { from { opacity: 0; transform: rotate(-6deg) scale(1.6); } to { opacity: 1; transform: rotate(-6deg) scale(1); } }
    @keyframes shake { 20%, 60% { transform: translateX(-3px); } 40%, 80% { transform: translateX(3px); } }
    ::view-transition-old(panel), ::view-transition-new(panel) { animation-duration: 0.35s; animation-timing-function: var(--ease); }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 0.001ms !important; animation-delay: 0s !important; transition-duration: 0.001ms !important; }
      .reveal[data-reveal-pending] { animation-play-state: running; }
      html { scroll-behavior: auto; }
    }

    .hero { align-items: center; }
    .hero-cta { align-items: center; gap: 20px; }
    .text-link { font-size: 14px; font-weight: 500; }
    .journey { padding: 4px 0 4px 28px; border-left: 1px solid var(--line-2); }
    .journey ol { list-style: none; padding: 0; margin: 24px 0 0; display: grid; gap: 22px; }
    .journey li { display: flex; gap: 16px; }
    .journey li > span { font: 12px/1.8 var(--mono); color: var(--accent); }
    .journey strong { font-weight: 500; }
    .journey p:not(.label) { margin: 4px 0 0; font-size: 14px; color: var(--muted); max-width: 34ch; }
    .workspace { padding-top: 32px; border-top: 1px solid var(--line-2); }
    .workspace-heading { display: flex; justify-content: space-between; align-items: center; gap: 24px; margin-bottom: 28px; }
    .workspace-heading h2 { margin: 10px 0 8px; font: 400 2.2rem/1.1 var(--serif); }
    .workspace-heading p:not(.label) { color: var(--muted); max-width: 62ch; margin: 0; font-size: 14px; }
    .workspace-heading > a { flex-shrink: 0; }
    .ledger-card { box-shadow: var(--shadow); padding: 20px; }
    .ledger-card .big strong { font-size: 3rem; }
    .ledger-card .rows li { font-size: 13px; }
    .ledger-card .hint { font-size: 12px; margin-bottom: 0; }
    #wallet-desk { margin-top: 56px; padding-top: 32px; border-top: 1px solid var(--line-2); }
    .demos { padding-top: 16px; border-top: 1px solid var(--line-2); }
    @media (max-width: 680px) {
      .workspace-heading { align-items: start; flex-direction: column; gap: 16px; }
      .journey { padding-left: 18px; }
      .hero-cta .text-link { text-align: center; width: 100%; }
      .nav-end .tag { font-size: 10px; }
    }

    .demo-banner {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 16px;
      align-items: center;
      margin-top: 28px;
      padding: 12px 14px 12px 12px;
      background: var(--surface);
      border: 1px solid var(--line-2);
      border-radius: 14px;
      font-size: 13.5px;
    }
    .demo-banner strong {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      border-radius: 99px;
      background: var(--navy);
      color: #fff;
      font: 600 11px/1 var(--mono);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .demo-banner span { flex: 1; min-width: 220px; color: var(--text-2); }
    .demo-banner a { font-weight: 500; }
    .demo-hero { padding-bottom: 48px; }
    .demo-hero h1 { font-size: clamp(2.6rem, 5.4vw, 4.4rem); }
    .demo-plan {
      position: relative;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--r);
      padding: 22px 22px 14px;
      box-shadow: var(--shadow-lg);
    }
    .demo-plan::before {
      content: "";
      position: absolute;
      inset: -1px;
      border-radius: inherit;
      padding: 1px;
      background: none;
      -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
    }
    .demo-plan h2 { margin: 12px 0 4px; font: 400 1.7rem/1.1 var(--serif); color: var(--navy); letter-spacing: -0.01em; }
    .plan { list-style: none; margin: 14px 0 0; padding: 0; }
    .plan li { position: relative; display: flex; gap: 14px; padding: 12px 0; border-top: 1px solid var(--line); }
    .plan li > span {
      flex: none;
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      border-radius: 10px;
      background: var(--accent-soft);
      color: var(--accent);
      font: 600 13px/1 var(--mono);
    }
    .plan li.pay > span { background: var(--ok-soft); color: var(--ok); }
    .plan strong { display: block; font-size: 14.5px; font-weight: 600; color: var(--navy); }
    .plan small { display: block; margin-top: 1px; font-size: 13px; color: var(--muted); }
    .needs li:nth-child(n) .need-icon.ok { background: var(--ok-soft); color: var(--ok); }
    .wallet-page #wallet-desk { margin-top: 0; }
    .demo-page .takes { grid-template-columns: 1fr; }
    .demo-panel { view-transition-name: none; }
    mark {
      color: var(--navy);
      font-weight: 500;
      background: none;
      font-weight: 600;
      text-decoration: underline;
      text-decoration-color: rgba(88, 105, 235, 0.45);
      text-decoration-thickness: 2px;
      text-underline-offset: 4px;
      padding: 0 2px;
    }
    .needs { margin-top: 26px; }
    .needs ul { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 0; padding: 0; }
    .needs li {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 13px 7px 7px;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 999px;
      box-shadow: 0 1px 2px rgba(17, 26, 61, 0.05);
      font-size: 13.5px;
      font-weight: 500;
      color: var(--text);
    }
    .need-icon { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); }
    .need-icon svg { width: 15px; height: 15px; }
    .demo-entry {
      display: flex;
      align-items: center;
      gap: 14px;
      max-width: 34rem;
      margin-top: 22px;
      padding: 14px 16px;
      background: rgba(255, 255, 255, 0.72);
      border: 1px dashed rgba(88, 105, 235, 0.35);
      border-radius: 16px;
      color: var(--text);
      transition: border-color 0.2s, background 0.2s, transform 0.2s var(--ease);
    }
    .demo-entry:hover { color: var(--text); background: var(--surface); border-color: var(--accent); border-style: solid; }
    .demo-entry:hover .demo-entry-go { transform: translateX(3px); }
    .demo-entry strong { display: block; font-size: 14.5px; font-weight: 600; color: var(--navy); }
    .demo-entry small { display: block; margin-top: 2px; font-size: 13px; color: var(--muted); }
    .demo-entry-icon { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: var(--accent); color: #fff; font-size: 11px; }
    .demo-entry-go { margin-left: auto; color: var(--accent); font-size: 18px; transition: transform 0.2s var(--ease); }
    .demo-page .workspace.advanced-demo, .demo-page .demos { padding-top: 0; border-top: 0; }
    .demo-page .demos { margin-top: 14px; }
    .advanced-demo > summary, .demos > summary {
      list-style: none;
      position: relative;
      display: block;
      padding: 18px 60px 18px 20px;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: var(--shadow);
      color: var(--navy);
      font-size: 15.5px;
      font-weight: 600;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .advanced-demo > summary::-webkit-details-marker, .demos > summary::-webkit-details-marker { display: none; }
    .advanced-demo > summary:hover, .demos > summary:hover { color: var(--navy); border-color: rgba(88, 105, 235, 0.45); }
    .advanced-demo > summary::after, .demos > summary::after {
      content: "+";
      position: absolute;
      right: 18px;
      top: 50%;
      transform: translateY(-50%);
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--accent-soft);
      color: var(--accent);
      font: 500 18px/1 var(--sans);
    }
    .advanced-demo[open] > summary::after, .demos[open] > summary::after { content: "−"; }
    .advanced-demo[open] > summary, .demos[open] > summary { margin-bottom: 24px; }
    .advanced-demo > summary small, .demos > summary small { display: block; margin-top: 4px; color: var(--muted); font-size: 13.5px; font-weight: 400; }

    @media (max-width: 960px) {
      .hero { grid-template-columns: 1fr; gap: 36px; padding: 48px 0 40px; align-items: start; }
      .desk { grid-template-columns: 1fr; }
      .desk-side { position: static; grid-template-columns: 1fr 1fr; align-items: start; }
      .takes { grid-template-columns: 1fr; }
    }
    @media (max-width: 680px) {
      .wrap { padding: 0 16px; }
      .nav .wrap { gap: 12px; }
      .nav .wrap { flex-wrap: wrap; height: auto; padding-top: 12px; padding-bottom: 10px; }
      .nav nav { order: 3; width: 100%; justify-content: space-between; }
      .nav nav a { padding: 6px 4px; font-size: 12px; }
      .wallet-connect { padding: 8px 11px; font-size: 12px; }
      .nav-end { gap: 6px; }
      .net { display: none; }
      .desk-side { grid-template-columns: 1fr; }
      .steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
      .steps li { flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 0; }
      .steps li::before { left: calc(50% + 20px); right: calc(-50% + 20px); top: 15px; bottom: auto; width: auto; height: 1px; }
      .steps li.done::before { background: var(--ok-bright); }
      .steps strong { margin-top: 0; font-size: 12px; }
      .steps small { display: none; }
      .panel { padding: 24px 18px 22px; border-radius: 20px; }
      .verdict { top: 20px; right: 16px; font-size: 11px; padding: 6px 10px; }
      .pair { grid-template-columns: 1fr; }
      .seats { grid-template-columns: 1fr; gap: 8px; }
      .versus { grid-auto-flow: column; justify-content: center; gap: 10px; }
      .versus span { width: 32px; height: 32px; font-size: 18px; }
      .tamper { flex-direction: column; align-items: stretch; }
      .btn { width: 100%; }
      .actions { display: grid; }
      .actions form { display: grid; }
      .code span { min-width: 34px; height: 46px; font-size: 20px; }
      .history li { grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; }
      .history .chip-status { grid-row: 2; justify-self: start; }
      .h-title code { display: none; }
      .take { padding: 20px 18px; }
      .take .btn { align-self: stretch; }
      .net span { max-width: 130px; overflow: hidden; text-overflow: ellipsis; }
    }
    @media (max-width: 370px) {
      .brand span { display: none; }
    }
  </style>
</head>
<body class="${isDemo ? "demo-page" : "wallet-page"}">
  <a class="skip btn primary" href="${isDemo ? "#in-app-demo" : "#wallet-desk"}">Skip to ${isDemo ? "demo" : "wallet jobs"}</a>
  <header class="nav">
    <div class="wrap">
      <a class="brand" href="/" aria-label="Rebind home">
        <svg viewBox="0 0 26 18" aria-hidden="true"><circle cx="9" cy="9" r="7.5" fill="none" stroke="#1c2952" stroke-width="1.8"/><circle cx="17" cy="9" r="7.5" fill="none" stroke="#5869eb" stroke-width="1.8"/></svg>
        <span>Rebind</span>
      </a>
      <nav aria-label="Primary">
        <a href="/" ${isDemo ? "" : 'aria-current="page"'}>Wallet jobs</a>
        <a href="/credits" ${isDemo ? 'aria-current="page"' : ""}>Guided demo</a>
        <a href="/flow">How it works</a>
      </nav>
      <div class="nav-end">
<span class="tag">${isDemo ? "Demo · No transactions" : "Test network · Test tokens"}</span>
      </div>
    </div>
  </header>

  <main class="wrap">
    ${isDemo ? `
    <div class="demo-banner"><strong>Demo only</strong><span>App credits only. These jobs do not move tokens or change your wallet balance.</span><a href="/">Back to wallet jobs →</a></div>
    <section class="hero demo-hero">
      <div>
        <p class="eyebrow reveal" style="--d:0">Guided demo · Sample credits</p>
        <h1 class="reveal" style="--d:1">Follow a job.<br /><em>See how payment works.</em></h1>
        <p class="deck reveal" style="--d:2">Fund a sample job, submit the work, and see why payment needs <mark>two different people</mark>.</p>
        <div class="hero-cta reveal" style="--d:3"><a class="btn primary lg" href="#in-app-demo">Start the guided demo <span aria-hidden="true">↓</span></a>${focus ? '<a class="text-link" href="#desk">Continue your credit sandbox job ↓</a>' : ""}</div>
        <div class="needs reveal" style="--d:4">
          <p class="label">You won’t need</p>
          <ul>
            <li><span class="need-icon ok" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>No wallet</li>
            <li><span class="need-icon ok" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>No World App</li>
            <li><span class="need-icon ok" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>No real tokens</li>
          </ul>
        </div>
      </div>
      <aside class="demo-plan reveal" style="--d:2" aria-label="What happens in the demo">
        <div class="ledger-top"><p class="label">In this demo</p><span class="tag">4 steps</span></div>
        <h2>One job, start to payout</h2>
        <ol class="plan">
          <li><span>1</span><div><strong>Fund</strong><small>40 sample credits go into escrow</small></div></li>
          <li><span>2</span><div><strong>Deliver</strong><small>The sample worker submits the work</small></div></li>
          <li class="hold"><span>3</span><div><strong>Buyer check</strong><small>Verified, but payment still waits</small></div></li>
          <li class="pay"><span>4</span><div><strong>Worker check &amp; payout</strong><small>Two different people, so it pays</small></div></li>
        </ol>
      </aside>
    </section>
` : `
    <section class="hero">
      <div>
        <p class="eyebrow reveal" style="--d:0">Job payments · ${escapeHtml(input.chain.network || "World Chain Sepolia")}</p>
        <h1 class="reveal" style="--d:1">Work delivered.<br /><em>People verified.</em></h1>
        <p class="deck reveal" style="--d:2">Fund a job, get the work delivered, and release payment only when the buyer and worker verify as <mark>two different people</mark>.</p>
        <div class="hero-cta reveal" style="--d:3">
          <a class="btn primary lg" href="#wallet-desk">Create a wallet job <span aria-hidden="true">↓</span></a>
        </div>
        <div class="needs reveal" style="--d:4">
          <p class="label">Each person needs</p>
          <ul>
            <li><span class="need-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><rect x="3" y="5" width="14" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M13 10.5h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5 5l7-2.5 1 2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></span>A MetaMask wallet</li>
            <li><span class="need-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="10" r="2.5" fill="currentColor"/></svg></span>World App</li>
            <li><span class="need-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 2.5 15 10l-5 3-5-3 5-7.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M5 11.5 10 17.5l5-6-5 3-5-3Z" fill="currentColor"/></svg></span>Test ETH for gas</li>
          </ul>
        </div>
        <a class="demo-entry reveal" style="--d:5" href="/credits">
          <span class="demo-entry-icon" aria-hidden="true">▶</span>
          <span><strong>Just exploring? Try the guided demo</strong><small>Sample people and credits. No wallet or World App needed.</small></span>
          <span class="demo-entry-go" aria-hidden="true">→</span>
        </a>
      </div>
      ${spatialView({ id: "people-explainer", mode: "people" })}
    </section>

`}

    ${isDemo ? `
    ${walkthrough.section}

    <details class="workspace advanced-demo" id="desk" ${focus || input.flash ? "open" : ""}>
      <summary>Advanced: test World ID with demo credits<small>Uses World App to verify real people. No wallet or blockchain transactions.</small></summary>
    <section aria-labelledby="sandbox-heading">
      <div class="workspace-heading">
        <div><p class="label">Demo credits · World App verification</p><h2 id="sandbox-heading">Credit sandbox</h2>
        <p>Walk through a job with demo credits. You’ll need two different people with World App to complete verification.</p></div>
        <a class="text-link" href="/">Go to wallet jobs →</a>
      </div>
      <ol class="steps" aria-label="Sandbox job progress">${railHtml}</ol>
      <div class="desk">
        <section class="panel" aria-label="Next action">
          ${flashHtml(input.flash)}
          ${claim}
          ${panel(moment, input.prompts)}
        </section>
        <div class="desk-side">
          ${focus ? spatialView({ id: "credit-payment", mode: "credits", job: focus }) : ""}
          ${focus ? focusCard(focus) : ""}
      <aside class="ledger-card" aria-label="Sandbox pool totals">
        <div class="ledger-top"><p class="label">Sandbox pool totals</p><span class="tag">credits</span></div>
        <div class="big"><strong data-count="paid" data-value="${input.ledger.paid}">${input.ledger.paid}</strong><span>paid out</span></div>

        ${ledgerBar(input.ledger)}
        <ul class="rows">
          <li class="held"><i></i><span>In escrow</span><b data-count="escrow" data-value="${input.ledger.escrow}">${input.ledger.escrow}</b></li>
          <li class="paid"><i></i><span>Paid out</span><b data-count="paid2" data-value="${input.ledger.paid}">${input.ledger.paid}</b></li>
          <li class="refused"><i></i><span>Blocked in escrow</span><b data-count="refused" data-value="${input.ledger.refused}">${input.ledger.refused}</b></li>
        </ul>
        <p class="hint">Across all sandbox jobs. Separate from your wallet balance.</p>
      </aside>
        </div>
      </div>
      ${history(input.jobs, focus?.id ?? null)}
    </section>
    </details>

    <details class="section demos reveal" style="--d:6">
      <summary>Explore payment checks<small>Simulate blocked and successful payouts with test identities.</small></summary>
      <p class="hint">No second person available? Use test identities to see blocked payments and successful payouts.</p>
      <div class="takes">
        <article class="take" id="take">
          <div class="take-top"><p class="label">Simulation</p><span class="tag">Test data</span></div>
          <h3>Preview payment checks</h3>
          <p>Uses test identities. Your balance is unchanged.</p>
          <button class="btn ghost" id="play-take" type="button">Run simulation</button>
          <ol class="beats" id="take-stage"></ol>
        </article>

      </div>
    </details>
    ` : wallet.section}
  </main>

  <footer>
    <div class="wrap">
      <span>Rebind</span>
      <nav aria-label="Resources">${isDemo ? '<a href="/">Back to wallet jobs</a>' : '<a href="/credits">Guided demo</a>'}<a href="/desk">Key management</a><a href="/film">Product demo</a></nav>
    </div>
  </footer>

  <script>
    (() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(({ target, isIntersecting }) => {
          if (!isIntersecting) return;
          target.removeAttribute("data-reveal-pending");
          observer.unobserve(target);
        });
      });
      document.querySelectorAll(".reveal").forEach((node) => {
        if (node.getBoundingClientRect().top < window.innerHeight) return;
        node.setAttribute("data-reveal-pending", "");
        node.style.animationDelay = "0s";
        observer.observe(node);
        node.addEventListener("focusin", () => {
          node.removeAttribute("data-reveal-pending");
          observer.unobserve(node);
        }, { once: true });
      });
    })();
  </script>
  ${isDemo ? `<script>
    (() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      function revealCreditJob() {
        if (location.hash === "#desk") document.getElementById("desk").open = true;
      }
      revealCreditJob();
      window.addEventListener("hashchange", revealCreditJob);
      const CHECK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

      function store(key, value) {
        try {
          if (value === undefined) return sessionStorage.getItem(key);
          sessionStorage.setItem(key, value);
        } catch (error) {}
        return null;
      }

      // Ledger numbers tick from what this tab saw last to what the server holds now.
      document.querySelectorAll("[data-count]").forEach((node) => {
        const key = "rebind.ledger." + node.dataset.count;
        const target = Number(node.dataset.value) || 0;
        const seen = store(key);
        store(key, String(target));
        const from = seen === null ? 0 : Number(seen) || 0;
        if (reduce || from === target) return;
        const start = performance.now();
        const span = 900;
        node.textContent = String(from);
        function frame(now) {
          const t = Math.min(1, (now - start) / span);
          const eased = 1 - Math.pow(1 - t, 4);
          node.textContent = String(Math.round(from + (target - from) * eased));
          if (t < 1) requestAnimationFrame(frame);
        }
        setTimeout(() => requestAnimationFrame(frame), 250);
      });

      // Submits show progress and cannot be sent twice.
      document.querySelectorAll("form").forEach((form) => {
        form.addEventListener("submit", () => {
          const button = form.querySelector("button[type=submit]");
          if (!button) return;
          setTimeout(() => {
            button.setAttribute("aria-busy", "true");
            button.disabled = true;
          }, 0);
        });
      });

      document.querySelectorAll("[data-dismiss]").forEach((button) => {
        button.addEventListener("click", () => {
          const box = button.closest(".notice");
          if (!box) return;
          box.classList.add("leaving");
          setTimeout(() => box.remove(), 240);
          if (location.search) history.replaceState(null, "", location.pathname + location.hash);
        });
      });

      // Reward presets.
      document.querySelectorAll(".post").forEach((form) => {
        const input = form.querySelector("input[name=reward]");
        const chips = form.querySelectorAll("[data-reward]");
        if (!input) return;
        function sync() {
          chips.forEach((chip) => chip.setAttribute("aria-pressed", String(chip.dataset.reward === input.value.trim())));
        }
        chips.forEach((chip) =>
          chip.addEventListener("click", () => {
            input.value = chip.dataset.reward;
            sync();
            input.focus();
          })
        );
        input.addEventListener("input", sync);
        sync();
      });

      document.querySelectorAll("[data-copy]").forEach((button) => {
        button.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(button.dataset.copy);
            button.textContent = "Copied";
            button.setAttribute("data-done", "");
            setTimeout(() => {
              button.textContent = "Copy";
              button.removeAttribute("data-done");
            }, 1600);
          } catch (error) { button.textContent = "Select code to copy"; }
        });
      });

      // While a World code is on screen, check for approval every few seconds.
      const poll = document.querySelector("[data-poll]");
      if (poll) {
        const job = poll.dataset.job;
        const role = poll.dataset.role;
        const started = Date.now();
        const limit = 3 * 60 * 1000;
        let timer = 0;
        let busy = false;
        let stopped = false;
        function say(text, live) {
          poll.textContent = text;
          if (live) poll.setAttribute("data-live", "");
          else poll.removeAttribute("data-live");
        }
        function schedule(delay) {
          clearTimeout(timer);
          if (stopped) return;
          if (Date.now() - started > limit) {
            say("Auto-check paused. Use the button once you approve.", false);
            return;
          }
          timer = setTimeout(check, delay);
        }
        function finish(url) {
          stopped = true;
          clearTimeout(timer);
          location.replace(url);
        }
        async function check() {
          if (busy || stopped) return;
          busy = true;
          try {
            const response = await fetch("/jobs/" + encodeURIComponent(job) + "/world/pull", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ role: role }),
            });
            const body = await response.json().catch(() => ({}));
            if (response.status === 202) {
              say("Waiting for approval in World App", true);
              schedule(5000);
            } else if (response.ok && body.attached) {
              say("Approved. Updating…", false);
              finish("/credits#desk");
            } else if (response.status === 403) {
              finish("/credits?flash=not-approved#desk");
            } else if (response.status === 409 && body.status === "replaced") {
              finish("/credits#desk");
            } else if (response.status === 404) {
              finish("/credits?flash=world-error#desk");
            } else {
              say("Couldn’t check approval. Retrying…", true);
              schedule(8000);
            }
          } catch (error) {
            say("Connection lost. Retrying…", true);
            schedule(8000);
          }
          busy = false;
        }
        say("Waiting for approval in World App", true);
        schedule(5000);
        document.addEventListener("visibilitychange", () => {
          if (!document.hidden) schedule(300);
        });
      }

      function beatTone(name, okNames, badNames) {
        if (okNames.indexOf(name) >= 0) return "ok";
        if (badNames.indexOf(name) >= 0) return "bad";
        return "wait";
      }

      function skeleton(stage, text) {
        stage.replaceChildren();
        const box = document.createElement("div");
        box.className = "skeleton";
        box.innerHTML = "<i></i><i></i><i></i>";
        const note = document.createElement("p");
        note.textContent = text;
        box.appendChild(note);
        stage.appendChild(box);
      }

      function beatItem(beat, index, tone) {
        const item = document.createElement("li");
        item.className = tone;
        item.style.setProperty("--i", String(index));
        const stamp = document.createElement("span");
        stamp.className = "beat-stamp";
        stamp.textContent = typeof beat.stamp === "string" ? beat.stamp : "";
        const title = document.createElement("h4");
        title.textContent = typeof beat.title === "string" ? beat.title : "";
        const detail = document.createElement("p");
        detail.textContent = typeof beat.detail === "string" ? beat.detail : "";
        item.append(stamp, title, detail);
        return item;
      }

      function verdict(stage, passed, text, index) {
        const line = document.createElement("p");
        line.className = "result " + (passed ? "ok" : "bad");
        line.style.animationDelay = index * 110 + "ms";
        line.innerHTML = passed ? CHECK : "";
        line.appendChild(document.createTextNode(text));
        stage.appendChild(line);
      }

      const play = document.getElementById("play-take");
      const stage = document.getElementById("take-stage");
      play.addEventListener("click", async () => {
        play.disabled = true;
        play.setAttribute("aria-busy", "true");
        skeleton(stage, "Running the payout rule…");
        try {
          const response = await fetch("/demo/self-pay", { method: "POST" });
          const report = await response.json();
          await new Promise((resolve) => setTimeout(resolve, reduce ? 0 : 450));
          stage.replaceChildren();
          const beats = Array.isArray(report.beats) ? report.beats : [];
          beats.forEach((beat, index) => {
            const name = typeof beat.stamp === "string" ? beat.stamp : "";
            const tone = name === "PAYOUT_RELEASED" ? "ok" : name === "DELIVERED" ? "wait" : "bad";
            const item = beatItem(beat, index, tone);
            const nums = document.createElement("p");
            nums.className = "nums";
            nums.textContent = "escrow " + beat.escrow + "  ·  paid " + beat.paid + "  ·  refused " + beat.refused;
            item.appendChild(nums);
            stage.appendChild(item);
          });
          verdict(stage, !!report.passed, report.passed ? "Simulation complete." : "Simulation failed. Try again.", beats.length);
          play.textContent = "Run again";
        } catch (error) {
          stage.replaceChildren();
          verdict(stage, false, "Couldn’t run the simulation. Try again.", 0);
        }
        play.disabled = false;
        play.removeAttribute("aria-busy");
      });

    })();
  </script>` : ""}
  ${isDemo ? walkthrough.tail : wallet.tail}
  <script type="module" src="/vendor/spatial/main.js"></script>
</body>
</html>`;
}
