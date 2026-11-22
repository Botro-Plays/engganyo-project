'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  FileText, Loader2, Plus, Search, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import type { ApiResponse } from '@/types';

type PostStatus = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED' | 'DELETED';

interface PostRow {
  id: string;
  slug: string;
  title: string;
  status: PostStatus;
  publishedAt: string | null;
  updatedAt: string;
  version: number;
}

interface ListResponse {
  items: PostRow[];
  total: number;
  page: number;
  limit: number;
}

const STATUS_STYLES: Record<PostStatus, string> = {
  DRAFT: 'text-zinc-300 bg-zinc-500/10 border-zinc-500/30',
  PUBLISHED: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  UNPUBLISHED: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  ARCHIVED: 'text-blue-300 bg-blue-500/10 border-blue-500/30',
  DELETED: 'text-red-300 bg-red-500/10 border-red-500/30',
};

const PAGE_LIMIT = 15;

export default function AdminBlogListPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<PostStatus | ''>('');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['admin-blog', q, status, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (status) params.set('status', status);
      params.set('page', String(page));
      params.set('limit', String(PAGE_LIMIT));
      const res = await apiClient.get<ApiResponse<ListResponse>>(
        `admin/blog/posts?${params.toString()}`,
      );
      return res.data.data;
    },
    placeholderData: (prev) => prev,
  });

  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / PAGE_LIMIT)) : 1;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <FileText className="w-6 h-6 text-brand-400" />
          <h1 className="text-2xl font-bold text-white">Blog posts</h1>
        </div>
        <Link
          href="/admin/blog/new"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-500 hover:bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          New post
        </Link>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <label className="relative flex-1 min-w-[12rem]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sc-muted" aria-hidden="true" />
          <input
            type="search"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search title, slug, or excerpt"
            className="w-full rounded-lg bg-surface-card border border-surface-border pl-9 pr-3 py-2 text-sm text-sc-text placeholder:text-sc-muted focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </label>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value as PostStatus | ''); setPage(1); }}
          aria-label="Filter by status"
          className="rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-sm text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="PUBLISHED">Published</option>
          <option value="UNPUBLISHED">Unpublished</option>
          <option value="ARCHIVED">Archived</option>
          <option value="DELETED">Deleted</option>
        </select>
      </div>

      {query.isLoading && (
        <div className="flex items-center gap-2 text-sc-muted py-12 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Loading posts...
        </div>
      )}
      {query.isError && (
        <p className="text-red-400 text-sm py-6 text-center" role="alert">
          {getApiErrorMessage(query.error)}
        </p>
      )}

      {query.data && (
        <>
          <div className="overflow-x-auto rounded-xl border border-surface-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-card text-left text-sc-muted">
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Slug</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Published</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {query.data.items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sc-muted">
                      No posts match.
                    </td>
                  </tr>
                )}
                {query.data.items.map((post) => (
                  <tr key={post.id} className="hover:bg-white/[0.03]">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/blog/${post.id}`}
                        className="text-brand-400 hover:underline font-medium"
                      >
                        {post.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sc-muted font-mono text-xs">{post.slug}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[post.status]}`}>
                        {post.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sc-muted">
                      {post.publishedAt
                        ? new Date(post.publishedAt).toLocaleDateString('en-GB', {
                            day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
                          })
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-sc-muted">
                      {new Date(post.updatedAt).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-sc-muted">
                Page {query.data.page} of {totalPages} ({query.data.total} posts)
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-3 py-1.5 text-sc-text disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" /> Prev
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-3 py-1.5 text-sc-text disabled:opacity-40"
                >
                  Next <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
