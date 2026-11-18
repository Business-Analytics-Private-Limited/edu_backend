/**
 * The rule for switching modules on and off for an organization:
 *   - ON:  every module it depends on must already be on (Attendance needs Academic and Students).
 *   - OFF: no module that is still on may depend on it (Students can't go while Attendance is on).
 *
 * A plain function (no database), so it is easy to read and to test (module-rules.spec.ts).
 */
export interface ModuleInfo {
  key: string;
  name: string;
  dependsOn: string[];
}

/** Returns an error message, or null when the change is allowed. */
export function checkModuleChange(
  module: ModuleInfo,
  turnOn: boolean,
  allModules: ModuleInfo[],
  enabledKeys: string[],
): string | null {
  if (turnOn) {
    const missing = module.dependsOn.filter((key) => !enabledKeys.includes(key));
    if (missing.length > 0) {
      return `${module.name} needs these modules first: ${missing.join(', ')}`;
    }
    return null;
  }

  const dependents = allModules.filter(
    (other) => enabledKeys.includes(other.key) && other.dependsOn.includes(module.key),
  );
  if (dependents.length > 0) {
    return `Switch off these modules first: ${dependents.map((m) => m.name).join(', ')}`;
  }
  return null;
}
