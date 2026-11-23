'use strict';

// Static browser app: secrets are encrypted with Web Crypto and stored only as
// ciphertext in IndexedDB. GitHub/OpenAI requests go directly from this browser.
const API_ROOT = 'https://api.github.com';
const DB_NAME = 'github-manager-vault';
const DB_STORE = 'encrypted-settings';
const VAULT_ID = 'main';
const KDF_ITERATIONS = 310000;
const MAX_FILE_BYTES = 95 * 1024 * 1024;
const MAX_TREE_ENTRIES = 100000;
const els = Object.fromEntries([
  'vaultGate','vaultTitle','vaultDescription','vaultForm','vaultPassword','vaultConfirm','vaultPasswordField','vaultConfirmField','vaultButton','vaultNotice',
  'app','repoSelect','refreshRepos','uploadPermission','folderInput','chooseFolder','folderName','folderSummary','fileCount','excludedCount','excludePatterns','uploadForm','uploadButton','uploadStatus','uploadProgress','progressLabel','progressPercent','progressBar','uploadNotice','repoLink','suggestButton',
  'connectionBadge','lockButton','footerLock','settingsForm','settingsUsername','settingsToken','settingsOpenai','settingsStatus','saveSettings','testConnection','clearCredentials','managerMessage','managerNotice','fileList','emptyState','visibleCount','selectVisible','deleteSelected','selectedCount','deleteAll','breadcrumbs','refreshContents','filePreviewPanel','previewTitle','previewContent','closePreview'
].map(id => [id, document.getElementById(id)]));
const state = {
  db: null, key: null, credentials: { username: '', token: '', openaiKey: '' },
  repos: [], selectedRepo: null, files: [], currentDir: '', selectedPaths: new Set(), busy: false, vaultExists: false
};

function showNotice(element, message, type = 'info') {
  element.textContent = message;
  element.className = `notice ${type}`;
  element.hidden = !message;
}
function clearNotice(element) { element.hidden = true; element.textContent = ''; }
function setSettingsStatus(message, type = '') {
  els.settingsStatus.textContent = message;
  els.settingsStatus.className = `settings-status ${type}`.trim();
}
function setProgress(percent, label) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  els.uploadProgress.hidden = false;
  els.progressBar.style.width = `${value}%`;
  els.progressPercent.textContent = `${value}%`;
  els.progressLabel.textContent = label;
}
function setBusy(value) {
  state.busy = value;
  document.body.classList.toggle('is-busy', value);
  els.uploadButton.disabled = value || !state.selectedRepo || !includedLocalFiles().length || !canWrite(state.selectedRepo);
  els.refreshRepos.disabled = value;
  els.refreshContents.disabled = value;
  els.chooseFolder.disabled = value;
  els.suggestButton.disabled = value;
}
function goPage(page) {
  document.querySelectorAll('[data-page-panel]').forEach(panel => {
    const active = panel.dataset.pagePanel === page;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  document.querySelectorAll('.nav-link').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  if (page === 'manager' && state.selectedRepo && !state.files.length) refreshContents();
}

// ---- Encrypted local vault (AES-GCM + PBKDF2, no plaintext localStorage) ----
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open browser storage.'));
  });
}
function readVaultRecord() {
  return new Promise((resolve, reject) => {
    const request = state.db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(VAULT_ID);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Could not read the encrypted vault.'));
  });
}
function writeVaultRecord(record) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not save the encrypted vault.'));
    tx.onabort = () => reject(tx.error || new Error('Vault save was cancelled.'));
  });
}
function deleteVaultRecord() {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(VAULT_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not clear the vault.'));
  });
}
async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt','decrypt']);
}
async function encryptSettings(settings, key = state.key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(settings));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const prior = await readVaultRecord();
  return { id: VAULT_ID, version: 1, iterations: KDF_ITERATIONS, salt: prior?.salt, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}
