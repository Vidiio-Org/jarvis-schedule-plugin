# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [1.0.0] — 2026-09-19

Primeira versão pública. Requer Jarvis ADE **0.4.0 ou superior** e Node.js 22+.

### Adicionado

- **Agendamentos recorrentes**: briefing, workspace, horário, dias da semana e fuso horário (com tratamento de horário de verão); na hora combinada o plugin abre uma missão autônoma no workspace escolhido.
- **Missões 100% autônomas**: o briefing recebe um bloco fixo dizendo ao maestro que ninguém responderá (nunca chamar `ask_user`, decidir sozinho e encerrar com `mission_finish` e um resumo completo).
- **Opções completas do briefing**: squad, maestro, modelos permitidos e modelo por agente, anexos, stack (backend, frontend, mobile, infra, outros) e fluxo de teste E2E visível.
- **Histórico de disparos** com origem (agendado ou manual), horário previsto e disparado, status (Em execução, Concluído, Falhou, Perdido), resumo final do maestro, tarefas com resultado e custo.
- **Executar agora** para testar um agendamento sem esperar o horário.
- **Nunca dispara o mesmo horário duas vezes**, mesmo com reinício do ADE ou do plugin; horário perdido (ADE fechado por mais de 15 minutos) é registrado como **Perdido**.
- **Tela nativa "Agendamentos" dentro do ADE** (ícone na barra lateral), sem login e sem token: o ADE autentica o painel (`hello.host.viewToken`).
- **Bridge automática**: com `"bridge": true` no manifesto, o ADE 0.4.0+ inicia a Bridge e entrega o acesso (`hello.host.bridge`); troca de credenciais ao vivo, sem reiniciar. `bridgeUrl` e `bridgeToken` ficam só como alternativa para ADE mais antigo.
- **Painel web local** em `127.0.0.1` (porta configurável) para uso em navegador, protegido por `dashboardToken`, com recusa de `Host` não local e `Content-Security-Policy` com `frame-ancestors 'none'`.
- Configurações: porta do painel, fuso padrão, retenção do histórico (90 dias) e chave geral para ligar/desligar o agendador.

### Corrigido

- Tabela de agendamentos e de histórico com nomes longos: no ADE com a barra lateral de missões aberta, as ações ficavam escondidas atrás de uma barra de rolagem horizontal. As tabelas agora quebram linha nos textos longos, cabem em telas a partir de 900 px e viram cartões empilhados quando a área do painel é estreita (até 1140 px de largura útil).
- Filtro de agendamento do histórico não estoura mais a largura da página quando há nomes muito longos.
