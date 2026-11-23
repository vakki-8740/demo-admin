'use strict';

// GitHub API calls happen directly from this browser. Credentials are kept only
// in the page's memory and are never written to storage or sent to a backend.
const API_ROOT = 'https://api.github.com';
const MAX_FILE_BYTES = 95 * 1024 * 1024; // Leave headroom below GitHub's 100 MB blob limit.
const DEFAULT_EXCLUDES = ['.git', 'node_modules', '.DS_Store', 'Thumbs.db', '.env', '.env.*'];
const els = {
  form: document.querySelector('#uploadForm'), repoUrl: document.querySelector('#repoUrl'),
  username: document.querySelector('#username'), token: document.querySelector('#githubToken'),
  openaiKey: document.querySelector('#openaiKey'), folderInput: document.querySelector('#folderInput'),
  chooseFolder: document.querySelector('#chooseFolder'), folderName: document.querySelector('#folderName'),
  folderSummary: document.querySelector('#folderSummary'), fileCount: document.querySelector('#fileCount'),
  excludedCount: document.querySelector('#excludedCount'), patterns: document.querySelector('#excludePatterns'),
  uploadButton: document.querySelector('#uploadButton'), statusText: document.querySelector('#statusText'),
  progressWrap: document.querySelector('#progressWrap'), progressLabel: document.querySelector('#progressLabel'),
  progressPercent: document.querySelector('#progressPercent'), progressBar: document.querySelector('#progressBar'),
  notice: document.querySelector('#notice'), repoLink: document.querySelector('#repoLink'),
  suggestButton: document.querySelector('#suggestButton')
};
let selectedFiles = [];
let isBusy = false;

function setNotice(message, kind = 'info') {
  els.notice.textContent = message;
  els.notice.className = `notice ${kind}`;
  els.notice.hidden = !message;
}
function clearNotice() { els.notice.hidden = true; els.notice.textContent = ''; }
function setProgress(percent, label) {
  const safe = Math.max(0, Math.min(100, Math.round(percent)));
  els.progressWrap.hidden = false;
  els.progressBar.style.width = `${safe}%`;
  els.progressPercent.textContent = `${safe}%`;
  els.progressLabel.textContent = label;
}
function setBusy(value) {
  isBusy = value;
  document.body.classList.toggle('is-busy', value);
  els.uploadButton.disabled = value || selectedFiles.length === 0;
  els.suggestButton.disabled = value;
  els.chooseFolder.disabled = value;
}
function parseRepoUrl(value) {
  let parsed;
  try { parsed = new URL(value.trim()); } catch { throw new Error('Enter a valid GitHub repository URL.'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || !/^([a-z0-9-]+\.)?github\.com$/i.test(parsed.hostname)) {
    throw new Error('Use a repository URL from github.com, such as https://github.com/owner/repository.');
  }
  const pieces = parsed.pathname.split('/').filter(Boolean);
  if (pieces.length < 2) throw new Error('The URL must include both the repository owner and repository name.');
  const owner = decodeURIComponent(pieces[0]);
  const repo = decodeURIComponent(pieces[1]).replace(/\.git$/i, '');
  if (!owner || !repo || pieces.length > 2) throw new Error('Enter a repository URL without extra path segments.');
  return { owner, repo, htmlUrl: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` };
}
function getPatterns() {
  return els.patterns.value.split(/\r?\n/).map(s => s.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean);
}
function globRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}
function isExcluded(path, patterns) {
  const segments = path.split('/');
  return patterns.some(pattern => {
    const re = globRegex(pattern);
    return re.test(path) || segments.some(segment => re.test(segment));
  });
}
function getIncludedFiles() {
  const patterns = getPatterns();
  return selectedFiles.map(file => {
    const relative = file.webkitRelativePath || file.name;
    const parts = relative.split('/');
    const path = parts.length > 1 ? parts.slice(1).join('/') : relative;
    return { file, path };
  }).filter(item => item.path && !isExcluded(item.path, patterns));
}
function updateSelection() {
  const included = getIncludedFiles();
  const excluded = selectedFiles.length - included.length;
  els.fileCount.textContent = `${included.length} ${included.length === 1 ? 'file' : 'files'} included`;
  els.excludedCount.textContent = ` · ${excluded} excluded`;
  els.folderSummary.hidden = selectedFiles.length === 0;
  els.uploadButton.disabled = isBusy || included.length === 0;
  if (selectedFiles.length && included.length === 0) {
    els.statusText.textContent = 'All selected files are excluded. Update the exclusion list to continue.';
  } else if (selectedFiles.length) {
    els.statusText.textContent = 'Folder selected. Check the files and repository details, then upload.';
  }
}

async function githubRequest(path, token, options = {}) {
  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The GitHub request timed out. Check your connection and try again.');
    throw new Error('Could not reach GitHub. Check your internet connection and browser network permissions.');
  }
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  if (!response.ok) {
    let message = data.message || `GitHub returned HTTP ${response.status}.`;
    if (response.status === 401) message = 'GitHub rejected the token. Check the token and make sure it has not expired.';
    const tokenPermissionError = /resource not accessible by personal access token|permission to .* denied/i.test(message);
    const rateLimitReached = /rate limit/i.test(message) || response.headers.get('x-ratelimit-remaining') === '0';
    if (response.status === 403 && tokenPermissionError) {
      message = `GitHub denied this token's permission. For a fine-grained token, grant the selected repository “Contents: Read and write” and “Metadata: Read-only”; confirm the correct repository is selected and the token is active. For a classic token on a private repository, grant the “repo” scope. Organization repositories may also require approval or SSO authorization. GitHub says: ${message}`;
    } else if (response.status === 403 && rateLimitReached) {
      const resetHeader = response.headers.get('x-ratelimit-reset');
      const reset = resetHeader ? new Date(Number(resetHeader) * 1000).toLocaleTimeString() : null;
      message = `GitHub API rate limit reached.${reset ? ` Try again after ${reset}.` : ' Wait a little, then try again.'} ${message}`;
    }
    if (response.status === 404) message = 'Repository or branch not found, or your token does not have access.';
    if (response.status === 422 && /already exists/i.test(message)) message = `GitHub rejected the update: ${message}`;
    // Include the endpoint (never the token) so permission failures can be
    // diagnosed by identifying whether blob, tree, commit, or ref access failed.
    throw new Error(`${message} (request: ${options.method || 'GET'} ${path})`);
  }
  return data;
}
function jsonBody(value) { return JSON.stringify(value); }
function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
function encodeRefBranch(branch) {
  return branch.split('/').map(encodeURIComponent).join('/');
}
async function mapWithLimit(items, limit, worker, onDone) {
  let next = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      const result = await worker(items[index], index);
      completed++;
      onDone(completed, items.length);
      items[index].sha = result;
    }
  });
  await Promise.all(workers);
}

