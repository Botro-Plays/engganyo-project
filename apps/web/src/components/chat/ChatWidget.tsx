'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, X, Send, Minimize2, Maximize2, RefreshCw, GripVertical } from 'lucide-react';
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

const STORAGE_KEY = 'chat-widget-pos';
const EDGE_MARGIN = 8;
const DESKTOP_QUERY = '(min-width: 640px)';

type Pos = { x: number; y: number };

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

function loadPos(): Pos {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Pos>;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        Number.isFinite(parsed.x) &&
        Number.isFinite(parsed.y)
      ) {
        return { x: parsed.x as number, y: parsed.y as number };
      }
    }
  } catch { /* ignore */ }
  return { x: 0, y: 0 };
}

function savePos(pos: Pos) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
}

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [aboveMobileNav, setAboveMobileNav] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  // ── Draggable dock offset (desktop only); mobile ignores pos and uses a sheet ──
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const widgetRef = useRef<HTMLElement | null>(null);
  const posRef = useRef<Pos>({ x: 0, y: 0 });
  const dragOffset = useRef<Pos>({ x: 0, y: 0 });
  const dragStartPos = useRef<Pos | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const { user, isAuthenticated } = useAuthStore();

  const quickActions = [
    'How does Engganyo work?',
    'How do I earn credits?',
    'How do I create a campaign?',
    'What platforms are supported?',
  ];

  // Keep posRef in sync for use inside listeners that must not rebind per render.
  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  // Clamp an offset so the widget's rect stays fully inside the viewport
  // (minus EDGE_MARGIN). The base rect is the docked rect with the current
  // transform removed.
  const clampToViewport = useCallback((candidate: Pos): Pos => {
    const el = widgetRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const left = r.left - posRef.current.x;
    const top = r.top - posRef.current.y;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      x: clamp(candidate.x, EDGE_MARGIN - left, vw - EDGE_MARGIN - r.width - left),
      y: clamp(candidate.y, EDGE_MARGIN - top, vh - EDGE_MARGIN - r.height - top),
    };
  }, []);

  // Desktop/mobile tracking (drag + persisted offset apply on desktop only).
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Track the ACTUAL visible viewport. On browsers where the layout
  // viewport doesn't shrink for the software keyboard, the sheet's
  // bottom edge is lifted by the occluded strip so the composer stays
  // reachable; its height is also capped to what's really visible.
  const [vv, setVv] = useState({ height: 0, offsetTop: 0 });
  useEffect(() => {
    const el = window.visualViewport;
    if (!el) return;
    const update = () => {
      setVv({ height: el.height, offsetTop: el.offsetTop });
      if (document.querySelector('nav[aria-label="Mobile navigation"]')) {
        setAboveMobileNav(el.height > 340);
      }
    };
    update();
    el.addEventListener('resize', update);
    el.addEventListener('scroll', update);
    return () => {
      el.removeEventListener('resize', update);
      el.removeEventListener('scroll', update);
    };
  }, []);

  const kbInset =
    !isDesktop && vv.height > 0
      ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      : 0;
  const sheetMaxH =
    !isDesktop && vv.height > 0
      ? Math.max(Math.min(vv.height - 16, window.innerHeight * 0.85), 160)
      : undefined;

  // Load + recover the persisted offset once the widget exists, and re-clamp
  // on resize/orientation change. Invalid or unreachable offsets collapse to
  // the docked position.
  useEffect(() => {
    const recover = () => {
      setPos((current) => {
        const candidate = current.x === 0 && current.y === 0 ? loadPos() : current;
        const next = clampToViewport(candidate);
        if (next.x !== candidate.x || next.y !== candidate.y) savePos(next);
        return next;
      });
    };
    recover();
    window.addEventListener('resize', recover);
    window.addEventListener('orientationchange', recover);
    return () => {
      window.removeEventListener('resize', recover);
      window.removeEventListener('orientationchange', recover);
    };
  }, [clampToViewport, isOpen]);

  const scrollToBottom = () => {
    // Scroll the message container directly — scrollIntoView could also
    // pull the underlying page when the sheet opens mid-document.
    const el = messagesEndRef.current?.parentElement;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  const startNewConversation = () => {
    setMessages([]);
    setConversationId(null);
    setInput('');
  };

  const handleQuickAction = (action: string) => {
    setInput(action);
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

  const close = useCallback(() => {
    setIsOpen(false);
    // Return focus to the launcher so keyboard users don't lose their place.
    requestAnimationFrame(() => launcherRef.current?.focus({ preventScroll: true }));
  }, []);

  // Focus the composer on open and let Escape close the panel/sheet.
  useEffect(() => {
    if (!isOpen) return;
    // The dashboard mobile nav is a fixed z-50 strip at the bottom edge.
    // Lift the sheet above it so the composer is never overlapped — but
    // only when the visible viewport has room; when the keyboard leaves
    // very little space the sheet falls back to covering the nav so the
    // composer stays reachable instead of being pushed off-screen.
    const nav = document.querySelector('nav[aria-label="Mobile navigation"]');
    const vvH = window.visualViewport?.height ?? window.innerHeight;
    setAboveMobileNav(!!nav && vvH > 340);
    inputRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Drag handlers (desktop only, distance-based click vs drag, clamped) ──
  const startDrag = (clientX: number, clientY: number) => {
    if (!isDesktop) return;
    setIsDragging(true);
    dragOffset.current = { x: clientX - posRef.current.x, y: clientY - posRef.current.y };
    dragStartPos.current = { x: clientX, y: clientY };
  };

  const onDrag = useCallback(
    (clientX: number, clientY: number) => {
      const raw = { x: clientX - dragOffset.current.x, y: clientY - dragOffset.current.y };
      setPos(clampToViewport(raw));
    },
    [clampToViewport],
  );

  const endDrag = useCallback(() => {
    setIsDragging((dragging) => {
      if (dragging) savePos(posRef.current);
      return false;
    });
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => onDrag(e.clientX, e.clientY);
    const onMouseUp = () => endDrag();
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) onDrag(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onTouchEnd = () => endDrag();

    if (isDragging) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onTouchEnd);
    }
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [isDragging, onDrag, endDrag]);

  // Mobile ignores pos entirely (launcher + sheet are fixed); desktop applies
  // the clamped dock offset.
  const dragStyle: React.CSSProperties = isDesktop
    ? { transform: `translate(${pos.x}px, ${pos.y}px)` }
    : {};

  const isInteractiveTarget = (e: React.MouseEvent | React.TouchEvent) => {
    const target = e.target as HTMLElement;
    return !!target.closest('button, input, textarea, a, select, [data-no-drag]');
  };

  const isClick = (clientX: number, clientY: number) => {
    if (!dragStartPos.current) return true;
    const dx = clientX - dragStartPos.current.x;
    const dy = clientY - dragStartPos.current.y;
    return Math.sqrt(dx * dx + dy * dy) < 5;
  };

  // z-40 keeps the widget under dialogs/room modals (z-50), the mobile nav,
  // and the cookie consent bar (z-[60]) — those always take precedence.
  if (!isOpen) {
    return (
      <button
        ref={(el) => {
          widgetRef.current = el;
          launcherRef.current = el;
        }}
        onClick={(e) => {
          if (isClick(e.clientX, e.clientY)) setIsOpen(true);
        }}
        onMouseDown={(e) => {
          if (!isDesktop) return;
          e.preventDefault();
          startDrag(e.clientX, e.clientY);
        }}
        style={dragStyle}
        className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-4 z-40 rounded-full bg-brand-500 p-4 text-sc-text shadow-lg shadow-brand-500/30 transition-all hover:scale-105 hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-sc-bg motion-reduce:transition-none sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] sm:left-auto sm:right-6"
        aria-label="Open support chat"
      >
        <MessageSquare className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div
      ref={(el) => {
        widgetRef.current = el;
      }}
      role="dialog"
      aria-label="Engganyo support chat"
      style={{
        ...dragStyle,
        ...(sheetMaxH ? { maxHeight: sheetMaxH } : {}),
        // Lift above the occluded strip when the software keyboard covers
        // the layout viewport's bottom edge (no-op when it resizes instead).
        ['--chat-kb' as string]: `${kbInset}px`,
      }}
      onMouseDown={(e) => {
        if (!isDesktop || isInteractiveTarget(e)) return;
        e.preventDefault();
        startDrag(e.clientX, e.clientY);
      }}
      className={`fixed inset-x-3 flex max-h-[85dvh] flex-col rounded-2xl border border-surface-border bg-surface shadow-2xl sm:inset-x-auto sm:right-6 sm:w-96 sm:max-h-[min(80vh,640px)] sm:z-40 ${
        aboveMobileNav ? 'z-40' : 'z-[60]'
      } ${
        aboveMobileNav
          ? 'bottom-[calc(4.5rem+env(safe-area-inset-bottom)+var(--chat-kb,0px))]'
          : 'bottom-[calc(0.75rem+env(safe-area-inset-bottom)+var(--chat-kb,0px))]'
      } sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))]`}
    >
      {/* Header — drag handle on desktop */}
      <div
        className={`flex items-center justify-between border-b border-surface-border bg-surface-hover p-4 select-none ${
          isDesktop ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
      >
        <div className="flex items-center gap-3">
          {isDesktop && <GripVertical className="h-4 w-4 text-sc-dim" />}
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500/20">
            <MessageSquare className="h-4 w-4 text-brand-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-sc-text">Engganyo Support</h3>
            <p className="text-xs text-sc-dim">
              {isAuthenticated ? 'Online' : 'Guest'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={startNewConversation}
            onMouseDown={(e) => e.stopPropagation()}
            className="rounded-lg p-1.5 text-sc-muted transition-colors hover:bg-surface-border hover:text-sc-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            aria-label="New conversation"
            title="New conversation"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            onMouseDown={(e) => e.stopPropagation()}
            className="rounded-lg p-1.5 text-sc-muted transition-colors hover:bg-surface-border hover:text-sc-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            aria-label={isMinimized ? 'Maximize chat' : 'Minimize chat'}
          >
            {isMinimized ? (
              <Maximize2 className="h-4 w-4" />
            ) : (
              <Minimize2 className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={close}
            onMouseDown={(e) => e.stopPropagation()}
            className="rounded-lg p-1.5 text-sc-muted transition-colors hover:bg-surface-border hover:text-sc-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            aria-label="Close chat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Messages */}
          <div
            className="min-h-0 max-h-[50dvh] flex-1 space-y-4 overflow-y-auto p-4 sm:min-h-[300px]"
            data-no-drag
          >
            {messages.length === 0 && (
              <div className="py-8 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-500/20">
                  <MessageSquare className="h-6 w-6 text-brand-400" />
                </div>
                <p className="mb-1 text-sm text-sc-muted">Hi there! 👋</p>
                <p className="mb-4 text-xs text-sc-dim">
                  How can I help you with Engganyo today?
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {quickActions.map((action) => (
                    <button
                      key={action}
                      onClick={() => handleQuickAction(action)}
                      className="rounded-lg border border-surface-border bg-surface-hover px-3 py-1.5 text-xs text-sc-muted transition-colors hover:border-brand-500/50 hover:text-sc-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
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
                      ? 'bg-brand-500 text-sc-text'
                      : 'bg-surface-hover text-sc-text'
                  }`}
                >
                  {msg.isHuman && (
                    <p className="mb-1 text-xs font-medium text-brand-400">
                      Support Agent
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-surface-hover px-4 py-2.5 text-sm text-sc-dim">
                  <div className="flex gap-1">
                    <div className="h-2 w-2 animate-bounce rounded-full bg-sc-soft" />
                    <div className="h-2 w-2 animate-bounce rounded-full bg-sc-soft delay-100" />
                    <div className="h-2 w-2 animate-bounce rounded-full bg-sc-soft delay-200" />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-surface-border p-4">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type your message..."
                className="flex-1 rounded-xl border border-surface-border bg-surface-hover px-4 py-2.5 text-sm text-sc-text placeholder-sc-dim transition-colors focus:border-brand-500/50 focus:outline-none"
                disabled={isLoading}
                aria-label="Chat message"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className="rounded-xl bg-brand-500 p-2.5 text-sc-text transition-colors hover:bg-brand-600 disabled:bg-surface-border disabled:text-sc-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
