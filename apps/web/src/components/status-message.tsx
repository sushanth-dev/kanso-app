import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export type StatusTone = 'error' | 'success';

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
