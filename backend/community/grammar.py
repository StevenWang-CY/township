"""
The argument grammar neighbors speak with: short, persona-flavoured lines
built from a stance clause and an issue clause. No model is called; every
line is a deterministic function of (speaker, listener, topic, stance,
seed). Voices keep the LLM; this is the sound of the rest of the town.
"""

from __future__ import annotations

import random

_OPENERS_BY_LANGUAGE = {
    "spanish": ["Mira,", "Oye,", "Bueno,", "Te digo,"],
    "default": [
        "Honestly,",
        "Look,",
        "I'll tell you,",
        "Between us,",
        "The way I see it,",
        "You know,",
    ],
}

_CASE_FOR = [
    "{option} is the only one talking straight about {issue}.",
    "on {issue}, {option} actually has a plan — the rest is noise.",
    "I keep coming back to {option} because of {issue}.",
    "{option}, mostly over {issue}. Nothing else has moved me.",
    "if {issue} matters to you, it's {option}. Full stop.",
]
_CASE_AGAINST = [
    "I can't get past what that means for {issue}.",
    "that's not going to help with {issue}, whatever they say.",
    "on {issue} I've heard it all before, and it never lands.",
]
_UNDECIDED = [
    "on {issue} I go back and forth. Nobody's convinced me yet.",
    "I'm still weighing {issue}. Ask me next week.",
    "{issue} is the thing, and I don't hear a real answer on it from anyone.",
    "I'll decide late. {issue} is what I'm watching.",
]
_AGREE = [
    "Glad we see {issue} the same way.",
    "That's what I've been saying about {issue}.",
    "Right — {issue}. Same here.",
]
_ASK = [
    "What's pushing you toward {option}?",
    "So {option} — why?",
    "Convince me on {issue}.",
]
_TAKEAWAY = [
    "{partner} and I keep landing on {issue}.",
    "{partner} makes a decent case on {issue}.",
    "Nothing new from {partner}, but {issue} came up again.",
]


def _opener(rng: random.Random, language: str) -> str:
    key = "spanish" if "spanish" in (language or "").lower() else "default"
    return rng.choice(_OPENERS_BY_LANGUAGE[key])


def speak(
    *,
    speaker_name: str,
    speaker_language: str,
    speaker_occupation: str,
    listener_name: str,
    topic: str,
    stance_label: str | None,
    listener_stance_label: str | None,
    undecided: bool,
    agree: bool,
    seed: str,
) -> tuple[str, str, str]:
    """Return (line, sentiment, takeaway) for one exchange."""
    rng = random.Random(seed)
    issue = topic.strip().rstrip(".") or "all of it"
    opener = _opener(rng, speaker_language)
    if undecided or not stance_label:
        if listener_stance_label and rng.random() < 0.5:
            body = rng.choice(_ASK).format(option=listener_stance_label, issue=issue)
        else:
            body = rng.choice(_UNDECIDED).format(issue=issue)
        sentiment = "neutral"
    elif agree:
        body = (
            rng.choice(_AGREE).format(issue=issue)
            + " "
            + rng.choice(_CASE_FOR).format(option=stance_label, issue=issue)
        )
        sentiment = "positive"
    else:
        body = rng.choice(_CASE_FOR).format(option=stance_label, issue=issue)
        if listener_stance_label and rng.random() < 0.5:
            body += " " + rng.choice(_CASE_AGAINST).format(issue=issue)
        sentiment = "negative" if listener_stance_label else "neutral"
    line = f"{opener} {body}"
    line = line[0].upper() + line[1:]
    takeaway = rng.choice(_TAKEAWAY).format(partner=listener_name.split()[0], issue=issue)
    return line, sentiment, takeaway


def react(
    *, name: str, language: str, headline: str, impact: str, emotion: str, concern: str, seed: str
) -> str:
    rng = random.Random(seed)
    opener = _opener(rng, language)
    hook = {
        "changes_mind": "that changes things for me",
        "strengthens_current": "that's exactly why I'm where I am",
        "weakens_current": "that gives me pause, honestly",
        "no_effect": "that doesn't move me much",
    }.get(impact, "that's something")
    feel = {
        "angry": "It makes me angry.",
        "anxious": "It worries me.",
        "hopeful": "It gives me some hope.",
        "confused": "I don't know what to make of it.",
        "indifferent": "Same as ever.",
    }.get(emotion, "")
    return f"{opener} {hook} — it comes down to {concern}. {feel}".strip()
