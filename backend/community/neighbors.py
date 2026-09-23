"""
Generated neighbors — the background population that gives each town a
real crowd at zero model cost.

A neighbor is a fictional composite drawn from generic pools (and the
scenario's optional `community.json`): a name, an occupation with a routine
template, a household, a lean and registration consistent with the town's
mix, two or three concerns phrased in the scenario's issue space, a couple
of ties. The generator is seeded per (scenario, town, seed) so the same
command always writes the same file; the loader never generates — the file
is committed scenario data (`agents/<town>/_neighbors.json`).
"""

from __future__ import annotations

import json
import random
import re
from pathlib import Path

from backend.core.agent_loader import agent_id_from_name
from backend.core.types import AgentDefinition

GENERATOR_VERSION = 1
DEFAULTS_PATH = Path(__file__).with_name("defaults.json")
NEIGHBORS_FILENAME = "_neighbors.json"
MIN_PER_TOWN = 12
MAX_PER_TOWN = 18


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def defaults() -> dict:
    return _load_json(DEFAULTS_PATH)


def community_config(scenario) -> dict:
    """The scenario's optional community.json (per-town mixes and pools)."""
    path = Path(scenario.scenario_dir) / "community.json"
    if path.is_file() and not path.is_symlink():
        return _load_json(path)
    return {}


def count_for_town(scenario, town_id: str, per_town: int | None = None) -> int:
    if per_town is not None:
        return max(1, per_town)
    pops = {
        t: int((d.get("demographics") or {}).get("population") or 0)
        for t, d in scenario.towns.items()
    }
    pmin, pmax = min(pops.values()), max(pops.values())
    pop = pops.get(town_id, pmin)
    if pmax <= pmin:
        return MIN_PER_TOWN
    return MIN_PER_TOWN + round((MAX_PER_TOWN - MIN_PER_TOWN) * (pop - pmin) / (pmax - pmin))


def _allocate(rng: random.Random, n: int, mix: dict[str, float]) -> list[str]:
    """Largest-remainder quotas for `n` draws from `mix`, shuffled: a town of
    twelve keeps its authored lean mix instead of a coin-flip caricature of it."""
    total = sum(mix.values()) or 1.0
    exact = {k: n * v / total for k, v in mix.items()}
    counts = {k: int(x) for k, x in exact.items()}
    short = n - sum(counts.values())
    for k in sorted(exact, key=lambda k: (-(exact[k] - counts[k]), k))[:short]:
        counts[k] += 1
    slots = [k for k, c in sorted(counts.items()) for _ in range(c)]
    rng.shuffle(slots)
    return slots


def _weighted(rng: random.Random, weights: dict[str, float]) -> str:
    items = list(weights.items())
    total = sum(w for _, w in items) or 1.0
    r = rng.random() * total
    acc = 0.0
    for key, w in items:
        acc += w
        if r <= acc:
            return key
    return items[-1][0]


def _landmarks_by_kind(town: dict) -> dict[str, list[str]]:
    kinds: dict[str, list[str]] = {}
    for lm in town.get("landmarks", []):
        name, typ = lm["name"], lm.get("type", "building")
        low = name.lower()
        kinds.setdefault(typ, []).append(name)
        if any(
            k in low
            for k in (
                "restaurant",
                "cafe",
                "café",
                "diner",
                "deli",
                "bodega",
                "pizzeria",
                "bakery",
                "pub",
                "taqueria",
                "grill",
                "coffee",
            )
        ):
            kinds.setdefault("food", []).append(name)
        if any(k in low for k in ("school", "college", "academy")):
            kinds.setdefault("school", []).append(name)
        if any(
            k in low
            for k in (
                "library",
                "town hall",
                "village hall",
                "municipal",
                "post office",
                "community",
            )
        ):
            kinds.setdefault("civic", []).append(name)
    return kinds


def _pick_landmark(
    rng: random.Random, kinds: dict[str, list[str]], wanted: list[str], fallback: str
) -> str:
    for kind in wanted:
        if kinds.get(kind):
            return rng.choice(sorted(kinds[kind]))
    return fallback


