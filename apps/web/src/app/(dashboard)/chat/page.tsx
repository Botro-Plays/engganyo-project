'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { connectChannelSocket, disconnectChannelSocket } from '@/lib/channel-socket';
import { useToast } from '@/components/toast-provider';
import { formatRelativeTime } from '@/lib/utils';
import {
  Send,
  Users,
  Gift,
  Crown,
  Hash,
  Loader2,
  ChevronLeft,
  Lock,
  AlertTriangle,
  Flag,
  X,
} from 'lucide-react';
import Link from 'next/link';

// ─── Types ───────────────────────────────────────────────────

interface Channel {
  id: string;
  name: string;
  slug: string;
  type: string;
  description: string | null;
  memberCount: number;
  messageCount: number;
  isMember: boolean;
  myRole: string | null;
  joinedAt: string | null;
}

interface ChatMessage {
  id: string;
  channelId: string;
  userId: string;
  content: string;
  isDeleted: boolean;
  createdAt: string;
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    vipTier: {
      name: string;
      displayName: string;
      color: string;
      badge: string;
    } | null;
  };
  tip: { amount: number } | null;
}

interface ApiResponse<T> {
  data: T;
}

// ─── Component ────────────────────────────────────────────────

export default function ChatPage() {
  const { user, isAuthenticated, accessToken } = useAuthStore();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionSuggestions, setMentionSuggestions] = useState<Array<{ id: string; username: string; displayName: string | null; avatarUrl: string | null; allowMentions: boolean }>>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [showMentions, setShowMentions] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [tipModal, setTipModal] = useState<{ messageId: string; toUserId: string } | null>(null);
  const [tipAmount, setTipAmount] = useState(100);
  const [reportModal, setReportModal] = useState<{ messageId: string; userId: string; username: string } | null>(null);
  const [reportReason, setReportReason] = useState('HARASSMENT');
  const [reportDescription, setReportDescription] = useState('');
  const [mobileShowList, setMobileShowList] = useState(true);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ─── Fetch channels ────────────────────────────────────────
  const { data: channels, isLoading: channelsLoading } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<Channel[]>>('channels');
      return res.data.data;
    },
    enabled: isAuthenticated,
  });

  const activeChannel = channels?.find((c) => c.id === activeChannelId) ?? null;

  // ─── Fetch messages for active channel ────────────────────
  const { data: initialMessages, isLoading: messagesLoading } = useQuery({
    queryKey: ['channels', 'messages', activeChannelId],
    queryFn: async () => {
      if (!activeChannelId) return [];
      const res = await apiClient.get<ApiResponse<ChatMessage[]>>(`channels/${activeChannelId}/messages?limit=50`);
      return res.data.data;
    },
    enabled: !!activeChannelId && isAuthenticated,
  });

  // Sync initial messages into local state
  useEffect(() => {
    if (initialMessages) {
      setMessages(initialMessages);
    }
  }, [initialMessages]);

  // ─── Socket setup ──────────────────────────────────────────
  useEffect(() => {
    if (!accessToken || !isAuthenticated) return;

    const socket = connectChannelSocket(accessToken);

    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);

    const onMessage = (msg: ChatMessage) => {
      setMessages((prev) => {
        // Prevent duplicate messages
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    };

    const onTyping = ({ userId: uid, isTyping }: { userId: string; isTyping: boolean }) => {
      setTypingUsers((prev) => {
        const next = new Set(prev);
        if (isTyping) next.add(uid);
        else next.delete(uid);
        return next;
      });
    };

    const onTipReceived = (tip: { fromUserId: string; amount: number }) => {
      addToast(`You received ${tip.amount} credits!`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    };

    const onRainReceived = (rain: { fromUsername: string; amount: number }) => {
      addToast(`🌧️ You caught a rain! ${rain.fromUsername} sent you ${rain.amount} credits!`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('chat:message', onMessage);
    socket.on('chat:typing', onTyping);
    socket.on('tip:received', onTipReceived);
    socket.on('rain:received', onRainReceived);

    if (socket.connected) setSocketConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('chat:message', onMessage);
      socket.off('chat:typing', onTyping);
      socket.off('tip:received', onTipReceived);
      socket.off('rain:received', onRainReceived);
      disconnectChannelSocket();
    };
  }, [accessToken, isAuthenticated, queryClient, addToast]);

  // Auto-join active channel via socket
  useEffect(() => {
    if (!activeChannelId || !socketConnected) return;
    const socket = connectChannelSocket(accessToken ?? '');
    socket.emit('channel:join', { channelId: activeChannelId });
  }, [activeChannelId, socketConnected, accessToken]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ─── Send message mutation ────────────────────────────────
  const sendMessageMutation = useMutation({
    mutationFn: async ({ channelId, content }: { channelId: string; content: string }) => {
      const res = await apiClient.post<ApiResponse<ChatMessage>>('channels/messages', { channelId, content });
      return res.data.data;
    },
    onSuccess: (msg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      setInput('');
    },
    onError: (err) => addToast(getApiErrorMessage(err), 'error'),
  });

  // ─── Join channel mutation ────────────────────────────────
  const joinMutation = useMutation({
    mutationFn: async (channelId: string) => {
      const res = await apiClient.post<ApiResponse<{ success: boolean }>>('channels/join', { channelId });
      return res.data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
    onError: (err) => addToast(getApiErrorMessage(err), 'error'),
  });

  // ─── Send tip mutation ────────────────────────────────────
  const tipMutation = useMutation({
    mutationFn: async (dto: { toUserId: string; amount: number; messageId?: string }) => {
      const res = await apiClient.post<ApiResponse<unknown>>('channels/tips', dto);
      return res.data.data;
    },
    onSuccess: () => {
      addToast('Tip sent successfully!', 'success');
      setTipModal(null);
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError: (err) => addToast(getApiErrorMessage(err), 'error'),
  });

  // ─── Report mutation ───────────────────────────────────────
  const reportMutation = useMutation({
    mutationFn: async (dto: { messageId: string; reason: string; description: string }) => {
      const res = await apiClient.post<ApiResponse<unknown>>('anti-abuse/reports', {
        messageId: dto.messageId,
        reason: dto.reason,
        description: dto.description,
      });
      return res.data.data;
    },
    onSuccess: () => {
      addToast('Report submitted. Thank you for helping keep the community safe.', 'success');
      setReportModal(null);
      setReportDescription('');
    },
    onError: (err) => addToast(getApiErrorMessage(err), 'error'),
  });

  // ─── Handlers ──────────────────────────────────────────────

  const handleSend = useCallback(() => {
    if (!activeChannelId || !input.trim()) return;
    if (!activeChannel?.isMember) {
      addToast('Join the channel to send messages', 'error');
      return;
    }
    sendMessageMutation.mutate({ channelId: activeChannelId, content: input.trim() });

    // Emit typing stop
    const socket = connectChannelSocket(accessToken ?? '');
    socket.emit('chat:typing', { channelId: activeChannelId, isTyping: false });
  }, [activeChannelId, input, activeChannel, sendMessageMutation, accessToken, addToast]);

  const handleInputChange = async (value: string) => {
    setInput(value);

    // Detect @mention
    const lastAtIndex = value.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const afterAt = value.slice(lastAtIndex + 1);
      const spaceIndex = afterAt.indexOf(' ');
      const query = spaceIndex === -1 ? afterAt : afterAt.slice(0, spaceIndex);
      if (query.length >= 2 && spaceIndex === -1) {
        setMentionQuery(query);
        try {
          const res = await apiClient.get<ApiResponse<Array<{ id: string; username: string; displayName: string | null; avatarUrl: string | null; allowMentions: boolean }>>>(
            `channels/users/search?q=${encodeURIComponent(query)}&limit=5`,
          );
          setMentionSuggestions(res.data.data.filter((u) => u.allowMentions));
          setMentionIndex(0);
          setShowMentions(true);
        } catch {
          setShowMentions(false);
        }
      } else {
        setShowMentions(false);
      }
    } else {
      setShowMentions(false);
    }

    if (!activeChannelId || !socketConnected) return;

    const socket = connectChannelSocket(accessToken ?? '');
    socket.emit('chat:typing', { channelId: activeChannelId, isTyping: true });

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('chat:typing', { channelId: activeChannelId, isTyping: false });
    }, 2000);
  };

  const insertMention = (username: string) => {
    const lastAtIndex = input.lastIndexOf('@');
    const before = input.slice(0, lastAtIndex);
    const after = input.slice(lastAtIndex + 1 + mentionQuery.length);
    setInput(`${before}@${username} ${after}`);
    setShowMentions(false);
    inputRef.current?.focus();
  };

  const handleSelectChannel = (channel: Channel) => {
    setActiveChannelId(channel.id);
    setMessages([]);
    setMobileShowList(false);
    if (!channel.isMember) {
      joinMutation.mutate(channel.id);
    }
  };

  const canTip = user?.vipTier?.perks.canTip ?? false;

  // ─── Render ────────────────────────────────────────────────

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-zinc-400">Please sign in to access chat.</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] -mx-4 -my-6">
      {/* ── Channel List (Sidebar) ── */}
      <div
        className={`${
          mobileShowList ? 'flex' : 'hidden'
        } md:flex w-full md:w-64 border-r border-white/5 flex-col bg-surface`}
      >
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
          <h2 className="font-bold text-white flex items-center gap-2">
            <Hash className="w-4 h-4 text-brand-400" />
            Channels
          </h2>
          {!socketConnected && (
            <span className="text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">Offline</span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {channelsLoading ? (
            <div className="flex justify-center p-4">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
            </div>
          ) : !channels?.length ? (
            <p className="text-zinc-500 text-sm p-4 text-center">No channels available.</p>
          ) : (
            channels.map((ch) => (
              <button
                key={ch.id}
                onClick={() => handleSelectChannel(ch)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                  activeChannelId === ch.id
                    ? 'bg-brand-500/20 text-brand-300'
                    : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  {ch.type === 'VIP' && <Crown className="w-3.5 h-3.5 text-amber-400" />}
                  {ch.type === 'PRIVATE' && <Lock className="w-3.5 h-3.5 text-zinc-500" />}
                  <span className="truncate font-medium">{ch.name}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-zinc-500">
                  <Users className="w-3 h-3" />
                  {ch.memberCount}
                  {!ch.isMember && <span className="text-brand-400">· Join</span>}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Chat Area ── */}
      <div className={`${mobileShowList ? 'hidden' : 'flex'} md:flex flex-1 flex-col bg-background`}>
        {!activeChannel ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Hash className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
              <p className="text-zinc-400 text-sm">Select a channel to start chatting.</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-4 py-3 border-b border-white/5 flex items-center gap-3">
              <button
                onClick={() => setMobileShowList(true)}
                className="md:hidden text-zinc-400 hover:text-white"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  {activeChannel.type === 'VIP' && <Crown className="w-4 h-4 text-amber-400" />}
                  <h3 className="font-semibold text-white">{activeChannel.name}</h3>
                </div>
                <p className="text-xs text-zinc-500">
                  {activeChannel.memberCount} members · {activeChannel.description ?? 'General discussion'}
                </p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {messagesLoading && messages.length === 0 ? (
                <div className="flex justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
                </div>
              ) : messages.length === 0 ? (
                <p className="text-center text-zinc-600 text-sm">No messages yet. Be the first to say hello!</p>
              ) : (
                messages.map((msg) => (
                  <div key={msg.id} className="flex gap-3 group">
                    {/* Avatar */}
                    <div className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                      {msg.user.displayName?.[0] ?? msg.user.username[0] ?? '?'}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-zinc-200">
                          {msg.user.displayName ?? msg.user.username}
                        </span>
                        {msg.user.vipTier && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase"
                            style={{
                              backgroundColor: msg.user.vipTier.color + '20',
                              color: msg.user.vipTier.color,
                            }}
                          >
                            {msg.user.vipTier.badge}
                          </span>
                        )}
                        <span className="text-[10px] text-zinc-600">
                          {formatRelativeTime(msg.createdAt)}
                        </span>
                      </div>

                      <p className={`text-sm mt-0.5 ${msg.isDeleted ? 'text-zinc-600 italic' : 'text-zinc-300'}`}>
                        {msg.content}
                      </p>

                      {msg.tip && (
                        <div className="flex items-center gap-1 mt-1 text-amber-400 text-xs">
                          <Gift className="w-3 h-3" />
                          Tipped {msg.tip.amount} credits
                        </div>
                      )}

                      {/* Tip + Report buttons */}
                      {!msg.isDeleted && msg.userId !== user?.id && (
                        <div className="flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {canTip && (
                            <button
                              onClick={() => setTipModal({ messageId: msg.id, toUserId: msg.userId })}
                              className="text-[10px] text-zinc-600 hover:text-brand-400 flex items-center gap-0.5"
                            >
                              <Gift className="w-3 h-3" />
                              Tip
                            </button>
                          )}
                          <button
                            onClick={() => setReportModal({ messageId: msg.id, userId: msg.userId, username: msg.user.username })}
                            className="text-[10px] text-zinc-600 hover:text-red-400 flex items-center gap-0.5"
                          >
                            <Flag className="w-3 h-3" />
                            Report
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}

              {/* Typing indicator */}
              {typingUsers.size > 0 && (
                <div className="flex items-center gap-2 text-xs text-zinc-500 px-12">
                  <div className="flex gap-0.5">
                    <span className="w-1 h-1 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1 h-1 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1 h-1 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  Someone is typing...
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-white/5">
              {!activeChannel.isMember ? (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  Join this channel to send messages.
                  <button
                    onClick={() => joinMutation.mutate(activeChannel.id)}
                    disabled={joinMutation.isPending}
                    className="ml-auto text-brand-400 hover:text-brand-300 font-medium"
                  >
                    {joinMutation.isPending ? 'Joining...' : 'Join Now'}
                  </button>
                </div>
              ) : (
                <div className="relative flex gap-2">
                  <div className="flex-1 relative">
                    <input
                      ref={inputRef}
                      type="text"
                      value={input}
                      onChange={(e) => handleInputChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (showMentions) {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setMentionIndex((i) => (i + 1) % mentionSuggestions.length);
                            return;
                          }
                          if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setMentionIndex((i) => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length);
                            return;
                          }
                          if (e.key === 'Enter' || e.key === 'Tab') {
                            e.preventDefault();
                            if (mentionSuggestions[mentionIndex]) {
                              insertMention(mentionSuggestions[mentionIndex].username);
                            }
                            return;
                          }
                          if (e.key === 'Escape') {
                            setShowMentions(false);
                            return;
                          }
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      placeholder="Type a message... Use @username to mention"
                      className="w-full bg-surface-hover border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-brand-500/50"
                      maxLength={2000}
                    />
                    {/* Mention dropdown */}
                    {showMentions && mentionSuggestions.length > 0 && (
                      <div className="absolute bottom-full left-0 mb-1 w-full bg-surface border border-white/10 rounded-lg shadow-xl overflow-hidden z-20">
                        {mentionSuggestions.map((u, i) => (
                          <button
                            key={u.id}
                            onClick={() => insertMention(u.username)}
                            className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm transition-colors ${
                              i === mentionIndex ? 'bg-brand-500/20 text-brand-300' : 'text-zinc-300 hover:bg-white/5'
                            }`}
                          >
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-brand-400 to-purple-500 flex items-center justify-center text-white text-[10px] font-bold">
                              {u.displayName?.[0] ?? u.username[0]}
                            </div>
                            <span className="font-medium">{u.displayName ?? u.username}</span>
                            <span className="text-zinc-500 text-xs">@{u.username}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handleSend}
                    disabled={sendMessageMutation.isPending || !input.trim()}
                    className="px-4 py-2.5 bg-brand-500 hover:bg-brand-400 disabled:opacity-40 disabled:hover:bg-brand-500 text-white rounded-lg transition-colors"
                  >
                    {sendMessageMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Tip Modal ── */}
      {tipModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-white/10 rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-white mb-1">Send Tip</h3>
            <p className="text-sm text-zinc-400 mb-4">Show appreciation with credits.</p>

            <div className="mb-4">
              <label className="text-xs text-zinc-500 mb-1 block">Amount (credits)</label>
              <input
                type="number"
                value={tipAmount}
                onChange={(e) => setTipAmount(Math.max(10, Math.min(10000, parseInt(e.target.value) || 10)))}
                className="w-full bg-surface-hover border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500/50"
                min={10}
                max={10000}
              />
              <p className="text-[10px] text-zinc-600 mt-1">Min: 10 · Max: 10,000 · Balance: {user?.creditBalance ?? 0}</p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setTipModal(null)}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  tipMutation.mutate({
                    toUserId: tipModal.toUserId,
                    amount: tipAmount,
                    messageId: tipModal.messageId,
                  })
                }
                disabled={tipMutation.isPending || (user?.creditBalance ?? 0) < tipAmount}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-brand-500 hover:bg-brand-400 disabled:opacity-40 text-white transition-colors"
              >
                {tipMutation.isPending ? 'Sending...' : `Tip ${tipAmount}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Report Modal ── */}
      {reportModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-white/10 rounded-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-bold text-white">Report Message</h3>
              <button onClick={() => setReportModal(null)} className="text-zinc-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-zinc-400 mb-4">Report @{reportModal.username} for moderation review.</p>

            <div className="mb-3">
              <label className="text-xs text-zinc-500 mb-1 block">Reason</label>
              <select
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                className="w-full bg-surface-hover border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500/50"
              >
                <option value="HARASSMENT">Harassment</option>
                <option value="INAPPROPRIATE_CONTENT">Inappropriate Content</option>
                <option value="SPAM_CAMPAIGN">Spam</option>
                <option value="BOT_ACTIVITY">Bot Activity</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            <div className="mb-4">
              <label className="text-xs text-zinc-500 mb-1 block">Description</label>
              <textarea
                value={reportDescription}
                onChange={(e) => setReportDescription(e.target.value)}
                placeholder="Describe the issue..."
                className="w-full bg-surface-hover border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-brand-500/50 resize-none"
                rows={3}
                maxLength={1000}
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setReportModal(null)}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  reportMutation.mutate({
                    messageId: reportModal.messageId,
                    reason: reportReason,
                    description: reportDescription || 'No additional description provided.',
                  })
                }
                disabled={reportMutation.isPending || reportDescription.length < 10}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-red-500 hover:bg-red-400 disabled:opacity-40 text-white transition-colors"
              >
                {reportMutation.isPending ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
