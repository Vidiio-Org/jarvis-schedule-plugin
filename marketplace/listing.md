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
| **Capturas de tela** | `marketplace/screenshots/*.png` (4 de até 8, PNG, 1280×800, dentro do ADE) | até 5 MiB cada, legenda de até 140 caracteres |

### Legendas das capturas de tela

1. `01-agendamentos.png` — Tela **Agendamentos** dentro do ADE: horário, dias, fuso, próxima e última execução, com Executar agora, Editar e Excluir.
2. `02-formulario-squad-modelos.png` — Formulário de novo agendamento: modelos permitidos, modelo por agente, stack e fluxo de teste E2E.
3. `03-historico.png` — Histórico de disparos com origem, horário e status Concluído.
4. `04-plugins-instalados.png` — Marketplace de Plugins → Instalados, com o Jarvis Schedule em execução e o botão Open Agendamentos.

As quatro capturas foram tiradas **dentro do Jarvis ADE** (ADE 0.4.0, plugin instalado pela pasta, Bridge automática), com dados de demonstração: o workspace, o briefing e os resultados são fictícios.

## Descrição (Markdown, pt-BR)

```markdown
# Jarvis Schedule

Missões recorrentes no Jarvis ADE, sem ninguém precisar apertar o botão. Você cadastra **briefing + workspace + horário + dias da semana + fuso** (e, se quiser, squad, maestro, modelos, anexos, stack e teste E2E) e, na hora combinada, o plugin abre uma missão no workspace escolhido. Cada disparo fica registrado, com o **resumo final do maestro**, as tarefas com resultado e o custo.

## Como funciona

- **100% autônomo.** Ao seu briefing, enviado sem alterações, o plugin acrescenta um bloco fixo dizendo ao maestro que ninguém vai responder: nunca chamar `ask_user`, decidir sozinho, não travar e encerrar a missão com `mission_finish` e um resumo completo.
- **Painel web próprio, só local.** Agendamentos, histórico e detalhe de cada disparo, abertos pelo ícone **Agendamentos** na barra lateral do ADE, **dentro do app**, sem login e sem token. O painel escuta só em `127.0.0.1` e nada é carregado de fora.
- **Nunca dispara duas vezes o mesmo horário**, mesmo se o ADE ou o plugin reiniciarem. Horário perdido (ADE fechado por mais de 15 minutos) fica registrado como **Perdido** em vez de disparar atrasado.
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

Este plugin inicia missões reais, que executam código na máquina onde o ADE roda. O painel escuta apenas em `127.0.0.1`, exige autenticação em toda chamada (dentro do ADE, feita pelo próprio ADE), recusa `Host` não local (DNS rebinding) e envia `Content-Security-Policy` com `frame-ancestors 'none'`. Os tokens não vão para o log. Não exponha o painel à rede.

Código aberto, licença MIT. Documentação completa no [README](https://github.com/Vidiio-Org/jarvis-schedule-plugin#readme).
```

## Antes de enviar

1. Publicar o pacote npm `jarvis-plugin-schedule` pelo fluxo de tag `vX.Y.Z` (`.github/workflows/publish.yml`, precisa do segredo `NPM_TOKEN`) e enviar o repositório ao GitHub. Sem o pacote, o cadastro vale só pela origem git.
2. Conferir que `package.json`, `ade.plugin.json` e a tag têm a mesma versão (`npm run check-release`).
3. Enviar o formulário com os campos acima e as imagens; a listagem entra como *Pendente* até a aprovação de um administrador.
