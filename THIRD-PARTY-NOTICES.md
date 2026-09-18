# Third-party notices

Our source in this repository is released under the MIT licence, in [LICENSE](LICENSE).
That licence covers our code only. The components below keep their own terms,
and this file records what each one is, where it ends up, and what its licence
requires of us.

## Shipped to the browser

| Component | Package | Where it goes | Licence |
| --- | --- | --- | --- |
| Public Sans | `@fontsource/public-sans` 5.3.0 | weights 400 and 600, font files copied into the web build | SIL Open Font License 1.1 |
| Source Serif 4 | `@fontsource/source-serif-4` 5.3.0 | weight 600, font files copied into the web build | SIL Open Font License 1.1 |
| Solar icon set | `@iconify-json/solar` 1.2.10 | icon shapes compiled into components at build time | CC BY 4.0 |
| GSAP | `gsap` 3.15.0 | landing and scroll animation code | standard "no charge" licence |

The web application makes no request to an external font or icon host: both
font families are imported in `apps/web/src/styles.css`, so Vite copies the font
files into the build and they are served from our own origin.

### Fonts, and what the OFL asks for

The Open Font License requires the copyright notice and the licence text to
travel with the fonts. Both are in the appendix below, and the same text ships
inside each package at `node_modules/@fontsource/<family>/LICENSE`.

| Family | Copyright |
| --- | --- |
| Public Sans | Copyright 2015 The Public Sans Project Authors (https://github.com/uswds/public-sans) |
| Source Serif 4 | Copyright Google Inc. |

### Solar, and the credit CC BY 4.0 asks for

Icons by [480 Design](https://www.figma.com/community/file/1166831539721848736),
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

`unplugin-icons` compiles the icons we import, such as
`~icons/solar/arrow-right-linear`, into components during the build, so the icon
shapes ship inside the web bundle. The shapes are unmodified; they take their
colour from the CSS `currentColor`, which is presentation applied at render
time rather than a change to the work.

### GSAP is not open source

GSAP is free to use, under its own terms, at
https://gsap.com/standard-license. That licence, not the MIT licence above,
governs GSAP. It allows the use we make of it. No GSAP Club plugin is installed
or bundled.

## Built from source, not distributed here

### Stockfish

`apps/api/Dockerfile.analysis` clones `official-stockfish/Stockfish` at the tag
named in its `STOCKFISH_RELEASE` argument, compiles it for `armv8-dotprod` and
copies the binary into the analysis image. No Stockfish binary and no Stockfish
source is stored in this repository. The engine runs as a separate process
behind a pipe, so no Stockfish code is linked into our application, and our
source stays MIT.

Licence: GNU General Public License version 3,
https://www.gnu.org/licenses/gpl-3.0.html

What that means in practice: the analysis image, once built, contains GPL-3.0
code. Anyone who distributes that image must also meet GPL-3.0, which includes
offering the corresponding source, starting with the Stockfish revision pinned
in the Dockerfile. Building and running the image without distributing it does
not trigger that.

### chessops

`chessops` 0.15.1 is a production dependency of `apps/api`, running in the API
and analysis processes. It is not bundled into the web application.

Licence: GNU General Public License version 3 or later,
https://www.gnu.org/licenses/gpl-3.0.html

## Build-time and test-only

| Component | Licence | Role |
| --- | --- | --- |
| `axe-core`, `@axe-core/playwright` | MPL-2.0 | accessibility assertions in the test run |
| `lightningcss` | MPL-2.0 | CSS transform in the build |
| `caniuse-lite` | CC BY 4.0 | browser support data for the build |
| `stockfish` 18.0.8 (WebAssembly) | GPL-3.0 | the engine the analysis tests run against |

These run in the build or the test run, not in the browser, and we do not modify
them. MPL-2.0 is file-level: it governs those files, not the work that includes
them.

## Everything else

Every remaining dependency is MIT, ISC, BSD or Apache-2.0. The resolved set and
the licence each package declares are in `package-lock.json`, which npm writes
from the published manifests.

## Appendix: SIL Open Font License 1.1

Both font families above are licensed under the licence text below.

SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
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
OTHER DEALINGS IN THE FONT SOFTWARE.
