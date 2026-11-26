FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY app ./app
COPY tests ./tests

RUN mkdir -p /app/backups

EXPOSE 8000

# Strictly 1 uvloop worker so all 1,000 WebSockets share one single authoritative RAM price state
# --timeout-keep-alive 65 > nginx keepalive_timeout prevents 502 connection reset under burst load
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--loop", "uvloop", "--http", "httptools", "--backlog", "4096", "--timeout-keep-alive", "65", "--ws-ping-interval", "20", "--ws-ping-timeout", "20"]

