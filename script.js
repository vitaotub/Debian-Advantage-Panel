/**
 * Debian Advantage Panel (DAP) - Script Compartilhado
 *
 * Este arquivo contém as funções GLOBAIS compartilhadas entre todas as sessões.
 * Cada sessão (*.html) tem seu próprio JS específico que usa estas funções.
 *
 * i18n: strings visíveis ao usuário usam tOr(chave, fallback) — em pt-BR,
 * tOr cai no fallback (texto original), mantendo o comportamento
 * idêntico ao anterior. Em en/es, retorna a string traduzida do JSON.
 *
 * LOG ÚNICO POR SESSÃO: sessões com múltiplos botões compartilham um único
 * logBox. O botão carrega data-logbox="<id-do-log>" para indicar onde
 * escrever. Sessões com 1 botão continuam usando log-<idComando>.
 *
 * LOG EXPANDIDO POR PADRÃO: ao contrário de versões anteriores, o log de
 * cada sessão já nasce expandido. O usuário pode clicar no toggle para
 * recolher (o clique remove a classe 'expandido').
 *
 * VERIFICAÇÃO DE ATUALIZAÇÕES: no boot, o DAP consulta a API do GitHub
 * para saber se há uma versão mais recente publicada. Se houver, um
 * badge "Atualizar" aparece ao lado do número da versão. O clique
 * dispara a atualização direto (POST /executar), sem navegação. Cache
 * de 12h.
 *
 * VERIFICAÇÃO DE FLATPAKS REMOVIDOS: no boot e a cada sessão carregada,
 * o DAP consulta /flatpak-installed e desmarca qualquer comando que
 * tenha sido marcado como executado mas cujo Flatpak não esteja mais
 * instalado (o usuário removeu via GNOME Software, linha de comando,
 * etc.). O botão volta ao estado original para reinstalar.
 *
 * LIMPEZA DE IDs ÓRFÃOS: no boot e a cada sessão carregada, o DAP remove
 * do progresso persistido qualquer idComando que não exista mais no
 * registro SESSOES. Isso evita que renomeações/remoções de sessão
 * deixem IDs "fantasmas" poluindo o .progresso.json para sempre.
 *
 * TEMA: claro/escuro alternável via botão na UI. Padrão do DAP é CLARO
 * (o FAP usava escuro). Persistência em localStorage sob a chave
 * 'dap_tema'.
 */

// ============================================================
// CONSTANTES E CONFIGURAÇÕES
// ============================================================

var API_URL = (function() {
    try {
        var origin = window.location && window.location.origin;
        if (origin && origin !== 'null' && origin.indexOf('file://') !== 0) {
            return origin;
        }
    } catch (e) { /* ignore */ }
    return 'http://localhost:3000';
})();

var STORAGE_KEY = 'dap_progress';

let DAP_VERSION = '';

window.DAP_VERSION_UI18N = '';

async function carregarVersaoServidor() {
    try {
        const response = await fetch(API_URL + '/info');
        if (response.ok) {
            const data = await response.json();
            DAP_VERSION = data.version || DAP_VERSION;
            window.DAP_VERSION_UI18N = DAP_VERSION;
        }
    } catch (e) {
        console.warn('[Versão] Não foi possível consultar /info:', e.message);
    }
    document.querySelectorAll('.dap-version').forEach(function(el) {
        el.textContent = DAP_VERSION || '?';
    });

    if (typeof I18N !== 'undefined' && typeof I18N.aplicarTraducoes === 'function') {
        var badges = document.querySelectorAll('[data-i18n-html="index.badge_versao"]');
        if (badges.length > 0) {
            I18N.aplicarTraducoes();
        }
    }

    // Notifica consumidores (sobre-dap.html) que a versão já está
    // disponível. Substitui o polling de 100ms que existia antes.
    document.dispatchEvent(new CustomEvent('dap-versao-pronta', {
        detail: { versao: DAP_VERSION }
    }));

    console.log('🚀 Debian Advantage Panel v' + (DAP_VERSION || '?') + ' - Script compartilhado carregado!');
}

// ============================================================
// VERIFICAÇÃO DE ATUALIZAÇÕES (GitHub Releases API)
// ============================================================

var GITHUB_REPO = 'vitaotub/Debian-Advantage-Panel';
var ULTIMA_VERIFICACAO_KEY = 'dap_ultima_verificacao';
var VERSAO_REMOTA_KEY = 'dap_versao_remota';
var TTL_VERIFICACAO_MS = 12 * 60 * 60 * 1000; // 12 horas

async function verificarAtualizacoes() {
    var agora = Date.now();
    var ultima = 0;
    try {
        ultima = parseInt(localStorage.getItem(ULTIMA_VERIFICACAO_KEY) || '0', 10) || 0;
    } catch (e) {
        ultima = 0;
    }

    if (agora - ultima < TTL_VERIFICACAO_MS) {
        try {
            var cache = localStorage.getItem(VERSAO_REMOTA_KEY);
            if (cache) return cache;
        } catch (e) { /* ignore */ }
        return null;
    }

    try {
        var resp = await fetch('https://api.github.com/repos/' + GITHUB_REPO + '/releases/latest');
        if (!resp.ok) {
            console.warn('[Atualização] GitHub retornou HTTP', resp.status);
            return null;
        }
        var data = await resp.json();
        var tagRemota = data.tag_name || '';

        try {
            localStorage.setItem(ULTIMA_VERIFICACAO_KEY, String(agora));
            localStorage.setItem(VERSAO_REMOTA_KEY, tagRemota);
        } catch (e) { /* ignore */ }

        return tagRemota;
    } catch (e) {
        console.warn('[Atualização] Não foi possível verificar:', e.message);
        return null;
    }
}

async function verificarAtualizacoesForcado() {
    try {
        var url = 'https://api.github.com/repos/' + GITHUB_REPO +
        '/releases/latest?_=' + Date.now();
        var resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) return null;
        var data = await resp.json();
        var tag = data.tag_name || '';
        try {
            localStorage.setItem(ULTIMA_VERIFICACAO_KEY, String(Date.now()));
            localStorage.setItem(VERSAO_REMOTA_KEY, tag);
        } catch (e) { /* ignore */ }
        return tag;
    } catch (e) {
        return null;
    }
}

function temAtualizacao(versaoLocal, versaoRemota) {
    var local = (versaoLocal || '').replace(/^[vV]/, '').trim();
    var remota = (versaoRemota || '').replace(/^[vV]/, '').trim();
    if (!local || !remota) return false;
    if (local === '?' || remota === '?') return false;
    return remota > local;
}

// ============================================================
// DISPARO DIRETO DA ATUALIZAÇÃO (a partir do badge)
// ============================================================
//
// O badge de "atualização disponível" antes navegava para
// guiado.html?session=sobre-dap. Em alguns casos isso causava uma
// tela preta (race entre dois carregamentos de sessão). Agora o
// clique dispara o `POST /executar` direto, sem navegação.

var _atualizacaoEmAndamento = false;

async function _dispararAtualizacaoDAP() {
    if (_atualizacaoEmAndamento) {
        mostrarToast(
            _t('comum.badge_ja_atualizando', '⏳ Atualização já em andamento...'),
                     'info', 4000
        );
        return;
    }

    var confirmMsg = _t('sessoes.sobre-dap.atualizar_confirmar',
                        '🔄 Deseja atualizar o Debian Advantage Panel para a versão mais recente?\n\n' +
                        'Isso irá baixar e instalar a última versão do GitHub.');
    if (!confirm(confirmMsg)) return;

    _atualizacaoEmAndamento = true;

    mostrarToast(
        _t('comum.badge_atualizando',
           '🔄 Atualizando DAP... Acompanhe o progresso em Sobre o DAP.'),
           'success', 8000
    );

    var es = null;
    var finalizado = false;

    function _finalizar(sucesso) {
        if (finalizado) return;
        finalizado = true;
        _atualizacaoEmAndamento = false;
        if (es) {
            try { es.close(); } catch (e) {}
            es = null;
        }
        if (sucesso === true) {
            mostrarToast(
                _t('sessoes.sobre-dap.atualizar_popup_concluido',
                   '✅ Atualização concluída! Feche e reabra o DAP.').split('\n')[0],
                         'success', 10000
            );
        } else if (sucesso === false) {
            mostrarToast(
                _t('comum.status_falha', '❌ Falha na execução'),
                         'error', 8000
            );
        }
        // sucesso === null → timeout silencioso, sem toast
    }

    try {
        var r = await fetch(API_URL + '/executar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                comando: 'bash <(curl -s https://raw.githubusercontent.com/vitaotub/Debian-Advantage-Panel/main/install.sh) --update',
                                 idComando: 'atualizar-dap'
            })
        });

        if (!r.ok) {
            mostrarToast(
                _tVars('comum.erro_http', '❌ Erro HTTP: {status}', { status: r.status }),
                         'error', 6000
            );
            _finalizar(null);
            return;
        }

        // Conecta ao SSE para saber quando o comando termina.
        es = new EventSource(API_URL + '/stream?id=atualizar-dap');
        es.onmessage = function(event) {
            try {
                var dados = JSON.parse(event.data);
                if (dados.tipo === 'end') {
                    _finalizar(dados.sucesso !== false);
                }
            } catch (e) { /* ignora payload não-JSON */ }
        };
        es.onerror = function() {
            // Se a conexão SSE cair (servidor reiniciando durante o
            // próprio update), libera o flag. Não mostramos toast de
            // erro porque o comando pode ter terminado com sucesso.
            _finalizar(null);
        };

        // Rede de segurança: se em 5min nada aconteceu, destrava.
        setTimeout(function() { _finalizar(null); }, 5 * 60 * 1000);

    } catch (err) {
        mostrarToast(
            _tVars('comum.erro_conexao', '❌ Erro de conexão: {msg}', { msg: err.message }),
                     'error', 6000
        );
        _atualizacaoEmAndamento = false;
    }
}

async function mostrarBadgeSeHouverAtualizacao() {
    var versaoRemota = await verificarAtualizacoes();
    if (!versaoRemota) return;

    var versaoLocal = DAP_VERSION || '?';
    if (!temAtualizacao(versaoLocal, versaoRemota)) return;

    var versaoRemotaFresca = await verificarAtualizacoesForcado();
    if (!versaoRemotaFresca || !temAtualizacao(versaoLocal, versaoRemotaFresca)) {
        try {
            localStorage.removeItem(ULTIMA_VERIFICACAO_KEY);
            localStorage.removeItem(VERSAO_REMOTA_KEY);
        } catch (e) { /* ignore */ }
        console.log('[Atualização] Cache obsoleto invalidado após verificação fresca.');
        return;
    }

    document.querySelectorAll('.dap-version').forEach(function(el) {
        var parent = el.parentElement;
        if (!parent) return;
        if (parent.querySelector('.badge-atualizacao')) return;

        var badgeTxt = _t('comum.atualizacao_disponivel_titulo',
                          'Nova versão disponível! Clique para atualizar.');

        var badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'badge-atualizacao';
        badge.title = badgeTxt;
        badge.setAttribute('aria-label', badgeTxt);
        badge.setAttribute('data-i18n-title', 'comum.atualizacao_disponivel_titulo');
        badge.setAttribute('data-i18n-aria-label', 'comum.atualizacao_disponivel_titulo');

        badge.innerHTML =
        '<svg class="badge-atualizacao-icon" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
        '<polyline points="7 10 12 15 17 10"/>' +
        '<line x1="12" y1="15" x2="12" y2="3"/>' +
        '</svg>';

        badge.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            _dispararAtualizacaoDAP();
        });

        parent.insertBefore(badge, el.nextSibling);
    });

    console.log('⬆️ Atualização disponível: ' + versaoLocal + ' → ' + versaoRemota);
}

// Expõe globalmente para o sobre-dap.html reutilizar a lógica de
// atualização (mesma confirmação + toast + rate-limit).
window._dispararAtualizacaoDAP = _dispararAtualizacaoDAP;

// ============================================================
// i18n HELPER LOCAL
// ============================================================
function _t(chave, fallback) {
    return (typeof tOr === 'function') ? tOr(chave, fallback) : fallback;
}
function _tVars(chave, fallback, vars) {
    return (typeof tOr === 'function') ? tOr(chave, fallback, vars) : fallback;
}

function _textoOriginalTraduzido(btn) {
    if (!btn) return '';
    const chave = btn.getAttribute('data-i18n');
    const fallback = btn.getAttribute('data-texto-original') || btn.textContent || '';
    if (chave) {
        return _t(chave, fallback);
    }
    return fallback;
}

// ============================================================
// TEMA CLARO / ESCURO
// ============================================================
//
// Padrão do DAP é CLARO (o FAP usava escuro). A paleta clara
// combina melhor com a identidade visual do Debian, que é
// predominantemente branca com acento vermelho.

var TEMA_STORAGE_KEY = 'dap_tema';

(function _aplicarTemaInicial() {
    try {
        var salvo = localStorage.getItem(TEMA_STORAGE_KEY) || 'claro';
        document.documentElement.setAttribute('data-tema', salvo === 'escuro' ? 'escuro' : 'claro');
    } catch (e) {
        document.documentElement.setAttribute('data-tema', 'claro');
    }
})();

function _temaAtual() {
    return document.documentElement.getAttribute('data-tema') || 'claro';
}

function _aplicarTema(tema) {
    if (tema !== 'claro' && tema !== 'escuro') tema = 'claro';
    document.documentElement.setAttribute('data-tema', tema);
    try { localStorage.setItem(TEMA_STORAGE_KEY, tema); } catch (e) { /* ignore */ }
    atualizarBotaoTema();
}

function alternarTema() {
    _aplicarTema(_temaAtual() === 'claro' ? 'escuro' : 'claro');
}

function atualizarBotaoTema() {
    var btn = document.getElementById('btn-toggle-tema');
    if (!btn) return;
    var atual = _temaAtual();
    btn.textContent = atual === 'claro' ? '🌙' : '☀️';
    var chave = atual === 'claro' ? 'comum.tema_para_escuro' : 'comum.tema_para_claro';
    var fallback = atual === 'claro' ? 'Mudar para tema escuro' : 'Mudar para tema claro';
    var txt = _t(chave, fallback);
    btn.title = txt;
    btn.setAttribute('aria-label', txt);
}

function criarBotaoTema() {
    var containers = document.querySelectorAll('.tema-toggle-container');
    for (var i = 0; i < containers.length; i++) {
        var c = containers[i];
        if (c.querySelector('.btn-tema')) continue;
        var btn = document.createElement('button');
        btn.className = 'btn-tema';
        btn.id = 'btn-toggle-tema';
        btn.type = 'button';
        btn.addEventListener('click', alternarTema);
        c.appendChild(btn);
    }
    atualizarBotaoTema();
}

// ============================================================
// TOASTS + NOTIFICAÇÕES NATIVAS
// ============================================================

function _garantirContainerToast() {
    var c = document.getElementById('dap-toast-container');
    if (!c) {
        c = document.createElement('div');
        c.id = 'dap-toast-container';
        c.className = 'dap-toast-container';
        document.body.appendChild(c);
    }
    return c;
}

function mostrarToast(mensagem, tipo, duracaoMs) {
    var c = _garantirContainerToast();
    var t = document.createElement('div');
    t.className = 'dap-toast ' + (tipo || 'info');
    t.textContent = mensagem;
    c.appendChild(t);
    setTimeout(function() {
        t.classList.add('removendo');
        setTimeout(function() { t.remove(); }, 300);
    }, duracaoMs || 5000);
}

function notificarNativo(titulo, corpo) {
    if (typeof Notification === 'undefined') return;
    var opts = { body: corpo };
    try {
        if (Notification.permission === 'granted') {
            new Notification(titulo, opts);
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(function(p) {
                if (p === 'granted') {
                    try { new Notification(titulo, opts); } catch (e) {}
                }
            });
        }
    } catch (e) { /* WebKitGTK pode não suportar; ignora */ }
}

// ============================================================
// BARRA DE PROGRESSO GLOBAL
// ============================================================
//
// -1 significa "inválido, recalcular". Qualquer transição de estado
// (marcar/desmarcar) chama _invalidarContadorSessoes().

var _contadorSessoesConcluidas = -1;

function _invalidarContadorSessoes() {
    _contadorSessoesConcluidas = -1;
}

function _atualizarProgressoGlobal() {
    var el = document.getElementById('progresso-global');
    if (!el) return;
    var total = SESSOES_PRINCIPAIS.length;

    if (_contadorSessoesConcluidas < 0) {
        var cont = 0;
        for (var i = 0; i < SESSOES_PRINCIPAIS.length; i++) {
            if (getStatusSessao(SESSOES_PRINCIPAIS[i]) === 'executado') cont++;
        }
        _contadorSessoesConcluidas = cont;
    }

    el.innerHTML = '<span class="numero">' + _contadorSessoesConcluidas + '</span>/' + total;
    el.title = _contadorSessoesConcluidas + ' de ' + total + ' sessões concluídas';
}

