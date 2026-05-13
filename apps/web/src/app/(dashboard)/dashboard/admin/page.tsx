'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminRedirect() {
  const router = useRouter();
  useEffect(() => { void router.replace('/admin'); }, [router]);
  return null;
}
