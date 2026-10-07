# <img src="icone_app.png" width="55" align="center"> Debian Advantage Panel (DAP)

**🌐 Language:** [Português (BR)](README.md) | English | [Español](README.es.md)

![Version](https://img.shields.io/badge/Version-v0.1--10072026-orange?style=flat-square)
![Debian](https://img.shields.io/badge/Debian-12%2B-A81D33?style=flat-square&logo=debian)
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

## ⚠️ Current status — v0.1 (Phase 1)

**This is an early development version.** It delivers **the complete technical foundation**, but **no automation session is implemented yet**.

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
- ✅ Install, update and uninstall via `install.sh`

### What is **not** present yet

- 🚧 None of the 8 automation sessions
- 🚧 Hardware detection (`hardware-service.js` is still the FAP one — returns empty list on Debian)
- 🚧 Real progress parser for `apt` (uses timer fallback)

**`guiado.html` shows an explicit placeholder saying "Phase 1 of development completed. Sessions will be added in the next phase."** This is not a bug — it is the expected state for v0.1.

## ✨ Sessions planned for v1

| # | Session | What it does |
|---|---|---|
| 1 | 🚀 First Steps | `apt update`/`upgrade`, enable non-free/contrib/non-free-firmware, Flatpak/Flathub, backports, PT-BR locale, hunspell, i386 (for Steam) |
| 2 | 🔤 Codecs and Compatibility | `ttf-mscorefonts-installer`, `libdvdcss2`, extra firmware |
| 3 | 🖥️ Hardware | AMD, Intel and NVIDIA drivers (via non-free) |
| 4 | 📦 Recommended Apps | ~45 Flatpaks + ArtCraft Suite + Remote Access Tools |
| 5 | 🏠 Home and Office | CUPS, Samba, LocalSend, KeePassXC, Okular+Tesseract |
| 6 | 🎮 Gaming | Steam (`steam-installer` + i386), Heroic, Lutris, GameMode, MangoHud, emulators |
| 7 | 📊 Diagnostics | System panel, GSmartControl, CoolerControl, journal |
| 8 | 📖 About DAP | Update, uninstall, dynamic changelog |

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

## 🖥️ Supported desktops

GNOME, KDE Plasma, XFCE, Cinnamon, MATE, LXQt, LXDE, Budgie, Sway, Hyprland, i3 and other tiling WMs.

## 📋 Requirements

- **Debian 12 (Bookworm) or newer** — Stable
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
