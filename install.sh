#!/usr/bin/env bash
# ============================================================
# Debian Advantage Panel (DAP) - Script de Instalação
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

INSTALL_DIR="$HOME/.local/share/debian-advantage-panel"
BIN_DIR="$HOME/.local/bin"

# ============================================================
# VERSÃO DO DAP — fonte única: package.json
# ============================================================
#
# Procura o package.json em ordem de preferência:
#   1. No diretório de instalação (caso comum: --update em install
#      existente, ou execução de um clone já instalado)
#   2. No diretório atual (caso de ./install.sh rodado de um clone)
#
# NÃO usa `node -p`: no primeiro uso, o próprio install.sh instala
# o Node antes de qualquer coisa — então não dá para confiar que
# ele já esteja disponível. `grep -oP` (GNU grep, presente em todo
# Debian) faz a leitura sem dependências.
#
# Se nada for encontrado, cai em "desconhecida" — o banner mostra
# isso, mas o script continua funcionando normalmente. Esta versão
# é apenas cosmética (o badge do DAP é alimentado pelo /info do
# server.js, que lê o package.json em runtime).
_ler_versao_package() {
    local arquivo
    for arquivo in "$INSTALL_DIR/package.json" "$PWD/package.json"; do
        if [ -f "$arquivo" ]; then
            local v
            v="$(grep -oP '"version"\s*:\s*"\K[^"]+' "$arquivo" 2>/dev/null | head -1)"
            if [ -n "$v" ]; then
                echo "$v"
                return 0
            fi
        fi
    done
    echo "desconhecida"
}

VERSION="$(_ler_versao_package)"

# ============================================================
# CORREÇÃO ÍCONE (KDE/Wayland): os nomes dos arquivos .desktop
# agora batem com o app_id definido em g_set_prgname("dap-container")
# no C. O KDE Plasma em Wayland é rigoroso: se o nome do .desktop
# não bater com o app_id da janela, o ícone não é associado e o
# toolkit mostra o ícone genérico ("W" do WebKitGTK).
# Não alterar sem atualizar o g_set_prgname no src/dap-container.c.
# ============================================================
DESKTOP_FILE="$HOME/.local/share/applications/dap-container.desktop"
DESKTOP_FILE_COMPAT="$HOME/.local/share/applications/dap-container-compat.desktop"

REPO_URL="https://github.com/vitaotub/Debian-Advantage-Panel.git"
LOG_FILE="/tmp/dap-install-$(date +%Y%m%d-%H%M%S).log"

# ============================================================
# ARQUIVOS DE SESSÃO
# ============================================================
#
# Os IDs de sessão são semânticos (sem número). A lista abaixo
# reflete o escopo da Fase 1 (vazia — as sessões serão adicionadas
# na Fase 2). Verificar_arquivos_instalados usa esta lista para
# avisar se algum arquivo não foi clonado corretamente.

SESSAO_ARQUIVOS=(
)

ARQUIVOS_PRINCIPAIS=(
"server.js"
"hardware-service.js"
"hardware_map.json"
"index.html"
"guiado.html"
"style.css"
"script.js"
"i18n.js"
"icone_app.png"
"iniciar_dap.sh"
"iniciar_dap_compat.sh"
"build-container.sh"
"Makefile"
"CHANGELOG.md"
)

print_header() {
echo ""
echo "============================================================"
echo " 🐧 Debian Advantage Panel (DAP) - Instalador v$VERSION"
echo "============================================================"
echo ""
}

print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_error() { echo -e "${RED}❌ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️ $1${NC}"; }
print_info() { echo -e "${BLUE}ℹ️ $1${NC}"; }
print_step() { echo -e "${CYAN}▶ $1${NC}"; }

log() { echo "[$(date '+%H:%M:%S')] $1" >> "$LOG_FILE"; }

reaplicar_permissoes() {
print_step "Reaplicando permissões dos arquivos..."

local arquivos_para_permissoes=(
"iniciar_dap.sh"
"iniciar_dap_compat.sh"
"dap-container"
"build-container.sh"
)

for arquivo in "${arquivos_para_permissoes[@]}"; do
if [ -f "$INSTALL_DIR/$arquivo" ]; then
chmod +x "$INSTALL_DIR/$arquivo"
print_info "Permissão aplicada: $arquivo"
fi
done

local links_para_permissoes=("dap" "dap-compat" "dap-container")
for link in "${links_para_permissoes[@]}"; do
# -L cobre symlinks (mesmo quebrados); -e cobre arquivos regulares.
if [ -L "$BIN_DIR/$link" ] || [ -e "$BIN_DIR/$link" ]; then
chmod +x "$BIN_DIR/$link" 2>/dev/null || true
print_info "Permissão aplicada: $link (link)"
fi
done

print_success "Permissões reaplicadas com sucesso!"
}

# ============================================================
# LIMPEZA DE ARQUIVOS DE VERSÕES ANTIGAS
# ============================================================
#
# Placeholder para futuras renomeações de arquivos entre versões
# do DAP. Quando algum arquivo for renomeado ou removido, listar
# aqui para o `--update` limpá-lo após o git pull.

limpar_arquivos_antigos() {
print_step "Removendo arquivos de versões anteriores..."

local antigos=(
)

local removidos=0
for arquivo in "${antigos[@]}"; do
if [ -f "$INSTALL_DIR/$arquivo" ]; then
rm -f "$INSTALL_DIR/$arquivo"
print_info "Removido: $arquivo"
removidos=$((removidos + 1))
fi
done

if [ $removidos -gt 0 ]; then
print_success "$removidos arquivo(s) antigo(s) removido(s)"
else
print_info "Nenhum arquivo antigo encontrado"
fi
}

verificar_arquivos_instalados() {
print_step "Verificando arquivos instalados..."
local todos_ok=true
local arquivos_para_verificar=("${ARQUIVOS_PRINCIPAIS[@]}" "${SESSAO_ARQUIVOS[@]}")

for arquivo in "${arquivos_para_verificar[@]}"; do
if [ ! -f "$INSTALL_DIR/$arquivo" ]; then
print_warning "Arquivo não encontrado: $arquivo"
todos_ok=false
fi
done

if [ "$todos_ok" = true ]; then
print_success "Todos os arquivos verificados com sucesso!"
else
print_warning "Alguns arquivos podem estar faltando. Tente: $0 --update"
fi
}

# ============================================================
# DEPENDÊNCIAS DO CONTAINER NATIVO
# ============================================================
#
# No Debian Stable (12+, Bookworm), o pacote de desenvolvimento do
# WebKitGTK baseado em GTK3 é o libwebkit2gtk-4.1-dev. O antigo
# webkit2gtk-4.0 (API GTK3 legada) não existe mais desde o Bookworm.
#
# Também instalamos o build-essential e o pkg-config — sem eles o
# gcc não consegue resolver os headers do WebKitGTK.

instalar_dependencias_container() {
print_step "Instalando dependências do container nativo..."

local pacotes=(
"libwebkit2gtk-4.1-dev"
"libgtk-3-dev"
"build-essential"
"pkg-config"
)

local instalar=()

for pkg in "${pacotes[@]}"; do
if ! dpkg -s "$pkg" &> /dev/null; then
instalar+=("$pkg")
fi
done

if [ ${#instalar[@]} -gt 0 ]; then
print_info "Instalando: ${instalar[*]}"
if sudo apt install -y "${instalar[@]}"; then
print_success "Dependências instaladas"
else
print_warning "Algumas dependências podem não ter sido instaladas"
fi
else
print_success "Todas as dependências já estão instaladas"
fi
}

# ============================================================
# DEPENDÊNCIAS DE AUTENTICAÇÃO GRÁFICA
# ============================================================
#
# O server.js usa uma cadeia de autenticação em ordem de
# preferência: kdesu → pkexec → sudo -A (com SUDO_ASKPASS) →
# zenity/kdialog. Para cada DE, precisamos garantir que o diálogo
# apropriado esteja instalado, senão o usuário não vê a janela de
# senha ao instalar pacotes.
#
#   KDE       → kde-cli-tools (kdesu) + kdialog
#   GNOME     → ssh-askpass-gnome + zenity
#   LXQt      → lxqt-sudo + qterminal (opcional) + zenity
#   XFCE      → ssh-askpass + zenity
#   MATE      → ssh-askpass + zenity
#   Cinnamon  → ssh-askpass + zenity
#   LXDE      → ssh-askpass + zenity
#   outros    → ssh-askpass + zenity (universal)

instalar_dependencias_autenticacao() {
print_step "Instalando dependências de autenticação gráfica..."

local desktop="${XDG_CURRENT_DESKTOP:-${DESKTOP_SESSION:-unknown}}"
desktop="$(echo "$desktop" | tr '[:lower:]' '[:upper:]')"

print_info "Desktop detectado: ${desktop:-desconhecido}"

local pacotes=()

case "$desktop" in
*KDE*|*PLASMA*)
pacotes=("kde-cli-tools" "kdialog")
;;
*GNOME*)
pacotes=("ssh-askpass-gnome" "zenity")
;;
*LXQT*)
pacotes=("lxqt-sudo" "zenity")
;;
*XFCE*|*MATE*|*CINNAMON*|*LXDE*|*BUDGIE*)
pacotes=("ssh-askpass" "zenity")
;;
*)
# Fallback universal: ssh-askpass + zenity
pacotes=("ssh-askpass" "zenity")
;;
esac

