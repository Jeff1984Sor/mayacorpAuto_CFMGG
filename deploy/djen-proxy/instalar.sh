#!/usr/bin/env bash
# Uso (no servidor do Brasil, com sudo):  bash instalar.sh djen.mayacorp.com.br
# Só ACRESCENTA um site ao nginx; não mexe nos sites existentes. Testa o nginx antes de recarregar.
set -euo pipefail
DOMINIO="${1:?informe o domínio, ex.: djen.mayacorp.com.br}"
SEGREDO="$(openssl rand -hex 16)"
[ -x /usr/sbin/nginx ] || { echo "nginx não está instalado neste servidor: instale antes (não instalo pacotes sozinho)."; exit 1; }
[ -e /etc/nginx/sites-available/djen-proxy ] && SEGREDO="$(grep -oE '/[0-9a-f]{32}/api' /etc/nginx/sites-available/djen-proxy | head -1 | cut -d/ -f2)" || true  # reinstalação mantém o segredo
sed -e "s/__DOMINIO__/$DOMINIO/g" -e "s/__SEGREDO__/$SEGREDO/g" "$(dirname "$0")/djen-proxy.nginx.conf" | sudo tee /etc/nginx/sites-available/djen-proxy >/dev/null
sudo ln -sf /etc/nginx/sites-available/djen-proxy /etc/nginx/sites-enabled/djen-proxy
sudo /usr/sbin/nginx -t && sudo systemctl reload nginx
if command -v certbot >/dev/null; then sudo certbot --nginx -n --redirect -d "$DOMINIO" --agree-tos --register-unsafely-without-email; sudo /usr/sbin/nginx -t; fi
echo "Teste local:  curl -s 'https://comunicaapi.pje.jus.br/api/v1/comunicacao?numeroOab=1&ufOab=SP&itensPorPagina=1' -o /dev/null -w '%{http_code}\n'"
echo "URL do proxy para o MayaJus:  https://$DOMINIO/$SEGREDO/api/v1"
