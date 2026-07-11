import {
  ROLES,
  api,
  assertIndexed,
  assertUi,
  connectAs,
  expect,
  portfolio,
  seedToken,
  test,
  waitForIndexed,
} from "../harness";

// @flow:PORT-3 — Tab switch: CREATED (tokens created by this address) (§12.50a / catalog §3b)
// assertable-layers: indexed · UI   (creation's on-chain leg lives in the LAUNCH flows — waiver)
test(
  "PORT-3 CREATED tab lists the subject's created tokens as TokenCards",
  { tag: ["@flow:PORT-3", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const subject = ROLES.creator;
    // seedToken creates via Router.createToken with ROLES.creator as the signer.
    const token = await seedToken({ name: "Port Made", ticker: "PRT3" });

    await assertIndexed("created returns the SAME TokenCard projection as /v1/tokens", async () => {
      const res = await waitForIndexed(
        () => api.portfolioCreated(subject.address, "?limit=50"),
        (d) => d.tokens.some((t) => t.address.toLowerCase() === token.token.toLowerCase()),
        { label: "created token indexed for the creator" },
      );
      const card = res.tokens.find((t) => t.address.toLowerCase() === token.token.toLowerCase());
      // Anti-drift: the card projection matches /v1/tokens (creator, status,
      // moderation gate applied server-side — the client renders what's listed).
      expect(card.creator.toLowerCase()).toBe(subject.address.toLowerCase());
      expect(card.ticker).toBe(token.ticker);
      expect(card.status).toBeTruthy();
      expect(card.moderation?.visibility).toBe("visible");
    });

    await assertUi("CREATED grid renders the TokenCard and routes to /t/[address]", async () => {
      await page.goto(portfolio.route());
      await connectAs(page, "creator");
      await portfolio.createdTab(page).click();
      await expect(portfolio.createdTab(page)).toHaveAttribute("aria-selected", "true");
      // TokenCard exposes role="link" with aria-label "<name> (<ticker>)".
      const card = page.getByRole("link", { name: new RegExp(token.ticker, "i") }).first();
      await expect(card).toBeVisible();
      await card.click();
      await expect(page).toHaveURL(new RegExp(`/t/${token.token}`, "i"));
    });
  },
);