local instalar=()
for pkg in "${pacotes[@]}"; do
if ! dpkg -s "$pkg" &> /dev/null; then
instalar+=("$pkg")
fi
done

if [ ${#instalar[@]} -gt 0 ]; then
print_info "Instalando: ${instalar[*]}"
if sudo apt install -y "${instalar[@]}"; then
print_success "Dependências de autenticação instaladas"
else
print_warning "Algumas dependências de autenticação podem não ter sido instaladas"
print_info "O DAP tentará outros métodos de autenticação automaticamente"
fi
else
print_success "Dependências de autenticação já estão instaladas"
fi

# pkexec vem do pacote policykit-1, que já é padrão no Debian
if ! dpkg -s policykit-1 &> /dev/null; then
print_info "Instalando policykit-1 (pkexec)..."
sudo apt install -y policykit-1 || print_warning "Falha ao instalar policykit-1"
fi
}

compilar_container_install() {
print_step "Compilando container nativo..."
cd "$INSTALL_DIR"

if [ ! -f "$INSTALL_DIR/build-container.sh" ]; then
print_warning "build-container.sh não encontrado"
print_info "O DAP usará o navegador como fallback"
return 1
fi

chmod +x "$INSTALL_DIR/build-container.sh"

# Captura stdout+stderr do build-container.sh no LOG_FILE.
# Assim, se a compilação falhar (pkg-config sem webkit2gtk-4.1,
# gcc reclamando, etc.), o motivo fica visível para diagnóstico.
if "$INSTALL_DIR/build-container.sh" >> "$LOG_FILE" 2>&1; then
if [ -f "$INSTALL_DIR/dap-container" ]; then
ln -sf "$INSTALL_DIR/dap-container" "$BIN_DIR/dap-container"
chmod +x "$BIN_DIR/dap-container"
print_success "Container compilado e instalado"
return 0
else
print_warning "Compilação retornou sucesso, mas o binário não foi encontrado"
print_info "Verifique o log: $LOG_FILE"
return 1
fi
else
print_warning "Falha ao compilar o container"
print_info "Motivo registrado em: $LOG_FILE"
print_info "O DAP continuará usando o container antigo (se existir) ou o navegador como fallback"
return 1
fi
}

# ============================================================
# VERIFICAÇÃO DE SISTEMA
# ============================================================
#
# Aceita apenas Debian. Derivados (MX, LMDE, Kali, Raspberry Pi OS)
# são detectados via ID_LIKE e avisados, mas o script continua —
# a maioria dos comandos deve funcionar. Testing/Sid também são
# avisados (o projeto é para Stable), mas não bloqueiam.

verificar_sistema() {
print_step "Verificando sistema operacional..."

if [ ! -f /etc/os-release ]; then
print_error "Arquivo /etc/os-release não encontrado"
print_error "Este sistema não parece ser baseado em Debian"
exit 1
fi

local os_id=""
local os_like=""
local os_pretty=""
local codename=""

os_id="$(grep '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"')"
os_like="$(grep '^ID_LIKE=' /etc/os-release | cut -d= -f2 | tr -d '"' || echo "")"
os_pretty="$(grep '^PRETTY_NAME=' /etc/os-release | cut -d= -f2 | tr -d '"' || echo "")"
codename="$(grep '^VERSION_CODENAME=' /etc/os-release | cut -d= -f2 | tr -d '"' || echo "")"

if [ "$os_id" = "debian" ]; then
print_success "$os_pretty"
log "Sistema: $os_pretty"

if [ "$codename" = "testing" ] || [ "$codename" = "sid" ] || [ "$codename" = "unstable" ]; then
print_warning "Você está usando Debian Testing/Sid"
print_warning "O DAP foi desenvolvido e testado para Debian Stable"
print_info "A maioria dos comandos deve funcionar, mas podem surgir incompatibilidades"
fi
else
if echo "$os_like" | grep -qi debian; then
print_warning "Sistema derivado do Debian detectado: $os_pretty"
print_warning "O DAP foi desenvolvido para Debian puro (Stable)"
print_info "A maioria dos comandos deve funcionar, mas não há garantia"
read -p "Continuar mesmo assim? (s/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Ss]$ ]]; then
print_error "Instalação cancelada"
exit 1
fi
else
print_error "Sistema não identificado como Debian: $os_pretty"
print_error "Este instalador é feito para Debian Linux"
exit 1
fi
fi
}

verificar_dependencias() {
print_step "Verificando dependências..."

local faltando=()

if ! command -v node &> /dev/null; then
faltando+=("nodejs")
print_warning "Node.js não encontrado"
else
local versao_node
versao_node="$(node --version 2>/dev/null | sed 's/^v//')"
local major="${versao_node%%.*}"
if [ -z "$major" ] || [ "$major" -lt 18 ] 2>/dev/null; then
print_warning "Node.js $versao_node é antigo (requer 18+)"
faltando+=("nodejs")
else
print_success "Node.js: $(node --version)"
fi
fi

if ! command -v npm &> /dev/null; then
faltando+=("npm")
print_warning "npm não encontrado"
else
print_success "npm: $(npm --version)"
fi

if ! command -v git &> /dev/null; then
faltando+=("git")
print_warning "git não encontrado"
else
print_success "git: $(git --version | cut -d' ' -f3)"
fi

if ! command -v curl &> /dev/null; then
faltando+=("curl")
print_warning "curl não encontrado"
else
print_success "curl: $(curl --version | head -1 | cut -d' ' -f2)"
fi

# ------------------------------------------------------------
# zenity: diálogo gráfico de senha em DEs não-KDE
# ------------------------------------------------------------
#
# Em KDE, o DAP usa kdesu (via kde-cli-tools). Nos demais, o
# fallback é pkexec + zenity, ou sudo -A + ssh-askpass. Sem
# nenhum dos três, a autenticação quebra silenciosamente.
#
# A instalação específica por DE é tratada em
# instalar_dependencias_autenticacao(), então aqui só verificamos
# se algum diálogo está disponível.
if ! command -v zenity &> /dev/null && \
   ! command -v kdialog &> /dev/null && \
   ! command -v ssh-askpass &> /dev/null && \
   ! command -v ssh-askpass-gnome &> /dev/null && \
   ! command -v lxqt-sudo &> /dev/null; then
print_warning "Nenhum diálogo gráfico de senha encontrado"
print_info "As dependências de autenticação serão instaladas em seguida"
fi

if [ ${#faltando[@]} -gt 0 ]; then
print_info "Instalando dependências faltando: ${faltando[*]}"
log "Instalando: ${faltando[*]}"
if ! sudo apt update && sudo apt install -y "${faltando[@]}"; then
print_error "Falha ao instalar dependências"
print_error "Tente manualmente: sudo apt install ${faltando[*]}"
exit 1
fi
print_success "Dependências instaladas"
else
print_success "Todas as dependências estão instaladas"
fi
}

instalar_dap() {
print_step "Instalando Debian Advantage Panel..."

mkdir -p "$INSTALL_DIR"
mkdir -p "$BIN_DIR"

if [ -d "$INSTALL_DIR/.git" ]; then
print_info "Atualizando repositório existente..."
cd "$INSTALL_DIR"
git pull --ff-only
else
print_info "Clonando repositório..."
git clone "$REPO_URL" "$INSTALL_DIR"
cd "$INSTALL_DIR"
fi

print_step "Instalando dependências do Node.js..."
# --omit=dev evita instalar nodemon (devDependency), que o DAP
# não usa em runtime.
if ! npm install --omit=dev --no-audit --no-fund --silent; then
print_error "Falha ao instalar dependências"
exit 1
fi

ln -sf "$INSTALL_DIR/iniciar_dap.sh" "$BIN_DIR/dap"
chmod +x "$INSTALL_DIR/iniciar_dap.sh"
chmod +x "$BIN_DIR/dap"

if [ -f "$INSTALL_DIR/iniciar_dap_compat.sh" ]; then
ln -sf "$INSTALL_DIR/iniciar_dap_compat.sh" "$BIN_DIR/dap-compat"
chmod +x "$INSTALL_DIR/iniciar_dap_compat.sh"
chmod +x "$BIN_DIR/dap-compat"
fi

print_success "DAP instalado em: $INSTALL_DIR"
print_success "Comando 'dap' disponível em: $BIN_DIR"
print_success "Comando 'dap-compat' disponível em: $BIN_DIR"
}

criar_atalhos() {
print_step "Criando atalhos no menu de aplicativos..."

# ============================================================
# CORREÇÃO ÍCONE (KDE/Wayland): o nome do arquivo .desktop agora
# é "dap-container.desktop", casando com o app_id definido em
# g_set_prgname("dap-container") no src/dap-container.c. Sem essa
# correspondência, o KDE Plasma em Wayland não associa o ícone do
# .desktop com a janela do container e mostra o ícone genérico do
# WebKitGTK (o "W" amarelo).
#
# O nome exibido no menu (Name=Debian Advantage Panel) não depende do
# nome do arquivo — pode ser qualquer coisa.
#
# O Exec aponta para o caminho REAL do script (dentro do
# INSTALL_DIR), não para o symlink em ~/.local/bin. Isso é
# ligeiramente mais robusto: se algo remover o symlink, o
# atalho continua funcionando.
# ============================================================

# Ícone no tema hicolor com o MESMO nome do app_id, para o KDE
# achar o ícone por nome (Icon=dap-container) em qualquer tema.
if [ -f "$INSTALL_DIR/icone_app.png" ]; then
mkdir -p "$HOME/.local/share/icons/hicolor/256x256/apps"
cp "$INSTALL_DIR/icone_app.png" "$HOME/.local/share/icons/hicolor/256x256/apps/dap-container.png"
gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
print_success "Ícone do container instalado em hicolor"
else
print_warning "icone_app.png não encontrado — o atalho usará ícone genérico"
print_info "Coloque um arquivo 'icone_app.png' na raiz do DAP e rode --update"
fi

mkdir -p "$(dirname "$DESKTOP_FILE")"

# --- Atalho principal ---
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Debian Advantage Panel
Comment=Painel de Automação do Debian
Exec=$INSTALL_DIR/iniciar_dap.sh
Icon=dap-container
Terminal=false
Categories=System;Settings;
StartupNotify=false
StartupWMClass=dap-container
EOF

chmod +x "$DESKTOP_FILE"
print_success "Atalho criado: $DESKTOP_FILE"

# --- Atalho de compatibilidade (modo software rendering) ---
if [ -f "$INSTALL_DIR/iniciar_dap_compat.sh" ]; then
cat > "$DESKTOP_FILE_COMPAT" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Debian Advantage Panel (Modo Compatibilidade)
Comment=Painel de Automação do Debian - Modo compatível com GPUs antigas
Exec=$INSTALL_DIR/iniciar_dap_compat.sh
Icon=dap-container
Terminal=false
Categories=System;Settings;
StartupNotify=false
StartupWMClass=dap-container
EOF

chmod +x "$DESKTOP_FILE_COMPAT"
print_success "Atalho de compatibilidade criado: $DESKTOP_FILE_COMPAT"
fi

update-desktop-database ~/.local/share/applications/ 2>/dev/null || true
kbuildsycoca6 --noincremental 2>/dev/null || kbuildsycoca5 --noincremental 2>/dev/null || true
}

configurar_path() {
print_step "Configurando PATH..."

if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
print_warning "~/.local/bin não está no PATH"

if [ -f "$HOME/.bashrc" ]; then
echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
print_success "Adicionado ao .bashrc"
fi

if [ -f "$HOME/.zshrc" ]; then
echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
print_success "Adicionado ao .zshrc"
fi

print_info "Reinicie o terminal ou execute: source ~/.bashrc"
else
print_success "PATH já configurado"
fi
}

# ============================================================
# DESINSTALAÇÃO
# ============================================================

desinstalar() {
print_header
print_warning "Desinstalando Debian Advantage Panel..."

read -p "Tem certeza? (s/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Ss]$ ]]; then
print_info "Desinstalação cancelada"
exit 0
fi

print_step "Removendo arquivos..."

# ─── 1. Diretório de instalação ─────────────────────────────
if [ -d "$INSTALL_DIR" ]; then
rm -rf "$INSTALL_DIR"
print_success "Diretório removido: $INSTALL_DIR"
fi

# ─── 2. Symlinks em ~/.local/bin ────────────────────────────
# NOTA: usamos `-L` (testa symlink) em vez de `-f` (segue o
# symlink). Como o INSTALL_DIR foi removido acima, os symlinks
# ficam "quebrados" e `-f` retorna false — pulando a remoção.
local links=("dap" "dap-compat" "dap-container")
for link in "${links[@]}"; do
if [ -L "$BIN_DIR/$link" ] || [ -e "$BIN_DIR/$link" ]; then
rm -f "$BIN_DIR/$link"
print_success "Link removido: $BIN_DIR/$link"
fi
done

# ─── 3. Atalhos .desktop ────────────────────────────────────
local atalhos=(
"$DESKTOP_FILE"
"$DESKTOP_FILE_COMPAT"
)
for atalho in "${atalhos[@]}"; do
if [ -L "$atalho" ] || [ -e "$atalho" ]; then
rm -f "$atalho"
print_success "Atalho removido: $atalho"
fi
done

# ─── 4. Ícone hicolor ──────────────────────────────────────
if [ -f "$HOME/.local/share/icons/hicolor/256x256/apps/dap-container.png" ]; then
rm -f "$HOME/.local/share/icons/hicolor/256x256/apps/dap-container.png"
gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
print_success "Ícone removido do hicolor"
fi

# ─── 5. Dados e cache do WebKitGTK ──────────────────────────
# O dap-container (WebKitGTK) cria esses dois diretórios em
# runtime. Sem removê-los, o cache HTTP e o localStorage ficam
# órfãos no sistema (incluindo o badge de atualização).
if [ -d "$HOME/.cache/dap-container" ]; then
rm -rf "$HOME/.cache/dap-container"
print_success "Cache do WebKitGTK removido: ~/.cache/dap-container"
fi

if [ -d "$HOME/.local/share/dap-container" ]; then
rm -rf "$HOME/.local/share/dap-container"
print_success "Dados do WebKitGTK removidos: ~/.local/share/dap-container"
fi

if [ -d "$HOME/.config/dap-container" ]; then
rm -rf "$HOME/.config/dap-container"
print_success "Configurações do DAP removidas: ~/.config/dap-container"
fi

# ─── 6. Logs temporários ────────────────────────────────────
# Os arquivos /tmp/dap-out-*.log são criados pelo kdesu/pkexec
# (que rodam como root) e ficam com owner root. O `rm -f` como
# usuário comum falha com "Operação não permitida", o que faz o
# `set -e` abortar o script inteiro. Solução: tentar como user
# primeiro, e escalar para sudo apenas se sobrar algo.
print_step "Removendo logs temporários..."

# Logs do usuário (sempre removíveis)
rm -f /tmp/dap-install-*.log 2>/dev/null || true
rm -f /tmp/dap-waydroid-ui.log 2>/dev/null || true
rm -f /tmp/dap-open-*.log 2>/dev/null || true

# Logs de comandos autenticados — podem pertencer ao root
if ls /tmp/dap-out-*.log >/dev/null 2>&1; then
if ! rm -f /tmp/dap-out-*.log 2>/dev/null; then
print_info "Alguns logs pertencem ao root (kdesu/pkexec). Removendo com sudo..."
sudo rm -f /tmp/dap-out-*.log 2>/dev/null || true
fi
fi

# Scripts temporários
rm -f /tmp/dap-cmd-*.sh 2>/dev/null || true

print_success "Logs temporários removidos"

# ─── 7. Limpeza de PATH nos rc files ────────────────────────
remover_linha_path() {
local arquivo="$1"
local linha_a_remover='export PATH="$HOME/.local/bin:$PATH"'

if [ ! -f "$arquivo" ]; then
return 0
fi

# Só faz backup se o arquivo realmente contém a linha a remover.
# Se não contém, não mexe — evita criar backup de arquivo que
# não foi alterado.
if ! grep -qF "$linha_a_remover" "$arquivo"; then
return 0
fi

# Backup atômico com timestamp, mantido por segurança caso o
# usuário queira restaurar manualmente.
local backup="${arquivo}.dap-backup-$(date +%Y%m%d-%H%M%S)"
cp "$arquivo" "$backup"
grep -vF "$linha_a_remover" "$arquivo" > "${arquivo}.tmp"
mv "${arquivo}.tmp" "$arquivo"
print_success "Linha removida de: $arquivo (backup: $backup)"
}

remover_linha_path "$HOME/.bashrc"
remover_linha_path "$HOME/.zshrc"
remover_linha_path "$HOME/.profile"

# ─── 8. Reindexação do menu ─────────────────────────────────
update-desktop-database ~/.local/share/applications/ 2>/dev/null || true
kbuildsycoca6 --noincremental 2>/dev/null || kbuildsycoca5 --noincremental 2>/dev/null || true

echo ""
print_success "✅ DAP completamente desinstalado!"
}

# ============================================================
# ATUALIZAÇÃO
# ============================================================

atualizar() {
print_header

if [ ! -d "$INSTALL_DIR/.git" ]; then
print_error "DAP não está instalado ou não foi clonado do Git"
print_info "Execute a instalação primeiro: ./install.sh"
exit 1
fi

print_step "Atualizando Debian Advantage Panel..."
cd "$INSTALL_DIR"

# git stash push -m é o substituto moderno do git stash save (que foi
# deprecado no Git 2.13+, 2017). O -m define a mensagem, preservando o
# comportamento do save.
git stash push -m "Backup automático antes da atualização" 2>/dev/null || true

# --ff-only usa o upstream configurado (origin/main por padrão) e
# recusa merge commits. Se o upstream não estiver setado, falha
# com mensagem clara em vez de instalar uma versão quebrada.
if ! git pull --ff-only; then
print_error "Falha ao atualizar"
exit 1
fi

git stash pop 2>/dev/null || true

# Remove arquivos de sessões antigas que possam ter sobrado.
# Roda DEPOIS do git pull, porque:
# - Se o git já tiver removido, o `rm -f` é no-op.
# - Se o git não detectou a renomeação, limpamos o resquício.
limpar_arquivos_antigos

print_step "Atualizando dependências do Node.js..."
if ! npm install --omit=dev --no-audit --no-fund --silent; then
print_warning "Falha ao atualizar dependências, continuando..."
fi

# Recompila o container nativo. O install.sh --update é chamado pelo
# botão "Atualizar DAP" na sessão sobre-dap, então essa recompilação
# roda automaticamente em cada atualização.
compilar_container_install || true

print_step "Recriando symlinks dos comandos..."
mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/iniciar_dap.sh" "$BIN_DIR/dap"
chmod +x "$INSTALL_DIR/iniciar_dap.sh" "$BIN_DIR/dap"
if [ -f "$INSTALL_DIR/iniciar_dap_compat.sh" ]; then
ln -sf "$INSTALL_DIR/iniciar_dap_compat.sh" "$BIN_DIR/dap-compat"
chmod +x "$INSTALL_DIR/iniciar_dap_compat.sh" "$BIN_DIR/dap-compat"
fi
if [ -f "$INSTALL_DIR/dap-container" ]; then
ln -sf "$INSTALL_DIR/dap-container" "$BIN_DIR/dap-container"
chmod +x "$BIN_DIR/dap-container"
fi
print_success "Symlinks atualizados"

verificar_arquivos_instalados
reaplicar_permissoes
criar_atalhos

print_success "✅ DAP atualizado para a versão mais recente!"

# ============================================================
# ENCERRA O SERVIDOR ANTIGO APÓS A ATUALIZAÇÃO
# ============================================================
#
# O processo `node server.js` carrega DAP_VERSION uma única vez, no
# boot. Se ele continuar rodando após o update, o endpoint /info
# segue retornando a versão antiga — e o badge de "atualização
# disponível" continua aparecendo, mesmo com o DAP já atualizado
# no disco.
#
# Solução: encerrar o servidor antigo automaticamente ao fim do
# update. O usuário só precisa reabrir o DAP com `dap`, e o novo
# servidor sobe com a versão nova.

if pgrep -f "node server.js" > /dev/null 2>&1; then
print_info "🔄 Encerrando o servidor antigo em 3 segundos..."
print_info "💡 Reabra o DAP com o comando 'dap' para usar a versão nova."

nohup bash -c 'sleep 3 && pkill -f "node server.js" 2>/dev/null' > /dev/null 2>&1 &
fi
}

# ============================================================
# AJUDA
# ============================================================

mostrar_ajuda() {
cat <<EOF
🐧 Debian Advantage Panel (DAP) - Instalador v$VERSION

Uso: $(basename "$0") [opções]

Opções:
--help, -h Mostra esta ajuda
--update Atualiza uma instalação existente
--uninstall Desinstala o DAP do sistema

Após a instalação:
- O comando 'dap' estará disponível no terminal
- O comando 'dap-compat' estará disponível (modo compatibilidade)
- Dois atalhos serão criados no menu de aplicativos

Nota sobre desktops:
- Todos os desktops Linux são suportados (GNOME, KDE, XFCE,
  Cinnamon, MATE, LXQt, LXDE, tiling WMs).
- A autenticação gráfica é detectada automaticamente:
    KDE      → kdesu (kde-cli-tools)
    GNOME    → ssh-askpass-gnome + zenity
    LXQt     → lxqt-sudo + zenity
    Outros   → ssh-askpass + zenity
- O DAP NÃO fixa atalhos na barra de tarefas. Faça manualmente
  pelo menu do seu desktop (botão direito no ícone do DAP).

EOF
exit 0
}

# ============================================================
# MAIN
# ============================================================

main() {
case "$1" in
--help|-h)
mostrar_ajuda
;;
--uninstall)
desinstalar
exit 0
;;
--update)
atualizar
exit 0
;;
esac

print_header

verificar_sistema
verificar_dependencias

instalar_dap
verificar_arquivos_instalados
instalar_dependencias_container
instalar_dependencias_autenticacao
compilar_container_install
criar_atalhos
configurar_path
reaplicar_permissoes

echo ""
print_success "🎉 Debian Advantage Panel instalado com sucesso!"
echo ""
print_info "📁 Instalado em: $INSTALL_DIR"
print_info ""
print_info "Para iniciar o DAP:"
echo " - Terminal: digite 'dap' ou 'dap-compat'"
echo " - Menu: procure por 'Debian Advantage Panel'"
echo ""
print_info "💡 Para fixar na barra de tarefas, use o menu do seu desktop"
print_info "   (botão direito no ícone do DAP → 'Adicionar ao Painel' ou similar)"
echo ""
print_info "📋 Log da instalação: $LOG_FILE"
echo ""
}

main "$@"
