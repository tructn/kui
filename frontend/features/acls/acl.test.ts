import { describe, expect, test } from "bun:test";

import { aclKey, aclsFromForm, describeAcl, matchesAcl, type AclForm } from "./acl";
import { OPERATIONS, type AclBinding } from "./types";

const acl: AclBinding = {
  resourceType: "topic",
  resourceName: "orders",
  patternType: "prefixed",
  principal: "User:alice",
  host: "*",
  operation: "read",
  permission: "allow",
};

const form: AclForm = {
  principal: " User:alice ",
  host: "",
  resourceType: "topic",
  patternType: "literal",
  resourceName: " orders ",
  permission: "deny",
  operations: ["read", "describe"],
};

describe("aclKey", () => {
  test("tells apart ACLs that differ in a single field", () => {
    expect(aclKey(acl)).not.toBe(aclKey({ ...acl, operation: "describe" }));
    expect(aclKey(acl)).not.toBe(aclKey({ ...acl, patternType: "literal" }));
    expect(aclKey(acl)).toBe(aclKey({ ...acl }));
  });

  test("can't be fooled by separators inside names", () => {
    const a = { ...acl, resourceName: "a", principal: "User:b|c" };
    const b = { ...acl, resourceName: "a|User:b", principal: "c" };
    expect(aclKey(a)).not.toBe(aclKey(b));
  });
});

describe("describeAcl", () => {
  test("reads as a sentence and marks prefixes with *", () => {
    expect(describeAcl(acl)).toBe("Allow User:alice to Read topic orders* from any host");
    expect(describeAcl({ ...acl, permission: "deny", patternType: "literal", host: "10.0.0.1" })).toBe(
      "Deny User:alice to Read topic orders from 10.0.0.1",
    );
  });
});

describe("matchesAcl", () => {
  test("searches principal, resource and host, ignoring case", () => {
    expect(matchesAcl(acl, "ALICE")).toBe(true);
    expect(matchesAcl(acl, "ord")).toBe(true);
    expect(matchesAcl(acl, "bob")).toBe(false);
    expect(matchesAcl(acl, "  ")).toBe(true);
  });
});

describe("aclsFromForm", () => {
  test("makes one trimmed ACL per operation, with * as the default host", () => {
    expect(aclsFromForm(form)).toEqual([
      { ...acl, resourceName: "orders", patternType: "literal", operation: "read", permission: "deny" },
      { ...acl, resourceName: "orders", patternType: "literal", operation: "describe", permission: "deny" },
    ]);
  });

  test("uses the fixed literal name for the cluster", () => {
    const [cluster] = aclsFromForm({ ...form, resourceType: "cluster", patternType: "prefixed", resourceName: "x" });
    expect(cluster.resourceName).toBe("kafka-cluster");
    expect(cluster.patternType).toBe("literal");
  });

  test("makes nothing when no operation is chosen", () => {
    expect(aclsFromForm({ ...form, operations: [] })).toEqual([]);
  });
});

test("every resource type allows All, like the Rust table", () => {
  for (const operations of Object.values(OPERATIONS)) expect(operations).toContain("all");
});
