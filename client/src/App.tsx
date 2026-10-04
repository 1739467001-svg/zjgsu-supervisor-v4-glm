import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import CourseList from "./pages/CourseList";
import MyPlans from "./pages/MyPlans";
import EvaluationForm from "./pages/EvaluationForm";
import EvaluationList from "./pages/EvaluationList";
import EvaluationDetail from "./pages/EvaluationDetail";
import AdminDashboard from "./pages/AdminDashboard";
import CollegeWorkbench from "./pages/CollegeWorkbench";
import UserManagement from "./pages/UserManagement";
import Notifications from "./pages/Notifications";
import CourseProgress from "./pages/CourseProgress";
import UploadCourses from "./pages/UploadCourses";
import { useAuth } from "./_core/hooks/useAuth";
import { SemesterSelectionProvider } from "./contexts/SemesterSelection";
import { ActiveRoleProvider } from "./hooks/useActiveRole";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <p className="text-muted-foreground text-sm">加载中...</p>
    </div>
  </div>;
  if (!user) {
    window.location.href = "/login";
    return null;
  }
  return <SemesterSelectionProvider><ActiveRoleProvider><Component /></ActiveRoleProvider></SemesterSelectionProvider>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/courses" component={() => <ProtectedRoute component={CourseList} />} />
      <Route path="/plans" component={() => <ProtectedRoute component={MyPlans} />} />
      <Route path="/evaluations" component={() => <ProtectedRoute component={EvaluationList} />} />
      <Route path="/evaluations/new/:courseId" component={() => <ProtectedRoute component={EvaluationForm} />} />
      <Route path="/evaluations/:id" component={() => <ProtectedRoute component={EvaluationDetail} />} />
      <Route path="/evaluations/:id/edit" component={() => <ProtectedRoute component={EvaluationForm} />} />
      <Route path="/admin" component={() => <ProtectedRoute component={AdminDashboard} />} />
      <Route path="/college" component={() => <ProtectedRoute component={CollegeWorkbench} />} />
      <Route path="/users" component={() => <ProtectedRoute component={UserManagement} />} />
      <Route path="/notifications" component={() => <ProtectedRoute component={Notifications} />} />
      <Route path="/course-progress" component={() => <ProtectedRoute component={CourseProgress} />} />
      <Route path="/upload-courses" component={() => <ProtectedRoute component={UploadCourses} />} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster position="top-right" />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