// ============================================================
// REGISTRO CENTRAL DE SESSÕES
// ============================================================
//
// A ORDEM DAS ENTRADAS NESTE ARRAY DEFINE:
// - a ordem de exibição das sessões principais (guiado.html)
// - o número "Sessão N" mostrado na UI (numerarSessao)
// - a cor do indicador no topo
//
// Os IDs são SEMÂNTICOS (sem número). Reordenar sessões é mover
// linhas neste array — nada mais precisa mudar.
//
// `flatpakId`: quando presente, indica que o comando instala um app
// Flatpak com esse app-id. Usado por `verificarFlatpaksRemovidos()`
// para detectar remoções externas e restaurar o botão.
//
// ============================================================
// FASE 6 — ONZE SESSÕES REGISTRADAS
// ============================================================
//
// Esta fase entrega as últimas quatro sessões do escopo:
//
//    1. primeiros-passos      — configuração base do Debian
//    2. codecs                — codecs, DVD comercial, fontes MS
//    3. hardware              — drivers AMD, NVIDIA e Intel
//    4. gaming                — launchers, Proton, emuladores
//    5. casa-escritorio       — impressora, compartilhamento, senhas, OCR
//    6. diagnostico           — painel do sistema, saúde, logs
//    7. producao-multimidia   — OBS Studio, câmera virtual, EasyEffects
//    8. virtualizacao         — QEMU/KVM, GNOME Boxes
//    9. ajustes-manutencao    — tunings, APT, GRUB, kernels
//   10. estado-debian         — versão, variante, AppArmor
//   11. sobre-dap             — atualizar/desinstalar/changelog do DAP
//
// Ainda pendentes (fases posteriores):
//
//   - nenhuma — todas as sessões do escopo foram entregues.
//     Sobram apenas refinamentos e a versão 1.0 estável.

