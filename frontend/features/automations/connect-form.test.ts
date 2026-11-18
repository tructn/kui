import { describe, expect, it } from "bun:test";

import { defaultConnectForm, optionsOf, publishedSummary, targetOf } from "./connect-form";

describe("optionsOf", () => {
  it("trims the form and reads extra properties as key=value lines", () => {
    const form = {
      ...defaultConnectForm(" broker:9092 "),
      replicationFactor: " 1 ",
      propertiesText: "confluent.topic.security.protocol = SASL_SSL\nnot a property\n",
    };
    expect(optionsOf(form)).toEqual({
      namePrefix: "kui",
      bootstrapServers: "broker:9092",
      replicationFactor: 1,
      properties: { "confluent.topic.security.protocol": "SASL_SSL" },
    });
  });

  it("turns a replication factor that isn't a whole number into 0 for the backend to reject", () => {
    for (const bad of ["", "1.5", "-2", "three", "40000"]) {
      expect(optionsOf({ ...defaultConnectForm("b:9092"), replicationFactor: bad }).replicationFactor).toBe(0);
    }
  });
});

describe("targetOf", () => {
  it("only sends a password along with a user name", () => {
    const form = defaultConnectForm("b:9092");
    expect(targetOf(form, "pw")).toEqual({ url: "http://localhost:8083", username: null, password: null });
    expect(targetOf({ ...form, username: " admin " }, "pw")).toEqual({
      url: "http://localhost:8083",
      username: "admin",
      password: "pw",
    });
  });
});

describe("publishedSummary", () => {
  it("separates created and updated connectors", () => {
    expect(
      publishedSummary([
        { name: "kui-a", created: true },
        { name: "kui-b", created: false },
      ]),
    ).toBe("Created kui-a. Updated kui-b");
    expect(publishedSummary([{ name: "kui-a", created: false }])).toBe("Updated kui-a");
  });
});
