# Creating a token

**Audience:** creators. What you provide, what it costs, what actually happens on-chain, and what you can — and deliberately cannot — do afterwards.
**Source of truth:** the [root README](../../README.md) and the developer docs under [../developers/](../developers). This page is a derived view; when they disagree, the design docs win.

## What you provide

| Field | Rules | Required |
|---|---|---|
| Name | 1–32 **bytes** (byte length, not characters — emoji and non-Latin scripts count multi-byte) | yes |
| Ticker | 1–10 bytes | yes |
| Image | ≤ 4 MB; png, jpeg, webp, or gif; re-encoded server-side | yes |
| Description | ≤ 500 characters | no |
| Links (website, socials) | optional | no |
| Initial buy | optional ETH amount, executed atomically in the creation transaction | no |

## What it costs

- **Creation fee:** flat, spam-resistance sized — “~$1–2 equivalent”. The current locked value is **0.000847 ETH** (847000000000000 wei <!-- m0:fees.creationFeeWei -->), from the M0 economics lock (sourced from `tools/m0/out/constants.json`). ETH-pegged values like this are deploy-time snapshots and are re-derived before mainnet deploy — treat the dollar figure as the intent, the constants file as the source.
- **Gas:** ordinary transaction gas on Robinhood Chain (ETH gas token, cheap blocks).
- **Optional initial buy:** whatever ETH you attach on top; it goes through the normal curve-buy path.

## What happens when you launch

1. **Image upload.** Your image goes to the API, never directly to storage. The API verifies the real file type from its bytes, decodes and re-encodes it (stripping metadata and anything hidden in the file), and stores it under a hash of the re-encoded bytes.
2. **Metadata commit.** The API canonicalizes your metadata JSON and hashes it. Your wallet client independently recomputes that hash and refuses to proceed on any mismatch — you never sign a hash you can't verify.
3. **One transaction.** You sign a single `createToken` call carrying the creation fee plus your optional initial buy. In that one transaction:
   - your **token** is deployed — fixed supply of 1,000,000,000, 18 decimals, entire supply minted once into the bonding curve; ownerless from the first block;
   - its **bonding curve** is deployed and live;
   - the token's future **Uniswap v3 pool is created and initialized immediately**, priced at the deterministic graduation price — this early initialization is a defense that prevents anyone from pre-seeding the pool at a fake price before graduation;
   - the metadata hash is committed on-chain, permanently binding the token to the exact name, ticker, and image you uploaded;
   - if you attached an initial buy, it executes atomically — nobody can trade before you.
4. **Tradeable in under a second.** The token appears on the site as soon as the sequencer includes the transaction.

## Supply layout

| Slice | Amount | Share |
|---|---|---|
| Sold on the bonding curve | ~793,100,000 | 79.31% |
| Reserved for graduation liquidity | ~206,900,000 | 20.69% |
| Creator / team allocation | 0 | 0% |

There is no presale and no vesting. If you want a position in your own token, you buy it — that's what the atomic initial buy is for.

## The initial buy has no special powers

The atomic initial buy exists so creators aren't sniped in the block after launch — not to give creators an edge. It runs under exactly the same rules as everyone else's trades, including the early-window anti-sniper cap (currently 0.143742 ETH (143742000000000000 wei <!-- m0:antiSniper.maxEarlyBuyWei -->) per transaction in the first seconds — 2.5% of the graduation target) and your own slippage floor. There is no carve-out.

## What creators cannot do — by design

Once launched, a token is out of your hands in every way that matters to a holder:

- you cannot mint more supply, tax transfers, or blacklist anyone — the token has no such code;
- you cannot pause or stop trading — no creator has any switch at all, and even the protocol's own switches can never block sells;
- you cannot withdraw the curve's ETH — it is reserved for trading and, at the end, graduation liquidity;
- you cannot change any fee — fees are computed in-contract from immutable parameters.

This is the honest trade-off of the launchpad model: creators get instant, free-ish, code-free launches; holders get a token that its creator cannot rug through the contract.

## What creators earn

You earn the **creator-fee leg of every trade on your token** — a live feature, not a promise. That is **0.5%** of the ETH side of every buy *and* sell, additive to the 1% treasury fee and hard-capped at 2% total in code. It accrues to your token's curve automatically — there is nothing to claim per trade — and you can pull the accumulated total to your address anytime with a one-click claim (a permissionless `sweepCreatorFees()` then `CreatorVault.claim()`); the ETH can **only ever** reach the creator address that earned it, and it can never be redirected or freeze anyone's sell.

- **You keep earning after graduation.** The graduated token's Uniswap pool charges a 1% fee; the vault's `collect()` splits it 50/50 with the treasury, routing your half to the `CreatorVault` — so your 0.5%-of-volume rate carries across the graduation seam.
- **On mainnet the rate is decided at 0.5%** and re-locked against real economics before deploy — the plumbing (a per-creator escrow, `CreatorVault`) ships either way, and the creator of every token is recorded on-chain from day one. Full mechanics, numbers, and how it compares to pump.fun / Raydium: [fees.md](fees.md).
