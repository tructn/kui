import { beforeEach, describe, expect, mock, test } from "bun:test";

// No Tauri backend under test: saving a setting is a no-op.
mock.module("@/lib/invoke", () => ({ callCommand: () => Promise.resolve(undefined) }));
const { useViewStateStore } = await import("./view-state-store");

const store = () => useViewStateStore.getState();

describe("view state", () => {
  beforeEach(() => useViewStateStore.setState({ remember: true, saved: {}, session: {} }));

  test("remembering saves values", () => {
    store().set("topics.search", "orders");
    expect(store().saved).toEqual({ "topics.search": "orders" });
    expect(store().session).toEqual({});
  });

  test("turning it off forgets everything saved", () => {
    store().set("topics.sort", { key: "name", direction: "desc" });
    store().setRemember(false);
    expect(store().saved).toEqual({});
  });

  test("off, values live in the session until the view forgets them", () => {
    store().setRemember(false);
    store().set("topics.search", "orders");
    expect(store().saved).toEqual({});
    expect(store().session).toEqual({ "topics.search": "orders" });
    store().forget("topics.search");
    expect(store().session).toEqual({});
  });

  test("turning it on keeps what is on screen", () => {
    store().setRemember(false);
    store().set("topics.showInternal", true);
    store().setRemember(true);
    expect(store().saved).toEqual({ "topics.showInternal": true });
  });
});
