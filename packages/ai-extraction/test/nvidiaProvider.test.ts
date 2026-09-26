import { describe, expect, it } from "vitest";
import { parseJsonResponse } from "../src/providers/nvidia.js";

describe("parseJsonResponse", () => {
  it("parses a bare JSON response", () => {
    expect(parseJsonResponse('{"a": 1}')).toEqual({ a: 1 });
  });

  it("strips a ```json fence the model added despite instructions not to", () => {
    expect(parseJsonResponse('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("strips a bare ``` fence", () => {
    expect(parseJsonResponse('```\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("slices to the outermost braces when stray prose surrounds an otherwise valid object", () => {
    expect(parseJsonResponse('Sure, here is the JSON: {"a": 1} Hope that helps!')).toEqual({ a: 1 });
  });

  it("still throws when there's no recoverable JSON at all", () => {
    expect(() => parseJsonResponse("not json and no braces here")).toThrow();
  });

  it("still throws when the sliced braces don't actually contain valid JSON", () => {
    expect(() => parseJsonResponse("{not valid json}")).toThrow();
  });
});
