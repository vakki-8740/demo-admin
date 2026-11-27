# GitHub Project Manager

A React + Vite desktop web app for GitHub uploads and repository management. GitHub/OpenAI API requests run directly in the browser; there is no backend service or database.

## Run locally

Requires Node.js 20.19+ (or a compatible current LTS) and npm:

```bash
npm install
npm run dev
```

For a production build, run `npm run build`; Vite writes the deployable site to `dist/`.

## Deploy to Vercel

Import this project into Vercel with **Framework Preset: Vite**, **Build Command: `npm run build`**, and **Output Directory: `dist`**. Vercel installs from `package-lock.json`. Keep the `public/` directory; it supplies the PWA manifest, service worker, and app icons.

## Encrypted multi-account vault

Create a vault passphrase once. Existing single-account vaults are upgraded when first unlocked; the saved GitHub account is retained. To connect another account, click **Add account** in the header, enter its GitHub username and PAT in Settings, and save. Use the header account menu to switch immediately between saved accounts. Each account remembers its own token, optional OpenAI key, and selected repository. Remove only the active account from Settings with **Remove current account**. All account data stays encrypted in the same browser vault using AES-GCM; the passphrase is not stored.

Use the same browser and deployed origin to access the vault. If the passphrase is forgotten, or browser data is cleared, the encrypted accounts cannot be recovered. The Windows CLI has a separate credential store and is not connected to the browser account switcher.

## Repositories and permissions

Public and private repositories are supported when the selected account's GitHub token can access them. Fine-grained PATs need the appropriate repository access and **Contents: read/write** permission for file management; classic PATs generally need `repo` for private repositories. One account's token can access multiple repositories. Account switching changes the GitHub identity and repository list; it does not bypass GitHub permissions.

The app is currently designed for desktop screens. Existing file browsing/editing remains available; a live rendered website preview is not included yet.

## Windows CLI

The ZIP/source also includes a Windows command-line companion for repository workflows. Run `powershell -ExecutionPolicy Bypass -File .\install-cli.ps1` from an extracted project folder, reopen Terminal, then use `ghpm auth login` and `ghpm help`. It uses one CLI account at a time; the browser's multi-account selector does not change CLI credentials. The CLI stores its token separately, encrypted for the current Windows user.

## Icons

UI icons use [Iconoir](https://github.com/iconoir-icons/iconoir), licensed under MIT; `icons/LICENSE` and `public/icons/LICENSE` contain the notice.
