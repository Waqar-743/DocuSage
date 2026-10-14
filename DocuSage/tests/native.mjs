// Drives the actual release binary through Tauri's WebDriver. No IPC mocks.
// Run only against an isolated app data directory; this creates/deletes fixtures.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = process.env.NATIVE_TEST_DIR || '/tmp/docusage-native';
const binary = process.env.DOCUSAGE_BINARY;
assert(binary, 'Set DOCUSAGE_BINARY to the real compiled desktop binary');
const evidence = resolve('docs/evidence');
await mkdir(evidence, { recursive: true });
await mkdir(root, { recursive: true });
let session;
let completed = false;
const outcomes = [];
const screenshots = [];
async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
const binarySha256 = await sha256(binary);

async function wd(method, path, body) {
  const response = await fetch(`http://127.0.0.1:4444${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  });
  const result = await response.json();
  if (result.value?.error && result.value?.message) throw new Error(`${result.value.error}: ${result.value.message}`);
  return result.value;
}
const execute = (script, args = []) => wd('POST', `/session/${session}/execute/sync`, { script, args });
const invoke = async (command, args = {}) => {
  const result = await wd('POST', `/session/${session}/execute/async`, {
    script: `const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then(value => done({ ok: true, value })).catch(error => done({ ok: false, error: String(error) }));`,
    args: [command, args],
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function check(name, action) {
  const start = Date.now();
  try { await action(); outcomes.push({ name, result: 'passed', milliseconds: Date.now() - start }); console.log(`PASS ${name}`); }
  catch (error) { outcomes.push({ name, result: 'failed', error: String(error) }); throw error; }
}
async function click(text) {
  assert(await execute(`const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === arguments[0] || button.getAttribute('aria-label') === arguments[0] || button.title === arguments[0]); if (!button) return false; button.click(); return true;`, [text]), `Missing UI button: ${text}`);
  await sleep(150);
}
async function waitFor(script, timeout = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await execute(script)) return; await sleep(200); }
  throw new Error(`Timed out waiting for desktop UI: ${script}`);
}
async function typeMessage(value) {
  await execute(`const input = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, arguments[0]); input.dispatchEvent(new Event('input', { bubbles: true }));`, [value]);
  await sleep(100);
}
async function toggleShortcut() {
  const status = await invoke('get_assistant_status');
  const shortcut = status.settings.globalShortcut.toLowerCase();
  console.log(`Testing registered shortcut: ${shortcut}`);
  await run('xdotool', ['key', '--clearmodifiers', shortcut]);
  await sleep(500);
}
async function capture(name) {
  const png = await wd('GET', `/session/${session}/screenshot`);
  await writeFile(join(evidence, `${name}.png`), Buffer.from(png, 'base64'));
  await run('convert', [join(evidence, `${name}.png`), '-quality', '92', resolve('public/media', `${name}.webp`)]);
  screenshots.push(`${name}.png`);
}
function pdf(lines) {
  const escape = line => line.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT /F1 15 Tf 48 748 Td ${lines.map((line, i) => `${i ? '0 -28 Td ' : ''}(${escape(line)}) Tj`).join('\n')} ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let data = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(data)); data += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(data);
  data += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return data;
}

const first = join(root, "Aurora field guide.pdf");
const second = join(root, "Borealis O'Brien.pdf");
await writeFile(first, pdf(['Aurora field guide', 'Aurora field station opens at 08:30.', 'Visitor check-in is in the east hall.',
  'Blue notebooks stay in cabinet seven.', 'Weekly instrument maintenance takes place on Friday.', 'The sky watch starts at 20:00 on Saturday.']));
await writeFile(second, pdf(['Borealis field guide', 'Borealis field station opens at 17:15.', 'Visitor check-in is in the west hall.', 'Red notebooks stay in cabinet five.']));
await writeFile(join(root, 'corrupt.pdf'), 'This is not a PDF');
await writeFile(join(root, 'scan.pdf'), pdf(['']));
const staleDownload = join(process.env.XDG_DATA_HOME, 'com.docusage.app', 'models', 'stale.gguf.part');
await mkdir(dirname(staleDownload), { recursive: true });
await writeFile(staleDownload, 'interrupted download fixture');

// Local HTTP fixture tests exercise real provider adapters and failure paths.
// These are protocol checks, not evidence of live paid-provider inference.
let lastRequest;
const server = createServer(async (request, response) => {
  if (request.url === '/model.gguf') {
    response.setHeader('Content-Type', 'application/octet-stream');
    return createReadStream(join(process.env.MODEL_PATH, 'qwen2.5-0.5b-instruct-q4_k_m.gguf')).pipe(response);
  }
  let body = ''; for await (const chunk of request) body += chunk;
  lastRequest = { url: request.url, headers: request.headers, body: body ? JSON.parse(body) : null };
  response.setHeader('Content-Type', 'application/json');
  if (request.url.startsWith('/slow/')) { await sleep(15_000); }
  if (request.url.startsWith('/error/')) { response.writeHead(401); return response.end('{"error":"fixture rejection"}'); }
  if (request.url.endsWith('/models') || request.url.endsWith('/api/tags')) return response.end('{"data":[]}');
  if (request.url.endsWith('/messages')) return response.end('{"content":[{"type":"text","text":"protocol ok"}]}');
  if (request.url.includes(':generateContent')) return response.end('{"candidates":[{"content":{"parts":[{"text":"protocol ok"}]}}]}');
  if (request.url.endsWith('/api/chat')) return response.end('{"message":{"content":"protocol ok"}}');
  response.end('{"choices":[{"message":{"content":"protocol ok"}}]}');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const input = (provider, extra = {}) => ({ name: `Test ${provider}`, provider, enabled: true,
  baseUrl: `http://127.0.0.1:${port}/v1`, model: 'fixture-model', timeoutSecs: 30, temperature: 0.2,
  organization: null, project: null, apiKey: 'test-key-do-not-use', deleteApiKey: false, options: {}, ...extra });

