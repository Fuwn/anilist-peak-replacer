import packageJson from './package.json' with { type: 'json' };

const OUTPUT_PATH = 'dist/anilist-peak-replacer.user.js';

const metadata = {
  name: 'AniList Peak Replacer',
  namespace: 'https://github.com/Fuwn/anilist-peak-replacer',
  version: packageJson.version,
  description: packageJson.description,
  author: 'Fuwn',
  license: packageJson.license,
  match: 'https://anilist.co/*',
  grant: [
    'GM.xmlHttpRequest',
    'GM_xmlhttpRequest',
    'GM.getValue',
    'GM_getValue',
    'GM.setValue',
    'GM_setValue',
    'GM.registerMenuCommand',
    'GM_registerMenuCommand',
  ],
  connect: 'openrouter.ai',
  'run-at': 'document-idle',
};

const renderMetadataBlock = (): string => {
  const lines = Object.entries(metadata).flatMap(([key, value]) =>
    (Array.isArray(value) ? value : [value]).map((entry) => `// @${key.padEnd(12)} ${entry}`),
  );

  return ['// ==UserScript==', ...lines, '// ==/UserScript=='].join('\n');
};

const result = await Bun.build({
  entrypoints: ['src/userscript.ts'],
  target: 'browser',
  format: 'iife',
  minify: false,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);

  process.exit(1);
}

const [output] = result.outputs;

if (output === undefined) throw new Error('Bun.build produced no output.');

const bundle = await output.text();

await Bun.write(OUTPUT_PATH, `${renderMetadataBlock()}\n\n${bundle}`);
console.log(`Wrote ${OUTPUT_PATH}`);