var SESSOES = [
    // ============================================================
    // SESSÃO 1 — PRIMEIROS PASSOS
    // ============================================================
    //
    // Configuração base do Debian recém-instalado via Live ISO.
    // Cobre o que a Live ISO não traz por padrão: repositórios
    // non-free/contrib/non-free-firmware, Flatpak + Flathub,
    // backports (kernel/Mesa/firmware), locale PT-BR, hunspell,
    // arquitetura i386 (para Steam).
    //
    // A ordem dos blocos dentro da sessão importa: `apt-update`
    // deve ser o primeiro, senão o `apt install` de qualquer
    // pacote pode falhar com índice desatualizado. Os outros
    // blocos são independentes entre si (o usuário pode rodar na
    // ordem que quiser).
    //
    // Todos os blocos são one-shot (marcados como concluídos após
    // execução) exceto `apt-update`, que é `sempreClicavel` — o
    // usuário precisa poder rodar `apt update` de novo dias depois.
    {
        id: 'primeiros-passos',
        nome: 'Primeiros Passos',
        nomeKey: 'sessoes.primeiros-passos.nome',
        comandos: {
            'apt-update': {
                sempreClicavel: true
            },
            'apt-upgrade': {
                textoConcluido: '✅ Sistema atualizado',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_apt_upgrade'
            },
            'deb822-converter': {
                textoConcluido: '✅ Formato deb822 em uso',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_deb822'
            },
            'non-free-enable': {
                textoConcluido: '✅ Repositórios non-free ativos',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_non_free'
            },
            'flatpak-install': {
                textoConcluido: '✅ Flatpak + Flathub ativos',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_flatpak'
            },
            'backports-enable': {
                textoConcluido: '✅ Backports habilitados',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_backports'
            },
            'kernel-backports': {
                textoConcluido: '✅ Kernel de backports instalado',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_kernel'
            },
            'mesa-backports': {
                textoConcluido: '✅ Mesa de backports instalado',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_mesa'
            },
            'extrepo-install': {
                textoConcluido: '✅ extrepo instalado',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_extrepo'
            },
            'locale-ptbr-packs': {
                textoConcluido: '✅ Tradução instalada',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_locale_packs'
            },
            'locale-ptbr-hunspell': {
                textoConcluido: '✅ Corretor ortográfico instalado',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_locale_hunspell'
            },
            'locale-ptbr-set': {
                textoConcluido: '✅ Localidade configurada',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_locale_set'
            },
            'i386-enable': {
                textoConcluido: '✅ Arquitetura i386 habilitada',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_i386'
            }
        }
    },

// ============================================================
// SESSÃO 2 — APLICATIVOS RECOMENDADOS
// ============================================================
//
// ~45 apps Flatpak em 8 blocos temáticos + Suíte ArtCraft (7
// apps Rust distribuídos como .deb no GitHub) + Ferramentas
// de Acesso Remoto (RustDesk, Remmina, GNOME Connections,
// KRDC). Todos os Flatpaks usam a fila de instalação.
//
// No Debian, o pacote de cada app muda: onde o FAP instalava
// .rpm, o DAP instala .deb. O binário do Steam fica em
// /usr/games/steam (não em /usr/bin/steam como no Fedora).
{
    id: 'aplicativos',
    nome: 'Aplicativos Recomendados',
    nomeKey: 'sessoes.aplicativos.nome',
    comandos: {
        'instalar-onlyoffice': { textoConcluido: '✅ OnlyOffice instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_onlyoffice', flatpakId: 'org.onlyoffice.desktopeditors' },
        'instalar-libreoffice': { textoConcluido: '✅ LibreOffice instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_libreoffice', flatpakId: 'org.libreoffice.LibreOffice' },
        'instalar-obsidian': { textoConcluido: '✅ Obsidian instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_obsidian', flatpakId: 'md.obsidian.Obsidian' },
        'instalar-thunderbird': { textoConcluido: '✅ Thunderbird instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_thunderbird', flatpakId: 'org.mozilla.thunderbird' },
        'instalar-okular': { textoConcluido: '✅ Okular instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_okular', flatpakId: 'org.kde.okular' },
        'instalar-joplin': { textoConcluido: '✅ Joplin instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_joplin', flatpakId: 'net.cozic.joplin_desktop' },
        'instalar-foliate': { textoConcluido: '✅ Foliate instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_foliate', flatpakId: 'com.github.johnfactotum.Foliate' },
        'instalar-haruna': { textoConcluido: '✅ Haruna instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_haruna', flatpakId: 'org.kde.haruna' },
        'instalar-vlc': { textoConcluido: '✅ VLC instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_vlc', flatpakId: 'org.videolan.VLC' },
        'instalar-mpv': { textoConcluido: '✅ MPV instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_mpv', flatpakId: 'io.mpv.Mpv' },
        'instalar-spotify': { textoConcluido: '✅ Spotify instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_spotify', flatpakId: 'com.spotify.Client' },
        'instalar-plex': { textoConcluido: '✅ Plex instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_plex', flatpakId: 'tv.plex.PlexDesktop' },
        'instalar-stremio': { textoConcluido: '✅ Stremio instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_stremio', flatpakId: 'com.stremio.Stremio' },
        'instalar-krita': { textoConcluido: '✅ Krita instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_krita', flatpakId: 'org.kde.krita' },
        'instalar-inkscape': { textoConcluido: '✅ Inkscape instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_inkscape', flatpakId: 'org.inkscape.Inkscape' },
        'instalar-pinta': { textoConcluido: '✅ Pinta instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_pinta', flatpakId: 'com.github.PintaProject.Pinta' },
        'instalar-gimp': { textoConcluido: '✅ GIMP instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_gimp', flatpakId: 'org.gimp.GIMP' },
        'instalar-darktable': { textoConcluido: '✅ Darktable instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_darktable', flatpakId: 'org.darktable.Darktable' },
        'instalar-freecad': { textoConcluido: '✅ FreeCAD instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_freecad', flatpakId: 'org.freecad.FreeCAD' },
        'instalar-librecad': { textoConcluido: '✅ LibreCAD instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_librecad', flatpakId: 'org.librecad.librecad' },
        'instalar-cura': { textoConcluido: '✅ Cura instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_cura', flatpakId: 'com.ultimaker.cura' },
        'instalar-upscayl': { textoConcluido: '✅ Upscayl instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_upscayl', flatpakId: 'org.upscayl.Upscayl' },
        'instalar-xnviewmp': { textoConcluido: '✅ XnView MP instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_xnviewmp', flatpakId: 'com.xnview.XnViewMP' },
        'instalar-affinity': { sempreClicavel: true },
        'instalar-opera': { textoConcluido: '✅ Opera instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_opera', flatpakId: 'com.opera.Opera' },
        'instalar-brave': { textoConcluido: '✅ Brave instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_brave', flatpakId: 'com.brave.Browser' },
        'instalar-zen': { textoConcluido: '✅ Zen Browser instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_zen', flatpakId: 'app.zen_browser.zen' },
        'instalar-edge': { textoConcluido: '✅ Microsoft Edge instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_edge', flatpakId: 'com.microsoft.Edge' },
        'instalar-chromium': { textoConcluido: '✅ Chromium instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_chromium', flatpakId: 'org.chromium.Chromium' },
        'instalar-zoom': { textoConcluido: '✅ Zoom instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_zoom', flatpakId: 'us.zoom.Zoom' },
        'instalar-vivaldi': { textoConcluido: '✅ Vivaldi instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_vivaldi', flatpakId: 'com.vivaldi.Vivaldi' },
        'instalar-discord': { textoConcluido: '✅ Discord instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_discord', flatpakId: 'com.discordapp.Discord' },
        'instalar-telegram': { textoConcluido: '✅ Telegram instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_telegram', flatpakId: 'org.telegram.desktop' },
        'instalar-signal': { textoConcluido: '✅ Signal instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_signal', flatpakId: 'org.signal.Signal' },
        'instalar-kdenlive': { textoConcluido: '✅ Kdenlive instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_kdenlive', flatpakId: 'org.kde.kdenlive' },
        'instalar-shotcut': { textoConcluido: '✅ Shotcut instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_shotcut', flatpakId: 'org.shotcut.Shotcut' },
        'instalar-pitivi': { textoConcluido: '✅ Pitivi instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_pitivi', flatpakId: 'org.pitivi.Pitivi' },
        'instalar-openshot': { textoConcluido: '✅ OpenShot instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_openshot', flatpakId: 'org.openshot.OpenShot' },
        'instalar-avidemux': { textoConcluido: '✅ Avidemux instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_avidemux', flatpakId: 'org.avidemux.Avidemux' },
        'instalar-drift': { textoConcluido: '✅ Drift instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_drift', flatpakId: 'org.cutwire.Drift' },
        'instalar-blender': { textoConcluido: '✅ Blender instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_blender', flatpakId: 'org.blender.Blender' },
        'instalar-ardour': { textoConcluido: '✅ Ardour instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_ardour', flatpakId: 'org.ardour.Ardour' },
        'instalar-lmms': { textoConcluido: '✅ LMMS instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_lmms', flatpakId: 'io.lmms.LMMS' },
        'instalar-audacity': { textoConcluido: '✅ Audacity instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_audacity', flatpakId: 'org.audacityteam.Audacity' },
        'instalar-rustdesk': { textoConcluido: '✅ RustDesk instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_rustdesk', flatpakId: 'com.rustdesk.RustDesk' },
        'instalar-remmina': { textoConcluido: '✅ Remmina instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_remmina' },
        'instalar-gnome-connections': { textoConcluido: '✅ GNOME Connections instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_gnome_connections' },
        'instalar-krdc': { textoConcluido: '✅ KRDC instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_krdc' },
        'instalar-photocraft':  { textoConcluido: '✅ PhotoCraft instalado',  textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_photocraft' },
        'instalar-vectorcraft': { textoConcluido: '✅ VectorCraft instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_vectorcraft' },
        'instalar-filmcraft':   { textoConcluido: '✅ FilmCraft instalado',   textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_filmcraft' },
        'instalar-lightcraft':  { textoConcluido: '✅ LightCraft instalado',  textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_lightcraft' },
        'instalar-printcraft':  { textoConcluido: '✅ PrintCraft instalado',  textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_printcraft' },
        'instalar-effectcraft': { textoConcluido: '✅ EffectCraft instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_effectcraft' },
        'instalar-designcraft': { textoConcluido: '✅ DesignCraft instalado', textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_designcraft' },
        'instalar-rclone-manager': {
            textoConcluido: '✅ Rclone Manager instalado',
            textoConcluidoKey: 'sessoes.aplicativos.texto_concluido_rclone_manager'
        },
        'desfazer-rclone-manager': { sempreClicavel: true }
    }
},

// ============================================================
// SESSÃO 3 — CODECS E COMPATIBILIDADE
// ============================================================
//
// Codecs multimídia essenciais, reprodução de DVDs comerciais
// e fontes Microsoft (com substitutos métricos). O bloco de
// fontconfig customizado (hinting, antialias, rgba) fica na
// mesma sessão, como quarto bloco.
//
// Todos os blocos são one-shot. Nenhum tem botão "Abrir".
// Requer o repositório non-free ativo (Sessão 1) para
// libavcodec-extra e libdvdcss2.
{
    id: 'codecs',
    nome: 'Codecs e Compatibilidade',
    nomeKey: 'sessoes.codecs.nome',
    comandos: {
        'codecs-essenciais': {
            textoConcluido: '✅ Codecs instalados',
            textoConcluidoKey: 'sessoes.codecs.texto_concluido_codecs'
        },
        'extras-dvd': {
            textoConcluido: '✅ Extras instalados',
            textoConcluidoKey: 'sessoes.codecs.texto_concluido_extras'
        },
        'fontes-ms-all': {
            textoConcluido: '✅ Fontes MS instaladas',
            textoConcluidoKey: 'sessoes.codecs.texto_concluido_fontes'
        },
        'fontconfig-tweaks': {
            textoConcluido: '✅ Perfil aplicado',
            textoConcluidoKey: 'sessoes.codecs.texto_concluido_fontconfig'
        }
    }
},

// ============================================================
// SESSÃO 3 — HARDWARE
// ============================================================
//
// Drivers gráficos AMD, NVIDIA e Intel. Cada bloco tem um
// botão de detecção que consulta o endpoint /hardware-scan e
// informa se o driver recomendado já está em uso.
//
// Os IDs das detecções são "sempreClicavel" — o usuário pode
// rodá-las quantas vezes quiser. Os botões de instalação e
// ativação são one-shot (com lixeira ou par install/revert,
// dependendo do caso).
//
// Requer o repositório non-free ativo (Sessão 1) para os
// drivers NVIDIA e Intel non-free.
{
    id: 'hardware',
    nome: 'Hardware',
    nomeKey: 'sessoes.hardware.nome',
    comandos: {
        // --- Detecções (sempre clicáveis) ---
        'amd-detection': { sempreClicavel: true },
        'nvidia-detection': { sempreClicavel: true },
        'intel-detection': { sempreClicavel: true },

        // --- AMD ---
        'vulkan-amd': {
            textoConcluido: '✅ Vulkan instalado',
            textoConcluidoKey: 'sessoes.hardware.texto_concluido_vulkan'
        },
        'vaapi-amd': {
            textoConcluido: '✅ VA-API instalado',
            textoConcluidoKey: 'sessoes.hardware.texto_concluido_vaapi'
        },
        'corectrl-install': {
            textoConcluido: '✅ CoreCtrl instalado',
            textoConcluidoKey: 'sessoes.hardware.texto_concluido_corectrl'
        },
        'lact-install': {
            textoConcluido: '✅ LACT instalado',
            textoConcluidoKey: 'sessoes.hardware.texto_concluido_lact'
        },
        'amdgpu-overclock': {
            textoConcluido: '✅ Overclock ativado',
            textoConcluidoKey: 'sessoes.hardware.texto_concluido_overclock'
        },
        'amdgpu-overclock-remove': {
            sempreClicavel: true,
            textoConcluido: '✅ Overclock desativado',
            textoConcluidoKey: 'sessoes.hardware.texto_concluido_overclock_remove'
        },

        // --- NVIDIA ---
        'nvidia-driver-install': {
            textoConcluido: '✅ Driver NVIDIA instalado',
            textoConcluidoKey: 'sessoes.hardware.texto_concluido_nvidia_driver'
        },
        'nvidia-driver-remove': {
            sempreClicavel: true
        },
        'nvidia-cuda-install': {
            textoConcluido: '✅ CUDA + NVENC instalado',
            textoConcluidoKey: 'sessoes.hardware.texto_concluido_nvidia_cuda'
        },
        'nvidia-modeset-on': { sempreClicavel: true },
        'nvidia-modeset-off': { sempreClicavel: true },

        // --- Intel ---
        'intel-media-install': {
            textoConcluido: '🎬 Intel Media Driver instalado',
            textoConcluidoKey: 'sessoes.hardware.texto_concluido_intel_media'
        }
    }
},

// ============================================================
// SESSÃO 4 — GAMING
// ============================================================
//
// Launchers, compatibilidade (Wine/Proton), desempenho,
// ferramentas avançadas e emuladores. Steam é nativo (via
// non-free, requer i386 habilitado na Sessão 1). O resto é
// via Flatpak ou apt.
//
// NTSYNC NÃO está incluído: o Debian 13 (kernel 6.12) não
// tem o módulo, e o Wine do repositório não o suporta.
// Gamescope Session também fica para v1.5.
{
    id: 'gaming',
    nome: 'Gaming',
    nomeKey: 'sessoes.gaming.nome',
    comandos: {
        // --- Launchers ---
        'steam-install': {
            textoConcluido: '✅ Steam instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_steam'
        },
        'heroic-install': {
            textoConcluido: '✅ Heroic instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_heroic',
            flatpakId: 'com.heroicgameslauncher.hgl'
        },
        'lutris-install': {
            textoConcluido: '✅ Lutris instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_lutris',
            flatpakId: 'net.lutris.Lutris'
        },

        // --- Compatibilidade ---
        'wine-install': {
            textoConcluido: '✅ Wine instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_wine'
        },
        'winetricks-install': {
            textoConcluido: '✅ Winetricks instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_winetricks'
        },
        'bottles-install': {
            textoConcluido: '✅ Bottles instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_bottles',
            flatpakId: 'com.usebottles.bottles'
        },

        // --- Performance ---
        'gamemode-install': {
            textoConcluido: '✅ GameMode ativado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_gamemode'
        },
        'mangohud-install': {
            textoConcluido: '✅ MangoHud instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_mangohud'
        },
        'goverlay-install': {
            textoConcluido: '✅ Goverlay instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_goverlay'
        },
        'gamescope-install': {
            textoConcluido: '✅ Gamescope instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_gamescope'
        },

        // --- Gaming Avançado ---
        'protonup-qt-install': {
            textoConcluido: '✅ ProtonUp-Qt instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_protonup',
            flatpakId: 'net.davidotek.pupgui2'
        },
        'vkbasalt-install': {
            textoConcluido: '✅ vkBasalt instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_vkbasalt'
        },
        'gamemode-presets-apply': {
            textoConcluido: '✅ Presets aplicados',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_gamemode_presets'
        },
        'controller-test-install': {
            textoConcluido: '✅ Ferramenta instalada',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_controller_test'
        },

        // --- Emuladores ---
        'retroarch-install': {
            textoConcluido: '✅ RetroArch instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_retroarch',
            flatpakId: 'org.libretro.RetroArch'
        },
        'dolphin-install': {
            textoConcluido: '✅ Dolphin instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_dolphin',
            flatpakId: 'org.DolphinEmu.dolphin-emu'
        },
        'pcsx2-install': {
            textoConcluido: '✅ PCSX2 instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_pcsx2',
            flatpakId: 'net.pcsx2.PCSX2'
        },
        'rpcs3-install': {
            textoConcluido: '✅ RPCS3 instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_rpcs3',
            flatpakId: 'net.rpcs3.RPCS3'
        },
        'duckstation-install': {
            textoConcluido: '✅ Duckstation instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_duckstation',
            flatpakId: 'org.duckstation.DuckStation'
        }
    }
},

// ============================================================
// SESSÃO 5 — CASA E ESCRITÓRIO
// ============================================================
//
// Impressora, compartilhamento de arquivos, gerenciador de
// senhas e leitura de PDF com OCR. Blocos independentes.
// Todos os apps com GUI (KeePassXC, Okular) têm botão "Abrir"
// dinâmico. Firewall não faz parte do escopo.
{
    id: 'casa-escritorio',
    nome: 'Casa e Escritório',
    nomeKey: 'sessoes.casa-escritorio.nome',
    comandos: {
        'cups-install': {
            textoConcluido: '✅ Impressora configurada',
            textoConcluidoKey: 'sessoes.casa-escritorio.texto_concluido_cups'
        },
        'samba-install': {
            textoConcluido: '✅ Samba instalado',
            textoConcluidoKey: 'sessoes.casa-escritorio.texto_concluido_samba'
        },
        'localsend-install': {
            textoConcluido: '✅ LocalSend instalado',
            textoConcluidoKey: 'sessoes.casa-escritorio.texto_concluido_localsend',
            flatpakId: 'org.localsend.localsend_app'
        },
        'warpinator-install': {
            textoConcluido: '✅ Warpinator instalado',
            textoConcluidoKey: 'sessoes.casa-escritorio.texto_concluido_warpinator',
            flatpakId: 'org.x.Warpinator'
        },
        'keepassxc-install': {
            textoConcluido: '✅ KeePassXC instalado',
            textoConcluidoKey: 'sessoes.casa-escritorio.texto_concluido_keepassxc'
        },
        'okular-tesseract-install': {
            textoConcluido: '✅ PDF+OCR instalado',
            textoConcluidoKey: 'sessoes.casa-escritorio.texto_concluido_okular_tesseract'
        }
    }
},

// ============================================================
// SESSÃO 6 — DIAGNÓSTICO
// ============================================================
//
// Painel do sistema (leitura), lista de partições (leitura),
// saúde do hardware (GSmartControl, CoolerControl) e logs do
// journal agrupados por origem.
//
// Os dois únicos itens instaláveis são GSmartControl e
// CoolerControl — ambos com GUI, ambos com botão "Abrir".
// O CoolerControl não está no repo Debian; o DAP adiciona o
// repositório oficial do projeto.
{
    id: 'diagnostico',
    nome: 'Diagnóstico',
    nomeKey: 'sessoes.diagnostico.nome',
    comandos: {
        'diag-refresh': { sempreClicavel: true },
        'journal-errors-check': { sempreClicavel: true },
        'gsmartcontrol-install': {
            textoConcluido: '✅ GSmartControl instalado',
            textoConcluidoKey: 'sessoes.diagnostico.texto_concluido_gsmartcontrol'
        },
        'coolercontrol-install': {
            textoConcluido: '✅ CoolerControl instalado',
            textoConcluidoKey: 'sessoes.diagnostico.texto_concluido_coolercontrol'
        }
    }
},

// ============================================================
// SESSÃO 7 — PRODUÇÃO MULTIMÍDIA
// ============================================================
//
// OBS Studio (Flatpak) + câmera virtual (via v4l2loopback-dkms
// no Debian) + EasyEffects (Flatpak). Blocos independentes.
// A câmera virtual é um módulo de kernel, não um software —
// então não tem botão "Abrir".
{
    id: 'producao-multimidia',
    nome: 'Produção Multimídia',
    nomeKey: 'sessoes.producao-multimidia.nome',
    comandos: {
        'instalar-obs-studio': {
            textoConcluido: '✅ OBS Studio instalado',
            textoConcluidoKey: 'sessoes.producao-multimidia.texto_concluido_obs',
            flatpakId: 'com.obsproject.Studio'
        },
        'obs-cam': {
            textoConcluido: '✅ Câmera Virtual ativada',
            textoConcluidoKey: 'sessoes.producao-multimidia.texto_concluido_cam'
        },
        'instalar-easyeffects': {
            textoConcluido: '✅ EasyEffects instalado',
            textoConcluidoKey: 'sessoes.producao-multimidia.texto_concluido_easyeffects',
            flatpakId: 'com.github.wwmm.easyeffects'
        }
    }
},

// ============================================================
// SESSÃO 8 — VIRTUALIZAÇÃO
// ============================================================
//
// QEMU/KVM + virt-manager e GNOME Boxes. Ambos com botão
// "Abrir" após instalação. O DAP configura a rede padrão do
// libvirt automaticamente (no Debian é manual).
//
// VirtualBox NÃO faz parte do escopo: não está no repo Debian
// e depender do repo da Oracle adiciona fragilidade.
{
    id: 'virtualizacao',
    nome: 'Virtualização',
    nomeKey: 'sessoes.virtualizacao.nome',
    comandos: {
        'qemu-kvm-install': {
            textoConcluido: '✅ QEMU/KVM instalado',
            textoConcluidoKey: 'sessoes.virtualizacao.texto_concluido_qemu'
        },
        'gnome-boxes-install': {
            textoConcluido: '✅ GNOME Boxes instalado',
            textoConcluidoKey: 'sessoes.virtualizacao.texto_concluido_boxes'
        }
    }
},

// ============================================================
// SESSÃO 9 — AJUSTES E MANUTENÇÃO
// ============================================================
//
// Tunings de performance (vm.max_map_count, vm.swappiness,
// vfs_cache_pressure, TCP BBR), ajustes de áudio (realtime,
// PipeWire quantum), configuração do APT, dual-boot, limpeza,
// kernels e GRUB.
//
// Bloco de locale foi removido — já está em Primeiros Passos.
{
    id: 'ajustes-manutencao',
    nome: 'Ajustes e Manutenção',
    nomeKey: 'sessoes.ajustes-manutencao.nome',
    comandos: {
        // --- Ajustes de desempenho ---
        'vm-max-map-count': { textoConcluido: '✅ Ajuste aplicado', textoConcluidoKey: 'sessoes.ajustes-manutencao.texto_concluido_vm_max_map_count' },
        'vm-max-map-count-remove': { sempreClicavel: true, textoConcluido: '✅ Ajuste revertido', textoConcluidoKey: 'sessoes.ajustes-manutencao.texto_concluido_vm_max_map_count_remove' },
        'vm-swappiness-cache': { textoConcluido: '✅ Ajuste aplicado', textoConcluidoKey: 'sessoes.ajustes-manutencao.texto_concluido_vm_swappiness_cache' },
        'vm-swappiness-cache-remove': { sempreClicavel: true, textoConcluido: '✅ Ajuste revertido', textoConcluidoKey: 'sessoes.ajustes-manutencao.texto_concluido_vm_swappiness_cache_remove' },
        'tcp-bbr': { textoConcluido: '✅ TCP BBR ativado', textoConcluidoKey: 'sessoes.ajustes-manutencao.texto_concluido_tcp_bbr' },
        'tcp-bbr-remove': { sempreClicavel: true, textoConcluido: '✅ TCP BBR desativado', textoConcluidoKey: 'sessoes.ajustes-manutencao.texto_concluido_tcp_bbr_remove' },

        // --- Ajustes de áudio ---
        'realtime-setup': { textoConcluido: '✅ Grupo realtime configurado', textoConcluidoKey: 'sessoes.ajustes-manutencao.texto_concluido_realtime_setup' },
        'realtime-setup-remove': { sempreClicavel: true, textoConcluido: '✅ Grupo realtime removido', textoConcluidoKey: 'sessoes.ajustes-manutencao.texto_concluido_realtime_setup_remove' },
        'pipewire-quantum-low': { textoConcluido: '✅ Baixa latência ativada', textoConcluidoKey: 'sessoes.ajustes-manutencao.texto_concluido_pipewire_quantum' },
        'pipewire-quantum-low-remove': { sempreClicavel: true, textoConcluido: '✅ Latência padrão restaurada', textoConcluidoKey: 'sessoes.ajustes-manutencao.texto_concluido_pipewire_quantum_remove' },

        // --- APT / Dual-boot ---
        'apt-speed': { sempreClicavel: true },
        'dual-boot-time': { sempreClicavel: true },

        // --- Manutenção do Debian ---
        'limpeza-sistema': {
            sempreClicavel: true,
            textoConcluido: '✅ Limpeza concluída',
            textoConcluidoKey: 'sessoes.ajustes-manutencao.texto_concluido_limpeza'
        },
        'listar-kernels': { sempreClicavel: true },
        'remover-kernel': { sempreClicavel: true },
        'grub-aplicar-recomendado': {
            sempreClicavel: true,
            textoConcluido: '✅ Configuração aplicada',
            textoConcluidoKey: 'sessoes.ajustes-manutencao.texto_concluido_grub_aplicar'
        },
        'grub-restaurar-padrao': {
            sempreClicavel: true,
            textoConcluido: '✅ Padrão restaurado',
            textoConcluidoKey: 'sessoes.ajustes-manutencao.texto_concluido_grub_restaurar'
        }
    }
},

// ============================================================
// SESSÃO 10 — ESTADO DO DEBIAN
// ============================================================
//
// Versão do Debian, detecção de variante (Stable/Testing/Sid/
// derivados) e AppArmor (o sistema de controle de acesso
// padrão do Debian, substituindo o SELinux do Fedora).
//
// Tudo é leitura — nenhum botão instala ou altera o sistema.
{
    id: 'estado-debian',
    nome: 'Estado do Debian',
    nomeKey: 'sessoes.estado-debian.nome',
    comandos: {
        'debian-version-check': { sempreClicavel: true },
        'variante-check': { sempreClicavel: true },
        'apparmor-status-check': { sempreClicavel: true },
        'apparmor-profiles-list': { sempreClicavel: true }
    }
},

// ============================================================
// SESSÃO 11 — SOBRE O DAP
// ============================================================
//
// Atualizar, desinstalar e ver o changelog. É a sessão mais
// simples do DAP — não instala nada, não altera o sistema.
// Serve como teste de integração do fluxo completo (botão →
// comando → SSE → gravação de progresso).
{
    id: 'sobre-dap',
    nome: 'Sobre o DAP',
    nomeKey: 'sessoes.sobre-dap.nome',
    comandos: {
        'atualizar-dap': {
            sempreClicavel: true,
            textoConcluido: '✅ DAP atualizado',
            textoConcluidoKey: 'sessoes.sobre-dap.texto_concluido_dap_atualizar'
        },
        'desinstalar-dap': {
            textoConcluido: '✅ DAP desinstalado',
            textoConcluidoKey: 'sessoes.sobre-dap.texto_concluido_dap_desinstalar'
        }
    }
}
];

];var SESSOES = [
    // ============================================================
    // SESSÃO 1 — PRIMEIROS PASSOS
    // ============================================================
    //
    // Configuração base do Debian recém-instalado via Live ISO.
    // Cobre o que a Live ISO não traz por padrão: repositórios
    // non-free/contrib/non-free-firmware, Flatpak + Flathub,
    // backports (kernel/Mesa/firmware), locale PT-BR, hunspell,
    // arquitetura i386 (para Steam).
    //
    // A ordem dos blocos dentro da sessão importa: `apt-update`
    // deve ser o primeiro, senão o `apt install` de qualquer
    // pacote pode falhar com índice desatualizado. Os outros
    // blocos são independentes entre si (o usuário pode rodar na
    // ordem que quiser).
    //
    // Todos os blocos são one-shot (marcados como concluídos após
    // execução) exceto `apt-update`, que é `sempreClicavel` — o
    // usuário precisa poder rodar `apt update` de novo dias depois.
    {
        id: 'primeiros-passos',
        nome: 'Primeiros Passos',
        nomeKey: 'sessoes.primeiros-passos.nome',
        comandos: {
            'apt-update': {
                sempreClicavel: true
            },
            'apt-upgrade': {
                textoConcluido: '✅ Sistema atualizado',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_apt_upgrade'
            },
            'deb822-converter': {
                textoConcluido: '✅ Formato deb822 em uso',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_deb822'
            },
            'non-free-enable': {
                textoConcluido: '✅ Repositórios non-free ativos',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_non_free'
            },
            'flatpak-install': {
                textoConcluido: '✅ Flatpak + Flathub ativos',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_flatpak'
            },
            'backports-enable': {
                textoConcluido: '✅ Backports habilitados',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_backports'
            },
            'kernel-backports': {
                textoConcluido: '✅ Kernel de backports instalado',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_kernel'
            },
            'mesa-backports': {
                textoConcluido: '✅ Mesa de backports instalado',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_mesa'
            },
            'extrepo-install': {
                textoConcluido: '✅ extrepo instalado',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_extrepo'
            },
            'locale-ptbr-packs': {
                textoConcluido: '✅ Tradução instalada',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_locale_packs'
            },
            'locale-ptbr-hunspell': {
                textoConcluido: '✅ Corretor ortográfico instalado',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_locale_hunspell'
            },
            'locale-ptbr-set': {
                textoConcluido: '✅ Localidade configurada',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_locale_set'
            },
            'i386-enable': {
                textoConcluido: '✅ Arquitetura i386 habilitada',
                textoConcluidoKey: 'sessoes.primeiros-passos.texto_concluido_i386'
            }
        }
    },

// ============================================================
// SESSÃO 2 — CODECS E COMPATIBILIDADE
// ============================================================
//
// Codecs multimídia essenciais, reprodução de DVDs comerciais
// e fontes Microsoft (com substitutos métricos). O bloco de
// fontconfig customizado (hinting, antialias, rgba) fica na
// mesma sessão, como quarto bloco.
//
// Todos os blocos são one-shot. Nenhum tem botão "Abrir".
// Requer o repositório non-free ativo (Sessão 1) para
// libavcodec-extra e libdvdcss2.
{
    id: 'codecs',
    nome: 'Codecs e Compatibilidade',
    nomeKey: 'sessoes.codecs.nome',
    comandos: {
        'codecs-essenciais': {
            textoConcluido: '✅ Codecs instalados',
            textoConcluidoKey: 'sessoes.codecs.texto_concluido_codecs'
        },
        'extras-dvd': {
            textoConcluido: '✅ Extras instalados',
            textoConcluidoKey: 'sessoes.codecs.texto_concluido_extras'
        },
        'fontes-ms-all': {
            textoConcluido: '✅ Fontes MS instaladas',
            textoConcluidoKey: 'sessoes.codecs.texto_concluido_fontes'
        },
        'fontconfig-tweaks': {
            textoConcluido: '✅ Perfil aplicado',
            textoConcluidoKey: 'sessoes.codecs.texto_concluido_fontconfig'
        }
    }
},

// ============================================================
// SESSÃO 3 — HARDWARE
// ============================================================
//
// Drivers gráficos AMD, NVIDIA e Intel. Cada bloco tem um
// botão de detecção que consulta o endpoint /hardware-scan e
// informa se o driver recomendado já está em uso.
//
// Os IDs das detecções são "sempreClicavel" — o usuário pode
// rodá-las quantas vezes quiser. Os botões de instalação e
// ativação são one-shot (com lixeira ou par install/revert,
// dependendo do caso).
//
// Requer o repositório non-free ativo (Sessão 1) para os
// drivers NVIDIA e Intel non-free.
{
    id: 'hardware',
    nome: 'Hardware',
    nomeKey: 'sessoes.hardware.nome',
    comandos: {
        // --- Detecções (sempre clicáveis) ---
        'amd-detection': { sempreClicavel: true },
        'nvidia-detection': { sempreClicavel: true },
        'intel-detection': { sempreClicavel: true },

        // --- AMD ---
        'vulkan-amd': {
            textoConcluido: '✅ Vulkan instalado',
            textoConcluidoKey: 'sessoes.hardware.texto_concluido_vulkan'
        },
        'vaapi-amd': {
            textoConcluido: '✅ VA-API instalado',
            textoConcluidoKey: 'sessoes.hardware.texto_concluido_vaapi'
        },
        'corectrl-install': {
            textoConcluido: '✅ CoreCtrl instalado',
            textoConcluidoKey: 'sessoes.hardware.texto_concluido_corectrl'
        },
        'lact-install': {
            textoConcluido: '✅ LACT instalado',
            textoConcluidoKey: 'sessoes.hardware.texto_concluido_lact'
        },
        'amdgpu-overclock': {
            textoConcluido: '✅ Overclock ativado',
            textoConcluidoKey: 'sessoes.hardware.texto_concluido_overclock'
        },
        'amdgpu-overclock-remove': {
            sempreClicavel: true,
            textoConcluido: '✅ Overclock desativado',
            textoConcluidoKey: 'sessoes.hardware.texto_concluido_overclock_remove'
        },

        // --- NVIDIA ---
        'nvidia-driver-install': {
            textoConcluido: '✅ Driver NVIDIA instalado',
            textoConcluidoKey: 'sessoes.hardware.texto_concluido_nvidia_driver'
        },
        'nvidia-driver-remove': {
            sempreClicavel: true
        },
        'nvidia-cuda-install': {
            textoConcluido: '✅ CUDA + NVENC instalado',
            textoConcluidoKey: 'sessoes.hardware.texto_concluido_nvidia_cuda'
        },
        'nvidia-modeset-on': { sempreClicavel: true },
        'nvidia-modeset-off': { sempreClicavel: true },

        // --- Intel ---
        'intel-media-install': {
            textoConcluido: '🎬 Intel Media Driver instalado',
            textoConcluidoKey: 'sessoes.hardware.texto_concluido_intel_media'
        }
    }
},

// ============================================================
// SESSÃO 4 — DISPOSITIVOS E PERIFÉRICOS
// ============================================================
//
// Detecção de hardware (usa o endpoint /hardware-scan, que
// consulta o hardware-service.js), suplementos de firmware,
// driver Broadcom, grupo input e steam-devices.
//
// Todos os comandos são "sempreClicavel" quando fazem sentido
// repetir, ou one-shot com lixeira/par install/revert.
{
    id: 'dispositivos-perifericos',
    nome: 'Dispositivos e Periféricos',
    nomeKey: 'sessoes.dispositivos-perifericos.nome',
    comandos: {
        'hw-scan': { sempreClicavel: true },

        'firmware-vendor-install': {
            textoConcluido: '✅ Firmwares adicionais instalados',
            textoConcluidoKey: 'sessoes.dispositivos-perifericos.texto_concluido_firmware_vendor'
        },
        'firmware-vendor-remove': {
            sempreClicavel: true,
            textoConcluido: '✅ Firmwares revertidos',
            textoConcluidoKey: 'sessoes.dispositivos-perifericos.texto_concluido_firmware_vendor_remove'
        },

        'driver-broadcom-wl-install': {
            textoConcluido: '✅ Pacote instalado',
            textoConcluidoKey: 'sessoes.dispositivos-perifericos.btn_pacote_instalado'
        },
        'driver-broadcom-wl-remove': {
            sempreClicavel: true,
            textoConcluido: '✅ Removido',
            textoConcluidoKey: 'sessoes.dispositivos-perifericos.btn_revertido'
        },

        'input-group-add': {
            textoConcluido: '✅ Adicionado ao grupo input',
            textoConcluidoKey: 'sessoes.dispositivos-perifericos.texto_concluido_input_add'
        },
        'input-group-remove': {
            sempreClicavel: true,
            textoConcluido: '✅ Removido do grupo input',
            textoConcluidoKey: 'sessoes.dispositivos-perifericos.texto_concluido_input_remove'
        },
        'steam-devices-install': {
            textoConcluido: '✅ Steam Devices instalado',
            textoConcluidoKey: 'sessoes.dispositivos-perifericos.texto_concluido_steam_devices'
        },
        'steam-devices-remove': { sempreClicavel: true }
    }
},

// ============================================================
// SESSÃO 5 — GAMING
// ============================================================
//
// Launchers, compatibilidade (Wine/Proton), desempenho,
// ferramentas avançadas e emuladores. Steam é nativo (via
// non-free, requer i386 habilitado na Sessão 1). O resto é
// via Flatpak ou apt.
//
// NTSYNC NÃO está incluído: o Debian 13 (kernel 6.12) não
// tem o módulo, e o Wine do repositório não o suporta.
// Gamescope Session também fica para v1.5.
{
    id: 'gaming',
    nome: 'Gaming',
    nomeKey: 'sessoes.gaming.nome',
    comandos: {
        // --- Launchers ---
        'steam-install': {
            textoConcluido: '✅ Steam instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_steam'
        },
        'heroic-install': {
            textoConcluido: '✅ Heroic instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_heroic',
            flatpakId: 'com.heroicgameslauncher.hgl'
        },
        'lutris-install': {
            textoConcluido: '✅ Lutris instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_lutris',
            flatpakId: 'net.lutris.Lutris'
        },

        // --- Compatibilidade ---
        'wine-install': {
            textoConcluido: '✅ Wine instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_wine'
        },
        'winetricks-install': {
            textoConcluido: '✅ Winetricks instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_winetricks'
        },
        'bottles-install': {
            textoConcluido: '✅ Bottles instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_bottles',
            flatpakId: 'com.usebottles.bottles'
        },

        // --- Performance ---
        'gamemode-install': {
            textoConcluido: '✅ GameMode ativado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_gamemode'
        },
        'mangohud-install': {
            textoConcluido: '✅ MangoHud instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_mangohud'
        },
        'goverlay-install': {
            textoConcluido: '✅ Goverlay instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_goverlay'
        },
        'gamescope-install': {
            textoConcluido: '✅ Gamescope instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_gamescope'
        },

        // --- Gaming Avançado ---
        'protonup-qt-install': {
            textoConcluido: '✅ ProtonUp-Qt instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_protonup',
            flatpakId: 'net.davidotek.pupgui2'
        },
        'vkbasalt-install': {
            textoConcluido: '✅ vkBasalt instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_vkbasalt'
        },
        'gamemode-presets-apply': {
            textoConcluido: '✅ Presets aplicados',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_gamemode_presets'
        },
        'controller-test-install': {
            textoConcluido: '✅ Ferramenta instalada',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_controller_test'
        },

        // --- Emuladores ---
        'retroarch-install': {
            textoConcluido: '✅ RetroArch instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_retroarch',
            flatpakId: 'org.libretro.RetroArch'
        },
        'dolphin-install': {
            textoConcluido: '✅ Dolphin instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_dolphin',
            flatpakId: 'org.DolphinEmu.dolphin-emu'
        },
        'pcsx2-install': {
            textoConcluido: '✅ PCSX2 instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_pcsx2',
            flatpakId: 'net.pcsx2.PCSX2'
        },
        'rpcs3-install': {
            textoConcluido: '✅ RPCS3 instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_rpcs3',
            flatpakId: 'net.rpcs3.RPCS3'
        },
        'duckstation-install': {
            textoConcluido: '✅ Duckstation instalado',
            textoConcluidoKey: 'sessoes.gaming.texto_concluido_duckstation',
            flatpakId: 'org.duckstation.DuckStation'
        }
    }
},

// ============================================================
// SESSÃO 5 — CASA E ESCRITÓRIO
// ============================================================
//
// Impressora, compartilhamento de arquivos, gerenciador de
// senhas e leitura de PDF com OCR. Blocos independentes.
// Todos os apps com GUI (KeePassXC, Okular) têm botão "Abrir"
// dinâmico. Firewall não faz parte do escopo.
{
    id: 'casa-escritorio',
    nome: 'Casa e Escritório',
    nomeKey: 'sessoes.casa-escritorio.nome',
    comandos: {
        'cups-install': {
            textoConcluido: '✅ Impressora configurada',
            textoConcluidoKey: 'sessoes.casa-escritorio.texto_concluido_cups'
        },
        'samba-install': {
            textoConcluido: '✅ Samba instalado',
            textoConcluidoKey: 'sessoes.casa-escritorio.texto_concluido_samba'
        },
        'localsend-install': {
            textoConcluido: '✅ LocalSend instalado',
            textoConcluidoKey: 'sessoes.casa-escritorio.texto_concluido_localsend',
            flatpakId: 'org.localsend.localsend_app'
        },
        'warpinator-install': {
            textoConcluido: '✅ Warpinator instalado',
            textoConcluidoKey: 'sessoes.casa-escritorio.texto_concluido_warpinator',
            flatpakId: 'org.x.Warpinator'
        },
        'keepassxc-install': {
            textoConcluido: '✅ KeePassXC instalado',
            textoConcluidoKey: 'sessoes.casa-escritorio.texto_concluido_keepassxc'
        },
        'okular-tesseract-install': {
            textoConcluido: '✅ PDF+OCR instalado',
            textoConcluidoKey: 'sessoes.casa-escritorio.texto_concluido_okular_tesseract'
        }
    }
},

// ============================================================
// SESSÃO 6 — DIAGNÓSTICO
// ============================================================
//
// Painel do sistema (leitura), lista de partições (leitura),
// saúde do hardware (GSmartControl, CoolerControl) e logs do
// journal agrupados por origem.
//
// Os dois únicos itens instaláveis são GSmartControl e
// CoolerControl — ambos com GUI, ambos com botão "Abrir".
// O CoolerControl não está no repo Debian; o DAP adiciona o
// repositório oficial do projeto.
{
    id: 'diagnostico',
    nome: 'Diagnóstico',
    nomeKey: 'sessoes.diagnostico.nome',
    comandos: {
        'diag-refresh': { sempreClicavel: true },
        'journal-errors-check': { sempreClicavel: true },
        'gsmartcontrol-install': {
            textoConcluido: '✅ GSmartControl instalado',
            textoConcluidoKey: 'sessoes.diagnostico.texto_concluido_gsmartcontrol'
        },
        'coolercontrol-install': {
            textoConcluido: '✅ CoolerControl instalado',
            textoConcluidoKey: 'sessoes.diagnostico.texto_concluido_coolercontrol'
        }
    }
},

// ============================================================
// SESSÃO 7 — SOBRE O DAP
// ============================================================
//
// Atualizar, desinstalar e ver o changelog. É a sessão mais
// simples do DAP — não instala nada, não altera o sistema.
// Serve como teste de integração do fluxo completo (botão →
// comando → SSE → gravação de progresso).
{
    id: 'sobre-dap',
    nome: 'Sobre o DAP',
    nomeKey: 'sessoes.sobre-dap.nome',
    comandos: {
        'atualizar-dap': {
            sempreClicavel: true,
            textoConcluido: '✅ DAP atualizado',
            textoConcluidoKey: 'sessoes.sobre-dap.texto_concluido_dap_atualizar'
        },
        'desinstalar-dap': {
            textoConcluido: '✅ DAP desinstalado',
            textoConcluidoKey: 'sessoes.sobre-dap.texto_concluido_dap_desinstalar'
        }
    }
}
];

var SESSOES_PRINCIPAIS = SESSOES.map(function(s) { return s.id; });

// ============================================================
// CONJUNTO DE IDs VÁLIDOS (para limpeza de órfãos)
// ============================================================
//
// Constrói um Set com todos os idComando atualmente registrados em
// SESSOES. Usado por `_limparIdsOrfaos()` para remover do progresso
// qualquer entrada que não exista mais (sessões renomeadas,
// comandos removidos, etc.).
//
// Memoizado: SESSOES é constante em runtime, então o Set só é
// construído uma vez por carregamento de página.

var _idsValidosCache = null;

function _construirIdsValidos() {
    if (_idsValidosCache) return _idsValidosCache;
    var set = new Set();
    for (var i = 0; i < SESSOES.length; i++) {
        var comandos = SESSOES[i].comandos || {};
        Object.keys(comandos).forEach(function(id) { set.add(id); });
    }
    _idsValidosCache = set;
    return set;
}

function _infoComando(idComando) {
    for (var i = 0; i < SESSOES.length; i++) {
        var comandos = SESSOES[i].comandos;
        if (comandos && comandos[idComando]) return comandos[idComando];
    }
    return null;
}

var SEMPRE_CLICAVEIS = SESSOES.reduce(function(lista, sessao) {
    Object.keys(sessao.comandos || {}).forEach(function(id) {
        if (sessao.comandos[id].sempreClicavel) lista.push(id);
    });
        return lista;
}, []);

// ============================================================
// MAPA idComando → sessaoId
// ============================================================
//
// Permite responder "a qual sessão pertence este comando?" em O(1).
// Usado pelo bloqueio de navegação, para saber se há algum comando
// rodando na sessão atual.
//
// Construído uma única vez, a partir do array SESSOES.

var _mapaComandoParaSessao = (function() {
    var mapa = {};
    for (var i = 0; i < SESSOES.length; i++) {
        var comandos = SESSOES[i].comandos || {};
        var ids = Object.keys(comandos);
        for (var j = 0; j < ids.length; j++) {
            mapa[ids[j]] = SESSOES[i].id;
        }
    }
    return mapa;
})();

function _sessaoDoComando(idComando) {
    return _mapaComandoParaSessao[idComando] || null;
}

// Retorna o id da sessão atual, lendo o DOM. Devolve null se não
// for possível determinar (por exemplo, antes do menu ser criado).
function _sessaoAtualId() {
    var ativa = document.querySelector('.session-menu-item.ativa');
    if (!ativa) return null;
    return ativa.getAttribute('data-sessao');
}

function numerarSessao(sessaoId, container) {
    const index = SESSOES_PRINCIPAIS.indexOf(sessaoId);
    if (index === -1 || !container) return;
    const label = container.querySelector('.sessao-label');
    if (label) label.textContent = _tVars('comum.sessao_label', 'Sessão ' + (index + 1), { n: index + 1 });
}

function nomeDaSessao(sessaoId) {
    const sessao = SESSOES.find(function(s) { return s.id === sessaoId; });
    if (!sessao) return sessaoId;
    if (sessao.nomeKey) {
        return _t(sessao.nomeKey, sessao.nome);
    }
    return sessao.nome;
}

// ============================================================
// LOG ÚNICO POR SESSÃO — helpers
// ============================================================

function _getLogBox(idComando) {
    var btn1 = document.querySelector('[data-comando="' + idComando + '"][data-logbox]');
    if (btn1) {
        var el = document.getElementById(btn1.dataset.logbox);
        if (el) return el;
    }
    var btn2 = document.getElementById('btn-' + idComando);
    if (btn2 && btn2.dataset && btn2.dataset.logbox) {
        var el2 = document.getElementById(btn2.dataset.logbox);
        if (el2) return el2;
    }
    return document.getElementById('log-' + idComando);
}

function _separadorLog(logBox, nomeAcao) {
    if (!logBox) return;
    if (logBox.children.length === 0) return;
    var sep = document.createElement('div');
    sep.className = 'log-line separator';
    sep.textContent = '────── Iniciando: ' + nomeAcao + ' ──────';
    logBox.appendChild(sep);
    logBox.scrollTop = logBox.scrollHeight;
}

// ============================================================
// BLOQUEIO DE SESSÃO DURANTE EXECUÇÃO
// ============================================================

function _bloquearSessao(idComando) {
    var btn = document.getElementById('btn-' + idComando);
    if (!btn) return;
    var sessaoContainer = btn.closest('.sessao-container');
    if (!sessaoContainer) return;

    // Inclui .btn-flatpak-uninstall: os ícones de lixeira também
    // precisam ser bloqueados durante uma execução em andamento.
    var botoes = sessaoContainer.querySelectorAll('.btn-executar, .btn-reverter, .btn-flatpak-uninstall');
    botoes.forEach(function(b) {
        if (b.id === 'btn-' + idComando) return;
        if (b.hasAttribute('data-sessao-bloqueado')) return;
        b.setAttribute('data-was-disabled', b.disabled ? '1' : '0');
        b.setAttribute('data-sessao-bloqueado', '1');
        b.disabled = true;
        b.style.opacity = '0.4';
        b.style.pointerEvents = 'none';
    });
}

function _liberarSessao(idComando) {
    var btn = document.getElementById('btn-' + idComando);
    if (!btn) return;
    var sessaoContainer = btn.closest('.sessao-container');
    if (!sessaoContainer) return;

    var botoes = sessaoContainer.querySelectorAll('[data-sessao-bloqueado="1"]');
    botoes.forEach(function(b) {
        var wasDisabled = b.getAttribute('data-was-disabled') === '1';
        b.removeAttribute('data-sessao-bloqueado');
        b.removeAttribute('data-was-disabled');
        b.disabled = wasDisabled;
        b.style.opacity = '';
        b.style.pointerEvents = '';
    });
}

// ============================================================
// BLOQUEIO ENTRE SESSÕES
// ============================================================
//
// Quando um comando apt/dpkg/backports está rodando em uma sessão, os
// botões de apt/dpkg das outras sessões também precisam ficar
// travados. Sem isso, o usuário pode disparar dois `apt install`
// em sessões diferentes — e o dpkg trava por conflito de lock.
//
// O bloqueio NÃO afeta:
// - Botões de flatpak (a fila cuida deles).
// - Botões "abrir app" (idComando terminando em `-open`).
// - Botões com `flatpakId` no registro (instalam flatpak).
// - Botões com `sempreClicavel: true` (read-only ou reexecutáveis).
//
// Os botões são identificados pelo `data-comando` no HTML. Como
// cada botão é montado dinamicamente pela sessão carregada, o
// bloqueio roda sobre o documento inteiro (não só a sessão atual).

var _comandoAptRodando = null;

// Decide se um idComando deve ser bloqueado durante a execução de
// um comando apt/dpkg em outra sessão.
function _deveBloquearDuranteApt(idComando) {
    // O próprio comando que está rodando nunca é bloqueado.
    if (idComando === _comandoAptRodando) return false;

    var info = _infoComando(idComando);
    if (!info) return false;

    // Flatpak → não bloqueia (a fila cuida).
    if (info.flatpakId) return false;

    // Sempre clicável → não bloqueia (read-only ou reexecutável).
    if (info.sempreClicavel) return false;

    // É um "abrir app" (idComando terminando em `-open`)? Não bloqueia.
    if (idComando.slice(-5) === '-open') return false;

    // Todo o resto é apt/dpkg → bloqueia.
    return true;
}

// Aplica o bloqueio em todos os botões apt/dpkg de todas as
// sessões carregadas (não apenas a atual).
function _bloquearOutrasSessoes(idComandoApt) {
    _comandoAptRodando = idComandoApt;

    var botoes = document.querySelectorAll('.btn-executar[data-comando]');
    botoes.forEach(function(b) {
        var id = b.getAttribute('data-comando');
        if (!id) return;
        if (!_deveBloquearDuranteApt(id)) return;

        // Ignora os que já estão marcados (para não sobrescrever o
        // `data-was-disabled` original).
        if (b.hasAttribute('data-cross-sessao-bloqueado')) return;

        b.setAttribute('data-was-disabled', b.disabled ? '1' : '0');
        b.setAttribute('data-cross-sessao-bloqueado', '1');
        b.disabled = true;
        b.style.opacity = '0.4';
        b.style.pointerEvents = 'none';
    });
}

// Libera todos os botões bloqueados pelo bloqueio entre sessões.
function _liberarOutrasSessoes() {
    _comandoAptRodando = null;

    var botoes = document.querySelectorAll('[data-cross-sessao-bloqueado="1"]');
    botoes.forEach(function(b) {
        var wasDisabled = b.getAttribute('data-was-disabled') === '1';
        b.removeAttribute('data-cross-sessao-bloqueado');
        b.removeAttribute('data-was-disabled');
        b.disabled = wasDisabled;
        b.style.opacity = '';
        b.style.pointerEvents = '';
    });
}

// Re-aplica o bloqueio entre sessões quando uma sessão nova é
// carregada. Isso é necessário porque a navegação entre sessões
// (guiado.html) injeta HTML dinamicamente — os botões das outras
// sessões só existem no DOM depois de a sessão ser carregada.
function _reaplicarBloqueioSeNecessario() {
    if (!_comandoAptRodando) return;

    var botoes = document.querySelectorAll('.btn-executar[data-comando]');
    botoes.forEach(function(b) {
        var id = b.getAttribute('data-comando');
        if (!id) return;
        if (!_deveBloquearDuranteApt(id)) return;
        if (b.hasAttribute('data-cross-sessao-bloqueado')) return;

        b.setAttribute('data-was-disabled', b.disabled ? '1' : '0');
        b.setAttribute('data-cross-sessao-bloqueado', '1');
        b.disabled = true;
        b.style.opacity = '0.4';
        b.style.pointerEvents = 'none';
    });
}

// ============================================================
// BLOQUEIO DE NAVEGAÇÃO ENTRE SESSÕES
// ============================================================
//
// Enquanto houver QUALQUER comando rodando pertencente à sessão
// atualmente visível, o usuário não pode trocar de sessão.
//
// Motivo: as variáveis globais dos scripts inline de cada sessão
// (APPS_FLATPAK, _svgLixeira, instalarFlatpak, etc.) têm os mesmos
// nomes em sessões diferentes. Se o usuário sai da Sessão 6 no meio
// de uma instalação e volta depois, o eval da Sessão 7 (que ele
// visitou no meio) teria sobrescrito essas variáveis — e o botão da
// Sessão 6 passaria a usar o `APPS_FLATPAK` da Sessão 7.
//
// Também evita que o usuário perca o progresso visual de uma fila
// em andamento (o log e a posição na fila ficariam órfãos ao sair).

var _navegacaoBloqueada = false;

// Decide se a navegação deve estar bloqueada. Verdadeiro se
// houver QUALQUER comando rodando pertencente à sessão atual.
function _deveBloquearNavegacao() {
    var sessaoAtual = _sessaoAtualId();
    if (!sessaoAtual) return false;

    // 1. apt/dpkg rodando na sessão atual?
    if (_comandoAptRodando) {
        var sessaoApt = _sessaoDoComando(_comandoAptRodando);
        if (sessaoApt === sessaoAtual) return true;
    }

    // 2. flatpak rodando na sessão atual?
    if (typeof _flatpakRodando !== 'undefined' && _flatpakRodando) {
        var sessaoFp = _sessaoDoComando(_flatpakRodando);
        if (sessaoFp === sessaoAtual) return true;
    }

    // 2b. Há itens da fila pertencentes à sessão atual?
    if (typeof _filaFlatpaks !== 'undefined' && _filaFlatpaks.length > 0) {
        for (var i = 0; i < _filaFlatpaks.length; i++) {
            var sessaoItem = _sessaoDoComando(_filaFlatpaks[i].idComando);
            if (sessaoItem === sessaoAtual) return true;
        }
    }

    // 3. Rede de segurança: barra de progresso visível e NÃO
    //    concluída na sessão atual. Cobre fluxos que não passam
    //    por `executarComandoGenerico`.
    var sessaoContainer = document.querySelector('.sessao-container');
    if (sessaoContainer) {
        var barras = sessaoContainer.querySelectorAll('.progress-container:not(.concluido)');
        for (var j = 0; j < barras.length; j++) {
            var b = barras[j];
            if (b.style.display && b.style.display !== 'none') {
                return true;
            }
        }
    }

    return false;
}

// Aplica ou remove o bloqueio visual da navegação, de acordo
// com o estado atual. Idempotente.
function _atualizarBloqueioNavegacao() {
    var deveBloquear = _deveBloquearNavegacao();

    // Se o estado não mudou, não mexe no DOM.
    if (deveBloquear === _navegacaoBloqueada) return;
    _navegacaoBloqueada = deveBloquear;

    var menuItens = document.querySelectorAll('.session-menu-item');
    var btnAnterior = document.getElementById('btn-anterior');
    var btnProximo = document.getElementById('btn-proximo');

    var titleTexto = _t('comum.navegacao_bloqueada',
                        'Aguarde o término dos comandos desta sessão para trocar de sessão.');

    menuItens.forEach(function(item) {
        if (deveBloquear) {
            item.classList.add('bloqueado');
            item.setAttribute('aria-disabled', 'true');
            item.setAttribute('title', titleTexto);
        } else {
            item.classList.remove('bloqueado');
            item.removeAttribute('aria-disabled');
            // O title original era o nome da sessão — restaura
            var sessaoId = item.dataset.sessao;
            if (sessaoId && typeof nomeDaSessao === 'function') {
                item.setAttribute('title', nomeDaSessao(sessaoId));
            }
        }
    });

    if (btnAnterior && deveBloquear) btnAnterior.disabled = true;
    if (btnProximo && deveBloquear) btnProximo.disabled = true;

    // Quando libera, restaura o estado correto dos botões conforme
    // a posição da sessão atual (o primeiro não tem Anterior, o
    // último não tem Próximo).
    if (!deveBloquear) {
        if (typeof SESSOES_PRINCIPAIS !== 'undefined' && typeof sessaoAtual !== 'undefined') {
            var total = SESSOES_PRINCIPAIS.length;
            if (btnAnterior) btnAnterior.disabled = (sessaoAtual === 0);
            if (btnProximo) btnProximo.disabled = (sessaoAtual === total - 1);
        }
    }
}

// ============================================================
// GERENCIAMENTO DE PROGRESSO
// ============================================================

var progressCache = null;
var progressLoaded = false;
var progressLoading = false;

async function getProgress() {
    if (progressLoaded && progressCache) {
        return progressCache;
    }

    if (progressLoading) {
        await new Promise(resolve => setTimeout(resolve, 200));
        return progressCache || { executados: [], pulados: [] };
    }

    progressLoading = true;

    try {
        const response = await fetch(API_URL + '/progress');
        if (response.ok) {
            const data = await response.json();
            progressCache = {
                executados: data.executados || [],
                pulados: data.pulados || []
            };
            progressLoaded = true;

            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(progressCache));
            } catch (e) { /* ignore */ }

            progressLoading = false;
            return progressCache;
        }
    } catch (e) {
        console.warn('⚠️ Não foi possível conectar ao servidor. Usando localStorage como fallback.');
    }

    try {
        const data = localStorage.getItem(STORAGE_KEY);
        const localData = data ? JSON.parse(data) : { executados: [], pulados: [] };
        progressCache = localData;
        progressLoaded = true;
        progressLoading = false;
        return localData;
    } catch (e) {
        progressLoading = false;
        return { executados: [], pulados: [] };
    }
}

async function saveProgress(progress) {
    progressCache = progress;
    progressLoaded = true;

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch (e) { /* ignore */ }

    try {
        const response = await fetch(API_URL + '/progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                executados: progress.executados || [],
                pulados: progress.pulados || []
            })
        });
        if (!response.ok) {
            throw new Error('Erro ao salvar no servidor');
        }
        console.log('✅ Progresso salvo no servidor');
    } catch (e) {
        console.warn('⚠️ Não foi possível salvar no servidor. Salvando apenas no localStorage.');
    }
}

