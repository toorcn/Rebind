(function () {
  var configNode = document.getElementById("rebind-config");
  var cfg = JSON.parse(configNode ? configNode.textContent || "{}" : "{}");
  var state = { account: "", jobId: "", userCode: "", busy: false, provider: null };

  function $(id) {
    return document.getElementById(id);
  }

  function showDesk(scroll) {
    var node = $("wallet-desk");
    if (!node) return;
    var wasHidden = node.hidden;
    node.hidden = false;
    if (scroll && wasHidden) node.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function injectedProvider() {
    var eth = window.ethereum;
    if (!eth) return null;
    if (eth.providers && eth.providers.length) {
      var named = null;
      for (var i = 0; i < eth.providers.length; i += 1) {
        var provider = eth.providers[i];
        if (provider.isMetaMask || provider.isRabby || provider.isCoinbaseWallet) named = provider;
      }
      return named || eth.providers[0];
    }
    return eth;
  }

  function ethereum() {
    return state.provider || injectedProvider();
  }

  function qrOptions() {
    return {
      chainIdHex: cfg.chainIdHex || "0x12c1",
      rpcUrl: cfg.rpcUrl || "https://worldchain-sepolia.g.alchemy.com/public",
    };
  }

  function adoptSession(accounts, provider) {
    state.provider = provider || null;
    state.account = accounts && accounts[0] ? accounts[0] : "";
    if (!state.account) throw new Error("The wallet returned no account.");
    $("connect").textContent = short(state.account);
    if (provider && provider.on) {
      provider.on("accountsChanged", function (next) {
        state.account = next && next[0] ? next[0] : "";
        $("connect").textContent = state.account ? short(state.account) : "Scan with MetaMask";
        if (state.account) showDesk(false);
      });
      provider.on("chainChanged", function () {
        if (state.account) run(refreshAccount, "wallet-status");
      });
    }
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function short(address) {
    if (!address || address.length < 12) return address || "—";
    return address.slice(0, 6) + "…" + address.slice(-4);
  }

  function same(a, b) {
    return String(a || "").toLowerCase() === String(b || "").toLowerCase();
  }

  function explain(err) {
    if (!err) return "Something failed.";
    if (err.code === 4001) return "You declined the request in the wallet.";
    if (typeof err.message === "string" && err.message.length) return err.message;
    return "The wallet request failed.";
  }

  function setStatus(id, text, kind) {
    var node = $(id);
    if (!node) return;
    node.textContent = text || "";
    if (kind === "bad") node.setAttribute("data-bad", "");
    else node.removeAttribute("data-bad");
    if (kind === "ok") node.setAttribute("data-ok", "");
    else node.removeAttribute("data-ok");
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function txLink(hash) {
    if (!cfg.explorer || !hash) return hash || "";
    return cfg.explorer.replace(/\/$/, "") + "/tx/" + hash;
  }

  async function api(path, options) {
    var response = await fetch(path, options);
    var body = await response.json().catch(function () {
      return {};
    });
    if (!response.ok && response.status !== 202 && response.status !== 409) {
      throw new Error(body.detail || body.error || "Request failed");
    }
    body.ok = response.ok;
    body.statusCode = response.status;
    return body;
  }

  async function prepare(body) {
    return api("/chain/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function send(prepared, statusId) {
    var eth = ethereum();
    var slot = statusId || "open-status";
    if (!eth || !state.account) throw new Error("Connect a wallet first.");
    setStatus(slot, "Confirm in your wallet: " + prepared.label + ".", "");
    var hash = await eth.request({
      method: "eth_sendTransaction",
      params: [{ from: state.account, to: prepared.to, data: prepared.data }],
    });
    setStatus(slot, "Waiting for " + prepared.label + " to confirm…", "");
    var receipt = null;
    for (var i = 0; i < 40; i += 1) {
      receipt = await eth.request({ method: "eth_getTransactionReceipt", params: [hash] });
      if (receipt) break;
      await sleep(1500);
    }
    if (!receipt) throw new Error("Still waiting on " + prepared.label + ". " + txLink(hash));
    if (receipt.status === "0x0") throw new Error(prepared.label + " reverted. " + txLink(hash));
    return hash;
  }

  async function ensureChain() {
    var eth = ethereum();
    if (!eth) throw new Error("Scan with MetaMask, or use a browser wallet, before signing.");
    if (!cfg.configured) throw new Error("This server has no chain configured.");
    var current = await eth.request({ method: "eth_chainId" });
    if (String(current).toLowerCase() === String(cfg.chainIdHex).toLowerCase()) return;
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: cfg.chainIdHex }],
      });
    } catch (err) {
      if (!err || err.code !== 4902) throw err;
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: cfg.chainIdHex,
            chainName: cfg.network,
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [cfg.rpcUrl],
            blockExplorerUrls: cfg.explorer ? [cfg.explorer] : [],
          },
        ],
      });
    }
  }

  async function refreshAccount() {
    if (!state.account || !cfg.configured) return null;
    var body = await api("/chain/accounts/" + state.account);
    var account = body.account;
    $("account-line").textContent = account.address;
    $("eth").textContent = account.eth;
    $("dusd").textContent = account.dusd + (account.proven ? " · World ID on file" : "");
    var eth = ethereum();
    var chainId = eth ? await eth.request({ method: "eth_chainId" }) : "";
    var onChain = String(chainId).toLowerCase() === String(cfg.chainIdHex).toLowerCase();
    $("chain-line").textContent = onChain
      ? "Connected on " + cfg.network + "."
      : "This wallet is on another network. Switch to " + cfg.network + " before you sign.";
    if (account.eth === "0") {
      setStatus("wallet-status", "This wallet has no ETH for gas on " + cfg.network + ".", "bad");
    }
    return account;
  }

  async function finishConnect() {
    if (cfg.configured) await ensureChain();
    await refreshAccount();
    var pending = await api("/chain/world/" + state.account);
    if (pending.pending) state.userCode = pending.userCode || "";
    if (state.jobId) await loadJob(state.jobId);
  }

  async function connect() {
    showDesk(true);
    setStatus("wallet-status", "Open MetaMask on your phone and scan the code.", "");
    var mod = await import("/vendor/metamask-connect.js");
    var result = await mod.connectWithQr(qrOptions());
    adoptSession(result.accounts, result.provider);
    await finishConnect();
  }

  async function connectBrowser() {
    showDesk(true);
    var eth = injectedProvider();
    if (!eth) {
      setStatus("wallet-status", "This browser has no wallet extension. Scan with MetaMask instead.", "bad");
      return;
    }
    state.provider = eth;
    var accounts = await eth.request({ method: "eth_requestAccounts" });
    adoptSession(accounts, eth);
    await finishConnect();
  }

  function timeLeft(expiredAt) {
    var delta = expiredAt * 1000 - Date.now();
    if (delta <= 0) return "Expired";
    var mins = Math.floor(delta / 60000);
    if (mins < 1) return "Under a minute";
    if (mins < 60) return mins + " min left";
    return Math.floor(mins / 60) + "h " + (mins % 60) + "m left";
  }

  function humansCopy(job) {
    if (job.status === "Completed") return "This job is already paid.";
    if (job.status === "Rejected" || job.status === "Expired") return "This job is closed.";
    if (job.humans === "distinct") return "Two humans are on record. Settlement can pay the worker.";
    if (job.humans === "same") return "Both wallets resolved to one person. Settlement will revert, and the buyer can claim the refund after expiry.";
    return "World ID is still missing on " + (!job.clientProven ? "the buyer" : "the worker") + " wallet.";
  }

  async function loadJob(id) {
    state.jobId = String(id);
    try {
      localStorage.setItem("rebind.job", state.jobId);
    } catch (err) {
      void err;
    }
    var body = await api("/chain/jobs/" + encodeURIComponent(state.jobId));
    var job = body.job;
    var panel = $("job");
    panel.hidden = false;
    $("job-title").textContent = "Job #" + job.id + " · " + job.status;
    var buyer = same(state.account, job.client);
    var worker = same(state.account, job.provider);
    var expired = job.expiredAt * 1000 <= Date.now();
    var html = "";
    html += '<p class="hint">' + esc(humansCopy(job)) + "</p>";
    html += '<div class="facts">';
    html += "<div><span>Buyer</span><b>" + esc(job.client) + (job.clientProven ? " · proved" : " · not proved") + "</b></div>";
    html += "<div><span>Worker</span><b>" + esc(job.provider) + (job.providerProven ? " · proved" : " · not proved") + "</b></div>";
    html += "<div><span>Budget</span><b>" + esc(job.budget) + " dUSD</b></div>";
    html += "<div><span>Expiry</span><b>" + esc(timeLeft(job.expiredAt)) + "</b></div>";
    html += "</div>";
    html += "<p>" + esc(job.description) + "</p>";
    if (worker && job.status === "Funded" && !expired) {
      html += '<label for="note">Delivery note</label><textarea id="note" maxlength="280" placeholder="What you delivered."></textarea>';
    }
    if (state.userCode) {
      html += '<p class="hint">Approve this code in World App, then come back and sign.</p>';
      html += '<div class="wallet-code">' + esc(state.userCode) + "</div>";
      html += '<p><a href="https://world.org/download" target="_blank" rel="noreferrer">Open World App</a></p>';
    }
    html += '<div class="actions">';
    if (worker && job.status === "Funded" && !expired) {
      html += '<button class="btn primary" type="button" id="deliver">Submit delivery</button>';
    }
    if ((buyer || worker) && !(buyer ? job.clientProven : job.providerProven)) {
      html += '<button class="btn primary" type="button" id="prove">Prove this wallet with World ID</button>';
      html += '<button class="btn ghost" type="button" id="check-world">Sign and check World App</button>';
    }
    if (job.status === "Submitted" && job.humans !== "waiting") {
      html += '<button class="btn primary" type="button" id="settle">' + (job.humans === "same" ? "Attempt settlement" : "Settle on-chain") + "</button>";
    }
    if (buyer && expired && (job.status === "Funded" || job.status === "Submitted")) {
      html += '<button class="btn ghost" type="button" id="refund">Claim refund</button>';
    }
    html += "</div>";
    $("job-body").innerHTML = html;
    bindJobActions(job);
  }

  function bindJobActions(job) {
    var deliver = $("deliver");
    var prove = $("prove");
    var check = $("check-world");
    var settle = $("settle");
    var refund = $("refund");
    if (deliver) deliver.addEventListener("click", function () { run(deliverJob, "job-status"); });
    if (prove) prove.addEventListener("click", function () { run(startWorld, "job-status"); });
    if (check) check.addEventListener("click", function () { run(checkWorld, "job-status"); });
    if (settle) settle.addEventListener("click", function () { run(function () { return settleJob(job); }, "job-status"); });
    if (refund) refund.addEventListener("click", function () { run(refundJob, "job-status"); });
  }

  async function deliverJob() {
    var noteNode = $("note");
    var note = noteNode ? noteNode.value.trim() : "";
    if (!note) throw new Error("Write a delivery note first.");
    await ensureChain();
    setStatus("job-status", "Submitting from the worker wallet…", "");
    var hash = await send(await prepare({ action: "submit", jobId: state.jobId, note: note }), "job-status");
    setStatus("job-status", "Delivery is on-chain. " + txLink(hash), "ok");
    await loadJob(state.jobId);
    await refreshBoard();
  }

  async function startWorld() {
    if (!state.account) throw new Error("Connect the wallet you want to prove.");
    var body = await api("/chain/world/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: state.account }),
    });
    state.userCode = body.userCode;
    setStatus("job-status", "Approve " + body.userCode + " in World App, then sign to check.", "");
    await loadJob(state.jobId);
  }

  async function checkWorld() {
    if (!state.account) throw new Error("Connect the wallet you want to prove.");
    if (!state.userCode) {
      var pending = await api("/chain/world/" + state.account);
      state.userCode = pending.userCode || "";
    }
    if (!state.userCode) throw new Error("Start the World ID check before signing.");
    var eth = ethereum();
    var message = "Rebind binds this wallet to the World ID you just approved.\n" + state.userCode;
    setStatus("job-status", "Sign to bind this wallet to the World ID you approved.", "");
    var signature = await eth.request({ method: "personal_sign", params: [message, state.account] });
    var body = await api("/chain/world/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: state.account, signature: signature }),
    });
    if (body.statusCode === 202) {
      setStatus("job-status", "World App has not approved " + state.userCode + " yet.", "");
      return;
    }
    state.userCode = "";
    setStatus("job-status", "This wallet is on the human registry. " + (body.link || body.tx || ""), "ok");
    await refreshAccount();
    await loadJob(state.jobId);
  }

  async function settleJob(job) {
    setStatus("job-status", job.humans === "same" ? "Asking the hook to settle. It should revert." : "Settling on-chain…", "");
    var body = await api("/chain/settle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: state.jobId }),
    });
    if (body.settled) {
      setStatus("job-status", "Paid. " + (body.link || body.tx || ""), "ok");
    } else if (body.sent) {
      setStatus("job-status", "Settlement reverted (" + body.reason + "). " + (body.link || body.tx || ""), "bad");
    } else {
      setStatus("job-status", body.detail || body.reason || "Settlement did not send.", "bad");
    }
    await loadJob(state.jobId);
    await refreshBoard();
  }

  async function refundJob() {
    await ensureChain();
    setStatus("job-status", "Claiming the refund back to the buyer wallet…", "");
    var hash = await send(await prepare({ action: "refund", jobId: state.jobId }), "job-status");
    setStatus("job-status", "Refund sent. " + txLink(hash), "ok");
    await refreshAccount();
    await loadJob(state.jobId);
    await refreshBoard();
  }

  async function openJob() {
    var description = $("description").value.trim();
    var worker = $("worker").value.trim();
    var budget = Number($("budget").value);
    if (!description || !worker) throw new Error("Add a description and the worker wallet.");
    if (!Number.isInteger(budget) || budget < 1 || budget > 1000) throw new Error("Budget is a whole number of dUSD from 1 to 1000.");
    if (same(worker, state.account)) throw new Error("The worker wallet has to be a different address. Switch accounts, fill it, then switch back to the buyer.");
    await ensureChain();
    var account = await refreshAccount();
    if (account && account.eth === "0") {
      throw new Error("This wallet has no ETH for gas on " + cfg.network + ".");
    }
    if (!account || Number(account.dusd) < budget) {
      setStatus("open-status", "Minting 1,000 dUSD into this wallet.", "");
      await send(await prepare({ action: "mint", account: state.account }), "open-status");
      account = await refreshAccount();
    }
    if (!account || Number(account.allowance) < budget) {
      setStatus("open-status", "Approving the job contract to take dUSD.", "");
      await send(await prepare({ action: "approve" }));
    }
    setStatus("open-status", "Creating the job.", "");
    var created = await send(await prepare({ action: "create", worker: worker, description: description, budget: budget }));
    var found = null;
    for (var i = 0; i < 8; i += 1) {
      var receiptResponse = await fetch("/chain/receipt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hash: created }),
      });
      found = await receiptResponse.json().catch(function () {
        return {};
      });
      if (receiptResponse.ok && found.jobId) break;
      found = null;
      await sleep(1000);
    }
    if (!found || !found.jobId) throw new Error("The create transaction confirmed, but it did not include a job id.");
    setStatus("open-status", "Setting the budget on job #" + found.jobId + ".", "");
    await send(await prepare({ action: "setBudget", jobId: found.jobId, budget: budget }));
    setStatus("open-status", "Funding escrow on job #" + found.jobId + ".", "");
    await send(await prepare({ action: "fund", jobId: found.jobId, budget: budget }));
    setStatus("open-status", "Job #" + found.jobId + " is funded from your wallet.", "ok");
    await loadJob(found.jobId);
    await refreshBoard();
  }

  async function refreshBoard() {
    if (!cfg.configured) {
      $("board").innerHTML = '<p class="hint">No chain is configured on this server.</p>';
      return;
    }
    var body = await api("/chain/board");
    var jobs = body.jobs || [];
    if (!jobs.length) {
      $("board").innerHTML = '<p class="hint">No jobs on this contract yet. Open the first one from your wallet.</p>';
      return;
    }
    $("board").innerHTML = jobs
      .map(function (job) {
        return (
          '<button type="button" data-job="' +
          esc(job.id) +
          '"><strong>#' +
          esc(job.id) +
          " · " +
          esc(job.status) +
          " · " +
          esc(job.budget) +
          ' dUSD</strong><small>' +
          esc(job.description) +
          "</small></button>"
        );
      })
      .join("");
    var buttons = $("board").querySelectorAll("button");
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].addEventListener("click", function (event) {
        var id = event.currentTarget.getAttribute("data-job");
        run(function () {
          return loadJob(id);
        });
      });
    }
  }

  function run(task, statusId) {
    if (state.busy) return;
    state.busy = true;
    Promise.resolve()
      .then(task)
      .catch(function (err) {
        setStatus(statusId || "wallet-status", explain(err), "bad");
      })
      .then(function () {
        state.busy = false;
      });
  }

  $("connect").addEventListener("click", function () {
    run(connect, "wallet-status");
  });
  if ($("connect-browser")) {
    $("connect-browser").addEventListener("click", function () {
      run(connectBrowser, "wallet-status");
    });
  }
  $("switch-chain").addEventListener("click", function () {
    run(async function () {
      await ensureChain();
      await refreshAccount();
      setStatus("wallet-status", "Network switched.", "ok");
    }, "wallet-status");
  });
  $("mint").addEventListener("click", function () {
    run(async function () {
      if (!state.account) await connect();
      await ensureChain();
      await send(await prepare({ action: "mint", account: state.account }), "wallet-status");
      await refreshAccount();
      setStatus("wallet-status", "Minted 1,000 dUSD into this wallet.", "ok");
    }, "wallet-status");
  });
  $("fill-worker").addEventListener("click", function () {
    if (!state.account) {
      setStatus("open-status", "Connect the worker wallet first.", "bad");
      return;
    }
    $("worker").value = state.account;
  });
  $("open-job").addEventListener("click", function () {
    run(async function () {
      if (!state.account) await connect();
      await openJob();
    }, "open-status");
  });

  var eth = ethereum();
  if (eth && eth.on) {
    eth.on("accountsChanged", function (accounts) {
      state.account = accounts && accounts[0] ? accounts[0] : "";
      $("connect").textContent = state.account ? short(state.account) : "Scan with MetaMask";
      if (state.account) {
        showDesk(false);
        run(async function () {
          await refreshAccount();
          if (state.jobId) await loadJob(state.jobId);
        }, "wallet-status");
      }
    });
    eth.on("chainChanged", function () {
      if (state.account) run(refreshAccount);
    });
  }

  refreshBoard().catch(function (err) {
    $("board").innerHTML = '<p class="hint">' + explain(err) + "</p>";
  });

  async function restore() {
    try {
      var mod = await import("/vendor/metamask-connect.js");
      var session = await mod.restoreQrSession(qrOptions());
      if (session && session.accounts && session.accounts[0]) {
        adoptSession(session.accounts, session.provider);
        showDesk(false);
        if (cfg.configured) await refreshAccount();
        if (state.jobId) await loadJob(state.jobId);
        return;
      }
    } catch (err) {
      void err;
    }
    var provider = injectedProvider();
    if (!provider) return;
    try {
      var accounts = await provider.request({ method: "eth_accounts" });
      if (!accounts || !accounts[0]) return;
      adoptSession(accounts, provider);
      showDesk(false);
      if (cfg.configured) await refreshAccount();
      if (state.jobId) await loadJob(state.jobId);
    } catch (err) {
      void err;
    }
  }
  restore();

  try {
    var saved = localStorage.getItem("rebind.job");
    if (saved) {
      loadJob(saved).catch(function () {
        $("job").hidden = true;
      });
    }
  } catch (err) {
    void err;
  }
})();
