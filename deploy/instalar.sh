#!/usr/bin/env bash
#
# Primeira instalação de um ambiente num servidor que JÁ RODA outros sistemas.
# Regra: não atualizar, reiniciar nem reconfigurar nada que já exista. Só acrescentar.
#
#   curl -fsSL https://raw.githubusercontent.com/Jeff1984Sor/mayacorpAuto_CFMGG/main/deploy/instalar.sh -o instalar.sh
#   sudo bash instalar.sh prod      # automacoes1.mayacorp.com.br     (API 10021, web 10022)
#   sudo bash instalar.sh hml       # hml-automacoes.mayacorp.com.br (API 10031, web 10032)
# Portas na faixa 10000+ (convenção do servidor, a mesma do Flicsales).
#
# Segue o padrão do servidor: código em /home/deploy/<app>, serviços rodando como o usuário deploy.
# O banco começa VAZIO (só o cliente CFME, a identidade e as configurações).
#
set -euo pipefail

AMB="${1:?informe o ambiente: prod ou hml}"
case "$AMB" in
  prod) BRANCH=main;    API_PORTA=10021; WEB_PORTA=10022; DOMINIO=automacoes1.mayacorp.com.br ;;
  hml)  BRANCH=develop; API_PORTA=10031; WEB_PORTA=10032; DOMINIO=hml-automacoes.mayacorp.com.br ;;
  *) echo "Ambiente inválido: $AMB (use prod ou hml)"; exit 1 ;;
esac
REPO="${REPO:-https://github.com/Jeff1984Sor/mayacorpAuto_CFMGG.git}"
USUARIO=deploy
BASE=/home/$USUARIO/mayacorp-automacoes
DIR="$BASE/$AMB"
BANCO="automacoes_$AMB"
ROLE="automacoes_$AMB"
NGINX_SITE="/etc/nginx/sites-available/automacoes-$AMB"

[ "$(id -u)" = "0" ] || { echo "Rode com sudo: sudo bash instalar.sh $AMB"; exit 1; }
id "$USUARIO" >/dev/null 2>&1 || { echo "Usuário $USUARIO não existe."; exit 1; }
como() { sudo -u "$USUARIO" -H bash -lc "$1"; }

echo "=== MayaCorp Automações ($AMB) → $DIR ==="

echo "--- 1/9 Conferindo o servidor (nada é alterado nesta etapa)"
for p in "$API_PORTA" "$WEB_PORTA"; do
  if ss -ltn "( sport = :$p )" | grep -q LISTEN; then echo "    Porta $p já está em uso. Abortado sem alterar nada."; exit 1; fi
done
[ -e "$DIR" ] && { echo "    $DIR já existe. Para atualizar use: ./deploy/deploy.sh $AMB"; exit 1; }
[ -e "$NGINX_SITE" ] && { echo "    $NGINX_SITE já existe. Abortado."; exit 1; }
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$BANCO'" | grep -q 1; then
  echo "    O banco $BANCO já existe. Abortado (não apago bancos)."; exit 1
fi
for svc in api worker web; do
  systemctl list-unit-files "automacoes-$svc@.service" --no-legend 2>/dev/null | grep -q . && \
    echo "    (serviços automacoes-*@ já instalados: serão reaproveitados)" && break
done
echo "    Portas $API_PORTA/$WEB_PORTA livres, pasta e banco novos. OK."

echo "--- 2/9 Pacotes: instala só o que falta, sem atualizar o que existe"
FALTAM=""
for pkg in git curl openssl nginx postgresql-client certbot python3-certbot-nginx; do
  dpkg -s "$pkg" >/dev/null 2>&1 || FALTAM="$FALTAM $pkg"
done
if [ -n "$FALTAM" ]; then
  echo "    instalando:$FALTAM"
  apt-get install -y -qq --no-upgrade $FALTAM >/dev/null
fi
# Node/npm do PRÓPRIO usuário deploy (pode vir do nvm): é ele que vai rodar o frontend
NPM_BIN="$(como 'command -v npm' || true)"
NODE_VER="$(como 'node -v' 2>/dev/null || echo v0)"
[ -n "$NPM_BIN" ] && [ "$(echo "$NODE_VER" | cut -d. -f1 | tr -d v)" -ge 20 ] || {
  echo "    Node.js >= 20 necessário para o usuário $USUARIO (encontrado: $NODE_VER). Abortado."; exit 1; }
NODE_DIR="$(dirname "$NPM_BIN")"
echo "    Node $NODE_VER ($NODE_DIR)"
como 'command -v uv >/dev/null || [ -x ~/.local/bin/uv ] || curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null'
UV="/home/$USUARIO/.local/bin/uv"
[ -x "$UV" ] || UV="$(como 'command -v uv')"

echo "--- 3/9 Código ($BRANCH)"
como "mkdir -p '$BASE' && git clone -q -b '$BRANCH' '$REPO' '$DIR'"

