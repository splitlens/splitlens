import { describe, it, expect } from "vitest";
import {
  identifyPerson,
  identifyPersonByName,
  DEFAULT_PEOPLE,
  getPersonById,
  type Person,
} from "../../src/people";

describe("identifyPerson — DEFAULT_PEOPLE registry", () => {
  it("returns null for an unknown counterparty", () => {
    expect(identifyPerson("UPI-RANDOMVENDORXYZ-FOO@PAYTM-...")).toBeNull();
  });

  describe("Rahul (flatmate, multi-handle)", () => {
    const cases = [
      "UPI-RAHULKUMAR-9525680445@YBL-HDFC0000235-...",
      "UPI-RAHULKUMAR-9525680445@AXL-HDFC0000235-...",
      "UPI-RAHUL KUMAR-RAHUL.GR8DPS@OKHDFCBANK-...",
    ];
    for (const n of cases) {
      it(`matches: ${n.slice(0, 50)}...`, () => {
        expect(identifyPerson(n)?.personId).toBe("rahul");
      });
    }
    it("does NOT match the BharatPe merchant 'RAHUL-BHARATPE-...'", () => {
      expect(identifyPerson("UPI-RAHUL-BHARATPE.9D0K0N0L2D024545@UNITYPE-...")).toBeNull();
    });
    it("does NOT match RAHULKUMARSINGH (different person)", () => {
      expect(identifyPerson("UPI-RAHULKUMARSINGH-6206785781@AXL-...")).toBeNull();
    });
  });

  describe("Shivam Mishra (flatmate, multi-handle)", () => {
    const cases = [
      "UPI-SHIVAMRAMSURAT MISH-SHIVAMWA786@OKSBI-SBIN0010331-...",
      "UPI-SHIVAMRAMSURAT MISH-SHIVAMWA321@OKICICI-...",
    ];
    for (const n of cases) {
      it(`matches: ${n.slice(0, 50)}...`, () => {
        expect(identifyPerson(n)?.personId).toBe("shivam-mishra");
      });
    }
  });

  describe("Bethprasad (domestic help)", () => {
    it("matches no-space form", () => {
      expect(identifyPerson("UPI-BETHPRASADKADEL-9886619181@AXL-...")?.personId).toBe(
        "bethprasad",
      );
    });
    it("matches with space + alt UPI handle", () => {
      expect(identifyPerson("UPI-BETHPRASAD KADEL-BEDKADEL88@OKSBI-...")?.personId).toBe(
        "bethprasad",
      );
    });
    it("returned match carries display name + matched pattern", () => {
      const m = identifyPerson("UPI-BETHPRASADKADEL-...");
      expect(m).toMatchObject({
        personId: "bethprasad",
        displayName: "Bethprasad Kadel",
        matchedPattern: expect.stringContaining("BEDKADEL"),
      });
    });
  });

  describe("Family", () => {
    it("matches Neha Singh", () => {
      expect(identifyPerson("UPI-NEHAUPENDRASINGH-...")?.personId).toBe("neha-singh");
    });
    it("matches Saransh Sinha", () => {
      expect(identifyPerson("UPI-SARANSHSINHA-...")?.personId).toBe("saransh-sinha");
    });
    it("matches Pooja Ramsurat", () => {
      expect(identifyPerson("UPI-POOJARAMSURAT-...")?.personId).toBe("pooja-ramsurat");
    });
    it("matches Mahendra Kumar Sinha", () => {
      expect(identifyPerson("UPI-MAHENDRAKUMAR SINHA-...")?.personId).toBe("mahendra-sinha");
    });
  });

  describe("Friends", () => {
    it("matches Mayank Wali (with space)", () => {
      expect(identifyPerson("UPI-MAYANK WALI-WALIMAYANK@YBL-HDFC0000446-...")?.personId).toBe(
        "mayank-wali",
      );
    });
    it("matches Mayank Wali via UPI handle alone", () => {
      expect(identifyPerson("UPI-WALIMAYANK-...")?.personId).toBe("mayank-wali");
    });
    it("matches Sitanshu Sinha by phone in handle", () => {
      expect(identifyPerson("UPI-KUMARSITANSHU-8092735101-4@AXL-...")?.personId).toBe(
        "sitanshu-sinha",
      );
    });
    it("matches Sitanshu Sinha by name with space", () => {
      expect(identifyPerson("UPI-KUMAR SITANSHU-8092735101@AXL-SBIN0014664-...")?.personId).toBe(
        "sitanshu-sinha",
      );
    });
    it("matches Shreya Agrawal", () => {
      expect(identifyPerson("UPI-SHREYA AGRAWAL-SHREYA@YBL-...")?.personId).toBe("shreya-agrawal");
    });
  });
});

