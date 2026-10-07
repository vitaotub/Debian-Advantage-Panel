const http = require('http');
const { exec, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const hardwareService = require('./hardware-service');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const ARQUIVO_PROGRESSO = path.join(__dirname, '.progresso.json');
const ARQUIVO_CHANGELOG = path.join(__dirname, 'CHANGELOG.md');

// ============================================================
// VERSÃO DO DAP — fonte única: package.json
// ============================================================
//
// A versão do DAP é definida em UM lugar só: o campo "version" do
// package.json. O Node resolve `require('./package.json')` relativo
// ao arquivo que faz o require, então funciona independente do CWD
// do processo.
//
// Se por algum motivo o package.json estiver ausente ou corrompido,
// caímos em 'unknown' — o endpoint /info continua respondendo, e o
// botão "Atualizar DAP" mostra o badge de forma conservadora (com
// 'unknown' em vez da versão local, `temAtualizacao()` retorna
// false e nenhum badge aparece). Isso evita falsos positivos.
let DAP_VERSION = 'unknown';
try {
    DAP_VERSION = require('./package.json').version || 'unknown';
} catch (e) {
    console.error('[DAP] Não foi possível ler a versão do package.json:', e.message);
}

const LANGS_SUPORTADOS = ['pt-BR', 'en', 'es'];
const LOCALES_DIR = path.join(__dirname, 'locales');

// ============================================================
// WHITELIST DE COMANDOS SEM AUTENTICAÇÃO
// ============================================================
//
// Comandos que rodam sem pedir senha. Critérios:
// - São read-only (consultas) ou abrem GUIs já instaladas.
// - Não permitem escalação de privilégio nem execução arbitrária.
// - NÃO fazem sentido rodando como root (Flatpak, por exemplo).
//
// NÃO INCLUIR:
// - 'which' / 'test' — qualquer coisa depois do verbo passaria
//   sem auth.
// - 'apt' em qualquer forma — sempre precisa de auth.
// - 'bash <(curl ...)' — executava qualquer URL. Update/uninstall
//   agora exigem autenticação (pkexec/kdesu/sudo -A).
//
// SOBRE O FLATPAK:
// - Flatpak NUNCA deve rodar via kdesu/pkexec/sudo. Rodar como root
//   quebra o session bus (D-BUS), porque o `sudo`/`pkexec` aponta
//   DBUS_SESSION_BUS_ADDRESS para o bus do root, não do usuário.
// - O tratamento especial em `executarComandoComStream` já seta
//   XDG_RUNTIME_DIR e DBUS_SESSION_BUS_ADDRESS corretos.
//
// SOBRE `systemctl --user`:
// - Mesma lógica do Flatpak: é um comando do contexto do USUÁRIO,
//   não do sistema. Rodar via pkexec apontaria XDG_RUNTIME_DIR para
//   /run/user/0 (do root), e o systemctl do usuário não encontraria
//   o bus correto — o comando falharia silenciosamente.
//
// SOBRE `setsid -f`:
// - Todos os botões "Abrir X" usam `setsid -f <comando>` para que o
//   app ganhe uma sessão própria, desacoplada do DAP. Isso resolve
//   o bug em que o app era morto junto quando o usuário fechava o
//   DAP (mesmo PGID).

const COMANDOS_SEM_AUTENTICACAO = [
    'dpkg-query',
'dpkg -l',
'uname -r',
'ls /boot/vmlinuz-*',
'cat /etc/debian_version',
'cat /etc/os-release',
'hostname',
'whoami',
'gtk-launch',
'rclone-manager',
'corectrl',
'lact',
'waydroid status',
'waydroid show-full-ui',
// ============================================================
// `setsid -f` — lançar apps GUI em nova sessão
// ============================================================
'setsid -f gtk-launch',
'setsid -f corectrl',
'setsid -f lact',
'setsid -f rclone-manager',
'setsid -f steam',
'setsid -f waydroid show-full-ui',
'setsid -f keepassxc',
'setsid -f okular',
'setsid -f photocraft',
'setsid -f vectorcraft',
'setsid -f filmcraft',
'setsid -f lightcraft',
'setsid -f printcraft',
'setsid -f effectcraft',
'setsid -f designcraft',
// Flatpak roda como usuário; a autenticação (quando necessária)
// é resolvida pelo Polkit do sistema, não pelo DAP.
'flatpak install',
'flatpak uninstall',
'flatpak update',
'flatpak remote-add',
// systemctl --user roda como usuário (serviço do usuário, não do
// sistema). Mesma lógica do Flatpak: precisa do bus do usuário.
'systemctl --user'
];

// ============================================================
// COMANDOS QUE RODAM NO CONTEXTO DO USUÁRIO
// ============================================================
//
// Estes comandos NÃO devem herdar o env do processo Node (que pode
// ter sido iniciado com variáveis erradas, ou que apontam para o
// diretório de outro usuário). `executarComandoComStream` ajusta
// XDG_RUNTIME_DIR, DBUS_SESSION_BUS_ADDRESS e HOME para esses.

const COMANDOS_USER_CONTEXT = [
    'flatpak',
'systemctl --user',
'pw-metadata',
'pw-cli',
'pactl',
'wpctl'
];

function _precisaEnvUserContext(comando) {
    return COMANDOS_USER_CONTEXT.some(function(cmd) {
        return comando.includes(cmd);
    });
}

// Caracteres de encadeamento de shell que permitem burlar a whitelist.
// Cobre: ; ` | $( ) <( ) >( ) && & (background, não 2>&1) e quebras de linha.
//
// Sem esta validação, um comando como "dpkg-query -W foo; rm -rf ~"
// passaria pelo startsWith("dpkg-query ") e executaria o `rm` sem
// autenticação.
const _CARACTERES_ENCADEAMENTO = /[\n\r;`|]|\$\(|&&|<\(|>\(|(?:^|\s)&(?:\s|$)/;

function _cmdSemAutenticacao(comando) {
    const trimmed = (comando || '').trim();
    if (_CARACTERES_ENCADEAMENTO.test(trimmed)) {
        return false;
    }
    return COMANDOS_SEM_AUTENTICACAO.some(function(cmd) {
        return trimmed === cmd
        || trimmed.startsWith(cmd + ' ')
        || trimmed.startsWith(cmd + '\t');
    });
}

function _filtrarLog(mensagem) {
    if (!mensagem) return mensagem;

    mensagem = mensagem.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    if (mensagem.indexOf('qt.qpa') === -1 &&
        mensagem.indexOf('QDBusError') === -1 &&
        mensagem.indexOf('portal') === -1) {
        return mensagem;
        }
        const linhas = mensagem.split('\n');
    const filtradas = linhas.filter(function(line) {
        if (line.includes('qt.qpa.services: failed to register with host portal')) return false;
        if (line.includes('QDBusError("org.freedesktop.portal.Error.Failed"')) return false;
        if (line.includes('could not register app ID:')) return false;
        return true;
    });
    return filtradas.join('\n');
}

const HOME_DIR_USUARIO = process.env.HOME || ('/home/' + (process.env.USER || 'user'));
const USUARIO_REAL = process.env.USER || process.env.LOGNAME || 'user';

function _substituirCaminhosUsuario(comando) {
    if (!comando) return comando;
    return comando
    .replace(/~\//g, HOME_DIR_USUARIO + '/')
    .replace(/\$HOME\b/g, HOME_DIR_USUARIO)
    .replace(/\$SUDO_USER\b/g, USUARIO_REAL)
    .replace(/\$USER\b/g, USUARIO_REAL);
}

const sseClients = new Map();

// ============================================================
// BUFFER DE REPLAY DO SSE
// ============================================================

const sseBuffers = new Map();
const SSE_BUFFER_MAX = 2000;
const SSE_BUFFER_TTL_MS = 10000;

// ============================================================
// RASTREAMENTO DE PROCESSOS FILHOS
// ============================================================
//
// Todo comando disparado pelo DAP é registrado neste Set. No SIGINT
// (Ctrl+C no terminal), o handler percorre o Set e mata a árvore de
// cada processo — não só o pai direto.
//
// O motivo de precisar matar a árvore: entre o bash que o Node
// criou e o comando real (apt, dpkg, etc.) há camadas (pkexec,
// script root). Matar só o bash deixa o apt órfão.
//
// A solução tem duas partes:
//   1. `detached: true` no spawn/exec — o bash vira líder de sessão
//      e todos os descendentes herdam o mesmo PGID.
//   2. `process.kill(-pid, 'SIGTERM')` no SIGINT — o `-` antes do
//      PID envia o sinal para o grupo inteiro.

const _processosAtivos = new Set();

function _registrarProcesso(proc) {
    _processosAtivos.add(proc);
    proc.on('close', () => _processosAtivos.delete(proc));
    return proc;
}

function _matarArvoreProcessos(proc) {
    if (!proc || !proc.pid) return;

    let grupoMorto = false;
    try {
        process.kill(-proc.pid, 'SIGTERM');
        grupoMorto = true;
    } catch (e) {
        // ESRCH = grupo não existe (o processo já morreu, ou não é líder).
        // EPERM = sem permissão (não deveria acontecer aqui).
    }

    if (!grupoMorto) {
        try { proc.kill('SIGTERM'); } catch (e) {}
    }
}

// ============================================================
// RATE LIMITING
// ============================================================
//
// Impede que um script (XSS ou chamada manual) dispare centenas
// de comandos em loop. Limite: 1 execução por idComando a cada
// 1.5s. Após 60s de inatividade, entradas antigas são removidas
// para não crescer indefinidamente.

const _ultimaExecucao = new Map();
const RATE_LIMIT_MS = 1500;

function _podeExecutar(idComando) {
    var agora = Date.now();
    var ultimo = _ultimaExecucao.get(idComando) || 0;
    if (agora - ultimo < RATE_LIMIT_MS) return false;
    _ultimaExecucao.set(idComando, agora);
    if (_ultimaExecucao.size > 500) {
        for (var [k, v] of _ultimaExecucao) {
            if (agora - v > 60000) _ultimaExecucao.delete(k);
        }
    }
    return true;
}

// ============================================================
// HELPERS DE EXECUÇÃO READ-ONLY
// ============================================================
//
// Para os endpoints informativos (system-info, top-processes,
// disk-usage, journal-errors), usamos este helper em vez de
// abrir conexão SSE. Comandos são simples, curtos, read-only.

function _execReadOnly(comando, timeoutMs) {
    return new Promise(function(resolve) {
        exec(comando, {
            shell: '/bin/bash',
            timeout: timeoutMs || 5000,
            maxBuffer: 1024 * 1024 * 5,
            env: process.env
        }, function(error, stdout, stderr) {
            if (error && !stdout) {
                resolve('');
            } else {
                resolve((stdout || '').trim());
            }
        });
    });
}

// Converte saída KEY=value (uma por linha) em objeto JS.
function _parseChaveValor(texto) {
    var obj = {};
    if (!texto) return obj;
    texto.split('\n').forEach(function(linha) {
        var idx = linha.indexOf('=');
        if (idx === -1) return;
        var chave = linha.substring(0, idx).trim();
        var valor = linha.substring(idx + 1).trim();
        if (chave) obj[chave] = valor;
    });
        return obj;
}

// ============================================================
// CHANGELOG DINÂMICO (lê CHANGELOG.md)
// ============================================================
//
// O arquivo CHANGELOG.md na raiz do repo tem seções por versão:
//
//   # Changelog
//
//   ## v0.1-10072026
//   - Item A
//   - Item B
//
// O endpoint /changelog recebe a versão atual (DAP_VERSION) e
// devolve {versao, corpo}, onde `corpo` já vem em HTML pronto.
// Cache em memória por 12h — o CHANGELOG.md não muda entre
// releases.

const CHANGELOG_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
let _changelogCache = { versao: null, corpo: null, ts: 0 };

function _inlineMd(s) {
    return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
}

function _markdownParaHTML(md) {
    if (!md) return '';
    var linhas = md.split('\n');
    var html = '';
    var emLista = false;

    for (var i = 0; i < linhas.length; i++) {
        var l = linhas[i];
        var t = l.trim();

        if (/^[-*]\s+/.test(t)) {
            if (!emLista) { html += '<ul>'; emLista = true; }
            var item = t.replace(/^[-*]\s+/, '');
            html += '<li>' + _inlineMd(item) + '</li>';
            continue;
        }

        if (/^###\s+/.test(t)) {
            if (emLista) { html += '</ul>'; emLista = false; }
            html += '<h5>' + _inlineMd(t.replace(/^###\s+/, '')) + '</h5>';
            continue;
        }

        if (/^##\s+/.test(t)) {
            if (emLista) { html += '</ul>'; emLista = false; }
            html += '<h4>' + _inlineMd(t.replace(/^##\s+/, '')) + '</h4>';
            continue;
        }

        if (t === '') {
            if (emLista) { html += '</ul>'; emLista = false; }
            continue;
        }

        if (emLista) { html += '</ul>'; emLista = false; }
        html += '<p>' + _inlineMd(t) + '</p>';
    }

    if (emLista) html += '</ul>';
    return html;
}

function _lerChangelogVersao(versao) {
    var versaoLimpa = (versao || '').replace(/^v/, '').trim();

    if (_changelogCache.versao === versaoLimpa &&
        (Date.now() - _changelogCache.ts) < CHANGELOG_CACHE_TTL_MS) {
        return { versao: versaoLimpa, corpo: _changelogCache.corpo };
        }

        if (!fs.existsSync(ARQUIVO_CHANGELOG)) {
            return { versao: versaoLimpa, corpo: '' };
        }

        var conteudo;
    try {
        conteudo = fs.readFileSync(ARQUIVO_CHANGELOG, 'utf8');
    } catch (e) {
        console.error('[Changelog] Erro ao ler CHANGELOG.md:', e.message);
        return { versao: versaoLimpa, corpo: '' };
    }

    var linhas = conteudo.split('\n');
    var capturando = false;
    var buffer = [];

    for (var i = 0; i < linhas.length; i++) {
        var linha = linhas[i];
        var match = linha.match(/^##\s+v?(\S+)/);

        if (match) {
            if (capturando) break;
            var versaoHeading = match[1].trim();
            if (versaoHeading === versaoLimpa) {
                capturando = true;
                continue;
            }
        }

        if (capturando) {
            buffer.push(linha);
        }
    }

    var corpo = _markdownParaHTML(buffer.join('\n').trim());

    _changelogCache = { versao: versaoLimpa, corpo: corpo, ts: Date.now() };
    return { versao: versaoLimpa, corpo: corpo };
}

// ============================================================
// PROGRESSO
// ============================================================

function lerProgresso() {
    try {
        if (fs.existsSync(ARQUIVO_PROGRESSO)) {
            const dados = JSON.parse(fs.readFileSync(ARQUIVO_PROGRESSO, 'utf8'));

            if (Array.isArray(dados)) {
                return { executados: dados, pulados: [] };
            }

            return {
                executados: Array.isArray(dados.executados) ? dados.executados : [],
                                                       pulados: Array.isArray(dados.pulados) ? dados.pulados : []
            };
        }
    } catch (e) {
        console.error("[Erro ao ler progresso]:", e.message);
    }
    return { executados: [], pulados: [] };
}

function escreverProgresso(progresso) {
    fs.writeFileSync(ARQUIVO_PROGRESSO, JSON.stringify(progresso, null, 2), 'utf8');
}

function salvarProgresso(idComando) {
    try {
        const progresso = lerProgresso();
        if (!progresso.executados.includes(idComando)) {
            progresso.executados.push(idComando);
        }
        progresso.pulados = progresso.pulados.filter(id => id !== idComando);
        escreverProgresso(progresso);
    } catch (e) {
        console.error("[Erro ao salvar progresso]:", e.message);
    }
}

function removerProgresso(idComando) {
    try {
        const progresso = lerProgresso();
        progresso.executados = progresso.executados.filter(id => id !== idComando);
        escreverProgresso(progresso);
        console.log(`[Progresso Removido]: Botão '${idComando}' limpo do histórico.`);
    } catch (e) {
        console.error("[Erro ao remover progresso]:", e.message);
    }
}

function resetarProgresso() {
    try {
        if (fs.existsSync(ARQUIVO_PROGRESSO)) {
            fs.unlinkSync(ARQUIVO_PROGRESSO);
            console.log('[PROGRESS] Arquivo .progresso.json removido');
        }
        return true;
    } catch (e) {
        console.error("[Erro ao resetar progresso]:", e.message);
        return false;
    }
}

// ============================================================
// LIMPEZA DE LOGS ANTIGOS
// ============================================================
//
// O iniciar_dap.sh cria um /tmp/dap-YYYYMMDD-HHMMSS.log por
// sessão. Sem limpeza, /tmp acumula centenas de arquivos ao
// longo do tempo. Remove os com mais de 7 dias.

function _limparLogsAntigos() {
    try {
        const agora = Date.now();
        const TTL = 7 * 24 * 60 * 60 * 1000;
        const arquivos = fs.readdirSync('/tmp');
        let removidos = 0;
        arquivos.forEach(function(nome) {
            if (!nome.startsWith('dap-') || !nome.endsWith('.log')) return;
            const caminho = path.join('/tmp', nome);
            try {
                const stat = fs.statSync(caminho);
                if (agora - stat.mtimeMs > TTL) {
                    fs.unlinkSync(caminho);
                    removidos++;
                }
            } catch (e) { /* ignore */ }
        });
        if (removidos > 0) {
            console.log(`[Cleanup] ${removidos} log(s) antigo(s) removido(s) de /tmp`);
        }
    } catch (e) {
        console.warn('[Cleanup] Falha ao limpar logs antigos:', e.message);
    }
}

// ============================================================
// SSE — LOGS EM TEMPO REAL
// ============================================================

function enviarLog(idComando, mensagem, tipo = 'output', extra = {}) {
    const mensagemLimpa = _filtrarLog(mensagem);

    if (!mensagemLimpa || mensagemLimpa.trim() === '') {
        if (tipo !== 'end') return;
    }

    const dados = { tipo, mensagem: mensagemLimpa, ...extra };

    if (!sseBuffers.has(idComando)) sseBuffers.set(idComando, []);
    const buffer = sseBuffers.get(idComando);
    buffer.push(dados);
    if (buffer.length > SSE_BUFFER_MAX) buffer.shift();

    const clients = sseClients.get(idComando) || [];
    const json = JSON.stringify(dados);
    clients.forEach(client => {
        client.write(`data: ${json}\n\n`);
    });

    if (tipo === 'end') {
        setTimeout(function() {
            sseBuffers.delete(idComando);
        }, SSE_BUFFER_TTL_MS);
    }
}

function adicionarClienteSSE(idComando, res) {
    const buffer = sseBuffers.get(idComando) || [];
    buffer.forEach(function(dados) {
        res.write(`data: ${JSON.stringify(dados)}\n\n`);
    });

    if (!sseClients.has(idComando)) {
        sseClients.set(idComando, []);
    }
    sseClients.get(idComando).push(res);

    res.on('close', () => {
        const clients = sseClients.get(idComando) || [];
        const index = clients.indexOf(res);
        if (index !== -1) {
            clients.splice(index, 1);
        }
        if (clients.length === 0) {
            sseClients.delete(idComando);
        }
    });
}

// ============================================================
// PROGRESSO DE PACOTES
// ============================================================
//
// O FAP usava o parser de [N/M] do DNF para emitir eventos SSE
// do tipo "progress" para o frontend, que atualizava a barra com
// progresso real.
//
// O apt NÃO emite [N/M]. Ele emite:
//   - "Reading package lists..." (indeterminado)
//   - "Building dependency tree..." (indeterminado)
//   - "Unpacking pacote (versão) ..." (por pacote)
//   - "Setting up pacote ..." (por pacote)
//   - Em alguns casos, uma barra de progresso com percentual
//     (mas só quando o output é um TTY — que não é o caso aqui).
//
// Por enquanto, esta função retorna sempre null. A barra do
// frontend cai no fallback do timer (que já existe em ambos os
// projetos). Um parser real de apt pode ser adicionado na Fase 2,
// quando houver casos reais para testar.
//
// TODO (Fase 2): implementar parser de progresso do apt usando
// contagem de "Unpacking" + "Setting up" combinada com o total
// previsto (apt-get -s install X pode dar o total antes de
// executar).

function _detectarProgressoPacotes(texto) {
    // Retorna null por enquanto — ver TODO acima.
    return null;
}

function enviarProgresso(idComando, atual, total) {
    var dados = { tipo: 'progress', pacote_atual: atual, pacote_total: total };

    if (!sseBuffers.has(idComando)) sseBuffers.set(idComando, []);
    var buffer = sseBuffers.get(idComando);
    buffer.push(dados);
    if (buffer.length > SSE_BUFFER_MAX) buffer.shift();

    var clients = sseClients.get(idComando) || [];
    var json = JSON.stringify(dados);
    clients.forEach(function(client) {
        client.write(`data: ${json}\n\n`);
    });
}

// ============================================================
// DETECÇÃO DE DESKTOP E AUTENTICAÇÃO
// ============================================================

function detectarDesktop() {
    const desktop = (process.env.XDG_CURRENT_DESKTOP || '').toUpperCase();
    const session = (process.env.DESKTOP_SESSION || '').toUpperCase();

    if (desktop.includes('KDE') || session.includes('KDE') || session.includes('PLASMA')) {
        return 'KDE';
    }
    if (desktop.includes('GNOME') || session.includes('GNOME')) {
        return 'GNOME';
    }
    if (desktop.includes('XFCE') || session.includes('XFCE')) {
        return 'XFCE';
    }
    if (desktop.includes('CINNAMON') || session.includes('CINNAMON')) {
        return 'CINNAMON';
    }
    if (desktop.includes('MATE') || session.includes('MATE')) {
        return 'MATE';
    }
    if (desktop.includes('LXQT') || session.includes('LXQT')) {
        return 'LXQT';
    }
    if (desktop.includes('LXDE') || session.includes('LXDE')) {
        return 'LXDE';
    }

    return 'UNKNOWN';
}

// ============================================================
// MÉTODO DE AUTENTICAÇÃO
// ============================================================
//
// Ordem de preferência:
//
//   1. KDE → kdesu (se disponível). É o método mais integrado no
//      KDE Plasma. Requer o pacote kde-cli-tools, que o install.sh
//      instala no KDE.
//
//   2. Qualquer DE → pkexec (PolicyKit). Presente no Debian por
//      padrão, mas em instalações mínimas pode não ter o agente
//      polkit rodando. O pkexec funciona, mas a janela de senha
//      pode não aparecer se o agente não estiver ativo.
//
//   3. Qualquer DE → sudo -A com SUDO_ASKPASS apontando para um
//      dos diálogos gráficos disponíveis:
//        - lxqt-sudo (LXQt)
//        - ssh-askpass (universal, GTK)
//        - ssh-askpass-gnome (GNOME)
//        - beesu (GTK antigo)
//
//   4. Fallback final → zenity/kdialog pedindo a senha, com o
//      resultado passado via stdin para o `sudo -S`.
//
// A detecção de qual diálogo gráfico está disponível é feita em
// runtime por `_acharSudoAskpass()`. O install.sh é responsável
// por instalar o diálogo apropriado ao DE detectado.

function _acharSudoAskpass() {
    // Lista em ordem de preferência. Devolve o caminho completo
    // do primeiro que existir, ou null.
    var candidatos = [
        'lxqt-sudo',
        'ssh-askpass',
        'ssh-askpass-gnome',
        'beesu',
        'ksshaskpass' // KDE (vem com kde-cli-tools às vezes)
    ];

    for (var i = 0; i < candidatos.length; i++) {
        if (commandExists(candidatos[i])) {
            return candidatos[i];
        }
    }
    return null;
}

function obterMetodoAutenticacao() {
    const desktop = detectarDesktop();

    if (desktop === 'KDE' && commandExists('kdesu')) {
        return { tipo: 'kdesu', comando: 'kdesu', descricao: 'kdesu (KDE)' };
    }

    if (commandExists('pkexec')) {
        return { tipo: 'pkexec', comando: 'pkexec', descricao: 'pkexec (PolicyKit)' };
    }

    var askpass = _acharSudoAskpass();
    if (askpass) {
        return {
            tipo: 'sudo_askpass',
            comando: askpass,
            descricao: 'sudo -A (' + askpass + ')'
        };
    }

    if (commandExists('kdialog') || commandExists('zenity')) {
        return {
            tipo: 'dialog_fallback',
            comando: commandExists('kdialog') ? 'kdialog' : 'zenity',
                                                       descricao: (commandExists('kdialog') ? 'kdialog' : 'zenity') + ' (fallback gráfico)'
        };
    }

    return {
        tipo: 'sudo_fallback',
        comando: 'sudo',
        descricao: 'sudo (fallback, terminal)'
    };
}

function commandExists(cmd) {
    try {
        const result = spawnSync('which', [cmd], { encoding: 'utf8', timeout: 1000 });
        return result.status === 0 && (result.stdout || '').trim().length > 0;
    } catch (e) {
        return false;
    }
}

// ============================================================
// EXECUÇÃO DE COMANDOS (com ou sem autenticação)
// ============================================================

function executarComandoComStream(comandoFinal, idComando, isReversao, callback) {
    const precisaAutenticacao = !_cmdSemAutenticacao(comandoFinal);

    if (!precisaAutenticacao) {
        console.log(`[INFO] Comando SEM autenticação: ${comandoFinal.substring(0, 50)}...`);
        enviarLog(idComando, `$ ${comandoFinal}\n`, 'info');

        const env = { ...process.env };

        // Comandos que rodam no contexto do usuário (flatpak,
        // systemctl --user, ferramentas do PipeWire) precisam do
        // bus e runtime corretos.
        if (_precisaEnvUserContext(comandoFinal)) {
            let uid = 1000;
            try {
                uid = process.getuid ? process.getuid() : 1000;
            } catch (e) {
                uid = 1000;
            }
            env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
            env.DBUS_SESSION_BUS_ADDRESS = `unix:path=/run/user/${uid}/bus`;
            if (!env.HOME) {
                env.HOME = process.env.HOME || '/home/' + (process.env.USER || 'user');
            }
            console.log(`[USER-CTX] XDG_RUNTIME_DIR=${env.XDG_RUNTIME_DIR}`);
            console.log(`[USER-CTX] DBUS_SESSION_BUS_ADDRESS=${env.DBUS_SESSION_BUS_ADDRESS}`);
            console.log(`[USER-CTX] HOME=${env.HOME}`);
        }

        _registrarProcesso(exec(comandoFinal, {
            shell: '/bin/bash',
            maxBuffer: 1024 * 1024 * 50,
            timeout: 1800000,
            env: env,
            // detached: cria sessão própria (setsid). Isso faz todos
            // os descendentes compartilharem o PGID do bash,
            // permitindo que process.kill(-pid, ...) alcance a
            // árvore inteira no SIGINT.
            detached: true
        }, (error, stdout, stderr) => {
            if (stdout) {
                enviarLog(idComando, stdout, 'output');
                var prog = _detectarProgressoPacotes(stdout);
                if (prog) enviarProgresso(idComando, prog.atual, prog.total);
            }
            if (stderr) {
                const stderrFiltrado = stderr.replace(/\[sudo\] password for .+: /g, '');
                if (stderrFiltrado.trim()) {
                    enviarLog(idComando, stderrFiltrado, 'error');
                }
            }
            if (error) {
                enviarLog(idComando, `\n❌ Comando falhou com código: ${error.code || 1}\n`, 'error');
                console.error(`[ERRO] ${idComando}: Código ${error.code || 1}`);
                enviarLog(idComando, '__END__', 'end', { sucesso: false });
                callback(error, stdout, stderr);
            } else {
                if (isReversao) {
                    removerProgresso(idComando);
                } else {
                    salvarProgresso(idComando);
                }
                enviarLog(idComando, `\n✅ Comando concluído com sucesso!\n`, 'success');
                console.log(`[SUCESSO] ${idComando}`);
                enviarLog(idComando, '__END__', 'end', { sucesso: true });
                callback(null, stdout, stderr);
            }
        }));
        return;
    }

    enviarLog(idComando, `$ ${comandoFinal}\n`, 'info');
    enviarLog(idComando, '─'.repeat(50) + '\n', 'info');

    const processo = _registrarProcesso(spawn(comandoFinal, {
        shell: '/bin/bash',
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        // Mesmo motivo do exec acima: garante que o kill alcance
        // os descendentes via PGID.
        detached: true
    }));

    let saidaCompleta = '';
    let erros = '';

    processo.stdout.on('data', (data) => {
        const texto = data.toString();
        saidaCompleta += texto;
        enviarLog(idComando, texto, 'output');
        var prog = _detectarProgressoPacotes(texto);
        if (prog) enviarProgresso(idComando, prog.atual, prog.total);
    });

        processo.stderr.on('data', (data) => {
            const texto = data.toString();
            erros += texto;
            const textoFiltrado = texto.replace(/\[sudo\] password for .+: /g, '');
            if (textoFiltrado.trim()) {
                enviarLog(idComando, textoFiltrado, 'error');
            }
        });

        processo.on('close', (code) => {
            if (code === 0) {
                if (isReversao) {
                    removerProgresso(idComando);
                } else {
                    salvarProgresso(idComando);
                }
                enviarLog(idComando, `\n✅ Comando concluído com sucesso! (código: ${code})\n`, 'success');
                console.log(`[SUCESSO] ${idComando}`);
            } else {
                enviarLog(idComando, `\n❌ Comando falhou com código: ${code}\n`, 'error');
                console.error(`[ERRO] ${idComando}: Código ${code}`);
            }

            enviarLog(idComando, '─'.repeat(50) + '\n', 'info');
            enviarLog(idComando, code === 0 ? '✅ Tarefa concluída!\n' : '❌ Tarefa falhou!\n', code === 0 ? 'success' : 'error');
            enviarLog(idComando, '__END__', 'end', { sucesso: code === 0 });

            callback(code === 0 ? null : new Error(`Código de saída: ${code}`), saidaCompleta, erros);
        });

        processo.on('error', (err) => {
            enviarLog(idComando, `\n❌ Erro ao iniciar processo: ${err.message}\n`, 'error');
            enviarLog(idComando, '__END__', 'end', { sucesso: false });
            callback(err, saidaCompleta, erros);
        });
}

// ============================================================
// AUTENTICAÇÃO SEGURA (kdesu / pkexec / sudo -A / fallback)
// ============================================================

function _construirScripts(timestamp, random, comandoCorrigido, descricao, outputTemp) {
    const scriptTemp = `/tmp/dap-cmd-${timestamp}-${random}.sh`;
    const homeDir = HOME_DIR_USUARIO;

    const comandoLimpo = (comandoCorrigido || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

    const scriptContent = [
        '#!/bin/bash',
        '# Debian Advantage Panel - ' + descricao,
        '# Executado em: ' + new Date().toLocaleString('pt-BR'),
                                                       '',
                                                       '# Exports obrigatórios quando roda via pkexec/kdesu/sudo (root).',
                                                       '# Sem HOME/USER corretos, scripts como install.sh --uninstall',
                                                       '# procurariam o DAP em /root/.local/share em vez de',
                                                       '# /home/<user>/.local/share.',
                                                       'export DISPLAY=' + (process.env.DISPLAY || ':0'),
                                                       'export XAUTHORITY=' + (process.env.XAUTHORITY || homeDir + '/.Xauthority'),
                                                       'export DBUS_SESSION_BUS_ADDRESS=' + (process.env.DBUS_SESSION_BUS_ADDRESS || ''),
                                                       'export HOME=' + homeDir,
                                                       'export USER=' + USUARIO_REAL,
                                                       'export LOGNAME=' + USUARIO_REAL,
                                                       'exec > ' + outputTemp + ' 2>&1',
                                                       '',
                                                       comandoLimpo,
                                                       ''
    ].join('\n');

    return { scriptTemp, scriptContent };
}

const MAX_READER_DURATION_MS = 30 * 60 * 1000;

function _criarReaderOutput(idComando, outputTemp) {
    let bytesLidos = 0;
    const inicioReader = Date.now();

    const readerInterval = setInterval(() => {
        if (Date.now() - inicioReader > MAX_READER_DURATION_MS) {
            console.warn(`[READER] Timeout de ${MAX_READER_DURATION_MS/60000}min atingido para ${idComando}`);
            enviarLog(idComando, `\n⚠️ Leitor de saída atingiu o tempo máximo (30min). Abortando.\n`, 'warning');
            clearInterval(readerInterval);
            return;
        }

        if (!fs.existsSync(outputTemp)) return;
        try {
            const conteudo = fs.readFileSync(outputTemp);
            if (conteudo.length > bytesLidos) {
                const novoConteudo = conteudo.slice(bytesLidos).toString('utf8');
                bytesLidos = conteudo.length;
                if (novoConteudo) {
                    enviarLog(idComando, novoConteudo, 'output');
                    var prog = _detectarProgressoPacotes(novoConteudo);
                    if (prog) enviarProgresso(idComando, prog.atual, prog.total);
                }
            }
        } catch (e) {
            // ignora erros de leitura (EACCES momentâneo, arquivo em escrita)
        }
    }, 500);

    const cleanupReader = () => {
        clearInterval(readerInterval);
        if (fs.existsSync(outputTemp)) {
            try {
                const conteudo = fs.readFileSync(outputTemp);
                if (conteudo.length > bytesLidos) {
                    const resto = conteudo.slice(bytesLidos).toString('utf8');
                    if (resto) {
                        enviarLog(idComando, resto, 'output');
                        var prog = _detectarProgressoPacotes(resto);
                        if (prog) enviarProgresso(idComando, prog.atual, prog.total);
                    }
                }
            } catch (e) {}
            try { fs.unlinkSync(outputTemp); } catch (e) {}
        }
    };

    return cleanupReader;
}

function executarComAutenticacaoSegura(comandoOriginal, idComando, isReversao, callback) {
    const desktop = detectarDesktop();

    const descricoesComandos = {
        'apt update': 'Atualizar a lista de pacotes',
        'apt upgrade': 'Atualizar os pacotes do sistema',
        'apt full-upgrade': 'Atualização completa do sistema',
        'apt install': 'Instalar pacotes',
        'apt remove': 'Remover pacotes',
        'apt purge': 'Remover pacotes e configurações',
        'apt autoremove': 'Remover dependências não utilizadas',
        'apt clean': 'Limpar cache de pacotes',
        'apt-add-repository': 'Adicionar repositório APT',
        'add-apt-repository': 'Adicionar repositório APT',
        'dpkg --add-architecture': 'Habilitar arquitetura adicional',
        'dpkg-reconfigure': 'Reconfigurar pacote',
        'update-grub': 'Reconfigurar GRUB',
        'update-initramfs': 'Reconstruir o initramfs',
        'locale-gen': 'Gerar localizações do sistema',
        'update-locale': 'Alterar configurações de localidade',
        'timedatectl': 'Alterar data e hora do sistema',
        'sed -i': 'Modificar arquivo de configuração',
        'usermod': 'Modificar grupos do usuário',
        'gpasswd': 'Modificar grupos do usuário',
        'systemctl': 'Gerenciar serviços do sistema',
        'waydroid init': 'Inicializar container Android (Waydroid)',
                                                       'ip link': 'Configurar interface de rede',
                                                       'chown': 'Ajustar permissões de arquivo',
                                                       'tee': 'Escrever arquivo de configuração',
                                                       'sysctl': 'Ajustar parâmetros do kernel',
                                                       'modprobe': 'Carregar módulo do kernel'
    };

    let descricao = 'Executar comando administrativo';
    for (const [key, value] of Object.entries(descricoesComandos)) {
        if (comandoOriginal.includes(key)) {
            descricao = value;
            break;
        }
    }

    enviarLog(idComando, `🔐 Autenticando para: ${descricao}\n`, 'info');

    const comandoSemSudo = comandoOriginal.replace(/sudo\s+(?!-)/g, '');
    const comandoCorrigido = _substituirCaminhosUsuario(comandoSemSudo);

    const hasPkexec = commandExists('pkexec');
    const hasKdesu = commandExists('kdesu');
    const hasZenity = commandExists('zenity');
    const hasKdialog = commandExists('kdialog');
    const askpassCmd = _acharSudoAskpass();

    console.log(`[AUTH] Desktop: ${desktop}, pkexec: ${hasPkexec}, kdesu: ${hasKdesu}, askpass: ${askpassCmd}`);
    console.log(`[AUTH] HOME do usuário: ${HOME_DIR_USUARIO}, usuário: ${USUARIO_REAL}`);

    // ============================================================
    // MÉTODO 1: kdesu (KDE)
    // ============================================================
    if (desktop === 'KDE' && hasKdesu) {
        enviarLog(idComando, '🪟 Usando kdesu (KDE) com interface gráfica...\n', 'info');

        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(7);
        const outputTemp = `/tmp/dap-out-${timestamp}-${random}.log`;
        const { scriptTemp, scriptContent } = _construirScripts(timestamp, random, comandoCorrigido, descricao, outputTemp);

        try {
            fs.writeFileSync(scriptTemp, scriptContent, { mode: 0o755 });
            console.log(`[KDESU] Script criado: ${scriptTemp}`);
        } catch (err) {
            enviarLog(idComando, `❌ Erro ao criar script: ${err.message}\n`, 'error');
            return callback(err, "", "");
        }

        const comandoFinal = `kdesu -c "${scriptTemp}" && rm -f ${scriptTemp} || { rm -f ${scriptTemp}; exit 1; }`;
        const cleanupReader = _criarReaderOutput(idComando, outputTemp);

        setTimeout(() => {
            if (fs.existsSync(scriptTemp)) {
                try { fs.unlinkSync(scriptTemp); } catch (e) {}
            }
        }, 60000);

        executarComandoComStream(comandoFinal, idComando, isReversao, (err, stdout, stderr) => {
            cleanupReader();
            callback(err, stdout, stderr);
        });

        return;
    }

    // ============================================================
    // MÉTODO 2: pkexec (PolicyKit)
    // ============================================================
    if (hasPkexec) {
        enviarLog(idComando, '🔑 Usando pkexec com interface gráfica...\n', 'info');

        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(7);
        const outputTemp = `/tmp/dap-out-${timestamp}-${random}.log`;
        const { scriptTemp, scriptContent } = _construirScripts(timestamp, random, comandoCorrigido, descricao, outputTemp);

        try {
            fs.writeFileSync(scriptTemp, scriptContent, { mode: 0o755 });
            console.log(`[PKEXEC] Script criado: ${scriptTemp}`);
        } catch (err) {
            enviarLog(idComando, `❌ Erro ao criar script: ${err.message}\n`, 'error');
            return callback(err, "", "");
        }

        const comandoFinal = `pkexec ${scriptTemp} && rm -f ${scriptTemp} || { rm -f ${scriptTemp}; exit 1; }`;
        const cleanupReader = _criarReaderOutput(idComando, outputTemp);

        setTimeout(() => {
            if (fs.existsSync(scriptTemp)) {
                try { fs.unlinkSync(scriptTemp); } catch (e) {}
            }
        }, 60000);

        executarComandoComStream(comandoFinal, idComando, isReversao, (err, stdout, stderr) => {
            cleanupReader();
            callback(err, stdout, stderr);
        });

        return;
    }

    // ============================================================
    // MÉTODO 3: sudo -A com SUDO_ASKPASS
    // ============================================================
    //
    // O `sudo -A` usa o programa apontado pela variável SUDO_ASKPASS
    // para pedir a senha graficamente. É o método mais portátil no
    // Debian (não depende de PolicyKit nem de kdesu).
    //
    // O install.sh é responsável por instalar o diálogo apropriado
    // ao DE detectado (lxqt-sudo em LXQt, ssh-askpass em outros,
    // ssh-askpass-gnome em GNOME).
    if (askpassCmd) {
        enviarLog(idComando, `🔐 Usando sudo -A (${askpassCmd})...\n`, 'info');

        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(7);
        const outputTemp = `/tmp/dap-out-${timestamp}-${random}.log`;
        const { scriptTemp, scriptContent } = _construirScripts(timestamp, random, comandoCorrigido, descricao, outputTemp);

        try {
            fs.writeFileSync(scriptTemp, scriptContent, { mode: 0o755 });
            console.log(`[SUDO-ASKPASS] Script criado: ${scriptTemp}`);
        } catch (err) {
            enviarLog(idComando, `❌ Erro ao criar script: ${err.message}\n`, 'error');
            return callback(err, "", "");
        }

        // Para o `sudo -A` encontrar o askpass, passamos via variável
        // de ambiente. O script final também precisa rodar como o
        // usuário real, por isso usamos o wrapper abaixo.
        //
        // - SUDO_ASKPASS aponta para o binário detectado
        // - O script é executado via sudo -A, que chama o askpass
        //   automaticamente quando precisa de senha
        const comandoFinal =
        `SUDO_ASKPASS=${askpassCmd} sudo -A ${scriptTemp} && rm -f ${scriptTemp} || { rm -f ${scriptTemp}; exit 1; }`;

        const cleanupReader = _criarReaderOutput(idComando, outputTemp);

        setTimeout(() => {
            if (fs.existsSync(scriptTemp)) {
                try { fs.unlinkSync(scriptTemp); } catch (e) {}
            }
        }, 60000);

        executarComandoComStream(comandoFinal, idComando, isReversao, (err, stdout, stderr) => {
            cleanupReader();
            callback(err, stdout, stderr);
        });

        return;
    }

    // ============================================================
    // MÉTODO 4: fallback com zenity/kdialog + sudo -S (senha via stdin)
    // ============================================================
    enviarLog(idComando, '⚠️ Usando fallback com zenity/kdialog...\n', 'warning');

    let promptSenha;
    if (hasKdialog && (desktop === 'KDE' || desktop === 'LXQT')) {
        promptSenha = `kdialog --password "Digite sua senha de administrador:" --title "Debian Advantage Panel - ${descricao}" 2>/dev/null`;
    } else if (hasZenity) {
        promptSenha = `zenity --password --title="Debian Advantage Panel" --text="🔐 ${descricao}" 2>/dev/null`;
    } else {
        promptSenha = `kdialog --password "Digite sua senha de administrador:" --title "Debian Advantage Panel - ${descricao}" 2>/dev/null || zenity --password --title="Debian Advantage Panel" --text="🔐 ${descricao}" 2>/dev/null`;
    }

    exec(promptSenha, {
        env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }
    }, (errPrompt, senha) => {
        if (errPrompt || !senha || senha.trim().length === 0) {
            enviarLog(idComando, '❌ Autenticação cancelada pelo usuário.\n', 'error');
            return callback(new Error("Autenticação cancelada pelo usuário."), "", "");
        }

        enviarLog(idComando, `$ sudo -S sh -c '<comando>'\n`, 'info');
        enviarLog(idComando, '─'.repeat(50) + '\n', 'info');

        const proc = _registrarProcesso(spawn('sudo', ['-S', 'sh', '-c', comandoCorrigido], {
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: true
        }));

        proc.stdin.write(senha.trim() + '\n');
        proc.stdin.end();

        let saidaCompleta = '';
        let erros = '';

        proc.stdout.on('data', (data) => {
            const texto = data.toString();
            saidaCompleta += texto;
            enviarLog(idComando, texto, 'output');
        });

        proc.stderr.on('data', (data) => {
            const texto = data.toString();
            erros += texto;
            const textoFiltrado = texto.replace(/\[sudo\] password for .+: /g, '');
            if (textoFiltrado.trim()) {
                enviarLog(idComando, textoFiltrado, 'error');
            }
        });

        proc.on('close', (code) => {
            if (code === 0) {
                if (isReversao) {
                    removerProgresso(idComando);
                } else {
                    salvarProgresso(idComando);
                }
                enviarLog(idComando, `\n✅ Comando concluído com sucesso! (código: ${code})\n`, 'success');
                console.log(`[SUCESSO] ${idComando}`);
            } else {
                enviarLog(idComando, `\n❌ Comando falhou com código: ${code}\n`, 'error');
                console.error(`[ERRO] ${idComando}: Código ${code}`);
            }

            enviarLog(idComando, '─'.repeat(50) + '\n', 'info');
            enviarLog(idComando, code === 0 ? '✅ Tarefa concluída!\n' : '❌ Tarefa falhou!\n', code === 0 ? 'success' : 'error');
            enviarLog(idComando, '__END__', 'end', { sucesso: code === 0 });

            callback(code === 0 ? null : new Error(`Código de saída: ${code}`), saidaCompleta, erros);
        });

        proc.on('error', (err) => {
            enviarLog(idComando, `\n❌ Erro ao iniciar processo: ${err.message}\n`, 'error');
            enviarLog(idComando, '__END__', 'end', { sucesso: false });
            callback(err, saidaCompleta, erros);
        });
    });
}

function procederComExecucao(comando, idComando, isReversao, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        success: true,
        output: 'Comando aceito. Acompanhe o progresso no log abaixo.'
    }));

    setImmediate(() => {
        const precisaAutenticacao = !_cmdSemAutenticacao(comando);

        console.log(`[AUTH] ${idComando}: PrecisaAuth=${precisaAutenticacao}`);

        if (precisaAutenticacao) {
            executarComAutenticacaoSegura(comando, idComando, isReversao, (error) => {
                if (error) {
                    console.error(`[ERRO] ${idComando}:`, error.message);
                }
            });
        } else {
            executarComandoComStream(comando, idComando, isReversao, (error) => {
                if (error) {
                    console.error(`[ERRO] ${idComando}:`, error.message);
                }
            });
        }
    });
}

// ============================================================
// SERVIDORES DE ARQUIVOS ESTÁTICOS
// ============================================================

function servirArquivoEstatico(req, res, filePath) {
    const fullPath = path.join(__dirname, filePath);

    if (fs.existsSync(fullPath)) {
        const ext = path.extname(fullPath).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon'
        };

        const mimeType = mimeTypes[ext] || 'application/octet-stream';

        res.writeHead(200, {
            'Content-Type': mimeType,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        fs.createReadStream(fullPath).pipe(res);
    } else {
        res.writeHead(404);
        res.end('Arquivo não encontrado');
    }
}

function servirLocale(req, res, lang) {
    if (LANGS_SUPORTADOS.indexOf(lang) === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Idioma não suportado: ' + lang }));
        return;
    }

    const arquivo = path.join(LOCALES_DIR, lang + '.json');

    const rel = path.relative(LOCALES_DIR, arquivo);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Acesso negado' }));
        return;
    }

    if (!fs.existsSync(arquivo)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Locale não encontrado: ' + lang }));
        return;
    }

    res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache'
    });
    fs.createReadStream(arquivo).pipe(res);
}

// ============================================================
// SERVIDOR HTTP
// ============================================================

const server = http.createServer((req, res) => {
    let parsedUrl;
    try {
        parsedUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Requisição inválida');
        return;
    }
    const url = parsedUrl.pathname;
    const query = parsedUrl.searchParams;

    // ----------------------------------------------------------
    // SSE — logs em tempo real
    // ----------------------------------------------------------
    if (req.method === 'GET' && url.startsWith('/stream')) {
        const idComando = query.get('id');

        if (!idComando) {
            res.writeHead(400);
            res.end('ID do comando é obrigatório');
            return;
        }

        console.log(`[SSE] Cliente conectado para: ${idComando}`);

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        const heartbeat = setInterval(() => {
            res.write(': heartbeat\n\n');
        }, 30000);

        adicionarClienteSSE(idComando, res);

        req.on('close', () => {
            clearInterval(heartbeat);
            console.log(`[SSE] Cliente desconectado: ${idComando}`);
        });

        return;
    }

    // ----------------------------------------------------------
    // LOCALES (JSON de tradução)
    // ----------------------------------------------------------
    if (req.method === 'GET' && url.startsWith('/locales/')) {
        let resto = url.substring('/locales/'.length);

        if (resto.endsWith('.json')) {
            resto = resto.substring(0, resto.length - '.json'.length);
        }

        let lang;
        try {
            lang = decodeURIComponent(resto);
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Requisição inválida' }));
            return;
        }

        servirLocale(req, res, lang);
        return;
    }

    // ----------------------------------------------------------
    // PROGRESSO
    // ----------------------------------------------------------
    if (req.method === 'GET' && url === '/progress') {
        const progresso = lerProgresso();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            executados: progresso.executados,
            pulados: progresso.pulados
        }));
        return;
    }

    if (req.method === 'POST' && url === '/progress') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const { executados, pulados } = JSON.parse(body);
                if (Array.isArray(executados) || Array.isArray(pulados)) {
                    escreverProgresso({
                        executados: Array.isArray(executados) ? executados : [],
                                      pulados: Array.isArray(pulados) ? pulados : []
                    });
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message }));
            }
        });
        return;
    }

    if (req.method === 'DELETE' && url === '/progress') {
        const ok = resetarProgresso();
        if (ok) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Falha ao remover o arquivo de progresso' }));
        }
        return;
    }

    // ----------------------------------------------------------
    // PÁGINAS E ARQUIVOS ESTÁTICOS
    // ----------------------------------------------------------
    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
        servirArquivoEstatico(req, res, 'index.html');
        return;
    }

    if (req.method === 'GET' && url === '/guiado.html') {
        servirArquivoEstatico(req, res, 'guiado.html');
        return;
    }

    // ----------------------------------------------------------
    // SESSÕES — IDs semânticos (sem número)
    // ----------------------------------------------------------
    //
    // O DAP usa IDs semânticos: os arquivos são 'codecs.html',
    // 'gaming.html', 'sobre-dap.html' etc, sem prefixo numérico.
    // Este regex casa qualquer arquivo .html cujo nome comece com
    // letra minúscula e contenha apenas letras, dígitos e hífen.
    // Também impede path traversal (não aceita '/', '.', nem
    // maiúsculas).
    if (req.method === 'GET' && url.match(/^\/([a-z][a-z0-9-]*\.html)$/)) {
        const match = url.match(/^\/([a-z][a-z0-9-]*\.html)$/);
        if (match) {
            servirArquivoEstatico(req, res, match[1]);
            return;
        }
    }

    if (req.method === 'GET' && url === '/style.css') {
        servirArquivoEstatico(req, res, 'style.css');
        return;
    }

    if (req.method === 'GET' && url === '/script.js') {
        servirArquivoEstatico(req, res, 'script.js');
        return;
    }

    if (req.method === 'GET' && url === '/i18n.js') {
        servirArquivoEstatico(req, res, 'i18n.js');
        return;
    }

    if (req.method === 'GET' && (url === '/icone_app.png' || url === '/favicon.ico')) {
        servirArquivoEstatico(req, res, 'icone_app.png');
        return;
    }

    // ----------------------------------------------------------
    // /status — healthcheck + progresso
    // ----------------------------------------------------------
    if (req.method === 'GET' && url === '/status') {
        const progresso = lerProgresso();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            ok: true,
            executados: progresso.executados,
            pulados: progresso.pulados,
            uptime: Math.floor(process.uptime()),
                               versao: DAP_VERSION,
                               sseConexoes: sseClients.size,
                               memoriaMB: Math.floor(process.memoryUsage().rss / 1024 / 1024)
        }));
        return;
    }

    // ----------------------------------------------------------
    // /info — metadados do ambiente
    // ----------------------------------------------------------
    if (req.method === 'GET' && url === '/info') {
        const desktop = detectarDesktop();
        const metodo = obterMetodoAutenticacao();
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.end(JSON.stringify({
            desktop: desktop,
            autenticacao: metodo.descricao,
            nodeVersion: process.version,
            platform: process.platform,
            version: DAP_VERSION,
            langsSuportados: LANGS_SUPORTADOS
        }));
        return;
    }

    // ----------------------------------------------------------
    // /kernel-atual — apenas o kernel em execução
    // ----------------------------------------------------------
    if (req.method === 'GET' && url === '/kernel-atual') {
        exec('uname -r', { shell: '/bin/bash', timeout: 3000 }, (error, stdout) => {
            var kernel = (stdout || '').trim();
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            res.end(JSON.stringify({ kernel: kernel }));
        });
        return;
    }

    // ----------------------------------------------------------
    // /kernels — lista de kernels instalados
    // ----------------------------------------------------------
    //
    // No Debian, os kernels são instalados como pacotes
    // linux-image-<versão>. Usamos dpkg-query para listar.
    if (req.method === 'GET' && url === '/kernels') {
        exec('dpkg-query -W -f=\'${Package}\\n\' \'linux-image-*-amd64\' 2>/dev/null || dpkg-query -W -f=\'${Package}\\n\' \'linux-image-*-*\' 2>/dev/null',
             { shell: '/bin/bash', timeout: 5000 },
             (error, stdout) => {
                 var kernels = (stdout || '').trim().split('\n')
                 .filter(function(l) { return l.startsWith('linux-image-'); })
                 .map(function(l) { return l.replace('linux-image-', '').replace(/-amd64$/, ''); })
                 .filter(function(l) { return !l.includes('dbg') && !l.includes('unsigned') && !l.includes('cloud'); });
                 exec('uname -r', (err2, stdout2) => {
                     const atual = (stdout2 || '').trim();
                     res.writeHead(200, {
                         'Content-Type': 'application/json',
                         'Cache-Control': 'no-cache, no-store, must-revalidate'
                     });
                     res.end(JSON.stringify({
                         kernels: kernels,
                         atual: atual
                     }));
                 });
             });
        return;
    }

    // ----------------------------------------------------------
    // /check-package — verifica se um pacote dpkg está instalado
    // ----------------------------------------------------------
    //
    // Usado pelo frontend para decidir se um app nativo de
    // desktop (gnome-connections, krdc) já está presente no
    // sistema. Se estiver, o DAP esconde o botão de instalar
    // e mostra o "Abrir" direto.
    //
    // Validação do nome do pacote: só aceita letras, números,
    // ponto, hífen e underscore (suficiente para nomes dpkg).
    if (req.method === 'GET' && url === '/check-package') {
        var pkg = query.get('pkg');
        if (!pkg || !/^[a-zA-Z0-9._-]+$/.test(pkg)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'pkg inválido' }));
            return;
        }
        exec('dpkg-query -W -f=\'${Status}\' ' + pkg + ' 2>/dev/null',
             { shell: '/bin/bash', timeout: 3000 },
             (error, stdout) => {
                 var out = (stdout || '').trim();
                 // dpkg-query devolve "install ok installed" quando
                 // o pacote está instalado corretamente.
                 var instalado = out === 'install ok installed';
                 res.writeHead(200, {
                     'Content-Type': 'application/json',
                     'Cache-Control': 'no-cache, no-store, must-revalidate'
                 });
                 res.end(JSON.stringify({ installed: instalado, pkg: pkg }));
             });
        return;
    }

    // ----------------------------------------------------------
    // /flatpak-installed — lista de app-ids Flatpak instalados
    // ----------------------------------------------------------
    //
    // Usado pelo script.js para detectar Flatpaks que foram
    // removidos fora do DAP (via GNOME Software, linha de
    // comando, ou outro gerenciador) e restaurar o botão
    // original para o usuário reinstalar.
    if (req.method === 'GET' && url === '/flatpak-installed') {
        exec('flatpak list --app --columns=application 2>/dev/null',
             { shell: '/bin/bash', timeout: 5000 },
             (error, stdout) => {
                 const apps = (stdout || '').trim().split('\n').filter(Boolean);
                 res.writeHead(200, {
                     'Content-Type': 'application/json',
                     'Cache-Control': 'no-cache, no-store, must-revalidate'
                 });
                 res.end(JSON.stringify({ apps: apps }));
             });
        return;
    }

    // ----------------------------------------------------------
    // /hardware-scan — detecção de hardware e sugestão de drivers
    // ----------------------------------------------------------
    //
    // Roda lspci, lsusb e dpkg-query, cruza com hardware_map.json
    // e devolve a lista de dispositivos detectados com estado de
    // driver. Nada é instalado — é puramente read-only.
    //
    // NOTA (Fase 1): o hardware-service.js será reescrito para
    // Debian na Fase 5. Por enquanto, o endpoint existe e chama o
    // módulo — se o módulo falhar (porque o mapeamento atual é do
    // FAP), retorna uma lista vazia em vez de derrubar o servidor.
    if (req.method === 'GET' && url === '/hardware-scan') {
        hardwareService.scanHardware().then(function (resultado) {
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            res.end(JSON.stringify(resultado));
        }).catch(function (e) {
            console.error('[hardware-scan] Erro:', e.message);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ devices: [], repos: {}, secure_boot: 'unknown', error: e.message }));
        });
        return;
    }

    // ----------------------------------------------------------
    // /system-info — painel de diagnóstico
    // ----------------------------------------------------------
    //
    // Campos de otimização (ksm_*, tcp_congestion, max_map_count,
    // pipewire_quantum) usam fallback independente — se o sensor
    // ou o comando não existir no sistema, o campo retorna um
    // valor neutro e o painel continua funcional.
    //
    // Diferenças em relação ao FAP:
    //   - fedora-release → debian_version + os-release
    //   - firewall-cmd → ufw status (com fallback nft)
    //   - getenforce funciona no Debian se selinux-utils estiver
    //     instalado; senão, retorna "N/A"
    if (req.method === 'GET' && url === '/system-info') {
        const script = `
        DEBIAN_VERSION=$(cat /etc/debian_version 2>/dev/null || echo "")
        DEBIAN_PRETTY=$(grep '^PRETTY_NAME=' /etc/os-release 2>/dev/null | cut -d'"' -f2 || echo "")
        KERNEL=$(uname -r 2>/dev/null || echo "")
        CPU=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | sed 's/^ *//' | head -c 60)
        CPU_USO=$(top -bn2 -d 0.5 2>/dev/null | grep "Cpu(s)" | tail -1 | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk '{printf "%d", 100 - $1}')
        RAM_TOTAL=$(free -b 2>/dev/null | awk '/^Mem:/{print $2}')
        RAM_USADO=$(free -b 2>/dev/null | awk '/^Mem:/{print $3}')
        DISCO_INFO=$(df -B1 / 2>/dev/null | tail -1 | awk '{print $2" "$3}')
        DISCO_TOTAL=$(echo "$DISCO_INFO" | awk '{print $1}')
        DISCO_USADO=$(echo "$DISCO_INFO" | awk '{print $2}')
        UPTIME=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)
        BOOT_TIME=$(uptime -s 2>/dev/null || echo "")
        FIREWALL=$(systemctl is-active ufw 2>/dev/null || echo "inativo")
        FIREWALL_ZONA=$(ufw status 2>/dev/null | head -1 | grep -oP 'active|inactive' || echo "-")
        SELINUX=$(getenforce 2>/dev/null || echo "N/A")
        SELINUX_MODO=$(grep '^SELINUX=' /etc/selinux/config 2>/dev/null | cut -d= -f2 || echo "-")
        PROCESSOS=$(ps -e --no-headers 2>/dev/null | wc -l)

        KSM_RUN=$(cat /sys/kernel/mm/ksm/run 2>/dev/null || echo "0")
        KSM_PAGES_SAVED=$(cat /sys/kernel/mm/ksm/pages_sharing 2>/dev/null || echo "0")
        TCP_CONGESTION=$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || echo "unknown")
        MAX_MAP_COUNT=$(sysctl -n vm.max_map_count 2>/dev/null || echo "65530")
        PIPEWIRE_QUANTUM=$(pw-metadata -n settings 0 clock.quantum 2>/dev/null | grep -oP 'value:\\K\\d+' | head -1 || echo "1024")

        echo "debian_version=$DEBIAN_VERSION"
        echo "debian_pretty=$DEBIAN_PRETTY"
        echo "kernel=$KERNEL"
        echo "cpu=$CPU"
        echo "cpu_uso=$CPU_USO"
        echo "ram_total=$RAM_TOTAL"
        echo "ram_usado=$RAM_USADO"
        echo "disco_total=$DISCO_TOTAL"
        echo "disco_usado=$DISCO_USADO"
        echo "uptime=$UPTIME"
        echo "boot_time=$BOOT_TIME"
        echo "firewall=$FIREWALL"
        echo "firewall_zona=$FIREWALL_ZONA"
        echo "selinux=$SELINUX"
        echo "selinux_modo=$SELINUX_MODO"
        echo "processos=$PROCESSOS"
        echo "ksm_run=$KSM_RUN"
        echo "ksm_pages_saved=$KSM_PAGES_SAVED"
        echo "tcp_congestion=$TCP_CONGESTION"
        echo "max_map_count=$MAX_MAP_COUNT"
        echo "pipewire_quantum=$PIPEWIRE_QUANTUM"
        `;

        _execReadOnly(script, 8000).then(function(stdout) {
            const raw = _parseChaveValor(stdout);
            // Campo `debian` no lugar do antigo `fedora` — o JSON do
            // /system-info agora é semântico para o DAP. O frontend
            // (diagnostico.html) lê `debian` diretamente.
            const obj = {
                debian: raw.debian_pretty || raw.debian_version || '',
                debian_version: raw.debian_version || '',
                kernel: raw.kernel || '',
                cpu: raw.cpu || '',
                cpu_uso: raw.cpu_uso ? parseInt(raw.cpu_uso, 10) : null,
                                         ram_total: raw.ram_total ? parseInt(raw.ram_total, 10) : null,
                                         ram_usado: raw.ram_usado ? parseInt(raw.ram_usado, 10) : null,
                                         disco_total: raw.disco_total ? parseInt(raw.disco_total, 10) : null,
                                         disco_usado: raw.disco_usado ? parseInt(raw.disco_usado, 10) : null,
                                         uptime: raw.uptime ? parseInt(raw.uptime, 10) : null,
                                         boot_time: raw.boot_time || '',
                                         firewall: raw.firewall || 'desconhecido',
                                         firewall_zona: raw.firewall_zona || '-',
                                         selinux: raw.selinux || 'desconhecido',
                                         selinux_modo: raw.selinux_modo || '-',
                                         processos: raw.processos ? parseInt(raw.processos, 10) : null,
                                         ksm_run: raw.ksm_run || '0',
                                         ksm_pages_saved: raw.ksm_pages_saved || '0',
                                         tcp_congestion: raw.tcp_congestion || 'unknown',
                                         max_map_count: raw.max_map_count || '65530',
                                         pipewire_quantum: raw.pipewire_quantum || '1024'
            };
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            res.end(JSON.stringify(obj));
        }).catch(function() {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ erro: 'Falha ao coletar informações do sistema' }));
        });
        return;
    }

    // ----------------------------------------------------------
    // /top-processes — top 5 por CPU e por RAM
    // ----------------------------------------------------------
    if (req.method === 'GET' && url === '/top-processes') {
        const scriptCpu = `ps -eo pcpu,comm --sort=-pcpu --no-headers 2>/dev/null | head -5`;
        const scriptRam = `ps -eo pmem,rss,comm --sort=-rss --no-headers 2>/dev/null | head -5`;

        Promise.all([
            _execReadOnly(scriptCpu, 4000),
                    _execReadOnly(scriptRam, 4000)
        ]).then(function(resultados) {
            const cpuOut = resultados[0] || '';
            const ramOut = resultados[1] || '';

            const cpu = cpuOut.split('\n').filter(Boolean).map(function(linha) {
                const partes = linha.trim().split(/\s+/);
                const pct = parseFloat(partes[0]) || 0;
                const nome = partes.slice(1).join(' ') || '?';
                return { nome: nome, cpu: pct.toFixed(1) };
            });

            const ram = ramOut.split('\n').filter(Boolean).map(function(linha) {
                const partes = linha.trim().split(/\s+/);
                const rssKb = parseInt(partes[1], 10) || 0;
                const nome = partes.slice(2).join(' ') || '?';
                const mb = (rssKb / 1024).toFixed(0);
                return { nome: nome, ram: mb + ' MB' };
            });

            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            res.end(JSON.stringify({ cpu: cpu, ram: ram }));
        }).catch(function() {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ cpu: [], ram: [] }));
        });
        return;
    }

    // ----------------------------------------------------------
    // /disk-usage — partições montadas
    // ----------------------------------------------------------
    if (req.method === 'GET' && url === '/disk-usage') {
        const script = `df -B1 --output=source,size,used,avail,pcent,target 2>/dev/null | tail -n +2 | grep -v -E "^(tmpfs|devtmpfs|efivarfs|squashfs|overlay)" | grep -v -E "\\s/(run|sys|proc|dev)(/|$)"`;

        _execReadOnly(script, 5000).then(function(stdout) {
            const particoes = stdout.split('\n').filter(Boolean).map(function(linha) {
                const partes = linha.trim().split(/\s+/);
                if (partes.length < 6) return null;
                return {
                    dispositivo: partes[0],
                    total: parseInt(partes[1], 10) || 0,
                                                                     usado: parseInt(partes[2], 10) || 0,
                                                                     livre: parseInt(partes[3], 10) || 0,
                                                                     percentual: partes[4],
                                                                     montagem: partes.slice(5).join(' ')
                };
            }).filter(Boolean);

            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            res.end(JSON.stringify({ particoes: particoes }));
        }).catch(function() {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ particoes: [] }));
        });
        return;
    }

    // ----------------------------------------------------------
    // /journal-errors — erros agrupados das últimas 24h
    // ----------------------------------------------------------
    if (req.method === 'GET' && url === '/journal-errors') {
        const script = `journalctl -p err -S "24 hours ago" -o short 2>/dev/null | grep -v "^-- " | tail -200`;

        _execReadOnly(script, 10000).then(function(stdout) {
            const grupos = {};
            const linhas = stdout.split('\n').filter(function(l) {
                return l.trim() && !l.startsWith('-- ');
            });

            linhas.forEach(function(linha) {
                var match = linha.match(/^\w{3}\s+\d+\s+\d+:\d+:\d+\s+\S+\s+([^\[:\s]+)(?:\[\d+\])?:\s*(.*)$/);
                if (!match) return;
                var origem = match[1];
                var mensagem = match[2] ? match[2].substring(0, 120) : '';

                if (!grupos[origem]) {
                    grupos[origem] = { origem: origem, contagem: 0, exemplo: '' };
                }
                grupos[origem].contagem++;
                if (!grupos[origem].exemplo && mensagem) {
                    grupos[origem].exemplo = mensagem;
                }
            });

            var lista = Object.values(grupos).sort(function(a, b) {
                return b.contagem - a.contagem;
            }).slice(0, 15);

            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            res.end(JSON.stringify({ grupos: lista }));
        }).catch(function() {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ grupos: [] }));
        });
        return;
    }

    // ----------------------------------------------------------
    // /changelog — changelog da versão atual (parseado do CHANGELOG.md)
    // ----------------------------------------------------------
    if (req.method === 'GET' && url === '/changelog') {
        var resultado = _lerChangelogVersao(DAP_VERSION);
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.end(JSON.stringify(resultado));
        return;
    }

    // ----------------------------------------------------------
    // /waydroid-status — status do container Android
    // ----------------------------------------------------------
    //
    // O campo `clean` é usado pelo frontend para decidir se o botão
    // de remoção do Waydroid deve ficar habilitado.
    if (req.method === 'GET' && url === '/waydroid-status') {
        exec('waydroid status 2>&1', { shell: '/bin/bash', timeout: 5000 }, (error, stdout, stderr) => {
            const output = ((stdout || '') + (stderr || '')).trim();

            let installed = true;
            let initialized = false;
            let running = false;

            // Detecção de "não instalado" multilíngue: o bash do Debian
            // emite mensagens localizadas ("comando não encontrado" em
            // PT-BR, "command not found" em EN). O `error` do exec
            // também é checado — o shell retorna 127 quando o comando
            // não existe.
            if (/command not found/i.test(output) ||
                /comando não encontrado/i.test(output) ||
                /No such file or directory/i.test(output) ||
                error) {
                installed = false;
                }

                if (output.indexOf('is not initialized') !== -1) {
                    initialized = false;
                } else if (output.indexOf('Session:') !== -1 || output.indexOf('Vendor type:') !== -1) {
                    initialized = true;
                    if (/Session:\s*RUNNING/i.test(output)) {
                        running = true;
                    }
                }

                const homeDir = HOME_DIR_USUARIO;
                const residualCmd =
                '[ -d /var/lib/waydroid ] && echo "residual" && exit 0; ' +
                '[ -d "' + homeDir + '/.local/share/waydroid" ] && echo "residual" && exit 0; ' +
                '[ -d "' + homeDir + '/.local/share/dap-waydroid" ] && echo "residual" && exit 0; ' +
                '[ -f "' + homeDir + '/.local/share/applications/Waydroid.desktop" ] && echo "residual" && exit 0; ' +
                '[ -f "' + homeDir + '/.local/share/applications/waydroid-helper.desktop" ] && echo "residual" && exit 0; ' +
                'echo "clean"';

                exec(residualCmd, { shell: '/bin/bash', timeout: 3000 }, (errResidual, stdoutResidual) => {
                    const residual = (stdoutResidual || '').trim();
                    const clean = (residual === 'clean') && !installed;

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        installed: installed,
                        initialized: initialized,
                        running: running,
                        clean: clean,
                        raw: output
                    }));
                });
        });
        return;
    }

    // ----------------------------------------------------------
    // /executar — executa comando (POST)
    // ----------------------------------------------------------
    //
    // IMPORTANTE: TODA a lógica (validação do body, rate limit,
    // despacho) roda DENTRO do req.on('end'). Só assim `comando` e
    // `idComando` estão definidos.
    if (req.method === 'POST' && url === '/executar') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const { comando, idComando } = JSON.parse(body);
                const isReversao = false;

                if (!comando || !idComando) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({
                        success: false,
                        output: 'Comando e ID são obrigatórios'
                    }));
                }

                if (!/^[a-zA-Z0-9_-]+$/.test(idComando)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({
                        success: false,
                        output: 'idComando inválido: use apenas letras, números, hífen e underline'
                    }));
                }

                if (!_podeExecutar(idComando)) {
                    res.writeHead(429, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({
                        success: false,
                        output: 'Aguarde um instante antes de executar novamente.'
                    }));
                }

                // Descarta o buffer de execuções anteriores do mesmo
                // idComando. Sem isso, um novo cliente SSE recebia o
                // replay da rodada anterior antes dos logs da nova.
                sseBuffers.delete(idComando);

                procederComExecucao(comando, idComando, isReversao, res);

            } catch (err) {
                console.error('[ERRO INTERNO]', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    output: 'Erro interno do servidor'
                }));
            }
        });
        return;
    }

    // ----------------------------------------------------------
    // 404
    // ----------------------------------------------------------
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Página não encontrada');
});

// ============================================================
// EVENTOS DO SERVIDOR
// ============================================================

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.error(`[ERRO]: A porta ${PORT} já está em uso.`);
        console.error(` Execute: kill -9 $(lsof -t -i:${PORT})`);
    } else {
        console.error('[Erro do servidor]:', e.message);
    }
});

process.on('SIGINT', () => {
    console.log('\n🛑 Encerrando servidor...');

    _processosAtivos.forEach(_matarArvoreProcessos);

    sseClients.forEach((clients) => {
        clients.forEach(client => {
            client.end();
        });
    });
    sseClients.clear();

    server.close(() => {
        console.log('✅ Servidor encerrado');
        process.exit(0);
    });
});

const HOST = '127.0.0.1';

server.listen(PORT, HOST, () => {
    const desktop = detectarDesktop();
    const metodo = obterMetodoAutenticacao();

    _limparLogsAntigos();

    console.log(`====================================================`);
    console.log(` 🐧 Debian Advantage Panel - Servidor de Automação v${DAP_VERSION}`);
    console.log(` 🌐 http://localhost:${PORT} (somente local — 127.0.0.1)`);
    console.log(` 🖥️ Desktop: ${desktop}`);
    console.log(` 🔐 Autenticação: ${metodo.descricao}`);
    console.log(` 🏠 HOME do usuário: ${HOME_DIR_USUARIO}`);
    console.log(` 👤 Usuário: ${USUARIO_REAL}`);
    console.log(` 📡 SSE: Ativo (logs em tempo real, com buffer de replay)`);
    console.log(` 📁 Arquivos estáticos: Ativo (HTML, CSS, JS, ícone)`);
    console.log(` 🌐 i18n: Ativo (locales em /locales/<lang>.json)`);
    console.log(` 📄 Páginas: index.html, guiado.html + sessões dinâmicas`);
    console.log(` 📝 Changelog: /changelog (lê CHANGELOG.md)`);
    console.log(` 🔧 Comandos SEM autenticação: dpkg-query, uname -r, gtk-launch, flatpak, systemctl --user, etc`);
    console.log(` 🎯 Comandos USER-CONTEXT (env ajustado): ${COMANDOS_USER_CONTEXT.join(', ')}`);
    console.log(` 📊 Progresso: .progresso.json (persistente no servidor)`);
    console.log(` 📱 Waydroid status: /waydroid-status`);
    console.log(` 📦 Flatpak instalados: /flatpak-installed`);
    console.log(` 🔌 Hardware scan: /hardware-scan (lê hardware_map.json)`);
    console.log(` 🧠 Kernels: /kernels`);
    console.log(` 🖥️ System info: /system-info (com KSM, BBR, max_map_count, PipeWire quantum)`);
    console.log(` 📈 Top processos: /top-processes`);
    console.log(` 💾 Uso de disco: /disk-usage`);
    console.log(` 📋 Erros do journal: /journal-errors`);
    console.log(` 🔁 Buffer SSE: ${SSE_BUFFER_MAX} mensagens por comando, TTL ${SSE_BUFFER_TTL_MS/1000}s`);
    console.log(` ⏱️ Timeout do reader de output: ${MAX_READER_DURATION_MS/60000}min`);
    console.log(` 🚦 Rate limit: ${RATE_LIMIT_MS}ms por idComando`);
    console.log(`====================================================`);
});
