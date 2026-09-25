# C3 Day 0 — revoke theater

ETHGlobal Tokyo 2026. Locked spine **C3**: AgentBook revoke / rotate as a signing-key lifecycle.

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
npm run win-revoke
npm run foil-revoke
```

`win-revoke` prints `REVOKE_ENFORCED` and `REBIND_GRANTED`. `foil-revoke` prints `REVOKE_INEFFECTIVE`.

Leave a server up:

```bash
npm run dev
```

Foil server instead: `FOIL_MODE=1 npm run dev` (or `npm run dev:foil`).

[Revoke theater](http://127.0.0.1:43210) — registry table and grant log. The page refreshes every 2 seconds.

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

This fixture is an **app-layer** stub of that gap: a registry that can record revoke and rotate, composed in front of a paygate that does not consult them. It is not an on-chain AgentBook opcode, and it does not patch mainnet.

Not in this repo: World ID, IDKit, live AgentKit, a free trial, World-as-login, or a C1 double-grant claim fix.

## Day 1

Mid-loop revoke enforcement: every grant re-reads the registry, and a revoked or rotated-away key is denied even if a session is already open.

Rotate re-bind: `K2` stays unusable until a fresh World / AgentBook proof is attached. `K` dies when the mapping moves.
