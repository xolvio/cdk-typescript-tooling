import { snakeToPascal } from "./snakeToPascal";

test("Turns snake to Pascal", () => {
  expect(snakeToPascal("ABC_DEF_GFH")).toEqual("AbcDefGfh");
});

test("Leaves things alone if not a snake", () => {
  expect(snakeToPascal("AbcDefGfh")).toEqual("AbcDefGfh");
});
