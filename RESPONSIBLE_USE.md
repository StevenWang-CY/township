# Responsible Use

## Why this document

Township simulates political deliberation with AI agents, and its flagship
scenario revisits a real election. AI-generated election content can mislead
people even when nobody intends it to: a simulated town that "votes" looks a
lot like a poll, and a synthetic resident with a name, a job, and worries
looks a lot like a person. We built Township because agent simulation is a
genuinely useful lens on how communities deliberate — and we would rather
over-explain what it is than let anyone mistake it for something it isn't.

One honest caveat up front: Township is MIT-licensed, and the MIT license
imposes no use restrictions. This document is not a license amendment. It is
the project's public statement of which uses we endorse, which we condemn, and
which design choices we hold ourselves to.

## What Township is — and is not

Township is a **deliberation simulator**: a research and education tool for
watching how opinions form, spread, and shift when AI agents with distinct
backgrounds, incomes, and worries talk to each other about a shared civic
question.

Township is **not**:

- **Not a poll.** Nothing it produces measures what real voters think.
- **Not a forecast.** Simulated residents reaching a conclusion says nothing
  about what a real electorate will do.
- **Not a persuasion tool.** It exists to make deliberation visible, not to
  discover what message moves which demographic.

## The disclaimer

This block ships with Township — in the UI, in exported outputs, and in every
scenario. Other documents embed it verbatim; if you fork or deploy Township,
keep it visible.

> **Township is a simulation, not a poll.** Its outputs do not measure real public opinion and must never be presented as if they do.
> **The residents are fictional composites**, informed by public demographic data. No real resident is depicted.
> **The candidates are real public figures**; their positions are quoted from cited public sources, not invented.
> **Every output is an LLM artifact**, shaped by who wrote the personas and by the model's own biases.

## Intended uses

- **Education and civics classrooms** — watching a town argue about a budget
  is a better civics lesson than a diagram of one.
- **Deliberation and opinion-dynamics research** — a reproducible sandbox for
  studying how framing, network structure, and news events shift agent
  opinions.
- **Media-literacy demonstrations** — showing an audience how convincing
  synthetic "public opinion" looks is one of the best inoculations against it.
- **Journalism prototyping** — exploring how a story or policy question might
  land across different communities, before (never instead of) real reporting.
- **Game and agent development** — a working, documented multi-agent town to
  build on.

## Prohibited uses

We will publicly and unambiguously condemn any use of Township for:

- **Voter microtargeting or persuasion-campaign optimization** — using
  simulated residents to tune messaging aimed at real voters.
- **Astroturfing or sockpuppet content generation** — publishing agent output
  as if it came from real people, anywhere, in any volume.
- **Presenting outputs as real polling or predictions** — in journalism,
  campaign material, social media, or anywhere else.
- **Impersonating real private individuals** — building a persona around an
  identifiable non-public person, with or without their name attached.
- **Election-eve influence operations** — deploying simulated content about a
  live election timed to when real people are voting.
- **Harassment** — personas or outputs that target, demean, or caricature any
  real person or community.

## Design commitments

These are decisions built into the project, not aspirations:

1. **Residents are always fictional.** Every persona is a composite informed
   by public demographic data. Contributions depicting real private
   individuals are rejected in review, full stop.
2. **Real people appear only as sourced public figures.** Candidates and
   officials enter a scenario with their positions quoted from cited public
   sources — never invented, never put in fabricated conversations with
   "constituents" presented as real.
3. **Disclaimers ship in the product.** The disclaimer block above appears in
   the UI and accompanies simulation outputs. It is not buried in a README.
4. **The flagship real-election scenario is retrospective.** The NJ-11 special
   election scenario was published only after the April 2026 results were
   certified, alongside an honest error analysis of where the simulation
   diverged from reality. We simulate real elections to study deliberation
   after the fact — not to influence one in progress.

## Known limitations

Take every output with all of the following in mind:

- **Demographic bias.** LLMs are trained on WEIRD-skewed data and render some
  communities in far higher fidelity than others. A simulated Dover
  restaurant owner is a model's idea of one.
- **Sycophancy.** LLM agents agree too easily; simulated deliberation drifts
  toward consensus faster than real rooms do.
- **Author bias.** Personas encode their authors' assumptions. Ours are
  written with care, and they are still one team's portrait of four towns.
- **Small N.** Twenty-six residents is a stage-play cast, not a sample. No
  statistic derived from them means anything about a population.
- **No turnout model.** Township simulates people talking, not people voting.
  Deliberation outcomes are not vote shares.
- **Prompt sensitivity.** Small changes in persona or scenario wording can
  shift outcomes. Treat any single run as one telling of a story.

## Reporting misuse

If you see Township used in ways this document prohibits — a fake poll, an
astroturfing operation, a persona of a real private person — we want to know.
Report privately via [GitHub security advisories](https://github.com/StevenWang-CY/township/security/advisories/new)
for anything sensitive, or open a [GitHub issue](https://github.com/StevenWang-CY/township/issues)
for anything public. We will respond, and where warranted, respond publicly.
