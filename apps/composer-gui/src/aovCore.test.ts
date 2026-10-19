import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { checkProjectShape, validateProject, type ProjectFile } from '../../../libs/aov-core';
import version from '../../../libs/aov-core/VERSION.json';
import validProject from '../../../fixtures/aov-merge/c/project.valid.json';
import brokenNodes from '../../../fixtures/aov-merge/c/project.broken-nodes.json';

describe('固定版本的 aov core 快照（D103）', () => {
  test('快照檔案與 VERSION.json 記錄的雜湊一致，手動修改會被發現', () => {
    for (const file of version.files) {
      const text = readFileSync(new URL(`../../../libs/aov-core/${file.path}`, import.meta.url));
      expect(createHash('sha256').update(text).digest('hex'), file.path).toBe(file.sha256);
    }
    expect(version.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  test('可在 B 內驗證 C 的專案檔：合法通過，結構損壞回傳診斷而不是丟出例外', () => {
    expect(validateProject(validProject as unknown as ProjectFile).ok).toBe(true);
    expect(() => validateProject(brokenNodes as unknown as ProjectFile)).not.toThrow();
    expect(checkProjectShape(brokenNodes).some(d => d.code === 'S0-shape')).toBe(true);
  });
});
