"""Load Township's local environment file before configuration is imported.

Process environment variables always win.  A ``.env`` in the current working
directory takes precedence over the source checkout's ``.env``; the latter is
also considered so commands launched from a repository subdirectory behave as
documented.  Installed wheels only inspect the working directory because their
site-packages parent is not a source checkout.
"""

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


def load_environment(*, cwd: Path | None = None) -> tuple[Path, ...]:
    """Load local dotenv files without replacing explicit process variables."""
    working_directory = (cwd or Path.cwd()).resolve()
    candidates = [working_directory / ".env"]

    # In an installed wheel REPOSITORY_ROOT is site-packages.  Only treat it as
    # a repository when its pyproject is present; this avoids reading an
    # unrelated site-packages/.env file.
    if (REPOSITORY_ROOT / "pyproject.toml").is_file():
        candidates.append(REPOSITORY_ROOT / ".env")

    loaded: list[Path] = []
    seen: set[Path] = set()
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        if resolved.is_file():
            load_dotenv(dotenv_path=resolved, override=False)
            loaded.append(resolved)
    return tuple(loaded)
