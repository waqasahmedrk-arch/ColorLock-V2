PY ?= python
COMPOSE = docker compose -f infra/docker-compose.yml

.PHONY: dev import test parity lint api frontend

dev:            ## api, postgres, redis, minio in docker
	$(COMPOSE) up --build

import:         ## load data/study into the docker stack
	$(COMPOSE) --profile import run --rm import

api:            ## API without docker (SQLite + local files under data/)
	cd backend/api && $(PY) -m alembic upgrade head && $(PY) -m uvicorn app.main:app --reload

frontend:
	cd frontend && npm run dev

test:           ## unit + API tests
	cd packages/colourlock && $(PY) -m pytest tests/unit -q
	cd backend/api && $(PY) -m pytest -q -m "not slow"

parity:         ## package vs notebook manifest on the 2,560 study images (~7 min)
	cd packages/colourlock && $(PY) -m pytest tests/parity -m slow -q

lint:
	$(PY) -m ruff check packages/colourlock/src backend/api scripts
	cd packages/colourlock && $(PY) -m mypy src
