import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Circle,
  MonitorDot,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { BrowserProfile, RecordedStep } from "../types";
import { FocusDialog } from "./ui/Dialog";
import { CustomSelect } from "./ui/CustomSelect";

export function BrowserRecorder({
  profiles,
  onProfileCreated,
  onApply,
}: {
  profiles: BrowserProfile[];
  onProfileCreated: (profile: BrowserProfile) => void;
  onApply: (profileId: string, steps: RecordedStep[]) => void;
}) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [initialUrl, setInitialUrl] = useState("");
  const [sessionId, setSessionId] = useState<string>();
  const [steps, setSteps] = useState<RecordedStep[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!sessionId) return;
    const timer = window.setInterval(() => {
      void api
        .getBrowserRecording(sessionId)
        .then((result) => setSteps(result.steps))
        .catch((value) => setError(String(value)));
    }, 800);
    return () => window.clearInterval(timer);
  }, [sessionId]);

  const begin = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.startBrowserRecording(
        profileId,
        initialUrl || undefined,
      );
      setSessionId(result.browserSession.sessionId);
      setSteps([]);
      setSetupOpen(false);
    } catch (value) {
      setError(String(value));
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      const result = await api.stopBrowserRecording(sessionId);
      setSteps(result.steps);
      setSessionId(undefined);
      setReviewing(true);
    } catch (value) {
      setError(String(value));
    } finally {
      setBusy(false);
    }
  };
  const createProfile = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const profile = await api.createBrowserProfile("Work browser", true, {
        viewportWidth: 1280,
        viewportHeight: 800,
        permissions: [],
      });
      onProfileCreated(profile);
      setProfileId(profile.id);
    } catch (value) {
      setError(String(value));
    } finally {
      setBusy(false);
    }
  };
  const cancelReview = () => {
    setReviewing(false);
    setSteps([]);
  };

  return (
    <>
      <button
        className="button"
        disabled={!api.isDesktop || Boolean(sessionId)}
        onClick={() => setSetupOpen(true)}
        title={
          api.isDesktop
            ? "Record actions in managed Chromium"
            : "Recording is available in the desktop application"
        }
      >
        <MonitorDot size={14} />
        Record
      </button>
      {sessionId && (
        <div className="recording-control">
          <Circle size={8} fill="currentColor" />
          <span>Recording browser</span>
          <em>
            {steps.length} draft step{steps.length === 1 ? "" : "s"}
          </em>
          <button onClick={stop} disabled={busy}>
            <Square size={10} fill="currentColor" />
            Stop
          </button>
        </div>
      )}
      <FocusDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        title="Record workflow"
        description="Actions are captured in an isolated managed Chromium profile."
      >
        {setupOpen && (
          <div className="recording-setup">
            <header>
              <span className="recording-icon">
                <Circle size={10} fill="currentColor" />
              </span>
              <div>
                <h2>Record workflow</h2>
                <p>
                  Actions are captured in an isolated managed Chromium profile.
                </p>
              </div>
            </header>
            <section>
              <label className="field">
                <span>Browser profile</span>
                <CustomSelect
                  autoFocus
                  value={profileId}
                  onChange={(event) => setProfileId(event.target.value)}
                >
                  <option value="">Select a profile…</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </CustomSelect>
              </label>
              <label className="field">
                <span>
                  Starting URL <small>Optional</small>
                </span>
                <input
                  placeholder="https://app.example.com"
                  value={initialUrl}
                  onChange={(event) => setInitialUrl(event.target.value)}
                />
              </label>
              <div className="security-note">
                <AlertTriangle size={14} />
                <span>
                  Password and payment fields are detected but their values are
                  never recorded. They become required protected inputs.
                </span>
              </div>
              {profiles.length === 0 && (
                <div className="inline-setup">
                  <span>No managed profile exists yet.</span>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={createProfile}
                  >
                    Create default profile
                  </button>
                </div>
              )}
              {error && <div className="error-banner">{error}</div>}
            </section>
            <footer>
              <button className="button" onClick={() => setSetupOpen(false)}>
                Cancel
              </button>
              <button
                className="button primary"
                disabled={!profileId || busy}
                onClick={begin}
              >
                {busy ? "Opening…" : "Open Chromium & record"}
              </button>
            </footer>
          </div>
        )}
      </FocusDialog>
      {reviewing && (
        <RecordingReview
          steps={steps}
          setSteps={setSteps}
          onCancel={cancelReview}
          onApply={() => {
            onApply(profileId, steps);
            cancelReview();
          }}
        />
      )}
    </>
  );
}

