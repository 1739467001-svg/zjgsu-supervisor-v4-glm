import { useState, useRef } from "react";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, Info, GraduationCap, Briefcase, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import DashboardLayout from "@/components/DashboardLayout";
import { useSemesterSelection } from "@/contexts/SemesterSelection";
import { trpc } from "@/lib/trpc";

type Entry = "standard" | "mba";

const ENTRY_CONFIG: Record<Entry, { title: string; desc: string; icon: React.ReactNode; hint: string }> = {
  standard: {
    title: "全校研究生总课表",
    desc: "研究生排课信息表（不含 MBA）",
    icon: <GraduationCap className="w-5 h-5" />,
    hint: "识别表头：开课院系 / 课程名称 / 主讲教师 / 自定义周次",
  },
  mba: {
    title: "MBA 课表",
    desc: "MBA / MPM 教育中心课表",
    icon: <Briefcase className="w-5 h-5" />,
    hint: "识别表头：班级 / 课程名称 / 授课教师 / 日期 / 上课时间",
  },
};

interface PreviewInfo {
  format: Entry;
  formatLabel: string;
  sourceRows: number;
  courseCount: number;
  inserted: number;
  updated: number;
  preserved: number;
  warnings: string[];
  collegeDist: Array<{ college: string; count: number }>;
  semesterLabel: string;
}

interface UploadStats {
  total: number;
  teachers: number;
  colleges: number;
}

interface UploadResult {
  success: boolean;
  message: string;
  stats?: UploadStats;
}

