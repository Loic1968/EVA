import { useEffect, useState, useRef } from 'react';
import { api } from '../api';

const INDEXABLE_TYPES = ['pdf', 'txt', 'csv', 'docx', 'doc', 'jpg', 'jpeg', 'png', 'webp'];

function ContentModal({ doc, onClose }) {
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api.getDocumentContent(doc.id)
      .then((r) => setContent(r.content_text || ''))
      .catch((e) => setErr(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [doc.id]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700/40 flex items-center justify-between">
          <h3 className="font-medium text-slate-900 dark:text-white truncate">Indexed: {doc.filename}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 dark:hover:text-white p-1">✕</button>
        </div>
        <div className="p-5 overflow-auto flex-1">
          {loading && <p className="text-slate-500 dark:text-eva-muted">Loading…</p>}
          {err && <p className="text-red-400">{err}</p>}
          {content && (
            <pre className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-sans break-words">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Documents() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [crawling, setCrawling] = useState(false);
  const [crawlUrl, setCrawlUrl] = useState('');
  const [processingId, setProcessingId] = useState(null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [contentModalDoc, setContentModalDoc] = useState(null);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);

  const handleProcess = async (doc) => {
    setProcessingId(doc.id);
    setError(null);
    try {
      await api.processDocument(doc.id);
      await load();
    } catch (e) {
      const msg = e?.body?.error || e?.message || 'Index failed';
      setError(msg);
    } finally {
      setProcessingId(null);
    }
  };

  const load = () =>
    api.getDocuments({ limit: 100 })
      .then((r) => setDocuments(r.documents || []))
      .catch((e) => setError(e.message));

  const autoIndexRun = useRef(false);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  // Auto-index documents that are still 'uploaded' (PDF, TXT, images) on first load
  useEffect(() => {
    if (documents.length === 0 || autoIndexRun.current) return;
    const toProcess = documents.filter(
      (d) => (d.status === 'uploaded' || d.status === 'error') && INDEXABLE_TYPES.includes((d.file_type || '').toLowerCase())
    );
    if (toProcess.length === 0) return;
    autoIndexRun.current = true;
    toProcess.forEach((d) => {
      api.processDocument(d.id).then(() => load()).catch(() => {});
    });
  }, [documents]);

  const handleUpload = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        await api.uploadDocument(file);
      }
      await load();
    } catch (e) {
      setError(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const onDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };

  const onDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (files?.length) handleUpload(files);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex gap-1">
          <div className="w-2 h-2 rounded-full bg-eva-accent eva-dot" />
          <div className="w-2 h-2 rounded-full bg-eva-accent eva-dot" />
          <div className="w-2 h-2 rounded-full bg-eva-accent eva-dot" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white">Documents</h1>
          <p className="text-slate-600 dark:text-eva-muted text-sm mt-1">Upload files for EVA&apos;s Memory Vault. Contracts, emails, reports — everything feeds the brain.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => cameraRef.current?.click()}
            disabled={uploading}
            className="flex-1 sm:flex-none min-h-[44px] sm:min-h-0 px-4 py-3 sm:py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium rounded-xl hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 transition-all flex items-center justify-center gap-2 touch-manipulation"
            title="Take a photo (camera on mobile)"
          >
            <span className="text-xl">📷</span>
            <span>{uploading ? '…' : 'Take Photo'}</span>
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex-1 sm:flex-none min-h-[44px] sm:min-h-0 px-4 py-3 sm:py-2.5 bg-slate-600 hover:bg-slate-500 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-medium rounded-xl disabled:opacity-50 transition-all flex items-center justify-center gap-2 touch-manipulation"
          >
            <span className="sm:hidden">📁</span>
            <span>{uploading ? '…' : 'Upload'}</span>
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.csv,application/pdf,text/*"
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
      </div>

      {error && <div className="text-red-600 dark:text-red-400 text-sm bg-red-500/10 rounded-lg px-4 py-2">{error}</div>}

      {/* Drop zone / tap hint */}
      <div
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-xl p-6 sm:p-8 text-center transition-colors min-h-[100px] flex items-center justify-center ${
          dragOver ? 'border-cyan-500 dark:border-eva-accent bg-cyan-50 dark:bg-eva-accent/5' : 'border-slate-300 dark:border-slate-700/40 hover:border-slate-400 dark:hover:border-slate-600 active:border-slate-400 dark:active:border-slate-600'
        }`}
      >
        <div className="text-slate-600 dark:text-eva-muted pointer-events-none">
          <p className="text-base sm:text-lg mb-1">
            {dragOver ? 'Drop files here' : (
              <>
                <span className="sm:hidden">Tap Take Photo or Upload above</span>
                <span className="hidden sm:inline">Drag & drop files here</span>
              </>
            )}
          </p>
          <p className="text-xs">PDF, DOCX, TXT, CSV, photos — up to 50MB</p>
        </div>
      </div>

      {/* File list */}
      <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700/40">
          <span className="text-sm font-medium text-slate-900 dark:text-white">{documents.length} documents</span>
        </div>
        {documents.length === 0 ? (
          <div className="p-8 text-center text-slate-500 dark:text-eva-muted text-sm">
            No documents uploaded yet. Start feeding EVA's memory.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-700/30">
            {documents.map((doc) => (
              <div key={doc.id} className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                    doc.file_type === 'pdf' ? 'bg-red-500/20 text-red-600 dark:text-red-400' :
                    doc.file_type === 'docx' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' :
                    doc.file_type === 'csv' ? 'bg-green-500/20 text-green-600 dark:text-green-400' :
                    ['jpg', 'jpeg', 'png', 'webp'].includes((doc.file_type || '').toLowerCase()) ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' :
                    'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                  }`}>
                    {(doc.file_type || '?').toUpperCase().slice(0, 3)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm text-slate-900 dark:text-white truncate">{doc.filename}</div>
                    <div className="text-xs text-slate-500 dark:text-eva-muted">{formatBytes(doc.file_size)} — {new Date(doc.created_at).toLocaleDateString()}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                  <span className={`text-xs px-2.5 py-1.5 rounded-full ${
                    doc.status === 'indexed' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' :
                    doc.status === 'processing' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' :
                    doc.status === 'error' ? 'bg-red-500/20 text-red-600 dark:text-red-400' :
                    'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                  }`} title={doc.status === 'error' && doc.metadata?.error ? doc.metadata.error : (doc.processed_at ? `Indexed ${new Date(doc.processed_at).toLocaleString()}` : doc.status)}>
                    {doc.status === 'indexed' ? 'Indexed' : doc.status === 'uploaded' ? 'Not indexed' : doc.status === 'processing' ? 'Indexing…' : 'Index failed'}
                  </span>
                  {doc.status === 'indexed' && (
                    <button
                      onClick={() => setContentModalDoc(doc)}
                      className="text-xs px-3 py-2 sm:py-1 rounded-lg bg-slate-200 dark:bg-slate-600/30 text-slate-600 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 hover:bg-cyan-500/20 transition-colors touch-manipulation"
                      title="View extracted text"
                    >
                      View index
                    </button>
                  )}
                  {(doc.status === 'uploaded' || doc.status === 'error') && INDEXABLE_TYPES.includes((doc.file_type || '').toLowerCase()) && (
                    <button
                      onClick={() => handleProcess(doc)}
                      disabled={processingId !== null}
                      className="text-xs px-4 py-2.5 min-h-[44px] sm:min-h-0 sm:py-1 rounded-lg bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/30 active:bg-cyan-500/40 disabled:opacity-50 touch-manipulation"
                      title="Extract text so EVA can search it"
                    >
                      {processingId === doc.id ? '…' : 'Index'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {contentModalDoc && (
        <ContentModal doc={contentModalDoc} onClose={() => setContentModalDoc(null)} />
      )}
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
