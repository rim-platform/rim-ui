import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AppShell } from "../../shell/layouts/AppShell";
import { LoginPage } from "../../features/auth/components/LoginPage";
import { JoinPage } from "../../features/auth/components/JoinPage";
import { OpenJoinPage } from "../../features/auth/components/OpenJoinPage";
import { ForgotPasswordPage } from "../../features/auth/components/ForgotPasswordPage";
import { ResetPasswordPage } from "../../features/auth/components/ResetPasswordPage";

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/join/:token" element={<JoinPage />} />
        <Route path="/join" element={<OpenJoinPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
        <Route path="*" element={<AppShell />} />
      </Routes>
    </BrowserRouter>
  );
}
