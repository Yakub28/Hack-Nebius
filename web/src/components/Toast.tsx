import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const [shown, setShown] = useState(false);
  const timer = useRef<number>();

  const push = useCallback((text: string) => {
    setMessage(text);
    setShown(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown(false), 3200);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className={`toast${shown ? " show" : ""}`} role="status" aria-live="polite">{message}</div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
