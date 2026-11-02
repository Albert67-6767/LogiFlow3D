import './styles.css';
import { actions, getState } from './state/store.js';
import { exportProject, importProject, itemsToCSV, itemsFromCSV } from './core/io.js';
import { $ } from './ui/dom.js';
import { hydrateIcons } from './ui/icons.js';
import { toast } from './ui/toast.js';
import { mountHeader } from './ui/views/header.js';
import { mountSidebar, openSidebar } from './ui/views/sidebar.js';
import { mountPackingView, getScene, openItemsPanel } from './ui/views/packingView.js';
import { mountRouteView } from './ui/views/routeView.js';
import { mountMetricsView } from './ui/views/metricsView.js';
import { mountItemDialog, openItemDialog } from './ui/views/itemDialog.js';
import { mountTruckDialog } from './ui/views/truckDialog.js';
import { buildPrintReport } from './ui/views/printReport.js';
import { mountTheme } from './ui/theme.js';
import { mountNavigation } from './ui/views/navigationView.js';
import { mountProductsView } from './ui/views/productsView.js';
import { mountScanner } from './ui/scanner.js';

hydrateIcons();
mountTheme();
// Em celulares o painel de peso começa recolhido para não cobrir a cena.
if (window.matchMedia('(max-width: 639px)').matches) $('#weight-panel').open = false;
mountSidebar();
mountHeader();
mountPackingView();
mountRouteView();
mountMetricsView();
mountItemDialog();
mountTruckDialog();
mountNavigation();
mountScanner();
mountProductsView();

$('#btn-add-item').addEventListener('click', () => openItemDialog());

// ---------- Arquivos ----------
function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

$('#btn-export-json').addEventListener('click', () => {
    download(`logiflow-${stamp()}.json`, exportProject(getState()), 'application/json');
});

$('#btn-export-csv').addEventListener('click', () => {
    if (!getState().items.length) return toast('Não há itens para exportar.', { tone: 'warn' });
    download(`logiflow-itens-${stamp()}.csv`, itemsToCSV(getState().items), 'text/csv;charset=utf-8');
});

const fileInput = $('#file-input');
$('#btn-import').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
        const text = await file.text();
        if (/\.csv$/i.test(file.name) || file.type.includes('csv')) {
            const items = itemsFromCSV(text);
            const replace = getState().items.length === 0 ||
                confirm(`Importar ${items.length} itens.\n\nOK = substituir a carga atual\nCancelar = adicionar à carga atual`);
            if (replace) actions.clearAll();
            actions.addItems(items);
            toast(`${items.length} itens importados do CSV.`, { tone: 'ok' });
        } else {
            actions.loadProject(importProject(text));
            toast('Projeto carregado.', { tone: 'ok' });
        }
        openSidebar(false);
    } catch (err) {
        toast(err.message || 'Não foi possível ler o arquivo.', { tone: 'danger', duration: 8000 });
    }
});

$('#btn-reset-sample').addEventListener('click', () => {
    if (confirm('Substituir a carga atual pelo exemplo?')) actions.resetSample();
});
$('#btn-clear').addEventListener('click', () => {
    if (confirm('Remover todos os itens e distâncias?')) actions.clearAll();
});

// ---------- Impressão ----------
$('#btn-print').addEventListener('click', () => {
    openSidebar(false);
    window.print();
});
window.addEventListener('beforeprint', () => {
    if (document.body.dataset.print === 'labels') return; // impressão de etiquetas
    buildPrintReport(getScene()?.snapshot());
});

// ---------- Teclado ----------
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    openSidebar(false);
    openItemsPanel(false);
    if (getState().selectedId) actions.select(null);
});

// ---------- Capa ----------
// Fica um instante na tela (pelo menos ~1 s desde a abertura) e some suavemente.
{
    const splash = document.getElementById('splash');
    const wait = Math.max(0, 1100 - performance.now());
    setTimeout(() => {
        splash.style.opacity = '0';
        setTimeout(() => splash.remove(), 550);
    }, wait);
}
