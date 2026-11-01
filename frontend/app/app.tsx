import { AppShell } from "./app-shell";
import { ErrorBoundary } from "./error-boundary";
import { Providers } from "./providers";

export function App() {
  return (
    <Providers>
      <ErrorBoundary>
        <AppShell />
      </ErrorBoundary>
    </Providers>
  );
}
