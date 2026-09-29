import { useState } from 'react';
import type { Kit, Recipe, Value } from '../../../libs/ui-runtime/types';

export function SettingsEditor({ kit, recipe, onChange }: { kit: Kit; recipe: Recipe; onChange: (subId: string, optionId: string, value: Value) => string }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  return <fieldset><legend>可修改項目</legend>{kit.subfeatures.filter(sub => recipe.selectedSubfeatures[kit.id]?.includes(sub.id)).flatMap(sub => sub.options.map(option => {
    const key = `${kit.id}::${sub.id}`;
    const id = `${key}/${option.id}`;
    const value = recipe.selectedSubfeatureOptions[key]?.[option.id] ?? option.defaultValue;
    function change(raw: string | boolean) {
      const next = option.type === 'number' ? (raw === '' ? NaN : Number(raw)) : raw;
      if (typeof raw === 'string') setDrafts(previous => ({ ...previous, [id]: raw }));
      const error = onChange(sub.id, option.id, next);
      setErrors(previous => ({ ...previous, [id]: error }));
    }
    return <div key={id} className="setting"><label htmlFor={id}>{option.displayName}</label>
      {option.type === 'boolean' ? <input id={id} type="checkbox" checked={Boolean(value)} onChange={e => change(e.target.checked)} />
        : option.target.property === 'options' ? <textarea id={id} value={drafts[id] ?? String(value)} onChange={e => change(e.target.value)} aria-describedby={`${id}-error`} />
        : <input id={id} type={option.type === 'number' ? 'number' : 'text'} min={option.range?.minimum} max={option.range?.maximum} value={drafts[id] ?? String(value)} onChange={e => change(e.target.value)} aria-describedby={`${id}-error`} />}
      <small>{option.change_level} / 角色提示：{option.allowed_roles.join(', ')} / {option.risk}；來源：{Object.hasOwn(recipe.selectedSubfeatureOptions[key] ?? {}, option.id) ? 'Recipe 覆寫' : 'Kit 預設'}</small>
      <span id={`${id}-error`} role={errors[id] ? 'alert' : undefined}>{errors[id]}</span>
    </div>;
  }))}</fieldset>;
}
