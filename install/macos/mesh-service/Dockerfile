# NOMAD Mesh Bridge — connects a LoRa mesh radio to the onboard AI.
# Multi-stage, non-root. The container talks only to the host AI endpoint and (in
# P1+) a host serial->TCP bridge; no --device, no host mounts, no docker socket.
FROM python:3.12-slim AS deps
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY --from=deps /install /usr/local
COPY mesh_service ./mesh_service

# Run as a non-root user.
RUN useradd --create-home --uid 10001 mesh
USER mesh

EXPOSE 8600
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8600/health').status==200 else 1)"

CMD ["uvicorn", "mesh_service.app:app", "--host", "0.0.0.0", "--port", "8600"]
