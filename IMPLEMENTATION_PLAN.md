# Township — Master Implementation Plan

> **Goal:** Elevate Township from a polished prototype into a **truly outstanding, world-class civic-simulation experience** — distinctive per-town maps, demographically-true agents with real daily routines, cinematic animations, and natural player-NPC integration that feels alive at every moment.

This document is the **single source of truth** for the next implementation pass. It is organized so a 2–4 person team can execute it in roughly 7 phases over ~3 sprints, but it can also be done top-to-bottom by a single engineer. Each section identifies the **current state** (what the code does today), the **gap** (what's missing or broken), the **target experience**, and the **concrete code/asset changes** to get there.

The plan also fixes a small number of **real bugs** discovered while reading the code (see §0 below) — these should be tackled first because they silently undermine the simulation pipeline today.

---

## Table of Contents

0. [Critical Bugs to Fix First](#0-critical-bugs-to-fix-first)
1. [Phase 1 — Distinct Per-Town Maps](#phase-1--distinct-per-town-maps)
2. [Phase 2 — Demographically-Truthful Agent Appearance](#phase-2--demographically-truthful-agent-appearance)
3. [Phase 3 — Living Daily Routines & Agent Behavior](#phase-3--living-daily-routines--agent-behavior)
4. [Phase 4 — Cinematic Animation Pipeline](#phase-4--cinematic-animation-pipeline)
5. [Phase 5 — Player ↔ Agent Integration & Social Layer](#phase-5--player--agent-integration--social-layer)
6. [Phase 6 — Onboarding & Player Identity](#phase-6--onboarding--player-identity)
7. [Phase 7 — World Lighting, Weather, Time-of-Day](#phase-7--world-lighting-weather-time-of-day)
8. [Phase 8 — UI Polish, Sound, Performance, QA](#phase-8--ui-polish-sound-performance-qa)
9. [Asset Manifest & Acquisition Sources](#asset-manifest--acquisition-sources)
10. [File-by-File Change Index](#file-by-file-change-index)
11. [Sequencing, Owners, Estimates](#sequencing-owners-estimates)
12. [Definition of Done — Acceptance Criteria](#definition-of-done--acceptance-criteria)

---

## 0. Critical Bugs to Fix First

These break the integration between the running simulation and the visible world. They MUST be fixed before any of the polish work below pays off, because right now you can run a backend simulation and see almost nothing on screen.

### 0.1 WebSocket event-type name mismatch (P0)

The backend publishes Pydantic events whose `type` field uses **singular snake_case**, while the frontend listens for **past-tense** strings. Every event sent over the wire is silently dropped:

| Backend `type` (`backend/core/types.py`) | Frontend listens for (`frontend/src/types/messages.ts`, `useWebSocket.ts`, `TownView.tsx`) |
|---|---|
| `agent_move` | `agent_moved` |
| `speech_bubble` | `agent_speech` |
| `opinion_change` | `opinion_changed` |
| `conversation_start` | `conversation_started` |
| `round_advance` | `round_started` |
| `news_injection` | `news_injected` |

**Fix:** Pick one convention (recommended: keep the frontend names — they read more naturally as past-tense events). Update `backend/core/types.py` Literal type fields to match. While doing so, also align field names: backend uses `agents:list[str]` for participants, frontend expects `conversation.participants` + `conversation.participant_names` — wrap a `Conversation` model around it.

### 0.2 AgentMoveEvent x,y is ignored (P0)

`round_manager.py` publishes `AgentMoveEvent(x=…, y=…)` looked up from `town_data` JSON. But the frontend's `TownScene.moveAgent()` ignores x/y entirely and re-derives the target from the **frontend**'s `TOWN_LANDMARKS` table (a separate hand-edited list in `game/config.ts`). The two lists currently disagree on landmark names ("Dover NJ Transit Station" vs "Dover Station", "St. Mary's Catholic Church" vs "St. Mary's Church", "Latino Businesses Area" vs "Bodega Row", etc.), so move events that come from the real simulation land on a random fallback waypoint.

**Fix:** Single source of truth. Move the landmark layout into `data/towns/{town}.json` (already partially there) and have the frontend `fetch('/api/towns')` once at startup. Drop `TOWN_LANDMARKS` from `game/config.ts`. The backend should always send the x,y in the event, and `moveAgent()` should use it.

### 0.3 Tilemap collision is over-greedy (P0)

```ts
terrain.setCollisionByExclusion([-1, 0]);
```

This marks *every* non-empty tile in the terrain layer as solid. Since terrain covers ~100% of the visible map, the player can collide with the ground itself. Symptoms: player stutters or refuses to move depending on where they were spawned.

**Fix:** Build a separate `collide` layer in Tiled (or programmatically), populated only with walls/water/building footprints. Move `setCollisionByExclusion(...)` to that layer. Until per-town Tiled maps are made (Phase 1), generate a programmatic collision rectangle list from each landmark's `(x, y, width, height)` and add them as `physics.add.staticGroup()` instead.

### 0.4 All four towns load the same tilemap (P0 — UX-critical)

```ts
this.load.tilemapTiledJSON("town-map", "/assets/maps/tilemap.json");
```

`tilemap.json` is loaded regardless of `townId`. Every town looks identical at the tile level. The only thing that differs is the colored landmark zone tint and the campfire/sparkle decorations. **This is the single biggest perceptual gap** between Township and a "real outstanding project."

**Fix:** See Phase 1 below.

### 0.5 Duplicate sprite assignments (P1)

`AGENT_SPRITE_MAP` in `TownScene.ts` assigns `Jennifer_Moore` to both Margaret "Peggy" O'Brien (Montclair) and Jennifer "Jen" Russo (Randolph). Players see two visually-identical women. Other matches are demographically wrong (Klaus_Mueller for Rabbi Daniel Goldstein, Tamara_Taylor for Grace Reyes who is a Filipina nurse, Latoya_Williams for Jordan Williams — but Jordan in the persona is a 24-y/o Black painter/barista, so this works, etc.).

**Fix:** See Phase 2's full re-mapping table.

### 0.6 Backend `ConversationStartEvent` shape doesn't match `Conversation` interface (P1)

Frontend `ConversationStartedEvent.conversation` expects `{id, participants[], participant_names[], topic, ...}`, backend `ConversationStartEvent` emits flat `{agents[], topic, location, town}`. Wrap.

### 0.7 OnboardingScene resolves player sprite, but TownScene loses it (P2)

The onboarding sets `profile.color` and an `agentId` but no sprite key. `TownView.tsx` later spawns the player with the hard-coded 16-px `char-player`, not whatever the user "chose." After Phase 6 (player sprite picker) this becomes a real feature; for now just document it.

---

## Phase 1 — Distinct Per-Town Maps

**Today:** All four towns render the same `tilemap.json` (the Smallville "the_ville" map) with a colored rectangle drawn behind each landmark. Buildings are *labels*, not buildings.

**Target:** Each town is **immediately recognizable** in 1 second. Dover feels like a dense Latino main street. Montclair feels like an upscale arts district. Parsippany feels like a wide corporate-suburban grid. Randolph feels like a leafy, large-lot affluent enclave. Each map carries demographic, economic, and architectural signal that mirrors the agents who live there.

### 1.1 Per-Town Tiled Maps (the core asset task)

Create four 40×30-tile Tiled maps at `frontend/public/assets/maps/`:

```
maps/
├── dover.tmj
├── montclair.tmj
├── parsippany.tmj
├── randolph.tmj
└── shared/
    ├── town-tileset.png       # Master tileset (use existing rpg-tileset.png + extensions)
    └── town-tileset.tsx       # Tiled tileset descriptor
```

Each Tiled map MUST contain these named layers (in this order):

1. **`ground`** — grass / dirt / pavement / cobblestone base
2. **`roads`** — main roads and lane markings (sized & oriented per-town)
3. **`water`** — rivers, lakes, ponds, fountains
4. **`buildings`** — building footprints (no collision yet)
5. **`building_roofs`** — roofs / awnings / signs (drawn above shadow but below characters)
6. **`deco`** — trees, lampposts, bus stops, mailboxes, flowerbeds
7. **`overlay`** — anything that draws *above* characters (tall tree canopies, hanging signs)
8. **`collide`** *(object layer)* — invisible polygons marking impassable areas
9. **`spawn_zones`** *(object layer)* — named rectangles agents wander toward (Bodega, Park, Library…)

This layer convention replaces the current "draw colored boxes from `TOWN_LANDMARKS`" approach.

### 1.2 Per-Town Art Direction

#### Dover — "The Working-Class Heart" (warm orange `#C0792A`)

- **Layout:** narrow Blackwell Street running E-W as the spine. Storefronts crammed shoulder-to-shoulder on both sides.
- **Buildings:** brick row-storefronts with bilingual Spanish/English signs (`Carnicería`, `Lavandería`, `La Finca`). Telephone poles with tangled wires. Wrought-iron fire escapes on apartments above shops.
- **Train station:** NJ Transit platform with a stopped commuter train silhouette on the left edge.
- **St. Mary's Church:** brown brick, white steeple, statue of Mary, candle votives flickering at night.
- **Public Housing:** four 3-story brick blocks with a basketball court and a community fridge.
- **Factory district:** corrugated metal warehouses, smokestacks venting, parked semis.
- **Ambient details:** street vendors, salsa music notes drifting (small ♪ particles near the bodega), papel picado strung above the park during fiesta time.
- **Color palette:** warm browns, terracotta, mustard. Highly saturated.

#### Montclair — "The Progressive Hub" (cool blue `#4A8FBF`)

- **Layout:** wider, leafier Bloomfield Ave. Boutique row off the side. Park with statue.
- **Buildings:** Tudor brick storefronts with copper roofs, Art Museum with classical columns and banners ("Black History Month", "Pride"), independent bookstores, a yoga studio, a fair-trade coffee shop.
- **Anderson Park:** sculptures, a duck pond, jogging paths, a bandshell.
- **Bay Street Station:** modern glass-and-brick NJ Transit station.
- **St. Paul Baptist:** brick church with stained-glass windows.
- **Ambient details:** "Hate Has No Home Here" yard signs, pride flags, dog walkers, joggers, a farmer's market stall.
- **Color palette:** muted blues, sage green, cream. Mid-saturation.

#### Parsippany — "The Suburban Melting Pot" (green-teal `#5D9E4F`)

- **Layout:** wide Route 46 grid, big setbacks, large parking lots.
- **Buildings:** glass corporate park towers (mid-rise), the Hindu temple with white spire and decorative gopuram, an Indian grocery + sweets shop strip mall, a Chinese restaurant, a Korean BBQ.
- **Lake Parsippany:** real lake with rippling tiles, a few canoes on the shore.
- **NJ Transit Stop:** small modern park-and-ride bus stop.
- **Residential:** rows of identical 1970s split-level homes.
- **Ambient details:** flag of India + American flag together on a porch, Diwali lights in season, sari-wearing NPCs.
- **Color palette:** verdant greens, warm tans, accent saffron/maroon. Mid-saturation, slightly cooler.

#### Randolph — "The Republican Suburb" (warm taupe `#8B7D6B`)

- **Layout:** winding lanes, cul-de-sacs, generous lawns. No commercial spine.
- **Buildings:** colonial-style homes with two-car garages, a brick high school campus with football field & bleachers, a tidy commercial strip with a diner & finance office, a Presbyterian church.
- **Sports fields:** soccer fields with portable goals, baseball diamond.
- **Hedden Park:** large wooded park with stone barbecue pits, a creek.
- **Town Hall:** brick + white columns, American flag on a tall pole.
- **Ambient details:** lawn signs for school board races, Range Rovers in driveways, golden retrievers.
- **Color palette:** earthy taupe, hunter green, brick red. Lower saturation, more "muted prosperity."

### 1.3 Per-Town Phaser Wiring

Replace the current single-tilemap loader with a town-aware loader. New `TownScene.preload()`:

```ts
const TOWN_MAP_KEY: Record<TownId, string> = {
  dover: "dover-map",
  montclair: "montclair-map",
  parsippany: "parsippany-map",
  randolph: "randolph-map",
};

preload() {
  this.load.image("town-tileset", "/assets/maps/shared/town-tileset.png");
  this.load.tilemapTiledJSON(TOWN_MAP_KEY[this.townId], `/assets/maps/${this.townId}.tmj`);
  // … existing character + FX preloads
}
```

`buildTilemap()` then layers `ground` → `roads` → `water` → `buildings` → `building_roofs` → `deco` and uses the **`collide` object layer** as the physics body source. Move characters to depth = `y + 100`, building roofs above (~`y + 200`) when needed, and the `overlay` layer at the top.

### 1.4 Programmatic Backstop (works without Tiled assets)

If artwork lags, ship a **richer programmatic fallback** that doesn't visually fail. Extend `TownScene.drawLandmarkLabel()` into a full `drawLandmarkBuilding()` method that draws actual buildings per `landmark.type`:

| Type | Visual recipe |
|---|---|
| `church` | tall rectangle + triangular roof + cross + warm window glow |
| `building` (commercial) | rectangle + flat roof + 2 windows + awning + sign with landmark name |
| `housing` | repeated row of small house silhouettes |
| `park` | grass disc + 3-5 tree clusters + benches + path |
| `transport` | platform rectangle + train silhouette |
| `road` | dashed center line + crosswalk stripes |

This is already 40% there with the campfire + sparkle decorations — extend it. Each shape uses the town's accent color for accents (awnings, roof trim) and a town-distinct ground color for grass / pavement.

This fallback is **not throwaway**: even after Tiled maps exist, the same routine renders nicely when assets fail to load.

### 1.5 Camera & World Size

- Switch `Phaser.Scale.FIT` → `Scale.RESIZE` for true responsive rendering.
- World size = `map.widthInPixels × map.heightInPixels` (likely 1280×960 per town).
- Camera follows player with `lerp=0.08`, `setBounds(0, 0, W, H)`, and `setZoom(1.5)` when player is present (so we see 1 screen ≈ a city block) vs `1.0` when no player.
- Add a **mini-map widget** (top-right) showing landmark positions + every agent as a dot in the town's accent color. Click a dot to focus the camera (use `cameras.main.pan()`).

---

## Phase 2 — Demographically-Truthful Agent Appearance

**Today:** 25 Smallville character spritesheets are used. Mapping is roughly demographically guessed but has duplicates and several mismatches. There's no clothing variation, no age/class signal, no per-agent visual identity beyond the spritesheet.

**Target:** Every one of the 26 agents is **visually distinct** and matches their persona's age, ethnicity, profession, and class. A user who reads Carlos's persona then sees "his" sprite should think *"yes, that's him."*

### 2.1 Sprite Re-Mapping

Re-do `AGENT_SPRITE_MAP` so no two NPCs share a sprite, and each match is justified by demographic / age / occupation. Use the existing Smallville sheets and add 3-5 new ones if needed.

| Agent | Town | Persona key facts | Current sprite | **New sprite** | Justification |
|---|---|---|---|---|---|
| Carlos Restrepo | dover | 51, Colombian, restaurant owner | Carlos_Gomez | Carlos_Gomez | ✓ keep |
| Miguel Hernandez | dover | 38, Mexican, construction | Francisco_Lopez | Francisco_Lopez | ✓ keep |
| Maria Santos | dover | 35, Puerto Rican, nursing aide | Carmen_Ortiz | Carmen_Ortiz | ✓ keep |
| Esperanza Guzman | dover | 71, Dominican retiree | Isabella_Rodriguez | **Isabella_Rodriguez** with grey hair tint | needs elderly look |
| Sofia Ramirez | dover | 20, DACA recipient | Jane_Moreno | Jane_Moreno | ✓ keep |
| Tom Kowalski | dover | 68, retired Polish-American | Tom_Moreno | **Wolfgang_Schulz** | better white-American match |
| Sarah & David Chen | montclair | Chinese-American couple | Mei_Lin | **Mei_Lin** (Sarah) + add David variant | composite agent — paint a 2-character spritesheet |
| Rosa Chen | montclair | 78, Taiwanese-American | Yuriko_Yamamoto | Yuriko_Yamamoto | ✓ keep |
| Jordan Williams | montclair | 24, Black painter/barista | Latoya_Williams | Latoya_Williams | ✓ keep |
| Carmen & Alejandro Vargas | montclair | Dominican couple | Maria_Lopez | **Maria_Lopez** + new partner sprite | needs co-agent |
| Rabbi Daniel Goldstein | montclair | Jewish rabbi, beard | Klaus_Mueller | **Adam_Smith** with beard overlay | needs Jewish iconography |
| Priya Patel | montclair | Indian boutique owner | Ayesha_Khan | Ayesha_Khan | ✓ keep |
| Margaret "Peggy" O'Brien | montclair | Irish retired librarian | Jennifer_Moore | **Hailey_Johnson** (older variant) | resolve dup |
| Raj & Sunita Krishnamurthy | parsippany | Indian software engineer | Rajiv_Patel | Rajiv_Patel | ✓ keep |
| Kantibhai Desai | parsippany | Indian retiree | Giorgio_Rossi | **Eddy_Lin** (older) | better South-Asian elder match |
| Brian McCarthy | parsippany | 50, Irish-American pharma mgr | Sam_Moore | Sam_Moore | ✓ keep |
| Aisha & Omar Khan | parsippany | Muslim Pakistani couple | Abigail_Chen | **Abigail_Chen** w/ hijab overlay | needs visible hijab |
| Pawan Sharma | parsippany | Indian restaurant owner | Adam_Smith | **Giorgio_Rossi** | better restaurant-owner read |
| Linda Morrison | parsippany | 65, retired white VP | Hailey_Johnson | **Jennifer_Moore** | swap |
| Grace Reyes | parsippany | Filipina nurse | Tamara_Taylor | **Tamara_Taylor** with nurse scrubs overlay | scrubs reskin |
| Mike Brennan | randolph | 47, Irish-American finance dir | Arthur_Burton | Arthur_Burton | ✓ keep |
| Jen Russo | randolph | Italian-American stay-at-home mom | Jennifer_Moore | **Hailey_Johnson** | resolve dup with Peggy |
| Frank DeLuca | randolph | 75, retired colonel | Wolfgang_Schulz | **Arthur_Burton** elderly variant | needs aged military look |
| Tyler & Megan Hart | randolph | young white couple | Ryan_Park | **Ryan_Park** + new wife | needs co-agent |
| Vikram Iyer | randolph | Indian software engineer | Eddy_Lin | **Rajiv_Patel** alt color | distinct from Raj |
| Tony Mancini | randolph | Italian-American landscaper | John_Lin | **John_Lin** rugged-clothes reskin | clothing for outdoor work |

### 2.2 Clothing & Profession Overlays

Smallville sprites are limited to ~25 base bodies. To express **occupation and class** without commissioning 26 new sheets, build a *layered* sprite renderer:

- **Base body** — Smallville sprite (skin, hair, base outfit)
- **Outfit layer** — 32×32 paper-doll layer drawn over the body (nurse scrubs, hard hat + reflective vest, business suit, apron, hijab, kippah, military beret, lab coat, painter's overall, sari, kurta, etc.)
- **Accessory layer** — props held in hand (clipboard, paint brush, briefcase, coffee cup, baby carrier, soccer ball, Bible, prayer beads)

These overlay sheets share the **same 12-frame 4-direction layout** as the body, so they always animate in sync. Create them in Aseprite — about 12 overlay sheets is enough to cover all 26 agents.

In `AgentSprite.ts`, replace `this.charSprite = scene.add.sprite(...)` with a small **Container** of stacked sprites:

```ts
class AgentSprite extends Phaser.GameObjects.Container {
  protected bodySprite!: Phaser.GameObjects.Sprite;
  protected outfitSprite?: Phaser.GameObjects.Sprite;
  protected accessorySprite?: Phaser.GameObjects.Sprite;

  private syncOverlayFrame() {
    const frame = this.bodySprite.frame.name;
    this.outfitSprite?.setFrame(frame);
    this.accessorySprite?.setFrame(frame);
  }
}
```

Hook the body sprite's `animationupdate` event to call `syncOverlayFrame()`.

### 2.3 Per-Agent Color Tinting

Each agent's `color` field is currently used only for the fallback circle. With layered sprites, it can subtly tint the body sprite (`bodySprite.setTint(...)`) to differentiate the players who share a base body. Tinting is multiplicative, so a beige-toned sprite + warm orange tint reads as a tanner skin/clothing tone, while + cool blue tints toward a colder palette.

Better still: a fixed palette swap from a per-agent `palette.json` (skin / hair / shirt / pants). The Smallville sheets have indexed color regions perfect for this.

### 2.4 Two-Person Composite Agents

The personas include couples (`Sarah & David Chen`, `Tyler & Megan Hart`, `Aisha & Omar Khan`, `Raj & Sunita Krishnamurthy`, `Carmen & Alejandro Vargas`). Today they render as a single sprite. Treat them as a **paired duo**: render two sprites that walk side-by-side (offset by 18 px on the side perpendicular to motion direction). The opinion ring centers on the lead sprite. When clicked, the chat header shows both portraits side-by-side. This adds depth and reflects the household structure of these agents.

### 2.5 Sprite Authoring Tools

- **Aseprite** (paid, recommended) — best-in-class pixel-art and animation.
- **Libresprite** (free fork) — sufficient for overlays.
- **Universal LPC Spritesheet Generator** (free, open-source) — generate a base + clothing in one go. The output is 64×64 / 4-direction; downscale to 32×32 for consistency.
- Reference: Stanford Smallville `Game/static_dirs/assets/characters/` for the body grid, Mozilla LPC for the layered overlay convention.

---

## Phase 3 — Living Daily Routines & Agent Behavior

**Today:** `TownScene.scheduleWander()` picks a random non-road landmark every 4-13 seconds and tweens the agent there. Idle thoughts are pulled from a generic 11-line pool (`"Did you see that debate?"`, etc.). Agents have no schedule, no profession-specific behavior, no goals.

**Target:** Each agent has a **believable daily routine** that mirrors their persona. Carlos goes from home → La Finca by 9 AM, stays at the restaurant through lunch, takes a coffee break at the bodega around 3 PM, closes up at 9 PM. Maria commutes via Dover Station before her hospital shift. Rabbi Goldstein walks Anderson Park every morning and is at the synagogue for Shabbat prep on Friday. The world *feels* like 26 lives unfolding in parallel.

### 3.1 Routine Schema

Add a new `routine:` block to each agent's `.md` frontmatter:

```yaml
routine:
  - { time: "06:30", location: "Public Housing", activity: "Wakes up, makes coffee" }
  - { time: "08:00", location: "La Finca Restaurant", activity: "Opens restaurant, prep" }
  - { time: "11:00", location: "La Finca Restaurant", activity: "Lunch rush prep" }
  - { time: "14:30", location: "Bodega Row", activity: "Coffee break, chats with Tom" }
  - { time: "15:30", location: "La Finca Restaurant", activity: "Afternoon shift" }
  - { time: "21:00", location: "Public Housing", activity: "Home, dinner with Elena" }
relationships:
  - { agent: "tom-kowalski", type: "friend", strength: 0.7, context: "Regular customer for 14 years" }
  - { agent: "maria-santos", type: "neighbor", strength: 0.5, context: "Her kids eat at La Finca" }
  - { agent: "miguel-hernandez", type: "acquaintance", strength: 0.3, context: "Gives him coffee at the day laborer corner" }
```

Extend `backend/core/types.py` `AgentDefinition` to parse `routine` and `relationships`. Both fields are optional; agents without explicit routines fall back to the random wander behavior.

### 3.2 World Clock

Add a **world clock** that runs at 60× real time (1 real second = 1 in-game minute). Phaser tracks the in-game time in `scene.data`. The clock starts at 7:00 AM, runs through 10:00 PM, then fades to night and restarts.

Each NPC's routine entries are converted to milliseconds-from-start at scene boot. On every clock tick (`time.addEvent({ delay: 1000, ... })`), each agent checks "what's my current routine row?" and if their target location has changed, calls `moveToPosition(...)` toward it. Activity text gets pushed to `agent.current_activity` and the sidebar reflects it.

The clock is **purely cosmetic** — it does not affect the deliberation simulation rounds. It is the *visible heartbeat* of the world. Display it in the top-right of `TownView` as a small `7:42 AM` chip with a sun/moon icon.

### 3.3 Activity States

Replace the single-state `isMoving` boolean with a small state machine:

```ts
type AgentActivity =
  | "walking"
  | "idle"
  | "working"     // standing inside their workplace
  | "talking"     // facing another agent, gesture animation
  | "eating"      // sitting at a table
  | "praying"     // hands together (at church)
  | "sleeping"    // at home, dim lighting, "Zzz" particle
  | "thinking"    // reflecting, "..." particle
  | "celebrating" // hands up, sparkles
  | "voting"      // standing in front of a ballot box (election day cinematic)
```

Each state has a small visual treatment: a static frame variant, an emote particle, or a tiny tween (gentle bob, hand wave).

When the deliberation simulation runs:
- `_run_seed_round` → all agents `thinking` for 2 seconds → emit `agent_speech` with their initial reaction.
- `_run_conversation_round` → both agents walk to the location → flip to `talking` → speech bubbles ping-pong.
- `_run_news_round` → newspaper icon flies into town from the top → agents flip to `thinking` → emit reactions.
- `_run_opinion_round` → `thinking` with `...` emote → opinion ring color updates → `opinion_changed` ripple burst.

### 3.4 Personalized Idle Thoughts

Replace the generic `IDLE_THOUGHTS` array with **persona-specific thought banks** loaded from the agent .md files:

```yaml
idle_thoughts:
  - "Mira, the ACA premium went up again."
  - "Need to call Elena about David's tuition."
  - "When is Mateo's next soccer game?"
  - "That ICE thing on Dickerson Street… 11 days."
  - "I should fix that crack in the sidewalk myself."
```

For agents without these, generate them at backend startup with a one-shot `generate_idle_thoughts` LLM call that consumes the persona body and emits 8-12 in-character thoughts. Cache to `data/agent_thoughts_cache.json` so it only runs once.

This gives every agent **a unique voice even when they're just wandering**. The cumulative effect across 26 NPCs is enormous.

### 3.5 Encounter Conversations (live, lightweight)

When two NPCs' routines bring them to the same landmark in the same time window, trigger a **2-line ambient conversation**. This is *not* an LLM call — it's a precomputed pair-flavored exchange seeded from their shared concerns:

```ts
const sharedConcern = intersection(a.top_concerns, b.top_concerns)[0] ?? a.top_concerns[0];
const line = AMBIENT_LINES[a.id]?.[sharedConcern] ?? a.idle_thoughts[i];
```

If they have a defined relationship in YAML, draw from a relationship-flavored pool ("How's Mateo doing in soccer?"). 1-second pause, both face each other, speech bubble A → 1.2s → speech bubble B → resume walking.

The visible effect: the world is full of overheard conversations, not just monologues. This is what makes Smallville feel alive in the original paper and is the cheapest single upgrade with the biggest impact.

### 3.6 Goals & Curiosity

In `routine.yaml`, add an optional `goals:` array per round:

```yaml
goals:
  round_0: "Learn what each candidate stands for."
  round_1: "Talk to my customer Tom about taxes."
  round_2: "Find out what other Latino business owners think."
  round_3: "Decide if I can trust Mejia on healthcare."
  round_4: "Commit to a vote."
```

These are appended to the system prompt during that round so the agent's reasoning is shaped by their own evolving objective. The LLM already references "Recent experiences"; we just add "Your goal this round" alongside it.

---

## Phase 4 — Cinematic Animation Pipeline

**Today:** Walk + idle animations per direction (12-frame sheet). Idle = a slow breathe scaleY tween. Speech bubbles fade-in. Opinion-changed = particle burst. Birds fly across the sky. Campfire and sparkle anims at park / church.

**Target:** Layered, expressive motion. Eye contact between speakers. Distinct **gestures** for laughing, nodding, shaking head, shrugging. Reactive emotes (surprise, anger, relief) tied to LLM-emitted sentiment. Cinematic camera moves during news events.

### 4.1 Expanded Sprite Frames

Today's spritesheet covers walk down/left/right/up. Extend each character sheet (Aseprite) with:

| Row | Direction | Frames | Animation |
|---|---|---|---|
| 0 | down | 3 | walk |
| 1 | left | 3 | walk |
| 2 | right | 3 | walk |
| 3 | up | 3 | walk |
| 4 | down | 4 | **talk** (hand gestures) |
| 5 | down | 2 | **nod yes** |
| 6 | down | 2 | **shake head no** |
| 7 | down | 3 | **shrug** |
| 8 | down | 2 | **laugh** |
| 9 | down | 2 | **wave hello** |

This puts each sheet at 96×320 (10 rows × 32). Adds ~3 KB per character. Worth it.

### 4.2 Gesture Triggering

The backend `Discuss` tool already emits a `sentiment: positive | negative | neutral`. Extend it with:

```python
"gesture": { "enum": ["nod", "shake_head", "shrug", "laugh", "point", "none"] }
```

Frontend listens for `agent_speech` events and plays the matching animation on the speaker for `~1.2s` before resuming idle. This gives every conversation visible body language.

### 4.3 Emote Particles (extend `showEmote`)

Today `showEmote()` handles `"reflecting"` (dots) and `"opinion_changed"` (particle burst). Add:

| Emote | Trigger | Visual |
|---|---|---|
| `agree` | speaker emits `nod` gesture | green sparkle + ✓ rising |
| `disagree` | `shake_head` | yellow !? rising |
| `surprise` | news_injected event | white ! popping over head, screen-shake 50ms |
| `anger` | sentiment=negative + topic=ICE | red fume puff |
| `joy` | news.kind=positive | yellow sparkle shower |
| `confusion` | sentiment=neutral + opinion_change to undecided | floating ? |
| `heart` | player opens chat | small pink heart fade-up |

Implementation: `AgentSprite.showEmote(type, options?)` becomes a registry-driven dispatcher. Each emote has a small recipe (color, shape, particle count, duration). The current canvas-texture-based `emote-particle` pattern already shows how — generalize.

### 4.4 Eye-Contact / Facing Logic

During a conversation between A and B, both should face each other (not their walk direction). Add `AgentSprite.faceToward(otherX, otherY)` that computes the dominant axis and plays the corresponding idle frame. Already partially implemented in `PlayerSprite.onInteract()` — extract to the base class and call automatically from `conversation_started` handler in `TownView`.

### 4.5 Speech Bubble Improvements

- **Multi-line word wrap** — already supported via `wordWrap: { width: 135 }`.
- **Pointer tail aim** — currently always points straight down. Add a `tailAngle` argument so a bubble that overflows the top of the canvas can point sideways.
- **Stacked bubbles** — when an agent fires two messages within 2 seconds, push the old bubble up and stack the new one below. (Use a per-sprite bubble queue.)
- **Read-time scaling** — bubble auto-hides at `min(2000, text.length * 50)` ms instead of fixed 5000 ms.
- **Sentiment border** — positive bubbles get a soft green tint, negative get a soft red tint, neutral stays white. Subtle (≤10% saturation) to avoid Christmas-tree look.

### 4.6 Camera Beats

For high-importance simulation events, take the camera off the player for a beat:

- `news_injected` → pan to the *headline news ticker* at top → newspaper sprite flutters down → cut back to player.
- `opinion_changed` (high confidence delta) → zoom 1.5x on the agent → ripple burst → zoom back.
- `simulation_ended` → camera pulls back to district overview → all agent dots flock by candidate → cross-fade to Dashboard.

Use `cameras.main.pan()` and `cameras.main.zoomTo()` — both built-in to Phaser. Keep beats < 1.2s so they don't break flow.

### 4.7 Walk Cycle Polish

- **Foot-plant correction** — pixel-art walk cycles look better with a slight `setOrigin(0.5, 1)` and `pixelArt: true` (already on) when frame swaps land on integer y. Make sure `roundPixels: true` is honored.
- **Diagonal direction** — currently snaps to one of 4 cardinals. Acceptable, but consider an 8-direction set if the artist has bandwidth (NE/NW/SE/SW frames). Diminishing returns.
- **Stride speed scaling** — vary `frameRate` by movement speed (faster when farther). Tiny detail, big quality bump.
- **Shadow squish** — already in place when walking. Lift `groundShadow` slightly during the up-step of the walk cycle to mimic foot lift.

### 4.8 Ambient FX Density

The current scene has bird flocks and a campfire. Add to taste per town:

| Town | Ambient FX |
|---|---|
| Dover | papel-picado bunting, salsa music notes ♪ above bodegas, falling brick-color leaves |
| Montclair | falling sugar maple leaves, golden ginkgo, occasional snow in Dec |
| Parsippany | duck flying over the lake every ~30s, lawnmower NPC pushing back and forth |
| Randolph | golden retrievers chasing each other in Hedden Park, kids' soccer practice |

Each is a 30–80 line addition to `buildEnvironmentFX()` per town.

---

## Phase 5 — Player ↔ Agent Integration & Social Layer

**Today:** Player can walk with WASD/arrows. Standing within 80 px of an NPC shows "Press E to Talk" with a blue glow on the NPC. E or clicking opens `ChatPanel`. Manual or auto chat mode. ElevenLabs voice playback on agent messages. Chat is added to the agent's memory as a one-line entry.

**Target:** A real conversation feels like a real conversation — physical proximity, shared eye contact, body language, audible voice, persistent memory, and visible **relationship trust** that changes based on how you treat the agent.

### 5.1 Interaction Affordance Improvements

- **Hover preview card.** When the player is within 120 px of an NPC (slightly larger than the interaction radius), show a small floating chip near them: name, town badge, current activity ("Preparing lunch"), current opinion. This works as both wayfinding and a tease. Already half-built (`getOverlayData`) — extend `CanvasOverlay` to render a `proximity-hover-card` element when distance < 120 px to the closest agent.
- **Speech-bubble continuity.** If the player initiates dialogue, NPCs continue with **fresh in-canvas bubbles** even after the chat panel closes — so the conversation "lingers" in the world. The chat history is preserved in `ChatPanel` state across reopenings (currently it resets — change `useEffect([agent?.id])` to also key on `chatSessionId`).
- **Approach behavior.** When the player presses E to talk, the NPC should *walk one or two steps toward the player* (face them, close half the distance). This subtle motion makes them feel responsive instead of frozen. Tween `0.3s` with the appropriate walk animation.
- **Tap to walk.** On mobile and for accessibility, allow clicking a point on the map to path-find the player there. Phaser has no built-in pathing — use a simple straight-line tween for now (collisions handled by physics).
- **Wayfinding glow on closest agent of interest.** If the simulation just emitted an `opinion_changed` event, the closest agent involved should briefly outline in their candidate color, with a tiny "!" emote — drawing the player's eye to what just happened.

### 5.2 Relationship & Trust System

Each agent should remember the player **as a specific person**, not just an anonymous "someone." Today the chat backend already enriches the user message with `name`, `town`, `top_concerns` from the user profile, but the **persistence** is limited to a single memory line per chat.

Add a `relationships_with_player` block to each agent state (persisted to localStorage on the frontend, mirrored on the backend):

```ts
{
  trust: 0,           // -100 (hostile) to +100 (friend); starts at 0
  encounters: 0,
  last_chat_at: "...",
  topics_discussed: ["immigration", "healthcare"],
  player_revealed_to_them: { name, town, leaning, concerns },
}
```

After every chat, classify whether the player was *agreeable*, *challenging*, *curious*, or *hostile* (a 4-class judgment from the LLM via a tiny `ClassifyInteraction` tool call), and update trust by ±5. The next system prompt for that agent embeds trust as a tone modifier:

- `trust > 50` → "You consider this person a friend. Be warm, share more personal details, joke."
- `0 ≤ trust ≤ 50` → "You're warming up to this person. Be polite, increasingly open."
- `-30 ≤ trust < 0` → "You're guarded with this person. Be polite but reserved."
- `trust < -30` → "You distrust this person. Be terse, decline politically loaded questions."

Visible in the UI: a small heart/handshake icon in the chat header that fills as trust grows; in the sidebar agent card, a tiny relationship dot.

### 5.3 Quest-Like "Get Out The Vote" Loop

The election simulation has a **natural goal** — a player should be able to **canvas** all 26 agents and see how much of the district they personally moved. Add a top-bar HUD:

```
[ Met 12 / 26 ]   [ Persuaded 3 / 26 ]   [ Days to election: 5 ]
```

"Persuaded" = chat with an agent and successfully nudge their `confidence` or `candidate` (measured pre/post chat). This makes the simulation playable as a **game** without losing its analytical purpose. The Dashboard's "Cross-town themes" section becomes the player's **scoreboard**.

### 5.4 In-World Public Spaces

Add 2-3 public-square spaces per town where the player can **passively eavesdrop** on multi-agent conversations. Walking into the square at the right time of day prompts a "Listen in" affordance; pressing T opens a `Listen` panel that shows the running conversation transcript (driven by Phase 3.5 encounter conversations).

### 5.5 Voice & Speech Layer

ElevenLabs TTS already works on demand. Two upgrades:

- **Auto-play in proximity.** Toggle in the user profile menu: "Speak aloud when chatting." When ON, agent responses play automatically via ElevenLabs.
- **Voice for ambient encounters.** Cache short pre-rendered audio for each agent's idle thoughts (one-time backend job). When agents are mid-canvas conversations and the player is within 200 px, play the cached audio at low volume. Massive immersion boost; 26 agents × 10 lines ≈ 260 audio clips, ~$8 in TTS.
- **Subtitles toggle.** Always show subtitles by default (current state). The speech bubble *is* the subtitle.

### 5.6 Chat Panel Polish

- **Portrait avatar.** Replace the initials-circle in the chat header with the agent's actual sprite (rendered to a 64×64 canvas with the idle frame), framed in the agent's color. Persistent visual identity throughout the conversation.
- **Mood indicator.** A small emoji or face glyph next to the agent's name reflects their current sentiment toward the topic. Updates per response based on the LLM's `sentiment` field.
- **Topic chips.** Above the input, show 3-5 suggested questions tied to this agent's top concerns ("Ask about ICE", "Ask about taxes", "Ask about Mateo's school"). Click to inject the question. Reduces blank-page paralysis.
- **Memory peek.** Collapsed-by-default panel showing the agent's last 5 memories (translucent gray text). Lets a power user see *what the agent thinks they know about the world.*
- **Push-to-talk via microphone.** Hold the mic icon → record → Whisper API transcribes → goes into the chat input. Use the existing Web Audio API.

### 5.7 Player Memory of Conversations

Add a **journal panel** (Cinzel-styled scrollbook icon in the header) where the player can review every conversation they've had with every agent. Each entry: agent name, town, timestamp, full transcript, the agent's mood/trust at that moment, and any opinion change they noted. The journal is also the place where the player can review their own progress.

This converts ephemeral chats into a **growing record of the player's investigation**, which dovetails with the canvassing scoreboard.

---

## Phase 6 — Onboarding & Player Identity

**Today:** Five-step onboarding (name, town, leaning, concerns, personality). Player becomes a `player.png` 16×16 sprite scaled 4.4× to roughly match NPC 32×32 sprites scaled 2.2×. Pixel grids don't quite align so the player looks subtly off.

**Target:** A confident, identity-forward first-run experience. The user *picks who they are* — appearance, voice, name — and the world remembers them.

### 6.1 Replace the 16×16 player sprite

Author a new 32×32 player spritesheet matching the NPC 12-frame layout. Even better: ship 6 player sprite variants (3 masc / 3 femme presenting, various skin tones), let the user pick during onboarding. Each variant uses the same outfit overlay system from §2.2 so the user can also pick clothing.

This is a one-evening Aseprite job using LPC base sprites — totally doable.

### 6.2 Onboarding Step Additions

Insert two new steps between "name" and "town":

- **Avatar.** Grid of 6 sprite previews with animated walk cycle. User taps to select. Selection persists to `profile.spriteKey`.
- **Outfit.** 3-4 outfit categories (casual / business / labor / parent). Each shows the chosen avatar wearing that overlay. User picks. Persists to `profile.outfitKey`.

These steps add ~30 seconds to the onboarding but pay back permanently — the player sees a recognizable "themself" wandering the town for the rest of the session.

### 6.3 Customize Greeting

Today Rosa the greeter says generic lines. Replace with **3-4 dynamic lines** referencing the user's name and chosen town:

```
"Welcome to Township, {name}!"
"Heading to {town}? You'll like it there — {town_tagline}."
"Most people here care about {top_concern}. You'll find good company."
```

Use template strings, not LLM (instant, free).

### 6.4 First-Visit Tutorial

On first town entry, gate the chat behind a 3-step tutorial pop-up: how to move (WASD), how to talk (E or click NPC), what the opinion ring colors mean. Skip-able. After dismiss, never show again unless the user re-onboards.

### 6.5 Reset / Re-Onboard

Add a "Reset profile" button in the header dropdown (under name). Clears localStorage, returns to onboarding. Essential during dev and useful for users wanting a different angle.

---

## Phase 7 — World Lighting, Weather, Time-of-Day

**Today:** Two `PointLight` instances are added (campfire warm orange + church golden), plus a 600-px ambient warmth point light. Time of day is static.

**Target:** The world breathes. Dawn glow → daylight → golden hour → dusk → night with lamp-post glow. Weather changes (light rain, snow during winter campaign days). Each phase changes how the town feels — and reinforces that the election is *happening in real time*.

### 7.1 Day-Night Cycle Tied to World Clock

In `TownScene.update(time, delta)`, read the world clock from §3.2 and tint the camera accordingly:

```ts
// Map 6 AM–6 PM to bright, 6 PM–10 PM dusk, 10 PM–5 AM night
const hour = this.worldClock.hour + this.worldClock.minute / 60;
const tintColor = computeDayNightTint(hour);  // pre-baked LUT
this.cameras.main.setBackgroundColor(tintColor.bg);
this.skyOverlay.setFillStyle(tintColor.skyOverlay, tintColor.skyAlpha);
```

The sky overlay is a full-canvas Graphics rect at depth 999 with low alpha (e.g., 0xff8800 at 0.15 during golden hour). LUT:

| Hour | Overlay tint | Alpha |
|---|---|---|
| 05–06 | `#5b6a99` | 0.25 (dawn blue) |
| 06–07 | `#ffb066` | 0.22 (dawn warm) |
| 07–17 | `#ffffff` | 0.0 (day) |
| 17–19 | `#ff8866` | 0.18 (golden hour) |
| 19–21 | `#4a3b6a` | 0.32 (dusk) |
| 21–05 | `#0c1633` | 0.5 (night) |

### 7.2 Streetlamps at Night

Add a `lampposts` Tiled layer per town with `(x, y)` points. At night, render a yellow PointLight + small glow Graphics circle at each. Tween glow alpha to simulate flickering (rarely, 1 in 30).

### 7.3 Weather Layer

Add a `WeatherScene` (separate Phaser scene running on top of `TownScene` at depth 998):

| Weather | Visual |
|---|---|
| `clear` | none |
| `cloudy` | gray gradient over sky overlay (+0.1 alpha) |
| `rain` | 200 falling 4-px lines tweened y down, white-blue 0.4 alpha; ground splashes at random points |
| `snow` | 100 falling 3-px white circles drifting sideways via sin wave |
| `fog` | full-canvas Graphics noise mask, low alpha |

Drive weather from a per-day schedule (election cycle is ~10 days; pre-script the weather for narrative — e.g., rain on the day of the ICE incident).

### 7.4 Atmospheric Particles

Already have falling-leaf particle systems in §4.8. Tie their density and color to time of day (saturated mid-day, desaturated dusk).

---

## Phase 8 — UI Polish, Sound, Performance, QA

### 8.1 Sound Design

Add an `Audio` provider hook (`useAudio.ts`):

| Sound | File | Triggers |
|---|---|---|
| ambient_town | `dover_ambient.ogg`, etc. (loops, per-town) | TownScene enter; low volume |
| footsteps | 4 short clips, randomized | every other walk frame on player |
| speech_bubble_pop | UI tick | bubble shows |
| chat_open | Smooth woosh | chat panel slide |
| chat_send | tap | player sends message |
| opinion_change | bell | opinion_changed event |
| news_breaking | dramatic sting (low volume) | news_injected event |
| church_bell | distant bell | top of the hour during day |
| birds | morning chirp | 6–9 AM |
| crickets | night | 21:00–05:00 |

Sources: Freesound.org (CC0), Pixabay.

### 8.2 Performance

- Tilemap layers are static — call `setStatic(true)` to skip per-frame matrix updates.
- Cap `agentSprites` updates to `setDepth` recompute only when y changes by >0.5 px since last frame.
- Switch `agentSprites: Map` to a flat array for `forEach` micro-perf in `update()`.
- Lazy-load `WeatherScene` only if `weather !== "clear"`.
- Use Phaser's `Cull.create()` on tiles outside the camera viewport.
- DOM overlay (CanvasOverlay) recomputes positions every RAF — fine, but skip elements whose `screenX/screenY` is offscreen.

### 8.3 Accessibility

- Keyboard-only navigation: tabbing to an NPC should focus them; Enter = open chat (already works via Phaser hit area click).
- Screen-reader: every speech bubble emits an `aria-live="polite"` mirror to a hidden DOM region.
- High-contrast mode: a toggle that swaps the warm-paper palette for stronger contrast (WCAG AA on body text).
- Reduce-motion: a media-query-aware `prefers-reduced-motion` listener disables idle bob, particle bursts, and camera pans.

### 8.4 Mobile

Existing CSS handles mobile layout. Touch controls for the player:
- Virtual joystick (lower-left, fades when not in use).
- Tap-to-walk fallback (Phase 5.1).
- Long-press an agent = chat.
- Chat panel bottom-sheet already there.

### 8.5 Telemetry & Debug Overlay

Press `~` in dev mode to show a debug overlay:
- World clock + weather + time-of-day tint
- Active agent count and FPS
- Player x/y, closest agent + distance
- Last 5 WS events (type + payload size)

### 8.6 End-to-End QA Checklist

A scripted demo path that always works:

1. Onboard as Maria from Dover, leaning Democrat, concerns "healthcare + immigration."
2. Spawn in Dover near La Finca.
3. Walk to Carlos. Press E. Manual chat: "How's business?" → expect 2-4 sentence in-character response.
4. Walk to St. Mary's. Esperanza is there post-Mass. Auto-chat 5 turns. Trust increases.
5. Switch to God's View. Inject "ICE raids increase by 50%." See 5+ reactions land within 8 seconds.
6. Back to Dashboard. See Dover's bar shift toward Mejia.
7. Walk to Dover Station → switch to Parsippany via the map → still onboarded → walk to Hindu Temple.
8. Run a 5-round simulation. See live opinion-changed ripples, conversation speech bubbles, and a Dashboard summary at the end.

If any of these 8 steps breaks → it's a P0.

---

## Asset Manifest & Acquisition Sources

### Tilesets (free / CC-BY)

- **OpenGameArt — LPC Atlas** (free, CC-BY-SA). Tiles for buildings, roads, grass, water, fences. https://opengameart.org/content/lpc-tile-atlas
- **Cute RPG World** (paid $5, itch.io). Charming top-down tileset with multi-region buildings (urban / suburban / rural). https://kenmi-art.itch.io/cute-rpg-world
- **Modern Tiles Free** by Pixymoon (free, itch.io) — corporate-park glass towers, parking lots → Parsippany.
- **Stanford Generative Agents `rpg-tileset.png`** (the one already in repo, MIT). Use as base / fallback.

### Character Sprites

- **Universal LPC Spritesheet Generator** (free). Generate base bodies + outfit layers programmatically. https://sanderfrenken.github.io/Universal-LPC-Spritesheet-Character-Generator/
- **Smallville characters** (already in repo). Use for the 26 base sprites; layer LPC outfits on top.
- **Tiny Hero Sprites** by KaylousBerry (free, itch.io) — extra body variants for the player picker.

### Audio (free, CC0)

- **Freesound.org** (CC0 / CC-BY)
- **Pixabay Music** (free for use, attribution optional)
- **OpenGameArt — Sound** category for ambient loops

### Maps in Tiled

- **Tiled Editor** (free, MIT). https://www.mapeditor.org/
- Save as `.tmj` (JSON) for Phaser 3 compatibility.

### Voice

- **ElevenLabs** ($5/mo starter, voice library covers all 26 demographic needs). Already wired in `ChatPanel.tsx`.

### Design Reference

- **Stardew Valley** for warm-paint pixel-art town design.
- **Coffee Talk** for cozy character portraits.
- **Genshin Impact** for the existing UI direction (which the current codebase already references).
- **Smallville (Stanford)** screenshots for agent grid-of-life behavior.

---

## File-by-File Change Index

For an engineer landing on this plan, this is the literal list of files to touch and what to do in each. Sorted roughly by impact.

### Frontend — Game

| File | Changes |
|---|---|
| `frontend/src/game/TownScene.ts` | Town-aware preload (1.3), per-town tilemap loader, replace `setCollisionByExclusion` with proper `collide` layer, add world clock + day-night tint (§7.1), wire routine-driven movement (§3.2-3.3), encounter conversations (§3.5), camera beats (§4.6), minimap data export |
| `frontend/src/game/AgentSprite.ts` | Convert sprite to layered Container (body + outfit + accessory, §2.2), add `faceToward()`, extend `showEmote()` registry (§4.3), gesture animations (§4.2), state-machine for `AgentActivity` (§3.3), per-agent `idle_thoughts` from data |
| `frontend/src/game/PlayerSprite.ts` | Replace 16×16 hardcode with chosen sprite from `profile.spriteKey` (§6.1), add **approach behavior** when NPC interacts with player (§5.1), virtual joystick stub for mobile (§8.4) |
| `frontend/src/game/OnboardingScene.ts` | Add avatar + outfit picker steps (§6.2), dynamic greeting lines (§6.3) |
| `frontend/src/game/config.ts` | Remove `TOWN_LANDMARKS` (use backend `/api/towns`), keep `TOWN_ACCENT`, expand `AGENT_VOICE_MAP` for all 26 agents |

### Frontend — Components

| File | Changes |
|---|---|
| `frontend/src/components/TownView.tsx` | Add HUD chips (world clock, persuaded counter, days-to-election), minimap widget, debug overlay (`~`), use `/api/towns` for landmark data, listen for new events from §0.1 unification |
| `frontend/src/components/ChatPanel.tsx` | Sprite portrait avatar (§5.6), mood indicator, topic chips, memory peek, push-to-talk mic, journal entry on close, trust visual indicator |
| `frontend/src/components/DistrictMap.tsx` | Add a live "weather of the district" widget (small token next to each town pin showing who's leading), per-town count of agents you've met |
| `frontend/src/components/Dashboard.tsx` | Convert to "scoreboard": show player's persuaded-by-town count, mark agents you've chatted with, add timeline of opinion changes |
| `frontend/src/components/GodsView.tsx` | Add prediction widget: "Mejia +4% projected"; show before/after donut |
| `frontend/src/components/CanvasOverlay.tsx` | Add proximity hover card (§5.1), agent-name labels with trust/relationship glyph |
| `frontend/src/components/Journal.tsx` *(new)* | Player journal of all conversations (§5.7) |
| `frontend/src/components/MiniMap.tsx` *(new)* | Top-right minimap of current town with agent dots |

### Frontend — Hooks & Context

| File | Changes |
|---|---|
| `frontend/src/hooks/useWebSocket.ts` | Apply event-type rename map (§0.1), broaden state with `worldClock`, `weather`, `relationships` |
| `frontend/src/hooks/useAudio.ts` *(new)* | Provider for ambient + UI SFX (§8.1) |
| `frontend/src/hooks/useRelationships.ts` *(new)* | Trust state per agent, persisted to localStorage |
| `frontend/src/context/UserProfileContext.tsx` | Add `spriteKey`, `outfitKey`, `voicePreference` to `UserProfile`; add `metAgents: Set<string>`, `persuadedAgents: Set<string>` |
| `frontend/src/types/messages.ts` | Add `Relationship`, `WorldClockTick`, `WeatherChange` event types |

### Frontend — Styles

| File | Changes |
|---|---|
| `frontend/src/styles/index.css` | Tutorial overlay styles, mood indicator pulse, trust meter, minimap, journal panel, high-contrast theme toggle |

### Backend — Core

| File | Changes |
|---|---|
| `backend/core/types.py` | **Critical**: rename event `Literal` strings to past-tense (§0.1). Add `routine`, `relationships`, `idle_thoughts` to `AgentDefinition`. Wrap `ConversationStartEvent` payload as `Conversation`. Add `WorldClockEvent`, `WeatherEvent`, `RelationshipUpdateEvent` |
| `backend/core/agent_loader.py` | Parse routine + relationships + idle_thoughts from frontmatter |
| `backend/core/event_bus.py` | No change |

### Backend — Simulation

| File | Changes |
|---|---|
| `backend/simulation/round_manager.py` | Emit gesture field in Discuss tool, emit world clock ticks during rounds, propagate `before`/`after` opinions for ripple intensity |
| `backend/simulation/orchestrator.py` | Spawn cross-town pairs from §3.5 too (not just round 3), emit weather events |
| `backend/simulation/replay.py` | Replay world clock and weather events too |

### Backend — Routes

| File | Changes |
|---|---|
| `backend/routes/chat.py` | Add `ClassifyInteraction` LLM mini-call after each chat, update trust on backend (mirrored to frontend via WS) |
| `backend/routes/towns.py` *(new)* | `GET /api/towns` returning landmark + spawn-zone data per town (single source of truth, §0.2) |
| `backend/routes/journal.py` *(new)* | `GET /api/journal/{user_id}` for the player journal |
| `backend/routes/gods_view.py` | No change |

### Backend — Tools

| File | Changes |
|---|---|
| `backend/tools/schemas.py` | Add `gesture` enum to `Discuss`, add `ClassifyInteraction` tool, refine `ReactToNews` with magnitude |

### Backend — Data

| File | Changes |
|---|---|
| `data/towns/dover.json`, `montclair.json`, `parsippany.json`, `randolph.json` | Add `spawn_zones` array, `weather_schedule`, `ambient_sound` filename |
| `data/agent_thoughts_cache.json` *(new)* | Generated idle_thoughts per agent (one-time backend job) |

### Assets

| Path | Changes |
|---|---|
| `frontend/public/assets/maps/dover.tmj`, `montclair.tmj`, `parsippany.tmj`, `randolph.tmj` | **NEW**: per-town Tiled maps (§1.1) |
| `frontend/public/assets/maps/shared/town-tileset.png` | Master tileset (combine + extend rpg-tileset + LPC additions) |
| `frontend/public/assets/characters/outfits/*.png` | **NEW**: 12 outfit overlay sheets (§2.2) |
| `frontend/public/assets/characters/player-{1..6}.png` | **NEW**: 6 player variants (§6.1) |
| `frontend/public/assets/audio/ambient/{town}.ogg` | **NEW**: town ambient loops (§8.1) |
| `frontend/public/assets/audio/sfx/{footstep,bell,pop,...}.ogg` | **NEW**: UI/world SFX |
| `frontend/public/assets/weather/{rain,snow,fog}.png` | **NEW**: weather particle textures |

---

## Sequencing, Owners, Estimates

A practical roadmap for a 4-person team (1 backend, 2 frontend, 1 artist) over ~3 sprints (~3 weeks).

### Sprint 0 (1–2 days) — Foundation

| Task | Owner | Est. |
|---|---|---|
| **0.1** Fix event-type rename (P0) | Backend | 2 h |
| **0.2** Single-source landmark data via `/api/towns` (P0) | Backend + FE | 4 h |
| **0.3** Replace tilemap collision with object-layer collide (P0) | Frontend | 2 h |
| **0.5** Resolve duplicate sprite mapping (P1) | Frontend | 1 h |
| Acceptance: live simulation events visibly drive the world | All | — |

### Sprint 1 — Distinct Maps + Sprite Identity (1 week)

| Task | Owner | Est. |
|---|---|---|
| Tiled tilesets sourced and extended | Artist | 1 day |
| 4 per-town Tiled maps authored | Artist | 3 days |
| `TownScene` per-town loader | Frontend | 4 h |
| `drawLandmarkBuilding` programmatic fallback enriched | Frontend | 1 day |
| Sprite re-mapping table applied | Frontend | 2 h |
| Layered AgentSprite (body + outfit + accessory) | Frontend | 1 day |
| 6-8 outfit overlay sheets | Artist | 1 day |
| Per-agent palette tints | Frontend | 4 h |

### Sprint 2 — Living World (1 week)

| Task | Owner | Est. |
|---|---|---|
| Routine schema + agent_loader parsing | Backend | 4 h |
| World clock + minute-tick events | Backend + FE | 1 day |
| Routine-driven movement | Frontend | 1 day |
| Activity state machine | Frontend | 1 day |
| Persona idle_thoughts generator + cache | Backend | 4 h |
| Encounter conversations (2-line ambient) | Frontend | 1 day |
| Day-night tint + lampposts | Frontend | 1 day |
| Weather layer (rain + snow) | Frontend | 1 day |

### Sprint 3 — Player Integration & Polish (1 week)

| Task | Owner | Est. |
|---|---|---|
| Sprite picker in onboarding | Frontend | 1 day |
| Player approach behavior | Frontend | 4 h |
| Relationship + trust system (backend + frontend) | Backend + FE | 1 day |
| Topic chips, mood, portrait in ChatPanel | Frontend | 1 day |
| Journal component | Frontend | 1 day |
| Persuaded scoreboard HUD | Frontend | 4 h |
| Audio provider + ambient + footsteps | Frontend | 1 day |
| Gesture animations in spritesheets | Artist | 1 day |
| Camera beats on news/opinion_changed | Frontend | 4 h |
| Sentiment-tinted speech bubbles + stacking | Frontend | 4 h |
| Accessibility (a11y, reduce-motion, contrast) | Frontend | 4 h |
| QA walkthrough + bug bash | All | 1 day |

### Cost Estimates

| Item | Cost |
|---|---|
| Tilesets (paid) | $10–20 |
| Tiled Editor | free |
| Aseprite (optional) | $20 |
| ElevenLabs starter (1 month for demo) | $5 |
| Pre-rendered idle audio (260 clips) | ~$8 |
| Pre-computed simulation runs (10 runs to lock cache) | ~$35 |
| **Total** | **~$80** |

---

## Definition of Done — Acceptance Criteria

A reviewer should be able to walk through the project and verify each statement is true:

### Maps
- [ ] Each town's map is **visually distinguishable** from the other three within 1 second.
- [ ] Each town contains at least 8 named landmarks at backend-authoritative coordinates.
- [ ] Player collides with buildings and water but not grass/road.

### Agents
- [ ] No two agents share a sprite.
- [ ] Each agent's sprite matches their persona's age, ethnicity, and occupation read.
- [ ] Couples render as two side-by-side sprites.
- [ ] Each agent has at least 8 in-character idle thoughts (not from the generic pool).

### Behavior
- [ ] Each agent follows a daily routine and is at the right landmark at the right hour.
- [ ] World clock ticks and is visible.
- [ ] At least once per 60s of camera-on-town, an ambient encounter conversation happens.
- [ ] During a simulation round, every agent's activity state changes (thinking → talking → reflecting).

### Animation
- [ ] Walk cycle, idle breathe, talk-gesture, nod, shake-head, shrug, laugh all play correctly.
- [ ] Speakers face each other during conversation.
- [ ] News events trigger a camera beat.
- [ ] Opinion changes ripple with a tinted ring and persistent ring color update.

### Player Integration
- [ ] WASD/arrows move the player at 160 px/s; mobile virtual joystick works.
- [ ] Standing within 80 px of an NPC shows the press-E prompt + blue glow.
- [ ] E (or tap) opens a chat panel whose header shows the agent's sprite portrait.
- [ ] Auto-mode chat runs 5 natural turns without user input.
- [ ] Listen button plays the response via ElevenLabs.
- [ ] After 3 chats with an agent, their tone visibly warms (or cools) per trust math.
- [ ] Journal records every chat with timestamp + transcript.

### Onboarding
- [ ] User can pick from 6 player sprites + 4 outfits.
- [ ] Greeting lines reference the user's name and town.
- [ ] First-visit tutorial appears once and is dismiss-able.
- [ ] "Reset profile" works.

### Lighting & Weather
- [ ] Day-night cycle progresses smoothly; lampposts light up at night.
- [ ] At least one weather pattern (rain or snow) renders correctly.

### Performance
- [ ] 60 FPS sustained on a 2020 MacBook Air with 26 agents + 4 ambient NPCs on screen.
- [ ] Bundle size < 2 MB JS + 5 MB assets.

### Bugs
- [ ] All §0 bugs verified fixed.
- [ ] No console errors during a full QA walkthrough.

---

## Closing Note

The current Township is already a **strong** prototype — solid backend architecture, a thoughtful design system, real agent personas, and a working Phaser town with ambient life. What it needs to become **outstanding** is **specificity**: specific buildings for specific towns, specific sprites for specific agents, specific routines for specific lives, specific gestures for specific feelings. Every piece of this plan is in service of that single principle.

When all phases land, a user walking into Dover at 8 AM on April 10, 2026 should see Carlos opening La Finca's shutters while Maria's bus pulls into Dover Station; should hear distant church bells from St. Mary's and salsa music drifting from the bodega; should walk up to Esperanza on her bench and have a real conversation in her real voice about her real ACA premium; and should feel — *for the first time in any civic visualization* — what it might mean to actually *meet* the electorate. That is the goal.
