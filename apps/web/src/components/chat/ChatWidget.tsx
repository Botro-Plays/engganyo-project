'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, X, Send, Minimize2, Maximize2, RefreshCw, GripVertical } from 'lucide-react';
import { usePathname } from 'next/navigation';
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
// Mobile keeps its own saved launcher spot, separate from the desktop
// dock offset so neither layout disturbs the other.
const MOBILE_STORAGE_KEY = 'chat-widget-pos-mobile';
const EDGE_MARGIN = 8;
const DESKTOP_QUERY = '(min-width: 640px)';
// Sheet geometry (mobile): the sheet's bottom edge anchors to the lower of
// the mobile-nav top edge and the visual viewport's bottom edge. Its height
// budget is that anchor minus the visual viewport's top edge and margins.
const SHEET_GAP = 8;
const SHEET_TOP_MARGIN = 8;
const SHEET_BASE_CLEARANCE = 12;
const MIN_SHEET_HEIGHT = 160;
const MIN_HEIGHT_FOR_NAV_CLEARANCE = 200;

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

function loadMobilePos(): Pos | null {
  try {
    const raw = localStorage.getItem(MOBILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Pos>;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Number.isFinite(parsed.x) &&
      Number.isFinite(parsed.y)
    ) {
      return { x: parsed.x as number, y: parsed.y as number };
    }
  } catch { /* ignore */ }
  return null;
}

function saveMobilePos(pos: Pos | null) {
  try {
    if (pos === null) localStorage.removeItem(MOBILE_STORAGE_KEY);
    else localStorage.setItem(MOBILE_STORAGE_KEY, JSON.stringify(pos));
  } catch { /* ignore */ }
}

