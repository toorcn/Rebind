import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChainStatus } from "./chain";
import { spatialView } from "./spatial-view";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function walletHomeEmbed(status: ChainStatus): { section: string; tail: string } {
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
    : "";

  const section = `<section class="section" id="wallet-desk" aria-labelledby="wallet-heading">
    <div class="workspace-heading">
      <div><p class="label">MetaMask · On-chain payments</p><h2 id="wallet-heading">Wallet jobs</h2>
      <p>Rewards sit in <strong>escrow on ${escapeHtml(status.network || "World Chain Sepolia")}</strong> until the buyer and worker verify as <strong>different people</strong>. Paid in DemoUSD, a test token.</p></div>
      <span class="net" id="net" data-state="${ready ? "on" : "off"}"><i></i><span>${ready ? escapeHtml(status.network) : "Unavailable"}</span></span>
    </div>
    <div class="roles" aria-label="How a wallet job works">
      <div class="role buyer">
        <p class="role-name"><i></i>Paying for work</p>
        <ol><li>Connect wallet</li><li>Add worker’s address</li><li>Fund the escrow</li></ol>
      </div>
      <div class="role worker">
        <p class="role-name"><i></i>Delivering work</p>
        <ol><li>Connect wallet</li><li>Pick your job</li><li>Submit delivery</li></ol>
      </div>
      <div class="role finish">
        <p class="role-name"><i></i>Both people</p>
        <ol><li>Verify in World App</li><li>Payment released</li></ol>
      </div>
    </div>
    ${ready ? "" : `<p class="banner">Wallet settlement is unavailable in this environment. <a href="/credits">Try the separate demo workspace</a> while it is unavailable.</p>`}
    <div class="wallet-grid">
      <section class="card">
        <div class="card-head"><span class="step-no">1</span><div><p class="label">Everyone</p><h3>Connect a wallet</h3></div></div>
        <p class="hint">MetaMask on your phone, or a wallet extension in this browser. Keep a little <strong>test ETH</strong> for gas.</p>
        <div class="actions">
          <button class="btn primary" id="connect" type="button" ${ready ? "" : "disabled"}>Scan with MetaMask</button>
          <button class="btn ghost" id="connect-browser" type="button" ${ready ? "" : "disabled"}>Browser wallet</button>
        </div>
        <p class="hint" id="chain-line">Not connected.</p>
        <div class="wallet-line"><span>Address</span><b id="account-line">—</b></div>
        <div class="wallet-line"><span>ETH for gas</span><b id="eth">—</b></div>
        <div class="wallet-line"><span>DemoUSD</span><b id="dusd">—</b></div>
        <div class="actions">
          <button class="btn ghost" id="switch-chain" type="button" hidden ${ready ? "" : "disabled"}>Switch network</button>
        </div>
        <details class="wallet-tools"><summary>Wallet tools</summary>
          <p class="hint">Funding adds test tokens automatically when needed. You can also top up here.</p>
          <button class="btn ghost" id="mint" type="button" ${ready ? "" : "disabled"}>Get test tokens</button>
        </details>
        <p class="status" id="wallet-status" role="status"></p>
      </section>
      <section class="card">
        <div class="card-head"><span class="step-no">2</span><div><p class="label">Buyer</p><h3>Create and fund a job</h3></div></div>
        <p class="hint">Paid from the buyer’s wallet. If it isn’t paid out, it’s <strong>refundable after 45 minutes</strong>.</p>
        <label for="description">Brief</label>
        <textarea id="description" required maxlength="280" aria-describedby="description-error" placeholder="Describe the expected delivery"></textarea>
        <p class="field-error" id="description-error" hidden></p>
        <button class="btn ghost" id="sample-brief" type="button">Use a sample brief</button>
        <label for="worker">Worker wallet</label>
        <input id="worker" required pattern="0x[0-9a-fA-F]{40}" aria-describedby="worker-help worker-error" autocomplete="off" spellcheck="false" placeholder="0x…" />
        <p class="hint" id="worker-help">Must be a <strong>different wallet</strong> from the buyer’s.</p>
        <p class="field-error" id="worker-error" hidden></p>
        <div class="wallet-row">
          <div>
            <label for="budget">Budget (dUSD)</label>
            <input id="budget" required type="number" min="1" max="1000" step="1" inputmode="numeric" value="40" aria-describedby="budget-error" />
            <p class="field-error" id="budget-error" hidden></p>
          </div>
          <div class="actions" style="align-items:flex-end">
            <button id="fill-worker" class="btn ghost" type="button">Save connected worker address</button>
          </div>
        </div>
        <p class="hint tip"><strong>Tip:</strong> connect the worker’s wallet, save its address, then reconnect as the buyer.</p>
        <div class="actions">
          <button class="btn primary" id="open-job" type="button" ${ready ? "" : "disabled"}>Fund job</button>
        </div>
        <p class="status" id="open-status" role="status"></p>
      </section>
    </div>
    <section class="card" style="margin-top:16px">
      <div class="card-head"><span class="step-no">3</span><div><p class="label">Worker and buyer</p><h3>Deliver, verify, and settle</h3></div></div>
      <p class="hint">Pick a job to see its next action. Payment releases once <strong>both people verify</strong> in World App.</p>
      <div class="job-list" id="board"><p class="hint">Loading jobs…</p></div>
    </section>
    <section class="card" id="job" style="margin-top:16px" hidden>
      <h3 id="job-title">Job</h3>
      ${spatialView({ id: "wallet-payment", mode: "wallet" })}
      <div id="job-body"></div>
      <p class="status" id="job-status" role="status"></p>
    </section>
    ${contracts ? `<details class="contract-details"><summary>Contract details</summary>${contracts}</details>` : ""}
  </section>
  <style>
    #wallet-desk { scroll-margin-top: 80px; }
    #wallet-desk .workspace-heading strong, #wallet-desk .card .hint strong { color: var(--navy); font-weight: 600; }
    #wallet-desk .roles { display: grid; grid-template-columns: 1fr 1fr 0.8fr; gap: 10px; margin: 0 0 22px; }
    #wallet-desk .role { position: relative; padding: 14px 16px; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 1px 2px rgba(17, 26, 61, 0.04); }
    #wallet-desk .role-name { display: flex; align-items: center; gap: 8px; margin: 0; font: 500 11px/1.2 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
    #wallet-desk .role-name i { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
    #wallet-desk .role.worker .role-name i { background: var(--coral); }
    #wallet-desk .role.finish { background: linear-gradient(135deg, rgba(34, 179, 122, 0.08), rgba(88, 105, 235, 0.06)); border-color: rgba(34, 179, 122, 0.25); }
    #wallet-desk .role.finish .role-name i { background: var(--ok-bright); }
    #wallet-desk .role ol { list-style: none; display: grid; gap: 7px; margin: 12px 0 0; padding: 0; counter-reset: s; }
    #wallet-desk .role li { counter-increment: s; display: flex; align-items: center; gap: 9px; font-size: 13.5px; font-weight: 500; color: var(--text); }
    #wallet-desk .role li::before { content: counter(s); flex: none; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--surface-3); color: var(--muted); font: 600 10.5px/1 var(--mono); }
    #wallet-desk .role.buyer li::before { background: var(--accent-soft); color: var(--accent); }
    #wallet-desk .role.worker li::before { background: rgba(234, 107, 67, 0.12); color: var(--coral); }
    #wallet-desk .role.finish li::before { background: var(--ok-soft); color: var(--ok); }
    #wallet-desk .role.finish li:last-child { color: var(--ok); }
    #wallet-desk .card-head { display: flex; align-items: center; gap: 12px; }
    #wallet-desk .card-head .label { margin: 0; }
    #wallet-desk .card-head h3 { margin: 3px 0 0 !important; }
    #wallet-desk .step-no {
      flex: none;
      display: grid;
      place-items: center;
      width: 38px;
      height: 38px;
      border-radius: 12px;
      background: var(--navy);
      color: #fff;
      font: 500 16px/1 var(--mono);
      box-shadow: 0 8px 18px -10px rgba(28, 41, 82, 0.8);
    }
    #wallet-desk .card-head + .hint { margin-top: 14px; }
    #wallet-desk .hint.tip { padding: 10px 12px; background: var(--surface-3); border-radius: 10px; font-size: 13px; }
    @media (max-width: 800px) { #wallet-desk .roles { grid-template-columns: 1fr; } }
    #wallet-desk > .hint { max-width: 46rem; margin: 0 0 20px; font-size: 14.5px; color: var(--text-2); }
    #wallet-desk .wallet-grid { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: 18px; align-items: start; }
    #wallet-desk .card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 22px;
      padding: 24px;
      box-shadow: var(--shadow);
      min-width: 0;
    }
    #wallet-desk .card h3 { margin: 10px 0 0; font: 400 1.6rem/1.1 var(--serif); letter-spacing: -0.01em; color: var(--navy); }
    #wallet-desk .card > .hint { margin: 8px 0 0; }
    #wallet-desk .card > p:not(.hint):not(.status) { margin: 14px 0 0; color: var(--text-2); }
    #wallet-desk #chain-line { margin-bottom: 14px; }
    #wallet-desk .wallet-line {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: baseline;
      margin: 0;
      padding: 11px 0;
      border-top: 1px solid var(--line);
      font-size: 14px;
    }
    #wallet-desk .wallet-line span { color: var(--muted); flex: none; }
    #wallet-desk .wallet-line b { font: 500 13px/1.4 var(--mono); color: var(--text); text-align: right; word-break: break-all; }
    #wallet-desk .card .actions { margin-top: 18px; }
    #wallet-desk .wallet-tools { margin-top: 16px; }
    #wallet-desk .wallet-tools summary { cursor: pointer; font-size: 13px; color: var(--text-2); }
    #wallet-desk .wallet-tools .hint { margin: 10px 0; }
    #wallet-desk .status { min-height: 1.4em; margin: 12px 0 0; color: var(--text-2); font-size: 13.5px; }
    #wallet-desk .status:empty { display: none; }
    #wallet-desk .status[data-bad] { color: var(--bad); }
    #wallet-desk .status[data-ok] { color: var(--ok); }
    #wallet-desk .field-error { margin: 6px 0; color: var(--bad); font-size: 13px; }
    #wallet-desk [aria-invalid="true"] { border-color: var(--bad); }
    #wallet-desk #sample-brief { margin-top: 8px; }
    #wallet-desk input, #wallet-desk textarea { min-width: 0; max-width: 100%; }
    #wallet-desk .banner {
      margin: 0 0 20px;
      padding: 12px 14px 12px 32px;
      position: relative;
      border: 1px solid rgba(246, 180, 14, 0.4);
      border-radius: 14px;
      background: var(--sun-soft);
      color: var(--text-2);
      font-size: 13.5px;
    }
    #wallet-desk .banner::before { content: ""; position: absolute; left: 15px; top: 19px; width: 7px; height: 7px; border-radius: 50%; background: var(--sun); }
    #wallet-desk .banner a { font-weight: 500; }
    #wallet-desk label { display: block; margin: 18px 0 7px; font-size: 13px; font-weight: 500; color: var(--text-2); }
    #wallet-desk .wallet-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: end; }
    #wallet-desk .wallet-row .actions { margin: 0; }
    #wallet-desk .wallet-row .btn { height: 47px; }
    #wallet-desk #budget { font-family: var(--mono); }
    #wallet-desk .job-list { display: grid; gap: 8px; margin-top: 16px; }
    #wallet-desk .job-list > .hint { margin: 0; }
    #wallet-desk .job-list button {
      display: block;
      width: 100%;
      text-align: left;
      font: inherit;
      color: var(--text);
      background: var(--surface-2);
      border: 1px solid var(--line-2);
      border-radius: 14px;
      padding: 13px 16px;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s, transform 0.16s var(--ease), box-shadow 0.2s;
    }
    #wallet-desk .job-list button:hover { border-color: rgba(88, 105, 235, 0.5); background: var(--surface); box-shadow: 0 0 0 4px var(--accent-soft); }
    #wallet-desk .job-list button:active { transform: scale(0.99); }
    #wallet-desk .job-list strong { font: 500 13.5px/1.3 var(--mono); color: var(--navy); }
    #wallet-desk .job-list small { display: block; margin-top: 4px; color: var(--muted); font-size: 13.5px; }
    #wallet-desk .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 16px 0 0; }
    #wallet-desk .facts > div { background: var(--surface-3); border-radius: 12px; padding: 10px 12px; min-width: 0; }
    #wallet-desk .facts span { display: block; font: 10.5px/1.2 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); }
    #wallet-desk .facts b { display: block; margin-top: 5px; font: 500 12.5px/1.45 var(--mono); color: var(--text); word-break: break-all; }
    #wallet-desk .wallet-code {
      display: inline-block;
      margin: 12px 0 4px;
      padding: 12px 18px;
      font: 500 28px/1 var(--mono);
      letter-spacing: 0.16em;
      color: var(--navy);
      background: linear-gradient(180deg, #f3f5ff, var(--surface-2));
      border: 1px solid var(--line-2);
      border-bottom-width: 2px;
      border-radius: 12px;
    }
    #wallet-desk .contracts {
      list-style: none;
      margin: 18px 0 0;
      padding: 4px 0;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: var(--shadow);
    }
    #wallet-desk .contracts li { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 12px; align-items: baseline; margin: 0; padding: 11px 20px; border-top: 1px solid var(--line); }
    #wallet-desk .contracts li:first-child { border-top: 0; }
    #wallet-desk .contracts span { font: 500 11px/1.2 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
    #wallet-desk .contracts a { font: 12.5px/1.4 var(--mono); overflow-wrap: anywhere; }
    @media (max-width: 800px) {
      #wallet-desk .wallet-grid, #wallet-desk .facts { grid-template-columns: 1fr; }
      #wallet-desk .contracts li { grid-template-columns: 1fr; gap: 4px; }
      #wallet-desk .wallet-row { grid-template-columns: 1fr; }
      #wallet-desk .card { padding: 20px 18px; }
    }
  </style>`;

  const tail = `<script id="rebind-config" type="application/json">${config}</script>
  <script>${clientJs}</script>`;

  return { section, tail };
}
