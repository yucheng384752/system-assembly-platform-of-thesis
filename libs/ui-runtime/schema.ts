import Ajv from 'ajv/dist/2020';
import kit from '../../schemas/kit.schema.json';
import recipe from '../../schemas/recipe.schema.json';
import ui from '../../schemas/ui-definition.schema.json';
import aov from '../../schemas/aov.schema.json';
import packageManifest from '../../schemas/package-manifest.schema.json';
import manual from '../../schemas/manual.schema.json';
import site from '../../schemas/site-profile.schema.json';

// Baseline allows union types and includes an email format; no remote schema loading.
const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
ajv.addFormat('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
export const schemas = { kit: ajv.compile(kit), recipe: ajv.compile(recipe), ui: ajv.compile(ui), aov: ajv.compile(aov), packageManifest: ajv.compile(packageManifest), manual: ajv.compile(manual), site: ajv.compile(site) };
export function validateSchema(kind: keyof typeof schemas, value: unknown): void {
  const validate = schemas[kind];
  if (!validate(value)) throw new Error(`${kind}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
}
