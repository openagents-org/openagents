SHELL := /bin/bash

.DEFAULT_GOAL := help

NETWORK_DIR ?= ./my_first_network
COMPOSE_FILE ?= docker-compose.yml
REMOTE_COMPOSE_FILE ?= docker-compose.remote.yml
STUDIO_DIR ?= studio

.PHONY: help install install-dev test lint format network-init network-start studio \
	studio-install studio-start docker-up docker-down docker-clean docker-logs \
	docker-remote-up docker-remote-down

help: ## Show categorized targets and example flows
	@echo "Usage: make <target> [VARIABLE=value]"
	@echo
	@echo "Setup"
	@echo "  install               Install runtime dependencies (editable)"
	@echo "  install-dev           Install development dependencies"
	@echo
	@echo "Quality"
	@echo "  test                  Run pytest suite"
	@echo "  lint                  Run Flake8 checks"
	@echo "  format                Format Python code with Black"
	@echo
	@echo "Network & Studio"
	@echo "  network-init          Scaffold a network workspace (NETWORK_DIR=...)"
	@echo "  network-start         Start network for a workspace"
	@echo "  studio                Launch Studio in standalone mode"
	@echo "  studio-install        Install Studio front-end dependencies"
	@echo "  studio-start          Start Studio dev server"
	@echo
	@echo "Docker (Local Build)"
	@echo "  docker-up             Build and run compose stack"
	@echo "  docker-down           Stop compose stack"
	@echo "  docker-clean          Stop and remove volumes"
	@echo "  docker-logs           Tail service logs"
	@echo
	@echo "Docker (Published Image)"
	@echo "  docker-remote-up      Run network + sample agent (remote compose)"
	@echo "  docker-remote-down    Stop remote stack"
	@echo
	@echo "Examples"
	@echo "  make install-dev && make test"
	@echo "  make network-init NETWORK_DIR=./workspace"
	@echo "  make docker-up"
	@echo "  make docker-remote-up REMOTE_COMPOSE_FILE=my-compose.yml"

install: ## Install runtime dependencies (editable mode)
	@pip install -e .

install-dev: ## Install development dependencies and tooling
	@pip install -e .[dev]

test: ## Run pytest test suite
	@pytest

lint: ## Run Flake8 lint checks
	@flake8 src tests

format: ## Format Python code with Black
	@black src tests

network-init: ## Scaffold a new network workspace at NETWORK_DIR
	@openagents init $(NETWORK_DIR)

network-start: ## Start the network defined at NETWORK_DIR
	@openagents network start $(NETWORK_DIR)

studio: ## Launch OpenAgents Studio in standalone mode
	@openagents studio -s

studio-install: ## Install Studio front-end dependencies
	@cd $(STUDIO_DIR) && npm install

studio-start: ## Start the Studio front-end dev server
	@cd $(STUDIO_DIR) && npm start

docker-up: ## Build and run stack using local Docker Compose
	@docker compose -f $(COMPOSE_FILE) up --build

docker-down: ## Stop stack and remove containers (local compose)
	@docker compose -f $(COMPOSE_FILE) down

docker-clean: ## Stop stack and remove containers + volumes (local compose)
	@docker compose -f $(COMPOSE_FILE) down -v

docker-logs: ## Tail logs from the openagents service (local compose)
	@docker compose -f $(COMPOSE_FILE) logs -f openagents

docker-remote-up: ## Run published image via remote compose file
	@docker compose -f $(REMOTE_COMPOSE_FILE) up -d

docker-remote-down: ## Stop remote compose deployment and remove containers
	@docker compose -f $(REMOTE_COMPOSE_FILE) down
