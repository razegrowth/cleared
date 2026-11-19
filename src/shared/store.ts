import { DEFAULT_SETTINGS, type MailState, type Request, type Response, type Settings } from './types';

/** The four storage keys the UI renders from. */
export const STATE_KEYS = ['accounts', 'threads', 'settings', 'snoozes'] as const;
type StateKey = (typeof STATE_KEYS)[number];

/** One typed value from chrome.storage.local. */
export async function getKey<T>(key: string): Promise<T | undefined> {
  return (await chrome.storage.local.get(key))[key] as T | undefined;
}

export function withDefaults(settings: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    quietHours: { ...DEFAULT_SETTINGS.quietHours, ...settings?.quietHours },
  };
}

export async function loadState(): Promise<MailState> {
  const raw = (await chrome.storage.local.get([...STATE_KEYS])) as Partial<Record<StateKey, any>>;
  return {
    accounts: raw.accounts ?? [],
    threads: raw.threads ?? {},
    settings: withDefaults(raw.settings),
    snoozes: raw.snoozes ?? [],
  };
}

export function onStateChange(listener: (patch: Partial<MailState>) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;
    const patch: Partial<MailState> = {};
    let touched = false;
    for (const key of STATE_KEYS) {
      if (!(key in changes)) continue;
      touched = true;
      const value = changes[key].newValue;
      if (key === 'settings') patch.settings = withDefaults(value as Partial<Settings> | undefined);
      else (patch as Record<StateKey, unknown>)[key] = value ?? (key === 'threads' ? {} : []);
    }
    if (touched) listener(patch);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

/** Sends a request to the background worker and unwraps its response. */
export async function request<T = unknown>(req: Request): Promise<T> {
  const res = (await chrome.runtime.sendMessage(req)) as Response<T> | undefined;
  if (!res) throw new Error('Glance’s background worker did not answer. Try again.');
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
