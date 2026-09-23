FROM ghcr.io/home-assistant/base:latest

ENV LANG=C.UTF-8
WORKDIR /app

RUN apk add --no-cache \
        python3 \
        py3-pip \
        py3-aiohttp \
    && python3 -m venv --system-site-packages /opt/venv

ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir -r /app/requirements.txt

COPY app /app
COPY run.sh /run.sh
RUN chmod a+x /run.sh

LABEL \
    io.hass.name="GitHub Sync" \
    io.hass.description="Sync Home Assistant folders with GitHub repositories" \
    io.hass.version="0.8.1" \
    io.hass.type="app" \
    io.hass.arch="aarch64|amd64"

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8099/api/health')"

CMD ["/run.sh"]
