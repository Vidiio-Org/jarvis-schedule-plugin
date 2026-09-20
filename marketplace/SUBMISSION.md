# Pacote de envio — Jarvis Schedule (Marketplace de Plugins)

Tudo o que é preciso para enviar **Jarvis Schedule 1.0.0** ao Marketplace do Jarvis ADE, sem precisar decidir nada. Preparado em 2026-09-20 a partir do commit `fbdbc09` (tag `v1.0.0`, já no GitHub). **Nada foi enviado**: este arquivo é só preparação.

> **Regra dura: `npmPackage` fica vazio.** O pacote `jarvis-plugin-schedule` não existe no npm; preenchê-lo faria as verificações `npm-package` e `npm-manifest` falharem.

## Antes de clicar em enviar (verificações rápidas)

1. **`plugin-id-unique`**: procure no Marketplace (jarvisade.com) se outro plugin já usa o `id` `jarvis-schedule`. Se usar, o `id` (manifesto, `package.json`, tag) e o slug precisam mudar antes.
2. **ADE 0.4.0**: a listagem afirma "Jarvis ADE 0.4.0 ou superior" (ícone na barra lateral, Bridge automática). Essas capacidades (`contributes.views`, `bridge: true`, `hello.host.bridge`) estão na branch `feature/plugin-host-views` do staff-agent; o desktop lançado que consta no repositório é o 0.3.0. **Só envie depois de confirmar que o ADE 0.4.0 com essas capacidades está (ou estará) disponível**, senão a listagem promete algo que o usuário não consegue usar. As capturas de tela mostram "0.1.0" na barra de título do app (versão do shell/build de desenvolvimento), por isso as legendas não citam versão do ADE.
3. O repositório `Vidiio-Org/jarvis-schedule-plugin` já é público e a tag `v1.0.0` existe (`repo-reachable`, `manifest-valid`, `version-consistency` devem passar).

## Campos do formulário

### name (15 caracteres; limite 2–60)

```text
Jarvis Schedule
```

### slug (`jarvis-schedule`, 15 caracteres; limite 3–39, `[a-z0-9-]`)

Igual ao `id` do `ade.plugin.json`.

```text
jarvis-schedule
```

### tagline (111 caracteres; limite 120)

```text
Dispara missões recorrentes no Jarvis ADE, instruídas a rodar sem supervisão, e guarda o histórico de cada uma.
```

### category

```text
productivity
```

Rótulo no formulário: **Produtividade**. Categorias aceitas: `integrations`, `productivity`, `agents`, `devtools`, `data`, `themes`, `other`. Escolhida porque o plugin é um agendador de rotinas (tempo, recorrência, histórico); "Agentes" seria a segunda opção, mas o plugin não traz agentes, ele só dispara missões dos que o usuário já tem.

### tags (8 de no máximo 8; cada uma ≤ 24 caracteres, minúsculas, `[a-z0-9-]`)

```text
agendador, missoes, automacao, recorrente, historico, scheduler, autonomo, dashboard
```

Como JSON (para a API): `["agendador","missoes","automacao","recorrente","historico","scheduler","autonomo","dashboard"]`

### repoUrl

```text
https://github.com/Vidiio-Org/jarvis-schedule-plugin
```

### npmPackage

```text
(vazio — não preencher; na API, omita o campo)
```

### homepageUrl (opcional, HTTPS)

```text
https://github.com/Vidiio-Org/jarvis-schedule-plugin#readme
```

### descriptionMd (3144 caracteres; limite 20.000)

Cole exatamente o bloco abaixo (o bloco externo usa quatro crases só para poder conter o Markdown).

````markdown
# Jarvis Schedule

Missões recorrentes no Jarvis ADE, sem ninguém precisar apertar o botão. Você cadastra **briefing + workspace + horário + dias da semana + fuso** (e, se quiser, squad, maestro, modelos, anexos, stack e teste E2E) e, na hora combinada, o plugin abre uma missão no workspace escolhido. Cada disparo fica registrado, com o **resumo final do maestro**, as tarefas com resultado e o custo (quando o ADE informa).

## Como funciona

