'use strict';

const list = document.getElementById('projects');
const empty = document.getElementById('empty');
const form = document.getElementById('add-form');
const fields = document.getElementById('add-fields');
const input = document.getElementById('path-input');
const browse = document.getElementById('browse');
const status = document.getElementById('status');

let busy = false;

function setStatus(text, isError) {
  status.textContent = text || '';
  status.hidden = !text;
  status.classList.toggle('error', Boolean(isError));
}

function setBusy(value) {
  busy = value;
  fields.disabled = value;
  for (const button of list.querySelectorAll('button')) button.disabled = value;
}

function render(projects) {
  list.textContent = '';
  empty.hidden = projects.length > 0;

  for (const project of projects) {
    const button = document.createElement('button');
    button.type = 'button';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = project.name;

    const path = document.createElement('span');
    path.className = 'path';
    path.textContent = project.path;

    button.append(name, path);
    button.addEventListener('click', () => open(project.path));

    const item = document.createElement('li');
    item.appendChild(button);
    list.appendChild(item);
  }
}

async function open(path) {
  if (busy) return;
  setBusy(true);
  setStatus('Starting server...', false);
  try {
    const result = await window.connectr.openProject(path);
    if (!result || !result.ok) {
      setStatus(result && result.error ? result.error : 'Failed to start the server.', true);
    }
    // On success the main process navigates this window to the dashboard;
    // leave the "Starting server..." state in place until it does.
  } catch (err) {
    setStatus(String((err && err.message) || err), true);
  } finally {
    if (status.classList.contains('error')) setBusy(false);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const path = input.value.trim();
  if (!path || busy) return;
  setBusy(true);
  setStatus('', false);
  try {
    render(await window.connectr.addProject(path));
    input.value = '';
  } catch (err) {
    setStatus(String((err && err.message) || err), true);
  } finally {
    setBusy(false);
  }
});

browse.addEventListener('click', async () => {
  if (busy) return;
  const picked = await window.connectr.pickFolder();
  if (picked) input.value = picked;
});

(async () => {
  try {
    render(await window.connectr.listProjects());
  } catch (err) {
    render([]);
    setStatus(String((err && err.message) || err), true);
  }
})();
