"""
Budget guard for API-key providers.

A campaign is dozens of beats; the guard stops a run cleanly before the next
beat would push spend past the limit. Providers that cost nothing at the
margin (the mock, the subscription CLI) report `total_cost` 0 and never trip
it. The limit comes from the start request or `LLM_BUDGET_USD`.
"""

from __future__ import annotations

import os

# Seeded from a measured 405-call / $7.33 Sonnet run.
DEFAULT_MEAN_COST_USD = 0.018


class BudgetGuard:
    def __init__(self, limit_usd: float | None, provider, *, baseline: dict | None = None) -> None:
        env = os.environ.get("LLM_BUDGET_USD")
        if limit_usd is None and env:
            try:
                limit_usd = float(env)
            except ValueError:
                limit_usd = None
        self.limit = limit_usd if limit_usd and limit_usd > 0 else None
        self.provider = provider
        base = baseline or (provider.get_usage_report() if provider is not None else {})
        self._base_cost = float(base.get("total_cost", 0.0) or 0.0)
        self._base_calls = int(base.get("total_calls", 0) or 0)
        # Providers that bill nothing at the margin never trip the guard.
        name = str(base.get("provider") or getattr(provider, "provider_name", "") or "")
        self.free = name in {"mock", "claude-cli"} or base.get("billing") == "subscription"

    @property
    def spent(self) -> float:
        report = self.provider.get_usage_report() if self.provider is not None else {}
        return max(0.0, float(report.get("total_cost", 0.0) or 0.0) - self._base_cost)

    @property
    def calls(self) -> int:
        report = self.provider.get_usage_report() if self.provider is not None else {}
        return max(0, int(report.get("total_calls", 0) or 0) - self._base_calls)

    @property
    def mean_cost(self) -> float:
        calls = self.calls
        if calls >= 10 and self.spent > 0:
            return self.spent / calls
        return DEFAULT_MEAN_COST_USD if self.spent > 0 or calls == 0 else 0.0

    def estimate(self, planned_calls: int) -> float:
        return planned_calls * self.mean_cost

    def should_stop(self, planned_calls: int) -> bool:
        """True when the next beat would exceed the limit (never for free providers)."""
        if self.limit is None or self.free:
            return False
        if self.calls >= 10 and self.spent == 0.0:
            return False  # a provider that bills nothing
        return self.spent + self.estimate(planned_calls) > self.limit

    def snapshot(self, planned_calls: int = 0) -> dict:
        return {
            "spent": round(self.spent, 4),
            "limit": self.limit,
            "estimate_per_beat": round(self.estimate(planned_calls), 4),
            "calls": self.calls,
        }
