// ============================================================
// DAP — Detecção de hardware e sugestão de drivers (Debian)
// ============================================================
//
// Este módulo é usado pelo server.js para o endpoint /hardware-scan.
// Não depende de bibliotecas externas — usa apenas child_process e
// fs (ambos nativos). Roda os comandos lspci, lsusb, dpkg-query e
// nvidia-detect, cruza com o hardware_map.json e devolve uma lista
// de dispositivos detectados com estado de driver.
//
// Diferenças em relação ao FAP:
//   - `rpm -q` → `dpkg-query -W -f='${Status}'`
//   - Detecção NVIDIA via `nvidia-detect` (pacote oficial do Debian)
//   - Não há conceito de "COPR" nem "akmod" no Debian
//   - Verificação de repositório ativo via leitura dos sources

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const HARDWARE_MAP_PATH = path.join(__dirname, 'hardware_map.json');

// ============================================================
// HELPERS INTERNOS
// ============================================================

function _exec(cmd, timeoutMs) {
    return new Promise(function(resolve) {
        exec(cmd, {
            shell: '/bin/bash',
            timeout: timeoutMs || 5000,
            maxBuffer: 5 * 1024 * 1024,
            env: process.env
        }, function(error, stdout, stderr) {
            resolve({
                ok: !error,
                stdout: (stdout || '').trim(),
                    stderr: (stderr || '').trim()
            });
        });
    });
}

function _lerMapa() {
    try {
        var bruto = JSON.parse(fs.readFileSync(HARDWARE_MAP_PATH, 'utf8'));
        return {
            pci_vendors: bruto.pci_vendors || {},
            usb_devices: bruto.usb_devices || {}
        };
    } catch (e) {
        console.error('[hardware-service] Erro ao ler hardware_map.json:', e.message);
        return { pci_vendors: {}, usb_devices: {} };
    }
}

// ============================================================
// VERIFICAÇÃO DE PACOTE INSTALADO (dpkg)
// ============================================================
//
// dpkg-query -W -f='${Status}' devolve "install ok installed"
// quando o pacote está instalado corretamente. Qualquer outro
// valor significa: não instalado, meio instalado, ou removido.

