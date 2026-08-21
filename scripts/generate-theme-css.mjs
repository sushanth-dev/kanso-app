import { writeFileSync } from 'node:fs';
import { generateThemeCSS } from '@astryxdesign/core/theme';
import { studyRoomTheme } from '../apps/web/src/theme.ts';

const { prose, component } = generateThemeCSS(studyRoomTheme);
const blocks = [];
if (prose) blocks.push(`@layer reset {\n${prose}\n}`);
if (component) blocks.push(`@layer astryx-theme {\n${component}\n}`);
const css = `${blocks.join('\n\n')}\n`;
writeFileSync('apps/web/src/study-room-theme.css', css);
console.log(
  `prose: ${prose ? prose.length : 0} chars, component: ${component ? component.length : 0} chars`,
);
