# <img src="icone_app.png" width="55" align="center"> Debian Advantage Panel (DAP)

**🌐 Language:** [Português (BR)](README.md) | English | [Español](README.es.md)

![Version](https://img.shields.io/badge/Version-v0.1--10082026-orange?style=flat-square)
![Debian](https://img.shields.io/badge/Debian-13%2B-A81D33?style=flat-square&logo=debian)
![License](https://img.shields.io/badge/License-GPL--3.0-green?style=flat-square)
![Languages](https://img.shields.io/badge/Languages-PT--BR%20%7C%20EN%20%7C%20ES-3c67e3?style=flat-square)

> Getting your Debian ready for daily use — visual, fast, no terminal.

## 🚀 Installation

```bash
bash <(curl -s https://raw.githubusercontent.com/vitaotub/Debian-Advantage-Panel/main/install.sh)
```

**Commands available after installing:**

```bash
dap                       # Launch (normal mode)
dap-compat                # Launch (compatibility mode — older GPUs)
./install.sh --update     # Update
./install.sh --uninstall  # Uninstall
```

## 📖 About

Visual automation panel for **Debian Stable**. Turns a **Live ISO** installation into a complete system — codecs, drivers, repositories, locale, spell checker, tools — through clicks, without opening the terminal.

**Why Live ISO?** Debian Live ISOs ship with incomplete packages by default: locale not generated, spell checker missing, basic codecs absent, firmware incomplete, Flatpak not installed. DAP exists to fill that gap with a click.

**Single entry point**: the **"Start"** button walks you through the sessions step by step. Each button remembers its own state. Closing and reopening DAP shows exactly where you stopped.

**Sister project of [Fedora Advantage Panel](https://github.com/vitaotub/Fedora-Advantage-Panel)** — shares philosophy, visual standards and architecture, but the content is specific to Debian.

## ⚠️ Current status — v0.1-10082026

**This is an actively developed version, with all sessions from the scope implemented.**

### What already works

- ✅ Landing page with clock, "Start" button and footer
- ✅ Native WebKitGTK container (own window, no external browser)
- ✅ Local Node.js server (127.0.0.1:3000)
- ✅ Internationalization PT-BR / EN / ES with real-time switching
- ✅ Light/dark theme with `localStorage` persistence
- ✅ Progress system (`.progresso.json`)
- ✅ Graphical authentication (kdesu / pkexec / sudo -A)
- ✅ Green Matrix log in real time (SSE)
- ✅ Flatpak install queue
- ✅ Session blocking during execution
- ✅ Real-time hardware detection (endpoint `/hardware-scan`)
- ✅ Install, update and uninstall via `install.sh`

### Implemented sessions

**13 automation sessions:**

1. 🚀 First Steps
2. 📦 Recommended Apps
3. 🔤 Codecs and Compatibility
4. 🖥️ Hardware
5. 🔌 Devices and Peripherals
6. 🎮 Gaming
7. 🏠 Home and Office
8. 📊 Diagnostics
9. 🎬 Media Production
10. 💻 Virtualization
11. 🛠️ Tunings and Maintenance
12. 🐧 Debian Status
13. 📖 About DAP

**`guiado.html` is functional** — session navigation, progress system, i18n, light/dark theme, Flatpak queue, graphical authentication, hardware detection.

## 🎨 Highlights

- **Light interface** with Debian red accent (`#a80030`), switchable to dark theme
- **Multilingual** (PT-BR, EN, ES) with real-time switching
- **Real-time logs** via SSE, with replay buffer
- **Unified trash icon** for Flatpaks and non-Flatpak apps
- **"Open" button** on every GUI app — launches in its own session (survives DAP closing)
- **Install queue** for Flatpaks — click on multiple in sequence
- **Smart lock** — prevents `dpkg` lock conflicts and blocks session navigation during execution
- **Robust graphical authentication** — `kdesu → pkexec → sudo -A` chain covers every Debian DE
- **Native WebKitGTK container** (no external browser)
- **Real-time hardware detection** — every Hardware and Devices session checks the driver in use
- **CoolerControl via official repository** (not in Debian's main)
- **AppArmor in Debian Status panel** (replaces Fedora's SELinux)

## 🖥️ Supported desktops

GNOME, KDE Plasma, XFCE, Cinnamon, MATE, LXQt, LXDE, Budgie, Sway, Hyprland, i3 and other tiling WMs.

## 📋 Requirements

- **Debian 13 (Trixie) or newer** — Stable
- **Not** supported on derivatives (MX, LMDE, Kali, Raspberry Pi OS) — may work, but no support
- **Not** supported on Testing/Sid — may work, but no support
- Installation from **Live ISO** (not netinst, not DVD) — to make the most of the "First Steps" sessions

## 📄 License

**GPL-3.0** — see [LICENSE](LICENSE).

## 👤 Author

**VitãoTub** — [vitaotub.com](https://www.vitaotub.com) · [github.com/vitaotub](https://github.com/vitaotub)

## 🙏 Acknowledgments

[![Debian Project](https://img.shields.io/badge/Debian-Project-A81D33?style=flat-square&logo=debian&logoColor=white)](https://www.debian.org/)
[![DeepSeek](https://img.shields.io/badge/DeepSeek-AI-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://www.deepseek.com/)

**Made with ❤️ for the Debian community**
