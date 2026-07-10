import Link from "next/link";

import { Button } from "@/shared/ui";

/**
 * Token Detail 404 (§5.2 "Token not found on ROBBED_" + Blockscout link). The
 * address echo/link is intentionally omitted here because `notFound()` does not
 * carry params; the global message + Discover link is the safe minimal state.
 */
export default function TokenNotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-lg font-semibold">Token not found on ROBBED_</h1>
      <p className="text-sm text-muted-foreground">
        This address is not a ROBBED_ token, or it has not been indexed yet.
      </p>
      <Button asChild variant="outline">
        <Link href="/">Back to Discover</Link>
      </Button>
    </main>
  );
}
