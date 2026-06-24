# -*- coding: utf-8 -*-
"""
SWE-bench evaluation support for the OpenAgents Workspace.

SWE-bench is a *benchmark / evaluation* capability — NOT an agent. It reuses a
connected coding agent to solve a benchmark instance, then runs the official
SWE-bench Docker harness to grade the result. Nothing here registers an agent
adapter or appears in any agent install list.

Heavy/optional third-party imports (``swebench``, ``datasets``, the ``docker``
CLI) are made lazily inside functions so the workspace backend imports and
boots even when SWE-bench is not installed/enabled.
"""

from .config import config  # noqa: F401
