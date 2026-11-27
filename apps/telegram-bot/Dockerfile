# Production image for the Engganyo Telegram bot.
# Build context: apps/telegram-bot (see .dockerignore for exclusions).
# Config (.env), data/ and logs/ are provided by bind mounts at runtime -
# never baked into the image.
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "main.py"]
