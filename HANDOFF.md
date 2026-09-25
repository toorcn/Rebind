# HANDOFF — ETHGlobal Tokyo 2026 · C3
**For:** any assistant / Hong continuing after this chat  
**Owner:** Hong Bing · Asia/Tokyo  
**Written:** 2026-09-26 ~08:08 JST  
**Agent that wrote this:** Japan Day Trip Event Chaos

---

## 0. Read this first (60 seconds)

| Item | Value |
|------|--------|
| **Headline** | **C3** — AgentBook revoke/rotate as **app-layer** sign-capability lifecycle |
| **Primary prize** | World ID **for agents** (AgentKit + AgentBook). IDKit only if a real human step appears. |
| **Not headline** | C1 (DGR claim) — Day 0 foil exists but **archived**, not pitch. C2 optional. |
| **§8** | Hong said yes on C3 slate ~07:39 JST 2026-09-26 |
| **Build status** | **Day 0 DONE.** Day 1 next. Day 2 World + film. |
| **Honesty** | App-layer stub composed with AgentKit — **do not** claim mainnet AgentBook opcode. Cite agentkit #37 / #23. |

**One-liner:** After compromise/rotate, old agent key fails mid-loop; re-bind only under fresh World/AgentBook-backed proof. Foil = revoke theater (UI says revoked, paygate still grants).

---

## 1. What is done

### Ideation (closed)
- Hard-nos locked: passport, thin market, World-as-login, free-trial/discount, Mandate402, Intercepta/observatory, Alice≠Bob as headline.
- Survivors were C1 (WEAK–PASS), C2 (PASS), C3 (PASS). Hong chose **C3** for World-agents alignment.
- Docs on box: `/workspace/eth-tokyo-deck/` (slate, survivors brief, SPEC, this handoff).

### Day 0 C3 foil — DONE
- **Cloud agent:** `bc-2c9a7746-ac59-5f39-8b9a-beacb11a3704`  
  https://cursor.com/agents/bc-2c9a7746-ac59-5f39-8b9a-beacb11a3704  
- **Repo:** new Origin draft, branch `main` (unpublished until Hong hits Create repo on agent page).  
- **Commit noted:** `af9785f` (SPEC + slate on main; foil also present — verify with agent if needed).  
- **Proof:** `npm run foil-revoke` exits 0 on **REVOKE_INEFFECTIVE**.  
- **Port (agent VM):** `http://127.0.0.1:43210` — run locally from Origin checkout for film.  
- **Docs in repo:** `SPEC.md`, `C3-SPEC-AND-PLAN.md`, `docs/confirmation-slate-c3.md`, README / DAY0-COMPLETION.

### Earlier C1 Day 0 (archive only)
- Agent: `bc-a504c509-e948-512b-94f6-c138d6f51531`  
- Vulnerable paygate DGR=20 — **not** the pitch anymore.

---

## 2. What to do next

### Day 1 (immediate)
1. Reply to **same** cloud agent `bc-2c9a7746-…` (don’t launch a second repo unless Origin draft is lost).
2. Implement **win mode**:
   - Every grant checks `revoked` → reject.
   - Mid-loop / every-request (not session-start-only).
   - Rotate K→K2 without World re-bind → K2 cannot grant; K cannot grant.
   - Keep `FOIL_MODE` (or flag) for A/B film.
3. Scripts: foil still proves REVOKE_INEFFECTIVE; win script proves revoke works + rotate-without-rebind fails.
4. Update SPEC Day 1 checkboxes + DAY1-COMPLETION.md; push `main`.

### Day 2
- World/AgentKit-backed fresh proof gates re-bind (stub→real as time allows).
- Mute M4 film: skip World → win must fail.
- 90s cut + judge one-pager.

### Mute tests (must still hold)
| # | Mute | Fail |
|---|------|------|
| M1 | Deny-list off | Revoked K still grants |
| M2 | No re-bind on rotate | K2 wrong / both wrong |
| M3 | Session-start only | Revoke after start still grants |
| M4 | Mute World on re-bind | Win still grants → **slate fail** |

---

## 3. Hard constraints (do not reopen casually)

**Must bases:** x402 + AgentKit  
**Buyer:** integrator / security  
**Domain:** code/devtools · research  

**Do not build / sell:** mainnet AgentBook opcode · free-trial win · World-as-login · C1 claim as headline · Alice≠Bob · Intercepta/observatory wrap · Mandate402 · passport · payment-identifier-only tutorial as product.

**Kill if:** win works with World muted; revoke is UI-only; sold as on-chain AgentBook fix.

---

## 4. Box artifact paths

| File | Path |
|------|------|
| This handoff | `/workspace/eth-tokyo-deck/HANDOFF.md` (+ PDF sibling if present) |
| C3 slate | `/workspace/eth-tokyo-deck/confirmation-slate-c3.md` / `.pdf` |
| SPEC + plan | `/workspace/eth-tokyo-deck/C3-SPEC-AND-PLAN.md` / `.pdf` |
| Survivors brief | `/workspace/eth-tokyo-deck/survivors-brief.pdf` |
| Old C1 slate | `confirmation-slate-filled.pdf` (superseded) |

Also commit `HANDOFF.md` into the C3 Origin repo root when Day 1 starts.

---

## 5. How to restart tooling

1. Open agent URL above → Create repo if draft needs a stable Origin URL.  
2. Coordinator: use CloudAgent **reply** to `bc-2c9a7746-…` for Day 1 (keeps branch/context).  
3. Code changes: follow Cursor `code-changes` skill — cloud agent only, no local clone unless Hong asks.  
4. User prefs: brief → interview historically; Hong sometimes delegates (“up to you”). Prefer no biased prize picks unless asked. First sentence answers the question.

---

## 6. Memory facts to trust

- Hong §8-yes C3 ~07:39 JST 2026-09-26; Day 0 unlocked then finished.  
- Switched from C1 → C3 for World-agents track alignment.  
- C1 DGR fixture = archive only.

---

## 7. Suggested Day 1 prompt (paste to cloud agent)

```
Day 1 for C3 on this repo. Read SPEC.md.

Add win mode (default): grant rejects if registry.revoked; check every request (mid-loop).
Rotate without worldRebind/freshProof: new key cannot grant; old key cannot grant.
Keep FOIL_MODE=true path so npm run foil-revoke still exits 0 on REVOKE_INEFFECTIVE.
Add npm run win-revoke (or similar) that: register → grant → revoke → grant fails → rotate without rebind → K2 fails → (optional stub) rebind flag → K2 grants.
Update SPEC Day 1 checkboxes + DAY1-COMPLETION.md. Commit + push main.
No live World/IDKit yet unless trivial stub interface for Day 2.
```

---

**End of handoff.** If anything conflicts, prefer: Hong’s latest chat message > SPEC.md in repo > this document > older C1 materials.
