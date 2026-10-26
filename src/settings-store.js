import { DEFAULT_MODEL, getModel } from './model-catalog.js?v=0.13.1';

const VERSION = 1;
const defaults = () => ({ apiKey: '', model: DEFAULT_MODEL, autoAnalyze: false });
export const isValidApiKey = value => typeof value === 'string' && /^[A-Za-z0-9._-]{16,256}$/.test(value);

// localStorage already separates origins; the app directory separates project sites
// sharing that origin. URL queries and release numbers are deliberately excluded.
export function createSettingsStore({ getStorage, appPath }) {
  const directory = String(appPath || '/').replace(/\/+$/, '') + '/';
  const storageKey = 'airbag-settings-v1:' + directory;
  let state = defaults(), persisted = true;
  try {
    const raw = getStorage().getItem(storageKey);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved?.version === VERSION && !Array.isArray(saved)) {
        state.apiKey = isValidApiKey(saved.apiKey) ? saved.apiKey : '';
        state.model = getModel(saved.model) ? saved.model : DEFAULT_MODEL;
        state.autoAnalyze = saved.autoAnalyze === true && !!state.apiKey;
      }
    }
  } catch { persisted = false; }

  return {
    storageKey,
    snapshot: () => ({ ...state, persisted }),
    update(patch = {}) {
      let invalidKey = false, deletingKey = false;
      if (Object.hasOwn(patch, 'apiKey')) {
        const value = typeof patch.apiKey === 'string' ? patch.apiKey.trim() : null;
        if (value === '' || isValidApiKey(value)) {
          deletingKey = value === '';
          state.apiKey = value;
        } else invalidKey = true;
      }
      if (getModel(patch.model)) state.model = patch.model;
      if (typeof patch.autoAnalyze === 'boolean') state.autoAnalyze = patch.autoAnalyze;
      if (!state.apiKey) state.autoAnalyze = false;
      // An incomplete edit must not replace the last valid credential on disk.
      // Other settings may still change while that edit remains in the input.
      try {
        const storage = getStorage();
        // Explicit deletion first removes the old credential, even if a later
        // settings write fails because the browser has run out of space.
        if (deletingKey) {
          try { storage.removeItem(storageKey); } catch {}
        }
        storage.setItem(storageKey, JSON.stringify({ version: VERSION, ...state }));
        persisted = true;
      } catch { persisted = false; }
      return { ...state, persisted, invalidKey };
    }
  };
}
