/**
 * 统计仪表盘的三张学院图表。
 *
 * 抽成独立组件不是为了好看：需求 6「三张图学院数量不一致」被退回过两次，
 * 两次都是因为三处渲染代码各自维护截断口径，改一处忘一处。现在三张图都只接受
 * 同一份 rows（由 buildCollegeChartRows 产出），想让它们数量不一致，
 * 得先把调用方改成传三个不同的数组 —— 那是显式的、一眼能看出来的错。
 */
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LabelList } from "recharts";
import { COLLEGE_NAME_AXIS_WIDTH, COLLEGE_NAME_FONT_SIZE, type CollegeChartRow } from "@shared/dashboardCharts";

/**
 * 分类色固定 7 槽，按固定顺序取，绝不取模循环。
 *
 * 旧调色板有 10 槽、用 COLORS[i % len] 循环，跑配色校验有三条 FAIL——
 * 其中 #019f68 与 #00818d 的正常视力 ΔE 只有 12.3（下限 15），
 * 不色盲也分不清那两个扇区。这一组 7 槽全部通过校验。
 */
const SERIES_COLORS = [
  "#2a78d6", // 蓝
  "#eb6834", // 橙
  "#1baf7a", // 青绿
  "#eda100", // 黄
  "#e87ba4", // 品红
  "#008300", // 绿
  "#4a3aa7", // 紫
];
/** 「其他 N 个学院」固定中性灰：它不是一个实体，不该占用一个分类色 */
const OTHERS_COLOR = "oklch(0.72 0.012 240)";
/** 条形图单色：学院是无序分类，一组一色，不做「越大越深」的渐变 */
const COUNT_BAR_COLOR = "#2a78d6";
const SCORE_BAR_COLOR = "#1baf7a";

const AXIS_TICK = { fontSize: COLLEGE_NAME_FONT_SIZE, fill: "oklch(0.52 0.025 240)" } as const;
const GRID_STROKE = "oklch(0.93 0.006 240)";
const TOOLTIP_STYLE = { fontSize: 12, borderRadius: 8, border: "1px solid oklch(0.90 0.01 240)" } as const;
const NAME_AXIS_WIDTH = COLLEGE_NAME_AXIS_WIDTH;
const CHART_HEIGHT = 260;

function Empty({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center" style={{ height: CHART_HEIGHT, color: "oklch(0.65 0.02 240)" }}>
      <p className="text-sm">{text}</p>
    </div>
  );
}

/** 各学院督导评价次数 —— 横向条形图，中文学院名不用旋转也不用截断 */
export function CollegeCountChart({ rows }: { rows: CollegeChartRow[] }) {
  if (rows.length === 0) return <Empty text="暂无数据" />;
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={rows} layout="vertical" margin={{ top: 5, right: 34, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={NAME_AXIS_WIDTH} tick={AXIS_TICK} interval={0} />
        <Tooltip
          formatter={(value, _n, item) => [`${value} 次（占 ${item?.payload?.share}%）`, "督导次数"]}
          contentStyle={TOOLTIP_STYLE}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={14}>
          {/* 「其他」是汇总行，用中性灰，免得它那根最长的柱子看起来像某个学院 */}
          {rows.map((row) => (
            <Cell key={row.name} fill={row.isOthers ? OTHERS_COLOR : COUNT_BAR_COLOR} />
          ))}
          <LabelList dataKey="count" position="right" style={AXIS_TICK} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** 督导评价学院分布 —— 扇区数与另外两张图完全相同，因为用的是同一个 rows */
export function CollegeShareChart({ rows }: { rows: CollegeChartRow[] }) {
  if (rows.length === 0) return <Empty text="暂无数据" />;
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <PieChart>
        <Pie data={rows} cx="50%" cy="50%" innerRadius={52} outerRadius={84} paddingAngle={2} dataKey="count" nameKey="name">
          {rows.map((row, i) => (
            <Cell
              key={row.name}
              fill={row.isOthers ? OTHERS_COLOR : SERIES_COLORS[i % SERIES_COLORS.length]}
              stroke="#ffffff"
              strokeWidth={2}
            />
          ))}
        </Pie>
        <Tooltip
          formatter={(value, _n, item) => [`${value} 次（占 ${item?.payload?.share}%）`, "督导次数"]}
          contentStyle={TOOLTIP_STYLE}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** 各学院平均评分 —— 没打过总分的学院柱子为空，但仍占一行，不会凭空少一个学院 */
export function CollegeScoreChart({ rows }: { rows: CollegeChartRow[] }) {
  if (rows.length === 0) return <Empty text="暂无评分数据" />;
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={rows} layout="vertical" margin={{ top: 5, right: 46, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
        <XAxis type="number" domain={[0, 5]} tick={AXIS_TICK} />
        <YAxis type="category" dataKey="name" width={NAME_AXIS_WIDTH} tick={AXIS_TICK} interval={0} />
        <Tooltip
          formatter={(value, _n, item) =>
            item?.payload?.score === null || item?.payload?.score === undefined
              ? ["暂无评分", "平均评分"]
              : [`${value} 分（${item?.payload?.scoredCount} 条已打分）`, "平均评分"]
          }
          contentStyle={TOOLTIP_STYLE}
        />
        <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={14}>
          {rows.map((row) => (
            <Cell key={row.name} fill={row.isOthers ? OTHERS_COLOR : SCORE_BAR_COLOR} />
          ))}
          {/*
            LabelList 的 formatter 碰到 null 根本不会被调用，所以「暂无评分」的学院
            此前是一根空柱子配一个空标签，看上去像渲染坏了。改用 content 自己画，
            拿得到整行数据，就能在柱子长度为 0 时也写出「暂无评分」。
          */}
          <LabelList
            content={(props: any) => {
              const { x, y, width, height, index } = props;
              const row = rows[index];
              if (!row) return null;
              const text = row.score === null ? "暂无评分" : row.score.toFixed(2);
              return (
                <text
                  x={Number(x) + Number(width || 0) + 6}
                  y={Number(y) + Number(height || 0) / 2}
                  dominantBaseline="middle"
                  style={{ ...AXIS_TICK, fill: row.score === null ? "oklch(0.65 0.02 240)" : AXIS_TICK.fill }}
                >
                  {text}
                </text>
              );
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