export default function UploadCourses() {
  const { semesterId, isHistorical } = useSemesterSelection();
  const utils = trpc.useUtils();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<"select" | "previewed" | "done">("select");
  const [busy, setBusy] = useState<"" | "preview" | "confirm">("");
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    const ext = f.name.toLowerCase();
    if (!ext.endsWith(".xls") && !ext.endsWith(".xlsx")) {
      setResult({ success: false, message: "只支持 .xls 或 .xlsx 格式的文件" });
      return;
    }
    setFile(f);
    setPreview(null);
    setPhase("select");
    setResult(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const resetAll = () => {
    setFile(null);
    setPreview(null);
    setPhase("select");
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  /** 统一上传入口：mode=preview 只解析比对，mode=confirm 才写入 */
  const postUpload = async (mode: "preview" | "confirm") => {
    const formData = new FormData();
    formData.append("file", file!);
    formData.append("semesterId", String(semesterId));
    formData.append("entry", entry!);
    formData.append("mode", mode);
    const res = await fetch("/api/upload-courses", {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    return res.json();
  };

  const handlePreview = async () => {
    if (!file || !entry) return;
    setBusy("preview");
    setResult(null);
    try {
      const data = await postUpload("preview");
      if (data.success && data.preview) {
        setPreview(data.preview);
        setPhase("previewed");
      } else {
        setResult({ success: false, message: data.message || "解析失败" });
      }
    } catch {
      setResult({ success: false, message: "网络错误，请检查连接后重试" });
    } finally {
      setBusy("");
    }
  };

  const handleConfirm = async () => {
    if (!file || !entry) return;
    setBusy("confirm");
    try {
      const data: UploadResult = await postUpload("confirm");
      setResult(data);
      if (data.success) {
        utils.invalidate();
        setPhase("done");
      }
    } catch {
      setResult({ success: false, message: "网络错误，请检查连接后重试" });
    } finally {
      setBusy("");
    }
  };

  if (isHistorical) return <DashboardLayout><p className="p-6">历史学期档案只读，不允许上传覆盖。请切换至当前学期。</p></DashboardLayout>;
  return (<DashboardLayout>
    <div className="max-w-2xl mx-auto py-8 px-4">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">上传课程数据</h1>
        <p className="text-sm text-gray-500 mt-1">
          两个独立导入入口 · 解析预览确认后导入 · 仅更新当前学期，历史档案保持不变
        </p>
      </div>

      {/* 第一步：选择导入入口 */}
      <div className="mb-4 flex items-center gap-2">
        <span className="w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center" style={{ background: "oklch(0.35 0.13 245)" }}>1</span>
        <h2 className="text-base font-semibold text-gray-900">选择导入入口</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        {(Object.keys(ENTRY_CONFIG) as Entry[]).map((key) => {
          const cfg = ENTRY_CONFIG[key];
          const active = entry === key;
          return (
            <button
              key={key}
              onClick={() => { setEntry(key); setPreview(null); setPhase("select"); setResult(null); }}
              className={`text-left rounded-xl p-4 border-2 transition-all ${
                active ? "border-blue-500 bg-blue-50 shadow-sm" : "border-gray-200 bg-white hover:border-blue-300"
              }`}
            >
              <div className="flex items-center gap-2 mb-1" style={{ color: active ? "oklch(0.35 0.13 245)" : "oklch(0.45 0.02 240)" }}>
                {cfg.icon}
                <span className="font-semibold">{cfg.title}</span>
                {active && <CheckCircle2 className="w-4 h-4 ml-auto text-blue-500" />}
              </div>
              <p className="text-xs text-gray-500">{cfg.desc}</p>
              <p className="text-xs text-gray-400 mt-1.5">{cfg.hint}</p>
            </button>
          );
        })}
      </div>

      {/* 第二步：选择文件 */}
      <div className="mb-4 flex items-center gap-2">
        <span className="w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center" style={{ background: entry ? "oklch(0.35 0.13 245)" : "oklch(0.65 0.02 240)" }}>2</span>
        <h2 className="text-base font-semibold text-gray-900">选择课表文件</h2>
      </div>
      <div
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer ${
          dragging
            ? "border-blue-400 bg-blue-50"
            : file
            ? "border-green-400 bg-green-50"
            : "border-gray-300 bg-gray-50 hover:border-blue-300 hover:bg-blue-50"
        } ${!entry ? "opacity-50 pointer-events-none" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xls,.xlsx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />

        {file ? (
          <div className="flex flex-col items-center gap-3">
            <FileSpreadsheet className="w-12 h-12 text-green-500" />
            <div>
              <p className="font-medium text-green-700">{file.name}</p>
              <p className="text-sm text-green-600 mt-1">
                {(file.size / 1024).toFixed(1)} KB · 点击可重新选择
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Upload className="w-12 h-12 text-gray-400" />
            <div>
              <p className="font-medium text-gray-600">拖拽文件到此处，或点击选择文件</p>
              <p className="text-sm text-gray-400 mt-1">支持 .xls / .xlsx 格式，20MB 以内</p>
            </div>
          </div>
        )}
      </div>

      {/* 第三步：解析预览 */}
      <div className="mt-6">
        <Button
          className="w-full h-12 text-base font-medium"
          disabled={!file || !entry || busy !== ""}
          onClick={handlePreview}
          style={{ background: file && entry && !busy ? "oklch(0.35 0.13 245)" : undefined }}
        >
          {busy === "preview" ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              正在解析文件，请稍候...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Eye className="w-5 h-5" />
              解析预览（不写入数据）
            </span>
          )}
        </Button>
      </div>

      {/* 解析预览结果 */}
      {preview && phase !== "done" && (
        <div className="mt-5 rounded-xl p-5 border border-blue-200 bg-blue-50">
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-5 h-5 text-blue-500" />
            <p className="font-medium text-blue-700">
              解析结果：识别为「{preview.formatLabel}」 · 目标学期 {preview.semesterLabel}
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            {[
              { label: "原始数据行", value: preview.sourceRows },
              { label: "合并后课程", value: preview.courseCount },
              { label: "预计新增", value: preview.inserted },
              { label: "预计更新", value: preview.updated },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white rounded-lg p-3 text-center border border-blue-100">
                <div className="text-xl font-bold text-blue-600">{value}</div>
                <div className="text-xs text-gray-500 mt-1">{label}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-blue-700">
            当前学期已有 {preview.preserved} 门课不在本文件中，将原样保留（不删除）；导入前已自动备份，确认前不会写入任何数据。
          </p>
          {preview.collegeDist.length > 0 && (
            <p className="text-xs text-blue-600 mt-1.5">
              学院分布（前 {preview.collegeDist.length} 项）：{preview.collegeDist.map(c => `${c.college} ${c.count} 门`).join("、")}
            </p>
          )}
          {preview.warnings.length > 0 && (
            <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              {preview.warnings.map((w, i) => <p key={i}>· {w}</p>)}
            </div>
          )}
          <Button
            className="w-full h-11 mt-4 text-base font-medium"
            disabled={busy !== ""}
            onClick={handleConfirm}
            style={{ background: "oklch(0.35 0.13 245)" }}
          >
            {busy === "confirm" ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                正在导入，请稍候...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" />
                确认导入以上数据
              </span>
            )}
          </Button>
        </div>
      )}

      {/* 结果提示 */}
      {result && (
        <div
          className={`mt-5 rounded-xl p-5 border ${
            result.success
              ? "bg-green-50 border-green-200"
              : "bg-red-50 border-red-200"
          }`}
        >
          <div className="flex items-start gap-3">
            {result.success ? (
              <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p className={`font-medium ${result.success ? "text-green-700" : "text-red-700"}`}>
                {result.message}
              </p>
              {result.success && result.stats && (
                <div className="mt-3 grid grid-cols-3 gap-3">
                  {[
                    { label: "课程总数", value: result.stats.total },
                    { label: "覆盖学院", value: result.stats.colleges },
                    { label: "授课教师", value: result.stats.teachers },
                  ].map(({ label, value }) => (
                    <div
                      key={label}
                      className="bg-white rounded-lg p-3 text-center border border-green-100"
                    >
                      <div className="text-2xl font-bold text-green-600">{value}</div>
                      <div className="text-xs text-gray-500 mt-1">{label}</div>
                    </div>
                  ))}
                </div>
              )}
              {result.success && (
                <div className="flex items-center gap-3 mt-3">
                  <p className="text-sm text-green-600">系统所有课程相关数据已同步更新。</p>
                  <button className="text-sm text-blue-600 underline" onClick={resetAll}>继续上传另一份课表</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  </DashboardLayout>);
}
