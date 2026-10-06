# API image: CPU only. No torch, no diffusers, no weights (conventions.md).
# Build from the repo root:  docker build -f infra/api.Dockerfile -t colourlock-api .
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    COLOURLOCK_CONFIG_DIR=/app/config

WORKDIR /app

COPY packages/colourlock /app/packages/colourlock
RUN pip install /app/packages/colourlock

COPY backend/api /app/backend/api
RUN pip install "/app/backend/api[postgres]"

COPY config /app/config
COPY scripts /app/scripts

RUN useradd --create-home --uid 10001 app
USER app

WORKDIR /app/backend/api
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers"]
