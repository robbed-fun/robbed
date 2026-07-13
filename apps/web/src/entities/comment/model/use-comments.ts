"use client";

import { type Comment as CommentModel, tokenEvents } from "@robbed/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { qk } from "@/shared/lib/query-keys";
import { useWsChannel } from "@/shared/lib/ws";
import { listComments } from "../api/comments";

/**
 * Live comment list (§12.63b). The paginated REST history (keyset, newest-first)
 * is the resumable truth; the WS `comment` event on `token:{address}:events`
 * PREPENDS new visible comments live (§8.4 moderation-gated fanout ⇒ WS delivers
 * only visible ones). A just-POSTed comment is prepended locally via `addLocal`
 * (so the author sees it even if it is pending_review, which the fanout skips).
 *
 * The merged list dedupes by `id` (live/local win over the page copy), so a
 * comment that arrives BOTH from the POST response AND the WS fanout renders once.
 */
export function useComments(address: string) {
  const query = useInfiniteQuery({
    queryKey: qk.comments(address),
    queryFn: ({ pageParam }) => listComments(address, pageParam ?? undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  // Live + optimistic head (newest-first). Kept out of the query cache so a
  // background refetch never wipes a comment the user just saw arrive.
  const [live, setLive] = useState<CommentModel[]>([]);

  const addLocal = useCallback((comment: CommentModel) => {
    setLive((prev) =>
      prev.some((c) => c.id === comment.id) ? prev : [comment, ...prev],
    );
  }, []);

  // WS fanout → prepend visible comments (their moderationStatus is 'visible' by
  // construction — the base payload omits it, so we set it explicitly).
  useWsChannel(tokenEvents(address), (msg) => {
    if (msg.type !== "comment") return;
    if (msg.data.tokenAddress.toLowerCase() !== address.toLowerCase()) return;
    addLocal({ ...msg.data, moderationStatus: "visible" });
  });

  const pageComments = query.data?.pages.flatMap((p) => p.items) ?? [];
  const comments = dedupeById([...live, ...pageComments]);

  return {
    comments,
    addLocal,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
  };
}

/** Keep the FIRST occurrence of each id (live/local head wins over page copies). */
function dedupeById(items: CommentModel[]): CommentModel[] {
  const seen = new Set<string>();
  const out: CommentModel[] = [];
  for (const c of items) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}
