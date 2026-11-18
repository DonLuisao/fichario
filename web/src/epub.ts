// Exporta tarjetas como libro EPUB para leerlas en un lector de libros electrónicos.
// Cada carpeta es un capítulo; cada tarjeta, la pregunta y debajo la respuesta.
import type { Card, Folder } from './types';
import { zip } from './zip';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function buildEpub(title: string, groups: { folder: Folder | null; cards: Card[] }[]): Blob {
  const id = `urn:uuid:${crypto.randomUUID()}`;
  const date = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const chapters = groups.map((g, i) => ({
    file: `cap${i + 1}.xhtml`,
    title: g.folder?.name ?? 'Sin carpeta',
    cards: g.cards,
  }));

  const page = (t: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="es" xml:lang="es">
<head><meta charset="utf-8"/><title>${esc(t)}</title><link rel="stylesheet" href="estilo.css"/></head>
<body>${body}</body></html>`;

  const files: { name: string; data: string }[] = [
    { name: 'mimetype', data: 'application/epub+zip' },
    {
      name: 'META-INF/container.xml',
      data: `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/libro.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    },
    {
      name: 'OEBPS/estilo.css',
      data: 'body{font-family:serif;line-height:1.5;margin:0 5%}h1{font-size:1.5em;margin:1em 0}.t{margin:0 0 1.4em;page-break-inside:avoid}.q{font-weight:bold;margin:0}.a{margin:.3em 0 0}',
    },
    {
      name: 'OEBPS/indice.xhtml',
      data: page('Índice', `<nav epub:type="toc"><h1>Índice</h1><ol>${chapters.map((c) => `<li><a href="${c.file}">${esc(c.title)}</a></li>`).join('')}</ol></nav>`),
    },
    ...chapters.map((c) => ({
      name: `OEBPS/${c.file}`,
      data: page(c.title, `<h1>${esc(c.title)}</h1>${c.cards.map((k) => `<div class="t"><p class="q">${esc(k.question)}</p><p class="a">${esc(k.answer)}</p></div>`).join('')}`),
    })),
    {
      name: 'OEBPS/libro.opf',
      data: `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" xml:lang="es">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">${id}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:language>es</dc:language><dc:creator>Repaso</dc:creator><meta property="dcterms:modified">${date}</meta></metadata>
<manifest><item id="indice" href="indice.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="estilo.css" media-type="text/css"/>${chapters.map((c, i) => `<item id="c${i + 1}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine><itemref idref="indice"/>${chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('')}</spine>
</package>`,
    },
  ];
  return new Blob([zip(files)], { type: 'application/epub+zip' });
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
