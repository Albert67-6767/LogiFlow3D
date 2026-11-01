import QRCode from 'qrcode';
import { findByCode, generateCode, itemFromProduct, validateProduct } from '../../core/products.js';
import { actions, getState, watch } from '../../state/store.js';
import { $, h, render } from '../dom.js';
import { bindDialogClose, decimal, focusFirstError, showErrors } from '../form.js';
import { dims, int, num } from '../format.js';
import { icon } from '../icons.js';
import { scanCode } from '../scanner.js';
import { toast } from '../toast.js';
import { openItemDialog } from './itemDialog.js';

/*
 * Aba "Produtos & Etiquetas": catálogo com código de barras / QR code.
 * Ler o código de um produto cadastrado já preenche a carga (medidas, peso, frágil).
 */

// ---------- Leitura → carga ----------

/** Lê um código e abre "Adicionar Carga" preenchida. Código novo abre o cadastro antes. */
export async function addFromScan() {
    const code = await scanCode({ title: 'Ler código do produto' });
    if (!code) return;
    const found = findByCode(getState().products, code);
    if (found) {
        openItemDialog({ preset: itemFromProduct(found[1]) });
        return;
    }
    openProductDialog({
        code,
        notice: `O código ${code} ainda não está cadastrado. Preencha os dados do produto uma vez; nas próximas leituras a carga já vem pronta.`,
        onSaved: (product) => openItemDialog({ preset: itemFromProduct(product) }),
    });
}

// ---------- Cadastro ----------

const FIELDS = ['code', 'name', 'w', 'h', 'd', 'weight'];
const DEFAULTS = { code: '', name: '', w: 0.4, h: 0.3, d: 0.4, weight: 10, fragile: false };
let editing = null; // { id, onSaved }

const productForm = () => $('#product-form');

function readProductForm() {
    const f = productForm();
    return { ...Object.fromEntries(FIELDS.map(k => [k, f.elements[k].value])), fragile: f.elements.fragile.checked };
}

/** Abre o cadastro. Com `id` edita; `code` pré-preenche; `onSaved(produto)` roda após salvar. */
export function openProductDialog({ id = null, code = '', notice = '', onSaved = null } = {}) {
    const f = productForm();
    editing = { id, onSaved };
    const v = id ? getState().products[id] : { ...DEFAULTS, code };
    f.elements.code.value = v.code;
    f.elements.name.value = v.name;
    for (const k of ['w', 'h', 'd', 'weight']) f.elements[k].value = decimal(v[k]);
    f.elements.fragile.checked = !!v.fragile;

    $('#product-dialog-title').textContent = id ? 'Editar Produto' : 'Novo Produto';
    $('#product-submit').textContent = id ? 'Salvar alterações' : (onSaved ? 'Cadastrar e continuar' : 'Cadastrar');
    $('#product-notice').textContent = notice;
    $('#product-notice').hidden = !notice;
    showErrors(f, {});
    $('#product-dialog').showModal();
    (v.code ? f.elements.name : f.elements.code).focus();
}

function closeProductDialog() {
    $('#product-dialog').close();
    editing = null;
}

function mountProductDialog() {
    const f = productForm();
    bindDialogClose($('#product-dialog'), closeProductDialog);

    $('#p-scan').addEventListener('click', async () => {
        const code = await scanCode({ title: 'Ler código do produto' });
        if (code) { f.elements.code.value = code; f.elements.name.focus(); }
    });
    $('#p-generate').addEventListener('click', () => {
        f.elements.code.value = generateCode(getState().products);
        f.elements.name.focus();
    });

    f.addEventListener('submit', (e) => {
        e.preventDefault();
        const raw = readProductForm();
        const { value, errors } = validateProduct(raw, getState().products, editing?.id);
        showErrors(f, errors);
        if (!value) return focusFirstError(f);
        const { id, onSaved } = editing;
        if (id) {
            actions.updateProduct(id, raw);
            toast('Produto atualizado.', { tone: 'ok' });
        } else {
            actions.addProduct(raw);
            toast(`"${value.name}" cadastrado.`, { tone: 'ok' });
        }
        closeProductDialog();
        onSaved?.(value);
    });
}