async function uploadProject(event) {
  event.preventDefault();
  if (isBusy) return;
  clearNotice();
  els.repoLink.hidden = true;
  const token = els.token.value.trim();
  const username = els.username.value.trim();
  if (!selectedFiles.length) return setNotice('Select a project folder before uploading.', 'error');
  if (!token) return setNotice('Enter your GitHub personal access token.', 'error');
  if (!username) return setNotice('Enter your GitHub username.', 'error');

  let repo;
  try { repo = parseRepoUrl(els.repoUrl.value); } catch (error) { return setNotice(error.message, 'error'); }
  const included = getIncludedFiles();
  if (!included.length) return setNotice('There are no files to upload after applying exclusions.', 'error');
  const tooLarge = included.find(item => item.file.size > MAX_FILE_BYTES);
  if (tooLarge) return setNotice(`“${tooLarge.path}” is larger than 95 MB. GitHub's Git data API has a 100 MB per-file limit; exclude or reduce this file first.`, 'error');
  if (included.length > 100000) return setNotice('GitHub limits a tree to 100,000 entries. Exclude some files and upload in smaller batches.', 'error');

  setBusy(true);
  els.statusText.textContent = 'Checking access and preparing the commit…';
  setProgress(1, 'Validating repository access');
  try {
    const me = await githubRequest('/user', token);
    if (me.login.toLowerCase() !== username.toLowerCase()) {
      throw new Error(`The token belongs to “${me.login}”, not “${username}”. Enter the username associated with this token.`);
    }
    const repository = await githubRequest(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`, token);
    if (repository.permissions && repository.permissions.push === false) throw new Error('Your GitHub account does not have write access to this repository.');
    const branch = repository.default_branch || 'main';
    const refPath = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/git/ref/heads/${encodeRefBranch(branch)}`;

    let ref = null;
    try { ref = await githubRequest(refPath, token); }
    catch (error) {
      // GitHub may return HTTP 409 "Git Repository is empty" instead of a 404
      // when the repository has no first commit yet. Treat that as a new repo.
      const emptyRepository = /git repository is empty|repository is empty/i.test(error.message);
      if (!/not found|404/i.test(error.message) && !emptyRepository) throw error;
    }
    let parentSha = null;
    let baseTreeSha = null;
    if (ref) {
      parentSha = ref.object.sha;
      const parentCommit = await githubRequest(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/git/commits/${parentSha}`, token);
      baseTreeSha = parentCommit.tree.sha;
    }

    setProgress(3, `Uploading file data · 0 of ${included.length}`);
    els.statusText.textContent = `Uploading ${included.length} ${included.length === 1 ? 'file' : 'files'}…`;
    await mapWithLimit(included, 3, async item => {
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      const content = bytesToBase64(bytes);
      const blob = await githubRequest(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/git/blobs`, token, {
        method: 'POST', body: jsonBody({ content, encoding: 'base64' })
      });
      return blob.sha;
    }, (done, total) => setProgress(3 + (done / total) * 82, `Uploading file data · ${done} of ${total}`));

    setProgress(88, 'Creating a single commit');
    const treePayload = {
      tree: included.map(({ path, file, sha }) => ({ path, mode: '100644', type: 'blob', sha }))
    };
    if (baseTreeSha) treePayload.base_tree = baseTreeSha;
    const tree = await githubRequest(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/git/trees`, token, {
      method: 'POST', body: jsonBody(treePayload)
    });
    const commitPayload = { message: `Upload project files (${included.length} files)`, tree: tree.sha };
    if (parentSha) commitPayload.parents = [parentSha];
    const commit = await githubRequest(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/git/commits`, token, {
      method: 'POST', body: jsonBody(commitPayload)
    });

    setProgress(96, 'Updating repository branch');
    if (ref) {
      await githubRequest(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/git/refs/heads/${encodeRefBranch(branch)}`, token, {
        method: 'PATCH', body: jsonBody({ sha: commit.sha, force: false })
      });
    } else {
      // Empty repository: create the first commit and branch ref (no force update).
      await githubRequest(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/git/refs`, token, {
        method: 'POST', body: jsonBody({ ref: `refs/heads/${branch}`, sha: commit.sha })
      });
    }

    setProgress(100, 'Upload complete');
    els.statusText.textContent = 'Your project is now on GitHub.';
    setNotice(`Uploaded ${included.length} ${included.length === 1 ? 'file' : 'files'} in one commit to the “${branch}” branch. Existing repository files were preserved.`, 'success');
    els.repoLink.href = `${repo.htmlUrl}/tree/${branch.split('/').map(encodeURIComponent).join('/')}`;
    els.repoLink.hidden = false;
  } catch (error) {
    els.statusText.textContent = 'The upload could not be completed.';
    setNotice(error.message || 'An unexpected error occurred. Please try again.', 'error');
    els.progressWrap.hidden = true;
  } finally {
    setBusy(false);
  }
}

