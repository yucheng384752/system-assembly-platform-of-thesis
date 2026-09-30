import { endpoint, findCycle, nextId, stepOfForm, type AovDocument, type AovStep, type FormEndpoint, type FormRelation } from './workflow';
import type { FormDraft } from './localData';

export interface Candidate { from: FormEndpoint; to: FormEndpoint }
const key = (name: string) => name.replace(/\s/g, '');
const linked = (doc: AovDocument, a: string, b: string) => doc.relations.some(r =>
  (r.from.formId === a && r.to.formId === b) || (r.from.formId === b && r.to.formId === a));

// D19: same name ignoring whitespace, same type, and at least one side marked isKey. Deterministic, never auto-applied.
// Direction follows step order (earlier step is upstream); pairs already linked or that would close a cycle are skipped (D22).
export function inferCandidates(doc: AovDocument): Candidate[] {
  const order = (form: FormDraft) => {
    const step = stepOfForm(doc, form.id);
    return [step ? doc.steps.indexOf(step) : doc.steps.length, doc.forms.indexOf(form)];
  };
  const sorted = [...doc.forms].sort((a, b) => order(a)[0] - order(b)[0] || order(a)[1] - order(b)[1]);
  const result: Candidate[] = [];
  sorted.forEach((upstream, index) => sorted.slice(index + 1).forEach(downstream => {
    if (linked(doc, upstream.id, downstream.id) || findCycle(doc, { from: upstream.id, to: downstream.id })) return;
    for (const a of upstream.fields) for (const b of downstream.fields) {
      if (key(a.name) && key(a.name) === key(b.name) && a.type === b.type && (a.isKey || b.isKey)) {
        result.push({ from: { formId: upstream.id, fieldId: a.id }, to: { formId: downstream.id, fieldId: b.id } });
      }
    }
  }));
  return result;
}
export function addRelation(doc: AovDocument, candidate: Candidate, origin: FormRelation['origin']): AovDocument {
  return { ...doc, relations: [...doc.relations, { id: nextId('rel', doc.relations), kind: 'shared-key', from: { ...candidate.from }, to: { ...candidate.to }, origin, confirmed: true }] };
}

export interface TraceLink { form: FormDraft; step?: AovStep; via: string }
export interface Trace { form: FormDraft; step?: AovStep; upstream: TraceLink[]; downstream: TraceLink[] }
// A23: for a record of this form, which step fills it, which role owns it, and which forms it links to through confirmed relations.
export function traceForm(doc: AovDocument, formId: string): Trace | undefined {
  const form = doc.forms.find(f => f.id === formId);
  if (!form) return undefined;
  const link = (relation: FormRelation, other: FormEndpoint, own: FormEndpoint): TraceLink[] => {
    const target = endpoint(doc, other); const self = endpoint(doc, own);
    return target.form && target.field && self.field ? [{ form: target.form, step: stepOfForm(doc, target.form.id), via: self.field.name === target.field.name ? self.field.name : `${self.field.name} ＝ ${target.field.name}` }] : [];
  };
  return {
    form, step: stepOfForm(doc, formId),
    upstream: doc.relations.filter(r => r.to.formId === formId).flatMap(r => link(r, r.from, r.to)),
    downstream: doc.relations.filter(r => r.from.formId === formId).flatMap(r => link(r, r.to, r.from)),
  };
}
