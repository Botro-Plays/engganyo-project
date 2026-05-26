'use client';

import { useState, useRef, useEffect } from 'react';
import { Megaphone, User } from 'lucide-react';

interface Campaign {
  id: string;
  title: string;
  status: string;
}

interface User {
  id: string;
  username: string;
  displayName: string | null;
}

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  campaigns: Campaign[];
  onUserSearch?: (query: string) => Promise<User[]>;
  placeholder?: string;
  rows?: number;
  className?: string;
  currentUserRole?: string;
}

type MentionType = 'campaign' | 'user' | null;

export function MentionTextarea({
  value,
  onChange,
  campaigns,
  onUserSearch,
  placeholder = 'Type ! for campaigns, @ for users...',
  rows = 3,
  className = '',
  currentUserRole = 'USER',
}: MentionTextareaProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionType, setMentionType] = useState<MentionType>(null);
  const [searchedUsers, setSearchedUsers] = useState<User[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const filteredCampaigns = campaigns.filter((campaign) =>
    campaign.title.toLowerCase().includes(filter.toLowerCase())
  );

  const currentSuggestions = mentionType === 'campaign' ? filteredCampaigns : searchedUsers;
  const currentCount = currentSuggestions.length;

  // Search users when filter changes for user mentions
  useEffect(() => {
    if (mentionType === 'user' && filter.length >= 2 && onUserSearch) {
      onUserSearch(filter).then(setSearchedUsers);
    } else if (mentionType === 'campaign') {
      setSearchedUsers([]);
    }
  }, [filter, mentionType, onUserSearch]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPosition = e.target.selectionStart;
    
    const textBeforeCursor = newValue.substring(0, cursorPosition);
    const lastExclamationIndex = textBeforeCursor.lastIndexOf('!');
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    // Determine which trigger is more recent
    const exclamationPos = lastExclamationIndex === -1 ? -1 : lastExclamationIndex;
    const atPos = lastAtIndex === -1 ? -1 : lastAtIndex;
    
    const lastTriggerIndex = Math.max(exclamationPos, atPos);
    const triggerChar = exclamationPos > atPos ? '!' : '@';
    
    if (lastTriggerIndex !== -1) {
      // Check if trigger is at the start of line or preceded by space
      const charBeforeTrigger = textBeforeCursor[lastTriggerIndex - 1];
      if (!charBeforeTrigger || charBeforeTrigger === ' ' || charBeforeTrigger === '\n') {
        const mentionText = textBeforeCursor.substring(lastTriggerIndex + 1);
        // Only trigger if mention text is short (no spaces)
        if (!mentionText.includes(' ') && mentionText.length <= 50) {
          setFilter(mentionText);
          setMentionStart(lastTriggerIndex);
          setMentionType(triggerChar === '!' ? 'campaign' : 'user');
          setShowSuggestions(true);
          setSelectedIndex(0);
        } else {
          setShowSuggestions(false);
          setMentionStart(null);
          setMentionType(null);
        }
      } else {
        setShowSuggestions(false);
        setMentionStart(null);
        setMentionType(null);
      }
    } else {
      setShowSuggestions(false);
      setMentionStart(null);
      setMentionType(null);
    }

    onChange(newValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showSuggestions) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % currentCount);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + currentCount) % currentCount);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (currentCount > 0) {
        if (mentionType === 'campaign') {
          selectCampaign(currentSuggestions[selectedIndex] as Campaign);
        } else {
          selectUser(currentSuggestions[selectedIndex] as User);
        }
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setMentionStart(null);
      setMentionType(null);
    }
  };

  const selectCampaign = (campaign: Campaign) => {
    if (mentionStart === null) return;

    const textBeforeMention = value.substring(0, mentionStart);
    const textAfterCursor = value.substring(textareaRef.current?.selectionStart || 0);
    
    // Insert campaign mention in format: ![campaign-title](campaign:id)
    const mention = `![${campaign.title}](campaign:${campaign.id})`;
    const newValue = textBeforeMention + mention + ' ' + textAfterCursor;
    
    onChange(newValue);
    setShowSuggestions(false);
    setMentionStart(null);
    setMentionType(null);
    setFilter('');

    // Move cursor after the mention
    setTimeout(() => {
      const newCursorPosition = textBeforeMention.length + mention.length + 1;
      textareaRef.current?.setSelectionRange(newCursorPosition, newCursorPosition);
      textareaRef.current?.focus();
    }, 0);
  };

  const selectUser = (user: User) => {
    if (mentionStart === null) return;

    const textBeforeMention = value.substring(0, mentionStart);
    const textAfterCursor = value.substring(textareaRef.current?.selectionStart || 0);
    
    // Insert user mention in format: @[username](user:id)
    const mention = `@[${user.username}](user:${user.id})`;
    const newValue = textBeforeMention + mention + ' ' + textAfterCursor;
    
    onChange(newValue);
    setShowSuggestions(false);
    setMentionStart(null);
    setMentionType(null);
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
        setMentionType(null);
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
      
      {showSuggestions && currentCount > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute z-10 w-full mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg max-h-60 overflow-y-auto"
        >
          {mentionType === 'campaign' ? (
            filteredCampaigns.map((campaign, index) => (
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
            ))
          ) : (
            searchedUsers.map((user: User, index: number) => (
              <button
                key={user.id}
                type="button"
                onClick={() => selectUser(user)}
                className={`w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-zinc-700 transition-colors ${
                  index === selectedIndex ? 'bg-zinc-700' : ''
                }`}
              >
                <User className="w-4 h-4 text-indigo-400" />
                <div className="flex-1">
                  <div className="text-white text-sm">@{user.username}</div>
                  {user.displayName && (
                    <div className="text-zinc-500 text-xs">{user.displayName}</div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
