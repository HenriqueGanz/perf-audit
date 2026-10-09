# perf-audit

Ferramenta de linha de comando para auditoria de performance web. O relatório sai em
Markdown.

O motor principal é a **API do PageSpeed Insights**: a medição roda nos servidores do
Google e dá o mesmo número que aparece em pagespeed.web.dev. Como fallback, a
ferramenta usa o **Lighthouse local**.

## Instalação

```bash
npm install
npx puppeteer browsers install chrome@stable   # Chrome para o motor local e as ferramentas
cp .env.example .env                           # e preencha PSI_API_KEY
```

Requer Node 18 ou mais recente. O Chrome é localizado nesta ordem:

1. variável `CHROME_PATH`;
2. cache do Puppeteer (versão mais nova);
3. caminhos padrão do sistema.

## Chave do PageSpeed (gratuita)

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto ou use
   um existente.
2. Vá em **APIs e serviços → Biblioteca**, procure **PageSpeed Insights API** e clique
   em **Ativar**.
3. Vá em **APIs e serviços → Credenciais → Criar credenciais → Chave de API**.
4. Em **Restrições de API**, limite a chave à PageSpeed Insights API.
5. Coloque a chave no `.env` como `PSI_API_KEY=...`. O `.env` está no `.gitignore`.

Com chave, a cota é de 25.000 consultas por dia e 400 a cada 100 segundos. Sem chave, a
cota pública é compartilhada e se esgota rápido.

## Uso

```bash
# Mobile + desktop, motor automático (PageSpeed; Lighthouse local se falhar)
node bin/audit.js https://site.com/

# Só mobile, 5 execuções, usa a mediana, gera o HTML oficial do relatório
node bin/audit.js https://site.com/ --form=mobile --execucoes=5 --html

# Exige o PageSpeed (sem fallback)
node bin/audit.js https://site.com/ --motor=psi

# Compara com uma medição anterior
node bin/audit.js https://site.com/ --compare=reports/site-com-20260101-120000.json

# "E se este recurso não carregasse?" (só no motor local)
node bin/audit.js https://site.com/ --block='*googletagmanager.com*,*hotjar*'
```

| Opção | Padrão | Descrição |
|---|---|---|
| `--motor=auto\|psi\|local` | `auto` | Motor de medição (ver abaixo) |
| `--form=mobile\|desktop\|both` | `both` | Formato |
| `--execucoes=N` | `1` | Roda N vezes e usa a execução mediana pela nota |
| `--html` | – | Gera o relatório HTML oficial do Lighthouse (fonte dos prints) |
| `--compare=arquivo.json` | – | Tabela de diferença contra uma medição anterior |
| `--block=padrões` | – | Bloqueia URLs durante a medição (força o motor local) |
| `--site=chave` | domínio | Prefixo dos arquivos gerados |

### Motores

| Motor | Quando usar | Limites |
|---|---|---|
| `psi` | Número oficial, o mesmo que o cliente vê. Traz dados de campo (CrUX). | Só URLs públicas; não bloqueia URLs; sem cabeçalhos ou cookies; 15–40 s por chamada |
| `local` | Experimentos com `--block`, páginas de homologação, sem cota | A nota tende a sair abaixo da do PageSpeed (outra máquina, outra rede) |
| `auto` | Padrão: tenta o PSI e cai para o local em caso de falha. O relatório registra o motor e o motivo do fallback. | – |

Notas dos dois motores **não são comparáveis entre si**: compare PSI com PSI e local
com local. Quando o `--compare` cruza motores, o relatório avisa.

Em séries (`--execucoes`), o motor da primeira execução vale para a série toda. Se o
PSI falhar no meio, a execução é descartada; os motores não se misturam na mediana.

## O que o relatório traz

- Nota e métricas de laboratório (FCP, LCP, TBT, CLS, SI), com o motor e a versão do
  Lighthouse.
- **Dados de campo (CrUX, p75 de 28 dias)**: LCP, INP, CLS, FCP e TTFB. Vêm só do
  PSI; usam os dados da página ou, na falta, os da origem.
- Elemento do LCP, flags (lazy-load, `fetchpriority`, descoberta no HTML) e
  subpartes.
- Oportunidades ordenadas por economia estimada.
- Terceiros com tempo de CPU.
- Recursos que bloqueiam renderização.
- Diferença contra medição anterior (`--compare`).

Cada execução grava em `reports/`:

| Arquivo | Conteúdo |
|---|---|
| `<site>-<data>.json` | Consolidado, usado como entrada do `--compare` |
| `<site>-<data>.md` | Relatório legível |
| `<site>-<data>-<formato>.lhr.json` | LHR bruto (PSI ou local) |
| `<site>-<data>-<formato>.psi.json` | Resposta completa da API (só no PSI) |
| `<site>-<data>-<formato>.report.html` | Relatório oficial (com `--html`) |

## Ferramentas auxiliares (`tools/`)

### Rodada de evidências

Quantifica o custo de cada recurso bloqueando URLs, com N execuções intercaladas por
cenário. Descarta execuções com TTFB alto e verifica se o bloqueio realmente pegou. Só
roda no motor local.

```bash
node tools/evidence-round.js --cenarios=exemplos/cenarios.exemplo.json --n=7 [--form=desktop] [--html]
```

O formato do arquivo de cenários está em `exemplos/cenarios.exemplo.json`. O primeiro
cenário é a linha de base dos deltas.

### Contador de rastreadores

Conta as requisições a rastreadores, os IDs GA4 distintos, as coletas com erro e os
bytes totais. Serve para conferir mudanças no Tag Manager sem o ruído da nota.

```bash
node tools/tracker-count.js https://site.com/ https://site.com/outra/ [--form=desktop] [--espera=16] [--padroes='meudominio-de-chat']
```

### Prints do relatório

Recorta o medidor da nota e os diagnósticos do HTML oficial (gerado com `--html`). Se
o HTML veio do PSI, o print mostra o número do PageSpeed.

```bash
node tools/shot-report.js reports/site-com-20260101-120000-mobile.report.html home-mobile [--saida=prints/]
```

### HTML → PDF de página única

Gera um PDF contínuo, sem quebras de página, com tema claro.

```bash
node tools/html-para-pdf.js relatorio.html [relatorio.pdf] [--largura=1000]
```

## Variação entre execuções

TBT e LCP variam bastante entre execuções, principalmente em hospedagem compartilhada.
Para decidir algo, use `--execucoes=3` ou mais e olhe a mediana. Para medir o efeito de
uma mudança isolada, prefira bytes e número de requisições (rodada de evidências,
contador de rastreadores), que são quase determinísticos.

## Estrutura

```
bin/audit.js           entrypoint
lib/engine.js          escolha do motor e fallback
lib/engines/psi.js     PageSpeed Insights API v5
lib/engines/local.js   Lighthouse local (CLI da dependência)
lib/parse.js           métricas, diagnósticos e dados de campo
lib/report-md.js       relatório Markdown
lib/html-report.js     relatório HTML oficial a partir do LHR
lib/compare.js         diferença entre medições
lib/chrome.js          localização do Chrome
lib/env.js             leitura do .env
tools/                 ferramentas auxiliares
exemplos/              arquivo de cenários de exemplo
```
