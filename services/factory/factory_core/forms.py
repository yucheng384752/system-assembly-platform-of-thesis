"""The form registry (contract section 4.3): form definitions the factory holds, addressed by their content hash.

A plan node names a form as `{formId, contentSha256}`, the hash being `contentSha256(FormDef)` computed in Composer over the
whole definition. The factory never rebuilds a form from its own station fields; an engineer uploads the definition, the
factory recomputes the hash itself, and a work order may only be created when every `(formId, contentSha256)` the plan
names is registered. A hash always means the same content, so a form cannot be "changed afterwards": a changed definition
is a different hash, and a plan built with the old one keeps pointing at the old content.
"""
from __future__ import annotations

from dataclasses import dataclass

from .canonical import CanonicalError, content_sha256, parse_json
from .plan import PlanRejected, _error

# AoV AttrValueType (libs/aov-core/model/types.ts). A new type there needs a deliberate change here.
FIELD_TYPES = ('number', 'string', 'bool', 'datetime', 'enum', 'quantity', 'string[]', 'json')
MAX_FORM_BYTES = 1024 * 1024


@dataclass(frozen=True)
class FormRecord:
    content_sha256: str
    form_id: str
    definition: dict
    uploaded_by: str
    uploaded_at: str


def _shape_errors(definition: object) -> list[dict]:
    if not isinstance(definition, dict):
        return [_error('broken-structure', '/definition', 'a form definition must be an object')]
    errors: list[dict] = []
    for key in ('id', 'name'):
        if not isinstance(definition.get(key), str) or not definition[key]:
            errors.append(_error('broken-structure', f'/definition/{key}', 'must be a non-empty string'))
    subject = definition.get('subject')
    if not isinstance(subject, list) or not all(isinstance(s, str) for s in subject):
        errors.append(_error('broken-structure', '/definition/subject', 'must be a list of strings'))
    if 'extends' in definition and not isinstance(definition['extends'], str):
        errors.append(_error('broken-structure', '/definition/extends', 'must be a string when present'))
    fields = definition.get('fields')
    if not isinstance(fields, dict):
        errors.append(_error('broken-structure', '/definition/fields', 'must be an object of fields'))
        return errors
    for name, field in fields.items():
        path = f'/definition/fields/{name}'
        if not isinstance(field, dict):
            errors.append(_error('broken-structure', path, 'a field must be an object'))
        elif field.get('type') not in FIELD_TYPES:
            errors.append(_error('unknown-field-type', path + '/type', f'must be one of {", ".join(FIELD_TYPES)}'))
    return errors


def receive_form(document: str | dict, *, uploaded_by: str, uploaded_at: str) -> FormRecord:
    """Parse and verify an upload `{contentSha256, definition}`; raise PlanRejected. The factory's own hash must equal the claim."""
    try:
        body = parse_json(document) if isinstance(document, str) else document
    except ValueError as error:
        raise PlanRejected([_error('broken-structure', '/', f'not valid JSON: {error}')]) from error
    if not isinstance(body, dict) or set(body) != {'contentSha256', 'definition'}:
        raise PlanRejected([_error('broken-structure', '/', 'the upload must be an object with exactly contentSha256 and definition')])
    errors = _shape_errors(body['definition'])
    if errors:
        raise PlanRejected(errors)
    try:
        actual = content_sha256(body['definition'])
    except CanonicalError as error:
        raise PlanRejected([_error('not-canonical', '/definition', str(error))]) from error
    if body['contentSha256'] != actual:
        raise PlanRejected([_error('form-hash-mismatch', '/contentSha256', f'the definition hashes to {actual}, not the claimed value')])
    return FormRecord(actual, body['definition']['id'], body['definition'], uploaded_by, uploaded_at)


def plan_forms(plan: dict) -> set[tuple[str, str]]:
    """Every `(formId, contentSha256)` the plan's nodes name."""
    return {(n['form']['formId'], n['form']['contentSha256']) for n in plan['nodes'] if n.get('form')}
