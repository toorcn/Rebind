import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChainStatus } from "./chain";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderWalletPage(status: ChainStatus): string {
  const clientJs = readFileSync(join(__dirname, "wallet-browser.js"), "utf8");
  const config = JSON.stringify(status).replaceAll("<", "\\u003c");
  const ready = status.configured && status.addresses;
  const contracts = ready
    ? `<ul class="contracts">
        <li><span>DemoUSD</span><a href="${escapeHtml(status.explorer)}/address/${escapeHtml(status.addresses!.token)}">${escapeHtml(status.addresses!.token)}</a></li>
        <li><span>Registry</span><a href="${escapeHtml(status.explorer)}/address/${escapeHtml(status.addresses!.registry)}">${escapeHtml(status.addresses!.registry)}</a></li>
        <li><span>Hook</span><a href="${escapeHtml(status.explorer)}/address/${escapeHtml(status.addresses!.hook)}">${escapeHtml(status.addresses!.hook)}</a></li>
        <li><span>Job contract</span><a href="${escapeHtml(status.explorer)}/address/${escapeHtml(status.addresses!.acp)}">${escapeHtml(status.addresses!.acp)}</a></li>
      </ul>`
    : `<p class="banner">This server has no World Chain deployment configured, so the wallet buttons stay off.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#f5f6fd" />
  <title>Rebind — pay a job from your wallet</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap" />
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f6fd;
      --surface: #ffffff;
      --line: rgba(28, 41, 82, 0.1);
      --text: #111a3d;
      --muted: #5f6890;
      --navy: #1c2952;
      --accent: #5869eb;
      --sun: #f6b40e;
      --ok: #138a5c;
      --bad: #d63d55;
      --serif: "Instrument Serif", Palatino, Georgia, serif;
      --sans: "Geist", ui-sans-serif, system-ui, sans-serif;
      --mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      --shadow: 0 1px 2px rgba(17, 26, 61, 0.04), 0 18px 40px -24px rgba(28, 41, 82, 0.35);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      font-size: 16px;
      line-height: 1.5;
    }
    a { color: var(--accent); }
    header, main, footer { width: min(1080px, calc(100% - 32px)); margin: 0 auto; }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 22px 0 8px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--text);
      text-decoration: none;
      font-weight: 600;
    }
    .brand svg { width: 28px; height: 20px; }
    nav { display: flex; gap: 16px; align-items: center; }
    nav a { color: var(--muted); text-decoration: none; font-size: 14px; }
    nav a:hover { color: var(--text); }
    h1 {
      font-family: var(--serif);
      font-weight: 400;
      font-size: clamp(40px, 6vw, 68px);
      line-height: 0.95;
      letter-spacing: -0.03em;
      margin: 8px 0 12px;
    }
    h1 em { font-style: italic; color: var(--navy); }
    .lede { max-width: 640px; color: var(--muted); margin: 0 0 28px; }
    .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 0 0 22px; padding: 0; list-style: none; }
    .steps li { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 14px 16px; box-shadow: var(--shadow); }
    .steps strong { display: block; font-size: 14px; margin-bottom: 4px; }
    .steps span { color: var(--muted); font-size: 14px; }
    .grid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 16px; }
    .card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 18px;
      box-shadow: var(--shadow);
    }
    .card h2 { margin: 0 0 6px; font-size: 18px; }
    .hint { color: var(--muted); font-size: 14px; margin: 0 0 14px; }
    label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 6px; }
    input, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px 12px;
      font: inherit;
      color: var(--text);
      background: #fbfbfe;
    }
    textarea { min-height: 84px; resize: vertical; }
    .row { display: flex; gap: 10px; }
    .row > * { flex: 1; }
    button, .btn {
      border: 0;
      border-radius: 999px;
      padding: 12px 16px;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      background: var(--navy);
      color: white;
    }
    button.ghost, a.ghost {
      background: transparent;
      color: var(--navy);
      border: 1px solid var(--line);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
    }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    .wallet-line { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin: 8px 0; }
    .wallet-line b { font-family: var(--mono); font-size: 13px; font-weight: 500; }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border-radius: 999px;
      padding: 6px 10px;
      background: rgba(88, 105, 235, 0.1);
      color: var(--navy);
      font-size: 13px;
      font-weight: 600;
    }
    .status { min-height: 1.4em; color: var(--navy); font-size: 14px; margin: 10px 0 0; }
    .status[data-bad] { color: var(--bad); }
    .status[data-ok] { color: var(--ok); }
    .banner {
      background: rgba(246, 180, 14, 0.18);
      border-radius: 14px;
      padding: 12px 14px;
      color: var(--navy);
    }
    .job-list { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
    .job-list button {
      text-align: left;
      border-radius: 14px;
      background: #f7f8fd;
      color: var(--text);
      border: 1px solid var(--line);
    }
    .job-list small { display: block; color: var(--muted); font-weight: 500; }
    .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; margin: 12px 0; }
    .facts span { display: block; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    .facts b { font-weight: 600; word-break: break-all; }
    .code {
      font-family: var(--mono);
      font-size: 28px;
      letter-spacing: 0.12em;
      margin: 8px 0;
    }
    footer { padding: 28px 0 48px; color: var(--muted); font-size: 13px; }
    .contracts { list-style: none; padding: 0; margin: 12px 0 0; }
    .contracts li { display: grid; grid-template-columns: 110px 1fr; gap: 8px; margin: 4px 0; }
    .contracts a { font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; }
    @media (max-width: 800px) {
      .grid, .steps, .facts, .contracts li, .row { grid-template-columns: 1fr; }
      .row { flex-direction: column; }
      header { align-items: flex-start; flex-direction: column; }
      nav { flex-wrap: wrap; }
    }
  </style>
</head>
<body>
  <header>
    <a class="brand" href="/">
      <svg viewBox="0 0 26 18" aria-hidden="true"><circle cx="9" cy="9" r="7.5" fill="none" stroke="#ea6b43" stroke-width="1.8"/><circle cx="17" cy="9" r="7.5" fill="none" stroke="#5869eb" stroke-width="1.8"/></svg>
      Rebind
    </a>
    <nav>
      <a href="/flow">Flow</a>
      <a href="/credits">Credit rehearsal</a>
      <button id="connect" type="button">Connect wallet</button>
    </nav>
  </header>
  <main>
    <p class="pill">${ready ? escapeHtml(status.network) : "Wallet desk"}</p>
    <h1>Pay a job from <em>your</em> wallet.</h1>
    <p class="lede">You sign the escrow. A second wallet delivers. Each wallet proves with World App, and that proof is written onto the address that signed. The hook pays two humans and reverts when both wallets are the same person.</p>
    <ol class="steps">
      <li><strong>1. Connect</strong><span>MetaMask, Rabby, or Coinbase Wallet on ${ready ? escapeHtml(status.network) : "World Chain Sepolia"}. Gas is testnet ETH.</span></li>
      <li><strong>2. Fund</strong><span>Mint DemoUSD, approve the job contract, and lock a budget. dUSD is a test token.</span></li>
      <li><strong>3. Settle</strong><span>The worker submits. Both wallets pass World ID. Settlement is a real transaction.</span></li>
    </ol>
    ${ready ? "" : `<div class="banner">This server has no World Chain deployment configured, so the wallet buttons stay off.</div>`}
    <div class="grid">
      <section class="card">
        <h2>Your wallet</h2>
        <p class="hint" id="chain-line">Not connected.</p>
        <div class="wallet-line"><span>Address</span><b id="account-line">—</b></div>
        <div class="wallet-line"><span>ETH for gas</span><b id="eth">—</b></div>
        <div class="wallet-line"><span>DemoUSD</span><b id="dusd">—</b></div>
        <div class="actions">
          <button id="mint" type="button" ${ready ? "" : "disabled"}>Mint 1,000 dUSD</button>
          <button id="switch-chain" class="ghost" type="button" ${ready ? "" : "disabled"}>Switch network</button>
        </div>
        <p class="status" id="wallet-status" role="status"></p>
      </section>
      <section class="card">
        <h2>Open a job</h2>
        <p class="hint">The connected wallet is the buyer. Paste the worker’s address, or fill it while that wallet is connected, then switch back. The job expires 45 minutes after you sign create, so a refused sale can be refunded.</p>
        <label for="description">What the worker delivers</label>
        <textarea id="description" maxlength="280" placeholder="A short brief the worker can submit against."></textarea>
        <label for="worker">Worker wallet</label>
        <input id="worker" autocomplete="off" spellcheck="false" placeholder="0x…" />
        <div class="row">
          <div>
            <label for="budget">Budget (dUSD)</label>
            <input id="budget" inputmode="numeric" value="40" />
          </div>
          <div class="actions" style="align-items:flex-end">
            <button id="fill-worker" class="ghost" type="button">Use connected wallet</button>
          </div>
        </div>
        <div class="actions">
          <button id="open-job" type="button" ${ready ? "" : "disabled"}>Create and fund</button>
        </div>
        <p class="status" id="open-status" role="status"></p>
      </section>
    </div>
    <section class="card" style="margin-top:16px">
      <h2>Jobs on this contract</h2>
      <p class="hint">Read from the job contract. Pick one to deliver, prove, settle, or refund.</p>
      <div class="job-list" id="board"><p class="hint">Loading jobs…</p></div>
    </section>
    <section class="card" id="job" style="margin-top:16px" hidden>
      <h2 id="job-title">Job</h2>
      <div id="job-body"></div>
      <p class="status" id="job-status" role="status"></p>
    </section>
    ${contracts}
  </main>
  <footer>Rebind · ETHGlobal Tokyo 2026 · The credit rehearsal is a separate ledger and does not move these tokens.</footer>
  <script id="rebind-config" type="application/json">${config}</script>
  <script>${clientJs}</script>
</body>
</html>`;
}
