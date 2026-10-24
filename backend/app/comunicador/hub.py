"""Conexões WebSocket em memória: presença e entrega em tempo real.

A API roda com 1 processo (ver deploy/systemd/automacoes-api@.service), então um hub em memória basta e
não dependemos de broker. O worker do robô (outro processo) não fala com o hub: ele grava a mensagem no banco
e a API a entrega no próximo ciclo do "carteiro" (ver routes._carteiro), sem perder nada.
"""

import logging
from collections import defaultdict
from datetime import UTC, datetime, timedelta

from fastapi import WebSocket

log = logging.getLogger(__name__)

AUSENTE_APOS = timedelta(minutes=5)


class Hub:
    def __init__(self) -> None:
        self.conexoes: dict[int, set[WebSocket]] = defaultdict(set)  # usuario_id -> sockets (várias abas)
        self.tenant_de: dict[int, int] = {}
        self.manual: dict[int, str] = {}  # status escolhido ("ocupado")
        self.atividade: dict[int, datetime] = {}

    # ---------------- presença
    def status(self, usuario_id: int) -> str:
        if not self.conexoes.get(usuario_id):
            return "offline"
        if self.manual.get(usuario_id) == "ocupado":
            return "ocupado"
        ultima = self.atividade.get(usuario_id)
        if ultima and datetime.now(UTC) - ultima > AUSENTE_APOS:
            return "ausente"
        return "online"

    def online_do_tenant(self, tenant_id: int) -> dict[int, str]:
        return {u: self.status(u) for u, t in self.tenant_de.items() if t == tenant_id and self.conexoes.get(u)}

    async def conectar(self, ws: WebSocket, usuario_id: int, tenant_id: int) -> None:
        primeira = not self.conexoes.get(usuario_id)
        self.conexoes[usuario_id].add(ws)
        self.tenant_de[usuario_id] = tenant_id
        self.atividade[usuario_id] = datetime.now(UTC)
        if primeira:
            await self.presenca_mudou(usuario_id)

    async def desconectar(self, ws: WebSocket, usuario_id: int) -> None:
        self.conexoes[usuario_id].discard(ws)
        if not self.conexoes[usuario_id]:
            self.manual.pop(usuario_id, None)
            await self.presenca_mudou(usuario_id)

    async def ativo(self, usuario_id: int) -> None:
        antes = self.status(usuario_id)
        self.atividade[usuario_id] = datetime.now(UTC)
        if antes != self.status(usuario_id):
            await self.presenca_mudou(usuario_id)

    async def definir_status(self, usuario_id: int, valor: str) -> None:
        if valor == "ocupado":
            self.manual[usuario_id] = "ocupado"
        else:
            self.manual.pop(usuario_id, None)
        await self.presenca_mudou(usuario_id)

    async def presenca_mudou(self, usuario_id: int) -> None:
        tenant = self.tenant_de.get(usuario_id)
        if tenant is not None:
            await self.para_tenant(tenant, {"tipo": "presenca", "usuario_id": usuario_id, "status": self.status(usuario_id)})

    async def varrer_ausentes(self) -> None:
        """Chamado periodicamente: quem ficou parado vira 'ausente' para os outros."""
        for u in list(self.conexoes):
            if self.conexoes.get(u):
                await self.presenca_mudou(u)

    # ---------------- entrega
    async def para_usuarios(self, usuario_ids, payload: dict) -> None:
        for u in set(usuario_ids):
            for ws in list(self.conexoes.get(u, ())):
                try:
                    await ws.send_json(payload)
                except Exception:  # noqa: BLE001 — socket morto: a desconexão limpa depois
                    self.conexoes[u].discard(ws)

    async def para_tenant(self, tenant_id: int, payload: dict) -> None:
        await self.para_usuarios([u for u, t in self.tenant_de.items() if t == tenant_id], payload)


hub = Hub()

