# Day 1 completion — revoke enforced

Default mode is **win**. `FOIL_MODE=1` keeps the Day 0 theater.

## Proved

`npm run win-revoke` exits 0 and prints:

- `REVOKE_ENFORCED` — after `revoke(K)`, the open session and a fresh signed request both return HTTP 403 `revoked`. `checkedRevoke` is true.
- `MUTE_WORLD_HELD` — `POST /rebind/finish` with a client `validated: true` does not attach a proof. `K2` stays 403 `rebind required`.
- Denied IdP outcome does not grant.
- `REBIND_GRANTED` — the server mints the subject, `finish` stores `local-sandbox|<subject>`, and only then does `K2` get HTTP 200.

`npm run foil-revoke` still exits 0 and prints `REVOKE_INEFFECTIVE`. That process boots with `mode: "foil"`.

## What win checks on every grant

1. Key is registered.
2. `revoked` is false.
3. `rotatedTo` is empty (the old key is dead once it points at a new one; if it was also revoked, the error is `revoked`).
4. A rotated-in key has `worldRebind` set by the server.

The session cookie is not an authorization decision in win mode.

## Not Day 2 yet

The film rebind uses a local IdP double with the same states as the sandbox journey (pending, validated, denied, expired, cancelled). A live device grant against `https://sandbox.auth.world.org` runs only when `WORLD_CLIENT_ID` and `WORLD_CLIENT_SECRET` are set (`POST /rebind/live/start`, then `/rebind/live/pull`). See `INTEGRATION-DEBRIEF.md`.
