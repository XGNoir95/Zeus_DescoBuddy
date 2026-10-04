FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/app/data
WORKDIR /app
COPY pyproject.toml ./
COPY requirements.lock ./
COPY descobuddy ./descobuddy
RUN pip install --no-cache-dir -r requirements.lock && pip install --no-cache-dir --no-deps . && useradd --uid 10001 --create-home bot && mkdir -p /app/data && chown -R bot:bot /app
USER bot
CMD ["python", "-m", "descobuddy", "run"]
