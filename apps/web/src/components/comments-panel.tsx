'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronUp, ChevronDown, MessageCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api, ApiError } from '@/lib/api';
import type { Comment } from '@/lib/types';
import { Button } from './ui/button';
import { cn } from '@/lib/cn';

interface Props {
  marketId: string;
}

export function CommentsPanel({ marketId }: Props): JSX.Element {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['comments', marketId],
    queryFn: () => api.marketComments(marketId),
    refetchInterval: 15_000,
  });

  const post = useMutation({
    mutationFn: () => api.postComment(marketId, body.trim()),
    onSuccess: () => {
      setBody('');
      setErr(null);
      qc.invalidateQueries({ queryKey: ['comments', marketId] });
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) setErr(e.message);
      else setErr('Failed to post');
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-slate-400" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
          Discussion
        </h2>
        <span className="text-xs text-slate-500">({q.data?.length ?? 0})</span>
      </div>

      {token ? (
        <div className="space-y-2 rounded-md border border-slate-800 bg-slate-900/40 p-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Share your take…"
            rows={2}
            maxLength={2000}
            className="w-full resize-none rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-brand focus:ring-1 focus:ring-brand"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-500">{2000 - body.length} chars left</span>
            <Button
              size="sm"
              disabled={!body.trim() || post.isPending}
              onClick={() => post.mutate()}
            >
              {post.isPending ? 'Posting…' : 'Post'}
            </Button>
          </div>
          {err && <p className="text-xs text-no">{err}</p>}
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-slate-800 px-3 py-2 text-xs text-slate-500">
          Log in to join the conversation.
        </p>
      )}

      <div className="space-y-2">
        {q.data?.length === 0 && (
          <p className="px-1 text-xs text-slate-500">No comments yet — be the first.</p>
        )}
        {q.data?.map((c) => <CommentRow key={c.id} comment={c} />)}
      </div>
    </div>
  );
}

function CommentRow({ comment }: { comment: Comment }): JSX.Element {
  const qc = useQueryClient();
  const { token } = useAuth();
  const vote = useMutation({
    mutationFn: (value: 1 | -1) => api.voteComment(comment.id, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['comments'] }),
  });

  return (
    <div className="flex gap-3 rounded-md border border-slate-800 bg-slate-900/30 p-3">
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          aria-label="Upvote"
          disabled={!token || vote.isPending}
          onClick={() => vote.mutate(1)}
          className="text-slate-500 hover:text-yes disabled:opacity-30"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <span className="tabular text-xs font-semibold text-slate-300">{comment.score}</span>
        <button
          type="button"
          aria-label="Downvote"
          disabled={!token || vote.isPending}
          onClick={() => vote.mutate(-1)}
          className="text-slate-500 hover:text-no disabled:opacity-30"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-slate-200">@{comment.user.username}</span>
          {comment.skin && (
            <span
              className={cn(
                'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                comment.skin.side === 'YES'
                  ? 'bg-yes-tint text-yes ring-1 ring-inset ring-yes/30'
                  : 'bg-no-tint text-no ring-1 ring-inset ring-no/30',
              )}
              title="Skin in the game"
            >
              {comment.skin.side} · {comment.skin.shares}
            </span>
          )}
          <span className="text-slate-600">·</span>
          <span className="text-slate-500">{relativeTime(comment.createdAt)}</span>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-200">{comment.body}</p>
      </div>
    </div>
  );
}

function relativeTime(iso: string): string {
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86400)}d ago`;
}