async function saveEncryptedSettings(settings) {
  const prior = await readVaultRecord();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(settings));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, state.key, plaintext);
  await writeVaultRecord({ id: VAULT_ID, version: 1, iterations: prior.iterations || KDF_ITERATIONS, salt: prior.salt, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) });
}
function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function fromBase64(text) { return Uint8Array.from(atob(text), char => char.charCodeAt(0)); }
async function createVault(passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  state.key = await deriveKey(passphrase, salt);
  state.credentials = { username: '', token: '', openaiKey: '', selectedRepo: '' };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, state.key, new TextEncoder().encode(JSON.stringify(state.credentials)));
  await writeVaultRecord({ id: VAULT_ID, version: 1, iterations: KDF_ITERATIONS, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) });
  state.vaultExists = true;
  enterApp();
}
async function unlockVault(passphrase, record) {
  const iterations = record.iterations || KDF_ITERATIONS;
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  state.key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: fromBase64(record.salt), iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt','decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(record.iv) }, state.key, fromBase64(record.ciphertext));
  state.credentials = JSON.parse(new TextDecoder().decode(plaintext));
  state.vaultExists = true;
  enterApp();
}
function configureVaultScreen(exists) {
  state.vaultExists = exists;
  els.vaultConfirmField.hidden = exists;
  els.vaultTitle.textContent = exists ? 'Unlock your vault' : 'Create your local vault';
  els.vaultDescription.textContent = exists
    ? 'Your GitHub and OpenAI credentials are encrypted on this device. Enter your vault passphrase to continue.'
    : 'Choose a vault passphrase. It encrypts your credentials on this device and is required each time you open the app.';
  els.vaultButton.textContent = exists ? 'Unlock vault' : 'Create encrypted vault';
  els.vaultPassword.autocomplete = exists ? 'current-password' : 'new-password';
}
async function initializeVault() {
  if (!window.isSecureContext || !window.crypto?.subtle || !window.indexedDB) {
    showNotice(els.vaultNotice, 'Secure browser storage is unavailable. Open this app from http://localhost (not file://) in a current browser.', 'error');
    els.vaultButton.disabled = true;
    return;
  }
  try {
    state.db = await openDatabase();
    const record = await readVaultRecord();
    configureVaultScreen(Boolean(record));
  } catch (error) {
    showNotice(els.vaultNotice, error.message, 'error');
  }
}
function enterApp() {
  els.vaultGate.hidden = true;
  els.app.hidden = false;
  els.vaultPassword.value = '';
  els.vaultConfirm.value = '';
  els.connectionBadge.classList.add('offline');
  els.connectionBadge.querySelector('span').textContent = state.credentials.token ? 'Connecting…' : 'Credentials needed';
  fillSettingsForm();
  if (state.credentials.token && state.credentials.username) {
    refreshRepositories().catch(() => {});
  } else {
    renderRepoOptions('Open Settings to add your GitHub username and token.');
    goPage('upload');
  }
}
function lockVault() {
  if (state.busy) return;
  state.key = null;
  state.credentials = { username: '', token: '', openaiKey: '', selectedRepo: '' };
  state.repos = [];
  state.selectedRepo = null;
  state.files = [];
  state.selectedPaths.clear();
  selectedLocalFiles = [];
  els.folderName.textContent = 'Select a project folder';
  els.folderSummary.hidden = true;
  els.settingsUsername.value = '';
  els.settingsToken.value = '';
  els.settingsOpenai.value = '';
  els.app.hidden = true;
  els.vaultGate.hidden = false;
  els.vaultPassword.value = '';
  els.vaultConfirm.value = '';
  clearNotice(els.vaultNotice);
  configureVaultScreen(true);
  els.vaultPassword.focus();
}

// ---- GitHub REST API ----
async function githubRequest(path, options = {}) {
  const token = state.credentials.token;
  if (!token) throw new Error('Save a GitHub token in Settings first.');
  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {})
      }
    });
  } catch {
    throw new Error('Could not reach GitHub. Check your internet connection and browser network permissions.');
  }
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  if (!response.ok) {
    let message = data.message || `GitHub returned HTTP ${response.status}.`;
    if (response.status === 401) message = 'GitHub rejected the token. Check that it is active and correct.';
    const permissionError = /resource not accessible by personal access token|permission to .* denied/i.test(message);
    const rateLimit = /rate limit/i.test(message) || response.headers.get('x-ratelimit-remaining') === '0';
    if (response.status === 403 && permissionError) message = `Token permission denied. Check repository access, Contents read/write, and organization approval/SSO. GitHub says: ${message}`;
    else if (response.status === 403 && rateLimit) {
      const reset = response.headers.get('x-ratelimit-reset');
      message = `GitHub API rate limit reached${reset ? `; try again after ${new Date(Number(reset) * 1000).toLocaleTimeString()}` : ''}. ${message}`;
    }
    if (response.status === 404) message = 'Repository or branch not found, or your token cannot access it.';
    throw new Error(`${message} (request: ${options.method || 'GET'} ${path})`);
  }
  return data;
}
function jsonBody(body) { return JSON.stringify(body); }
function apiRepoPath(repo = state.selectedRepo) {
  if (!repo) throw new Error('Select a repository first.');
  return `/repos/${encodeURIComponent(repo.owner.login || repo.owner)}/${encodeURIComponent(repo.name)}`;
}
function encodeBranch(branch) { return branch.split('/').map(encodeURIComponent).join('/'); }
function getDefaultBranch(repo = state.selectedRepo) { return repo?.default_branch || 'main'; }
function canWrite(repo = state.selectedRepo) { return Boolean(repo && (!repo.permissions || repo.permissions.push !== false)); }

