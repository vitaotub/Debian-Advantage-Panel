# Changelog — Debian Advantage Panel (DAP)

Todas as mudanças notáveis deste projeto estão documentadas aqui.
O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

Este arquivo é lido em runtime pelo endpoint `GET /changelog` do `server.js`,
que exibe a seção da versão atual dentro do DAP, na sessão **Sobre o DAP**.

> Use apenas `## vX.Y-DDMMYYYY` para os cabeçalhos de versão. Dentro de uma
> seção, use `###` para subseções — um `##` no meio encerra a captura.
> Versões anteriores ficam nas releases do GitHub.

---

## v0.1-10082026

### 📌 Origem do projeto

- **Debian Advantage Panel (DAP)** é o projeto irmão do **Fedora Advantage Panel (FAP)** para o Debian Linux. Compartilha a filosofia (automação visual, sem terminal, tudo opcional), os padrões visuais (log Matrix verde, três estados de botão, fila de Flatpak) e a arquitetura (container WebKitGTK + servidor Node.js local + frontend com i18n), mas o conteúdo é específico para o Debian.
- **Distribuição alvo:** Debian **Stable**, instalado a partir de **Live ISO** (não netinst, não DVD). Live ISOs trazem pacotes incompletos por padrão — localização, corretor ortográfico, codecs, firmware, Flatpak — e o DAP existe para resolver isso.
- **Filosofia:** tudo opcional. Nada é habilitado por padrão sem clique explícito do usuário. Repositórios como `backports` e `non-free` são botões, não pré-requisitos do instalador.

### ✨ Sessões implementadas

Esta versão entrega **13 sessões de automação**, cobrindo o escopo completo definido no kickoff:

1. 🚀 **Primeiros Passos** — `apt update`/`upgrade`, conversão para deb822, ativação de `non-free`/`contrib`/`non-free-firmware`, Flatpak + Flathub, backports (kernel/Mesa/firmware), `extrepo`, locale PT-BR, hunspell e arquitetura i386.
2. 📦 **Aplicativos Recomendados** — ~45 apps Flatpak em 8 blocos temáticos, Suíte ArtCraft (7 apps Rust distribuídos como `.deb` no GitHub) e Ferramentas de Acesso Remoto (RustDesk, Remmina, GNOME Connections, KRDC).
3. 🔤 **Codecs e Compatibilidade** — codecs multimídia essenciais, `libdvdcss2` via deb-multimedia, fontes Microsoft com substitutos métricos (`caladea` e `carlito`) e perfil de renderização `fontconfig`.
4. 🖥️ **Hardware** — drivers AMD (Vulkan/Mesa/RADV, VA-API/VDPAU, CoreCtrl, LACT), NVIDIA (detecção via `nvidia-detect` com fallback de heurística, CUDA + NVENC, modeset) e Intel (VA-API).
5. 🔌 **Dispositivos e Periféricos** — detecção automática de hardware via `/hardware-scan`, firmware-linux adicional, driver Broadcom, grupo `input` e regras udev do `steam-devices`.
6. 🎮 **Gaming** — launchers (Steam nativo, Heroic, Lutris), Wine/Proton (Wine, Winetricks, Bottles), desempenho (GameMode, MangoHud, Goverlay, Gamescope), ferramentas avançadas (ProtonUp-Qt, vkBasalt, presets) e emuladores (RetroArch, Dolphin, PCSX2, RPCS3, Duckstation).
7. 🏠 **Casa e Escritório** — CUPS + Avahi, Samba, LocalSend, Warpinator, KeePassXC e Okular + Tesseract.
8. 📊 **Diagnóstico** — painel do sistema, top 5 processos, partições, saúde de disco (GSmartControl), monitoramento e controle térmico (CoolerControl) e logs do journal.
9. 🎬 **Produção Multimídia** — OBS Studio (Flatpak) + câmera virtual (`v4l2loopback-dkms`) e EasyEffects.
10. 💻 **Virtualização** — QEMU/KVM + virt-manager (com configuração automática da rede padrão do libvirt) e GNOME Boxes.
11. 🛠️ **Ajustes e Manutenção** — tunings de performance (`vm.max_map_count`, `vm.swappiness`, `vfs_cache_pressure`, TCP BBR), ajustes de áudio (realtime, PipeWire quantum), configuração de paralelismo do APT, correção de horário em dual-boot, limpeza, gerenciamento de kernels e GRUB.
12. 🐧 **Estado do Debian** — versão do Debian, detecção de variante (Stable/Testing/Sid/derivados) e AppArmor (o sistema de controle de acesso padrão do Debian).
13. 📖 **Sobre o DAP** — atualizar, desinstalar e changelog dinâmico.

### 🔧 Correções

- **`firmware-linux` e `firmware-misc-nonfree`** agora são instalados via backports quando disponíveis, para garantir compatibilidade com hardware recente.
- **Detecção de driver recomendado** em `hardware.html` — o DAP agora informa explicitamente se o sistema já está usando o driver recomendado (`amdgpu` em AMD, `nvidia`/`nvidia_drm` em NVIDIA, `i915`/`xe` em Intel).

### 🎯 Melhorias

- **Steam no Debian** — usa `steam-installer` (não `steam`), com binário em `/usr/games/steam`.
- **NTSYNC removido** — o Debian 13 (kernel 6.12) não tem o módulo; o DAP explica isso na sessão Gaming.
- **Gamescope Session** — fica para v1.5.
- **AppArmor no painel de Estado do Debian** — substitui o SELinux do Fedora.
- **CoolerControl via repositório oficial** — não está no `main` do Debian, mas o desenvolvedor mantém um repositório APT oficial.

### 📝 Notas de desenvolvimento

- **Serviço de hardware reescrito para Debian** — `hardware-service.js` usa `dpkg-query` (não mais `rpm -q`), detecta NVIDIA via `nvidia-detect` (com fallback de heurística via `lspci`) e `hardware_map.json` aponta para pacotes Debian (`nvidia-open-kernel-dkms`, `broadcom-sta-dkms`, `firmware-realtek`, etc.).
- **Formato deb822** — o DAP detecta se o sistema está no formato legado e converte automaticamente via `apt modernize-sources`.
- **Backports** — `trixie-backports` (codename detectado dinamicamente via `/etc/os-release`).
- **Parser de progresso do `apt`** — por enquanto, o `_detectarProgressoPacotes()` do `server.js` retorna sempre `null` (o `apt` não emite `[N/M]`). A barra de progresso cai no fallback do timer.

### 📝 Notas de versão

- **Versionamento**: `MAJOR.MINOR-DDMMYYYY`. O sufixo de data é o dia/mês/ano da publicação.
- **Testado em**: Debian 13 (Trixie) com KDE Plasma, a partir de Live ISO.
- **Distribuição alvo explícita**: Debian puro. Derivados (MX Linux, LMDE, Kali, Raspberry Pi OS) podem funcionar, mas não são oficialmente suportados.

---

## Próximas versões (roadmap)

As versões abaixo são planejadas. Elas só entram neste changelog quando forem publicadas.

- **v0.2** — Refinamentos visuais e correções de bugs reportados pela comunidade.
- **v0.3** — Gamescope Session (sessão de login que abre direto no Big Picture).
- **v1.0** — Primeira versão estável, com paridade funcional completa e revisão geral do código.
