# C3 — Spec & weekend plan
**Event:** ETHGlobal Tokyo 2026  
**Headline:** Agent key revoke/rotate lifecycle; **rebind** = fresh World ID for Agents auth  
**Primary prize:** Best Use of World ID for Agents ($5k) — `sandbox.auth.world.org` + AgentPlugin  
**Updated:** 2026-09-26 ~08:13 JST · §8 locked · World surface retargeted to track quals

---

## 1. Problem (judge must feel)

Compromised agent keys keep working after a cosmetic “revoke.” Operators need mid-loop **deny** and **rotate**, and rotate must require a **fresh human verification** via official **World ID for Agents** — not a login sticker, not free-trial.

**Honesty:** App-layer deny/rotate registry is the product policy layer. Prize integration is World ID for Agents on the event **dev** env. Do not claim a mainnet AgentBook opcode. Cite agentkit #37/#23 only as motivation for why revoke/rotate matters.

---

## 2. Product one-liner

After compromise or rotate, the old agent key fails mid-loop; the new key gains paid capability only after a **backend-validated World ID for Agents** journey (request → human completes → validated result). Denied/expired/cancelled → no grant. Foil = revoke theater (still grants).

---

## 3. Architecture

```
[Agent key] --sign--> [Paygate grant]
                         |
                         v
                  [App registry] register|lookup|revoke|rotate
                         |
              Day1+: enforce revoked + mid-loop check
              Day2+: rotate/rebind → World ID for Agents (sandbox)
                     backend validates → then grant
```

| Component | Role |
|-----------|------|
| App registry | register · lookup · revoke · rotate |
| Paygate | grant only if not revoked (+ Day2 rebind proof) |
| Foil mode | Day 0: ignores revoke |
| Win mode | Day 1: revoke enforced mid-loop |
| World surface | Day 2: **sandbox.auth.world.org** World ID for Agents / AgentPlugin for rebind |

---

## 4. Prize qualification checklist (Day 2 must hit)

| # | Requirement | How we show it |
|---|-------------|----------------|
| Q1 | Official World ID for Agents on **dev** env | Integrate `sandbox.auth.world.org` (+ AgentPlugin as needed) |
| Q2 | Complete journey | Request → user completes → backend validates → protected grant |
| Q3 | Unsuccessful path | Denied/expired/cancelled → protected action does **not** occur |
| Q4 | Secure backend validation | Never treat raw client response as auth; no exposed client secrets |
| Q5 | Integration debrief | Short note: time-to-first-success, friction, missing docs, #1 improvement |
| Q6 | Not login-only | Rebind gates **mid-loop paid/agent action**, not app login |

Mocks OK if event says proofs are mocked — still run full journey + fail path.

---

## 5. Demo film (90s)

| Beat | Judge sees | Pass |
|------|------------|------|
| 1 Setup | Register K; grant OK | Live |
| 2 Foil | revoke(K); K still grants | REVOKE_INEFFECTIVE |
| 3 Win revoke | Mid-loop deny; K rejected | Old key dead |
| 4 Rotate | K→K2 without World rebind → fail | Bind required |
| 5 World | Sandbox journey success → K2 grants | Q2 |
| 6 Fail | Deny/expire/cancel → no grant | Q3 |
| 7 Mute-World | Skip validation → win fails | M4 / slate |

---

## 6. Mute tests

| # | Mute | Expected fail |
|---|------|---------------|
| M1 | Deny-list off | Revoked K still grants |
| M2 | No rebind on rotate | K2 grants without World |
| M3 | Session-start only | Revoke after start still grants |
| M4 | Mute World / skip backend validate | Win grants anyway → **slate fail** |

---

## 7. Build / not build

**Build:** registry · paygate · foil · mid-loop revoke · sandbox World ID for Agents rebind · fail path · backend validation · debrief · 90s film  

**Do not build:** mainnet AgentBook opcode · free-trial AgentKit win · World-as-login · C1 claim headline · Alice≠Bob · Intercepta/observatory · Mandate402 · passport

---

## 8. Weekend shape

### Day 0 — Foil ✅
- [x] Registry + paygate ignores revoke
- [x] `npm run foil-revoke` → REVOKE_INEFFECTIVE
- [x] SPEC / slate / HANDOFF

### Day 1 — Enforce lifecycle ✅
- [x] Grant rejects if revoked (every request)
- [x] Rotate without rebind: K2 cannot grant
- [x] FOIL_MODE kept for A/B
- [x] `npm run win-revoke` + DAY1-COMPLETION

### Day 2 — World ID for Agents (track)
- [x] Journey states + fail path + server-side validation (local IdP double)
- [x] INTEGRATION-DEBRIEF.md (Q5)
- [x] Mute-World: a client "validated" claim does not grant
- [ ] Live portal client on sandbox.auth.world.org (needs WORLD_CLIENT_ID / WORLD_CLIENT_SECRET)
- [ ] 90s cut

---

## 9. Kill criteria

- Win works with World muted / without backend validation  
- Revoke UI-only  
- Sold as on-chain AgentBook fix  
- Win = login or free-trial  
- No unsuccessful path filmed  

---

## 10. Links (track)

- Docs: http://sandbox.auth.world.org/docs  
- Portal: http://sandbox.auth.world.org/portal  
- AgentPlugin: https://github.com/worldcoin/world-id-agent-plugin  

---

## 11. Repo layout (target)

```
src/registry.ts
src/paygate.ts
src/server.ts
src/world-rebind.ts   # Day 2 sandbox validate
scripts/foil-revoke.ts
scripts/win-revoke.ts
SPEC.md
HANDOFF.md
FULL_AGENT_HANDOFF.md
docs/confirmation-slate-c3.md
INTEGRATION-DEBRIEF.md  # Day 2
```
