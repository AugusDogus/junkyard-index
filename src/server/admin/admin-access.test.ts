import { describe, expect, test } from "bun:test";
import { AdminAccess } from "./admin-access";

describe("AdminAccess.parseUserIds", () => {
  test("reads a comma-separated list, ignoring spaces and empty entries", () => {
    expect([...AdminAccess.parseUserIds(" user-a, user-b ,,user-a ")]).toEqual([
      "user-a",
      "user-b",
    ]);
  });

  test("an unset or blank list grants no one", () => {
    expect(AdminAccess.parseUserIds(undefined).size).toBe(0);
    expect(AdminAccess.parseUserIds(" , ").size).toBe(0);
  });
});

describe("AdminAccess.decide", () => {
  const admins = AdminAccess.parseUserIds("user-a");

  test("a signed-in user on the list is an admin", () => {
    expect(AdminAccess.decide({ user: { id: "user-a" } }, admins)).toEqual({
      status: "admin",
      userId: "user-a",
    });
  });

  test("a signed-in user off the list is denied", () => {
    expect(AdminAccess.decide({ user: { id: "user-b" } }, admins)).toEqual({
      status: "denied",
    });
  });

  test("a signed-out visitor is denied", () => {
    expect(AdminAccess.decide(null, admins)).toEqual({ status: "denied" });
  });

  test("no one is an admin while the list is empty", () => {
    expect(
      AdminAccess.decide(
        { user: { id: "user-a" } },
        AdminAccess.parseUserIds(undefined),
      ),
    ).toEqual({ status: "denied" });
  });

  test("ids match exactly, not by prefix or case", () => {
    for (const id of ["user-", "USER-A", "user-a2", ""]) {
      expect(AdminAccess.decide({ user: { id } }, admins)).toEqual({
        status: "denied",
      });
    }
  });
});
