// CSV compatible con el Fichario anterior: sin cabecera y de 2 a 6 columnas:
// pregunta, respuesta, falsa 1, falsa 2, falsa 3, carpeta.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text ?? '').replace(/^﻿/, '');

  const endRow = () => {
    row.push(field);
    if (row.some((f) => f.trim() !== '')) rows.push(row);
    row = [];
    field = '';
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      endRow();
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

// Convierte filas en tarjetas. Las filas sin pregunta o sin respuesta se cuentan como saltadas.
export function rowsToCards(rows) {
  const cards = [];
  let skipped = 0;
  for (const r of rows) {
    const [question = '', answer = '', w1 = '', w2 = '', w3 = '', folder = ''] = r.map((f) => f.trim());
    if (!question || !answer) {
      skipped++;
      continue;
    }
    cards.push({ question, answer, wrongs: [w1, w2, w3].filter(Boolean), folder });
  }
  return { cards, skipped };
}

function escapeField(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function cardsToCsv(cards) {
  return cards
    .map((c) => {
      const w = c.wrongs ?? [];
      return [c.question, c.answer, w[0], w[1], w[2], c.folder].map(escapeField).join(',');
    })
    .join('\n');
}
