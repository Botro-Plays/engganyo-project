import type { Metadata } from 'next';
import { ChallengeClient } from './challenge-client';

// Functional challenge join page - not indexable content.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ChallengePage({
  params,
}: {
  params: { id: string };
}) {
  return <ChallengeClient id={params.id} />;
}
