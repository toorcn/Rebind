# C3 — Spec & weekend plan
**Event:** ETHGlobal Tokyo 2026  
**Headline:** AgentBook revoke / rotate as sign-capability lifecycle (app-layer honest)  
**Primary prize:** World ID for agents (AgentKit + AgentBook)  
**Updated:** 2026-09-26 JST · §8 locked by Hong

---

## 1. Problem (judge must feel)

World AgentBook today has **no revoke**. A compromised agent wallet can still resolve via `lookupHuman`. Operators need mid-loop **deny** and **rotate** that actually bind to paid capability — not a UI toggle.

**Evidence (cite, don’t overclaim):** worldcoin/agentkit #37 RFC (revoke), #23 unregister block; SDK null for both unregistered and RPC failure. Weekend ships **app-layer** deny/rotate registry composed with AgentKit — **not** a mainnet AgentBook opcode.

---

## 2. Product one-liner

After compromise or rotate, the agent’s **old signing key fails mid-loop**; the win path re-binds capability only under a **fresh World/AgentBook-backed proof**. Naive foil keeps granting with the revoked key.

---

## 3. Architecture

```
[Agent key K] --sign--> [Paygate grant]
                           |
                           v
                    [App registry]
                    register | lookup | revoke | rotate
                           |
              Day1+: enforce revoked=false + mid-loop check
              Day2+: rotate → require World re-bind before K2 grants
```

| Component | Role |
|-----------|------|
| `AgentBookRegistry` | In-memory/sqlite: register, lookup, revoke(flag), rotate(old→new) |
| `Paygate` | Express paid resource; checks registry on every grant |
| `Foil mode` | Day 0: lookup ignores `revoked` (or session-start only) |
| `Win mode` | Day 1+: deny if revoked; mid-loop re-check; Day 2 World re-bind on rotate |
| World surface | Fresh AgentKit/AgentBook-backed proof gates re-bind (not login, not free-trial) |

---

## 4. Demo film (90s target)

| Beat | What judges see | Pass |
|------|-----------------|------|
| 1 Setup | Register K; grant succeeds | Live |
| 2 Foil | `revoke(K)`; same K still grants | REVOKE_INEFFECTIVE |
| 3 Win revoke | Mid-loop deny; K rejected | Old key dead |
| 4 Rotate | K→K2 without World re-bind → fail | Bind required |
| 5 World | Fresh proof → K2 grants; mute World → still fails | World load-bearing |

---

## 5. Mute tests (must break win)

| # | Mute | Expected fail |
|---|------|---------------|
| M1 | Deny-list off | Revoked K still grants |
| M2 | No re-bind on rotate | K2 grants without World / or K+K2 both wrong |
| M3 | Session-start check only | Revoke after start still grants |
| M4 | Skip World on re-bind | Win path grants anyway → **slate fail** |

---

## 6. Build / not build

**Build:** app registry · paygate · foil · mid-loop revoke · World-gated rotate re-bind · mute film · README honesty  

**Do not build:** mainnet AgentBook opcode · free-trial win · World-as-login · C1 claim as headline · Alice≠Bob · Intercepta/observatory · Mandate402 · passport

---

## 7. Weekend plan

### Day 0 — Foil (DONE)

- [x] Registry API with revoke flag that UI can show
- [x] Paygate that **does not** enforce revoke on grant
- [x] `npm run foil-revoke` exits 0 → `REVOKE_INEFFECTIVE`
- [x] README + DAY0-COMPLETION.md
- [x] Commit main

### Day 1 — Enforce lifecycle
- [ ] Grant path: reject if `revoked`
- [ ] Mid-loop / every-request check (not session cookie forever)
- [ ] Rotate without re-bind: K2 cannot grant; K cannot grant
- [ ] Foil mode flag kept for A/B film
- [ ] Script: foil fails, win passes

### Day 2 — World principal + cut
- [ ] Re-bind requires fresh World/AgentKit-backed proof (stub→real as time allows)
- [ ] Mute-World film (M4)
- [ ] 90s demo cut + one-pager for judges

---

## 8. Success / kill

**Ship if:** mute M4 fails the win; film shows foil vs win; docs honest about app-layer.  

**Kill if:** win works with World muted; revoke is UI-only; sold as on-chain AgentBook fix; win = login/free-trial.

---

## 9. Repo layout (as built, Day 0)

```
src/registry.ts      # AgentBook-shaped store
src/app.ts           # paygate grant path + registry HTTP (foil ignores revoke)
src/server.ts        # wire registry + paygate
src/sign.ts          # stub sign/verify (not a wallet, not AgentKit)
src/foil-revoke.ts   # npm run foil-revoke
README.md
DAY0-COMPLETION.md
SPEC.md              # this document
docs/confirmation-slate-c3.md
```

Day 0 does not call World ID, IDKit, or live AgentKit.

---

## 10. Constraints reminder

Must bases: **x402 + AgentKit**. Buyer: integrator/security. Domain: code/devtools · research. Primary: **World ID for agents**.
