# <img src="icone_app.png" width="55" align="center"> Debian Advantage Panel (DAP)

**🌐 Idioma:** [Português (BR)](README.md) | [English](README.en.md) | Español

![Versión](https://img.shields.io/badge/Versi%C3%B3n-v0.1--10072026-orange?style=flat-square)
![Debian](https://img.shields.io/badge/Debian-12%2B-A81D33?style=flat-square&logo=debian)
![Licencia](https://img.shields.io/badge/Licencia-GPL--3.0-green?style=flat-square)
![Idiomas](https://img.shields.io/badge/Idiomas-PT--BR%20%7C%20EN%20%7C%20ES-3c67e3?style=flat-square)

> Dejando tu Debian listo para el uso diario — visual, rápido y sin terminal.

## 🚀 Instalación

```bash
bash <(curl -s https://raw.githubusercontent.com/vitaotub/Debian-Advantage-Panel/main/install.sh)
```

**Comandos disponibles después de instalar:**

```bash
dap                       # Iniciar (modo normal)
dap-compat                # Iniciar (modo compatibilidad — GPUs antiguas)
./install.sh --update     # Actualizar
./install.sh --uninstall  # Desinstalar
```

## 📖 Sobre

Panel de automatización visual para **Debian Stable**. Transforma una instalación hecha a partir de **Live ISO** en un sistema completo — códecs, controladores, repositorios, localización, corrector ortográfico, herramientas — a través de clics, sin abrir la terminal.

**¿Por qué Live ISO?** Las Live ISOs de Debian vienen con paquetes incompletos por defecto: localización no generada, corrector ortográfico ausente, códecs básicos faltantes, firmware incompleto, Flatpak no instalado. DAP existe para cerrar esa brecha con un clic.

**Un único punto de entrada**: el botón **"Iniciar"** te lleva por las sesiones paso a paso. Cada botón recuerda su propio estado. Cerrar y reabrir DAP muestra exactamente dónde te detuviste.

**Proyecto hermano del [Fedora Advantage Panel](https://github.com/vitaotub/Fedora-Advantage-Panel)** — comparte filosofía, estándares visuales y arquitectura, pero el contenido es específico para Debian.

## ⚠️ Estado actual — v0.1 (Fase 1)

**Esta es una versión inicial de desarrollo.** Entrega **la base técnica completa**, pero **ninguna sesión de automatización está implementada todavía**.

### Lo que ya funciona

- ✅ Landing page con reloj, botón "Iniciar" y pie de página
- ✅ Contenedor WebKitGTK nativo (ventana propia, sin navegador externo)
- ✅ Servidor Node.js local (127.0.0.1:3000)
- ✅ Internacionalización PT-BR / EN / ES con cambio en tiempo real
- ✅ Tema claro/oscuro con persistencia en `localStorage`
- ✅ Sistema de progreso (`.progresso.json`)
- ✅ Autenticación gráfica (kdesu / pkexec / sudo -A)
- ✅ Log Matrix verde en tiempo real (SSE)
- ✅ Cola de instalación de Flatpak
- ✅ Bloqueo de sesión durante la ejecución
- ✅ Instalación, actualización y desinstalación vía `install.sh`

### Lo que **no** está presente todavía

- 🚧 Ninguna de las 8 sesiones de automatización
- 🚧 Detección de hardware (`hardware-service.js` sigue siendo el del FAP — devuelve lista vacía en Debian)
- 🚧 Parser de progreso real para `apt` (usa fallback del temporizador)

**`guiado.html` muestra un placeholder explícito diciendo "Fase 1 del desarrollo completada. Las sesiones se agregarán en la próxima fase."** Esto no es un bug — es el estado esperado para v0.1.

## ✨ Sesiones planeadas para la v1

| # | Sesión | Qué hace |
|---|---|---|
| 1 | 🚀 Primeros Pasos | `apt update`/`upgrade`, activar non-free/contrib/non-free-firmware, Flatpak/Flathub, backports, locale PT-BR, hunspell, i386 (para Steam) |
| 2 | 🔤 Códecs y Compatibilidad | `ttf-mscorefonts-installer`, `libdvdcss2`, firmwares adicionales |
| 3 | 🖥️ Hardware | Controladores AMD, Intel y NVIDIA (vía non-free) |
| 4 | 📦 Aplicaciones | ~45 Flatpaks + Suite ArtCraft + Herramientas de Acceso Remoto |
| 5 | 🏠 Hogar y Oficina | CUPS, Samba, LocalSend, KeePassXC, Okular+Tesseract |
| 6 | 🎮 Gaming | Steam (`steam-installer` + i386), Heroic, Lutris, GameMode, MangoHud, emuladores |
| 7 | 📊 Diagnóstico | Panel del sistema, GSmartControl, CoolerControl, journal |
| 8 | 📖 Acerca de DAP | Actualizar, desinstalar, changelog dinámico |

## 🎨 Destaques

- **Interfaz clara** con acento rojo Debian (`#a80030`), alternable a tema oscuro
- **Multiidioma** (PT-BR, EN, ES) con cambio en tiempo real
- **Registros en tiempo real** vía SSE, con búfer de replay
- **Papelera unificada** para Flatpaks y apps no-Flatpak
- **Botón "Abrir"** en cada app GUI — se inicia en sesión propia (sobrevive al cierre de DAP)
- **Cola de instalación** de Flatpaks — haz clic en varios en secuencia
- **Bloqueo inteligente** — evita conflictos de lock en `dpkg` y bloquea la navegación entre sesiones durante la ejecución
- **Autenticación gráfica robusta** — la cadena `kdesu → pkexec → sudo -A` cubre todos los DEs de Debian
- **Contenedor WebKitGTK nativo** (sin navegador externo)

## 🖥️ Escritorios soportados

GNOME, KDE Plasma, XFCE, Cinnamon, MATE, LXQt, LXDE, Budgie, Sway, Hyprland, i3 y otros tiling WMs.

## 📋 Requisitos

- **Debian 12 (Bookworm) o más nuevo** — Stable
- **No** soportado en derivados (MX, LMDE, Kali, Raspberry Pi OS) — puede funcionar, pero sin soporte
- **No** soportado en Testing/Sid — puede funcionar, pero sin soporte
- Instalación desde **Live ISO** (no netinst, no DVD) — para aprovechar al máximo las sesiones de "Primeros Pasos"

## 📄 Licencia

**GPL-3.0** — ver [LICENSE](LICENSE).

## 👤 Autor

**VitãoTub** — [vitaotub.com](https://www.vitaotub.com) · [github.com/vitaotub](https://github.com/vitaotub)

## 🙏 Agradecimientos

[![Debian Project](https://img.shields.io/badge/Debian-Project-A81D33?style=flat-square&logo=debian&logoColor=white)](https://www.debian.org/)
[![DeepSeek](https://img.shields.io/badge/DeepSeek-AI-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://www.deepseek.com/)

**Hecho con ❤️ para la comunidad Debian**
