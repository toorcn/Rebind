# Rebind — content brief

Source notes for a pitch deck. This is context and content, not a slide outline.

Rebind is an ETHGlobal Tokyo 2026 project by Hong Bing. The public repo is https://github.com/toorcn/Rebind. The live app is https://rebind-psi.vercel.app. The animated story, which does not move money, is https://rebind-psi.vercel.app/flow. An earlier 12-page technical PDF in the repo (`deck/rebind-pool-pitch.pdf`) was written before the on-chain hook. Use it for screenshots and citations, not as the current story.

## What it is

The product is a job pool for agent commerce. A buyer agent escrows a reward. A worker agent delivers the job. The reward leaves escrow only when both sides have finished a sandbox World ID check, the server has verified both tokens, and the two pairwise subject ids are different.

One person can run both agents and finish the work. The payout stays locked, and that sale does not count. A second person proves the buyer, and the same delivery is paid. A request body that says `differentHumans: true` and includes two subject ids does not unlock anything. The server never reads those fields.

The line that carries the pitch: a finished task whose reward does not become revenue. Delivery is allowed. Settlement is refused. Counted revenue is only what was actually paid to two different humans.

## What World ID is here

World ID is not a login, a reputation score, a free-trial meter, or a discount. It is the settlement condition. The issuer that counts is `https://sandbox.auth.world.org`. Subjects are pairwise. The chain does not store the raw subject. `HumanRegistry` stores `keccak256(issuer + "|" + pairwiseSubject)`. The same hash on the client and the provider is the same human. A local issuer named `local-sandbox` stays unpaid even when the two subject strings differ.

## The pain

The pain is wash demand in agent markets. Wallet counts cannot see one operator.

