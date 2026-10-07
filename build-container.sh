#!/usr/bin/env bash
# ============================================================
# Build do Container DAP
# ============================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# ============================================================
# VERSÃO DO DAP — fonte única: package.json
# ============================================================
#
# O C não lê arquivos em runtime. Injetamos a versão via macro
# `-DDAP_VERSION="..."` no gcc, lendo do package.json com o mesmo
# `grep -oP` dos outros scripts. Fallback "unknown" — o binário
# continua compilando mesmo sem o arquivo.
DAP_VERSION="$(grep -oP '"version"\s*:\s*"\K[^"]+' "$DIR/package.json" 2>/dev/null | head -1)"
[ -z "$DAP_VERSION" ] && DAP_VERSION="unknown"

echo "============================================================"
echo " 🏗️ Debian Advantage Panel - Build do Container"
echo "============================================================"
echo ""

echo "🔍 Verificando dependências..."

# ============================================================
# DETECÇÃO DO WEBKITGTK 4.1 (GTK3)
# ============================================================
#
# No Debian, este é o único pacote de WebKitGTK baseado em GTK3
# disponível nos repositórios estáveis — o antigo webkit2gtk-4.0
# (API GTK3 legada) não existe mais desde o Debian 12 (Bookworm).
# O Debian 12+ também tem o webkitgtk-6.0 (base GTK4), mas este
# programa é escrito para GTK3 e não compila contra o 6.0 sem
# uma reescrita (APIs diferentes).
#
# Detecção: basta checar se o pkg-config enxerga webkit2gtk-4.1
# e gtk+-3.0. Se não enxergar, falta o pacote de desenvolvimento.

if ! pkg-config --exists webkit2gtk-4.1 gtk+-3.0 2>/dev/null; then
    echo "❌ WebKitGTK 4.1 (base GTK3) não encontrado!"
    echo ""
    echo " Este programa precisa do pacote libwebkit2gtk-4.1-dev e"
    echo " do libgtk-3-dev para compilar o container nativo."
    echo ""
    echo " Instale com:"
    echo ""
    echo "     sudo apt update"
    echo "     sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev"
    echo ""
    echo " Se o comando acima disser que os pacotes não foram"
    echo " encontrados, verifique se os repositórios main estão"
    echo " habilitados em /etc/apt/sources.list (ou nos arquivos em"
    echo " /etc/apt/sources.list.d/)."
    echo ""
    echo " Se os pacotes já estão instalados e mesmo assim isto"
    echo " falha, rode:"
    echo "     pkg-config --list-all | grep -i webkit"
    echo " para conferir se o pkg-config está enxergando o pacote."
    echo ""
    exit 1
fi

echo "✅ WebKitGTK 4.1 detectado"

mkdir -p src

if [ ! -f "src/dap-container.c" ]; then
    echo "❌ Arquivo src/dap-container.c não encontrado!"
    echo ""
    echo " Certifique-se de que o arquivo existe."
    exit 1
fi

echo ""
echo "📦 Compilando container com WebKitGTK-4.1..."

# Compila passando a versão do DAP como macro C (-DDAP_VERSION=...).
# O .c tem um #ifndef que cai em "unknown" se a macro não for
# passada.
if gcc -Wall -O2 \
    -DDAP_VERSION="\"$DAP_VERSION\"" \
    $(pkg-config --cflags webkit2gtk-4.1 gtk+-3.0) \
    -o dap-container src/dap-container.c \
    $(pkg-config --libs webkit2gtk-4.1 gtk+-3.0) -lm; then
    echo ""
    echo "============================================================"
    echo " ✅ Container compilado com sucesso!"
    echo "============================================================"
    echo ""
    echo "📁 Arquivo: $DIR/dap-container"
    echo "📦 Tamanho: $(du -h dap-container | cut -f1)"
    echo "🔧 WebKitGTK: 4.1"
    echo "🏷️ Versão do DAP: $DAP_VERSION"
    echo ""
    echo "Para executar:"
    echo " ./dap-container"
    echo ""
    echo "Com opções:"
    echo " ./dap-container --url http://localhost:3000 --icon icone_app.png"
    echo ""
    echo "Para instalar no sistema:"
    echo " sudo make install"
    echo ""
else
    echo "❌ Falha na compilação"
    exit 1
fi
