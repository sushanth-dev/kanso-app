import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export type StatusTone = 'error' | 'success' | 'info';

export interface StatusMessageProps {
  tone: StatusTone;
  children: ReactNode;
}

interface StatusMessageFlash {
  message: string;
  destination: string;
  presented: boolean;
}

interface StatusMessageContextValue {
  flash: StatusMessageFlash | null;
  showMessage: (message: string, destination: string) => void;
  markPresented: () => void;
  clearMessage: () => void;
}

const StatusMessageContext = createContext<StatusMessageContextValue | null>(null);

export function StatusMessageProvider({ children }: { children: ReactNode }) {
  const [flash, setFlash] = useState<StatusMessageFlash | null>(null);
  const showMessage = useCallback((message: string, destination: string) => {
    setFlash({ message, destination, presented: false });
  }, []);
  const markPresented = useCallback(() => {
    setFlash((current) =>
      current === null || current.presented ? current : { ...current, presented: true },
    );
  }, []);
  const clearMessage = useCallback(() => {
    setFlash(null);
  }, []);

  return (
    <StatusMessageContext.Provider value={{ flash, showMessage, markPresented, clearMessage }}>
      {children}
    </StatusMessageContext.Provider>
  );
}

export function useStatusMessage() {
  const context = useContext(StatusMessageContext);
  if (context === null) throw new Error('useStatusMessage requires StatusMessageProvider.');
  return context;
}

const toneClassName: Record<StatusTone, string> = {
  error: 'text-danger',
  success: 'text-success',
  info: 'text-info',
};

function StatusIcon({ tone }: { tone: StatusTone }) {
  if (tone === 'info') {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 shrink-0" fill="none">
        <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 9v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="10" cy="6.5" r="1" fill="currentColor" />
      </svg>
    );
  }
  if (tone === 'success') {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 shrink-0" fill="none">
        <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="m6 10 2.5 2.5L14 7"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 shrink-0" fill="none">
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="14" r="1" fill="currentColor" />
    </svg>
  );
}

export function StatusMessage({
  tone,
  className,
  children,
}: StatusMessageProps & { className?: string }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-center gap-2 ${className ?? 'reveal-in'} ${toneClassName[tone]}`}
    >
      <StatusIcon tone={tone} />
      {children}
    </p>
  );
}
