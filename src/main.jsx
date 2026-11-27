import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import legacyMarkup from './legacy-ui.html?raw';
import '../style.css';
import './app.css';

function AccountSwitcher() {
  const [vault, setVault] = useState({ accounts: [], activeAccountId: null, addingAccount: false });
  useEffect(() => {
    const update = (event) => setVault(event?.detail || window.GHPMAccounts?.snapshot?.() || { accounts: [], activeAccountId: null, addingAccount: false });
    window.addEventListener('ghpm:accounts', update);
    import('../script.js').then(() => update()).catch((error) => console.error('App initialization failed:', error));
    return () => window.removeEventListener('ghpm:accounts', update);
  }, []);
  const accounts = vault.accounts || [];
  const bridge = window.GHPMAccounts;
  return (
    <div className="account-switcher" aria-label="GitHub accounts">
      <span className="account-label">ACCOUNT</span>
      <select
        className="account-select"
        aria-label="Switch GitHub account"
        value={vault.activeAccountId || ''}
        disabled={!accounts.length || vault.addingAccount || vault.busy}
        onChange={(event) => bridge?.switchAccount(event.target.value)}
      >
        {!accounts.length && <option value="">No saved accounts</option>}
        {accounts.map((account) => <option key={account.id} value={account.id}>{account.username}{account.selectedRepo ? ` · ${account.selectedRepo}` : ''}</option>)}
      </select>
      <button
        className={`account-add ${vault.addingAccount ? 'is-cancel' : ''}`}
        type="button"
        disabled={vault.busy}
        onClick={() => vault.addingAccount ? bridge?.cancelAddAccount() : bridge?.addAccount()}
      >
        <span aria-hidden="true">{vault.addingAccount ? '×' : '+'}</span>{vault.addingAccount ? 'Cancel' : 'Add account'}
      </button>
    </div>
  );
}

function App() {
  const [accountTarget, setAccountTarget] = useState(null);
  useEffect(() => {
    setAccountTarget(document.getElementById('accountSwitcherMount'));
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    }
  }, []);
  return (
    <>
      <div id="legacyAppRoot" dangerouslySetInnerHTML={{ __html: legacyMarkup }} />
      {accountTarget && createPortal(<AccountSwitcher />, accountTarget)}
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
