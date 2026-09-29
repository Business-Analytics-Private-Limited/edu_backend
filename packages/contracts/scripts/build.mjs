// Builds the API contract (ADR-0010):
//   1. merges openapi/<module>.yaml files and common.yaml into one OpenAPI 3.1 document
//   2. checks the documentation rules from docs/08-api-conventions.md
//   3. writes dist/openapi.json and dist/openapi.yaml
//   4. generates TypeScript types (src/generated/openapi.ts)
//   5. generates the Postman collection (postman/eduplatform.postman_collection.json)
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import openapiTS, { astToString } from 'openapi-typescript';
import Converter from 'openapi-to-postmanv2';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const openapiDir = join(pkgDir, 'openapi');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];
const OPERATION_ID = /^[a-z_]+\.[a-z_]+\.[a-z_]+$/;
const PERMISSION = /^[a-z_]+\.[a-z_]+\.[a-z_]+$/;

function readYaml(file) {
  return YAML.parse(readFileSync(join(openapiDir, file), 'utf8'));
}

// ---- 1. merge ------------------------------------------------------------------------------
const common = readYaml('common.yaml');
const moduleFiles = readdirSync(openapiDir)
  .filter((f) => f.endsWith('.yaml') && f !== 'common.yaml')
  .sort();

const doc = {
  openapi: '3.1.0',
  info: {
    title: 'EduPlatform API',
    version: pkg.version,
    description:
      'Generated from packages/contracts/openapi. Conventions: docs/08-api-conventions.md. ' +
      'Module guides: docs/modules/.',
  },
  servers: [{ url: 'http://localhost:3000/api/v1', description: 'Local development' }],
  security: [{ keycloak: ['openid'] }],
  tags: [],
  paths: {},
  components: structuredClone(common.components ?? {}),
};

const errors = [];
for (const file of moduleFiles) {
  const part = readYaml(file);
  for (const tag of part.tags ?? []) {
    if (!doc.tags.some((t) => t.name === tag.name)) doc.tags.push(tag);
  }
  for (const [path, item] of Object.entries(part.paths ?? {})) {
    if (doc.paths[path]) errors.push(`${file}: path ${path} is already defined in another file`);
    doc.paths[path] = item;
  }
  for (const [section, entries] of Object.entries(part.components ?? {})) {
    doc.components[section] ??= {};
    for (const [name, value] of Object.entries(entries)) {
      if (doc.components[section][name]) {
        errors.push(`${file}: components.${section}.${name} is already defined`);
      }
      doc.components[section][name] = value;
    }
  }
}

// References to common.yaml become local references in the merged document.
const merged = JSON.parse(JSON.stringify(doc).replace(/"(\.\/)?common\.yaml#\//g, '"#/'));

// ---- 2. rules ------------------------------------------------------------------------------
const operationIds = new Set();
for (const [path, item] of Object.entries(merged.paths)) {
  for (const method of HTTP_METHODS) {
    const op = item[method];
    if (!op) continue;
    const where = `${method.toUpperCase()} ${path}`;
    if (!op.operationId || !OPERATION_ID.test(op.operationId)) {
      errors.push(`${where}: operationId must look like module.resource.action`);
    } else if (operationIds.has(op.operationId)) {
      errors.push(`${where}: duplicate operationId ${op.operationId}`);
    } else {
      operationIds.add(op.operationId);
    }
    if (!op.summary) errors.push(`${where}: summary is required`);
    if (!op.tags?.length) errors.push(`${where}: at least one tag is required`);
    if (!op['x-module']) errors.push(`${where}: x-module is required`);
    const permission = op['x-permission'];
    if (
      !permission ||
      !(['public', 'authenticated'].includes(permission) || PERMISSION.test(permission))
    ) {
      errors.push(`${where}: x-permission must be public, authenticated or module.resource.action`);
    }
    if (!Object.keys(op.responses ?? {}).some((code) => /^2\d\d$/.test(code))) {
      errors.push(`${where}: a 2xx response is required`);
    }
  }
}

const refPattern = /"\$ref":"#\/components\/([^/"]+)\/([^/"]+)"/g;
for (const [, section, name] of JSON.stringify(merged).matchAll(refPattern)) {
  if (!merged.components?.[section]?.[name]) {
    errors.push(`unresolved reference #/components/${section}/${name}`);
  }
}

if (errors.length > 0) {
  console.error('OpenAPI contract errors:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

// ---- 3. bundled document -------------------------------------------------------------------
mkdirSync(join(pkgDir, 'dist'), { recursive: true });
writeFileSync(join(pkgDir, 'dist', 'openapi.json'), JSON.stringify(merged, null, 2) + '\n');
writeFileSync(join(pkgDir, 'dist', 'openapi.yaml'), YAML.stringify(merged));

// ---- 4. TypeScript types -------------------------------------------------------------------
const ast = await openapiTS(merged);
mkdirSync(join(pkgDir, 'src', 'generated'), { recursive: true });
writeFileSync(
  join(pkgDir, 'src', 'generated', 'openapi.ts'),
  '// Generated by packages/contracts/scripts/build.mjs. Do not edit.\n' + astToString(ast),
);

// ---- 5. Postman collection -----------------------------------------------------------------
const conversion = await new Promise((resolve, reject) => {
  Converter.convert(
    { type: 'json', data: merged },
    {
      folderStrategy: 'Tags',
      requestNameSource: 'Fallback',
      // Use the contract's examples, never generated values, so the file is identical on
      // every build (both the current and the older option names, for converter versions).
      parametersResolution: 'Example',
      requestParametersResolution: 'Example',
      exampleParametersResolution: 'Example',
    },
    (err, result) => (err ? reject(err) : resolve(result)),
  );
});
if (!conversion.result) {
  console.error(`Postman conversion failed: ${conversion.reason}`);
  process.exit(1);
}

const collection = conversion.output[0].data;
// Generated ids are random; replace them with stable ones so the committed file only changes
// when the contract changes (CI checks that it is up to date).
const stableId = (seed) => {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const normalizeIds = (node, trail) => {
  if (Array.isArray(node)) {
    node.forEach((child, i) => normalizeIds(child, `${trail}/${i}`));
  } else if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      if (key === 'id' || key === '_postman_id') node[key] = stableId(`${trail}/${key}`);
      else normalizeIds(node[key], `${trail}/${key}`);
    }
  }
};
normalizeIds(collection, 'collection');
collection.info.name = 'EduPlatform API';
collection.info._postman_id = stableId('eduplatform-collection');

mkdirSync(join(pkgDir, 'postman'), { recursive: true });
writeFileSync(
  join(pkgDir, 'postman', 'eduplatform.postman_collection.json'),
  JSON.stringify(collection, null, 2) + '\n',
);

console.log(
  `Contract built: ${operationIds.size} operations from ${moduleFiles.length} module file(s).`,
);