def _issue_phrase(rng: random.Random, issue_id: str, pools: dict, scenario) -> str:
    phrases = pools.get("concern_phrases", {}).get(issue_id)
    if phrases:
        return rng.choice(phrases)
    for issue in getattr(scenario, "issues", []) or []:
        if issue.id == issue_id:
            return issue.label.lower()
    return issue_id.replace("-", " ")


def _concerns_for(
    rng: random.Random, lean: str, occ: dict, issue_ids: list[str], scenario
) -> list[str]:
    """Three issues: what the job makes you feel, tilted toward what your side
    campaigns on. A leaner's concerns favour the issues their option owns (people
    care about what their side talks about); fence-sitters draw evenly, so the
    ledger's seed agrees with the drawn lean instead of fighting it."""
    align = scenario.option_alignment(lean) if lean != scenario.undecided_id else {}
    weights: dict[str, float] = {}
    for iid in issue_ids:
        w = 1.0
        if iid in occ.get("concerns", []):
            w += 1.5
        a = float(align.get(iid, 0.0)) if align else 0.0
        w += 2.0 * max(0.0, a) - 0.6 * max(0.0, -a)
        weights[iid] = max(0.1, w)
    picked: list[str] = []
    pool = dict(weights)
    while pool and len(picked) < 3:
        iid = _weighted(rng, pool)
        picked.append(iid)
        pool.pop(iid, None)
    return picked


def _registration_for(rng: random.Random, lean: str, scenario, cfg: dict) -> str:
    groups = {o.id: (o.group or "").lower() for o in scenario.config.options}
    partisan = any(groups.values())
    if not partisan:
        return rng.choice(["unaffiliated", "unaffiliated", "democrat", "republican"])
    group = groups.get(lean, "")
    if group:
        return group if rng.random() < 0.7 else "unaffiliated"
    r = rng.random()
    if r < 0.6:
        return "unaffiliated"
    named = sorted({g for g in groups.values() if g})
    return rng.choice(named) if named else "unaffiliated"


