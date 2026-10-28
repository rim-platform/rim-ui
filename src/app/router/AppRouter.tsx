import { BrowserRouter, Route, Routes, useParams } from "react-router-dom";

import { AppShell } from "../../shell/layouts/AppShell";
import { WindowFrame } from "../../shell/layouts/WindowFrame";
import { LoginPage } from "../../features/auth/components/LoginPage";
import { JoinPage } from "../../features/auth/components/JoinPage";
import { OpenJoinPage } from "../../features/auth/components/OpenJoinPage";
import { PublicLinkJoin } from "../../features/auth/components/PublicLinkJoin";
import { isPublicLinkToken } from "../../features/workspaces/publicJoinLink";

/**
 * `/join/:token`: a workspace's public link (`rim_pjl_…`) opens its own page, which never
 * reaches the invite preview or signup; every other token goes through the invite flow.
 */
export function JoinTokenRoute() {
  const { token } = useParams<{ token: string }>();
  if (token && isPublicLinkToken(token)) return <PublicLinkJoin token={token} />;
  return <JoinPage />;
}

/** The route tree: the auth screens inside the window frame, everything else in the app shell. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<WindowFrame />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/join/:token" element={<JoinTokenRoute />} />
        <Route path="/join" element={<OpenJoinPage />} />
      </Route>
      <Route path="*" element={<AppShell />} />
    </Routes>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
