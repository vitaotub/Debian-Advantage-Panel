# ============================================================
# Debian Advantage Panel (DAP) - Makefile
# Versão lida dinamicamente do package.json (alvo: make version)
# ============================================================

PREFIX ?= /usr/local
BINDIR = $(PREFIX)/bin
ICONDIR = $(PREFIX)/share/icons/hicolor/256x256/apps

CC = gcc
CFLAGS = -Wall -O2
LDFLAGS = -lm

# ============================================================
# VERSÃO DO DAP — fonte única: package.json
# ============================================================
#
# Definida ANTES de ser usada em CPPFLAGS. Isto é obrigatório:
# se CPPFLAGS += for processado antes desta definição, o Make
# adia a expansão para o momento do build e funciona por
# acidente — mas quebra silenciosamente se alguém trocar o
# operador (:=, =) ou a ordem. Manter esta ordem.
#
# Formato esperado da versão: MAJOR.MINOR-DDMMYYYY
# Exemplo: 0.1-10072026
#
# Mesmo `grep -oP` dos outros scripts (install.sh, iniciar_dap.sh,
# build-container.sh). Fallback "unknown" garante que o build
# continua mesmo sem o package.json.
DAP_VERSION := $(shell grep -oP '"version"\s*:\s*"\K[^"]+' package.json 2>/dev/null | head -1)
ifeq ($(DAP_VERSION),)
DAP_VERSION := unknown
endif

# Macro com a versão — passada ao gcc como string literal.
# A sintaxe '"..."' (single quote fora, double dentro) é
# necessária para o Make passar as aspas literais ao gcc.
CPPFLAGS += -DDAP_VERSION='"$(DAP_VERSION)"'

# Detecção de WebKitGTK 4.1 (base GTK3). No Debian 12+ este é o
# único pacote de WebKitGTK baseado em GTK3 disponível — o antigo
# webkit2gtk-4.0 foi removido do Bookworm. O webkitgtk-6.0 (base
# GTK4) existe, mas o dap-container.c é escrito para GTK3 e não
# compila contra o 6.0 sem reescrita. O build-container.sh segue
# a mesma decisão, para manter os dois caminhos de build
# consistentes.
WEBKIT_PKG := $(shell pkg-config --exists webkit2gtk-4.1 gtk+-3.0 && echo webkit2gtk-4.1)

ifeq ($(WEBKIT_PKG),)
$(error WebKitGTK 4.1 não encontrado. Instale: sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev)
endif

PKG_CFLAGS := $(shell pkg-config --cflags $(WEBKIT_PKG) gtk+-3.0)
PKG_LIBS := $(shell pkg-config --libs $(WEBKIT_PKG) gtk+-3.0)

TARGET = dap-container
SRC = src/dap-container.c

.PHONY: all clean install uninstall run version check-basico

all: $(TARGET)

$(TARGET): $(SRC)
	$(CC) $(CFLAGS) $(CPPFLAGS) $(PKG_CFLAGS) -o $(TARGET) $(SRC) $(PKG_LIBS) $(LDFLAGS)

clean:
	rm -f $(TARGET)

install: $(TARGET)
	install -d $(DESTDIR)$(BINDIR)
	install -m 755 $(TARGET) $(DESTDIR)$(BINDIR)/$(TARGET)
	install -d $(DESTDIR)$(ICONDIR)
	install -m 644 icone_app.png $(DESTDIR)$(ICONDIR)/dap-container.png

uninstall:
	rm -f $(DESTDIR)$(BINDIR)/$(TARGET)
	rm -f $(DESTDIR)$(ICONDIR)/dap-container.png

run: $(TARGET)
	./$(TARGET) --url http://localhost:3000 --icon icone_app.png

version:
	@echo "DAP version: $(DAP_VERSION)"

# ============================================================
# ALVO DE SANIDADE
# ============================================================
#
# Roda os mesmos checks que o install.sh e o build-container.sh
# poderiam rodar, mais validações específicas do formato de
# versionamento do DAP. Útil antes de commitar.

check-basico:
	@echo "==> Checando sintaxe JavaScript..."
	@for f in script.js i18n.js server.js hardware-service.js; do \
		node --check "$$f" && echo "  OK: $$f" || exit 1; \
	done
	@echo "==> Checando sintaxe Bash..."
	@for f in iniciar_dap.sh iniciar_dap_compat.sh install.sh build-container.sh; do \
		bash -n "$$f" && echo "  OK: $$f" || exit 1; \
	done
	@echo "==> Checando JSON dos locales e do mapa de hardware..."
	@for f in locales/*.json hardware_map.json; do \
		node -e "JSON.parse(require('fs').readFileSync('$$f','utf8'))" && echo "  OK: $$f" || exit 1; \
	done
	@echo "==> Validando formato da versão em package.json..."
	@node -e " \
		const v = require('./package.json').version; \
		if (!/^[0-9]+\.[0-9]+-[0-9]{8}$$/.test(v)) { \
			console.error('  ERRO: versão \"' + v + '\" não segue o formato MAJOR.MINOR-DDMMYYYY'); \
			console.error('  Exemplo válido: 0.1-10072026'); \
			process.exit(1); \
		} \
		console.log('  OK: versão \"' + v + '\" segue o formato esperado'); \
	"
	@echo "==> Checando CHANGELOG.md vs package.json..."
	@node -e " \
		const fs = require('fs'); \
		const v = require('./package.json').version; \
		const c = fs.readFileSync('CHANGELOG.md', 'utf8'); \
		const re = new RegExp('^##\\\\s+v?' + v.replace(/[.*+?^\$${}()|[\\]\\\\]/g, '\\\\\$$&') + '\\\\s*\$$', 'm'); \
		if (!re.test(c)) { console.error('  ERRO: seção ## v' + v + ' não encontrada no CHANGELOG.md'); process.exit(1); } \
		console.log('  OK: seção v' + v + ' encontrada no CHANGELOG.md'); \
	"
	@echo ""
	@echo "✅ Todos os checks básicos passaram."