def generate_neighbors(
    scenario,
    town_id: str,
    seed: int = 7,
    per_town: int | None = None,
    avoid_ids: set[str] | None = None,
) -> dict:
    """Deterministic neighbors for one town (see the module docstring).

    `avoid_ids` carries the derived ids already taken elsewhere in the scenario
    (voices in every town, neighbors of towns generated earlier) so ids stay
    unique district-wide — the agent loader rejects duplicates across towns.
    """
    pools = defaults()
    cfg = community_config(scenario)
    town_cfg = (cfg.get("towns") or {}).get(town_id, {})
    town = scenario.towns[town_id]
    rng = random.Random(f"{scenario.id}|{town_id}|{seed}")
    n = count_for_town(scenario, town_id, per_town)
    kinds = _landmarks_by_kind(town)
    homes = (
        kinds.get("housing")
        or [lm["name"] for lm in town.get("landmarks", []) if lm.get("type") != "road"][:1]
        or ["Town Center"]
    )
    option_ids = [o.id for o in scenario.config.options]
    lean_mix = (
        town_cfg.get("lean_mix")
        or cfg.get("lean_mix")
        or {
            **{o: 1.0 / (len(option_ids) + 1) for o in option_ids},
            scenario.undecided_id: 1.0 / (len(option_ids) + 1),
        }
    )
    name_mix = town_cfg.get("name_pools") or cfg.get("name_pools") or {"anglo": 1.0}
    issue_ids = [i.id for i in getattr(scenario, "issues", []) or []] or list(
        pools["concern_phrases"].keys()
    )
    occupations = [
        o
        for o in pools["occupations"]
        if (not town_cfg.get("occupations") or o["title"] in town_cfg["occupations"])
    ] or pools["occupations"]
    commute_targets: list[str] = (
        town_cfg.get("commute_targets") or cfg.get("commute_targets", {}).get(town_id, []) or []
    )
    voices = [d for d in scenario.agents.get(town_id, []) if getattr(d, "tier", "voice") == "voice"]
    taken_ids: set[str] = set(avoid_ids or ())
    for defs in scenario.agents.values():
        # Only voices count: regenerating with --force must not be perturbed by
        # the neighbors files a loaded scenario already carries.
        taken_ids.update(
            agent_id_from_name(d.name) for d in defs if getattr(d, "tier", "voice") == "voice"
        )
    voice_places = {
        agent_id_from_name(v.name): {r.get("location") for r in v.routine if isinstance(r, dict)}
        for v in voices
    }

    lean_slots = _allocate(rng, n, lean_mix)
    used_names: set[str] = set()
    out = []
    for _i in range(n):
        pool_key = _weighted(rng, name_mix)
        pool = pools["name_pools"].get(pool_key) or pools["name_pools"]["anglo"]
        for _ in range(40):
            name = f"{rng.choice(pool['first'])} {rng.choice(pool['last'])}"
            if name not in used_names and agent_id_from_name(name) not in taken_ids:
                break
        used_names.add(name)
        taken_ids.add(agent_id_from_name(name))
        occ = rng.choice(occupations)
        template = pools["templates"][occ["template"]]
        home = rng.choice(sorted(homes))
        work_kinds = occ.get("workplace", [])
        commute = None
        if "commute" in work_kinds and commute_targets and rng.random() < 0.75:
            commute = rng.choice(sorted(commute_targets))  # "town: Landmark"
        workplace = None
        if work_kinds and not commute:
            workplace = _pick_landmark(
                rng, kinds, [k for k in work_kinds if k != "commute"] or ["building"], home
            )
        routine = []
        for time, slot, activity in template:
            if slot == "home":
                loc = home
            elif slot == "work":
                loc = workplace or commute or _pick_landmark(rng, kinds, ["building"], home)
            elif slot == "commute":
                loc = commute or workplace or _pick_landmark(rng, kinds, ["building"], home)
            else:
                loc = _pick_landmark(rng, kinds, [slot, "park", "building"], home)
            routine.append({"time": time, "location": loc, "activity": activity})
        lean = lean_slots.pop()
        if lean not in option_ids and lean != scenario.undecided_id:
            lean = scenario.undecided_id
        registration = _registration_for(rng, lean, scenario, cfg)
        concern_ids = _concerns_for(rng, lean, occ, issue_ids, scenario)
        concerns = [_issue_phrase(rng, c, pools, scenario) for c in concern_ids[:3]]
        age = rng.randint(24, 78) if occ["template"] != "retiree" else rng.randint(63, 84)
        if occ["template"] == "student":
            age = rng.randint(19, 27)
        language = rng.choice(pools["languages"].get(pool_key, pools["languages"]["default"]))
        household = rng.choice(pools["households"])
        # Ties: one voice who shares a place, up to two neighbors at the same home.
        ties = []
        my_places = {r["location"] for r in routine}
        shared_voice = [vid for vid, places in voice_places.items() if places & my_places]
        if shared_voice:
            vid = rng.choice(sorted(shared_voice))
            ties.append(
                {
                    "agent": vid,
                    "type": rng.choice(["neighbor", "acquaintance", "regular"]),
                    "strength": round(rng.uniform(0.3, 0.6), 2),
                    "context": "Crosses paths most days",
                }
            )
        out.append(
            {
                "name": name,
                "age": age,
                "occupation": occ["title"],
                "household": household,
                "income_bracket": occ.get("income", "~$50k"),
                "language": language,
                "political_registration": registration,
                "initial_lean": lean,
                "top_concerns": concerns,
                "home": home,
                "workplace": commute or workplace,
                "routine_template": occ["template"],
                "routine": routine,
                "relationships": ties,
                "idle_thoughts": rng.sample(pools["idle_thoughts"], 2),
                "turnout": round(rng.uniform(0.35, 0.95), 2),
                # Fence-sitters are the persuadable ones; leaners hold their ground more.
                "persuadability": round(rng.uniform(0.45, 0.8), 2)
                if lean == scenario.undecided_id
                else round(rng.uniform(0.2, 0.55), 2),
                "party_loyalty": round(rng.uniform(0.3, 0.8), 2)
                if registration != "unaffiliated"
                else round(rng.uniform(0.0, 0.2), 2),
                "issue_weights": {
                    c: round(w, 2) for c, w in zip(concern_ids[:3], (1.0, 0.6, 0.4), strict=False)
                },
            }
        )
    # Second-degree ties among neighbors who share a home.
    by_home: dict[str, list[dict]] = {}
    for nb in out:
        by_home.setdefault(nb["home"], []).append(nb)
    for group in by_home.values():
        for nb in group:
            others = [o for o in group if o is not nb]
            for o in rng.sample(others, min(len(others), rng.randint(0, 2))):
                nb["relationships"].append(
                    {
                        "agent": agent_id_from_name(o["name"]),
                        "type": "neighbor",
                        "strength": round(rng.uniform(0.2, 0.5), 2),
                        "context": f"Both live at {nb['home']}",
                    }
                )
    return {"seed": seed, "generator_version": GENERATOR_VERSION, "town": town_id, "neighbors": out}


