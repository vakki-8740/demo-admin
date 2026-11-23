# GitHub Project Manager

Static desktop-first HTML/CSS/vanilla-JavaScript app for Vercel or any HTTPS static host. GitHub/OpenAI requests go directly from the browser; no backend is required.

## Vault and credentials

On first use, create a vault passphrase (10+ characters), then add the GitHub username/PAT and optional OpenAI key in Settings. Credentials are encrypted with Web Crypto AES-GCM and saved in this browser's IndexedDB. When reopening the app, enter only the vault passphrase; repository selection and credentials load automatically. The passphrase itself is never saved. If forgotten, the encrypted vault cannot be recovered. Use the same browser and deployed domain so the browser can find the same vault.

## Deploy

Deploy `index.html`, `style.css`, `script.js`, and the complete `icons/` folder as static files on Vercel. Keep the `icons/` directory intact because the interface uses local SVG masks. Open the deployed URL, unlock/create the vault, then select a repository to upload or manage files.

Fine-grained GitHub PATs need access to the selected repository and Contents read/write permission for upload/edit/delete operations. Classic PATs generally need `repo` scope for private repositories. Use an expiration date and keep tokens private.

Icons are from [Iconoir](https://github.com/iconoir-icons/iconoir), licensed under MIT; the included `icons/LICENSE` contains the license notice.
