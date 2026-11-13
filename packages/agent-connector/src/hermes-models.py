"""Read the active Hermes provider's model picker without starting a chat or setup.

Run with Hermes's own Python, so provider resolution, OAuth and discovery use
the same installed version and HERMES_HOME as the agent. Only model names leave
this process; provider credentials and exception messages never do.
"""

import contextlib
import io
import json
import os
import sys
from pathlib import Path


def model_catalog(profile=None):
    # `hermes chat` applies the sticky active profile before importing config.
    # A specific HERMES_HOME already supplied by the caller takes precedence.
    try:
        from hermes_cli.profiles import get_active_profile, resolve_profile_env
    except ImportError:
        pass  # Older Hermes releases had only the default home.
    else:
        home = os.environ.get("HERMES_HOME", "")
        if profile or not home or Path(home).parent.name != "profiles":
            selected = profile or get_active_profile()
            if selected and selected != "default":
                os.environ["HERMES_HOME"] = resolve_profile_env(selected)

    from hermes_cli.config import load_config
    from hermes_cli.auth import resolve_provider

    config = load_config()
    model = config.get("model", {})
    current = model.get("default") or model.get("name") if isinstance(model, dict) else model
    try:
        from hermes_cli.runtime_provider import resolve_requested_provider
        requested = resolve_requested_provider()
    except ImportError:
        requested = (model.get("provider") if isinstance(model, dict) else None) or os.getenv("HERMES_INFERENCE_PROVIDER") or "auto"
    provider = resolve_provider(requested)
    from hermes_cli import models

    # Newer Hermes caches discovery by provider and credential fingerprint.
    discover = getattr(models, "cached_provider_model_ids", None) or getattr(models, "provider_model_ids", None)
    try:
        listed = list(discover(provider)) if discover else []
    except Exception:
        listed = []
    # A working configured model remains selectable during discovery failures.
    if isinstance(current, str) and current.strip() and current not in listed:
        listed.insert(0, current.strip())
    return {"provider": provider, "models": listed}


if __name__ == "__main__":
    try:
        # Provider libraries can print diagnostics. Never forward them (or keys).
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = model_catalog(sys.argv[1] if len(sys.argv) > 1 else None)
    except Exception:
        result = {"provider": "", "models": []}
    print(json.dumps(result, ensure_ascii=True))
