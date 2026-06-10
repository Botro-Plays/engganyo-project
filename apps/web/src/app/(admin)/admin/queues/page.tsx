'use client';

import { useEffect } from 'react';

export default function QueuesRedirect() {
  useEffect(() => {
    window.location.href = '/api/admin/queues';
  }, []);

  return (
    <div className="flex items-center justify-center h-64 text-zinc-400">
      <p>Opening Bull Board…</p>
    </div>
  );
}