function getProgressSync() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : { executados: [], pulados: [] };
    } catch (e) {
        return { executados: [], pulados: [] };
    }
}

async function carregarProgressoInicial() {
    const progress = await getProgress();
    console.log('📊 Progresso carregado:', progress.executados.length + ' itens');
    await _limparIdsOrfaos();
    _atualizarProgressoGlobal();
}

// ============================================================
// LIMPEZA DE IDs ÓRFÃOS
// ============================================================
//
// Remove do progresso persistido qualquer idComando que não esteja
// mais registrado em SESSOES. Acontece quando:
// - uma sessão é renomeada
// - um comando é removido
// - uma sessão é excluída por completo
//
// Sem isso, o .progresso.json acumula IDs fantasmas para sempre, e
// o contador global de sessões concluídas passa a mentir.
//
// Chamada em carregarProgressoInicial(), que roda no boot e a cada
// sessão carregada. Se nada foi limpo, é no-op.

async function _limparIdsOrfaos() {
    var validos = _construirIdsValidos();
    var progress = await getProgress();

    var execAntes = progress.executados.length;
    var pulAntes = progress.pulados.length;

    var execNovos = progress.executados.filter(function(id) { return validos.has(id); });
    var pulNovos = progress.pulados.filter(function(id) { return validos.has(id); });

    if (execNovos.length === execAntes && pulNovos.length === pulAntes) {
        return; // nada a fazer
    }

    progress.executados = execNovos;
    progress.pulados = pulNovos;
    await saveProgress(progress);

    console.log('🧹 IDs órfãos removidos: ' +
    (execAntes - execNovos.length) + ' executados, ' +
    (pulAntes - pulNovos.length) + ' pulados');
}

