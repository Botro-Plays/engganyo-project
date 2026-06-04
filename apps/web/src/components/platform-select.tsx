'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { PlatformIcon } from './platform-icon';

interface Option {
  value: string;
  label: string;
  platform?: string;
}

interface PlatformSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
}

const PLATFORM_COLOR: Record<string, string> = {
  YOUTUBE: 'text-red-400',
  TIKTOK: 'text-white',
  INSTAGRAM: 'text-pink-400',
  TWITTER: 'text-sky-400',
  FACEBOOK: 'text-blue-400',
  TWITCH: 'text-purple-400',
  SPOTIFY: 'text-green-400',
  TELEGRAM: 'text-sky-300',
  DISCORD: 'text-indigo-400',
  TRUSTPILOT: 'text-green-300',
  GOOGLE: 'text-blue-300',
};

export function PlatformSelect({ options, value, onChange, placeholder = 'Select type', id }: PlatformSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        id={id}
        onClick={() => setOpen((v) => !v)}
        className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500 flex items-center justify-between gap-2"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 truncate">
          {selected?.platform && (
            <span className={PLATFORM_COLOR[selected.platform] ?? 'text-zinc-400'}>
              <PlatformIcon platform={selected.platform} className="w-4 h-4" />
            </span>
          )}
          <span className="truncate">{selected?.label ?? placeholder}</span>
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-surface-border bg-[#18181b] py-1 shadow-xl ring-1 ring-black ring-opacity-5 focus:outline-none text-sm"
        >
          {options.map((opt) => {
            const isActive = opt.value === value;
            const color = opt.platform ? PLATFORM_COLOR[opt.platform] ?? 'text-zinc-400' : 'text-zinc-400';
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`cursor-pointer select-none px-3 py-2 flex items-center gap-2 ${
                  isActive ? 'bg-brand-500/10 text-white' : 'text-zinc-300 hover:bg-surface-hover'
                }`}
              >
                {opt.platform && (
                  <span className={color}>
                    <PlatformIcon platform={opt.platform} className="w-4 h-4" />
                  </span>
                )}
                <span className="truncate">{opt.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
