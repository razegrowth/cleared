import { assert, test } from 'vitest';
import { parseMailto, webUrl } from '../src/ui/links.ts';

test('only absolute web links are followed', () => {
  assert.equal(webUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(webUrl('http://example.com'), 'http://example.com/');
  assert.isNull(webUrl('javascript:alert(1)'));
  assert.isNull(webUrl('file:///etc/passwd'));
  assert.isNull(webUrl('data:text/html,hi'));
  assert.isNull(webUrl('/relative/path'));
  assert.isNull(webUrl('#top'));
});

test('mailto links become a draft', () => {
  assert.deepEqual(parseMailto('mailto:sam@x.com,dana%40y.com?subject=Lunch%20Thursday&cc=pat@z.com&body=Hi%0Athere'), {
    to: 'sam@x.com, dana@y.com',
    cc: 'pat@z.com',
    bcc: '',
    subject: 'Lunch Thursday',
    body: 'Hi\nthere',
  });
  assert.isNull(parseMailto('https://example.com'));
});