async function getUser() { return githubRequest('/user'); }
async function fetchAllRepositories() {
  const all = [];
  for (let page = 1; page <= 50; page++) {
    const part = await githubRequest(`/user/repos?visibility=all&affiliation=owner%2Ccollaborator%2Corganization_member&sort=full_name&per_page=100&page=${page}`);
    all.push(...part);
    if (part.length < 100) break;
  }
  return all;
}
function repoLabel(repo) { return `${repo.full_name}${repo.private ? ' · private' : ''}${canWrite(repo) ? '' : ' · read-only'}`; }
function renderRepoOptions(placeholder = 'Select a repository…') {
  const prior = state.credentials.selectedRepo || state.selectedRepo?.full_name || '';
  els.repoSelect.replaceChildren();
  const first = document.createElement('option'); first.value = ''; first.textContent = placeholder; els.repoSelect.append(first);
  state.repos.forEach(repo => {
    const option = document.createElement('option'); option.value = repo.full_name; option.textContent = repoLabel(repo); els.repoSelect.append(option);
  });
  const selected = state.repos.find(repo => repo.full_name === prior) || state.repos.find(canWrite) || state.repos[0] || null;
  if (selected) {
    state.selectedRepo = selected;
    els.repoSelect.value = selected.full_name;
    state.credentials.selectedRepo = selected.full_name;
  } else {
    state.selectedRepo = null;
    els.repoSelect.value = '';
  }
  els.repoSelect.disabled = !state.repos.length;
  updateSelectedRepoUI();
}
async function refreshRepositories() {
  if (!state.credentials.token) { renderRepoOptions('Set up GitHub credentials in Settings'); return; }
  els.refreshRepos.disabled = true;
  els.connectionBadge.classList.add('offline');
  els.connectionBadge.querySelector('span').textContent = 'Connecting…';
  try {
    const me = await getUser();
    if (me.login.toLowerCase() !== state.credentials.username.toLowerCase()) throw new Error(`Token account is “${me.login}”, but Settings username is “${state.credentials.username}”.`);
    state.repos = await fetchAllRepositories();
    renderRepoOptions(state.repos.length ? 'Select a repository…' : 'No accessible repositories found');
    els.connectionBadge.classList.remove('offline');
    els.connectionBadge.querySelector('span').textContent = `${me.login} · ${state.repos.length} repos`;
    if (!state.repos.length) {
      els.uploadPermission.textContent = 'No accessible repositories found. Check token repository access and permissions.';
      if (!els.managerNotice.hidden) showNotice(els.managerNotice, 'No accessible repositories were returned by GitHub.', 'info');
    }
    if (document.querySelector('[data-page-panel="manager"]').classList.contains('active') && state.selectedRepo) await refreshContents();
  } catch (error) {
    els.connectionBadge.classList.add('offline');
    els.connectionBadge.querySelector('span').textContent = 'Connection failed';
    renderRepoOptions('Could not load repositories');
    showNotice(els.uploadNotice, error.message, 'error');
    showNotice(els.managerNotice, error.message, 'error');
  } finally { els.refreshRepos.disabled = false; updateSelectedRepoUI(); }
}
function updateSelectedRepoUI() {
  const repo = state.selectedRepo;
  els.uploadButton.disabled = state.busy || !repo || !includedLocalFiles().length || !canWrite(repo);
  els.uploadPermission.textContent = !repo ? 'Save GitHub credentials and select a repository.'
    : canWrite(repo) ? `${repo.full_name} · ${getDefaultBranch(repo)} branch · write access available.`
    : `${repo.full_name} is read-only for this token; select a repository with write access.`;
  els.deleteSelected.disabled = state.busy || !repo || !canWrite(repo) || state.selectedPaths.size === 0;
  els.deleteAll.disabled = state.busy || !repo || !canWrite(repo) || state.files.length === 0;
}

