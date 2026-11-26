# GitHub Project Manager

Installable, desktop-first HTML/CSS/vanilla-JavaScript app for Vercel or any HTTPS static host. GitHub/OpenAI requests go directly from the browser; no backend is required.

## Install on your device

Deploy the files below to the root of your Vercel project. Open the deployed HTTPS URL in Chrome/Edge and press **Install app** in the UI (or use the browser's Install option). On iPhone/iPad, use Safari **Share → Add to Home Screen**; on Safari for Mac, use **File → Add to Dock**. The service worker caches the app shell so the interface can open offline; GitHub and OpenAI actions still require internet.

## Vault and credentials

On first use, create a vault passphrase (10+ characters), then add the GitHub username/PAT and optional OpenAI key in Settings. Choose a repository from the dropdown or type an owner/repository name in the search field to filter the list; searching works on both Home and Upload. Credentials are encrypted with Web Crypto AES-GCM and saved in this browser's IndexedDB. When reopening the installed app, enter only the vault passphrase; repository selection and credentials load automatically. The passphrase itself is never saved. If forgotten, the encrypted vault cannot be recovered. Use the same browser and deployed domain so the browser can find the same vault.

## Windows command-line companion (CLI)

The ZIP also includes a Windows CLI that mirrors the dashboard's repository workflows: select/search repositories; search/list files; show or download files; create/edit/move/delete files; delete folders; view commit history; upload a folder in merge or replace mode; and optionally request OpenAI exclusion suggestions. It only acts on repositories your GitHub token can access, reads local files only from the folder you pass to `ghpm upload`, and asks for confirmation before destructive changes. It does not provide arbitrary remote shell commands or Windows administrator access.

1. Extract the complete ZIP on Windows.
2. Open PowerShell in the extracted folder and run `powershell -ExecutionPolicy Bypass -File .\install-cli.ps1`. The installer checks for Node.js LTS (and can offer winget installation).
3. Close and reopen Terminal. Run `ghpm auth login` once, enter your GitHub username and PAT, then `ghpm repo list` and `ghpm repo use 1` (or choose by `owner/repo`). The token is encrypted by Windows for your current user; it is not stored in project files.
4. Run `ghpm help` for commands. Example: `ghpm upload "C:\Users\you\Desktop\my-project" --exclude .env`.

The CLI has its own Windows credential store and default-repository setting; it does not read or share the browser's IndexedDB vault. It works on that Windows account/profile; reinstalling Windows or changing user profiles may require signing in again. `ghpm auth logout` deletes the CLI's saved credentials. OpenAI is optional; configure it once with `ghpm settings openai` to use CLI suggestions.

## Files to deploy

Keep `index.html`, `style.css`, `script.js`, `manifest.webmanifest`, `service-worker.js`, and the complete `icons/` directory together at the site root. The `icons/` folder contains local SVG UI icons, a green GitHub logo/favicon, and matching 192/512px PWA app icons.

Fine-grained GitHub PATs need access to the selected repository and Contents read/write permission for upload/edit/delete operations. Classic PATs generally need `repo` scope for private repositories. Use an expiration date and keep tokens private.

UI icons are from [Iconoir](https://github.com/iconoir-icons/iconoir), licensed under MIT; `icons/LICENSE` contains the license notice.
