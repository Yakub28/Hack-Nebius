# Paper discovery: every common command, so `make help` is the one place to look.

PY ?= .venv/bin/python
PORT ?= 8000
IMAGE ?= paper-discovery

# Exports .env (if present) into the recipe's shell, the way the README's `set -a` does.
ENV = set -a; [ -f .env ] && . ./.env; set +a;

.DEFAULT_GOAL := help

.PHONY: help
help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

.PHONY: venv
venv:  ## Create .venv (Python 3.12) and install the dev dependencies
	uv venv -p 3.12 .venv
	uv pip install -r requirements-dev.txt

.PHONY: run
run:  ## Serve the API and UI on :8000 with reload (reads .env)
	$(ENV) $(PY) -m uvicorn api:app --reload --port $(PORT)

.PHONY: test
test:  ## Run the unit tests
	$(PY) -m pytest

.PHONY: lint
lint:  ## Lint the Python code (ruff)
	$(PY) -m ruff check .

.PHONY: check
check: lint test  ## Everything CI runs

.PHONY: sample
sample:  ## Record one real search into web/sample.json (needs the keys in .env)
	$(ENV) $(PY) scripts/make_sample.py

.PHONY: docker
docker:  ## Build the image and run it on :8000 with .env
	docker build -t $(IMAGE) .
	docker run --rm -p $(PORT):8000 --env-file .env $(IMAGE)
