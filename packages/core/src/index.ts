import menuJson from '../data/menu.json';
import settingsJson from '../data/settings.json';
import { MenuSchema, SettingsSchema } from './schema';

export * from './api';
export * from './cancellation';
export * from './pricing';
export * from './schedule';
export * from './schema';

/** Menú y configuración por defecto, validados al importarse: un JSON mal editado falla en build y en pruebas, no en producción. */
export const defaultMenu = MenuSchema.parse(menuJson);
export const defaultSettings = SettingsSchema.parse(settingsJson);
