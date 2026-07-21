from pathlib import Path

import frontmatter

from .types import AgentDefinition

AGENT_ID_MAX_CHARS = 160
_ROUTE_BREAKING_AGENT_ID = frozenset("/\\?#%")
_PERSONA_FRONTMATTER_FIELDS = frozenset(
    {
        "name",
        "town",
        "description",
        "age",
        "occupation",
        "household",
        "income_bracket",
        "language",
        "political_registration",
        "initial_lean",
        "top_concerns",
        "tools",
        "model",
        "routine",
        "relationships",
        "idle_thoughts",
        "goals",
    }
)
_REQUIRED_PERSONA_FRONTMATTER_FIELDS = _PERSONA_FRONTMATTER_FIELDS - {
    "tools",
    "model",
    "routine",
    "relationships",
    "idle_thoughts",
    "goals",
}


def agent_id_from_name(name: str) -> str:
    """Derive the stable wire/route id used for a resident display name.

    The transformation intentionally preserves the project's existing ids so
    recorded replays remain compatible. Characters that could escape or alter
    an HTTP path are rejected at scenario-load time; clients still URL-encode
    every id when placing it in a route.
    """
    if not isinstance(name, str) or not name.strip():
        raise ValueError("agent name must be a non-empty string")
    agent_id = name.strip().lower().replace(" ", "-").replace(".", "")
    if not agent_id or len(agent_id) > AGENT_ID_MAX_CHARS:
        raise ValueError(f"derived agent id must contain 1-{AGENT_ID_MAX_CHARS} characters")
    if any(ch in _ROUTE_BREAKING_AGENT_ID or ord(ch) < 32 or ord(ch) == 127 for ch in agent_id):
        raise ValueError(
            "agent names cannot derive ids containing path separators, URL delimiters, "
            "percent escapes, or control characters"
        )
    return agent_id


def validate_agent_ids(agents: dict[str, list[AgentDefinition]]) -> None:
    """Require one valid, globally unique derived id across a scenario roster."""
    seen: dict[str, tuple[str, str]] = {}
    for town, definitions in agents.items():
        for definition in definitions:
            try:
                agent_id = agent_id_from_name(definition.name)
            except ValueError as exc:
                raise ValueError(
                    f"invalid resident identity {town}/{definition.name!r}: {exc}"
                ) from exc
            prior = seen.get(agent_id)
            if prior is not None:
                prior_town, prior_name = prior
                raise ValueError(
                    f"duplicate derived agent id {agent_id!r}: "
                    f"{prior_town}/{prior_name!r} and {town}/{definition.name!r}"
                )
            seen[agent_id] = (town, definition.name)


def load_agent(filepath: Path) -> AgentDefinition:
    """Parse a single .md persona file into an AgentDefinition."""
    post = frontmatter.load(str(filepath))
    keys = set(post.metadata)
    unknown = sorted(keys - _PERSONA_FRONTMATTER_FIELDS)
    if unknown:
        raise ValueError(f"unknown persona frontmatter fields in {filepath.name}: {unknown}")
    missing = sorted(_REQUIRED_PERSONA_FRONTMATTER_FIELDS - keys)
    if missing:
        raise ValueError(f"missing persona frontmatter fields in {filepath.name}: {missing}")
    return AgentDefinition(
        name=post.metadata["name"],
        town=post.metadata["town"],
        description=post.metadata["description"],
        age=post.metadata["age"],
        occupation=post.metadata["occupation"],
        household=post.metadata["household"],
        income_bracket=post.metadata["income_bracket"],
        language=post.metadata["language"],
        political_registration=post.metadata["political_registration"],
        initial_lean=post.metadata["initial_lean"],
        top_concerns=post.metadata["top_concerns"],
        tools=post.metadata.get("tools", ["Discuss", "FormOpinion", "ReactToNews"]),
        model=post.metadata.get("model"),
        system_prompt=post.content,
        # Phase 3 — optional living-world fields. Older personas without these
        # keys gracefully fall back to empty lists / dicts.
        routine=post.metadata.get("routine", []) or [],
        relationships=post.metadata.get("relationships", []) or [],
        idle_thoughts=post.metadata.get("idle_thoughts", []) or [],
        goals=post.metadata.get("goals", {}) or {},
    )


def load_agents(town: str, agents_dir: str = "agents") -> list[AgentDefinition]:
    """Load all agents for a given town."""
    town_dir = Path(agents_dir) / town
    if not town_dir.exists():
        return []
    agents = []
    for md_file in sorted(town_dir.glob("*.md")):
        agents.append(load_agent(md_file))
    return agents


def load_all_agents(agents_dir: str = "agents") -> dict[str, list[AgentDefinition]]:
    """Load all agents grouped by town. Auto-discovers towns from directories."""
    agents_path = Path(agents_dir)
    result = {}
    for town_dir in sorted(agents_path.iterdir()):
        if town_dir.is_dir() and not town_dir.name.startswith("."):
            agents = load_agents(town_dir.name, agents_dir)
            if agents:
                result[town_dir.name] = agents
    return result
