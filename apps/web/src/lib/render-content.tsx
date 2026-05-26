import React from 'react';
import Link from 'next/link';
import { Megaphone } from 'lucide-react';

interface CampaignMention {
  id: string;
  title: string;
  status: string;
}

// Parse campaign mentions from content in format: @[campaign-title](campaign:id)
export function parseCampaignMentions(content: string): {
  text: string;
  mentions: CampaignMention[];
} {
  const mentionRegex = /@\[([^\]]+)\]\(campaign:([a-zA-Z0-9-]+)\)/g;
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

// Render content with campaign mentions as clickable links
export function renderContentWithMentions(
  content: string,
  campaignData?: Map<string, { id: string; title: string; status: string }>
): React.ReactNode {
  if (!content) return null;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const mentionRegex = /@\[([^\]]+)\]\(campaign:([a-zA-Z0-9-]+)\)/g;
  let match;

  while ((match = mentionRegex.exec(content)) !== null) {
    // Add text before the mention
    if (match.index > lastIndex) {
      parts.push(content.substring(lastIndex, match.index));
    }

    const campaignTitle = match[1];
    const campaignId = match[2];
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
      // Fallback if campaign data not available
      parts.push(
        <span key={campaignId} className="text-zinc-400">
          @{campaignTitle}
        </span>
      );
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
