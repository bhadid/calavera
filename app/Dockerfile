# Calavera app image: API + job queue + built frontend, with the amdl
# downloader and a static ffmpeg.
#
#   docker build --target test .     run the backend tests
#   docker build .                   build the runtime image

ARG PYTHON_VERSION=3.12
ARG NODE_VERSION=22

# --- frontend: build the single-page app -------------------------------------
FROM node:${NODE_VERSION}-alpine AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# --- amdl: official release binary, checksum-verified -------------------------
FROM debian:13.2-slim AS amdl
ARG AMDL_VERSION
ARG AMDL_SHA256
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -fsSL -o /amdl "https://github.com/zhaarey/apple-music-downloader/releases/download/${AMDL_VERSION}/amdl_linux_amd64" \
    && echo "${AMDL_SHA256}  /amdl" | sha256sum -c - \
    && chmod 755 /amdl

# --- base: Python, tools and the backend package -----------------------------
FROM python:${PYTHON_VERSION}-slim-bookworm AS base
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 HOME=/tmp
RUN apt-get update && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*
# Static ffmpeg 7.1 (pinned by digest): FLAC conversion and audio verification.
COPY --from=mwader/static-ffmpeg@sha256:a8090df5f5608daef387e1b2e93b98aaacb4d92153ad904e7d715c725724fca4 /ffmpeg /usr/local/bin/ffmpeg
COPY --from=amdl /amdl /usr/local/bin/amdl
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY backend/calavera ./calavera

# --- test: run the backend test suite at build time ---------------------------
FROM base AS test
COPY backend/requirements-dev.txt ./
RUN pip install -r requirements-dev.txt
COPY backend/tests ./tests
RUN python -m pytest -q tests

# --- runtime -------------------------------------------------------------------
FROM base
COPY --from=frontend /src/dist /app/static
EXPOSE 8080
CMD ["python", "-m", "calavera"]
