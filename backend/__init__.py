"""Township backend package.

Importing the package loads local configuration before modules such as storage
and provider selection bind their environment-backed defaults.
"""

from .env import load_environment as _load_environment

_load_environment()

del _load_environment
