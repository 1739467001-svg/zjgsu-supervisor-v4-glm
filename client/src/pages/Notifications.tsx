import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Bell, CheckCheck, Eye, ShieldAlert } from "lucide-react";
import { formatDateBJ } from "@shared/dateUtils";
import { useLocation } from "wouter";

export default function Notifications() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data: notifications, isLoading } = trpc.notifications.list.useQuery();

  const markReadMutation = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  const markAllReadMutation = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      toast.success("全部已读");
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  const unread = notifications?.filter((n) => !n.isRead) || [];

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-5 page-transition max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold" style={{ color: "oklch(0.18 0.025 240)" }}>通知消息</h1>
            <p className="text-sm mt-0.5" style={{ color: "oklch(0.52 0.025 240)" }}>
              {unread.length > 0 ? `${unread.length} 条未读消息` : "暂无未读消息"}
            </p>
          </div>
          {unread.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => markAllReadMutation.mutate()} disabled={markAllReadMutation.isPending}>
              <CheckCheck className="w-4 h-4 mr-1.5" />全部已读
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !notifications || notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white rounded-xl" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
            <Bell className="w-12 h-12" style={{ color: "oklch(0.75 0.02 240)" }} />
            <p className="text-sm" style={{ color: "oklch(0.52 0.025 240)" }}>暂无通知消息</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <div
                key={n.id}
                className="bg-white rounded-xl p-4 cursor-pointer transition-all duration-200 hover:shadow-sm"
                style={{
                  border: `1px solid ${n.isRead ? "oklch(0.90 0.01 240)" : "oklch(0.75 0.10 245)"}`,
                  background: n.isRead ? "white" : "oklch(0.97 0.008 245)",
                }}
                onClick={() => {
                  if (!n.isRead) markReadMutation.mutate(n.id);
                  if (n.evaluationId) navigate(`/evaluations/${n.evaluationId}`);
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{
                    background: n.isRead ? "oklch(0.93 0.01 240)" : n.type === "password_reminder" ? "oklch(0.95 0.04 30)" : "oklch(0.93 0.018 245)",
                    color: n.isRead ? "oklch(0.52 0.025 240)" : n.type === "password_reminder" ? "oklch(0.50 0.16 30)" : "oklch(0.35 0.13 245)",
                  }}>
                    {n.type === "password_reminder" ? <ShieldAlert className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium" style={{ color: "oklch(0.18 0.025 240)" }}>{n.title}</p>
                      {!n.isRead && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: n.type === "password_reminder" ? "#e65100" : "#3b82f6" }} />}
                    </div>
                    <p className="text-xs mt-1 leading-relaxed" style={{ color: "oklch(0.52 0.025 240)" }}>{n.content}</p>
                    <p className="text-xs mt-2" style={{ color: "oklch(0.65 0.02 240)" }}>
                      {formatDateBJ(n.createdAt)}
                    </p>
                  </div>
                  {n.evaluationId && <Eye className="w-4 h-4 flex-shrink-0 mt-1" style={{ color: "oklch(0.65 0.02 240)" }} />}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
