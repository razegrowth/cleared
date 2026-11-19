import { Search, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { snoozeOptions } from './snooze';

export interface Command {
  id: string;
  label: string;
  group: string;
  icon?: LucideIcon;
  keys?: string[];
  run: () => void;
}

/** Subsequence match, rewarding hits at word starts and runs of letters. */
function score(label: string, query: string): number {
  if (!query) return 1;
  const l = label.toLowerCase();
  const q = query.toLowerCase();
  if (l.includes(q)) return 100 - l.indexOf(q);
  let s = 0;
  let i = 0;
  let run = 0;
  for (const ch of q) {
    const at = l.indexOf(ch, i);
    if (at < 0) return 0;
    run = at === i ? run + 1 : 0;
    s += 1 + run * 2 + (at === 0 || l[at - 1] === ' ' ? 3 : 0);
    i = at + 1;
  }
  return s;
}

export function Palette({
  commands,
  onSearch,
  onClose,
}: {
  commands: Command[];
  onSearch: (q: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => input.current?.focus(), []);

  const items = useMemo(() => {
    const ranked = commands
      .map((c) => ({ c, s: score(c.label, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => (query ? b.s - a.s : 0))
      .map((x) => x.c);
    if (query.trim()) {
      ranked.push({
        id: 'search',
        label: `Search all inboxes for “${query.trim()}”`,
        group: 'Search',
        icon: Search,
        run: () => onSearch(query.trim()),
      });
    }
    return ranked;
  }, [commands, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  let lastGroup = '';
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette" onKeyDown={onKey}>
        <div className="input">
          <Search />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search…"
            aria-activedescendant={`cmd-${active}`}
          />
          <kbd>esc</kbd>
        </div>
        <div className="items" ref={list} role="listbox">
          {items.length === 0 && <div className="none">No matching commands</div>}
          {items.map((c, i) => {
            const header = !query && c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            const Icon = c.icon;
            return (
              <div key={c.id}>
                {header && <div className="group">{header}</div>}
                <button
                  id={`cmd-${i}`}
                  className="item"
                  role="option"
                  data-index={i}
                  data-active={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(c)}
                >
                  {Icon && <Icon />}
                  <span className="label">{c.label}</span>
                  {c.keys && (
                    <span className="keys">
                      {c.keys.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function SnoozeMenu({ onPick, onClose }: { onPick: (at: number) => void; onClose: () => void }) {
  const options = useMemo(() => snoozeOptions(), []);
  const [active, setActive] = useState(0);
  const [custom, setCustom] = useState('');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => root.current?.focus(), []);

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') {
      if (e.key === 'Escape') onClose();
      return;
    }
    const byKey = options.find((o) => o.key === e.key);
    if (byKey) {
      e.preventDefault();
      onPick(byKey.at);
    } else if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onPick(options[active].at);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
    e.stopPropagation();
  };

  const customAt = custom ? new Date(custom).getTime() : NaN;

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="menu" ref={root} tabIndex={-1} onKeyDown={onKey} role="menu" aria-label="Snooze until">
        <div className="title">Snooze until…</div>
        {options.map((o, i) => (
          <button
            key={o.label}
            className="item"
            role="menuitem"
            data-active={i === active}
            onMouseMove={() => setActive(i)}
            onClick={() => onPick(o.at)}
          >
            <kbd>{o.key}</kbd>
            {o.label}
            <span className="when">{o.when}</span>
          </button>
        ))}
        <div className="custom">
          <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Pick a date and time" />
          <button className="btn" disabled={!(customAt > Date.now())} onClick={() => onPick(customAt)}>
            Snooze
          </button>
        </div>
      </div>
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon: LucideIcon;
  /** A tick, for an item that is a switch. */
  checked?: boolean;
  hint?: string;
  run: () => void;
}

/**
 * Where a menu opens: a point in the window, with the menu's left or right
 * edge on it. `end` hangs it under a button at the right; `start` puts it at
 * the pointer for a right-click.
 */
export interface MenuAnchor {
  x: number;
  y: number;
  align: 'start' | 'end';
}

/** Below a button, its right edges lined up. */
export const under = (el: Element): MenuAnchor => {
  const r = el.getBoundingClientRect();
  return { x: r.right, y: r.bottom + 4, align: 'end' };
};

/**
 * A short list of things to do to one thing, such as an inbox. Arrows or j/k
 * to move, Return to choose. With an anchor it opens where it was asked for,
 * kept inside the window; without one (from the palette) it opens at the top.
 */
export function ActionMenu({ title, items, anchor, onClose }: { title: string; items: MenuItem[]; anchor?: MenuAnchor; onClose: () => void }) {
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; origin: string } | null>(null);
  useEffect(() => root.current?.focus(), []);

  useLayoutEffect(() => {
    const menu = root.current;
    const box = menu?.parentElement?.getBoundingClientRect();
    if (!anchor || !menu || !box) return;
    // Layout size, not the on-screen box: that is still scaled down by the opening animation.
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const margin = 8;
    let left = (anchor.align === 'end' ? anchor.x - width : anchor.x) - box.left;
    let top = anchor.y - box.top;
    let vertical = 'top';
    // No room below: open upwards from the anchor instead.
    if (top + height > box.height - margin) {
      top = Math.max(margin, top - height - (anchor.align === 'end' ? 32 : 0));
      vertical = 'bottom';
    }
    left = Math.min(Math.max(margin, left), box.width - width - margin);
    setPlace({ left, top, origin: `${vertical} ${anchor.align === 'end' ? 'right' : 'left'}` });
  }, [anchor]);

  const choose = (i: number) => {
    onClose();
    items[i].run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'j') setActive((a) => Math.min(items.length - 1, a + 1));
    else if (e.key === 'ArrowUp' || e.key === 'k') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Enter') choose(active);
    else if (e.key === 'Escape') onClose();
    else return;
    e.preventDefault();
  };

  return (
    <div
      className={`scrim ${anchor ? 'anchored' : ''}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onContextMenu={(e) => {
        e.preventDefault();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="menu"
        ref={root}
        tabIndex={-1}
        onKeyDown={onKey}
        role="menu"
        aria-label={title}
        style={
          anchor
            ? place
              ? { position: 'absolute', left: place.left, top: place.top, transformOrigin: place.origin }
              : { position: 'absolute', visibility: 'hidden' }
            : undefined
        }
      >
        <div className="title">{title}</div>
        {items.map((item, i) => (
          <button
            key={item.label}
            className="item"
            role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={item.checked}
            data-active={i === active}
            onMouseMove={() => setActive(i)}
            onClick={() => choose(i)}
          >
            <item.icon size={14} />
            {item.label}
            {item.checked !== undefined ? (
              <span className="when">{item.checked ? 'On' : 'Off'}</span>
            ) : (
              item.hint && <span className="when">{item.hint}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
