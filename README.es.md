# <img src="icone_app.png" width="55" align="center"> Debian Advantage Panel (DAP)

**🌐 Idioma:** [Português (BR)](README.md) | [English](README.en.md) | Español

![Versión](https://img.shields.io/badge/Versi%C3%B3n-v0.1--10082026-orange?style=flat-square)
![Debian](https://img.shields.io/badge/Debian-13%2B-A81D33?style=flat-square&logo=debian)
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

## ⚠️ Estado actual — v0.1-10082026

**Esta es una versión en desarrollo activo, con todas las sesiones del alcance implementadas.**

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
- ✅ Detección de hardware en tiempo real (endpoint `/hardware-scan`)
- ✅ Instalación, actualización y desinstalación vía `install.sh`

### Sesiones implementadas

**13 sesiones de automatización:**

1. 🚀 Primeros Pasos
2. 📦 Aplicaciones Recomendadas
3. 🔤 Códecs y Compatibilidad
4. 🖥️ Hardware
5. 🔌 Dispositivos y Periféricos
6. 🎮 Gaming
7. 🏠 Hogar y Oficina
8. 📊 Diagnóstico
9. 🎬 Producción Multimedia
10. 💻 Virtualización
11. 🛠️ Ajustes y Mantenimiento
12. 🐧 Estado de Debian
13. 📖 Acerca de DAP

**`guiado.html` está funcional** — navegación entre sesiones, sistema de progreso, i18n, tema claro/oscuro, cola de Flatpak, autenticación gráfica, detección de hardware.

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
- **Detección de hardware en tiempo real** — cada sesión de Hardware y Dispositivos verifica el driver en uso
- **CoolerControl vía repositorio oficial** (no está en main de Debian)
- **AppArmor en el panel de Estado de Debian** (reemplaza el SELinux de Fedora)

## 🖥️ Escritorios soportados

GNOME, KDE Plasma, XFCE, Cinnamon, MATE, LXQt, LXDE, Budgie, Sway, Hyprland, i3 y otros tiling WMs.

## 📋 Requisitos

- **Debian 13 (Trixie) o más nuevo** — Stable
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
