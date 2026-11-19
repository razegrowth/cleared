import DOMPurify from 'dompurify';

/**
 * Makes an email's HTML safe to put straight into Glance's page.
 *
 * Mail used to render in a sandboxed frame with scripts off. WebKit (and so
 * Quo) won't run anything in such a frame, not even Glance's own click
 * handler, so links there could never be followed. Instead the HTML is
 * sanitised here and drawn in a shadow root (EmailBody), where Glance can
 * handle clicks the same way in every browser.
 *
 * What's removed: scripts, event handlers, forms and their fields, frames,
 * embeds, <link>/<meta>/<base>, and any link that isn't web or mailto.
 * With remote images held back, every way a sender could load something on
 * open is removed too: <img src/srcset>, background attributes, url() in
 * style attributes and <style> blocks, and @import.
 */

/** A url(...) pointing off the device (http, https or protocol-relative). */
const REMOTE_CSS_URL = /url\(\s*(['"]?)\s*(?:https?:)?\/\/[^)]*\)/gi;
const IMPORT = /@import[^;]*;?/gi;
const REMOTE = /^\s*(?:https?:)?\/\//i;

/** An email's `body { … }` rules, aimed at the wrapper that stands in for <body>. */
function retargetBody(css: string): string {
  return css.replace(/(^|[\s,}>])(?:html|body)(?=[\s,{.#:[>]|$)/gi, '$1.glance-body');
}

export interface Cleaned {
  html: string;
  /** Whether anything remote was held back, so the reader can offer to load it. */
  blockedRemote: boolean;
}

export function cleanEmail(raw: string, opts: { remoteImages: boolean; inline?: Map<string, string> }): Cleaned {
  let blockedRemote = false;

  // Inline (cid:) images become data URLs before anything else looks at them.
  let html = raw;
  for (const [cid, url] of opts.inline ?? []) html = html.split(`cid:${cid}`).join(url);

  // Styles in <head> would be dropped with the head; carry them into the body.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const headStyles = [...doc.head.querySelectorAll('style')].map((s) => s.outerHTML).join('');
  html = headStyles + doc.body.innerHTML;

  const purify = DOMPurify(window);
  purify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName !== 'style') return;
    let css = node.textContent ?? '';
    if (!opts.remoteImages && (REMOTE_CSS_URL.test(css) || IMPORT.test(css))) {
      blockedRemote = true;
      css = css.replace(REMOTE_CSS_URL, 'none').replace(IMPORT, '');
    }
    REMOTE_CSS_URL.lastIndex = 0;
    IMPORT.lastIndex = 0;
    node.textContent = retargetBody(css);
  });
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;
    // Glance decides how links open (links.ts); a target here would only get in the way.
    node.removeAttribute('target');
    if (opts.remoteImages) return;
    for (const attr of ['src', 'srcset', 'background', 'poster']) {
      const v = node.getAttribute(attr);
      if (v && (REMOTE.test(v) || (attr === 'srcset' && /(?:https?:)?\/\//i.test(v)))) {
        node.removeAttribute(attr);
        blockedRemote = true;
      }
    }
    const style = node.getAttribute('style');
    if (style && /url\(/i.test(style)) {
      const next = style.replace(REMOTE_CSS_URL, 'none');
      REMOTE_CSS_URL.lastIndex = 0;
      if (next !== style) {
        node.setAttribute('style', next);
        blockedRemote = true;
      }
    }
  });

  const clean = purify.sanitize(html, {
    FORCE_BODY: true,
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['script', 'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'frame', 'object', 'embed', 'link', 'meta', 'base', 'svg', 'math'],
    FORBID_ATTR: ['srcdoc', 'formaction', 'action', 'ping'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|cid:|#)/i,
  }) as string;

  return { html: clean, blockedRemote };
}