// env(safe-area-inset-bottom) can't be read from JS directly; measure a
// fixed probe with the same bottom value.
function measureSafeAreaInsetBottom(): number {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;bottom:env(safe-area-inset-bottom);left:0;width:0;height:0;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const inset = Math.max(0, window.innerHeight - probe.getBoundingClientRect().bottom);
  probe.remove();
  return inset;
}

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  // Computed mobile sheet geometry: px bottom offset, px max height, and
  // whether the sheet rests above the nav (vs covering it when cramped).
  const [sheetGeom, setSheetGeom] = useState<{
    bottom: number;
    maxHeight: number;
    aboveNav: boolean;
  } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  // ── Draggable dock offset (desktop only); mobile ignores pos and uses a sheet ──
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 });
  // Mobile launcher position: {x,y} = fixed left/top in layout-viewport
  // px. null = the default docked corner (classes place it).
  const [mPos, setMPos] = useState<Pos | null>(null);
  const mPosRef = useRef<Pos | null>(null);
  const mDragGrab = useRef<Pos>({ x: 0, y: 0 });
  const mDragLast = useRef<Pos | null>(null);
  const mDragging = useRef(false);
  // The one pointer id driving the current mobile gesture; move/end
  // events from any other pointer are ignored so they cannot interfere.
  const mPointerId = useRef<number | null>(null);
  // Set once a gesture travels past the tap threshold; the trailing
  // click is then swallowed so a drag never opens chat. Keyboard Enter
  // clicks (clientX/Y 0) are unaffected because this stays false.
  const movedRef = useRef(false);
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
  useEffect(() => {
    mPosRef.current = mPos;
  }, [mPos]);

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

  // Clamp an absolute {left,top} launcher spot: fully inside the visual
  // viewport minus margins, and always above the mobile nav's top edge
  // (or the safe-area-adjusted viewport bottom when no nav is present).
  const clampMobileSpot = useCallback((candidate: Pos): Pos => {
    const el = launcherRef.current;
    if (!el) return candidate;
    const r = el.getBoundingClientRect();
    const vvEl = window.visualViewport;
    const vvW = vvEl?.width ?? window.innerWidth;
    const vvTop = vvEl?.offsetTop ?? 0;
    const vvBottom = vvTop + (vvEl?.height ?? window.innerHeight);
    const safe = measureSafeAreaInsetBottom();
    const nav = document.querySelector('nav[aria-label="Mobile navigation"]');
    const navTop = nav ? nav.getBoundingClientRect().top : Number.POSITIVE_INFINITY;
    const bottomEdge = Math.min(navTop - SHEET_GAP, vvBottom - safe - EDGE_MARGIN);
    return {
      x: clamp(candidate.x, EDGE_MARGIN, vvW - EDGE_MARGIN - r.width),
      y: clamp(candidate.y, vvTop + EDGE_MARGIN, bottomEdge - r.height),
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

  const pathname = usePathname();

  // Re-render trigger when the ACTUAL visible viewport changes. On
  // browsers where the layout viewport doesn't shrink for the software
  // keyboard, the occluded strip shows up as innerHeight - vv.height -
  // vv.offsetTop.
  const [vvTick, setVvTick] = useState(0);
  useEffect(() => {
    const el = window.visualViewport;
    if (!el) return;
    const update = () => setVvTick((t) => t + 1);
    update();
    el.addEventListener('resize', update);
    el.addEventListener('scroll', update);
    return () => {
      el.removeEventListener('resize', update);
      el.removeEventListener('scroll', update);
    };
  }, []);

  // Sheet geometry, recomputed whenever the visible viewport, the route
  // (nav presence), or open state changes. The budget is the visual
  // viewport bounds minus the real bottom offset, safe-area clearance,
  // and a top margin - so header, messages and composer always stay
  // inside what's actually visible.
  useEffect(() => {
    if (!isOpen || isDesktop) {
      setSheetGeom(null);
      return;
    }
    const vvEl = window.visualViewport;
    const ih = window.innerHeight;
    const vvH = vvEl?.height ?? ih;
    const vvTop = vvEl?.offsetTop ?? 0;
    const vvBottom = vvTop + vvH;
    const kbInset = Math.max(0, ih - vvH - vvTop);
    const safe = measureSafeAreaInsetBottom();

    const nav = document.querySelector('nav[aria-label="Mobile navigation"]');
    const navTop = nav ? nav.getBoundingClientRect().top : Number.POSITIVE_INFINITY;

    let aboveNav = false;
    let bottomEdge: number;
    if (navTop < vvBottom) {
      // The nav's top edge pokes into the visible region - rest above it.
      bottomEdge = navTop - SHEET_GAP;
      aboveNav = true;
      if (bottomEdge - vvTop - SHEET_TOP_MARGIN < MIN_HEIGHT_FOR_NAV_CLEARANCE) {
        // Too cramped to clear the nav - cover it instead (transient; the
        // composer staying reachable wins) and use the tighter anchor.
        aboveNav = false;
        bottomEdge = vvBottom - safe - SHEET_BASE_CLEARANCE;
      }
    } else {
      bottomEdge = vvBottom - safe - SHEET_BASE_CLEARANCE;
    }

    const avail = Math.max(0, bottomEdge - vvTop - SHEET_TOP_MARGIN);
    // With the keyboard open the budget is already the binding
    // constraint; without it keep the comfortable 85% ceiling.
    const cap = kbInset > 0 ? vvH : vvH * 0.85;
    const maxHeight = Math.max(MIN_SHEET_HEIGHT, Math.min(avail, cap));
    setSheetGeom({
      bottom: Math.max(0, ih - bottomEdge),
      maxHeight,
      aboveNav,
    });
  }, [isOpen, isDesktop, vvTick, pathname]);

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

  // Load + re-clamp the mobile launcher spot on mount, on breakpoint
  // change, and whenever the visible viewport moves (keyboard opening
  // can push a saved spot out of view).
  useEffect(() => {
    if (isDesktop) return;
    setMPos((current) => {
      const candidate = current ?? loadMobilePos();
      if (!candidate) return null;
      const next = clampMobileSpot(candidate);
      if (next.x !== candidate.x || next.y !== candidate.y) saveMobilePos(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop, vvTick, clampMobileSpot]);

  const scrollToBottom = () => {
    // Scroll the message container directly - scrollIntoView could also
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
    // New gesture boundary: a stale flag from a cancelled earlier drag
    // must not swallow this gesture's click.
    movedRef.current = false;
    dragStartPos.current = { x: clientX, y: clientY };
  };

  const onDrag = useCallback(
    (clientX: number, clientY: number) => {
      const start = dragStartPos.current;
      if (start && Math.hypot(clientX - start.x, clientY - start.y) >= 5) {
        movedRef.current = true;
      }
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

  // Mobile launcher drag: Pointer Events + capture. A tap still opens
  // chat (isClick distance check); a real drag repositions instead.
  const onLauncherPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (isDesktop || e.pointerType === 'mouse') return;
    // One gesture at a time; a second pointer cannot hijack the drag.
    if (mPointerId.current !== null) return;
    e.preventDefault();
    mPointerId.current = e.pointerId;
    // Gesture boundary: movedRef only describes THIS gesture's travel.
    movedRef.current = false;
    const r = e.currentTarget.getBoundingClientRect();
    mDragGrab.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    mDragging.current = true;
    mDragLast.current = null;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    // Synthetic pointer events in tests have no active pointer to
    // capture; real touches always do.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch { /* synthetic pointer in e2e */ }
  };

  const onLauncherPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerId !== mPointerId.current || !mDragging.current) return;
    const start = dragStartPos.current;
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 5) {
      movedRef.current = true;
    }
    const spot = { x: e.clientX - mDragGrab.current.x, y: e.clientY - mDragGrab.current.y };
    const clamped = clampMobileSpot(spot);
    mDragLast.current = clamped;
    setMPos(clamped);
  };

  // Shared by pointerup, pointercancel and lostpointercapture: each is a
  // real browser boundary at which the gesture ends.
  const onLauncherPointerEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerId !== mPointerId.current || !mDragging.current) return;
    mDragging.current = false;
    mPointerId.current = null;
    // Save the ref-tracked last spot, not mPosRef: the final setMPos from
    // pointermove may not have committed its sync effect before pointerup.
    const last = mDragLast.current;
    mDragLast.current = null;
    if (last) saveMobilePos(last);
  };

  const resetMobilePos = () => {
    setMPos(null);
    saveMobilePos(null);
  };

  // z-40 keeps the widget under dialogs/room modals (z-50), the mobile nav,
  // and the cookie consent bar (z-[60]) - those always take precedence. When
  // the sheet covers the nav (cramped heights only) it rises to z-[60] so the
  // nav can't intercept composer taps.
  if (!isOpen) {
    return (
      <>
        <button
          ref={(el) => {
            widgetRef.current = el;
            launcherRef.current = el;
          }}
          onClick={(e) => {
            // Keyboard/screen-reader activation fires click with detail 0
            // and stays independent of pointer-drag suppression.
            if (e.detail === 0) {
              setIsOpen(true);
              return;
            }
            if (movedRef.current) {
              movedRef.current = false;
              return;
            }
            setIsOpen(true);
          }}
          onMouseDown={(e) => {
            if (!isDesktop) return;
            e.preventDefault();
            startDrag(e.clientX, e.clientY);
          }}
          onPointerDown={onLauncherPointerDown}
          onPointerMove={onLauncherPointerMove}
          onPointerUp={onLauncherPointerEnd}
          onPointerCancel={onLauncherPointerEnd}
          onLostPointerCapture={onLauncherPointerEnd}
          style={
            mPos && !isDesktop
              ? { left: mPos.x, top: mPos.y, bottom: 'auto', right: 'auto' }
              : { ...dragStyle, transition: isDragging ? 'none' : undefined }
          }
          // touch-none lets pointermove drive the drag without the page
          // scrolling the gesture away. The transition list excludes
          // left/top so a mobile drag follows the pointer instantly;
          // the desktop transform-drag disables transitions while active.
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-4 z-40 touch-none rounded-full bg-brand-500 p-4 text-sc-text shadow-lg shadow-brand-500/30 transition-[transform,background-color,box-shadow] hover:scale-105 hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-sc-bg motion-reduce:transition-none sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] sm:left-auto sm:right-6 sm:touch-auto"
          aria-label="Open support chat"
        >
          <MessageSquare className="h-6 w-6" />
        </button>
        {mPos && !isDesktop && (
          <button
            onClick={resetMobilePos}
            style={{ left: mPos.x, top: Math.max(EDGE_MARGIN, mPos.y - 36) }}
            className="fixed z-40 rounded-full border border-surface-border bg-surface px-2.5 py-1 text-[10px] text-sc-muted shadow-md"
            aria-label="Reset chat button position"
          >
            Reset
          </button>
        )}
      </>
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
        // Computed px geometry overrides the CSS fallback once measured;
        // the classes below keep a sane default for the first frame.
        ...(sheetGeom && !isDesktop
          ? { bottom: sheetGeom.bottom, maxHeight: sheetGeom.maxHeight }
          : {}),
      }}
      onMouseDown={(e) => {
        if (!isDesktop || isInteractiveTarget(e)) return;
        e.preventDefault();
        startDrag(e.clientX, e.clientY);
      }}
      className={`fixed inset-x-3 flex max-h-[85dvh] flex-col rounded-2xl border border-surface-border bg-surface shadow-2xl sm:inset-x-auto sm:right-6 sm:w-96 sm:max-h-[min(80vh,640px)] sm:z-40 ${
        sheetGeom && !sheetGeom.aboveNav && !isDesktop ? 'z-[60]' : 'z-40'
      } bottom-[calc(0.75rem+env(safe-area-inset-bottom))] sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))]`}
    >
      {/* Header - drag handle on desktop */}
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
            className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:min-h-[300px]"
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
