import { $ } from './dom.js';
import { bindDialogClose } from './form.js';

/*
 * Leitura de código de barras / QR code pela câmera.
 * Usa o leitor nativo do navegador quando existe (Chrome no Android) e, nos
 * demais (iPhone, computador), um leitor gratuito (ZXing) carregado na primeira
 * leitura. Também aceita o código digitado ou vindo de um leitor USB/Bluetooth.
 */

const FORMATS = ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'data_matrix'];

let detectorPromise = null;

function getDetector() {
    detectorPromise ??= (async () => {
        if ('BarcodeDetector' in window) {
            try {
                const supported = await window.BarcodeDetector.getSupportedFormats();
                const formats = FORMATS.filter(f => supported.includes(f));
                if (formats.includes('qr_code') && formats.includes('ean_13')) return new window.BarcodeDetector({ formats });
            } catch { /* cai no leitor gratuito */ }
        }
        const { BarcodeDetector } = await import('barcode-detector/ponyfill');
        return new BarcodeDetector({ formats: FORMATS });
    })();
    detectorPromise.catch(() => { detectorPromise = null; });
    return detectorPromise;
}

/** Bip curto e vibração ao ler. */
function feedback() {
    navigator.vibrate?.(80);
    try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 1400;
        gain.gain.value = 0.15;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.12);
        osc.onended = () => ctx.close();
    } catch { /* sem som */ }
}

const CAMERA_ERRORS = {
    NotAllowedError: 'Câmera bloqueada. Libere o acesso à câmera nas permissões do navegador, ou digite o código.',
    NotFoundError: 'Nenhuma câmera encontrada. Digite o código ou use um leitor USB/Bluetooth.',
    NotReadableError: 'A câmera está sendo usada por outro aplicativo.',
    SecurityError: 'A câmera só funciona em endereço https (ou localhost).',
};

let session = null; // leitura em andamento

function setStatus(text, tone = 'normal') {
    const el = $('#scan-status');
    el.textContent = text;
    el.className = `min-h-5 text-center text-sm ${tone === 'error' ? 'text-amber-300' : 'text-slate-300'}`;
}

function stop(result) {
    if (!session) return;
    const { resolve, stream, timer } = session;
    session = null;
    clearTimeout(timer);
    stream?.getTracks().forEach(t => t.stop());
    const video = $('#scan-video');
    video.pause();
    video.srcObject = null;
    const dialog = $('#scan-dialog');
    if (dialog.open) dialog.close();
    resolve(result);
}

async function startCamera(current) {
    const video = $('#scan-video');
    if (!navigator.mediaDevices?.getUserMedia) {
        setStatus(window.isSecureContext ? CAMERA_ERRORS.NotFoundError : CAMERA_ERRORS.SecurityError, 'error');
        return;
    }
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
        });
    } catch (err) {
        setStatus(CAMERA_ERRORS[err.name] ?? 'Não foi possível abrir a câmera. Digite o código.', 'error');
        return;
    }
    if (session !== current) { stream.getTracks().forEach(t => t.stop()); return; } // fechou enquanto pedia permissão
    current.stream = stream;
    video.srcObject = stream;
    await video.play().catch(() => {});

    let detector;
    try {
        setStatus('Preparando o leitor…');
        detector = await getDetector();
    } catch {
        setStatus('Não foi possível carregar o leitor (sem internet?). Digite o código.', 'error');
        return;
    }
    if (session !== current) return;
    setStatus('Aponte a câmera para o código de barras ou QR code.');

    let failures = 0;
    const tick = async () => {
        if (session !== current) return;
        if (video.readyState >= 2) {
            try {
                const codes = await detector.detect(video);
                const code = codes.find(c => c.rawValue?.trim())?.rawValue.trim();
                if (code && session === current) {
                    feedback();
                    stop(code);
                    return;
                }
            } catch {
                if (++failures === 5) setStatus('O leitor não está funcionando aqui. Digite o código.', 'error');
            }
        }
        current.timer = setTimeout(tick, 120);
    };
    tick();
}

/**
 * Abre o leitor. Resolve com o código lido/digitado, ou null se a pessoa fechar.
 * @returns {Promise<string|null>}
 */
export function scanCode({ title = 'Ler código' } = {}) {
    if (session) stop(null);
    return new Promise((resolve) => {
        const current = { resolve, stream: null, timer: null };
        session = current;
        $('#scan-dialog-title').lastChild.textContent = title;
        $('#scan-input').value = '';
        setStatus('Abrindo a câmera…');
        $('#scan-dialog').showModal();
        // Em computador o campo já fica pronto para leitor USB/Bluetooth (no celular abriria o teclado).
        if (window.matchMedia('(pointer: fine)').matches) $('#scan-input').focus();
        startCamera(current);
    });
}

export function mountScanner() {
    const dialog = $('#scan-dialog');
    bindDialogClose(dialog, () => stop(null));
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); stop(null); }); // tecla Esc
    $('#scan-manual').addEventListener('submit', (e) => {
        e.preventDefault();
        const code = $('#scan-input').value.trim();
        if (code) stop(code);
        else $('#scan-input').focus();
    });
}
