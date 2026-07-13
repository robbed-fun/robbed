"use client";

import { COMMENT_BODY_MAX } from "@robbed/shared";
import { useState } from "react";
import { useAccount } from "wagmi";

import { CommentItem, postComment, useComments } from "@/entities/comment";
import { useSiweAuth } from "@/features/auth-siwe";
import { WalletConnectButton } from "@/features/connect-wallet";
import { ApiError } from "@/shared/api";
import { Button, EmptyState, MonoLabel, MonoText, TextArea } from "@/shared/ui";

/**
 * Comments panel for `/t/[address]` (§12.63b). Composes the `comment` entity (list
 * + WS-live + post) with the `auth-siwe` feature (SIWE sign-in) and the
 * `connect-wallet` feature. Flow: connect wallet → sign in (SIWE) → post. The list
 * is REST history + live WS prepends; a just-posted comment is shown locally.
 *
 * Moderation: the API excludes hidden comments (visible + pending_review only), so
 * the panel renders whatever it is served. A REPORT affordance is intentionally
 * absent — no report endpoint exists on the API surface (routed to robbed-indexer;
 * see the report). Never gates any trade/sell path — purely additive.
 */
export function CommentsPanel({ address }: { address: string }) {
  const { comments, addLocal, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useComments(address);

  return (
    <section aria-label="Comments" className="flex flex-col gap-3">
      <MonoLabel size="2xs" className="text-text-tertiary">
        Comments
      </MonoLabel>

      <Composer address={address} onPosted={addLocal} />

      {isLoading ? (
        <MonoText tone="faint" size="xs">
          Loading comments…
        </MonoText>
      ) : isError && comments.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <MonoText tone="faint" size="xs">
            Couldn&apos;t load comments.
          </MonoText>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : comments.length === 0 ? (
        <EmptyState title="No comments yet" description="Be the first to say something." />
      ) : (
        <div className="flex flex-col">
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} />
          ))}
          {hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Composer({
  address,
  onPosted,
}: {
  address: string;
  onPosted: (comment: import("@robbed/shared").Comment) => void;
}) {
  const { isConnected } = useAccount();
  const auth = useSiweAuth();
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Not connected → the connect affordance is the entry point.
  if (!isConnected) {
    return (
      <div className="flex flex-col items-start gap-2">
        <MonoText tone="faint" size="xs">
          Connect a wallet to comment.
        </MonoText>
        <WalletConnectButton />
      </div>
    );
  }

  // Connected but no session this tab → SIWE sign-in.
  if (!auth.authedAddress) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={auth.phase === "authenticating"}
          onClick={() => void auth.login()}
        >
          {auth.phase === "authenticating" ? "Check your wallet…" : "Sign in to comment"}
        </Button>
        {auth.error && (
          <MonoText tone="red" size="xs">
            {auth.error}
          </MonoText>
        )}
      </div>
    );
  }

  const trimmed = body.trim();
  const tooLong = body.length > COMMENT_BODY_MAX;
  const canPost = trimmed.length > 0 && !tooLong && !posting;

  const submit = async () => {
    if (!canPost) return;
    setPosting(true);
    setError(null);
    try {
      const comment = await postComment(address, trimmed);
      onPosted(comment);
      setBody("");
    } catch (e) {
      // A 401 means the cookie expired/was cleared → drop the session so the
      // sign-in prompt returns (spec §12.63b: re-auth, never a silent failure).
      if (e instanceof ApiError && (e.status === 401 || e.code === "unauthorized")) {
        auth.reset();
        setError("Your session expired — sign in again.");
      } else {
        setError(e instanceof Error ? e.message : "Couldn't post your comment.");
      }
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <TextArea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a comment…"
        rows={2}
        aria-label="Add a comment"
        maxLength={COMMENT_BODY_MAX + 1}
      />
      <div className="flex items-center justify-between">
        <MonoText tone={tooLong ? "red" : "faint"} size="2xs" numeric>
          {body.length}/{COMMENT_BODY_MAX}
        </MonoText>
        <Button size="sm" variant="outline" disabled={!canPost} onClick={() => void submit()}>
          {posting ? "Posting…" : "Post"}
        </Button>
      </div>
      {error && (
        <MonoText tone="red" size="xs">
          {error}
        </MonoText>
      )}
    </div>
  );
}
