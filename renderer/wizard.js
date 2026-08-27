// The onboarding wizard: choose a folder, pick the tools this project should use and get
// them signed in, then either describe what you want built or go straight to the board.
'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const wiz = $('wiz');
  const steps = [
    { title: 'Choose a folder', sub: 'This is where your agents will work.', body: 'wizFolder', next: 'Next' },
    { title: 'Pick your tools', sub: 'Only tools that are installed and signed in can be given work.', body: 'wizTools', next: 'Create project' },
    { title: 'Plan or build', sub: 'Describe an outcome and ConnectR turns it into routed tasks - or skip and open the board.', body: 'wizStart', next: 'Plan it' }
  ];

  let step = 0;
  let dir = '';
  let tools = [];
  const picked = new Set();
  let busy = false;

  function msg(text, isError) {
    const m = $('wizMsg');
    m.textContent = text || '';
    m.classList.toggle('error', Boolean(isError));
  }

  function setBusy(v) {
    busy = v;
    $('wizNext').disabled = v;
    $('wizBack').disabled = v;
  }

  function show() {
    const s = steps[step];
    $('wizStep').textContent = `Step ${step + 1} of ${steps.length}`;
    $('wizTitle').textContent = s.title;
    $('wizSub').textContent = s.sub;
    $('wizNext').textContent = s.next;
    $('wizBack').hidden = step === 0;
    $('wizCancel').textContent = step === 2 ? 'Skip - open the board' : 'Cancel';
    for (const st of steps) $(st.body).hidden = st.body !== s.body;
  }

  // A tool can only be given work if it is installed and not signed out. Participants
  // report signedIn: null because they authenticate inside their own IDE.
  function ready(t) {
    return t.installed && t.signedIn !== false;
  }

  function renderTools() {
    const list = $('wizToolList');
    if (!tools.length) {
      list.innerHTML = '<p class="empty">No coding tools detected. Install Claude Code, Codex or Gemini CLI and re-check.</p>';
      return;
    }
    list.innerHTML = '';
    for (const t of tools) {
      const row = document.createElement('div');
      row.className = 'tool' + (picked.has(t.tool) ? ' picked' : '') + (ready(t) ? '' : ' off');

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = picked.has(t.tool);
      box.disabled = !ready(t);
      box.addEventListener('change', () => {
        if (box.checked) picked.add(t.tool); else picked.delete(t.tool);
        renderTools();
      });

      const main = document.createElement('div');
      main.className = 't-main';
      const name = document.createElement('div');
      name.className = 't-name';
      name.textContent = t.tool;
      const state = document.createElement('div');
      state.className = 't-state' + (t.installed && t.signedIn === false ? ' warn' : ready(t) ? ' ok' : '');
      state.textContent = !t.installed
        ? 'not installed'
        : t.signedIn === false
          ? 'signed out'
          : t.kind === 'participant'
            ? 'joins the shared brain - a human drives it'
            : t.signedIn === null
              ? 'installed'
              : 'installed and signed in';
      main.append(name, state);
      row.append(box, main);

      if (t.installed && t.signedIn === false && t.signInHint) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Sign in';
        btn.addEventListener('click', async () => {
          const r = await window.connectr.signIn(t.signInHint);
          msg(r && r.ok
            ? `Finish signing in the terminal, then Re-check.`
            : `Run this yourself, then Re-check: ${t.signInHint}`, !(r && r.ok));
        });
        row.appendChild(btn);
      }
      list.appendChild(row);
    }
  }

  async function detect() {
    setBusy(true);
    msg('Looking for your coding tools...');
    const r = await window.connectr.detectTools(dir);
    setBusy(false);
    if (!r || !r.ok) {
      tools = [];
      renderTools();
      msg((r && r.error) || 'could not detect tools', true);
      return;
    }
    tools = r.tools || [];
    // Preselect everything usable, so the common case is one click.
    for (const t of tools) if (ready(t)) picked.add(t.tool);
    renderTools();
    const n = tools.filter(ready).length;
    msg(n ? `${n} tool${n === 1 ? '' : 's'} ready` : 'nothing is ready yet - sign in above');
  }

  async function next() {
    if (busy) return;
    if (step === 0) {
      dir = $('wizPath').value.trim();
      if (!dir) return msg('choose a folder first', true);
      step = 1; show(); await detect(); return;
    }
    if (step === 1) {
      if (!picked.size) return msg('pick at least one tool', true);
      setBusy(true);
      msg('Setting up the project...');
      const r = await window.connectr.createProject({ dir, tools: [...picked], mode: 'auto' });
      setBusy(false);
      if (!r || !r.ok) return msg((r && r.error) || 'could not create the project', true);
      step = 2; show(); msg('Project ready'); $('wizIntent').focus(); return;
    }
    // Step 3: open the project, then hand the intent to the dashboard's planner.
    const intent = $('wizIntent').value.trim();
    setBusy(true);
    msg('Opening...');
    const opened = await window.connectr.openProject(dir, intent || undefined);
    if (opened && opened.ok === false) { setBusy(false); return msg(opened.error || 'could not open', true); }
  }

  $('wizNext').addEventListener('click', next);
  $('wizBack').addEventListener('click', () => { if (!busy && step > 0) { step -= 1; show(); msg(''); } });
  $('wizCancel').addEventListener('click', async () => {
    if (busy) return;
    if (step === 2) { await window.connectr.openProject(dir); return; }
    wiz.hidden = true;
  });
  $('wizBrowse').addEventListener('click', async () => {
    const p = await window.connectr.pickFolder();
    if (p) $('wizPath').value = p;
  });
  $('wizRecheck').addEventListener('click', () => { if (!busy) detect(); });
  wiz.addEventListener('click', (e) => { if (e.target === wiz && step !== 2 && !busy) wiz.hidden = true; });

  // "New project" replaces the old bare path box as the primary way in.
  const open = () => { step = 0; picked.clear(); msg(''); show(); wiz.hidden = false; $('wizPath').focus(); };
  window.openWizard = open;
  const trigger = document.getElementById('new-project');
  if (trigger) trigger.addEventListener('click', open);
  show();
})();
