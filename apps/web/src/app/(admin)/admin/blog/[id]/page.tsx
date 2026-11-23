'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, Loader2, Save, Eye, EyeOff, Upload, Trash2,
  Archive, RotateCcw, Globe, Eye as EyeIcon,
} from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import type { ApiResponse } from '@/types';

type PostStatus = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED' | 'DELETED';

interface DraftFields {
  title: string;
  excerpt: string;
  body: string;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  authorName: string;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
}

interface PostRecord extends DraftFields {
  id: string;
  slug: string;
  status: PostStatus;
  publishedAt: string | null;
  version: number;
  // The admin working copy; the top-level fields are the published
  // snapshot and must not be loaded into the editor.
  draft: DraftFields;
  slugLocked: boolean;
}

interface MutationResult {
  post: PostRecord;
  revalidation?: { attempted: boolean; ok: boolean };
}

const inputCls =
  'w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-sm text-sc-text placeholder:text-sc-muted focus:outline-none focus:ring-2 focus:ring-brand-500';
const btnCls =
  'inline-flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2 text-sm font-medium text-sc-text hover:border-brand-500/60 transition-colors disabled:opacity-40';

const STATUS_ACTIONS: Record<PostStatus, string[]> = {
  DRAFT: ['publish', 'archive', 'delete'],
  PUBLISHED: ['unpublish', 'archive', 'delete'],
  UNPUBLISHED: ['publish', 'archive', 'delete'],
  ARCHIVED: ['restore', 'delete'],
  DELETED: [],
};

