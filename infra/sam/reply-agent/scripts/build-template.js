'use strict';
// Reads template.yaml + seed JSON files, inlines content as strings, writes template.built.yaml.
// Run before sam build/deploy.
//
// Usage: node scripts/build-template.js
//
// Why this script exists:
//   AWS::AppConfig::HostedConfigurationVersion.Content must be a String.
//   AWS::Include transforms resolve JSON files as YAML objects, not strings.
//   This script sidesteps that by inlining the raw JSON text directly.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const templateSrc = fs.readFileSync(path.join(root, 'template.yaml'), 'utf-8');
const sysPromptSeed = fs.readFileSync(path.join(root, 'config/system-prompt.seed.json'), 'utf-8').trim();
const featureFlagsSeed = fs.readFileSync(path.join(root, 'config/feature-flags.seed.json'), 'utf-8').trim();

// JSON-escape the seed content and wrap in single-quoted YAML literal string.
// We embed it as a double-quoted YAML string so YAML parsers treat it as a scalar.
// JSON.stringify adds the surrounding double-quotes and escapes internal quotes/newlines.
const sysPromptYaml = JSON.stringify(sysPromptSeed);
const featureFlagsYaml = JSON.stringify(featureFlagsSeed);

let built = templateSrc
  .replace('"__SYSTEM_PROMPT_SEED_PLACEHOLDER__"', sysPromptYaml)
  .replace('"__FEATURE_FLAGS_SEED_PLACEHOLDER__"', featureFlagsYaml);

fs.writeFileSync(path.join(root, 'template.built.yaml'), built);
console.log('Wrote template.built.yaml');
console.log('  system-prompt seed: ' + sysPromptSeed.length + ' chars');
console.log('  feature-flags seed: ' + featureFlagsSeed.length + ' chars');
