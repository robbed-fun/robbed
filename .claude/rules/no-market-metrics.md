# Never hardcode market metrics (always loaded)

- Never hardcode TVL, prices, ETH/USD, volumes, or any threshold derived from them — in code, copy, or docs. Cite source + timestamp or query live.
- M0-derived protocol constants come from `tools/m0/out/constants.json` (committed; the committed values ARE canonical). Numbers quoted in docs are asserted against it with `<!-- m0:dotted.path -->` markers (doc-check gate e).