try {
  const created = await wd('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: binary } } } });
  session = created.sessionId;
  await writeFile(join(root, 'webdriver-session.json'), JSON.stringify({ session }));
  await wd('POST', `/session/${session}/timeouts`, { script: 600_000 });
  await waitFor("return !!document.querySelector('[data-desktop-app]');");

  await check('the production desktop stylesheet is applied', async () => {
    const rendering = await execute(`return { display: getComputedStyle(document.querySelector('[data-desktop-app]')).display,
      sheets: [...document.styleSheets].map(sheet => ({ href: sheet.href, rules: sheet.cssRules.length })),
      links: [...document.querySelectorAll('link')].map(link => ({ href: link.href, rel: link.rel })) };`);
    await writeFile('/tmp/docusage-render-debug.json', JSON.stringify(rendering, null, 2));
    assert.equal(rendering.display, 'flex', 'The native desktop stylesheet did not apply');
  });

  await check('production native bridge, hidden launch, and interrupted download recovery', async () => {
    assert(await execute("return '__TAURI_INTERNALS__' in window;"));
    assert.equal((await invoke('get_assistant_status')).isVisible, false);
    await assert.rejects(() => readFile(staleDownload), { code: 'ENOENT' });
    await toggleShortcut();
    assert.equal((await invoke('get_assistant_status')).isVisible, true);
  });
  await invoke('set_assistant_window_mode', { windowMode: 'full' });
  await wd('POST', `/session/${session}/window/rect`, { width: 1280, height: 900 });

  await check('window sizes, global toggle, Escape, and single instance', async () => {
    for (const windowMode of ['compact', 'medium', 'full']) {
      assert.equal(await invoke('set_assistant_window_mode', { windowMode }), windowMode);
      await sleep(250);
      assert(await execute('return document.documentElement.scrollWidth <= innerWidth;'), `${windowMode} overflows horizontally`);
    }
    await invoke('hide_assistant_window');
    await toggleShortcut();
    assert.equal((await invoke('get_assistant_status')).isVisible, true);
    await run('xdotool', ['key', 'Escape']); await sleep(300);
    assert.equal((await invoke('get_assistant_status')).isVisible, false);
    await run(binary, [], { timeout: 10_000 }); await sleep(300);
    assert.equal((await invoke('get_assistant_status')).isVisible, true);
  });
  await invoke('set_assistant_window_mode', { windowMode: 'full' });
  await wd('POST', `/session/${session}/window/rect`, { width: 1280, height: 900 });

  await check('local GGUF startup, general inference, and real streaming', async () => {
    await waitFor("return !![...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Ready');", 300_000);
    await execute(`window.__realTokenCount = 0; const handler = window.__TAURI_INTERNALS__.transformCallback(event => { if (event.payload.token) window.__realTokenCount++; }); window.__TAURI_INTERNALS__.invoke('plugin:event|listen', { event: 'chat-token', target: { kind: 'Any' }, handler }); return true;`);
    await click('General');
    await typeMessage('Reply with only the word ready.'); await click('Send message');
    await waitFor("return !document.querySelector('[data-streaming=\"true\"]');");
    console.log('Generation controls:', await execute('return [...document.querySelectorAll(\'button[title]\')].map(button => button.title);'));
    const reply = await execute(`return [...document.querySelectorAll('[data-message-sender="bot"]')].at(-1)?.innerText;`);
    assert.match(reply.trim(), /^ready[.!]?$/i);
    assert((await execute('return window.__realTokenCount;')) > 0, 'No actual streamed tokens observed');
  });
  if (!process.env.NATIVE_SMOKE_ONLY) {
  let indexed;
  await check('the native PDF picker imports a document through the app UI', async () => {
    await click('Ingest PDF');
    const dialog = await run('xdotool', ['search', '--sync', '--onlyvisible', '--name', '^Open File$'], { timeout: 10_000 });
    const dialogId = dialog.stdout.trim().split('\n').at(-1);
    await run('xdotool', ['windowactivate', '--sync', dialogId]);
    await run('xdotool', ['key', '--clearmodifiers', 'ctrl+l']);
    await run('xdotool', ['type', '--clearmodifiers', '--delay', '2', first]);
    await sleep(500);
    await run('xdotool', ['key', '--clearmodifiers', 'Return']);
    await sleep(500);
    await run('xdotool', ['key', '--clearmodifiers', 'alt+o']);
    await waitFor("return document.body.innerText.includes('Successfully vectorized');", 300_000);
    assert.equal((await invoke('list_indexed_documents')).length, 1);
  });
  await check('PDF extraction, local embeddings, and persistent LanceDB indexing', async () => {
    indexed = await invoke('ingest_document', { filePath: first });
    assert(indexed.chunkCount > 0); assert(indexed.charCount > 100);
    await invoke('ingest_document', { filePath: second });
    assert.equal((await invoke('list_indexed_documents')).length, 2);
  });
  await check('re-import replaces chunks without duplicates', async () => {
    await invoke('ingest_document', { filePath: first });
    const documents = await invoke('list_indexed_documents');
    assert.equal(documents.find(document => document.path === first).chunkCount, indexed.chunkCount);
  });
  await check('invalid, missing, non-PDF, and scanned files return useful errors', async () => {
    for (const name of ['missing.pdf', 'corrupt.pdf', 'scan.pdf', 'wrong.txt']) {
      await assert.rejects(() => invoke('ingest_document', { filePath: join(root, name) }));
    }
  });
  await check('RAG uses the selected PDF and shows the actual context', async () => {
    await invoke('save_rag_config', { config: { chunkSize: 900, chunkOverlap: 150, topK: 3, showContext: true } });
    const answer = await invoke('chat_rag', { prompt: 'What time does Aurora field station open? Answer in one sentence.', history: [], requestId: 'rag-real', sourcePath: first });
    assert.match(answer.split('Retrieved Context')[0], /08:30/); assert.doesNotMatch(answer, /17:15|Borealis/); assert.match(answer, /Retrieved Context/);
    await writeFile(join(evidence, 'local-rag-answer.txt'), answer);
  });
  await check('Unicode queries do not panic and failed requests release their slot', async () => {
    await assert.rejects(() => invoke('chat_rag', { prompt: '你好🌿'.repeat(100), history: [], requestId: 'unicode-missing', sourcePath: join(root, 'missing.pdf') }));
    const answer = await invoke('chat_general', { prompt: 'Reply with only ok.', history: [], requestId: 'after-failure' });
    assert(answer.trim());
  });
  await check('document deletion removes retrieval data and preserves another PDF', async () => {
    await invoke('delete_document', { filePath: second });
    const documents = await invoke('list_indexed_documents');
    assert.equal(documents.length, 1); assert.equal(documents[0].path, first);
  });
  await check('RAG settings validation and disk persistence', async () => {
    await assert.rejects(() => invoke('save_rag_config', { config: { chunkSize: 0, chunkOverlap: 10, topK: 0, showContext: false } }));
    const settings = await invoke('get_rag_config');
    assert.equal(settings.topK, 3); assert.equal(settings.showContext, true);
    const saved = JSON.parse(await readFile(join(process.env.XDG_CONFIG_HOME, 'com.docusage.app', 'rag-config.json'), 'utf8'));
    assert.equal(saved.topK, 3);
  });
  await check('native credentials survive fresh keyring reads and never enter settings JSON', async () => {
    const provider = await invoke('save_ai_provider_config', { input: input('customOpenAiCompatible') });
    const listed = await invoke('list_ai_provider_configs');
    assert.equal(listed.secureStorageAvailable, true);
    assert.equal(listed.providers.find(saved => saved.id === provider.id).apiKeySet, true);
    const raw = await readFile(join(process.env.XDG_CONFIG_HOME, 'com.docusage.app', 'ai-providers.json'), 'utf8');
    assert(!raw.includes('test-key-do-not-use'));
    await invoke('delete_ai_provider_config', { providerId: provider.id });
  });
  await check('all remote adapters send correct requests to protocol fixtures', async () => {
    for (const kind of ['openAi', 'openRouter', 'customOpenAiCompatible', 'lmStudio', 'lmStudioRemote', 'anthropic', 'googleGemini', 'ollamaLocal', 'ollamaRemote']) {
      const provider = await invoke('save_ai_provider_config', { input: input(kind) });
      await invoke('set_active_ai_provider', { providerId: provider.id });
      assert.equal((await invoke('test_ai_provider_connection', { providerId: provider.id })).ok, true);
      assert.equal(await invoke('chat_cloud', { prompt: 'Test prompt', history: [{ sender: 'user', text: 'Earlier message' }], requestId: `protocol-${kind}` }), 'protocol ok');
      assert(lastRequest.body); assert(!lastRequest.url.includes('test-key'));
      if (kind === 'googleGemini') {
        assert.equal(lastRequest.headers['x-goog-api-key'], 'test-key-do-not-use');
        assert.match(lastRequest.body.contents[0].parts[0].text, /Earlier message.*\nUser: Test prompt/);
      } else if (kind === 'anthropic') {
        assert.equal(lastRequest.headers['x-api-key'], 'test-key-do-not-use');
        assert.equal(lastRequest.body.messages[0].content, 'Earlier message');
        assert(lastRequest.body.system);
      } else {
        assert.equal(lastRequest.headers.authorization, 'Bearer test-key-do-not-use');
        assert.equal(lastRequest.body.messages[0].role, 'system');
        assert.equal(lastRequest.body.messages[1].content, 'Earlier message');
      }
      if (kind === 'customOpenAiCompatible') {
        const answer = await invoke('chat_cloud_rag', { prompt: 'When does Aurora open?', history: [], requestId: 'remote-rag', sourcePath: first });
        assert.match(answer, /Retrieved Context/);
        assert.match(JSON.stringify(lastRequest.body), /08:30/);
        assert.doesNotMatch(JSON.stringify(lastRequest.body), /17:15|Borealis/);
      }
      await invoke('delete_ai_provider_config', { providerId: provider.id });
    }
  });
  await check('remote errors and cancellation recover without a stuck chat', async () => {
    const error = await invoke('save_ai_provider_config', { input: input('customOpenAiCompatible', { baseUrl: `http://127.0.0.1:${port}/error` }) });
    await invoke('set_active_ai_provider', { providerId: error.id });
    await assert.rejects(() => invoke('chat_cloud', { prompt: 'Fail', history: [], requestId: 'http-failure' }), /401/);
    await invoke('delete_ai_provider_config', { providerId: error.id });
    const slow = await invoke('save_ai_provider_config', { input: input('customOpenAiCompatible', { baseUrl: `http://127.0.0.1:${port}/slow` }) });
    await invoke('set_active_ai_provider', { providerId: slow.id });
    await execute("window.__nativePending = window.__TAURI_INTERNALS__.invoke('chat_cloud', { prompt: 'Slow request', history: [], requestId: 'cancel-cloud' }); return true;");
    await sleep(300); await invoke('stop_chat', { requestId: 'cancel-cloud' });
    const stopped = await wd('POST', `/session/${session}/execute/async`, { script: 'const done = arguments[arguments.length - 1]; window.__nativePending.then(done).catch(error => done(String(error)));', args: [] });
    assert.equal(stopped, 'Generation stopped.');
    await invoke('delete_ai_provider_config', { providerId: slow.id });
  });
  await check('disabled providers and unsafe endpoints cannot become active', async () => {
    for (const baseUrl of ['file:///tmp/key', 'https://user:password@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/#fragment']) {
      await assert.rejects(() => invoke('save_ai_provider_config', { input: input('openAi', { baseUrl }) }));
    }
    await assert.rejects(() => invoke('save_ai_provider_config', { input: input('openAi', { id: 'local' }) }));
    await assert.rejects(() => invoke('save_ai_provider_config', { input: input('local', { id: 'local', enabled: false }) }));
    const disabled = await invoke('save_ai_provider_config', { input: input('lmStudio', { enabled: false }) });
    await assert.rejects(() => invoke('set_active_ai_provider', { providerId: disabled.id }));
    await invoke('delete_ai_provider_config', { providerId: disabled.id });
  });
  await check('model download validation, no partial catalog entries, and safe deletion', async () => {
    await assert.rejects(() => invoke('download_model', { url: `http://127.0.0.1:${port}/v1/models`, filename: '../escape.gguf' }));
    await assert.rejects(() => invoke('download_model', { url: `http://127.0.0.1:${port}/v1/models`, filename: 'invalid.gguf' }), /not a GGUF/);
    assert(!(await invoke('list_downloaded_models')).some(model => model.filename === 'invalid.gguf'));
    await assert.rejects(() => invoke('delete_model', { filePath: first }), /Only a GGUF/);
    const models = await invoke('list_downloaded_models');
    await assert.rejects(() => invoke('delete_model', { filePath: models[0].path }), /currently connected/);
  });
  await check('a complete GGUF download enters the catalog and can be removed', async () => {
    const filePath = await invoke('download_model', { url: `http://127.0.0.1:${port}/model.gguf`, filename: 'download-test.gguf' });
    const downloaded = (await invoke('list_downloaded_models')).find(model => model.filename === 'download-test.gguf');
    assert(downloaded.sizeBytes > 400_000_000);
    await invoke('delete_model', { filePath });
    assert(!(await invoke('list_downloaded_models')).some(model => model.filename === 'download-test.gguf'));
  });
  await check('local generation stops and the engine accepts another request', async () => {
    await execute("window.__nativePending = window.__TAURI_INTERNALS__.invoke('chat_general', { prompt: 'Write a very long guide with 100 numbered steps.', history: [], requestId: 'cancel-local' }); return true;");
    await sleep(400);
    const start = Date.now();
    await invoke('stop_chat', { requestId: 'cancel-local' });
    const reply = await wd('POST', `/session/${session}/execute/async`, { script: 'const done = arguments[arguments.length - 1]; window.__nativePending.then(done).catch(error => done(String(error)));', args: [] });
    assert.equal(typeof reply, 'string'); assert(Date.now() - start < 5000);
    assert((await invoke('chat_general', { prompt: 'Reply with only ok.', history: [], requestId: 'after-local-stop' })).trim());
  });
  await check('local disconnect, connection status, reconnect, and restart', async () => {
    const connected = await invoke('get_connected_model');
    const path = (await invoke('list_downloaded_models')).find(model => model.filename === connected).path;
    await invoke('disconnect_model'); assert.equal(await invoke('get_connected_model'), null);
    assert.equal((await invoke('test_ai_provider_connection', { providerId: 'local' })).ok, false);
    await assert.rejects(() => invoke('chat_general', { prompt: 'hello', history: [], requestId: 'disconnected' }), /No model loaded/);
    await invoke('connect_model', { filePath: path }); assert.equal(await invoke('get_connected_model'), connected);
    // An earlier-sorting file must not replace the explicitly selected model.
    const unselected = join(dirname(path), '000-unselected.gguf');
    await writeFile(unselected, 'GGUF intentionally invalid unselected fixture');
    await invoke('restart_ai_engine'); assert.equal(await invoke('get_connected_model'), connected);
    await invoke('delete_model', { filePath: unselected });
  });

  await check('persisted document chat, theme changes, and native settings screenshots', async () => {
  // Reload hydrates actual indexed documents. Answers below are generated by
  // the connected GGUF model through the application's own Send interaction.
  await execute('location.reload();'); await waitFor("return !!document.querySelector('[data-desktop-app]');");
  await waitFor("return !![...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Ready');");
  await click('Docs');
  if (await execute("return document.body.innerText.includes(\"Borealis O'Brien.pdf\");")) {
    await click("Borealis O'Brien.pdf");
    await execute("document.querySelector('[title=\"Delete document\"]').click();");
    await sleep(300);
  }
  await click('Aurora field guide.pdf');
  await typeMessage('What time does the station open, and where is visitor check-in? Answer briefly.'); await click('Send message');
  await waitFor("return !document.querySelector('[data-streaming=\"true\"]');");
  await sleep(400);
  const screenshotAnswer = await execute(`return [...document.querySelectorAll('[data-message-sender="bot"]')].at(-1)?.innerText;`);
  assert.match(screenshotAnswer.split('Retrieved Context')[0], /08:30/);
  assert.match(screenshotAnswer.split('Retrieved Context')[0], /east hall/i);
  await execute('location.reload();');
  await waitFor("return !![...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Ready');");
  assert.equal(await execute(`return [...document.querySelectorAll('[data-message-sender="bot"]')].at(-1)?.innerText;`), screenshotAnswer);
  await capture('desktop-dark');
  await click('Settings'); await click('Appearance');
  await execute("[...document.querySelectorAll('button')].find(button => button.textContent.trim().startsWith('Light')).click();");
  await click('Close settings'); await capture('desktop-light');
  await click('Settings'); await click('Model Catalog'); await capture('desktop-models');
  await click('AI Providers'); await click('Add OpenAI'); await capture('desktop-providers');
  await click('Shortcuts'); await capture('desktop-shortcuts'); await click('Close settings');
  });
  await check('update check reaches the existing GitHub release', async () => {
    assert.match(await invoke('check_for_updates'), /latest|Latest/);
  });
  }
  completed = true;
} finally {
  await writeFile(join(evidence, process.env.NATIVE_REPORT || 'native-results.json'), JSON.stringify({ date: new Date().toISOString(), platform: process.platform,
    binaryProfile: 'release', binarySha256, actualNativeBackend: true, completed, screenshots, livePaidProvidersVerified: false, checks: outcomes }, null, 2));
  if (session) await wd('DELETE', `/session/${session}`).catch(() => {});
  server.closeAllConnections(); server.close();
}
