# GitHub Project Manager

Desktop-first, light iOS-inspired GitHub uploader and repository manager. Frontend remains HTML/CSS/vanilla JS. A small local Python helper serves the UI and stores GitHub/OpenAI credentials in the operating system keychain so the app can auto-load them without an in-app unlock prompt.

## First run

1. Install Python 3.10 or newer.
2. Open a terminal in this folder and install the one local keychain dependency:

   ```sh
   python -m pip install -r requirements.txt
   ```

3. Start the app:

   ```sh
   python server.py
   ```

4. Open **http://localhost:8765**. Keep the terminal window running while using the app. Stop it with Ctrl+C.
5. In Settings, save your GitHub username and PAT once. The helper stores them in Windows Credential Manager, macOS Keychain, or Linux Secret Service/KWallet; it does not write them into project files or browser storage.

Use the same local app address each time. The GitHub token needs repository Contents read/write permission for upload and file edits. The OpenAI key is optional.

## Notes

- On Linux, a Secret Service/KWallet session must be available. The helper refuses to use an unprotected fallback keyring.
- Uploading into an empty GitHub repository bootstraps its first file through GitHub's Contents API, then adds remaining files in a follow-up commit. Existing repositories are updated in one commit (or one replacement commit when replace mode is selected).
- Repository history displays recent GitHub commits (up to 50), including work done outside this app.
- Credentials are returned to the frontend only while the local app is open so the browser can send authorized requests directly to GitHub/OpenAI.
