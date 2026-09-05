import type { OpenPetsPluginManifest, PluginConfigField } from "./plugin-manifest.js";
import { isValidUserSoundId } from "./plugin-user-sound-store.js";

export type PluginConfigValue = string | number | boolean | string[] | Array<Record<string, unknown>> | { kind: "user-sound"; id: string; name?: string } | null;
export type PluginConfig = Record<string, PluginConfigValue>;

export type PluginConfigValidationError = { path: string; code: string; message: string };
export type PluginConfigValidationResult = { ok: true; config: PluginConfig; errors: [] } | { ok: false; errors: PluginConfigValidationError[] };

export function getPluginDefaultConfig(manifest: OpenPetsPluginManifest): PluginConfig {
  const config: PluginConfig = {};
  for (const [key, field] of configSchemaEntries(manifest)) {
    if (isValidDefault(field)) config[key] = field.default;
  }
  return config;
}

export function validatePluginConfigReplacement(manifest: OpenPetsPluginManifest, value: unknown): PluginConfigValidationResult {
  return validateConfigObject(manifest, value, { rejectUnknown: true, applyDefaults: false });
}

export function getEffectivePluginConfig(manifest: OpenPetsPluginManifest, persisted: unknown): PluginConfigValidationResult {
  return validateConfigObject(manifest, persisted, { rejectUnknown: false, applyDefaults: true });
}

export function resolvePluginNumericConfig(manifest: OpenPetsPluginManifest, persisted: unknown, fieldName: string, options: { min?: number } = {}): number {
  const schema = manifest.configSchema;
  const field = schema && Object.prototype.hasOwnProperty.call(schema, fieldName) ? schema[fieldName] : undefined;
  if (!field || field.type !== "number") throw new Error(`Plugin numeric config ${fieldName} must reference a number config field.`);
  const result = getEffectivePluginConfig(manifest, persisted);
  if (!result.ok) throw new Error(`Plugin numeric config ${fieldName} is invalid: ${result.errors.map((error) => error.message).join("; ")}`);
  if (!Object.prototype.hasOwnProperty.call(result.config, fieldName)) throw new Error(`Plugin numeric config ${fieldName} must resolve to an integer.`);
  const value = result.config[fieldName];
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) throw new Error(`Plugin numeric config ${fieldName} must resolve to an integer.`);
  if (options.min !== undefined && value < options.min) throw new Error(`Plugin numeric config ${fieldName} must be an integer of at least ${options.min}.`);
  return value;
}

export function resolvePluginStringConfig(manifest: OpenPetsPluginManifest, persisted: unknown, fieldName: string, allowedType: "text" | "select"): string {
  const schema = manifest.configSchema;
  const field = schema && Object.prototype.hasOwnProperty.call(schema, fieldName) ? schema[fieldName] : undefined;
  if (!field || field.type !== allowedType) throw new Error(`Plugin string config reference must point to a ${allowedType} config field.`);
  const result = getEffectivePluginConfig(manifest, persisted);
  if (!result.ok) throw new Error("Plugin string config is invalid.");
  if (!Object.prototype.hasOwnProperty.call(result.config, fieldName)) throw new Error("Plugin string config must resolve to a value.");
  const value = result.config[fieldName];
  if (typeof value !== "string") throw new Error("Plugin string config must resolve to a string.");
  return value;
}

function validateConfigObject(manifest: OpenPetsPluginManifest, value: unknown, options: { rejectUnknown: boolean; applyDefaults: boolean }): PluginConfigValidationResult {
  const errors: PluginConfigValidationError[] = [];
  if (!isPlainRecord(value)) return { ok: false, errors: [{ path: "$", code: "invalid_config", message: "Plugin config must be a plain object." }] };
  const config: PluginConfig = options.applyDefaults ? getPluginDefaultConfig(manifest) : {};
  const schema = manifest.configSchema ?? {};

  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    const field = Object.prototype.hasOwnProperty.call(schema, key) ? schema[key] : undefined;
    if (!field) {
      if (options.rejectUnknown) errors.push({ path: `$.${key}`, code: "unknown_config_key", message: `Unknown config key ${key}.` });
      continue;
    }
    const fieldErrors = validateFieldValue(value[key], field, `$.${key}`);
    if (fieldErrors.length > 0) errors.push(...fieldErrors);
    else config[key] = value[key] as PluginConfigValue;
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config, errors: [] };
}

