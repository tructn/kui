import { describe, expect, test } from "bun:test";

import { emptyCluster, withoutUnusedSecurity, type ClusterConfig } from "./types";

const filled: ClusterConfig = {
  ...emptyCluster(),
  saslUsername: "alice",
  saslPassword: "secret",
  oauthTokenEndpoint: "https://idp/token",
  oauthClientId: "kui",
  oauthClientSecret: "s3cret",
  oauthScope: "kafka",
  sslCaLocation: "/ca.pem",
  sslCertificateLocation: "/client.pem",
  sslKeyLocation: "/client.key",
  sslKeyPassword: "pw",
};

describe("withoutUnusedSecurity", () => {
  test("PLAINTEXT keeps no credentials or certificates", () => {
    const c = withoutUnusedSecurity({ ...filled, securityProtocol: "PLAINTEXT" });
    expect(c.saslMechanism).toBeNull();
    expect(c.saslPassword).toBeNull();
    expect(c.oauthClientSecret).toBeNull();
    expect(c.sslCaLocation).toBeNull();
  });

  test("SSL keeps only certificates", () => {
    const c = withoutUnusedSecurity({ ...filled, securityProtocol: "SSL" });
    expect(c.sslCertificateLocation).toBe("/client.pem");
    expect(c.sslKeyPassword).toBe("pw");
    expect(c.saslUsername).toBeNull();
    expect(c.oauthClientId).toBeNull();
  });

  test("SASL_SSL with SCRAM keeps the password, not the OAuth client", () => {
    const c = withoutUnusedSecurity({ ...filled, securityProtocol: "SASL_SSL", saslMechanism: "SCRAM-SHA-512" });
    expect(c.saslPassword).toBe("secret");
    expect(c.sslCaLocation).toBe("/ca.pem");
    expect(c.oauthClientSecret).toBeNull();
  });

  test("OAUTHBEARER keeps the OAuth client, not the password", () => {
    const c = withoutUnusedSecurity({ ...filled, securityProtocol: "SASL_PLAINTEXT", saslMechanism: "OAUTHBEARER" });
    expect(c.oauthTokenEndpoint).toBe("https://idp/token");
    expect(c.oauthClientSecret).toBe("s3cret");
    expect(c.saslPassword).toBeNull();
    expect(c.sslCaLocation).toBeNull();
  });
});
