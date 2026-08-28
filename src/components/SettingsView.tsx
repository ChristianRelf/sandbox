import { Accessibility, Copy, ExternalLink, LayoutPanelLeft, MoreHorizontal, Palette, Plus, RefreshCcw, RotateCcw, ShieldCheck, Trash2, Workflow } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { usePreferences } from "../preferences";
import type { BrowserEngineStatus, BrowserProfile, BrowserProfileSettings } from "../types";
import { ConnectionsSettings } from "./ConnectionsSettings";

const defaults: BrowserProfileSettings = { viewportWidth: 1280, viewportHeight: 800, permissions: [] };

export function SettingsView() {
  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
  const [engine, setEngine] = useState<BrowserEngineStatus>();
  const [editing, setEditing] = useState<BrowserProfile | "new">();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = async () => {
    try {
      const [nextProfiles, nextEngine] = await Promise.all([api.listBrowserProfiles(), api.browserEngineStatus()]);
      setProfiles(nextProfiles);
      setEngine(nextEngine);
    } catch (value) {
      setError(`Settings could not load: ${String(value)}`);
    }
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
    <header className="page-header"><div><h1>Settings</h1><p>Personalise Sandbox, choose accessible defaults, and manage local connections.</p></div></header>
    <AppPreferenceSettings />
    <div className="settings-service-grid"><section className="settings-section">
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
        <div><b>{profile.name}</b><small>{profile.persistent ? "Persists between runs" : "Clears after each run"} · {profile.settings?.viewportWidth ?? 1280}×{profile.settings?.viewportHeight ?? 800}{profile.lastUsedAt ? ` · Last used ${new Date(profile.lastUsedAt).toLocaleDateString()}` : " · Never used"}</small></div>
        <span className="profile-path">Managed data · {profile.id.slice(0, 8)}</span>
        <button className="button" disabled={!api.isDesktop} onClick={() => act(() => api.openBrowserProfile(profile.id))}><ExternalLink size={13} />Open</button>
        <button className="icon-button" title="Duplicate without browser data" aria-label={`Duplicate ${profile.name} without browser data`} onClick={() => act(() => api.duplicateBrowserProfile(profile.id))}><Copy size={14} /></button>
        <button className="icon-button" title="Edit profile" aria-label={`Edit ${profile.name}`} onClick={() => setEditing(profile)}><MoreHorizontal size={15} /></button>
      </div>)}</div> : <div className="settings-empty"><ShieldCheck size={22} /><h3>No managed profiles</h3><p>Create an isolated Chromium identity for browser workflows and recording.</p><button className="button" onClick={() => setEditing("new")}>Create browser profile</button></div>}
    </section>
    <ConnectionsSettings />
    </div>
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

function AppPreferenceSettings() {
  const preferences = usePreferences();
  const update = preferences.update;
  return <section className="preference-section" aria-labelledby="app-preferences-title">
    <div className="settings-heading preference-heading"><div><h2 id="app-preferences-title">App preferences</h2><p>Saved on this device and applied immediately.</p></div><button className="button" onClick={preferences.reset}><RotateCcw size={13}/>Reset defaults</button></div>
    <div className="preference-grid">
      <article className="preference-card"><header><span><Palette size={16}/></span><div><h3>Appearance</h3><p>Shape the workspace around your display.</p></div></header>
        <label className="field"><span>Surface</span><select value={preferences.surfaceTheme} onChange={event=>update({surfaceTheme:event.target.value as "charcoal"|"oled"})}><option value="charcoal">Charcoal</option><option value="oled">OLED black</option></select></label>
        <label className="field"><span>Accent</span><select value={preferences.accent} onChange={event=>update({accent:event.target.value as "lime"|"violet"|"blue"})}><option value="lime">Sandbox lime</option><option value="violet">Violet</option><option value="blue">Electric blue</option></select></label>
        <label className="field"><span>Interface density</span><select value={preferences.density} onChange={event=>update({density:event.target.value as "comfortable"|"compact"})}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
      </article>
      <article className="preference-card"><header><span><Accessibility size={16}/></span><div><h3>Accessibility</h3><p>Reduce visual load without losing context.</p></div></header>
        <PreferenceToggle label="Reduce motion" description="Stops decorative transitions and pulsing states." checked={preferences.reduceMotion} onChange={reduceMotion=>update({reduceMotion})}/>
        <PreferenceToggle label="Increase contrast" description="Strengthens borders, muted text, and focus rings." checked={preferences.increasedContrast} onChange={increasedContrast=>update({increasedContrast})}/>
        <PreferenceToggle label="Accessible editor by default" description="Opens the structured, non-drag workflow editor with each workflow." checked={preferences.accessibleEditorDefault} onChange={accessibleEditorDefault=>update({accessibleEditorDefault})}/>
      </article>
      <article className="preference-card"><header><span><Workflow size={16}/></span><div><h3>Workspace</h3><p>Choose what the workflow canvas shows.</p></div></header>
        <PreferenceToggle label="Show canvas minimap" description="Keeps a workflow overview in the lower-right corner." checked={preferences.showMinimap} onChange={showMinimap=>update({showMinimap})}/>
        <PreferenceToggle label="Confirm unsaved navigation" description="Warns before leaving a workflow with local changes." checked={preferences.confirmBeforeLeaving} onChange={confirmBeforeLeaving=>update({confirmBeforeLeaving})}/>
        <PreferenceToggle label="Compact sidebar" description="Gives the canvas and wide tables more horizontal room." checked={preferences.sidebarCollapsed} onChange={sidebarCollapsed=>update({sidebarCollapsed})} icon={<LayoutPanelLeft size={13}/>}/>
      </article>
    </div>
  </section>;
}

function PreferenceToggle({label,description,checked,onChange,icon}:{label:string;description:string;checked:boolean;onChange:(checked:boolean)=>void;icon?:ReactNode}) {
  return <label className="preference-toggle"><span>{icon}<span><b>{label}</b><small>{description}</small></span></span><input type="checkbox" checked={checked} onChange={event=>onChange(event.target.checked)}/><i aria-hidden="true"/></label>;
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
