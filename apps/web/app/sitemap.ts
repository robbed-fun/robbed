import type { MetadataRoute } from "next";

import { siteUrl } from "@/shared/config/site";

const SITEMAP_ROUTES = [
  { path: "/", changeFrequency: "hourly", priority: 1 },
  { path: "/create", changeFrequency: "weekly", priority: 0.8 },
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return SITEMAP_ROUTES.map((route) => ({
    url: siteUrl(route.path),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
