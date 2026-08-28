import { useEffect } from "react";
import { create } from "zustand";

export type Accent = "lime" | "violet" | "blue";
export type Density = "comfortable" | "compact";
export type SurfaceTheme = "charcoal" | "oled";
export type StartView = "workflows" | "history";
export type DateDisplay = "relative" | "absolute";
export type UpdateChannel = "beta" | "stable";

export interface AppPreferences {
  accent: Accent;
  density: Density;
  surfaceTheme: SurfaceTheme;
  startView: StartView;
  dateDisplay: DateDisplay;
  reduceMotion: boolean;
  increasedContrast: boolean;
  accessibleEditorDefault: boolean;
  showMinimap: boolean;
  snapToGrid: boolean;
  gridSize: 10 | 20 | 40;
  showCanvasHints: boolean;
  showNodeDescriptions: boolean;
  confirmNodeDeletion: boolean;
  confirmBeforeLeaving: boolean;
  checkForUpdates: boolean;
  updateChannel: UpdateChannel;
  sidebarCollapsed: boolean;
}

export const defaultPreferences: AppPreferences = {
  accent: "lime",
  density: "comfortable",
  surfaceTheme: "charcoal",
  startView: "workflows",
  dateDisplay: "relative",
  reduceMotion: false,
  increasedContrast: false,
  accessibleEditorDefault: false,
  showMinimap: true,
  snapToGrid: true,
  gridSize: 20,
  showCanvasHints: true,
  showNodeDescriptions: true,
  confirmNodeDeletion: true,
  confirmBeforeLeaving: true,
  checkForUpdates: true,
  updateChannel: "beta",
  sidebarCollapsed: false,
};

const STORAGE_KEY = "sandbox.app-preferences.v1";
const accents = new Set<Accent>(["lime", "violet", "blue"]);
const densities = new Set<Density>(["comfortable", "compact"]);
const themes = new Set<SurfaceTheme>(["charcoal", "oled"]);
const startViews = new Set<StartView>(["workflows", "history"]);
const dateDisplays = new Set<DateDisplay>(["relative", "absolute"]);
const gridSizes = new Set([10, 20, 40]);
const updateChannels = new Set<UpdateChannel>(["beta", "stable"]);

export function normalisePreferences(value: unknown): AppPreferences {
  if (!value || typeof value !== "object") return { ...defaultPreferences };
  const input = value as Partial<AppPreferences>;
  return {
    accent: accents.has(input.accent as Accent) ? input.accent as Accent : defaultPreferences.accent,
    density: densities.has(input.density as Density) ? input.density as Density : defaultPreferences.density,
    surfaceTheme: themes.has(input.surfaceTheme as SurfaceTheme) ? input.surfaceTheme as SurfaceTheme : defaultPreferences.surfaceTheme,
    startView: startViews.has(input.startView as StartView) ? input.startView as StartView : defaultPreferences.startView,
    dateDisplay: dateDisplays.has(input.dateDisplay as DateDisplay) ? input.dateDisplay as DateDisplay : defaultPreferences.dateDisplay,
    reduceMotion: typeof input.reduceMotion === "boolean" ? input.reduceMotion : defaultPreferences.reduceMotion,
    increasedContrast: typeof input.increasedContrast === "boolean" ? input.increasedContrast : defaultPreferences.increasedContrast,
    accessibleEditorDefault: typeof input.accessibleEditorDefault === "boolean" ? input.accessibleEditorDefault : defaultPreferences.accessibleEditorDefault,
    showMinimap: typeof input.showMinimap === "boolean" ? input.showMinimap : defaultPreferences.showMinimap,
    snapToGrid: typeof input.snapToGrid === "boolean" ? input.snapToGrid : defaultPreferences.snapToGrid,
    gridSize: gridSizes.has(input.gridSize as number) ? input.gridSize as 10 | 20 | 40 : defaultPreferences.gridSize,
    showCanvasHints: typeof input.showCanvasHints === "boolean" ? input.showCanvasHints : defaultPreferences.showCanvasHints,
    showNodeDescriptions: typeof input.showNodeDescriptions === "boolean" ? input.showNodeDescriptions : defaultPreferences.showNodeDescriptions,
    confirmNodeDeletion: typeof input.confirmNodeDeletion === "boolean" ? input.confirmNodeDeletion : defaultPreferences.confirmNodeDeletion,
    confirmBeforeLeaving: typeof input.confirmBeforeLeaving === "boolean" ? input.confirmBeforeLeaving : defaultPreferences.confirmBeforeLeaving,
    checkForUpdates: typeof input.checkForUpdates === "boolean" ? input.checkForUpdates : defaultPreferences.checkForUpdates,
    updateChannel: updateChannels.has(input.updateChannel as UpdateChannel) ? input.updateChannel as UpdateChannel : defaultPreferences.updateChannel,
    sidebarCollapsed: typeof input.sidebarCollapsed === "boolean" ? input.sidebarCollapsed : defaultPreferences.sidebarCollapsed,
  };
}

function readPreferences(): AppPreferences {
  if (typeof window === "undefined") return { ...defaultPreferences };
  try { return normalisePreferences(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")); }
  catch { return { ...defaultPreferences }; }
}

interface PreferenceStore extends AppPreferences {
  update: (patch: Partial<AppPreferences>) => void;
  reset: () => void;
}

export const usePreferences = create<PreferenceStore>((set) => ({
  ...readPreferences(),
  update: (patch) => set((current) => {
    const next = normalisePreferences({ ...current, ...patch });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }),
  reset: () => set(() => {
    const next = { ...defaultPreferences };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }),
}));

export function applyPreferences(preferences: AppPreferences): void {
  const root = document.documentElement;
  root.dataset.accent = preferences.accent;
  root.dataset.density = preferences.density;
  root.dataset.surface = preferences.surfaceTheme;
  root.dataset.reduceMotion = String(preferences.reduceMotion);
  root.dataset.contrast = preferences.increasedContrast ? "high" : "standard";
  root.dataset.nodeDescriptions = String(preferences.showNodeDescriptions);
}

export function useApplyPreferences(): void {
  const preferences = usePreferences();
  useEffect(() => applyPreferences(preferences), [
    preferences.accent,
    preferences.density,
    preferences.surfaceTheme,
    preferences.reduceMotion,
    preferences.increasedContrast,
    preferences.showNodeDescriptions,
  ]);
}
