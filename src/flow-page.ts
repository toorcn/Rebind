export function renderFlowPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Rebind — watch the settlement</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font: 16px/1.45 ui-sans-serif, system-ui, sans-serif;
      background: #12140f;
      color: #f4f1e8;
    }
    main { max-width: 1080px; margin: 0 auto; padding: 22px 18px 28px; }
    .kicker {
      margin: 0;
      font-size: 12px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #b7b2a6;
    }
    .kicker a { color: #e3b341; text-decoration: none; }
    h1 {
      margin: 8px 0 0;
      font-family: Palatino, Georgia, serif;
      font-weight: 500;
      font-size: clamp(1.7rem, 4vw, 2.5rem);
      line-height: 1.05;
      letter-spacing: -0.03em;
    }
    .lead { margin: 8px 0 0; color: #d9d3c5; max-width: 42rem; min-height: 3.2em; }
    .stage {
      margin-top: 16px;
      display: grid;
      grid-template-columns: 1.15fr 0.85fr;
      gap: 12px;
    }
    .panel {
      background: #181b15;
      border: 1px solid #2c3128;
      border-radius: 18px;
      padding: 14px 14px 16px;
      min-height: 320px;
    }
    .tag {
      margin: 0;
      font-size: 11px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #b7b2a6;
    }
    .humans { display: flex; gap: 18px; margin-top: 12px; min-height: 78px; }
    .human { margin: 0; text-align: center; width: 84px; }
    .human i {
      display: block;
      width: 36px;
      height: 36px;
      margin: 0 auto 6px;
      border-radius: 50%;
      background: #e3b341;
      box-shadow: 0 18px 0 -8px #3a4034;
    }
    .human figcaption { font-size: 12px; color: #d9d3c5; }
    .human.b { opacity: 0; transform: translateX(16px); transition: opacity 0.45s ease, transform 0.45s ease; }
    .stage[data-humans="2"] .human.b { opacity: 1; transform: none; }
    .human.b i { background: #8fdf7a; }
    .agents { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; position: relative; }
    .agents article {
      border: 1px solid #2c3128;
      border-radius: 12px;
      padding: 10px;
      min-height: 92px;
    }
    .agents h2 { margin: 0; font-size: 0.95rem; font-weight: 650; }
    .agents p { margin: 4px 0 0; color: #b7b2a6; font-size: 0.85rem; }
    .agents code {
      display: block;
      margin-top: 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.78rem;
      color: #8d887c;
    }
    .stage[data-match="same"] .agents code { color: #ff8d8d; }
    .stage[data-match="differ"] .agents article.buyer code { color: #8fdf7a; }
    .stage[data-match="differ"] .agents article.worker code { color: #ffb4b4; }
    .slip {
      position: absolute;
      left: 8%;
      right: 8%;
      top: 18px;
      border: 1px dashed #e3b341;
      border-radius: 12px;
      background: #2a2618;
      padding: 10px 12px;
      opacity: 0;
      transform: translateY(-8px) rotate(-2deg);
      pointer-events: none;
      transition: opacity 0.35s ease, transform 0.35s ease;
    }
    .stage[data-slip="on"] .slip { opacity: 1; transform: none; }
    .slip strong { display: block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.82rem; }
    .slip em {
      display: inline-block;
      margin-top: 4px;
      font-style: normal;
      font-size: 12px;
      letter-spacing: 0.12em;
      font-weight: 800;
      color: #ff8d8d;
      opacity: 0;
    }
    .stage[data-slip="on"] .slip em { opacity: 1; transition: opacity 0.3s ease 0.35s; }
    .track { position: relative; display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 14px; height: 78px; }
    .track span {
      align-self: start;
      text-align: center;
      color: #8d887c;
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .puck, .chip {
      position: absolute;
      top: 28px;
      width: 84px;
      margin-left: -42px;
      text-align: center;
      border-radius: 999px;
      padding: 6px 0;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
      transition: left 0.65s cubic-bezier(.2,.7,.2,1), opacity 0.3s ease, background 0.3s ease, color 0.3s ease;
    }
    .puck { background: #e3b341; color: #12140f; }
    .chip { background: #24301f; color: #8fdf7a; border: 1px solid #3d5a32; }
    .stage[data-puck="none"] .puck { opacity: 0; left: 16%; }
    .stage[data-puck="buyer"] .puck { left: 16%; }
    .stage[data-puck="vault"] .puck { left: 50%; }
    .stage[data-puck="worker"] .puck { left: 84%; }
    .stage[data-chip="none"] .chip { opacity: 0; left: 16%; }
    .stage[data-chip="client"] .chip { left: 16%; }
    .stage[data-chip="acp"] .chip { left: 50%; background: #e3b341; color: #12140f; border-color: #e3b341; }
    .stage[data-chip="provider"] .chip { left: 84%; }
    .meters { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 8px; }
    .meters div { background: #12140f; border-radius: 10px; padding: 8px; }
    .meters span { display: block; color: #8d887c; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; }
    .meters strong { font-family: Palatino, Georgia, serif; font-size: 1.35rem; font-weight: 500; }
    .meters .paid strong { color: #8fdf7a; }
    .meters .refused strong { color: #ff8d8d; }
    dl { display: grid; gap: 6px; margin: 12px 0 0; }
    dl div { display: flex; justify-content: space-between; gap: 12px; border-top: 1px solid #2c3128; padding-top: 6px; }
    dt { color: #8d887c; }
    dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
    .stage[data-verdict="revert"] dd.verdict { color: #ff8d8d; font-weight: 750; }
    .stage[data-verdict="paid"] dd.verdict { color: #8fdf7a; font-weight: 750; }
    .stage[data-verdict="refund"] dd.verdict { color: #e3b341; font-weight: 750; }
    .stage[data-verdict="revert"] .panel.chain { animation: shake 0.45s linear; }
    @keyframes shake {
      20% { transform: translateX(-3px); }
      40% { transform: translateX(3px); }
      60% { transform: translateX(-2px); }
      80% { transform: translateX(2px); }
    }
    .log {
      list-style: none;
      margin: 12px 0 0;
      padding: 10px 12px;
      min-height: 132px;
      max-height: 168px;
      overflow: auto;
      background: #0e100c;
      border: 1px solid #2c3128;
      border-radius: 14px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12.5px;
      line-height: 1.45;
    }
    .log li { display: grid; grid-template-columns: 4.2rem 1fr; gap: 8px; padding: 3px 0; }
    .log b { color: #e3b341; font-weight: 700; }
    .log li.chain b { color: #8fdf7a; }
    .transport { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
    button, a.back {
      font: inherit;
      cursor: pointer;
      border-radius: 999px;
      padding: 10px 16px;
      text-decoration: none;
      border: 1px solid #3a4034;
      background: transparent;
      color: #f4f1e8;
    }
    button.primary { background: #e3b341; color: #12140f; border-color: #e3b341; font-weight: 750; }
    .dots { display: flex; gap: 6px; margin-left: auto; }
    .dots button { width: 28px; height: 28px; padding: 0; border-radius: 50%; }
    .dots button.on { background: #e3b341; color: #12140f; border-color: #e3b341; }
    .aside { margin: 10px 0 0; color: #8d887c; font-size: 0.9rem; }
    a { color: #e3b341; }
    @media (max-width: 800px) {
      .stage, .meters, .agents { grid-template-columns: 1fr; }
      .dots { margin-left: 0; width: 100%; }
      .lead { min-height: 0; }
      .panel { min-height: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    }
  </style>
</head>
<body>
  <main>
    <p class="kicker"><a href="/">Pool</a> · watch the flow · <span id="count">1 / 8</span></p>
    <h1 id="title">One phone, two agents</h1>
    <p class="lead" id="lead"></p>
    <div class="stage" id="stage" data-puck="none" data-chip="none" data-humans="1" data-verdict="idle" data-slip="off" data-match="none">
      <section class="panel" aria-label="The pool">
        <p class="tag">The pool · credits</p>
        <div class="humans">
          <figure class="human a"><i></i><figcaption>One person</figcaption></figure>
          <figure class="human b"><i></i><figcaption>Second person</figcaption></figure>
        </div>
        <div class="agents">
          <article class="buyer"><h2>Buyer agent</h2><p id="buyer-line">No proof yet</p><code id="buyer-sub">—</code></article>
          <article class="worker"><h2>Worker agent</h2><p id="worker-line">No proof yet</p><code id="worker-sub">—</code></article>
          <div class="slip"><strong>differentHumans: true</strong><em>CLAIM IGNORED</em></div>
        </div>
        <div class="track" aria-hidden="true">
          <span>Buyer</span><span>Escrow</span><span>Worker</span>
          <i class="puck">40</i>
        </div>
        <div class="meters">
          <div><span>Escrow</span><strong id="escrow">0</strong></div>
          <div class="paid"><span>Paid</span><strong id="paid">0</strong></div>
          <div class="refused"><span>Refused</span><strong id="refused">0</strong></div>
          <div><span>Counted</span><strong id="counted">0</strong></div>
        </div>
      </section>
      <section class="panel chain" aria-label="The chain">
        <p class="tag">World Chain Sepolia · ERC-8183</p>
        <div class="track" aria-hidden="true">
          <span>Client</span><span>ACP</span><span>Provider</span>
          <i class="chip">40 dUSD</i>
        </div>
        <dl>
          <div><dt>Job</dt><dd id="job">—</dd></div>
          <div><dt>Status</dt><dd id="status">—</dd></div>
          <div><dt>Call</dt><dd id="call">—</dd></div>
          <div><dt>Hook</dt><dd class="verdict" id="verdict">—</dd></div>
        </dl>
      </section>
    </div>
    <ol class="log" id="log" aria-live="polite"></ol>
    <div class="transport">
      <button id="prev" type="button">Back</button>
      <button id="play" class="primary" type="button">Play the flow</button>
      <button id="next" type="button">Next</button>
      <div class="dots" id="dots"></div>
    </div>
    <p class="aside">This page only plays the story. It does not escrow credits or send a transaction. The working pool is <a href="/">here</a>.</p>
  </main>
  <script>
    var SAME = "0x60ef…7643";
    var SECOND = "0x4674…545d";
    var beats = [
      {
        title: "One phone, two agents",
        lead: "The buyer agent and the worker agent can both belong to the same person. Finishing the job is not the same as getting paid.",
        escrow: 0, paid: 0, refused: 0, counted: 0,
        puck: "none", chip: "none", humans: "1", verdict: "idle", slip: "off", match: "none",
        buyerLine: "No proof yet", workerLine: "No proof yet", buyerSub: "—", workerSub: "—",
        job: "—", status: "No job yet", call: "—", hook: "—",
        log: []
      },
      {
        title: "Escrow is not revenue",
        lead: "The buyer posts “Summarize the Tokyo briefing” for 40. The credits sit in the pool. On chain, fund() pulls 40 dUSD into the ACP job.",
        escrow: 40, paid: 0, refused: 0, counted: 0,
        puck: "vault", chip: "acp", humans: "1", verdict: "locked", slip: "off", match: "none",
        buyerLine: "Posted the job", workerLine: "Has not delivered", buyerSub: "—", workerSub: "—",
        job: "#1", status: "Funded", call: "fund()", hook: "Not consulted",
        log: [
          ["POOL", "post “Summarize the Tokyo briefing”  reward 40  escrow 40  paid 0"],
          ["CHAIN", "job #1  fund()  40 dUSD locked in ACP  status Funded"]
        ]
      },
      {
        title: "The work can finish unpaid",
        lead: "The worker delivers. The pool still has not paid. On chain the job moves to Submitted, and the 40 dUSD does not move.",
        escrow: 40, paid: 0, refused: 0, counted: 0,
        puck: "vault", chip: "acp", humans: "1", verdict: "locked", slip: "off", match: "none",
        buyerLine: "Waiting for a human", workerLine: "Delivered", buyerSub: "—", workerSub: "—",
        job: "#1", status: "Submitted", call: "submit()", hook: "Not consulted",
        log: [
          ["POOL", "deliver “Five bullets, ready.”  reason awaiting-both  paid 0"],
          ["CHAIN", "submit()  status Submitted  escrow unchanged"]
        ]
      },
      {
        title: "The client cannot vouch for itself",
        lead: "The request says the humans differ and includes two subject ids. The pool does not read those fields. The chain has no field for them either.",
        escrow: 40, paid: 0, refused: 0, counted: 0,
        puck: "vault", chip: "acp", humans: "1", verdict: "locked", slip: "on", match: "none",
        buyerLine: "Claim ignored", workerLine: "Delivered", buyerSub: "—", workerSub: "—",
        job: "#1", status: "Submitted", call: "—", hook: "No client story arrives",
        log: [
          ["POOL", "claim ignored  fields differentHumans, buyerSubject, workerSubject"],
          ["CHAIN", "no transaction  the hook never sees the body"]
        ]
      },
      {
        title: "One World ID on both seats",
        lead: "Each side finishes a sandbox check. The issuer is sandbox.auth.world.org. The pairwise subject is sub_one_phone, so both registry entries are the same hash.",
        escrow: 40, paid: 0, refused: 40, counted: 0,
        puck: "vault", chip: "acp", humans: "1", verdict: "locked", slip: "off", match: "same",
        buyerLine: "sub_one_phone", workerLine: "sub_one_phone", buyerSub: SAME, workerSub: SAME,
        job: "#1", status: "Submitted", call: "register()", hook: "Subjects match",
        log: [
          ["POOL", "buyer = worker = sub_one_phone  issuer sandbox.auth.world.org  reason same-human"],
          ["CHAIN", "registry[client] = registry[provider] = 0x60ef455a…7643"]
        ]
      },
      {
        title: "complete() reverts",
        lead: "The evaluator calls complete(). TwoHumansHook reads the two subjects, they match, and the call reverts with SameHuman. The mined transaction fails. Escrow stays.",
        escrow: 40, paid: 0, refused: 40, counted: 0,
        puck: "vault", chip: "acp", humans: "1", verdict: "revert", slip: "off", match: "same",
        buyerLine: "sub_one_phone", workerLine: "sub_one_phone", buyerSub: SAME, workerSub: SAME,
        job: "#1", status: "Submitted", call: "complete()", hook: "revert SameHuman",
        log: [
          ["POOL", "released false  counted false  escrow 40  refused 40"],
          ["CHAIN", "complete() revert SameHuman(0x60ef…7643)  tx status failed"]
        ]
      },
      {
        title: "The funds are not hostage",
        lead: "claimRefund is not hookable. After expiry the 40 dUSD returns to the buyer. The pool still holds its credits, marked refused. Neither side counts a sale.",
        escrow: 40, paid: 0, refused: 40, counted: 0,
        puck: "vault", chip: "client", humans: "1", verdict: "refund", slip: "off", match: "same",
        buyerLine: "sub_one_phone", workerLine: "sub_one_phone", buyerSub: SAME, workerSub: SAME,
        job: "#1", status: "Expired", call: "claimRefund()", hook: "Cannot block the refund",
        log: [
          ["POOL", "escrow 40  refused 40  sale not counted"],
          ["CHAIN", "claimRefund()  40 dUSD back to the client"]
        ]
      },
      {
        title: "A second human releases the same delivery",
        lead: "Someone else approves the buyer. The subjects differ, so 40 credits leave escrow and count. On chain that is a new job: complete() emits DistinctHumans and pays the worker.",
        escrow: 0, paid: 40, refused: 0, counted: 40,
        puck: "worker", chip: "provider", humans: "2", verdict: "paid", slip: "off", match: "differ",
        buyerLine: "sub_second_human", workerLine: "sub_one_phone", buyerSub: SECOND, workerSub: SAME,
        job: "#2", status: "Completed", call: "complete()", hook: "DistinctHumans",
        log: [
          ["POOL", "buyer sub_second_human  worker sub_one_phone  reason released  paid 40  counted 40"],
          ["CHAIN", "complete() DistinctHumans  provider paid 40 dUSD  status Completed"]
        ]
      }
    ];

    var index = 0;
    var timer = null;
    var stage = document.getElementById("stage");
    var play = document.getElementById("play");
    var dots = document.getElementById("dots");

    beats.forEach(function (_beat, i) {
      var dot = document.createElement("button");
      dot.type = "button";
      dot.textContent = String(i + 1);
      dot.addEventListener("click", function () {
        pause();
        show(i);
      });
      dots.appendChild(dot);
    });

    function show(next) {
      index = next;
      var beat = beats[index];
      document.getElementById("title").textContent = beat.title;
      document.getElementById("lead").textContent = beat.lead;
      document.getElementById("count").textContent = (index + 1) + " / " + beats.length;
      document.getElementById("escrow").textContent = String(beat.escrow);
      document.getElementById("paid").textContent = String(beat.paid);
      document.getElementById("refused").textContent = String(beat.refused);
      document.getElementById("counted").textContent = String(beat.counted);
      document.getElementById("buyer-line").textContent = beat.buyerLine;
      document.getElementById("worker-line").textContent = beat.workerLine;
      document.getElementById("buyer-sub").textContent = beat.buyerSub;
      document.getElementById("worker-sub").textContent = beat.workerSub;
      document.getElementById("job").textContent = beat.job;
      document.getElementById("status").textContent = beat.status;
      document.getElementById("call").textContent = beat.call;
      document.getElementById("verdict").textContent = beat.hook;
      stage.setAttribute("data-puck", beat.puck);
      stage.setAttribute("data-chip", beat.chip);
      stage.setAttribute("data-humans", beat.humans);
      stage.setAttribute("data-verdict", beat.verdict);
      stage.setAttribute("data-slip", beat.slip);
      stage.setAttribute("data-match", beat.match);
      var log = document.getElementById("log");
      log.replaceChildren();
      for (var i = 0; i <= index; i += 1) {
        beats[i].log.forEach(function (row) {
          var item = document.createElement("li");
          if (row[0] === "CHAIN") item.className = "chain";
          var mark = document.createElement("b");
          var text = document.createElement("span");
          mark.textContent = row[0];
          text.textContent = row[1];
          item.append(mark, text);
          log.appendChild(item);
        });
      }
      log.scrollTop = log.scrollHeight;
      Array.prototype.forEach.call(dots.children, function (dot, i) {
        dot.className = i === index ? "on" : "";
      });
      play.textContent = timer ? "Pause" : (index === beats.length - 1 ? "Replay" : "Play the flow");
    }

    function tick() {
      if (index >= beats.length - 1) {
        pause();
        return;
      }
      show(index + 1);
    }

    function pause() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      play.textContent = index === beats.length - 1 ? "Replay" : "Play the flow";
    }

    function start() {
      if (index === beats.length - 1) show(0);
      pause();
      timer = setInterval(tick, 5600);
      play.textContent = "Pause";
    }

    play.addEventListener("click", function () {
      if (timer) pause();
      else start();
    });
    document.getElementById("next").addEventListener("click", function () {
      pause();
      show(Math.min(beats.length - 1, index + 1));
    });
    document.getElementById("prev").addEventListener("click", function () {
      pause();
      show(Math.max(0, index - 1));
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "ArrowRight") document.getElementById("next").click();
      if (event.key === "ArrowLeft") document.getElementById("prev").click();
      if (event.key === " " && event.target === document.body) {
        event.preventDefault();
        play.click();
      }
    });
    show(0);
  </script>
</body>
</html>`;
}
