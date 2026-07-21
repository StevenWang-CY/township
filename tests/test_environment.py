"""Local dotenv loading is early, predictable, and never overrides the shell."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import backend.env as township_env

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_environment_precedence(tmp_path, monkeypatch):
    working = tmp_path / "working"
    repository = tmp_path / "repository"
    working.mkdir()
    repository.mkdir()
    (repository / "pyproject.toml").write_text("[project]\nname='probe'\n")
    (working / ".env").write_text(
        "TOWNSHIP_ENV_PRECEDENCE=working\n"
        "TOWNSHIP_ENV_WORKING_ONLY=yes\n"
        "TOWNSHIP_ENV_PREEXISTING=dotenv\n"
    )
    (repository / ".env").write_text(
        "TOWNSHIP_ENV_PRECEDENCE=repository\nTOWNSHIP_ENV_REPOSITORY_ONLY=yes\n"
    )

    monkeypatch.setattr(township_env, "REPOSITORY_ROOT", repository)
    monkeypatch.setenv("TOWNSHIP_ENV_PREEXISTING", "shell")
    monkeypatch.delenv("TOWNSHIP_ENV_PRECEDENCE", raising=False)
    monkeypatch.delenv("TOWNSHIP_ENV_WORKING_ONLY", raising=False)
    monkeypatch.delenv("TOWNSHIP_ENV_REPOSITORY_ONLY", raising=False)

    loaded = township_env.load_environment(cwd=working)

    assert loaded == ((working / ".env").resolve(), (repository / ".env").resolve())
    assert os.environ["TOWNSHIP_ENV_PRECEDENCE"] == "working"
    assert os.environ["TOWNSHIP_ENV_WORKING_ONLY"] == "yes"
    assert os.environ["TOWNSHIP_ENV_REPOSITORY_ONLY"] == "yes"
    assert os.environ["TOWNSHIP_ENV_PREEXISTING"] == "shell"


def test_backend_import_loads_cwd_dotenv_without_overriding_shell(tmp_path):
    (tmp_path / ".env").write_text(
        "TOWNSHIP_ENV_IMPORT_PROBE=dotenv\nTOWNSHIP_ENV_SHELL_PROBE=dotenv\n"
    )
    environment = os.environ.copy()
    environment["TOWNSHIP_ENV_SHELL_PROBE"] = "shell"
    environment.pop("TOWNSHIP_ENV_IMPORT_PROBE", None)
    environment["PYTHONPATH"] = os.pathsep.join(
        [str(PROJECT_ROOT), environment.get("PYTHONPATH", "")]
    ).rstrip(os.pathsep)

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import os, backend; "
                "print(os.environ['TOWNSHIP_ENV_IMPORT_PROBE']); "
                "print(os.environ['TOWNSHIP_ENV_SHELL_PROBE'])"
            ),
        ],
        cwd=tmp_path,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )

    assert result.stdout.splitlines() == ["dotenv", "shell"]
