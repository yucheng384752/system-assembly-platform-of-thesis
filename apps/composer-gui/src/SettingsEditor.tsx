import { useState } from 'react';
import type { Kit, Recipe, Value } from '../../../libs/ui-runtime/types';

export function SettingsEditor({ kit, recipe, onChange, legacy = false }: { kit: Kit; recipe: Recipe; onChange: (subId: string, optionId: string, value: Value) => string; legacy?: boolean }) {
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
      {option.type === 'boolean' ? <label className="switch-wrap"><input id={id} className="switch" role="switch" aria-describedby={`${id}-error`} type="checkbox" checked={Boolean(value)} onChange={e => change(e.target.checked)} /></label>
        : option.target.property === 'options' ? <textarea id={id} value={drafts[id] ?? String(value)} onChange={e => change(e.target.value)} aria-describedby={`${id}-error`} />
        : <input id={id} type={option.type === 'number' ? 'number' : 'text'} min={option.range?.minimum} max={option.range?.maximum} value={drafts[id] ?? String(value)} onChange={e => change(e.target.value)} aria-describedby={`${id}-error`} />}
      {legacy ? <small>{option.change_level} / 角色提示：{option.allowed_roles.join(', ')} / {option.risk}；來源：{Object.hasOwn(recipe.selectedSubfeatureOptions[key] ?? {}, option.id) ? 'Recipe 覆寫' : 'Kit 預設'}</small> : <>
        <small>適用對象：一般使用者；低風險，只改變畫面顯示。來源：{Object.hasOwn(recipe.selectedSubfeatureOptions[key] ?? {}, option.id) ? '您的設定' : '預設值'}</small>
        <details><summary>進階設定資訊</summary><small>{option.change_level} / 角色提示：{option.allowed_roles.join(', ')} / {option.risk}</small></details>
      </>}
      <span id={`${id}-error`} role={errors[id] ? 'alert' : undefined}>{errors[id] ? legacy ? errors[id] : `「${option.displayName}」的值不符合限制，請檢查內容、長度或數值範圍。上次有效設定已保留。` : ''}</span>
      {!legacy && errors[id] && <details><summary>進階：驗證詳情</summary><p>{errors[id]}</p></details>}
    </div>;
  }))}</fieldset>;
}
