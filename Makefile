# Snowball: every common command, so `make help` is the one place to look.

PY ?= .venv/bin/python
PORT ?= 8000
IMAGE ?= snowball
# A project-local Node (make node) wins over a system one, so the build works without a global install.
export PATH := $(if $(wildcard .tools/node/bin),$(CURDIR)/.tools/node/bin:,)$(PATH)

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

.PHONY: node
node:  ## Install Node.js LTS into .tools/node (checksum-verified, no system install)
	scripts/install_node.sh

.PHONY: run
run: web/dist/index.html  ## Serve the API and the built UI on :8000 with reload (reads .env)
	$(ENV) $(PY) -m uvicorn api:app --reload --port $(PORT)

.PHONY: web
web: web/node_modules  ## UI dev server with hot reload on :5173 (run `make run` alongside it)
	cd web && npm run dev

.PHONY: web-build
web-build: web/node_modules  ## Type-check and build the UI into web/dist
	cd web && npm run build

web/dist/index.html:
	$(MAKE) web-build

web/node_modules: web/package-lock.json
	@command -v npm >/dev/null || { echo "No Node.js: run 'make node' (or brew install node)"; exit 1; }
	cd web && npm ci --no-audit --no-fund
	@touch web/node_modules

.PHONY: test
test:  ## Run the unit tests
	$(PY) -m pytest

.PHONY: lint
lint:  ## Lint the Python code (ruff) and type-check the UI
	$(PY) -m ruff check .
	@if [ -d web/node_modules ]; then cd web && npm run --silent typecheck; fi

.PHONY: check
check: lint test  ## Lint and test: run before every commit

.PHONY: sample
sample:  ## Record one real search into web/public/sample.json (needs the keys in .env)
	$(ENV) $(PY) scripts/make_sample.py

.PHONY: docker
docker:  ## Build the image and run it on :8000 with .env
	docker build -t $(IMAGE) .
	docker run --rm -p $(PORT):8000 --env-file .env $(IMAGE)
