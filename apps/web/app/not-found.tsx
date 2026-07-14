import Link from "next/link";

import { Button } from "@/shared/ui";

/** Global 404 boundary (web.md). */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="text-sm text-muted-foreground">
        That page does not exist on ROBBED_.
      </p>
      <Button asChild variant="outline">
        <Link href="/">Back to Discover</Link>
      </Button>
    </main>
  );
}
