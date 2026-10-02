import { describe, expect, it } from "vitest";
import { canViewEvaluation } from "./evaluationAccess";

describe("学院缺失时的评价详情与打印授权", () => {
  it.each(["college_secretary", "supervisor_leader"])("%s 不可读取他人评价", role => {
    expect(canViewEvaluation({ id: 1, role, supervisorScope: "college", college: null }, { supervisorId: 2 }, { college: "人文学院" })).toBe(false);
  });

  it("仍可读取本人历史评价", () => {
    expect(canViewEvaluation({ id: 1, role: "supervisor_expert", supervisorScope: "college", college: null }, { supervisorId: 1 }, { college: "人文学院" })).toBe(true);
  });
});
