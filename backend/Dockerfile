FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
ENV SELECTOR_CACHE_DIR=/data/cache
VOLUME /data
EXPOSE 8000
# Pass SELECTOR_CORS_ORIGINS="https://your-frontend" for a production frontend origin.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
