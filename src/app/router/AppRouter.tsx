import { BrowserRouter, Route, Routes, useParams } from "react-router-dom";

import { AppShell } from "../../shell/layouts/AppShell";
import { LoginPage } from "../../features/auth/components/LoginPage";
import { JoinPage } from "../../features/auth/components/JoinPage";
import { OpenJoinPage } from "../../features/auth/components/OpenJoinPage";
import { PublicLinkJoin } from "../../features/auth/components/PublicLinkJoin";
import { ForgotPasswordPage } from "../../features/auth/components/ForgotPasswordPage";
import { ResetPasswordPage } from "../../features/auth/components/ResetPasswordPage";
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

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/join/:token" element={<JoinTokenRoute />} />
        <Route path="/join" element={<OpenJoinPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
        <Route path="*" element={<AppShell />} />
      </Routes>
    </BrowserRouter>
  );
}