Sieve’s write-up of Virtuals aGDP (https://github.com/saurrx/sieve) describes an epoch distributing $81,515 where four agents marked BLOCK share about 201 buyers, funded through one Disperse contract, on mechanical 15-second jobs. The score is computed after the jobs exist. Sieve lists “human attestation” as a future signal, weighted 10%.

Zhao et al., “Can Trustless Agents Be Trusted?” (https://arxiv.org/html/2606.26028v2), flag coordinated Sybil reviewers at 73.5% on Ethereum, 59.2% on BSC, and 90.6% on Base.

ERC-8004’s `getSummary` requires client addresses. Unfiltered results are subject to Sybil, and the standard publishes a signal rather than refusing a payment.

RNWY’s “91% same-day-wallet reviews” figure is their illustrative example, not a measured network rate. Say that if it is used.

## What a World track has already said

World’s Lisbon 2026 prize page says these patterns will not qualify: agent reputation, human-backed content generation, and human-backed benefits for agents such as API calls and discounts. https://ethglobal.com/events/lisbon2026/prizes

Turing Swap won Lisbon’s World AgentKit prize by reading `AgentBook.lookupHuman` inside a 1inch SwapVM opcode and changing the fee when two wallets shared a human id. https://ethglobal.com/showcase/turing-swap-ck2y6 That is the cousin that already won, and it is the discount shape the Lisbon brief names.

Tokyo’s public World pool is $15,000. The track write-up on https://ethglobal.com/events/tokyo2026/prizes still said “details coming soon” when this was checked. Lisbon is the last published sponsor bar.

## What this is not

Adjacent projects do not do this rule.

Open Human binds one World ID nullifier to one worker account. AgenTick blocks escrow release until a unique human approves. ProofPay checks that an agent is human-owned, caps agents per human, and can revoke an agent. Execution Market uses a unique nullifier per worker account. None of them refuse settlement when the buyer and the worker are the same human.

Sieve finds the farm after the fact, at the score layer, using wallets. This project answers the same crime at settlement, with a World subject instead of a wallet score.

The concept of refusing a related-party trade is old. The exact rule — the buyer subject must differ from the worker subject or the sale does not count, and a client claim cannot substitute for that — is what this build ships. World ID for Agents made it buildable because one human may delegate to many agents, and a service can tell those agents trace to one human.

## Two piles of value

These must not be drawn as the same coin.

The pool holds in-app credits. The example job is “Summarize the Tokyo briefing,” reward 40. On a same-human result the ledger is escrow 40, paid 0, refused 40, counted 0. The credits stay in escrow. When a second subject replaces the buyer, escrow goes to 0, paid goes to 40, refused clears, and counted becomes 40.

The chain holds DemoUSD, a 6-decimal demo token with open mint, not USDC. `fund()` locks 40 dUSD in an ERC-8183 job. `complete()` is the only gated step. `TwoHumansHook` reverts with `SameHuman` when the hashes match and `Unproven` when either side has no subject. The failed transaction is mined. Status stays Submitted. Escrow in the ACP contract does not move. `claimRefund` is deliberately not hookable, so after expiry the buyer gets the 40 dUSD back. The funds are not hostage, and the sale still does not count. A second human is a new on-chain job whose `complete()` emits `DistinctHumans` and pays the provider.

ERC-8183: https://eips.ethereum.org/EIPS/eip-8183

## The payout rule

In order:

- If the work is not delivered, hold.
- If either proof is missing, hold.
- If the issuer is not sandbox World, hold. Reason: `not-world`.
- If the subjects are equal, hold. Reason: `same-human`. Add the reward to refused.
- Otherwise release and count.

The decision is recomputed from stored proofs. A stored “released” flag is never trusted. Forged subjects in the post or deliver body are not stored. There is no endpoint a client can write a proof to.

## What is live

Production settles on World Chain Sepolia, chain id 4801.

Explorer: https://worldchain-sepolia.explorer.alchemy.com

Contracts:

- DemoUSD `0xb904Fa786eA5f8267e808b6CbE5e2702e5dAf30a`
- HumanRegistry `0xf026A0268f9A5460cACF135eB5Bd67365b661a06`
- TwoHumansHook `0x2B99A95AD8896F46E62B5C796074C014cB7fbC99`
- ACP core `0x95fcb6f45700160536897B3596BE7C5843BDd5A7`

A failed same-human `complete()`: https://worldchain-sepolia.explorer.alchemy.com/tx/0x6fa8294bd0f2555d265ab6c1feece8e873496994851904dbc35532af872ae064

A two-human payout: https://worldchain-sepolia.explorer.alchemy.com/tx/0xd04e9e467c24c74b44923e44e730195d2d49222a547b7b62e333fe9bcacc6596

The on-chain take on the live site reruns this and links each step. It takes about a minute. Fixture subjects in that take are `sub_one_phone` and `sub_second_human`, hashed with the sandbox issuer. The registrar key writes them. A live registrar is supposed to write only after the server-side World device check. That wiring, from a real World App approval into `HumanRegistry`, is not what the on-chain take does today.

The live desk can start a real sandbox device grant. Production has the World client credentials. They are not in the repo. The person approves a code in the sandbox World App. Until someone approves, nothing is stored. A pending or denied pull attaches no subject. Two different sandbox World App accounts are what move the live Paid number on the credit pool. One account on both seats is what fills Refused. A second phone in the room is the live proof. If that phone is absent, the recorded take and the on-chain take are the honest fallback, and they must be labeled as fixtures.

## The animated flow

https://rebind-psi.vercel.app/flow plays these facts in order. It signs nothing.

One person stands behind both agents. Escrow is not revenue. The work can finish unpaid. The client claim is ignored. One World subject lands on both seats. `complete()` reverts `SameHuman`. `claimRefund` returns the chain funds while the pool still holds its credits. A second human releases the same delivery and the chain emits `DistinctHumans`.

## What not to claim

The older revoke desk at `/desk` and the 90-second film at `/film` are an earlier cut. A revoked agent key should fail the next payment, and a rotated key should pay only after a server-validated rebind. That is not the prize thesis. Do not build the deck around it.

Do not claim an AgentBook opcode, a World login, a reputation score, a free trial, or that a fixture subject was issued by World App. Credits are not dollars. DemoUSD is not USDC.

What a judge can click: the GitHub repo, the live pool, the flow, and the failed transaction. The refusal is the product. The second human is the release.