// Usa progressCache quando já populado (evita JSON.parse a cada
// chamada).
function isExecutado(idComando) {
    const progress = progressCache || getProgressSync();
    return progress.executados.includes(idComando);
}

function isPulado(idComando) {
    const progress = progressCache || getProgressSync();
    return progress.pulados.includes(idComando);
}

var SESSAO_COMANDOS = SESSOES.reduce(function(mapa, sessao) {
    mapa[sessao.id] = Object.keys(sessao.comandos || {}).filter(function(id) {
        return !sessao.comandos[id].sempreClicavel;
    });
    return mapa;
}, {});

function getStatusSessao(sessaoId) {
    const comandos = SESSAO_COMANDOS[sessaoId] || [];
    if (comandos.length > 0 && comandos.every(id => isExecutado(id))) {
        return 'executado';
    }
    return 'pendente';
}

async function marcarComoExecutado(idComando) {
    const progress = await getProgress();
    if (!progress.executados.includes(idComando)) {
        progress.executados.push(idComando);
        await saveProgress(progress);
        _invalidarContadorSessoes();
        _atualizarProgressoGlobal();
    }
}

async function marcarComoPulado(idComando) {
    const progress = await getProgress();
    if (!progress.pulados.includes(idComando)) {
        progress.pulados.push(idComando);
        await saveProgress(progress);
        _invalidarContadorSessoes();
        _atualizarProgressoGlobal();
    }
}

async function desmarcarComoExecutado(idComando) {
    const progress = await getProgress();
    progress.executados = progress.executados.filter(id => id !== idComando);
    await saveProgress(progress);
    _invalidarContadorSessoes();
    _atualizarProgressoGlobal();
}

async function desmarcarComoPulado(idComando) {
    const progress = await getProgress();
    progress.pulados = progress.pulados.filter(id => id !== idComando);
    await saveProgress(progress);
    _invalidarContadorSessoes();
    _atualizarProgressoGlobal();
}

// ============================================================
// SINCRONIZAÇÃO DE ESTADO DE FLATPAKS (removidos + instalados)
// ============================================================
//
// Esta função faz DUAS coisas numa única passada:
//
//   1. DESMARCA comandos Flatpak cujo app foi removido por fora.
//   2. MARCA comandos Flatpak cujo app JÁ ESTÁ instalado no
//      sistema, mas o comando não estava marcado como executado.
//
// Unificar evita duas requisições ao mesmo endpoint e resolve o
// bug de throttle compartilhado que existia no FAP.

const FLATPAK_VERIFY_TTL_MS = 30000;
let _ultimaVerificacaoFlatpak = 0;