describe("getPersonById", () => {
  it("returns the full record for a known id", () => {
    const p = getPersonById("rahul");
    expect(p).toMatchObject({
      id: "rahul",
      displayName: "Rahul Kumar",
      relationship: "flatmate",
    });
  });
  it("returns undefined for unknown id", () => {
    expect(getPersonById("not-a-person")).toBeUndefined();
  });
});

describe("DEFAULT_PEOPLE registry shape", () => {
  it("has at least 10 people", () => {
    expect(DEFAULT_PEOPLE.length).toBeGreaterThanOrEqual(10);
  });
  it("every entry has a unique id", () => {
    const ids = DEFAULT_PEOPLE.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("every entry has at least one upi pattern", () => {
    for (const p of DEFAULT_PEOPLE) {
      expect(p.upiPatterns.length).toBeGreaterThan(0);
    }
  });
});

describe("identifyPersonByName — clean-name fallback (PhonePe / GPay)", () => {
  it("matches the exact display name (case-insensitive)", () => {
    expect(identifyPersonByName("Rahul Kumar")?.personId).toBe("rahul");
    expect(identifyPersonByName("RAHUL KUMAR")?.personId).toBe("rahul");
    expect(identifyPersonByName("rahul kumar")?.personId).toBe("rahul");
  });

  it("returns null for a counterparty no one in the registry matches", () => {
    expect(identifyPersonByName("KRISHNA BEKARY")).toBeNull();
    expect(identifyPersonByName("Apple Media Services")).toBeNull();
  });

  it("returns null for empty / whitespace input", () => {
    expect(identifyPersonByName("")).toBeNull();
    expect(identifyPersonByName("   ")).toBeNull();
  });

  it("matches on a nameAliases entry instead of displayName when provided", () => {
    const reg: Person[] = [
      {
        id: "max",
        displayName: "Maximus Q",
        relationship: "friend",
        upiPatterns: ["MAX-PAY@HDFC"],
        nameAliases: ["Maximus", "Max"],
      },
    ];
    expect(identifyPersonByName("Maximus", reg)?.personId).toBe("max");
    expect(identifyPersonByName("Max", reg)?.personId).toBe("max");
    // 'Maximus Q' contains the alias 'Maximus' as a whole word — still matches.
    expect(identifyPersonByName("Maximus Q", reg)?.personId).toBe("max");
    // Different name entirely doesn't match.
    expect(identifyPersonByName("Maxine", reg)).toBeNull();
  });

  it("matches whole-word containment for multi-word names", () => {
    const reg: Person[] = [
      {
        id: "rahul-k",
        displayName: "Rahul Kumar",
        relationship: "friend",
        upiPatterns: ["RAHUL-X@OK"],
      },
    ];
    // "Rahul Kumar Singh" contains "Rahul Kumar" as a whole-word match.
    expect(identifyPersonByName("Rahul Kumar Singh", reg)?.personId).toBe("rahul-k");
  });

  it("does NOT match a partial substring that crosses word boundaries", () => {
    const reg: Person[] = [
      {
        id: "rahul-k",
        displayName: "Rahul Kumar",
        relationship: "friend",
        upiPatterns: ["RAHUL-X@OK"],
      },
    ];
    expect(identifyPersonByName("Mahirahul Kumarwala", reg)).toBeNull();
  });
});
