import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Drafts from './pages/Drafts';
import AuditLog from './pages/AuditLog';
import Settings from './pages/Settings';
import DataSources from './pages/DataSources';
import Documents from './pages/Documents';
import Chat from './pages/Chat';
import ChatRealtime from './pages/ChatRealtime';

import Emails from './pages/Emails';

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/chat/realtime" element={<ChatRealtime />} />
          <Route path="/voice" element={<ChatRealtime />} />
          <Route path="/chat" element={<Chat />} />

          <Route path="/emails" element={<Emails />} />
          <Route path="/drafts" element={<Drafts />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/sources" element={<DataSources />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
