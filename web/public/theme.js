// Aplica el tema guardado antes de pintar la página, para que no parpadee.
try {
  var t = localStorage.getItem('repaso:tema');
  if (t === 'claro' || t === 'oscuro') document.documentElement.dataset.theme = t;
} catch (e) {}