async function _sincronizarEstadoFlatpaks() {
    var agora = Date.now();
    if (agora - _ultimaVerificacaoFlatpak < FLATPAK_VERIFY_TTL_MS) {
        return;
    }
    _ultimaVerificacaoFlatpak = agora;

    try {
        var r = await fetch(API_URL + '/flatpak-installed', { cache: 'no-store' });
        if (!r.ok) {
            console.warn('[Flatpak] /flatpak-installed retornou HTTP ' + r.status);
            return;
        }
        var data = await r.json();
        var instalados = Array.isArray(data.apps) ? data.apps : [];

        var progress = await getProgress();
        var executados = progress.executados || [];

        var marcados = [];
        var removidos = [];

        for (var i = 0; i < SESSOES.length; i++) {
            var sessao = SESSOES[i];
            var comandos = sessao.comandos || {};
            for (var idComando in comandos) {
                var info = comandos[idComando];
                if (!info.flatpakId) continue;

                var estaMarcado = executados.includes(idComando);
                var estaInstalado = instalados.includes(info.flatpakId);

                if (!estaMarcado && estaInstalado) {
                    marcados.push(idComando);
                } else if (estaMarcado && !estaInstalado) {
                    removidos.push({ id: idComando, appId: info.flatpakId });
                }
            }
        }

        // Etapa 1: marca os que já estão instalados no sistema.
        for (var j = 0; j < marcados.length; j++) {
            console.log('[Flatpak] Já instalado, marcando como executado:', marcados[j]);
            await marcarComoExecutado(marcados[j]);
        }
        for (var k = 0; k < marcados.length; k++) {
            try {
                var idAbrirMarc = (typeof _derivarIdAbrir === 'function')
                ? _derivarIdAbrir(marcados[k])
                : null;
                aplicarEstadoInstalavel(marcados[k], idAbrirMarc);
                _atualizarIconeDesinstalarSeExistir(marcados[k]);
            } catch (e) { /* ignora */ }
        }

        // Etapa 2: desmarca os que foram removidos por fora.
        for (var l = 0; l < removidos.length; l++) {
            var item = removidos[l];
            console.log('[Flatpak] Removido externamente:', item.id, '→', item.appId);
            await desmarcarComoExecutado(item.id);
            try {
                var idAbrirRem = (typeof _derivarIdAbrir === 'function')
                ? _derivarIdAbrir(item.id)
                : null;
                aplicarEstadoInstalavel(item.id, idAbrirRem);
            } catch (e) {
                console.warn('[Flatpak] Erro ao restaurar botão de', item.id, ':', e.message);
            }
        }

        if (marcados.length > 0 || removidos.length > 0) {
            _atualizarProgressoGlobal();
        }
    } catch (e) {
        console.warn('[Flatpak] Falha ao sincronizar estado:', e.message);
    }
}

// Aliases mantidos por compatibilidade.
function verificarFlatpaksRemovidos() {
    return _sincronizarEstadoFlatpaks();
}

function marcarFlatpaksJaInstalados() {
    return _sincronizarEstadoFlatpaks();
}

function _atualizarIconeDesinstalarSeExistir(idComando) {
    if (typeof _atualizarIconeDesinstalar === 'function') {
        try { _atualizarIconeDesinstalar(idComando); } catch (e) { /* ignora */ }
    }
}

// ============================================================
// BARRA DE PROGRESSO
// ============================================================

var progressIntervals = {};
var progressTimeouts = {};
var _inicioExecucao = {};

function iniciarProgresso(idComando) {
    const container = document.getElementById('progress-' + idComando);
    if (!container) return;
    container.style.display = 'block';

    // Remove a marca de "concluído" caso este comando seja
    // reexecutado.
    container.classList.remove('concluido');

    // Bloqueia a navegação imediatamente ao iniciar o comando.
    _atualizarBloqueioNavegacao();

    const fill = document.getElementById('progress-fill-' + idComando);
    const percent = document.getElementById('progress-percent-' + idComando);
    const status = document.getElementById('progress-status-' + idComando);

    if (!fill || !percent || !status) return;

    _inicioExecucao[idComando] = Date.now();

    fill.style.width = '0%';
    fill.className = 'progress-fill';
    percent.textContent = '0%';
    status.textContent = _t('comum.status_iniciando', '⏳ Iniciando...');
    status.className = 'status running';

    let progresso = 0;

    if (progressIntervals[idComando]) {
        clearInterval(progressIntervals[idComando]);
        delete progressIntervals[idComando];
    }

    if (progressTimeouts[idComando]) {
        clearTimeout(progressTimeouts[idComando]);
        delete progressTimeouts[idComando];
    }

    progressTimeouts[idComando] = setTimeout(() => {
        if (progressIntervals[idComando]) {
            console.log('[PROGRESS] Timeout de segurança para: ' + idComando);
            clearInterval(progressIntervals[idComando]);
            delete progressIntervals[idComando];
            completarProgresso(idComando, true);
        }
    }, 1800000);

    // Timer de fallback. Só avança enquanto nenhum evento "progress"
    // real chegou do servidor. O timer não passa de 30% para não
    // "mentir" se o comando travar antes de emitir progresso real.
    progressIntervals[idComando] = setInterval(() => {
        if (progresso < 30) {
            const incremento = Math.max(0.05, (30 - progresso) / 200);
            progresso = Math.min(30, progresso + incremento);
            fill.style.width = progresso + '%';
            percent.textContent = Math.round(progresso) + '%';
            status.textContent = _t('comum.status_executando', '⏳ Executando...');
            status.className = 'status running';
        }
    }, 100);
}

// ============================================================
// CONCLUSÃO REAL DE UM COMANDO
// ============================================================

var _aguardandoConclusao = {};

function aguardarConclusaoReal(idComando, timeoutMs) {
    return new Promise(function(resolve) {
        if (!_aguardandoConclusao[idComando]) _aguardandoConclusao[idComando] = [];

        var resolvido = false;
        var wrappedResolve = function(value) {
            if (resolvido) return;
            resolvido = true;
            resolve(value);
            var esperando = _aguardandoConclusao[idComando];
            if (esperando) {
                var idx = esperando.indexOf(wrappedResolve);
                if (idx !== -1) esperando.splice(idx, 1);
                if (esperando.length === 0) {
                    delete _aguardandoConclusao[idComando];
                }
            }
        };

        _aguardandoConclusao[idComando].push(wrappedResolve);
        setTimeout(function() { wrappedResolve(null); }, timeoutMs || 60000);
    });
}

function _notificarConclusaoReal(idComando, sucesso) {
    const esperando = _aguardandoConclusao[idComando];
    if (!esperando) return;
    const copia = esperando.slice();
    copia.forEach(function(resolve) { resolve(sucesso); });
}

function completarProgresso(idComando, sucesso) {
    const container = document.getElementById('progress-' + idComando);

    const aplicarUI = function() {
        if (container) {
            const fill = document.getElementById('progress-fill-' + idComando);
            const percent = document.getElementById('progress-percent-' + idComando);
            const status = document.getElementById('progress-status-' + idComando);

            if (progressTimeouts[idComando]) {
                clearTimeout(progressTimeouts[idComando]);
                delete progressTimeouts[idComando];
            }

            if (progressIntervals[idComando]) {
                clearInterval(progressIntervals[idComando]);
                delete progressIntervals[idComando];
            }

            if (fill && percent && status) {
                fill.style.width = '100%';
                fill.className = 'progress-fill complete';
                percent.textContent = '100%';

                if (sucesso) {
                    status.textContent = _t('comum.status_concluido', '✅ Concluído!');
                    status.className = 'status success';
                } else {
                    status.textContent = _t('comum.status_falha', '❌ Falha na execução');
                    status.className = 'status error';
                }

                // Marca a barra como "concluída". O bloqueio de
                // navegação ignora barras com esta classe.
                container.classList.add('concluido');

                setTimeout(() => {
                    container.style.display = 'none';
                }, 5000);
            }
        }

        var inicio = _inicioExecucao[idComando];
        if (inicio && (Date.now() - inicio) > 30000) {
            var msg = sucesso
            ? _t('comum.status_concluido', '✅ Tarefa concluída!')
            : _t('comum.status_falha', '❌ Falha na execução');
            mostrarToast(msg, sucesso ? 'success' : 'error', 6000);
            if (sucesso) {
                var tituloNotif = _t('comum.notif_tarefa_concluida_titulo', 'DAP — Tarefa concluída');
                var corpoNotif = _t('comum.notif_tarefa_concluida_corpo', 'A tarefa terminou. Veja o log para detalhes.');
                notificarNativo(tituloNotif, corpoNotif);
            }
        }
        delete _inicioExecucao[idComando];

        restaurarBotaoAposExecucao(idComando, sucesso);
        _notificarConclusaoReal(idComando, sucesso);

        _liberarSessao(idComando);
        // Libera os botões apt/dpkg das outras sessões.
        if (_comandoAptRodando === idComando) {
            _liberarOutrasSessoes();
        }

        // Reavalia o bloqueio de navegação.
        _atualizarBloqueioNavegacao();
    };

    if (sucesso && !SEMPRE_CLICAVEIS.includes(idComando)) {
        marcarComoExecutado(idComando).then(aplicarUI, aplicarUI);
    } else {
        aplicarUI();
    }
}

// ============================================================
// TEXTO CORRETO DOS BOTÕES APÓS EXECUÇÃO
// ============================================================

function getTextoAposExecucao(idComando) {
    const info = _infoComando(idComando);
    if (!info) return _t('comum.btn_concluido', '✅ Concluído');
    if (info.textoConcluidoKey) {
        return _t(info.textoConcluidoKey, info.textoConcluido || '✅ Concluído');
    }
    return info.textoConcluido || _t('comum.btn_concluido', '✅ Concluído');
}

// ============================================================
// RESTAURAR BOTÃO APÓS EXECUÇÃO
// ============================================================

function _corOriginalDoBotao(btn) {
    if (btn.hasAttribute('data-cor-original')) {
        return btn.getAttribute('data-cor-original');
    }
    let cor = btn.style.backgroundColor || '';
    if (!cor) {
        try {
            cor = window.getComputedStyle(btn).backgroundColor || '';
        } catch (e) {
            cor = '';
        }
    }
    btn.setAttribute('data-cor-original', cor);
    return cor;
}

/**
 * Aplica o estado visual de um par install/revert.
 *
 * Regra única:
 * - Se o comando de install está marcado como executado:
 *     install → desabilitado, com texto final ("✅ ...")
 *     revert  → habilitado, clicável
 * - Se o comando de install NÃO está marcado:
 *     install → habilitado, texto original
 *     revert  → DESABILITADO (não há o que reverter)
 */
function aplicarEstadoToggle(idInstall, idRevert) {
    var installBtn = document.getElementById('btn-' + idInstall);
    var revertBtn = document.getElementById('btn-' + idRevert);
    if (!installBtn || !revertBtn) return;

    var installFeito = isExecutado(idInstall);

    var textoOriginalInstall = installBtn.getAttribute('data-texto-original') || installBtn.textContent;
    var textoOriginalRevert = revertBtn.getAttribute('data-texto-original') || revertBtn.textContent;
    var corOriginalInstall = _corOriginalDoBotao(installBtn);

    if (installFeito) {
        installBtn.textContent = getTextoAposExecucao(idInstall);
        installBtn.style.backgroundColor = '#4b5563';
        installBtn.style.cursor = 'default';
        installBtn.disabled = true;
        installBtn.style.opacity = '1';

        revertBtn.textContent = textoOriginalRevert;
        revertBtn.style.backgroundColor = '';
        revertBtn.style.cursor = 'pointer';
        revertBtn.disabled = false;
        revertBtn.style.opacity = '1';
    } else {
        installBtn.textContent = textoOriginalInstall;
        installBtn.style.backgroundColor = corOriginalInstall || '';
        installBtn.style.cursor = 'pointer';
        installBtn.disabled = false;
        installBtn.style.opacity = '1';

        revertBtn.textContent = textoOriginalRevert;
        revertBtn.style.backgroundColor = '';
        revertBtn.style.cursor = 'not-allowed';
        revertBtn.disabled = true;
        revertBtn.style.opacity = '0.5';
    }
}

/**
 * Marca um botão one-shot como concluído, reaplicando o estado
 * persistido do progresso.
 */
function _marcarBotaoConcluido(idComando) {
    var btn = document.getElementById('btn-' + idComando);
    if (!btn) return;
    _corOriginalDoBotao(btn);
    btn.textContent = getTextoAposExecucao(idComando);
    btn.style.backgroundColor = '#4b5563';
    btn.style.cursor = 'default';
    btn.disabled = true;
    btn.style.opacity = '1';
}

function restaurarBotaoAposExecucao(idComando, sucesso) {
    const botoes = obterBotoesPorId(idComando);
    const btnExecutar = botoes.btnExecutar;
    const btnReverter = botoes.btnReverter;

    if (!btnExecutar) return;

    const corOriginal = _corOriginalDoBotao(btnExecutar);

    if (SEMPRE_CLICAVEIS.includes(idComando)) {
        btnExecutar.textContent = _textoOriginalTraduzido(btnExecutar);
        btnExecutar.style.backgroundColor = corOriginal || 'var(--accent, #a80030)';
        btnExecutar.style.cursor = 'pointer';
        btnExecutar.disabled = false;
        btnExecutar.style.opacity = '1';
        return;
    }

    if (sucesso) {
        const textoFinal = getTextoAposExecucao(idComando);
        btnExecutar.textContent = textoFinal;
        btnExecutar.style.backgroundColor = '#4b5563';
        btnExecutar.style.cursor = 'default';
        btnExecutar.disabled = true;
        btnExecutar.style.opacity = '1';

        if (btnReverter) {
            btnReverter.style.display = 'inline-block';
            btnReverter.disabled = false;
        }
    } else {
        btnExecutar.textContent = _textoOriginalTraduzido(btnExecutar);
        btnExecutar.style.backgroundColor = corOriginal || 'var(--accent, #a80030)';
        btnExecutar.style.cursor = 'pointer';
        btnExecutar.disabled = false;
        btnExecutar.style.opacity = '1';
    }
}

// ============================================================
// SSE - LOGS EM TEMPO REAL
// ============================================================

var sseConnections = {};

function toggleTerminalLog(logBoxId) {
    var logBox = document.getElementById(logBoxId);
    if (!logBox) return;
    var toggle = document.getElementById('log-toggle-' + logBoxId);
    if (!toggle) return;
    toggle.classList.toggle('expandido');
    logBox.classList.toggle('expandido');
}

function criarToggleParaLog(logBox, labelKey) {
    if (!logBox) return;

    if (logBox.parentElement && logBox.parentElement.classList.contains('terminal-log-wrapper')) {
        return;
    }

    var wrapper = document.createElement('div');
    wrapper.className = 'terminal-log-wrapper';

    var toggle = document.createElement('div');
    toggle.className = 'terminal-log-toggle';
    toggle.id = 'log-toggle-' + logBox.id;

    var chave = labelKey || 'comum.log_execucao';
    var fallback = (chave === 'comum.log_sessao') ? '📋 Log da Sessão' : '📋 Log de execução';
    var toggleTexto = _t(chave, fallback);

    toggle.innerHTML = '<span class="toggle-arrow">▼</span><span class="toggle-text">' + toggleTexto + '</span>';
    toggle.addEventListener('click', function() {
        toggleTerminalLog(logBox.id);
    });

    logBox.parentNode.insertBefore(wrapper, logBox);
    wrapper.appendChild(toggle);
    wrapper.appendChild(logBox);

    logBox.style.display = 'block';
    requestAnimationFrame(function() {
        toggle.classList.add('expandido');
        logBox.classList.add('expandido');
    });
}

function inicializarLogsDaSessao(root) {
    if (!root) root = document;

    var logs = root.querySelectorAll('.terminal-log');

    logs.forEach(function(logBox) {
        var labelKey = (logBox.id && logBox.id.indexOf('log-sessao-') === 0)
        ? 'comum.log_sessao'
        : 'comum.log_execucao';

        criarToggleParaLog(logBox, labelKey);
    });
}

// ============================================================
// PROGRESSO REAL DE PACOTES
// ============================================================
//
// Recebe eventos do tipo "progress" emitidos pelo server.js.
//
// O FAP usava o parser de [N/M] do DNF para atualizar a barra com
// progresso real. O apt NÃO emite [N/M] — ele emite progresso em
// formato diferente (Reading package lists, Unpacking, Setting up,
// e percentuais em alguns casos).
//
// Por enquanto, `_detectarProgressoPacotes` (no server.js) retorna
// sempre null no DAP, e a barra cai no fallback do timer (que
// existe em ambos os projetos). Um parser real de apt pode ser
// adicionado na Fase 2, quando as sessões com apt install estiverem
// prontas e houver casos reais para testar.

function _atualizarProgressoPacotes(idComando, atual, total) {
    if (!total || total <= 0) return;

    var fill = document.getElementById('progress-fill-' + idComando);
    var percent = document.getElementById('progress-percent-' + idComando);
    var status = document.getElementById('progress-status-' + idComando);

    if (!fill || !percent || !status) return;

    // Reserva 90% da barra para os pacotes; os 10% finais são
    // preenchidos na conclusão real (completarProgresso).
    var fracao = Math.min(atual / total, 1);
    var perc = Math.round(fracao * 90);

    fill.style.width = perc + '%';
    percent.textContent = perc + '%';
    status.textContent = _tVars('comum.status_pacote',
                                'Pacote ' + atual + ' de ' + total,
                                { atual: atual, total: total });
    status.className = 'status running';
}

