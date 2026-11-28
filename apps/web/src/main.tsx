import '@fontsource/playfair-display/latin-700.css';
import '@fontsource/outfit/latin-400.css';
import '@fontsource/outfit/latin-600.css';
import '@fontsource/caveat/latin-600.css';
import './styles.css';
import { render } from 'preact';
import { App } from './app';

// El panel del equipo usa el look de la app interna desde el primer cuadro (sin mostrar antes el de la tienda).
if (location.pathname.replace(/\/+$/, '') === '/admin') document.documentElement.classList.add('staff');

const root = document.getElementById('app');
if (root) render(<App />, root);
