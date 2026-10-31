import { actions, getDerived, getState } from '../../state/store.js';
import { validateItem } from '../../core/validation.js';
import { newId } from '../../core/io.js';
import { $, h, render } from '../dom.js';
import { bindDialogClose, decimal, focusFirstError, showErrors } from '../form.js';
import { icon } from '../icons.js';
import { toast } from '../toast.js';

const DEFAULTS = { label: '', address: '', w: 0.6, h: 0.5, d: 0.6, weight: 50, quantity: 1, fragile: false };

let editingId = null;

const dialog = () => $('#item-dialog');
const form = () => $('#item-form');

function readForm() {
    const f = form();
    return {
        label: f.label.value, address: f.address.value,
        w: f.w.value, h: f.h.value, d: f.d.value,
        weight: f.weight.value, stop: f.stop.value,
        quantity: editingId ? 1 : f.quantity.value,
        fragile: f.fragile.checked,
    };
}

function showWarnings(warnings) {
    render($('#item-warnings'), warnings.map(w =>
        h('p', { class: 'flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300' },
            icon('warn', 'mt-px size-3.5'), w)));
}

/** Abre o formulário. Sem `item` = adicionar; com `item` = editar. */
export function openItemDialog({ item } = {}) {
    const f = form();
    editingId = item?.id ?? null;
    const state = getState();
    const nextStop = state.items.length ? Math.max(...state.items.map(i => i.stop)) : 1;
    const v = item ?? { ...DEFAULTS, stop: nextStop };

    f.label.value = v.label;
    f.address.value = v.address ?? '';
    f.w.value = decimal(v.w);
    f.h.value = decimal(v.h);
    f.d.value = decimal(v.d);
    f.weight.value = decimal(v.weight);
    f.stop.value = v.stop;
    f.quantity.value = 1;
    f.fragile.checked = !!v.fragile;

    $('#item-dialog-title').textContent = item ? 'Editar Carga' : 'Adicionar Carga';
    $('#item-submit').textContent = item ? 'Salvar alterações' : 'Adicionar ao Baú';
    $('#quantity-field').hidden = Boolean(item);
    showErrors(f, {});
    showWarnings([]);

    dialog().showModal();
    f.label.focus();
    f.label.select();
}

function close() {
    dialog().close();
    editingId = null;
}

export function mountItemDialog() {
    const d = dialog();
    const f = form();

    bindDialogClose(d, close);

    // Avisos em tempo real (não bloqueiam).
    f.addEventListener('input', () => {
        const { warnings } = validateItem(readForm(), getDerived().truck);
        showWarnings(warnings);
    });

    f.addEventListener('submit', (e) => {
        e.preventDefault();
        const { value, errors } = validateItem(readForm(), getDerived().truck);
        showErrors(f, errors);
        if (!value) return focusFirstError(f);
        const { quantity, ...data } = value;

        if (editingId) {
            actions.updateItem(editingId, data);
            toast('Carga atualizada.', { tone: 'ok' });
        } else {
            const items = Array.from({ length: quantity }, (_, n) => ({
                id: newId(),
                ...data,
                label: quantity > 1 ? `${data.label} (${n + 1}/${quantity})` : data.label,
            }));
            actions.addItems(items);
            const unplaced = items.filter(i => getDerived().unplacedById.has(i.id)).length;
            if (unplaced) toast(`${unplaced} de ${items.length} não couberam no baú.`, { tone: 'warn' });
            else toast(items.length > 1 ? `${items.length} cargas adicionadas.` : 'Carga adicionada.', { tone: 'ok' });
        }
        close();
    });
}
