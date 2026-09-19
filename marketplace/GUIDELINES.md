# Checklist das diretrizes de plugins do Jarvis ADE

Fontes: páginas <https://jarvisade.com/docs/plugins/> (`manifesto`, `protocolo`, `configuracoes`, `boas-praticas`, `publicar`, `marketplace`, `cli`; **não existe** uma página `/docs/plugins/marketplace/guidelines`, essa rota dá 404), `backend/docs/marketplace/DESIGN.md`, `plugin-manifest.schema.ts` e as verificações automáticas de `backend/src/marketplace/checks/plugin-checks.service.ts` (staff-agent). Estado em 2026-09-19, versão 1.0.0.

Legenda: ✅ atendido · ⏳ depende de uma ação de quem publica (nada foi enviado nem publicado).

## Verificações automáticas do envio (`plugin-checks.service.ts`)

| Verificação | Regra | Estado |
| --- | --- | --- |
| `repo-reachable` | repositório GitHub público, URL exata `https://github.com/<dono>/<repo>` | ⏳ o repo `Vidiio-Org/jarvis-schedule-plugin` precisa ser enviado (push) e estar público; a URL já está em `package.json`, no manifesto e na listagem |
| `manifest-valid` | `ade.plugin.json` na raiz do repo, válido pelo schema | ✅ `jarvis-ade plugins validate .` (CLI do worktree `feature-plugin-host-views`, que conhece `views` e `bridge`) → válido, 0 avisos. O `jarvis-ade` publicado no npm ainda pode avisar `unknown key` em `contributes.views`: é só aviso |
| `npm-package` / `npm-manifest` | (só se informar pacote npm) o pacote existe, tem `latest` e traz `ade.plugin.json` na raiz | ⏳ publicar `jarvis-plugin-schedule`; `npm pack --dry-run` confirma que o tarball leva `ade.plugin.json` na raiz (`files`) |
| `npm-repository` | `repository` do pacote aponta para o mesmo repo da listagem | ✅ `git+https://github.com/Vidiio-Org/jarvis-schedule-plugin.git` |
| `plugin-id-match` | mesmo `id` no manifesto do GitHub e do npm | ✅ um único arquivo, `jarvis-schedule` |
| `version-consistency` | versão do manifesto = `package.json` = tag | ✅ 1.0.0 nos dois; `scripts/check-release.mjs` confere também a tag `v1.0.0` |
| `runtime-dependencies` | sem `dependencies` (o instalador só copia arquivos) | ✅ só `devDependencies` |
| `install-scripts` | sem `preinstall`/`install`/`postinstall` | ✅ nenhum |
| `npm-keyword` | palavra-chave `jarvis-ade-plugin` | ✅ |
| `plugin-id-unique` | nenhuma outra listagem ativa (não rejeitada) usa o mesmo `id`; a verificação usa o banco do marketplace e é anexada pelo serviço de listagens, por isso só roda no envio (o desktop instala por `id`) | ⏳ `jarvis-schedule` é um `id` genérico: **antes de enviar**, procure no Marketplace se já existe outro plugin com esse `id`; se existir, o `id` (no manifesto **e** no `package.json`/tag) precisa mudar |

## Manifesto (`manifesto`, `plugin-manifest.schema.ts`)

| Regra | Estado |
| --- | --- |
| `id` kebab-case `/^[a-z0-9]+(-[a-z0-9]+)*$/` | ✅ `jarvis-schedule` |
| `name` (≥ 1), `version` semver | ✅ "Jarvis Schedule", `1.0.0` |
| `description`, `author`, `homepage`, `license` (opcionais, mas exigidos pela nossa tarefa) | ✅ descrição, `Vidiio`, `https://github.com/Vidiio-Org/jarvis-schedule-plugin`, `MIT` |
| `contributes.settings[].key` `/^[a-zA-Z][a-zA-Z0-9_]*$/`, `type` ∈ string/secret/boolean/number | ✅ 7 configurações, todas camelCase; nenhuma `select` |
| `default` sempre string, inclusive em número/booleano | ✅ `"4870"`, `"90"`, `"true"` |
| `contributes.integrations[]` com `id` kebab-case, `name`, `command` | ✅ `scheduler`, `node dist/index.js` |
| `events`: `[]` ou sem filtro entrega **tudo** (não "nada") | ✅ o plugin não usa eventos de `board.*`/`mission.*` (acompanha as missões pela Bridge); o filtro foi reduzido a `["mission.finished"]` para não receber o `board.snapshot` de todas as missões à toa |
| Campos obrigatórios (`required: true`) travam o início até serem preenchidos | ✅ nenhuma configuração é obrigatória: `bridgeToken` e `bridgeUrl` são só o fallback de um ADE mais antigo (ADE 0.4.0+ entrega a Bridge em `hello.host.bridge`), `dashboardToken` só serve para abrir o painel num navegador. Sem Bridge do host e sem `bridgeToken`, o plugin emite `error` e o motivo (`ADE_BRIDGE=1` + token) fica no log |
| Integração com `"bridge": true` | ✅ declarada em `contributes.integrations[scheduler]`; o plugin usa `hello.host.bridge` para toda chamada (REST e SSE), troca as credenciais ao vivo num `hello` repetido e nunca as registra |
| `contributes.views` (tela nativa "Agendamentos") | ✅ `dashboard`, `icon: calendar-clock`, `integration: scheduler`; o CLI que conhece `views` valida sem avisos (versões mais antigas do CLI avisam `unknown key`, aviso e não erro) |
| Segredos: tipo `secret`, nunca em log | ✅ `bridgeToken`, `dashboardToken` são `secret` e não são registrados |

