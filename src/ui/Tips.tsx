import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Cleared's own tooltips, in place of the browser's slow grey ones.
 *
 * Nothing in the UI needs to know about this: any element with a `title`
 * keeps writing one, and this layer moves it to `data-tip` the moment it
 * appears (so the browser never shows its own), then draws it at once on
 * hover or keyboard focus. An icon-only control also gets the text as its
 * aria-label, so screen readers still have a name for it.
 *
 * A trailing short "(…)" is read as a shortcut and drawn as a key:
 * "Archive (e)" shows Archive with an E key beside it.
 */

const SHORTCUT = /^(.*\S)\s+\(([^()]{1,6})\)$/;
const GAP = 6;
const EDGE = 6;

function adopt(el: Element) {
  const text = el.getAttribute('title');
  el.removeAttribute('title');
  if (!text) return;
  el.setAttribute('data-tip', text);
  // Only name the element when it has nothing else to go by, and keep the
  // name in step when the tip changes ("Star" ↔ "Unstar").
  const owned = el.hasAttribute('data-tip-label');
  if (owned || (!el.hasAttribute('aria-label') && !el.textContent?.trim())) {
    el.setAttribute('aria-label', SHORTCUT.exec(text)?.[1] ?? text);
    el.setAttribute('data-tip-label', '');
  }
}

function adoptAll(root: ParentNode) {
  root.querySelectorAll('[title]').forEach(adopt);
}

interface Shown {
  el: Element;
  text: string;
}

export function Tips() {
  const [shown, setShown] = useState<Shown | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean; origin: number } | null>(null);
  // The last tip stays on screen briefly while it fades out.
  const last = useRef<Shown | null>(null);
  const [closing, setClosing] = useState(false);
  // Going from one tip straight to the next (along the toolbar, say), the
  // tip glides across instead of popping in again.
  const [warm, setWarm] = useState(false);
  const visible = useRef(false);

  useEffect(() => {
    if (shown) {
      last.current = shown;
      setClosing(false);
      return;
    }
    if (!last.current) return;
    setClosing(true);
    const timer = setTimeout(() => {
      last.current = null;
      setClosing(false);
      setWarm(false);
      setPos(null);
    }, 140);
    return () => clearTimeout(timer);
  }, [shown]);

  // Turn every title into a tip as soon as it reaches the page.
  useEffect(() => {
    adoptAll(document);
    const watch = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') {
          if ((r.target as Element).hasAttribute('title')) adopt(r.target as Element);
        } else {
          r.addedNodes.forEach((n) => {
            if (n instanceof Element) {
              if (n.hasAttribute('title')) adopt(n);
              adoptAll(n);
            }
          });
        }
      }
    });
    watch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    const target = (e: Event) => (e.target instanceof Element ? e.target.closest('[data-tip]') : null);
    const show = (el: Element | null) =>
      setShown((cur) => {
        if (!el) return null;
        const text = el.getAttribute('data-tip') ?? '';
        if (cur?.el === el && cur.text === text) return cur;
        setWarm(visible.current);
        return { el, text };
      });

    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      show(target(e));
    };
    const leave = (e: PointerEvent) => {
      // Moving between children of the same control keeps the tip.
      const to = e.relatedTarget instanceof Element ? e.relatedTarget.closest('[data-tip]') : null;
      if (!to) setShown(null);
    };
    const focus = (e: FocusEvent) => {
      const el = target(e);
      if (el && el.matches(':focus-visible')) show(el);
    };
    const hide = () => setShown(null);

    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerout', leave, true);
    document.addEventListener('focusin', focus, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('pointerout', leave, true);
      document.removeEventListener('focusin', focus, true);
      document.removeEventListener('focusout', hide, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // A control can change its tip while hovered (Star → Unstar), or vanish.
  useEffect(() => {
    if (!shown) return;
    const check = new MutationObserver(() => {
      if (!shown.el.isConnected) return setShown(null);
      const text = shown.el.getAttribute('data-tip');
      if (text === null) setShown(null);
      else if (text !== shown.text) setShown({ el: shown.el, text });
    });
    check.observe(shown.el, { attributes: true, attributeFilter: ['data-tip'] });
    check.observe(document.body, { childList: true, subtree: true });
    return () => check.disconnect();
  }, [shown]);

  // Below the control, centred; above it when there's no room; never off
  // screen. `width: max-content` (styles.css) keeps the new text from being
  // squeezed into wherever the last tip happened to sit.
  useLayoutEffect(() => {
    const el = tip.current;
    if (!shown || !el) return;
    const r = shown.el.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const below = r.bottom + GAP + h <= vh - EDGE || r.top - GAP - h < EDGE;
    const x = Math.min(Math.max(r.left + r.width / 2 - w / 2, EDGE), vw - w - EDGE);
    const y = below ? r.bottom + GAP : r.top - GAP - h;
    // Grow out of the control, even when the tip is pushed off-centre by an edge.
    const origin = Math.min(Math.max(r.left + r.width / 2 - x, 8), w - 8);
    setPos({ x, y, below, origin });
  }, [shown]);

  const current = shown ?? (closing ? last.current : null);
  visible.current = !!current;
  if (!current) return null;
  const m = SHORTCUT.exec(current.text);
  const label = m ? m[1] : current.text;
  const keys = m ? m[2] : null;

  return createPortal(
    <div
      ref={tip}
      className="tip"
      role="tooltip"
      data-side={pos?.below === false ? 'above' : 'below'}
      data-state={shown ? 'open' : 'closed'}
      data-warm={(warm && !!pos) || undefined}
      style={
        pos
          ? { left: pos.x, top: pos.y, transformOrigin: `${pos.origin}px ${pos.below ? 'top' : 'bottom'}` }
          : { left: 0, top: 0, visibility: 'hidden' }
      }
    >
      <span>{label}</span>
      {keys && <kbd>{keys}</kbd>}
    </div>,
    document.body,
  );
}
