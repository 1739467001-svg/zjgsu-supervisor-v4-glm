import { useState, useRef } from "react";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import DashboardLayout from "@/components/DashboardLayout";
import { useSemesterSelection } from "@/contexts/SemesterSelection";
import { trpc } from "@/lib/trpc";

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
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    const ext = f.name.toLowerCase();
    if (!ext.endsWith(".xls") && !ext.endsWith(".xlsx")) {
      setResult({ success: false, message: "只支持 .xls 或 .xlsx 格式的文件" });
      return;
    }
    setFile(f);
    setResult(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleUpload = async () => {
    if (!file || isHistorical) return;
    setUploading(true);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("semesterId", String(semesterId));

    try {
      const res = await fetch("/api/upload-courses", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data: UploadResult = await res.json();
      setResult(data);
      if (data.success) {
        utils.invalidate();
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
      }
    } catch {
      setResult({ success: false, message: "网络错误，请检查连接后重试" });
    } finally {
      setUploading(false);
    }
  };

  if (isHistorical) return <DashboardLayout><p className="p-6">历史学期档案只读，不允许上传覆盖。请切换至当前学期。</p></DashboardLayout>;
  return (<DashboardLayout>
    <div className="max-w-2xl mx-auto py-8 px-4">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">上传课程数据</h1>
        <p className="text-sm text-gray-500 mt-1">
          上传当前学期课表，仅更新当前学期，历史档案保持不变
        </p>
      </div>

      {/* 说明卡片 */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 flex gap-3">
        <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-700 space-y-1">
          <p className="font-medium">操作说明</p>
          <p>• 支持格式：<strong>.xls</strong> 或 <strong>.xlsx</strong>（研究生排课信息表）</p>
          <p>• 按当前学期新增或更新课程；未出现在文件中的课程及历史评价仍保留，不清空。</p>
          <p>• 系统所有相关显示（课程列表、统计数字、评价进度等）将自动同步</p>
          <p>• 文件大小限制：20MB</p>
        </div>
      </div>

      {/* 上传区域 */}
      <div
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer ${
          dragging
            ? "border-blue-400 bg-blue-50"
            : file
            ? "border-green-400 bg-green-50"
            : "border-gray-300 bg-gray-50 hover:border-blue-300 hover:bg-blue-50"
        }`}
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
              <p className="text-sm text-gray-400 mt-1">支持 .xls / .xlsx 格式</p>
            </div>
          </div>
        )}
      </div>

      {/* 上传按钮 */}
      <div className="mt-6">
        <Button
          className="w-full h-12 text-base font-medium"
          disabled={!file || uploading}
          onClick={handleUpload}
          style={{ background: file && !uploading ? "oklch(0.35 0.13 245)" : undefined }}
        >
          {uploading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              正在解析并导入数据，请稍候...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              确认上传并更新课程数据
            </span>
          )}
        </Button>
      </div>

      {/* 结果提示 */}
      {result && (
        <div
          className={`mt-6 rounded-xl p-5 border ${
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
                <p className="text-sm text-green-600 mt-3">
                  系统所有课程相关数据已同步更新，刷新页面即可查看最新内容。
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  </DashboardLayout>);
}
