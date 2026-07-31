import { Component, ReactNode, createRef } from "react";
import { PrimaryButton, SecondaryButton } from "@/components/app";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  headingRef = createRef<HTMLHeadingElement>();
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // Bounded operational logging only. Do not include user or entity data.
    if (typeof console !== "undefined") {
      const message = error instanceof Error ? error.message : "unknown";
      console.error("[app-error-boundary]", message);
    }
  }

  componentDidMount() {
    // Connectivity-loss errors resolve themselves once the device is back
    // online, so clear the boundary automatically instead of leaving the user
    // stranded on a dead-end screen after reconnecting.
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleRetry);
    }
  }

  componentWillUnmount() {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleRetry);
    }
  }

  componentDidUpdate(_: Props, prev: State) {
    if (this.state.hasError && !prev.hasError) {
      // Move focus to the error heading for a11y.
      queueMicrotask(() => this.headingRef.current?.focus());
    }
  }

  handleRetry = () => {
    if (this.state.hasError) this.setState({ hasError: false });
  };


  handleHome = () => {
    this.setState({ hasError: false });
    if (typeof window !== "undefined") {
      window.location.assign("/");
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main
        role="main"
        className="min-h-dvh flex items-center justify-center px-6 py-10 bg-background"
      >
        <div className="max-w-sm w-full text-center">
          <h1
            ref={this.headingRef}
            tabIndex={-1}
            className="text-2xl font-semibold tracking-tight text-charcoal outline-none"
          >
            Something went wrong.
          </h1>
          <p className="mt-3 text-sm text-charcoal-muted leading-relaxed">
            Your information is safe. Try again, or return to Today.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <PrimaryButton onClick={this.handleRetry}>Try again</PrimaryButton>
            <SecondaryButton onClick={this.handleHome}>
              Return to Today
            </SecondaryButton>
          </div>
        </div>
      </main>
    );
  }
}
