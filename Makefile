# ───────────────────────────────────────────────────────────────────────────
# Township — developer entry points
#
# Every public target carries a `## description` used by `make help`.
# Recipes stay portable across macOS (make 3.81) and Linux: plain bash,
# no GNU-make-4-only features.
# ───────────────────────────────────────────────────────────────────────────

.DEFAULT_GOAL := help
SHELL := /bin/bash

PORT   ?= 8001
UV     := $(shell command -v uv 2>/dev/null)
ifeq ($(strip $(UV)),)
PYTHON ?= python3
else
PYTHON ?= $(UV) run --locked --extra dev python
endif

.PHONY: help install dev dev-backend dev-frontend test test-e2e lint format build demo demo-build demo-preview capture-setup capture-media sim docker

help: ## Show this help
	@printf "\n  \033[1mTownship\033[0m — AI residents deliberating in a living pixel town\n\n"
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*## "} {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@printf "\n  Variables: PORT=%s (backend port), PYTHON=%s\n\n" "$(PORT)" "$(PYTHON)"

install: ## Install backend (editable, with dev extras) + frontend deps
	@if command -v uv >/dev/null 2>&1; then \
		uv sync --locked --extra dev; \
	else \
		$(PYTHON) -m pip install -e ".[dev]"; \
	fi
	cd frontend && npm ci

dev: ## Run backend (:8001) + frontend (:5173) together; Ctrl-C stops both
	@trap 'kill 0' INT TERM; \
	$(MAKE) dev-backend & \
	$(MAKE) dev-frontend & \
	wait

dev-backend: ## Backend only: uvicorn with auto-reload on :8001 (override with PORT=)
	$(PYTHON) -m uvicorn backend.main:app --reload --port $(PORT)

dev-frontend: ## Frontend only: Vite dev server on :5173 (proxies /api + /ws)
	cd frontend && npm run dev

test: ## Run backend tests (no API keys needed) + frontend type-check
	$(PYTHON) -m pytest -q
	cd frontend && npm run test:scripts
	cd frontend && npx tsc --noEmit

test-e2e: ## Run the zero-backend Chromium, mobile, and WCAG browser suite
	cd frontend && npm run test:e2e

lint: ## Ruff lint over backend + tests
	$(PYTHON) -m ruff check backend tests

format: ## Auto-format and fix lint findings in backend + tests
	$(PYTHON) -m ruff format backend tests
	$(PYTHON) -m ruff check --fix backend tests

build: ## Production frontend build → frontend/dist
	cd frontend && npm run build

demo: build ## Zero-key local app: build the UI, then serve it with the deterministic mock
	@echo "Township demo — MockProvider, no API keys required."
	@echo "Open http://localhost:$(PORT) once the server is up."
	LLM_PROVIDER=mock $(PYTHON) -m uvicorn backend.main:app --port $(PORT)

demo-build: ## Build the zero-backend demo player (stages scenarios/*/demo caches) → frontend/dist-demo
	cd frontend && npm run demo:build

demo-preview: ## Serve the built demo player locally (run 'make demo-build' first)
	cd frontend && npm run demo:preview

capture-setup: ## Install Playwright Chromium for automated product captures
	cd frontend && npx playwright install chromium

capture-media: demo-build ## Regenerate README hero, stills, resident strip, mobile proof, and social card
	node scripts/capture/capture.mjs

sim: ## Start a full simulation on the running backend (TOWN=dover for one town)
	@curl -sf -o /dev/null http://localhost:$(PORT)/ || { \
		echo "Backend is not running on :$(PORT) — start it with 'make dev' or 'make demo' first."; \
		exit 1; \
	}
	@if [ -n "$(TOWN)" ]; then body='{"town":"$(TOWN)"}'; else body='{}'; fi; \
	curl -s -X POST http://localhost:$(PORT)/api/simulation/start \
		-H 'Content-Type: application/json' -d "$$body"; echo
	@echo "Simulation started — watch it live at http://localhost:5173 or poll" \
		"http://localhost:$(PORT)/api/simulation/status"

docker: ## Build the production Docker image (township)
	docker build -t township .
