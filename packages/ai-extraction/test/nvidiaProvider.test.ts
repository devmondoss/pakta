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
});
