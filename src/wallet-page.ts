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

  const section = `<section class="section" id="wallet-desk" hidden>
    <div class="section-head">
      <h2>Your wallet</h2>
      <p>${ready ? escapeHtml(status.network) : "Wallet"}</p>
    </div>
    <p class="hint">Scan with MetaMask opens a code for the phone app. Browser wallet uses an extension already in this window. Either way you sign mint, escrow, and delivery on this page. World ID is written onto the address that signs. DemoUSD is a test token.</p>
    ${ready ? "" : `<p class="banner">This server has no World Chain deployment configured, so the wallet buttons stay off.</p>`}
    <div class="wallet-grid">
      <section class="card">
        <h2>Balances</h2>
        <p class="hint" id="chain-line">Not connected.</p>
        <div class="wallet-line"><span>Address</span><b id="account-line">—</b></div>
        <div class="wallet-line"><span>ETH for gas</span><b id="eth">—</b></div>
        <div class="wallet-line"><span>DemoUSD</span><b id="dusd">—</b></div>
        <div class="actions">
          <button class="btn primary" id="mint" type="button" ${ready ? "" : "disabled"}>Mint 1,000 dUSD</button>
          <button class="btn ghost" id="switch-chain" type="button" ${ready ? "" : "disabled"}>Switch network</button>
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
        <div class="wallet-row">
          <div>
            <label for="budget">Budget (dUSD)</label>
            <input id="budget" inputmode="numeric" value="40" />
          </div>
          <div class="actions" style="align-items:flex-end">
            <button id="fill-worker" class="btn ghost" type="button">Use connected wallet</button>
          </div>
        </div>
        <div class="actions">
          <button class="btn primary" id="open-job" type="button" ${ready ? "" : "disabled"}>Create and fund</button>
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
  </section>
  <style>
    #wallet-desk .wallet-grid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 16px; }
    #wallet-desk .card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 18px;
      box-shadow: var(--shadow);
    }
    #wallet-desk .card h2 { margin: 0 0 6px; font-size: 18px; }
    #wallet-desk .wallet-line { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin: 8px 0; }
    #wallet-desk .wallet-line b { font-family: var(--mono); font-size: 13px; font-weight: 500; word-break: break-all; }
    #wallet-desk .wallet-status, #wallet-desk .status { min-height: 1.4em; color: var(--navy); font-size: 14px; margin: 10px 0 0; }
    #wallet-desk .status[data-bad] { color: var(--bad); }
    #wallet-desk .status[data-ok] { color: var(--ok); }
    #wallet-desk .banner { background: rgba(246, 180, 14, 0.18); border-radius: 14px; padding: 12px 14px; color: var(--navy); }
    #wallet-desk .job-list { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
    #wallet-desk .job-list button { text-align: left; width: 100%; }
    #wallet-desk .job-list small { display: block; color: var(--muted); font-weight: 500; margin-top: 4px; }
    #wallet-desk .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; margin: 12px 0; }
    #wallet-desk .facts span { display: block; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    #wallet-desk .facts b { font-weight: 600; word-break: break-all; }
    #wallet-desk .wallet-code { font-family: var(--mono); font-size: 28px; letter-spacing: 0.12em; margin: 8px 0; }
    #wallet-desk .contracts { list-style: none; padding: 0; margin: 18px 0 0; }
    #wallet-desk .contracts li { display: grid; grid-template-columns: 110px 1fr; gap: 8px; margin: 4px 0; }
    #wallet-desk .contracts a { font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; }
    #wallet-desk label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 6px; }
    #wallet-desk input, #wallet-desk textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px;
      font: inherit;
      color: var(--text);
      background: var(--surface);
    }
    #wallet-desk textarea { min-height: 84px; resize: vertical; }
    #wallet-desk .wallet-row { display: flex; gap: 10px; align-items: flex-end; }
    #wallet-desk .wallet-row > * { flex: 1; }
    @media (max-width: 800px) {
      #wallet-desk .wallet-grid, #wallet-desk .facts, #wallet-desk .contracts li { grid-template-columns: 1fr; }
      #wallet-desk .wallet-row { flex-direction: column; align-items: stretch; }
    }
  </style>`;

  const tail = `<script id="rebind-config" type="application/json">${config}</script>
  <script>${clientJs}</script>`;

  return { section, tail };
}
