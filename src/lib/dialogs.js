/*
 * SweetAlert2 dialogs, shared by the public site and the local admin so both look the same.
 *
 * Plain JS with no imports: the site bundles it through Vite, the admin loads it as a module from
 * /vendor/dialogs.js (see the VENDOR map in admin/server.js). The look lives in src/styles/swal.css,
 * which both stylesheets import.
 */

/** Options every dialog shares. Buttons are ordered confirm-first, like the browser's own dialogs. */
const BASE = {
  buttonsStyling: false,
  reverseButtons: true,
  focusCancel: true,
  showClass: { popup: 'swal2-show' },
  customClass: {
    container: 'ql-swal',
    popup: 'ql-swal-popup',
    title: 'ql-swal-title',
    htmlContainer: 'ql-swal-text',
    actions: 'ql-swal-actions',
    confirmButton: 'ql-swal-confirm',
    denyButton: 'ql-swal-deny',
    cancelButton: 'ql-swal-cancel',
    input: 'ql-swal-input',
    validationMessage: 'ql-swal-validation',
  },
};

/**
 * @typedef {object} AskOptions
 * @property {string} [text] Body text. Blank lines start a new paragraph; single newlines become line breaks.
 * @property {string} [confirmText]
 * @property {string} [cancelText]
 * @property {'question' | 'warning' | 'error' | 'success' | 'info'} [icon]
 *
 * @typedef {object} PromptOptions
 * @property {string} [text]
 * @property {string} [value]
 * @property {string} [placeholder]
 * @property {string} [confirmText]
 * @property {string} [inputType]
 * @property {(value: string) => string | null | Promise<string | null>} [validate]
 */

/**
 * Builds the dialog helpers around a SweetAlert2 instance.
 *
 * @param {import('sweetalert2').default} Swal
 * @returns dialogs: `confirm` (amber), `danger` (rose), `alert`, `prompt` and `toast`.
 *          All return promises; `confirm`/`danger` resolve to a boolean.
 */
export function createDialogs(Swal) {
  const swal = Swal.mixin(BASE);

  /** Text with \n\n paragraphs, escaped, so messages read the same as they did in window.confirm. */
  const body = (text) => {
    if (!text) return undefined;
    const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return String(text)
      .split(/\n{2,}/)
      .map((p) => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`)
      .join('');
  };

  const ask = async (options) => {
    const result = await swal.fire({ showCancelButton: true, cancelButtonText: 'Cancel', ...options });
    return result.isConfirmed;
  };

  return {
    /**
     * A normal yes/no question. Resolves true when confirmed.
     * @param {string} title
     * @param {AskOptions} [options]
     */
    confirm(title, { text, confirmText = 'OK', cancelText = 'Cancel', icon = 'question' } = {}) {
      return ask({ title, html: body(text), icon, confirmButtonText: confirmText, cancelButtonText: cancelText });
    },

    /**
     * Same, for something destructive: red confirm button, cancel focused.
     * @param {string} title
     * @param {AskOptions} [options]
     */
    danger(title, { text, confirmText = 'Delete', cancelText = 'Cancel', icon = 'warning' } = {}) {
      return ask({
        title,
        html: body(text),
        icon,
        confirmButtonText: confirmText,
        cancelButtonText: cancelText,
        customClass: { ...BASE.customClass, confirmButton: 'ql-swal-confirm ql-swal-confirm-danger' },
      });
    },

    /**
     * One-button notice (replaces window.alert).
     * @param {string} title
     * @param {AskOptions} [options]
     */
    alert(title, { text, icon = 'info', confirmText = 'OK' } = {}) {
      return swal.fire({ title, html: body(text), icon, confirmButtonText: confirmText });
    },

    /**
     * Single-line input (replaces window.prompt). Resolves to the string, or null when cancelled.
     * @param {string} title
     * @param {PromptOptions} [options]
     */
    async prompt(title, { text, value = '', placeholder = '', confirmText = 'Save', inputType = 'text', validate } = {}) {
      const result = await swal.fire({
        title,
        html: body(text),
        input: inputType,
        inputValue: value,
        inputPlaceholder: placeholder,
        inputValidator: validate,
        showCancelButton: true,
        cancelButtonText: 'Cancel',
        confirmButtonText: confirmText,
        focusCancel: false,
      });
      return result.isConfirmed ? result.value : null;
    },

    /**
     * Small corner toast for "done" messages.
     * @param {string} title
     * @param {{ icon?: string, timer?: number }} [options]
     */
    toast(title, { icon = 'success', timer = 2500 } = {}) {
      return Swal.fire({
        ...BASE,
        toast: true,
        position: 'bottom-end',
        icon,
        title,
        timer,
        timerProgressBar: true,
        showConfirmButton: false,
        customClass: { ...BASE.customClass, popup: 'ql-swal-popup ql-swal-toast' },
      });
    },
  };
}
