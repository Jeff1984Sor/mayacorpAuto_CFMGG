"""Conversa com o Mercado Pago (API v1). Toda chamada ao Mercado Pago passa por aqui.

- Link de pagamento (Checkout Pro): `preferencia` → o cliente paga por Pix, cartão ou boleto.
- Cartão recorrente (assinatura): `assinatura` → o cliente cadastra o cartão uma vez e o MP cobra todo mês.
- Notificações (webhook): `assinatura_valida` confere o cabeçalho x-signature com a assinatura secreta.
"""

import hashlib
import hmac
from decimal import Decimal

import httpx

API = "https://api.mercadopago.com"


class ErroMercadoPago(Exception):
    pass


class MercadoPago:
    def __init__(self, token: str):
        self.token = token

    def _chamar(self, metodo: str, caminho: str, json: dict | None = None, chave: str | None = None) -> dict:
        cab = {"Authorization": f"Bearer {self.token}"}
        if chave:  # idempotência: a mesma cobrança nunca vira duas preferências
            cab["X-Idempotency-Key"] = chave
        try:
            r = httpx.request(metodo, API + caminho, json=json, headers=cab, timeout=30)
        except httpx.HTTPError as e:
            raise ErroMercadoPago("Não foi possível falar com o Mercado Pago. Tente de novo em instantes.") from e
        if r.status_code == 401:
            raise ErroMercadoPago("O Mercado Pago recusou o Access Token. Confira se copiou o de produção, inteiro.")
        if r.status_code >= 400:
            try:
                msg = r.json().get("message") or r.text
            except ValueError:
                msg = r.text
            raise ErroMercadoPago(f"Mercado Pago: {msg[:300]}")
        return r.json() if r.content else {}

    def conta(self) -> dict:
        return self._chamar("GET", "/users/me")

    def preferencia(self, *, ref: str, titulo: str, valor: Decimal, email: str | None, notificacao: str | None,
                    voltar: str | None) -> dict:
        corpo: dict = {
            "items": [{"title": titulo[:250], "quantity": 1, "unit_price": float(valor), "currency_id": "BRL"}],
            "external_reference": ref,
            "statement_descriptor": "MAYAJUS",
        }
        if email:
            corpo["payer"] = {"email": email}
        if notificacao:
            corpo["notification_url"] = notificacao
        if voltar:
            corpo["back_urls"] = {"success": voltar, "pending": voltar, "failure": voltar}
            corpo["auto_return"] = "approved"
        return self._chamar("POST", "/checkout/preferences", corpo, chave=ref)

    def assinatura(self, *, ref: str, titulo: str, valor: Decimal, email: str, voltar: str,
                   notificacao: str | None) -> dict:
        corpo: dict = {
            "reason": titulo[:250],
            "external_reference": ref,
            "payer_email": email,
            "back_url": voltar,
            "status": "pending",
            "auto_recurring": {"frequency": 1, "frequency_type": "months", "transaction_amount": float(valor),
                               "currency_id": "BRL"},
        }
        if notificacao:
            corpo["notification_url"] = notificacao
        return self._chamar("POST", "/preapproval", corpo)

    def alterar_assinatura(self, assinatura_id: str, *, valor: Decimal | None = None, status: str | None = None) -> dict:
        corpo: dict = {}
        if valor is not None:
            corpo["auto_recurring"] = {"transaction_amount": float(valor), "currency_id": "BRL"}
        if status:
            corpo["status"] = status  # paused | cancelled | authorized
        return self._chamar("PUT", f"/preapproval/{assinatura_id}", corpo)

    def ler_assinatura(self, assinatura_id: str) -> dict:
        return self._chamar("GET", f"/preapproval/{assinatura_id}")

    def pagamento(self, pagamento_id: str) -> dict:
        return self._chamar("GET", f"/v1/payments/{pagamento_id}")

    def pagamento_da_assinatura(self, autorizado_id: str) -> dict:
        return self._chamar("GET", f"/authorized_payments/{autorizado_id}")


def assinatura_valida(segredo: str, x_signature: str | None, x_request_id: str | None, data_id: str | None) -> bool:
    """Cabeçalho x-signature "ts=...,v1=...": HMAC-SHA256 de "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"."""
    if not (segredo and x_signature):
        return False
    partes = dict(p.strip().split("=", 1) for p in x_signature.split(",") if "=" in p)
    ts, v1 = partes.get("ts"), partes.get("v1")
    if not (ts and v1):
        return False
    manifesto = ""
    if data_id:
        manifesto += f"id:{data_id.lower() if data_id.isalnum() else data_id};"
    if x_request_id:
        manifesto += f"request-id:{x_request_id};"
    manifesto += f"ts:{ts};"
    esperado = hmac.new(segredo.encode(), manifesto.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(esperado, v1)


FORMAS = {"pix": "Pix", "credit_card": "cartão de crédito", "debit_card": "cartão de débito", "ticket": "boleto",
          "bank_transfer": "Pix", "account_money": "saldo Mercado Pago"}
