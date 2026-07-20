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
PYTHON ?= python3

.PHONY: help install dev dev-backend dev-frontend test lint format build demo sim docker

help: ## Show this help
	@printf "\n  \033[1mTownship\033[0m — AI residents deliberating in a living pixel town\n\n"
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*## "} {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@printf "\n  Variables: PORT=%s (backend port), PYTHON=%s\n\n" "$(PORT)" "$(PYTHON)"

install: ## Install backend (editable, with dev extras) + frontend deps
	$(PYTHON) -m pip install -e ".[dev]"
	cd frontend && npm install

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
	cd frontend && npx tsc --noEmit

lint: ## Ruff lint over backend + tests
	$(PYTHON) -m ruff check backend tests

format: ## Auto-format and fix lint findings in backend + tests
	$(PYTHON) -m ruff format backend tests
	$(PYTHON) -m ruff check --fix backend tests

build: ## Production frontend build → frontend/dist
	cd frontend && npm run build

demo: ## Zero-key demo: mock LLM provider; serves frontend/dist when built
	@echo "Township demo — MockProvider, no API keys required."
	@if [ -d frontend/dist ]; then \
		echo "Built frontend found — open http://localhost:$(PORT) once the server is up."; \
	else \
		echo "No frontend/dist yet — run 'make build' first to get the full UI"; \
		echo "(the API still works: http://localhost:$(PORT))."; \
	fi
	LLM_PROVIDER=mock $(PYTHON) -m uvicorn backend.main:app --port $(PORT)

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
