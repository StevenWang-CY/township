# ───────────────────────────────────────────────────────────────────────────
# Township — production image
#
#   docker build -t township .
#   docker run -p 127.0.0.1:8000:8000 -e LLM_PROVIDER=mock township
#
# Stage 1 builds the React/Phaser frontend; stage 2 installs the FastAPI
# backend and serves frontend/dist statically from the same process.
# ───────────────────────────────────────────────────────────────────────────

# ── Stage 1: frontend build ────────────────────────────────────────────────
FROM node:22-slim AS frontend
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY LICENSE THIRD_PARTY_NOTICES.md RESPONSIBLE_USE.md /app/
COPY frontend/ ./
RUN npm run build

# ── Stage 2: backend runtime ───────────────────────────────────────────────
FROM python:3.12-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install the exact, hash-verified runtime dependency graph exported from
# uv.lock. Township is an application source tree under /app, so uvicorn can
# import it directly without invoking an isolated, networked package build.
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir --require-hashes -r backend/requirements.txt
COPY backend/ backend/
COPY scenarios/ scenarios/

# Runtime content. data/ only holds local state and a migration note.
COPY data/ data/

# Built frontend, served statically by FastAPI when present.
COPY --from=frontend /app/frontend/dist frontend/dist

# Run as an unprivileged user and pre-create the writable application dirs.
RUN useradd --create-home --uid 10001 township \
    && mkdir -p /app/runs /app/data/state \
    && chown -R township:township /app
USER township

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"]
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
