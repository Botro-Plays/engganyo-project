'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send, User, Clock, ChevronLeft, ChevronRight, Loader2, AlertTriangle, Trash2, X, RotateCcw } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import type { ApiResponse } from '@/types';

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  isHuman: boolean;
  createdAt: string;
}

interface ChatConversation {
  id: string;
  userId: string | null;
  ipAddress: string | null;
  status: string;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    username: string;
    email: string;
    displayName: string | null;
  } | null;
  messages: ChatMessage[];
  agent: {
    id: string;
    username: string;
    displayName: string | null;
  } | null;
}

const STATUS_COLORS: Record<string, string> = {
  AI_HANDLING: 'text-blue-400 bg-blue-500/10',
  PENDING_HUMAN: 'text-yellow-400 bg-yellow-500/10',
  HUMAN_HANDLING: 'text-green-400 bg-green-500/10',
  CLOSED: 'text-zinc-400 bg-zinc-500/10',
};

export default function AdminAiSupportPage() {
  const { user: currentAdmin } = useAuthStore();
  const queryClient = useQueryClient();
  const [selectedChat, setSelectedChat] = useState<ChatConversation | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [page, setPage] = useState(1);

  const { data: chatsData, isLoading: isLoadingChats } = useQuery({
    queryKey: ['admin', 'chats', page],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<ChatConversation[]>>(
        'chat/admin/list',
      );
      return res.data.data;
    },
  });

  const transferMutation = useMutation({
    mutationFn: (chatId: string) =>
      apiClient.patch(`chat/admin/${chatId}/transfer`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'chats'] });
      if (selectedChat) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'chat', selectedChat.id] });
      }
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: ({ chatId, message }: { chatId: string; message: string }) =>
      apiClient.post(`chat/admin/${chatId}/send`, { message }),
    onSuccess: () => {
      setMessageInput('');
      if (selectedChat) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'chat', selectedChat.id] });
      }
    },
  });

  const closeMutation = useMutation({
    mutationFn: (chatId: string) =>
      apiClient.patch(`chat/admin/${chatId}/close`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'chats'] });
      if (selectedChat) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'chat', selectedChat.id] });
      }
    },
  });

  const reopenMutation = useMutation({
    mutationFn: (chatId: string) =>
      apiClient.patch(`chat/admin/${chatId}/reopen`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'chats'] });
      if (selectedChat) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'chat', selectedChat.id] });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (chatId: string) =>
      apiClient.delete(`chat/admin/${chatId}`),
    onSuccess: () => {
      setSelectedChat(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'chats'] });
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: () =>
      apiClient.delete('chat/admin/all'),
    onSuccess: () => {
      setSelectedChat(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'chats'] });
    },
  });

  const { data: selectedChatData, isLoading: isLoadingChat } = useQuery({
    queryKey: ['admin', 'chat', selectedChat?.id],
    queryFn: async () => {
      if (!selectedChat) return null;
      const res = await apiClient.get<ApiResponse<ChatConversation>>(
        `chat/admin/${selectedChat.id}`,
      );
      return res.data.data;
    },
    enabled: !!selectedChat,
  });

  const handleTransfer = (chatId: string) => {
    if (confirm('Take over this conversation?')) {
      transferMutation.mutate(chatId);
    }
  };

  const handleSendMessage = () => {
    if (!messageInput.trim() || !selectedChat) return;
    sendMessageMutation.mutate({
      chatId: selectedChat.id,
      message: messageInput.trim(),
    });
  };

  const handleClose = (chatId: string) => {
    if (confirm('Close this conversation?')) {
      closeMutation.mutate(chatId);
    }
  };

  const handleReopen = (chatId: string) => {
    if (confirm('Reopen this conversation?')) {
      reopenMutation.mutate(chatId);
    }
  };

  const handleDelete = (chatId: string) => {
    if (confirm('Delete this conversation? This action cannot be undone.')) {
      deleteMutation.mutate(chatId);
    }
  };

  const handleDeleteAll = () => {
    if (confirm('Delete ALL conversations? This action cannot be undone.')) {
      deleteAllMutation.mutate();
    }
  };

  const currentChat = selectedChatData || selectedChat;

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">AI Support</h1>
          <p className="text-zinc-400">Manage and respond to AI chat conversations</p>
        </div>
        <button
          onClick={handleDeleteAll}
          disabled={deleteAllMutation.isPending}
          className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/30 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {deleteAllMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <Trash2 className="w-4 h-4 inline mr-2" />
              Delete All
            </>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chat List */}
        <div className="lg:col-span-1 bg-surface border border-surface-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-surface-border">
            <h2 className="font-semibold text-white">Conversations</h2>
          </div>
          
          {isLoadingChats ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
            </div>
          ) : (
            <div className="divide-y divide-surface-border max-h-[600px] overflow-y-auto">
              {chatsData?.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => setSelectedChat(chat)}
                  className={`w-full p-4 text-left hover:bg-surface-hover transition-colors ${
                    selectedChat?.id === chat.id ? 'bg-surface-hover' : ''
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-zinc-500" />
                      <span className="text-sm font-medium text-white">
                        {chat.user?.username || 'Anonymous'}
                      </span>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[chat.status]}`}>
                      {chat.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500 flex items-center gap-2">
                    <Clock className="w-3 h-3" />
                    {formatDate(chat.createdAt)}
                  </div>
                  {chat.agent && (
                    <div className="text-xs text-zinc-500 mt-1">
                      Assigned to: {chat.agent.displayName || chat.agent.username}
                    </div>
                  )}
                </button>
              ))}
              
              {chatsData?.length === 0 && (
                <div className="p-8 text-center text-zinc-500">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No conversations yet</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Chat Detail */}
        <div className="lg:col-span-2 bg-surface border border-surface-border rounded-xl overflow-hidden flex flex-col h-[600px]">
          {currentChat ? (
            <>
              {/* Header */}
              <div className="p-4 border-b border-surface-border flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-white">
                    {currentChat.user?.username || 'Anonymous User'}
                  </h3>
                  <p className="text-xs text-zinc-500">
                    {currentChat.user?.email || currentChat.ipAddress || 'Unknown'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {currentChat.status === 'AI_HANDLING' && (
                    <button
                      onClick={() => handleTransfer(currentChat.id)}
                      disabled={transferMutation.isPending}
                      className="px-3 py-1.5 bg-brand-500 hover:bg-brand-600 disabled:bg-surface-border text-white text-sm rounded-lg transition-colors"
                    >
                      {transferMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        'Take Over'
                      )}
                    </button>
                  )}
                  {currentChat.status === 'CLOSED' && (
                    <button
                      onClick={() => handleReopen(currentChat.id)}
                      disabled={reopenMutation.isPending}
                      className="px-3 py-1.5 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/30 text-sm rounded-lg transition-colors"
                    >
                      {reopenMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <RotateCcw className="w-4 h-4 inline mr-1" />
                          Reopen
                        </>
                      )}
                    </button>
                  )}
                  {currentChat.status !== 'CLOSED' && (
                    <button
                      onClick={() => handleClose(currentChat.id)}
                      disabled={closeMutation.isPending}
                      className="px-3 py-1.5 bg-zinc-500/10 hover:bg-zinc-500/20 text-zinc-400 border border-zinc-500/30 text-sm rounded-lg transition-colors"
                    >
                      {closeMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <X className="w-4 h-4 inline mr-1" />
                          Close
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(currentChat.id)}
                    disabled={deleteMutation.isPending}
                    className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-sm rounded-lg transition-colors"
                  >
                    {deleteMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4 inline mr-1" />
                        Delete
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {isLoadingChat ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
                  </div>
                ) : (
                  currentChat.messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === 'USER' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                          msg.role === 'USER'
                            ? 'bg-surface-hover text-zinc-300'
                            : msg.isHuman
                            ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30'
                            : 'bg-surface-hover text-zinc-300'
                        }`}
                      >
                        {msg.isHuman && (
                          <p className="text-xs text-brand-400 mb-1 font-medium">
                            You
                          </p>
                        )}
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                        <p className="text-xs text-zinc-500 mt-1">
                          {formatDate(msg.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Input */}
              {currentChat.status === 'HUMAN_HANDLING' && (
                <div className="p-4 border-t border-surface-border">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                      placeholder="Type your response..."
                      className="flex-1 bg-surface-hover border border-surface-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500/50 transition-colors"
                      disabled={sendMessageMutation.isPending}
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={!messageInput.trim() || sendMessageMutation.isPending}
                      className="p-2.5 bg-brand-500 hover:bg-brand-600 disabled:bg-surface-border disabled:text-zinc-500 text-white rounded-xl transition-colors"
                    >
                      {sendMessageMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500">
              <div className="text-center">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>Select a conversation to view</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
