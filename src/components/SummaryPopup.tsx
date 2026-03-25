import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, Phone, Mail, Building2, Printer } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { printSessionReceipt } from '../services/printer';

interface SummaryPopupProps {
  sessionId: string;
  onClose: () => void;
  onPrint?: () => void;
}

export const SummaryPopup = ({ sessionId, onClose, onPrint }: SummaryPopupProps) => {
  const PUBLIC_BASE_URL = import.meta.env.VITE_PUBLIC_BASE_URL || window.location.origin;
  const summaryUrl = `${PUBLIC_BASE_URL}/session/${sessionId}`;
  const hasAutoPrinted = useRef(false);
  const [printError, setPrintError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasAutoPrinted.current) {
      hasAutoPrinted.current = true;
      printSessionReceipt(sessionId).catch(e => {
        console.error("Auto-print failed:", e);
        setPrintError("Print failed");
      });
    }
  }, [sessionId]);

  const handlePrint = () => {
    setPrintError(null);
    if (onPrint) onPrint();
    printSessionReceipt(sessionId).catch(e => {
      console.error("Manual print failed:", e);
      setPrintError("Printer unavailable");
    });
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-4">
      {/* Printable Area (Hidden in UI, visible in print) */}
      <div id="print-area" className="hidden">
        <div style={{ textAlign: 'center', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>
          <div className="flex items-center gap-2" style={{ margin: '0' }}>
            <img src="https://caribdesigns.com/voiceit-logo.png" alt="VoiceIt" className="h-[72px] w-auto" referrerPolicy="no-referrer" />
            <h1 style={{ fontSize: '18px', margin: '0' }}>Session</h1>
          </div>
          <p style={{ fontSize: '10px', color: '#666', margin: '2px 0' }}>Thank you for visiting</p>
        </div>
        
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '10px 0' }}>
          <p style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '10px' }}>Scan for Session Summary</p>
          <QRCodeCanvas value={summaryUrl} size={150} level="H" includeMargin={false} />
          <p style={{ fontSize: '9px', color: '#888', marginTop: '10px', textAlign: 'center' }}>Scan this code to view your questions, answers, and download source documents.</p>
        </div>

        <div style={{ borderTop: '1px solid #eee', paddingTop: '10px', fontSize: '8px', color: '#444' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span>Tel: 869-467-1623</span>
            <span>info@lawcommission.gov.kn</span>
          </div>
          <div style={{ textAlign: 'center', fontWeight: 'bold', color: '#000' }}>
            Powered by Cherami Ltd. - 868-222-0011
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #print-area, #print-area * {
            visibility: visible !important;
            display: flex !important;
          }
          #print-area {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 4in !important;
            height: 4in !important;
            padding: 0.2in !important;
            background: white !important;
            color: black !important;
            font-family: sans-serif !important;
            flex-direction: column !important;
            justify-content: space-between !important;
            z-index: 9999 !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>
      
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        className="glass-panel rounded-[40px] p-8 md:p-12 max-w-2xl w-full text-center shadow-2xl relative overflow-hidden no-print"
      >
        {/* UI Content */}
        <div className="no-print relative z-10">
          <div className="absolute -top-12 -left-12 w-48 h-48 bg-app-accent/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-12 -right-12 w-48 h-48 bg-app-warning/10 rounded-full blur-3xl" />
          
          <div className="mb-6 inline-flex items-center justify-center w-16 h-16 bg-app-accent/10 text-app-accent rounded-2xl border border-app-accent/20">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">Session Complete</h2>
          <p className="text-app-muted text-lg mb-8 flex items-center justify-center gap-2">
            Thank you for using 
            <img src="https://caribdesigns.com/voiceit-logo.png" alt="VoiceIt" className="h-[60px] w-auto" referrerPolicy="no-referrer" />. 
            Your session has been securely summarized.
          </p>
          
          <div className="flex flex-col items-center justify-center mb-10">
            <div className="p-6 bg-white rounded-3xl shadow-[0_0_40px_rgba(255,255,255,0.1)]">
              <QRCodeCanvas value={summaryUrl} size={180} level="H" includeMargin={true} />
            </div>
            <p className="mt-4 text-app-accent text-[10px] font-bold uppercase tracking-[0.3em] animate-pulse">Scan to save your summary</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10 text-left">
            <div className="space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-app-muted">Contact Information</p>
              <div className="flex items-center gap-3 text-white/80">
                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                  <Phone className="w-4 h-4 text-app-accent" />
                </div>
                <span className="font-medium text-sm">869-467-1623</span>
              </div>
              <div className="flex items-center gap-3 text-white/80">
                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                  <Mail className="w-4 h-4 text-app-accent" />
                </div>
                <span className="font-medium text-sm truncate">info@lawcommission.gov.kn</span>
              </div>
            </div>
            
            <div className="space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-app-muted">Powered By</p>
              <div className="flex items-center gap-3 text-white">
                <div className="w-8 h-8 rounded-lg bg-app-accent/20 flex items-center justify-center">
                  <Building2 className="w-4 h-4 text-app-accent" />
                </div>
                <span className="font-bold">Cherami Ltd.</span>
              </div>
              <div className="flex items-center gap-3 text-white/80">
                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                  <Phone className="w-4 h-4 text-app-accent" />
                </div>
                <span className="font-medium text-sm">868-222-0011</span>
              </div>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 flex flex-col gap-2">
              <button 
                onClick={handlePrint}
                className="w-full py-5 bg-white/5 border border-white/10 text-white rounded-2xl font-bold hover:bg-white/10 transition-all flex items-center justify-center gap-2"
              >
                <Printer className="w-5 h-5" />
                Print Receipt
              </button>
              {printError && (
                <p className="text-red-500 text-[10px] font-bold uppercase tracking-widest animate-pulse">{printError}</p>
              )}
            </div>
            <button 
              onClick={onClose}
              className="flex-1 py-5 bg-app-accent text-white rounded-2xl font-bold hover:brightness-110 transition-all shadow-[0_0_30px_rgba(59,130,246,0.3)] active:scale-[0.98]"
            >
              Close & Finish
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
