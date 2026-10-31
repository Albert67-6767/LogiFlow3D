import { $$ } from './dom.js';

/** Número no formato do campo (vírgula decimal); vazio se não houver valor. */
export const decimal = (v) => (v === null || v === undefined || v === '' ? '' : String(v).replace('.', ','));

/**
 * Mostra as mensagens de erro nos elementos [data-error="campo"] do formulário
 * e marca os campos inválidos com aria-invalid.
 */
export function showErrors(form, errors) {
    $$('[data-error]', form).forEach(el => {
        const key = el.dataset.error;
        el.textContent = errors[key] ?? '';
        form.elements[key]?.setAttribute('aria-invalid', String(Boolean(errors[key])));
    });
}

/** Foca o primeiro campo inválido. */
export function focusFirstError(form) {
    form.querySelector('[aria-invalid="true"]')?.focus();
}

/** Liga os botões [data-close] e o clique fora do cartão ao fechamento do <dialog>. */
export function bindDialogClose(dialog, onClose) {
    $$('[data-close]', dialog).forEach(btn => btn.addEventListener('click', onClose));
    dialog.addEventListener('click', (e) => { if (e.target === dialog) onClose(); });
}
