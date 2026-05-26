'use client';

import { useState, useRef, useEffect } from 'react';
import { Megaphone } from 'lucide-react';

interface Campaign {
  id: string;
  title: string;
  status: string;
}

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  campaigns: Campaign[];
  placeholder?: string;
  rows?: number;
  className?: string;
}

export function MentionTextarea({
  value,
  onChange,
  campaigns,
  placeholder = 'Type @ to mention your campaigns...',
  rows = 3,
  className = '',
}: MentionTextareaProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const filteredCampaigns = campaigns.filter((campaign) =>
    campaign.title.toLowerCase().includes(filter.toLowerCase())
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPosition = e.target.selectionStart;
    
    // Check if we're typing a mention
    const textBeforeCursor = newValue.substring(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    if (lastAtIndex !== -1) {
      // Check if @ is at the start of line or preceded by space
      const charBeforeAt = textBeforeCursor[lastAtIndex - 1];
      if (!charBeforeAt || charBeforeAt === ' ' || charBeforeAt === '\n') {
        const mentionText = textBeforeCursor.substring(lastAtIndex + 1);
        // Only trigger if mention text is short (no spaces)
        if (!mentionText.includes(' ') && mentionText.length <= 50) {
          setFilter(mentionText);
          setMentionStart(lastAtIndex);
          setShowSuggestions(true);
          setSelectedIndex(0);
        } else {
          setShowSuggestions(false);
          setMentionStart(null);
        }
      } else {
        setShowSuggestions(false);
        setMentionStart(null);
      }
    } else {
      setShowSuggestions(false);
      setMentionStart(null);
    }

    onChange(newValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showSuggestions) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredCampaigns.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredCampaigns.length) % filteredCampaigns.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCampaigns.length > 0) {
        selectCampaign(filteredCampaigns[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setMentionStart(null);
    }
  };

  const selectCampaign = (campaign: Campaign) => {
    if (mentionStart === null) return;

    const textBeforeMention = value.substring(0, mentionStart);
    const textAfterCursor = value.substring(textareaRef.current?.selectionStart || 0);
    
    // Insert campaign mention in format: @[campaign-title](campaign-id)
    const mention = `@[${campaign.title}](campaign:${campaign.id})`;
    const newValue = textBeforeMention + mention + ' ' + textAfterCursor;
    
    onChange(newValue);
    setShowSuggestions(false);
    setMentionStart(null);
    setFilter('');

    // Move cursor after the mention
    setTimeout(() => {
      const newCursorPosition = textBeforeMention.length + mention.length + 1;
      textareaRef.current?.setSelectionRange(newCursorPosition, newCursorPosition);
      textareaRef.current?.focus();
    }, 0);
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
        setMentionStart(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        className={`w-full bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 resize-none ${className}`}
      />
      
      {showSuggestions && filteredCampaigns.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute z-10 w-full mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg max-h-60 overflow-y-auto"
        >
          {filteredCampaigns.map((campaign, index) => (
            <button
              key={campaign.id}
              type="button"
              onClick={() => selectCampaign(campaign)}
              className={`w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-zinc-700 transition-colors ${
                index === selectedIndex ? 'bg-zinc-700' : ''
              }`}
            >
              <Megaphone className={`w-4 h-4 ${
                campaign.status === 'ACTIVE' || campaign.status === 'PENDING_REVIEW'
                  ? 'text-green-400'
                  : 'text-zinc-400'
              }`} />
              <div className="flex-1">
                <div className="text-white text-sm">{campaign.title}</div>
                <div className="text-zinc-500 text-xs">{campaign.status}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
