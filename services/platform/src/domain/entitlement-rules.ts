/**
 * Rules for granting and taking away modules (docs/05-module-catalog.md §5.3).
 *
 * Pure functions: they get the catalog and the tenant's current entitlements, and either
 * return what to save or throw a ValidationError explaining why not. The service does the
 * reading and saving around them.
 */
import { ValidationError } from '@eduplatform/server-kit';

/** What the rules need to know about a catalog module. */
export interface CatalogModule {
  key: string;
  name: string;
  isCore: boolean;
  status: 'available' | 'planned' | 'retired';
  dependsOn: string[];
  variants: { key: string; isDefault: boolean; status: 'available' | 'planned' | 'retired' }[];
}

/**
 * Decides which variants to grant when enabling a module.
 *
 * @param requested variants the super admin asked for; empty or missing = the default variant
 * @param enabledModules keys of modules the tenant has enabled right now
 * @returns the variants to save
 */
export function checkEnable(
  module: CatalogModule | undefined,
  requested: string[] | undefined,
  enabledModules: ReadonlySet<string>,
): string[] {
  if (!module) {
    throw new ValidationError([
      { path: 'moduleKey', code: 'unknown_module', message: 'No such module' },
    ]);
  }
  if (module.status !== 'available') {
    throw new ValidationError([
      {
        path: 'moduleKey',
        code: 'module_not_available',
        message: `${module.name} is ${module.status}`,
      },
    ]);
  }

  // Rule: every module it depends on must already be enabled (e.g. attendance → students).
  const missing = module.dependsOn.filter((key) => !enabledModules.has(key));
  if (missing.length > 0) {
    throw new ValidationError(
      [
        {
          path: 'moduleKey',
          code: 'missing_dependency',
          message: `${module.name} needs these modules first: ${missing.join(', ')}`,
        },
      ],
      `${module.name} depends on modules that are not granted`,
    );
  }

  if (module.variants.length === 0) return [];

  const variants =
    requested && requested.length > 0
      ? [...new Set(requested)]
      : module.variants.filter((v) => v.isDefault).map((v) => v.key);

  const errors = variants.flatMap((key, index) => {
    const variant = module.variants.find((v) => v.key === key);
    if (!variant)
      return [
        {
          path: `allowedVariants.${index}`,
          code: 'unknown_variant',
          message: `No variant "${key}"`,
        },
      ];
    if (variant.status !== 'available') {
      return [
        {
          path: `allowedVariants.${index}`,
          code: 'variant_not_available',
          message: `"${key}" is ${variant.status}`,
        },
      ];
    }
    return [];
  });
  if (errors.length > 0) throw new ValidationError(errors);
  if (variants.length === 0) {
    throw new ValidationError([
      { path: 'allowedVariants', code: 'required', message: 'Choose at least one variant' },
    ]);
  }
  return variants;
}

/**
 * Checks that a module may be taken away.
 *
 * @param enabledModules the tenant's enabled modules, with what each depends on
 */
export function checkDisable(
  module: CatalogModule | undefined,
  enabledModules: ReadonlyArray<{ key: string; dependsOn: string[] }>,
): void {
  if (!module) {
    throw new ValidationError([
      { path: 'moduleKey', code: 'unknown_module', message: 'No such module' },
    ]);
  }
  if (module.isCore) {
    throw new ValidationError([
      {
        path: 'moduleKey',
        code: 'core_module',
        message: `${module.name} is part of every organization`,
      },
    ]);
  }
  // Rule: can't remove a module while an enabled module needs it (e.g. students ← attendance).
  const dependents = enabledModules
    .filter((m) => m.dependsOn.includes(module.key))
    .map((m) => m.key);
  if (dependents.length > 0) {
    throw new ValidationError([
      {
        path: 'moduleKey',
        code: 'has_dependents',
        message: `Take away these modules first: ${dependents.join(', ')}`,
      },
    ]);
  }
}

/** How long a disabled module stays readable before it is hidden (docs/05 §5.3). */
export const READ_ONLY_DAYS = 90;
