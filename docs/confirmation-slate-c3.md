# Confirmation slate — C3 (DRAFT for Hong §8)
**Event:** ETHGlobal Tokyo 2026  
**Updated:** 2026-09-26 ~07:35 JST  
**Pivot:** Hong switched headline from C1 → **C3** (World ID for agents / AgentBook lifecycle)

---

## 0. Locked constraints
| Field | Value |
|-------|--------|
| Primary prize lens | **World ID for agents** (AgentKit + AgentBook); IDKit secondary only if a real human step appears |
| Must bases | x402 + AgentKit |
| Domain shortlist | code / devtools · research |
| Buyer | integrator / security |
| Hard nos | passport · thin market · World-as-login · free-trial/discount · Mandate402 reskin · Intercepta/observatory wrap · Alice≠Bob as headline · claiming on-chain AgentBook opcode |

---

## 1. Headline spine — PROPOSED
| Choose | ID | Gap | Stress |
|--------|----|-----|--------|
| ☐ | C1 | Pre-grant `(pay_id × resource)` claim + atomic CAIP-122 | WEAK–PASS — archived foil only |
| ☐ | C2 | Unresolved settle → refuse re-auth (+ HITL) | PASS — not headline |
| ☑ | **C3** | **AgentBook revoke / rotate as sign-capability lifecycle** | **PASS** |

**One-liner:** After compromise or rotate, the agent’s old signing key must fail mid-loop; win path re-binds capability only under a fresh World/AgentBook-backed proof. Naive foil keeps granting with the revoked key.

**Foil legs:** C1 DGR fixture stays in repo as archive, not pitch.

**Why this bind:** AgentBook today has no revoke; `lookupHuman` can still succeed for compromised wallets (worldcoin/agentkit #37 RFC, #23 unregister block). Product is **app-layer** deny-list / rotation registry composed with AgentKit — honest about not shipping a mainnet opcode.

---

## 2. World surface — PROPOSED
| Choose | Surface |
|--------|---------|
| ☑ | **AgentBook revoke / rotate lifecycle** (primary) |
| ☐ | HITL on payment intent (C2 — out) |
| ☐ | CAIP-122 atomic consume as sole headline (C1 — out; may still appear as helper) |

**Mute-World expected fail:** rotated / new key never gains paid capability; or old key still passes after “revoke.”

**Hard-no guard:** do not sell as “we patched AgentBook on-chain”; no World-as-login; no free-trial burn.

---

## 3. Demo film (draft)
| Beat | Judge sees | Pass if |
|------|------------|---------|
| 1 Setup | Agent has World-backed sign capability bound to a paid resource path | Fixture live |
| 2 Naive foil | Key marked compromised / “revoked” in UI but server still accepts signatures → grant continues | Revoke theater visible |
| 3 Rotate | Operator rotates to new agent key; without World re-bind, new key cannot grant | Rotate without World fails |
| 4 Win | Fresh World/AgentBook-backed re-bind → new key grants; old key rejected mid-loop | Lifecycle holds |
| 5 Mute-World | Skip World re-bind step → win path still grants with rotated key | **slate fail if this works** |

**Owned fixture:** ☑ yes — AgentBook-shaped registry stub + paygate that checks app deny/rotate list (real AgentKit calls where weekend allows; stub honest when RPC flaky)

---

## 4. Mute tests
| # | Mute | Expected fail |
|---|------|---------------|
| M1 | Mute revoke policy (deny-list off) | Old compromised key still grants |
| M2 | Mute rotate re-bind | New key never usable / or old+new both work wrongly |
| M3 | Mute mid-loop check (check only at session start) | Revoke after start still grants |
| M4 | Mute World / skip fresh proof on re-bind | Win path grants anyway → **slate fail** |

---

## 5. Building / not building
**Building:** app-layer AgentBook-shaped registry (register · revoke · rotate · lookup) · paygate that consults it on grant · foil that ignores revoke · World/AgentKit re-bind on rotate · 90s film  

**Not building:** mainnet AgentBook opcode · free-trial win · C1 claim as headline · Alice≠Bob · Intercepta/observatory · Mandate402 · passport · World-as-login

---

## 6. Thin-build kill list
- Win works with World muted → kill
- “Revoke” is a UI toggle only, server never checks → kill
- Sold as on-chain AgentBook fix → kill
- Win = login / free-trial → kill
- No mid-loop deny (session cookie forever) → kill

---

## 7. Weekend shape
| Day | Outcome |
|-----|---------|
| 0 | Foil: revoke theater / no mid-loop deny — old key still grants |
| 1 | App revoke + rotate registry; old key dies mid-loop; rotate needs re-bind |
| 2 | World/AgentKit fresh proof on re-bind + mute film + 90s cut |

---

## 8. Confirm (Hong) — blank until you say yes
| Question | Answer |
|----------|--------|
| Spine locked C3? | ☐ yes · ☐ overturn |
| World surface = AgentBook revoke/rotate? | ☐ yes · ☐ edit |
| Fixture = owned AgentBook-shaped stub + paygate? | ☐ yes · ☐ edit |
| Mutes M1–M4 shame-checked? | ☐ yes · ☐ edit |
| Ready to build Day 0? | ☐ yes · ☐ hold |

**Hong sign-off:** _______________ · date _______________
