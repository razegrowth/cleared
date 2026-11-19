import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export interface Toast {
  id: number;
  text: string;
  error?: boolean;
  action?: { label: string; key?: string; run: () => void };
  ms?: number;
}

type Push = (t: Omit<Toast, 'id'>) => number;

const Ctx = createContext<{ push: Push; dismiss: (id: number) => void }>({ push: () => 0, dismiss: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const push = useCallback<Push>(
    (t) => {
      const id = next.current++;
      // At most two at once; the newest matters most.
      setToasts((all) => [...all.slice(-1), { ...t, id }]);
      timers.current.set(id, setTimeout(() => dismiss(id), t.ms ?? (t.error ? 6000 : 5000)));
      return id;
    },
    [dismiss],
  );

  return (
    <Ctx.Provider value={{ push, dismiss }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.error ? 'error' : ''}`}>
            <span>{t.text}</span>
            {t.action ? (
              <button
                className="btn"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
                {t.action.key && <kbd>{t.action.key}</kbd>}
              </button>
            ) : (
              <span className="spacer" />
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToasts = () => useContext(Ctx);
