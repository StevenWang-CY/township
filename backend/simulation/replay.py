import asyncio
import json
import logging
from pathlib import Path

from ..core.artifacts import (
    ArtifactFormatError,
    ArtifactPrivacyError,
    require_replay_artifact,
)
from ..core.event_bus import EventBus
from ..core.types import (
    PRIVATE_EVENT_TYPES,
    AgentMovedEvent,
    AgentSpeechEvent,
    ConversationEndedEvent,
    ConversationStartedEvent,
    CrossTownGossipEvent,
    GodsViewResultEvent,
    GodViewInjectionEvent,
    NewsInjectedEvent,
    NewsReactionEvent,
    OpinionChangedEvent,
    RelationshipUpdateEvent,
    RoundEndedEvent,
    RoundStartedEvent,
    SimulationEndedEvent,
    SimulationStartedEvent,
    WeatherChangedEvent,
    WorldClockTickEvent,
)

logger = logging.getLogger(__name__)

# Map event type strings to their Pydantic model classes (past-tense, current).
EVENT_TYPE_MAP = {
    "round_started": RoundStartedEvent,
    "round_ended": RoundEndedEvent,
    "agent_moved": AgentMovedEvent,
    "agent_speech": AgentSpeechEvent,
    "conversation_started": ConversationStartedEvent,
    "conversation_ended": ConversationEndedEvent,
    "opinion_changed": OpinionChangedEvent,
    "news_injected": NewsInjectedEvent,
    "news_reaction": NewsReactionEvent,
    "cross_town_gossip": CrossTownGossipEvent,
    "god_view_injection": GodViewInjectionEvent,
    "gods_view_result": GodsViewResultEvent,
    "simulation_started": SimulationStartedEvent,
    "simulation_ended": SimulationEndedEvent,
    "world_clock_tick": WorldClockTickEvent,
    "weather_changed": WeatherChangedEvent,
    "relationship_update": RelationshipUpdateEvent,
}

# Delay between events by type (seconds at 1x speed)
EVENT_DELAYS = {
    "round_started": 1.0,
    "round_ended": 0.4,
    "agent_moved": 0.3,
    "agent_speech": 1.5,
    "conversation_started": 0.5,
    "conversation_ended": 0.3,
    "opinion_changed": 0.8,
    "news_injected": 2.0,
    "news_reaction": 0.4,
    "cross_town_gossip": 1.0,
    "god_view_injection": 2.0,
    "gods_view_result": 0.5,
    "simulation_started": 0.5,
    "simulation_ended": 0.0,
    "world_clock_tick": 0.1,
    "weather_changed": 0.5,
    "relationship_update": 0.2,
}


def _deserialize_event(event_data: dict):
    """Convert a raw event dict back into a typed Pydantic event."""
    event_type = event_data.get("type", "unknown")
    model_class = EVENT_TYPE_MAP.get(event_type)
    if model_class:
        try:
            return model_class.model_validate(event_data)
        except Exception as e:
            logger.warning(f"Failed to deserialize event type '{event_type}': {e}")
            return None
    else:
        logger.warning(f"Unknown event type: {event_type}")
        return None


async def replay(event_bus: EventBus, cache_path: str, speed: float = 1.0):
    """
    Load cached simulation from JSON, emit events through event_bus at controlled speed.

    Args:
        event_bus: The EventBus to publish replay events to.
        cache_path: Path to the simulation_cache.json file.
        speed: Playback speed multiplier. 1.0 = real-time, 2.0 = double speed, 0.5 = half speed.
    """
    path = Path(cache_path)
    if not path.exists():
        logger.error(f"Cache file not found: {cache_path}")
        return

    with open(path) as f:
        cache_data = json.load(f)
    events = require_replay_artifact(cache_data)
    logger.info(f"Replaying {len(events)} events at {speed}x speed from {cache_path}")

    speed = max(0.1, speed)  # Minimum 0.1x to prevent division issues

    for event_data in events:
        event_type = event_data.get("type", "unknown")
        if event_type in PRIVATE_EVENT_TYPES:
            logger.warning("Skipping private event type during replay: %s", event_type)
            continue
        event = _deserialize_event(event_data)
        if event is None:
            continue

        # Publish the event
        await event_bus.publish(event)

        # Wait based on event type and speed
        base_delay = EVENT_DELAYS.get(event_type, 0.5)
        actual_delay = base_delay / speed

        if actual_delay > 0:
            await asyncio.sleep(actual_delay)

    logger.info("Replay complete")


async def load_cache_summary(cache_path: str) -> dict:
    """Load just the summary data from a cache file without replaying."""
    path = Path(cache_path)
    if not path.exists():
        logger.warning("Replay cache does not exist: %s", path)
        return {"error": "cache_not_found"}

    try:
        with open(path) as f:
            cache_data = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Replay cache could not be read: %s", exc)
        return {"error": "cache_invalid"}

    try:
        events = require_replay_artifact(cache_data)
    except ArtifactPrivacyError:
        logger.warning("Refusing an unversioned replay artifact: %s", path)
        return {"error": "legacy_artifact_restricted"}
    except ArtifactFormatError as exc:
        logger.warning("Replay cache has an invalid shape: %s", exc)
        return {"error": "cache_invalid"}

    return {
        "total_events": sum(
            event.get("type") not in PRIVATE_EVENT_TYPES
            for event in events
            if isinstance(event, dict)
        ),
        "district_summary": cache_data.get("district_summary"),
        "usage": cache_data.get("usage"),
    }
