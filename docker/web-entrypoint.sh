#!/bin/sh
set -e

envsubst '$API_UPSTREAM' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

# HTTPS is optional: with a certificate mounted at /etc/nginx/certs (see scripts/make-dev-cert.sh)
# the same server also answers on 443; without one nginx serves plain HTTP only.
if [ -f /etc/nginx/certs/server.crt ] && [ -f /etc/nginx/certs/server.key ]; then
  sed -i 's|# TLS_LISTEN|listen 443 ssl;\n  ssl_certificate /etc/nginx/certs/server.crt;\n  ssl_certificate_key /etc/nginx/certs/server.key;\n  ssl_protocols TLSv1.2 TLSv1.3;|' /etc/nginx/conf.d/default.conf
fi
