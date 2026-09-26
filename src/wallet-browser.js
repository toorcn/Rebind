(function () {
  var configNode = document.getElementById("rebind-config");
  var cfg = JSON.parse(configNode ? configNode.textContent || "{}" : "{}");
  var state = { account: "", jobId: "", userCode: "", verificationUri: "", busy: false, refreshQueued: false, onChain: null, provider: null, funding: null };
  var boundProviders = new WeakSet();

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
    changeAccount(accounts);
    if (!state.account) throw new Error("The wallet returned no account.");
    if (provider && provider.on && !boundProviders.has(provider)) {
      boundProviders.add(provider);
      provider.on("accountsChanged", function (next) {
        if (state.provider !== provider) return;
        changeAccount(next);
        queueRefresh();
      });
      provider.on("chainChanged", function () {
        if (state.provider !== provider) return;
        state.onChain = null;
        queueRefresh();
      });
    }
  }

  function fundingKey(account) {
    return "rebind.funding:" + cfg.chainIdHex + ":" + String(cfg.addresses && cfg.addresses.acp || "").toLowerCase() + ":" + account.toLowerCase();
  }

  function changeAccount(accounts) {
    state.account = accounts && accounts[0] ? accounts[0] : "";
    state.userCode = "";
    state.verificationUri = "";
    state.onChain = null;
    state.funding = null;
    try {
      var saved = JSON.parse(localStorage.getItem(fundingKey(state.account)) || "null");
      if (saved && same(saved.account, state.account) && (saved.jobId || saved.hash)) state.funding = saved;
    } catch (err) { void err; }
    $("connect").textContent = state.account ? short(state.account) : "Scan with MetaMask";
    $("account-line").textContent = state.account || "—";
    $("eth").textContent = "—";
    $("dusd").textContent = "—";
    $("chain-line").textContent = state.account ? "Checking wallet…" : "Not connected.";
    $("job").hidden = true;
    $("job-body").innerHTML = "";
    setStatus("wallet-status", "", "");
    setStatus("job-status", "", "");
    if (state.account) showDesk(false);
    syncControls();
  }

  function rememberFunding(funding) {
    if (!funding || same(funding.account, state.account)) state.funding = funding;
    try {
      if (funding) localStorage.setItem(fundingKey(funding.account), JSON.stringify(funding));
      else localStorage.removeItem(fundingKey(state.account));
    } catch (err) { void err; }
    syncControls();
  }

  function requireAccount(account) {
    if (!account || !same(account, state.account)) throw new Error("Wallet changed. Reconnect the original wallet to continue.");
  }

  function setWorldPrompt(prompt) {
    state.userCode = prompt.userCode || "";
    state.verificationUri = prompt.verificationUriComplete || prompt.verificationUri || "";
  }

  function queueRefresh() {
    state.refreshQueued = true;
    syncControls();
    if (!state.busy) run(refreshSession, "wallet-status");
  }

  async function refreshSession() {
    state.refreshQueued = false;
    var account = state.account;
    await refreshAccount();
    if (account !== state.account) return;
    if (account) {
      var pending = await api("/chain/world/" + account);
      if (account !== state.account) return;
      setWorldPrompt(pending.pending ? pending : {});
    }
    if (state.jobId) await loadJob(state.jobId);
  }

  function syncControls() {
    var locked = state.busy || state.refreshQueued;
    document.querySelectorAll("#wallet-desk button").forEach(function (button) {
      button.disabled = locked || !cfg.configured;
      if (button.id === "fill-worker" || button.id === "switch-chain") button.disabled = button.disabled || !state.account;
      if ((button.id === "fill-worker" || button.id === "sample-brief") && state.funding) button.disabled = true;
    });
    $("switch-chain").hidden = !state.account || state.onChain !== false;
    $("open-job").textContent = state.funding ? "Resume funding" : "Fund job";
    ["description", "worker", "budget"].forEach(function (id) { $(id).disabled = locked || Boolean(state.funding); });
    if (locked) $("wallet-desk").setAttribute("aria-busy", "true");
    else $("wallet-desk").removeAttribute("aria-busy");
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
    if (!err) return "Request failed. Try again.";
    if (err.code === 4001) return "Request cancelled. Try again when you’re ready.";
    if (typeof err.message === "string" && err.message.length) return err.message;
    return "Wallet request failed. Try again.";
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
      var error = new Error(body.detail || body.error || "Request failed");
      error.statusCode = response.status;
      throw error;
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

  async function send(prepared, statusId, account, onSent) {
    var eth = ethereum();
    var slot = statusId || "open-status";
    account = account || state.account;
    requireAccount(account);
    if (!eth || !state.account) throw new Error("Connect a wallet first.");
    await ensureChain();
    requireAccount(account);
    setStatus(slot, "Confirm in your wallet: " + prepared.label + ".", "");
    var hash = await eth.request({
      method: "eth_sendTransaction",
      params: [{ from: account, to: prepared.to, data: prepared.data }],
    });
    if (onSent) onSent(hash);
    setStatus(slot, "Waiting for " + prepared.label + " to confirm…", "");
    var receipt = null;
    for (var i = 0; i < 40; i += 1) {
      receipt = await eth.request({ method: "eth_getTransactionReceipt", params: [hash] });
      if (receipt) break;
      await sleep(1500);
    }
    if (!receipt) throw new Error("Still waiting on " + prepared.label + ". " + txLink(hash));
    if (receipt.status === "0x0") throw new Error(prepared.label + " reverted. " + txLink(hash));
    requireAccount(account);
    return hash;
  }

  async function ensureChain() {
    var eth = ethereum();
    if (!eth) throw new Error("Connect a wallet to continue.");
    if (!cfg.configured) throw new Error("Wallet payments are currently unavailable.");
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
    var address = state.account;
    var eth = ethereum();
    var chainId = eth ? await eth.request({ method: "eth_chainId" }) : "";
    if (address !== state.account || eth !== ethereum()) return null;
    state.onChain = String(chainId).toLowerCase() === String(cfg.chainIdHex).toLowerCase();
    syncControls();
    var body = await api("/chain/accounts/" + address);
    if (address !== state.account || eth !== ethereum()) return null;
    var account = body.account;
    $("account-line").textContent = account.address;
    $("eth").textContent = account.eth;
    $("dusd").textContent = account.dusd;
    $("chain-line").textContent = state.onChain
      ? "Connected on " + cfg.network + "."
      : "Switch to " + cfg.network + " to continue.";
    if (account.eth === "0") {
      setStatus("wallet-status", "This wallet has no ETH for gas on " + cfg.network + ".", "bad");
    }
    return account;
  }

  async function finishConnect() {
    if (cfg.configured) await ensureChain();
    await refreshSession();
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
      setStatus("wallet-status", "No browser wallet found. Use Scan with MetaMask.", "bad");
      return;
    }
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
    if (job.status === "Completed") return "Payment complete.";
    if (job.status === "Rejected" || job.status === "Expired") return "This job is closed.";
    if (job.expiredAt * 1000 <= Date.now()) return "Job expired. The buyer can claim a refund.";
    if (job.status === "Open") return "This job has not been funded. The buyer can resume funding below.";
    if (job.humans === "distinct") return job.status === "Submitted" ? "Ready to release payment." : "Both people verified. Submit delivery to continue.";
    if (job.humans === "same") return "Payment blocked: both wallets belong to the same person. The buyer can request a refund after expiry.";
    return "Verification needed for " + (!job.clientProven ? "the buyer" : "the worker") + " wallet.";
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
    if (String(job.id) !== state.jobId) return;
    if (state.funding && String(state.funding.jobId) === String(job.id) && job.status !== "Open") rememberFunding(null);
    var panel = $("job");
    panel.hidden = false;
    $("job-title").textContent = "Job #" + job.id + " · " + job.status;
    var paymentView = $("wallet-payment");
    if (paymentView) paymentView.setAttribute("data-job", JSON.stringify(job));
    var buyer = same(state.account, job.client);
    var worker = same(state.account, job.provider);
    var expired = job.expiredAt * 1000 <= Date.now();
    var html = "";
    html += '<p class="hint">' + esc(humansCopy(job)) + "</p>";
    html += '<div class="facts">';
    html += "<div><span>Buyer</span><b>" + esc(job.client) + (job.clientProven ? " · verified" : " · unverified") + "</b></div>";
    html += "<div><span>Worker</span><b>" + esc(job.provider) + (job.providerProven ? " · verified" : " · unverified") + "</b></div>";
    html += "<div><span>Budget</span><b>" + esc(job.budget) + " dUSD</b></div>";
    html += "<div><span>Expiry</span><b>" + esc(timeLeft(job.expiredAt)) + "</b></div>";
    html += "</div>";
    html += "<p>" + esc(job.description) + "</p>";
    if (buyer && job.status === "Open" && !expired && Number(job.budget) === 0) {
      var fundingBudget = state.funding && String(state.funding.jobId) === String(job.id) ? state.funding.budget : 40;
      html += '<label for="fund-budget">Budget (dUSD)</label><input id="fund-budget" type="number" min="1" max="1000" step="1" value="' + esc(fundingBudget) + '" />';
    }
    if (worker && job.status === "Funded" && !expired) {
      html += '<label for="note">Delivery note</label><textarea id="note" maxlength="280" placeholder="Add the completed work or a link"></textarea>';
    }
    var needsProof = (buyer || worker) && !(buyer ? job.clientProven : job.providerProven) && !expired && (job.status === "Funded" || job.status === "Submitted");
    if (state.userCode && needsProof) {
      html += '<p class="hint">Approve in World App, then return to verify.</p>';
      html += '<div class="wallet-code">' + esc(state.userCode) + "</div>";
      if (state.verificationUri) html += '<p><a href="' + esc(state.verificationUri) + '" target="_blank" rel="noreferrer">Open World App</a></p>';
    }
    html += '<div class="actions">';
    if (buyer && job.status === "Open" && !expired) {
      html += '<button class="btn primary" type="button" id="resume-funding">Resume funding</button>';
    }
    if (worker && job.status === "Funded" && !expired) {
      html += '<button class="btn primary" type="button" id="deliver">Submit delivery</button>';
    }
    if (needsProof) {
      html += '<button class="btn ' + (state.userCode ? 'ghost' : 'primary') + '" type="button" id="prove">' + (state.userCode ? 'New code' : 'Verify with World ID') + '</button>';
    }
    if (needsProof && state.userCode) {
      html += '<button class="btn primary" type="button" id="check-world">Check approval</button>';
    }
    if (job.status === "Submitted" && job.humans === "distinct" && !expired) {
      html += '<button class="btn primary" type="button" id="settle">Release payment</button>';
    }
    if (buyer && expired && (job.status === "Funded" || job.status === "Submitted")) {
      html += '<button class="btn ghost" type="button" id="refund">Claim refund</button>';
    }
    html += "</div>";
    $("job-body").innerHTML = html;
    bindJobActions(job);
    syncControls();
  }

  function bindJobActions(job) {
    var resume = $("resume-funding");
    var deliver = $("deliver");
    var prove = $("prove");
    var check = $("check-world");
    var settle = $("settle");
    var refund = $("refund");
    if (resume) resume.addEventListener("click", function () { run(function () { return resumeJob(job); }, "job-status"); });
    if (deliver) deliver.addEventListener("click", function () { run(deliverJob, "job-status"); });
    if (prove) prove.addEventListener("click", function () { run(startWorld, "job-status"); });
    if (check) check.addEventListener("click", function () { run(checkWorld, "job-status"); });
    if (settle) settle.addEventListener("click", function () { run(function () { return settleJob(job); }, "job-status"); });
    if (refund) refund.addEventListener("click", function () { run(refundJob, "job-status"); });
  }

  async function deliverJob() {
    var account = state.account;
    var noteNode = $("note");
    var note = noteNode ? noteNode.value.trim() : "";
    if (!note) throw new Error("Write a delivery note first.");
    await ensureChain();
    setStatus("job-status", "Submitting from the worker wallet…", "");
    var hash = await send(await prepare({ action: "submit", jobId: state.jobId, note: note }), "job-status", account);
    setStatus("job-status", "Delivery submitted. " + txLink(hash), "ok");
    await loadJob(state.jobId);
    await refreshBoard();
  }

  async function startWorld() {
    if (!state.account) throw new Error("Connect the wallet you want to prove.");
    var account = state.account;
    var body = await api("/chain/world/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: account }),
    });
    requireAccount(account);
    setWorldPrompt(body);
    setStatus("job-status", "Approve " + body.userCode + " in World App, then sign to check.", "");
    await loadJob(state.jobId);
  }

  async function checkWorld() {
    if (!state.account) throw new Error("Connect the wallet you want to prove.");
    var account = state.account;
    if (!state.userCode) {
      var pending = await api("/chain/world/" + state.account);
      requireAccount(account);
      setWorldPrompt(pending);
    }
    if (!state.userCode) throw new Error("Start the World ID check before signing.");
    var eth = ethereum();
    var message = "Rebind binds this wallet to the World ID you just approved.\n" + state.userCode;
    setStatus("job-status", "Sign to bind this wallet to the World ID you approved.", "");
    var signature = await eth.request({ method: "personal_sign", params: [message, account] });
    requireAccount(account);
    var body;
    try {
      body = await api("/chain/world/pull", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: account, signature: signature }),
      });
    } catch (err) {
      requireAccount(account);
      if (err.statusCode === 403 || err.statusCode === 404) {
        setWorldPrompt({});
        await loadJob(state.jobId);
        throw new Error("This code is no longer valid. Start a new World ID check.");
      }
      throw err;
    }
    requireAccount(account);
    if (body.statusCode === 202) {
      setStatus("job-status", "World App has not approved " + state.userCode + " yet.", "");
      return;
    }
    if (body.statusCode === 409) {
      await refreshSession();
      setStatus("job-status", "A newer code is available. Approve that code in World App, then check again.", "");
      return;
    }
    if (!body.attached) throw new Error("World ID verification did not complete. Try checking again.");
    setWorldPrompt({});
    setStatus("job-status", "Wallet verified. " + (body.link || body.tx || ""), "ok");
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
    var account = state.account;
    await ensureChain();
    setStatus("job-status", "Claiming the refund back to the buyer wallet…", "");
    var hash = await send(await prepare({ action: "refund", jobId: state.jobId }), "job-status", account);
    setStatus("job-status", "Refund sent. " + txLink(hash), "ok");
    await refreshAccount();
    await loadJob(state.jobId);
    await refreshBoard();
  }

  function clearFieldError(id) {
    $(id).removeAttribute("aria-invalid");
    var error = $(id + "-error");
    if (error) { error.hidden = true; error.textContent = ""; }
  }

  function invalidField(id, message) {
    $(id).setAttribute("aria-invalid", "true");
    var error = $(id + "-error");
    if (error) { error.textContent = message; error.hidden = false; }
    // run() restores enabled controls before moving keyboard focus.
    var failure = new Error(message);
    failure.fieldId = id;
    throw failure;
  }

  function validateJob() {
    ["description", "worker", "budget"].forEach(clearFieldError);
    var description = $("description").value.trim();
    var worker = $("worker").value.trim();
    var budget = Number($("budget").value);
    if (!description) invalidField("description", "Add a brief describing what the worker should deliver, or use the sample brief.");
    if (!worker) invalidField("worker", "Add the worker’s wallet address.");
    if (!/^0x[0-9a-fA-F]{40}$/.test(worker) || /^0x0{40}$/i.test(worker)) invalidField("worker", "Enter a valid worker wallet address.");
    if (!Number.isInteger(budget) || budget < 1 || budget > 1000) invalidField("budget", "Enter a whole number from 1 to 1,000 dUSD.");
    if (same(worker, state.account)) invalidField("worker", "The connected wallet is the worker’s. Connect the buyer wallet to fund, or enter a different worker address.");
    return { description: description, worker: worker, budget: budget };
  }

  async function openJob() {
    if (state.funding) return continueFunding("open-status");
    var draft = validateJob();
    var description = draft.description;
    var worker = draft.worker;
    var budget = draft.budget;
    var buyer = state.account;
    await ensureChain();
    await prepareFunds(budget, buyer, "open-status");
    setStatus("open-status", "Creating the job.", "");
    await send(await prepare({ action: "create", worker: worker, description: description, budget: budget }), "open-status", buyer, function (hash) {
      rememberFunding({ account: buyer, budget: budget, hash: hash, jobId: "" });
    });
    await continueFunding("open-status");
  }

  async function prepareFunds(budget, buyer, slot) {
    requireAccount(buyer);
    var account = await refreshAccount();
    requireAccount(buyer);
    if (account && account.eth === "0") {
      throw new Error("This wallet has no ETH for gas on " + cfg.network + ".");
    }
    if (!account || Number(account.dusd) < budget) {
      setStatus(slot, "Minting 1,000 dUSD into this wallet.", "");
      await send(await prepare({ action: "mint", account: buyer }), slot, buyer);
      account = await refreshAccount();
      requireAccount(buyer);
    }
    if (!account || Number(account.allowance) < budget) {
      setStatus(slot, "Approving the job contract to take dUSD.", "");
      await send(await prepare({ action: "approve" }), slot, buyer);
    }
  }

  async function resumeJob(job) {
    var input = $("fund-budget");
    var budget = Number(job.budget) || Number(input && input.value);
    if (!Number.isInteger(budget) || budget < 1 || budget > 1000) throw new Error("Enter a whole number from 1 to 1,000 dUSD.");
    requireAccount(job.client);
    if (state.funding && String(state.funding.jobId) !== String(job.id)) {
      throw new Error("Finish the pending job with Resume funding above before funding another job.");
    }
    rememberFunding({ account: state.account, budget: budget, jobId: String(job.id), hash: "" });
    await continueFunding("job-status");
  }

  async function fundingJobId(funding) {
    if (funding.jobId) return funding.jobId;
    var receipt = await ethereum().request({ method: "eth_getTransactionReceipt", params: [funding.hash] });
    requireAccount(funding.account);
    if (receipt && receipt.status === "0x0") {
      rememberFunding(null);
      throw new Error("Job creation reverted. You can create a new job.");
    }
    var found = null;
    for (var i = 0; i < 8; i += 1) {
      var receiptResponse = await fetch("/chain/receipt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hash: funding.hash }),
      });
      found = await receiptResponse.json().catch(function () {
        return {};
      });
      if (receiptResponse.ok && found.jobId) break;
      found = null;
      await sleep(1000);
    }
    requireAccount(funding.account);
    if (!found || !found.jobId) throw new Error("Still locating the created job. Use Resume funding to check again.");
    funding.jobId = String(found.jobId);
    rememberFunding(funding);
    return funding.jobId;
  }

  async function continueFunding(slot) {
    var funding = state.funding;
    if (!funding) return;
    requireAccount(funding.account);
    await ensureChain();
    var id = await fundingJobId(funding);
    var body = await api("/chain/jobs/" + encodeURIComponent(id));
    requireAccount(funding.account);
    var job = body.job;
    if (!same(job.client, funding.account)) throw new Error("Only the buyer wallet can fund this job.");
    if (job.status !== "Open") {
      rememberFunding(null);
      await loadJob(id);
      setStatus(slot, "Job #" + id + " is already " + job.status.toLowerCase() + ".", "");
      return;
    }
    if (job.expiredAt * 1000 <= Date.now()) {
      rememberFunding(null);
      throw new Error("This unfunded job expired. Create a new job to continue.");
    }
    var budget = Number(job.budget) || funding.budget;
    await loadJob(id);
    try {
      await prepareFunds(budget, funding.account, slot);
      if (Number(job.budget) === 0) {
        setStatus(slot, "Setting the budget on job #" + id + ".", "");
        await send(await prepare({ action: "setBudget", jobId: id, budget: budget }), slot, funding.account);
      }
      setStatus(slot, "Funding escrow on job #" + id + ".", "");
      await send(await prepare({ action: "fund", jobId: id, budget: budget }), slot, funding.account);
      rememberFunding(null);
      setStatus(slot, "Job #" + id + " is funded from your wallet.", "ok");
    } catch (err) {
      throw new Error(explain(err) + " Use Resume funding to continue this job.");
    } finally {
      // Keep the existing job reachable even when a later signature is cancelled.
      await loadJob(id);
      await refreshBoard();
    }
  }

  async function refreshBoard() {
    if (!cfg.configured) {
      $("board").innerHTML = '<p class="hint">Wallet payments are currently unavailable.</p>';
      return;
    }
    var body = await api("/chain/board");
    var jobs = body.jobs || [];
    if (!jobs.length) {
      $("board").innerHTML = '<p class="hint">No jobs yet. Fund a job to get started.</p>';
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
    syncControls();
  }

  function run(task, statusId) {
    if (state.busy) return Promise.resolve();
    state.busy = true;
    var focusId = "";
    syncControls();
    return Promise.resolve()
      .then(task)
      .catch(function (err) {
        focusId = err.fieldId || "";
        setStatus(statusId || "wallet-status", explain(err), "bad");
      })
      .then(function () {
        state.busy = false;
        syncControls();
        if (focusId && $(focusId)) $(focusId).focus();
        if (state.refreshQueued) queueRefresh();
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
      var account = state.account;
      await ensureChain();
      requireAccount(account);
      await send(await prepare({ action: "mint", account: account }), "wallet-status", account);
      await refreshAccount();
      setStatus("wallet-status", "Added 1,000 test dUSD.", "ok");
    }, "wallet-status");
  });
  $("fill-worker").addEventListener("click", function () {
    if (!state.account) {
      setStatus("open-status", "Connect the worker wallet first.", "bad");
      return;
    }
    $("worker").value = state.account;
    clearFieldError("worker");
    setStatus("open-status", "Worker address saved. Now connect the buyer wallet before funding.", "");
  });
  ["description", "worker", "budget"].forEach(function (id) {
    $(id).addEventListener("input", function () {
      clearFieldError(id);
      setStatus("open-status", "", "");
    });
  });
  if ($("sample-brief")) $("sample-brief").addEventListener("click", function () {
    $("description").value = "Summarize the project in five bullet points, including the main benefit, intended users, and next steps.";
    clearFieldError("description");
    setStatus("open-status", "Sample brief added. You can edit it before funding.", "");
    $("description").focus();
  });
  $("open-job").addEventListener("click", function () {
    run(async function () {
      if (!state.funding) validateJob();
      if (!state.account) await connect();
      await openJob();
    }, "open-status");
  });

  refreshBoard().catch(function (err) {
    $("board").textContent = "Couldn’t load jobs. Refresh to retry.";
  });

  async function restore() {
    try {
      var mod = await import("/vendor/metamask-connect.js");
      var session = await mod.restoreQrSession(qrOptions());
      if (state.provider) return;
      if (session && session.accounts && session.accounts[0]) {
        adoptSession(session.accounts, session.provider);
        showDesk(false);
        queueRefresh();
        return;
      }
    } catch (err) {
      void err;
    }
    var provider = injectedProvider();
    if (!provider) return;
    try {
      var accounts = await provider.request({ method: "eth_accounts" });
      if (state.provider) return;
      if (!accounts || !accounts[0]) return;
      adoptSession(accounts, provider);
      showDesk(false);
      queueRefresh();
    } catch (err) {
      void err;
    }
  }
  syncControls();
  if (cfg.configured) restore();

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
