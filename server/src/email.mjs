// Envío de correo con la API de Resend. Sin clave configurada, el correo se escribe en el log.
export function createMailer(config, fetchImpl = globalThis.fetch) {
  return async function sendEmail({ to, subject, text, html }) {
    if (!config.resendApiKey) {
      console.log(`[correo no enviado: falta RESEND_API_KEY] Para: ${to} | ${subject}\n${text}`);
      return { ok: false, reason: 'sin-clave' };
    }
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.resendApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: config.emailFrom, to: [to], subject, text, html }),
    });
    if (!res.ok) {
      console.error(`Resend respondió ${res.status}: ${await res.text().catch(() => '')}`);
      return { ok: false, reason: 'error-envio' };
    }
    return { ok: true };
  };
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function resetPasswordEmail(resetUrl) {
  const subject = 'Restablece tu contraseña de Repaso';
  const text = [
    'Hola:',
    '',
    'Alguien ha pedido restablecer la contraseña de tu cuenta de Repaso.',
    'Para elegir una nueva, abre este enlace (caduca en una hora):',
    '',
    resetUrl,
    '',
    'Si no has sido tú, ignora este correo: tu contraseña no cambia.',
  ].join('\n');
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:32px 20px;background:#f2f4f7;font-family:system-ui,sans-serif;color:#101828">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
<p style="margin:0 0 20px;font-size:18px;font-weight:700">Repaso</p>
<p style="margin:0 0 16px;line-height:1.5">Alguien ha pedido restablecer la contraseña de tu cuenta. Para elegir una nueva, pulsa el botón. El enlace caduca en una hora.</p>
<p style="margin:24px 0"><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#101828;color:#fff;text-decoration:none;font-weight:700;padding:14px 20px;border-radius:12px">Elegir una contraseña nueva</a></p>
<p style="margin:0;font-size:14px;color:#5b6474;line-height:1.5">Si no has sido tú, ignora este correo: tu contraseña no cambia.</p>
</div></body></html>`;
  return { subject, text, html };
}