function RecordingReview({
  steps,
  setSteps,
  onCancel,
  onApply,
}: {
  steps: RecordedStep[];
  setSteps: (steps: RecordedStep[]) => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const sensitive = useMemo(
    () => steps.filter((step) => step.sensitiveInputRequired).length,
    [steps],
  );
  const move = (index: number, direction: -1 | 1) => {
    const next = [...steps];
    const [step] = next.splice(index, 1);
    next.splice(index + direction, 0, step);
    setSteps(next);
  };
  const rename = (index: number, name: string) =>
    setSteps(
      steps.map((step, position) =>
        position === index ? { ...step, name } : step,
      ),
    );
  const mergeable = (index: number) =>
    index > 0 &&
    steps[index].action === "fill_field" &&
    steps[index - 1].action === "fill_field" &&
    JSON.stringify(steps[index].configuration.locator) ===
      JSON.stringify(steps[index - 1].configuration.locator);
  const combine = (index: number) =>
    setSteps(steps.filter((_, position) => position !== index - 1));
  return (
    <FocusDialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title="Review recorded steps"
      description="Rename, reorder, remove, or combine input events before creating editable nodes."
    >
      <div className="recording-review">
        <header>
          <div>
            <h2>Review recorded steps</h2>
            <p>
              Rename, reorder, remove, or combine input events before creating
              editable nodes.
            </p>
          </div>
          <span>{steps.length} steps</span>
        </header>
        {sensitive > 0 && (
          <div className="sensitive-review">
            <AlertTriangle size={15} />
            <div>
              <b>
                {sensitive} protected input{sensitive === 1 ? "" : "s"} required
              </b>
              <p>
                Values were not captured. Map a credential or protected workflow
                input before running.
              </p>
            </div>
          </div>
        )}
        <section>
          {steps.length ? (
            steps.map((step, index) => (
              <div className="recorded-step" key={step.id}>
                <span className="step-number">{index + 1}</span>
                <div>
                  <input
                    value={step.name}
                    onChange={(event) => rename(index, event.target.value)}
                  />
                  <small>
                    {step.action.replaceAll("_", " ")}
                    {step.sensitiveInputRequired
                      ? " · protected value required"
                      : ""}
                  </small>
                </div>
                {mergeable(index) && (
                  <button
                    className="button compact"
                    onClick={() => combine(index)}
                  >
                    Combine
                  </button>
                )}
                <button
                  className="icon-button"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  title="Move up"
                  aria-label={`Move ${step.name} up`}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  className="icon-button"
                  disabled={index === steps.length - 1}
                  onClick={() => move(index, 1)}
                  title="Move down"
                  aria-label={`Move ${step.name} down`}
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  className="icon-button danger-text"
                  onClick={() =>
                    setSteps(steps.filter((_, position) => position !== index))
                  }
                  title="Remove"
                  aria-label={`Remove ${step.name}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          ) : (
            <div className="review-empty">
              No supported actions were recorded.
            </div>
          )}
        </section>
        <footer>
          <span>
            Typing is automatically combined into one Fill Field node.
          </span>
          <button className="button" onClick={onCancel}>
            Discard
          </button>
          <button
            className="button primary"
            disabled={!steps.length}
            onClick={onApply}
          >
            Add editable nodes
          </button>
        </footer>
      </div>
    </FocusDialog>
  );
}
