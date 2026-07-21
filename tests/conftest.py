"""
Shared pytest fixtures + a fake Bedrock client for Township backend tests.

The fake never makes a network call, so the whole suite runs with no AWS /
OpenAI / ElevenLabs credentials. It returns tool-use payloads that match the
real Anthropic tool schemas (backend/tools/schemas.py).
"""
import os
import sys

import pytest

# Make `import backend...` work when pytest is launched from the repo root.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

# The test contract is always offline, even when a contributor's local .env
# contains live provider credentials. Explicit process variables win over the
# package's dotenv loader and prevent accidental billable calls.
os.environ["LLM_PROVIDER"] = "mock"
os.environ["MOCK_DELAY_S"] = "0"

# Keep player-state persistence (relationships/journal) out of the repo's
# data/state/ during tests. Must happen before any `backend` import — the
# route modules bind their state paths at import time.
if "TOWNSHIP_STATE_DIR" not in os.environ:
    import tempfile

    os.environ["TOWNSHIP_STATE_DIR"] = tempfile.mkdtemp(prefix="township-state-")


@pytest.fixture(autouse=True, scope="session")
def _runs_dir_outside_repo(tmp_path_factory):
    """Keep run persistence (runs/<id>/) out of the repo during tests.

    Individual tests may still monkeypatch TOWNSHIP_RUNS_DIR to their own
    tmp dir; monkeypatch restores this session value afterwards.
    """
    runs_dir = tmp_path_factory.mktemp("runs")
    previous = os.environ.get("TOWNSHIP_RUNS_DIR")
    os.environ["TOWNSHIP_RUNS_DIR"] = str(runs_dir)
    yield
    if previous is None:
        os.environ.pop("TOWNSHIP_RUNS_DIR", None)
    else:
        os.environ["TOWNSHIP_RUNS_DIR"] = previous

SCENARIOS_DIR = os.path.join(REPO_ROOT, "scenarios")
NJ11_SCENARIO_DIR = os.path.join(SCENARIOS_DIR, "nj11-2026")


def load_nj11_scenario():
    """Load the flagship NJ-11 scenario package (fresh instance per call)."""
    from backend.core.scenario import load_scenario

    return load_scenario(NJ11_SCENARIO_DIR)


def _ok(text: str = "", tool_use=None) -> dict:
    return {
        "text": text,
        "tool_use": tool_use,
        "input_tokens": 0,
        "output_tokens": 0,
        "cost": 0.0,
        "stop_reason": "end_turn",
    }


class FakeClient:
    """Stand-in for AnthropicClient with the same call_agent contract."""

    def __init__(self, mode: str = "normal"):
        self.mode = mode  # "normal" | "error"
        self.calls: list = []

    async def call_agent(self, system_prompt, messages, tools=None,
                         max_tokens: int = 500, model: str = "fake") -> dict:
        names = [t["name"] for t in (tools or [])]
        self.calls.append(names)

        if self.mode == "error":
            return {
                "text": "[API Error: simulated outage]",
                "tool_use": None,
                "input_tokens": 0,
                "output_tokens": 0,
                "cost": 0.0,
                "stop_reason": "error",
                "error": "simulated outage",
            }

        if "FormOpinion" in names:
            return _ok(tool_use={
                "name": "FormOpinion",
                "input": {
                    "candidate": "mejia",
                    "confidence": 82,
                    "reasoning": "After everything, I'm with Mejia on healthcare.",
                    "top_issues": ["healthcare", "immigration"],
                    "dealbreaker": None,
                },
                "id": "tu_form",
            })
        if "ReactToNews" in names:
            return _ok(tool_use={
                "name": "ReactToNews",
                "input": {
                    "emotional_response": "hopeful",
                    "impact_on_vote": "changes_mind",
                    "reasoning": "This genuinely changes how I see the race.",
                    "would_share_with": "my family",
                },
                "id": "tu_news",
            })
        if "ClassifyInteraction" in names:
            return _ok(tool_use={
                "name": "ClassifyInteraction",
                "input": {"tone": "curious", "trust_delta": 4,
                          "reasoning": "They asked real questions."},
                "id": "tu_classify",
            })
        if "Discuss" in names:
            return _ok(tool_use={
                "name": "Discuss",
                "input": {"response": "I hear you on that.", "topic": "taxes",
                          "sentiment": "neutral", "key_takeaway": "We talked taxes.",
                          "gesture": "nod"},
                "id": "tu_discuss",
            })
        return _ok(text="Business is steady, gracias for asking.")

    def get_usage_report(self) -> dict:
        return {
            "total_input_tokens": 0, "total_output_tokens": 0,
            "total_cache_read_tokens": 0, "total_cache_write_tokens": 0,
            "total_tokens": 0, "total_cost": 0.0,
            "total_calls": len(self.calls), "default_model": "fake",
            "provider": "fake",
        }

    def reset_usage(self) -> None:
        self.calls.clear()
