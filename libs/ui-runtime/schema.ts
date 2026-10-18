import Ajv from 'ajv/dist/2020';
import kit from '../../schemas/kit.schema.json';
import recipe from '../../schemas/recipe.schema.json';
import ui from '../../schemas/ui-definition.schema.json';
import aov from '../../schemas/aov.schema.json';
import aovBundle from '../../schemas/aov-bundle.schema.json';
import kitWorkflow from '../../schemas/kit-workflow.schema.json';
import packageManifest from '../../schemas/package-manifest.schema.json';
import manual from '../../schemas/manual.schema.json';
import site from '../../schemas/site-profile.schema.json';
import kitRegistry from '../../schemas/kit-registry.schema.json';
import actionCatalog from '../../schemas/action-catalog.schema.json';

// Baseline allows union types and includes an email format; no remote schema loading.
const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
ajv.addFormat('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
export const schemas = { kit: ajv.compile(kit), recipe: ajv.compile(recipe), ui: ajv.compile(ui), aov: ajv.compile(aov), aovBundle: ajv.compile(aovBundle), kitWorkflow: ajv.compile(kitWorkflow), packageManifest: ajv.compile(packageManifest), manual: ajv.compile(manual), site: ajv.compile(site), kitRegistry: ajv.compile(kitRegistry), actionCatalog: ajv.compile(actionCatalog) };
export function validateSchema(kind: keyof typeof schemas, value: unknown): void {
  const validate = schemas[kind];
  if (!validate(value)) throw new Error(`${kind}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
}