// ---- Repository upload (single tree + commit, preserving other paths) ----
let selectedLocalFiles = [];
function parsePatterns() { return els.excludePatterns.value.split(/\r?\n/).map(x => x.trim().replace(/^\/+|\/+$/g,'')).filter(Boolean); }
function globRegex(pattern) { return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.')}$`,'i'); }
function isExcluded(path, patterns) { return patterns.some(pattern => { const re=globRegex(pattern); return re.test(path)||path.split('/').some(part=>re.test(part)); }); }
function includedLocalFiles() {
  const patterns=parsePatterns();
  return selectedLocalFiles.map(file=>{const raw=file.webkitRelativePath||file.name;const parts=raw.split('/');return {file,path:parts.length>1?parts.slice(1).join('/'):raw};}).filter(x=>x.path&&!isExcluded(x.path,patterns));
}
function updateLocalSelection() {
  const included=includedLocalFiles(); const excluded=selectedLocalFiles.length-included.length;
  els.fileCount.textContent=`${included.length} ${included.length===1?'file':'files'} included`;
  els.excludedCount.textContent=` · ${excluded} excluded`;
  els.folderSummary.hidden=!selectedLocalFiles.length;
  if(selectedLocalFiles.length&&included.length===0) els.uploadStatus.textContent='All selected files are excluded. Update the exclusion list to continue.';
  else if(selectedLocalFiles.length) els.uploadStatus.textContent='Folder selected. Check the destination and exclusions, then upload.';
  updateSelectedRepoUI();
}
function fileBase64(bytes) { let s=''; for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000)); return btoa(s); }
function encodeRepoPath(path) { return path.split('/').map(encodeURIComponent).join('/'); }
async function mapConcurrent(items, limit, work, progress) {
  let next=0,done=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;items[i].sha=await work(items[i]);progress(++done,items.length);}}));
}
async function uploadProject(event) {
  event.preventDefault(); clearNotice(els.uploadNotice); els.repoLink.hidden=true;
  const repo=state.selectedRepo; const included=includedLocalFiles();
  if(!repo) return showNotice(els.uploadNotice,'Select a repository first.','error');
  if(!canWrite(repo)) return showNotice(els.uploadNotice,'This token has read-only access to the selected repository.','error');
  if(!included.length) return showNotice(els.uploadNotice,'Select a folder with at least one included file.','error');
  const huge=included.find(item=>item.file.size>MAX_FILE_BYTES);
  if(huge) return showNotice(els.uploadNotice,`“${huge.path}” exceeds the 95 MB per-file limit. Exclude or reduce it first.`,'error');
  if(included.length>MAX_TREE_ENTRIES) return showNotice(els.uploadNotice,'GitHub tree limit is 100,000 entries; exclude some files and upload in batches.','error');
  let bootstrappedPath=null;
  setBusy(true); els.uploadStatus.textContent='Checking repository access…'; setProgress(1,'Validating repository');
  try {
    const repositoryPath=apiRepoPath(repo);
    const current=await githubRequest(repositoryPath);
    if(current.permissions?.push===false) throw new Error('GitHub confirms that your token cannot push to this repository.');
    let branch=getDefaultBranch(repo); const base=`${repositoryPath}/git`;
    let ref=null;
    try { ref=await githubRequest(`${base}/ref/heads/${encodeBranch(branch)}`); }
    catch(error) { if(!/git repository is empty|repository is empty/i.test(error.message)) throw error; }

    // GitHub does not allow creating Git blobs while a repository has no first
    // commit. Bootstrap the default branch via the Contents API, then use Git
    // Trees/Commits for the rest of the upload. Existing repos still get one commit.
    let remaining=included;
    let parentSha=null,baseTree=null;
    if(!ref) {
      const first=included[0];
      els.uploadStatus.textContent='Starting the empty repository…';
      setProgress(4,'Creating the first repository commit');
      const bytes=new Uint8Array(await first.file.arrayBuffer());
      await githubRequest(`${repositoryPath}/contents/${encodeRepoPath(first.path)}`,{
        method:'PUT',body:jsonBody({message:`Initialize repository with ${first.path}`,content:fileBase64(bytes)})
      });
      bootstrappedPath=first.path;
      const updatedRepo=await githubRequest(repositoryPath);
      branch=updatedRepo.default_branch||branch;
      repo.default_branch=branch;
      ref=await githubRequest(`${base}/ref/heads/${encodeBranch(branch)}`);
      parentSha=ref.object.sha;
      const initialCommit=await githubRequest(`${base}/commits/${parentSha}`);
      baseTree=initialCommit.tree.sha;
      remaining=included.slice(1);
    } else {
      parentSha=ref.object.sha;
      const parentCommit=await githubRequest(`${base}/commits/${parentSha}`);
      baseTree=parentCommit.tree.sha;
    }

    els.uploadStatus.textContent=`Uploading ${included.length} ${included.length===1?'file':'files'}…`;
    if(remaining.length) {
      await mapConcurrent(remaining,2,async item=>{
        const bytes=new Uint8Array(await item.file.arrayBuffer());
        const blob=await githubRequest(`${base}/blobs`,{method:'POST',body:jsonBody({content:fileBase64(bytes),encoding:'base64'})});
        return blob.sha;
      },(done,total)=>setProgress(8+done/total*76,`Uploading file data · ${done} of ${total}`));
      const treeBody={base_tree:baseTree,tree:remaining.map(({path,sha})=>({path,mode:'100644',type:'blob',sha}))};
      setProgress(88,'Creating a single commit for remaining files');
      const tree=await githubRequest(`${base}/trees`,{method:'POST',body:jsonBody(treeBody)});
      const commit=await githubRequest(`${base}/commits`,{method:'POST',body:jsonBody({message:`Upload remaining project files (${remaining.length})`,tree:tree.sha,parents:[parentSha]})});
      setProgress(96,'Updating repository branch');
      await githubRequest(`${base}/refs/heads/${encodeBranch(branch)}`,{method:'PATCH',body:jsonBody({sha:commit.sha,force:false})});
    }
    setProgress(100,'Upload complete');
    els.uploadStatus.textContent='Your project is now on GitHub.';
    const commitInfo=bootstrappedPath
      ? (remaining.length ? 'The empty repository was initialized first, then the remaining files were added in a follow-up commit.' : 'The empty repository was initialized with its first commit.')
      : 'All files were uploaded in one commit; existing repository files were preserved.';
    showNotice(els.uploadNotice,`Uploaded ${included.length} ${included.length===1?'file':'files'} to ${repo.full_name}. ${commitInfo}`,'success');
    els.repoLink.href=`${repo.html_url}/tree/${branch.split('/').map(encodeURIComponent).join('/')}`; els.repoLink.hidden=false;
    state.files=[]; if(document.querySelector('[data-page-panel="manager"]').classList.contains('active')) await refreshContents();
  } catch(error) {
    els.uploadStatus.textContent='Upload could not be completed.';
    const detail=bootstrappedPath?`GitHub created the first commit with “${bootstrappedPath}”, but the rest did not finish. Retry the upload to continue. ${error.message}`:error.message;
    showNotice(els.uploadNotice,detail,'error');els.uploadProgress.hidden=true;
  }
  finally {setBusy(false);}
}

