# Network Env Files

The remote stacks should not share one root `.env`. Use one gitignored file per
network:

```bash
cp config/env/testnet.env.example config/env/testnet.env
cp config/env/mainnet.env.example config/env/mainnet.env
```

The root npm scripts call `scripts/compose-env.sh`, which uses the matching file
when it exists:

```bash
pnpm run dev:testnet:d
pnpm run dev:mainnet:d
```

During migration, if `config/env/<network>.env` is missing, the wrapper falls
back to the legacy root `.env`.

Keep private keys out of git and out of `config/env/*.env`. Signer owner
addresses are public; signer private keys stay with the individual owners and
are only supplied locally when running a signing command.

If a runtime service still needs a raw secret, keep it outside the workspace and
load it through the optional secrets env file:

```bash
mkdir -p ~/.config/robbed
chmod 700 ~/.config/robbed
touch ~/.config/robbed/mainnet.secrets.env ~/.config/robbed/testnet.secrets.env
chmod 600 ~/.config/robbed/mainnet.secrets.env ~/.config/robbed/testnet.secrets.env
```

Only fill the key that is needed for the service you are starting:

```env
MAINNET_KEEPER_PRIVATE_KEY=0x...
TESTNET_KEEPER_PRIVATE_KEY=0x...
```

Override the location when needed:

```bash
ROBBED_MAINNET_SECRETS_ENV=/secure/path/mainnet.secrets.env pnpm run dev:mainnet:d
ROBBED_TESTNET_SECRETS_ENV=/secure/path/testnet.secrets.env pnpm run dev:testnet:d
```
