# Rebind — the pool pays two humans

ETHGlobal Tokyo 2026. A buyer agent escrows a reward. A worker agent delivers the job. The credits leave escrow only when the buyer and the worker have each finished a sandbox World ID check, the server has verified both tokens, and the two subject ids differ.

One person can run both agents and finish the work. The payout stays locked, and it does not count. A second person proves the buyer, and the same delivery is paid. A request body that says `differentHumans: true` does not unlock the pool.

```bash
npm i
npm run self-pay
npm run dev
```

Open http://127.0.0.1:43210 . The home page is the wallet desk: connect MetaMask, Rabby, or Coinbase Wallet on World Chain Sepolia, mint DemoUSD, and fund a job from that wallet. A second wallet delivers. Each wallet proves with World App, and the server writes that subject onto the address that signed. Settlement pays two humans and reverts when they are one person. The in-app credit rehearsal is at `/credits`.

`self-pay` prints `SAME_HUMAN`, `CLIENT_CLAIM_IGNORED`, `NOT_A_WORLD_PROOF`, and `PAYOUT_RELEASED`, then `SELF_PAY_PASSED`.

The earlier revoke desk is still at `/desk`. The 90-second cut is at `/film`. The animated settlement, separate from the pool, is at `/flow`.

## On-chain settlement

