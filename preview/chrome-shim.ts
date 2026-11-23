/**
 * Just enough of chrome.* for Cleared to run in a normal tab. Storage is in
 * memory, messages go straight to the background router in this page, and
 * anything that would leave the page (notifications, tabs, sign-in) logs instead.
 */
type Listener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void;

const data = new Map<string, unknown>();
const listeners = new Set<Listener>();
const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));

const local = {
  async get(keys?: string | string[] | null) {
    const list = keys == null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const k of list) if (data.has(k)) out[k] = clone(data.get(k));
    return out;
  },
  async set(items: Record<string, unknown>) {
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const [k, v] of Object.entries(items)) {
      changes[k] = { oldValue: data.get(k), newValue: clone(v) };
      data.set(k, clone(v));
    }
    queueMicrotask(() => listeners.forEach((l) => l(changes, 'local')));
  },
  async remove(keys: string | string[]) {
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      changes[k] = { oldValue: data.get(k), newValue: undefined };
      data.delete(k);
    }
    queueMicrotask(() => listeners.forEach((l) => l(changes, 'local')));
  },
};

let router: ((req: unknown) => Promise<unknown>) | undefined;
export function attachRouter(fn: (req: unknown) => Promise<unknown>) {
  router = fn;
}

const noop = async () => {};
const event = () => ({ addListener() {}, removeListener() {} });
const log = (what: string) => async (...args: unknown[]) => console.info(`[preview] ${what}`, ...args);

(globalThis as any).chrome = {
  storage: {
    local,
    onChanged: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) },
  },
  runtime: {
    id: 'aiiajjnmbdmphlgpjonnpffadapdiegl',
    sendMessage: (req: unknown) => router!(req),
    getURL: (p: string) => p,
    openOptionsPage: () => window.open('/?layout=settings', '_blank'),
    onMessage: event(),
  },
  identity: { getRedirectURL: (p = '') => `https://aiiajjnmbdmphlgpjonnpffadapdiegl.chromiumapp.org/${p}` },
  alarms: { create: noop, clear: noop, onAlarm: event() },
  notifications: { create: log('notification'), clear: noop, onClicked: event(), onButtonClicked: event() },
  action: { setBadgeText: noop, setBadgeBackgroundColor: noop, setBadgeTextColor: noop, setTitle: noop },
  tabs: { create: log('open tab') },
  windows: { getCurrent: async () => ({ id: 1 }) },
  sidePanel: { open: log('open side panel'), setPanelBehavior: noop },
};
