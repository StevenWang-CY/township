# Writing a resident — the persona authoring guide

Every resident in Township is one Markdown file: YAML frontmatter that the engine
reads as data, and a markdown body that becomes the agent's system prompt, verbatim.
No code, no registration step. Drop a file into a scenario's `agents/` tree and the
town has a new voice.

This guide covers the anatomy (what every field does and how the engine uses it),
the craft (what separates a resident people quote from a demographic with a name),
the ethics rules, and the submission checklist. A complete annotated example lives
in [`persona-template.md`](persona-template.md) — it passes the lint if you drop it
into `scenarios/millbrook-budget/agents/harlow-crossing/`.

## Quick start

```bash
# Scaffold a skeleton with valid frontmatter for the scenario's stances
township new-agent millbrook-budget harlow-crossing --name "Priya Nair"

# ...write the persona (this guide), then check your work:
python3 -m pytest tests/test_persona_lint.py -q

# Watch them live, no API keys needed:
township serve --scenario millbrook-budget --provider mock   # then, in another shell:
make sim

# Or headless, straight to a recap:
township run --scenario millbrook-budget --provider mock
```

## Anatomy of a persona

Files live at `scenarios/<scenario-id>/agents/<town-id>/<role-slug>.md` — the
filename is a descriptive role slug by convention (`colombian-restaurant-owner.md`,
`night-shift-nurse.md`); the agent's actual identity comes from the `name` field.
The loader (`backend/core/agent_loader.py`) parses each file into an
`AgentDefinition` (`backend/core/types.py`), and the orchestrator derives the agent
id from the name: lowercase, spaces to hyphens, dots stripped — `"Carlos Restrepo"`
becomes `carlos-restrepo`. Other files refer to your resident by that slug or by
the display name.

### Frontmatter reference

Required fields — the loader fails loudly if any is missing:

| Field | Type | What it does |
|---|---|---|
| `name` | string | Display name. The agent id is derived from it (see above). |
| `town` | string | Must match both the directory the file sits in and a `towns/<town-id>.json` manifest. The lint checks both. |
| `description` | string | One line for roster cards and dashboards. Lead with the tension, not the résumé. |
| `age` | int | Part of the roster card and the model's self-image. |
| `occupation` | string | Same. |
| `household` | string | Who depends on them. Ground it in specifics — names, ages, jobs. |
| `income_bracket` | string | e.g. `~$85k household`. Money is where civic questions get personal. |
| `language` | string | e.g. `Spanish primary, functional English`. Pair it with voice instructions in the body. |
| `political_registration` | string | Free-form — each scenario defines its own registrations. |
| `initial_lean` | string | Must be one of the scenario's stance ids: its `options[].id` values plus `undecided` (from `scenario.json`). The lint rejects anything else; at the wire layer an unknown lean is coerced to `undecided` rather than crashing the frontend. |
| `top_concerns` | list of strings | Three to five, concrete and personal. When two agents converse, the topic is drawn from the concerns they *share* (falling back to the union) — overlap with neighbors is a feature, not repetition. The first three also seed the resident's pre-simulation roster opinion. |

Optional fields with defaults:

| Field | Default | What it does |
|---|---|---|
| `tools` | `[Discuss, FormOpinion, ReactToNews]` | The tool set exposed to the model. Leave it alone unless you know why. |
| `model` | `claude-sonnet-4-5` | Per-agent model override. |

And the four optional living-world fields, which older personas simply omit
(they fall back to empty). These are where a resident stops being a survey
respondent and starts being someone you can watch:

#### `goals` — a per-round arc, injected into the prompt

```yaml
goals:
  round_0: "Get the actual platform documents. Read them like an after-action review."
  round_1: "Talk to Tom Kowalski at the VFW post — what do Dover vets see I don't?"
```

Each simulation round, the engine looks up `round_<n>` and appends it to the
agent's system prompt under a `YOUR GOAL THIS ROUND` heading
(`backend/simulation/round_manager.py`, `_build_agent_system_prompt`). Written
well, goals give a resident an arc — investigate, consult, test, decide — instead
of five identical rounds. Match the keys to the scenario's `round_plan` (the
millbrook-budget plan runs rounds 0–4, with news landing in rounds 1–3), and aim
the middle goals at the news beats the resident will actually see.

#### `routine` — where they are, hour by hour

```yaml
routine:
  - { time: "08:00", location: "La Finca Restaurant", activity: "Opens La Finca, preps stocks and arepa dough" }
```

The routine ships to the frontend on the agent's wire DTO and drives movement in
the pixel town: the Phaser scene checks the world clock against the routine and
walks the sprite to each landmark as its hour arrives
(`frontend/src/game/Routine.ts`, `TownScene.tickRoutines`). `location` must name a
landmark from the town's `towns/<town-id>.json` — unrecognized locations are
simply skipped by the scene, and the lint requires that at least 80% of a
scenario's routine locations resolve. The slack is deliberate: an off-map prose
location (a hospital in the next city, a train to campus) is fine texture, in
moderation. Agents without a routine wander randomly, which reads as exactly that.

