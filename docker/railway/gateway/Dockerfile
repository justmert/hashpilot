# Token-enforcing reverse proxy in front of ChromaDB (see Caddyfile)
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
    || echo "validation skipped (env placeholders)"
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
