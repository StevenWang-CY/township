"""
Deterministic influence model — the engine-side ledger of why residents move.

Every resident carries ``Beliefs``: a utility per option, normalised issue
weights, and three traits. Conversations, headlines and gossip push the
utilities by bounded amounts; each push is a ``LedgerEntry`` with a ref
(``conv:<id>``, ``news:<id>``, ``gossip:<id>``) that later becomes the cause
an opinion change cites. The read-out (stance, confidence) is a pure
function of the utilities, so the mock provider can render it verbatim and
a real model's self-attribution can be checked against it.

Constants live at the top; everything below is pure and seedless except
where a ``random.Random`` is passed in.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from backend.core.types import AgentDefinition, AgentState, Ballot, Beliefs, LedgerEntry

# ── Constants ─────────────────────────────────────────────────────────────
ISSUE_RANK_WEIGHTS = [1.0, 0.6, 0.4, 0.25, 0.15]  # by top_concerns rank
SEED_LEAN_BONUS = 0.15  # utility for the persona's declared initial lean
SEED_NOISE = 0.03
PARTY_SAME = 1.0
PARTY_OTHER = -0.4
DEFAULT_PERSUADABILITY_REGISTERED = 0.35
DEFAULT_PERSUADABILITY_UNAFFILIATED = 0.6
UNDECIDED_PERSUADABILITY_BONUS = 0.15
PERSUADABILITY_CAP = 0.8
DEFAULT_LOYALTY_REGISTERED = 0.5
DEFAULT_LOYALTY_UNAFFILIATED = 0.1
DEFAULT_MEDIA_DIET = 0.5
EPS_GAP = 0.9  # bounded confidence: arguments from further away are dismissed
EXCHANGE_GAIN = 0.25
REINFORCE_GAIN = 0.5  # share of Δ applied when speaker and listener agree
NEWS_GAIN = 0.45
GOSSIP_KAPPA = 0.25
CONFIRMATION = 0.8  # pushes away from the current favourite land a little softer
UNDECIDED_MARGIN = 0.12
CONFIDENCE_BASE = 30.0
CONFIDENCE_SPAN = 55.0
CONFIDENCE_SCALE = 0.6
EVIDENCE_BONUS = 2.0
EVIDENCE_CAP = 5
UNDECIDED_CONF_BASE = 20.0
UNDECIDED_CONF_SLOPE = 150.0
UNDECIDED_CONF_CAP = 40.0
TURNOUT_BASE = 0.55
TURNOUT_CONF = 0.35
TURNOUT_REGISTERED = 0.07
TURNOUT_FLOOR = 0.3
TURNOUT_CEIL = 0.97

# Generic issue vocabulary used when a scenario declares no `issues` block
# (and to widen authored keyword lists). Keys are engine synonyms only.
_SYNONYMS: dict[str, list[str]] = {
    "healthcare": [
        "health",
        "medicare",
        "medicaid",
        "aca",
        "insurance",
        "premium",
        "hospital",
        "clinic",
        "prescription",
    ],
    "immigration": [
        "immigration",
        "immigrant",
        "ice",
        "deport",
        "border",
        "daca",
        "citizenship",
        "undocumented",
        "raid",
    ],
    "taxes": ["tax", "taxes", "property tax", "assessment", "salt", "levy", "millage"],
    "cost-of-living": [
        "rent",
        "cost of living",
        "grocer",
        "afford",
        "wage",
        "inflation",
        "prices",
        "housing",
    ],
    "jobs": [
        "job",
        "jobs",
        "layoff",
        "employer",
        "factory",
        "union",
        "labor",
        "labour",
        "small business",
        "payroll",
    ],
    "transit": [
        "transit",
        "train",
        "bus",
        "commut",
        "tunnel",
        "gateway",
        "traffic",
        "road",
        "bridge",
        "pothole",
    ],
    "education": ["school", "college", "tuition", "teacher", "student", "class size"],
    "safety": ["crime", "police", "safety", "fire", "emergency", "flood"],
    "environment": ["river", "park", "trail", "greenway", "flood", "water", "climate", "erosion"],
    "trust": ["fraud", "conviction", "corrupt", "trust", "honest", "scandal", "integrity"],
    "seniors": ["senior", "retire", "pension", "social security", "elder"],
    "budget": ["budget", "surplus", "bond", "debt", "deficit", "spending", "windfall", "reserve"],
    "heritage": ["heritage", "historic", "mill", "ruins", "landmark", "memory"],
    "development": [
        "develop",
        "downtown",
        "main street",
        "vacancy",
        "storefront",
        "tourism",
        "destination",
    ],
}

_WORD_RE = re.compile(r"[a-z][a-z0-9'-]*")


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "issue"


def _clamp(value: float, lo: float, hi: float) -> float:
    return lo if value < lo else hi if value > hi else value


@dataclass
class Issue:
    id: str
    label: str
    keywords: list[str] = field(default_factory=list)


@dataclass
class Readout:
    stance: str
    confidence: int
    margin: float
    top: str | None
    second: str | None


class InfluenceModel:
    """Scenario-bound influence model. Construct once per run; stateless per agent."""

    def __init__(self, scenario) -> None:
        self.scenario = scenario
        self.option_ids: list[str] = list(scenario.option_ids)
        self.undecided_id: str = scenario.undecided_id
        self.groups: dict[str, str | None] = {
            o.id: (o.group or None) for o in scenario.config.options
        }
        self.issues: list[Issue] = self._build_issues()
        self.issue_ids = [i.id for i in self.issues]
        # A[option][issue] in -1..1
        self.alignment: dict[str, dict[str, float]] = {
            o: self._alignment_for(o) for o in self.option_ids
        }
        self._keyword_index: list[tuple[str, str]] = []
        for issue in self.issues:
            for kw in issue.keywords:
                self._keyword_index.append((kw, issue.id))
        # longest keywords first so "property tax" beats "tax"
        self._keyword_index.sort(key=lambda kv: -len(kv[0]))

    # ── Issue space ──────────────────────────────────────────────────────
    def _build_issues(self) -> list[Issue]:
        declared = getattr(self.scenario, "issues", None) or []
        if declared:
            out = []
            for spec in declared:
                kws = list(spec.keywords)
                for word in _WORD_RE.findall(spec.label.lower()):
                    if len(word) > 3 and word not in kws:
                        kws.append(word)
                kws.extend(k for k in _SYNONYMS.get(spec.id, []) if k not in kws)
                out.append(Issue(id=spec.id, label=spec.label, keywords=kws))
            return out
        # Fallback: the union of option positions, slugified.
        seen: dict[str, Issue] = {}
        for option in self.scenario.config.options:
            data = self.scenario.options_data.get(option.id, {}) or {}
            for pos in data.get("positions", []) or []:
                label = str(pos.get("issue", "")).strip()
                if not label:
                    continue
                iid = _slug(label)
                if iid not in seen:
                    words = [w for w in _WORD_RE.findall(label.lower()) if len(w) >= 3]
                    for key, syns in _SYNONYMS.items():
                        if key in iid or any(w in syns for w in words):
                            words.extend(k for k in syns if k not in words)
                    seen[iid] = Issue(id=iid, label=label, keywords=words)
        return list(seen.values())

    def _alignment_for(self, option_id: str) -> dict[str, float]:
        authored = {}
        try:
            authored = self.scenario.option_alignment(option_id)
        except AttributeError:  # pragma: no cover — older Scenario stubs
            authored = {}
        if authored:
            return {i.id: float(authored.get(i.id, 0.0)) for i in self.issues}
        # Fallback: +1 wherever the option states a position on the issue.
        data = self.scenario.options_data.get(option_id, {}) or {}
        stated = {_slug(str(p.get("issue", ""))) for p in data.get("positions", []) or []}
        return {i.id: (1.0 if i.id in stated else 0.0) for i in self.issues}

    def match_issue(self, text: str) -> str | None:
        """Best issue for a free-text topic, concern or headline (None if nothing matches)."""
        low = (text or "").lower()
        if not low:
            return None
        scores: dict[str, int] = {}
        for kw, iid in self._keyword_index:
            if kw in low:
                scores[iid] = scores.get(iid, 0) + len(kw)
        if not scores:
            return None
        return max(scores.items(), key=lambda kv: (kv[1], -self.issue_ids.index(kv[0])))[0]

    # ── Traits and weights ───────────────────────────────────────────────
    def traits_for(self, defn: AgentDefinition) -> dict[str, float]:
        registered = bool(
            defn.political_registration
        ) and defn.political_registration.strip().lower() not in {
            "unaffiliated",
            "independent",
            "none",
            "unregistered",
            "not registered",
            "",
        }
        persuadability = defn.persuadability
        if persuadability is None:
            persuadability = (
                DEFAULT_PERSUADABILITY_REGISTERED
                if registered
                else DEFAULT_PERSUADABILITY_UNAFFILIATED
            )
            if defn.initial_lean == self.undecided_id:
                persuadability += UNDECIDED_PERSUADABILITY_BONUS
            persuadability = min(PERSUADABILITY_CAP, persuadability)
        loyalty = defn.party_loyalty
        if loyalty is None:
            loyalty = DEFAULT_LOYALTY_REGISTERED if registered else DEFAULT_LOYALTY_UNAFFILIATED
        media = defn.media_diet if defn.media_diet is not None else DEFAULT_MEDIA_DIET
        return {
            "persuadability": float(persuadability),
            "party_loyalty": float(loyalty),
            "media_diet": float(media),
            "registered": 1.0 if registered else 0.0,
        }

    def weights_for(self, defn: AgentDefinition) -> dict[str, float]:
        weights: dict[str, float] = {i: 0.0 for i in self.issue_ids}
        if defn.issue_weights:
            for k, v in defn.issue_weights.items():
                if k in weights:
                    weights[k] += float(v)
        else:
            for rank, concern in enumerate(defn.top_concerns[: len(ISSUE_RANK_WEIGHTS)]):
                iid = self.match_issue(concern)
                if iid:
                    weights[iid] += ISSUE_RANK_WEIGHTS[rank]
        total = sum(weights.values())
        if total <= 0 and weights:
            # No concern matched an issue: spread evenly so news still lands.
            even = 1.0 / len(weights)
            return {k: even for k in weights}
        return {k: (v / total if total else 0.0) for k, v in weights.items()}

    def party_pull(self, defn: AgentDefinition, option_id: str) -> float:
        reg = (defn.political_registration or "").strip().lower()
        group = (self.groups.get(option_id) or "").strip().lower()
        if not reg or reg in {"unaffiliated", "independent", "none", "unregistered"} or not group:
            return 0.0
        if reg == group or reg in group or group in reg:
            return PARTY_SAME
        return PARTY_OTHER

    # ── Seed ─────────────────────────────────────────────────────────────
    def seed(self, defn: AgentDefinition, rng, stance: str | None = None) -> Beliefs:
        """Initial beliefs. `stance` (the seed-round read-out, e.g. the LLM's)
        gets a bonus so the ledger prior agrees with the first opinion."""
        traits = self.traits_for(defn)
        weights = self.weights_for(defn)
        utilities: dict[str, float] = {}
        for o in self.option_ids:
            u = sum(weights.get(i, 0.0) * self.alignment[o].get(i, 0.0) for i in self.issue_ids)
            u += traits["party_loyalty"] * self.party_pull(defn, o)
            if defn.initial_lean == o:
                u += SEED_LEAN_BONUS
            if stance == o:
                u += SEED_LEAN_BONUS
            u += SEED_NOISE * (rng.random() - 0.5)
            utilities[o] = u
        beliefs = Beliefs(utilities=utilities, weights=weights, traits=traits)
        if (stance or defn.initial_lean) == self.undecided_id:
            self._compress_to_undecided(beliefs)
        beliefs.ledger.append(
            LedgerEntry(
                round=0,
                kind="seed",
                ref=f"persona:{_slug(defn.top_concerns[0]) if defn.top_concerns else 'values'}",
                option=stance or defn.initial_lean,
                delta=0.0,
                note="where I start from",
            )
        )
        return beliefs

    def _compress_to_undecided(self, beliefs: Beliefs) -> None:
        """Keep the order of preference but pull the top two inside the
        undecided band: a declared fence-sitter leans, and a push or two flips them."""
        ranked = sorted(beliefs.utilities.values(), reverse=True)
        if len(ranked) < 2:
            return
        margin = ranked[0] - ranked[1]
        target = UNDECIDED_MARGIN * 0.5
        if margin <= target:
            return
        mean = sum(beliefs.utilities.values()) / len(beliefs.utilities)
        f = target / margin
        for o in beliefs.utilities:
            beliefs.utilities[o] = mean + (beliefs.utilities[o] - mean) * f

    def adopt_stance(
        self, beliefs: Beliefs, stance: str, round_num: int, ref: str, note: str = ""
    ) -> None:
        """Align the ledger with a stance a model stated outright (seed or
        reflection): the utilities move just enough that the read-out agrees.
        The model's word is authoritative; the ledger records the alignment."""
        if stance == self.undecided_id:
            self._compress_to_undecided(beliefs)
            beliefs.ledger.append(
                LedgerEntry(
                    round=round_num,
                    kind="reflection",
                    ref=ref,
                    option=stance,
                    delta=0.0,
                    note=note or "still on the fence",
                )
            )
            return
        if stance not in beliefs.utilities:
            return
        current = self.readout(beliefs)
        if current.stance == stance:
            return
        top_u = max(beliefs.utilities.values())
        need = (top_u - beliefs.utilities[stance]) + UNDECIDED_MARGIN + 0.05
        n = len(beliefs.utilities)
        # _push spreads -delta/(n-1) over the others, so the relative gain is delta * n/(n-1)
        delta = need * (n - 1) / n if n > 1 else need
        self._push(beliefs, stance, delta)
        beliefs.ledger.append(
            LedgerEntry(
                round=round_num,
                kind="reflection",
                ref=ref,
                option=stance,
                delta=round(delta, 4),
                note=note or f"settled on {stance}",
            )
        )

    # ── Pushes ───────────────────────────────────────────────────────────
    def _push(self, beliefs: Beliefs, option: str, delta: float) -> None:
        if option not in beliefs.utilities or delta == 0.0:
            return
        others = [o for o in beliefs.utilities if o != option]
        beliefs.utilities[option] += delta
        if others:
            share = delta / len(others)
            for o in others:
                beliefs.utilities[o] -= share

    def apply_exchange(
        self,
        listener: AgentState,
        speaker: AgentState,
        topic: str,
        round_num: int,
        ref: str,
        *,
        same_town: bool = True,
        relationship: float = 0.0,
        kappa: float = 1.0,
        kind: str = "conversation",
    ) -> LedgerEntry | None:
        """One spoken argument landing on the listener. Returns the ledger entry."""
        if listener.beliefs is None:
            return None
        speaker_stance = speaker.current_opinion.candidate if speaker.current_opinion else None
        if (
            not speaker_stance
            or speaker_stance == self.undecided_id
            or speaker_stance not in listener.beliefs.utilities
        ):
            return None
        b = listener.beliefs
        issue = self.match_issue(topic)
        align = self.alignment.get(speaker_stance, {}).get(issue, 0.0) if issue else 0.0
        arg = 0.4 + 0.6 * max(0.0, align)
        listener_top = self.readout(b).top
        same_option = listener_top == speaker_stance
        trust = min(
            1.0,
            0.35
            + 0.45 * relationship
            + (0.10 if same_town else 0.0)
            + (0.10 if same_option else 0.0),
        )
        gap = (b.utilities.get(listener_top, 0.0) if listener_top else 0.0) - b.utilities[
            speaker_stance
        ]
        if gap > EPS_GAP:
            entry = LedgerEntry(
                round=round_num,
                kind=kind,
                ref=ref,
                agent_id=speaker.agent_id,
                option=speaker_stance,
                delta=0.0,
                note=f"dismissed {speaker.definition.name}'s case",
            )  # type: ignore[arg-type]
            b.ledger.append(entry)
            return entry
        delta = (
            EXCHANGE_GAIN
            * b.traits.get("persuadability", 0.4)
            * trust
            * arg
            * (1.0 - max(0.0, gap) / EPS_GAP)
            * kappa
        )
        if same_option:
            delta *= REINFORCE_GAIN
        elif listener_top is not None:
            delta *= CONFIRMATION
        self._push(b, speaker_stance, delta)
        b.evidence += 1
        note = f"{speaker.definition.name} made the case for {speaker_stance}" + (
            f" on {issue}" if issue else ""
        )
        entry = LedgerEntry(
            round=round_num,
            kind=kind,
            ref=ref,
            agent_id=speaker.agent_id,
            option=speaker_stance,
            delta=round(delta, 4),
            note=note,
        )  # type: ignore[arg-type]
        b.ledger.append(entry)
        return entry

    def apply_news(
        self, agent: AgentState, news, round_num: int, ref: str
    ) -> tuple[list[LedgerEntry], dict]:
        """A headline lands. Returns (entries, derived reaction {impact, emotion})."""
        if agent.beliefs is None:
            return [], {"impact_on_vote": "no_effect", "emotional_response": "indifferent"}
        b = agent.beliefs
        before = self.readout(b)
        effects = list(getattr(news, "effects", []) or [])
        entries: list[LedgerEntry] = []
        headline = getattr(news, "headline", "") or ""
        if not effects:
            issue = self.match_issue(headline + " " + (getattr(news, "description", "") or ""))
            if issue:
                # Fallback: the headline favours whichever option is most aligned on its issue.
                best = max(self.option_ids, key=lambda o: self.alignment[o].get(issue, 0.0))
                if self.alignment[best].get(issue, 0.0) > 0:
                    effects = [type("E", (), {"issue": issue, "option": best, "delta": 0.5})()]
        media = b.traits.get("media_diet", DEFAULT_MEDIA_DIET)
        for eff in effects:
            issue_id = getattr(eff, "issue", None)
            option = getattr(eff, "option", None)
            delta_spec = float(getattr(eff, "delta", 0.0))
            if option not in b.utilities:
                continue
            w = b.weights.get(issue_id, 0.0) if issue_id else 0.0
            delta = NEWS_GAIN * media * delta_spec * (0.25 + w)
            if before.top is not None and option != before.top and delta > 0:
                delta *= CONFIRMATION
            self._push(b, option, delta)
            entries.append(
                LedgerEntry(
                    round=round_num,
                    kind="news",
                    ref=ref,
                    option=option,
                    delta=round(delta, 4),
                    note=f"{headline[:60]} → {option} on {issue_id}",
                )
            )
        if entries:
            b.evidence += 1
            b.ledger.extend(entries)
        after = self.readout(b)
        # Derived reaction
        top_before = before.top
        gain_top = b.utilities.get(top_before, 0.0) if top_before else 0.0
        moved = sum(e.delta for e in entries)
        if after.top != top_before and after.stance != self.undecided_id:
            impact = "changes_mind"
        elif top_before and any(e.option == top_before and e.delta >= 0.02 for e in entries):
            impact = "strengthens_current"
        elif top_before and any(e.option != top_before and e.delta >= 0.02 for e in entries):
            impact = "weakens_current"
        else:
            impact = "no_effect"
        # Emotion: angry when their top option lost ground on their #1 issue,
        # anxious when their stance weakened, hopeful when it strengthened,
        # confused when the top two sit within 0.05, indifferent otherwise.
        top_issue = max(b.weights.items(), key=lambda kv: kv[1])[0] if b.weights else None
        lost_on_top = any(
            e.option != top_before and e.delta >= 0.1 and top_issue and top_issue in e.note
            for e in entries
        )
        if lost_on_top:
            emotion = "angry"
        elif impact == "weakens_current":
            emotion = "anxious"
        elif impact in ("strengthens_current", "changes_mind"):
            emotion = "hopeful"
        elif after.margin < 0.05 and abs(moved) > 0:
            emotion = "confused"
        else:
            emotion = "indifferent"
        _ = gain_top
        return entries, {"impact_on_vote": impact, "emotional_response": emotion}

    def apply_gossip(
        self, listener: AgentState, speaker: AgentState, topic: str, round_num: int, ref: str
    ) -> LedgerEntry | None:
        return self.apply_exchange(
            listener,
            speaker,
            topic,
            round_num,
            ref,
            same_town=False,
            kappa=GOSSIP_KAPPA,
            kind="gossip",
        )

    def apply_event(
        self, agent: AgentState, option: str, delta: float, round_num: int, ref: str, note: str = ""
    ) -> LedgerEntry | None:
        """God's View or campaign event: a direct authored push."""
        if agent.beliefs is None or option not in agent.beliefs.utilities:
            return None
        self._push(agent.beliefs, option, delta)
        agent.beliefs.evidence += 1
        entry = LedgerEntry(
            round=round_num,
            kind="god_view" if ref.startswith("god:") else "event",
            ref=ref,
            option=option,
            delta=round(delta, 4),
            note=note,
        )
        agent.beliefs.ledger.append(entry)
        return entry

    # ── Read-out ─────────────────────────────────────────────────────────
    def readout(self, beliefs: Beliefs) -> Readout:
        ranked = sorted(
            beliefs.utilities.items(),
            key=lambda kv: (
                -kv[1],
                self.option_ids.index(kv[0]) if kv[0] in self.option_ids else 99,
            ),
        )
        if not ranked:
            return Readout(self.undecided_id, 20, 0.0, None, None)
        top, u1 = ranked[0]
        second, u2 = ranked[1] if len(ranked) > 1 else (None, u1 - 1.0)
        margin = u1 - u2
        if margin < UNDECIDED_MARGIN:
            conf = _clamp(
                UNDECIDED_CONF_BASE + UNDECIDED_CONF_SLOPE * margin,
                UNDECIDED_CONF_BASE,
                UNDECIDED_CONF_CAP,
            )
            return Readout(self.undecided_id, int(round(conf)), margin, top, second)
        conf = _clamp(
            CONFIDENCE_BASE
            + CONFIDENCE_SPAN * math.tanh(margin / CONFIDENCE_SCALE)
            + EVIDENCE_BONUS * min(beliefs.evidence, EVIDENCE_CAP),
            5,
            95,
        )
        return Readout(top, int(round(conf)), margin, top, second)

    def prior_for(self, agent: AgentState, since_round: int = 0) -> dict:
        """What the ledger says now — handed to providers that render from it."""
        if agent.beliefs is None:
            return {}
        r = self.readout(agent.beliefs)
        recent = [e for e in agent.beliefs.ledger if e.round >= since_round and e.delta != 0.0]
        recent.sort(key=lambda e: -abs(e.delta))
        return {
            "stance": r.stance,
            "confidence": r.confidence,
            "margin": round(r.margin, 4),
            "top": r.top,
            "second": r.second,
            "influences": [
                {
                    "ref": e.ref,
                    "agent_id": e.agent_id,
                    "option": e.option,
                    "delta": e.delta,
                    "note": e.note,
                    "kind": e.kind,
                }
                for e in recent[:6]
            ],
        }

    # ── Ballot ───────────────────────────────────────────────────────────
    def ballot(self, agent: AgentState, rng, round_num: int) -> Ballot:
        b = agent.beliefs
        defn = agent.definition
        r = self.readout(b) if b is not None else None
        current = agent.current_opinion
        conf = current.confidence if current else (r.confidence if r else 30)
        traits = b.traits if b is not None else self.traits_for(defn)
        turnout = defn.turnout
        if turnout is None:
            turnout = _clamp(
                TURNOUT_BASE
                + TURNOUT_CONF * conf / 100.0
                + TURNOUT_REGISTERED * traits.get("registered", 0.0),
                TURNOUT_FLOOR,
                TURNOUT_CEIL,
            )
        if rng.random() > turnout:
            return Ballot(
                option=None,
                confidence=int(conf),
                reason="Did not make it to the polls.",
                round=round_num,
            )
        choice: str | None
        if r is not None and r.margin >= UNDECIDED_MARGIN and r.top:
            choice = r.top
            reason = f"Went with {choice} — the case that held up."
        elif current and current.candidate != self.undecided_id:
            choice = current.candidate
            reason = f"Stuck with {choice} in the end."
        else:
            party = None
            if traits.get("party_loyalty", 0.0) >= 0.3:
                for o in self.option_ids:
                    if self.party_pull(defn, o) >= PARTY_SAME:
                        party = o
                        break
            if party:
                choice, reason = party, f"Undecided to the end, so I went with my side: {party}."
            elif defn.initial_lean in self.option_ids:
                choice, reason = (
                    defn.initial_lean,
                    f"Fell back on my first instinct: {defn.initial_lean}.",
                )
            else:
                choice, reason = None, "Could not choose, so I left it blank."
        return Ballot(option=choice, confidence=int(conf), reason=reason, round=round_num)
