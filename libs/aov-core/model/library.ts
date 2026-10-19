import type { ArtifactType, AttrDef, ProjectFile, ResolvedType } from './types';

/** 內建基礎型別：場域型別以 extends 繼承它們 */
export const BUILTIN_TYPES: ArtifactType[] = [
  { id: 'material', name: '實體', kind: 'material', identity: 'lot' },
  { id: 'carrier', name: '載具', kind: 'carrier', identity: 'serial' },
  { id: 'info', name: '資訊', kind: 'information', identity: 'record' },
  {
    id: 'info.measurement',
    name: '量測紀錄',
    extends: 'info',
    attributes: {
      value: { type: 'quantity', source: 'generated' },
      method: { type: 'string', source: 'generated' },
    },
  },
  {
    id: 'info.judgment',
    name: '判定紀錄',
    extends: 'info',
    attributes: {
      verdict: { type: 'string', source: 'generated' },
      rule: { type: 'number', source: 'generated' },
      failed: { type: 'json', source: 'generated', description: '各等級不合格數' },
      results: { type: 'json', source: 'generated', description: '每個檢驗項目的結果' },
    },
  },
  {
    id: 'info.document',
    name: '文件',
    extends: 'info',
    attributes: {
      author: { type: 'string', source: 'generated' },
      content: { type: 'string', source: 'generated' },
    },
  },
  {
    id: 'info.approval',
    name: '核准紀錄',
    extends: 'info',
    attributes: {
      approver: { type: 'string', source: 'generated' },
      decision: { type: 'string', source: 'generated' },
      note: { type: 'string', source: 'generated' },
    },
  },
];

export const BUILTIN_IDS = new Set(BUILTIN_TYPES.map((t) => t.id));

/** 每個 artifact 都有的內建欄位，表達式中可直接存取 */
export const BUILTIN_FIELDS = ['id', 'type', 'version', 'qty', 'location', 'createdAt'] as const;

export class TypeLibrary {
  private readonly defs = new Map<string, ArtifactType>();
  private readonly cache = new Map<string, ResolvedType>();

  constructor(types: ArtifactType[]) {
    for (const t of BUILTIN_TYPES) this.defs.set(t.id, t);
    for (const t of types) this.defs.set(t.id, t);
  }

  static fromProject(p: ProjectFile): TypeLibrary {
    return new TypeLibrary(p.artifactTypes ?? []);
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  ids(): string[] {
    return [...this.defs.keys()];
  }

  userIds(): string[] {
    return [...this.defs.keys()].filter((id) => !BUILTIN_IDS.has(id));
  }

  raw(id: string): ArtifactType | undefined {
    return this.defs.get(id);
  }

  /** 繼承鏈，若有循環繼承或缺父型別則拋錯 */
  chain(id: string): string[] {
    const out: string[] = [];
    let cur: string | undefined = id;
    while (cur) {
      if (out.includes(cur)) throw new Error(`型別 ${id} 有循環繼承`);
      const def = this.defs.get(cur);
      if (!def) throw new Error(`找不到型別 ${cur}`);
      out.push(cur);
      cur = def.extends;
    }
    return out;
  }

  resolve(id: string): ResolvedType {
    const hit = this.cache.get(id);
    if (hit) return hit;
    const chain = this.chain(id);
    // 從最上層祖先往下覆蓋
    let kind: ResolvedType['kind'] | undefined;
    let identity: ResolvedType['identity'] | undefined;
    let quantity: ResolvedType['quantity'];
    let subject: ResolvedType['subject'];
    let transformIdentity: ResolvedType['transformIdentity'] = 'new_on_type_change';
    const attributes: Record<string, AttrDef> = {};
    for (const tid of [...chain].reverse()) {
      const d = this.defs.get(tid)!;
      if (d.kind) kind = d.kind;
      if (d.identity) identity = d.identity;
      if (d.quantity) quantity = { ...quantity, ...d.quantity };
      if (d.subject) subject = d.subject;
      if (d.transformIdentity) transformIdentity = d.transformIdentity;
      if (d.attributes) Object.assign(attributes, d.attributes);
    }
    const self = this.defs.get(id)!;
    const resolved: ResolvedType = {
      id,
      name: self.name ?? id,
      chain,
      kind: kind ?? 'material',
      identity: identity ?? (kind === 'information' ? 'record' : 'lot'),
      quantity,
      attributes,
      subject,
      transformIdentity,
    };
    this.cache.set(id, resolved);
    return resolved;
  }

  tryResolve(id: string): ResolvedType | undefined {
    try {
      return this.resolve(id);
    } catch {
      return undefined;
    }
  }

  /**
   * sub 是否符合 pattern。pattern 可以是：
   * - 型別 id：sub 等於它或繼承它
   * - glob：以 ".*" 結尾，sub 或其祖先以該前綴開頭
   */
  isA(sub: string, pattern: string): boolean {
    let chain: string[];
    try {
      chain = this.chain(sub);
    } catch {
      chain = [sub];
    }
    if (pattern === '*') return true;
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -1); // keep trailing dot
      const bare = pattern.slice(0, -2);
      return chain.some((c) => c === bare || c.startsWith(prefix));
    }
    return chain.includes(pattern);
  }

  /** 連線相容：輸出 port 的型別必須符合輸入 port 的型別 */
  compatible(outType: string, inType: string): boolean {
    if (outType.endsWith('.*') || outType === '*') {
      // 輸出是 glob：只有當輸入 pattern 涵蓋整個 glob 時才相容
      if (inType === '*' ) return true;
      const bare = outType === '*' ? '' : outType.slice(0, -2);
      return bare !== '' && this.isA(bare, inType);
    }
    return this.isA(outType, inType);
  }

  /** port 型別（可能是 glob）對應到的代表 kind */
  kindOf(pattern: string): ResolvedType['kind'] | undefined {
    const bare = pattern.endsWith('.*') ? pattern.slice(0, -2) : pattern;
    const r = this.tryResolve(bare);
    if (r) return r.kind;
    // glob 但前綴本身不是型別：找第一個符合的型別
    for (const id of this.defs.keys()) {
      if (this.isA(id, pattern)) return this.resolve(id).kind;
    }
    return undefined;
  }
}

export function isLinear(kind: ResolvedType['kind'] | undefined): boolean {
  return kind === 'material' || kind === 'carrier';
}

/** 解析 cardinality 字串 */
export function parseCardinality(c: string | undefined): { min: number; max: number } {
  const text = (c ?? '1').trim();
  const m = /^(\d+)(?:\.\.(\d+|\*))?$/.exec(text);
  if (!m) throw new Error(`無效的 cardinality：${text}`);
  const min = Number(m[1]);
  const max = m[2] === undefined ? min : m[2] === '*' ? Infinity : Number(m[2]);
  if (max < min) throw new Error(`cardinality 上限小於下限：${text}`);
  return { min, max };
}

export function isPortRequired(p: { required?: boolean; cardinality?: string }): boolean {
  if (p.required !== undefined) return p.required;
  try {
    return parseCardinality(p.cardinality).min > 0;
  } catch {
    return true;
  }
}
