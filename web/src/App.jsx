import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import EvaLoading from './components/EvaLoading';
import Dashboard from './pages/Dashboard';
import Drafts from './pages/Drafts';
import AuditLog from './pages/AuditLog';
import Settings from './pages/Settings';
import DataSources from './pages/DataSources';
import Documents from './pages/Documents';
import Chat from './pages/Chat';
import ChatRealtime from './pages/ChatRealtime';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Emails from './pages/Emails';
import Calendar from './pages/Calendar';
import About from './pages/About';
import { useAuth } from './context/AuthContext';

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-eva-dark">
      <EvaLoading />
    </div>
  );
}

function AppRoutes() {
  const { user, loading, requireAuth, isAuthenticated } = useAuth();
  if (loading) return <LoadingScreen />;
  if (requireAuth && !isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/voice" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/chat/realtime" element={<ChatRealtime />} />
        <Route path="/voice" element={<ChatRealtime />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/emails" element={<Emails />} />
        <Route path="/drafts" element={<Drafts />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/audit" element={<AuditLog />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/sources" element={<DataSources />} />
        <Route path="/about" element={<About />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return <AppRoutes />;
}