async function suggestExclusions() {
  if (isBusy) return;
  const key = els.openaiKey.value.trim();
  if (!key) return setNotice('Enter an OpenAI API key to request exclusion suggestions. This field is optional.', 'error');
  if (!selectedFiles.length) return setNotice('Select a project folder first so suggestions can be based on its files.', 'error');
  const paths = selectedFiles.map(file => {
    const raw = file.webkitRelativePath || file.name;
    const parts = raw.split('/');
    return parts.length > 1 ? parts.slice(1).join('/') : raw;
  }).slice(0, 1500);
  const buttonLabel = els.suggestButton.textContent;
  els.suggestButton.disabled = true;
  els.suggestButton.textContent = 'Reviewing…';
  clearNotice();
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        instructions: 'You are a file housekeeping helper, not a chatbot. Given project paths, suggest only clearly unnecessary generated/dependency/cache/secret files or folders that are present. Return ONLY a newline-separated list of exact path or basename patterns, with no bullets or explanation. Do not suggest excluding source files, configs, or assets needed to build/run the project. If none, return NONE.',
        input: paths.join('\n')
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || `OpenAI returned HTTP ${response.status}.`);
    const text = data.output_text || (data.output || []).flatMap(item => item.content || []).map(part => part.text || '').join('\n');
    const suggestions = text.split(/\r?\n/).map(line => line.trim().replace(/^[-*•\s]+/, '')).filter(line => line && line.toUpperCase() !== 'NONE');
    const valid = suggestions.filter(candidate => paths.some(path => path === candidate || path.split('/').includes(candidate) || (candidate.includes('*') && globRegex(candidate).test(path))));
    const current = els.patterns.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const fresh = valid.filter(item => !current.includes(item));
    if (!fresh.length) setNotice('No additional, clearly unnecessary files were identified. Review the current exclusions before uploading.', 'info');
    else {
      els.patterns.value = [...current, ...fresh].join('\n');
      updateSelection();
      setNotice(`Added ${fresh.length} suggestion${fresh.length === 1 ? '' : 's'} to the exclusion list. Please review the list before uploading.`, 'success');
    }
  } catch (error) {
    setNotice(`Could not get suggestions: ${error.message}`, 'error');
  } finally {
    els.suggestButton.disabled = false;
    els.suggestButton.textContent = buttonLabel;
  }
}

els.chooseFolder.addEventListener('click', () => els.folderInput.click());
els.folderInput.addEventListener('change', () => {
  selectedFiles = Array.from(els.folderInput.files || []);
  const firstPath = selectedFiles[0]?.webkitRelativePath || '';
  const folder = firstPath.split('/')[0] || 'Selected folder';
  els.folderName.textContent = selectedFiles.length ? folder : 'Select a project folder';
  els.folderInput.value = '';
  clearNotice();
  els.progressWrap.hidden = true;
  els.repoLink.hidden = true;
  updateSelection();
});
els.patterns.addEventListener('input', updateSelection);
els.form.addEventListener('submit', uploadProject);
els.suggestButton.addEventListener('click', suggestExclusions);
