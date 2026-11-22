'use client';

// Horizontal rail for published blog previews. All card content and
// links render inside the normal React tree (server-rendered HTML,
// real anchors, no clones); this component only adds scroll controls
// and a gentle auto-advance when more than one post exists.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';

const ADVANCE_MS = 7000; // gentle auto-advance, ~6-8s window
const EDGE_EPS = 8;

export function BlogRail({ children, count }: { children: React.ReactNode; count: number }) {
  const railRef = useRef<HTMLUListElement>(null);
  const [playing, setPlaying] = useState(false); // user-visible state
  const [reducedMotion, setReducedMotion] = useState(false);
  const suspend = useRef({ hover: false, focus: false, hidden: false, manual: false });
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
      if (s.hover || s.focus || s.hidden || s.manual) return;
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

  // Pause while off-screen or the tab is hidden.
  useEffect(() => {
    const rail = railRef.current;
    const s = suspend.current;
    const io = new IntersectionObserver(([entry]) => {
      s.hidden = !entry.isIntersecting;
    });
    if (rail) io.observe(rail);
    const onVis = () => {
      s.hidden = document.hidden || s.hidden;
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const scrollStep = useCallback((dir: 1 | -1) => {
    const rail = railRef.current;
    if (!rail) return;
    suspend.current.manual = true;
    const card = rail.querySelector('li');
    const step = card ? card.getBoundingClientRect().width + 16 : rail.clientWidth;
    rail.scrollBy({ left: step * dir, behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [reducedMotion]);

  const togglePlay = useCallback(() => {
    suspend.current.manual = false;
    setPlaying((p) => {
      suspend.current.manual = p; // playing -> manual pause; paused -> resume
      return !p;
    });
  }, []);

  return (
    <div className="relative">
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
        className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-2 [touch-action:pan-y] [scrollbar-width:thin]"
      >
        {children}
      </ul>
      {!single && (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => scrollStep(-1)}
            aria-label="Previous article"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-surface-border bg-surface-card text-sc-text hover:border-brand-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? 'Pause article rotation' : 'Play article rotation'}
            aria-pressed={playing}
            disabled={reducedMotion}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-surface-border bg-surface-card text-sc-text hover:border-brand-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40"
          >
            {playing ? (
              <Pause className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={() => scrollStep(1)}
            aria-label="Next article"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-surface-border bg-surface-card text-sc-text hover:border-brand-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
          {reducedMotion && (
            <span className="text-xs text-sc-muted">Auto-advance off (reduced motion)</span>
          )}
        </div>
      )}
    </div>
  );
}
