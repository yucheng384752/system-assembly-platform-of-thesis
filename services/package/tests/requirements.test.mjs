import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeRequirements } from '../deployment.mjs';

test('pins are merged, sorted and deduplicated; a conflicting pin or a loose one is refused', () => {
  assert.equal(mergeRequirements(['b==2.0\n# note\na==1.0', 'a==1.0']), 'a==1.0\nb==2.0\n');
  assert.throws(() => mergeRequirements(['a==1.0', 'a==2.0']), /依賴版本衝突/);
  assert.throws(() => mergeRequirements(['a>=1.0']), /依賴未固定版本/);
  assert.throws(() => mergeRequirements(['a']), /依賴未固定版本/);
});

test('a local version tag is a pin like any other', () => {
  assert.equal(mergeRequirements(['torch==2.14.1+cpu']), 'torch==2.14.1+cpu\n');
});

test('an extra package index goes first, once, and only as https without credentials', () => {
  const merged = mergeRequirements(['--extra-index-url https://download.pytorch.org/whl/cpu\ntorch==2.14.1+cpu', '--extra-index-url https://download.pytorch.org/whl/cpu\nz==1']);
  assert.equal(merged, '--extra-index-url https://download.pytorch.org/whl/cpu\ntorch==2.14.1+cpu\nz==1\n');
  for (const bad of ['--extra-index-url http://example.com/simple', '--extra-index-url https://user:pw@example.com/simple', '--extra-index-url not-a-url', '--extra-index-url']) {
    assert.throws(() => mergeRequirements([bad]), /額外套件來源|不支援的依賴檔選項/, bad);
  }
});

test('other pip options are refused, so a Kit cannot change how the image installs', () => {
  for (const option of ['--index-url https://example.com/simple', '--trusted-host example.com', '-r other.txt', '--no-deps', '--find-links https://example.com']) {
    assert.throws(() => mergeRequirements([option]), /不支援的依賴檔選項|依賴未固定版本/, option);
  }
});
