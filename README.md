# Jarvis Schedule

Plugin do [Jarvis ADE](https://jarvisade.com) que **dispara missões recorrentes**. Você cadastra um agendamento (briefing + workspace + horário + dias da semana + fuso + squad opcional) e, no horário combinado, o plugin abre uma missão no workspace escolhido, com o briefing e um reforço fixo para o maestro trabalhar **100% sem supervisão**. Cada disparo fica registrado em um histórico, junto com o resumo e os dados que o maestro devolveu.

No Jarvis ADE 0.4.0 ou superior ele **abre dentro do próprio app**: um ícone **Agendamentos** aparece na barra lateral, sem token, sem senha e sem configurar a Bridge. O plugin traz o seu próprio painel (agendamentos, histórico e detalhe de cada disparo), servido só em `127.0.0.1`.

## O que ele faz

- Dispara uma missão por agendamento, todos os dias ou nos dias que você escolher, no fuso horário do agendamento (com tratamento de horário de verão).
- Envia o seu briefing **sem alterações**, seguido do texto de autonomia descrito [abaixo](#reforço-de-autonomia).
- Acompanha a missão até o fim e guarda status, resumo final do maestro, tarefas com resultado, custo (quando o ADE informa) e os dados brutos da missão.
- Nunca dispara o mesmo horário duas vezes, mesmo se o ADE ou o plugin reiniciarem.
- Botão **Executar agora** para testar um agendamento sem esperar o horário.

## Requisitos

- **Jarvis ADE 0.4.0 ou superior** (caminho integrado, sem configuração). Um ADE mais antigo também funciona, mas exige passos manuais: veja [ADE mais antigo (sem integração automática)](#ade-mais-antigo-sem-integração-automática).
- Node.js 22 ou superior disponível no `PATH` (o ADE inicia o plugin com `node`).
- Nada de `npm install`: o plugin não tem dependências em tempo de execução e o `dist/` já vem compilado.

## Instalação

1. No ADE, abra o **Marketplace de Plugins**, encontre **Jarvis Schedule** e instale. (Enquanto a listagem não estiver aprovada, importe pela origem git: **Marketplace de Plugins → Instalados → Importar plugin → URL git**, com `https://github.com/Vidiio-Org/jarvis-schedule-plugin`.)
2. Pronto. Um ícone **Agendamentos** aparece na barra lateral do ADE, ao lado do ícone de Plugins. Clique nele e o painel abre **dentro do app**.

Não há nada para preencher. O ADE inicia a Bridge local sozinho quando o plugin precisa dela e entrega o endereço e o token ao plugin, e ele mesmo autentica o painel: você não digita token nenhum nem mexe nas configurações. No topo do painel aparece **Conectado à Bridge do ADE (automático)**.

Se a integração não estiver em execução (desativada ou com erro), a tela mostra o estado e um atalho para as configurações. Quando o plugin reinicia, o ADE recarrega a tela; se ela mostrar "A sessão do painel expirou", use **Recarregar**. Se o ADE reiniciar a Bridge ou trocar o token dela, o plugin adota as novas credenciais na hora, sem reiniciar nem perder agendamentos.

## Configurações

Todas são opcionais. Num ADE 0.4.0 ou superior você não precisa mexer em nenhuma.

| Chave | Tipo | Padrão | O que faz |
| --- | --- | --- | --- |
| `bridgeUrl` | texto | `http://127.0.0.1:4820` | **Só para ADE mais antigo.** Endereço da ADE SaaS Bridge. É ignorada quando o ADE entrega a Bridge automaticamente. |
| `bridgeToken` | segredo | — | **Só para ADE mais antigo.** Token da Bridge. É ignorado quando o ADE entrega a Bridge automaticamente. Veja [ADE mais antigo](#ade-mais-antigo-sem-integração-automática). |
| `dashboardPort` | número | `4870` | Porta do painel (sempre em `127.0.0.1`). |
| `dashboardToken` | segredo | — | Senha para abrir o painel **num navegador comum**, com **pelo menos 12 caracteres** (se preenchido com menos que isso, o plugin se recusa a iniciar). Dentro do ADE não é preciso: a tela Agendamentos entra sozinha. |
| `defaultTimezone` | texto | `America/Sao_Paulo` | Fuso IANA sugerido para novos agendamentos. Se for inválido, o plugin usa `America/Sao_Paulo` e avisa no log. |
| `historyRetentionDays` | número | `90` | Quantos dias de histórico manter (mínimo 1, máximo 3650). Registros mais antigos são apagados. |
| `enabled` | booleano | `true` | Chave geral. Desligada, **nenhum agendamento dispara sozinho** (o painel continua no ar e "Executar agora" continua funcionando). |

## Como abrir o painel

### Dentro do ADE (recomendado)

Com o plugin instalado e a integração em execução, clique no ícone **Agendamentos** na barra lateral. O painel abre como uma tela nativa do ADE, **sem login e sem digitar token**: o ADE autentica as chamadas por conta própria com um token que existe só naquela execução do plugin.

Nessa tela o painel não repete o título "Jarvis Agendador" nem mostra o botão **Sair**; o estado da conexão com a Bridge continua visível no topo.

### Num navegador (opcional)

Para usar o painel fora do ADE, acesse:

```
http://127.0.0.1:<dashboardPort>
```

Com a porta padrão, `http://127.0.0.1:4870`. Na tela de login, digite o valor de `dashboardToken`. O token fica só no `sessionStorage` do navegador (some ao fechar a aba) e é enviado como `Authorization: Bearer` em cada chamada. Se ele for recusado, o painel volta para o login com a mensagem "Token inválido ou expirado. Entre novamente."

Sem `dashboardToken` configurado e num ADE que não autentica a tela (o ADE mais antigo), o plugin gera uma senha nova a cada execução e a escreve no log da integração, na linha `Painel: http://127.0.0.1:<porta>/ — token <senha>`; copie o endereço e a senha dali. Esse log fica só no seu computador.

No navegador o painel se chama "Jarvis Agendador" e o topo mostra se a Bridge está **conectada** (automática ou manual) ou **desconectada**.

## ADE mais antigo (sem integração automática)

Isto vale **só** para um ADE anterior à versão 0.4.0. Nele o plugin instala normalmente, mas:

- o ADE **ignora o ícone Agendamentos** (não há telas de plugin): o painel só abre no navegador;
- o ADE **não inicia a Bridge para o plugin**: você precisa ligá-la e informar o token manualmente.

Passos:

1. **Inicie o ADE com a Bridge ligada**: defina `ADE_BRIDGE=1` no ambiente do aplicativo (não existe opção na interface). Opcionalmente `ADE_BRIDGE_PORT` (padrão `4820`) e `ADE_BRIDGE_TOKEN`. **Sem `ADE_BRIDGE=1` a Bridge não existe** e o painel só mostra **Bridge desconectado**.
2. **Pegue o token da Bridge.** Se você definiu `ADE_BRIDGE_TOKEN`, é esse valor; senão o ADE gera um token aleatório e o imprime **uma vez** no log do aplicativo, na linha `[saas-bridge] token=... port=...`. Trate-o como uma credencial de acesso à máquina que roda o ADE.
3. Nas configurações do plugin preencha **`bridgeToken`** (e `bridgeUrl`, só se a porta não for a `4820`) e salve. Ao salvar, o ADE reinicia o plugin. Sem `bridgeToken` (e sem Bridge entregue pelo ADE) a integração não inicia.
4. **Abra o painel no navegador**, em `http://127.0.0.1:<dashboardPort>`, com o `dashboardToken` que você definiu nas configurações; se não definiu nenhum, use a senha gerada a cada execução, na linha `Painel: … — token …` do log da integração (veja acima).

O plugin usa a Bridge entregue pelo ADE sempre que ela existir; `bridgeUrl` e `bridgeToken` só valem quando ela não vem.

## Criando um agendamento

Em **Agendamentos → Novo agendamento**, preencha:

| Campo | Como funciona |
| --- | --- |
| **Nome** | Como o agendamento aparece na lista e no histórico. |
| **Briefing** | O que o maestro deve fazer. Vai para a missão exatamente como você escreveu (até 100.000 caracteres). |
| **Workspace** | Lista vinda do ADE. A missão é aberta nesse workspace. |
| **Horário** | `HH:MM` no fuso do agendamento. É um horário de disparo único por dia, não uma janela. |
| **Dias** | Caixas de seleção de domingo a sábado, com atalhos "Todos os dias" e "Dias úteis". |
| **Fuso horário** | Nome IANA (ex.: `America/Sao_Paulo`). Começa com o `defaultTimezone`. |
| **Squad** | Lista vinda do ADE. "Padrão" não escolhe squad: a missão usa o comportamento padrão do ADE. |
| **Anexos** | Arquivos que o maestro recebe em toda execução (veja [Briefing completo](#briefing-completo-anexos-maestro-modelos-e2e-e-stack)). |
| **Maestro** | Qual maestro conduz a missão. "Padrão do Jarvis ADE" não escolhe nenhum. |
| **Modelos liberados / Modelo por agente** | Quais modelos o maestro pode usar e qual modelo cada agente do squad usa. |
| **Stack** | Tecnologias já conhecidas do projeto (opcional). |
| **Fluxo de teste E2E visível** | Liga o teste end-to-end em navegador visível. |
| **Agendamento ativo** | Desativado, o agendamento fica "Pausado" e não dispara sozinho. |

Erros de validação da API (por exemplo, fuso inexistente ou workspace que o Bridge não conhece) aparecem no formulário. Nomes de fuso são gravados na forma canônica: `america/sao_paulo` vira `America/Sao_Paulo`. Na lista de agendamentos você também vê a próxima e a última execução de cada um, e pode **editar**, **excluir** (com confirmação; o histórico já gravado é mantido) ou **executar agora**.

Criar ou alterar horário, dias, fuso ou o estado ativo de um agendamento nunca dispara horários que já passaram: só valem os horários a partir da alteração.

## Briefing completo: anexos, maestro, modelos, E2E e stack

O formulário oferece as mesmas opções de briefing que o app do Jarvis ADE oferece ao criar uma missão. Tudo é opcional e o que você não mexer segue o padrão do ADE.

- **Anexos.** Escolha um ou mais arquivos (até **50 MB cada**, **200 MB** e **20 arquivos** por agendamento, os mesmos 50 MB por arquivo que o Bridge aceita). Os arquivos só são gravados quando você salva o agendamento e ficam em `ADE_PLUGIN_DATA_DIR/attachments/<id do agendamento>/`, com nome gerado pelo plugin (o nome que você vê é só um rótulo, sem caminho). O estacionamento de anexos do Bridge fica em memória e descarta ids antigos, então **a cada disparo o plugin reenvia os arquivos** ao Bridge e usa os ids novos. Se o envio falhar (por exemplo, arquivo grande demais para o Bridge), o disparo termina em **Falha no disparo** com o motivo, e nenhuma missão é aberta.
- **Maestro.** Lista só os maestros que o Bridge diz estarem disponíveis nesta máquina. "Padrão do Jarvis ADE" não envia nenhum.
- **Squad e modelo por agente.** Ao escolher um squad, cada agente aparece com um seletor de modelo que lista **todos** os modelos do catálogo, agrupados por fornecedor (Claude, Codex, Gemini…). O modelo define a CLI, então qualquer agente pode rodar o modelo de outra CLI; o plugin não compara o fornecedor do agente com o do modelo. "Padrão (X)" mantém o modelo do agente (ou o do squad, se ele definir um).
- **Modelos liberados.** O conjunto de modelos que o maestro pode alocar. Sem seleção vale o pool do squad, ou qualquer modelo se o squad não restringir. Ao restringir o pool, um modelo de agente que ficou fora dele volta ao padrão, com aviso na tela.
- **Fluxo de teste E2E visível.** Liga o teste end-to-end em navegador visível; precisa de um agente de QA (Reviewer) no squad.
- **Stack.** Uma lista por camada (Backend, Frontend, Mobile, Infra, Outros), separada por vírgulas, igual ao `stack` que o Bridge aceita. O maestro continua analisando o projeto; isto só evita que ele adivinhe.
- **Figma.** Não está disponível no agendamento: o Bridge só lista as fontes Figma do workspace ativo (ou de uma missão já criada), então o plugin não consegue oferecê-las para qualquer workspace antes de a missão existir.

**Seleção de modelos exige um Jarvis ADE recente.** O plugin só mostra e só envia `modelPool`/`agentModels` quando o catálogo do Bridge traz `models`. Num Jarvis ADE mais antigo o painel esconde os seletores e mostra "Seleção de modelos indisponível: atualize o Jarvis ADE para escolher modelos.", e nenhum campo de modelo é enviado (se o agendamento já tinha modelos salvos, eles são mantidos, mas o disparo registra o aviso). Um Bridge novo recusa ids de modelo desconhecidos, e o disparo termina em **Falha no disparo** com a mensagem dele.

No **detalhe do disparo**, a seção **Opções usadas** mostra exatamente o que foi enviado: squad, maestro, E2E, stack, modelos liberados, modelo por agente e os nomes dos anexos, mais os avisos (como modelos não enviados a um Bridge antigo). Agendamentos criados antes destas opções continuam funcionando, com os valores padrão.

## Reforço de autonomia

Todo disparo envia o seu briefing seguido, sem alterações, deste bloco fixo (em inglês, porque é uma instrução para o maestro):

```
---
SCHEDULED, UNATTENDED RUN — AUTONOMY REQUIREMENTS (added automatically by the Jarvis Schedule plugin)

This mission was started by a schedule. Nobody is watching and nobody will answer. You (the maestro) MUST run 100% autonomously:
- NEVER call ask_user and NEVER wait for a human reply, approval or confirmation.
- Take every decision yourself, using sensible defaults whenever something is ambiguous or missing. State the assumptions you made.
- NEVER stall or block: if something is impossible or fails, work around it or record it and move on with what can be done.
- Complete the work described above, then close the mission by calling mission_finish with a COMPLETE summary of what was done and the result (deliverables, key findings or numbers, anything that failed or was skipped, and any follow-ups). That summary is stored as this run's record.
```

O texto vem de `src/autonomy.ts`. Escreva o briefing como se ninguém fosse responder: quanto mais completo (onde olhar, o que entregar, o que fazer diante de dúvida), melhor o resultado.

## Histórico e detalhe do disparo

**Histórico** lista os disparos do mais novo para o mais antigo, com filtro por agendamento e atualização automática a cada ~10 segundos. Cada linha mostra o agendamento, se foi **Agendado** ou **Manual**, o horário previsto, quando foi disparado, o status e o nome da missão.

| Status | Significado |
| --- | --- |
| **Disparando** | O pedido de criação da missão está sendo enviado à Bridge. |
| **Em execução** | A missão foi criada e está rodando. |
| **Concluído** | A missão terminou com sucesso; o resumo do maestro foi gravado. |
| **Falhou** | A missão terminou com falha ou foi abortada, ou a Bridge deixou de listá-la, ou continuou rodando 48 horas depois do disparo. |
| **Falha no disparo** | A Bridge recusou ou não recebeu o pedido; nenhuma missão foi aberta (o motivo fica no campo de erro). |
| **Perdido** | O horário passou sem disparar (veja a próxima seção). |

Ao abrir um disparo você vê todos os campos do registro, o **resumo do maestro** (com as quebras de linha preservadas e o texto sempre escapado, nunca interpretado como HTML), a lista de **tarefas** com status e resultado, o **custo** em US$ (quando o ADE informa), o **erro** (quando houver) e os **dados brutos** em uma seção recolhida. Enquanto o disparo está ativo, a página se atualiza sozinha.

O plugin acompanha cada missão pelo fluxo de eventos da Bridge (SSE) e, como reforço, consulta a lista de missões a cada 30 segundos. Isso também retoma disparos que ficaram abertos se o plugin reiniciar.

## Horários perdidos, tolerância e duplicidade

- O agendador verifica a cada ~20 segundos.
- Um horário é disparado quando chega a hora e o atraso é de **até 15 minutos** (tolerância para quem estava com o ADE fechado, com a Bridge fora do ar ou com um ciclo atrasado).
- Passados os 15 minutos, o horário **não é disparado**: fica registrado como **Perdido**, com a explicação no campo de erro. Só são reavaliados horários dos últimos 7 dias, limitados pela retenção do histórico.
- **Sem disparo duplo:** antes de chamar a Bridge, o plugin grava o registro do disparo em disco (`ADE_PLUGIN_DATA_DIR`), e esse registro serve de trava. O ADE reenvia `hello` a cada reinício do plugin (salvar configurações, reabrir o app, recuperação de falha), e mesmo assim o mesmo horário nunca é disparado de novo. Se o plugin cair no meio de um disparo, ele **não** é repetido: a missão pode já ter sido criada, então o registro termina como "Falha no disparo".
- Só falhas de conexão recusada ou de nome não resolvido (o pedido comprovadamente não chegou à Bridge) são repetidas, e apenas dentro da tolerância de 15 minutos, a cada 30 segundos.
- **Horário de verão:** um horário que não existe (pulo da hora) dispara no instante equivalente deslocado (02:30 vira 03:30); um horário que acontece duas vezes dispara na primeira ocorrência.
- O horário fica por conta do relógio do computador que roda o ADE: se ele estiver desligado, nada dispara.

## Segurança

- **Este plugin inicia missões reais, que executam código na máquina onde o ADE roda.** Quem acessa o painel consegue disparar missões. Por isso o acesso pelo navegador exige um token: se você configurar o `dashboardToken`, use no mínimo 12 caracteres, de preferência um valor longo e único. Dentro do ADE o acesso é autenticado pelo próprio ADE (token por execução, nunca visível na tela nem na URL), e a Bridge é iniciada pelo ADE só em `127.0.0.1`, com o token entregue direto ao plugin.
- O painel só escuta em `127.0.0.1`. Não o exponha a outras máquinas nem à internet (túnel, proxy reverso).
- Toda rota `/api/*` exige um token: o `dashboardToken` ou o token da execução que o ADE envia (comparação em tempo constante). Requisições com cabeçalho `Host` que não seja local (`127.0.0.1`, `localhost`, `[::1]`) são recusadas com `403 FORBIDDEN_HOST`, o que barra ataques de DNS rebinding. Não há CORS.
- O painel envia `Content-Security-Policy` (incluindo `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff` e `Cache-Control: no-store`. Não carrega nada de fora: sem CDN, sem fontes externas, sem frameworks.
- Textos vindos da API e das missões são sempre exibidos como texto, nunca como HTML.
- Os tokens (o da Bridge, seja o entregue pelo ADE ou o `bridgeToken`, o `dashboardToken` e o token do ADE) não são gravados em log nem guardados em disco pelo plugin. Única exceção, de propósito: sem nenhum `dashboardToken` e num ADE sem telas de plugin, a senha gerada a cada execução aparece no log local da integração (linha `Painel: …`), para você conseguir abrir o painel.
- O histórico guarda o resumo e os dados da missão em `ADE_PLUGIN_DATA_DIR`, no seu computador. O briefing é enviado só à Bridge local.

## Solução de problemas

| Sintoma | O que verificar |
| --- | --- |
| Painel mostra **Bridge desconectado** (ADE 0.4.0+) | Reabra o ADE ou reinicie o plugin (Plugins → integração). O ADE entrega a Bridge sozinho; se ela caiu, o plugin volta a conectar assim que o ADE a reiniciar. |
| Painel mostra **Bridge desconectado** (ADE mais antigo) | O ADE foi iniciado com `ADE_BRIDGE=1`? Sem essa variável a Bridge não existe. A `bridgeUrl` bate com a porta real (padrão 4820, ou `ADE_BRIDGE_PORT`)? |
| Integração com erro e log "Missing required setting "bridgeToken"" | Só acontece num ADE que não entrega a Bridge (mais antigo): inicie-o com `ADE_BRIDGE=1`, preencha `bridgeToken` e salve. |
| Login funciona mas a Bridge recusa (nos logs, erros 401) | Só no ADE mais antigo: o `bridgeToken` está errado. Confira o valor de `ADE_BRIDGE_TOKEN` ou a linha `[saas-bridge] token=...` do log do ADE. |
| O ícone **Agendamentos** não aparece | O ADE é anterior à 0.4.0 (sem telas de plugin): atualize, ou abra o painel no navegador. |
| Log "Configuration invalid" com `dashboardToken` | O token, se preenchido, precisa de pelo menos 12 caracteres (ou deixe em branco). |
| O plugin não sobe: porta em uso | Outra aplicação usa a `dashboardPort`. Escolha outra porta e salve. |
| Lista de workspaces ou squads vazia no formulário | A Bridge não respondeu. O formulário continua utilizável; reabra depois que a Bridge voltar. |
| "Executar agora" retorna erro de Bridge indisponível | Mesmo caso: a Bridge está fora do ar. O disparo é registrado como "Falha no disparo". |
| Disparo aparece como **Perdido** | O ADE ou a Bridge estavam fora do ar por mais de 15 minutos após o horário. |
| Nada dispara sozinho | O agendamento está ativo? A chave geral `enabled` está ligada? Os dias e o fuso estão certos? |

O log do plugin aparece no painel de logs da integração no ADE.

## Desenvolvimento

```sh
npm install          # só devDependencies (typescript, vitest, @types/node)
npm run build        # tsc -> dist/  (o dist/ é versionado)
npm run typecheck
npm test             # compila e roda os testes (vitest)
npm run validate     # validador de plugins do jarvis-ade
npm run check-release
npm run fake-bridge -- --port 0 --token segredo --auto-finish-ms 5000   # Bridge falsa
```

Os testes cobrem o cálculo de horários (incluindo horário de verão), o agendador, a validação das configurações, o serviço (disparo, acompanhamento, horários perdidos, tolerância, retenção, arquivos corrompidos, sem disparo duplo após reinício), a API local (autenticação, `Host`, CORS, validação, arquivos estáticos e path traversal) e um teste de ponta a ponta que sobe o `dist/index.js` de verdade contra a Bridge falsa.

`test/fake-bridge.mjs` é uma Bridge falsa reutilizável, fiel ao formato real (envelopes `{ok,data}`, token por cabeçalho ou `?token=`, `POST /api/missions`, `GET /api/missions`, `/api/catalog` e SSE em `/api/events`). Como o `127.0.0.1:4899` costuma estar ocupado, use `--port 0` para uma porta livre.

### Estrutura

```
ade.plugin.json     manifesto do plugin (configurações, tela "Agendamentos" + integração "scheduler" com bridge: true)
dist/               sidecar compilado (node dist/index.js), versionado
src/                fonte em TypeScript
ui/                 painel (HTML/JS/CSS puros, sem build)
test/               testes e Bridge falsa
scripts/            check-release.mjs (portão de publicação)
marketplace/        material da listagem (listing.md, cover.png, screenshots/) e checklist das diretrizes; não vai no pacote npm
```

O estado (agendamentos e histórico) fica em `ADE_PLUGIN_DATA_DIR`: `schedules.json` e `runs/<id>.json`, com escrita atômica (arquivo temporário + `rename`). Arquivos ilegíveis são tratados como ausentes, sem derrubar o plugin.

### API local

Servida em `127.0.0.1:<dashboardPort>`. Todas as rotas `/api/*` exigem `Authorization: Bearer <dashboardToken>` e respondem `{ok:true,data}` ou `{ok:false,code,message}`.

`GET /api/health` (inclui `bridgeConnected` e `bridgeSource`: `host` = Bridge entregue pelo ADE, `settings` = configurada à mão) · `GET /api/workspaces` · `GET /api/catalog` (squads com agentes, maestros e, quando o Bridge tem, `models`) · `GET|POST /api/schedules` · `PUT|DELETE /api/schedules/:id` · `POST /api/schedules/:id/run` · `POST /api/schedules/:id/attachments` (JSON `{name, mime, data}` com `data` em base64) · `DELETE /api/schedules/:id/attachments/:attachmentId` · `GET /api/runs?scheduleId=&limit=` · `GET /api/runs/:id`

**Validação contra o Bridge.** Ao criar ou editar (`POST`/`PUT /api/schedules`), com o Bridge acessível, o plugin confere `workspaceId`, `squadId`, `maestro`, `modelPool` e `agentModels` no `GET /api/catalog` do Bridge. Um valor que o Bridge não conhece resulta em `400 VALIDATION_ERROR` com o campo na mensagem (`workspaceId: unknown workspace "x"…`): o `maestro` precisa estar em `catalog.maestros`, cada id de `modelPool` e cada modelo de `agentModels` em `catalog.models`, e cada agente de `agentModels` precisa existir no squad escolhido (o que exige um `squadId`). O fornecedor do agente **não** é comparado com o do modelo.

Sem Bridge, o agendamento é aceito sem essas conferências e a resposta traz `warnings` (lista de textos; sempre presente em `POST`/`PUT`, vazia quando não há avisos) dizendo o que não foi validado; os ids são conferidos de novo no disparo. `warnings` também avisa quando o maestro existe mas não está disponível agora, e quando o Bridge é antigo (sem `catalog.models`) e a seleção de modelos foi salva mas não será enviada. O painel mostra cada aviso ao salvar.

Corpos JSON acima de 1 MiB recebem `413 PAYLOAD_TOO_LARGE` (o envio de anexo tem um limite maior, veja acima), sempre com a resposta em JSON e nunca com a conexão derrubada.

Códigos de erro: `UNAUTHORIZED` (401), `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `BRIDGE_UNAVAILABLE` (502), além de `FORBIDDEN_HOST` (403), `METHOD_NOT_ALLOWED` (405) e `PAYLOAD_TOO_LARGE` (413).

## English summary

**Jarvis Schedule** is a Jarvis ADE plugin that dispatches recurring, fully autonomous missions. Define a schedule (briefing, workspace, `HH:MM`, days of the week, IANA timezone, optional squad) and the plugin creates a mission through the local ADE SaaS Bridge at that time: your briefing verbatim, followed by a fixed block telling the maestro never to call `ask_user` and to close with a complete `mission_finish` summary. Every dispatch is recorded with its status, the maestro's summary, task results and cost.

- Local dashboard at `http://127.0.0.1:<dashboardPort>` (default 4870), bound to loopback only. Inside ADE 0.4.0+ it opens as a native screen (`contributes.views`, icon **Agendamentos**) with no login: the host proxy injects a per-launch token it hands the sidecar in `hello.host.viewToken`, and the sidecar announces its real port in `ready.http.port`. The manifest declares `"bridge": true` on the integration, so ADE 0.4.0+ starts the Bridge on demand (loopback) and passes `hello.host.bridge = {url, token}`: no manual Bridge setup, and a repeated `hello` with new credentials is adopted live. Older ADE needs `ADE_BRIDGE=1` plus the `bridgeUrl`/`bridgeToken` settings. In a browser it is protected by the optional `dashboardToken` (≥ 12 characters); with neither, a random per-launch token is written to the local integration log (`Painel: <url> — token <t>`).
- Late slots are dispatched up to 15 minutes after the scheduled time; older ones are recorded as `missed`. A write-ahead run ledger in `ADE_PLUGIN_DATA_DIR` guarantees a restart never dispatches the same slot twice.
- On create/update the plugin validates workspace, squad, maestro and models against the Bridge catalog (400 `VALIDATION_ERROR` naming the field). With the Bridge down the schedule is accepted and the response carries a `warnings` array. Models are never checked against the agent's adapter — the model implies the CLI.
- Runtime is dependency-free (Node ≥ 22, built-ins and global `fetch`); `dist/` is committed. See [Desenvolvimento](#desenvolvimento) for build and test commands.

## Licença

[MIT](LICENSE) © 2026 Vidiio
