#!/bin/sh
# Creates a local CA and a server certificate for the web container, into ./certs:
#   ca.crt      install/trust this on every computer that opens the game (never share ca.key)
#   server.crt / server.key   mounted by compose; restart the web container afterwards
# Usage: scripts/make-dev-cert.sh <ip-or-hostname> [more ...]   e.g. 192.168.31.100 localhost
set -eu
[ "$#" -ge 1 ] || { echo "usage: $0 <ip-or-hostname> [...]" >&2; exit 1; }
cd "$(dirname "$0")/.."
mkdir -p certs
cd certs
san=""
for name in "$@"; do
  case "$name" in
    *[!0-9.]*) san="$san${san:+,}DNS:$name" ;;
    *) san="$san${san:+,}IP:$name" ;;
  esac
done
[ -f ca.key ] || {
  openssl req -x509 -newkey rsa:3072 -nodes -keyout ca.key -out ca.crt -days 3650 \
    -subj "/CN=Rust and Spark local CA"
}
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=$1"
printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$san" > server.ext
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt \
  -days 825 -extfile server.ext
rm -f server.csr server.ext
chmod 600 ca.key server.key
echo "done: certs/ca.crt (trust it on clients), certs/server.crt, certs/server.key"
