import React from 'react';
import Link from 'next/link';
import { Megaphone } from 'lucide-react';

interface CampaignMention {
  id: string;
  title: string;
  status: string;
}

// Parse campaign mentions from content in format: ![campaign-title](campaign:id)
export function parseCampaignMentions(content: string): {
  text: string;
  mentions: CampaignMention[];
} {
  const mentionRegex = /!\[([^\]]+)\]\(campaign:([a-zA-Z0-9-]+)\)/g;
  const mentions: CampaignMention[] = [];
  let match;

  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push({
      id: match[2],
      title: match[1],
      status: 'ACTIVE', // Will be updated when we fetch campaign data
    });
  }

  return { text: content, mentions };
}

// Parse user mentions from content in format: @[username](user:id)
export function parseUserMentions(content: string): {
  text: string;
  mentions: { id: string; username: string }[];
} {
  const mentionRegex = /@\[([^\]]+)\]\(user:([a-zA-Z0-9-]+)\)/g;
  const mentions: { id: string; username: string }[] = [];
  let match;

  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push({
      id: match[2],
      username: match[1],
    });
  }

  return { text: content, mentions };
}

// Render content with campaign and user mentions as clickable links
export function renderContentWithMentions(
  content: string,
  campaignData?: Map<string, { id: string; title: string; status: string }>,
  userData?: Map<string, { id: string; username: string; displayName: string | null }>
): React.ReactNode {
  if (!content) return null;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  
  // Combined regex for both campaign (!) and user (@) mentions
  const mentionRegex = /(!\[([^\]]+)\]\(campaign:([a-zA-Z0-9-]+)\)|@\[([^\]]+)\]\(user:([a-zA-Z0-9-]+)\))/g;
  let match;

  while ((match = mentionRegex.exec(content)) !== null) {
    // Add text before the mention
    if (match.index > lastIndex) {
      parts.push(content.substring(lastIndex, match.index));
    }

    const isCampaign = match[1].startsWith('!');
    
    if (isCampaign) {
      // Campaign mention: ![title](campaign:id)
      const campaignTitle = match[2];
      const campaignId = match[3];
      const campaign = campaignData?.get(campaignId);

      if (campaign) {
        parts.push(
          <Link
            key={campaignId}
            href={`/campaigns/${campaignId}`}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
              campaign.status === 'ACTIVE' || campaign.status === 'PENDING_REVIEW'
                ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30'
                : 'bg-zinc-500/20 text-zinc-400 border border-zinc-500/30 hover:bg-zinc-500/30'
            }`}
          >
            <Megaphone className="w-3 h-3" />
            {campaign.title}
          </Link>
        );
      } else {
        parts.push(
          <span key={campaignId} className="text-zinc-400">
            !{campaignTitle}
          </span>
        );
      }
    } else {
      // User mention: @[username](user:id)
      const username = match[4];
      const userId = match[5];
      const user = userData?.get(userId);

      if (user) {
        parts.push(
          <Link
            key={userId}
            href={`/users/${userId}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30"
          >
            @{user.displayName || user.username}
          </Link>
        );
      } else {
        parts.push(
          <span key={userId} className="text-zinc-400">
            @{username}
          </span>
        );
      }
    }

    lastIndex = mentionRegex.lastIndex;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    parts.push(content.substring(lastIndex));
  }

  return (
    <div className="whitespace-pre-wrap leading-relaxed">
      {parts.map((part, index) => (
        <React.Fragment key={index}>{part}</React.Fragment>
      ))}
    </div>
  );
}
