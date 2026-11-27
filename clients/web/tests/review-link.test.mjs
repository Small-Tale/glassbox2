import assert from 'node:assert/strict';
import test from 'node:test';

import { parseReviewLink, reviewLinkUrl } from '../src/components/review/review-link.ts';

// HS2-B5K6GM: the deep link for a cited commit round-trips and refuses anything malformed.
const target = { directory: '/work/my repo', commit: 'abcdef1234', path: 'src/a&b.ts', line: 42 };

test('a cited commit link round-trips through a page address', () => {
  const url = new URL(reviewLinkUrl('http://127.0.0.1:4100', target));
  assert.equal(url.origin, 'http://127.0.0.1:4100');
  assert.equal(url.pathname, '/');
  assert.deepEqual(parseReviewLink(url.search), target);
  for (const odd of [
    { ...target, directory: 'C:\\Users\\a b\\repo', path: 'ü/ñ.ts' },
    { ...target, path: 'a?b=c#d.ts', directory: '/tmp/100%/x' },
  ]) {
    assert.deepEqual(parseReviewLink(new URL(reviewLinkUrl('http://127.0.0.1:4100', odd)).search), odd);
  }
});

test('an ordinary page address names no cited commit', () => {
  for (const search of ['', '?', '?review=1', '?open=file&directory=/r&commit=abcdef1&path=a&line=1']) {
    assert.equal(parseReviewLink(search), null, search);
  }
});

test('a malformed cited commit link is refused and a valid hash is normalised', () => {
  const valid = '?open=commit&directory=%2Fr&commit=ABCDEF1&path=a.ts&line=3';
  assert.deepEqual(parseReviewLink(valid), { directory: '/r', commit: 'abcdef1', path: 'a.ts', line: 3 });
  const without = (name) => valid.replace(new RegExp(`&${name}=[^&]*`, 'u'), '');
  for (const name of ['directory', 'commit', 'path', 'line']) {
    assert.equal(parseReviewLink(without(name)), null, `no ${name}`);
  }
  for (const commit of ['', 'HEAD', 'abc', 'abcdef', '--all', 'abcdef1^', 'g'.repeat(8), 'a'.repeat(41)]) {
    assert.equal(parseReviewLink(valid.replace('ABCDEF1', commit)), null, commit);
  }
  for (const line of ['', '0', '-1', '1.5', '01', 'x', '1e3', '9999999999']) {
    assert.equal(parseReviewLink(valid.replace('line=3', `line=${line}`)), null, `line ${line}`);
  }
  assert.equal(parseReviewLink(valid.replace('directory=%2Fr', 'directory=')), null);
  assert.equal(parseReviewLink(valid.replace('path=a.ts', 'path=')), null);
});
