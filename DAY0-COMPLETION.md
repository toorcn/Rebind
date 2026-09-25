# Day 0 completion — C3 revoke theater

Spine: AgentBook revoke / rotate as sign-capability lifecycle.  
This document covers the foil only.

## Proved

`npm run foil-revoke` exits 0 and prints:

- `REVOKE_INEFFECTIVE` — key `K` is revoked in the registry (`lookup` returns `revoked: true`) and `POST /api/resource/premium` still returns HTTP 200. Both the open session and a fresh signed request grant. `checkedRevoke` is false.
- `ROTATE_NO_REBIND` — `rotate(K → K2)` stores the new mapping with `worldRebind: null`. Old key `K` still grants. New key `K2` grants with no World re-bind.

A never-registered key is denied (HTTP 403). The foil is “revoke did nothing,” not an open gate.

## How the hole works

The registry methods do what they say: `revoke` sets the flag, `rotate` points `K` at `K2` and inserts `K2`.

The paygate grant path does not:

- An `agent_session` cookie from the first lookup authorizes every later request for that key.
- A request with no cookie loads the row and treats “row exists” as enough. `revoked` and `rotatedTo` are copied into the response for the film and then ignored.

Debug surfaces for the film: `GET /`, `GET /debug/registry`, `GET /debug/grants`, `GET /debug/sessions`.

Restart the dev server between film takes. The script registers key `K`, and a second run against the same process gets HTTP 409.

## Honest scope

App-layer stub shaped like the AgentBook gap. Cite [agentkit#37](https://github.com/worldcoin/agentkit/issues/37) and [agentkit#23](https://github.com/worldcoin/agentkit/issues/23). No mainnet opcode. No claim that AgentBook was patched. No World ID / IDKit / AgentKit RPC. Signatures are a sha256 stub.

## Day 1 (not built)

- Mid-loop deny: revoke after session start returns 403 on the next grant. The session cookie stops being sufficient.
- World re-bind on rotate: `K2` cannot grant until a fresh World / AgentBook proof is recorded. `K` cannot grant after the rotate.
- Mute film: turning those checks off must bring this Day 0 failure back.

`npm run foil-revoke` is expected to exit 0 only while the hole exists. A Day 1 paygate that enforces revoke should make this script exit non-zero.
