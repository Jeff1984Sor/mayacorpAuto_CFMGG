"""Modelo HTML dos e-mails da MayaCorp aos clientes (boas-vindas, cobranças, contratos, cadastros).

O texto continua sendo escrito como texto puro (é a versão para quem não lê HTML); aqui ele ganha cabeçalho com a
marca, links viram botões, linhas "• item: valor" viram tabela e "Total:" ganha destaque. Tudo com estilo inline e
tabelas, que é o que Gmail e Outlook respeitam.
"""

import html
import re

NAVY, INDIGO, DARK, GRAY, TEAL = "#1E2D6B", "#7C8FFF", "#0F1729", "#F7F8FC", "#1A8F5E"

# rótulo do botão pelo destino do link
_BOTOES = [
    ("/primeiro-acesso", "Criar meu acesso"),
    ("/redefinir-senha", "Criar minha senha"),
    ("/aprovar", "Aprovar ou recusar"),
    ("mercadopago.com", "Pagar agora"),
    ("mercadolivre.com", "Pagar agora"),
    ("/minha-conta/plano", "Ver meu plano"),
]
_URL = re.compile(r"^https?://\S+$")


def _rotulo(url: str) -> str:
    return next((r for trecho, r in _BOTOES if trecho in url), "Abrir")


def _botao(url: str) -> str:
    u = html.escape(url, quote=True)
    return (f'<table role="presentation" cellspacing="0" cellpadding="0" style="margin:18px 0"><tr>'
            f'<td style="border-radius:10px;background:{NAVY}">'
            f'<a href="{u}" style="display:inline-block;padding:13px 26px;font-weight:600;font-size:15px;color:#ffffff;'
            f'text-decoration:none;border-radius:10px">{_rotulo(url)} &rarr;</a></td></tr></table>'
            f'<p style="margin:0 0 6px;font-size:11px;color:#8a90a6;word-break:break-all">Se o botão não abrir, copie: '
            f'<a href="{u}" style="color:{INDIGO}">{html.escape(url)}</a></p>')


def _itens(linhas: list[str]) -> str:
    tr = []
    for ln in linhas:
        desc, _, valor = ln.strip().lstrip("•").strip().rpartition(":")
        neg = valor.strip().startswith("R$ -")
        tr.append(f'<tr><td style="padding:8px 0;border-bottom:1px solid #eceef5;color:#3b4258">{html.escape(desc or valor)}</td>'
                  f'<td style="padding:8px 0;border-bottom:1px solid #eceef5;text-align:right;white-space:nowrap;'
                  f'font-family:\'JetBrains Mono\',Consolas,monospace;color:{TEAL if neg else DARK}">'
                  f'{html.escape(valor.strip()) if desc else ""}</td></tr>')
    return f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 4px">{"".join(tr)}</table>'


def _paragrafo(bloco: str) -> str:
    texto = html.escape(bloco).replace("\n", "<br>")
    texto = re.sub(r"(https?://[^\s<]+)", lambda m: f'<a href="{m.group(1)}" style="color:{INDIGO}">{m.group(1)}</a>', texto)
    return f'<p style="margin:0 0 14px">{texto}</p>'


def corpo_html(corpo: str, *, titulo: str, marca: str = "MayaJus", logo_cid: str | None = None) -> str:
    partes: list[str] = []
    for bloco in re.split(r"\n\s*\n", corpo.strip()):
        linhas = [ln for ln in bloco.split("\n") if ln.strip()]
        if not linhas:
            continue
        if len(linhas) == 1 and _URL.match(linhas[0].strip()):
            partes.append(_botao(linhas[0].strip()))
        elif all(ln.strip().startswith("•") for ln in linhas):
            partes.append(_itens(linhas))
        elif linhas[0].startswith("Total:"):
            partes.append(f'<p style="margin:6px 0 14px;font-size:18px;font-weight:700;color:{DARK}">'
                          f'{html.escape(linhas[0])}</p>')
        elif _URL.match(linhas[-1].strip()):  # "Texto:\nhttps://..." → texto + botão
            partes.append(_paragrafo("\n".join(linhas[:-1])))
            partes.append(_botao(linhas[-1].strip()))
        else:
            partes.append(_paragrafo("\n".join(linhas)))
    cabeca = (f'<img src="cid:{logo_cid}" alt="{html.escape(marca)}" style="max-height:44px;max-width:220px;display:block">'
              if logo_cid else
              f'<table role="presentation" cellspacing="0" cellpadding="0"><tr>'
              f'<td style="width:40px;height:40px;border-radius:10px;background:{INDIGO};text-align:center;'
              f'font-weight:700;font-size:20px;color:#fff">{html.escape(marca[:1])}</td>'
              f'<td style="padding-left:12px;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:.2px">'
              f'{html.escape(marca)}</td></tr></table>')
    return f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>{html.escape(titulo)}</title></head>
<body style="margin:0;padding:0;background:{GRAY};font-family:'DM Sans',Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:{GRAY};padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e8f0">
<tr><td style="background:{NAVY};background-image:linear-gradient(135deg,{DARK} 0%,{NAVY} 70%,{INDIGO} 140%);padding:24px 32px">{cabeca}</td></tr>
<tr><td style="padding:28px 32px 12px;color:{DARK};font-size:15px;line-height:1.6">{"".join(partes)}</td></tr>
<tr><td style="padding:18px 32px 26px;border-top:1px solid #eceef5;color:#8a90a6;font-size:12px;line-height:1.5">
MayaJus é um produto <b style="color:{NAVY}">MayaCorp</b> · gestão jurídica com NFS-e e financeiro<br>
Responda este e-mail se precisar de ajuda.</td></tr>
</table></td></tr></table></body></html>"""
