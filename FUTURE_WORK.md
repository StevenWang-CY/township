# Township — Future Work & Team Collaboration Items

Items that require team effort, external assets, or runtime testing beyond what can be built in a single coding session.

---

## 1. Phaser.js Tilemap Assets (TEAM PRIORITY)

**Current state:** Town views use programmatic Phaser Graphics (colored rectangles, circles, text). This works but lacks the charming pixel-art aesthetic of Stanford's Smallville.

**What's needed:**
- Create 4 town tilemaps in Tiled Editor (each ~40x30 tiles, 32x32px per tile)
- Download/create a tileset sprite sheet (RPG Maker MV style or similar)
  - Recommended free sources: itch.io (search "top-down RPG tileset"), OpenGameArt.org
  - Minimum assets: grass, road, buildings (various), trees, water, fences, signs
- Export maps as JSON from Tiled (Phaser 3 compatible format)
- Create character sprite sheets (4-direction walk animation, 32x48px per character frame)
  - 26 distinct characters or at minimum 8-10 base sprites with color variations
  - Can use RPG Maker MV character generator or Libresprite

**Town map guidelines:**
- **Dover:** Dense small-town feel. Blackwell St as main horizontal road. Train station on left, church upper-right, businesses along main street, residential areas at edges, factory in background.
- **Montclair:** More spread out, upscale. Bloomfield Ave as wide commercial strip. Art museum, park with trees, mixed residential, transit station.
- **Parsippany:** Corporate suburban. Office park buildings, wide roads, strip mall with Indian restaurants, temple, lake area, residential subdivisions.
- **Randolph:** Affluent suburban. Large lots, school campus, sports fields, park, diner, town hall, church.

**Files to create:**
```
frontend/public/assets/
├── tilesets/
│   ├── town-tileset.png          # Main tileset sprite sheet
│   └── town-tileset.json         # Tileset metadata
├── maps/
│   ├── dover.json                # Tiled JSON export
│   ├── montclair.json
│   ├── parsippany.json
│   └── randolph.json
├── characters/
│   ├── carlos.png                # Character sprite sheets
│   ├── maria.png
│   └── ... (26 total)
└── ui/
    ├── speech-bubble.png
    └── opinion-indicators.png
```

**How to integrate:** The `TownScene.ts` file has a `loadTilemap()` method that's ready to accept Tiled JSON maps. Replace the programmatic drawing with tilemap layers once assets are ready.

---

## 2. ElevenLabs Voice Integration

**Current state:** Chat is text-only.

**What's needed:**
- ElevenLabs API key
- Select 6-8 voice IDs that match agent demographics:
  - Carlos (Colombian accent, warm male voice)
  - Maria (Puerto Rican, energetic female)
  - Esperanza (elderly Dominican, gentle female)
  - Raj (Indian-accented English, professional male)
  - Mike Brennan (standard American, authoritative male)
  - Rosa Chen (elderly Taiwanese-American, soft female)
- Implement in `ChatPanel.tsx`:
  ```typescript
  const playVoice = async (text: string, voiceId: string) => {
    const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, {
      method: 'POST',
      headers: { 'xi-api-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_monolingual_v1' })
    });
    const audioBlob = await response.blob();
    new Audio(URL.createObjectURL(audioBlob)).play();
  };
  ```
- Add a "Listen" button next to each agent response in the chat

**Cost estimate:** ~$0.30 per 1000 characters. Budget for demo: ~$2-3.

---

## 3. Pre-computed Simulation Cache

**Current state:** Simulation runs live via API. For demo reliability, we need a cached version.

**Steps:**
1. Run the full simulation: `POST /api/simulation/start` (ensure ANTHROPIC_API_KEY is set)
2. Wait for completion (~2-5 minutes for 26 agents, 5 rounds)
3. The backend auto-saves to `data/simulation_cache.json`
4. For demo: `POST /api/simulation/replay` streams cached events through WebSocket
5. Test replay 3 times to ensure consistency

**Important:** Run this AFTER all 26 agent personas are finalized. Any persona changes require re-running.

---

## 4. Cross-Town Gossip Tuning

**Current state:** Cross-town gossip in Round 3 uses random pairs. Could be more strategic.

**Improvements to consider:**
- Pair agents with shared concerns across towns (e.g., Carlos in Dover + Raj in Parsippany both worry about healthcare costs)
- Create "connection stories" — why would these two people know each other? (kids at same community college, shop at same Indian grocery, met at a regional church event)
- Weight gossip by issue relevance, not just random

**File to modify:** `backend/simulation/round_manager.py` — `_create_cross_town_pairs()` method

---

## 5. God's View Scenario Library

**Current state:** God's View accepts free-text input. Pre-filled suggestions exist but are basic.

**Create a curated library of scenarios with expected impacts:**
```json
[
  {
    "name": "ICE Enforcement in Dover",
    "description": "ICE conducts a workplace enforcement operation at a Dover restaurant, detaining 3 workers.",
    "expected_impact": "Dover agents shift strongly toward Mejia. Randolph agents may shift toward Hathaway on 'law and order'. Parsippany split.",
    "category": "immigration"
  },
  ...
]
```

Save to `data/god_view_scenarios.json`. The GodsView component can load these as clickable preset cards.

---

## 6. Mobile Responsiveness

**Current state:** Desktop-first layout. Dashboard and TownView need mobile adaptation.

**Key changes needed:**
- Dashboard: stack town columns vertically on mobile
- TownView: Phaser canvas scales to viewport, chat panel becomes bottom sheet
- DistrictMap: town pins stay tappable at mobile sizes
- Add viewport meta tag (already present)

---

## 7. Deployment

**For demo:**
- Backend: `uvicorn backend.main:app --host 0.0.0.0 --port 8000`
- Frontend: `cd frontend && npm run build`, serve from FastAPI static files or `npx serve dist`
- Environment: `ANTHROPIC_API_KEY` must be set

**For public deployment (post-hackathon):**
- Backend: Deploy to Railway/Render/Fly.io
- Frontend: Deploy to Vercel/Netlify
- Add rate limiting to prevent API abuse
- Add WebSocket connection limits

---

## 8. Additional Agent Personas (Optional Expansion)

The 26-agent set covers the district's key demographics. To deepen coverage:
- Add 2-3 agents per town for a total of ~36
- Cover: K-12 teachers, healthcare providers, small landlords, retail workers, religious leaders (beyond Rabbi Goldstein), college students, new immigrants (< 2 years)
- Each new agent: create .md file in `agents/{town}/`, no code changes needed

---

## 9. Real-Time Election Data Feed

**Post-hackathon enhancement:**
- Connect to NJ election board API for live results on April 16
- Feed real voting data into God's View as events
- Compare simulation predictions with actual results
- This is the "accountability moment" — did the swarm intelligence predict anything correctly?

---

## Priority Order for Hackathon

| Priority | Item | Who | Time Est. |
|----------|------|-----|-----------|
| P0 | Tilemap assets (even basic ones) | Artist/designer | 2-3 hrs |
| P0 | Pre-compute simulation cache | Backend dev | 30 min |
| P1 | ElevenLabs integration | Frontend dev | 1 hr |
| P1 | God's View scenario library | Content person | 1 hr |
| P2 | Mobile responsiveness | Frontend dev | 1 hr |
| P2 | Cross-town gossip tuning | Backend dev | 30 min |
| P3 | Deployment | DevOps | 1 hr |
