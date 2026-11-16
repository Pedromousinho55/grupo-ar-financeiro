"""Atualiza os fornecedores (CNPJ) com os dados públicos da Receita Federal.

Uso:  python3 ferramentas/atualizar_fornecedores_receita.py teste|producao [--todos]

Sem --todos, consulta só quem ainda não foi consultado.
Regras (iguais às da tela de fornecedores):
- sobrescreve razão social, endereço, bairro, cidade, UF, CEP, CNAE e situação cadastral;
- telefone e e-mail só se estiverem vazios;
- nome fantasia: o da Receita; se a Receita não tiver, mantém o atual; se também não houver,
  usa o nome antigo (ex.: do GRFood) quando ele for diferente da razão social oficial;
- não mexe em banco, PIX, prazo, observação.
Fonte: BrasilAPI; reserva: CNPJá (consulta aberta, limite de 5 por minuto).
Só o número do CNPJ é enviado.
"""
import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "supabase"))
import aplicar_migracoes as banco  # noqa: E402

AUTOR = "Claude (consulta Receita, a pedido de Pedro Mousinho)"
dig = lambda t: re.sub(r"\D", "", str(t or ""))  # noqa: E731


def limpo(v):
    t = str(v or "").strip()
    return t or None


def telefone(t):
    d = dig(t)
    if len(d) == 10:
        return f"({d[:2]}) {d[2:6]}-{d[6:]}"
    if len(d) == 11:
        return f"({d[:2]}) {d[2:7]}-{d[7:]}"
    return limpo(t)


def cnae(codigo, texto):
    c = dig(codigo).zfill(7)
    fmt = f"{c[:2]}.{c[2:4]}-{c[4]}-{c[5:]} " if c != "0000000" else ""
    return limpo(f"{fmt}{texto or ''}")


def juntar(*p):
    return limpo(", ".join(str(x).strip() for x in p if str(x or "").strip()))


def de_brasilapi(d):
    return {
        "razao_social": limpo(d.get("razao_social")),
        "nome_fantasia": limpo(d.get("nome_fantasia")),
        "endereco": juntar(" ".join(x for x in [d.get("descricao_tipo_de_logradouro"), d.get("logradouro")] if x), d.get("numero"), d.get("complemento")),
        "bairro": limpo(d.get("bairro")),
        "cidade": limpo(d.get("municipio")),
        "uf": limpo(d.get("uf")),
        "cep": limpo(dig(d.get("cep"))),
        "telefone": telefone(d.get("ddd_telefone_1")),
        "email": (limpo(d.get("email")) or "").lower() or None,
        "cnae_principal": cnae(d.get("cnae_fiscal"), d.get("cnae_fiscal_descricao")),
        "situacao_cadastral": (limpo(d.get("descricao_situacao_cadastral")) or "").upper() or None,
    }


def de_cnpja(d):
    a = d.get("address") or {}
    f = (d.get("phones") or [None])[0]
    em = (d.get("emails") or [None])[0]
    return {
        "razao_social": limpo((d.get("company") or {}).get("name")),
        "nome_fantasia": limpo(d.get("alias")),
        "endereco": juntar(a.get("street"), a.get("number"), a.get("details")),
        "bairro": limpo(a.get("district")),
        "cidade": limpo(a.get("city")),
        "uf": limpo(a.get("state")),
        "cep": limpo(dig(a.get("zip"))),
        "telefone": telefone(f"{f['area']}{f['number']}") if f else None,
        "email": (em or {}).get("address", "").lower() or None if em else None,
        "cnae_principal": cnae((d.get("mainActivity") or {}).get("id"), (d.get("mainActivity") or {}).get("text")),
        "situacao_cadastral": (limpo((d.get("status") or {}).get("text")) or "").upper() or None,
    }


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "financeiro-interno/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception:
        return 0, None


_ultima_cnpja = [0.0]


def consultar(cnpj):
    # BrasilAPI às vezes responde 404 para CNPJ que existe: nunca confiar só nela.
    for tentativa in range(2):
        st, d = get(f"https://brasilapi.com.br/api/cnpj/v1/{cnpj}")
        if d:
            return "ok", de_brasilapi(d)
        time.sleep(2 if st == 404 else 8)
    # reserva: limite de 5 consultas por minuto
    espera = 12.5 - (time.time() - _ultima_cnpja[0])
    if espera > 0:
        time.sleep(espera)
    for tentativa in range(3):
        _ultima_cnpja[0] = time.time()
        st, d = get(f"https://open.cnpja.com/office/{cnpj}")
        if d:
            return "ok", de_cnpja(d)
        if st == 404:
            return "nao_encontrado", None
        time.sleep(15 * (tentativa + 1))
    return "falha", None


def gravar(ref, lote):
    dados = json.dumps(lote, ensure_ascii=False)
    assert "$lote$" not in dados
    banco.sql(ref, f"""
begin;
select set_config('app.autor', '{AUTOR}', true);
update public.fornecedores f set
  razao_social = coalesce(x.razao_social, f.razao_social),
  nome_fantasia = x.nome_fantasia,
  endereco = x.endereco, bairro = x.bairro, cidade = x.cidade, uf = x.uf, cep = x.cep,
  cnae_principal = x.cnae_principal, situacao_cadastral = x.situacao_cadastral,
  telefone = coalesce(f.telefone, x.telefone),
  email = coalesce(f.email, x.email),
  consultado_receita_em = now()
from jsonb_to_recordset($lote${dados}$lote$::jsonb) as x(
  id uuid, razao_social text, nome_fantasia text, endereco text, bairro text, cidade text, uf text,
  cep text, cnae_principal text, situacao_cadastral text, telefone text, email text)
where f.id = x.id;
commit;""")


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in banco.PROJETOS:
        raise SystemExit(__doc__)
    ref = banco.PROJETOS[sys.argv[1]]
    filtro = "" if "--todos" in sys.argv else "and consultado_receita_em is null"
    fornecedores = banco.sql(ref, f"select id, documento, razao_social, nome_fantasia from public.fornecedores where length(documento) = 14 {filtro} order by razao_social")
    print(f"{len(fornecedores)} fornecedor(es) para consultar", flush=True)
    lote, rel = [], {"ok": 0, "nao_encontrado": [], "falha": [], "nao_ativa": [], "nome_mudou": []}
    for i, f in enumerate(fornecedores, 1):
        situacao, d = consultar(f["documento"])
        if situacao != "ok" or not d or not d["razao_social"]:
            rel["falha" if situacao == "falha" else "nao_encontrado"].append(f"{f['documento']} {f['razao_social']}")
        else:
            antigo = (f["razao_social"] or "").strip()
            if not d["nome_fantasia"]:
                d["nome_fantasia"] = f["nome_fantasia"] or (antigo if antigo.upper() != d["razao_social"].upper() else None)
            if antigo.upper() != d["razao_social"].upper():
                rel["nome_mudou"].append(f"{antigo}  →  {d['razao_social']}")
            if d["situacao_cadastral"] != "ATIVA":
                rel["nao_ativa"].append(f"{d['razao_social']} ({f['documento']}): {d['situacao_cadastral']}")
            lote.append({"id": f["id"], **d})
            rel["ok"] += 1
        if len(lote) >= 25:
            gravar(ref, lote)
            lote = []
        if i % 25 == 0:
            print(f"  {i}/{len(fornecedores)} consultados", flush=True)
        time.sleep(0.6)
    if lote:
        gravar(ref, lote)
    print(json.dumps(rel, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
