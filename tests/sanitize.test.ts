// @vitest-environment jsdom
import { assert, test } from 'vitest';
import { cleanEmail } from '../src/ui/sanitize.ts';

const off = { remoteImages: false };
const on = { remoteImages: true };

test('scripts, handlers, forms, frames and bad links are removed', () => {
  const { html } = cleanEmail(
    `<p onclick="steal()">Hi</p><script>steal()</script><a href="javascript:steal()">x</a>
     <form action="https://evil.example"><input name="pw"></form><iframe src="https://evil.example"></iframe>
     <img src="x" onerror="steal()"><a href="https://ok.example" target="_blank" ping="https://t.example">ok</a>`,
    on,
  );
  assert.notMatch(html, /script|onclick|onerror|javascript:|<form|<input|<iframe|ping=|target=/i);
  assert.match(html, /<a href="https:\/\/ok\.example">ok<\/a>/);
});

test('mailto links survive', () => {
  assert.match(cleanEmail('<a href="mailto:help@x.example?subject=Hi">Email us</a>', off).html, /href="mailto:help@x\.example\?subject=Hi"/);
});

test('remote images and CSS backgrounds wait until allowed', () => {
  const src = `<img src="https://t.example/pixel.gif"><div style="background:url(https://t.example/bg.png)">x</div>
    <table background="//t.example/t.png"><tr><td>y</td></tr></table>
    <style>.a{background-image:url('https://t.example/c.png')} @import url(https://t.example/x.css);</style>`;
  const blocked = cleanEmail(src, off);
  assert.isTrue(blocked.blockedRemote);
  assert.notMatch(blocked.html, /t\.example/);
  const allowed = cleanEmail(src, on);
  assert.isFalse(allowed.blockedRemote);
  assert.match(allowed.html, /https:\/\/t\.example\/pixel\.gif/);
});

test('head styles are kept and body rules aim at the email wrapper', () => {
  const { html } = cleanEmail('<html><head><style>body{color:red} tbody td{x:1}</style></head><body><p>Hi</p></body></html>', off);
  assert.match(html, /\.glance-body\{color:red\}/);
  assert.match(html, /tbody td/);
  assert.match(html, /<p>Hi<\/p>/);
});

test('inline cid images become data URLs', () => {
  const { html } = cleanEmail('<img src="cid:logo">', { remoteImages: false, inline: new Map([['logo', 'data:image/png;base64,AAAA']]) });
  assert.match(html, /src="data:image\/png;base64,AAAA"/);
});