## Pacote e repositório (`publicar`)

| Regra | Estado |
| --- | --- |
| Um plugin por repositório, `ade.plugin.json` na raiz | ✅ |
| `package.json` e manifesto com a mesma versão | ✅ |
| `keywords` inclui `jarvis-ade-plugin` | ✅ |
| `repository` → GitHub público | ✅ |
| `files` inclui `ade.plugin.json`, `dist`, `ui`, README, LICENSE | ✅ (`npm pack --dry-run`: só LICENSE, README, manifesto, `dist/`, `ui/`, `package.json`; nada de `test/`, `scripts/`, `marketplace/`, mock) |
| `"type": "module"`, `engines.node` declarado | ✅ `>=22` (a página cita `>=18` como exemplo; o mínimo é declarado e documentado no README) |
| Sem dependências de runtime, sem scripts de instalação | ✅ |
| `private: true` proibido | ✅ removido |
| Licença | ✅ `LICENSE` MIT na raiz + `license: MIT` no manifesto e no `package.json` |
| Publicação por tag `vX.Y.Z` com `NPM_TOKEN` | ✅ `.github/workflows/publish.yml` (release gate, validação e `npm publish --provenance`); ⏳ o segredo `NPM_TOKEN` e a tag ficam com quem publica |
| Instalação por pasta/zip/git copia **o diretório inteiro** (`PluginInstaller.installFromDir`: `cp -r`); só o npm respeita `files` | ✅ o repo não tem mais mock de desenvolvimento (removido em `8e02920`); `dist/` é versionado porque o instalador nunca compila; `test/`, `scripts/` e `marketplace/` vão junto numa instalação git, sem segredos e sem código executado |

## Protocolo e boas práticas (`protocolo`, `boas-praticas`)

| Regra | Estado |
| --- | --- |
| Funcionar só com os arquivos publicados, em Node "puro" | ✅ TypeScript já compilado em `dist/`; só módulos nativos do Node e `fetch` global |
| Estado só em `ADE_PLUGIN_DATA_DIR`, com escrita atômica; a pasta do plugin é descartável | ✅ `schedules.json`, `runs/<id>.json`, `attachments/` via arquivo temporário + `rename`; arquivo ilegível = ausente |
| `hello` reenviado a cada reinício: reconciliar, não repetir | ✅ registro do disparo gravado antes de chamar a Bridge (trava); teste de ponta a ponta "reinício não redispara o horário" |
| Logs `{type:'log'}`, ≤ 500 caracteres, sem segredos | ✅ `Emitter.log` corta em 500 caracteres (teste `protocol.test.ts`); tokens da Bridge são redigidos em `Bridge.redact` e o `dashboardToken` e o `viewToken` do ADE nunca são registrados (única exceção documentada: o token aleatório por execução do fallback "Painel: …", sem `dashboardToken` e sem ADE com telas, só no log local) |
| Sair em até 5 s no `shutdown` (e com stdin fechado) | ✅ `shutdown` e fechamento do stdin encerram o servidor e saem com código 0 (teste e2e) |
| `ready` cedo; sem `process.exit(1)` em erro recuperável | ✅ `ready` logo após subir; exceções não tratadas só vão para o log |
| Timeouts em toda E/S de rede | ✅ chamadas à Bridge com timeout |
| Não usar `type: "select"`; não escrever na pasta do plugin | ✅ |
| Não agir a cada `hello` | ✅ ver a linha do `hello` acima |

## Listagem (`marketplace`, `marketplace.constants.ts`)

| Regra | Estado |
| --- | --- |
| Nome 2–60, slug 3–39, resumo ≤ 120, categoria válida, ≤ 8 tags (≤ 24 caracteres, `[a-z0-9-]`), descrição ≤ 20.000 | ✅ `marketplace/listing.md` (com as contagens) |
| Repositório GitHub no formato exato | ✅ |
| Capa recomendada 1200×630, capturas até 8, PNG/JPEG/WebP até 5 MiB | ✅ `marketplace/cover.png` (1200×630) e 4 capturas 1280×800 tiradas dentro do ADE, cada uma com menos de 200 KB |
| Instalação `npx -y jarvis-ade plugins add <handle>/<slug>` / importação pela UI (npm ou URL git) | ✅ README e listagem descrevem a instalação pelo Marketplace (ícone **Agendamentos**, sem configurar) e a importação por URL git enquanto a listagem não é aprovada; o comando `npx` passa a valer depois da aprovação |
| Fluxo Pendente → verificações automáticas → aprovação de um admin | ⏳ com quem envia |

## Idioma e conteúdo

| Regra | Estado |
| --- | --- |
| README para o usuário em pt-BR, derivado do comportamento real | ✅ `README.md` (com resumo em inglês); o texto de autonomia é citado de `src/autonomy.ts` |
| Segurança e privacidade explicadas | ✅ seção "Segurança" do README |