def neighbor_to_definition(nb: dict, town_id: str, scenario) -> AgentDefinition:
    """A generated neighbor as an AgentDefinition (tier neighbor, no tools)."""
    concerns = ", ".join(nb["top_concerns"])
    prompt = (
        f"{nb['name']} is a {nb['age']}-year-old {nb['occupation'].lower()} in "
        f"{scenario.towns[town_id].get('name', town_id)}. {nb['household']}. "
        f"What keeps them up: {concerns}. They speak {nb['language']}. "
        f"A composite resident generated for Township's background population — not a real person."
    )
    return AgentDefinition(
        name=nb["name"],
        town=town_id,
        description=f"{nb['occupation']} — generated neighbor",
        age=int(nb["age"]),
        occupation=nb["occupation"],
        household=nb["household"],
        income_bracket=nb["income_bracket"],
        language=nb["language"],
        political_registration=nb["political_registration"],
        initial_lean=nb["initial_lean"],
        top_concerns=list(nb["top_concerns"]),
        tools=[],
        system_prompt=prompt,
        routine=list(nb.get("routine", [])),
        relationships=list(nb.get("relationships", [])),
        idle_thoughts=list(nb.get("idle_thoughts", [])),
        persuadability=nb.get("persuadability"),
        party_loyalty=nb.get("party_loyalty"),
        turnout=nb.get("turnout"),
        issue_weights=dict(nb.get("issue_weights", {})),
        tier="neighbor",
    )


def load_neighbors_file(path: Path, town_id: str, scenario) -> list[AgentDefinition]:
    data = _load_json(path)
    if not isinstance(data, dict) or "neighbors" not in data:
        raise ValueError(f"{path} must be an object with a 'neighbors' list")
    allowed = {"seed", "generator_version", "town", "neighbors"}
    unknown = sorted(set(data) - allowed)
    if unknown:
        raise ValueError(f"{path} has unknown keys {unknown}")
    required = {
        "name",
        "age",
        "occupation",
        "household",
        "income_bracket",
        "language",
        "political_registration",
        "initial_lean",
        "top_concerns",
        "routine",
    }
    optional = {
        "home",
        "workplace",
        "routine_template",
        "relationships",
        "idle_thoughts",
        "turnout",
        "persuadability",
        "party_loyalty",
        "issue_weights",
        "media_diet",
    }
    out = []
    for nb in data["neighbors"]:
        keys = set(nb)
        missing = sorted(required - keys)
        extra = sorted(keys - required - optional)
        if missing or extra:
            raise ValueError(
                f"{path}: neighbor {nb.get('name', '?')!r} missing {missing}, unknown {extra}"
            )
        out.append(neighbor_to_definition(nb, town_id, scenario))
    return out


def write_neighbors(
    scenario, seed: int = 7, per_town: int | None = None, force: bool = False
) -> list[Path]:
    """Generate and write every town's `_neighbors.json`; returns the paths."""
    written = []
    taken: set[str] = set()
    for town_id in scenario.town_ids:
        town_dir = Path(scenario.scenario_dir) / "agents" / town_id
        town_dir.mkdir(parents=True, exist_ok=True)
        path = town_dir / NEIGHBORS_FILENAME
        if path.exists() and not force:
            raise FileExistsError(f"{path} exists; pass --force to overwrite")
        data = generate_neighbors(scenario, town_id, seed=seed, per_town=per_town, avoid_ids=taken)
        taken.update(agent_id_from_name(nb["name"]) for nb in data["neighbors"])
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        written.append(path)
    return written


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
