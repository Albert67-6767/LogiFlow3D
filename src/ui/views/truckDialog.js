import { CABIN_TYPES, FUEL_LABELS } from '../../config/constants.js';
import { validateTruck } from '../../core/fleet.js';
import { actions, getState } from '../../state/store.js';
import { $, h, render } from '../dom.js';
import { bindDialogClose, decimal, focusFirstError, showErrors } from '../form.js';
import { num } from '../format.js';
import { toast } from '../toast.js';

const DEFAULTS = { name: '', w: 1.8, h: 1.8, d: 3, payload: 1500, kmPerLiter: 9, fuel: 'diesel', cabin: 'auto' };
const FIELDS = ['name', 'w', 'h', 'd', 'payload', 'kmPerLiter', 'fuel', 'cabin'];

let editingId = null;

const dialog = () => $('#truck-dialog');
const form = () => $('#truck-form');

const readForm = () => Object.fromEntries(FIELDS.map(k => [k, form().elements[k].value]));

/** Mostra volume calculado enquanto o usuário digita. */
function updateSummary() {
    const { value } = validateTruck(readForm(), {});
    $('#truck-summary').textContent = value
        ? `Volume ${num(value.w * value.h * value.d, 2)} m³ · ${num(value.payload / (value.w * value.h * value.d), 0)} kg/m³`
        : 'Preencha as medidas para ver o volume.';
}

/** Abre o formulário. Sem `id` = novo veículo; com `id` = editar. */
export function openTruckDialog(id = null) {
    const f = form();
    editingId = id;
    const v = id ? getState().trucks[id] : DEFAULTS;

    f.elements.name.value = v.name;
    for (const k of ['w', 'h', 'd', 'payload', 'kmPerLiter']) f.elements[k].value = decimal(v[k]);
    f.elements.fuel.value = v.fuel;
    f.elements.cabin.value = v.cabin ?? 'auto';

    $('#truck-dialog-title').textContent = id ? 'Editar Veículo' : 'Novo Veículo';
    $('#truck-submit').textContent = id ? 'Salvar alterações' : 'Adicionar veículo';
    showErrors(f, {});
    updateSummary();

    dialog().showModal();
    f.elements.name.focus();
}

function close() {
    dialog().close();
    editingId = null;
}

export function mountTruckDialog() {
    const f = form();
    render(f.elements.fuel, Object.entries(FUEL_LABELS).map(([value, label]) => h('option', { value }, label)));
    render(f.elements.cabin, Object.entries(CABIN_TYPES).map(([value, label]) => h('option', { value }, label)));

    bindDialogClose(dialog(), close);
    f.addEventListener('input', updateSummary);

    f.addEventListener('submit', (e) => {
        e.preventDefault();
        const raw = readForm();
        const { errors } = validateTruck(raw, getState().trucks, editingId);
        showErrors(f, errors);
        if (Object.keys(errors).length) return focusFirstError(f);

        if (editingId) {
            actions.updateTruck(editingId, raw);
            toast('Veículo atualizado.', { tone: 'ok' });
        } else {
            actions.addTruck(raw);
            toast(`"${raw.name.trim()}" adicionado e selecionado.`, { tone: 'ok' });
        }
        close();
    });
}

/** Remove com opção de desfazer. */
export function confirmRemoveTruck(id) {
    const truck = getState().trucks[id];
    try {
        const undo = actions.removeTruck(id);
        toast(`"${truck.name}" removido.`, { action: { label: 'Desfazer', run: undo } });
    } catch (err) {
        toast(err.message, { tone: 'warn' });
    }
}
