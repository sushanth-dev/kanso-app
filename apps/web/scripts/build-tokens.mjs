import StyleDictionary from 'style-dictionary';

const source = [
  '../../tokens/color.primitives.json',
  '../../tokens/color.semantic.json',
  '../../tokens/dimension.json',
  '../../tokens/motion.json',
  '../../tokens/typography.json',
];

const dictionary = new StyleDictionary({
  usesDtcg: true,
  source,
  platforms: {
    css: {
      prefix: 'kanso',
      transformGroup: 'css',
      buildPath: 'src/generated/',
      files: [{ destination: 'tokens.css', format: 'css/variables' }],
    },
    ts: {
      prefix: 'kanso',
      transformGroup: 'js',
      buildPath: 'src/generated/',
      files: [{ destination: 'tokens.ts', format: 'javascript/es6' }],
    },
    json: {
      prefix: 'kanso',
      transformGroup: 'js',
      buildPath: 'src/generated/',
      files: [{ destination: 'tokens.json', format: 'json/nested' }],
    },
  },
});

await dictionary.cleanAllPlatforms();
await dictionary.buildAllPlatforms();
