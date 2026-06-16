/**
 * Cosmetic style resolver — turns equipped cosmetics into CSS classes/styles
 * for profile cards (themes) and avatars (frames).
 */

export interface EquippedCosmetic {
  id: string;
  equipped: boolean;
  item: {
    id: string;
    name: string;
    category: string;
    metadata: Record<string, unknown>;
  };
}

export interface CosmeticStyles {
  /** CSS classes for the profile card wrapper */
  themeCardClass: string;
  /** CSS classes for the avatar wrapper */
  frameClass: string;
  /** Inline styles for avatar glow/shadow */
  frameStyle: React.CSSProperties;
}

const THEME_STYLES: Record<string, CosmeticStyles['themeCardClass']> = {
  neon: 'bg-gradient-to-br from-violet-900/40 via-purple-900/30 to-fuchsia-900/20 border border-violet-500/40 shadow-[0_0_20px_rgba(139,92,246,0.15)]',
  cyber: 'bg-gradient-to-br from-cyan-900/40 via-teal-900/30 to-emerald-900/20 border border-cyan-500/40 shadow-[0_0_20px_rgba(34,211,238,0.15)]',
  sunset: 'bg-gradient-to-br from-orange-900/40 via-rose-900/30 to-pink-900/20 border border-orange-500/40 shadow-[0_0_20px_rgba(251,146,60,0.15)]',
  midnight: 'bg-gradient-to-br from-slate-800/60 via-zinc-800/40 to-neutral-800/20 border border-slate-400/30 shadow-[0_0_20px_rgba(148,163,184,0.15)]',
};

const FRAME_STYLES: Record<string, { cls: string; style: React.CSSProperties }> = {
  gold: {
    cls: 'ring-2 ring-amber-400/70 ring-offset-2 ring-offset-zinc-900/50',
    style: { boxShadow: '0 0 12px rgba(251,191,36,0.35)' },
  },
  silver: {
    cls: 'ring-2 ring-slate-300/70 ring-offset-2 ring-offset-zinc-900/50',
    style: { boxShadow: '0 0 12px rgba(203,213,225,0.35)' },
  },
  diamond: {
    cls: 'ring-2 ring-cyan-300/70 ring-offset-2 ring-offset-zinc-900/50',
    style: { boxShadow: '0 0 12px rgba(103,232,249,0.35)' },
  },
  ruby: {
    cls: 'ring-2 ring-rose-500/70 ring-offset-2 ring-offset-zinc-900/50',
    style: { boxShadow: '0 0 12px rgba(244,63,94,0.35)' },
  },
};

/**
 * Resolve cosmetic styles from equipped cosmetics array.
 * Picks the first equipped theme and first equipped frame.
 */
export function resolveCosmeticStyles(cosmetics: EquippedCosmetic[] | undefined): CosmeticStyles {
  const theme = cosmetics?.find((c) => {
    const meta = c.item.metadata as Record<string, unknown>;
    return meta['cosmeticType'] === 'profile_theme';
  });

  const frame = cosmetics?.find((c) => {
    const meta = c.item.metadata as Record<string, unknown>;
    return meta['cosmeticType'] === 'avatar_frame';
  });

  const themeMeta = theme?.item.metadata as Record<string, unknown> | undefined;
  const themeStyle = (themeMeta?.['style'] as string | undefined) ?? 'neon';
  const themeCardClass = THEME_STYLES[themeStyle] ?? THEME_STYLES['neon'];

  const frameMeta = frame?.item.metadata as Record<string, unknown> | undefined;
  const frameStyle = (frameMeta?.['style'] as string | undefined) ?? 'gold';
  const frameDef = FRAME_STYLES[frameStyle] ?? FRAME_STYLES['gold'];

  return {
    themeCardClass,
    frameClass: frameDef.cls,
    frameStyle: frameDef.style,
  };
}
