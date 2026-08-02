"use client";

import { AssetIcon } from "./primitives";

export function GlobalDirectoryTermsDialog({
  open,
  onCancel,
  onAccept,
}: {
  open: boolean;
  onCancel: () => void;
  onAccept: () => void;
}) {
  if (!open) return null;

  return (
    <div className="global-directory-terms-backdrop" role="presentation">
      <section
        className="global-directory-terms-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-directory-terms-title"
        aria-describedby="global-directory-terms-description"
      >
        <span className="global-directory-terms-icon" aria-hidden="true">
          <AssetIcon name="ic_shield_check_r_yape" />
        </span>
        <span className="global-directory-terms-eyebrow">REGISTRO</span>
        <h2 id="global-directory-terms-title">Confirma el registro</h2>
        <p id="global-directory-terms-description">
          Este dato quedará disponible para todos los usuarios y se usará para
          autocompletar destinatarios al yapear.
        </p>
        <p className="global-directory-terms-warning">
          Solo registra información real. Si se registra información falsa,
          engañosa o de otra persona, el registro se revocará y la cuenta
          podrá quedar suspendida permanentemente.
        </p>
        <div className="global-directory-terms-actions">
          <button type="button" className="global-directory-terms-cancel" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="global-directory-terms-accept" onClick={onAccept}>
            Aceptar y registrar
          </button>
        </div>
      </section>
    </div>
  );
}
