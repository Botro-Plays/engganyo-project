'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import type { ApiResponse } from '@/types';

interface PostRecord { id: string }

const inputCls =
  'w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-sm text-sc-text placeholder:text-sc-muted focus:outline-none focus:ring-2 focus:ring-brand-500';

export default function AdminBlogNewPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiResponse<PostRecord>>('admin/blog/posts', {
        title, slug, excerpt,
      });
      return res.data.data;
    },
    onSuccess: (post) => router.push(`/admin/blog/${post.id}`),
    onError: (e) => setError(getApiErrorMessage(e)),
  });

  const valid =
    title.trim().length > 0 &&
    /^[a-z0-9]{2,64}$/.test(slug);

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/blog" className="text-sc-muted hover:text-sc-text" aria-label="Back to list">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-bold text-white">New blog post</h1>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) createMut.mutate();
        }}
      >
        <label className="block">
          <span className="block text-xs text-sc-muted mb-1">Title</span>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="block">
          <span className="block text-xs text-sc-muted mb-1">
            Slug (lowercase letters and digits only, no hyphens)
          </span>
          <input
            className={inputCls}
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            pattern="[a-z0-9]{2,64}"
            required
          />
        </label>
        <label className="block">
          <span className="block text-xs text-sc-muted mb-1">Excerpt</span>
          <textarea className={inputCls} rows={2} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
        </label>
        <button
          type="submit"
          disabled={!valid || createMut.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-500 hover:bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-40"
        >
          {createMut.isPending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          Create draft
        </button>
      </form>
    </div>
  );
}
