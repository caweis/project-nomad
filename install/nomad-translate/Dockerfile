FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8391
WORKDIR /app

RUN pip install --no-cache-dir \
    ctranslate2==4.8.3 \
    sentencepiece==0.2.2 \
    numpy==2.4.6 \
    PyYAML==6.0.3

COPY blocks.py engine.py fetch_models.py proxy.py entrypoint.sh /app/
RUN chmod 755 /app/entrypoint.sh

EXPOSE 8391
ENTRYPOINT ["/app/entrypoint.sh"]
