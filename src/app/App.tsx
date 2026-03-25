import { AppProviders } from "./providers/AppProviders";
import { AppRouter } from "./router/AppRouter";
import { AppErrorBoundary } from "./AppErrorBoundary";

export default function App() {
  return (
    <AppErrorBoundary>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </AppErrorBoundary>
  );
}