echo "--- 4/9 Banco de dados $BANCO (novo; os outros bancos não são tocados)"
SENHA_BANCO="$(openssl rand -hex 24)"
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$ROLE'" | grep -q 1; then
  sudo -u postgres psql -q -c "ALTER ROLE $ROLE WITH LOGIN PASSWORD '$SENHA_BANCO'"
else
  sudo -u postgres psql -q -c "CREATE ROLE $ROLE WITH LOGIN PASSWORD '$SENHA_BANCO'"
fi
sudo -u postgres psql -q -c "CREATE DATABASE $BANCO OWNER $ROLE ENCODING 'UTF8'"

echo "--- 5/9 Configuração de servidor (.env só com o que é de servidor; o resto fica em Configurações)"
MASTER_KEY="$(python3 -c 'import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())')"
como "cat > '$DIR/backend/.env'" <<ENV
AMBIENTE=$AMB
API_PORTA=$API_PORTA
DATABASE_URL=postgresql+psycopg://$ROLE:$SENHA_BANCO@127.0.0.1:5432/$BANCO
FRONTEND_URL=https://$DOMINIO
CORS_ORIGINS=["https://$DOMINIO"]
JWT_SECRET=$(openssl rand -hex 48)
MASTER_KEY=$MASTER_KEY
WORKER_EMBUTIDO=false
MIGRAR_NA_SUBIDA=false
ENV
como "chmod 600 '$DIR/backend/.env'"
como "cat > '$DIR/frontend/.env.production'" <<ENV
NEXT_PUBLIC_API_URL=https://$DOMINIO/api
NEXT_PUBLIC_AMBIENTE=$AMB
NEXT_PUBLIC_VERSAO=$AMB
WEB_PORTA=$WEB_PORTA
ENV

echo "--- 6/9 Backend: dependências, migrations e base vazia"
como "cd '$DIR/backend' && '$UV' sync --frozen -q && '$UV' run python -m alembic upgrade head && '$UV' run python -m app.seed --somente-base"

echo "--- 7/9 Frontend: build"
como "cd '$DIR/frontend' && npm ci --silent && npm run build >/dev/null"

echo "--- 8/9 Serviços (systemd) e nginx — só acrescenta, não mexe nos existentes"
for svc in api worker web; do
  sed "s|__BASE__|$BASE|g; s|__USUARIO__|$USUARIO|g; s|__NODE_DIR__|$NODE_DIR|g" "$DIR/deploy/systemd/automacoes-$svc@.service" \
    > "/etc/systemd/system/automacoes-$svc@.service"
done
systemctl daemon-reload
systemctl enable --now "automacoes-api@$AMB" "automacoes-worker@$AMB" "automacoes-web@$AMB"

sed "s|__DOMINIO__|$DOMINIO|g; s|__API__|$API_PORTA|g; s|__WEB__|$WEB_PORTA|g" \
  "$DIR/deploy/nginx/automacoes.conf.template" > "$NGINX_SITE"
ln -s "$NGINX_SITE" "/etc/nginx/sites-enabled/automacoes-$AMB"
if nginx -t 2>/tmp/automacoes-nginx.txt; then
  systemctl reload nginx   # reload: os sites existentes continuam no ar
else
  rm -f "/etc/nginx/sites-enabled/automacoes-$AMB"
  echo "    O nginx recusou a configuração nova; ela foi DESFEITA (os outros sites seguem intactos):"
  cat /tmp/automacoes-nginx.txt
  exit 1
fi
if [ "$AMB" = "prod" ]; then
  echo "0 2 * * * $USUARIO $DIR/deploy/backup.sh prod >> /home/$USUARIO/mayacorp-automacoes/backup.log 2>&1" \
    > /etc/cron.d/automacoes-backup
fi

echo "--- 9/9 Primeiro administrador"
LOGIN="(a criar)"
if { : </dev/tty; } 2>/dev/null; then
  read -r -p "    Login: " LOGIN </dev/tty
  read -r -p "    Nome: " NOME </dev/tty
  read -r -p "    E-mail: " EMAIL </dev/tty
  como "cd '$DIR/backend' && '$UV' run python -m app.criar_usuario --login '$LOGIN' --nome '$NOME' --email '$EMAIL' --perfil admin" </dev/tty
else
  echo "    Sem terminal interativo: crie o administrador depois (a senha é lida da entrada):"
  echo "    cd $DIR/backend && ~/.local/bin/uv run python -m app.criar_usuario --login admin --nome '...' --email ... --perfil admin"
fi

sleep 3
CODIGO="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$API_PORTA/api/health" || echo 000)"
echo
echo "=== Pronto: $AMB instalado (API local: HTTP $CODIGO) ==="
echo "    1) DNS: registro A '$DOMINIO' → IP deste servidor"
echo "    2) HTTPS: sudo certbot --nginx -d $DOMINIO"
echo "    3) Acesse https://$DOMINIO com o login '$LOGIN'"
echo "    GUARDE a MASTER_KEY (em $DIR/backend/.env) num lugar seguro: sem ela o certificado A1 precisa ser reenviado."
