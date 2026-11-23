# GitHub Project Manager

Static desktop-first HTML/CSS/vanilla-JavaScript app for Vercel or any static host. It connects directly from the browser to GitHub and (optionally) OpenAI. No backend or separate server is required.

## Credentials and session privacy

Enter your GitHub username and personal access token on the sign-in page each time you open/reload the app. Credentials are held in JavaScript memory for that browser session only; they are not written to localStorage, sent to this project's GitHub repository, or persisted by the app. Signing out or reloading clears them. The OpenAI API key is optional and also session-only.

## Deploy

Deploy `index.html`, `style.css`, `script.js`, and the complete `icons/` folder as static files on Vercel. Keep the `icons/` directory intact because the interface loads local SVG masks from it. Open the deployed URL, sign in, select a repository, then upload/manage files.

Icons are from [Iconoir](https://github.com/iconoir-icons/iconoir), licensed under MIT; the included `icons/LICENSE` contains the license notice.

Fine-grained GitHub PATs need access to the selected repository and Contents read/write permission for upload/edit/delete operations. Classic PATs generally need `repo` scope for private repositories. Keep tokens private and use an expiration date.
