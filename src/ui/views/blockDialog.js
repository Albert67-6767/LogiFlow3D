import { ROAD_BLOCK } from '../../config/constants.js';
import { actions, getState } from '../../state/store.js';
import { h, render } from '../dom.js';
import { icon } from '../icons.js';
import { toast } from '../toast.js';

/*
 * Observação "não dá para passar": o motorista (ou a equipe) escolhe o motivo
 * com um toque, escreve um detalhe se quiser e diz se vale só para caminhão.
 * As próximas rotas desviam desse ponto. Usado no mapa da aba Rota e na navegação.
 */

const DIALOG_CLASS = 'm-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-0 text-slate-100 shadow-2xl backdrop:bg-slate-950/80 backdrop:backdrop-blur-sm';

let dialog = null;

function ensureDialog() {
    if (dialog) return dialog;
    dialog = h('dialog', { class: DIALOG_CLASS, 'aria-label': 'Rua sem passagem' });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    document.body.append(dialog);
    return dialog;
}

/**
 * Abre para nova observação no ponto `at` ({lat, lon}) ou para editar a `id`.
 * `onSaved(block)` roda depois de salvar (a navegação usa para recalcular).
 */
export function openBlockDialog({ id = null, at = null, scope = null, onSaved = null } = {}) {
    const dlg = ensureDialog();
    const block = id ? getState().roadBlocks.find(b => b.id === id) : null;
    let reason = block?.reason ?? null;
    let chosenScope = block?.scope ?? scope ?? 'truck';

    const note = h('textarea', {
        class: 'input min-h-16 resize-y', maxlength: 200, rows: 2,
        placeholder: 'Detalhe (opcional): ex. fio baixo na esquina, só passa carro pequeno',
    });
    note.value = block?.note ?? '';

    const save = h('button', { type: 'button', class: 'btn-primary flex-1 justify-center py-3 text-base', disabled: !reason, onclick: () => {
        const data = { reason, note: note.value.trim().slice(0, 200), scope: chosenScope };
        let saved;
        if (block) {
            actions.updateRoadBlock(block.id, data);
            saved = { ...block, ...data };
            toast('Observação atualizada. Recalcule a rota para desviar.', { tone: 'ok' });
        } else {
            const newId = actions.addRoadBlock({ ...data, lat: +at.lat.toFixed(6), lon: +at.lon.toFixed(6) });
            saved = getState().roadBlocks.find(b => b.id === newId);
            if (!onSaved) toast('Observação salva. As próximas rotas vão desviar deste ponto.', { tone: 'ok' });
        }
        dlg.close();
        onSaved?.(saved);
    } }, icon('ok', 'size-5'), 'Salvar observação');

    const reasons = ROAD_BLOCK.reasons.map(r => h('button', {
        type: 'button', class: 'seg-btn justify-start border-slate-700 px-3 py-3 text-left text-sm text-slate-200',
        'aria-pressed': String(r === reason),
        onclick: (e) => {
            reason = r;
            reasons.forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
            save.disabled = false;
            if (r === 'Outro motivo') note.focus();
        },
    }, r));

    const scopes = Object.entries(ROAD_BLOCK.scopes).map(([key, label]) => h('button', {
        type: 'button', class: 'seg-btn justify-center py-2 text-xs', 'aria-pressed': String(key === chosenScope),
        onclick: (e) => {
            chosenScope = key;
            scopes.forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        },
    }, label));

    render(dlg, h('div', { class: 'space-y-4 p-5' },
        h('div', { class: 'flex items-center gap-2' },
            icon('ban', 'size-5 text-red-400'),
            h('h3', { class: 'flex-1 text-base font-semibold text-slate-100' }, block ? 'Editar observação' : 'Não dá para passar aqui'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fechar', onclick: () => dlg.close() }, icon('x', 'size-5'))),
        block && h('p', { class: 'text-[11px] text-slate-500' }, `Registrada em ${new Date(block.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`),
        h('div', {},
            h('p', { class: 'label' }, 'Qual o problema?'),
            h('div', { class: 'grid grid-cols-1 gap-1.5 sm:grid-cols-2', role: 'group', 'aria-label': 'Motivo' }, reasons)),
        note,
        h('div', {},
            h('p', { class: 'label' }, 'Vale para'),
            h('div', { class: 'grid grid-cols-2 gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1', role: 'group' }, scopes)),
        h('div', { class: 'flex flex-wrap gap-2 pt-1' },
            block && h('button', { type: 'button', class: 'btn-ghost hover:!text-red-400', onclick: () => {
                const undo = actions.removeRoadBlock(block.id);
                dlg.close();
                toast('Observação removida.', { action: { label: 'Desfazer', run: undo } });
            } }, icon('trash', 'size-4'), 'Remover'),
            save),
    ));
    dlg.showModal();
}
