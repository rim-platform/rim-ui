import { describe, expect, it } from "vitest";

import { usernameHint, usernameProblem } from "./username";

describe("usernameProblem", () => {
  it("refuses fewer than 3 or more than 32 characters after trimming", () => {
    for (const name of ["", "ab", "  ab  ", "a".repeat(33)]) {
      expect(usernameProblem(name)).toBe("Use 3 to 32 characters.");
    }
    expect(usernameProblem(`  ${"a".repeat(32)}  `)).toBeNull();
  });

  it("refuses anything but ASCII letters, digits, _ and -", () => {
    for (const name of ["al ice", "alice!", "ålice", "a.b.c"]) {
      expect(usernameProblem(name)).toBe("Use only letters (a–z), digits, _ and -.");
    }
  });

  it("refuses r_ and deleted- in either case", () => {
    for (const name of ["r_alice", "R_alice"]) {
      expect(usernameProblem(name)).toBe(
        "Usernames starting with r_ are kept for people from other servers.",
      );
    }
    for (const name of ["deleted-x", "Deleted-x"]) {
      expect(usernameProblem(name)).toBe(
        "Usernames starting with deleted- are kept for deleted accounts.",
      );
    }
  });

  it("accepts alice, a-b_c and Alice", () => {
    for (const name of ["alice", "a-b_c", "Alice"]) {
      expect(usernameProblem(name)).toBeNull();
    }
  });
});

describe("usernameHint", () => {
  it("hints the lowercase form of a valid name with capitals", () => {
    expect(usernameHint(" Alice ")).toBe("Saved as alice.");
    expect(usernameHint("alice")).toBe("3 to 32 characters: letters, digits, _ and -.");
    expect(usernameHint("Al ice")).toBe("3 to 32 characters: letters, digits, _ and -.");
  });
});