function conectarSSE(idComando, logBox) {
    if (!logBox) return;

    var labelKey = (logBox.id && logBox.id.indexOf('log-sessao-') === 0)
    ? 'comum.log_sessao'
    : 'comum.log_execucao';

    criarToggleParaLog(logBox, labelKey);

    if (sseConnections[idComando]) {
        sseConnections[idComando].close();
        delete sseConnections[idComando];
    }

    try {
        const eventSource = new EventSource(API_URL + '/stream?id=' + idComando);
        sseConnections[idComando] = eventSource;

        let linhas = logBox.children.length;

        const MAX_LINHAS = 10000;

        eventSource.onmessage = function(event) {
            try {
                const dados = JSON.parse(event.data);

                if (dados.tipo === 'end') {
                    eventSource.close();
                    delete sseConnections[idComando];
                    const sucesso = dados.sucesso !== false;
                    completarProgresso(idComando, sucesso);
                    return;
                }

                if (dados.tipo === 'progress') {
                    _atualizarProgressoPacotes(idComando, dados.pacote_atual, dados.pacote_total);
                    return;
                }

                let mensagem = dados.mensagem
                .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
                .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
                .replace(/\x1b[@-Z\\-_]/g, '')
                .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

                const lines = mensagem.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (line.trim() === '') continue;

                    const lineElement = document.createElement('div');
                    lineElement.className = 'log-line ' + dados.tipo;
                    lineElement.textContent = line;
                    logBox.appendChild(lineElement);
                    linhas++;
                }

                if (linhas > MAX_LINHAS) {
                    const children = logBox.children;
                    const excesso = linhas - MAX_LINHAS;
                    for (let j = 0; j < excesso; j++) {
                        if (children[j]) children[j].remove();
                    }
                }

                logBox.scrollTop = logBox.scrollHeight;

            } catch (e) {
                console.error('[SSE] Erro ao processar mensagem:', e);
            }
        };

        eventSource.onerror = function(event) {
            if (eventSource.readyState === EventSource.CLOSED) {
                console.log('[SSE] Conexão fechada para:', idComando);
            } else {
                console.warn('[SSE] Erro na conexão:', event);
            }
        };

    } catch (e) {
        console.error('[SSE] Erro ao criar conexão:', e);
        const errorLine = document.createElement('div');
        errorLine.className = 'log-line error';
        errorLine.textContent = '❌ Erro ao conectar SSE: ' + e.message;
        logBox.appendChild(errorLine);
        logBox.scrollTop = logBox.scrollHeight;
    }
}

// ============================================================
// DETECÇÃO DE DESKTOP
// ============================================================

var desktopCache = null;
async function detectarDesktopReal() {
    if (desktopCache) return desktopCache;
    try {
        const response = await fetch(API_URL + '/info');
        if (response.ok) {
            const data = await response.json();
            desktopCache = data.desktop || 'UNKNOWN';
            return desktopCache;
        }
    } catch (e) {
        console.warn('[Desktop] Não foi possível consultar /info:', e.message);
    }
    return 'UNKNOWN';
}

// ============================================================
// FUNÇÕES DE BOTÕES
// ============================================================

function obterBotoesPorId(idComando) {
    let btnExecutar = null;

    btnExecutar = document.querySelector('.btn-executar[data-comando="' + idComando + '"]');

    if (!btnExecutar) {
        const allButtons = document.querySelectorAll('.btn-executar');
        for (const btn of allButtons) {
            if (btn.id === 'btn-' + idComando) {
                btnExecutar = btn;
                break;
            }
            const onclick = btn.getAttribute('onclick') || '';
            if (onclick.includes("'" + idComando + "'") ||
                onclick.includes('"' + idComando + '"')) {
                btnExecutar = btn;
            break;
                }
        }
    }

    let btnReverter = null;
    if (btnExecutar && btnExecutar.parentElement) {
        btnReverter = btnExecutar.parentElement.querySelector('.btn-reverter');
    }

    return { btnExecutar, btnReverter };
}

// ============================================================
// FILA DE INSTALAÇÃO DE FLATPAKS
// ============================================================
//
// O `flatpak install` tem um lock global: dois comandos em
// paralelo falham com "Remote flathub already in use". Por isso
// só podemos rodar UM `flatpak install` por vez.
//
// A fila é exclusiva para flatpaks. Comandos apt/dpkg continuam
// com o comportamento normal (travam a sessão inteira e não entram
// nesta fila).

var _filaFlatpaks = [];
var _flatpakRodando = null;

function _flatpakNaFila(idComando) {
    if (_flatpakRodando === idComando) return true;
    for (var i = 0; i < _filaFlatpaks.length; i++) {
        if (_filaFlatpaks[i].idComando === idComando) return true;
    }
    return false;
}

function _marcarBotaoNaFila(idComando, posicao) {
    var btn = document.getElementById('btn-' + idComando);
    if (!btn) return;

    if (!btn.hasAttribute('data-texto-original')) {
        btn.setAttribute('data-texto-original', btn.textContent);
    }

    btn.textContent = '⏳ Na fila (' + posicao + 'º)';
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
}

function _desmarcarBotaoDaFila(idComando) {
    var btn = document.getElementById('btn-' + idComando);
    if (!btn) return;
    var original = btn.getAttribute('data-texto-original') || btn.textContent;
    btn.textContent = original;
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
}

function _reajustarPosicoesDaFila() {
    for (var i = 0; i < _filaFlatpaks.length; i++) {
        _marcarBotaoNaFila(_filaFlatpaks[i].idComando, i + 1);
    }
}

async function _enfileirarFlatpak(idComando, comando, nomeAcao, onSucesso) {
    if (_flatpakNaFila(idComando)) {
        return;
    }

    if (_flatpakRodando === null) {
        _flatpakRodando = idComando;
        _atualizarBloqueioNavegacao();
        await _dispararFlatpak(idComando, comando, nomeAcao, onSucesso);
        return;
    }

    _filaFlatpaks.push({
        idComando: idComando,
        comando: comando,
        nomeAcao: nomeAcao,
        onSucesso: onSucesso
    });
    _marcarBotaoNaFila(idComando, _filaFlatpaks.length);

    _atualizarBloqueioNavegacao();
}

async function _dispararFlatpak(idComando, comando, nomeAcao, onSucesso) {
    await _executarComandoGenericoOriginal(idComando, comando, nomeAcao, null, true);

    var sucesso = await aguardarConclusaoReal(idComando, 1800000);

    if (sucesso && typeof onSucesso === 'function') {
        try {
            onSucesso(idComando);
        } catch (e) {
            console.warn('[flatpak-fila] Erro no onSucesso de ' + idComando + ':', e);
        }
    }

    _flatpakRodando = null;

    if (_filaFlatpaks.length > 0) {
        var proximo = _filaFlatpaks.shift();
        _reajustarPosicoesDaFila();
        _flatpakRodando = proximo.idComando;
        _atualizarBloqueioNavegacao();
        _dispararFlatpak(proximo.idComando, proximo.comando, proximo.nomeAcao, proximo.onSucesso);
    } else {
        _atualizarBloqueioNavegacao();
    }
}

// ============================================================
// EXECUTAR COMANDO GENÉRICO
// ============================================================
async function executarComandoGenerico(idComando, comando, nomeAcao, onSucesso, ehFlatpak) {
    const logBox = _getLogBox(idComando);
    const btn = document.getElementById('btn-' + idComando);

    if (!logBox) return;

    if (isExecutado(idComando) && !SEMPRE_CLICAVEIS.includes(idComando)) {
        alert(_t('comum.ja_executado', 'Este comando já foi executado anteriormente.'));
        return;
    }

    iniciarProgresso(idComando);

    logBox.style.display = 'block';

    _separadorLog(logBox, nomeAcao);

    const header = document.createElement('div');
    header.className = 'log-line info';
    header.textContent = '🚀 ' + nomeAcao + '... (' + new Date().toLocaleTimeString() + ')';
    logBox.appendChild(header);
    logBox.scrollTop = logBox.scrollHeight;

    conectarSSE(idComando, logBox);

    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ ' + nomeAcao + '...';
        btn.style.opacity = '0.6';
    }

    // Flatpaks NÃO bloqueiam a sessão inteira. Comandos apt/dpkg
    // continuam bloqueando toda a sessão atual E as demais sessões
    // (bloqueio entre sessões) para evitar conflitos de lock no dpkg.
    if (!ehFlatpak) {
        _bloquearSessao(idComando);
        _bloquearOutrasSessoes(idComando);
    }

    _atualizarBloqueioNavegacao();

    try {
        const response = await fetch(API_URL + '/executar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comando: comando, idComando: idComando })
        });

        if (!response.ok) {
            const errorLine = document.createElement('div');
            errorLine.className = 'log-line error';
            errorLine.textContent = _tVars('comum.erro_http', '❌ Erro HTTP: ' + response.status, { status: response.status });
            logBox.appendChild(errorLine);
            logBox.scrollTop = logBox.scrollHeight;
            completarProgresso(idComando, false);

            if (btn) {
                btn.disabled = false;
                btn.textContent = _textoOriginalTraduzido(btn) || nomeAcao;
                btn.style.opacity = '1';
            }
            return;
        }

        if (typeof onSucesso === 'function') {
            aguardarConclusaoEEntao(idComando, onSucesso);
        }
    } catch (e) {
        const errorLine = document.createElement('div');
        errorLine.className = 'log-line error';
        errorLine.textContent = _tVars('comum.erro_conexao', '❌ Erro de conexão: ' + e.message, { msg: e.message });
        logBox.appendChild(errorLine);
        logBox.scrollTop = logBox.scrollHeight;
        completarProgresso(idComando, false);

        if (btn) {
            btn.disabled = false;
            btn.textContent = _textoOriginalTraduzido(btn) || nomeAcao;
            btn.style.opacity = '1';
        }
    }
}

// Detecta `flatpak install` e roteia para a fila.
var _executarComandoGenericoOriginal = executarComandoGenerico;
executarComandoGenerico = async function(idComando, comando, nomeAcao, onSucesso, ehFlatpak) {
    var isFlatpak = ehFlatpak || /^\s*flatpak\s+install\b/.test(comando);
    if (isFlatpak) {
        return await _enfileirarFlatpak(idComando, comando, nomeAcao, onSucesso);
    }
    return await _executarComandoGenericoOriginal(idComando, comando, nomeAcao, onSucesso, ehFlatpak);
};

// ============================================================
// DESINSTALAR PACOTE
// ============================================================
async function desinstalarPacote(idComando, comandoRemover, nomeExibicao) {
    if (!isExecutado(idComando)) {
        alert(_tVars('comum.nao_instalado', nomeExibicao + ' não está instalado.', { nome: nomeExibicao }));
        return;
    }

    if (!confirm(_tVars('comum.confirmar_desinstalar', 'Deseja desinstalar o ' + nomeExibicao + '?', { nome: nomeExibicao }))) return;

    const logBox = _getLogBox(idComando);
    const btn = document.getElementById('btn-' + idComando);
    const btnReverter = document.getElementById('btn-reverter-' + idComando);
    const idRevert = idComando + '-revert';

    if (logBox) {
        logBox.style.display = 'block';
        _separadorLog(logBox, '🗑️ Desinstalar ' + nomeExibicao);
        const infoLine = document.createElement('div');
        infoLine.className = 'log-line info';
        infoLine.textContent = '🗑️ Desinstalando ' + nomeExibicao + '...';
        logBox.appendChild(infoLine);
        logBox.scrollTop = logBox.scrollHeight;
    }

    if (btnReverter) {
        btnReverter.disabled = true;
    }

    conectarSSE(idRevert, logBox);

    try {
        await fetch(API_URL + '/executar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comando: comandoRemover, idComando: idRevert })
        });

        const sucesso = await aguardarConclusaoReal(idRevert, 180000);

        if (!sucesso) {
            if (btnReverter) btnReverter.disabled = false;
            if (logBox) {
                const errorLine = document.createElement('div');
                errorLine.className = 'log-line error';
                errorLine.textContent = sucesso === null
                ? _t('comum.erro_timeout_desinstalar', '❌ Tempo esgotado esperando a desinstalação.')
                : _tVars('comum.erro_falha_desinstalar', '❌ Falha ao desinstalar ' + nomeExibicao + '.', { nome: nomeExibicao });
                logBox.appendChild(errorLine);
                logBox.scrollTop = logBox.scrollHeight;
            }
            return;
        }

        desmarcarComoExecutado(idComando);

        if (btn) {
            btn.textContent = _textoOriginalTraduzido(btn) || nomeExibicao;
            btn.style.backgroundColor = _corOriginalDoBotao(btn);
            btn.style.cursor = 'pointer';
            btn.style.opacity = '1';
            btn.disabled = false;
        }

        if (btnReverter) {
            btnReverter.disabled = true;
            btnReverter.style.display = 'none';
        }

        if (logBox) {
            const successLine = document.createElement('div');
            successLine.className = 'log-line success';
            successLine.textContent = _tVars('comum.sucesso_desinstalar', '✅ ' + nomeExibicao + ' desinstalado com sucesso!', { nome: nomeExibicao });
            logBox.appendChild(successLine);
            logBox.scrollTop = logBox.scrollHeight;
        }

    } catch (e) {
        if (btnReverter) {
            btnReverter.disabled = false;
        }
        if (logBox) {
            const errorLine = document.createElement('div');
            errorLine.className = 'log-line error';
            errorLine.textContent = _tVars('comum.erro_desinstalar', '❌ Erro ao desinstalar: ' + e.message, { msg: e.message });
            logBox.appendChild(errorLine);
            logBox.scrollTop = logBox.scrollHeight;
        }
    }
}

// ============================================================
// ABRIR FERRAMENTA EXTERNA
// ============================================================
//
// Ponto ÚNICO de abertura de apps GUI no DAP. Todas as sessões
// devem chamar esta função em vez de montar o comando sozinhas.
//
//   1. `setsid -f` — o app ganha uma SESSÃO PRÓPRIA.
//   2. Redirecionamento `> /tmp/dap-open-<id>.log 2>&1 < /dev/null`.
//   3. `& ` no final do comando original é REMOVIDO.

function abrirFerramentaExterna(comando, idLog, nomeExibicao) {
    var cmdFinal = (comando || '').trim();

    cmdFinal = cmdFinal.replace(/\s*&\s*$/, '').trim();

    if (!/^setsid\s/.test(cmdFinal)) {
        cmdFinal = 'setsid -f ' + cmdFinal;
    }

    if (cmdFinal.indexOf('> /dev/null') === -1 && cmdFinal.indexOf('> /tmp/') === -1) {
        var logFile = '/tmp/dap-open-' + (idLog || 'app') + '.log';
        cmdFinal += ' > ' + logFile + ' 2>&1 < /dev/null';
    }

    fetch(API_URL + '/executar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comando: cmdFinal, idComando: idLog + '-open' })
    });

    var logBox = _getLogBox(idLog);
    if (logBox) {
        logBox.style.display = 'block';
        _separadorLog(logBox, '🚀 Abrir ' + nomeExibicao);
        var infoLine = document.createElement('div');
        infoLine.className = 'log-line success';
        infoLine.textContent = '🚀 ' + nomeExibicao + ' aberto!';
        logBox.appendChild(infoLine);
        logBox.scrollTop = logBox.scrollHeight;
    }
}

// ============================================================
// HELPER GLOBAL — ÍCONE DE REMOVER UNIFICADO
// ============================================================

var APPS_REMOVIVEIS = {};
var DAP_SVG_LIXEIRA = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

function registrarAppRemovivel(idComando, config) {
    APPS_REMOVIVEIS[idComando] = config;
}

function _idRemocaoDe(idComando) {
    return idComando + '-remove';
}

function atualizarIconeRemover(idComando) {
    var btn = document.getElementById('btn-' + idComando);
    if (!btn) return;

    var wrapper = btn.closest('.btn-flatpak-wrapper');
    if (!wrapper) {
        console.warn('[remove-icon] Botão sem wrapper .btn-flatpak-wrapper:', idComando);
        return;
    }

    var info = APPS_REMOVIVEIS[idComando];
    if (!info) {
        console.warn('[remove-icon] App não registrado:', idComando);
        return;
    }

    var nomeExibicao = info.nome || idComando;

    var icone = wrapper.querySelector('.btn-flatpak-uninstall');
    if (!icone) {
        icone = document.createElement('button');
        icone.type = 'button';
        icone.className = 'btn-flatpak-uninstall';
        icone.setAttribute('data-comando-alvo', idComando);
        icone.innerHTML = DAP_SVG_LIXEIRA;
        icone.title = _tVars('comum.desinstalar_app', 'Remover ' + nomeExibicao, { nome: nomeExibicao });
        icone.setAttribute('aria-label', icone.title);

        icone.addEventListener('click', function(e) {
            e.stopPropagation();
            _executarRemocaoApp(this.getAttribute('data-comando-alvo'));
        });

        wrapper.appendChild(icone);
    }

    icone.style.display = '';
}

function esconderIconeRemover(idComando) {
    var btn = document.getElementById('btn-' + idComando);
    if (!btn) return;
    var wrapper = btn.closest('.btn-flatpak-wrapper');
    if (!wrapper) return;
    var icone = wrapper.querySelector('.btn-flatpak-uninstall');
    if (icone) icone.style.display = 'none';
}

// ============================================================
// ESCONDER BOTÃO "ABRIR" APÓS REMOÇÃO
// ============================================================

function esconderBotoesAbrirDe(idInstall) {
    var btn = document.getElementById('btn-' + idInstall);
    if (!btn) return;

    var wrapper = btn.closest('.btn-flatpak-wrapper');
    var container = wrapper ? wrapper.parentElement : btn.parentElement;
    if (!container) return;

    var botoes = container.querySelectorAll('.btn-executar.verde[data-comando^="abrir-"]');
    botoes.forEach(function(b) {
        b.style.display = 'none';
    });
}

