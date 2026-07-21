# NJ-11 retrospective: the simulation next to the certified results

In April 2026, New Jersey's 11th congressional district held a special election.
Township's flagship scenario puts 26 AI residents of four of its towns — Dover,
Parsippany, Randolph, Montclair — through five rounds of deliberation about that
race. The results are now certified. This page is the honest side-by-side: what
a persona-grounded deliberation simulation got right, what it got wrong, and why.

Everything below is governed by [RESPONSIBLE_USE.md](../RESPONSIBLE_USE.md):

> **Township is a simulation, not a poll.** Its outputs do not measure real public opinion and must never be presented as if they do.
> **The residents are fictional composites**, informed by public demographic data. No real resident is depicted.
> **The candidates are real public figures**; their positions are quoted from cited public sources, not invented.
> **Every output is an LLM artifact**, shaped by who wrote the personas and by the model's own biases.

This is an error analysis, not a validation. The simulation was never a
prediction instrument, and nothing here should be read as "it nearly called the
race." The narrower question: ground LLM agents in authored personas and real,
cited campaign material — *which features of a real electorate's behavior show
up anyway, and which are structurally invisible?*

## TL;DR

- **Direction, everywhere.** The simulation never had Hathaway ahead in any town. Its blowout town (Montclair, 6–1) was the real blowout (87.3–12.0); its most contested town was the real nail-biter.
- **Randolph — the race's genuine cliffhanger (52.9–46.7, and Hathaway's own hometown) — was the only town the sim left split**: 2 Mejia, 2 Hathaway, 2 undecided at close.
- **Magnitude overshot.** District-wide the sim landed at 73.1% Mejia against a certified 60.18% — roughly 13 points high, most plausibly because the persona roster over-samples compelling-tension archetypes and under-samples the suburban Republican base, and because the sim has no turnout model at all.

## The race

