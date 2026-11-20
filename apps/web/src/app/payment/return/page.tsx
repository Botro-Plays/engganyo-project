import type { Metadata } from 'next';
import { PaymentReturnClient } from './payment-return-client';

// Payment callback surface — never indexable.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PaymentReturnPage() {
  return <PaymentReturnClient />;
}