async function _pacoteInstalado(pkg) {
    if (!pkg) return false;
    var pkgSeguro = String(pkg).replace(/'/g, "'\\''");
    var r = await _exec("dpkg-query -W -f='${Status}' '" + pkgSeguro + "' 2>/dev/null");
    if (!r.ok) return false;
    return r.stdout === 'install ok installed';
}

// ============================================================
// VERIFICAÇÃO DE REPOSITÓRIO ATIVO
// ============================================================
//
// No Debian, o repo pode estar no formato deb822 (.sources) ou
// no formato legado (.list). O DAP suporta os dois.

async function _repositorioAtivo(nome) {
    if (!nome) return true;  // 'main' sempre disponível

    if (nome === 'main') return true;

    // Lê tanto .sources quanto .list
    var cmd =
    'grep -rhE "^(Components:|deb )" /etc/apt/sources.list.d/*.sources /etc/apt/sources.list 2>/dev/null | ' +
    'grep -iE "\\b' + nome + '\\b" | head -1';

    var r = await _exec(cmd);
    return r.stdout.length > 0;
}

async function _driverKernelEmUso(pciAddress) {
    var r = await _exec('lspci -k -s ' + pciAddress + ' 2>/dev/null');
    if (!r.ok) return null;
    var match = r.stdout.match(/Kernel driver in use:\s*(\S+)/);
    return match ? match[1] : null;
}

// ============================================================
// DETECÇÃO NVIDIA (via nvidia-detect)
// ============================================================
//
// `nvidia-detect` é um pacote oficial do Debian que identifica a
// geração da GPU e sugere o pacote correto. Se não estiver
// instalado, cai num fallback via lspci que diferencia Turing+
// (open-kernel) de Maxwell/Pascal/Volta e anteriores (proprietário).

async function _nvidiaDetect() {
    // Tenta nvidia-detect primeiro (fonte oficial de verdade)
    var r = await _exec('nvidia-detect 2>/dev/null');
    if (r.ok && r.stdout) {
        // nvidia-detect devolve algo como:
        //   "Detected NVIDIA GPUs:
        //    ...
        //    Your card is supported by the default drivers.
        //    It is recommended to install the nvidia-driver package."
        //
        // Ou, para GPUs antigas:
        //   "Your card is only supported up to the 470 legacy drivers series."
        //
        // Parseamos a recomendação e devolvemos o pacote.

        if (/only supported up to the 470/i.test(r.stdout)) {
            return { pkg: 'nvidia-kernel-dkms', flavour: 'legacy-470', source: 'nvidia-detect' };
        }
        if (/only supported up to the 390/i.test(r.stdout)) {
            return { pkg: 'nvidia-kernel-dkms', flavour: 'legacy-390', source: 'nvidia-detect' };
        }
        if (/default drivers/i.test(r.stdout)) {
            return { pkg: 'nvidia-open-kernel-dkms', flavour: 'open', source: 'nvidia-detect' };
        }
    }

    // Fallback: heurística por modelo detectado via lspci
    var pci = await _exec("lspci -nn | grep -iE 'nvidia.*(vga|3d|display)'");
    if (!pci.ok || !pci.stdout) {
        return null;
    }

    var modelo = pci.stdout;

    // Turing+ → RTX 20xx / GTX 16xx / RTX 30xx / RTX 40xx / RTX 50xx
    // Também cobre datacenter (T4, A100, H100) e workstation (Quadro RTX)
    if (/RTX\s+(20|30|40|50)\d{2}/i.test(modelo) ||
        /GTX\s+16\d{2}/i.test(modelo) ||
        /T4|A100|H100|A30|L4|L40/i.test(modelo)) {
        return { pkg: 'nvidia-open-kernel-dkms', flavour: 'open', source: 'lspci-heuristic' };
        }

        // Maxwell / Pascal / Volta → GTX 750/9xx/10xx, Titan (V/X), Quadro P
        if (/GTX\s+(75|9|10)\d{2}/i.test(modelo) ||
            /Titan\s+(V|X)/i.test(modelo) ||
            /Quadro\s+P\d/i.test(modelo)) {
            return { pkg: 'nvidia-kernel-dkms', flavour: 'legacy-mid', source: 'lspci-heuristic' };
            }

            // Kepler e anteriores → GTX 6xx/7xx, Fermi, etc.
            if (/GTX\s+[67]\d{2}/i.test(modelo) ||
                /GT\s+[4-7]\d{2}/i.test(modelo)) {
                return { pkg: 'nvidia-kernel-dkms', flavour: 'legacy-old', source: 'lspci-heuristic' };
                }

                // Fallback genérico: instala open-kernel (padrão do Debian 13)
                return { pkg: 'nvidia-open-kernel-dkms', flavour: 'default', source: 'lspci-heuristic' };
}

// ============================================================
// PARSERS
// ============================================================

// Parse de linha do lspci -nn:
// "01:00.0 VGA compatible controller [0300]: NVIDIA Corporation GA106 [GeForce RTX 3060] [10de:2504]"
function _parseLinhaPci(linha) {
    var match = linha.match(/^([0-9a-f:\.]+)\s+([^:]+):\s+(.+?)\s+\[([0-9a-f]{4}):([0-9a-f]{4})\]/i);
    if (!match) return null;
    return {
        pci_address: match[1],
        category_raw: match[2].trim(),
        name: match[3].trim(),
        vendor_id: match[4].toLowerCase(),
        device_id: match[5].toLowerCase()
    };
}

function _parseLinhaUsb(linha) {
    var match = linha.match(/ID\s+([0-9a-f]{4}):([0-9a-f]{4})\s+(.+)/i);
    if (!match) return null;
    return {
        vendor_id: match[1].toLowerCase(),
        product_id: match[2].toLowerCase(),
        name: match[3].trim()
    };
}

// ============================================================
// DETECÇÃO PRINCIPAL
// ============================================================

async function scanHardware() {
    var mapa = _lerMapa();
    var devices = [];

    // Estado dos repositórios (para o frontend mostrar banner)
    var nonFreeAtivo = await _repositorioAtivo('non-free');
    var nonFreeFirmwareAtivo = await _repositorioAtivo('non-free-firmware');
    var backportsAtivo = await _repositorioAtivo('backports');
    var secureBoot = await _checkSecureBoot();

    // ---------- PCI ----------
    var pci = await _exec('lspci -nn');
    if (pci.ok) {
        var linhasPci = pci.stdout.split('\n').filter(Boolean);

        var candidatosPci = [];
        for (var i = 0; i < linhasPci.length; i++) {
            var parsed = _parseLinhaPci(linhasPci[i]);
            if (!parsed) continue;

            var vendor = mapa.pci_vendors[parsed.vendor_id];
            if (!vendor) continue;

            var isGpu = /VGA|3D|Display/i.test(parsed.category_raw);
            var isNet = /Network|Ethernet/i.test(parsed.category_raw);
            if (!isGpu && !isNet) continue;

            candidatosPci.push({ parsed: parsed, vendor: vendor });
        }

        var resultadosPci = await Promise.all(candidatosPci.map(async function(c) {
            var parsed = c.parsed;
            var vendor = c.vendor;

            var driverEmUso = await _driverKernelEmUso(parsed.pci_address);

            var conflict = vendor.conflict_check || [];
            var driverPadraoOk = !!driverEmUso && conflict.indexOf(driverEmUso) !== -1;

            var pacotesSugeridos = (vendor.packages || []).slice();
            var nvidiaInfo = null;

            // NVIDIA tem lógica especial
            if (parsed.vendor_id === '10de') {
                nvidiaInfo = await _nvidiaDetect();
                if (nvidiaInfo) {
                    if (nvidiaInfo.pkg === 'nvidia-open-kernel-dkms') {
                        pacotesSugeridos = ['nvidia-open-kernel-dkms', 'nvidia-driver', 'firmware-misc-nonfree'];
                    } else {
                        pacotesSugeridos = ['nvidia-kernel-dkms', 'nvidia-driver', 'firmware-misc-nonfree'];
                    }
                } else {
                    pacotesSugeridos = ['nvidia-open-kernel-dkms', 'nvidia-driver', 'firmware-misc-nonfree'];
                }
            }

            // Checa se algum pacote sugerido está instalado
            var instalado = false;
            for (var j = 0; j < pacotesSugeridos.length; j++) {
                if (await _pacoteInstalado(pacotesSugeridos[j])) {
                    instalado = true;
                    break;
                }
            }

            // Driver recomendado já está em uso?
            var usandoDriverRecomendado = false;
            if (parsed.vendor_id === '10de') {
                // NVIDIA: considera "recomendado em uso" se o kernel
                // module carregado for nvidia/nvidia_drm
                usandoDriverRecomendado = driverEmUso === 'nvidia' || driverEmUso === 'nvidia_drm';
            } else if (parsed.vendor_id === '1002' || parsed.vendor_id === '1022') {
                // AMD: driver amdgpu é o recomendado
                usandoDriverRecomendado = driverEmUso === 'amdgpu';
            } else if (parsed.vendor_id === '8086') {
                // Intel: driver i915 é o recomendado
                usandoDriverRecomendado = driverEmUso === 'i915' || driverEmUso === 'xe';
            } else {
                usandoDriverRecomendado = true; // outros vendors, sem recomendação
            }

            return {
                type: 'PCI',
                pci_address: parsed.pci_address,
                category: vendor.category,
                vendor: vendor.name,
                name: parsed.name,
                device_id: parsed.vendor_id + ':' + parsed.device_id,
                driver_in_use: driverEmUso,
                driver_default_working: driverPadraoOk,
                driver_recommended_in_use: usandoDriverRecomendado,
                installed: instalado,
                packages: pacotesSugeridos,
                repo_required: vendor.repo_required || null,
                nvidia_info: nvidiaInfo,
                notes: vendor.notes || null,
                notes_key: vendor.notesKey || null,
                needs_secure_boot_disabled: parsed.vendor_id === '10de'
            };
        }));

        for (var kp = 0; kp < resultadosPci.length; kp++) {
            devices.push(resultadosPci[kp]);
        }
    }

    // ---------- USB ----------
    var usb = await _exec('lsusb');
    if (usb.ok) {
        var linhasUsb = usb.stdout.split('\n').filter(Boolean);

        var candidatosUsb = [];
        for (var k = 0; k < linhasUsb.length; k++) {
            var parsedUsb = _parseLinhaUsb(linhasUsb[k]);
            if (!parsedUsb) continue;

            var dev = mapa.usb_devices[parsedUsb.vendor_id + ':' + parsedUsb.product_id];
            if (!dev) continue;

            candidatosUsb.push({ parsedUsb: parsedUsb, dev: dev });
        }

        var resultadosUsb = await Promise.all(candidatosUsb.map(async function(c) {
            var parsedUsb = c.parsedUsb;
            var dev = c.dev;

            var instaladoUsb = false;
            if (dev.package) {
                instaladoUsb = await _pacoteInstalado(dev.package);
            }

            return {
                type: 'USB',
                category: dev.category,
                vendor: 'USB device',
                name: dev.name,
                device_id: parsedUsb.vendor_id + ':' + parsedUsb.product_id,
                driver_in_use: null,
                driver_default_working: false,
                driver_recommended_in_use: false,
                installed: instaladoUsb,
                packages: dev.package ? [dev.package] : [],
                repo_required: null,
                nvidia_info: null,
                notes: dev.notes || null,
                notes_key: dev.notesKey || null,
                needs_secure_boot_disabled: false
            };
        }));

        for (var ku = 0; ku < resultadosUsb.length; ku++) {
            devices.push(resultadosUsb[ku]);
        }
    }

    return {
        devices: devices,
        repos: {
            non_free: nonFreeAtivo,
            non_free_firmware: nonFreeFirmwareAtivo,
            backports: backportsAtivo
        },
        secure_boot: secureBoot
    };
}

async function _checkSecureBoot() {
    var r = await _exec('mokutil --sb-state 2>/dev/null');
    if (!r.ok) return 'unknown';
    var out = r.stdout.toLowerCase();
    if (out.includes('enabled')) return 'enabled';
    if (out.includes('disabled')) return 'disabled';
    return 'unknown';
}

async function checkPackageInstalled(pkg) {
    return _pacoteInstalado(pkg);
}

module.exports = {
    scanHardware: scanHardware,
    checkPackageInstalled: checkPackageInstalled
};
