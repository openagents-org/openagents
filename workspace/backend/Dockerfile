FROM python:3.12-slim

WORKDIR /app

# System deps for psycopg2 and Playwright
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright browsers (chromium only to keep image small)
RUN playwright install --with-deps chromium

# Copy application code
COPY . .

RUN chmod +x entrypoint.sh

ENV PYTHONPATH=/app

EXPOSE 8000
ENTRYPOINT ["./entrypoint.sh"]
