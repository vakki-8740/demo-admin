#!/usr/bin/env node
'use strict';

// Windows CLI companion. No third-party Node dependencies.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync, spawn } = require('node:child_process');
const readline = require('node:readline');
const { pathToFileURL } = require('node:url');
const API = 'https://api.github.com';
const APP_DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'GitHubProjectManagerCLI');
const CONFIG_FILE = path.join(APP_DIR, 'config.json');
const TOKEN_FILE = path.join(APP_DIR, 'github-token.dpapi');
const OPENAI_FILE = path.join(APP_DIR, 'openai-key.dpapi');
const VAULT_HELPER = path.join(__dirname, 'windows-vault.ps1');
const DEFAULT_EXCLUDES = ['.git', 'node_modules', '.DS_Store', 'Thumbs.db', '.env', '.env.*'];
let config = {};
let token = '';

function help() {
  console.log(`\nGitHub Project Manager CLI (Windows)\n\nOne-time setup\n  ghpm auth login                 Save GitHub username + token securely\n  ghpm auth status                Check account connection\n  ghpm auth logout                Remove saved credentials\n\nRepositories\n  ghpm repo list [--search text]  List repositories accessible to your token\n  ghpm repo search <text>         Search by owner or repository name\n  ghpm repo use <name|number>     Choose and remember the default repository\n  ghpm repo current               Show the chosen repository\n\nFiles and history (uses the chosen repository)\n  ghpm files [--search text]      List files; optionally filter by path\n  ghpm file show <path>           Print a text file\n  ghpm file download <path> [to]  Download a file to this computer\n  ghpm file create <path>         Create a file in your editor, then commit it\n  ghpm file edit <path>           Edit a text file in your editor, then commit it\n  ghpm file move <from> <to>      Rename/move a file\n  ghpm file delete <path>         Delete one file (asks before committing)\n  ghpm folder delete <path>       Delete a folder and its tracked contents\n  ghpm history [count]             Show recent commits (default 10)\n\nUpload and optional AI helper\n  ghpm upload <folder> [options]  Upload a local project folder\n    --replace                     Remove tracked repo files absent from folder\n    --exclude <pattern>           Exclude a name/path (can be repeated)\n    --suggest                     Ask optional OpenAI key for reviewable suggestions\n  ghpm settings openai             Save optional OpenAI key securely\n  ghpm help                       Show this help\n\nThe CLI only uses GitHub access granted to your token. Destructive actions ask for confirmation.\n`);
}
function loadConfig() { try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { config = {}; } }
function saveConfig() { fs.mkdirSync(APP_DIR, { recursive: true }); fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 }); }
function requireWindows() { if (process.platform !== 'win32') throw new Error('This packaged CLI currently targets Windows.'); }
function vault(action, file, input = '') {
  requireWindows();
  const powershell = process.env.POWERSHELL || 'powershell.exe';
  const result = spawnSync(powershell, ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',VAULT_HELPER,action,file], { input, encoding:'utf8', windowsHide:true, maxBuffer:1024*1024 });
  if (result.error) throw new Error(`Could not start Windows secure storage: ${result.error.message}`);
  if (result.status !== 0) throw new Error((result.stderr || 'Windows secure storage failed.').trim());
  return result.stdout.replace(/\r?\n$/, '');
}
function question(prompt) { const rl=readline.createInterface({input:process.stdin,output:process.stdout});return new Promise(resolve=>rl.question(prompt,answer=>{rl.close();resolve(answer.trim());})); }
function hiddenQuestion(prompt) {
  return new Promise((resolve,reject)=>{
    if (!process.stdin.isTTY || !process.stdin.setRawMode) return question(prompt+' (input hidden only in interactive Terminal): ').then(resolve,reject);
    let answer=''; process.stdout.write(prompt); process.stdin.setRawMode(true); process.stdin.resume();
    const done=(err)=>{process.stdin.removeListener('keypress',onKey);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');err?reject(err):resolve(answer);};
    readline.emitKeypressEvents(process.stdin);
    const onKey=(str,key)=>{if(key.ctrl&&key.name==='c')return done(new Error('Cancelled.'));if(key.name==='return')return done();if(key.name==='backspace'){answer=answer.slice(0,-1);return;}if(str&&!key.ctrl&&!key.meta)answer+=str;};
    process.stdin.on('keypress',onKey);
  });
}
async function api(route, options={}) {
  const res=await fetch(API+route,{...options,headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
  const text=await res.text();let data;try{data=text?JSON.parse(text):null;}catch{data=text;}
  if(!res.ok){const message=data&&data.message?data.message:`HTTP ${res.status}`;throw new Error(`${message} (${res.status})`);}
  return data;
}
function routePath(p){return p.split('/').map(encodeURIComponent).join('/');}
function repoRoute(repo=config.defaultRepo){if(!repo)throw new Error('Choose a repository first with: ghpm repo use <name>.');return `/repos/${routePath(repo)}`;}
async function readToken(){if(!token){token=vault('read',TOKEN_FILE);if(!token)throw new Error('No saved token. Run: ghpm auth login');}return token;}
async function ensureAuth(){await readToken();}
async function login(){requireWindows();loadConfig();const username=await question('GitHub username: ');if(!username)throw new Error('Username is required.');const secret=await hiddenQuestion('GitHub Personal Access Token (input hidden): ');if(!secret)throw new Error('Token is required.');token=secret;const me=await api('/user');if(me.login.toLowerCase()!==username.toLowerCase())throw new Error(`That token belongs to ${me.login}, not ${username}.`);vault('store',TOKEN_FILE,secret+'\n');config.username=me.login;saveConfig();console.log(`Saved securely for Windows user ${os.userInfo().username}. Connected as ${me.login}.`);}
async function authStatus(){await ensureAuth();const me=await api('/user');console.log(`Connected: ${me.login}${config.defaultRepo?`\nDefault repository: ${config.defaultRepo}`:''}`);}
async function authLogout(){requireWindows();loadConfig();vault('clear',TOKEN_FILE);vault('clear',OPENAI_FILE);try{fs.unlinkSync(CONFIG_FILE);}catch{}token='';config={};console.log('CLI credentials and settings removed from this Windows account.');}
async function allRepos(){let page=1,all=[];while(true){const part=await api(`/user/repos?visibility=all&affiliation=owner%2Ccollaborator%2Corganization_member&sort=full_name&per_page=100&page=${page++}`);all.push(...part);if(part.length<100)break;}return all;}
function repoLine(repo,i){return `${String(i+1).padStart(3)}  ${repo.full_name.padEnd(36)} ${repo.private?'private':'public'}${repo.permissions?.push===false?' · read-only':''}${config.defaultRepo===repo.full_name?' · current':''}`;}
async function repoList(query=''){await ensureAuth();const repos=await allRepos();const q=query.toLowerCase();const rows=repos.filter(r=>!q||[r.full_name,r.name,r.description,r.language].filter(Boolean).some(v=>v.toLowerCase().includes(q)));if(!rows.length){console.log('No matching repositories. Check token access or try another search.');return;}console.log('\n #   OWNER/REPOSITORY                     VISIBILITY');rows.forEach((r,i)=>console.log(repoLine(r,i)));console.log(`\n${rows.length} shown of ${repos.length} accessible repositories.`);}
async function repoUse(value){await ensureAuth();if(!value)throw new Error('Usage: ghpm repo use <owner/repo, repo name or list number>');const repos=await allRepos();const needle=value.toLowerCase();let matches=/^\d+$/.test(value)?[repos[Number(value)-1]].filter(Boolean):repos.filter(r=>r.full_name.toLowerCase()===needle||r.name.toLowerCase()===needle||r.full_name.toLowerCase().endsWith('/'+needle));if(matches.length!==1){if(!matches.length)throw new Error(`No accessible repository matched “${value}”. Use ghpm repo search <text>.`);console.log('More than one repository matches:');matches.forEach((r,i)=>console.log(`${i+1}. ${r.full_name}`));throw new Error('Choose by full owner/repository name.');}const r=matches[0];config.defaultRepo=r.full_name;saveConfig();console.log(`Selected ${r.full_name} (${r.default_branch||'main'} branch).`);}
async function repoCurrent(){loadConfig();console.log(config.defaultRepo||'No default repository selected. Run: ghpm repo use <name>');}
async function repoDetails(){return api(repoRoute());}
async function getBranch(){const repo=await repoDetails();return repo.default_branch||'main';}
async function getRef(branch){return api(`${repoRoute()}/git/ref/heads/${routePath(branch)}`);}
async function getTree(){const branch=await getBranch();const ref=await getRef(branch);const commit=await api(`${repoRoute()}/git/commits/${ref.object.sha}`);const tree=await api(`${repoRoute()}/git/trees/${commit.tree.sha}?recursive=1`);if(tree.truncated)throw new Error('Repository tree is too large for a complete recursive listing.');return {branch,ref,commit,tree};}
function ensureWrite(repo){if(repo?.permissions?.push===false)throw new Error('This token has read-only access to the selected repository.');}
async function listFiles(query=''){await ensureAuth();const {tree}=await getTree();const blobs=tree.tree.filter(x=>x.type==='blob'&&(!query||x.path.toLowerCase().includes(query.toLowerCase())));if(!blobs.length){console.log(query?'No files match that search.':'No tracked files (repository may be empty).');return;}console.log(`\nFILES · ${config.defaultRepo}\n`);for(const f of blobs)console.log(`${f.path.padEnd(54)} ${formatBytes(f.size||0)}`);console.log(`\n${blobs.length} file(s).`);}
function formatBytes(n){if(n<1024)return `${n} B`;if(n<1024**2)return `${(n/1024).toFixed(1)} KB`;return `${(n/1024**2).toFixed(1)} MB`;}
function findPath(tree,p){const normalized=p.replace(/\\/g,'/').replace(/^\.\//,'').replace(/\/$/,'');const item=tree.tree.find(x=>x.path===normalized&&x.type==='blob');if(!item)throw new Error(`File not found: ${normalized}`);return item;}
async function bytesFor(item){const blob=await api(`${repoRoute()}/git/blobs/${item.sha}`);return Buffer.from(blob.content.replace(/\n/g,''),'base64');}
async function showFile(p){await ensureAuth();const {tree}=await getTree();const item=findPath(tree,p);const bytes=await bytesFor(item);if(bytes.includes(0)){console.log(`Binary file · ${formatBytes(bytes.length)} · ${item.sha}`);return;}process.stdout.write(bytes.toString('utf8'));if(!bytes.toString('utf8').endsWith('\n'))process.stdout.write('\n');}
async function downloadFile(repoPath,destination){await ensureAuth();const {tree}=await getTree();const item=findPath(tree,repoPath);const bytes=await bytesFor(item);const out=path.resolve(destination||path.basename(item.path));fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);console.log(`Downloaded ${item.path} (${formatBytes(bytes.length)}) to ${out}`);}
async function commitChanges(changes,message){
  const repo=await repoDetails();ensureWrite(repo);let branch=repo.default_branch||'main';let ref;
  try{ref=await getRef(branch);}catch(e){if(!/404|empty/i.test(e.message))throw e;}
  if(!ref){const first=changes.find(c=>c.sha!==null);if(!first)throw new Error('Cannot create an initial commit containing only deletions.');const initial=await api(`${repoRoute()}/contents/${routePath(first.path)}`,{method:'PUT',body:JSON.stringify({message:`Initialize repository: ${first.path}`,content:first.contentBase64})});first.sha=initial.content.sha;delete first.contentBase64;const initialized=await repoDetails();branch=initialized.default_branch||branch;ref=await getRef(branch);}
  const parent=await api(`${repoRoute()}/git/commits/${ref.object.sha}`);
  const entries=[];
  for(const change of changes){if(change.sha===null){entries.push({path:change.path,mode:'100644',type:'blob',sha:null});continue;}let sha=change.sha;if(!sha){const blob=await api(`${repoRoute()}/git/blobs`,{method:'POST',body:JSON.stringify({content:change.contentBase64,encoding:'base64'})});sha=blob.sha;}entries.push({path:change.path,mode:'100644',type:'blob',sha});}
  const tree=await api(`${repoRoute()}/git/trees`,{method:'POST',body:JSON.stringify({base_tree:parent.tree.sha,tree:entries})});
  const commit=await api(`${repoRoute()}/git/commits`,{method:'POST',body:JSON.stringify({message,tree:tree.sha,parents:[ref.object.sha]})});
  await api(`${repoRoute()}/git/refs/heads/${routePath(branch)}`,{method:'PATCH',body:JSON.stringify({sha:commit.sha,force:false})});
  console.log(`Committed: ${message}\n${commit.html_url}`);return commit;
}
async function editorContent(initial=''){const ext=process.env.EDITOR||process.env.VISUAL||'notepad';const temp=path.join(os.tmpdir(),`ghpm-${Date.now()}.txt`);fs.writeFileSync(temp,initial,'utf8');console.log(`Opening editor: ${ext} ${temp}`);await new Promise((resolve,reject)=>{const parts=ext.split(/\s+/);const child=spawn(parts[0],[...parts.slice(1),temp],{stdio:'inherit',shell:false});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Editor exited with code ${code}`)));});const text=fs.readFileSync(temp,'utf8');try{fs.unlinkSync(temp);}catch{}return text;}
async function editFile(p,isNew){await ensureAuth();const {tree}=await getTree();let normalized=p.replace(/\\/g,'/').replace(/^\.\//,'').replace(/^\/+/, '');if(!normalized||normalized.split('/').includes('..'))throw new Error('Use a safe repository-relative path.');const existing=tree.tree.find(x=>x.path===normalized&&x.type==='blob');if(isNew&&existing)throw new Error('File already exists. Use: ghpm file edit <path>');if(!isNew&&!existing)throw new Error(`File not found: ${normalized}`);let initial='';if(existing){const bytes=await bytesFor(existing);if(bytes.includes(0))throw new Error('Binary files are not editable in the terminal text editor.');initial=bytes.toString('utf8');}const content=await editorContent(initial);if(content===initial){console.log('No changes.');return;}await commitChanges([{path:normalized,contentBase64:Buffer.from(content,'utf8').toString('base64')}],`${isNew?'Create':'Update'} ${normalized}`);}
async function confirm(prompt){if(!process.stdin.isTTY)throw new Error('Interactive confirmation required; run this command from Windows Terminal.');const a=await question(`${prompt} Type yes to continue: `);return a.toLowerCase()==='yes';}
async function deletePaths(paths,label){await ensureAuth();if(!paths.length){console.log('Nothing to delete.');return;}if(!await confirm(`Delete ${paths.length} item(s) ${label}? This creates a GitHub commit.`)){console.log('Cancelled.');return;}await commitChanges(paths.map(p=>({path:p,sha:null})),`Delete ${label}`);}
async function moveFile(from,to){await ensureAuth();const {tree}=await getTree();const item=findPath(tree,from);const dest=to.replace(/\\/g,'/').replace(/^\.\//,'').replace(/^\/+/, '');if(!dest||dest.split('/').includes('..'))throw new Error('Use a safe repository-relative destination.');if(tree.tree.some(x=>x.path===dest))throw new Error(`Destination already exists: ${dest}`);if(!await confirm(`Move ${item.path} to ${dest}?`)){console.log('Cancelled.');return;}const bytes=await bytesFor(item);await commitChanges([{path:dest,contentBase64:bytes.toString('base64')},{path:item.path,sha:null}],`Move ${item.path} to ${dest}`);}
function globRegex(pattern){const escaped=pattern.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.');return new RegExp(`(^|/)${escaped}($|/)`,'i');}
async function askSuggestions(paths){let key;try{key=vault('read',OPENAI_FILE);}catch{throw new Error('No OpenAI key saved. Optional: ghpm settings openai');}const res=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({model:'gpt-4.1-mini',instructions:'You are a file housekeeping helper, not a chatbot. Suggest only clearly unnecessary generated/dependency/cache/secret paths that exist in this list. Return only newline-separated exact path or basename patterns, no bullets or explanations. Never suggest excluding source files, configs, or assets required to run/build. If none, return NONE.',input:paths.join('\n')})});const data=await res.json();if(!res.ok)throw new Error(data.error?.message||`OpenAI returned ${res.status}`);return (data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n').split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&x!=='NONE');}
async function uploadFolder(folder,args){await ensureAuth();const root=path.resolve(folder);if(!fs.existsSync(root)||!fs.statSync(root).isDirectory())throw new Error(`Folder not found: ${root}`);const excludes=[...DEFAULT_EXCLUDES];for(let i=0;i<args.length;i++)if(args[i]==='--exclude'&&args[i+1])excludes.push(args[++i]);let files=[];function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const abs=path.join(dir,ent.name),rel=path.relative(root,abs).split(path.sep).join('/');if(excludes.some(p=>globRegex(p).test(rel)||rel===p))continue;if(ent.isDirectory())walk(abs);else if(ent.isFile())files.push({abs,path:rel});}}walk(root);if(!files.length)throw new Error('No files remain after applying exclusions.');
  if(args.includes('--suggest')){const suggestions=await askSuggestions(files.map(f=>f.path));if(suggestions.length){console.log('Optional exclusion suggestions (review carefully):\n'+suggestions.map(x=>'  '+x).join('\n'));if(await confirm('Apply these suggestions to this upload?')){const regs=suggestions.map(globRegex);files=files.filter(f=>!regs.some(r=>r.test(f.path)));}}}
  const existing=await getTree().catch(e=>{if(/404|empty/i.test(e.message))return {tree:{tree:[]}};throw e;});const replace=args.includes('--replace');const paths=new Set(files.map(f=>f.path));const changes=files.map(f=>({path:f.path,contentBase64:fs.readFileSync(f.abs).toString('base64')}));if(replace){const extras=existing.tree.tree.filter(x=>x.type==='blob'&&!paths.has(x.path)).map(x=>({path:x.path,sha:null}));if(extras.length){console.log(`Replace mode will remove ${extras.length} existing tracked file(s).`);if(!await confirm('Continue with replacement?')){console.log('Cancelled.');return;}changes.push(...extras);}}
  console.log(`Uploading ${files.length} file(s) to ${config.defaultRepo}…`);await commitChanges(changes,`${replace?'Replace':'Upload'} project (${files.length} files)`);
}
async function history(count=10){await ensureAuth();const n=Math.max(1,Math.min(100,Number(count)||10));const commits=await api(`${repoRoute()}/commits?per_page=${n}`);for(const c of commits)console.log(`${c.sha.slice(0,8)}  ${c.commit.author?.date||''}  ${c.commit.message.split('\n')[0]}\n          ${c.html_url}`);}
async function setOpenAI(){requireWindows();loadConfig();const key=await hiddenQuestion('OpenAI API key (input hidden): ');if(!key)throw new Error('Key is required.');vault('store',OPENAI_FILE,key+'\n');console.log('OpenAI key saved securely for optional exclusion suggestions.');}
async function main(){loadConfig();const [group,sub,...rest]=process.argv.slice(2);if(!group||group==='help'||group==='--help'||group==='-h'){help();return;}
  if(group==='auth'){if(sub==='login')return login();if(sub==='status')return authStatus();if(sub==='logout')return authLogout();throw new Error('Use auth login, auth status, or auth logout.');}
  if(group==='settings'&&sub==='openai')return setOpenAI();
  if(group==='repo'){if(sub==='list')return repoList(rest[0]==='--search'?rest.slice(1).join(' '):'');if(sub==='search')return repoList(rest.join(' '));if(sub==='use')return repoUse(rest.join(' '));if(sub==='current')return repoCurrent();throw new Error('Use repo list, repo search, repo use, or repo current.');}
  if(group==='files')return listFiles(sub==='--search'?rest.join(' '):(sub||''));
  if(group==='file'){if(sub==='show')return showFile(rest.join(' '));if(sub==='download')return downloadFile(rest[0],rest[1]);if(sub==='create')return editFile(rest.join(' '),true);if(sub==='edit')return editFile(rest.join(' '),false);if(sub==='move')return moveFile(rest[0],rest[1]);if(sub==='delete')return deletePaths([rest.join(' ')],rest.join(' '));throw new Error('Use file show/download/create/edit/move/delete.');}
  if(group==='folder'&&sub==='delete'){const name=rest.join(' ').replace(/\\/g,'/').replace(/\/$/,'');await ensureAuth();const {tree}=await getTree();const paths=tree.tree.filter(x=>x.type==='blob'&&x.path.startsWith(name+'/')).map(x=>x.path);return deletePaths(paths,name);}
  if(group==='history')return history(sub);
  if(group==='upload'){if(!sub)throw new Error('Usage: ghpm upload <folder> [--replace] [--exclude pattern] [--suggest]');return uploadFolder(sub,rest);}
  throw new Error(`Unknown command: ${group}. Run ghpm help.`);
}
main().catch(error=>{console.error(`\nError: ${error.message}`);process.exitCode=1;});
