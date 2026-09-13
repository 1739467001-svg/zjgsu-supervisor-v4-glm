import DashboardLayout from "@/components/DashboardLayout";
import SemesterSettings from "@/components/SemesterSettings";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis } from "recharts";
import { TrendingUp, Users, BookOpen, CheckCircle, Eye, ChevronRight, BarChart3 } from "lucide-react";

const COLORS = [
  "oklch(0.35 0.13 245)", "oklch(0.52 0.16 200)", "oklch(0.62 0.14 160)",
  "oklch(0.72 0.14 85)", "oklch(0.62 0.16 30)", "oklch(0.55 0.14 300)",
  "oklch(0.65 0.12 120)", "oklch(0.45 0.15 260)", "oklch(0.70 0.13 50)",
  "oklch(0.50 0.17 180)",
];

const WEEKDAY_ORDER = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];

export default function AdminDashboard() {
  const [, navigate] = useLocation();
  const { data: stats, isLoading } = trpc.stats.adminDashboard.useQuery();
  const { data: collegeProgressData } = trpc.stats.allCollegeProgress.useQuery();

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">加载统计数据...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!stats) return null;

  const weekdayData = WEEKDAY_ORDER.map((day) => ({
    name: day.replace("星期", ""),
    count: stats.evalByWeekday.find((d) => d.weekday === day)?.count || 0,
  }));

  // 三张学院图表全部由 stats.collegeStats 这一份数据派生，
  // 取前 N 名的口径、学院名截断长度也保持一致 ——
  // 此前三张图各取前 12 / 前 8 / 前 8，平均分那张还少了「没打总分」的学院，
  // 于是同一个页面上三张图的学院数量互相对不上。
  const TOP_N = 10;
  const shortName = (college: string | null) => {
    const name = college || "";
    return name.length > 8 ? name.slice(0, 8) + "…" : name;
  };

  const topColleges = stats.collegeStats.slice(0, TOP_N);
  const othersCount = stats.collegeStats.slice(TOP_N).reduce((sum, c) => sum + c.count, 0);

  const collegeBarData = topColleges.map((c) => ({
    name: shortName(c.college),
    fullName: c.college,
    count: c.count,
  }));

  const avgScoreData = topColleges.map((c) => ({
    name: shortName(c.college),
    fullName: c.college,
    // 该学院所有评价都没打总分时为 null，柱子不画但学院仍列在轴上，不会凭空少一个学院
    score: c.avgScore === null ? null : Number(c.avgScore.toFixed(2)),
    count: c.count,
    scoredCount: c.scoredCount,
  }));

  const pieData = [
    ...topColleges.map((c, i) => ({
      name: shortName(c.college),
      value: c.count,
      color: COLORS[i % COLORS.length],
    })),
    ...(othersCount > 0 ? [{ name: `其他 ${stats.collegeStats.length - TOP_N} 个学院`, value: othersCount, color: "oklch(0.75 0.01 240)" }] : []),
  ];

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 page-transition">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "oklch(0.18 0.025 240)" }}>研究生院督导统计</h1>
          <p className="text-sm mt-0.5" style={{ color: "oklch(0.52 0.025 240)" }}>全校督导评价数据可视化分析</p>
        </div>

        {/* 核心指标 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "全校课程总数", value: stats.totalCourses, icon: <BookOpen className="w-5 h-5" />, color: "oklch(0.35 0.13 245)", bg: "oklch(0.93 0.018 240)" },
            { label: "已完成督导评价", value: stats.totalEvaluations, icon: <CheckCircle className="w-5 h-5" />, color: "oklch(0.42 0.14 160)", bg: "oklch(0.93 0.018 160)" },
            { label: "督导专家人数", value: stats.totalSupervisors, icon: <Users className="w-5 h-5" />, color: "oklch(0.52 0.16 200)", bg: "oklch(0.93 0.018 200)" },
            { label: "已覆盖学院数", value: stats.collegeStats.length, icon: <TrendingUp className="w-5 h-5" />, color: "oklch(0.55 0.14 85)", bg: "oklch(0.95 0.02 85)" },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-xl p-5 relative overflow-hidden" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
              <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: stat.color }} />
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3" style={{ background: stat.bg, color: stat.color }}>
                {stat.icon}
              </div>
              <div className="text-2xl font-bold" style={{ color: "oklch(0.18 0.025 240)" }}>{stat.value}</div>
              <div className="text-xs mt-1" style={{ color: "oklch(0.52 0.025 240)" }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* 图表区 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* 各学院督导次数柱状图 */}
          <div className="bg-white rounded-xl p-5" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: "oklch(0.18 0.025 240)" }}>各学院督导评价次数</h3>
            {collegeBarData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={collegeBarData} margin={{ top: 5, right: 10, left: -20, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.93 0.006 240)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "oklch(0.52 0.025 240)" }} angle={-35} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 10, fill: "oklch(0.52 0.025 240)" }} />
                  <Tooltip
                    formatter={(value) => [`${value} 次`, "督导次数"]}
                    labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid oklch(0.90 0.01 240)" }}
                  />
                  <Bar dataKey="count" fill="oklch(0.35 0.13 245)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[260px]" style={{ color: "oklch(0.65 0.02 240)" }}>
                <p className="text-sm">暂无数据</p>
              </div>
            )}
          </div>

          {/* 学院占比饼图 */}
          <div className="bg-white rounded-xl p-5" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: "oklch(0.18 0.025 240)" }}>督导评价学院分布</h3>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2} dataKey="value">
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => [`${value} 次`, "督导次数"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[260px]" style={{ color: "oklch(0.65 0.02 240)" }}>
                <p className="text-sm">暂无数据</p>
              </div>
            )}
          </div>

          {/* 按星期分布 */}
          <div className="bg-white rounded-xl p-5" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: "oklch(0.18 0.025 240)" }}>督导评价星期分布</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weekdayData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.93 0.006 240)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "oklch(0.52 0.025 240)" }} />
                <YAxis tick={{ fontSize: 11, fill: "oklch(0.52 0.025 240)" }} />
                <Tooltip formatter={(value) => [`${value} 次`, "督导次数"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="count" fill="oklch(0.52 0.16 200)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* 各学院平均评分 */}
          <div className="bg-white rounded-xl p-5" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: "oklch(0.18 0.025 240)" }}>各学院平均评分</h3>
            {avgScoreData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={avgScoreData} margin={{ top: 5, right: 10, left: -20, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.93 0.006 240)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "oklch(0.52 0.025 240)" }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis domain={[0, 5]} tick={{ fontSize: 11, fill: "oklch(0.52 0.025 240)" }} />
                  <Tooltip
                    formatter={(value) => [value === null ? "暂无评分" : `${value} 分`, "平均评分"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Bar dataKey="score" fill="oklch(0.62 0.14 160)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[220px]" style={{ color: "oklch(0.65 0.02 240)" }}>
                <p className="text-sm">暂无评分数据</p>
              </div>
            )}
          </div>
        </div>

        {/* 活跃督导专家 */}
        {stats.topSupervisors.length > 0 && (
          <div className="bg-white rounded-xl p-5" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: "oklch(0.18 0.025 240)" }}>最活跃督导专家 Top 10</h3>
            <div className="space-y-2">
              {stats.topSupervisors.map(({ supervisor, count }, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{
                    background: idx < 3 ? "oklch(0.35 0.13 245)" : "oklch(0.93 0.01 240)",
                    color: idx < 3 ? "white" : "oklch(0.52 0.025 240)",
                  }}>
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium" style={{ color: "oklch(0.20 0.025 240)" }}>{supervisor?.name || "未知"}</span>
                      <span className="text-xs font-semibold" style={{ color: "oklch(0.35 0.13 245)" }}>{count} 次</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "oklch(0.93 0.01 240)" }}>
                      <div className="h-full rounded-full transition-all" style={{
                        width: `${(count / (stats.topSupervisors[0]?.count || 1)) * 100}%`,
                        background: "oklch(0.35 0.13 245)",
                      }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 学期配置 */}
        <SemesterSettings />

        {/* 全校各学院评价进度 */}
        <div className="bg-white rounded-xl p-5" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" style={{ color: "oklch(0.35 0.13 245)" }} />
              <h3 className="text-sm font-semibold" style={{ color: "oklch(0.18 0.025 240)" }}>全校各学院课程评价进度</h3>
            </div>
            <button
              onClick={() => navigate("/course-progress")}
              className="flex items-center gap-1 text-xs hover:opacity-70 transition-opacity"
              style={{ color: "oklch(0.35 0.13 245)" }}
            >
              查看详情 <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          {collegeProgressData && collegeProgressData.length > 0 ? (
            <div className="space-y-2.5">
              {collegeProgressData.map((item) => {
                const pct = item.totalCourses > 0 ? Math.round((item.evaluatedCourses / item.totalCourses) * 100) : 0;
                const barColor = pct >= 80 ? "oklch(0.55 0.15 160)" : pct >= 50 ? "oklch(0.55 0.15 245)" : "oklch(0.65 0.15 50)";
                return (
                  <div
                    key={item.college}
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => navigate(`/course-progress?college=${encodeURIComponent(item.college)}`)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium truncate max-w-[180px]" style={{ color: "oklch(0.25 0.025 240)" }}>
                        {item.college}
                      </span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs" style={{ color: "oklch(0.52 0.025 240)" }}>
                          {item.evaluatedCourses}/{item.totalCourses}
                        </span>
                        <span className="text-xs font-bold w-8 text-right" style={{ color: barColor }}>{pct}%</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "oklch(0.93 0.01 240)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, background: barColor }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-32" style={{ color: "oklch(0.65 0.02 240)" }}>
              <p className="text-sm">暂无数据</p>
            </div>
          )}
        </div>

        {/* 最近评价 */}
        {stats.recentEvals.length > 0 && (
          <div className="bg-white rounded-xl p-5" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: "oklch(0.18 0.025 240)" }}>最近督导评价</h3>
            <div className="space-y-2">
              {stats.recentEvals.map((e: any) => (
                <div key={e.id} className="flex items-center justify-between gap-3 p-3 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => navigate(`/evaluations/${e.id}`)}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "oklch(0.20 0.025 240)" }}>{e.course?.courseName || "未知课程"}</p>
                    <p className="text-xs mt-0.5" style={{ color: "oklch(0.52 0.025 240)" }}>
                      {e.course?.teacher} · {e.supervisor?.name} · {e.course?.college?.slice(0, 8)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {e.overallScore && (
                      <span className="text-xs font-medium" style={{ color: "oklch(0.35 0.13 245)" }}>{(e.overallScore || 0).toFixed(1)}/5</span>
                    )}
                    <Eye className="w-4 h-4" style={{ color: "oklch(0.65 0.02 240)" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
