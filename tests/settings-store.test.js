import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsStore, isValidApiKey } from '../src/settings-store.js';
import { DEFAULT_MODEL } from '../src/model-catalog.js';

const key = 'sk-local-test-only-not-a-real-key';
function memoryStorage() {
  const values = new Map();
  return { values, getItem: name => values.get(name) ?? null,
    setItem: (name, value) => values.set(name, value), removeItem: name => values.delete(name) };
}
const store = (storage, appPath = '/airbag/') => createSettingsStore({ getStorage: () => storage, appPath });

test('settings and a valid key survive a new store on the same app path', () => {
  const storage = memoryStorage(), first = store(storage);
  first.update({ apiKey: '  ' + key + '  ', model: 'qwen3-vl-plus', autoAnalyze: true, other: 'not saved' });
  assert.deepEqual(store(storage).snapshot(), { apiKey: key, model: 'qwen3-vl-plus', autoAnalyze: true, comparePrevious: false, attention: '', persisted: true });
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(first.storageKey))).sort(), ['apiKey', 'autoAnalyze', 'comparePrevious', 'model', 'version']);
});

test('project paths sharing an origin do not read or overwrite each other', () => {
  const storage = memoryStorage(), one = store(storage, '/airbag/'), two = store(storage, '/other-app/');
  one.update({ apiKey: key, autoAnalyze: true });
  assert.equal(two.snapshot().apiKey, '');
  two.update({ model: 'qwen3-vl-plus' });
  assert.equal(store(storage, '/airbag/').snapshot().apiKey, key);
  assert.equal(store(storage, '/airbag').storageKey, one.storageKey);
});

test('an incomplete or malformed key edit retains the previous valid key', () => {
  const storage = memoryStorage(), settings = store(storage);
  settings.update({ apiKey: key, autoAnalyze: true });
  for (const invalid of ['sk-partial', 'sk-invalid key-with-spaces', 'x'.repeat(257), null]) {
    const result = settings.update({ apiKey: invalid, model: 'qwen3-vl-plus' });
    assert.equal(result.invalidKey, true); assert.equal(result.apiKey, key); assert.equal(result.autoAnalyze, true);
    assert.equal(store(storage).snapshot().apiKey, key);
  }
  assert.equal(settings.snapshot().model, 'qwen3-vl-plus');
});

test('explicit key deletion persists, disables auto analysis and preserves model', () => {
  const storage = memoryStorage(), settings = store(storage);
  settings.update({ apiKey: key, model: 'qwen3-vl-plus', autoAnalyze: true });
  settings.update({ apiKey: '   ', autoAnalyze: true });
  assert.deepEqual(store(storage).snapshot(), { apiKey: '', model: 'qwen3-vl-plus', autoAnalyze: false, comparePrevious: false, attention: '', persisted: true });
  assert.ok(![...storage.values.values()].some(value => value.includes(key)));
});

test('clear removes the old credential even if writing remaining settings fails', () => {
  const storage = memoryStorage(), settings = store(storage);
  settings.update({ apiKey: key, autoAnalyze: true });
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  const cleared = settings.update({ apiKey: '' });
  assert.equal(cleared.apiKey, ''); assert.equal(cleared.autoAnalyze, false); assert.equal(cleared.persisted, false);
  assert.equal(store(storage).snapshot().apiKey, '');
});

test('invalid cached fields are discarded and missing keys never enable automatic requests', () => {
  const storage = memoryStorage(), settings = store(storage);
  for (const apiKey of ['', 'sk-short', null, {}]) {
    storage.setItem(settings.storageKey, JSON.stringify({ version: 1, apiKey, model: 'not-supported', autoAnalyze: true }));
    assert.deepEqual(store(storage).snapshot(), { apiKey: '', model: DEFAULT_MODEL, autoAnalyze: false, comparePrevious: false, attention: '', persisted: true });
  }
  for (const broken of ['{', 'null', '[]', '{"version":99,"apiKey":"' + key + '"}']) {
    storage.setItem(settings.storageKey, broken);
    assert.equal(store(storage).snapshot().apiKey, '');
  }
});

test('denied localStorage access or writes leave the app usable in memory', () => {
  const inaccessible = createSettingsStore({ appPath: '/airbag/', getStorage() { throw new Error('SecurityError'); } });
  assert.equal(inaccessible.snapshot().persisted, false);
  assert.equal(inaccessible.update({ apiKey: key, autoAnalyze: true }).apiKey, key);
  assert.equal(inaccessible.snapshot().autoAnalyze, true);
  const storage = memoryStorage(), settings = store(storage);
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(settings.update({ apiKey: key }).persisted, false);
  assert.equal(settings.snapshot().apiKey, key);
});

test('key syntax matches the supported request format', () => {
  assert.equal(isValidApiKey(key), true);
  for (const invalid of ['', 'short', 'x'.repeat(257), 'sk-local-test-only/extra', 'sk-local-test-only\n']) assert.equal(isValidApiKey(invalid), false);
});

test('persistent attention and comparison survive reload and key deletion without requiring a key',()=>{
 const storage=memoryStorage(),settings=store(storage);assert.equal(settings.hasAttentionPreference(),false);
 settings.update({attention:'持续关注起跳转肩',comparePrevious:true});const reopened=store(storage);
 assert.equal(reopened.hasAttentionPreference(),true);assert.equal(reopened.snapshot().attention,'持续关注起跳转肩');assert.equal(reopened.snapshot().comparePrevious,true);
 reopened.update({apiKey:key,autoAnalyze:true});reopened.update({apiKey:''});const clearedKey=store(storage);
 assert.equal(clearedKey.snapshot().attention,'持续关注起跳转肩');assert.equal(clearedKey.snapshot().comparePrevious,true);
 clearedKey.update({attention:'',comparePrevious:false});const cleared=store(storage);assert.equal(cleared.hasAttentionPreference(),true);assert.equal(cleared.snapshot().attention,'');assert.equal(cleared.snapshot().comparePrevious,false);
});

test('legacy settings keep the attention migration opportunity until explicitly set',()=>{
 const storage=memoryStorage(),settings=store(storage);storage.setItem(settings.storageKey,JSON.stringify({version:1,apiKey:key,model:DEFAULT_MODEL,autoAnalyze:true}));
 const old=store(storage);assert.equal(old.hasAttentionPreference(),false);old.update({model:'qwen3-vl-plus'});assert.equal(store(storage).hasAttentionPreference(),false);
 old.update({attention:''});assert.equal(store(storage).hasAttentionPreference(),true);
 old.update({attention:'有效关注'});old.update({attention:'关'.repeat(241),comparePrevious:'false'});assert.equal(store(storage).snapshot().attention,'有效关注');assert.equal(store(storage).snapshot().comparePrevious,false);
});