function confirmRemove(id) {
    const product = getState().products[id];
    const undo = actions.removeProduct(id);
    if (undo) toast(`"${product.name}" removido.`, { action: { label: 'Desfazer', run: undo } });
}

// ---------- Etiquetas ----------

function openLabelsDialog(onlyId = null) {
    const products = Object.entries(getState().products);
    if (!products.length) return toast('Cadastre um produto antes de imprimir etiquetas.', { tone: 'warn' });
    const list = $('#labels-list');
    const updateTotal = () => {
        const total = [...list.querySelectorAll('input')].reduce((s, i) => s + (Math.max(0, parseInt(i.value, 10)) || 0), 0);
        $('#labels-total').textContent = `${total} etiqueta${total === 1 ? '' : 's'} · ${Math.ceil(total / 24) || 0} folha${Math.ceil(total / 24) === 1 ? '' : 's'}`;
    };
    render(list, products.map(([id, p]) => h('label', { class: 'flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2' },
        h('span', { class: 'min-w-0 flex-1' },
            h('span', { class: 'block truncate text-sm text-slate-200' }, p.name),
            h('span', { class: 'block truncate font-mono text-[11px] text-slate-500' }, p.code),
        ),
        h('input', {
            type: 'number', min: '0', max: '500', step: '1', class: 'input w-20 text-center font-mono',
            value: onlyId && onlyId !== id ? '0' : '1', dataset: { id }, 'aria-label': `Quantidade de etiquetas de ${p.name}`,
            oninput: updateTotal,
        }),
    )));
    updateTotal();
    $('#labels-dialog').showModal();
}

/** Monta as etiquetas e abre a impressão. */
async function printLabels(entries) {
    const products = getState().products;
    const labels = [];
    for (const [id, copies] of entries) {
        const p = products[id];
        if (!p || copies < 1) continue;
        const svgText = await QRCode.toString(p.code, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
        const svg = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement;
        for (let n = 0; n < copies; n++) {
            labels.push(h('div', { class: 'label-card' },
                svg.cloneNode(true),
                h('div', { class: 'label-text' },
                    h('span', { class: 'label-name' }, p.name),
                    h('span', { class: 'label-code' }, p.code),
                    h('span', { class: 'label-meta' }, `${dims(p)} · ${num(p.weight)} kg`),
                    p.fragile && h('span', { class: 'label-fragile' }, 'FRÁGIL'),
                ),
            ));
        }
    }
    if (!labels.length) return toast('Escolha pelo menos uma etiqueta.', { tone: 'warn' });
    render($('#print-labels'), labels);
    document.body.dataset.print = 'labels';
    window.addEventListener('afterprint', () => { delete document.body.dataset.print; }, { once: true });
    window.print();
}

function mountLabelsDialog() {
    const d = $('#labels-dialog');
    bindDialogClose(d, () => d.close());
    $('#labels-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const entries = [...$('#labels-list').querySelectorAll('input')]
            .map(i => [i.dataset.id, Math.min(500, Math.max(0, parseInt(i.value, 10) || 0))]);
        d.close();
        printLabels(entries);
    });
}

// ---------- Aba ----------

let query = '';

function productCard(id, p) {
    return h('li', { class: 'card flex min-w-0 flex-col gap-3 p-3 sm:p-4' },
        h('div', { class: 'flex items-start gap-3' },
            h('div', { class: 'flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400' }, icon('qr', 'size-5')),
            h('div', { class: 'min-w-0 flex-1' },
                h('p', { class: 'truncate font-semibold text-slate-100', title: p.name }, p.name),
                h('p', { class: 'truncate font-mono text-xs text-slate-400' }, p.code),
                h('p', { class: 'mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-slate-400' },
                    h('span', {}, dims(p)), h('span', {}, `${num(p.weight)} kg`),
                    p.fragile && h('span', { class: 'rounded border border-amber-500/40 px-1 font-sans text-[10px] font-semibold text-amber-300' }, 'FRÁGIL'),
                ),
            ),
            h('div', { class: 'flex shrink-0 gap-0.5' },
                h('button', { class: 'icon-btn', title: 'Imprimir etiqueta', 'aria-label': `Imprimir etiqueta de ${p.name}`, onclick: () => openLabelsDialog(id) }, icon('printer')),
                h('button', { class: 'icon-btn', title: 'Editar', 'aria-label': `Editar ${p.name}`, onclick: () => openProductDialog({ id }) }, icon('pencil')),
                h('button', { class: 'icon-btn hover:text-red-400', title: 'Remover', 'aria-label': `Remover ${p.name}`, onclick: () => confirmRemove(id) }, icon('trash')),
            ),
        ),
        h('button', { class: 'btn-subtle justify-center py-2', onclick: () => openItemDialog({ preset: itemFromProduct(p) }) },
            icon('plus', 'size-4'), 'Adicionar à carga'),
    );
}

