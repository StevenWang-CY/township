# ───────────────────────────────────────────────────────────────────────────
# Township — production image
#
#   docker build -t township .
#   docker run -p 8000:8000 -e LLM_PROVIDER=mock township
#
# Stage 1 builds the React/Phaser frontend; stage 2 installs the FastAPI
# backend and serves frontend/dist statically from the same process.
# ───────────────────────────────────────────────────────────────────────────

# ── Stage 1: frontend build ────────────────────────────────────────────────
FROM node:20-slim AS frontend
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 2: backend runtime ───────────────────────────────────────────────
FROM python:3.12-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install the backend package (deps resolved from pyproject.toml).
COPY pyproject.toml README.md ./
COPY backend/ backend/
RUN pip install --no-cache-dir .

# Runtime content: personas + district data. tests/ is deliberately excluded.
COPY agents/ agents/
COPY data/ data/
# scenarios/ will hold packaged scenario bundles once the scenario engine
# lands (Phase 2) — add `COPY scenarios/ scenarios/` here when it exists.

# Built frontend, served statically by FastAPI when present.
COPY --from=frontend /app/frontend/dist frontend/dist

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
