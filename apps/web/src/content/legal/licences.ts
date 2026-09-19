import type { LegalPage } from './index.ts';

/**
 * The copyright notices and the licence texts that travel with what this site
 * serves (ST-170).
 *
 * The fonts are why the page exists. `apps/web/src/styles.css` imports Public
 * Sans and Source Serif 4 through the `@fontsource` packages, so the build
 * copies their files and a reader fetches them from our own origin. They are
 * font software under the SIL Open Font License 1.1, whose condition 2 requires
 * that each copy contains the copyright notice and the licence, and whose
 * condition 5 requires that the font software be distributed entirely under
 * that licence. Serving those files without the notice and the licence beside
 * them is the gap this page closes.
 *
 * The licence text below is quoted rather than written: it is the same text as
 * the appendix in the repository's `THIRD-PARTY-NOTICES.md`, which is where the
 * full position on every component lives. This page names that file and that
 * file names this page, and `legal-routes.test.tsx` reads the file from disk
 * and fails if the two copies drift apart.
 */

/**
 * The SIL Open Font License 1.1, copied from the appendix in
 * `THIRD-PARTY-NOTICES.md` without a change. It is one literal so that a
 * wording change shows as the licence in a diff rather than as a reflow, and it
 * is split at its blank lines so the page renders one paragraph per paragraph
 * of the licence, in the licence's own order.
 */
const OFL_1_1_TEXT = `SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.`;

const OFL_1_1_PARAGRAPHS = OFL_1_1_TEXT.split('\n\n');

export const LICENCES_PAGE: LegalPage = {
  title: 'Licences',
  description:
    'The licences that cover what this site serves: the two font families, the icon set, and the components that keep their own terms.',
  heading: 'Licences',
  kicker: 'Notices',
  updated: '2026-09-19',
  summary:
    'The fonts this site serves are font software rather than assets we own, and their licence requires its notice and its text to reach whoever receives them. This page is that delivery, and it records the position on everything else we ship.',
  sections: [
    {
      heading: 'Why this page exists',
      blocks: [
        'Public Sans and Source Serif 4 are licensed under the SIL Open Font License 1.1. It sets two conditions on anyone who passes the fonts on: every copy has to carry the copyright notice and the licence text, and the font software has to be distributed entirely under that licence.',
        'This site serves those files from its own origin, so the notice and the licence travel here, where the reader who receives them can actually read them. Each package also ships the same text beside its fonts, and the repository carries both.',
        'The full position on everything this site is built with, including the components that keep their own terms, is in the repository file THIRD-PARTY-NOTICES.md. The licence text at the end of this page is quoted from it.',
      ],
    },
    {
      heading: 'Fonts',
      blocks: [
        'Public Sans: Copyright 2015 The Public Sans Project Authors (https://github.com/uswds/public-sans)',
        'Source Serif 4: Copyright Google Inc.',
        'Both are licensed under the SIL Open Font License 1.1, whose complete text is at the end of this page.',
      ],
    },
    {
      heading: 'Icons',
      blocks: [
        'The icons are the Solar set by 480 Design, licensed under Creative Commons Attribution 4.0. That licence asks for the source and the licence to be named, so: the set is at https://www.figma.com/community/file/1166831539721848736, and the licence is at https://creativecommons.org/licenses/by/4.0/.',
        'The shapes are compiled into the application when it is built and are not modified. They take their colour from the text around them, which is presentation applied when the page is drawn rather than a change to the work.',
      ],
    },
    {
      heading: 'Everything else this site is built with',
      blocks: [
        'GSAP runs the landing page and the scroll animation. It is free to use under its own licence, at https://gsap.com/standard-license, which is not an open-source licence and governs GSAP in place of the MIT licence that covers our own code.',
        'Stockfish checks the moves. It is built from source into its own image and is not sent to a browser, and the application talks to it through a pipe rather than by linking it, so no Stockfish code is part of this site. Anyone who distributes that image has to meet the GNU General Public License version 3 alongside it.',
        'chessops is a library our API calls directly, rather than a separate program it talks to, which makes the API a combined work under the GNU General Public License version 3 or later. Our own files stay under the MIT licence, and that licence permits the combination.',
      ],
    },
    {
      heading: 'The SIL Open Font License 1.1',
      blocks: OFL_1_1_PARAGRAPHS,
    },
  ],
};
