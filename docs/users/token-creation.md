# Creating a token

**Audience:** creators. What you provide, what it costs, what actually happens on-chain, and what you can — and deliberately cannot — do afterwards.
**Source of truth:** [../spec.md](../spec.md) (§5.3, §6.1, §6.4, §8.3). This page is a derived view; when they disagree, the spec wins.

## What you provide

| Field | Rules | Required |
|---|---|---|
| Name | 1–32 **bytes** (byte length, not characters — emoji and non-Latin scripts count multi-byte, §12.30) | yes |
| Ticker | 1–10 bytes (§12.30) | yes |
| Image | ≤ 4 MB; png, jpeg, webp, or gif; re-encoded server-side (§5.3, §8.4) | yes |
| Description | ≤ 500 characters | no |
| Links (website, socials) | optional | no |
| Initial buy | optional ETH amount, executed atomically in the creation transaction | no |

## What it costs

- **Creation fee:** flat, spam-resistance sized — “~$1–2 equivalent” (§6.4). The current locked value is **0.000825 ETH**, from the M0 economics re-lock of 2026-07-12 at ETH/USD $1,817.62 (CoinGecko; §12.62). ETH-pegged values like this are deploy-time snapshots and are re-derived before mainnet deploy — treat the dollar figure as the intent, the spec as the source.
- **Gas:** ordinary transaction gas on Robinhood Chain (ETH gas token, cheap blocks).
- **Optional initial buy:** whatever ETH you attach on top; it goes through the normal curve-buy path.

## What happens when you launch

1. **Image upload.** Your image goes to the API, never directly to storage. The API verifies the real file type from its bytes, decodes and re-encodes it (stripping metadata and anything hidden in the file), and stores it under a hash of the re-encoded bytes (§8.3, §8.4, §12.19).
2. **Metadata commit.** The API canonicalizes your metadata JSON and hashes it. Your wallet client independently recomputes that hash and refuses to proceed on any mismatch — you never sign a hash you can't verify (§8.3, §12.19).
3. **One transaction.** You sign a single `createToken` call carrying the creation fee plus your optional initial buy (§5.3). In that one transaction:
   - your **token** is deployed — fixed supply of 1,000,000,000, 18 decimals, entire supply minted once into the bonding curve; ownerless from the first block (§6.1);
   - its **bonding curve** is deployed and live;
   - the token's future **Uniswap v3 pool is created and initialized immediately**, priced at the deterministic graduation price — this early initialization is a defense that prevents anyone from pre-seeding the pool at a fake price before graduation (§6.3);
   - the metadata hash is committed on-chain, permanently binding the token to the exact name, ticker, and image you uploaded (§8.3);
   - if you attached an initial buy, it executes atomically — nobody can trade before you (§5.3).
4. **Tradeable in under a second.** The token appears on the site as soon as the sequencer includes the transaction (§2.1).

## Supply layout

| Slice | Amount | Share |
|---|---|---|
| Sold on the bonding curve | ~793,100,000 | 79.31% |
| Reserved for graduation liquidity | ~206,900,000 | 20.69% |
| Creator / team allocation | 0 | 0% |

There is no presale and no vesting. If you want a position in your own token, you buy it — that's what the atomic initial buy is for (§5.3).

## The initial buy has no special powers

The atomic initial buy exists so creators aren't sniped in the block after launch — not to give creators an edge. It runs under exactly the same rules as everyone else's trades, including the early-window anti-sniper cap (currently 0.197915 ETH per transaction in the first seconds — 2.5% of the graduation target; §6.5, §12.32) and your own slippage floor. There is no carve-out (§12.15).

## What creators cannot do — by design

Once launched, a token is out of your hands in every way that matters to a holder:

- you cannot mint more supply, tax transfers, or blacklist anyone — the token has no such code (§6.1);
- you cannot pause or stop trading — no creator has any switch at all, and even the protocol's own switches can never block sells (§6.5);
- you cannot withdraw the curve's ETH — it is reserved for trading and, at the end, graduation liquidity (§6.2, §6.3);
- you cannot change any fee — fees are computed in-contract from immutable parameters (§4.1).

This is the honest trade-off of the launchpad model: creators get instant, free-ish, code-free launches; holders get a token that its creator cannot rug through the contract.

## What creators earn

You earn the **creator-fee leg of every trade on your token** while it is on the curve — a live feature, not a promise (§7, §12.63). On the current testnet that is **0.5%** of the ETH side of every buy *and* sell, additive to the 1% treasury fee and hard-capped at 2% total in code. It accrues to your token's curve automatically — there is nothing to claim per trade — and you can pull the accumulated total to your address anytime with a one-click claim (a permissionless `sweepCreatorFees()` then `CreatorVault.claim()`); the ETH can **only ever** reach the creator address that earned it, and it can never be redirected or freeze anyone's sell.

Two honest caveats:

- **The earning window is the curve phase.** After graduation, trading moves to the token's Uniswap pool and those 1% pool fees go to the treasury, not to you (§6.3, §12.14).
- **On mainnet the rate is a deploy-time decision.** The spec's v1 default is 0, so mainnet may launch with the creator fee at 0 or at a re-locked non-zero value — the plumbing (a per-creator escrow, `CreatorVault`) ships either way, and the creator of every token is recorded on-chain from day one (§7, §12.63). Full mechanics, numbers, and how it compares to pump.fun / Raydium: [fees.md](fees.md).
