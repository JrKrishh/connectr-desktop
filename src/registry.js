'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function registryPath() {
  return path.join(os.homedir(), '.connectr', 'projects.json');
}

function readProjects(file) {
  const target = file || registryPath();
  let raw;
  try {
    raw = fs.readFileSync(target, 'utf8');
  } catch (err) {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      typeof entry.name === 'string' &&
      typeof entry.path === 'string'
  ).map((entry) => ({ name: entry.name, path: entry.path }));
}

function addProject(dirPath, file) {
  const target = file || registryPath();
  const resolved = path.resolve(dirPath);
  const projects = readProjects(target);
  if (projects.some((p) => p.path === resolved)) return projects;

  projects.push({ name: path.basename(resolved), path: resolved });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(projects, null, 2) + '\n', 'utf8');
  return projects;
}

module.exports = { registryPath, readProjects, addProject };
