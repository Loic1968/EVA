import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Drafts from './pages/Drafts';
import AuditLog from './pages/AuditLog';
import Settings from './pages/Settings';
import DataSources from './pages/DataSources';
import Documents from './pages/Documents';
import Chat from './pages/Chat';
import Emails from './pages/Emails';

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
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