// ============================================================
// HELPER GLOBAL — SUBSTITUIÇÃO "INSTALAR" → "ABRIR"
// ============================================================

function aplicarEstadoInstalavel(idInstall, idAbrir, idRemover) {
    var btnInstall = document.getElementById('btn-' + idInstall);
    if (!btnInstall) return;

    var btnAbrir = idAbrir ? document.getElementById('btn-' + idAbrir) : null;
    var instalado = isExecutado(idInstall);

    var corOriginal = _corOriginalDoBotao(btnInstall);
    var textoOriginalInstall = btnInstall.getAttribute('data-texto-original') || btnInstall.textContent;

    if (instalado) {
        if (btnAbrir) {
            var textoAbrir = _textoOriginalTraduzido(btnAbrir);
            btnInstall.textContent = textoAbrir;
            btnInstall.style.backgroundColor = '#10b981';
            btnInstall.style.cursor = 'pointer';
            btnInstall.disabled = false;
            btnInstall.style.opacity = '1';

            var onclickAbrir = btnAbrir.getAttribute('onclick') || '';
            var onclickInstall = btnInstall.getAttribute('data-onclick-install');

            if (!onclickInstall) {
                btnInstall.setAttribute('data-onclick-install', btnInstall.getAttribute('onclick') || '');
            }
            btnInstall.setAttribute('onclick', onclickAbrir);

            btnAbrir.style.display = 'none';

            btnInstall.setAttribute('data-estado', 'instalado-abrir');
        } else {
            btnInstall.textContent = getTextoAposExecucao(idInstall);
            btnInstall.style.backgroundColor = '#4b5563';
            btnInstall.style.cursor = 'default';
            btnInstall.disabled = true;
            btnInstall.style.opacity = '1';
            btnInstall.setAttribute('data-estado', 'instalado-sem-abrir');
        }

        var idRem = idRemover || _idRemocaoDe(idInstall);
        _mostrarLixeira(idInstall, idRem);
    } else {
        btnInstall.textContent = textoOriginalInstall;
        btnInstall.style.backgroundColor = corOriginal || '';
        btnInstall.style.cursor = 'pointer';
        btnInstall.disabled = false;
        btnInstall.style.opacity = '1';

        var onclickInstallSalvo = btnInstall.getAttribute('data-onclick-install');
        if (onclickInstallSalvo !== null) {
            btnInstall.setAttribute('onclick', onclickInstallSalvo);
        }
        btnInstall.removeAttribute('data-estado');

        if (btnAbrir) btnAbrir.style.display = 'none';

        _esconderLixeira(idInstall);
    }
}

function _mostrarLixeira(idInstall, idRemover) {
    var btnInstall = document.getElementById('btn-' + idInstall);
    if (!btnInstall) return;

    var wrapper = btnInstall.closest('.btn-flatpak-wrapper');
    if (!wrapper) return;

    var icone = wrapper.querySelector('.btn-flatpak-uninstall');
    if (!icone) {
        icone = document.createElement('button');
        icone.type = 'button';
        icone.className = 'btn-flatpak-uninstall';
        icone.setAttribute('data-comando-install', idInstall);
        icone.setAttribute('data-comando-remover', idRemover);
        icone.innerHTML = DAP_SVG_LIXEIRA;

        var nomeAcao = (APPS_REMOVIVEIS[idInstall] && APPS_REMOVIVEIS[idInstall].nome) || idInstall;
        icone.title = 'Remover ' + nomeAcao;
        icone.setAttribute('aria-label', icone.title);

        icone.addEventListener('click', function(e) {
            e.stopPropagation();
            _executarRemocaoPeloWrapper(this.getAttribute('data-comando-install'));
        });

        wrapper.appendChild(icone);
    }

    icone.style.display = '';
}

function _esconderLixeira(idInstall) {
    var btnInstall = document.getElementById('btn-' + idInstall);
    if (!btnInstall) return;
    var wrapper = btnInstall.closest('.btn-flatpak-wrapper');
    if (!wrapper) return;
    var icone = wrapper.querySelector('.btn-flatpak-uninstall');
    if (icone) icone.style.display = 'none';
}

function _executarRemocaoPeloWrapper(idInstall) {
    var info = APPS_REMOVIVEIS[idInstall];

    if (info) {
        if (info.modo === 'desfazerTudo') {
            _executarDesfazerTudo(idInstall);
        } else {
            _executarRemocaoApp(idInstall);
        }
        return;
    }

    _executarRemocaoApp(idInstall);
}

// ============================================================
// REMOÇÃO DE APP (LIXEIRA) — FLUXO PRÓPRIO
// ============================================================
//
// IMPORTANTE: este fluxo NÃO usa executarComandoGenerico().
//
// Motivo: executarComandoGenerico faz `_getLogBox(idComando)` e
// retorna cedo se não encontrar o logBox. O id de remoção
// (`<install>-remove` ou `<install>-revert`) é dinâmico — não
// existe como botão no HTML — então _getLogBox(idRemocao) sempre
// retornava null, e a lixeira ficava silenciosa.
//
// Solução: reaproveita o logBox do botão INSTALL.

async function _executarRemocaoApp(idComando) {
    var info = APPS_REMOVIVEIS[idComando];
    if (!info) return;

    if (!isExecutado(idComando)) {
        alert(_tVars('comum.nao_instalado',
                     (info.nome || idComando) + ' não está instalado.',
                     { nome: info.nome || idComando }));
        return;
    }

    var msg = info.confirmMsg || _tVars('comum.confirmar_desinstalar',
                                        'Deseja desinstalar o ' + (info.nome || idComando) + '?',
                                        { nome: info.nome || idComando });
    if (!confirm(msg)) return;

    var comando, idRemocao;
    if (info.tipo === 'flatpak') {
        comando = 'flatpak uninstall -y ' + info.appId;
        idRemocao = idComando + '-revert';
    } else if (info.tipo === 'dnf') {
        // Mantido o nome 'dnf' como identificador de "pacote do sistema"
        // para não quebrar a lógica existente nas sessões. O comando
        // em si é que muda — usa apt purge/autoremove.
        comando = 'sudo apt purge -y ' + info.pacotes.join(' ') + ' && sudo apt autoremove -y';
        idRemocao = _idRemocaoDe(idComando);
    } else if (info.tipo === 'arquivos') {
        comando = info.comandoRemocao;
        idRemocao = _idRemocaoDe(idComando);
    } else {
        console.warn('[remove-icon] tipo inválido:', info.tipo);
        return;
    }

    var logBox = _getLogBox(idComando);
    var btn = document.getElementById('btn-' + idComando);

    if (logBox) {
        logBox.style.display = 'block';
        _separadorLog(logBox, '🗑️ Remover ' + (info.nome || idComando));
        var infoLine = document.createElement('div');
        infoLine.className = 'log-line info';
        infoLine.textContent = '🗑️ Removendo ' + (info.nome || idComando) + '...';
        logBox.appendChild(infoLine);
        logBox.scrollTop = logBox.scrollHeight;
    }

    conectarSSE(idRemocao, logBox);

    _bloquearSessao(idComando);
    _bloquearOutrasSessoes(idComando);
    _atualizarBloqueioNavegacao();

    try {
        var response = await fetch(API_URL + '/executar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comando: comando, idComando: idRemocao })
        });

        if (!response.ok) {
            if (logBox) {
                var errorLine = document.createElement('div');
                errorLine.className = 'log-line error';
                errorLine.textContent = _tVars('comum.erro_http', '❌ Erro HTTP: {status}', { status: response.status });
                logBox.appendChild(errorLine);
                logBox.scrollTop = logBox.scrollHeight;
            }
            _liberarSessao(idComando);
            _liberarOutrasSessoes();
            _atualizarBloqueioNavegacao();
            return;
        }

        var sucesso = await aguardarConclusaoReal(idRemocao, 180000);

        _liberarSessao(idComando);
        _liberarOutrasSessoes();
        _atualizarBloqueioNavegacao();

        if (!sucesso) {
            if (logBox) {
                var errorLine2 = document.createElement('div');
                errorLine2.className = 'log-line error';
                errorLine2.textContent = sucesso === null
                ? _t('comum.erro_timeout_desinstalar', '❌ Tempo esgotado esperando a desinstalação.')
                : _tVars('comum.erro_falha_desinstalar', '❌ Falha ao desinstalar {nome}.', { nome: info.nome || idComando });
                logBox.appendChild(errorLine2);
                logBox.scrollTop = logBox.scrollHeight;
            }
            return;
        }

        await desmarcarComoExecutado(idComando);

        var idAbrir = _derivarIdAbrir(idComando);

        aplicarEstadoInstalavel(idComando, idAbrir, idComando);

        if (logBox) {
            var successLine = document.createElement('div');
            successLine.className = 'log-line success';
            successLine.textContent = _tVars('comum.sucesso_desinstalar', '✅ {nome} desinstalado com sucesso!', { nome: info.nome || idComando });
            logBox.appendChild(successLine);
            logBox.scrollTop = logBox.scrollHeight;
        }
    } catch (e) {
        _liberarSessao(idComando);
        _liberarOutrasSessoes();
        _atualizarBloqueioNavegacao();
        if (logBox) {
            var errorLine3 = document.createElement('div');
            errorLine3.className = 'log-line error';
            errorLine3.textContent = _tVars('comum.erro_desinstalar', '❌ Erro ao desinstalar: {msg}', { msg: e.message });
            logBox.appendChild(errorLine3);
            logBox.scrollTop = logBox.scrollHeight;
        }
    }
}

// ============================================================
// HELPER GLOBAL — "DESFAZER TUDO"
// ============================================================

async function _executarDesfazerTudo(idInstall) {
    var info = APPS_REMOVIVEIS[idInstall];
    if (!info || info.modo !== 'desfazerTudo') return;
    if (!isExecutado(idInstall)) return;

    var nome = info.nome || idInstall;
    var idDesfazer = info.idDesfazer;

    var msg1 = _tVars('comum.desfazer_tudo_confirm1',
                      '⚠️ Remover completamente o ' + nome + '?\n\n' +
                      'Este botão remove TUDO que o DAP instalou:\n' +
                      '• Pacotes do sistema\n' +
                      '• Arquivos de configuração criados\n' +
                      '• Grupos de usuário e serviços\n\n' +
                      'Ação irreversível.',
                      { nome: nome });
    if (!confirm(msg1)) return;

    var msg2 = _tVars('comum.desfazer_tudo_confirm2',
                      '🔄 Última confirmação!\n\n' +
                      'Todos os resquícios do ' + nome + ' serão removidos.\n\n' +
                      'Tem certeza absoluta?',
                      { nome: nome });
    if (!confirm(msg2)) return;

    var nomeAcao = _tVars('comum.btn_desfazer_tudo',
                          '🗑️ Remover completamente o ' + nome,
                          { nome: nome });

    await executarComandoGenerico(idDesfazer, info.comandoDesfazer, nomeAcao,
                                  async function() {
                                      await desmarcarComoExecutado(idInstall);
                                      aplicarEstadoToggle(idInstall, idDesfazer);

                                      esconderBotoesAbrirDe(idInstall);
                                  });
}

function mostrarBotaoDesinstalar(idComando) {
    const btnReverter = document.getElementById('btn-reverter-' + idComando);
    if (btnReverter) {
        btnReverter.disabled = false;
    }
}

async function aguardarConclusaoEEntao(idComando, onSucesso) {
    const sucesso = await aguardarConclusaoReal(idComando, 1800000);
    if (sucesso) {
        onSucesso(idComando);
    }
}

// ============================================================
// SELECTS PERSONALIZADOS
// ============================================================

var selectOutsideClickBound = false;

function bindCustomSelect(triggerId, optionsId, hiddenId, displayId) {
    const trigger = document.getElementById(triggerId);
    const options = document.getElementById(optionsId);
    const hiddenInput = document.getElementById(hiddenId);
    const displayValue = document.getElementById(displayId);

    if (!trigger || !options || !hiddenInput || !displayValue) return;

    if (trigger.dataset.dapSelectBound === '1') return;
    trigger.dataset.dapSelectBound = '1';

    trigger.addEventListener('click', function(e) {
        e.stopPropagation();
        trigger.classList.toggle('open');
        options.classList.toggle('open');
    });

    const optionItems = options.querySelectorAll('li');
    optionItems.forEach(function(li) {
        li.addEventListener('click', function(e) {
            e.stopPropagation();
            const value = this.getAttribute('data-value');
            const text = this.textContent;
            displayValue.textContent = text;
            hiddenInput.value = value;

            optionItems.forEach(function(opt) {
                opt.classList.remove('selected');
            });
            this.classList.add('selected');

            trigger.classList.remove('open');
            options.classList.remove('open');
        });
    });
}

function initCustomSelects() {
    bindCustomSelect('custom-select-trigger', 'custom-select-options', 'select-downloads', 'custom-select-value');

    if (!selectOutsideClickBound) {
        selectOutsideClickBound = true;
        document.addEventListener('click', function(e) {
            document.querySelectorAll('.custom-select').forEach(function(container) {
                if (!container.contains(e.target)) {
                    const t = container.querySelector('.custom-select-trigger');
                    const o = container.querySelector('.custom-select-options');
                    if (t) t.classList.remove('open');
                    if (o) o.classList.remove('open');
                }
            });
        });
    }
}

// ============================================================
// ATALHOS DE TECLADO
// ============================================================

// Ctrl+Enter: dispara o botão que está em foco, se for um .btn-executar
// habilitado.
document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        var foco = document.activeElement;
        if (foco && foco.classList && foco.classList.contains('btn-executar') && !foco.disabled) {
            e.preventDefault();
            foco.click();
        }
    }
});

// ============================================================
// INICIALIZAÇÃO GLOBAL
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
    carregarProgressoInicial();
    setTimeout(initCustomSelects, 300);
    criarBotaoTema();
    _atualizarProgressoGlobal();

    verificarFlatpaksRemovidos();

    try {
        var params = new URLSearchParams(window.location.search);
        var sessaoAlvo = params.get('session');
        if (sessaoAlvo && typeof SESSOES_PRINCIPAIS !== 'undefined' &&
            SESSOES_PRINCIPAIS.indexOf(sessaoAlvo) !== -1) {
            setTimeout(function() {
                if (typeof irParaSessao === 'function') {
                    var idx = SESSOES_PRINCIPAIS.indexOf(sessaoAlvo);
                    if (idx !== -1) irParaSessao(idx);
                }
            }, 500);
            }
    } catch (e) { /* ignore */ }

    if (typeof I18N !== 'undefined' && typeof I18N.criarSeletorIdioma === 'function') {
        setTimeout(function() { I18N.criarSeletorIdioma(); }, 50);
    }

    carregarVersaoServidor().then(function() {
        mostrarBadgeSeHouverAtualizacao();
    });
});

document.addEventListener('sessao-carregada', function() {
    _reaplicarBloqueioSeNecessario();

    marcarFlatpaksJaInstalados();

    setTimeout(initCustomSelects, 200);
    setTimeout(carregarProgressoInicial, 300);
    criarBotaoTema();
    _atualizarProgressoGlobal();

    setTimeout(verificarFlatpaksRemovidos, 500);

    if (typeof I18N !== 'undefined' && typeof I18N.criarSeletorIdioma === 'function') {
        setTimeout(function() { I18N.criarSeletorIdioma(); }, 100);
    }

    setTimeout(_atualizarBloqueioNavegacao, 200);
});

document.addEventListener('todas-sessoes-carregadas', function() {
    setTimeout(initCustomSelects, 300);
    setTimeout(carregarProgressoInicial, 400);
    criarBotaoTema();
    _atualizarProgressoGlobal();

    if (typeof I18N !== 'undefined' && typeof I18N.criarSeletorIdioma === 'function') {
        setTimeout(function() { I18N.criarSeletorIdioma(); }, 100);
    }
});

// ============================================================
// HELPER GLOBAL — DERIVAR IDs DE ABRIR A PARTIR DO INSTALL
// ============================================================
//
// Convenção usada em todo o DAP:
//   'instalar-vlc'         → 'abrir-vlc'
//   'samba-install'        → 'abrir-samba'
//   'okular-tesseract-install' → 'abrir-okular-tesseract'
//
// Se o botão de abrir tiver um id que NÃO segue a convenção,
// mapeie aqui.
var _MAPA_ABRIR_EXCECOES = {
    // instalar-id : abrir-id
    // (vazio por enquanto — a Fase 2 vai preencher se necessário)
};

function _derivarIdAbrir(idInstall) {
    if (_MAPA_ABRIR_EXCECOES[idInstall]) {
        return _MAPA_ABRIR_EXCECOES[idInstall];
    }
    if (idInstall.indexOf('instalar-') === 0) {
        return 'abrir-' + idInstall.substring('instalar-'.length);
    }
    if (idInstall.indexOf('-install') !== -1) {
        return 'abrir-' + idInstall.replace(/-install$/, '');
    }
    return null;
}