The special election for New Jersey's 11th district was held on April 16, 2026.
Certified results ([NJ Division of Elections, official list dated May 14, 2026](https://nj.gov/state/elections/assets/pdf/election-results/2026/2026-official-special-general-results-us-house-11cd.pdf)):
**Analilia Mejia (D) 81,825 votes (60.18%)**, Joe Hathaway (R) 53,520 (39.36%),
independent Alan B. Bond 625 (0.46%), on 135,970 total votes. Turnout was 23% —
136,544 ballots from 599,611 registered voters
([official turnout report](https://nj.gov/state/elections/assets/pdf/election-results/2026/2026-special-general-election-voter-turnout.pdf)) —
in a compressed off-cycle race. Per [Wikipedia's certified-matching summary](https://en.wikipedia.org/wiki/2026_New_Jersey%27s_11th_congressional_district_special_election),
it was the best Democratic performance in the district since 1982. Mejia had won
a crowded February primary 29–28 over Tom Malinowski — a contest in which AIPAC
spent over $2M against Malinowski while backing a third candidate
([NJ Globe](https://newjerseyglobe.com/congress/analilia-mejia-wins-nj-11-special-keeping-sherrills-seat-in-democratic-hands/)).

The dynamics matter more than the topline. Democrats built what NJ Globe called
an essentially insurmountable mail and early-vote lead. Hathaway, a Randolph
councilman and former mayor, **lost his own hometown** 52.9–46.7; his concession
blamed the compressed schedule and low turnout, and promised a November rematch
([Morristown Green](https://morristowngreen.com/2026/04/16/mejia-wins-11th-district-in-landslide-hathaway-looking-forward-to-the-rematch-in-november/)).
NJ Globe's swing analysis (single source) has Mejia overperforming Harris's 2024
nine-point district margin by ~12 points, dominating majority-minority towns
while heavily Jewish areas swung against her. Bond, excluded from the race's
only debate ([NJ Globe](https://newjerseyglobe.com/congress/independent-alan-bond-responds-to-nj-11-congressional-debate/)), drew 52 votes in his home town of Montclair.

## The simulation

Township's engine ([architecture.md](architecture.md), `backend/simulation/round_manager.py`)
walks each town through five phases per the scenario's round plan: **seed**
(full briefing — every candidate's positions, endorsements, debate excerpts —
then an initial opinion), **converse** (random in-town pairs, three-exchange
conversations at town landmarks), **news** (beats injected, each agent reacts),
**opinion** (reflect on the ten most recent memories, re-form the stance),
**decide**. Opinions arrive only via a typed `FormOpinion` tool call whose
candidate enum *is* the ballot — stance, confidence, reasoning, top issues,
optional dealbreaker. Towns run in parallel; cross-town gossip carries takeaways
between them (52 events this run). Each of the 26 agents is a hand-authored
Markdown persona — occupation, income, worries, and what would change their
mind ([persona-authoring.md](persona-authoring.md)).

What the model saw: the [scenario package](../scenarios/nj11-2026/) — candidate
positions and debate excerpts quoted from cited public sources, town
demographics, and three mid-run news beats (ACA subsidies at risk in the One Big
Beautiful Bill; increased ICE enforcement in Morris County; a property tax
reassessment). All of it reflects the race as of early April 2026. No polls, no
returns, no post-election information appears in any persona or context file.

### What this run is and isn't

The run shipped in [`scenarios/nj11-2026/demo/`](../scenarios/nj11-2026/demo/simulation_cache.json)
was executed on **July 21, 2026 — three months after the election** — as a
re-run of the pre-election methodology: 26 agents, 5 rounds, Claude Sonnet 4.6
via AWS Bedrock, 405 LLM calls, ~1.5M tokens, $7.33, zero failed agents. The
original hackathon runs happened before election day, but they are not the
shipped artifact. So: the prompts contain only pre-election information, but
**this is not a sealed pre-registration**, and we cannot rule out that the
model's training data includes coverage of the outcome. We publish the
comparison anyway: the honest version of this exercise beats a stronger claim we
can't support, and the errors below are the kind no leaked headline would produce.

## Results side by side

Simulated stances are agent counts (n = 26); certified results are real votes
(n = 135,970) — not the same kind of thing. Δ is sim Mejia share minus certified.

| Contest | Simulation — agents (share) | Certified — votes (share) | Δ Mejia |
|---|---|---|---|
| **District** | Mejia 19 (73.1%) · Hathaway 5 (19.2%) · Bond 0 (0.0%) · undecided 2 (7.7%) | Mejia 81,825 (60.18%) · Hathaway 53,520 (39.36%) · Bond 625 (0.46%) | +12.9 |
| Dover | Mejia 6 (100%) · Hathaway 0 (0%) | Mejia 920 (72.1%) · Hathaway 352 (27.6%) | +27.9 |
| Parsippany–Troy Hills | Mejia 5 (71.4%) · Hathaway 2 (28.6%) | Mejia 4,695 (58.3%) · Hathaway 3,302 (41.0%) | +13.1 |
| Randolph | Mejia 2 (33.3%) · Hathaway 2 (33.3%) · undecided 2 (33.3%) | Mejia 3,254 (52.9%) · Hathaway 2,873 (46.7%) | −19.6 |
| Montclair | Mejia 6 (85.7%) · Hathaway 1 (14.3%) | Mejia 6,711 (87.3%) · Hathaway 926 (12.0%) | −1.6 |

Sim figures come from the shipped run's `district_summary` (its `prediction`
field is nothing more than these agent shares). Certified town figures:
[Morris County Clerk official municipality report](https://www.morriscountyclerk.org/files/sharedassets/clerk/v/6/elections/past-results/2026-special-general-municipality-report-official.pdf);
Montclair from [Essex County Clarity precinct data](https://results.enr.clarityelections.com/NJ/Essex/126073/web.345435/#/summary), whose aggregation reproduces the certified Essex totals exactly.

## What the simulation got right

**Direction everywhere, and the ordering between towns.** Hathaway never led
anywhere; Montclair was the sim's blowout and reality's; Randolph was the sim's
only town without a Mejia majority and reality's closest. Bond converted zero
agents, against a real 0.46%.

**Randolph as the contested town — for recognizable reasons.** The sim's
Randolph closed 2–2–2, arguing along the race's actual fault lines. Its Hathaway
anchor talked local fiscal texture, not abstraction: *"Look, I'm backing
Hathaway too, though for me it's honestly the SALT cap and Gateway Tunnel…"*
(Mike Brennan, finance director). Its most dramatic arc was Frank DeLuca, a
retired Army colonel who opened at Hathaway/85 and ended undecided/35: *"I
cannot support Mejia's progressive agenda that undermines institutions and
fiscal stability. Bond is a felon. But Hathaway's support for the One Big
Beautiful Bill … shows his 'moderation' is branding, not principle. I've spent
four rounds waiting for evidence he'll stand up to Trump on policy that matters.
I'm still waiting."* Randolph-Republican softness is exactly what the certified
result shows — though the sim surfaced a mechanism consistent with it rather than predicting it.

**Texture that matches reported dynamics.** The sim's lone Montclair holdout for
Hathaway was Rabbi Daniel Goldstein (final confidence 52) — an unplanned echo of
NJ Globe's finding that heavily Jewish areas swung toward Hathaway. Dover's
deliberation ran on lived stakes and earned distrust, not party labels: *"I
worry… if something happens to me, what happens to them? They are citizens, born
here, but I am not…"* (Miguel Hernandez); *"I've watched Democrats promise
immigration reform my entire life and deliver nothing but deportations and
anxiety"* (Sofia Ramirez, forming her first opinion at confidence 35).

## What it got wrong — and why

**A ~13-point Mejia overshoot district-wide, worst in Dover (+27.9).** Three
mechanisms, in decreasing order of confidence:

1. **Roster composition.** Personas were written to be interesting — service
   workers, immigrants, healthcare-anxious retirees, cross-pressured
   small-business owners. Compelling-tension archetypes skew toward voters with
   concrete, quantifiable stakes in Democratic policy (a $1,400/month ACA
   premium, an ICE raid on your street) and under-sample the ordinary suburban
   Republican base that cast 39% of real votes. Even the sim's small-business
   owners resolved their tension leftward: *"that $25 minimum wage thing keeps
   me up at night too, and I'm voting for Mejia"* (Tony Mancini, landscaper,
   Randolph). A 26-persona cast is an editorial act, made before the first token is sampled.
2. **No turnout model — at all.** Township simulates people talking, not people
   voting. Dover is the cleanest demonstration: the sim's 100%-Mejia town voted
   72.1% Mejia on **14.72% turnout** — 1,293 ballots from 8,784 registered — the
   lowest of the four towns, while Randolph turned out at 29.97%. A deliberation
   sim sees conviction; it cannot see who shows up, and in a 23%-turnout special
   election, who shows up *is* the result.
3. **Agreeableness drift.** LLM agents agree too readily, and multi-round
   conversation compounds it: across the run's 104 opinion updates, movement ran
   overwhelmingly toward the town's emerging consensus (every Dover holdout
   converged on Mejia by round 4; Frank DeLuca drifted 85→35 without a single
   countervailing pull). Real rooms keep their cranks; simulated ones sand them
   down. See "Sycophancy" in [RESPONSIBLE_USE.md](../RESPONSIBLE_USE.md#known-limitations).

## What would improve it

In rough order of expected payoff: a **turnout layer** (weight each agent's
final stance by likelihood to vote, so a 100%-Mejia low-propensity town stops
reading as a 100% result); a **roster calibrated to registration and past-vote
data** rather than narrative interest, including the base-Republican archetypes
the cast lacks; **adversarial/anchor personas** authored to resist consensus, a
partial counterweight to agreeableness drift; and **larger N over multiple
seeds** — 26 agents is a stage-play cast, one run is one telling, and only
distributions over reruns separate signal from sampling noise.

## Why this matters for the field

The right yardstick for a deliberation simulation is deliberation quality, not
vote-share accuracy — does the simulated town argue about what the real town
argued about, along the real fault lines, for legible reasons? By that yardstick
the interesting results here are Randolph's 2–2–2 split, DeLuca's four-round
erosion, and a rabbi as Montclair's lone holdout — not the 73.1%.
Generative-agent work has shown persona-grounded LLM societies produce
believable emergent social behavior ([Park et al., 2023](https://arxiv.org/abs/2304.03442))
and that interview-grounded agents can match individual humans' survey responses
with useful fidelity ([Park et al., 2024](https://arxiv.org/abs/2411.10109)).
Township runs the complementary, less flattering experiment: hold the
methodology fixed, let reality grade the run, publish the residuals. The
residuals say composition and turnout — who is in the room and who acts —
dominate whatever the deliberation itself gets wrong. That points at where
simulation effort should go next. It is not a license to forecast.

## Reproduce it

Every number above comes from one tracked file:
[`scenarios/nj11-2026/demo/simulation_cache.json`](../scenarios/nj11-2026/demo/simulation_cache.json)
(883 events plus `district_summary` and `usage`). Watch this exact run with
`make demo` (zero-key, mock provider) and the UI's replay — the replay endpoint
resolves the active scenario's demo cache — or with `township replay --demo`.
Re-roll it live with `township run` and a real provider ([deployment.md](deployment.md));
this run cost **$7.33** for 405 calls (~1.5M tokens, ~1.0M of them prompt-cache
writes) on Claude Sonnet 4.6 via Bedrock. Your re-roll *will* differ — treat any
single run as one telling. Quotes are verbatim from the cache; ellipses mark the
replay format's 150-character speech truncation (opinion reasoning is stored in full).
