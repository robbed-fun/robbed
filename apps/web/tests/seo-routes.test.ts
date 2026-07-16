import { describe, expect, it } from "vitest";

import manifest from "../app/manifest";
import robots from "../app/robots";
import sitemap from "../app/sitemap";

import { SITE_DESCRIPTION, SITE_ORIGIN, siteUrl } from "@/shared/config/site";

describe("site discovery metadata routes", () => {
  it("builds absolute public URLs from the canonical site origin", () => {
    expect(siteUrl()).toBe(`${SITE_ORIGIN}/`);
    expect(siteUrl("/create")).toBe(`${SITE_ORIGIN}/create`);
  });

  it("allows crawlers and points them at the public sitemap", () => {
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/" },
      sitemap: `${SITE_ORIGIN}/sitemap.xml`,
      host: SITE_ORIGIN,
    });
  });

  it("exposes the crawlable public routes without wallet-personalized pages", () => {
    expect(sitemap()).toEqual([
      {
        url: `${SITE_ORIGIN}/`,
        changeFrequency: "hourly",
        priority: 1,
      },
      {
        url: `${SITE_ORIGIN}/create`,
        changeFrequency: "weekly",
        priority: 0.8,
      },
    ]);
  });

  it("publishes install/share metadata for the live app shell", () => {
    expect(manifest()).toMatchObject({
      name: "ROBBED_",
      short_name: "ROBBED_",
      description: SITE_DESCRIPTION,
      start_url: "/",
      display: "standalone",
    });
  });
});
