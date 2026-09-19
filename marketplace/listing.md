# Listagem no Marketplace — Jarvis Schedule

Material pronto para o formulário de envio do Marketplace de Plugins do Jarvis ADE. **Nada foi enviado**; quem publica cola estes campos no formulário e anexa as imagens desta pasta.

Os limites abaixo vêm de `backend/src/marketplace/marketplace.constants.ts` (staff-agent) e da página <https://jarvisade.com/docs/plugins/marketplace>.

## Campos

| Campo | Valor | Limite / regra |
| --- | --- | --- |
| **Nome** | Jarvis Schedule | 2 a 60 caracteres (aqui: 15) |
| **Slug (ID)** | `jarvis-schedule` | 3 a 39, minúsculas, números e hífen; igual ao `id` do `ade.plugin.json` |
| **Resumo** | Dispara missões recorrentes 100% autônomas no Jarvis ADE e guarda o histórico de cada uma. | até 120 (aqui: 90) |
| **Categoria** | Produtividade (`productivity`) | uma de: Integrações, Produtividade, Agentes, Ferramentas de desenvolvimento, Dados, Temas, Outros |
| **Tags** | `agendador`, `missoes`, `automacao`, `recorrente`, `historico`, `scheduler`, `autonomo`, `dashboard` | até 8, até 24 caracteres cada, minúsculas com hífen (sem acento) |
| **URL do repositório** | `https://github.com/Vidiio-Org/jarvis-schedule-plugin` | só GitHub, formato exato, sem `/` final nem `.git` |
| **Pacote npm** (opcional) | `jarvis-plugin-schedule` | o campo `repository` do pacote aponta para o mesmo repositório |
| **Site** (opcional) | `https://github.com/Vidiio-Org/jarvis-schedule-plugin#readme` | HTTPS |
| **Licença** | MIT | arquivo `LICENSE` na raiz |
| **Capa** | `marketplace/cover.png` (1200×630, PNG) | recomendado 1200×630; PNG, JPEG ou WebP, até 5 MiB |
| **Capturas de tela** | `marketplace/screenshots/*.png` (4 de até 8, 1280×800, PNG) | até 5 MiB cada, legenda de até 140 caracteres |

### Legendas das capturas de tela

1. `01-agendamentos.png` — Lista de agendamentos com horário, dias, fuso, próxima e última execução.
2. `02-novo-agendamento.png` — Formulário: briefing, workspace, horário, fuso, squad, dias da semana, anexos e maestro.
3. `03-historico.png` — Histórico de disparos com origem, horário e status (Em execução, Concluído, Falhou…).
4. `04-detalhe-do-disparo.png` — Detalhe de um disparo: resumo final do maestro e tarefas com resultado.

As capturas foram tiradas do painel de verdade (`dist/index.js` + `ui/`) rodando contra a Bridge falsa do repositório (`test/fake-bridge.mjs`); os nomes de workspace, briefings e resumos são dados de demonstração.

## Descrição (Markdown, pt-BR)

```markdown
# Jarvis Schedule

Missões recorrentes no Jarvis ADE, sem ninguém precisar apertar o botão. Você cadastra **briefing + workspace + horário + dias da semana + fuso** (e, se quiser, squad, maestro, modelos, anexos, stack e teste E2E) e, na hora combinada, o plugin abre uma missão no workspace escolhido. Cada disparo fica registrado, com o **resumo final do maestro**, as tarefas com resultado e o custo.

## Como funciona

- **100% autônomo.** Ao seu briefing, enviado sem alterações, o plugin acrescenta um bloco fixo dizendo ao maestro que ninguém vai responder: nunca chamar `ask_user`, decidir sozinho, não travar e encerrar a missão com `mission_finish` e um resumo completo.
- **Painel web próprio, só local.** Agendamentos, histórico e detalhe de cada disparo em `http://127.0.0.1:4870`, aberto pelo ícone **Agendamentos** dentro do ADE, sem login (num navegador, protegido por um token que você define, mínimo de 12 caracteres). Nada é carregado de fora.
- **Nunca dispara duas vezes o mesmo horário**, mesmo se o ADE ou o plugin reiniciarem. Horário perdido (ADE fechado por mais de 15 minutos) fica registrado como **Perdido** em vez de disparar atrasado.
- **Executar agora** para testar um agendamento sem esperar.
- Fuso horário por agendamento, com tratamento de horário de verão.

## Instalação

No ADE: **Marketplace de Plugins → Instalados → Importar plugin → URL git**, com `https://github.com/Vidiio-Org/jarvis-schedule-plugin`. Depois preencha `bridgeToken` (token da ADE SaaS Bridge) e salve; o painel abre pelo ícone **Agendamentos** do ADE, sem login. O `dashboardToken` (senha do painel) é opcional e só serve para abrir o painel num navegador.

## Requisitos

Jarvis ADE aberto e Node.js 22 ou superior no `PATH`. O plugin não tem dependências: não roda `npm install`.

## Segurança

Este plugin inicia missões reais, que executam código na máquina onde o ADE roda. O painel escuta apenas em `127.0.0.1`, exige o token em toda chamada, recusa `Host` não local (DNS rebinding) e envia `Content-Security-Policy` com `frame-ancestors 'none'`. Os tokens não vão para o log. Não exponha o painel à rede.

Código aberto, licença MIT. Documentação completa no [README](https://github.com/Vidiio-Org/jarvis-schedule-plugin#readme).
```

## Antes de enviar

1. Publicar o pacote npm `jarvis-plugin-schedule` pelo fluxo de tag `vX.Y.Z` (`.github/workflows/publish.yml`, precisa do segredo `NPM_TOKEN`) e enviar o repositório ao GitHub. Sem o pacote, o cadastro vale só pela origem git.
2. Conferir que `package.json`, `ade.plugin.json` e a tag têm a mesma versão (`npm run check-release`).
3. Enviar o formulário com os campos acima e as imagens; a listagem entra como *Pendente* até a aprovação de um administrador.