- **Sem supervisão.** Ao seu briefing, enviado sem alterações, o plugin acrescenta um bloco fixo dizendo ao maestro que ninguém vai responder: nunca chamar `ask_user`, decidir sozinho, não travar e encerrar a missão com `mission_finish` e um resumo completo. É uma instrução ao maestro, não uma garantia: escreva o briefing como se ninguém fosse responder.
- **Painel web próprio, só local.** Agendamentos, histórico e detalhe de cada disparo, abertos pelo ícone **Agendamentos** na barra lateral do ADE, **dentro do app**, sem login e sem token. O painel escuta só em `127.0.0.1` e nada é carregado de fora.
- **Nunca dispara duas vezes o mesmo horário**, mesmo se o ADE ou o plugin reiniciarem. Horário perdido (plugin ou Bridge parados por mais de 15 minutos depois do horário) fica registrado como **Perdido** em vez de disparar atrasado.
- **Executar agora** para testar um agendamento sem esperar.
- Fuso horário por agendamento, com tratamento de horário de verão.

## Instalação

1. No ADE, abra o **Marketplace de Plugins**, encontre **Jarvis Schedule** e instale.
2. Um ícone **Agendamentos** aparece na barra lateral do ADE. Clique e o painel abre dentro do app.

Não há nada para configurar: o ADE inicia a Bridge local sozinho, entrega o acesso ao plugin e autentica o painel. Sem token, sem senha, sem variável de ambiente.

## Requisitos

Jarvis ADE **0.4.0 ou superior** e Node.js 22 ou superior no `PATH`. O plugin não tem dependências: não roda `npm install`.

## ADE mais antigo (sem integração automática)

Num ADE anterior à 0.4.0 o plugin funciona, mas sem o ícone na barra lateral e sem Bridge automática:

1. inicie o ADE com `ADE_BRIDGE=1` (sem isso a Bridge não existe e o painel mostra "Bridge desconectado");
2. copie o token da Bridge (o valor de `ADE_BRIDGE_TOKEN`, ou o token que o ADE imprime uma vez no log, linha `[saas-bridge] token=...`) para a configuração `bridgeToken` do plugin e salve;
3. abra o painel no navegador, em `http://127.0.0.1:4870`, com o `dashboardToken` que você definir nas configurações (mínimo de 12 caracteres) ou com a senha gerada a cada execução, que aparece no log da integração (linha `Painel: … — token …`).

## Segurança

Este plugin inicia missões reais, que executam código na máquina onde o ADE roda. O painel escuta apenas em `127.0.0.1`, exige autenticação em toda chamada da API (dentro do ADE, feita pelo próprio ADE), recusa `Host` não local (DNS rebinding) e envia `Content-Security-Policy` com `frame-ancestors 'none'`. Os tokens da Bridge e do ADE não vão para o log. Não exponha o painel à rede.