function emptyState() {
    const step = (n, title, text) => h('li', { class: 'flex gap-3' },
        h('span', { class: 'flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 font-mono text-sm font-bold text-emerald-300' }, String(n)),
        h('span', {}, h('span', { class: 'block text-sm font-semibold text-slate-200' }, title), h('span', { class: 'block text-xs text-slate-400' }, text)),
    );
    return h('div', { class: 'card space-y-4 p-5' },
        h('p', { class: 'text-sm text-slate-300' }, 'Cadastre cada produto uma vez. Depois é só ler o código para a carga entrar com medidas e peso.'),
        h('ol', { class: 'space-y-3' },
            step(1, 'Cadastre', 'Toque em "Ler código" e aponte para o código de barras da caixa, ou em "Novo produto".'),
            step(2, 'Sem código?', 'No cadastro, toque em "Gerar" e imprima a etiqueta com QR code para colar na caixa.'),
            step(3, 'Carregue', 'Na hora de montar a carga, use "Ler código" no topo: o item já vem preenchido.'),
        ),
    );
}

export function mountProductsView() {
    mountProductDialog();
    mountLabelsDialog();

    const root = $('#products-root');
    const listEl = h('ul', { class: 'grid grid-cols-1 gap-3 sm:grid-cols-2' });
    const countEl = h('span', { class: 'font-mono text-slate-500' });
    const search = h('input', {
        class: 'input pl-9', type: 'search', placeholder: 'Buscar por nome ou código', 'aria-label': 'Buscar produto',
        oninput: (e) => { query = e.target.value; draw(getState()); },
    });

    render(root,
        h('div', { class: 'flex flex-wrap items-center justify-between gap-3' },
            h('h2', { class: 'flex items-center gap-2 text-lg font-semibold text-slate-100' }, icon('tag', 'size-5 text-emerald-400'), 'Produtos ', countEl),
            h('div', { class: 'flex flex-wrap gap-2' },
                h('button', { class: 'btn-primary', onclick: addFromScan }, icon('scan', 'size-4'), 'Ler código'),
                h('button', { class: 'btn-subtle', onclick: () => openProductDialog() }, icon('plus', 'size-4'), 'Novo produto'),
                h('button', { class: 'btn-subtle', onclick: () => openLabelsDialog() }, icon('printer', 'size-4'), 'Etiquetas'),
            ),
        ),
        h('div', { class: 'relative' }, h('span', { class: 'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500' }, icon('search', 'size-4')), search),
        listEl,
    );

    function draw(s) {
        const all = Object.entries(s.products).sort(([, a], [, b]) => a.name.localeCompare(b.name, 'pt-BR'));
        countEl.textContent = `(${int(all.length)})`;
        search.parentElement.hidden = all.length < 2;
        const q = query.trim().toLowerCase();
        const shown = q ? all.filter(([, p]) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)) : all;
        if (!all.length) render(listEl, h('li', { class: 'sm:col-span-2' }, emptyState()));
        else if (!shown.length) render(listEl, h('li', { class: 'p-4 text-sm text-slate-400 sm:col-span-2' }, 'Nenhum produto encontrado.'));
        else render(listEl, shown.map(([id, p]) => productCard(id, p)));
    }
    watch(s => [s.products], draw);

    $('#btn-scan').addEventListener('click', addFromScan);
}