export default function AdminBlogEditorPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    title: '', slug: '', excerpt: '', body: '',
    coverImageUrl: '', coverImageAlt: '', authorName: '',
    seoTitle: '', seoDescription: '', ogImageUrl: '',
  });
  const [version, setVersion] = useState(1);
  const [status, setStatus] = useState<PostStatus>('DRAFT');
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [slugLocked, setSlugLocked] = useState(false);
  // Set when a mutation reported revalidation.ok === false: the DB
  // write committed but public caches have not converged.
  const [unsynced, setUnsynced] = useState(false);
  const versionRef = useRef(version);
  versionRef.current = version;

  const postQuery = useQuery({
    queryKey: ['admin-blog-post', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<PostRecord>>(`admin/blog/posts/${id}`);
      return res.data.data;
    },
  });

  // Deployment wiring check: warns early when cache invalidation cannot
  // run at all. Booleans only, no secret values cross the wire.
  const revalStatusQuery = useQuery({
    queryKey: ['admin-blog-reval-status'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ secretConfigured: boolean; webUrlConfigured: boolean }>>(
        'admin/blog/revalidation/status',
      );
      return res.data.data;
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    const p = postQuery.data;
    if (!p) return;
    // The editor loads the draft working copy, not the published row.
    const d = p.draft ?? p;
    setForm({
      title: d.title, slug: p.slug, excerpt: d.excerpt, body: d.body,
      coverImageUrl: d.coverImageUrl ?? '', coverImageAlt: d.coverImageAlt ?? '',
      authorName: d.authorName, seoTitle: d.seoTitle ?? '',
      seoDescription: d.seoDescription ?? '', ogImageUrl: d.ogImageUrl ?? '',
    });
    setVersion(p.version);
    setStatus(p.status);
    setSlugLocked(p.slugLocked);
    setDirty(false);
  }, [postQuery.data]);

  // Unsaved-change guard on tab close / refresh.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
    setNotice(null);
  };

  const showResult = (result: MutationResult | undefined, action: string) => {
    const rv = result?.revalidation;
    // Any ok:false outcome is an unsynced publication state: the DB
    // write committed but public caches have not converged yet.
    if (rv && !rv.ok) {
      setUnsynced(true);
      setNotice({
        kind: 'warn',
        text: rv.attempted
          ? `${action} saved, but the public cache refresh failed. The change is stored; use Retry refresh or wait for the next revalidation window.`
          : `${action} saved, but public cache refresh is not configured on this deployment. The change is stored; it will appear after the next scheduled revalidation.`,
      });
    } else {
      setUnsynced(false);
      setNotice({ kind: 'ok', text: `${action} succeeded.` });
    }
  };

  const applyPost = (p: PostRecord) => {
    setVersion(p.version);
    setStatus(p.status);
    setDirty(false);
    queryClient.invalidateQueries({ queryKey: ['admin-blog'] });
    queryClient.invalidateQueries({ queryKey: ['admin-blog-post', id] });
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const res = await apiClient.patch<ApiResponse<MutationResult>>(`admin/blog/posts/${id}`, {
        ...form,
        coverImageUrl: form.coverImageUrl || null,
        coverImageAlt: form.coverImageAlt || null,
        seoTitle: form.seoTitle || null,
        seoDescription: form.seoDescription || null,
        ogImageUrl: form.ogImageUrl || null,
        expectedVersion: versionRef.current,
      });
      return res.data.data;
    },
    onSuccess: (r) => {
      applyPost(r.post);
      showResult(r, 'Save');
    },
    onError: (e) => {
      setNotice({ kind: 'err', text: getApiErrorMessage(e) });
    },
  });

  const transitionMut = useMutation({
    mutationFn: async (action: 'publish' | 'unpublish' | 'archive' | 'restore') => {
      const res = await apiClient.post<ApiResponse<MutationResult>>(
        `admin/blog/posts/${id}/${action}`,
        { expectedVersion: versionRef.current },
      );
      return { result: res.data.data, action };
    },
    onSuccess: ({ result, action }) => {
      applyPost(result.post);
      showResult(result, `${action[0].toUpperCase()}${action.slice(1)}`);
    },
    onError: (e) => setNotice({ kind: 'err', text: getApiErrorMessage(e) }),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      const res = await apiClient.delete<ApiResponse<MutationResult>>(
        `admin/blog/posts/${id}`,
        { data: { confirm: true, expectedVersion: versionRef.current } },
      );
      return res.data.data;
    },
    onSuccess: (r) => {
      applyPost(r.post);
      setConfirmDelete(false);
      showResult(r, 'Delete');
    },
    onError: (e) => setNotice({ kind: 'err', text: getApiErrorMessage(e) }),
  });

  // Explicit retry for a committed mutation whose invalidation failed.
  const retryMut = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiResponse<{ attempted: boolean; ok: boolean }>>(
        `admin/blog/posts/${id}/revalidate`,
      );
      return res.data.data;
    },
    onSuccess: (rv) => {
      setUnsynced(!rv.ok);
      setNotice(
        rv.ok
          ? { kind: 'ok', text: 'Public cache refresh succeeded. The change is now converging to public pages.' }
          : { kind: 'err', text: 'Cache refresh still failing. Check the deployment configuration.' },
      );
    },
    onError: (e) => setNotice({ kind: 'err', text: getApiErrorMessage(e) }),
  });

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiClient.post<ApiResponse<{ url: string }>>('admin/blog/cover', fd);
      return res.data.data;
    },
    onSuccess: (d) => set('coverImageUrl')(d.url),
    onError: (e) => setNotice({ kind: 'err', text: getApiErrorMessage(e) }),
  });

  const previewMut = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiResponse<{ bodyHtml: string }>>(
        'admin/blog/render-preview',
        { body: form.body },
      );
      return res.data.data.bodyHtml;
    },
    onSuccess: (html) => setPreviewHtml(html),
  });

  const busy = saveMut.isPending || transitionMut.isPending || deleteMut.isPending;

  if (postQuery.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sc-muted">
        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Loading post...
      </div>
    );
  }
  if (postQuery.isError) {
    return (
      <p className="text-red-400 text-sm text-center py-24" role="alert">
        {getApiErrorMessage(postQuery.error)}
      </p>
    );
  }

  const actions = STATUS_ACTIONS[status];
  const deleted = status === 'DELETED';
  // A live post whose saved draft differs needs an explicit republish
  // path that promotes the pending edits; Unpublish->Publish is never
  // required (that route briefly removes the public article). Comparing
  // the draft copy to the published snapshot mirrors the server's
  // draftDiffers check, including intentional null clears.
  const post = postQuery.data;
  const d = post?.draft ?? post;
  const draftDiffers = !!post && !!d && (
    d.title !== post.title || d.excerpt !== post.excerpt || d.body !== post.body ||
    d.authorName !== post.authorName || d.coverImageUrl !== post.coverImageUrl ||
    d.coverImageAlt !== post.coverImageAlt || d.seoTitle !== post.seoTitle ||
    d.seoDescription !== post.seoDescription || d.ogImageUrl !== post.ogImageUrl
  );
  const showPublish = actions.includes('publish') || (status === 'PUBLISHED' && draftDiffers);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/blog" className="text-sc-muted hover:text-sc-text" aria-label="Back to list">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-bold text-white truncate">{form.title || 'Edit post'}</h1>
        <span className="ml-auto rounded-full border border-surface-border px-2.5 py-0.5 text-xs font-medium text-sc-muted">
          {status}
        </span>
      </div>

      {revalStatusQuery.data && (!revalStatusQuery.data.secretConfigured || !revalStatusQuery.data.webUrlConfigured) && (
        <p role="alert" className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          Public cache refresh is not fully configured on this deployment
          {!revalStatusQuery.data.secretConfigured ? ' (revalidation secret missing)' : ''}
          {!revalStatusQuery.data.webUrlConfigured ? ' (web URL missing)' : ''}
          . Changes are stored now and appear on public pages after the
          next scheduled revalidation instead of immediately.
        </p>
      )}

      {unsynced && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <span>Published change is stored but public caches are not yet synced.</span>
          <button
            type="button"
            className={`${btnCls} shrink-0`}
            disabled={retryMut.isPending}
            onClick={() => retryMut.mutate()}
          >
            {retryMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            Retry refresh
          </button>
        </div>
      )}

      {notice && (
        <p
          role="alert"
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            notice.kind === 'ok' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            : notice.kind === 'warn' ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            : 'border-red-500/40 bg-red-500/10 text-red-300'
          }`}
        >
          {notice.text}
        </p>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-xs text-sc-muted mb-1">Title</span>
            <input className={inputCls} value={form.title} onChange={(e) => set('title')(e.target.value)} disabled={deleted} />
          </label>
          <label className="block">
            <span className="block text-xs text-sc-muted mb-1">Slug (lowercase letters and digits only)</span>
            <input className={inputCls} value={form.slug} onChange={(e) => set('slug')(e.target.value)} disabled={deleted || slugLocked} />
            {slugLocked && (
              <span className="mt-1 block text-[11px] text-sc-muted">
                Locked: this post has been published, so its public URL cannot change.
              </span>
            )}
          </label>
        </div>
        <label className="block">
          <span className="block text-xs text-sc-muted mb-1">Excerpt</span>
          <textarea className={inputCls} rows={2} value={form.excerpt} onChange={(e) => set('excerpt')(e.target.value)} disabled={deleted} />
        </label>
        <label className="block">
          <span className="block text-xs text-sc-muted mb-1">Body (Markdown)</span>
          <textarea className={`${inputCls} font-mono`} rows={14} value={form.body} onChange={(e) => set('body')(e.target.value)} disabled={deleted} />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-xs text-sc-muted mb-1">Cover image URL</span>
            <div className="flex gap-2">
              <input className={inputCls} value={form.coverImageUrl} onChange={(e) => set('coverImageUrl')(e.target.value)} disabled={deleted} />
              <label className={`${btnCls} cursor-pointer shrink-0`}>
                <Upload className="w-4 h-4" aria-hidden="true" />
                <span className="sr-only">Upload cover</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="sr-only"
                  disabled={deleted || uploadMut.isPending}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadMut.mutate(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </label>
          <label className="block">
            <span className="block text-xs text-sc-muted mb-1">Cover alt text</span>
            <input className={inputCls} value={form.coverImageAlt} onChange={(e) => set('coverImageAlt')(e.target.value)} disabled={deleted} />
          </label>
          <label className="block">
            <span className="block text-xs text-sc-muted mb-1">Author / byline</span>
            <input className={inputCls} value={form.authorName} onChange={(e) => set('authorName')(e.target.value)} disabled={deleted} />
          </label>
          <label className="block">
            <span className="block text-xs text-sc-muted mb-1">Social preview image URL</span>
            <input className={inputCls} value={form.ogImageUrl} onChange={(e) => set('ogImageUrl')(e.target.value)} disabled={deleted} />
          </label>
          <label className="block">
            <span className="block text-xs text-sc-muted mb-1">SEO title</span>
            <input className={inputCls} value={form.seoTitle} onChange={(e) => set('seoTitle')(e.target.value)} disabled={deleted} />
          </label>
          <label className="block">
            <span className="block text-xs text-sc-muted mb-1">SEO description</span>
            <textarea className={inputCls} rows={2} value={form.seoDescription} onChange={(e) => set('seoDescription')(e.target.value)} disabled={deleted} />
          </label>
        </div>

        {form.coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={form.coverImageUrl} alt={form.coverImageAlt || 'Cover preview'} className="w-48 rounded-lg border border-surface-border" />
        )}

        {dirty && <p className="text-amber-300 text-xs">Unsaved changes.</p>}

        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            className={`${btnCls} bg-brand-500 text-white border-transparent hover:bg-brand-600`}
            disabled={!dirty || busy || deleted}
            onClick={() => saveMut.mutate()}
          >
            {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save draft
          </button>
          <button
            type="button"
            className={btnCls}
            disabled={previewMut.isPending}
            onClick={() => {
              const next = !showPreview;
              setShowPreview(next);
              if (next) previewMut.mutate();
            }}
          >
            {showPreview ? <EyeOff className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
            {showPreview ? 'Hide preview' : 'Preview'}
          </button>
          {showPublish && (
            <button type="button" className={`${btnCls} border-emerald-500/40 text-emerald-300`} disabled={busy} onClick={() => transitionMut.mutate('publish')}>
              <Globe className="w-4 h-4" /> {status === 'PUBLISHED' ? 'Publish changes' : 'Publish'}
            </button>
          )}
          {actions.includes('unpublish') && (
            <button type="button" className={`${btnCls} border-amber-500/40 text-amber-300`} disabled={busy} onClick={() => transitionMut.mutate('unpublish')}>
              <Eye className="w-4 h-4" /> Unpublish
            </button>
          )}
          {actions.includes('archive') && (
            <button type="button" className={btnCls} disabled={busy} onClick={() => transitionMut.mutate('archive')}>
              <Archive className="w-4 h-4" /> Archive
            </button>
          )}
          {actions.includes('restore') && (
            <button type="button" className={btnCls} disabled={busy} onClick={() => transitionMut.mutate('restore')}>
              <RotateCcw className="w-4 h-4" /> Restore
            </button>
          )}
          {actions.includes('delete') && !confirmDelete && (
            <button type="button" className={`${btnCls} border-red-500/40 text-red-300`} disabled={busy} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          )}
          {confirmDelete && (
            <span className="inline-flex items-center gap-2">
              <span className="text-red-300 text-sm">Delete permanently?</span>
              <button type="button" className={`${btnCls} border-red-500/40 text-red-300`} disabled={busy} onClick={() => deleteMut.mutate()}>
                Confirm
              </button>
              <button type="button" className={btnCls} onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </span>
          )}
        </div>

        {status === 'DRAFT' && (
          <p className="text-xs text-sc-muted">
            Saving keeps this post as a draft. Nothing goes live until you use Publish.
          </p>
        )}
        {status === 'PUBLISHED' && (
          <p className="text-xs text-sc-muted">
            This post is live. Edits you save stay private as a draft and
            do not change the public page until you use Publish changes.
          </p>
        )}

        {showPreview && (
          <div className="mt-4 rounded-xl border border-surface-border p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Preview (not public)</h2>
            {previewMut.isPending ? (
              <p className="text-sc-muted text-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Rendering...
              </p>
            ) : (
              <div className="blog-body text-zinc-300 leading-relaxed" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