Código aberto, licença MIT. Documentação completa no [README](https://github.com/Vidiio-Org/jarvis-schedule-plugin#readme).
````

## Imagens

Envie nesta ordem: primeiro a capa, depois as capturas (a ordem de envio define a ordem de exibição). Todos os arquivos foram verificados: existem, são PNG e estão abaixo de 5 MiB e de 8192 px por lado.

### 1. Capa — `cover.png`

- Arquivo: `/home/vidiio-developer-server/projects/vidiio/jarvis-schedule-plugin/marketplace/cover.png` (PNG, **1200×630**, 77.238 bytes)
- A capa não tem legenda.
- A imagem traz o texto "Missões recorrentes, 100% autônomas": é o slogan da capa, e a descrição explica o mecanismo real (um bloco de instruções ao maestro, não uma garantia). Se preferir alinhar 100% ao texto da listagem, regenere a capa antes de enviar.

### 2. Captura 1 — `01-agendamentos.png`

- Arquivo: `/home/vidiio-developer-server/projects/vidiio/jarvis-schedule-plugin/marketplace/screenshots/01-agendamentos.png` (PNG, 1280×800)
- Legenda (118/140 caracteres):

```text
Tela Agendamentos dentro do ADE: horário, dias, fuso, próxima e última execução, com Executar agora, Editar e Excluir.
```

### 3. Captura 2 — `02-formulario-squad-modelos.png`

- Arquivo: `/home/vidiio-developer-server/projects/vidiio/jarvis-schedule-plugin/marketplace/screenshots/02-formulario-squad-modelos.png` (PNG, 1280×800)
- Legenda (112/140 caracteres):

```text
Novo agendamento: modelos permitidos, modelo por agente do squad, stack do projeto e fluxo de teste E2E visível.
```

### 4. Captura 3 — `03-historico.png`

- Arquivo: `/home/vidiio-developer-server/projects/vidiio/jarvis-schedule-plugin/marketplace/screenshots/03-historico.png` (PNG, 1280×800)
- Legenda (104/140 caracteres):

```text
Histórico de disparos com origem (agendado ou manual), horário previsto e disparado, e status Concluído.
```

### 5. Captura 4 — `04-plugins-instalados.png`

- Arquivo: `/home/vidiio-developer-server/projects/vidiio/jarvis-schedule-plugin/marketplace/screenshots/04-plugins-instalados.png` (PNG, 1280×800)
- Legenda (96/140 caracteres):

```text
Marketplace de Plugins → Instalados: Jarvis Schedule em execução, com o botão Open Agendamentos.
```

Tamanhos: 01 = 103.094 bytes, 02 = 150.984, 03 = 117.037, 04 = 124.935 (todos 1280×800). As quatro mostram dados de demonstração (workspace `checkout-service`, agendamento "Varredura diária de QA").

## Como submeter

O plano é o mesmo nos dois caminhos: (1) conta de cliente com sessão ativa, (2) identidade de publicador, (3) listagem, (4) capa, (5) capturas.

**Publicador sugerido para a Vidiio** (regras do handle: 3–39 caracteres, `[a-z0-9-]`, sem hífen nas pontas):

| Campo | Valor |
| --- | --- |
| `handle` | `vidiio` (6 caracteres) |
| `displayName` | `Vidiio` (até 60) |

O handle aparece na URL pública (`<handle>/<slug>` → `vidiio/jarvis-schedule`) e **fica travado depois da primeira aprovação** (`MARKETPLACE_HANDLE_LOCKED`); se `vidiio` já estiver em uso, o erro é `MARKETPLACE_HANDLE_TAKEN` e a alternativa é `vidiio-org`.

### Caminho A — formulário web

1. Entre em <https://jarvisade.com> (área do cliente) com e-mail e senha da conta da Vidiio e digite o código de 6 dígitos que chega por e-mail (OTP).
2. Abra <https://jarvisade.com/painel/plugins/novo>. Se pedir a identidade de publicador, informe **handle** `vidiio` e **nome de exibição** `Vidiio`.
3. Preencha campo a campo (os rótulos do formulário podem variar um pouco) com os blocos da seção "Campos do formulário":
   1. **Nome** → `Jarvis Schedule`
   2. **Slug** → `jarvis-schedule`
   3. **Resumo (tagline)** → o texto de 111 caracteres
   4. **Descrição (Markdown)** → o bloco `descriptionMd`
   5. **Categoria** → Produtividade
   6. **Tags** → as 8 tags, uma a uma
   7. **URL do repositório** → `https://github.com/Vidiio-Org/jarvis-schedule-plugin`
   8. **Pacote npm** → **deixe em branco**
   9. **Site** → `https://github.com/Vidiio-Org/jarvis-schedule-plugin#readme`
4. Envie o formulário. A listagem nasce como **Pendente** e as verificações automáticas rodam na hora; confira o resultado na tela.
5. Anexe a **capa** (`/home/vidiio-developer-server/projects/vidiio/jarvis-schedule-plugin/marketplace/cover.png`) e, na ordem, as 4 **capturas** com as legendas acima.
6. Aguarde a aprovação de um administrador. Depois dela, `npx -y jarvis-ade plugins add vidiio/jarvis-schedule` passa a funcionar.

### Caminho B — HTTP com curl

Base: `https://jarvis-license.vidiio.net`. Substitua os marcadores `<...>`. Não grave a senha, o código nem o token em arquivo versionado nem em histórico compartilhado.

```bash
API=https://jarvis-license.vidiio.net
IMG=/home/vidiio-developer-server/projects/vidiio/jarvis-schedule-plugin/marketplace/

# 1) login: confere a senha e envia o OTP por e-mail; devolve challengeId
curl -sS -X POST "$API/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"<EMAIL_DA_CONTA>","password":"<SENHA>"}'
# => {"challengeId":"<UUID>","email":"vi***@...","expiresAt":"..."}

# 2) verify: troca challengeId + código de 6 dígitos pelo token de sessão
curl -sS -X POST "$API/v1/auth/verify" \
  -H 'Content-Type: application/json' \
  -d '{"challengeId":"<UUID_DO_PASSO_1>","code":"<CODIGO_6_DIGITOS>"}'
# => {"sessionToken":"<TOKEN>","expiresAt":"...","customer":{...}}
TOKEN='<sessionToken>'

# 3) identidade de publicador (409 MARKETPLACE_HANDLE_TAKEN se o handle já existe)
curl -sS -X PUT "$API/v1/marketplace/me/publisher" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"handle":"vidiio","displayName":"Vidiio"}'

# 4) cria a listagem (sempre PENDING; as verificações automáticas rodam na resposta).
#    Sem o campo npmPackage, de propósito. Guarde o "id" da resposta.
curl -sS -X POST "$API/v1/marketplace/me/plugins" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data @plugin.json
ID='<id devolvido no passo 4>'
```

`plugin.json` (o `descriptionMd` é o bloco da seção anterior, em uma única string JSON; o jeito mais seguro é gerá-lo com `jq --rawfile d desc.md '{...,descriptionMd:$d}'`, onde `desc.md` contém só o Markdown):

```json
{
  "name": "Jarvis Schedule",
  "slug": "jarvis-schedule",
  "tagline": "Dispara missões recorrentes no Jarvis ADE, instruídas a rodar sem supervisão, e guarda o histórico de cada uma.",
  "descriptionMd": "<CONTEÚDO DO BLOCO descriptionMd>",
  "category": "productivity",
  "tags": ["agendador","missoes","automacao","recorrente","historico","scheduler","autonomo","dashboard"],
  "repoUrl": "https://github.com/Vidiio-Org/jarvis-schedule-plugin",
  "homepageUrl": "https://github.com/Vidiio-Org/jarvis-schedule-plugin#readme"
}
```

```bash
# 5) capa (multipart, campo "file"; PNG/JPEG/WebP ≤ 5 MiB)
curl -sS -X POST "$API/v1/marketplace/me/plugins/$ID/cover" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@${IMG}cover.png;type=image/png"

# 6) capturas, nesta ordem (campo "file" + "caption" ≤ 140; máximo de 8)
curl -sS -X POST "$API/v1/marketplace/me/plugins/$ID/screenshots" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@${IMG}screenshots/01-agendamentos.png;type=image/png" \
  -F "caption=Tela Agendamentos dentro do ADE: horário, dias, fuso, próxima e última execução, com Executar agora, Editar e Excluir."

curl -sS -X POST "$API/v1/marketplace/me/plugins/$ID/screenshots" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@${IMG}screenshots/02-formulario-squad-modelos.png;type=image/png" \
  -F "caption=Novo agendamento: modelos permitidos, modelo por agente do squad, stack do projeto e fluxo de teste E2E visível."

curl -sS -X POST "$API/v1/marketplace/me/plugins/$ID/screenshots" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@${IMG}screenshots/03-historico.png;type=image/png" \
  -F "caption=Histórico de disparos com origem (agendado ou manual), horário previsto e disparado, e status Concluído."

curl -sS -X POST "$API/v1/marketplace/me/plugins/$ID/screenshots" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@${IMG}screenshots/04-plugins-instalados.png;type=image/png" \
  -F "caption=Marketplace de Plugins → Instalados: Jarvis Schedule em execução, com o botão Open Agendamentos."

# 7) conferir status e resultado das verificações automáticas
curl -sS "$API/v1/marketplace/me/plugins/$ID" -H "Authorization: Bearer $TOKEN"

# (opcional) encerrar a sessão
curl -sS -X POST "$API/v1/auth/logout" -H "Authorization: Bearer $TOKEN"
```

Erros comuns: `MARKETPLACE_HANDLE_TAKEN` (troque o handle), verificação `plugin-id-unique` reprovada (outro plugin com o mesmo `id`), `npm-package` reprovada (você preencheu `npmPackage`; remova com `PATCH /v1/marketplace/me/plugins/$ID` e `{"npmPackage":null}`). Depois de aprovada, edições viram `pendingRevision` até um administrador aprovar de novo.

## Conferência de veracidade (o que foi corrigido)

Cada afirmação da tagline e da descrição foi conferida contra o código de 1.0.0 (`src/`, `ui/`, `ade.plugin.json`, 171 testes passando). Ajustes feitos:

| Onde | Antes | Depois | Motivo |
| --- | --- | --- | --- |
| tagline | "…missões recorrentes **100% autônomas**…" | "…missões recorrentes no Jarvis ADE, **instruídas a rodar sem supervisão**…" | O plugin só acrescenta um bloco de instruções ao briefing (`src/autonomy.ts`); não controla o maestro, então "100% autônomas" prometia mais do que o código faz |
| descrição, "Como funciona" | "**100% autônomo.**" | "**Sem supervisão.**" + "É uma instrução ao maestro, não uma garantia" | Mesmo motivo |
| descrição, "Segurança" | "Os tokens não vão para o log" | "Os tokens da Bridge e do ADE não vão para o log" | Num ADE antigo, sem `dashboardToken`, a senha gerada do painel é escrita no log local (`src/index.ts`, "Painel: … — token …"); a frase geral era exagerada |
| descrição, "Segurança" | "exige autenticação em toda chamada" | "…em toda chamada **da API**" | Os arquivos estáticos do painel (tela de login) são servidos sem token; só `/api/*` exige (`src/api.ts`) |
| descrição, "Como funciona" | "ADE fechado por mais de 15 minutos" | "plugin ou Bridge parados por mais de 15 minutos depois do horário" | É o que o código faz: `GRACE_MS` de 15 min após o horário do slot; o registro "Perdido" diz que o plugin/Bridge não estava rodando |
| descrição, "Como funciona" | "…tarefas com resultado e o custo" | "…e o custo (quando o ADE informa)" | `costUsd` pode ser nulo |
| listing.md, campo npm | `jarvis-plugin-schedule` | vazio | Regra dura: o pacote não existe no npm |
| listing.md, "Antes de enviar" | "Publicar o pacote npm…" | "Deixe o pacote npm em branco…" | Mesmo motivo |
| listing.md, legendas | Legendas com negrito Markdown e citando "ADE 0.4.0" | Texto puro (≤ 140) e sem versão do ADE | O envio de legenda é texto puro; a barra de título das capturas mostra 0.1.0 |
| listing.md, legenda 2 | "modelo por agente, stack e fluxo E2E" | "modelos permitidos, modelo por agente do squad, stack do projeto e fluxo de teste E2E visível" | Igual ao que a captura 02 mostra |

Conferido e correto (sem mudança): painel só em `127.0.0.1` (`server.listen(port,'127.0.0.1')`); recusa de `Host` não local e `Content-Security-Policy` com `frame-ancestors 'none'` (`src/api.ts`); briefing enviado sem alterações + bloco fixo (`buildBrief`); nada carregado de fora (nenhuma URL externa em `ui/`, CSP `default-src 'self'`); não dispara duas vezes o mesmo horário (registro gravado antes de chamar a Bridge; teste "reinício não redispara o horário"); **Executar agora**; fuso e horário de verão (`src/time.ts`, regras documentadas); histórico com resumo, tarefas e custo; squad, maestro, modelos permitidos e por agente, anexos, stack e E2E (`src/bridge.ts`); sem dependências de runtime e Node ≥ 22 (`package.json`).

Pontos que dependem de fora do repositório e não puderam ser provados aqui: o ADE 0.4.0 com telas de plugin e Bridge automática (ver a verificação 2 no topo) e o comportamento do servidor de produção do marketplace (as rotas e os limites acima vêm do código do staff-agent, `marketplace-author.controller.ts`, `marketplace.dto.ts` e `marketplace.constants.ts`; não houve chamada à API real).
