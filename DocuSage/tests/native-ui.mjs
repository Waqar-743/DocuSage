// Supplemental UI checks against the actual production binary, using authored
// Markdown fixtures only for rendering/copy tests. No generated-answer claims.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const outcomes = [];
let session;
let completed = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wd(method, path, body) {
  const response = await fetch('http://127.0.0.1:4444' + path, { method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const data = await response.json();
  if (data.value?.error) throw new Error(data.value.message);
  return data.value;
}
const execute = (script, args = []) => wd('POST', '/session/' + session + '/execute/sync', { script, args });
async function invoke(command, args = {}) {
  const result = await wd('POST', '/session/' + session + '/execute/async', {
    script: 'const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then(value => done({ok:true,value})).catch(error => done({ok:false,error:String(error)}));', args: [command, args] });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
async function waitFor(script) {
  for (let i = 0; i < 100; i++) { if (await execute(script)) return; await sleep(100); }
  throw new Error('Timed out: ' + script);
}
async function click(name) {
  assert(await execute('const b=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===arguments[0]||b.getAttribute("aria-label")===arguments[0]||b.title===arguments[0]);if(!b)return false;b.click();return true;', [name]));
  await sleep(150);
}
async function type(selector, value, elementType = 'HTMLInputElement') {
  await execute('const el=document.querySelector(arguments[0]);Object.getOwnPropertyDescriptor(window[arguments[2]].prototype,"value").set.call(el,arguments[1]);el.dispatchEvent(new Event("input",{bubbles:true}));', [selector, value, elementType]);
  await sleep(150);
}
async function check(name, action) {
  try { await action(); outcomes.push({ name, result: 'passed' }); console.log('PASS ' + name); }
  catch (error) { outcomes.push({ name, result: 'failed', error: String(error) }); throw error; }
}
const config = join(process.env.XDG_CONFIG_HOME, 'com.docusage.app');
await mkdir(config, { recursive: true });
await writeFile(join(config, 'assistant-settings.json'), JSON.stringify({ launchHidden:true, hideOnClose:true,
  hideFromTaskbar:true, keepModelLoaded:false, globalShortcut:'Alt+Space', windowMode:'full', firstOpenDone:true, lastMonitorName:null }));
try {
  session = (await wd('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: process.env.DOCUSAGE_BINARY } } } })).sessionId;
  await waitFor('return !!document.querySelector("[data-desktop-app]");');
  await invoke('show_assistant_window');
  const fence = String.fromCharCode(96).repeat(3);
  const stored = { theme:'dark', mode:'general', documents:[], generalChats:[{ id:'fixture', name:'First chat',
    messages:[{id:'sample',sender:'bot',text:'### Notes\n\n**Bold example**\n\n'+fence+"js\nconsole.log('local');\n"+fence}] }],
    selectedGeneralChatId:'fixture', selectedDocId:null, drafts:{}, scrollPositions:{}, assistantWindowMode:'full', sidebarCollapsed:false, sidebarTab:'chats' };
  await execute('localStorage.setItem("docusage:app-state:v1",JSON.stringify(arguments[0]));location.reload();', [stored]);
  await waitFor('return !!document.querySelector("pre code");');
  await check('native Markdown and code copying reach the system clipboard', async () => {
    assert.match(await execute('return document.querySelector("pre code").textContent;'), /console\.log/);
    assert(await execute('return [...document.querySelectorAll("strong")].some(el=>el.textContent==="Bold example");'));
    const element = await wd('POST', '/session/' + session + '/element', { using:'css selector', value:'button[title="Copy code"]' });
    await wd('POST', '/session/' + session + '/element/' + Object.values(element)[0] + '/click', {});
    await waitFor('return [...document.querySelectorAll("button")].find(b=>b.title==="Copy code").textContent.includes("Copied");');
    assert.equal((await run('xsel', ['--clipboard', '--output'])).stdout, "console.log('local');");
  });
  await check('six appearance themes render and the selected theme survives reload', async () => {
    await click('Settings'); await click('Appearance');
    for (const name of ['Dark','Glass','Paper','Rose','Ocean','Light']) {
      await execute('const b=[...document.querySelectorAll("button")].find(b=>b.textContent.trim().startsWith(arguments[0]));b.click();', [name]);
      await sleep(100);
      const theme = await execute('return document.querySelector("[data-desktop-app]").style.colorScheme;');
      assert.equal(theme, ['Dark','Glass','Ocean'].includes(name) ? 'dark' : 'light');
    }
    await click('Close settings'); await sleep(350); await execute('location.reload();');
    await waitFor('return document.querySelector("[data-desktop-app]")?.style.colorScheme === "light";');
  });
  await check('drafts and chat search work across native sessions', async () => {
    await type('textarea', 'First draft', 'HTMLTextAreaElement');
    await click('New Chat');
    assert.equal(await execute('return document.querySelector("textarea").value;'), '');
    await type('textarea', 'Second draft', 'HTMLTextAreaElement');
    await click('First chat');
    assert.equal(await execute('return document.querySelector("textarea").value;'), 'First draft');
    await type('input[placeholder="Search"]', 'First');
    assert.equal(await execute('return [...document.querySelectorAll("aside button")].filter(b=>b.textContent.trim()==="New Chat").length;'), 1);
    await type('input[placeholder="Search"]', '');
    await sleep(350); await execute('location.reload();');
    await waitFor('return document.querySelector("textarea")?.value === "First draft";');
  });
  await check('custom global shortcuts persist and invalid replacements preserve the valid shortcut', async () => {
    await click('Settings'); await click('Shortcuts');
    await type('input[aria-label="Global shortcut"]', 'Ctrl+Shift+K'); await click('Save');
    await waitFor('return document.body.innerText.includes("Assistant settings saved");');
    await click('Close settings');
    await run('xdotool', ['key','--clearmodifiers','ctrl+shift+k']); await sleep(350);
    assert.equal((await invoke('get_assistant_status')).isVisible,false);
    await run('xdotool', ['key','--clearmodifiers','ctrl+shift+k']); await sleep(350);
    const current = await invoke('get_assistant_status'); assert.equal(current.isVisible,true);
    await assert.rejects(() => invoke('save_assistant_settings', { settings:{...current.settings,globalShortcut:'Alt+Space+N'} }));
    await run('xdotool', ['key','--clearmodifiers','ctrl+shift+k']); await sleep(350);
    assert.equal((await invoke('get_assistant_status')).isVisible,false);
  });
  completed = true;
} finally {
  await mkdir('docs/evidence', { recursive:true });
  await writeFile('docs/evidence/native-ui-results.json', JSON.stringify({ completed, fixtureMessagesAreAuthored:true, checks:outcomes },null,2));
  if (session) await wd('DELETE', '/session/' + session).catch(()=>{});
}
