.PHONY: dev stop test migrate build

# Start all services (db + backend + frontend)
dev:
	docker compose up --build

# Start only the backend (db + backend, no frontend)
dev-backend:
	docker compose up --build db backend

# Stop all services
stop:
	docker compose down

# Run backend tests
test:
	cd backend && python -m pytest tests/ -v

# Run Alembic migrations
migrate:
	cd backend && alembic upgrade head

# Create a new Alembic migration
migration:
	cd backend && alembic revision --autogenerate -m "$(msg)"

# Build Docker images
build:
	docker compose build

# Reset database (destroy and recreate)
reset-db:
	docker compose down -v
	docker compose up -d db
	@echo "Waiting for database..."
	@sleep 3
	cd backend && alembic upgrade head

# Lint
lint:
	cd backend && python -m ruff check app/

# Start backend locally (without Docker)
dev-local-backend:
	cd backend && DATABASE_URL="postgresql://postgres:postgres@localhost:5432/openagents_workspace" AUTH_MODE=workspace_token PYTHONPATH=. uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Start frontend locally (without Docker)
dev-local-frontend:
	cd frontend && NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
