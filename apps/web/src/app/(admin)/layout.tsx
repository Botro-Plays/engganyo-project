import type { Metadata } from 'next';
import { AdminShell } from './admin-shell';

// Admin surfaces are never indexable content.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminShell>{children}</AdminShell>;
}
