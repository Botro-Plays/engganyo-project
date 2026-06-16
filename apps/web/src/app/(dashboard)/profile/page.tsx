'use client';

import { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  Check,
  Loader2,
  Plus,
  Trash2,
  Youtube,
  Instagram,
  Twitter,
  Music,
  Globe,
  Lock,
  Shield,
  Share2,
  Mail,
  ExternalLink,
  Upload,
  X,
  Award,
  Users,
  UserCheck,
  Clock,
  Coins,
} from 'lucide-react';
import Link from 'next/link';

import { apiClient, getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import type { ApiResponse } from '@/types';

// ─── Types ────────────────────────────────────────────────────
interface SocialAccount {
  id: string;
  platform: string;
  platformUsername: string;
  profileUrl: string | null;
  followerCount: number | null;
  isVerified: boolean;
}

interface FullProfile {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  role: string;
  status: string;
  xp: number;
  level: number;
  vp: number;
  vipTier: { name: string; displayName: string; level: number; perks: { color: string; icon: string } } | null;
  creditBalance: number;
  reputationScore: number;
  currentStreak: number;
  longestStreak: number;
  referralCode: string;
  createdAt: string;
  profile: {
    websiteUrl: string | null;
    location: string | null;
    timezone: string | null;
    niche: string[];
    languages: string[];
    totalTasksDone: number;
    totalCampaigns: number;
    completionRate: number;
    isPublic: boolean;
    allowMentions: boolean;
  } | null;
  socialAccounts: SocialAccount[];
}

// ─── Schemas ──────────────────────────────────────────────────
const profileSchema = z.object({
  displayName: z.string().max(50).optional().or(z.literal('')),
  bio: z.string().max(300).optional().or(z.literal('')),
  avatarUrl: z.string().optional().or(z.literal('')),
  websiteUrl: z.string().url().optional().or(z.literal('')),
  location: z.string().max(100).optional().or(z.literal('')),
  allowMentions: z.boolean().optional(),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: z
      .string()
      .min(8, 'At least 8 characters')
      .regex(/[A-Z]/, 'Must contain an uppercase letter')
      .regex(/[0-9]/, 'Must contain a number'),
    confirmPassword: z.string().min(1, 'Required'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

const socialSchema = z.object({
  platform: z.string().min(1),
  platformUsername: z.string().min(1, 'Username is required').max(100),
  profileUrl: z.string().url().optional().or(z.literal('')),
});

type ProfileFormData = z.infer<typeof profileSchema>;
type PasswordFormData = z.infer<typeof passwordSchema>;
type SocialFormData = z.infer<typeof socialSchema>;

// ─── Platform config ──────────────────────────────────────────
const PLATFORMS = [
  { value: 'YOUTUBE', label: 'YouTube', icon: Youtube, color: 'text-red-400' },
  { value: 'INSTAGRAM', label: 'Instagram', icon: Instagram, color: 'text-pink-400' },
  { value: 'TWITTER', label: 'Twitter / X', icon: Twitter, color: 'text-sky-400' },
  { value: 'TIKTOK', label: 'TikTok', icon: Music, color: 'text-white' },
  { value: 'FACEBOOK', label: 'Facebook', icon: Globe, color: 'text-blue-400' },
  { value: 'TWITCH', label: 'Twitch', icon: Globe, color: 'text-purple-400' },
  { value: 'SPOTIFY', label: 'Spotify', icon: Music, color: 'text-green-400' },
];

// ─── Trust score card ─────────────────────────────────────────
const TRUST_LEVEL_CONFIG: Record<string, { label: string; color: string; bg: string; bar: string }> = {
  NEW:      { label: 'New',      color: 'text-zinc-400',   bg: 'bg-zinc-500/10',   bar: 'bg-zinc-500'   },
  LOW:      { label: 'Low',      color: 'text-red-400',    bg: 'bg-red-500/10',    bar: 'bg-red-500'    },
  MEDIUM:   { label: 'Medium',   color: 'text-yellow-400', bg: 'bg-yellow-500/10', bar: 'bg-yellow-500' },
  HIGH:     { label: 'High',     color: 'text-green-400',  bg: 'bg-green-500/10',  bar: 'bg-green-500'  },
  VERIFIED: { label: 'Verified', color: 'text-brand-400',  bg: 'bg-brand-500/10',  bar: 'bg-brand-500'  },
};

interface TrustScore {
  score: number;
  level: string;
  completionRate: number;
  accountAgeDays: number;
  verifiedSocials: number;
  reportCount: number;
  abuseFlagCount: number;
}

interface Referee {
  id: string;
  username: string;
  displayName: string | null;
  createdAt: string;
}

interface ReferralItem {
  id: string;
  isQualified: boolean;
  qualifiedAt: string | null;
  creditsAwarded: number;
  createdAt: string;
  referee: Referee;
}

interface MyReferralsData {
  total: number;
  qualified: number;
  pending: number;
  totalCreditsEarned: number;
  referrals: ReferralItem[];
}

function TrustScoreCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['trust', 'me'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<TrustScore>>('anti-abuse/trust/me');
      return res.data.data;
    },
  });

  const cfg = TRUST_LEVEL_CONFIG[data?.level ?? 'NEW'] ?? TRUST_LEVEL_CONFIG.NEW;

  return (
    <div className="card-glass rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-zinc-400" />
          <h2 className="text-sm font-semibold text-white">Trust Score</h2>
        </div>
        {data && (
          <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.color}`}>
            {cfg.label}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="h-10 animate-pulse bg-zinc-800 rounded-lg" />
      ) : data ? (
        <>
          <div className="flex items-center gap-3 mb-3">
            <span className={`text-3xl font-bold ${cfg.color}`}>{Math.round(data.score)}</span>
            <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${cfg.bar}`}
                style={{ width: `${data.score}%` }}
              />
            </div>
            <span className="text-xs text-zinc-600">/ 100</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-500">
            <span>Completion rate: <span className="text-zinc-300">{Math.round(data.completionRate * 100)}%</span></span>
            <span>Account age: <span className="text-zinc-300">{data.accountAgeDays}d</span></span>
            <span>Linked socials: <span className="text-zinc-300">{data.verifiedSocials}</span></span>
            <span>Reports received: <span className={data.reportCount > 0 ? 'text-red-400' : 'text-zinc-300'}>{data.reportCount}</span></span>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ─── My Referrals Card ──────────────────────────────────────
function MyReferralsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['referrals', 'me'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<MyReferralsData>>('referrals/me');
      return res.data.data;
    },
  });

  return (
    <div className="card-glass rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Users className="w-4 h-4 text-brand-400" />
        <h2 className="font-semibold text-white">My Referrals</h2>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <div className="h-16 animate-pulse bg-zinc-800 rounded-lg" />
          <div className="h-32 animate-pulse bg-zinc-800 rounded-lg" />
        </div>
      ) : data ? (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Users className="w-3.5 h-3.5 text-zinc-400" />
                <span className="text-xs text-zinc-500">Invited</span>
              </div>
              <span className="text-lg font-semibold text-white">{data.total}</span>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <UserCheck className="w-3.5 h-3.5 text-green-400" />
                <span className="text-xs text-zinc-500">Qualified</span>
              </div>
              <span className="text-lg font-semibold text-green-400">{data.qualified}</span>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Clock className="w-3.5 h-3.5 text-yellow-400" />
                <span className="text-xs text-zinc-500">Pending</span>
              </div>
              <span className="text-lg font-semibold text-yellow-400">{data.pending}</span>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Coins className="w-3.5 h-3.5 text-brand-400" />
                <span className="text-xs text-zinc-500">Earned</span>
              </div>
              <span className="text-lg font-semibold text-brand-400">{data.totalCreditsEarned}</span>
            </div>
          </div>

          {/* Explanation */}
          <div className="rounded-lg bg-brand-500/5 border border-brand-500/10 p-3 mb-4">
            <p className="text-xs text-zinc-400 leading-relaxed">
              <span className="text-brand-300 font-medium">How it works:</span>{' '}
              When someone signs up with your code and completes their first verified task, both you and they earn{' '}
              <span className="text-brand-300">50 credits</span> each. Bonuses are awarded automatically — no manual claiming needed.
            </p>
          </div>

          {/* Referral list */}
          {data.referrals.length > 0 ? (
            <div className="border-t border-surface-border pt-4">
              <p className="text-xs font-medium text-zinc-500 mb-3">Invited users</p>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {data.referrals.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-lg bg-zinc-800/30 px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-medium text-zinc-300">
                        {(r.referee.displayName ?? r.referee.username).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm text-white font-medium">
                          @{r.referee.username}
                        </p>
                        <p className="text-[10px] text-zinc-500">
                          Joined {new Date(r.referee.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    {r.isQualified ? (
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/10 text-green-400 text-xs font-medium">
                        <UserCheck className="w-3 h-3" />
                        <span>+{r.creditsAwarded}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-400 text-xs font-medium">
                        <Clock className="w-3 h-3" />
                        <span>Pending</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="border-t border-surface-border pt-4 text-center">
              <p className="text-xs text-zinc-500">
                No referrals yet. Share your code to start earning!
              </p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────
export default function ProfilePage() {
  const { user, updateUser } = useAuthStore();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [showSocialForm, setShowSocialForm] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [avatarUploadError, setAvatarUploadError] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCanShare(!!navigator.share);
  }, []);

  // Clean up object URL on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (avatarPreview && avatarPreview.startsWith('blob:')) {
        URL.revokeObjectURL(avatarPreview);
      }
    };
  }, [avatarPreview]);

  // ─── Fetch full profile ────────────────────────────────────
  const { data: profile, isLoading } = useQuery({
    queryKey: ['users', 'me'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<FullProfile>>('users/me');
      return res.data.data;
    },
  });

  // ─── Profile form ──────────────────────────────────────────
  const profileForm = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: '',
      bio: '',
      avatarUrl: '',
      websiteUrl: '',
      location: '',
    },
  });

  useEffect(() => {
    if (profile) {
      profileForm.reset({
        displayName: profile.displayName ?? '',
        bio: profile.bio ?? '',
        avatarUrl: profile.avatarUrl ?? '',
        websiteUrl: profile.profile?.websiteUrl ?? '',
        location: profile.profile?.location ?? '',
        allowMentions: profile.profile?.allowMentions ?? true,
      });
    }
  }, [profile, profileForm]);

  const profileMutation = useMutation({
    mutationFn: (data: ProfileFormData) =>
      apiClient.patch<ApiResponse<FullProfile>>('users/me', {
        displayName: data.displayName || undefined,
        bio: data.bio || undefined,
        avatarUrl: data.avatarUrl || undefined,
        websiteUrl: data.websiteUrl || undefined,
        location: data.location || undefined,
        allowMentions: data.allowMentions,
      }),
    onSuccess: (res) => {
      const updated = res.data.data;
      updateUser({
        displayName: updated.displayName,
        avatarUrl: updated.avatarUrl,
      });
      void queryClient.invalidateQueries({ queryKey: ['users', 'me'] });
      setProfileSuccess(true);
      setProfileError(null);
      setTimeout(() => setProfileSuccess(false), 3000);
    },
    onError: (err) => setProfileError(getApiErrorMessage(err)),
  });

  // ─── Avatar upload ─────────────────────────────────────────
  const avatarUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiClient.post<ApiResponse<{ avatarUrl: string }>>('uploads/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data.data;
    },
    onSuccess: (data) => {
      profileForm.setValue('avatarUrl', data.avatarUrl);
      setAvatarPreview(data.avatarUrl);
      setAvatarUploadError(null);
    },
    onError: (err) => setAvatarUploadError(getApiErrorMessage(err)),
  });

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setAvatarUploadError('File too large. Max 5MB.');
      return;
    }
    // Show local preview immediately
    const objectUrl = URL.createObjectURL(file);
    setAvatarPreview(objectUrl);
    avatarUploadMutation.mutate(file);
  };

  const handleRemoveAvatar = () => {
    profileForm.setValue('avatarUrl', '');
    setAvatarPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // ─── Password form ─────────────────────────────────────────
  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
  });

  const passwordMutation = useMutation({
    mutationFn: (data: PasswordFormData) =>
      apiClient.patch('users/me/password', {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      }),
    onSuccess: () => {
      passwordForm.reset();
      setPasswordSuccess(true);
      setPasswordError(null);
      setTimeout(() => setPasswordSuccess(false), 3000);
    },
    onError: (err) => setPasswordError(getApiErrorMessage(err)),
  });

  // ─── Social form ───────────────────────────────────────────
  const socialForm = useForm<SocialFormData>({
    resolver: zodResolver(socialSchema),
    defaultValues: { platform: 'YOUTUBE', platformUsername: '', profileUrl: '' },
  });

  const socialMutation = useMutation({
    mutationFn: (data: SocialFormData) =>
      apiClient.put('users/me/social', {
        platform: data.platform,
        platformUsername: data.platformUsername,
        profileUrl: data.profileUrl || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users', 'me'] });
      socialForm.reset({ platform: 'YOUTUBE', platformUsername: '', profileUrl: '' });
      setShowSocialForm(false);
      setSocialError(null);
    },
    onError: (err) => setSocialError(getApiErrorMessage(err)),
  });

  const removeSocialMutation = useMutation({
    mutationFn: (platform: string) => apiClient.delete(`users/me/social/${platform}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users', 'me'] }),
  });

  // ─── Copy referral code ────────────────────────────────────
  const copyReferral = () => {
    const code = profile?.referralCode ?? user?.referralCode;
    if (!code) return;
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ─── Share referral link ──────────────────────────────────
  const getReferralUrl = () => {
    const code = profile?.referralCode ?? user?.referralCode;
    return `${window.location.origin}/register?ref=${code ?? ''}`;
  };

  const getShareText = () => {
    const code = profile?.referralCode ?? user?.referralCode;
    return `Join Engganyo and earn credits by completing tasks! Use my referral code ${code ?? ''} to sign up:`;
  };

  const handleNativeShare = async () => {
    try {
      await navigator.share({
        title: 'Join Engganyo',
        text: getShareText(),
        url: getReferralUrl(),
      });
    } catch {
      // User cancelled or share failed — no action needed
    }
  };

  const displayName = profile?.displayName ?? user?.displayName ?? user?.username ?? '?';
  const initials = displayName.charAt(0).toUpperCase();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Profile</h1>
        <p className="text-zinc-400 text-sm mt-1">Manage your public creator profile.</p>
      </div>

      {/* ── Avatar + header ── */}
      <div className="card-glass rounded-xl p-6 flex items-start gap-4 flex-wrap">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 flex items-center justify-center text-white text-2xl font-bold shrink-0">
          {avatarPreview || profile?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarPreview || profile?.avatarUrl || ''} alt={displayName} className="w-16 h-16 rounded-full object-cover" />
          ) : (
            initials
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold text-white truncate">{displayName}</p>
          <p className="text-zinc-400 text-sm truncate">@{profile?.username ?? user?.username}</p>
          <p className="text-zinc-500 text-xs truncate">{profile?.email ?? user?.email}</p>

          {/* VIP Tier Badge */}
          {(profile?.vipTier ?? user?.vipTier) ? (
            <div className="flex items-center gap-2 mt-2">
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold"
                style={{
                  backgroundColor: `${(profile?.vipTier ?? user?.vipTier)?.perks.color}22`,
                  color: (profile?.vipTier ?? user?.vipTier)?.perks.color,
                  border: `1px solid ${(profile?.vipTier ?? user?.vipTier)?.perks.color}44`,
                }}
              >
                <Award className="w-3 h-3" />
                {(profile?.vipTier ?? user?.vipTier)?.displayName}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-zinc-700/50 text-zinc-400 border border-zinc-600/50">
                <Award className="w-3 h-3" />
                No VIP Tier — earn VP to unlock
              </span>
            </div>
          )}

          {/* VP Progress */}
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-zinc-400">VIP Points</span>
              <span className="text-zinc-300 font-medium">{profile?.vp ?? user?.vp ?? 0} VP</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-700/50 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-500 transition-all"
                style={{ width: `${Math.min((profile?.vp ?? user?.vp ?? 0) / 100 * 100, 100)}%` }}
              />
            </div>
          </div>

          <Link
            href={`/users/${profile?.username ?? user?.username}`}
            className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-lg bg-zinc-700/50 border border-zinc-600 text-zinc-300 text-xs hover:bg-zinc-700 hover:text-white transition-all"
          >
            <ExternalLink className="w-3 h-3" />
            View Public Profile
          </Link>
        </div>
      </div>

      {/* ── Trust score card ── */}
      <TrustScoreCard />

      {/* ── Refer & Earn ── */}
      <div className="card-glass rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Share2 className="w-4 h-4 text-brand-400" />
          <h2 className="font-semibold text-white">Refer & Earn</h2>
        </div>
        <p className="text-sm text-zinc-400 mb-4">
          Invite friends and earn credits when they sign up and complete their first verified task. Both you and your friend get 50 credits each — awarded automatically.
        </p>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-4">
          <button
            onClick={copyReferral}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 text-sm font-mono hover:bg-brand-500/20 transition-all"
          >
            {profile?.referralCode ?? user?.referralCode ?? '—'}
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <span className="text-xs text-zinc-500">Tap to copy your referral code</span>
        </div>

        <div className="border-t border-surface-border pt-4">
          <p className="text-xs text-zinc-500 mb-3">Share your link:</p>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`${getShareText()} ${getReferralUrl()}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-500/10 text-green-400 text-xs font-medium hover:bg-green-500/20 transition-all"
            >
              <span className="text-sm">WA</span> WhatsApp
            </a>
            <a
              href={`https://t.me/share/url?url=${encodeURIComponent(getReferralUrl())}&text=${encodeURIComponent(getShareText())}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-500/10 text-sky-400 text-xs font-medium hover:bg-sky-500/20 transition-all"
            >
              <span className="text-sm">TG</span> Telegram
            </a>
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`${getShareText()} ${getReferralUrl()}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-500/10 text-zinc-300 text-xs font-medium hover:bg-zinc-500/20 transition-all"
            >
              <Twitter className="w-3.5 h-3.5" /> X / Twitter
            </a>
            <a
              href={`mailto:?subject=${encodeURIComponent('Join me on Engganyo')}&body=${encodeURIComponent(`${getShareText()} ${getReferralUrl()}`)}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-500/10 text-zinc-300 text-xs font-medium hover:bg-zinc-500/20 transition-all"
            >
              <Mail className="w-3.5 h-3.5" /> Email
            </a>
            {canShare && (
              <button
                onClick={() => void handleNativeShare()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-500/10 text-brand-400 text-xs font-medium hover:bg-brand-500/20 transition-all"
              >
                <Share2 className="w-3.5 h-3.5" /> More
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── My Referrals stats & list ── */}
      <MyReferralsCard />

      {/* ── Edit profile form ── */}
      <div className="card-glass rounded-xl p-6">
        <h2 className="font-semibold text-white mb-5">Edit Profile</h2>

        {profileError && (
          <div className="mb-4 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {profileError}
          </div>
        )}
        {profileSuccess && (
          <div className="mb-4 px-4 py-2.5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm">
            Profile updated successfully.
          </div>
        )}

        <form
          onSubmit={profileForm.handleSubmit((d) => profileMutation.mutate(d))}
          className="space-y-4"
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Display name</label>
              <input
                {...profileForm.register('displayName')}
                className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                placeholder="Your name"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Location</label>
              <input
                {...profileForm.register('location')}
                className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                placeholder="City, Country"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Bio</label>
            <textarea
              {...profileForm.register('bio')}
              rows={3}
              className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
              placeholder="Tell other creators about yourself..."
            />
            {profileForm.formState.errors.bio && (
              <p className="text-xs text-red-400 mt-1">{profileForm.formState.errors.bio.message}</p>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Website URL</label>
              <input
                {...profileForm.register('websiteUrl')}
                className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                placeholder="https://yoursite.com"
              />
              {profileForm.formState.errors.websiteUrl && (
                <p className="text-xs text-red-400 mt-1">{profileForm.formState.errors.websiteUrl.message}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Avatar</label>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 flex items-center justify-center text-white text-sm font-bold shrink-0 overflow-hidden">
                  {avatarPreview || profileForm.watch('avatarUrl') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarPreview || profileForm.watch('avatarUrl') || ''} alt="Avatar" className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    initials
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    onChange={handleAvatarSelect}
                    className="hidden"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={avatarUploadMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-hover border border-surface-border text-zinc-300 text-xs hover:bg-surface-hover hover:text-white transition-all disabled:opacity-50"
                    >
                      {avatarUploadMutation.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Upload className="w-3 h-3" />
                      )}
                      Upload
                    </button>
                    {(avatarPreview || profileForm.watch('avatarUrl')) && (
                      <button
                        type="button"
                        onClick={handleRemoveAvatar}
                        className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-zinc-500 hover:text-red-400 text-xs transition-colors"
                        title="Remove avatar"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {avatarUploadError && (
                <p className="text-xs text-red-400 mt-1">{avatarUploadError}</p>
              )}
              <p className="text-[10px] text-zinc-600 mt-1">PNG, JPG, JPEG, WebP. Max 5MB.</p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <input
              {...profileForm.register('allowMentions')}
              type="checkbox"
              id="allowMentions"
              className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-brand-500 focus:ring-brand-500 focus:ring-offset-0"
            />
            <label htmlFor="allowMentions" className="text-sm text-zinc-300 cursor-pointer">
              Allow others to mention me in forum posts
            </label>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={profileMutation.isPending}
              className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-sm font-medium px-5 py-2 rounded-lg transition-all"
            >
              {profileMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save changes
            </button>
          </div>
        </form>
      </div>

      {/* ── Social accounts ── */}
      <div className="card-glass rounded-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-white">Social Accounts</h2>
          <button
            onClick={() => setShowSocialForm(!showSocialForm)}
            className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add account
          </button>
        </div>

        {showSocialForm && (
          <form
            onSubmit={socialForm.handleSubmit((d) => socialMutation.mutate(d))}
            className="mb-5 p-4 rounded-lg bg-surface-hover border border-surface-border space-y-3"
          >
            {socialError && (
              <p className="text-xs text-red-400">{socialError}</p>
            )}
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Platform</label>
                <select
                  {...socialForm.register('platform')}
                  className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {PLATFORMS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Username / Handle</label>
                <input
                  {...socialForm.register('platformUsername')}
                  className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="@handle"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Profile URL (optional)</label>
                <input
                  {...socialForm.register('profileUrl')}
                  className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="https://..."
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowSocialForm(false)}
                className="text-xs text-zinc-500 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={socialMutation.isPending}
                className="flex items-center gap-1.5 text-xs bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition-all"
              >
                {socialMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                Save
              </button>
            </div>
          </form>
        )}

        {profile?.socialAccounts && Array.isArray(profile.socialAccounts) && profile.socialAccounts.length > 0 ? (
          <div className="space-y-2">
            {profile.socialAccounts.map((acct) => {
              const platformCfg = PLATFORMS.find((p) => p.value === acct.platform);
              const Icon = platformCfg?.icon ?? Globe;
              return (
                <div
                  key={acct.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg bg-surface-hover border border-surface-border"
                >
                  <Icon className={`w-4 h-4 shrink-0 ${platformCfg?.color ?? 'text-zinc-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">{platformCfg?.label ?? acct.platform}</p>
                    <p className="text-xs text-zinc-500 truncate">{acct.platformUsername}</p>
                  </div>
                  {acct.isVerified && (
                    <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">
                      Verified
                    </span>
                  )}
                  <button
                    onClick={() => removeSocialMutation.mutate(acct.platform)}
                    disabled={removeSocialMutation.isPending}
                    className="text-zinc-600 hover:text-red-400 transition-colors ml-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No social accounts linked yet.</p>
        )}
      </div>

      {/* ── Change password ── */}
      <div className="card-glass rounded-xl p-6">
        <div className="flex items-center gap-2 mb-5">
          <Lock className="w-4 h-4 text-zinc-400" />
          <h2 className="font-semibold text-white">Change Password</h2>
        </div>

        {passwordError && (
          <div className="mb-4 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {passwordError}
          </div>
        )}
        {passwordSuccess && (
          <div className="mb-4 px-4 py-2.5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm">
            Password changed successfully.
          </div>
        )}

        <form
          onSubmit={passwordForm.handleSubmit((d) => passwordMutation.mutate(d))}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Current password</label>
            <input
              {...passwordForm.register('currentPassword')}
              type="password"
              className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
            {passwordForm.formState.errors.currentPassword && (
              <p className="text-xs text-red-400 mt-1">{passwordForm.formState.errors.currentPassword.message}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">New password</label>
            <input
              {...passwordForm.register('newPassword')}
              type="password"
              className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
            {passwordForm.formState.errors.newPassword && (
              <p className="text-xs text-red-400 mt-1">{passwordForm.formState.errors.newPassword.message}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Confirm new password</label>
            <input
              {...passwordForm.register('confirmPassword')}
              type="password"
              className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
            {passwordForm.formState.errors.confirmPassword && (
              <p className="text-xs text-red-400 mt-1">{passwordForm.formState.errors.confirmPassword.message}</p>
            )}
          </div>
          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={passwordMutation.isPending}
              className="flex items-center gap-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-60 text-white text-sm font-medium px-5 py-2 rounded-lg transition-all"
            >
              {passwordMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Update password
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