The same payout rule where settlement lives. `contracts/` is a foundry project with an [ERC-8183](https://eips.ethereum.org/EIPS/eip-8183) hook: `TwoHumansHook.beforeAction` reads the World subject of the job's client and provider from `HumanRegistry` and reverts `complete()` with `SameHuman` when they match, or `Unproven` when either side has none. Escrow locks visibly in `fund()`; settlement is the step that refuses. `claimRefund` is not hookable in ERC-8183, so the buyer recovers the budget after expiry — the sale never counts and nobody's funds are hostage.

```bash
# one-time: install foundry, then inside contracts/
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge install foundry-rs/forge-std --no-commit
forge build
forge test
npm run chain-artifacts   # regenerates src/chain-artifacts.ts from contracts/out
npm run chain-self-pay    # boots anvil, deploys, runs the two-job take
```

`chain-self-pay` prints `ESCROW_LOCKED`, `SAME_HUMAN` (a mined, failed `complete()`), `REFUNDED`, `DISTINCT_HUMANS`, then `CHAIN_SELF_PAY_PASSED`. The desk's on-chain panel (`POST /demo/chain-self-pay`) runs the same take against the chain named by `CHAIN_RPC_URL` + `CHAIN_REGISTRAR_KEY` (optional `CHAIN_CLIENT_KEY`, `CHAIN_PROVIDER_KEY`, `CHAIN_ID`, `CHAIN_NETWORK`, `CHAIN_EXPLORER`, and the four `CHAIN_*_ADDRESS` values to attach instead of deploy). With none set, the route answers 501 and the panel says so.

Production settles on World Chain Sepolia (chain 4801). The failed same-human settlement is [this transaction](https://worldchain-sepolia.explorer.alchemy.com/tx/0x9b41dda60fb60487b40cc94ebd13ea80332367ff20a1e49672dac55eae337070). The two-human payout is [this one](https://worldchain-sepolia.explorer.alchemy.com/tx/0x733d34f143256e05140cb4b1735c909a3bb11c975a2d04c03911d4338f55d3af).

| Contract | Address |
| --- | --- |
| DemoUSD | `0xb904Fa786eA5f8267e808b6CbE5e2702e5dAf30a` |
| HumanRegistry | `0xf026A0268f9A5460cACF135eB5Bd67365b661a06` |
| TwoHumansHook | `0x2B99A95AD8896F46E62B5C796074C014cB7fbC99` |
| ACP core | `0x95fcb6f45700160536897B3596BE7C5843BDd5A7` |

## Revoke desk

Default `npm run dev` is **win** mode: a revoked key is denied on every grant, and a rotated key pays only after the server validates a rebind.

`npm run foil-revoke` still boots the Day 0 theater, where revoke is recorded and the grant still succeeds.

Full product spec and the Day 0/1/2 plan: [SPEC.md](SPEC.md) (same text as [C3-SPEC-AND-PLAN.md](C3-SPEC-AND-PLAN.md)). Confirmation slate: [docs/confirmation-slate-c3.md](docs/confirmation-slate-c3.md).

## What you see

1. Register agent key `K` for a human.
2. A signed request for the paid resource is granted. The paygate opens a session from that lookup.
3. `revoke(K)` flips `revoked` to true. Lookup shows the flag.
4. The same key is granted again. The open session is not re-checked. A brand-new request looks the key up and **ignores** the flag.
5. `rotate(K → K2)` updates the mapping and attaches **no** World re-bind. `K` still pays. `K2` pays anyway.

The script prints `REVOKE_INEFFECTIVE` and `ROTATE_NO_REBIND`, then exits 0. Exit 0 means the hole is present.

## Run

```bash
npm i
npm run self-pay
npm run win-revoke
npm run foil-revoke
```

`win-revoke` prints `REVOKE_ENFORCED` and `REBIND_GRANTED`. `foil-revoke` prints `REVOKE_INEFFECTIVE`.

The 90-second cut runs the foil hole and the win path, including denied, cancelled, and expired rebind:

```bash
npm run film
```

Leave a server up:

```bash
npm run dev
```

Foil server instead: `FOIL_MODE=1 npm run dev` (or `npm run dev:foil`).

[Job pool](http://127.0.0.1:43210) is the live desk. [90-second cut](http://127.0.0.1:43210/film) plays the revoke film. [Operator desk](http://127.0.0.1:43210/desk) is the key lifecycle.

Drive that server instead of an in-process one:

```bash
npm run foil-revoke -- --against http://127.0.0.1:43210
```

`PORT` overrides `43210`. The registry is in-memory and resets when the process exits. Run the film once per process: a second `--against` the same server fails because `K` is already registered. Restart `npm run dev` between takes.

## API

| Call | Effect |
| --- | --- |
| `POST /registry/register` | `{ agentKey, humanRef }` |
| `GET /registry/lookup/:agentKey` | record, including `revoked` |
| `POST /registry/revoke` | `{ agentKey }` flips the flag |
| `POST /registry/rotate` | `{ oldKey, newKey }` updates the mapping, `worldRebind` stays null |
| `GET /api/resource/premium` | `402` challenge (no facilitator) |
| `POST /api/resource/premium` | signed grant. Win mode enforces revoke and rebind. Foil mode does not. |
| `POST /rebind/start` | start a rebind for a rotated-in key |
| `POST /rebind/decide` | local IdP outcome: `validated`, `denied`, or `cancelled` |
| `POST /rebind/finish` | attach `worldRebind` only if the server already validated |
| `POST /rebind/live/start` | sandbox device grant when client credentials are set |
| `GET /debug/registry` | all rows |
| `GET /debug/grants` | grant log |
| `GET /debug/sessions` | sessions opened at first lookup |

A grant sends header `X-Agent-Key` plus a body:

```json
{ "agentKey": "K", "message": "POST /api/resource/premium", "signature": "<sha256 stub>" }
```

The signature is `sha256(agentKey + ":" + message)`. It is a local stub, not a wallet signature and not AgentKit.

Win mode re-reads the registry on every grant. A session cookie does not skip that check. Foil mode still does: the cookie from the first lookup keeps granting, and a fresh request grants if the key was ever registered.

An unknown key is rejected in both modes.

## Why this shape

Real AgentBook has no revoke operation. Compromised wallets can still resolve through `lookupHuman`.

- [worldcoin/agentkit#37](https://github.com/worldcoin/agentkit/issues/37) — RFC: re-registration, revocation, and wallet rotation. `IAgentBook` has no revocation op. The x402 docs talk about revoked registrations taking effect at lookup time, but the contract cannot express that.
- [worldcoin/agentkit#23](https://github.com/worldcoin/agentkit/issues/23) — “How to unregister an agent.” The hosted flow returns `ALREADY_REGISTERED`. There is no unregister.

The registry is an app-layer policy list. It is not an on-chain AgentBook opcode. AgentBook is why revoke matters. The prize surface is World ID for Agents on `https://sandbox.auth.world.org`.

Win mode consults revoke on every grant. A rotated key gets `worldRebind` only after the server validates a rebind. The local film uses issuer `local-sandbox`. A live device grant needs `WORLD_CLIENT_ID` and `WORLD_CLIENT_SECRET`. See [INTEGRATION-DEBRIEF.md](INTEGRATION-DEBRIEF.md) and [DAY1-COMPLETION.md](DAY1-COMPLETION.md).

Not in this repo: IDKit-as-login, a free trial, or a C1 double-grant claim fix.
