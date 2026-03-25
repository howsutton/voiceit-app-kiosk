import React, { useState, useEffect } from 'react';
import { RefreshCw, AlertTriangle, Volume2, MessageSquare, BookOpen, FileText, ExternalLink, Download } from 'lucide-react';
import { API_BASE } from '../constants';

interface SummaryPageProps {
  sessionId: string;
}

export const SummaryPage = ({ sessionId }: SummaryPageProps) => {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log("SummaryPage: Fetching summary for session:", sessionId, "using API_BASE:", API_BASE || "(relative)");
    const fetchSummary = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/summary`);
        if (!res.ok) {
          throw new Error("Session not found or expired.");
        }
        const data = await res.json();
        setSummary(data);
      } catch (err: any) {
        console.error("Failed to fetch summary:", err);
        setError(err.message || "An unexpected error occurred.");
      } finally {
        setLoading(false);
      }
    };

    if (sessionId) {
      fetchSummary();
    } else {
      setLoading(false);
    }
  }, [sessionId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bloom bg-dots">
        <div className="flex flex-col items-center gap-6">
          <div className="relative">
            <div className="w-16 h-16 bg-app-accent/20 rounded-full blur-2xl absolute inset-0 animate-pulse" />
            <RefreshCw className="w-10 h-10 text-app-accent animate-spin relative z-10" />
          </div>
          <p className="text-slate-400 font-bold uppercase tracking-[0.3em] text-xs">Decrypting Summary...</p>
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bloom bg-dots p-6">
        <div className="text-center p-10 bg-surface-low border border-white/10 rounded-[40px] max-w-md shadow-2xl">
          <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-3 tracking-tight">Session Expired</h1>
          <p className="text-slate-300 leading-relaxed mb-8">{error || "The session summary you are looking for is no longer available or the link is invalid."}</p>
          <div className="pt-8 border-t border-white/5">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-indigo-400 mb-4">Support Protocol</p>
            <div className="space-y-2">
              <p className="text-white font-medium text-sm">support@voiceit.ai</p>
              <p className="text-slate-500 text-xs flex items-center gap-2">
                <img src="https://caribdesigns.com/voiceit-logo.png" alt="VoiceIt" className="h-9 w-auto" referrerPolicy="no-referrer" />
                Enterprise Support
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bloom bg-dots p-6 md:p-12 font-sans text-white overflow-y-auto">
      <div className="max-w-3xl mx-auto">
        <header className="mb-16 flex justify-between items-end">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-app-accent">Verified Session</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tighter mb-2">Session Summary</h1>
            <p className="text-app-muted font-medium flex items-center gap-2">
              <img src="https://caribdesigns.com/voiceit-logo.png" alt="VoiceIt" className="h-12 w-auto" referrerPolicy="no-referrer" />
              Assistant • {new Date(summary.timestamp).toLocaleDateString(undefined, { dateStyle: 'long' })}
            </p>
          </div>
          <div className="w-14 h-14 glass-panel rounded-2xl flex items-center justify-center text-app-accent shadow-[0_0_30px_rgba(59,130,246,0.2)]">
            <Volume2 className="w-7 h-7" />
          </div>
        </header>

        <section className="space-y-12 mb-20">
          <div className="flex items-center gap-4 mb-8">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-white/10" />
            <h2 className="text-xs font-bold text-app-accent uppercase tracking-[0.4em] whitespace-nowrap">
              Interaction Log
            </h2>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-white/10" />
          </div>

          {summary.qa && summary.qa.length > 0 ? (
            summary.qa.map((item: any, i: number) => (
              <div key={i} className="glass-panel p-8 md:p-10 rounded-[40px] relative overflow-hidden group hover:border-app-accent/30 transition-all duration-500">
                <div className="absolute -top-24 -right-24 w-48 h-48 bg-app-accent/5 rounded-full blur-3xl group-hover:bg-app-accent/10 transition-all" />
                
                <div className="mb-10 relative z-10">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                      <MessageSquare className="w-4 h-4 text-app-muted" />
                    </div>
                    <p className="text-app-muted font-bold text-[10px] uppercase tracking-[0.3em]">User Query</p>
                  </div>
                  <p className="text-white font-bold text-2xl md:text-3xl leading-tight tracking-tight">{item.q}</p>
                </div>

                <div className="relative z-10 pl-6 border-l-2 border-app-accent bg-app-accent/5 p-6 md:p-8 rounded-r-[32px]">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-app-accent/20 flex items-center justify-center">
                      <Volume2 className="w-4 h-4 text-app-accent" />
                    </div>
                    <p className="text-app-accent font-bold text-[10px] uppercase tracking-[0.3em] flex items-center gap-2">
                      <img src="https://caribdesigns.com/voiceit-logo.png" alt="VoiceIt" className="h-9 w-auto" referrerPolicy="no-referrer" />
                      Response
                    </p>
                  </div>
                  <p className="text-white/90 leading-relaxed text-lg md:text-xl font-medium">{item.a}</p>
                  
                  {item.sources && item.sources.length > 0 && (
                    <div className="mt-8 pt-8 border-t border-white/5 space-y-4">
                      <p className="text-[10px] font-bold text-app-muted uppercase tracking-[0.3em]">Knowledge Sources</p>
                      <div className="flex flex-wrap gap-3">
                        {item.sources.map((src: any, si: number) => (
                          <div key={si} className="group/source relative">
                            <div className="text-[10px] glass-panel px-4 py-2 rounded-xl text-white/70 flex items-center gap-2 hover:bg-white/10 transition-all cursor-default">
                              <BookOpen className="w-3.5 h-3.5 text-app-accent" />
                              <span className="font-bold">{src.documentTitle}</span>
                              <span className="opacity-30">•</span>
                              <span className="text-app-accent">Page {src.pageNumber}</span>
                            </div>
                            {src.excerpt && (
                              <div className="mt-3 p-5 bg-white/5 border-l-2 border-app-accent/30 rounded-r-2xl text-sm text-white/60 italic leading-relaxed">
                                <p className="font-bold text-[9px] uppercase tracking-[0.2em] text-app-accent mb-2 not-italic">Verified Excerpt</p>
                                "{src.excerpt}"
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-20 glass-panel rounded-[40px] border-dashed">
              <p className="text-app-muted font-medium italic">No interaction data found for this session.</p>
            </div>
          )}
        </section>

        <section className="space-y-6 mb-20">
          <div className="flex items-center gap-4 mb-8">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-white/10" />
            <h2 className="text-xs font-bold text-app-accent uppercase tracking-[0.4em] whitespace-nowrap">
              Reference Library
            </h2>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-white/10" />
          </div>

          {summary.sources && summary.sources.length > 0 ? (
            <div className="grid grid-cols-1 gap-4">
              {Array.from(new Map(summary.sources.map((item: any) => [item.id || item.file_url || item.title, item])).values()).map((doc: any, i: number) => (
                <div key={i} className="glass-panel p-6 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-6 group hover:border-app-accent/30 transition-all duration-300">
                  <div className="flex items-center gap-5">
                    <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center text-app-muted group-hover:bg-app-accent/10 group-hover:text-app-accent transition-all">
                      <FileText className="w-7 h-7" />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-lg leading-tight mb-1">{doc.title}</h3>
                      <p className="text-[10px] text-app-muted uppercase tracking-widest font-bold">{doc.page_count} pages • {doc.mime_type || 'PDF Document'}</p>
                    </div>
                  </div>
                  {doc.file_url ? (
                    <div className="flex items-center gap-3">
                      <a 
                        href={doc.file_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-xs font-bold text-white transition-all"
                      >
                        <ExternalLink className="w-4 h-4" />
                        View
                      </a>
                      <a 
                        href={doc.file_url} 
                        download={doc.original_filename || doc.title}
                        className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 bg-app-accent text-white rounded-2xl text-xs font-bold hover:brightness-110 transition-all shadow-[0_0_20px_rgba(59,130,246,0.2)]"
                      >
                        <Download className="w-4 h-4" />
                        Download
                      </a>
                    </div>
                  ) : (
                    <div className="px-6 py-3 bg-white/5 text-app-muted rounded-2xl text-[10px] font-bold uppercase tracking-widest italic">
                      Restricted Access
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-app-muted text-center py-10 italic">No reference documents were utilized in this session.</p>
          )}
        </section>

        <footer className="pt-16 border-t border-white/5 text-center pb-20">
          <div className="inline-flex items-center gap-3 text-white font-bold text-xl mb-8 tracking-tight">
            <div className="w-10 h-10 glass-panel rounded-xl flex items-center justify-center">
              <Volume2 className="w-5 h-5 text-app-accent" />
            </div>
            <div className="flex items-center gap-2">
              <img src="https://caribdesigns.com/voiceit-logo.png" alt="VoiceIt" className="h-[60px] w-auto" referrerPolicy="no-referrer" />
              Assistant
            </div>
          </div>
          <div className="flex flex-col items-center gap-8">
            <div className="flex flex-wrap justify-center gap-10">
              <div className="flex flex-col items-center gap-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-app-muted">Inquiries</p>
                <p className="text-white font-medium">869-467-1623</p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-app-muted">Email</p>
                <p className="text-white font-medium">info@lawcommission.gov.kn</p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-app-muted">Developer</p>
                <p className="text-white font-medium">Cherami Ltd.</p>
              </div>
            </div>
            <p className="text-app-muted text-[10px] font-bold uppercase tracking-[0.5em] mt-4">Secure AI Infrastructure</p>
          </div>
        </footer>
      </div>
    </div>
  );
};
