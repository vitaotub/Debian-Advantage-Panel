# Changelog — Debian Advantage Panel (DAP)

Todas as mudanças notáveis deste projeto estão documentadas aqui.
O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

Este arquivo é lido em runtime pelo endpoint `GET /changelog` do `server.js`,
que exibe a seção da versão atual dentro do DAP, na sessão **Sobre o DAP**.

> Use apenas `## vX.Y-DDMMYYYY` para os cabeçalhos de versão. Dentro de uma
> seção, use `###` para subseções — um `##` no meio encerra a captura.
> Versões anteriores ficam nas releases do GitHub.

---

## v0.1-10072026

### 📌 Origem do projeto

- **Debian Advantage Panel (DAP)** é o projeto irmão do **Fedora Advantage Panel (FAP)** para o Debian Linux. Compartilha a filosofia (automação visual, sem terminal, tudo opcional), os padrões visuais (log Matrix verde, três estados de botão, fila de Flatpak) e a arquitetura (container WebKitGTK + servidor Node.js local + frontend com i18n), mas o conteúdo é específico para o Debian.
- **Distribuição alvo:** Debian **Stable**, instalado a partir de **Live ISO** (não netinst, não DVD). Live ISOs trazem pacotes incompletos por padrão — localização, corretor ortográfico, codecs, firmware, Flatpak — e o DAP existe para resolver isso.
- **Filosofia:** tudo opcional. Nada é habilitado por padrão sem clique explícito do usuário. Repositórios como `backports` e `non-free` são botões, não pré-requisitos do instalador.

### ✨ Fase 1 — Esqueleto funcional

Esta é a primeira versão do DAP. Ela entrega **a base técnica completa**, sem nenhuma sessão de automação ainda. As sessões entram na Fase 2.

#### Arquitetura

- **Container WebKitGTK** (`src/dap-container.c`): janela GTK3 com `WebKitWebView` embutido. Compila contra `libwebkit2gtk-4.1-dev` + `libgtk-3-dev` (Debian 12+). Intercepta navegação via `decide-policy` para abrir links externos no navegador padrão via `xdg-open`. `g_set_prgname("dap-container")` e `gtk_window_set_wmclass("dap-container", "dap-container")` para que o KDE Plasma em Wayland associe o ícone correto.
- **Servidor Node.js local** (`server.js`): roda em `127.0.0.1:3000`, sem acesso externo. Serve arquivos estáticos, locales, SSE para logs em tempo real e endpoints de execução.
- **Frontend** (`index.html`, `guiado.html`, `script.js`, `i18n.js`, `style.css`): UI carregada dentro do container, com i18n (PT-BR/EN/ES), tema claro/escuro, fila de Flatpak, bloqueio de sessão durante execução e sistema de estado por comando.

#### Autenticação e segurança

- **Whitelist de comandos sem autenticação**: `dpkg-query`, `dpkg -l`, `uname -r`, `cat /etc/debian_version`, `cat /etc/os-release`, `flatpak install`, `flatpak uninstall`, `gtk-launch`, `systemctl --user` e os comandos de abrir apps GUI via `setsid -f`. Comandos que exigem privilégio (`apt`, `dpkg`, `dpkg-reconfigure`, `update-grub`, `update-initramfs`, `locale-gen`, `usermod`, etc.) passam pela cadeia de autenticação.
- **Rejeição de comandos com encadeamento shell** (`;`, `&&`, `|`, `$(...)`, backticks) quando vêm da whitelist — evita burlar a validação com `dpkg-query -W foo; rm -rf ~`.
- **Cadeia de autenticação gráfica** em ordem de preferência: `kdesu` (KDE, via `kde-cli-tools`) → `pkexec` (PolicyKit) → `sudo -A` com `SUDO_ASKPASS` (`lxqt-sudo`, `ssh-askpass`, `ssh-askpass-gnome`, `beesu`, `ksshaskpass`) → fallback `zenity`/`kdialog` + `sudo -S` via stdin. O `install.sh` detecta o DE e instala o diálogo apropriado.
- **Rate limiting** de 1 execução por `idComando` a cada 1,5s.
- **Rastreamento de processos filhos** em um `Set`, com kill em árvore (grupo de processos) no `SIGINT`.

#### Detecção de hardware

- **`hardware-service.js`** e **`hardware_map.json`**: estrutura pronta, mas o mapeamento ainda é o do FAP (baseado em `rpm`). O endpoint `/hardware-scan` existe e responde, mas retorna lista vazia no Debian até a Fase 5, quando o mapeamento vendor→pacote será reescrito para `dpkg-query` e pacotes Debian.

#### Internacionalização

- **`i18n.js`**: sistema completo, reaproveitado do FAP. PT-BR é o HTML nativo, EN/ES vêm de `locales/<lang>.json`. Cache em `localStorage` por versão, invalidação automática quando o DAP é atualizado.
- **`locales/en.json`** e **`locales/es.json`**: contêm apenas as chaves de `comum`, `index`, `guiado` e `seletor`. A chave `sessoes` está **vazia** — será preenchida conforme cada sessão for adicionada na Fase 2.

#### Tema visual

- **Tema claro como padrão**, com acento vermelho Debian (`#a80030`, cor do site oficial). Tema escuro como alternativa.
- **Log Matrix verde** mantido (assinatura visual do projeto).
- **Botões com as cores do FAP**: azul `#3c67e3` para ação principal, verde `#10b981` para "Abrir", vermelho `#ef4444` para remover/reverter, vermelho destrutivo com contorno tracejado para ações irreversíveis.

#### Instalação e inicialização

- **`install.sh`**: detecta Debian via `/etc/os-release` (`ID=debian`), avisa (mas não bloqueia) derivados (`ID_LIKE` contendo `debian`) e Testing/Sid. Instala dependências do container via `apt`, detecta o DE e instala a dependência de autenticação apropriada, clona o repositório, compila o container, cria symlinks (`dap`, `dap-compat`, `dap-container`) e atalhos `.desktop` + ícone em `hicolor`.
- **`iniciar_dap.sh`**: detecta o DE, abre o terminal nativo do desktop, inicia o servidor Node.js, abre o container WebKitGTK (ou cai no Firefox/Chromium como fallback).
- **`iniciar_dap_compat.sh`**: força renderização por software (`LIBGL_ALWAYS_SOFTWARE=1`, `GALLIUM_DRIVER=llvmpipe`, `GDK_BACKEND=x11`) para GPUs sem aceleração 3D.

#### Comandos disponíveis

```bash
dap                       # Iniciar (modo normal)
dap-compat                # Iniciar (modo compatibilidade — GPUs antigas)
./install.sh --update     # Atualizar
./install.sh --uninstall  # Desinstalar
