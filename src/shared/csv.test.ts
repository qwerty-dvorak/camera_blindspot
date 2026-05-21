import { describe, expect, test } from "bun:test";
import { parseCameraCsv } from "./csv";

describe("parseCameraCsv", () => {
  test("parses and normalizes camera rows", () => {
    const cameras = parseCameraCsv("camera,lat,long,orientation_deg,fov_deg,range_m\nA,10,20,370,90,100");
    expect(cameras).toEqual([
      {
        camera: "A",
        lat: 10,
        long: 20,
        orientation_deg: 10,
        fov_deg: 90,
        range_m: 100,
      },
    ]);
  });

  test("reports missing columns", () => {
    expect(() => parseCameraCsv("camera,lat\nA,10")).toThrow("missing required");
  });
});
