import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Drafts from './pages/Drafts';
import AuditLog from './pages/AuditLog';
import Settings from './pages/Settings';
import DataSources from './pages/DataSources';
import Chat from './pages/Chat';

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/drafts" element={<Drafts />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/sources" element={<DataSources />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
