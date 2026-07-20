# Third-Party Notices

Township's own code is licensed under the MIT License (see [LICENSE](LICENSE)).

The game art bundled under `frontend/public/assets/` is vendored from third-party
open-source projects and remains under the original authors' licenses and
copyrights, reproduced below. Provenance was verified against the upstream
repository file trees on 2026-07-20; each section states exactly which vendored
files it covers.

---

## 1. Stanford Generative Agents ("Smallville")

- **Upstream:** <https://github.com/joonspk-research/generative_agents>
- **License:** Apache License, Version 2.0
- **Copyright:** Copyright 2023 Joon Sung Park

### Vendored files covered by this section

Copied from `environment/frontend_server/static_dirs/assets/` in the upstream
repository:

- `frontend/public/assets/characters/` — 25 character spritesheets:
  `Abigail_Chen.png`, `Adam_Smith.png`, `Arthur_Burton.png`, `Ayesha_Khan.png`,
  `Carlos_Gomez.png`, `Carmen_Ortiz.png`, `Eddy_Lin.png`, `Francisco_Lopez.png`,
  `Giorgio_Rossi.png`, `Hailey_Johnson.png`, `Isabella_Rodriguez.png`,
  `Jane_Moreno.png`, `Jennifer_Moore.png`, `John_Lin.png`, `Klaus_Mueller.png`,
  `Latoya_Williams.png`, `Maria_Lopez.png`, `Mei_Lin.png`, `Rajiv_Patel.png`,
  `Ryan_Park.png`, `Sam_Moore.png`, `Tamara_Taylor.png`, `Tom_Moreno.png`,
  `Wolfgang_Schulz.png`, `Yuriko_Yamamoto.png`
- `frontend/public/assets/speech_bubble/v2.png` — speech-bubble overlay

### Upstream artist credits

The upstream README credits the following artists for the game assets and
encourages supporting them (credits reproduced from the upstream README):

- Background art: [PixyMoon (@\_PixyMoon\_)](https://twitter.com/_PixyMoon_)
- Furniture/interior design: [LimeZu (@lime_px)](https://twitter.com/lime_px)
- Character design: [ぴぽ (@pipohi)](https://twitter.com/pipohi)

The character spritesheets vendored here are character art; per the upstream
credits, character design is by ぴぽ (pipohi). The upstream repository is
distributed under Apache-2.0 as a whole; it does not publish separate per-asset
license terms beyond the artist credits above.

### Citation

Joon Sung Park, Joseph C. O'Brien, Carrie J. Cai, Meredith Ringel Morris,
Percy Liang, and Michael S. Bernstein. 2023. *Generative Agents: Interactive
Simulacra of Human Behavior.* In the 36th Annual ACM Symposium on User
Interface Software and Technology (UIST '23), San Francisco, CA, USA.
Association for Computing Machinery, New York, NY, USA.
arXiv: <https://arxiv.org/abs/2304.03442>

### License text

<details>
<summary>Apache License, Version 2.0 (full text)</summary>

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

## 2. AI Town (a16z-infra)

- **Upstream:** <https://github.com/a16z-infra/ai-town>
- **License:** MIT License
- **Copyright:** Copyright (c) 2023 a16z-infra

### Vendored files covered by this section

Copied from `public/assets/` in the upstream repository:

- `frontend/public/assets/tilesets/rpg-tileset.png` — 16 px RPG tilesheet
- `frontend/public/assets/tilesets/magecity.png` — city tileset
- `frontend/public/assets/maps/tilemap.json` — Tiled tilemap (references
  `rpg-tileset.png`)
- `frontend/public/assets/spritesheets/campfire.png` — animated campfire
- `frontend/public/assets/spritesheets/gentlesparkle32.png` — animated sparkle
- `frontend/public/assets/spritesheets/gentlewaterfall32.png` — animated
  waterfall
- `frontend/public/assets/spritesheets/windmill.png` — animated windmill
- `frontend/public/assets/characters/32x32folk.png` — folk character atlas
- `frontend/public/assets/characters/player.png` — 16 px player spritesheet

Derived works created for Township from the files above:

- `frontend/public/assets/characters/player-1.png` through `player-6.png` and
  `frontend/public/assets/characters/Folk_Resident.png` are crops/derivatives
  of the folk character atlas (`32x32folk.png`) and are covered by the same
  upstream terms and artist credits.

### Upstream artist credits

Reproduced from the ai-town README:

- Tilesheet:
  - <https://opengameart.org/content/16x16-game-assets> by George Bailey
  - <https://opengameart.org/content/16x16-rpg-tileset> by hilau
- Original assets by [ansimuz](https://opengameart.org/content/tiny-rpg-forest)
- "The UI is based on original assets by
  [Mounir Tohami](https://mounirtohami.itch.io/pixel-art-gui-elements)"
  (note: the ai-town UI SVGs based on Mounir Tohami's work are **not** shipped
  with Township; the credit is retained here because ai-town documents its
  asset credits collectively rather than per file)
- ai-town also notes: "We used
  <https://github.com/pierpo/phaser3-simple-rpg> for the original POC of this
  project."

The upstream README does not map credits to individual files, so all of the
above attributions are retained for the vendored asset set as a whole.

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

## Provenance note

The Stanford Generative Agents repository is licensed under Apache-2.0 as a
whole, but its README credits the game art to independent pixel artists
(PixyMoon, LimeZu, and pipohi) and does not publish separate license terms for
the art itself. Township retains those artist credits above. If stricter asset
provenance is ever required, the character spritesheets can be replaced with
public-domain (CC0) alternatives such as Kenney's character packs
(<https://kenney.nl/assets>) or the Liberated Pixel Cup (LPC) sprite
collection (<https://opengameart.org/content/lpc-collection>).
