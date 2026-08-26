import { Copy, ExternalLink, MoreHorizontal, Plus, RefreshCcw, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { BrowserEngineStatus, BrowserProfile, BrowserProfileSettings } from "../types";

const defaults: BrowserProfileSettings = { viewportWidth: 1280, viewportHeight: 800, permissions: [] };

export function SettingsView() {
  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
  const [engine, setEngine] = useState<BrowserEngineStatus>();
  const [editing, setEditing] = useState<BrowserProfile | "new">();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = async () => {
    setProfiles(await api.listBrowserProfiles());
    setEngine(await api.browserEngineStatus());
  };

  useEffect(() => { void load(); }, []);

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      await load();
    } catch (value) {
      setError(String(value));
    } finally {
      setBusy(false);
    }
  };

  return <main className="content settings-page">
    <header className="page-header"><div><h1>Settings</h1><p>Managed browser identities and local connection security.</p></div></header>
    <section className="settings-section">
      <div className="settings-heading">
        <div><h2>Browser Profiles</h2><p>Isolated Chromium identities. Sandbox never reads your personal browser profile.</p></div>
        <button className="button primary" onClick={() => setEditing("new")}><Plus size={14} />New profile</button>
      </div>
      <div className={`engine-health ${engine?.available ? "available" : "unavailable"}`}>
        <span />
        <div>
          <b>{engine?.available ? `Managed Chromium ${engine.browserVersion ?? "ready"}` : "Browser engine unavailable"}</b>
          <small>{engine?.available ? `Sidecar ${engine.sidecarVersion} · authenticated protocol v${engine.protocolVersion}` : engine?.error ?? "Checking the packaged runtime…"}</small>
        </div>
        {!engine?.available && api.isDesktop && <button className="button" onClick={() => act(() => api.restartBrowserEngine())}><RefreshCcw size={13} />Restart engine</button>}
      </div>
      {error && <div className="error-banner"><b>{error}</b></div>}
      {profiles.length ? <div className="profile-list">{profiles.map(profile => <div className="profile-row" key={profile.id}>
        <span className="profile-avatar">{profile.name.slice(0, 2).toUpperCase()}</span>
        <div><b>{profile.name}</b><small>{profile.persistent ? "Persists between runs" : "Clears after each run"} · {profile.settings.viewportWidth}×{profile.settings.viewportHeight}{profile.lastUsedAt ? ` · Last used ${new Date(profile.lastUsedAt).toLocaleDateString()}` : " · Never used"}</small></div>
        <span className="profile-path">Managed data · {profile.id.slice(0, 8)}</span>
        <button className="button" disabled={!api.isDesktop} onClick={() => act(() => api.openBrowserProfile(profile.id))}><ExternalLink size={13} />Open</button>
        <button className="icon-button" title="Duplicate without browser data" onClick={() => act(() => api.duplicateBrowserProfile(profile.id))}><Copy size={14} /></button>
        <button className="icon-button" title="Edit profile" onClick={() => setEditing(profile)}><MoreHorizontal size={15} /></button>
      </div>)}</div> : <div className="settings-empty"><ShieldCheck size={22} /><h3>No managed profiles</h3><p>Create an isolated Chromium identity for browser workflows and recording.</p><button className="button" onClick={() => setEditing("new")}>Create browser profile</button></div>}
    </section>
    {editing && <ProfileEditor
      profile={editing === "new" ? undefined : editing}
      busy={busy}
      onClose={() => setEditing(undefined)}
      onSave={(name, persistent, settings) => act(() => editing === "new" ? api.createBrowserProfile(name, persistent, settings) : api.updateBrowserProfile(editing.id, name, persistent, settings)).then(() => setEditing(undefined))}
      onClear={editing !== "new" ? async () => { if (confirm("Clear cookies, storage and downloads stored in this profile?")) await act(() => api.clearBrowserProfileData(editing.id)); } : undefined}
      onDelete={editing !== "new" ? async () => { if (confirm(`Delete ${editing.name}? This cannot be undone.`)) { await act(() => api.deleteBrowserProfile(editing.id)); setEditing(undefined); } } : undefined}
    />}
  </main>;
}

function ProfileEditor({ profile, busy, onClose, onSave, onClear, onDelete }: {
  profile?: BrowserProfile;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string, persistent: boolean, settings: BrowserProfileSettings) => void;
  onClear?: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}) {
  const [name, setName] = useState(profile?.name ?? "Work browser");
  const [persistent, setPersistent] = useState(profile?.persistent ?? true);
  const [settings, setSettings] = useState(profile?.settings ?? defaults);
  return <div className="overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}><div className="settings-modal">
    <header><div><h2>{profile ? "Edit browser profile" : "New browser profile"}</h2><p>Browser data is isolated under this profile ID.</p></div></header>
    <section>
      <label className="field"><span>Name</span><input autoFocus value={name} onChange={event => setName(event.target.value)} /></label>
      <div className="field-grid">
        <label className="field"><span>Viewport width</span><input type="number" min="320" max="3840" value={settings.viewportWidth} onChange={event => setSettings({ ...settings, viewportWidth: Number(event.target.value) })} /></label>
        <label className="field"><span>Viewport height</span><input type="number" min="240" max="2160" value={settings.viewportHeight} onChange={event => setSettings({ ...settings, viewportHeight: Number(event.target.value) })} /></label>
      </div>
      <label className="toggle-row"><span><b>Persist between runs</b><small>Retain cookies and site storage in this isolated profile.</small></span><input type="checkbox" checked={persistent} onChange={event => setPersistent(event.target.checked)} /></label>
      <details><summary>Advanced</summary>
        <label className="field"><span>Proxy</span><input placeholder="http://proxy.example:8080" value={settings.proxy ?? ""} onChange={event => setSettings({ ...settings, proxy: event.target.value || undefined })} /></label>
        <label className="field"><span>User-agent override</span><input value={settings.userAgent ?? ""} onChange={event => setSettings({ ...settings, userAgent: event.target.value || undefined })} /></label>
      </details>
      <div className="security-note"><ShieldCheck size={14} /><span>Passwords are never imported from your normal browser. Duplicates copy preferences only.</span></div>
    </section>
    <footer>{profile && <div className="destructive-actions"><button className="button" onClick={onClear}>Clear browser data</button><button className="button danger-text" onClick={onDelete}><Trash2 size={13} />Delete</button></div>}<span /><button className="button" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || !name.trim()} onClick={() => onSave(name, persistent, settings)}>{busy ? "Saving…" : "Save profile"}</button></footer>
  </div></div>;
}
