# <img src="icone_app.png" width="55" align="center"> Debian Advantage Panel (DAP)

**🌐 Idioma:** Português (BR) | [English](README.en.md) | [Español](README.es.md)

![Versão](https://img.shields.io/badge/Vers%C3%A3o-v0.1--10072026-orange?style=flat-square)
![Debian](https://img.shields.io/badge/Debian-12%2B-A81D33?style=flat-square&logo=debian)
![Licença](https://img.shields.io/badge/Licen%C3%A7a-GPL--3.0-green?style=flat-square)
![Idiomas](https://img.shields.io/badge/Idiomas-PT--BR%20%7C%20EN%20%7C%20ES-3c67e3?style=flat-square)

> Deixando o seu Debian pronto para o uso diário — visual, rápido e sem terminal.

## 🚀 Instalação

```bash
bash <(curl -s https://raw.githubusercontent.com/vitaotub/Debian-Advantage-Panel/main/install.sh)
```

**Comandos disponíveis após instalar:**

```bash
dap                       # Iniciar (modo normal)
dap-compat                # Iniciar (modo compatibilidade — GPUs antigas)
./install.sh --update     # Atualizar
./install.sh --uninstall  # Desinstalar
```

## 📖 O que é

Painel de automação visual para **Debian Stable**. Transforma uma instalação feita a partir de **Live ISO** em um sistema completo — codecs, drivers, repositórios, localização, corretor ortográfico, ferramentas — através de cliques, sem abrir o terminal.

**Por que Live ISO?** As Live ISOs do Debian trazem pacotes incompletos por padrão: localização não gerada, corretor ortográfico ausente, codecs básicos faltando, firmware incompleto, Flatpak não instalado. O DAP existe para fechar essa lacuna com um clique.

**Um único ponto de entrada**: o botão **"Iniciar"** leva você pelas sessões passo a passo. Cada botão lembra seu próprio estado. Fechar e reabrir o DAP mostra exatamente onde você parou.

**Projeto irmão do [Fedora Advantage Panel](https://github.com/vitaotub/Fedora-Advantage-Panel)** — compartilha filosofia, padrões visuais e arquitetura, mas o conteúdo é específico para o Debian.

## ⚠️ Status atual — v0.1 (Fase 1)

**Esta é uma versão inicial de desenvolvimento.** Ela entrega **a base técnica completa**, mas **nenhuma sessão de automação está implementada ainda**.

### O que já funciona

- ✅ Landing page com relógio, botão "Iniciar" e rodapé
- ✅ Container WebKitGTK nativo (janela própria, sem navegador externo)
- ✅ Servidor Node.js local (127.0.0.1:3000)
- ✅ Internacionalização PT-BR / EN / ES com troca em tempo real
- ✅ Tema claro/escuro com persistência em `localStorage`
- ✅ Sistema de progresso (`.progresso.json`)
- ✅ Autenticação gráfica (kdesu / pkexec / sudo -A)
- ✅ Log Matrix verde em tempo real (SSE)
- ✅ Sistema de fila de Flatpak
- ✅ Bloqueio de sessão durante execução
- ✅ Instalação, atualização e desinstalação via `install.sh`

### O que ainda **não** está presente

- 🚧 Nenhuma das 8 sessões de automação
- 🚧 Detecção de hardware (`hardware-service.js` ainda é o do FAP — retorna lista vazia no Debian)
- 🚧 Parser de progresso real para o `apt` (usa fallback do timer)

**O `guiado.html` mostra um placeholder explícito dizendo "Fase 1 do desenvolvimento concluída. As sessões serão adicionadas na próxima fase."** Isso não é bug — é a expectativa correta para a v0.1.

## ✨ Sessões planejadas para a v1

| # | Sessão | O que faz |
|---|---|---|
| 1 | 🚀 Primeiros Passos | `apt update`/`upgrade`, ativar non-free/contrib/non-free-firmware, Flatpak/Flathub, backports, locale PT-BR, hunspell, i386 (para Steam) |
| 2 | 🔤 Codecs e Compatibilidade | `ttf-mscorefonts-installer`, `libdvdcss2`, firmwares adicionais |
| 3 | 🖥️ Hardware | Drivers AMD, Intel e NVIDIA (via non-free) |
| 4 | 📦 Aplicativos | ~45 Flatpaks + Suíte ArtCraft + Ferramentas de Acesso Remoto |
| 5 | 🏠 Casa e Escritório | CUPS, Samba, LocalSend, KeePassXC, Okular+Tesseract |
| 6 | 🎮 Gaming | Steam (`steam-installer` + i386), Heroic, Lutris, GameMode, MangoHud, emuladores |
| 7 | 📊 Diagnóstico | Painel do sistema, GSmartControl, CoolerControl, journal |
| 8 | 📖 Sobre o DAP | Atualizar, desinstalar, changelog dinâmico |

## 🎨 Destaques

- **Interface clara** com acento vermelho Debian (`#a80030`), alternável para tema escuro
- **Multilíngue** (PT-BR, EN, ES) com troca em tempo real
- **Logs em tempo real** via SSE, com buffer de replay
- **Lixeira unificada** para Flatpaks e apps não-Flatpak
- **Botão "Abrir"** em todos os apps GUI — abre em sessão própria (sobrevive ao fechar o DAP)
- **Fila de instalação** de Flatpaks — clique em vários em sequência
- **Bloqueio inteligente** — evita conflitos de lock no `dpkg` e bloqueia navegação entre sessões durante execução
- **Autenticação gráfica robusta** — cadeia `kdesu → pkexec → sudo -A` cobre todos os DEs do Debian
- **Container WebKitGTK nativo** (sem navegador externo)

## 🖥️ Desktops suportados

GNOME, KDE Plasma, XFCE, Cinnamon, MATE, LXQt, LXDE, Budgie, Sway, Hyprland, i3 e outros tiling WMs.

## 📋 Requisitos

- **Debian 12 (Bookworm) ou mais novo** — Stable
- **Não** roda em derivados (MX, LMDE, Kali, Raspberry Pi OS) — pode funcionar, mas não há suporte
- **Não** roda em Testing/Sid — pode funcionar, mas não há suporte
- Instalação feita a partir de **Live ISO** (não netinst, não DVD) — para aproveitar ao máximo as sessões de "Primeiros Passos"

## 📄 Licença

**GPL-3.0** — veja [LICENSE](LICENSE).

## 👤 Autor

**VitãoTub** — [vitaotub.com](https://www.vitaotub.com) · [github.com/vitaotub](https://github.com/vitaotub)

## 🙏 Agradecimentos

[![Debian Project](https://img.shields.io/badge/Debian-Project-A81D33?style=flat-square&logo=debian&logoColor=white)](https://www.debian.org/)
[![DeepSeek](https://img.shields.io/badge/DeepSeek-AI-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://www.deepseek.com/)

**Feito com ❤️ para a comunidade Debian**
