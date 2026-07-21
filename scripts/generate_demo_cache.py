#!/usr/bin/env python3
"""
Generate a scenario's shipped demo replay cache.

Runs a full headless simulation and writes the minified event cache to
``scenarios/<id>/demo/simulation_cache.json`` (or ``--out``) — the file
``/api/simulation/replay`` and the demo player use as their default source.

Real caches should come from a real provider; the deterministic mock is
refused unless ``--allow-mock`` is passed (mock caches are fine for CI and
the millbrook demo, but a flagship cache should be a real deliberation).

Usage:
    python scripts/generate_demo_cache.py --scenario nj11-2026 --provider bedrock
    python scripts/generate_demo_cache.py --scenario millbrook-budget --provider mock --allow-mock
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

SIZE_BUDGET_BYTES = 3 * 1024 * 1024  # 3MB — the demo-cache budget


def _mb(n: int) -> str:
    return f"{n / (1024 * 1024):.2f}MB"


def _trim_events(events: list[dict]) -> list[dict]:
    """Shrink an oversized cache while keeping the replay watchable.

    Drops the highest-volume/lowest-signal movement events first, then
    truncates long prose fields. Private events are already excluded by the
    orchestrator's serialization boundary.
    """
    slimmed = [e for e in events if e.get("type") != "agent_moved"]
    for event in slimmed:
        for key in ("text", "description"):
            value = event.get(key)
            if isinstance(value, str) and len(value) > 280:
                event[key] = value[:277] + "..."
        for opinion_key in ("old_opinion", "new_opinion"):
            opinion = event.get(opinion_key)
            if isinstance(opinion, dict) and isinstance(opinion.get("reasoning"), str):
                if len(opinion["reasoning"]) > 280:
                    opinion["reasoning"] = opinion["reasoning"][:277] + "..."
    return slimmed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument(
        "--scenario",
        default=os.environ.get("SCENARIO", "nj11-2026"),
        help="Scenario id under scenarios/ (default: nj11-2026)",
    )
    parser.add_argument(
        "--provider",
        default=None,
        help="LLM provider (sets LLM_PROVIDER: bedrock|anthropic|openai|mock|...)",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="Output path (default: scenarios/<id>/demo/simulation_cache.json)",
    )
    parser.add_argument(
        "--allow-mock",
        action="store_true",
        help="Permit generating the cache with the deterministic mock provider",
    )
    parser.add_argument(
        "--trim",
        action="store_true",
        help="If the cache exceeds 3MB, drop low-signal events and truncate prose",
    )
    args = parser.parse_args()

    if args.provider:
        os.environ["LLM_PROVIDER"] = args.provider
    os.environ.setdefault("MOCK_DELAY_S", "0")

    from backend.core.artifacts import artifact_version_fields
    from backend.core.event_bus import EventBus
    from backend.core.scenario import load_scenario_with_fallback
    from backend.core.storage import save_json_atomic
    from backend.providers import create_provider
    from backend.simulation.orchestrator import SimulationOrchestrator

    scenario = load_scenario_with_fallback(args.scenario)
    provider = create_provider(max_concurrent=10)
    provider_name = provider.get_usage_report().get("provider", "unknown")

    if provider_name == "mock" and not args.allow_mock:
        print(
            "Refusing to generate a demo cache with the mock provider — mock "
            "conversations are canned. Pass --allow-mock if that is intentional "
            "(e.g. the millbrook CI demo), or set a real provider via --provider.",
            file=sys.stderr,
        )
        return 2

    print(f"Scenario: {scenario.id} — {scenario.title}")
    print(f"Provider: {provider_name}")

    bus = EventBus()
    orchestrator = SimulationOrchestrator(
        anthropic_client=provider, event_bus=bus, scenario=scenario
    )
    district = asyncio.run(orchestrator.run_full_simulation())

    events = orchestrator._serialized_events()
    usage = provider.get_usage_report()
    cache = {
        **artifact_version_fields(),
        "events": events,
        "district_summary": district.model_dump() if district else None,
        "usage": usage,
        "responsible_use": scenario.responsible_use.model_dump(),
    }

    out = Path(args.out) if args.out else scenario.scenario_dir / "demo" / "simulation_cache.json"
    save_json_atomic(out, cache, minify=True)
    size = out.stat().st_size
    print(f"Wrote {out} — {_mb(size)}, {len(events)} events ({len(bus.get_event_log())} in log)")
    print(f"Cost: ${usage.get('total_cost', 0):.4f} across {usage.get('total_calls', 0)} calls")

    if size > SIZE_BUDGET_BYTES:
        if args.trim:
            cache["events"] = _trim_events(events)
            save_json_atomic(out, cache, minify=True)
            size = out.stat().st_size
            print(f"Trimmed to {_mb(size)}, {len(cache['events'])} events")
            if size > SIZE_BUDGET_BYTES:
                print(
                    f"WARNING: still over the {_mb(SIZE_BUDGET_BYTES)} budget after trim",
                    file=sys.stderr,
                )
        else:
            print(
                f"WARNING: cache exceeds the {_mb(SIZE_BUDGET_BYTES)} budget — re-run with --trim",
                file=sys.stderr,
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
