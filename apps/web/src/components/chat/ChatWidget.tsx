'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Minimize2, Maximize2, RefreshCw } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { apiClient } from '@/lib/api';
import type { ApiResponse } from '@/types';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  isHuman?: boolean;
}

interface ChatResponse {
  message: string;
  conversationId: string;
  isHuman: boolean;
  status?: string;
}

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { user, isAuthenticated } = useAuthStore();

  const quickActions = [
    'How does Engganyo work?',
    'How do I earn credits?',
    'How do I create a campaign?',
    'What platforms are supported?',
  ];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const startNewConversation = () => {
    setMessages([]);
    setConversationId(null);
    setInput('');
  };

  const handleQuickAction = (action: string) => {
    setInput(action);
    // Pass the action directly since state update is async
    sendMessageWithMessage(action);
  };

  const sendMessageWithMessage = async (message?: string) => {
    const userMessage = (message || input).trim();
    if (!userMessage || isLoading) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const res = await apiClient.post<ApiResponse<ChatResponse>>('chat', {
        message: userMessage,
        conversationId: conversationId || undefined,
      });

      const data = res.data.data;
      
      setConversationId(data.conversationId);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.message, isHuman: data.isHuman },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = () => {
    sendMessageWithMessage();
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 left-6 sm:right-6 sm:left-auto z-50 bg-brand-500 hover:bg-brand-600 text-white p-4 rounded-full shadow-lg shadow-brand-500/30 transition-all hover:scale-105"
        aria-label="Open chat"
      >
        <MessageSquare className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 left-6 sm:right-6 sm:left-auto z-50 w-[calc(100%-3rem)] sm:w-96 max-h-[80vh] flex flex-col bg-surface border border-surface-border rounded-2xl shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-surface-border bg-surface-hover">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-brand-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white text-sm">Engganyo Support</h3>
            <p className="text-xs text-zinc-500">
              {isAuthenticated ? 'Online' : 'Guest'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={startNewConversation}
            className="p-1.5 rounded-lg hover:bg-surface-border text-zinc-400 hover:text-white transition-colors"
            aria-label="New conversation"
            title="New conversation"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1.5 rounded-lg hover:bg-surface-border text-zinc-400 hover:text-white transition-colors"
            aria-label={isMinimized ? 'Maximize' : 'Minimize'}
          >
            {isMinimized ? (
              <Maximize2 className="w-4 h-4" />
            ) : (
              <Minimize2 className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-lg hover:bg-surface-border text-zinc-400 hover:text-white transition-colors"
            aria-label="Close chat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[300px] max-h-[50vh]">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-brand-500/20 flex items-center justify-center mx-auto mb-3">
                  <MessageSquare className="w-6 h-6 text-brand-400" />
                </div>
                <p className="text-zinc-400 text-sm mb-1">Hi there! 👋</p>
                <p className="text-zinc-500 text-xs mb-4">
                  How can I help you with Engganyo today?
                </p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {quickActions.map((action) => (
                    <button
                      key={action}
                      onClick={() => handleQuickAction(action)}
                      className="px-3 py-1.5 text-xs bg-surface-hover border border-surface-border rounded-lg text-zinc-400 hover:text-white hover:border-brand-500/50 transition-colors"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                    msg.role === 'user'
                      ? 'bg-brand-500 text-white'
                      : 'bg-surface-hover text-zinc-300'
                  }`}
                >
                  {msg.isHuman && (
                    <p className="text-xs text-brand-400 mb-1 font-medium">
                      Support Agent
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-surface-hover rounded-2xl px-4 py-2.5 text-sm text-zinc-500">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce delay-100" />
                    <div className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce delay-200" />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-surface-border">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type your message..."
                className="flex-1 bg-surface-hover border border-surface-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500/50 transition-colors"
                disabled={isLoading}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className="p-2.5 bg-brand-500 hover:bg-brand-600 disabled:bg-surface-border disabled:text-zinc-500 text-white rounded-xl transition-colors"
                aria-label="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
