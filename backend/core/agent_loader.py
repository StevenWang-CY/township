import frontmatter
from pathlib import Path
from .types import AgentDefinition


def load_agent(filepath: Path) -> AgentDefinition:
    """Parse a single .md persona file into an AgentDefinition."""
    post = frontmatter.load(str(filepath))
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
        model=post.metadata.get("model", "claude-sonnet-4-6"),
        system_prompt=post.content,
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
