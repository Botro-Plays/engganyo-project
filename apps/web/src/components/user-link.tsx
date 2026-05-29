'use client';

import Link from 'next/link';
import { getInitials } from '@/lib/utils';

interface UserLinkProps {
  user: {
    id?: string;
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  };
  showAvatar?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export function UserLink({ user, showAvatar = true, size = 'sm', className }: UserLinkProps) {
  const name = user.displayName ?? user.username;
  const avatarSize = size === 'md' ? 'w-8 h-8 text-xs' : 'w-6 h-6 text-[10px]';

  return (
    <Link
      href={`/users/${user.username}`}
      className={`inline-flex items-center gap-2 hover:opacity-80 transition-opacity ${className ?? ''}`}
    >
      {showAvatar && (
        <div
          className={`${avatarSize} rounded-full bg-gradient-brand flex items-center justify-center text-white font-bold shrink-0 overflow-hidden`}
        >
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt={name} className="w-full h-full object-cover" />
          ) : (
            getInitials(name)
          )}
        </div>
      )}
      <span className="text-sm font-medium text-white truncate">{name}</span>
      {user.displayName && (
        <span className="text-xs text-zinc-500 hidden sm:inline">@{user.username}</span>
      )}
    </Link>
  );
}
