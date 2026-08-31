import { Download, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { usePreferences } from "../preferences";
import { checkForDesktopUpdate, type DesktopUpdate } from "../updates";

export function DesktopUpdateNotice({ collapsed = false }: { collapsed?: boolean }) {
  const { checkForUpdates, updateChannel } = usePreferences();
  const [update, setUpdate] = useState<DesktopUpdate>();

  useEffect(() => {
    if (!checkForUpdates) { setUpdate(undefined); return; }
    let active = true;
    void checkForDesktopUpdate(updateChannel).then(available => {
      if (active && available && localStorage.getItem(dismissalKey(available.version)) !== "1") setUpdate(available);
    });
    return () => { active = false; };
  }, [checkForUpdates, updateChannel]);

  if (!update) return null;
  const openRelease = async () => {
    try { await openUrl(update.releaseUrl); }
    catch { window.open(update.releaseUrl, "_blank", "noopener,noreferrer"); }
  };
  const dismiss = () => {
    localStorage.setItem(dismissalKey(update.version), "1");
    setUpdate(undefined);
  };

  if (collapsed) return <button className="desktop-update-collapsed" title={`sndbox ${update.version} is available`} aria-label={`Open sndbox ${update.version} release`} onClick={() => void openRelease()}><Download size={15}/></button>;
  return <aside className="desktop-update-notice" aria-live="polite">
    <button className="desktop-update-link" title={`Open sndbox ${update.version} release`} onClick={() => void openRelease()}><Download size={14}/><span>Update available</span></button>
    <button className="desktop-update-dismiss" aria-label={`Dismiss sndbox ${update.version} update`} title="Dismiss" onClick={dismiss}><X size={13}/></button>
  </aside>;
}

function dismissalKey(version: string) {
  return `sandbox.dismissed-update.${version}`;
}
