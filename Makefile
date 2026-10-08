export DOCKER_DEFAULT_PLATFORM := linux/amd64

COMPOSE ?= docker compose
TEST_COMPOSE = $(COMPOSE) -f docker-compose.yml -f docker-compose.test.yml

.PHONY: build test test-unit lint up down smoke shrinkwrap

build:
	$(COMPOSE) build

test:
	$(TEST_COMPOSE) build test
	$(TEST_COMPOSE) run --rm test; status=$$?; $(TEST_COMPOSE) down -v; exit $$status

test-unit:
	$(TEST_COMPOSE) build test
	$(TEST_COMPOSE) run --rm --no-deps test npm run test:unit

lint:
	$(TEST_COMPOSE) build test
	$(TEST_COMPOSE) run --rm --no-deps test npm run lint

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

smoke:
	COMPOSE="$(COMPOSE)" sh scripts/smoke.sh; status=$$?; $(COMPOSE) down -v; exit $$status

shrinkwrap:
	docker run --rm -v "$(CURDIR)":/app -w /app node:10 sh -c \
	  'npm install --before=2016-03-01 --package-lock-only --no-audit && npm shrinkwrap'
