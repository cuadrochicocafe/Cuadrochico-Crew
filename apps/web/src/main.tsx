import '@fontsource/playfair-display/latin-700.css';
import '@fontsource/outfit/latin-400.css';
import '@fontsource/outfit/latin-600.css';
import '@fontsource/caveat/latin-600.css';
import './styles.css';
import { render } from 'preact';
import { App } from './app';

const root = document.getElementById('app');
if (root) render(<App />, root);
