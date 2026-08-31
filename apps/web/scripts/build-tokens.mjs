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

// ST-104: the high-contrast theme builds as a second dictionary so its output
// stays an override set scoped to html[data-contrast='high'], not a duplicate
// :root block that would fight the base for cascade order. The theme file is
// listed after color.semantic.json so an override wins wherever both define a
// token; the filter keeps every base token out of the file.
const highContrastDictionary = new StyleDictionary({
  usesDtcg: true,
  source: [...source, '../../tokens/theme.high-contrast.json'],
  platforms: {
    css: {
      prefix: 'kanso',
      transformGroup: 'css',
      buildPath: 'src/generated/',
      files: [
        {
          destination: 'tokens.high-contrast.css',
          format: 'css/variables',
          filter: (token) => token.filePath.includes('theme.high-contrast.json'),
          options: { selector: "html[data-contrast='high']" },
        },
      ],
    },
  },
});

await highContrastDictionary.cleanAllPlatforms();
await highContrastDictionary.buildAllPlatforms();
