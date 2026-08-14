import { createContext, useContext, useState, type ReactNode } from 'react';

export type StatusTone = 'error' | 'success';

export interface StatusMessageProps {
  tone: StatusTone;
  children: ReactNode;
}

interface StatusMessageContextValue {
  message: string | null;
  setMessage: (message: string | null) => void;
}

const StatusMessageContext = createContext<StatusMessageContextValue | null>(null);

export function StatusMessageProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <StatusMessageContext.Provider value={{ message, setMessage }}>
      {children}
    </StatusMessageContext.Provider>
  );
}

export function useStatusMessage() {
  const context = useContext(StatusMessageContext);
  if (context === null) throw new Error('useStatusMessage requires StatusMessageProvider.');
  return context;
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
