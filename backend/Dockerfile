FROM python:3.11-slim

# Install system dependencies: Chromium for PDF generation, fonts for rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-dejavu-core \
    poppler-utils \
    libheif-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt pillow

# Copy application code
COPY . /app

# Set environment for cloud mode
ENV APP_ENV=cloud
ENV CHROMIUM_PATH=/usr/bin/chromium

EXPOSE 8000

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 4