#### `relationships` — the structured half of the web

```yaml
relationships:
  - { agent: "tom-kowalski", type: "friend", strength: 0.7, context: "Regular customer for 14 years — always pollo a la plancha, no rice, extra plantains, 20% tip" }
```

The `agent` target may be a slug (`tom-kowalski`) or a display name
(`Tom Kowalski`) — the engine's name lookup handles both, and the lint accepts
both. What the lint rejects is a target that matches no agent in the scenario at
all. Use `strength` roughly as: 0.3 acquaintance, 0.5 solid, 0.7+ close. The
`context` string is where the texture lives — make it a fact, not a category.

Two things to know about how relationships are consumed. First, the structured
entries ship to the frontend with the agent roster; they are the map of the town's
social graph. Second — and this matters — the model itself reads the *body*, not
the frontmatter. Narrate every relationship in prose too (see
[Relationship webs](#relationship-webs) below). Cross-town encounters are a
separate mechanism: the scenario's `scenario.json` declares `cross_town_pairs`
matched by display name, with unmatched agents paired by chance at the scenario's
`cross_town_meeting_place`. If your resident should have a guaranteed cross-river
scene, that's a scenario-file change to propose alongside the persona.

#### `idle_thoughts` — the ambient interior monologue

```yaml
idle_thoughts:
  - "Bridge posted at eight tons. Engine 2 weighs nineteen. Do the math the town keeps not doing."
```

While a resident wanders the town between simulation beats, the Phaser scene
occasionally floats one of these as a speech bubble — preferring the agent's
personal bank over the generic pool (`TownScene.scheduleWander`). No LLM call is
involved; these are pure characterization, and they are the fastest way to hear
whether a voice works. Seven to twelve lines is the sweet spot.

### The body: the system prompt

Everything below the frontmatter's closing `---` is passed to the model verbatim
as the base of the agent's system prompt. Write it in second person — "You are
Carlos Restrepo, age 51." At simulation time the engine appends, in order: the
scenario context block, the agent's ten most recent memories, their current stance
and confidence, the round goal, and a standing instruction to stay in character,
reference specific local places and people, and admit confusion when torn
(`_build_agent_system_prompt` in `backend/simulation/round_manager.py`).

That instruction can only cash out what you put in the body. The strong bodies in
the shipped scenarios all cover, in roughly this order: history and material
stakes, voice mechanics, the honest case for their lean, the honest case against
it, and the social web plus media diet, closing on the emotional register in a
single line. Four to seven paragraphs. Study
`scenarios/nj11-2026/agents/dover/colombian-restaurant-owner.md` and
`scenarios/nj11-2026/agents/randolph/retired-veteran.md` — they are the house
exemplars, and the rest of this guide quotes them.

## The craft

### Voice: mechanics, not adjectives

"Speaks with a slight accent" gives the model nothing. Repeatable mechanics —
filler words, sentence length, code-switching triggers, forms of address, what
they *don't* say — give it everything. Carlos Restrepo:

> You are friendly and talkative with customers but guarded about politics —
> talking politics in a restaurant loses you customers. You switch between Spanish
> and English mid-sentence without noticing. You say "mira" and "bueno" as filler
> words, call everyone "hermano" or "mi amor." Your English is functional but you
> stumble on complex political vocabulary, which frustrates you because you
> understand more than you can express.

Every clause is an instruction the model can execute, and the last one is the best
kind: a *limitation* that produces behavior (reaching for words, frustration,
switching to Spanish). Frank DeLuca's voice is built the same way from opposite
parts:

> You speak with the economy of a career officer. You do not waste words.
> Sentences are short. Points are direct. You say "affirmative" instead of "yes"
> when you are being emphatic, and "negative" instead of "no" when you are being
> final. You call people "son" regardless of their age, which some find
> patronizing and others find comforting.

Notice the paragraph *demonstrates* the register it describes. Then hold your
voice against its nearest neighbor: millbrook's Dana Whitcomb also speaks in
clipped professional shorthand, but hers is fire-radio brevity ("copy that,"
"that's the call") where Frank's is parade-ground formality. Two clipped voices,
zero confusion. The working test, straight from the PR checklist: put your
resident's idle thoughts next to their closest neighbor's — if you could swap the
names, keep writing.

### Genuine ambivalence beats flat advocacy

The engine lets agents change their minds; a resident who is a walking press
release produces transcripts nobody reads. The most watchable residents are pulled
in two directions by facts from their own lives. Carlos again:

> You are deeply torn about this election. Mejia's promise to abolish ICE speaks
> to your gut — in 2023, ICE picked up a father of three from the laundromat on
> Dickerson Street and his wife did not know where he was for eleven days. That
> haunts you. But Hathaway's tax talk hits you every time you write a check to
> Morris County.

Both pulls are concrete, local, and his. Even *decided* residents need friction —
it's what makes their certainty legible instead of cartoonish. Frank supports
Hathaway "clearly and without reservation," and still:

> Not because you agree with him on everything — his Yale pedigree and his Chris
> Christie background are not your world —

and, from his idle thoughts: *"Christian nationalist undercurrent worries me. I
will not say it aloud at Rotary."* A conviction with a crack in it is a character;
a conviction without one is a pamphlet. Rule of thumb: every persona carries at
least one hard fact that argues against their own lean, held honestly.

### Concrete anchors

Vague worries produce vague deliberation. Numbers, dates, and named places give
the model something to argue *with*: Carlos's ACA premium is $1,400 a month and
would be $2,800 without the subsidy; the sidewalk outside La Finca has been
cracked for three years; the lease went up 12%. Dana Whitcomb's entire case is
"the bridge is posted at eight tons, Engine 2 weighs nineteen, the detour is
eleven minutes, a room fire doubles every sixty seconds."

Anchor to the town's actual landmarks — they exist in `towns/<town-id>.json`, they
render on the map, and your routine can walk through them. Anchor to other
residents by name. Invented specifics are fine (this is fiction); *unanchored*
specifics are not, because nothing else in the simulation can touch them.

### Relationship webs

Residents deliberate with their neighbors, so a persona with no web has no one to
deliberate with. Three rules:

1. **Targets must resolve.** Name-or-slug, per the lint — see the
   [`relationships`](#relationships--the-structured-half-of-the-web) reference above.
2. **Relationships are bidirectional.** If your resident knows Tom Kowalski, Tom's
   file gets a matching entry in the same PR. The PR template checks for this.
3. **Narrate every relationship in the body, on both sides.** The frontmatter is
   for the engine and the lint; the prose is what the model actually reads.

The gold standard is the same fact seen from two heads. Carlos's frontmatter:
*"Regular customer for 14 years — always pollo a la plancha, no rice, extra
plantains, 20% tip"* — and his body: "You consider him a good man." Cross the
river to millbrook and watch Dana and Walt share one furnace filter. Dana's idle
thought: *"Walt's furnace filter is due. He'll say he already did it. He didn't.
Bring the good flashlight."* Walt's: *"Dana will be by about the furnace filter. I
already did it. (I did not.)"* That's a relationship — two files, one truth, two
voices.

Disagreement belongs in the web too. Frank DeLuca and his landscaper Tony Mancini
argue politics at the curb over beers, "arguments, beers, mutual respect across
party lines" — cross-lean friendships are where the interesting conversations
happen, and a town where everyone's friends agree with them deliberates like a
group chat.

## The ethics rules

Read [`RESPONSIBLE_USE.md`](../RESPONSIBLE_USE.md) before writing anyone. The
non-negotiable, quoted from its design commitments:

> **Residents are always fictional.** Every persona is a composite informed
> by public demographic data. Contributions depicting real private
> individuals are rejected in review, full stop.

In practice:

- **No real private individuals** — not by name, and not by recognizable
  portrait. If a real person in that town could read your persona and see
  themselves, start over. If the name matches a real person in that town, pick
  another.
- **Real public figures never become residents.** Candidates and officials enter
  a scenario only as sourced scenario data, with positions quoted from cited
  public sources — never as agents, never in invented conversations.
- **Portraits, not caricatures.** You are writing someone else's neighbor.
  Composite from public demographic data (the shipped towns' `demographics`
  blocks are the pattern), write with empathy, and give the resident the same
  interior complexity you'd want in a portrayal of your own community. Personas
  that demean or caricature a community are a prohibited use, not a style
  problem.
- The new-persona issue template asks you to affirm all of this explicitly —
  it's not boilerplate; reviewers hold submissions to it.

## Submission checklist

The persona lint (`tests/test_persona_lint.py`) enforces the first five; the PR
template asks about the rest. Run `python3 -m pytest tests/test_persona_lint.py -q`
— or `make test` for the full suite — before opening the PR.

- [ ] Frontmatter parses: all required fields present (the loader fails loudly on
      a missing key)
- [ ] `initial_lean` is on the scenario's stance roster (option ids + `undecided`)
- [ ] `town` matches the directory the file lives in, and that town has a
      `towns/<town-id>.json`
- [ ] Every `relationships` target resolves to a real agent in the scenario
      (display name or slug)
- [ ] Routine locations name real landmarks from the town file (the lint requires
      ≥80% scenario-wide; aim for all, spend the slack deliberately)
- [ ] Relationships are bidirectional — every referenced resident references
      yours back, in frontmatter and in prose
- [ ] The voice survives the swap test against its nearest neighbor
- [ ] The persona carries at least one honest fact against its own lean
- [ ] Fictional composite, no real private individual, written with empathy
- [ ] You've watched them run: `township run --scenario <id> --provider mock`

Best first step of all: open a [new persona issue](../.github/ISSUE_TEMPLATE/new_persona.yml)
and pitch the resident in a paragraph before writing the file. It's the
lowest-effort way to find out what gap the town actually needs filled.