function validateFieldValue(value: unknown, field: PluginConfigField, path: string): PluginConfigValidationError[] {
  const errors: PluginConfigValidationError[] = [];
  if (field.type === "list") {
    if (!Array.isArray(value) || !value.every((item) => isPlainRecord(item))) return [{ path, code: "invalid_config_value", message: "List config value must be an array of objects." }];
    if (field.maxItems !== undefined && value.length > field.maxItems) return [{ path, code: "invalid_config_value", message: "List config has too many items." }];
    const itemSchema = field.itemSchema ?? {};
    for (const [index, item] of value.entries()) for (const [itemKey, itemField] of Object.entries(itemSchema)) if (Object.prototype.hasOwnProperty.call(item, itemKey)) errors.push(...validateFieldValue(item[itemKey], itemField, `${path}[${index}].${itemKey}`));
    return errors;
  }
  if (field.type === "multiSelect") return Array.isArray(value) && value.every((item) => typeof item === "string" && field.options?.some((option) => option.value === item)) ? [] : [{ path, code: "invalid_config_value", message: "Multi-select config value must be an array of option values." }];
  if (field.type === "sound") return isValidSoundConfigValue(value) ? [] : [{ path, code: "invalid_config_value", message: "Sound config value must be a host sound name or user sound reference." }];
  if (value === null || Array.isArray(value) || typeof value === "object") return [{ path, code: "invalid_config_value", message: "Config value must match the field type." }];
  if (field.type === "text" || field.type === "textarea") {
    if (typeof value !== "string") errors.push({ path, code: "invalid_config_value", message: "Config value must be a string." });
    else if (field.maxLength !== undefined && value.length > field.maxLength) errors.push({ path, code: "invalid_config_value", message: "Config value is too long." });
  } else if (field.type === "time") {
    if (typeof value !== "string" || !isValidTime(value)) errors.push({ path, code: "invalid_config_value", message: "Time config value must be HH:mm between 00:00 and 23:59." });
  } else if (field.type === "select") {
    if (typeof value !== "string") errors.push({ path, code: "invalid_config_value", message: "Select config value must be a string." });
    else if (!field.options?.some((option) => option.value === value)) errors.push({ path, code: "invalid_select_value", message: "Select config value must match one of the schema options." });
  } else if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) errors.push({ path, code: "invalid_config_value", message: "Config value must be a finite number." });
    else if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) errors.push({ path, code: "invalid_config_value", message: "Number config value is outside allowed range." });
  } else if (field.type === "boolean") {
    if (typeof value !== "boolean") errors.push({ path, code: "invalid_config_value", message: "Config value must be a boolean." });
  }
  return errors;
}

function isValidTime(value: string): boolean { const m = /^(\d{2}):(\d{2})$/.exec(value); return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59; }

function isValidSoundConfigValue(value: unknown): boolean {
  if (value === null || value === "") return true;
  if (typeof value === "string") return value.length <= 80 && /^[A-Za-z0-9._-]+$/.test(value) && !looksLikeFilesystemPath(value);
  if (!isPlainRecord(value)) return false;
  return value.kind === "user-sound" && isValidUserSoundId(value.id) && (value.name === undefined || (typeof value.name === "string" && value.name.length <= 120));
}

function looksLikeFilesystemPath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("~") || /^[A-Za-z]:[\\/]/.test(value) || value.includes("\\") || value.includes("/") || value.startsWith("file:");
}

function configSchemaEntries(manifest: OpenPetsPluginManifest): Array<[string, PluginConfigField]> {
  return Object.entries(manifest.configSchema ?? {}).sort(([a], [b]) => a.localeCompare(b));
}

function isValidDefault(field: PluginConfigField): field is PluginConfigField & { default: PluginConfigValue } {
  if (field.default === undefined) return false;
  return validateFieldValue(field.default, field, "$.default").length === 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
