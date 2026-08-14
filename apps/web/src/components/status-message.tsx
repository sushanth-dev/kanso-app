import type { ReactNode } from 'react';

export type StatusTone = 'error' | 'success';

export interface StatusMessageProps {
  tone: StatusTone;
  children: ReactNode;
}

export function StatusMessage({ tone, children }: StatusMessageProps) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={tone === 'error' ? 'text-danger' : 'text-primary'}
    >
      {children}
    </p>
  );
}
