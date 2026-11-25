'use client';

// Horizontal rail for published blog previews. All card content and
// links render inside the normal React tree (server-rendered HTML,
// real anchors, no clones); this component only adds scroll controls
// and a gentle auto-advance when more than one post exists.
//
// Controls: Previous/Next sit beside the rail on >=sm screens and in
// the control row below it on narrow screens, so they never cover
// article content or clip focus rings. The rail scrolls natively
// (touch swipe, keyboard via the buttons) but the scrollbar itself is
// hidden in every engine. Autoplay pauses on hover, focus, offscreen,
// hidden tab, manual interaction, and reduced motion; the pause
// toggle stays reachable in the control row.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';

const ADVANCE_MS = 5000; // auto-advance interval between cards (~5s)
const EDGE_EPS = 8;

const arrowButton =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-surface-border bg-surface-card text-sc-text hover:border-brand-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

export function BlogRail({ children, count }: { children: React.ReactNode; count: number }) {
  const railRef = useRef<HTMLUListElement>(null);
  const [playing, setPlaying] = useState(false); // user-visible state
  const [reducedMotion, setReducedMotion] = useState(false);
  const suspend = useRef({ hover: false, focus: false, hidden: false, offscreen: false, manual: false });
  const single = count <= 1;

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Autoplay only for multi-post rails, never for reduced motion.
  useEffect(() => {
    if (single || reducedMotion) {
      setPlaying(false);
      return;
    }
    setPlaying(true);
    const s = suspend.current;
    const id = window.setInterval(() => {
      if (s.hover || s.focus || s.hidden || s.offscreen || s.manual) return;
      const rail = railRef.current;
      if (!rail) return;
      const atEnd = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - EDGE_EPS;
      if (atEnd) {
        rail.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        const card = rail.querySelector('li');
        const step = card ? card.getBoundingClientRect().width + 16 : rail.clientWidth;
        rail.scrollBy({ left: step, behavior: 'smooth' });
      }
    }, ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [single, reducedMotion]);

  // Pause while off-screen or the tab is hidden. The two flags stay
  // separate: visibilitychange fires again on tab return, so hidden
  // must track document.hidden exactly instead of latching.
  useEffect(() => {
    const rail = railRef.current;
    const s = suspend.current;
    const io = new IntersectionObserver(([entry]) => {
      s.offscreen = !entry.isIntersecting;
    });
    if (rail) io.observe(rail);
    const onVis = () => {
      s.hidden = document.hidden;
    };
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // One-card steps, wrapping at both ends so the arrows mirror the
  // autoplay loop instead of going dead at the edges.
  const scrollStep = useCallback(
    (dir: 1 | -1) => {
      const rail = railRef.current;
      if (!rail) return;
      suspend.current.manual = true;
      const behavior = reducedMotion ? 'auto' : 'smooth';
      const max = rail.scrollWidth - rail.clientWidth;
      const atEnd = rail.scrollLeft >= max - EDGE_EPS;
      const atStart = rail.scrollLeft <= EDGE_EPS;
      if (dir === 1 && atEnd) {
        rail.scrollTo({ left: 0, behavior });
        return;
      }
      if (dir === -1 && atStart) {
        rail.scrollTo({ left: max, behavior });
        return;
      }
      const card = rail.querySelector('li');
      const step = card ? card.getBoundingClientRect().width + 16 : rail.clientWidth;
      rail.scrollBy({ left: step * dir, behavior });
    },
    [reducedMotion],
  );

  const togglePlay = useCallback(() => {
    suspend.current.manual = false;
    setPlaying((p) => {
      suspend.current.manual = p; // playing -> manual pause; paused -> resume
      return !p;
    });
  }, []);

  const prevButton = (extraClass: string) => (
    <button
      type="button"
      onClick={() => scrollStep(-1)}
      aria-label="Previous article"
      className={`${arrowButton} ${extraClass}`}
    >
      <ChevronLeft className="h-5 w-5" aria-hidden="true" />
    </button>
  );
  const nextButton = (extraClass: string) => (
    <button
      type="button"
      onClick={() => scrollStep(1)}
      aria-label="Next article"
      className={`${arrowButton} ${extraClass}`}
    >
      <ChevronRight className="h-5 w-5" aria-hidden="true" />
    </button>
  );

  return (
    <div>
      <div className="flex items-center gap-2 sm:gap-3">
        {!single && prevButton('hidden sm:inline-flex')}
        <ul
          ref={railRef}
          aria-label="Published articles"
          onPointerEnter={() => (suspend.current.hover = true)}
          onPointerLeave={() => (suspend.current.hover = false)}
          onFocus={() => (suspend.current.focus = true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) suspend.current.focus = false;
          }}
          onPointerDown={() => (suspend.current.manual = true)}
          onWheel={() => (suspend.current.manual = true)}
          onTouchStart={() => (suspend.current.manual = true)}
          className="flex min-w-0 flex-1 gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-2 [touch-action:pan-x_pan-y] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {children}
        </ul>
        {!single && nextButton('hidden sm:inline-flex')}
      </div>
      {!single && (
        <>
          {/* Control area below the cards: the Play/Pause toggle is
              horizontally centered on every width; on narrow screens the
              Previous/Next arrows pin to the row edges so the centered
              toggle never shifts. */}
          <div className="relative mt-3 min-h-11">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 sm:hidden">
              {prevButton('')}
            </div>
            <div className="absolute right-0 top-1/2 -translate-y-1/2 sm:hidden">
              {nextButton('')}
            </div>
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? 'Pause article rotation' : 'Play article rotation'}
              aria-pressed={playing}
              disabled={reducedMotion}
              className="absolute left-1/2 top-1/2 inline-flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-surface-border/60 bg-surface-card/40 text-sc-muted transition-colors hover:border-brand-500/70 hover:bg-surface-card/80 hover:text-accent-300 focus-visible:border-brand-500/70 focus-visible:text-accent-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40"
            >
              {playing ? (
                <Pause className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
            {reducedMotion && (
              <span className="absolute right-0 top-1/2 hidden -translate-y-1/2 text-xs text-sc-muted sm:block">
                Auto-advance off (reduced motion)
              </span>
            )}
          </div>
          {reducedMotion && (
            <p className="mt-1 text-center text-xs text-sc-muted sm:hidden">
              Auto-advance off (reduced motion)
            </p>
          )}
        </>
      )}
    </div>
  );
}
