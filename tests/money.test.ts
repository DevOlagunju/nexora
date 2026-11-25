import { describe, expect, it } from "vitest";
import { addNgn, koboToNgn, mulNgn, ngnToKobo, numberFrom, roundNgn, subNgn, sumNgn } from "@/lib/money";

/** Money maths must behave like decimal arithmetic on paper, not like binary floats. */
describe("money helpers", () => {
  it("adds without float noise", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the problem being avoided
    expect(addNgn(0.1, 0.2)).toBe(0.3);
    expect(sumNgn([0.1, 0.2, 0.3, 0.4])).toBe(1);
    expect(sumNgn(Array.from({ length: 1000 }, () => 0.01))).toBe(10);
    expect(sumNgn([])).toBe(0);
  });

  it("subtracts without float noise", () => {
    expect(subNgn(0.3, 0.1)).toBe(0.2);
    expect(subNgn(10_000, 5_050)).toBe(4_950);
  });

  it("multiplies quantity by rate and rounds half-up to the kobo", () => {
    expect(mulNgn(0.1, 3)).toBe(0.3);
    expect(mulNgn(1.15, 100)).toBe(115); // 114.99999999999999 as a float
    expect(mulNgn(0.00012345, 150_000_000)).toBe(18_517.5);
    expect(mulNgn(1.005, 1)).toBe(1.01);
    expect(mulNgn(0.333, 0.01)).toBe(0); // 0.00333 rounds down
    expect(mulNgn(0.5, 0.01)).toBe(0.01); // exactly half a kobo rounds up
  });

  it("rounds half-up, including values floats cannot hold exactly", () => {
    expect(roundNgn(1.005)).toBe(1.01);
    expect(roundNgn(2.675)).toBe(2.68);
    expect(roundNgn(1234.5600000000002)).toBe(1234.56);
  });

  it("converts to and from kobo exactly", () => {
    expect(ngnToKobo(1.15)).toBe(115);
    expect(ngnToKobo(19.99)).toBe(1999);
    expect(koboToNgn(1999)).toBe(19.99);
    expect(koboToNgn(ngnToKobo(4_950.05))).toBe(4_950.05);
  });

  it("reads database aggregates, which arrive as decimals or null", () => {
    expect(numberFrom(null)).toBe(0);
    expect(numberFrom(undefined)).toBe(0);
    expect(numberFrom(12.5)).toBe(12.5);
  });
});
