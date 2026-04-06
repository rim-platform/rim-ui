import { describe, it, expect, beforeEach } from "vitest";
import {
  saveStatusExpiry,
  getStatusExpiry,
  clearStatusExpiry,
} from "./StatusDropdown";

describe("StatusDropdown utility functions", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("saveStatusExpiry", () => {
    it("saves expiry to localStorage", () => {
      const expiry = new Date(Date.now() + 60_000).toISOString();
      saveStatusExpiry(expiry);
      expect(localStorage.getItem("rim_status_expires_at")).toBe(expiry);
    });

    it("removes expiry when null is passed", () => {
      saveStatusExpiry("2025-01-01T00:00:00Z");
      saveStatusExpiry(null);
      expect(localStorage.getItem("rim_status_expires_at")).toBeNull();
    });
  });

  describe("getStatusExpiry", () => {
    it("returns null when no expiry is set", () => {
      expect(getStatusExpiry()).toBeNull();
    });

    it("returns the stored expiry string", () => {
      const expiry = "2025-06-15T12:00:00Z";
      localStorage.setItem("rim_status_expires_at", expiry);
      expect(getStatusExpiry()).toBe(expiry);
    });
  });

  describe("clearStatusExpiry", () => {
    it("removes the expiry from localStorage", () => {
      localStorage.setItem("rim_status_expires_at", "2025-01-01");
      clearStatusExpiry();
      expect(localStorage.getItem("rim_status_expires_at")).toBeNull();
    });

    it("is safe to call when no expiry exists", () => {
      clearStatusExpiry();
      expect(localStorage.getItem("rim_status_expires_at")).toBeNull();
    });
  });
});
