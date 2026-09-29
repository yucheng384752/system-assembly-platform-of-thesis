import { useState } from 'react';
import type { Definition, Sources } from './types';

// Both preview and target consumers use this renderer; actions only filter supplied rows.
export function Renderer({ definition, sources }: { definition: Definition; sources: Sources }) {
  const [selections, setSelections] = useState<Record<string, { value: string; signature: string }>>({});
  const selectedValue = (id: string, fallback: string, signature: string) => selections[id]?.signature === signature ? selections[id].value : fallback;
  return <div>{definition.components.map(component => {
    if (component.type === 'select') {
      const signature = JSON.stringify([component.options, component.defaultValue]);
      return <label key={component.id}>{component.title}
        <select aria-label={component.title} value={selectedValue(component.id, component.defaultValue, signature)} onChange={event => setSelections(previous => ({ ...previous, [component.id]: { value: event.target.value, signature } }))}>
          {component.options.map(o => <option key={o.value} value={o.value}>{o.displayName}</option>)}
        </select>
      </label>;
    }
    const filters = definition.components.filter(c => c.type === 'select' && c.action.target_component_id === component.id);
    const rows = sources[component.source_ref].rows.filter(row => filters.every(c => c.type !== 'select' || String(row[c.action.field]) === selectedValue(c.id, c.defaultValue, JSON.stringify([c.options, c.defaultValue]))));
    const columns = component.columns.filter(c => c.visible);
    return <table key={component.id}><caption>{component.title}</caption><thead><tr>{columns.map(c => <th key={c.field} scope="col" style={{ width: c.width }}>{c.label}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>{columns.map(c => <td key={c.field}>{row[c.field]}</td>)}</tr>)}</tbody>
    </table>;
  })}</div>;
}
