import Link from "next/link";

import { Button, LootMascot } from "@/shared/ui";

/**
 * Global 404 boundary (web.md). LOOT_ mascot lockup — the design's sanctioned
 * empty-state placement (ROBBED Explorations.html §3a → docs/developers/mascot.md):
 * the mascot over the "this page has been robbed." line. SSR-safe (pure SVG), so
 * the 404 renders fully without client JS.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <LootMascot size={112} label="" />
      <h1 className="text-lg font-semibold">this page has been robbed.</h1>
      <p className="text-sm text-muted-foreground">
        That page does not exist on ROBBED_.
      </p>
      <Button asChild variant="outline">
        <Link href="/">Back to Discover</Link>
      </Button>
    </main>
  );
}
