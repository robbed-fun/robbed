import type { MetadataRoute } from "next";

import {
  SITE_DESCRIPTION,
  SITE_MANIFEST_BACKGROUND_COLOR,
  SITE_MANIFEST_THEME_COLOR,
  SITE_NAME,
} from "@/shared/config/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: SITE_MANIFEST_BACKGROUND_COLOR,
    theme_color: SITE_MANIFEST_THEME_COLOR,
    icons: [
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
