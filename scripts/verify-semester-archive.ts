/** 仅查询与断言；无迁移、归档写入、导入或删除。只输出计数，不输出评价正文或配置。 */
import "dotenv/config";
import assert from "node:assert/strict";
import { closeDb, getActiveSemester, getAdminStats, getAllEvaluations, getCourses, listSemesters } from "../server/db";
import { semesterLabel } from "../shared/semesterArchive";

async function verify() {
  const before = await getActiveSemester();
  for (const semester of await listSemesters()) {
    const stats = await getAdminStats(semester.id);
    assert(stats, "统计查询失败");
    const courses = await getCourses({ semesterId: semester.id, page: 1, pageSize: 10000 });
    const evaluations = await getAllEvaluations({ semesterId: semester.id });
    assert(courses.data.every(c => c.semesterId === semester.id), "课程混入其他学期");
    assert(evaluations.every(e => e.semesterId === semester.id), "评价混入其他学期");
    assert(evaluations.every(e => e.course?.semesterId === semester.id), "评价关联课程缺失或跨学期");
    assert.equal(stats.totalCourses, courses.total, "课程列表与仪表盘不一致");
    assert.equal(stats.totalEvaluations, evaluations.filter(e => e.status === "submitted").length, "已提交评价数量不一致");
    assert.equal(stats.totalEvaluations, stats.semesterColleges.reduce((n, c) => n + c.evaluationCount, 0), "学院次数合计不一致");
    assert.equal(stats.totalCourses, stats.semesterColleges.reduce((n, c) => n + c.totalCourses, 0), "学院课程合计不一致");
    console.log(JSON.stringify({ semester: semesterLabel(semester), courses: courses.total, colleges: stats.semesterColleges.length, submitted: stats.totalEvaluations, drafts: evaluations.filter(e => e.status === "draft").length, evaluatedCourses: stats.semesterColleges.reduce((n,c) => n+c.evaluatedCourses,0), result: "PASS" }));
  }
  assert.equal((await getActiveSemester())?.id, before?.id, "只读查看改变了当前学期");
}
verify().catch(error => { console.error(error instanceof assert.AssertionError ? error.message : "只读核验失败，请检查连接及查询兼容性（未输出配置）"); process.exitCode = 1; }).finally(closeDb);
