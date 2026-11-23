import { useEffect, useRef, useState } from 'react';
import { loadState, onStateChange } from '../shared/store';
import type { MailState, Settings } from '../shared/types';

/** The whole mail state, kept live from storage. */
export function useMail(): MailState | null {
  const [state, setState] = useState<MailState | null>(null);
  useEffect(() => {
    let alive = true;
    loadState().then((s) => alive && setState(s));
    const off = onStateChange((patch) => setState((s) => (s ? { ...s, ...patch } : s)));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

export function useTheme(settings: Settings | undefined) {
  useEffect(() => {
    const root = document.documentElement;
    if (!settings || settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings?.theme]);
}

export function useWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

/** Re-renders every `ms`, for "updated 2 min ago" labels. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** True when keystrokes belong to a text field, not to Cleared's shortcuts. */
export function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

/**
 * Whether Cleared is checking for mail right now: one the person asked for, or
 * a timed one. A mark older than a minute is a check whose worker went away.
 */
export function useChecking(): boolean {
  const [since, setSince] = useState(0);
  useEffect(() => {
    chrome.storage.local.get('checking').then((v) => setSince(Number(v.checking) || 0)).catch(() => {});
    const on = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && 'checking' in changes) setSince(Number(changes.checking.newValue) || 0);
    };
    chrome.storage.onChanged.addListener(on);
    return () => chrome.storage.onChanged.removeListener(on);
  }, []);
  return since > 0 && Date.now() - since < 60_000;
}

/**
 * A spinning icon that, when the work ends, finishes its turn rather than
 * snapping back, and always turns at least once so a quick check is seen.
 */
export function useSpin(active: boolean) {
  const [on, setOn] = useState(active);
  useEffect(() => {
    if (active) setOn(true);
  }, [active]);
  return {
    className: on ? 'spin' : '',
    onAnimationIteration: () => !active && setOn(false),
  };
}

export const TEXT_SCALES = [0.85, 0.92, 1, 1.08, 1.17, 1.25, 1.35, 1.5];

/** The next text size up (+1) or down (-1) from the current one. */
export function stepScale(current: number, dir: 1 | -1): number {
  const i = TEXT_SCALES.reduce((best, s, j) => (Math.abs(s - current) < Math.abs(TEXT_SCALES[best] - current) ? j : best), 0);
  return TEXT_SCALES[Math.max(0, Math.min(TEXT_SCALES.length - 1, i + dir))];
}

/**
 * Whether this page has the keyboard. A side panel, or a popup the browser
 * didn't focus, hears no keys until it's clicked; pointing at it asks for
 * the keyboard (which some browsers grant), and the answer is kept here so
 * the UI can say when the shortcuts aren't listening.
 */
export function useKeyboardFocus(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const update = () => setFocused(document.hasFocus());
    let asked = 0;
    const ask = () => {
      if (document.hasFocus() || Date.now() - asked < 1000) return;
      asked = Date.now();
      window.focus();
      setTimeout(update, 50);
    };
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('pointermove', ask, { passive: true });
    // Some hosts move focus without telling the page: check now and then.
    const poll = setInterval(update, 1000);
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('pointermove', ask);
      clearInterval(poll);
    };
  }, []);
  return focused;
}
