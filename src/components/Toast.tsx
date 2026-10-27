import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Show = (msg: string, bad?: boolean) => void;
const Ctx = createContext<Show>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const timer = useRef<number>();
  const show = useCallback<Show>((text, bad = false) => {
    setMsg({ text, bad });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), bad ? 6000 : 3200);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      {msg && <div className={`toast ${msg.bad ? 'bad' : ''}`} role="status">{msg.text}</div>}
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
