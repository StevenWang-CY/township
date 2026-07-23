"""
Provider abstraction tests: factory selection, Anthropic<->OpenAI
translation on the real tool schemas, MockProvider determinism/shape,
and the shared error-dict contract.

Everything here runs with zero credentials and zero network.
"""

import asyncio
import json
import sys

import pytest
from conftest import REPO_ROOT  # noqa: F401  (ensures sys.path setup ran)

from backend.providers import (
    AnthropicProvider,
    BedrockProvider,
    LLMProvider,
    MockProvider,
    OpenAICompatProvider,
    create_provider,
    translate,
)
from backend.tools.schemas import (
    classify_interaction_tool,
    discuss_tool,
    form_opinion_tool,
    react_to_news_tool,
)

CRED_ENV_VARS = (
    "LLM_PROVIDER",
    "ANTHROPIC_API_KEY",
    "AWS_BEARER_TOKEN_BEDROCK",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "ANTHROPIC_CACHE_SYSTEM",
    "BEDROCK_CACHE_SYSTEM",
)
MODEL_ENV_VARS = (
    "BEDROCK_MODEL_ID",
    "OPENAI_MODEL",
    "OPENROUTER_MODEL",
    "OLLAMA_MODEL",
    "LMSTUDIO_MODEL",
)

CARLOS_PROMPT = (
    "You are Carlos Restrepo, age 51. You own La Finca, a Colombian restaurant "
    "on Blackwell Street in Dover, NJ. The ACA premium went up to $1,400 again "
    "and the commercial lease is up 12%.\n\n"
    "--- YOUR CURRENT STANCE ---\n"
    "You are currently leaning toward: undecided (confidence: 30%)\n"
    "Top issues: healthcare, immigration, property taxes"
)

PRIYA_PROMPT = (
    "You are Priya Raman, age 34. You teach middle-school science in "
    "Parsippany, NJ, and worry constantly about schools funding, childcare "
    "costs, and property taxes."
)

USER_MSG = [{"role": "user", "content": "What matters most to you this election?"}]


def _clear_env(monkeypatch):
    for var in CRED_ENV_VARS + MODEL_ENV_VARS:
        monkeypatch.delenv(var, raising=False)


def run(coro):
    return asyncio.run(coro)


# ── Factory: explicit LLM_PROVIDER ─────────────────────────────


