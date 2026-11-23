import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsonLdScript } from './jsonld';

const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

test('escapes script-closing payloads in metadata', () => {
  const out = jsonLdScript({
    headline: 'x</script><script>alert(1)</script>',
    author: { name: 'a & b' },
  });
  assert.equal(out.includes('</script>'), false);
  assert.equal(out.includes('<script>'), false);
  // The escaped output is still valid JSON carrying the original text.
  const parsed = JSON.parse(out) as { headline: string; author: { name: string } };
  assert.equal(parsed.headline, 'x</script><script>alert(1)</script>');
  assert.equal(parsed.author.name, 'a & b');
});

test('escapes unicode line separators that break script parsing', () => {
  const original = `a${LINE_SEP}b${PARA_SEP}c`;
  const out = jsonLdScript({ t: original });
  assert.equal(out.includes(LINE_SEP), false);
  assert.equal(out.includes(PARA_SEP), false);
  assert.equal((JSON.parse(out) as { t: string }).t, original);
});
