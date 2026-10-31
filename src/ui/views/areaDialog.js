import { RISK_LEVELS } from '../../config/constants.js';
import { actions, getState } from '../../state/store.js';
import { $, h, render } from '../dom.js';
import { bindDialogClose, focusFirstError, showErrors } from '../form.js';
import { toast } from '../toast.js';

/*
 * Cadastro de "áreas de atenção": bairros ou trechos que a equipe considera
 * arriscados. O cálculo da rota penaliza caminhos que passam por elas.
 */

let editing = null; // { id } ao editar, { lat, lon } ao criar

const dialog = () => $('#area-dialog');
const form = () => $('#area-form');

function validate(raw) {
    const errors = {};
    const name = String(raw.name ?? '').trim();
    const radius = Number(raw.radius);
    if (!name) errors.name = 'Informe um nome.';
    if (!Number.isFinite(radius) || radius < 50 || radius > 20000) errors.radius = 'Use entre 50 e 20.000 m.';
    return { errors, value: { name, radius: Math.round(radius), level: Number(raw.level) || 1 } };
}

/** Abre para nova área no ponto `at` ({lat, lon}) ou para editar a área `id`. */
export function openAreaDialog({ id = null, at = null } = {}) {
    const f = form();
    const area = id ? getState().riskAreas.find(a => a.id === id) : null;
    editing = area ? { id } : { ...at };
    f.elements.name.value = area?.name ?? '';
    f.elements.radius.value = area?.radius ?? 600;
    f.querySelector(`input[name=level][value="${area?.level ?? 2}"]`).checked = true;
    $('#area-dialog-title').textContent = area ? 'Editar área de atenção' : 'Nova área de atenção';
    $('#area-delete').hidden = !area;
    showErrors(f, {});
    dialog().showModal();
    f.elements.name.focus();
}

function close() {
    dialog().close();
    editing = null;
}

export function mountAreaDialog() {
    const f = form();
    render($('#a-levels'), Object.entries(RISK_LEVELS).map(([value, lvl]) =>
        h('label', { class: 'flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-800 px-2 py-2 text-xs font-medium text-slate-300 has-checked:border-slate-500 has-checked:bg-slate-800' },
            h('input', { type: 'radio', name: 'level', value, class: 'sr-only' }),
            h('span', { class: 'size-2.5 rounded-full', style: { backgroundColor: lvl.color } }),
            lvl.label)));

    bindDialogClose(dialog(), close);

    $('#area-delete').addEventListener('click', () => {
        if (!editing?.id) return;
        const undo = actions.removeRiskArea(editing.id);
        close();
        toast('Área removida.', { action: { label: 'Desfazer', run: undo } });
    });

    f.addEventListener('submit', (e) => {
        e.preventDefault();
        const raw = { name: f.elements.name.value, radius: f.elements.radius.value, level: f.elements.level.value };
        const { errors, value } = validate(raw);
        showErrors(f, errors);
        if (Object.keys(errors).length) return focusFirstError(f);
        if (editing?.id) actions.updateRiskArea(editing.id, value);
        else actions.addRiskArea({ ...value, lat: editing.lat, lon: editing.lon });
        toast('Área salva. Recalcule a rota para buscar desvios.', { tone: 'ok' });
        close();
    });
}