// ---- Repository browser and Git-tree mutations ----
function repoBranchRefPath(repo=state.selectedRepo) { return `${apiRepoPath(repo)}/git/ref/heads/${encodeBranch(getDefaultBranch(repo))}`; }
async function loadRepositoryFiles() {
  let ref;
  try { ref=await githubRequest(repoBranchRefPath()); }
  catch(error) {
    if(/git repository is empty|repository is empty/i.test(error.message)) { state.files=[]; state.selectedPaths.clear(); state.currentDir=''; return; }
    throw error;
  }
  const commit=await githubRequest(`${apiRepoPath()}/git/commits/${ref.object.sha}`);
  const tree=await githubRequest(`${apiRepoPath()}/git/trees/${commit.tree.sha}?recursive=1`);
  if(tree.truncated) throw new Error('GitHub truncated this repository tree. Browse a smaller repository or use the GitHub website for the full listing.');
  state.files=(tree.tree||[]).filter(item=>item.type==='blob').map(item=>({path:item.path,sha:item.sha,size:item.size||0,mode:item.mode})).sort((a,b)=>a.path.localeCompare(b.path));
  state.selectedPaths.clear(); state.currentDir='';
}
function setManagerMessage(message,type='') { els.managerMessage.textContent=message;els.managerMessage.className=`manager-message ${type}`.trim(); }
async function refreshContents() {
  if(!state.selectedRepo){setManagerMessage('Select a repository to browse its files.');renderFileList();return;}
  if(!state.credentials.token){setManagerMessage('Add GitHub credentials in Settings first.','error');return;}
  setManagerMessage(`Loading ${state.selectedRepo.full_name}…`);els.refreshContents.disabled=true;clearNotice(els.managerNotice);
  try {await loadRepositoryFiles();setManagerMessage(`${state.files.length} tracked ${state.files.length===1?'file':'files'} on ${getDefaultBranch()}.`);renderFileList();}
  catch(error){setManagerMessage(error.message,'error');state.files=[];renderFileList();}
  finally{els.refreshContents.disabled=false;updateSelectedRepoUI();}
}
function directEntries(dir) {
  const prefix=dir?`${dir}/`:'';const folders=new Set();const files=[];
  for(const file of state.files){if(!file.path.startsWith(prefix))continue;const rest=file.path.slice(prefix.length);if(!rest)continue;const slash=rest.indexOf('/');if(slash>=0)folders.add(prefix+rest.slice(0,slash));else files.push(file);}
  return {folders:[...folders].sort((a,b)=>a.localeCompare(b)),files:files.sort((a,b)=>a.path.localeCompare(b.path))};
}
function makeButton(label,className,handler,title='') {const b=document.createElement('button');b.type='button';b.className=className;b.textContent=label;if(title)b.title=title;b.addEventListener('click',handler);return b;}
function renderBreadcrumbs() {
  els.breadcrumbs.replaceChildren();const segments=state.currentDir?state.currentDir.split('/'):[];
  const root=makeButton(state.selectedRepo?.name||'Repository','crumb',()=>{state.currentDir='';renderFileList();});els.breadcrumbs.append(root);
  let path='';segments.forEach((part,index)=>{const sep=document.createElement('span');sep.className='crumb-sep';sep.textContent='/';els.breadcrumbs.append(sep);path+=(path?'/':'')+part;const target=path;els.breadcrumbs.append(makeButton(part,'crumb',()=>{state.currentDir=target;renderFileList();}));});
}
function formatSize(size) {if(!size)return '—';if(size<1024)return `${size} B`;if(size<1024*1024)return `${(size/1024).toFixed(1)} KB`;return `${(size/1024/1024).toFixed(1)} MB`;}
function renderFileList() {
  els.fileList.replaceChildren();renderBreadcrumbs();
  const {folders,files}=directEntries(state.currentDir);const visibleCount=folders.length+files.length;
  els.visibleCount.textContent=`${visibleCount} item${visibleCount===1?'':'s'}`;
  els.emptyState.hidden=visibleCount!==0;
  els.selectVisible.checked=files.length>0&&files.every(file=>state.selectedPaths.has(file.path));
  els.selectVisible.indeterminate=files.some(file=>state.selectedPaths.has(file.path))&&!els.selectVisible.checked;
  for(const folderPath of folders){
    const row=document.createElement('div');row.className='file-row folder-row';
    const item=document.createElement('div');item.className='file-item';const glyph=document.createElement('span');glyph.className='file-symbol';glyph.textContent='▰';item.append(glyph);
    const name=makeButton(folderPath.split('/').pop(),'file-name-button',()=>{state.currentDir=folderPath;renderFileList();});item.append(name);
    const size=document.createElement('span');size.className='file-size';size.textContent='Folder';
    const actions=document.createElement('div');actions.className='file-actions';actions.append(makeButton('Delete folder','text-action danger',()=>deleteFolder(folderPath),`Delete ${folderPath}`));
    row.append(item,size,actions);els.fileList.append(row);
  }
  for(const file of files){
    const row=document.createElement('div');row.className='file-row';
    const item=document.createElement('div');item.className='file-item';const check=document.createElement('input');check.type='checkbox';check.checked=state.selectedPaths.has(file.path);check.setAttribute('aria-label',`Select ${file.path}`);check.addEventListener('change',()=>{if(check.checked)state.selectedPaths.add(file.path);else state.selectedPaths.delete(file.path);updateSelectedRepoUI();updateSelectedCount();renderSelectAllState(files);});
    const glyph=document.createElement('span');glyph.className='file-symbol';glyph.textContent='▤';item.append(check,glyph);
    item.append(makeButton(file.path.split('/').pop(),'file-name-button',()=>previewFile(file),`Preview ${file.path}`));
    const size=document.createElement('span');size.className='file-size';size.textContent=formatSize(file.size);
    const actions=document.createElement('div');actions.className='file-actions';actions.append(makeButton('Move / rename','text-action',()=>moveFile(file),`Move or rename ${file.path}`),makeButton('Delete','text-action danger',()=>deletePaths([file.path],`Delete “${file.path}”?`),'Delete file'));
    row.append(item,size,actions);els.fileList.append(row);
  }
  updateSelectedCount();updateSelectedRepoUI();
}
function renderSelectAllState(files=directEntries(state.currentDir).files){els.selectVisible.checked=files.length>0&&files.every(file=>state.selectedPaths.has(file.path));els.selectVisible.indeterminate=files.some(file=>state.selectedPaths.has(file.path))&&!els.selectVisible.checked;}
function updateSelectedCount(){els.selectedCount.textContent=state.selectedPaths.size?`(${state.selectedPaths.size})`:'';els.deleteSelected.disabled=!canWrite()||state.selectedPaths.size===0||state.busy;}
async function previewFile(file) {
  els.filePreviewPanel.hidden=false;els.previewTitle.textContent=file.path;els.previewContent.textContent='Loading preview…';
  try {
    if(file.size>1024*1024){els.previewContent.textContent='Preview is limited to files under 1 MB. Use GitHub to view this larger file.';return;}
    const encoded=file.path.split('/').map(encodeURIComponent).join('/');const data=await githubRequest(`${apiRepoPath()}/contents/${encoded}?ref=${encodeURIComponent(getDefaultBranch())}`);
    if(data.encoding!=='base64'||!data.content){els.previewContent.textContent='This file cannot be previewed as text.';return;}
    const binary=atob(data.content.replace(/\n/g,''));const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    try{els.previewContent.textContent=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{els.previewContent.textContent='Binary or non-UTF-8 file. Preview is unavailable.';}
  }catch(error){els.previewContent.textContent=error.message;}
}
async function makeCommit(changes,message) {
  const repo=state.selectedRepo;if(!repo)throw new Error('Select a repository first.');if(!canWrite(repo))throw new Error('This token has read-only access to the selected repository.');
  const base=apiRepoPath(repo);const branch=getDefaultBranch(repo);const ref=await githubRequest(`${base}/git/ref/heads/${encodeBranch(branch)}`);const parentSha=ref.object.sha;
  const parent=await githubRequest(`${base}/git/commits/${parentSha}`);
  const tree=await githubRequest(`${base}/git/trees`,{method:'POST',body:jsonBody({base_tree:parent.tree.sha,tree:changes})});
  const commit=await githubRequest(`${base}/git/commits`,{method:'POST',body:jsonBody({message,tree:tree.sha,parents:[parentSha]})});
  await githubRequest(`${base}/git/refs/heads/${encodeBranch(branch)}`,{method:'PATCH',body:jsonBody({sha:commit.sha,force:false})});
}
async function runMutation(paths,changes,message,confirmText) {
  if(!paths.length)return;
  if(!canWrite())return showNotice(els.managerNotice,'This token cannot write to the selected repository.','error');
  if(!window.confirm(confirmText))return;
  setBusy(true);showNotice(els.managerNotice,'Committing repository change…','info');
  try{await makeCommit(changes,message);showNotice(els.managerNotice,`Completed: ${message}`,'success');await refreshContents();}
  catch(error){showNotice(els.managerNotice,error.message,'error');}
  finally{setBusy(false);updateSelectedRepoUI();}
}
function deletePaths(paths,confirmText) {
  const unique=[...new Set(paths)];const changes=unique.map(path=>({path,mode:'100644',type:'blob',sha:null}));
  return runMutation(unique,changes,`Delete ${unique.length} ${unique.length===1?'file':'files'}`,confirmText);
}
function deleteFolder(folderPath) {
  const paths=state.files.filter(file=>file.path.startsWith(`${folderPath}/`)).map(file=>file.path);
  if(!paths.length)return showNotice(els.managerNotice,'Folder contains no tracked files.','info');
  return deletePaths(paths,`Delete folder “${folderPath}” and all ${paths.length} tracked files inside it? This creates a repository commit.`);
}
function moveFile(file) {
  const destination=window.prompt('Enter the new repository path (folders allowed):',file.path);
  if(destination===null)return;const newPath=destination.trim().replace(/^\/+/, '');
  if(!newPath||newPath.split('/').some(part=>!part||part==='.'||part==='..'))return showNotice(els.managerNotice,'Enter a valid relative repository path without . or .. segments.','error');
  if(newPath===file.path)return;
  const collision=state.files.find(item=>item.path===newPath);
  const confirmed=collision?window.confirm(`“${newPath}” already exists. Replace it with “${file.path}” and move the original there?`):true;
  if(!confirmed)return;
  const changes=[{path:newPath,mode:file.mode||'100644',type:'blob',sha:file.sha},{path:file.path,mode:file.mode||'100644',type:'blob',sha:null}];
  return runMutation([file.path],changes,`Move ${file.path} to ${newPath}`,`Move / rename “${file.path}” to “${newPath}”? This creates a repository commit.`);
}
async function deleteAllContents() {
  if(!state.files.length)return showNotice(els.managerNotice,'Repository has no tracked files.','info');
  if(state.files.length>MAX_TREE_ENTRIES)return showNotice(els.managerNotice,'This repository exceeds the 100,000-entry Git tree limit; delete in smaller batches.','error');
  const paths=state.files.map(file=>file.path);const changes=state.files.map(file=>({path:file.path,mode:file.mode||'100644',type:'blob',sha:null}));
  return runMutation(paths,changes,`Delete all ${paths.length} repository files`,`Delete ALL ${paths.length} tracked files from ${state.selectedRepo.full_name}? This creates a commit and removes the project contents from the current branch.`);
}

// ---- Settings and optional file assistance ----
function fillSettingsForm() {
  els.settingsUsername.value=state.credentials.username||'';
  els.settingsToken.value=state.credentials.token||'';
  els.settingsOpenai.value=state.credentials.openaiKey||'';
  els.saveSettings.textContent=state.credentials.token?'Update settings':'Save settings';
  setSettingsStatus(state.credentials.token?'Credentials are encrypted and saved in this browser.':'Credentials have not been saved yet.');
}
async function saveSettings(event) {
  event.preventDefault();if(!state.key)return;
  const username=els.settingsUsername.value.trim();const token=els.settingsToken.value.trim();const openaiKey=els.settingsOpenai.value.trim();
  if(!username||!token)return setSettingsStatus('GitHub username and token are required.','error');
  const next={...state.credentials,username,token,openaiKey};
  try{await saveEncryptedSettings(next);state.credentials=next;setSettingsStatus('Settings encrypted and saved on this device.','success');els.saveSettings.textContent='Update settings';await refreshRepositories();}
  catch(error){setSettingsStatus(`Could not save settings: ${error.message}`,'error');}
}
async function testConnection() {
  const enteredToken=els.settingsToken.value.trim()||state.credentials.token;const enteredUsername=els.settingsUsername.value.trim()||state.credentials.username;
  if(!enteredToken||!enteredUsername)return setSettingsStatus('Enter a GitHub username and token first.','error');
  const previous=state.credentials;state.credentials={...previous,username:enteredUsername,token:enteredToken};
  els.testConnection.disabled=true;setSettingsStatus('Testing GitHub connection…');
  try{const me=await getUser();if(me.login.toLowerCase()!==enteredUsername.toLowerCase())throw new Error(`Token belongs to “${me.login}”, not “${enteredUsername}”.`);const repos=await fetchAllRepositories();setSettingsStatus(`Connected as ${me.login}. Found ${repos.length} accessible repositories.`,'success');}
  catch(error){setSettingsStatus(error.message,'error');}
  finally{state.credentials=previous;els.testConnection.disabled=false;}
}
async function clearCredentials() {
  if(!state.key)return;
  if(!window.confirm('Clear the saved GitHub username, token, and OpenAI key from this encrypted vault?'))return;
  const empty={username:'',token:'',openaiKey:'',selectedRepo:''};
  try{await saveEncryptedSettings(empty);state.credentials=empty;state.repos=[];state.selectedRepo=null;state.files=[];state.selectedPaths.clear();els.connectionBadge.classList.add('offline');els.connectionBadge.querySelector('span').textContent='Credentials needed';fillSettingsForm();renderRepoOptions('Set up GitHub credentials in Settings');goPage('settings');setSettingsStatus('Saved credentials were cleared from the vault.','success');}
  catch(error){setSettingsStatus(`Could not clear credentials: ${error.message}`,'error');}
}
async function suggestExclusions() {
  if(!state.credentials.openaiKey)return showNotice(els.uploadNotice,'Add an OpenAI API key in Settings to get exclusion suggestions. Upload works without it.','error');
  if(!selectedLocalFiles.length)return showNotice(els.uploadNotice,'Select a project folder first so suggestions are based on its file list.','error');
  els.suggestButton.disabled=true;const old=els.suggestButton.textContent;els.suggestButton.textContent='Reviewing…';
  const paths=selectedLocalFiles.map(file=>{const raw=file.webkitRelativePath||file.name;const parts=raw.split('/');return parts.length>1?parts.slice(1).join('/'):raw;}).slice(0,1500);
  try{
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${state.credentials.openaiKey}`},body:JSON.stringify({model:'gpt-4.1-mini',instructions:'You are a file housekeeping helper, not a chatbot. Suggest only clearly unnecessary generated/dependency/cache/secret paths that exist in this list. Return only newline-separated exact path or basename patterns, no bullets or explanations. Never suggest excluding source files, configs, or assets required to run/build. If none, return NONE.',input:paths.join('\n')})});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error?.message||`OpenAI returned HTTP ${response.status}.`);
    const text=data.output_text||(data.output||[]).flatMap(x=>x.content||[]).map(x=>x.text||'').join('\n');
    const candidates=text.split(/\r?\n/).map(x=>x.trim().replace(/^[-*•\s]+/,'')).filter(x=>x&&x.toUpperCase()!=='NONE');
    const valid=candidates.filter(c=>paths.some(p=>p===c||p.split('/').includes(c)||(c.includes('*')&&globRegex(c).test(p))));
    const current=els.excludePatterns.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);const fresh=valid.filter(x=>!current.includes(x));
    if(!fresh.length)showNotice(els.uploadNotice,'No additional exclusions suggested. Review the current list before uploading.','info');
    else{els.excludePatterns.value=[...current,...fresh].join('\n');updateLocalSelection();showNotice(els.uploadNotice,`Added ${fresh.length} suggestion${fresh.length===1?'':'s'} to the exclusion list. Review before upload.`,'success');}
  }catch(error){showNotice(els.uploadNotice,`Could not get suggestions: ${error.message}`,'error');}
  finally{els.suggestButton.disabled=false;els.suggestButton.textContent=old;}
}

// ---- UI events ----
els.vaultForm.addEventListener('submit',async event=>{
  event.preventDefault();clearNotice(els.vaultNotice);
  const pass=els.vaultPassword.value;
  if(pass.length<10)return showNotice(els.vaultNotice,'Use a vault passphrase with at least 10 characters.','error');
  try{
    if(state.vaultExists){const record=await readVaultRecord();await unlockVault(pass,record);}
    else{if(pass!==els.vaultConfirm.value)return showNotice(els.vaultNotice,'The passphrases do not match.','error');await createVault(pass);}
  }catch(error){state.key=null;showNotice(els.vaultNotice,state.vaultExists?'Passphrase incorrect or vault data is damaged. Your credentials were not changed.':error.message,'error');}
});
document.querySelectorAll('.nav-link').forEach(button=>button.addEventListener('click',()=>goPage(button.dataset.page)));
document.querySelectorAll('[data-page-link]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();goPage(link.dataset.pageLink);}));
els.lockButton.addEventListener('click',lockVault);els.footerLock.addEventListener('click',lockVault);
els.settingsForm.addEventListener('submit',saveSettings);els.testConnection.addEventListener('click',testConnection);els.clearCredentials.addEventListener('click',clearCredentials);
document.querySelectorAll('[data-toggle-secret]').forEach(button=>button.addEventListener('click',()=>{const input=document.getElementById(button.dataset.toggleSecret);const show=input.type==='password';input.type=show?'text':'password';button.textContent=show?'Hide':'Show';}));
els.refreshRepos.addEventListener('click',()=>refreshRepositories());
els.repoSelect.addEventListener('change',()=>{
  state.selectedRepo=state.repos.find(repo=>repo.full_name===els.repoSelect.value)||null;
  state.credentials.selectedRepo=state.selectedRepo?.full_name||'';state.files=[];state.currentDir='';state.selectedPaths.clear();els.filePreviewPanel.hidden=true;
  updateSelectedRepoUI();if(state.selectedRepo&&document.querySelector('[data-page-panel="manager"]').classList.contains('active'))refreshContents();
  if(state.key)saveEncryptedSettings(state.credentials).catch(()=>{});
});
els.chooseFolder.addEventListener('click',()=>els.folderInput.click());
els.folderInput.addEventListener('change',()=>{
  selectedLocalFiles=Array.from(els.folderInput.files||[]);const path=selectedLocalFiles[0]?.webkitRelativePath||'';
  els.folderName.textContent=selectedLocalFiles.length?(path.split('/')[0]||'Selected folder'):'Select a project folder';els.folderInput.value='';
  clearNotice(els.uploadNotice);els.uploadProgress.hidden=true;els.repoLink.hidden=true;updateLocalSelection();
});
els.excludePatterns.addEventListener('input',updateLocalSelection);els.uploadForm.addEventListener('submit',uploadProject);document.getElementById('suggestButton').addEventListener('click',suggestExclusions);
els.refreshContents.addEventListener('click',refreshContents);
els.selectVisible.addEventListener('change',()=>{const {files}=directEntries(state.currentDir);files.forEach(file=>els.selectVisible.checked?state.selectedPaths.add(file.path):state.selectedPaths.delete(file.path));renderFileList();});
els.deleteSelected.addEventListener('click',()=>deletePaths([...state.selectedPaths],`Delete ${state.selectedPaths.size} selected file${state.selectedPaths.size===1?'':'s'} from ${state.selectedRepo?.full_name}?`));
els.deleteAll.addEventListener('click',deleteAllContents);els.closePreview.addEventListener('click',()=>{els.filePreviewPanel.hidden=true;});

initializeVault();
