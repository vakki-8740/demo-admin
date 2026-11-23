# GitHub Project Manager

Installable, desktop-first HTML/CSS/vanilla-JavaScript app for Vercel or any HTTPS static host. GitHub/OpenAI requests go directly from the browser; no backend is required.

## Install on your device

Deploy the files below to the root of your Vercel project. Open the deployed HTTPS URL in Chrome/Edge and press **Install app** in the UI (or use the browser's Install option). On iPhone/iPad, use Safari **Share → Add to Home Screen**; on Safari for Mac, use **File → Add to Dock**. The service worker caches the app shell so the interface can open offline; GitHub and OpenAI actions still require internet.

## Vault and credentials

On first use, create a vault passphrase (10+ characters), then add the GitHub username/PAT and optional OpenAI key in Settings. Credentials are encrypted with Web Crypto AES-GCM and saved in this browser's IndexedDB. When reopening the installed app, enter only the vault passphrase; repository selection and credentials load automatically. The passphrase itself is never saved. If forgotten, the encrypted vault cannot be recovered. Use the same browser and deployed domain so the browser can find the same vault.

## Files to deploy

Keep `index.html`, `style.css`, `script.js`, `manifest.webmanifest`, `service-worker.js`, and the complete `icons/` directory together at the site root. The `icons/` folder contains local SVG UI icons, a green GitHub logo/favicon, and matching 192/512px PWA app icons.

Fine-grained GitHub PATs need access to the selected repository and Contents read/write permission for upload/edit/delete operations. Classic PATs generally need `repo` scope for private repositories. Use an expiration date and keep tokens private.

UI icons are from [Iconoir](https://github.com/iconoir-icons/iconoir), licensed under MIT; `icons/LICENSE` contains the license notice.
