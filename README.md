# Jarvis Schedule

Plugin do [Jarvis ADE](https://jarvisade.com) que **dispara missões recorrentes**. Você cadastra um agendamento (briefing + workspace + horário + dias da semana + fuso + squad opcional) e, no horário combinado, o plugin abre uma missão no workspace escolhido, com o briefing e um reforço fixo para o maestro trabalhar **100% sem supervisão**. Cada disparo fica registrado em um histórico, junto com o resumo e os dados que o maestro devolveu.

O plugin traz o seu próprio **painel web local** (agendamentos, histórico e detalhe de cada disparo), servido só em `127.0.0.1`.

## O que ele faz

- Dispara uma missão por agendamento, todos os dias ou nos dias que você escolher, no fuso horário do agendamento (com tratamento de horário de verão).
- Envia o seu briefing **sem alterações**, seguido do texto de autonomia descrito [abaixo](#reforço-de-autonomia).
- Acompanha a missão até o fim e guarda status, resumo final do maestro, tarefas com resultado, custo (quando o ADE informa) e os dados brutos da missão.
- Nunca dispara o mesmo horário duas vezes, mesmo se o ADE ou o plugin reiniciarem.
- Botão **Executar agora** para testar um agendamento sem esperar o horário.

## Requisitos

- Jarvis ADE aberto (o plugin fala com a **ADE SaaS Bridge**, o servidor local do ADE, por padrão em `http://127.0.0.1:4820`).
- Node.js 22 ou superior disponível no `PATH` (o ADE inicia o plugin com `node`).
- Nada de `npm install`: o plugin não tem dependências em tempo de execução e o `dist/` já vem compilado.

## Instalação

No ADE, abra **Marketplace → Importar plugin** e use a origem **git** com a URL:

```
https://github.com/Vidiio-Org/jarvis-schedule-plugin
```

Depois de importar, abra as configurações do plugin, preencha as duas configurações obrigatórias (`bridgeToken` e `dashboardToken`) e salve. Ao salvar, o ADE reinicia o plugin. Se alguma configuração obrigatória estiver vazia, a integração fica em `missing_settings` e não inicia.

## Configurações

| Chave | Tipo | Obrigatória | Padrão | O que faz |
| --- | --- | --- | --- | --- |
| `bridgeUrl` | texto | não | `http://127.0.0.1:4820` | Endereço da ADE SaaS Bridge. Só mude se você iniciou o ADE com outra porta (`ADE_BRIDGE_PORT`). |
| `bridgeToken` | segredo | **sim** | — | Token da Bridge. Veja [Onde achar o token da Bridge](#onde-achar-o-token-da-bridge). |
| `dashboardPort` | número | não | `4870` | Porta do painel (sempre em `127.0.0.1`). |
| `dashboardToken` | segredo | **sim** | — | Senha do painel, com **pelo menos 12 caracteres**. Com menos que isso o plugin se recusa a iniciar. |
| `defaultTimezone` | texto | não | `America/Sao_Paulo` | Fuso IANA sugerido para novos agendamentos. Se for inválido, o plugin usa `America/Sao_Paulo` e avisa no log. |
| `historyRetentionDays` | número | não | `90` | Quantos dias de histórico manter (mínimo 1, máximo 3650). Registros mais antigos são apagados. |
| `enabled` | booleano | não | `true` | Chave geral. Desligada, **nenhum agendamento dispara sozinho** (o painel continua no ar e "Executar agora" continua funcionando). |

### Onde achar o token da Bridge

O ADE define o token da Bridge de duas formas:

- se você iniciou o ADE com a variável `ADE_BRIDGE_TOKEN`, é esse valor;
- caso contrário o ADE gera um token aleatório e o imprime **uma vez** no log do aplicativo, na linha `[saas-bridge] token=... port=...`.

Trate o token como uma credencial de acesso à máquina que roda o ADE.

## Abrindo o painel

Com o plugin em execução, acesse:

```
http://127.0.0.1:<dashboardPort>
```

Com a porta padrão, `http://127.0.0.1:4870`. Na tela de login, digite o valor de `dashboardToken`. O token fica só no `sessionStorage` do navegador (some ao fechar a aba) e é enviado como `Authorization: Bearer` em cada chamada. Se ele for recusado, o painel volta para o login com a mensagem "Token inválido ou expirado. Entre novamente."

O painel se chama "Jarvis Agendador" na tela. No topo aparece se a Bridge está **conectada** ou **desconectada**.

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
| **Agendamento ativo** | Desativado, o agendamento fica "Pausado" e não dispara sozinho. |

Erros de validação da API (por exemplo, fuso inexistente) aparecem no formulário. Na lista de agendamentos você também vê a próxima e a última execução de cada um, e pode **editar**, **excluir** (com confirmação; o histórico já gravado é mantido) ou **executar agora**.

Criar ou alterar horário, dias, fuso ou o estado ativo de um agendamento nunca dispara horários que já passaram: só valem os horários a partir da alteração.

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

- **Este plugin inicia missões reais, que executam código na máquina onde o ADE roda.** Quem acessa o painel consegue disparar missões. Por isso o `dashboardToken` é obrigatório, com no mínimo 12 caracteres: use um valor longo e único.
- O painel só escuta em `127.0.0.1`. Não o exponha a outras máquinas nem à internet (túnel, proxy reverso).
- Toda rota `/api/*` exige o token do painel (comparação em tempo constante). Requisições com cabeçalho `Host` que não seja local (`127.0.0.1`, `localhost`, `[::1]`) são recusadas com `403 FORBIDDEN_HOST`, o que barra ataques de DNS rebinding. Não há CORS.
- O painel envia `Content-Security-Policy` (incluindo `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff` e `Cache-Control: no-store`. Não carrega nada de fora: sem CDN, sem fontes externas, sem frameworks.
- Textos vindos da API e das missões são sempre exibidos como texto, nunca como HTML.
- Os tokens (`bridgeToken`, `dashboardToken`) não são gravados em log.
- O histórico guarda o resumo e os dados da missão em `ADE_PLUGIN_DATA_DIR`, no seu computador. O briefing é enviado só à Bridge local.

## Solução de problemas

| Sintoma | O que verificar |
| --- | --- |
| Integração em `missing_settings` | Preencha `bridgeToken` e `dashboardToken` e salve. |
| Log "Configuration invalid" com `dashboardToken` | O token precisa de pelo menos 12 caracteres. |
| Painel mostra **Bridge desconectado** | O ADE está aberto? A `bridgeUrl` bate com a porta real da Bridge (padrão 4820, ou `ADE_BRIDGE_PORT`)? |
| Login funciona mas a Bridge recusa (nos logs, erros 401) | O `bridgeToken` está errado. Confira o valor de `ADE_BRIDGE_TOKEN` ou a linha `[saas-bridge] token=...` do log do ADE. |
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
npm run dev:mock     # painel contra uma API simulada, sem sidecar nem Bridge (dev/mock-server.mjs)
npm run fake-bridge -- --port 0 --token segredo --auto-finish-ms 5000   # Bridge falsa
```

Os testes cobrem o cálculo de horários (incluindo horário de verão), o agendador, a validação das configurações, o serviço (disparo, acompanhamento, horários perdidos, tolerância, retenção, arquivos corrompidos, sem disparo duplo após reinício), a API local (autenticação, `Host`, CORS, validação, arquivos estáticos e path traversal) e um teste de ponta a ponta que sobe o `dist/index.js` de verdade contra a Bridge falsa.

`test/fake-bridge.mjs` é uma Bridge falsa reutilizável, fiel ao formato real (envelopes `{ok,data}`, token por cabeçalho ou `?token=`, `POST /api/missions`, `GET /api/missions`, `/api/catalog` e SSE em `/api/events`). Como o `127.0.0.1:4899` costuma estar ocupado, use `--port 0` para uma porta livre.

### Estrutura

```
ade.plugin.json     manifesto do plugin (configurações + integração "scheduler")
dist/               sidecar compilado (node dist/index.js), versionado
src/                fonte em TypeScript
ui/                 painel (HTML/JS/CSS puros, sem build)
dev/                ferramentas só de desenvolvimento (não vão no pacote npm)
test/               testes e Bridge falsa
scripts/            check-release.mjs (portão de publicação)
marketplace/        material para a listagem no Marketplace
```

O estado (agendamentos e histórico) fica em `ADE_PLUGIN_DATA_DIR`: `schedules.json` e `runs/<id>.json`, com escrita atômica (arquivo temporário + `rename`). Arquivos ilegíveis são tratados como ausentes, sem derrubar o plugin.

### API local

Servida em `127.0.0.1:<dashboardPort>`. Todas as rotas `/api/*` exigem `Authorization: Bearer <dashboardToken>` e respondem `{ok:true,data}` ou `{ok:false,code,message}`.

`GET /api/health` · `GET /api/workspaces` · `GET /api/catalog` · `GET|POST /api/schedules` · `PUT|DELETE /api/schedules/:id` · `POST /api/schedules/:id/run` · `GET /api/runs?scheduleId=&limit=` · `GET /api/runs/:id`

Códigos de erro: `UNAUTHORIZED` (401), `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `BRIDGE_UNAVAILABLE` (502), além de `FORBIDDEN_HOST` (403), `METHOD_NOT_ALLOWED` (405) e `PAYLOAD_TOO_LARGE` (413).

## English summary

**Jarvis Schedule** is a Jarvis ADE plugin that dispatches recurring, fully autonomous missions. Define a schedule (briefing, workspace, `HH:MM`, days of the week, IANA timezone, optional squad) and the plugin creates a mission through the local ADE SaaS Bridge at that time: your briefing verbatim, followed by a fixed block telling the maestro never to call `ask_user` and to close with a complete `mission_finish` summary. Every dispatch is recorded with its status, the maestro's summary, task results and cost.

- Local dashboard at `http://127.0.0.1:<dashboardPort>` (default 4870), protected by `dashboardToken` (≥ 12 characters), bound to loopback only.
- Late slots are dispatched up to 15 minutes after the scheduled time; older ones are recorded as `missed`. A write-ahead run ledger in `ADE_PLUGIN_DATA_DIR` guarantees a restart never dispatches the same slot twice.
- Runtime is dependency-free (Node ≥ 22, built-ins and global `fetch`); `dist/` is committed. See [Desenvolvimento](#desenvolvimento) for build and test commands.

## Licença

[MIT](LICENSE) © 2026 Vidiio
