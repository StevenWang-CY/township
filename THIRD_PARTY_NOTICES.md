# Third-Party Notices

Township's own code and original artwork are licensed under the MIT License (see
[LICENSE](LICENSE)). That license does **not** replace the asset-specific terms
below.

This notice covers third-party visual assets, Township adaptations of those
assets, bundled fonts, and production browser software. The inventory and source links were checked against
the cited upstream revisions and primary license pages on 2026-07-21. Each
section identifies the files it covers, the applicable license, attribution,
and known modifications.

---

## 1. Stanford Generative Agents ("Smallville")

- **Upstream:** <https://github.com/joonspk-research/generative_agents>
- **Revision checked:**
  [`fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4`](https://github.com/joonspk-research/generative_agents/tree/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4)
- **License:** Apache License, Version 2.0
- **License file:**
  <https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/LICENSE>
- **Copyright:** Copyright 2023 Joon Sung Park

### Vendored files covered by this section

The following files are byte-for-byte copies of files under
`environment/frontend_server/static_dirs/assets/` at the revision above:

- `frontend/public/assets/characters/` — 25 character spritesheets:
  `Abigail_Chen.png`, `Adam_Smith.png`, `Arthur_Burton.png`, `Ayesha_Khan.png`,
  `Carlos_Gomez.png`, `Carmen_Ortiz.png`, `Eddy_Lin.png`, `Francisco_Lopez.png`,
  `Giorgio_Rossi.png`, `Hailey_Johnson.png`, `Isabella_Rodriguez.png`,
  `Jane_Moreno.png`, `Jennifer_Moore.png`, `John_Lin.png`, `Klaus_Mueller.png`,
  `Latoya_Williams.png`, `Maria_Lopez.png`, `Mei_Lin.png`, `Rajiv_Patel.png`,
  `Ryan_Park.png`, `Sam_Moore.png`, `Tamara_Taylor.png`, `Tom_Moreno.png`,
  `Wolfgang_Schulz.png`, `Yuriko_Yamamoto.png`
- `frontend/public/assets/speech_bubble/v2.png` — speech-bubble overlay

### Township modification notice

As required for modified Apache-2.0 files, Township records these changes
prominently:

- Every `*_custom.png` file under
  `frontend/public/assets/characters/custom/`, except
  `jennifer-jen-russo_custom.png`, is a palette-swapped derivative of a
  Smallville character sheet. Township's generator changes selected garment
  pixels while preserving the upstream silhouette and animation frames. The
  `_custom` suffix identifies the modified files.
- Documentation captures under `docs/media/` may reproduce these sheets after
  scaling, cropping, scene lighting, and composition with Township UI and map
  art.
- The separately distributed accessory overlays under
  `frontend/public/assets/characters/accessories/` were drawn by Township. When
  an overlay is composited with a Smallville body, the body remains subject to
  this section.

### Upstream artist credits

The upstream README credits the following artists for the game assets and
encourages supporting them (credits reproduced from the upstream README):

- Background art: [PixyMoon (@\_PixyMoon\_)](https://twitter.com/_PixyMoon_)
- Furniture/interior design: [LimeZu (@lime_px)](https://twitter.com/lime_px)
- Character design: [ぴぽ (@pipohi)](https://twitter.com/pipohi)

The upstream repository's root Apache-2.0 license is the only license published
alongside these particular character and speech-bubble files; no separate
per-file art license or exclusion is present. Township redistributes them in
reliance on that repository license and retains the upstream artist credits.

### Citation

Joon Sung Park, Joseph C. O'Brien, Carrie J. Cai, Meredith Ringel Morris,
Percy Liang, and Michael S. Bernstein. 2023. *Generative Agents: Interactive
Simulacra of Human Behavior.* In the 36th Annual ACM Symposium on User
Interface Software and Technology (UIST '23), San Francisco, CA, USA.
Association for Computing Machinery, New York, NY, USA.
arXiv: <https://arxiv.org/abs/2304.03442>

### License text

<details>
<summary>Apache License, Version 2.0 (terms and upstream notice)</summary>

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   Copyright 2023 Joon Sung Park

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

</details>

---

## 2. AI Town folk and animation assets

- **Upstream:** <https://github.com/a16z-infra/ai-town>
- **Revision checked:**
  [`7b242334bfbfef02f7718bded120d431e8f307df`](https://github.com/a16z-infra/ai-town/tree/7b242334bfbfef02f7718bded120d431e8f307df)
- **License for the files identified in this section:** MIT License
- **License file:**
  <https://github.com/a16z-infra/ai-town/blob/7b242334bfbfef02f7718bded120d431e8f307df/LICENSE>
- **Copyright:** Copyright (c) 2023 a16z-infra

### Unmodified vendored files covered by this section

These are byte-for-byte copies of the matching AI Town files:

- `frontend/public/assets/characters/32x32folk.png`
- `frontend/public/assets/spritesheets/campfire.png`
- `frontend/public/assets/spritesheets/gentlesparkle32.png`
- `frontend/public/assets/spritesheets/gentlewaterfall32.png`
- `frontend/public/assets/spritesheets/windmill.png`

The OpenGameArt-derived `rpg-tileset.png` and the ansimuz-derived `player.png`
are intentionally excluded from this MIT section; their asset-specific terms
are documented in Sections 3 and 4.

### Township modification notice

- `frontend/public/assets/characters/folk-0.png` through `folk-7.png`,
  `player-1.png` through `player-6.png`, and `Folk_Resident.png` are exact
  rectangular crops of `32x32folk.png`.
- `frontend/public/assets/characters/custom/jennifer-jen-russo_custom.png` is a
  garment-palette modification of `Folk_Resident.png`; the `_custom` suffix
  identifies the modified file.
- Documentation captures under `docs/media/` may show these assets after
  scaling, cropping, lighting, and composition with other art and UI.

AI Town's README provides aggregate art credits but does not map a separate
artist or license to these five source files. The root MIT license is the only
license shipped alongside them, so Township redistributes these files in
reliance on that license. The provenance limitation is recorded below rather
than assigning an unsupported per-file attribution.

### License text

```
MIT License

Copyright (c) 2023 a16z-infra

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 3. 16x16 RPG Tileset and its source works

- **Vendored file:** `frontend/public/assets/tilesets/rpg-tileset.png`
- **Immediate source:**
  [`public/assets/rpg-tileset.png`](https://github.com/a16z-infra/ai-town/blob/7b242334bfbfef02f7718bded120d431e8f307df/public/assets/rpg-tileset.png)
  in AI Town
- **License option used by Township:**
  [Creative Commons Attribution-ShareAlike 3.0 Unported](https://creativecommons.org/licenses/by-sa/3.0/)

AI Town's README identifies its tilesheet sources. The immediate source file is
a compiled adaptation of the following works and retains their attribution
chain:

- **"16x16 RPG Tileset" by hilau** —
  <https://opengameart.org/content/16x16-rpg-tileset>. The author offers the
  work under CC BY-SA 3.0 or GPL 3.0. Township uses the CC BY-SA 3.0 option.
- **"16x16 Game Assets" by George Bailey** —
  <https://opengameart.org/content/16x16-game-assets>, licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Hilau identifies
  this as a principal source work.
- **"LPC Thatched-roof Cottage" by bluecarrot16** —
  <https://opengameart.org/content/lpc-thatched-roof-cottage>, licensed
  CC BY-SA 3.0 or GPL 3.0+. That work in turn credits:
  - **"LPC Base Assets" by Lanea Zimmerman (Sharm) and Daniel Armstrong
    (HughSpectrum)** —
    <https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles>
  - **"LPC art entry" by Casper Nilsson** —
    <https://opengameart.org/content/lpc-cnilsson>

### Modification and ShareAlike notice

- Hilau documents extensive recoloring, extensions, and new terrain,
  buildings, roofs, interiors, and objects on the source page.
- AI Town compiled the source art into a 1600×1600-pixel sheet. AI Town does
  not publish a per-tile change log for that compilation.
- Township copied AI Town's compiled `rpg-tileset.png` byte-for-byte without
  changing the sheet.
- Township's `frontend/public/assets/maps/*-preview.png` files are new rendered
  arrangements of tiles from the sheet. Game-scene captures under
  `docs/media/` may further scale, crop, light, or composite those arrangements
  with Township art and UI.
- The `.tmj` files under `frontend/public/assets/maps/` are Township-authored
  layout data that reference tile identifiers; they do not embed the source
  pixels.

The adapted tile artwork in `rpg-tileset.png` and in rendered images that
reproduce it is distributed under CC BY-SA 3.0. Township's separable code,
layout data, UI, and original artwork retain their stated licenses. No source
artist or project endorses Township.

---

## 4. Tiny RPG - Forest player sprite

- **Vendored file:** `frontend/public/assets/characters/player.png`
- **Creator:** Luis Zuno (`ansimuz`)
- **Original asset page:**
  <https://opengameart.org/content/tiny-rpg-forest>
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
- **Intermediate source:**
  [`pierpo/phaser3-simple-rpg/assets/player.png`](https://github.com/pierpo/phaser3-simple-rpg/blob/master/assets/player.png)

Township's file is byte-for-byte identical to the `player.png` published by
`phaser3-simple-rpg`, whose README credits its assets to ansimuz's Tiny RPG -
Forest pack. AI Town republishes the same file, from which Township vendored
it. The sprite is unmodified; runtime and documentation rendering may scale or
composite it. CC0 does not require attribution, but the creator and source are
retained here as a courtesy and provenance record.

Despite their names, Township's `player-1.png` through `player-6.png` are crops
of AI Town's folk atlas, not derivatives of this player sprite; Section 2
governs those files.

---

## 5. Cinzel and Inter typefaces

- **Cinzel upstream:**
  <https://github.com/google/fonts/tree/main/ofl/cinzel>
- **Inter upstream:**
  <https://github.com/google/fonts/tree/main/ofl/inter>
- **License:** SIL Open Font License, Version 1.1
- **Cinzel copyright:** Copyright 2020 The Cinzel Project Authors
- **Inter copyright:** Copyright 2020 The Inter Project Authors

The self-hosted, Latin-subset webfonts at
`frontend/src/assets/fonts/cinzel-latin.woff2` and
`frontend/src/assets/fonts/inter-latin.woff2` are format-converted, Latin-subset
versions of the upstream variable fonts; Township made no glyph-design
changes. The corresponding complete OFL texts and copyright notices ship at
`frontend/public/assets/fonts/Cinzel-OFL.txt` and
`frontend/public/assets/fonts/Inter-OFL.txt`.

---

## 6. Production browser software

The production frontend bundle includes the following MIT-licensed packages
and their listed runtime dependencies. Versions are resolved by
`frontend/package-lock.json`:

| Package | Version | Copyright notice |
|---|---:|---|
| Phaser | 3.90.0 | Copyright (c) 2024 Richard Davey, Phaser Studio Inc. |
| eventemitter3 | 5.0.4 | Copyright (c) 2014 Arnout Kazemier |
| React | 19.2.8 | Copyright (c) Meta Platforms, Inc. and affiliates. |
| React DOM | 19.2.8 | Copyright (c) Meta Platforms, Inc. and affiliates. |
| Scheduler | 0.27.0 | Copyright (c) Meta Platforms, Inc. and affiliates. |
| React Router | 7.18.1 | Copyright (c) React Training LLC 2015–2019; Remix Software Inc. 2020–2021; Shopify Inc. 2022–2023 |
| React Router DOM | 7.18.1 | Copyright (c) React Training LLC 2015–2019; Remix Software Inc. 2020–2021; Shopify Inc. 2022–2023 |
| cookie | 1.1.1 | Copyright (c) 2012–2014 Roman Shtylman; Copyright (c) 2015 Douglas Christopher Wilson |
| set-cookie-parser | 2.7.2 | Copyright (c) 2015 Nathan Friedly |

The following MIT text applies to every package in the table above:

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 7. Township-created visual assets

For clarity, the following are Township-authored and covered by Township's MIT
license, not by the third-party licenses above:

- `frontend/public/assets/tilesets/township-modern.png` — generated by
  `scripts/mapgen/moderntiles.py`; its generator samples the vendored RPG
  sheet's palette for visual cohesion but does not copy source tiles.
- `frontend/public/assets/characters/accessories/*.png` — generated Township
  accessory overlays.
- `frontend/public/assets/maps/*.tmj` — original map layout and collision data.
- Textures generated at runtime by `frontend/src/game/pixelTextures.ts`.

When these assets are combined with third-party character or tile art in a
rendered scene, the applicable third-party attribution and license remain in
force for that art.

---

## Provenance qualifications

- **Smallville:** the upstream repository places a root Apache-2.0 license
  alongside the character sheets and speech bubble and credits the artists in
  its README, but it provides no separate per-asset license document. Township
  relies on the repository license; the absence of per-asset terms is an
  upstream provenance limitation.
- **AI Town folk and animation files:** AI Town's root MIT license is the only
  license published alongside the five files in Section 2. Its README gives
  aggregate art credits (including pixel-art generation via Replicate and
  Fal.ai) but no file-to-creator mapping. Township therefore cannot provide a
  more specific authorship chain for those files.

Downstream distributors whose policy requires an independent, per-file asset
license should treat those two qualifications as unresolved provenance risk
and replace the affected assets before redistribution. The OpenGameArt tile
sheet, ansimuz player, and Google Fonts files have the specific source and
license chains documented above.
