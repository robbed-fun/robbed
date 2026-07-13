import type { Comment as CommentModel } from "@robbed/shared";

import { AddressChip, MonoText, RelativeTime } from "@/shared/ui";

/**
 * A single comment row (§12.63b) — author (short address) · relative time · body.
 * The `author` is a plain address (identity is embedded like `tradeRow.trader`);
 * ENS/avatar resolution is a later enhancement. Body is rendered as PLAIN TEXT
 * (never `dangerouslySetInnerHTML`) so stored-comment XSS cannot execute.
 */
export function CommentItem({ comment }: { comment: CommentModel }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border/60 py-2.5">
      <div className="flex items-center gap-2">
        <AddressChip address={comment.author} className="text-xs" />
        <RelativeTime
          unixSeconds={comment.createdAt}
          className="text-2xs text-text-tertiary"
        />
      </div>
      <MonoText size="sm" className="whitespace-pre-wrap break-words text-text-secondary">
        {comment.body}
      </MonoText>
    </div>
  );
}
