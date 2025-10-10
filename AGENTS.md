# Repository Guidelines

## Project Structure & Module Organization
Source code lives in `src/openagents`, split into `agents/`, `core/`, `mods/`, `workspace/`, and related helpers. Templates and configs sit in `src/openagents/templates` and `config/`. Tests mirror the package layout inside `tests/` using `test_*.py`. The Studio front end is in `studio/`, while docs and assets live in `docs/`. Example workspaces are under `examples/` and `demos/`.

## Build, Test, and Development Commands
Install dependencies in editable mode with dev extras via `pip install -e .[dev]`. Run the Python suite using `pytest`, and add coverage with `pytest --cov=src/openagents --cov-report=term-missing`. For the Studio, run `npm install` then `npm start` from `studio/`. To boot the stack, use `docker compose up --build`; to rely on the published image with the bundled sample agent, run `docker compose -f docker-compose.remote.yml up -d`. All workflows are mirrored by the top-level `Makefile`; run `make help` for shortcuts like `make install-dev`, `make test`, `make docker-up`, and `make docker-remote-up`.

## Coding Style & Naming Conventions
Python code should pass Black (line length 88) and Flake8; run `black src tests` and `flake8 src tests` before submitting. Use type hints, `snake_case` functions, `PascalCase` classes, and `SCREAMING_SNAKE_CASE` constants. CLI extensions belong in `openagents.cli`. On the front end, follow the existing Tailwind + React patterns in `studio/src` and colocate component assets.

## Testing Guidelines
Pytest with `pytest-asyncio` powers async tests; decorate coroutines with `@pytest.mark.asyncio`. Keep test files as `test_<module>.py` and mirror package paths. Changes to transports or mods should add integration-style tests beneath `tests/<domain>/`. Maintain or raise the coverage configured in `pyproject.toml` and include regression cases for reported bugs.

## Commit & Pull Request Guidelines
Use concise, imperative commit subjects (example: `Add grpc transport healthcheck`), optionally followed by wrapped body paragraphs at 72 characters. Reference GitHub issues with `Fixes #123` when applicable. Every pull request should outline the change, testing performed, and any docs or config updates. Include screenshots for Studio UI tweaks and attach sample commands for new CLI behavior. Run the full lint and test suite before requesting review, and ensure the PR passes existing GitHub Actions checks.

## Agent & Network Tips
When contributing new agents, place reusable logic under `src/openagents/agents` and keep workspace scaffolds in `examples/`. Use the `NETWORK_HOST` and `NETWORK_PORT` environment variables (see `examples/agents/simple_worker_agent_example.py`) so agents behave in Docker and local runs. The LLM demos (`examples/agents/llm_worker_agent.py` 和 `examples/agents/chinese_poet_agent.py`) 展示了如何通过 `.env` 提供 `BASE_URL`, `MODEL`, `API_KEY` 并在缺省时优雅降级。Verify agents connect to a network started with `openagents network start` or Docker, and document any credentials. For network-level changes, update the corresponding YAML templates and call out migration steps in the README or release notes.
