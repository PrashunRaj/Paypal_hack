import { Component } from 'react';

// Shows a readable message instead of a blank page if a component crashes.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('UI error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card mx-auto max-w-xl">
        <h2 className="text-lg font-bold">Something went wrong on this page</h2>
        <p className="muted mt-1 text-sm">{String(this.state.error.message || this.state.error)}</p>
        <button className="btn mt-4" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
