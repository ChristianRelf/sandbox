import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorState } from "./States";

interface Props { children: ReactNode; onHome: () => void }
interface State { error?: Error }

export class AsyncErrorBoundary extends Component<Props, State> {
  state: State = {};
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Sandbox view failed", error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="content error-boundary"><ErrorState title="This view could not load" description={this.state.error.message} onRetry={() => this.setState({ error: undefined })}/><button className="button" onClick={() => { this.setState({ error: undefined }); this.props.onHome(); }}>Return to workflows</button></main>;
  }
}
