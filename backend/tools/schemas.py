"""
Claude tool-use schemas for civic simulation tools.
These dicts follow the Anthropic SDK tool format for the `tools` parameter.
"""

discuss_tool = {
    "name": "Discuss",
    "description": (
        "Have a conversation with another person about the NJ-11 special election. "
        "Express your genuine views based on your life experience, concerns, and values. "
        "Respond naturally as yourself — agree, disagree, ask questions, share stories. "
        "Stay in character and reference specific local issues that matter to you."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "response": {
                "type": "string",
                "description": (
                    "Your conversational response to the other person. "
                    "Speak naturally in your own voice. 2-4 sentences. "
                    "Reference specific local issues, personal experiences, or candidates."
                ),
            },
            "topic": {
                "type": "string",
                "description": "The main topic or issue being discussed in this exchange.",
            },
            "sentiment": {
                "type": "string",
                "enum": ["positive", "negative", "neutral"],
                "description": "Your overall emotional tone in this response.",
            },
            "key_takeaway": {
                "type": "string",
                "description": (
                    "One sentence summary of what you learned or felt from this exchange. "
                    "This becomes a memory you carry forward."
                ),
            },
            "gesture": {
                "type": "string",
                "enum": ["nod", "shake_head", "shrug", "laugh", "point", "none"],
                "description": (
                    "Body-language gesture that accompanies this line. Optional — "
                    "pick the gesture that best fits the tone of your response."
                ),
            },
        },
        "required": ["response", "topic", "sentiment", "key_takeaway"],
    },
}

form_opinion_tool = {
    "name": "FormOpinion",
    "description": (
        "Crystallize your current stance on the NJ-11 special election. "
        "Based on everything you know — candidate positions, conversations you've had, "
        "news you've seen, and your own life circumstances — state who you're leaning toward "
        "and why. Be honest about your confidence level and what could change your mind."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "candidate": {
                "type": "string",
                "enum": ["mejia", "hathaway", "bond", "undecided"],
                "description": "Which candidate you currently support or lean toward.",
            },
            "confidence": {
                "type": "integer",
                "minimum": 0,
                "maximum": 100,
                "description": (
                    "How confident you are in this choice (0-100). "
                    "0 = completely unsure, 100 = absolutely certain."
                ),
            },
            "reasoning": {
                "type": "string",
                "description": (
                    "2-3 sentences explaining why you lean this way. "
                    "Reference specific policies, conversations, or personal circumstances."
                ),
            },
            "top_issues": {
                "type": "array",
                "items": {"type": "string"},
                "description": "The 2-4 issues most important to your vote, ranked by priority.",
            },
            "dealbreaker": {
                "type": "string",
                "description": (
                    "One thing that could make you switch candidates entirely. "
                    "Null if nothing would change your mind."
                ),
            },
        },
        "required": ["candidate", "confidence", "reasoning", "top_issues"],
    },
}

react_to_news_tool = {
    "name": "ReactToNews",
    "description": (
        "React to a news event or new information about the NJ-11 election. "
        "Respond emotionally and authentically based on your personal circumstances "
        "and values. Consider how this news affects your community and your vote."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "emotional_response": {
                "type": "string",
                "enum": ["angry", "hopeful", "anxious", "indifferent", "confused"],
                "description": "Your primary emotional reaction to this news.",
            },
            "impact_on_vote": {
                "type": "string",
                "enum": [
                    "strengthens_current",
                    "weakens_current",
                    "changes_mind",
                    "no_effect",
                ],
                "description": "How this news affects your current voting intention.",
            },
            "reasoning": {
                "type": "string",
                "description": (
                    "2-3 sentences explaining your reaction. "
                    "Reference how this personally affects you, your family, or your community."
                ),
            },
            "would_share_with": {
                "type": "string",
                "description": (
                    "Who in your community would you talk to about this news? "
                    "Name a specific person or group."
                ),
            },
            "magnitude": {
                "type": "string",
                "enum": ["none", "minor", "moderate", "major"],
                "description": (
                    "How big a deal this news feels to you personally. Optional — "
                    "default to 'minor' for routine items, 'major' if it directly threatens "
                    "you or your family."
                ),
            },
        },
        "required": ["emotional_response", "impact_on_vote", "reasoning", "would_share_with"],
    },
}


classify_interaction_tool = {
    "name": "ClassifyInteraction",
    "description": (
        "Classify how a person interacted with you in a conversation so you can adjust "
        "your level of trust toward them. Call this AFTER an exchange, reflecting on the "
        "tone of the exchange overall."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "tone": {
                "type": "string",
                "enum": ["agreeable", "challenging", "curious", "hostile"],
                "description": (
                    "The dominant tone of the person's behavior toward you. "
                    "'agreeable' = warmly supportive; 'challenging' = pushes back but "
                    "respectfully; 'curious' = sincerely asking and listening; "
                    "'hostile' = rude, dismissive, or attacking."
                ),
            },
            "trust_delta": {
                "type": "integer",
                "minimum": -15,
                "maximum": 15,
                "description": (
                    "Change in trust toward this person. Positive numbers increase trust "
                    "(0..+15); negative numbers decrease it (-15..0). Typical values: "
                    "+5 curious, +3 agreeable, -2 challenging, -10 hostile."
                ),
            },
            "reasoning": {
                "type": "string",
                "description": "One sentence explaining why this trust change feels right.",
            },
        },
        "required": ["tone", "trust_delta", "reasoning"],
    },
}


TOOL_REGISTRY: dict[str, dict] = {
    "Discuss": discuss_tool,
    "FormOpinion": form_opinion_tool,
    "ReactToNews": react_to_news_tool,
    "ClassifyInteraction": classify_interaction_tool,
}


def get_tools(tool_names: list[str]) -> list[dict]:
    """Return tool schema dicts for the given tool names."""
    tools = []
    for name in tool_names:
        if name in TOOL_REGISTRY:
            tools.append(TOOL_REGISTRY[name])
    return tools
