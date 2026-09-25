# Integration debrief — World ID for Agents

Track: Best Use of World ID for Agents. Issuer we target: `https://sandbox.auth.world.org`.

## What is wired

- Discovery matches the sandbox IdP: device authorization `POST /api/v1/device_authorization`, token `POST /api/v1/token`, JWKS `/.well-known/jwks.json`.
- `POST /rebind/live/start` starts that device grant when `WORLD_CLIENT_ID` and `WORLD_CLIENT_SECRET` are set. The device code stays on the server. The client only receives `user_code` and `verification_uri`.
- `POST /rebind/live/pull` sends the device code to the token endpoint and accepts an ID token only after RS256, `iss`, `aud`, and `exp` checks. The pairwise `sub` is what gets stored. A raw client JSON body is never treated as success.
- The paid grant is the protected action (Q6). Rebind is not app login.
- Fail path (Q3): denied, cancelled, expired, and a still-pending request do not attach `worldRebind`, so the rotated key cannot pay.
- Mute: `finish` with `validated: true` in the body does nothing unless the server already marked the request validated.

## Time to first success

The local journey (start → decide validated → finish → grant) succeeds in one `npm run win-revoke` run, under a second, with no portal client.

A live sandbox round trip is not done in this environment. There is no registered OIDC client here, so device authorization cannot complete in World App.

## Friction

- The prize surface is an OIDC IdP (device flow, pairwise `sub`), not an AgentBook opcode and not IDKit-as-login. That took a pass over `/.well-known/openid-configuration` to see.
- Confidential client (`client_secret_basic` / `client_secret_post` / `private_key_jwt`) means the film cannot finish live without portal credentials.
- AgentPlugin is listed on the track. This repo calls the sandbox IdP HTTP API directly. The plugin is not required for the device grant we implemented.

## Missing docs

The public docs page describes Human Continuity and points at the portal and `/mcp`. The exact rebind-for-agents walkthrough (which scope, whether AgentPlugin is mandatory, how a hackathon client is registered) was not on that page. The discovery document was the part that made the endpoints concrete.

## One improvement

Publish one hackathon snippet: register a sandbox confidential client, start the device grant, poll the token endpoint, and show the `iss`+`sub` check before a protected action. Include the denied and expired responses next to the success path.

## Honesty

`npm run win-revoke` uses `issuer: local-sandbox` and a server-minted subject. That is a stand-in so the lifecycle film runs without World App. It is not a World ID proof. Do not describe it as one.