def test_factory_explicit_mock(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    assert isinstance(create_provider(), MockProvider)


def test_factory_explicit_bedrock(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "bedrock")
    provider = create_provider()
    assert isinstance(provider, BedrockProvider)
    assert provider.get_usage_report()["provider"] == "bedrock"


def test_bedrock_empty_model_uses_default(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("BEDROCK_MODEL_ID", "")

    provider = BedrockProvider()

    assert provider.get_usage_report()["default_model"].startswith("us.anthropic.")


def test_anthropic_family_prompt_cache_is_opt_in(monkeypatch):
    _clear_env(monkeypatch)
    bedrock = BedrockProvider()
    assert bedrock._cache_system is False

    monkeypatch.setenv("BEDROCK_CACHE_SYSTEM", "1")
    assert BedrockProvider()._cache_system is True

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    anthropic = AnthropicProvider()
    assert anthropic._cache_system is False

    monkeypatch.setenv("ANTHROPIC_CACHE_SYSTEM", "1")
    assert AnthropicProvider()._cache_system is True


def test_factory_explicit_anthropic(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    provider = create_provider()
    assert isinstance(provider, AnthropicProvider)
    assert provider.get_usage_report()["provider"] == "anthropic"


def test_factory_anthropic_without_key_raises(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        create_provider()


@pytest.mark.parametrize("name", ["openai", "openrouter", "ollama", "lmstudio"])
def test_factory_explicit_openai_family(monkeypatch, name):
    pytest.importorskip("openai")
    _clear_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", name)
    provider = create_provider()
    assert isinstance(provider, OpenAICompatProvider)
    assert provider.get_usage_report()["provider"] == name


def test_factory_openai_preset_default_model(monkeypatch):
    pytest.importorskip("openai")
    _clear_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    assert create_provider().get_usage_report()["default_model"] == "gpt-4.1-mini"


def test_factory_unknown_provider_raises(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "hal9000")
    with pytest.raises(ValueError, match="hal9000"):
        create_provider()


# ── Factory: auto-detection ────────────────────────────────────


def test_factory_autodetect_defaults_to_mock(monkeypatch):
    _clear_env(monkeypatch)
    assert isinstance(create_provider(), MockProvider)


def test_factory_autodetect_anthropic(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    assert isinstance(create_provider(), AnthropicProvider)


def test_factory_autodetect_bedrock(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("AWS_BEARER_TOKEN_BEDROCK", "test-token")
    assert isinstance(create_provider(), BedrockProvider)


def test_factory_autodetect_openai(monkeypatch):
    pytest.importorskip("openai")
    _clear_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    provider = create_provider()
    assert isinstance(provider, OpenAICompatProvider)
    assert provider.get_usage_report()["provider"] == "openai"


def test_factory_autodetect_openrouter(monkeypatch):
    pytest.importorskip("openai")
    _clear_env(monkeypatch)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    provider = create_provider()
    assert isinstance(provider, OpenAICompatProvider)
    assert provider.get_usage_report()["provider"] == "openrouter"


def test_factory_autodetect_anthropic_beats_bedrock(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("AWS_BEARER_TOKEN_BEDROCK", "test-token")
    assert isinstance(create_provider(), AnthropicProvider)


def test_openai_missing_package_error_mentions_extra(monkeypatch):
    # Simulate `openai` not being installed: None in sys.modules makes the
    # lazy import raise ImportError.
    monkeypatch.setitem(sys.modules, "openai", None)
    with pytest.raises(ImportError, match=r"township\[openai\]"):
        OpenAICompatProvider(
            base_url="http://localhost:1234/v1",
            api_key="k",
            default_model="local-model",
        )


# ── translate.py: round-trip on the real schemas ───────────────


@pytest.mark.parametrize("tool", [discuss_tool, form_opinion_tool])
def test_tool_schema_round_trip(tool):
    oai = translate.anthropic_tool_to_openai(tool)
    assert oai["type"] == "function"
    assert oai["function"]["name"] == tool["name"]
    assert oai["function"]["parameters"] == tool["input_schema"]

    back = translate.openai_tool_to_anthropic(oai)
    assert back["name"] == tool["name"]
    assert back["description"] == tool["description"]
    assert back["input_schema"] == tool["input_schema"]


def test_multiple_tool_defs_convert_in_order():
    converted = translate.anthropic_tools_to_openai(
        [discuss_tool, form_opinion_tool, react_to_news_tool]
    )
    assert [t["function"]["name"] for t in converted] == [
        "Discuss",
        "FormOpinion",
        "ReactToNews",
    ]
    assert translate.anthropic_tools_to_openai(None) == []


def test_openai_completion_with_tool_call_maps_to_contract():
    args = {
        "response": "I hear you.",
        "topic": "taxes",
        "sentiment": "neutral",
        "key_takeaway": "We talked taxes.",
    }
    completion = {
        "choices": [
            {
                "message": {
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_abc",
                            "type": "function",
                            "function": {"name": "Discuss", "arguments": json.dumps(args)},
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
        "usage": {"prompt_tokens": 120, "completion_tokens": 45},
    }
    result = translate.openai_completion_to_result(completion, cost=0.01)
    assert result["stop_reason"] == "tool_use"
    assert result["tool_use"] == {"name": "Discuss", "input": args, "id": "call_abc"}
    assert result["input_tokens"] == 120
    assert result["output_tokens"] == 45
    assert result["cost"] == 0.01
    assert result["text"] == ""


def test_openai_completion_text_finish_reasons():
    completion = {
        "choices": [{"message": {"content": "Hello there."}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 4},
    }
    result = translate.openai_completion_to_result(completion)
    assert result["text"] == "Hello there."
    assert result["tool_use"] is None
    assert result["stop_reason"] == "end_turn"

    completion["choices"][0]["finish_reason"] = "length"
    assert translate.openai_completion_to_result(completion)["stop_reason"] == "max_tokens"


def test_openai_completion_bad_tool_arguments_degrade_gracefully():
    completion = {
        "choices": [
            {
                "message": {
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_bad",
                            "function": {"name": "Discuss", "arguments": "{not valid json"},
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
    }
    result = translate.openai_completion_to_result(completion)
    assert result["tool_use"]["input"] == {}
    assert result["stop_reason"] == "tool_use"


# ── MockProvider ───────────────────────────────────────────────


@pytest.fixture()
def fast_mock(monkeypatch):
    monkeypatch.setenv("MOCK_DELAY_S", "0")
    return MockProvider


def test_mock_satisfies_protocol(fast_mock):
    assert isinstance(fast_mock(), LLMProvider)


def test_mock_determinism_same_inputs_same_outputs(fast_mock):
    r1 = run(fast_mock().call_agent(CARLOS_PROMPT, USER_MSG, tools=[discuss_tool]))
    r2 = run(fast_mock().call_agent(CARLOS_PROMPT, USER_MSG, tools=[discuss_tool]))
    assert r1 == r2


def test_mock_discuss_returns_valid_non_empty_message(fast_mock):
    result = run(fast_mock().call_agent(CARLOS_PROMPT, USER_MSG, tools=[discuss_tool]))
    assert result["stop_reason"] == "tool_use"
    tool_use = result["tool_use"]
    assert tool_use["name"] == "Discuss"
    payload = tool_use["input"]
    for field in discuss_tool["input_schema"]["required"]:
        assert payload.get(field), f"Discuss missing required field {field}"
    assert payload["sentiment"] in ("positive", "negative", "neutral")
    assert payload["gesture"] in discuss_tool["input_schema"]["properties"]["gesture"]["enum"]
    assert len(payload["response"]) > 20


def test_mock_form_opinion_validates_and_drifts_upward(fast_mock):
    provider = fast_mock()
    enum = form_opinion_tool["input_schema"]["properties"]["candidate"]["enum"]

    first = run(provider.call_agent(CARLOS_PROMPT, USER_MSG, tools=[form_opinion_tool]))
    second = run(provider.call_agent(CARLOS_PROMPT, USER_MSG, tools=[form_opinion_tool]))
    o1, o2 = first["tool_use"]["input"], second["tool_use"]["input"]

    assert o1["candidate"] in enum
    assert 0 <= o1["confidence"] <= 100
    assert o1["reasoning"]
    assert isinstance(o1["top_issues"], list) and o1["top_issues"]
    # Stance is stable per agent across calls; confidence drifts upward.
    assert o2["candidate"] == o1["candidate"]
    assert o2["confidence"] >= o1["confidence"]


def test_mock_different_agents_may_differ_but_stay_valid(fast_mock):
    provider = fast_mock()
    enum = form_opinion_tool["input_schema"]["properties"]["candidate"]["enum"]
    carlos = run(provider.call_agent(CARLOS_PROMPT, USER_MSG, tools=[form_opinion_tool]))
    priya = run(provider.call_agent(PRIYA_PROMPT, USER_MSG, tools=[form_opinion_tool]))
    assert carlos["tool_use"]["input"]["candidate"] in enum
    assert priya["tool_use"]["input"]["candidate"] in enum


def test_mock_react_to_news_fills_schema(fast_mock):
    news = [{"role": "user", "content": "Breaking: ICE raids increase 50% across Morris County."}]
    result = run(fast_mock().call_agent(CARLOS_PROMPT, news, tools=[react_to_news_tool]))
    payload = result["tool_use"]["input"]
    props = react_to_news_tool["input_schema"]["properties"]
    assert payload["emotional_response"] in props["emotional_response"]["enum"]
    assert payload["impact_on_vote"] in props["impact_on_vote"]["enum"]
    assert payload["magnitude"] in props["magnitude"]["enum"]
    assert payload["reasoning"] and payload["would_share_with"]


def test_mock_news_reactions_vary_across_personas_and_track_the_story(fast_mock):
    """God's View regression: reactions must not be near-verbatim template
    repeats, and the reasoning must engage the story's actual topic instead
    of a mismatched persona noun (Rabbi + healthcare news != college rant)."""
    provider = fast_mock()
    news = [
        {
            "role": "user",
            "content": (
                "BREAKING: Statewide healthcare premiums will rise 22% next "
                "year, insurers confirmed this morning."
            ),
        }
    ]
    rosters = [
        ("Carlos Restrepo", "healthcare, immigration, property taxes"),
        ("Priya Raman", "schools funding, childcare, property taxes"),
        ("David Goldstein", "college affordability, healthcare, housing"),
        ("Maria Santos", "housing, rent, wages"),
        ("Tom Whitfield", "small business, taxes, traffic"),
        ("Aisha Bello", "childcare, healthcare, transit"),
        ("Frank Novak", "property taxes, public safety, jobs"),
        ("Lena Park", "transit, cost of living, schools"),
        ("Omar Haddad", "jobs, wages, immigration"),
        ("Grace Chen", "education, college, housing"),
        ("Sal Marino", "small business, insurance, traffic"),
        ("Ruth Adler", "healthcare, cost of living, transit"),
    ]
    reasonings = []
    for persona_name, issues in rosters:
        prompt = (
            f"You are {persona_name}, a longtime resident of Dover, NJ.\n"
            f"Top issues: {issues}"
        )
        result = run(provider.call_agent(prompt, news, tools=[react_to_news_tool]))
        reasonings.append(result["tool_use"]["input"]["reasoning"])

    # The whole cast must not read from one script.
    assert len(set(reasonings)) >= 10, reasonings
    # Every reaction engages the story's own topic — no mismatched nouns.
    assert all("healthcare" in r for r in reasonings), reasonings


def test_mock_news_reaction_prefers_concern_the_story_touches(fast_mock):
    """When the story hits one of the agent's own issues, the stake line
    speaks to that issue rather than an unrelated one."""
    provider = fast_mock()
    prompt = (
        "You are Nadia Osei, a nurse in Morristown, NJ.\n"
        "Top issues: childcare, transit, wages"
    )
    news = [
        {
            "role": "user",
            "content": "BREAKING: County slashes transit funding for 2027.",
        }
    ]
    result = run(provider.call_agent(prompt, news, tools=[react_to_news_tool]))
    reasoning = result["tool_use"]["input"]["reasoning"]
    assert "transit" in reasoning
    assert "childcare" not in reasoning and "wages" not in reasoning


def test_mock_classify_interaction_fills_schema(fast_mock):
    result = run(fast_mock().call_agent(CARLOS_PROMPT, USER_MSG, tools=[classify_interaction_tool]))
    payload = result["tool_use"]["input"]
    assert payload["tone"] in ("agreeable", "challenging", "curious", "hostile")
    assert -15 <= payload["trust_delta"] <= 15
    assert payload["reasoning"]


def test_mock_plain_chat_returns_text(fast_mock):
    result = run(fast_mock().call_agent(CARLOS_PROMPT, USER_MSG, tools=None))
    assert result["tool_use"] is None
    assert result["stop_reason"] == "end_turn"
    assert len(result["text"]) > 20
    # Deterministic here too.
    again = run(fast_mock().call_agent(CARLOS_PROMPT, USER_MSG, tools=None))
    assert again["text"] == result["text"]


def test_mock_usage_report_and_reset(fast_mock):
    provider = fast_mock()
    run(provider.call_agent(CARLOS_PROMPT, USER_MSG, tools=[discuss_tool]))
    report = provider.get_usage_report()
    assert report["provider"] == "mock"
    assert report["total_cost"] == 0.0
    assert report["total_calls"] == 1
    assert report["total_tokens"] > 0
    provider.reset_usage()
    assert provider.get_usage_report()["total_calls"] == 0


# ── Error contract ─────────────────────────────────────────────


def test_provider_error_contract_preserved(monkeypatch):
    provider = BedrockProvider(max_concurrent=1)

    async def boom(**kwargs):
        raise RuntimeError("simulated outage")

    monkeypatch.setattr(provider._client.messages, "create", boom)
    result = run(provider.call_agent("system", [{"role": "user", "content": "hi"}]))
    assert result["stop_reason"] == "error"
    assert "simulated outage" in result["error"]
    assert result["tool_use"] is None
    assert result["cost"] == 0.0
    assert result["text"].startswith("[API Error:")


# ── App wiring ─────────────────────────────────────────────────


def test_app_state_llm_aliases_anthropic_client():
    from backend.main import app

    assert app.state.llm is app.state.anthropic_client
