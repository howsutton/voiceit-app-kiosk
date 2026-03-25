import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Mic, MicOff, Send, BookOpen, User as UserIcon, Settings, 
  LayoutDashboard, FileText, Activity, LogOut,
  ChevronRight, ChevronLeft, Volume2, Search, Info, Camera, Trash2,
  Clock, RefreshCw, Plus, CheckCircle2, Phone, PhoneOff, Mail, Printer, Download,
  ExternalLink, Database, Layers, CircleHelp,
  Building2, Smile, Meh, Frown, Hash, MessageSquare, CreditCard, TrendingUp, AlertCircle,
  AlertTriangle, Ban, X
} from 'lucide-react';
import { Project, Message, Document, Account, User as UserType, Analytics, ProjectMessageLogItem, GlobalMessageLogItem, UsageLogItem, PaginatedResponse } from './types';
import { generateGroundedAnswer } from './services/aiService';
import { printSessionReceipt } from './services/printer';
import { SummaryPage } from './components/SummaryPage';
import { SummaryPopup } from './components/SummaryPopup';
import { HelpPopup } from './components/Help';
import { VoiceOrb } from './components/VoiceOrb';
import { QRCodeCanvas } from 'qrcode.react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import L from 'leaflet';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';

import { GoogleGenAI, Modality, LiveServerMessage, Type, FunctionDeclaration } from "@google/genai";

// Fix for default marker icons in Leaflet
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

const createCustomClusterIcon = (cluster: any) => {
  return L.divIcon({
    html: `<div class="bg-indigo-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold text-xs shadow-lg border-2 border-white">${cluster.getChildCount()}</div>`,
    className: 'custom-marker-cluster',
    iconSize: L.point(32, 32, true),
  });
};

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const API_BASE = ''; // Force relative paths for Cloud Run environment

// --- Components ---

const KioskMode = ({ project, sessionTimeout, onExit }: { project: Project, sessionTimeout: number, onExit: () => void }) => {
  const [isPresent, setIsPresent] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(true);
  const [session, setSession] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [transcription, setTranscription] = useState('');
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);
  const sortedDocs = useMemo(() => {
    return [...documents].sort((a, b) => a.title.localeCompare(b.title));
  }, [documents]);
  const [activePreviewSources, setActivePreviewSources] = useState<any[]>([]);
  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const selectedSource = activePreviewSources[activePreviewIndex] || null;

  const [showAllSourcesModal, setShowAllSourcesModal] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [allSourcesPage, setAllSourcesPage] = useState(1);
  const allSourcesPageSize = 6;
  const awaitingAllSourcesConfirmationRef = useRef<boolean>(false);
  const [isAllSourcesPending, setIsAllSourcesPending] = useState(false);

  // Refs for state to be used in onmessage callback
  const showAllSourcesModalRef = useRef(showAllSourcesModal);
  const showHelpRef = useRef(showHelp);
  const allSourcesPageRef = useRef(allSourcesPage);
  const selectedSourceRef = useRef(selectedSource);
  const activePreviewSourcesRef = useRef(activePreviewSources);
  const activePreviewIndexRef = useRef(activePreviewIndex);
  const sortedDocsRef = useRef(sortedDocs);

  useEffect(() => {
    showAllSourcesModalRef.current = showAllSourcesModal;
    showHelpRef.current = showHelp;
    allSourcesPageRef.current = allSourcesPage;
    selectedSourceRef.current = selectedSource;
    activePreviewSourcesRef.current = activePreviewSources;
    activePreviewIndexRef.current = activePreviewIndex;
    sortedDocsRef.current = sortedDocs;
  }, [showAllSourcesModal, showHelp, allSourcesPage, selectedSource, activePreviewSources, activePreviewIndex, sortedDocs]);

  const [showSettings, setShowSettings] = useState(false);

  const isEndingSessionRef = useRef(false);
  const awaitingAnythingElseConfirmationRef = useRef(false);

  const getDeviceType = useCallback(() => {
    const ua = navigator.userAgent;
    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
      return "mobile";
    }
    if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) {
      return "mobile";
    }
    return "desktop";
  }, []);

  const getLocation = useCallback(async () => {
    return new Promise<{latitude: number, longitude: number, country: string, city: string} | null>((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }

      navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`);
          if (res.ok) {
            const data = await res.json();
            resolve({
              latitude,
              longitude,
              country: data.address?.country || 'Unknown',
              city: data.address?.city || data.address?.town || data.address?.village || 'Unknown'
            });
          } else {
            resolve({ latitude, longitude, country: 'Unknown', city: 'Unknown' });
          }
        } catch (e) {
          resolve({ latitude, longitude, country: 'Unknown', city: 'Unknown' });
        }
      }, () => {
        resolve(null);
      }, { timeout: 5000 });
    });
  }, []);
  
  const setSelectedSource = useCallback((source: any) => {
    if (source === null) {
      setActivePreviewSources([]);
      setActivePreviewIndex(0);
    } else {
      setActivePreviewSources([source]);
      setActivePreviewIndex(0);
    }
  }, []);

  const [showSummary, setShowSummary] = useState(false);
  const showSummaryRef = useRef(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  const remainingTimeFormatted = useMemo(() => {
    if (remainingSeconds === null) return "00:00";
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, [remainingSeconds]);

  const shortAIText = useMemo(() => {
    if (isThinking) return "Analyzing your documents...";
    
    // Find the last model message to show as a summary
    const lastModelMessage = [...messages].reverse().find(m => m.role === 'model');
    const content = lastModelMessage?.content || "";
    
    if (content) {
      // Split by sentence boundaries (period, exclamation, question mark followed by space or end of string)
      const sentences = content.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [content];
      
      if (sentences.length > 2) {
        return sentences.slice(0, 2).join(' ');
      }
      
      // Fallback for very long content without clear sentence boundaries
      if (content.length > 160 && sentences.length <= 1) {
        return content.substring(0, 157) + "...";
      }
      return content;
    }
    
    if (isListening) return "I'm listening to your request...";
    return "How can I help today?";
  }, [isListening, isThinking, messages]);

  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
      });
    }
  }, [isMuted]);
  
  const isPresentRef = useRef(false);
  const connectionStatusRef = useRef<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const isConnectingRef = useRef(false);
  const liveSessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueue = useRef<AudioBuffer[]>([]);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const nextStartTime = useRef(0);
  const isPlaying = useRef(false);
  const lastActivityRef = useRef<number>(Date.now());
  const [billingStatus, setBillingStatus] = useState<any>(null);

  useEffect(() => {
    const fetchBilling = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/projects/${project.id}/billing-status`);
        if (res.ok) {
          const data = await res.json();
          setBillingStatus(data);
        }
      } catch (e) {
        console.warn("Failed to fetch billing status.");
      }
    };
    fetchBilling();
    const interval = setInterval(fetchBilling, 30000);
    return () => clearInterval(interval);
  }, [project.id]);

  const billingAccessState = useMemo(() => {
    if (!billingStatus) return 'ok';
    if (billingStatus.isBlocked) return 'blocked';
    if (billingStatus.status === 'warning') return 'warning';
    return 'ok';
  }, [billingStatus]);

  useEffect(() => {
    return () => {
      console.log("KioskMode unmounting, cleaning up...");
      stopAudioPlayback();
      if (liveSessionRef.current) {
        intentionalCloseRef.current = true;
        try {
          liveSessionRef.current.close();
        } catch (e) {}
        liveSessionRef.current = null;
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
    };
  }, []);

  const hasPromptedRef = useRef<boolean>(false);
  const lastSeenTimeRef = useRef<number | null>(null);
  const currentTurnRef = useRef<{ userText: string, modelText: string, sources: any[] }>({ userText: '', modelText: '', sources: [] });
  const currentUserTranscriptRef = useRef('');
  const latestTranscriptRef = useRef('');
  const finalUserTranscriptRef = useRef('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const intentionalCloseRef = useRef(false);
  const reconnectTimeoutRef = useRef<any>(null);
  const reconnectAttemptsRef = useRef(0);
  const isReconnectingRef = useRef(false);
  
  // Source offer handoff state
  const lastOfferedSourcesRef = useRef<any[]>([]);
  const awaitingSourceConfirmationRef = useRef<boolean>(false);
  const [isShowingSourcePending, setIsShowingSourcePending] = useState(false);
  
  // Source flow lifecycle state
  const sourceFlowStateRef = useRef<'idle' | 'awaiting_show_confirmation' | 'source_visible' | 'awaiting_read_confirmation' | 'reading_source' | 'awaiting_post_source_action'>('idle');
  const lastReadConfirmationSourceKeyRef = useRef<string | null>(null);
  const lastReadPromptedSourceKeyRef = useRef<string | null>(null);
  
  // Billing: Voice duration tracking
  const userVoiceStartTimeRef = useRef<number>(0);
  const userVoiceDurationRef = useRef<number>(0);
  const modelVoiceDurationRef = useRef<number>(0);
  const isModelSpeakingRef = useRef<boolean>(false);

  // --- Source Flow Lifecycle Helpers ---

  const clearSourceFlow = useCallback(() => {
    setActivePreviewSources([]);
    setActivePreviewIndex(0);
    setIsShowingSourcePending(false);
    awaitingSourceConfirmationRef.current = false;
    sourceFlowStateRef.current = 'idle';
    lastReadPromptedSourceKeyRef.current = null;
  }, []);

  const openAllSourcesModal = useCallback(() => {
    setShowAllSourcesModal(true);
    setAllSourcesPage(1);
    awaitingAllSourcesConfirmationRef.current = false;
    setIsAllSourcesPending(false);
  }, []);

  const closeAllSourcesExperience = useCallback(() => {
    setActivePreviewSources([]);
    setActivePreviewIndex(0);
    setShowAllSourcesModal(false);
    awaitingAllSourcesConfirmationRef.current = false;
    awaitingSourceConfirmationRef.current = false;
    sourceFlowStateRef.current = 'idle';
    lastReadPromptedSourceKeyRef.current = null;
  }, []);

  const openSource = useCallback((source: any, sourceSet?: any[]) => {
    const sourcesToPreview = sourceSet && sourceSet.length > 0 ? sourceSet : [source];
    
    // Deduplicate and cap to 3 for voice mode
    const finalSources: any[] = [];
    const seen = new Set();
    for (const s of sourcesToPreview) {
      const key = `${s.documentTitle}-${s.pageNumber}`;
      if (!seen.has(key)) {
        seen.add(key);
        finalSources.push({
          id: 'source-' + Date.now() + '-' + finalSources.length,
          project_id: project.id,
          title: s.documentTitle,
          content: s.content || s.excerpt,
          page_count: 1,
          ...s
        });
      }
      if (finalSources.length >= 3) break;
    }

    // Find index of the requested source in the set
    const initialIndex = finalSources.findIndex(s => 
      s.documentTitle === source.documentTitle && s.pageNumber === source.pageNumber
    );
    
    setActivePreviewSources(finalSources);
    const actualIndex = initialIndex >= 0 ? initialIndex : 0;
    setActivePreviewIndex(actualIndex);

    const currentSource = finalSources[actualIndex];
    
    // Ensure it's tracked in the current turn for the summary
    finalSources.forEach(s => {
      if (!currentTurnRef.current.sources.some((existing: any) => 
        existing.documentTitle === s.documentTitle && 
        existing.pageNumber === s.pageNumber
      )) {
        currentTurnRef.current.sources.push(s);
      }
    });
    
    setIsShowingSourcePending(false);
    awaitingSourceConfirmationRef.current = false;
    
    // Transition to awaiting read confirmation for the CURRENTLY SHOWN source
    const sourceKey = `${currentSource.documentTitle}-${currentSource.pageNumber}`;
    
    const alreadyPrompted = lastReadPromptedSourceKeyRef.current === sourceKey;
    const alreadyAnswered = lastReadConfirmationSourceKeyRef.current === sourceKey;

    if (!alreadyPrompted && !alreadyAnswered) {
      sourceFlowStateRef.current = 'awaiting_read_confirmation';
      lastReadPromptedSourceKeyRef.current = sourceKey;
    } else {
      sourceFlowStateRef.current = 'source_visible';
    }
  }, [project.id]);

  const handleReset = useCallback(() => {
    console.log("Full UI Reset triggered.");
    setShowSummary(false);
    isEndingSessionRef.current = false;
    stopAudioPlayback();
    
    // Reset billing refs
    userVoiceStartTimeRef.current = 0;
    userVoiceDurationRef.current = 0;
    modelVoiceDurationRef.current = 0;
    isModelSpeakingRef.current = false;

    if (liveSessionRef.current) {
      intentionalCloseRef.current = true;
      try { liveSessionRef.current.close(); } catch (e) {}
      liveSessionRef.current = null;
    }
    
    // Comprehensive state reset
    setIsPresent(false);
    isPresentRef.current = false;
    lastOfferedSourcesRef.current = [];
    awaitingSourceConfirmationRef.current = false;
    setIsShowingSourcePending(false);
    sourceFlowStateRef.current = 'idle';
    lastReadConfirmationSourceKeyRef.current = null;
    lastReadPromptedSourceKeyRef.current = null;
    setMessages([]);
    setTranscription('');
    setInput('');
    setIsListening(false);
    setIsThinking(false);
    setIsSpeaking(false);
    setConnectionStatus('idle');
    connectionStatusRef.current = 'idle';
    lastActivityRef.current = Date.now();
    hasPromptedRef.current = false;
    setRemainingSeconds(null);
    awaitingAnythingElseConfirmationRef.current = false;
    clearSourceFlow();
  }, [clearSourceFlow]);

  const enterSummaryMode = useCallback(() => {
    console.log("Entering summary mode...");
    
    // Explicitly stop all AI activity as per requirements
    stopAudioPlayback();
    if (liveSessionRef.current) {
      intentionalCloseRef.current = true;
      try {
        liveSessionRef.current.close();
      } catch (e) {}
      liveSessionRef.current = null;
    }
    setIsListening(false);
    setIsSpeaking(false);
    setIsThinking(false);
    
    setShowAllSourcesModal(false);
    clearSourceFlow();
    lastActivityRef.current = Date.now(); // Reset activity timer for summary page
    setShowSummary(true);
  }, [clearSourceFlow]);

  const handleExit = () => {
    console.log("Exiting Kiosk mode...");
    if (liveSessionRef.current) {
      intentionalCloseRef.current = true;
      try { liveSessionRef.current.close(); } catch (e) {}
      liveSessionRef.current = null;
    }
    isPresentRef.current = false;
    setIsPresent(false);
    onExit();
  };

  // Sync refs with state for use in callbacks
  useEffect(() => {
    connectionStatusRef.current = connectionStatus;
  }, [connectionStatus]);

  useEffect(() => {
    isPresentRef.current = isPresent;
    if (!isPresent) {
      // Reset state when user leaves
      setTranscription('');
      setIsListening(false);
      setIsThinking(false);
      setIsSpeaking(false);
      hasPromptedRef.current = false;
    }
  }, [isPresent]);

  useEffect(() => {
    showSummaryRef.current = showSummary;
  }, [showSummary]);

  useEffect(() => {
    const fetchDocs = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/projects/${project.id}/documents`);
        if (res.ok) {
          const data = await res.json();
          setDocuments(data);
        }
      } catch (e) {
        console.warn("Failed to fetch documents from backend.");
      }
    };
    fetchDocs();
  }, [project.id]);

  useEffect(() => {
    let timer: any;
    const initCamera = async () => {
      try {
        if (mediaStreamRef.current) return;
        
        console.log("Initializing unified media stream...");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        mediaStreamRef.current = stream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(e => console.warn("Video play failed:", e));
        }
        
        // Auto-start session after a short delay to ensure camera is ready
        timer = setTimeout(() => { 
          if (!isPresentRef.current && connectionStatusRef.current === 'idle') {
            console.log("Initial presence detected: starting session.");
            startSession(); 
          }
        }, 500);
      } catch (err) {
        console.warn("Media access denied or unavailable:", err);
        setError("Camera/Microphone access is required for Kiosk mode.");
      }
    };
    initCamera();
    return () => {
      if (timer) clearTimeout(timer);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
    };
  }, [project.id]);

  // Handle session lifecycle based on isPresent state
  useEffect(() => {
    if (showSummary) return;
    if (isPresent && isVoiceMode) {
      // If we are present and in voice mode, ensure session is connected
      if (connectionStatus === 'idle' || connectionStatus === 'error' || (connectionStatus === 'connected' && !liveSessionRef.current)) {
        console.log("Session lifecycle: connecting live session");
        
        const now = Date.now();
        const timeSinceLastSeen = lastSeenTimeRef.current ? (now - lastSeenTimeRef.current) : null;
        const isReturn = timeSinceLastSeen !== null && timeSinceLastSeen < (sessionTimeout * 1000);
        
        // If we have messages, it's a return with history
        const hasHistory = messages.length > 0;
        connectLive(documents, isReturn || hasHistory, hasHistory ? messages : undefined);
      }
    } else if (isPresent && !isVoiceMode) {
      // If we are present but in text mode, close live session if it exists
      if (liveSessionRef.current) {
        console.log("Session lifecycle: closing live session for text mode");
        intentionalCloseRef.current = true;
        stopAudioPlayback();
        liveSessionRef.current.close();
        liveSessionRef.current = null;
      }
      if (connectionStatus !== 'connected') {
        setConnectionStatus('connected');
      }
      setIsListening(false);
      setIsThinking(false);
      setIsSpeaking(false);
    } else if (!isPresent) {
      // If not present, close everything
      if (liveSessionRef.current) {
        console.log("Session lifecycle: closing live session (no presence)");
        intentionalCloseRef.current = true;
        stopAudioPlayback();
        liveSessionRef.current.close();
        liveSessionRef.current = null;
      }
      setConnectionStatus('idle');
      if (isPresentRef.current) {
        lastSeenTimeRef.current = Date.now();
      }
      setIsListening(false);
      setIsThinking(false);
      setIsSpeaking(false);
    }
  }, [isPresent, isVoiceMode, connectionStatus, messages.length, documents, showSummary]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log("KioskMode unmounting: performing cleanup");
      if (liveSessionRef.current) {
        try { liveSessionRef.current.close(); } catch (e) {}
        liveSessionRef.current = null;
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
      stopAudioPlayback();
    };
  }, []);

  // Inactivity Timeout Logic
  useEffect(() => {
    // If not present AND not showing summary, we don't need the timer
    if (!isPresent && !showSummary) {
      setRemainingSeconds(null);
      return;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const idleTime = now - lastActivityRef.current;
      const totalTimeout = sessionTimeout * 1000;
      
      // Calculate remaining seconds for UI
      // If summary is showing, we show a countdown for the summary itself (60s)
      const displayTimeout = showSummary ? (totalTimeout + 60000) : totalTimeout;
      const remaining = Math.max(0, Math.ceil((displayTimeout - idleTime) / 1000));
      setRemainingSeconds(remaining);

      // Inactivity timeout (prompt)
      if (idleTime > (sessionTimeout - 30) * 1000 && !hasPromptedRef.current && sessionTimeout > 30 && !showSummary) {
        if (liveSessionRef.current) {
          // Use a more natural prompt via text input to the live session
          try {
            liveSessionRef.current.sendRealtimeInput({
              text: "I haven't heard from you in a while. Do you need any more assistance, or should I close this session?"
            });
            hasPromptedRef.current = true;
          } catch (e) {
            console.warn("Failed to send inactivity prompt:", e);
          }
        }
      } 
      // Timeout after prompt (or immediately if timeout is reached)
      else if (idleTime > totalTimeout && !showSummary) {
        console.log("Session timed out due to inactivity - showing summary");
        enterSummaryMode();
      }
      // If summary is showing, have a secondary timeout to reset completely if no one interacts
      else if (showSummary && idleTime > totalTimeout + 60000) {
        console.log("Summary popup timed out - resetting kiosk");
        handleReset();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isPresent, sessionTimeout, showSummary, handleReset, enterSummaryMode]);

  // Presence Detection / Auto-start Loop
  useEffect(() => {
    if (isPresent) return;

    const interval = setInterval(() => {
      // If we are idle and not connecting, and it's been a while since we last saw someone
      // or if we've never seen anyone, try to "detect" presence.
      // In a real app, this would use a face detection API.
      if (connectionStatusRef.current === 'idle' && !isConnectingRef.current) {
        const now = Date.now();
        const timeSinceLastSeen = lastSeenTimeRef.current ? (now - lastSeenTimeRef.current) : Infinity;
        
        // If they've been gone for at least 5 seconds, look for a "new" presence
        if (timeSinceLastSeen > 5000) {
          console.log("Looking for new presence...");
          // For this demo, we'll assume someone is detected if the camera is active
          if (mediaStreamRef.current?.active) {
            startSession();
          }
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isPresent]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Global interaction listener to reset inactivity timer
  useEffect(() => {
    const handleInteraction = () => {
      if (isPresentRef.current) {
        lastActivityRef.current = Date.now();
        hasPromptedRef.current = false;
      }
    };
    window.addEventListener('mousemove', handleInteraction);
    window.addEventListener('touchstart', handleInteraction);
    window.addEventListener('keydown', handleInteraction);
    return () => {
      window.removeEventListener('mousemove', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
  }, []);

  const startSession = async () => {
    if (isPresentRef.current || connectionStatusRef.current === 'connecting' || showSummary) {
      console.log("Session already active, connecting, or summary shown, ignoring start request.");
      return;
    }
    
    try {
      console.log("Starting session flow...");
      setError(null);
      setConnectionStatus('connecting');
      
      const now = Date.now();
      const timeSinceLastSeen = lastSeenTimeRef.current ? (now - lastSeenTimeRef.current) : null;
      // It's a return only if they were seen recently AND within the timeout period
      const isReturn = timeSinceLastSeen !== null && timeSinceLastSeen < (sessionTimeout * 1000); 
      
      console.log(`Starting session. Time since last seen: ${timeSinceLastSeen}ms. Is return: ${isReturn}`);
      
      // Fetch latest documents right before starting session to ensure AI has latest knowledge
      let currentDocs = documents;
      try {
        const res = await fetch(`${API_BASE}/api/projects/${project.id}/documents`);
        if (res.ok) {
          currentDocs = await res.json();
          setDocuments(currentDocs);
          console.log(`Fetched ${currentDocs.length} documents for session.`);
        }
      } catch (e) {
        console.warn("Failed to fetch latest documents, using cached ones.");
      }

      // Use existing media stream
      if (!mediaStreamRef.current) {
        console.log("No media stream available, attempting to initialize...");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        mediaStreamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      }

      // Resume audio context immediately on user interaction
      if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      // Try to create a session on the backend, but don't block if it fails
      try {
        const location = await getLocation();
        const deviceType = getDeviceType();
        
        const res = await fetch(`${API_BASE}/api/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            projectId: project.id, 
            mode: isVoiceMode ? 'voice' : 'text',
            latitude: location?.latitude,
            longitude: location?.longitude,
            country: location?.country,
            city: location?.city,
            device_type: deviceType
          })
        });
        if (res.ok) {
          const data = await res.json();
          setSession(data.id);
          sessionRef.current = data.id;
        } else {
          const id = 'local-' + Date.now();
          setSession(id);
          sessionRef.current = id;
        }
      } catch (e) {
        console.warn("Backend session creation failed, using local session.");
        const id = 'local-' + Date.now();
        setSession(id);
        sessionRef.current = id;
      }

      isPresentRef.current = true;
      setIsPresent(true);
      lastActivityRef.current = Date.now();
      
      if (isVoiceMode) {
        // Pass the freshly fetched docs to connectLive
        // If we have messages, it's a return with history
        const hasHistory = messages.length > 0;
        connectLive(currentDocs, isReturn || hasHistory, hasHistory ? messages : undefined);
      } else {
        setConnectionStatus('connected');
        console.log("Setting initial greeting for text mode.");
        const content = isReturn 
          ? "Welcome back. How can I help?"
          : `Welcome. I am the assistant for ${project.title}. ${project.description}. I’m ready to help. What would you like to do first?`;
          
        const greeting: Message = {
          id: 'greet-' + Date.now(),
          role: 'model',
          content,
          created_at: new Date().toISOString()
        };
        setMessages([greeting]);
      }
    } catch (err) {
      console.error("Error in startSession:", err);
      setError("Failed to start session. Please try again.");
      setConnectionStatus('error');
      isPresentRef.current = false;
      setIsPresent(false);
    }
  };

  const connectLive = async (currentDocs?: Document[], isReturn: boolean = false, initialHistory?: Message[]) => {
    if (billingAccessState === 'blocked') {
      console.warn("AI usage blocked due to billing limit.");
      return;
    }
    if ((isConnectingRef.current && !isReconnectingRef.current) || (connectionStatusRef.current === 'connected' && liveSessionRef.current)) {
      console.log("Already connecting or connected to Gemini Live, skipping.");
      return;
    }
    
    if (!isReconnectingRef.current) {
      reconnectAttemptsRef.current = 0;
    }
    
    const docsToUse = currentDocs || documents;
    console.log(`Connecting to Gemini Live with ${docsToUse.length} documents. Is return: ${isReturn}. History: ${initialHistory?.length || 0} msgs`);
    
    try {
      console.log("Connecting to Gemini Live...");
      isConnectingRef.current = true;
      setConnectionStatus('connecting');
      
      // Initialize AI instance right before connection as per guidelines
      const currentAi = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const stream = mediaStreamRef.current;
      if (!stream) throw new Error("Media stream not initialized");

      if (videoRef.current && videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(e => console.warn("Video play failed:", e));
      }
      const source = audioContextRef.current.createMediaStreamSource(stream);
      
      const contextText = docsToUse.map(d => `SOURCE DOCUMENT: ${d.title}\nCONTENT:\n${d.content}`).join("\n\n---\n\n");
      
      console.log("Context text length:", contextText.length);
      
      const showSourceFunctionDeclaration: FunctionDeclaration = {
        name: "showSource",
        parameters: {
          type: Type.OBJECT,
          description: "Display the source document details to the user. Call this when the user says 'yes' to seeing sources or explicitly asks to open a source.",
          properties: {
            documentTitle: {
              type: Type.STRING,
              description: "The title of the document to show.",
            },
            pageNumber: {
              type: Type.NUMBER,
              description: "The page number within the document.",
            },
            excerpt: {
              type: Type.STRING,
              description: "The specific excerpt from the document.",
            },
          },
          required: ["documentTitle", "pageNumber", "excerpt"],
        },
      };

      const closeSourceFunctionDeclaration: FunctionDeclaration = {
        name: "closeSource",
        parameters: {
          type: Type.OBJECT,
          description: "Close the currently displayed source document. Call this when the user says 'close source' or 'hide source'.",
          properties: {},
        },
      };

      const listAllSourcesFunctionDeclaration: FunctionDeclaration = {
        name: "listAllSources",
        parameters: {
          type: Type.OBJECT,
          description: "Open a popup listing all ingested source documents for the project. Call this when the user says 'yes' to seeing all sources or explicitly asks to list all sources.",
          properties: {},
        },
      };

      const showSummaryFunctionDeclaration: FunctionDeclaration = {
        name: "showSummary",
        parameters: {
          type: Type.OBJECT,
          description: "Display the session summary and QR code to the user. Call this when the user indicates they are finished with the session (e.g., 'no', 'I'm done', 'goodbye') after you've asked if there's anything else you can help with.",
          properties: {},
        },
      };

      const systemInstruction = `
        You are a real-time kiosk assistant for ${project.title}.
        
        CONTEXT:
        ${project.description}
        
        KNOWLEDGE BASE:
        ${contextText}
        
        GREETING INSTRUCTION:
        A user has just entered the interaction zone. 
        This is a ${isReturn ? 'RETURNING' : 'NEW'} user.
        
        ${isReturn 
          ? "Greet them warmly with a 'Welcome back!' and ask if they have more questions about " + project.title + "."
          : "Introduce yourself as the " + project.title + " assistant. Welcome them, briefly mention what the project is about, and invite them to ask questions."
        }
        
        Keep the initial greeting concise but very professional and welcoming.
        
        GENERAL RULES:
        
        1. When you receive a "NEW_PRESENCE" signal, immediately respond with a full introduction.
        2. When you receive a "RETURN_PRESENCE" signal, respond with a shorter welcome back message.
        3. The full introduction must include:
           - A warm welcome.
           - Your identity as the assistant for "${project.title}".
           - A brief mention of the project: "${project.description}".
           - An invitation to ask questions.
        4. Do not wait for the visitor to say hello first.
        5. Do not ask for permission to begin.
        6. Keep the greeting natural, polished, and professional.
        
        FULL GREETING TEMPLATE:
        "Welcome! I am the assistant for ${project.title}. ${project.description}. I'm here to help you with any questions you might have. What would you like to know?"
        
        RETURN GREETING TEMPLATE:
        "Welcome back! How can I continue to help you today?"
        
        ABOUT THIS PROJECT:
        ${project.description}
        
        KNOWLEDGE BASE (CONTEXT DOCUMENTS):
        ${docsToUse.length > 0 ? contextText : "No documents uploaded yet."}
        
        YOUR MISSION:
        - Answer questions strictly based on the provided KNOWLEDGE BASE.
        - ${project.instructions}
        - If the answer is not in the context, politely say you don't have that information.
        - Be friendly, calm, confident, and professional.
        - IMPORTANT: After every answer derived from the knowledge base, you MUST ask the user if they want to see the source.
        - If they say "yes", "show me", "open source", or specify a source, call the 'showSource' tool with the relevant details.
        - If you have just offered a source and the user says any affirmative response such as "yes", "yes please", "show me", or "okay", immediately call 'showSource' in the same turn without asking again.
        - If they say "close source", "hide source", or "stop showing", call the 'closeSource' tool.
        - You can handle multiple sources. If there are multiple, ask which one they want to see or offer to show them all.
        - READ SOURCE FEATURE: When a source is shown on screen via 'showSource', you MUST ask the user if they would like you to read out what is shown. If they say yes, read the excerpt clearly and naturally.
        - ALL SOURCES FEATURE: If the user asks to see "all sources", "list sources", "what are the sources", or similar, immediately call the 'listAllSources' tool. If you are proactively offering to show all sources, then ask: "Would you like me to show all ingested source files?". If they then say "yes", "show me", or any affirmative, call the 'listAllSources' tool.
        - NAVIGATION: When the "all sources" list is open, the user can say "next page", "previous page", "first page", "last page", "go to page [number]", or "open [document name/index]". When a document preview is open, they can say "next", "previous", or "close".
        
        SESSION END INSTRUCTION:
        When all questions are asked and answers are given and sources are shown and closed, ask the user: "Is there anything else I can help you with today?".
        If the user indicates they are finished (e.g., "no", "I'm done", "goodbye"), call the 'showSummary' tool immediately.

        SOURCE FLOW INSTRUCTION:
        1. If you offer to show a source and the user says "yes", the frontend will show it immediately. You should then ask if they would like you to read it aloud.
        2. If a source is currently visible and you ask whether the user wants it read aloud, interpret a simple "no" as "do not read the source", not as end-of-session. Then continue the conversation naturally.
        3. Do not call showSource for the same source multiple times in a row.
        4. When you ask "Is there anything else I can help you with today?" and the user says "no", then you should call 'showSummary'. But do not call it if they just said "no" to reading a source.

        HELP POPUP GUIDANCE:
        If the Help popup is open and the user asks about any Help item or feature shown there, answer directly and clearly.
        Explain:
        1. what the feature does
        2. how the user can use it
        3. whether it is activated by button, voice, or both
        Only describe behavior that is actually implemented in the app.

        Supported Help items to explain:
        - Transcript / Text Mode: lets the user type messages instead of speaking; accessible by switching to text mode.
        - Voice Mode: lets the user speak with the assistant; accessible by switching to voice mode.
        - Mute: turns assistant audio on or off; only describe voice activation if that already exists.
        - End Session: ends the interaction and moves toward the summary/session closing flow.
        - Sources: lets the user view source documents and ingested files supporting answers.
        - Session Summary: shows the session wrap-up/summary at the end of the session.
        - Settings: opens available interface/session settings.

        If the user asks follow-up questions like "what does that do?" or "how do I use that?" while Help is open, interpret them in the context of the Help popup and answer accordingly.
      `;

      const sessionPromise = currentAi.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: [showSourceFunctionDeclaration, closeSourceFunctionDeclaration, showSummaryFunctionDeclaration, listAllSourcesFunctionDeclaration] }],
        },
        callbacks: {
          onopen: () => {
            if (showSummaryRef.current) {
              console.log("Summary shown, closing new session immediately...");
              sessionPromise.then(s => s?.close());
              return;
            }
            console.log("Live session opened successfully");
            setConnectionStatus('connected');
            setIsListening(true);
            lastActivityRef.current = Date.now();
            hasPromptedRef.current = true; // Mark as prompted since AI will greet via system instruction
            
            // Reset current turn tracking
            currentTurnRef.current = { userText: '', modelText: '', sources: [] };
            
            // Reset billing duration tracking
            userVoiceStartTimeRef.current = 0;
            userVoiceDurationRef.current = 0;
            modelVoiceDurationRef.current = 0;
            isModelSpeakingRef.current = false;
            
            // Trigger proactive greeting via text signal
            if (initialHistory && initialHistory.length > 0) {
              console.log("Resuming session with history...");
              const historyTurns = initialHistory.map(msg => ({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.content }]
              }));
              
              const lastMsg = initialHistory[initialHistory.length - 1];
              const resumePrompt = lastMsg.role === 'user' 
                ? `The user has switched from text to voice mode and is waiting for your response to their last message: "${lastMsg.content}". Please respond naturally via voice.`
                : `The user has switched back to voice mode. You have already answered their last question. Please wait for them to speak or acknowledge their presence if they speak first.`;

              sessionPromise.then(s => {
                if (s && isPresentRef.current) {
                  setTimeout(() => {
                    if (s && isPresentRef.current) {
                      s.sendClientContent({
                        turns: historyTurns,
                        turnComplete: false // Don't trigger response yet
                      });
                      // Also send a small prompt to acknowledge the return
                      s.sendRealtimeInput({ text: resumePrompt });
                    }
                  }, 100);
                }
              });
            } else {
              const signal = isReturn ? 'RETURN_PRESENCE' : 'NEW_PRESENCE';
              const promptText = isReturn 
                ? `[SIGNAL: ${signal}] The user has returned. Please greet them back warmly.` 
                : `[SIGNAL: ${signal}] A new user has arrived. Please introduce yourself and welcome them as the ${project.title} assistant.`;
                
              sessionPromise.then(s => {
                if (s && isPresentRef.current) {
                  // Use a smaller timeout to ensure the session is ready but greeting is fast
                  setTimeout(() => {
                    if (s && isPresentRef.current) {
                      console.log(`Sending proactive greeting prompt (${signal}) to AI...`);
                      s.sendClientContent({
                        turns: [{ role: 'user', parts: [{ text: promptText + " Respond immediately." }] }],
                        turnComplete: true
                      });
                    }
                  }, 100);
                }
              });
            }

            sessionPromise.then(s => {
              console.log("Gemini Live session resolved:", s);
              if (s && isPresentRef.current) {
                liveSessionRef.current = s;
                
                // Start video streaming loop
                if (videoRef.current) {
                  const canvas = document.createElement('canvas');
                  const ctx = canvas.getContext('2d');
                  const video = videoRef.current;
                  
                  const sendFrame = () => {
                    if (!isPresentRef.current || !liveSessionRef.current || showSummaryRef.current) return;
                    
                    if (video.videoWidth > 0 && video.videoHeight > 0) {
                      // Resize for performance and API limits
                      const targetWidth = 480; // Slightly higher resolution for better detection
                      const targetHeight = (video.videoHeight / video.videoWidth) * targetWidth;
                      canvas.width = targetWidth;
                      canvas.height = targetHeight;
                      
                      ctx?.drawImage(video, 0, 0, targetWidth, targetHeight);
                      const base64Frame = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
                      
                      try {
                        // Sending video frame for context
                        liveSessionRef.current.sendRealtimeInput({
                          video: { data: base64Frame, mimeType: 'image/jpeg' }
                        });
                      } catch (e) {
                        console.error("Failed to send video frame:", e);
                      }
                    }
                    // Send frame every 1 second for near-instant detection
                    setTimeout(sendFrame, 1000);
                  };
                  sendFrame();
                }
              }
            });
            
            const processor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            source.connect(processor);
            processor.connect(audioContextRef.current!.destination);
            
            processor.onaudioprocess = (e) => {
              if (!isPresentRef.current || connectionStatusRef.current !== 'connected' || showSummaryRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmData = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
              }
              
              const bytes = new Uint8Array(pcmData.buffer);
              let binary = '';
              const len = bytes.byteLength;
              for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              const base64Data = btoa(binary);
              
              sessionPromise.then(s => {
                if (s && isPresentRef.current && connectionStatusRef.current === 'connected') {
                  try {
                    s.sendRealtimeInput({
                      audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                    });
                  } catch (e) {
                    console.error("Failed to send audio input:", e);
                  }
                }
              });
            };
          },
          onmessage: async (message: LiveServerMessage) => {
            try {
              if (!isPresentRef.current || showSummaryRef.current) return;
              console.log("Received message from Gemini:", message);
              
              if (message.serverContent?.modelTurn?.parts) {
                // If model starts speaking, user has finished their turn
                if (userVoiceStartTimeRef.current > 0) {
                  userVoiceDurationRef.current = (Date.now() - userVoiceStartTimeRef.current) / 1000;
                  userVoiceStartTimeRef.current = 0;
                  console.log(`[BILLING] User voice duration: ${userVoiceDurationRef.current.toFixed(2)}s`);
                }
                isModelSpeakingRef.current = true;
                for (const part of message.serverContent.modelTurn.parts) {
                  if (part.inlineData) {
                    playAudioChunk(part.inlineData.data);
                  }
                }
              }
              
              if (message.serverContent?.interrupted) {
                stopAudioPlayback();
              }

              if (message.toolCall) {
                for (const call of message.toolCall.functionCalls) {
                  if (call.name === 'showSource') {
                    const args = call.args as any;
                    const newSource = {
                      documentTitle: args.documentTitle,
                      pageNumber: args.pageNumber,
                      excerpt: args.excerpt
                    };
                    
                    openSource(newSource, currentTurnRef.current.sources);
                    
                    // Ensure it's in currentTurnRef sources if not already
                    if (!currentTurnRef.current.sources.some(s => s.documentTitle === newSource.documentTitle && s.pageNumber === newSource.pageNumber)) {
                      currentTurnRef.current.sources.push(newSource);
                    }
                    
                    // Add source to the current model message
                    setMessages(prev => {
                      const lastMsg = prev[prev.length - 1];
                      if (lastMsg?.role === 'model') {
                        const existingSources = lastMsg.sources || [];
                        // Avoid duplicates
                        if (!existingSources.some(s => s.documentTitle === newSource.documentTitle && s.pageNumber === newSource.pageNumber)) {
                          return [...prev.slice(0, -1), { ...lastMsg, sources: [...existingSources, newSource] }];
                        }
                      }
                      return prev;
                    });

                    // Send response back to model
                    sessionPromise.then(s => {
                      if (s) {
                        s.sendToolResponse({
                          functionResponses: [{
                            name: 'showSource',
                            id: call.id,
                            response: { success: true }
                          }]
                        });
                      }
                    });
                  } else if (call.name === 'closeSource') {
                    clearSourceFlow();
                    sessionPromise.then(s => {
                      if (s) {
                        s.sendToolResponse({
                          functionResponses: [{
                            name: 'closeSource',
                            id: call.id,
                            response: { success: true }
                          }]
                        });
                      }
                    });
                  } else if (call.name === 'listAllSources') {
                    openAllSourcesModal();
                    sessionPromise.then(s => {
                      if (s) {
                        s.sendToolResponse({
                          functionResponses: [{
                            name: 'listAllSources',
                            id: call.id,
                            response: { success: true }
                          }]
                        });
                      }
                    });
                  } else if (call.name === 'showSummary') {
                    if (!isEndingSessionRef.current) {
                      isEndingSessionRef.current = true;
                      const finalPhrase = "I am printing your session receipt now. You can scan the QR code on the screen to access your questions, answers, and source documents.";
                      sessionPromise.then(s => {
                        if (s) {
                          s.sendRealtimeInput({ text: `Say exactly: "${finalPhrase}"` });
                        }
                      });
                      setTimeout(() => {
                        enterSummaryMode();
                      }, 10000);
                    }
                    
                    sessionPromise.then(s => {
                      if (s) {
                        s.sendToolResponse({
                          functionResponses: [{
                            name: 'showSummary',
                            id: call.id,
                            response: { success: true }
                          }]
                        });
                      }
                    });
                  }
                }
              }

              if (message.serverContent?.turnComplete) {
                setTranscription('');
                
                // Select best final transcript: latest stable vs longest fragment
                let bestTranscript = latestTranscriptRef.current;
                if (currentUserTranscriptRef.current.length > latestTranscriptRef.current.length) {
                  bestTranscript = currentUserTranscriptRef.current;
                }

                // Filter out source control utterances from summary
                const normalizedTranscript = bestTranscript.toLowerCase().trim().replace(/[.,?!]/g, '');
                const controlPhrases = [
                  'yes', 'no', 'show me', 'yeah', 'yep', 'sure', 'okay', 'ok', 'open it', 
                  'show source', 'yes please', 'please do', 'show it', 'open source',
                  'no thanks', 'dont read', 'skip', 'not now', 'no dont', 'stop',
                  'thats all', 'that is all', 'im done', 'i am done', 'goodbye', 
                  'finish', 'done', 'close session', 'no thats all', 'no that is all', 
                  'nothing else thanks', 'open sources', 'open all sources', 
                  'what are all the sources', 'list sources', 'show all sources',
                  'next page', 'previous page', 'page next', 'page previous',
                  'first page', 'last page', 'go to page', 'page forward', 'page back',
                  'next', 'forward', 'back', 'previous', 'close'
                ];
                const isControlOnly = controlPhrases.some(p => normalizedTranscript === p);
                
                const finalUserText = isControlOnly ? '' : bestTranscript;

                // Reset refs for next turn
                latestTranscriptRef.current = '';
                currentUserTranscriptRef.current = '';

                // Track if this answer had sources to offer
                if (currentTurnRef.current.sources.length > 0) {
                  lastOfferedSourcesRef.current = [...currentTurnRef.current.sources];
                  awaitingSourceConfirmationRef.current = true;
                  console.log("Source offer pending for:", lastOfferedSourcesRef.current);
                }
                
                // Save the turn to backend if we have content
                const currentSession = sessionRef.current;
                const finalUserTextToSave = finalUserText || (isControlOnly ? '' : currentTurnRef.current.userText);
                
                if (currentSession && (finalUserTextToSave || currentTurnRef.current.modelText)) {
                  const saveTurn = async () => {
                    try {
                      // Save user message
                      if (finalUserTextToSave) {
                        const userDuration = userVoiceDurationRef.current;
                        await fetch(`${API_BASE}/api/sessions/${currentSession}/messages`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ 
                            role: 'user', 
                            content: finalUserTextToSave,
                            voice_seconds: userDuration > 0 ? userDuration : undefined
                          })
                        });
                        userVoiceDurationRef.current = 0;
                      }
                      
                      // Save model message with sources
                      if (currentTurnRef.current.modelText) {
                        const modelDuration = modelVoiceDurationRef.current;
                        await fetch(`${API_BASE}/api/sessions/${currentSession}/messages`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ 
                            role: 'model', 
                            content: currentTurnRef.current.modelText,
                            sources: currentTurnRef.current.sources,
                            voice_seconds: modelDuration > 0 ? modelDuration : undefined
                          })
                        });
                        modelVoiceDurationRef.current = 0;
                      }
                      
                      // Reset for next turn
                      currentTurnRef.current = { userText: '', modelText: '', sources: [] };
                    } catch (e) {
                      console.warn("Failed to save turn to backend:", e);
                    }
                  };
                  saveTurn();
                }

                setMessages(prev => {
                  const lastMsg = prev[prev.length - 1];
                  if (lastMsg?.id === 'live-current') {
                    return [...prev.slice(0, -1), { ...lastMsg, id: Date.now().toString() }];
                  }
                  return prev;
                });
                // Only set isSpeaking to false if there are no more audio chunks queued
                if (activeSourcesRef.current.length === 0) {
                  setIsSpeaking(false);
                }
              }

              // User transcription
              if (message.serverContent?.inputTranscription?.text) {
                // Track start of user voice turn
                if (userVoiceStartTimeRef.current === 0) {
                  userVoiceStartTimeRef.current = Date.now();
                }
                
                const text = message.serverContent.inputTranscription.text;
                setTranscription(text);
                
                // Track latest and longest for best final selection
                latestTranscriptRef.current = text;
                if (text.length > currentUserTranscriptRef.current.length) {
                  currentUserTranscriptRef.current = text;
                }
                
                currentTurnRef.current.userText = text;
                lastActivityRef.current = Date.now();
                hasPromptedRef.current = false;

                const normalized = text.toLowerCase().trim().replace(/[.,?!]/g, '');
                
                // --- Help Intent Recognition ---
                const helpTriggers = ['help', 'assistance', 'i want help', 'what can you do', 'how do i use this', 'how does this work', 'show help', 'open help', 'assistance please'];
                const closeHelpPatterns = ['close help', 'close the help', 'close help window', 'close the help window', 'close this help window', 'hide help', 'dismiss help', 'never mind', 'stop showing help', 'exit help', 'done with help', 'close the window', 'close this window', 'done'];

                if (showHelpRef.current) {
                  if (closeHelpPatterns.some(p => normalized === p || normalized.startsWith(p + ' ') || normalized.endsWith(' ' + p))) {
                    setShowHelp(false);
                    return;
                  }
                } else {
                  if (helpTriggers.some(p => normalized === p || normalized.includes(p))) {
                    setShowHelp(true);
                    return;
                  }
                }

                // --- All Sources Intent Recognition ---
                const allSourcesTriggers = ['open sources', 'open all sources', 'what are all the sources', 'list sources', 'show all sources', 'what are the sources', 'show sources', 'show me all files', 'what files do you have', 'what ingested files'];
                if (allSourcesTriggers.some(p => normalized === p || normalized.includes(p))) {
                  if (!showAllSourcesModalRef.current) {
                    openAllSourcesModal();
                    return;
                  }
                }

                const endSessionPatterns = [
                  'no', 'no thanks', 'nothing else', 'thats all', 'that is all', 
                  'im done', 'i am done', 'goodbye', 'finish', 'done', 'close session',
                  'no thats all', 'no that is all', 'nothing else thanks'
                ];
                const isEndIntent = endSessionPatterns.some(p => normalized === p || normalized.startsWith(p + ' ') || normalized.endsWith(' ' + p));

                // Helper to ask the follow-up question
                const askAnythingElse = () => {
                  awaitingAnythingElseConfirmationRef.current = true;
                  sessionPromise.then(s => {
                    if (s) {
                      s.sendRealtimeInput({ text: 'Say exactly: "Is there anything else I can help you with today?"' });
                    }
                  });
                };

                // --- Source Flow Lifecycle Handling ---

                // 0. Awaiting ALL SOURCES confirmation
                if (awaitingAllSourcesConfirmationRef.current) {
                  const affirmativePatterns = ['yes', 'yeah', 'yep', 'yup', 'sure', 'okay', 'ok', 'show me', 'open them', 'yes please', 'please do', 'show it', 'open sources', 'please'];
                  const negativePatterns = ['no', 'no thanks', 'dont show', 'skip', 'not now', 'no dont', 'stop', 'not interested', 'no thanks'];

                  if (affirmativePatterns.some(p => normalized === p || normalized.startsWith(p + ' ') || normalized.endsWith(' ' + p))) {
                    console.log("Affirmative all sources confirmation detected:", normalized);
                    setShowAllSourcesModal(true);
                    setAllSourcesPage(1);
                    awaitingAllSourcesConfirmationRef.current = false;
                    return;
                  } else if (negativePatterns.some(p => normalized === p || normalized.startsWith(p + ' ') || normalized.endsWith(' ' + p))) {
                    console.log("Negative all sources confirmation detected:", normalized);
                    awaitingAllSourcesConfirmationRef.current = false;
                    askAnythingElse();
                    return;
                  }
                }

                // 1. Awaiting SHOW confirmation
                if (awaitingSourceConfirmationRef.current && lastOfferedSourcesRef.current.length > 0) {
                  const affirmativePatterns = [
                    'yes', 'yeah', 'yep', 'yup', 'sure', 'okay', 'ok', 'show me', 'open it', 
                    'show source', 'yes please', 'please do', 'show it', 'open source', 'please'
                  ];
                  const negativePatterns = ['no', 'no thanks', 'dont show', 'skip', 'not now', 'no dont', 'stop', 'not interested', 'no thanks'];
                  
                  if (affirmativePatterns.some(p => normalized === p || normalized.startsWith(p + ' ') || normalized.endsWith(' ' + p))) {
                    console.log("Affirmative source confirmation detected:", normalized);
                    const sourceToShow = lastOfferedSourcesRef.current[0];
                    setIsShowingSourcePending(true);
                    openSource(sourceToShow, lastOfferedSourcesRef.current);
                    
                    setMessages(prev => {
                      const lastMsg = prev[prev.length - 1];
                      if (lastMsg?.role === 'model') {
                        const existingSources = lastMsg.sources || [];
                        if (!existingSources.some(s => s.documentTitle === sourceToShow.documentTitle && s.pageNumber === sourceToShow.pageNumber)) {
                          return [...prev.slice(0, -1), { ...lastMsg, sources: [...existingSources, sourceToShow] }];
                        }
                      }
                      return prev;
                    });

                    setTimeout(() => setIsShowingSourcePending(false), 1000);
                    awaitingSourceConfirmationRef.current = false;
                    return; // Consume this transcript
                  } else if (negativePatterns.some(p => normalized === p || normalized.startsWith(p + ' ') || normalized.endsWith(' ' + p))) {
                    console.log("Negative source confirmation detected:", normalized);
                    awaitingSourceConfirmationRef.current = false;
                    askAnythingElse();
                    return;
                  } else if (text.length > 25) {
                    awaitingSourceConfirmationRef.current = false;
                  }
                }

                // 2. Awaiting READ confirmation
                if (selectedSourceRef.current && sourceFlowStateRef.current === 'awaiting_read_confirmation') {
                  const affirmativePatterns = ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'read it', 'please do', 'yes please', 'please read'];
                  const negativePatterns = ['no', 'no thanks', 'dont read', 'skip', 'not now', 'no dont', 'stop', 'close', 'close source', 'hide source', 'not interested'];

                  if (affirmativePatterns.some(p => normalized === p || normalized.startsWith(p + ' ') || normalized.endsWith(' ' + p))) {
                    console.log("Affirmative read confirmation detected:", normalized);
                    sourceFlowStateRef.current = 'reading_source';
                    lastReadConfirmationSourceKeyRef.current = `${selectedSourceRef.current.documentTitle}-${selectedSourceRef.current.pageNumber}`;
                  } else if (negativePatterns.some(p => normalized === p || normalized.startsWith(p + ' ') || normalized.endsWith(' ' + p))) {
                    console.log("Negative read confirmation detected:", normalized);
                    clearSourceFlow();
                    sourceFlowStateRef.current = 'awaiting_post_source_action';
                    askAnythingElse();
                    return;
                  }
                }

                // --- All Sources Modal Navigation ---
                if (showAllSourcesModalRef.current && !selectedSourceRef.current) {
                  const nextPagePatterns = ['next page', 'page next', 'page forward', 'forward page', 'next', 'skip'];
                  const prevPagePatterns = ['previous page', 'page previous', 'page back', 'back page', 'previous', 'back'];
                  const firstPagePatterns = ['first page', 'go to first page'];
                  const lastPagePatterns = ['last page', 'go to last page'];
                  const closePatterns = ['close', 'close sources', 'close all sources', 'close sources popup', 'close source popup', 'close all source documents', 'close source documents', 'hide sources', 'hide all sources', 'hide source popup', 'dismiss sources', 'dismiss sources popup', 'dismiss all sources', 'stop showing', 'exit', 'done'];

                  if (nextPagePatterns.some(p => normalized === p || normalized.startsWith(p + ' ') || normalized.endsWith(' ' + p))) {
                    const totalPages = Math.ceil(documents.length / allSourcesPageSize);
                    setAllSourcesPage(prev => Math.min(totalPages, prev + 1));
                    return;
                  }
                  if (prevPagePatterns.some(p => normalized === p || normalized.startsWith(p + ' ') || normalized.endsWith(' ' + p))) {
                    setAllSourcesPage(prev => Math.max(1, prev - 1));
                    return;
                  }
                  if (firstPagePatterns.some(p => normalized === p || normalized.startsWith(p + ' ') || normalized.endsWith(' ' + p))) {
                    setAllSourcesPage(1);
                    return;
                  }
                  if (lastPagePatterns.some(p => normalized === p || normalized.startsWith(p + ' ') || normalized.endsWith(' ' + p))) {
                    const totalPages = Math.ceil(documents.length / allSourcesPageSize);
                    setAllSourcesPage(totalPages);
                    return;
                  }
                  if (closePatterns.some(p => normalized === p || normalized.startsWith(p + ' ') || normalized.endsWith(' ' + p))) {
                    closeAllSourcesExperience();
                    sourceFlowStateRef.current = 'awaiting_post_source_action';
                    askAnythingElse();
                    return;
                  }

                  // Handle "go to page [number]"
                  if (normalized.includes('go to page') || normalized.includes('page number')) {
                    const match = normalized.match(/page (?:number )?(\d+)/);
                    if (match) {
                      const pageNum = parseInt(match[1]);
                      const totalPages = Math.ceil(documents.length / allSourcesPageSize);
                      if (pageNum >= 1 && pageNum <= totalPages) {
                        setAllSourcesPage(pageNum);
                        return;
                      }
                    }
                  }

                  // Handle "open [name]" or "open [index]"
                  const indexWords = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
                  const indexNumbers = ['1', '2', '3', '4', '5', '6', 'one', 'two', 'three', 'four', 'five', 'six'];
                  
                  for (let i = 0; i < indexWords.length; i++) {
                    const word = indexWords[i];
                    const num = indexNumbers[i];
                    const numWord = indexNumbers[i+6];
                    
                    if (normalized.includes(`open ${word}`) || normalized.includes(`show ${word}`) || normalized.includes(`view ${word}`) ||
                        normalized.includes(`open ${num}`) || normalized.includes(`show ${num}`) || normalized.includes(`view ${num}`) ||
                        normalized.includes(`open ${numWord}`) || normalized.includes(`show ${numWord}`) || normalized.includes(`view ${numWord}`)) {
                      const docIndex = (allSourcesPageRef.current - 1) * allSourcesPageSize + i;
                      if (sortedDocsRef.current[docIndex]) {
                        const doc = sortedDocsRef.current[docIndex];
                        openSource({ documentTitle: doc.title, pageNumber: 1, content: doc.content, excerpt: doc.content }, sortedDocsRef.current.map(d => ({ documentTitle: d.title, pageNumber: 1, content: d.content, excerpt: d.content })));
                        setActivePreviewIndex(docIndex);
                        
                        // AI follow-up
                        sessionPromise.then(s => {
                          if (s) {
                            s.sendRealtimeInput({ text: `I’ve opened ${doc.title}. Would you like information about it?` });
                          }
                        });
                        return;
                      }
                    }
                  }
                  
                  // Try matching by name
                  for (const doc of sortedDocsRef.current) {
                    if (normalized.includes(`open ${doc.title.toLowerCase()}`) || normalized.includes(`show ${doc.title.toLowerCase()}`)) {
                      const docIndex = sortedDocsRef.current.indexOf(doc);
                      openSource({ documentTitle: doc.title, pageNumber: 1, content: doc.content, excerpt: doc.content }, sortedDocsRef.current.map(d => ({ documentTitle: d.title, pageNumber: 1, content: d.content, excerpt: d.content })));
                      setActivePreviewIndex(docIndex);
                      
                      // AI follow-up
                      sessionPromise.then(s => {
                        if (s) {
                          s.sendRealtimeInput({ text: `I’ve opened ${doc.title}. Would you like information about it?` });
                        }
                      });
                      return;
                    }
                  }
                }

                // --- Multi-Source Navigation & Closing ---
                if (selectedSourceRef.current) {
                  const nextPatterns = ['next', 'next source', 'show next', 'go next', 'forward', 'skip'];
                  const prevPatterns = ['previous', 'previous source', 'go back', 'show previous', 'back'];
                  const closePatterns = ['close', 'close source', 'hide source', 'stop showing', 'not interested', 'no thanks', 'done', 'close the window', 'close window', 'close this window', 'close this source', 'close this document', 'hide this window', 'dismiss this window'];
                  const closeAllPatterns = ['close all', 'hide all', 'close all sources', 'close sources popup', 'close source popup', 'close all source documents', 'close source documents', 'hide all sources', 'hide source popup', 'dismiss sources popup', 'dismiss all sources', 'close all source windows', 'close all documents', 'hide all source documents', 'exit all sources'];

                  if (nextPatterns.some(p => normalized === p || normalized.startsWith(p + ' ') || normalized.endsWith(' ' + p))) {
                    if (activePreviewIndexRef.current < activePreviewSourcesRef.current.length - 1) {
                      setActivePreviewIndex(prev => prev + 1);
                      return;
                    }
                  } else if (prevPatterns.some(p => normalized === p || normalized.startsWith(p + ' ') || normalized.endsWith(' ' + p))) {
                    if (activePreviewIndexRef.current > 0) {
                      setActivePreviewIndex(prev => prev - 1);
                      return;
                    }
                  } else if (closeAllPatterns.some(p => normalized === p || normalized.startsWith(p + ' ') || normalized.endsWith(' ' + p))) {
                    closeAllSourcesExperience();
                    sourceFlowStateRef.current = 'awaiting_post_source_action';
                    askAnythingElse();
                    return;
                  } else if (closePatterns.some(p => normalized === p || normalized.startsWith(p + ' ') || normalized.endsWith(' ' + p))) {
                    clearSourceFlow();
                    if (!showAllSourcesModalRef.current) {
                      sourceFlowStateRef.current = 'awaiting_post_source_action';
                      askAnythingElse();
                    }
                    return;
                  }
                }

                // 3. Post-source or General End Session Detection
                if (isEndIntent) {
                  if (awaitingAnythingElseConfirmationRef.current) {
                    if (!isEndingSessionRef.current) {
                      isEndingSessionRef.current = true;
                      console.log("End session confirmed:", normalized);
                      const finalPhrase = "I am printing your session receipt now. You can scan the QR code on the screen to access your questions, answers, and source documents.";
                      
                      sessionPromise.then(s => {
                        if (s) {
                          s.sendRealtimeInput({ text: `Say exactly: "${finalPhrase}"` });
                        }
                      });

                      setTimeout(() => {
                        enterSummaryMode();
                      }, 10000);
                    }
                    return; // Consume this transcript
                  } else {
                    console.log("End intent detected, asking follow-up:", normalized);
                    askAnythingElse();
                    return;
                  }
                }

                // Reset the "anything else" flag if user asks a substantive question
                if (text.length > 20 && !isEndIntent) {
                  awaitingAnythingElseConfirmationRef.current = false;
                }

                // Handle voice commands when summary is showing
                if (showSummary) {
                  if (text.includes('print')) {
                    if (session) {
                      printSessionReceipt(session).catch(e => console.error("Voice print failed:", e));
                    }
                  } else if (text.includes('close') || text.includes('done') || text.includes('finish')) {
                    handleReset();
                  }
                }
              }

              // Model transcription
              if (message.serverContent?.modelTurn?.parts) {
                lastActivityRef.current = Date.now();
                hasPromptedRef.current = false;
                setIsSpeaking(true); // Ensure text is shown when model starts responding
                const textParts = message.serverContent.modelTurn.parts.filter(p => p.text).map(p => p.text).join("");
                if (textParts) {
                  currentTurnRef.current.modelText += textParts;
                  setMessages(prev => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg?.role === 'model' && lastMsg.id === 'live-current') {
                      return [...prev.slice(0, -1), { ...lastMsg, content: lastMsg.content + textParts }];
                    }
                    return [...prev, {
                      id: 'live-current',
                      role: 'model',
                      content: textParts,
                      created_at: new Date().toISOString()
                    }];
                  });
                }
              }
            } catch (e) {
              console.error("Error processing message:", e);
            }
          },
          onclose: () => {
            console.log("Live session closed. Intentional:", intentionalCloseRef.current);
            if (!intentionalCloseRef.current && isPresentRef.current) {
              console.warn("Unexpected session closure while user is present. Attempting reconnect.");
              
              // DO NOT reset the session if it's an unexpected close and user is present
              if (reconnectAttemptsRef.current < 3) {
                setConnectionStatus('connecting');
                isReconnectingRef.current = true;
                
                if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = setTimeout(() => {
                  if (isPresentRef.current && !intentionalCloseRef.current) {
                    reconnectAttemptsRef.current++;
                    console.log(`Attempting reconnect #${reconnectAttemptsRef.current}...`);
                    connectLive(docsToUse, isReturn);
                  }
                }, 1500);
              } else {
                console.error("Max reconnect attempts reached.");
                setConnectionStatus('error');
                setError("Connection lost. Please try again.");
                clearSourceFlow();
              }
            } else {
              setConnectionStatus('idle');
              clearSourceFlow(); // Clear source UI when session ends
              if (!intentionalCloseRef.current) {
                isPresentRef.current = false;
                setIsPresent(false);
              }
            }
            intentionalCloseRef.current = false;
            liveSessionRef.current = null;
            isReconnectingRef.current = false;
            
            // Reset billing refs
            userVoiceStartTimeRef.current = 0;
            userVoiceDurationRef.current = 0;
            modelVoiceDurationRef.current = 0;
            isModelSpeakingRef.current = false;
          },
          onerror: (err) => {
            console.error("Live session error:", err);
            if (isPresentRef.current) {
              setError("Connection error. Please try again.");
              setConnectionStatus('error');
              if (err.message?.includes("Requested entity was not found")) {
                (window as any).aistudio?.openSelectKey();
              }
            }
          },
        }
      });

      liveSessionRef.current = await sessionPromise;
    } catch (err) {
      console.error("Failed to connect live:", err);
      setConnectionStatus('error');
      setError("Failed to connect to AI voice service.");
    } finally {
      isConnectingRef.current = false;
    }
  };

  const playAudioChunk = (base64Data: string) => {
    if (!audioContextRef.current) return;
    setIsSpeaking(true);
    
    try {
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
      
      const pcmData = new Int16Array(bytes.buffer);
      const floatData = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) floatData[i] = pcmData[i] / 32768.0;

      // Gemini Live output is 24000Hz
      const buffer = audioContextRef.current.createBuffer(1, floatData.length, 24000);
      buffer.getChannelData(0).set(floatData);
      
      const currentTime = audioContextRef.current.currentTime;
      
      // If we are starting fresh or fell behind, reset nextStartTime
      if (nextStartTime.current < currentTime) {
        nextStartTime.current = currentTime + 0.05; // 50ms lookahead buffer
      }
      
      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);
      
      source.start(nextStartTime.current);
      activeSourcesRef.current.push(source);
      nextStartTime.current += buffer.duration;
      modelVoiceDurationRef.current += buffer.duration;
      
      // Keep track of the source so we can stop it on interruption
      // We store it in a way that we can stop multiple if they are queued
      const sourceNode = source;
      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== sourceNode);
        if (currentSourceRef.current === sourceNode) {
          currentSourceRef.current = null;
        }
        // If this was the last source and we've already received turnComplete, set isSpeaking to false
        if (activeSourcesRef.current.length === 0) {
          setIsSpeaking(false);
        }
      };
      currentSourceRef.current = source;
    } catch (e) {
      console.error("Error playing audio chunk:", e);
    }
  };

  const stopAudioPlayback = () => {
    activeSourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch (e) {}
    });
    activeSourcesRef.current = [];
    currentSourceRef.current = null;
    // Note: nextStartTime.current = 0 will be handled in playAudioChunk
    nextStartTime.current = 0;
    setIsSpeaking(false);
    isModelSpeakingRef.current = false;
  };

  useEffect(() => {
    if (showSummary) {
      console.log("Summary shown, stopping audio and ending session...");
      stopAudioPlayback();
      intentionalCloseRef.current = true;
      if (liveSessionRef.current) {
        try { liveSessionRef.current.close(); } catch (e) {}
        liveSessionRef.current = null;
      }
      setIsListening(false);
      setIsThinking(false);
      setIsSpeaking(false);
    }
  }, [showSummary]);

  // Handle mode switching session continuity
  const handleSend = async (text: string) => {
    if (!text.trim() || !session || showSummary) return;
    if (billingAccessState === 'blocked') {
      setError("AI features are currently suspended for this account.");
      return;
    }
    
    lastActivityRef.current = Date.now();
    hasPromptedRef.current = false;

    if (isVoiceMode && liveSessionRef.current) {
      liveSessionRef.current.sendRealtimeInput({
        media: { data: btoa(text), mimeType: 'text/plain' }
      });
      setTranscription(text);
    } else {
      const userMsg: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: text,
        created_at: new Date().toISOString()
      };
      setMessages(prev => [...prev, userMsg]);
      setIsThinking(true);
      
      try {
        // Save user message to backend
        const saveRes = await fetch(`${API_BASE}/api/sessions/${session}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'user', content: text })
        });

        if (saveRes.status === 402) {
          const errorData = await saveRes.json();
          setError(errorData.message || "AI features are currently suspended for this account.");
          setBillingStatus({ isBlocked: true, status: 'blocked' });
          return;
        }

        const history = messages.map(m => ({ role: m.role, content: m.content }));
        const result = await generateGroundedAnswer(text, project, documents, history);
        
        const aiMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'model',
          content: result.answer,
          sources: result.sources,
          created_at: new Date().toISOString()
        };
        setMessages(prev => [...prev, aiMsg]);

        // Save AI message to backend
        fetch(`${API_BASE}/api/sessions/${session}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            role: 'model', 
            content: result.answer, 
            sources: result.sources 
          })
        }).catch(e => console.warn("Failed to save AI message:", e));

        if (result.showSummary) {
          setShowSummary(true);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsThinking(false);
        setInput('');
      }
    }
  };

  return (
    <div className="app-container">
      <div className={`device-frame bg-dots ${isPresent ? 'is-voice' : ''}`}>
        <AnimatePresence mode="wait">
          {!isPresent && !showSummary ? (
            <motion.div 
              key="waiting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full w-full flex flex-col items-center justify-center text-white p-8 overflow-hidden relative"
            >
              <video ref={videoRef} autoPlay muted className="absolute inset-0 w-full h-full object-cover opacity-10 grayscale brightness-50" />
              <div className="absolute inset-0 bg-gradient-to-t from-app-bg via-app-bg/60 to-transparent" />
              
              <motion.div 
                initial={{ opacity: 0, y: 20 }} 
                animate={{ opacity: 1, y: 0 }} 
                className="z-10 text-center w-full max-w-md flex flex-col items-center"
              >
                <div className="relative mb-12 flex justify-center items-center">
                  <div className="w-32 h-32 bg-app-accent/20 rounded-full blur-3xl absolute inset-0 animate-orb-pulse" />
                  <img src="https://caribdesigns.com/voiceit-logo.png" alt="VoiceIt" className="h-72 w-auto relative z-10" referrerPolicy="no-referrer" />
                </div>
                
                <p className="text-app-muted text-sm uppercase tracking-[0.3em] font-medium mb-12">AI Assistant</p>
                
                <div className="h-24 flex flex-col items-center justify-center mb-8">
                  {connectionStatus === 'idle' && (
                    <p className="text-lg text-white/60 font-light max-w-xs mx-auto leading-tight animate-pulse">Waiting for presence...</p>
                  )}
                  {connectionStatus === 'connecting' && (
                    <div className="flex flex-col items-center gap-4">
                      <p className="text-lg text-app-accent font-medium tracking-tight">Establishing secure link...</p>
                      <div className="flex gap-1.5">
                        <motion.div animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }} transition={{ repeat: Infinity, duration: 1.5 }} className="w-2 h-2 bg-app-accent rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
                        <motion.div animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.2 }} className="w-2 h-2 bg-app-accent rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
                        <motion.div animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.4 }} className="w-2 h-2 bg-app-accent rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
                      </div>
                    </div>
                  )}
                  {connectionStatus === 'error' && (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 rounded-full bg-app-danger/10 flex items-center justify-center mb-2">
                        <AlertCircle className="w-6 h-6 text-app-danger" />
                      </div>
                      <p className="text-lg text-app-danger font-medium">Connection failed</p>
                      <p className="text-xs text-app-muted">Please check your configuration.</p>
                    </div>
                  )}
                </div>
                
                <button 
                  onClick={startSession} 
                  disabled={connectionStatus === 'connecting'}
                  className={`group relative mt-4 w-full px-8 py-4 rounded-2xl text-sm font-bold transition-all overflow-hidden ${
                    connectionStatus === 'connecting' 
                      ? 'bg-white/5 text-white/20 cursor-not-allowed' 
                      : 'bg-app-accent text-white shadow-[0_0_30px_rgba(59,130,246,0.3)] hover:shadow-[0_0_40px_rgba(59,130,246,0.5)] active:scale-[0.98]'
                  }`}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                  <span className="relative flex items-center justify-center gap-2">
                    {connectionStatus === 'connecting' ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        Enter Interaction Zone
                        <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </span>
                </button>
              </motion.div>
              
              <div className="absolute bottom-12 left-0 w-full flex justify-center px-8">
                <div className="flex items-center gap-6 text-[10px] font-bold uppercase tracking-[0.2em] text-app-muted">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                    System Online
                  </div>
                  <div className="w-1 h-1 rounded-full bg-white/10" />
                  <div>v2.4.0-Premium</div>
                </div>
              </div>
            </motion.div>
          ) : isVoiceMode ? (
        <motion.div 
          key="voice"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="min-h-screen w-full bg-bloom text-white flex flex-col items-center overflow-y-auto relative pb-32"
        >
        {/* Ambient Glows */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] md:w-[1400px] h-[1000px] md:h-[1400px] bg-app-accent/15 rounded-full blur-[150px] md:blur-[220px]" />
          <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-app-accent/10 to-transparent" />
        </div>

        {/* Top Bar */}
        <div className="w-full flex justify-between items-center z-20 px-8 py-8">
          <div className="flex items-center gap-4">
            <img src="https://caribdesigns.com/voiceit-logo.png" alt="VoiceIt" className="h-24 w-auto" referrerPolicy="no-referrer" />
          </div>

          <div className="flex items-center gap-6">
            <button 
              onClick={() => setShowHelp(true)}
              className="flex items-center gap-2 px-5 py-2 bg-surface-container/50 backdrop-blur-xl rounded-full text-xs font-bold tracking-wider text-on-surface/70 hover:text-on-surface hover:bg-surface-container/80 transition-all"
            >
              <CircleHelp className="w-4 h-4 text-primary-container" />
              Help
            </button>
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 text-on-surface/40 hover:text-on-surface transition-colors"
            >
              <Settings className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Upper Status Pill */}
        {messages[messages.length - 1]?.sources && messages[messages.length - 1]?.sources!.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="z-20 mt-2"
          >
            <div className="px-5 py-2 bg-surface-container/40 backdrop-blur-xl rounded-full flex items-center gap-3 text-[10px] font-sans font-black uppercase tracking-[0.2em] text-primary-container">
              <Layers className="w-3.5 h-3.5" />
              SOURCE 1 OF {messages[messages.length - 1]?.sources!.length}
            </div>
          </motion.div>
        )}

        {/* Main Content - Orb Centered */}
        <div className="z-10 flex flex-col items-center flex-1 justify-center w-full max-w-xl px-8">
          <div className="relative mb-8">
            <VoiceOrb 
              isSpeaking={isSpeaking} 
              isListening={isListening}
              isThinking={isThinking} 
              isShowingSourcePending={isShowingSourcePending}
              onClick={isSpeaking ? stopAudioPlayback : undefined} 
            />
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
            />
          </div>

          <div className="text-center w-full mb-16">
            <AnimatePresence mode="wait">
              <motion.div 
                key={isListening ? "listening" : isThinking ? "thinking" : isSpeaking ? "speaking" : "idle"}
                initial={{ opacity: 0, y: 10 }} 
                animate={{ opacity: 1, y: 0 }} 
                exit={{ opacity: 0, y: -10 }} 
                className="space-y-3"
              >
                <h3 className="text-4xl md:text-6xl font-sans font-black tracking-tighter text-on-surface">
                  {isListening ? (
                    <motion.span 
                      animate={{ 
                        opacity: [0.4, 1, 0.4],
                        scale: [0.98, 1, 0.98],
                        textShadow: ["0 0 0px rgba(255,255,255,0)", "0 0 10px rgba(255,255,255,0.3)", "0 0 0px rgba(255,255,255,0)"]
                      }} 
                      transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                    >
                      Listening<motion.span animate={{ opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 1.5, times: [0, 0.3, 1] }}>.</motion.span>
                      <motion.span animate={{ opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.3, times: [0, 0.3, 1] }}>.</motion.span>
                      <motion.span animate={{ opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.6, times: [0, 0.3, 1] }}>.</motion.span>
                    </motion.span>
                  ) : isThinking ? "Analyzing..." : isSpeaking ? "Speaking..." : "Ready."}
                </h3>
                <p className="text-[10px] md:text-xs font-sans font-black uppercase tracking-[0.4em] text-on-surface/20">
                  {isListening ? "ENVIRONMENTAL NOISE SUPPRESSED" : "AWAITING YOUR VOICE"}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Assistant Response Card - Intentional Asymmetry */}
          <AnimatePresence>
            {(isSpeaking || isThinking || isListening) && (
              <motion.div 
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.95 }}
                className="w-full p-8 bg-surface-container/40 backdrop-blur-3xl rounded-tr-[48px] rounded-bl-[48px] rounded-tl-2xl rounded-br-2xl shadow-2xl relative overflow-hidden group"
              >
                <div className="absolute top-0 left-0 w-1.5 h-full bg-primary-container/30" />
                <div className="flex gap-6">
                  <div className="w-12 h-12 rounded-2xl bg-surface-highest flex items-center justify-center">
                    <Activity className="w-6 h-6 text-primary-container" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <p className="text-[10px] font-sans font-black uppercase tracking-[0.2em] text-on-surface/30">Assistant</p>
                    <p className="text-base md:text-lg leading-relaxed text-on-surface/90 font-medium">
                      {shortAIText}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom Action Bar - Fixed to bottom */}
        <div className="fixed bottom-0 left-0 w-full px-8 py-10 z-[100] bg-gradient-to-t from-surface via-surface/90 to-transparent backdrop-blur-sm">
          <div className="max-w-md mx-auto flex items-center justify-between">
            {/* Transcript */}
            <div className="flex flex-col items-center gap-3">
              <button 
                onClick={() => setIsVoiceMode(false)}
                className="p-4 bg-surface-container/50 rounded-2xl text-on-surface/40 hover:text-on-surface transition-all hover:bg-surface-highest"
              >
                <FileText className="w-6 h-6" />
              </button>
              <span className="text-[9px] font-sans font-black uppercase tracking-widest text-on-surface/20">Transcript</span>
            </div>

            {/* Mute */}
            <div className="flex flex-col items-center gap-3">
              <button 
                onClick={() => setIsMuted(!isMuted)}
                className={`p-4 rounded-2xl transition-all ${isMuted ? 'bg-app-danger/10 text-app-danger' : 'bg-surface-container/50 text-on-surface/40 hover:text-on-surface hover:bg-surface-highest'}`}
              >
                {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </button>
              <span className="text-[9px] font-sans font-black uppercase tracking-widest text-on-surface/20">{isMuted ? 'Muted' : 'Mute'}</span>
            </div>

            {/* End Session */}
            <div className="flex flex-col items-center gap-3 -mt-10">
              <button 
                onClick={() => setShowSummary(true)}
                className="w-20 h-20 rounded-full bg-gradient-to-br from-app-danger to-red-700 flex items-center justify-center text-white shadow-[0_10px_30px_rgba(239,68,68,0.4)] hover:scale-110 active:scale-95 transition-all"
              >
                <PhoneOff className="w-8 h-8" />
              </button>
              <span className="text-[9px] font-sans font-black uppercase tracking-widest text-app-danger mt-1">End Session</span>
            </div>

            {/* Sources */}
            <div className="flex flex-col items-center gap-3">
              <button 
                onClick={() => {
                  if (selectedSource) {
                    clearSourceFlow();
                  } else if (showAllSourcesModal) {
                    setShowAllSourcesModal(false);
                  } else {
                    // Trigger "all sources" flow
                    awaitingAllSourcesConfirmationRef.current = true;
                    if (liveSessionRef.current) {
                      liveSessionRef.current.sendRealtimeInput({ text: 'Say exactly: "Would you like me to show all ingested source files?"' });
                    }
                  }
                }}
                className={`p-4 rounded-2xl transition-all relative ${(selectedSource || showAllSourcesModal) ? 'bg-primary/20 text-primary-container' : 'bg-surface-container/50 text-on-surface/40 hover:text-on-surface hover:bg-surface-highest'}`}
              >
                <Database className="w-6 h-6" />
                {(selectedSource || showAllSourcesModal) && <div className="absolute top-3 right-3 w-2.5 h-2.5 bg-primary-container rounded-full border-2 border-surface" />}
              </button>
              <span className="text-[9px] font-sans font-black uppercase tracking-widest text-on-surface/20">Sources</span>
            </div>

            {/* Text Mode */}
            <div className="flex flex-col items-center gap-3">
              <button 
                onClick={() => setIsVoiceMode(false)}
                className="p-4 bg-surface-container/50 rounded-2xl text-on-surface/40 hover:text-on-surface transition-all hover:bg-surface-highest"
              >
                <MessageSquare className="w-6 h-6" />
              </button>
              <span className="text-[9px] font-sans font-black uppercase tracking-widest text-on-surface/20">Text Mode</span>
            </div>
          </div>
        </div>

        <input type="text" className="opacity-0 absolute" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') { handleSend((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; } }} />
        
        <AnimatePresence>
          {showAllSourcesModal && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.9 }} 
              className="fixed inset-0 z-[110] flex items-center justify-center p-4 md:p-8 bg-black/80 backdrop-blur-md"
            >
              <div className="bg-surface-low/95 backdrop-blur-3xl w-full max-w-2xl rounded-[40px] border border-outline-variant shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
                <div className="p-6 border-b border-outline-variant flex justify-between items-center bg-surface-container/30">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center">
                      <Database className="w-6 h-6 text-primary-container" />
                    </div>
                    <div className="flex flex-col">
                      <h3 className="font-sans font-extrabold text-on-surface leading-tight tracking-tight">Project Sources</h3>
                      <span className="text-[10px] text-primary-container font-sans font-black uppercase tracking-[0.2em] mt-1">
                        {documents.length} Ingested Documents
                      </span>
                    </div>
                  </div>
                  <button 
                    onClick={() => setShowAllSourcesModal(false)} 
                    className="px-5 py-2.5 bg-surface-highest/50 rounded-2xl text-[10px] font-sans font-black uppercase tracking-widest text-on-surface/40 hover:text-on-surface transition-all"
                  >
                    Close
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 bg-dots">
                  <div className="grid grid-cols-1 gap-3">
                    {sortedDocs.slice((allSourcesPage - 1) * allSourcesPageSize, allSourcesPage * allSourcesPageSize).map((doc, idx) => (
                      <button
                        key={doc.id}
                        onClick={() => openSource({ documentTitle: doc.title, pageNumber: 1, content: doc.content, excerpt: doc.content }, sortedDocs.map(d => ({ documentTitle: d.title, pageNumber: 1, content: d.content, excerpt: d.content })))}
                        className="flex items-center justify-between p-4 bg-surface-container/40 hover:bg-surface-highest rounded-2xl border border-outline-variant/50 transition-all group text-left"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-surface-highest flex items-center justify-center text-on-surface/40 group-hover:text-primary-container transition-colors">
                            <span className="text-xs font-black">{(allSourcesPage - 1) * allSourcesPageSize + idx + 1}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-on-surface group-hover:text-primary-container transition-colors truncate max-w-[300px]">{doc.title}</span>
                            <span className="text-[9px] font-black uppercase tracking-widest text-on-surface/20">Source Document</span>
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-on-surface/10 group-hover:text-primary-container group-hover:translate-x-1 transition-all" />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-6 border-t border-outline-variant flex justify-between items-center bg-surface-container/30">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setAllSourcesPage(prev => Math.max(1, prev - 1))}
                      disabled={allSourcesPage === 1}
                      className={`p-3 rounded-xl glass-panel transition-all ${allSourcesPage === 1 ? 'opacity-20 cursor-not-allowed' : 'hover:bg-white/10 hover:text-primary-container'}`}
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface/40 px-4">
                      Page {allSourcesPage} of {Math.ceil(documents.length / allSourcesPageSize)}
                    </span>
                    <button 
                      onClick={() => setAllSourcesPage(prev => Math.min(Math.ceil(documents.length / allSourcesPageSize), prev + 1))}
                      disabled={allSourcesPage >= Math.ceil(documents.length / allSourcesPageSize)}
                      className={`p-3 rounded-xl glass-panel transition-all ${allSourcesPage >= Math.ceil(documents.length / allSourcesPageSize) ? 'opacity-20 cursor-not-allowed' : 'hover:bg-white/10 hover:text-primary-container'}`}
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                  <button 
                    onClick={() => setShowAllSourcesModal(false)} 
                    className="px-10 py-4 bg-primary-container text-on-primary-container rounded-2xl text-sm font-bold shadow-lg hover:brightness-110 active:scale-95 transition-all"
                  >
                    Done
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {selectedSource && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.9 }} 
              className="fixed inset-0 z-[110] flex items-center justify-center p-4 md:p-8 bg-black/80 backdrop-blur-md"
            >
              <div className="bg-surface-low/95 backdrop-blur-3xl w-full max-w-2xl rounded-[40px] border border-outline-variant shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
                <div className="p-6 border-b border-outline-variant flex justify-between items-center bg-surface-container/30">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center">
                      <FileText className="w-6 h-6 text-primary-container" />
                    </div>
                    <div className="flex flex-col">
                      <h3 className="font-sans font-extrabold text-on-surface truncate max-w-[150px] md:max-w-[200px] leading-tight tracking-tight">{selectedSource.documentTitle}</h3>
                      {activePreviewSources.length > 1 && (
                        <span className="text-[10px] text-primary-container font-sans font-black uppercase tracking-[0.2em] mt-1">
                          Source {activePreviewIndex + 1} of {activePreviewSources.length}
                        </span>
                      )}
                    </div>
                  </div>
                  <button 
                    onClick={() => clearSourceFlow()} 
                    className="px-5 py-2.5 bg-surface-highest/50 rounded-2xl text-[10px] font-sans font-black uppercase tracking-widest text-on-surface/40 hover:text-on-surface transition-all"
                  >
                    Close
                  </button>
                </div>
                <div className="flex-1 p-6 md:p-10 overflow-y-auto relative group bg-dots">
                  {activePreviewSources.length > 1 && (
                    <>
                      <button 
                        onClick={() => setActivePreviewIndex(prev => Math.max(0, prev - 1))}
                        disabled={activePreviewIndex === 0}
                        className={`absolute left-4 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full glass-panel flex items-center justify-center transition-all ${activePreviewIndex === 0 ? 'opacity-20 cursor-not-allowed' : 'hover:bg-white/10 hover:scale-110 active:scale-95 shadow-[0_0_20px_rgba(0,0,0,0.3)]'}`}
                      >
                        <ChevronLeft className="w-6 h-6 text-white" />
                      </button>
                      <button 
                        onClick={() => setActivePreviewIndex(prev => Math.min(activePreviewSources.length - 1, prev + 1))}
                        disabled={activePreviewIndex === activePreviewSources.length - 1}
                        className={`absolute right-4 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full glass-panel flex items-center justify-center transition-all ${activePreviewIndex === activePreviewSources.length - 1 ? 'opacity-20 cursor-not-allowed' : 'hover:bg-white/10 hover:scale-110 active:scale-95 shadow-[0_0_20px_rgba(0,0,0,0.3)]'}`}
                      >
                        <ChevronRight className="w-6 h-6 text-white" />
                      </button>
                    </>
                  )}
                  <div className="glass-panel rounded-[40px] p-8 md:p-14 relative shadow-2xl border-white/5 h-full min-h-[420px] max-h-[65vh] overflow-y-auto">
                    <div className="absolute -top-24 -right-24 w-64 h-64 bg-app-accent/5 rounded-full blur-3xl" />
                    <div className="absolute top-6 right-8 text-[10px] font-bold uppercase tracking-[0.3em] text-app-accent">Page {selectedSource.pageNumber}</div>
                    <div className="space-y-6 relative z-10 text-left">
                      <div className="h-4 w-3/4 bg-white/5 rounded-full" />
                      <div className="h-4 w-full bg-white/5 rounded-full" />
                      <div className="h-4 w-5/6 bg-white/5 rounded-full" />
                      <div className="py-10 px-8 bg-app-accent/5 border-l-2 border-app-accent rounded-r-[32px] text-white/90 leading-relaxed shadow-inner">
                        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-app-accent mb-4 opacity-70">Document Content</p>
                        <pre className="whitespace-pre-wrap font-sans text-sm md:text-base">
                          {selectedSource.content || selectedSource.excerpt}
                        </pre>
                      </div>
                      <div className="h-4 w-full bg-white/5 rounded-full" />
                      <div className="h-4 w-2/3 bg-white/5 rounded-full" />
                    </div>
                  </div>
                </div>
                <div className="p-6 border-t border-white/10 flex justify-center gap-4 bg-white/5">
                  {activePreviewSources.length > 1 && (
                    <div className="flex gap-2 mr-auto">
                      <button 
                        onClick={() => setActivePreviewIndex(prev => Math.max(0, prev - 1))}
                        disabled={activePreviewIndex === 0}
                        className={`px-5 py-3 rounded-2xl glass-panel text-[10px] font-bold uppercase tracking-[0.2em] transition-all ${activePreviewIndex === 0 ? 'opacity-20 cursor-not-allowed' : 'hover:bg-white/10 hover:text-app-accent'}`}
                      >
                        Previous
                      </button>
                      <button 
                        onClick={() => setActivePreviewIndex(prev => Math.min(activePreviewSources.length - 1, prev + 1))}
                        disabled={activePreviewIndex === activePreviewSources.length - 1}
                        className={`px-5 py-3 rounded-2xl glass-panel text-[10px] font-bold uppercase tracking-[0.2em] transition-all ${activePreviewIndex === activePreviewSources.length - 1 ? 'opacity-20 cursor-not-allowed' : 'hover:bg-white/10 hover:text-app-accent'}`}
                      >
                        Next
                      </button>
                    </div>
                  )}
                  <button 
                    onClick={() => clearSourceFlow()} 
                    className="px-12 py-4 bg-app-accent hover:brightness-110 rounded-2xl text-sm font-bold transition-all shadow-[0_0_30px_rgba(59,130,246,0.3)] active:scale-95"
                  >
                    Got it
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {remainingSeconds !== null && (
          <div className="fixed bottom-4 right-4 md:bottom-8 md:right-8 z-[150] pointer-events-none">
            <div className={`px-6 py-3 rounded-[24px] backdrop-blur-2xl border-2 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center gap-4 transition-all duration-500 pointer-events-auto ${
              remainingSeconds < 10 
                ? 'bg-app-danger/30 border-app-danger text-white animate-pulse scale-110' 
                : 'bg-white/5 border-white/10 text-white/90'
            }`}>
              <div className="relative">
                <Clock className={`w-5 h-5 ${remainingSeconds < 10 ? 'animate-spin-slow text-app-danger' : 'text-app-accent'}`} />
                {remainingSeconds < 10 && <div className="absolute inset-0 bg-app-danger blur-md animate-pulse rounded-full" />}
              </div>
              <div className="flex flex-col">
                <span className="text-[9px] uppercase tracking-[0.3em] opacity-50 font-bold">Session Time</span>
                <span className="text-lg font-mono font-bold leading-none tracking-tighter">
                  {Math.floor(remainingSeconds / 60)}:{(remainingSeconds % 60).toString().padStart(2, '0')}
                </span>
              </div>
            </div>
          </div>
        )}

        {showSummary && (
          <SummaryPopup 
            sessionId={session || 'unknown'} 
            onClose={handleReset} 
          />
        )}

        <AnimatePresence>
          {showSettings && (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }} 
                animate={{ scale: 1, y: 0 }} 
                exit={{ scale: 0.9, y: 20 }} 
                className="bg-surface-low w-full max-w-md rounded-[32px] border border-outline-variant shadow-2xl overflow-hidden"
              >
                <div className="p-6 border-b border-outline-variant flex justify-between items-center">
                  <h3 className="text-xl font-bold text-on-surface">Interface Settings</h3>
                  <button onClick={() => setShowSettings(false)} className="p-2 text-on-surface/40 hover:text-on-surface">
                    <X className="w-6 h-6" />
                  </button>
                </div>
                <div className="p-8 space-y-6">
                  <div className="space-y-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-app-muted">Session Info</p>
                    <div className="bg-white/5 p-4 rounded-2xl space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-on-surface/40">Project</span>
                        <span className="text-on-surface font-medium">{project.title}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-on-surface/40">Session ID</span>
                        <span className="text-on-surface font-mono text-xs">{session?.substring(0, 12)}...</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-on-surface/40">Mode</span>
                        <span className="text-app-accent font-bold uppercase tracking-tighter">{isVoiceMode ? 'Voice' : 'Text'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-app-muted">Controls</p>
                    <div className="grid grid-cols-2 gap-4">
                      <button 
                        onClick={() => { setIsMuted(!isMuted); setShowSettings(false); }}
                        className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-2 ${isMuted ? 'bg-app-danger/10 border-app-danger/30 text-app-danger' : 'bg-white/5 border-white/10 text-on-surface/60'}`}
                      >
                        {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                        <span className="text-[10px] font-bold uppercase tracking-widest">{isMuted ? 'Unmute' : 'Mute'}</span>
                      </button>
                      <button 
                        onClick={() => { setIsVoiceMode(!isVoiceMode); setShowSettings(false); }}
                        className="p-4 rounded-2xl border border-white/10 bg-white/5 text-on-surface/60 transition-all flex flex-col items-center gap-2"
                      >
                        {isVoiceMode ? <MessageSquare className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                        <span className="text-[10px] font-bold uppercase tracking-widest">Switch Mode</span>
                      </button>
                    </div>
                  </div>

                  <button 
                    onClick={() => { setShowSettings(false); setShowSummary(true); }}
                    className="w-full py-4 bg-app-danger/10 hover:bg-app-danger/20 border border-app-danger/30 rounded-2xl text-app-danger text-sm font-bold transition-all flex items-center justify-center gap-2"
                  >
                    <PhoneOff className="w-4 h-4" />
                    End Session
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <HelpPopup 
          isOpen={showHelp} 
          onClose={() => setShowHelp(false)} 
          projectTitle={project.title}
          projectDescription={project.description}
          isVoiceMode={isVoiceMode}
        />
      </motion.div>
    ) : (
      <motion.div
        key="text"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full w-full bg-app-bg text-white flex flex-col font-sans overflow-hidden relative"
            >
              {/* Header */}
              <header className="p-6 border-b border-white/5 flex justify-between items-center glass-panel z-20">
                <div className="flex items-center gap-3">
                  <img src="https://caribdesigns.com/voiceit-logo.png" alt="VoiceIt" className="h-24 w-auto" referrerPolicy="no-referrer" />
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] uppercase tracking-widest text-app-muted truncate max-w-[120px] font-bold">{project.title}</span>
                      <span className="w-1 h-1 bg-white/10 rounded-full" />
                      <span className="text-[9px] text-app-accent uppercase tracking-widest font-bold">{documents.length} Docs</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setShowSettings(true)}
                    className="p-2 text-on-surface/40 hover:text-on-surface transition-colors mr-2"
                  >
                    <Settings className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => setIsVoiceMode(true)} 
                    className="px-5 py-2.5 bg-app-accent/10 hover:bg-app-accent/20 border border-app-accent/30 rounded-full text-xs font-bold text-app-accent transition-all flex items-center gap-2"
                  >
                    <Mic className="w-4 h-4" />
                    Voice
                  </button>
                </div>
              </header>

              <main className="flex-1 flex overflow-hidden relative">
                <div className={`flex-1 flex flex-col transition-all duration-500 ${selectedSource ? 'hidden md:flex md:w-1/2' : 'w-full'}`}>
                  {billingAccessState !== 'ok' && (
                    <div className={`p-4 border-b flex items-center gap-3 backdrop-blur-md ${
                      billingAccessState === 'blocked' 
                        ? 'bg-app-danger/10 border-app-danger/20 text-app-danger' 
                        : 'bg-app-warning/10 border-app-warning/20 text-app-warning'
                    }`}>
                      <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                      <div className="text-xs">
                        <p className="font-bold uppercase tracking-widest">
                          {billingAccessState === 'blocked' ? 'AI Features Suspended' : 'Billing Notice'}
                        </p>
                        <p className="opacity-80 mt-0.5">
                          {billingAccessState === 'blocked' 
                            ? 'AI access is temporarily disabled. Please contact admin.' 
                            : 'Account approaching usage limit. Review settings.'}
                        </p>
                      </div>
                    </div>
                  )}

                  <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-8 scroll-smooth pb-32 bg-dots">
                    <AnimatePresence mode="popLayout">
                      {messages.map((msg) => (
                        <motion.div 
                          key={msg.id} 
                          initial={{ opacity: 0, y: 20, scale: 0.95 }} 
                          animate={{ opacity: 1, y: 0, scale: 1 }} 
                          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div className={`max-w-[85%] relative group ${
                            msg.role === 'user' 
                              ? 'bg-app-accent text-white rounded-[24px] rounded-tr-none shadow-[0_10px_30px_rgba(59,130,246,0.2)]' 
                              : 'glass-panel p-5 rounded-[24px] rounded-tl-none border-white/5 shadow-xl'
                          } p-5`}>
                            <p className="text-base leading-relaxed font-medium">{msg.content}</p>
                            
                            {msg.sources && msg.sources.length > 0 && (
                              <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap gap-2">
                                {msg.sources.map((src, i) => (
                                  <button 
                                    key={i} 
                                    onClick={() => setSelectedSource(src)} 
                                    className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all"
                                  >
                                    <BookOpen className="w-3.5 h-3.5 text-app-accent" />
                                    <span className="max-w-[120px] truncate">{src.documentTitle}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                            
                            <span className="absolute -bottom-5 left-0 text-[8px] uppercase tracking-widest text-app-muted font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                              {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </motion.div>
                      ))}
                      
                      {isThinking && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                          <div className="glass-panel p-4 rounded-[20px] rounded-tl-none flex gap-1.5">
                            <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1 }} className="w-2 h-2 bg-app-accent rounded-full" />
                            <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-2 h-2 bg-app-accent rounded-full" />
                            <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-2 h-2 bg-app-accent rounded-full" />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Input Area */}
                  <div className="absolute bottom-0 left-0 right-0 p-6 z-20 flex justify-center">
                    <div className="glass-panel rounded-[32px] p-2 flex items-center gap-3 shadow-[0_-20px_50px_rgba(0,0,0,0.3)] w-full max-w-4xl">
                      <button 
                        onClick={() => billingAccessState !== 'blocked' && setIsListening(!isListening)} 
                        disabled={billingAccessState === 'blocked'}
                        className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all flex-shrink-0 ${
                          billingAccessState === 'blocked' 
                            ? 'bg-white/5 cursor-not-allowed opacity-50' 
                            : isListening ? 'bg-app-danger animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.4)]' : 'bg-white/5 hover:bg-white/10 text-app-muted hover:text-white'
                        }`}
                      >
                        <Mic className="w-6 h-6" />
                      </button>
                      
                      <div className="flex-1 relative">
                        <input 
                          type="text" 
                          value={input} 
                          onChange={(e) => setInput(e.target.value)} 
                          onKeyDown={(e) => e.key === 'Enter' && handleSend(input)} 
                          placeholder={billingAccessState === 'blocked' ? "Account suspended" : isListening ? "Listening..." : "Ask anything..."} 
                          disabled={billingAccessState === 'blocked'}
                          className="w-full bg-transparent border-none py-4 px-4 focus:outline-none text-base font-medium placeholder:text-app-muted" 
                        />
                      </div>

                      <button 
                        onClick={() => handleSend(input)} 
                        disabled={billingAccessState === 'blocked' || !input.trim()}
                        className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${
                          billingAccessState === 'blocked' || !input.trim()
                            ? 'bg-white/5 text-white/10 cursor-not-allowed'
                            : 'bg-app-accent text-white shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:scale-105 active:scale-95'
                        }`}
                      >
                        <Send className="w-6 h-6" />
                      </button>
                    </div>
                  </div>
                </div>
        
        <AnimatePresence>
          {selectedSource && (
            <motion.div 
              initial={{ x: '100%' }} 
              animate={{ x: 0 }} 
              exit={{ x: '100%' }} 
              className="fixed inset-0 md:relative md:inset-auto md:w-1/2 border-l border-white/10 bg-app-bg/95 backdrop-blur-3xl flex flex-col z-30"
            >
              <div className="p-4 md:p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 glass-panel rounded-xl flex items-center justify-center text-app-accent shadow-[0_0_20px_rgba(59,130,246,0.2)]">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex flex-col">
                    <h3 className="font-bold text-white truncate max-w-[150px] md:max-w-[200px] leading-tight tracking-tight">{selectedSource.documentTitle}</h3>
                    {activePreviewSources.length > 1 && (
                      <span className="text-[10px] text-app-accent font-bold uppercase tracking-[0.2em] mt-1">
                        Source {activePreviewIndex + 1} of {activePreviewSources.length}
                      </span>
                    )}
                  </div>
                </div>
                <button 
                  onClick={() => clearSourceFlow()} 
                  className="px-4 py-2 glass-panel rounded-xl text-[10px] font-bold uppercase tracking-widest text-app-muted hover:text-white hover:border-white/20 transition-all"
                >
                  Close
                </button>
              </div>
              <div className="flex-1 p-4 md:p-8 overflow-y-auto relative group bg-dots">
                {activePreviewSources.length > 1 && (
                  <>
                    <button 
                      onClick={() => setActivePreviewIndex(prev => Math.max(0, prev - 1))}
                      disabled={activePreviewIndex === 0}
                      className={`absolute left-4 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full glass-panel flex items-center justify-center transition-all ${activePreviewIndex === 0 ? 'opacity-20 cursor-not-allowed' : 'hover:bg-white/10 hover:scale-110 active:scale-95 shadow-[0_0_20px_rgba(0,0,0,0.3)]'}`}
                    >
                      <ChevronLeft className="w-6 h-6 text-white" />
                    </button>
                    <button 
                      onClick={() => setActivePreviewIndex(prev => Math.min(activePreviewSources.length - 1, prev + 1))}
                      disabled={activePreviewIndex === activePreviewSources.length - 1}
                      className={`absolute right-4 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full glass-panel flex items-center justify-center transition-all ${activePreviewIndex === activePreviewSources.length - 1 ? 'opacity-20 cursor-not-allowed' : 'hover:bg-white/10 hover:scale-110 active:scale-95 shadow-[0_0_20px_rgba(0,0,0,0.3)]'}`}
                    >
                      <ChevronRight className="w-6 h-6 text-white" />
                    </button>
                  </>
                )}
                <div className="glass-panel rounded-[40px] p-8 md:p-14 relative shadow-2xl border-white/5 h-full min-h-[420px] max-h-[65vh] overflow-y-auto">
                  <div className="absolute -top-24 -right-24 w-64 h-64 bg-app-accent/5 rounded-full blur-3xl" />
                  <div className="absolute top-6 right-8 text-[10px] font-bold uppercase tracking-[0.3em] text-app-accent">Page {selectedSource.pageNumber}</div>
                  <div className="space-y-6 relative z-10">
                    <div className="h-4 w-3/4 bg-white/5 rounded-full" />
                    <div className="h-4 w-full bg-white/5 rounded-full" />
                    <div className="h-4 w-5/6 bg-white/5 rounded-full" />
                    <div className="py-10 px-8 bg-app-accent/5 border-l-2 border-app-accent rounded-r-[32px] text-white/90 leading-relaxed shadow-inner">
                      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-app-accent mb-4 opacity-70">Document Content</p>
                      <pre className="whitespace-pre-wrap font-sans text-sm md:text-base">
                        {selectedSource.content || selectedSource.excerpt}
                      </pre>
                    </div>
                    <div className="h-4 w-full bg-white/5 rounded-full" />
                    <div className="h-4 w-2/3 bg-white/5 rounded-full" />
                  </div>
                </div>
              </div>
              {activePreviewSources.length > 1 && (
                <div className="p-6 border-t border-white/10 flex justify-center gap-4 bg-white/5">
                  <button 
                    onClick={() => setActivePreviewIndex(prev => Math.max(0, prev - 1))}
                    disabled={activePreviewIndex === 0}
                    className={`flex-1 py-4 rounded-2xl glass-panel text-[10px] font-bold uppercase tracking-[0.2em] transition-all ${activePreviewIndex === 0 ? 'opacity-20 cursor-not-allowed' : 'hover:bg-white/10 hover:text-app-accent'}`}
                  >
                    Previous Source
                  </button>
                  <button 
                    onClick={() => setActivePreviewIndex(prev => Math.min(activePreviewSources.length - 1, prev + 1))}
                    disabled={activePreviewIndex === activePreviewSources.length - 1}
                    className={`flex-1 py-4 rounded-2xl glass-panel text-[10px] font-bold uppercase tracking-[0.2em] transition-all ${activePreviewIndex === activePreviewSources.length - 1 ? 'opacity-20 cursor-not-allowed' : 'hover:bg-white/10 hover:text-app-accent'}`}
                  >
                    Next Source
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {remainingSeconds !== null && (
          <div className="fixed bottom-4 right-4 md:bottom-8 md:right-8 z-[150] pointer-events-none">
            <div className={`px-6 py-3 rounded-[24px] backdrop-blur-2xl border-2 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center gap-4 transition-all duration-500 pointer-events-auto ${
              remainingSeconds < 10 
                ? 'bg-app-danger/30 border-app-danger text-white animate-pulse scale-110' 
                : 'bg-white/5 border-white/10 text-white/90'
            }`}>
              <div className="relative">
                <Clock className={`w-5 h-5 ${remainingSeconds < 10 ? 'animate-spin-slow text-app-danger' : 'text-app-accent'}`} />
                {remainingSeconds < 10 && <div className="absolute inset-0 bg-app-danger blur-md animate-pulse rounded-full" />}
              </div>
              <div className="flex flex-col">
                <span className="text-[9px] uppercase tracking-[0.3em] opacity-50 font-bold">Session Time</span>
                <span className="text-lg font-mono font-bold leading-none tracking-tighter">
                  {Math.floor(remainingSeconds / 60)}:{(remainingSeconds % 60).toString().padStart(2, '0')}
                </span>
              </div>
            </div>
          </div>
        )}

        {showSummary && (
          <SummaryPopup 
            sessionId={session || 'unknown'} 
            onClose={handleReset} 
          />
        )}
      </main>
    </motion.div>
    )
  }
  </AnimatePresence>
      {/* Kiosk Exit Link */}
      <button
        onClick={onExit}
        className="fixed bottom-2 right-2 z-[9999] text-[10px] text-white/20 hover:text-white/60 transition-colors bg-transparent border-none p-1 cursor-pointer font-sans"
      >
        Close
      </button>
    </div>
  </div>
  );
};

const AccountDashboard = ({ account, projects, analytics }: { account: Account, projects: Project[], analytics: Analytics | null }) => {
  if (!account) return null;
  const accountProjects = projects.filter(p => p.account_id === account.id);
  
  return (
    <div className="space-y-10">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold text-slate-900">{account.name}</h2>
          <p className="text-slate-500 mt-1">Account Overview & Performance</p>
        </div>
        <div className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-xl text-xs font-bold uppercase tracking-widest">
          {accountProjects.length} Active Projects
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Account Sessions', value: analytics?.totalSessions || '0', icon: Activity },
          { label: 'Avg. Sentiment', value: 'Positive', icon: Smile },
          { label: 'Active Kiosks', value: accountProjects.length, icon: Settings },
          { label: 'Response Rate', value: '98.2%', icon: CheckCircle2 },
        ].map((stat, i) => (
          <div key={i} className="bg-surface-low p-6 rounded-2xl border border-white/5 shadow-sm">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-slate-50 rounded-lg text-slate-400">
                <stat.icon className="w-5 h-5" />
              </div>
            </div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">{stat.label}</p>
            <h3 className="text-2xl font-bold text-slate-900">{stat.value}</h3>
          </div>
        ))}
      </div>

      {/* User Location Map */}
      <div className="bg-surface-low p-6 md:p-8 rounded-3xl border border-white/5 shadow-sm overflow-hidden">
        <h3 className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-6 flex items-center gap-2">
          <Activity className="w-4 h-4" />
          User Location Map
        </h3>
        <div className="h-[300px] w-full rounded-2xl overflow-hidden border border-slate-100">
          <MapContainer center={[20, 0]} zoom={2} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MarkerClusterGroup chunkedLoading iconCreateFunction={createCustomClusterIcon}>
              {analytics?.location_points?.map((point, idx) => (
                <Marker key={idx} position={[point.latitude, point.longitude]} icon={DefaultIcon}>
                  <Popup>
                    <div className="text-xs font-bold text-slate-900">{point.city}, {point.country}</div>
                    <div className="text-[10px] text-slate-500">{point.count} sessions</div>
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>
          </MapContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Countries Table */}
        <div className="bg-surface-low p-6 md:p-8 rounded-3xl border border-white/5 shadow-sm">
          <h3 className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-6">Top 5 Countries</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Rank</th>
                  <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Country</th>
                  <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {analytics?.top_countries?.map((c, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 text-sm font-bold text-slate-400">#{i + 1}</td>
                    <td className="py-4 text-sm font-bold text-slate-700">{c.country}</td>
                    <td className="py-4 text-sm font-bold text-slate-900 text-right">{c.count}</td>
                  </tr>
                ))}
                {(!analytics?.top_countries || analytics.top_countries.length === 0) && (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-slate-400 italic text-sm">No data available</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Device Breakdown Pie Chart */}
        <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200 shadow-sm">
          <h3 className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-6">Device Breakdown</h3>
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'Mobile', value: analytics?.device_breakdown?.mobile || 0 },
                    { name: 'Desktop', value: analytics?.device_breakdown?.desktop || 0 }
                  ].filter(d => d.value > 0)}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={5}
                  dataKey="value"
                >
                  <Cell fill="#6366f1" />
                  <Cell fill="#10b981" />
                </Pie>
                <RechartsTooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Legend verticalAlign="bottom" height={36}/>
              </PieChart>
            </ResponsiveContainer>
            {(!analytics?.device_breakdown || (analytics.device_breakdown.mobile === 0 && analytics.device_breakdown.desktop === 0)) && (
              <div className="flex items-center justify-center h-full text-slate-400 italic text-sm">No data available</div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <h3 className="text-xl font-bold text-slate-900">Account Projects</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {accountProjects.map(proj => (
              <div key={proj.id} className="bg-surface-low p-6 rounded-2xl border border-white/5 shadow-sm hover:shadow-md transition-shadow">
                <h4 className="font-bold text-white mb-2">{proj.title}</h4>
                <p className="text-sm text-slate-400 line-clamp-2 mb-4">{proj.description}</p>
                <div className="flex justify-between items-center pt-4 border-t border-white/5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active</span>
                  <div className="flex gap-2">
                    <button className="text-indigo-600 font-bold text-xs hover:underline">Manage</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="bg-surface-low rounded-3xl p-8 text-white">
          <h3 className="text-xl font-bold mb-6">Account Sentiment</h3>
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Smile className="w-5 h-5 text-emerald-400" />
                <span className="text-sm font-medium">Positive</span>
              </div>
              <span className="font-bold">72%</span>
            </div>
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-400 w-[72%]" />
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Meh className="w-5 h-5 text-amber-400" />
                <span className="text-sm font-medium">Neutral</span>
              </div>
              <span className="font-bold">18%</span>
            </div>
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-amber-400 w-[18%]" />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Frown className="w-5 h-5 text-red-400" />
                <span className="text-sm font-medium">Negative</span>
              </div>
              <span className="font-bold">10%</span>
            </div>
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-red-400 w-[10%]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const UsersView = ({ users, accounts, onRefresh, onImpersonate }: { users: UserType[], accounts: Account[], onRefresh: () => void, onImpersonate: (user: UserType) => void }) => {
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserType | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', role: 'user', account_id: 'acc_default' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingUser ? `${API_BASE}/api/users/${editingUser.id}` : `${API_BASE}/api/users`;
    const method = editingUser ? 'PUT' : 'POST';
    
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });

    if (res.ok) {
      setShowModal(false);
      setEditingUser(null);
      setFormData({ name: '', email: '', role: 'user', account_id: 'acc_default' });
      onRefresh();
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this user?')) {
      const res = await fetch(`${API_BASE}/api/users/${id}`, { method: 'DELETE' });
      if (res.ok) onRefresh();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-bold">User Management</h3>
        <button 
          onClick={() => { setEditingUser(null); setFormData({ name: '', email: '', role: 'user', account_id: 'acc_default' }); setShowModal(true); }}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold shadow-sm"
        >
          Add User
        </button>
      </div>

      <div className="bg-surface-low rounded-2xl border border-white/5 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 border-b border-white/5 text-slate-400 uppercase text-[10px] font-bold tracking-wider">
            <tr>
              <th className="px-6 py-4">Name</th>
              <th className="px-6 py-4">Email</th>
              <th className="px-6 py-4">Role</th>
              <th className="px-6 py-4">Account</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map(user => (
              <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 font-medium text-slate-900">{user.name}</td>
                <td className="px-6 py-4 text-slate-500">{user.email}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                    {user.role}
                  </span>
                </td>
                <td className="px-6 py-4 text-slate-500">{user.account_name || user.account_id}</td>
                <td className="px-6 py-4 text-right space-x-2">
                  <button 
                    onClick={() => onImpersonate(user)}
                    className="text-amber-600 hover:text-amber-700 font-bold text-xs"
                  >
                    Log in as
                  </button>
                  <button 
                    onClick={() => { setEditingUser(user); setFormData({ name: user.name, email: user.email, role: user.role as any, account_id: user.account_id || 'acc_default' }); setShowModal(true); }}
                    className="text-indigo-600 hover:text-indigo-700 font-bold text-xs"
                  >
                    Edit
                  </button>
                  <button 
                    onClick={() => handleDelete(user.id)}
                    className="text-red-600 hover:text-red-700 font-bold text-xs"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-surface-low/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-surface-low border border-white/10 rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <h3 className="text-2xl font-bold mb-6">{editingUser ? 'Edit User' : 'Add New User'}</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Full Name</label>
                <input 
                  type="text" 
                  required
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Email Address</label>
                <input 
                  type="email" 
                  required
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Role</label>
                  <select 
                    value={formData.role}
                    onChange={e => setFormData({ ...formData, role: e.target.value as any })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="kiosk">Kiosk</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Account</label>
                  <select 
                    value={formData.account_id}
                    onChange={e => setFormData({ ...formData, account_id: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-colors">Cancel</button>
                <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-100">
                  {editingUser ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};

const BillingView = ({ effectiveUser, projects, accounts, analytics }: { effectiveUser: UserType | null, projects: Project[], accounts: Account[], analytics: Analytics | null }) => {
  const isAdmin = effectiveUser?.role === 'admin';
  const [billingLogs, setBillingLogs] = useState<UsageLogItem[]>([]);
  const [billingTotal, setBillingTotal] = useState(0);
  const [billingPage, setBillingPage] = useState(1);
  const [billingTotalPages, setBillingTotalPages] = useState(1);
  
  const warningAccounts = useMemo(() => accounts.filter(acc => acc.status === 'warning'), [accounts]);
  const suspendedAccounts = useMemo(() => accounts.filter(acc => acc.isBlocked || acc.status === 'capped' || acc.status === 'suspended' || ((acc.totalSpentUsd || 0) >= (acc.monthly_limit_usd || 0))), [accounts]);

  const [billingFilters, setBillingFilters] = useState({
    search: '',
    type: '',
    projectId: '',
    accountId: '',
    startDate: '',
    endDate: ''
  });

  const fetchBilling = async () => {
    try {
      const params = new URLSearchParams({
        page: billingPage.toString(),
        limit: '20',
        ...billingFilters
      });
      const res = await fetch(`${API_BASE}/api/billing?${params}`, {
        headers: { 'x-user-id': effectiveUser?.id || '' }
      });
      const data = await res.json();
      setBillingLogs(data.data);
      setBillingTotal(data.total);
      setBillingTotalPages(data.totalPages);
    } catch (err) {
      console.error("Failed to fetch billing logs:", err);
    }
  };

  useEffect(() => {
    if (effectiveUser) fetchBilling();
  }, [effectiveUser, billingPage, billingFilters]);

  const handleExport = async (format: 'csv' | 'json') => {
    const params = new URLSearchParams({
      format,
      ...billingFilters
    });
    window.open(`${API_BASE}/api/billing/export?${params}&x-user-id=${effectiveUser?.id || ''}`, '_blank');
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Billing & Usage</h2>
          <p className="text-slate-500 mt-1">Monitor costs and resource consumption across the system.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => handleExport('csv')}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-50 transition-all shadow-sm"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
              <CreditCard className="w-6 h-6" />
            </div>
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg uppercase tracking-wider">Total Spent</span>
          </div>
          <p className="text-3xl font-bold text-slate-900 tracking-tight">${analytics?.billing?.totalSpentUsd.toFixed(2) || '0.00'}</p>
          <p className="text-xs text-slate-400 mt-1">Current billing cycle</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
              <Mic className="w-6 h-6" />
            </div>
            <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-lg uppercase tracking-wider">Voice Spend</span>
          </div>
          <p className="text-3xl font-bold text-slate-900 tracking-tight">${analytics?.billing?.voiceSpentUsd.toFixed(2) || '0.00'}</p>
          <p className="text-xs text-slate-400 mt-1">{analytics?.billing?.voiceSeconds.toLocaleString() || 0} seconds used</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
              <FileText className="w-6 h-6" />
            </div>
            <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg uppercase tracking-wider">Text Spend</span>
          </div>
          <p className="text-3xl font-bold text-slate-900 tracking-tight">${analytics?.billing?.textSpentUsd.toFixed(2) || '0.00'}</p>
          <p className="text-xs text-slate-400 mt-1">{analytics?.billing?.textCharacters.toLocaleString() || 0} chars processed</p>
        </div>

        {isAdmin && (
          <>
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-lg uppercase tracking-wider">Warning Threshold</span>
              </div>
              <p className="text-3xl font-bold text-slate-900 tracking-tight">{warningAccounts.length}</p>
              <p className="text-xs text-slate-400 mt-1">Accounts near limit</p>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-red-50 text-red-600 rounded-2xl">
                  <Ban className="w-6 h-6" />
                </div>
                <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-1 rounded-lg uppercase tracking-wider">Suspended</span>
              </div>
              <p className="text-3xl font-bold text-slate-900 tracking-tight">{suspendedAccounts.length}</p>
              <p className="text-xs text-slate-400 mt-1">Accounts capped/over</p>
            </div>
          </>
        )}
      </div>

      {/* Top 5 Tables */}
      {isAdmin && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col min-h-[400px]">
            <div className="p-6 border-b border-slate-50">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500" />
                Accounts in Warning Threshold
              </h3>
            </div>
            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-100">
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Account</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Limit</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Spent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {warningAccounts.sort((a, b) => (b.totalSpentUsd || 0) - (a.totalSpentUsd || 0)).slice(0, 5).map(acc => (
                    <tr key={acc.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-900 text-xs">{acc.name}</td>
                      <td className="px-6 py-4 text-xs text-slate-600">${acc.monthly_limit_usd?.toFixed(2)}</td>
                      <td className="px-6 py-4 text-xs font-bold text-slate-900 text-right">${acc.totalSpentUsd?.toFixed(2)}</td>
                    </tr>
                  ))}
                  {warningAccounts.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-6 py-12 text-center text-xs text-slate-400 italic">No accounts in warning threshold</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col min-h-[400px]">
            <div className="p-6 border-b border-slate-50">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Ban className="w-4 h-4 text-red-500" />
                Accounts Suspended
              </h3>
            </div>
            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-100">
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Account</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Limit</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Spent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {suspendedAccounts.sort((a, b) => (b.totalSpentUsd || 0) - (a.totalSpentUsd || 0)).slice(0, 5).map(acc => (
                    <tr key={acc.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-900 text-xs">{acc.name}</td>
                      <td className="px-6 py-4 text-xs text-slate-600">${acc.monthly_limit_usd?.toFixed(2)}</td>
                      <td className="px-6 py-4 text-xs font-bold text-red-600 text-right">${acc.totalSpentUsd?.toFixed(2)}</td>
                    </tr>
                  ))}
                  {suspendedAccounts.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-6 py-12 text-center text-xs text-slate-400 italic">No accounts suspended</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Account Spend Bar Graph */}
      {isAdmin && (
        <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-100 shadow-sm">
          <h3 className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-6">Total Spend per Account</h3>
          <div className="relative">
            {/* Y-axis grid lines */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-8 pt-8">
              {(() => {
                const maxSpent = Math.max(...accounts.map(a => a.totalSpentUsd || 0), 1);
                return [0, 1, 2, 3, 4].map(i => {
                  const val = maxSpent * (4-i)/4;
                  return (
                    <div key={i} className="w-full border-t border-slate-50 flex items-center">
                      <span className="text-[8px] text-slate-300 -ml-8 w-6 text-right pr-2">
                        ${val >= 1 ? val.toFixed(0) : val.toFixed(2)}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>

            <div className="overflow-x-auto pb-4 scrollbar-hide">
              <div className="h-48 md:h-64 flex items-end gap-2 md:gap-4 pt-8 min-w-max px-2">
                {(() => {
                  const maxSpent = Math.max(...accounts.map(a => a.totalSpentUsd || 0), 1);
                  return accounts.map((acc) => {
                    const rawHeight = ((acc.totalSpentUsd || 0) / maxSpent) * 100;
                    // Ensure bars are visible even for very small amounts (min 2% height if > 0)
                    const height = acc.totalSpentUsd > 0 ? Math.max(rawHeight, 2) : 0;
                    return (
                      <div key={acc.id} className="w-16 md:w-24 flex flex-col items-center gap-2 group relative h-full">
                        <div className="w-full relative flex flex-col justify-end flex-1">
                          <motion.div 
                            initial={{ height: 0 }}
                            animate={{ height: `${height}%` }}
                            className={`w-full rounded-t-xl relative ${acc.totalSpentUsd > acc.monthly_limit_usd ? 'bg-red-500' : 'bg-indigo-500 group-hover:bg-indigo-400'}`}
                          >
                            <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[9px] font-bold text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity">
                              ${acc.totalSpentUsd?.toFixed(2)}
                            </div>
                          </motion.div>
                          <div className="absolute -top-10 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-bold px-2 py-1 rounded whitespace-nowrap z-10 shadow-xl pointer-events-none">
                            ${acc.totalSpentUsd?.toFixed(2)} / ${acc.monthly_limit_usd?.toFixed(0)}
                          </div>
                        </div>
                        <span className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate w-full text-center px-1" title={acc.name}>
                          {acc.name}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Account Summary Table */}
      {isAdmin && (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-50">
            <h3 className="text-sm font-bold text-slate-900">Account Summary</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Account Name</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Monthly Limit</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Spent</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Balance</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {accounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 font-bold text-slate-900 text-sm">{acc.name}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">${acc.monthly_limit_usd?.toFixed(2)}</td>
                    <td className="px-6 py-4 text-sm font-bold text-slate-900">${acc.totalSpentUsd?.toFixed(2)}</td>
                    <td className="px-6 py-4">
                      <span className={`text-sm font-bold ${acc.balance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        ${acc.balance?.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                        acc.status === 'capped' ? 'bg-red-50 text-red-600' : 
                        acc.status === 'warning' ? 'bg-amber-50 text-amber-600' : 
                        'bg-emerald-50 text-emerald-600'
                      }`}>
                        {acc.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search content..."
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all"
              value={billingFilters.search}
              onChange={(e) => setBillingFilters({...billingFilters, search: e.target.value})}
            />
          </div>
          <select 
            className="w-full px-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all"
            value={billingFilters.type}
            onChange={(e) => setBillingFilters({...billingFilters, type: e.target.value})}
          >
            <option value="">All Types</option>
            <option value="voice">Voice</option>
            <option value="text">Text</option>
          </select>
          {effectiveUser?.role === 'admin' && (
            <select 
              className="w-full px-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all"
              value={billingFilters.accountId}
              onChange={(e) => setBillingFilters({...billingFilters, accountId: e.target.value})}
            >
              <option value="">All Accounts</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <select 
            className="w-full px-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all"
            value={billingFilters.projectId}
            onChange={(e) => setBillingFilters({...billingFilters, projectId: e.target.value})}
          >
            <option value="">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <input 
            type="date" 
            className="w-full px-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all"
            value={billingFilters.startDate}
            onChange={(e) => setBillingFilters({...billingFilters, startDate: e.target.value})}
          />
          <input 
            type="date" 
            className="w-full px-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all"
            value={billingFilters.endDate}
            onChange={(e) => setBillingFilters({...billingFilters, endDate: e.target.value})}
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Timestamp</th>
                {effectiveUser?.role === 'admin' && <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Account</th>}
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Project</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Type</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Units</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cost</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Message Preview</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {billingLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-slate-900">{new Date(log.created_at).toLocaleDateString()}</span>
                      <span className="text-[10px] text-slate-400 font-medium">{new Date(log.created_at).toLocaleTimeString()}</span>
                    </div>
                  </td>
                  {effectiveUser?.role === 'admin' && (
                    <td className="px-6 py-4">
                      <span className="text-sm font-medium text-slate-600">{log.account_name}</span>
                    </td>
                  )}
                  <td className="px-6 py-4">
                    <span className="text-sm font-medium text-slate-600">{log.project_title}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                      log.type === 'voice' ? 'bg-blue-50 text-blue-600' : 'bg-indigo-50 text-indigo-600'
                    }`}>
                      {log.type === 'voice' ? <Mic className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                      {log.type}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm font-bold text-slate-900">
                      {log.type === 'voice' ? `${log.units}s` : `${log.units} chars`}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm font-bold text-emerald-600">${log.cost_usd.toFixed(4)}</span>
                  </td>
                  <td className="px-6 py-4 max-w-xs">
                    <p className="text-sm text-slate-500 truncate">{log.message_content}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between">
          <p className="text-xs text-slate-400 font-medium">
            Showing <span className="text-slate-900 font-bold">{billingLogs.length}</span> of <span className="text-slate-900 font-bold">{billingTotal}</span> records
          </p>
          <div className="flex gap-2">
            <button 
              disabled={billingPage === 1}
              onClick={() => setBillingPage(p => p - 1)}
              className="p-2 bg-white border border-slate-200 rounded-xl disabled:opacity-50 hover:bg-slate-50 transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center px-4 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700">
              Page {billingPage} of {billingTotalPages}
            </div>
            <button 
              disabled={billingPage === billingTotalPages}
              onClick={() => setBillingPage(p => p + 1)}
              className="p-2 bg-white border border-slate-200 rounded-xl disabled:opacity-50 hover:bg-slate-50 transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const MessagesView = ({ effectiveUser, projects, accounts }: { effectiveUser: UserType | null, projects: Project[], accounts: Account[] }) => {
  const [messages, setMessages] = useState<GlobalMessageLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    search: '',
    role: '',
    sentiment: '',
    projectId: '',
    accountId: '',
    startDate: '',
    endDate: ''
  });

  const fetchMessages = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '50',
        ...filters
      });
      const res = await fetch(`${API_BASE}/api/messages?${params}`, {
        headers: {
          'x-user-id': effectiveUser?.id || ''
        }
      });
      const data = await res.json();
      setMessages(data.data);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (err) {
      console.error("Failed to fetch messages:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();
  }, [page, filters.role, filters.sentiment, filters.projectId, filters.accountId, filters.startDate, filters.endDate, effectiveUser?.id]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      fetchMessages();
    }, 500);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const handleExport = async (format: 'csv' | 'json') => {
    const params = new URLSearchParams({
      format,
      ...filters
    });
    window.open(`${API_BASE}/api/messages/export?${params}&x-user-id=${effectiveUser?.id || ''}`, '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h3 className="text-2xl font-bold text-slate-900">Global Messages</h3>
          <p className="text-sm text-slate-500">View and analyze messages across all projects and accounts.</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => handleExport('csv')}
            className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-lg text-xs font-bold hover:bg-emerald-600 hover:text-white transition-all flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button 
            onClick={() => handleExport('json')}
            className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-600 hover:text-white transition-all flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> Export JSON
          </button>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-slate-200 space-y-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search content..." 
              value={filters.search}
              onChange={e => setFilters({ ...filters, search: e.target.value })}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          <select 
            value={filters.role}
            onChange={e => setFilters({ ...filters, role: e.target.value })}
            className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
          >
            <option value="">All Roles</option>
            <option value="user">User</option>
            <option value="model">AI Assistant</option>
          </select>
          <select 
            value={filters.sentiment}
            onChange={e => setFilters({ ...filters, sentiment: e.target.value })}
            className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
          >
            <option value="">All Sentiments</option>
            <option value="positive">Positive</option>
            <option value="neutral">Neutral</option>
            <option value="negative">Negative</option>
          </select>
          {effectiveUser?.role === 'admin' && (
            <select 
              value={filters.accountId}
              onChange={e => setFilters({ ...filters, accountId: e.target.value, projectId: '' })}
              className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
            >
              <option value="">All Accounts</option>
              {accounts.map(acc => (
                <option key={acc.id} value={acc.id}>{acc.name}</option>
              ))}
            </select>
          )}
          <select 
            value={filters.projectId}
            onChange={e => setFilters({ ...filters, projectId: e.target.value })}
            className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
          >
            <option value="">All Projects</option>
            {projects
              .filter(p => !filters.accountId || p.account_id === filters.accountId)
              .map(proj => (
                <option key={proj.id} value={proj.id}>{proj.title}</option>
              ))}
          </select>
          <input 
            type="date" 
            value={filters.startDate}
            onChange={e => setFilters({ ...filters, startDate: e.target.value })}
            className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
          />
          <input 
            type="date" 
            value={filters.endDate}
            onChange={e => setFilters({ ...filters, endDate: e.target.value })}
            className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Context</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Message</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Sentiment</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={4} className="px-6 py-12 text-center text-slate-400">Loading messages...</td></tr>
              ) : messages.length === 0 ? (
                <tr><td colSpan={4} className="px-6 py-12 text-center text-slate-400">No messages found matching filters.</td></tr>
              ) : (
                messages.map(msg => (
                  <tr key={msg.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 align-top">
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-slate-900 truncate max-w-[150px]">{msg.project_title}</p>
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">{msg.account_name}</p>
                        <p className="text-[10px] text-indigo-500 font-mono">ID: {msg.session_id}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4 max-w-md">
                      <div className="flex gap-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${msg.role === 'user' ? 'bg-blue-100 text-blue-600' : 'bg-indigo-100 text-indigo-600'}`}>
                          {msg.role === 'user' ? <UserIcon className="w-3 h-3" /> : <Activity className="w-3 h-3" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm text-slate-700 line-clamp-3">{msg.content}</p>
                          {msg.sources && msg.sources.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {msg.sources.map((src, i) => (
                                <span key={i} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[9px] font-medium">
                                  {src.documentTitle}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      {msg.sentiment && (
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                          msg.sentiment === 'positive' ? 'bg-emerald-50 text-emerald-600' : 
                          msg.sentiment === 'negative' ? 'bg-red-50 text-red-600' : 
                          'bg-slate-50 text-slate-400'
                        }`}>
                          {msg.sentiment === 'positive' ? <Smile className="w-3 h-3" /> : 
                           msg.sentiment === 'negative' ? <Frown className="w-3 h-3" /> : 
                           <Meh className="w-3 h-3" />}
                          {msg.sentiment}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 align-top">
                      <p className="text-xs text-slate-500">{new Date(msg.created_at).toLocaleDateString()}</p>
                      <p className="text-[10px] text-slate-400">{new Date(msg.created_at).toLocaleTimeString()}</p>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-between items-center px-2">
        <p className="text-xs text-slate-400 font-medium">Showing {messages.length} of {total} messages</p>
        <div className="flex items-center gap-4">
          <p className="text-xs text-slate-400">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button 
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 disabled:opacity-50 hover:bg-slate-50 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button 
              disabled={page === totalPages}
              onClick={() => setPage(p => p + 1)}
              className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 disabled:opacity-50 hover:bg-slate-50 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ProjectLogsView = ({ project, onBack }: { project: Project, onBack: () => void }) => {
  const [logs, setLogs] = useState<ProjectMessageLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', role: '', sentiment: '', startDate: '', endDate: '' });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const sessions = useMemo(() => {
    const groups: { [key: string]: ProjectMessageLogItem[] } = {};
    logs.forEach(log => {
      if (!groups[log.session_id]) groups[log.session_id] = [];
      groups[log.session_id].push(log);
    });
    
    return Object.entries(groups).sort((a, b) => {
      const latestA = Math.max(...a[1].map(m => new Date(m.created_at).getTime()));
      const latestB = Math.max(...b[1].map(m => new Date(m.created_at).getTime()));
      return latestB - latestA;
    }).map(([sessionId, messages]) => ({
      sessionId,
      messages: messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }));
  }, [logs]);

  const fetchLogs = async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: page.toString(),
      limit: '20',
      ...Object.fromEntries(Object.entries(filters).filter(([_, v]) => v))
    });
    const res = await fetch(`${API_BASE}/api/projects/${project.id}/messages?${params}`);
    if (res.ok) {
      const data = await res.json();
      setLogs(data.data);
      setTotalPages(data.totalPages);
    }
    setLoading(false);
  };

  useEffect(() => { fetchLogs(); }, [project.id, page, filters]);

  const handleExport = (format: 'json' | 'csv') => {
    const params = new URLSearchParams({
      format,
      ...Object.fromEntries(Object.entries(filters).filter(([_, v]) => v))
    });
    window.open(`${API_BASE}/api/projects/${project.id}/messages/export?${params}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 mb-6">
        <button 
          onClick={onBack}
          className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div>
          <h3 className="text-xl font-bold text-slate-900">Session Logs</h3>
          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">{project.title}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button 
            onClick={() => handleExport('csv')}
            className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-lg text-xs font-bold hover:bg-emerald-600 hover:text-white transition-all flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button 
            onClick={() => handleExport('json')}
            className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-600 hover:text-white transition-all flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> Export JSON
          </button>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-slate-200 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search content..." 
              value={filters.search}
              onChange={e => setFilters({ ...filters, search: e.target.value })}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          <select 
            value={filters.role}
            onChange={e => setFilters({ ...filters, role: e.target.value })}
            className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
          >
            <option value="">All Roles</option>
            <option value="user">User</option>
            <option value="model">AI Assistant</option>
          </select>
          <select 
            value={filters.sentiment}
            onChange={e => setFilters({ ...filters, sentiment: e.target.value })}
            className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
          >
            <option value="">All Sentiments</option>
            <option value="positive">Positive</option>
            <option value="neutral">Neutral</option>
            <option value="negative">Negative</option>
          </select>
          <input 
            type="date" 
            value={filters.startDate}
            onChange={e => setFilters({ ...filters, startDate: e.target.value })}
            className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
          />
          <input 
            type="date" 
            value={filters.endDate}
            onChange={e => setFilters({ ...filters, endDate: e.target.value })}
            className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
          />
        </div>
      </div>

      <div className="bg-surface-low rounded-2xl border border-white/5 overflow-hidden">
        <div className="divide-y divide-white/5">
          {loading ? (
            <div className="p-12 text-center text-slate-400">Loading logs...</div>
          ) : sessions.length === 0 ? (
            <div className="p-12 text-center text-slate-400">No messages found matching filters.</div>
          ) : (
            sessions.map(session => (
              <div key={session.sessionId} className="p-6 space-y-6 bg-surface-low">
                <div className="flex items-center justify-between border-b border-slate-50 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400">
                      <Hash className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Session {session.sessionId}</h4>
                      <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
                        Started {new Date(session.messages[0].session_start || session.messages[0].created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-4">
                  {session.messages.map(log => (
                    <div key={log.id} className="flex gap-4 group">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${log.role === 'user' ? 'bg-blue-100 text-blue-600' : 'bg-indigo-100 text-indigo-600'}`}>
                        {log.role === 'user' ? <UserIcon className="w-4 h-4" /> : <Activity className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{log.role === 'model' ? 'AI Assistant' : 'User'}</span>
                          <div className="flex items-center gap-3">
                            {log.sentiment && (
                              <span className={`flex items-center gap-1 text-[10px] font-bold uppercase ${log.sentiment === 'positive' ? 'text-emerald-600' : log.sentiment === 'negative' ? 'text-red-600' : 'text-slate-400'}`}>
                                {log.sentiment === 'positive' ? <Smile className="w-3 h-3" /> : log.sentiment === 'negative' ? <Frown className="w-3 h-3" /> : <Meh className="w-3 h-3" />}
                                {log.sentiment}
                              </span>
                            )}
                            <span className="text-[10px] text-slate-400">{new Date(log.created_at).toLocaleTimeString()}</span>
                          </div>
                        </div>
                        <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 p-3 rounded-xl inline-block max-w-full">{log.content}</p>
                        
                        {log.sources && log.sources.length > 0 && (
                          <div className="mt-3 space-y-2">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                              <BookOpen className="w-3 h-3" /> Sources Used
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {log.sources.map((src, i) => (
                                <div key={i} className="p-2 bg-indigo-50/50 border border-indigo-100 rounded-lg text-[10px]">
                                  <div className="flex justify-between items-center mb-1">
                                    <span className="font-bold text-indigo-900 truncate">{src.documentTitle}</span>
                                    <span className="text-indigo-400">p. {src.pageNumber}</span>
                                  </div>
                                  <p className="text-indigo-700/70 italic line-clamp-2">"{src.excerpt}"</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex justify-between items-center">
        <p className="text-xs text-slate-400">Page {page} of {totalPages}</p>
        <div className="flex gap-2">
          <button 
            disabled={page === 1}
            onClick={() => setPage(p => p - 1)}
            className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold disabled:opacity-50"
          >
            Previous
          </button>
          <button 
            disabled={page === totalPages}
            onClick={() => setPage(p => p + 1)}
            className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

const AdminDashboard = ({ 
  onLaunchKiosk, 
  sessionTimeout, 
  setSessionTimeout,
  billingVoiceRate,
  setBillingVoiceRate,
  billingTextRate,
  setBillingTextRate
}: { 
  onLaunchKiosk: (project: Project) => void, 
  sessionTimeout: number, 
  setSessionTimeout: (val: number) => void,
  billingVoiceRate: number,
  setBillingVoiceRate: (val: number) => void,
  billingTextRate: number,
  setBillingTextRate: (val: number) => void
}) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [users, setUsers] = useState<UserType[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [accountAnalytics, setAccountAnalytics] = useState<Analytics | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [managingProject, setManagingProject] = useState<Project | null>(null);
  const [projectDocs, setProjectDocs] = useState<Document[]>([]);
  const [newProject, setNewProject] = useState({ title: '', description: '', instructions: '', account_id: 'acc_default' });
  const [newAccount, setNewAccount] = useState({ 
    name: '', 
    branding_json: '{}',
    monthly_limit_usd: 100,
    warning_threshold_percent: 80,
    hard_stop_enabled: true
  });
  const [uploadingDoc, setUploadingDoc] = useState({ title: '', content: '' });
  const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ 
    show: boolean, 
    title: string, 
    message: string, 
    onConfirm: () => void,
    confirmLabel?: string,
    confirmColor?: string
  } | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const [currentUser, setCurrentUser] = useState<UserType | null>(null);
  const [impersonatedUser, setImpersonatedUser] = useState<UserType | null>(null);
  const effectiveUser = impersonatedUser || currentUser;
  const effectiveUserId = effectiveUser?.id || '';

  const [billingStatus, setBillingStatus] = useState<any>(null);

  useEffect(() => {
    const fetchBilling = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/account-billing-status`, {
          headers: { 'x-user-id': effectiveUser?.id || '' }
        });
        if (res.ok) {
          const data = await res.json();
          setBillingStatus(data);
        }
      } catch (e) {
        console.warn("Failed to fetch billing status.");
      }
    };
    if (effectiveUser) {
      fetchBilling();
      const interval = setInterval(fetchBilling, 30000);
      return () => clearInterval(interval);
    }
  }, [effectiveUser]);

  const billingAccessState = useMemo(() => {
    if (!billingStatus) return 'ok';
    if (billingStatus.isBlocked) return 'blocked';
    if (billingStatus.status === 'warning') return 'warning';
    return 'ok';
  }, [billingStatus]);

  const warningAccounts = useMemo(() => accounts.filter(acc => acc.status === 'warning'), [accounts]);
  const suspendedAccounts = useMemo(() => accounts.filter(acc => acc.isBlocked || acc.status === 'capped' || acc.status === 'suspended'), [accounts]);

  const [isInitialLoading, setIsInitialLoading] = useState(true);

  const fetchData = useCallback(async () => {
    console.log("fetchData: Starting Promise.all for projects, users, analytics, accounts, settings...");
    try {
      const headers = { 'x-user-id': effectiveUserId };
      const [pRes, uRes, aRes, accRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/api/projects`, { headers }).then(r => r),
        fetch(`${API_BASE}/api/users`, { headers }).then(r => r),
        fetch(`${API_BASE}/api/analytics`, { headers }).then(r => r),
        fetch(`${API_BASE}/api/accounts`, { headers }).then(r => r),
        fetch(`${API_BASE}/api/settings`, { headers }).then(r => r)
      ]);
      
      // Handle each response individually to avoid getting stuck if some fail (e.g. 403 on first load)
      if (pRes.ok) {
        const projects = await pRes.json();
        setProjects(projects);
      }
      
      if (uRes.ok) {
        const users = await uRes.json();
        setUsers(users);
        // Set initial current user if not set
        if (!currentUser && users.length > 0) {
          const admin = users.find((u: UserType) => u.role === 'admin');
          setCurrentUser(admin || users[0]);
        }
      }

      if (aRes.ok) {
        const analytics = await aRes.json();
        setAnalytics(analytics);
      } else {
        setAnalytics(null);
      }

      if (accRes.ok) {
        const accounts = await accRes.json();
        setAccounts(accounts);
      }

      if (sRes.ok) {
        const settings = await sRes.json();
        if (settings.session_timeout) setSessionTimeout(parseInt(settings.session_timeout));
        if (settings.billing_voice_rate_per_minute) setBillingVoiceRate(parseFloat(settings.billing_voice_rate_per_minute));
        if (settings.billing_text_rate_per_1000_chars) setBillingTextRate(parseFloat(settings.billing_text_rate_per_1000_chars));
      }

      setIsInitialLoading(false);
    } catch (error) {
      console.error("Fetch data failed:", error);
      setAnalytics(null);
      setIsInitialLoading(false);
    }
  }, [effectiveUserId, currentUser]);

  const fetchAccountAnalytics = async (accountId: string) => {
    try {
      const headers = { 'x-user-id': effectiveUserId };
      const res = await fetch(`${API_BASE}/api/accounts/${accountId}/analytics`, { headers });
      if (res.ok) {
        const data = await res.json();
        setAccountAnalytics(data);
      }
    } catch (error) {
      console.error("Failed to fetch account analytics:", error);
    }
  };

  useEffect(() => {
    if (selectedAccount) {
      fetchAccountAnalytics(selectedAccount.id);
    }
  }, [selectedAccount]);

  useEffect(() => {
    console.log("App: Fetching initial data using API_BASE:", API_BASE || "(relative)");
    fetch(`${API_BASE}/api/health`)
      .then(res => res.json())
      .then(data => console.log("Server Health Check:", data))
      .catch(err => console.error("Server Health Check Failed:", err));

    fetchData();
  }, [fetchData]);

  const handleCreateProject = async () => {
    if (!newProject.title) return;
    try {
      const res = await fetch(editingProject ? `${API_BASE}/api/projects/${editingProject.id}` : `${API_BASE}/api/projects`, {
        method: editingProject ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProject)
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Server returned ${res.status}`);
      }
      
      setNewProject({ title: '', description: '', instructions: '', account_id: 'acc_default' });
      setShowNewProject(false);
      setEditingProject(null);
      fetchData();
    } catch (error) {
      console.error("Failed to save project:", error);
      alert(`Error: ${error instanceof Error ? error.message : 'Failed to save project'}`);
    }
  };

  const handleCreateAccount = async () => {
    if (!newAccount.name) return;
    try {
      const res = await fetch(editingAccount ? `${API_BASE}/api/accounts/${editingAccount.id}` : `${API_BASE}/api/accounts`, {
        method: editingAccount ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAccount)
      });
      
      if (!res.ok) throw new Error('Failed to save account');
      
      setNewAccount({ 
        name: '', 
        branding_json: '{}',
        monthly_limit_usd: 100,
        warning_threshold_percent: 80,
        hard_stop_enabled: true
      });
      setShowNewAccount(false);
      setEditingAccount(null);
      fetchData();
    } catch (error) {
      console.error("Failed to save account:", error);
    }
  };

  const handleEditProject = (proj: Project) => {
    setEditingProject(proj);
    setNewProject({ 
      title: proj.title, 
      description: proj.description || '', 
      instructions: proj.instructions || '',
      account_id: proj.account_id || 'acc_default'
    });
    setShowNewProject(true);
  };

  const handleEditAccount = (acc: Account) => {
    setEditingAccount(acc);
    setNewAccount({ 
      name: acc.name, 
      branding_json: acc.branding_json || '{}',
      monthly_limit_usd: acc.monthly_limit_usd || 100,
      warning_threshold_percent: acc.warning_threshold_percent || 80,
      hard_stop_enabled: acc.hard_stop_enabled ?? true
    });
    setShowNewAccount(true);
  };

  const handleManageProject = async (proj: Project) => {
    setManagingProject(proj);
    try {
      const res = await fetch(`${API_BASE}/api/projects/${proj.id}/documents`);
      if (!res.ok) throw new Error('Failed to fetch documents');
      const docs = await res.json();
      console.log("Fetched docs for project:", proj.id, docs);
      setProjectDocs(docs);
    } catch (error) {
      console.error("Error fetching project documents:", error);
      setProjectDocs([]);
    }
  };

  const handleDeleteDoc = (docId: string) => {
    setConfirmModal({
      show: true,
      title: 'Delete Document',
      message: 'Are you sure you want to delete this document? This action cannot be undone.',
      onConfirm: async () => {
        await fetch(`${API_BASE}/api/documents/${docId}`, { method: 'DELETE' });
        if (managingProject) handleManageProject(managingProject);
        fetchData();
        setConfirmModal(null);
      }
    });
  };

  const handleUploadDoc = async () => {
    if (!managingProject || (!uploadingDoc.title && selectedFiles.length === 0 && !uploadingDoc.content)) return;
    
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('title', uploadingDoc.title);
      formData.append('content', uploadingDoc.content);
      
      if (selectedFiles.length > 0) {
        selectedFiles.forEach(file => {
          formData.append('files', file);
        });
      }

      await fetch(`${API_BASE}/api/projects/${managingProject.id}/documents`, {
        method: 'POST',
        body: formData
      });
      
      setUploadingDoc({ title: '', content: '' });
      setSelectedFiles([]);
      setShowUploadModal(false);
      handleManageProject(managingProject);
      fetchData();
    } catch (error) {
      console.error("Upload failed:", error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteProject = (id: string) => {
    setConfirmModal({
      show: true,
      title: 'Delete Project',
      message: 'Are you sure you want to delete this project and all its documents? This action cannot be undone.',
      onConfirm: async () => {
        await fetch(`${API_BASE}/api/projects/${id}`, { method: 'DELETE' });
        fetchData();
        setConfirmModal(null);
      }
    });
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    try {
      const responses = await Promise.all([
        fetch(`${API_BASE}/api/settings`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-user-id': effectiveUser?.id || ''
          },
          body: JSON.stringify({ key: 'session_timeout', value: sessionTimeout })
        }),
        fetch(`${API_BASE}/api/settings`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-user-id': effectiveUser?.id || ''
          },
          body: JSON.stringify({ key: 'billing_voice_rate_per_minute', value: billingVoiceRate })
        }),
        fetch(`${API_BASE}/api/settings`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-user-id': effectiveUser?.id || ''
          },
          body: JSON.stringify({ key: 'billing_text_rate_per_1000_chars', value: billingTextRate })
        })
      ]);

      const allOk = responses.every(res => res.ok);

      if (allOk) {
        setConfirmModal({
          show: true,
          title: 'Settings Saved',
          message: 'Your system settings have been successfully updated.',
          onConfirm: () => setConfirmModal(null),
          confirmLabel: 'OK',
          confirmColor: 'bg-indigo-600 hover:bg-indigo-700'
        });
      } else {
        const failed = responses.filter(r => !r.ok);
        console.error("Some settings failed to save:", failed);
        setConfirmModal({
          show: true,
          title: 'Save Failed',
          message: 'One or more settings could not be saved. Please check your connection and try again.',
          onConfirm: () => setConfirmModal(null),
          confirmLabel: 'OK',
          confirmColor: 'bg-red-600 hover:bg-red-700'
        });
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      setConfirmModal({
        show: true,
        title: 'Error',
        message: 'An unexpected error occurred while saving settings.',
        onConfirm: () => setConfirmModal(null),
        confirmLabel: 'OK',
        confirmColor: 'bg-red-600 hover:bg-red-700'
      });
    } finally {
      setIsSavingSettings(false);
    }
  };

  if (isInitialLoading || !effectiveUser) {
    return (
      <div className="min-h-screen bg-bloom bg-dots flex items-center justify-center p-8 w-full">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-500 font-bold text-xs uppercase tracking-widest">Initializing Platform...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-bloom bg-dots text-white flex flex-col md:flex-row font-sans relative overflow-hidden">
      {/* Impersonation Banner */}
      {impersonatedUser && (
        <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-white px-4 py-2 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3 text-sm font-bold">
            <Activity className="w-4 h-4 animate-pulse" />
            <span>Impersonating: {impersonatedUser.name} ({impersonatedUser.email})</span>
          </div>
          <button 
            onClick={() => setImpersonatedUser(null)}
            className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-bold transition-colors"
          >
            Return to Admin
          </button>
        </div>
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-surface-low/80 backdrop-blur-2xl border-r border-white/5 flex flex-col transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${showMobileMenu ? 'translate-x-0' : '-translate-x-full'} ${impersonatedUser ? 'pt-10' : ''}`}>
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="https://caribdesigns.com/voiceit-logo.png" alt="VoiceIt" className="h-24 w-auto" referrerPolicy="no-referrer" />
          </div>
          <button onClick={() => setShowMobileMenu(false)} className="md:hidden p-2 text-slate-400 hover:text-slate-200">
            <LogOut className="w-5 h-5 rotate-180" />
          </button>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {[
            { id: 'overview', icon: LayoutDashboard, label: 'Overview', roles: ['admin'] },
            { id: 'accounts', icon: Building2, label: 'Accounts', roles: ['admin'] },
            { id: 'projects', icon: BookOpen, label: 'Projects', roles: ['admin', 'user'] },
            { id: 'messages', icon: MessageSquare, label: 'Messages', roles: ['admin', 'user'] },
            { id: 'billing', icon: CreditCard, label: 'Billing', roles: ['admin', 'user'] },
            { id: 'users', icon: UserIcon, label: 'Users', roles: ['admin'] },
            { id: 'settings', icon: Settings, label: 'Settings', roles: ['admin'] },
          ].filter(item => !item.roles || item.roles.includes(effectiveUser?.role || 'user')).map((item) => (
            <button
              key={item.id}
              onClick={() => { setActiveTab(item.id); setManagingProject(null); setSelectedAccount(null); setShowMobileMenu(false); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === item.id && !managingProject && !selectedAccount ? 'bg-indigo-600/10 text-indigo-400' : 'text-slate-400 hover:bg-white/5'}`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-white/5">
          <div className="bg-white/5 p-4 rounded-xl">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">System Health</p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full animate-pulse ${analytics ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span className={`text-sm font-medium ${analytics ? 'text-emerald-400' : 'text-red-400'}`}>
                  {analytics ? 'Operational' : 'Backend Unreachable'}
                </span>
              </div>
              {!analytics && (
                <button 
                  onClick={() => fetchData()} 
                  className="p-1 text-slate-400 hover:text-indigo-400 transition-colors"
                  title="Retry connection"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="md:hidden bg-surface-low border-b border-white/5 p-4 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white">
            <Volume2 className="w-5 h-5" />
          </div>
          <img src="https://caribdesigns.com/voiceit-logo.png" alt="VoiceIt" className="h-18 w-auto" referrerPolicy="no-referrer" />
        </div>
        <button onClick={() => setShowMobileMenu(true)} className="p-2 bg-white/5 rounded-lg text-slate-400">
          <LayoutDashboard className="w-5 h-5" />
        </button>
      </div>

      {/* Overlay */}
      {showMobileMenu && (
        <div 
          className="fixed inset-0 bg-surface-low/60 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setShowMobileMenu(false)}
        />
      )}

      {/* Main */}
      <main className="flex-1 p-4 md:p-10 overflow-y-auto bg-transparent">
        {/* Admin-wide Billing Notifications */}
        {effectiveUser?.role === 'admin' && (warningAccounts.length > 0 || suspendedAccounts.length > 0) && (
          <div className="mb-6 space-y-3">
            {suspendedAccounts.length > 0 && (
              <div className="p-4 rounded-2xl border bg-red-50 border-red-200 text-red-700 flex items-center gap-3 shadow-sm">
                <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-bold">Attention: {suspendedAccounts.length} account(s) are suspended due to usage limits.</p>
                </div>
              </div>
            )}
            {warningAccounts.length > 0 && (
              <div className="p-4 rounded-2xl border bg-amber-50 border-amber-200 text-amber-700 flex items-center gap-3 shadow-sm">
                <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-bold">Attention: {warningAccounts.length} account(s) have reached warning threshold.</p>
                </div>
              </div>
            )}
          </div>
        )}

        {billingAccessState !== 'ok' && (
          <div className={`mb-6 p-4 rounded-2xl border flex items-center gap-3 ${
            billingAccessState === 'blocked' 
              ? 'bg-red-50 border-red-200 text-red-700' 
              : 'bg-amber-50 border-amber-200 text-amber-700'
          }`}>
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-bold">
                {billingAccessState === 'blocked' ? 'Account Suspended' : 'Billing Warning'}
              </p>
              <p className="opacity-90">
                {billingAccessState === 'blocked' 
                  ? 'This account has reached its monthly limit and AI features are disabled.' 
                  : 'This account is approaching its monthly limit. Please review usage.'}
              </p>
            </div>
          </div>
        )}
        <header className={`flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8 md:mb-10 ${impersonatedUser ? 'mt-12' : ''}`}>
          <div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white capitalize">
              {managingProject ? 'Project Management' : selectedAccount ? `Account: ${selectedAccount.name}` : activeTab}
            </h2>
            <p className="text-slate-400 mt-1 text-sm md:text-base">
              {selectedAccount ? 'View account-specific analytics and projects.' : 'Manage your enterprise knowledge and kiosk deployments.'}
            </p>
          </div>
          <div className="flex gap-3 w-full sm:w-auto">
            {activeTab === 'accounts' && !selectedAccount && effectiveUser?.role === 'admin' && (
              <button 
                onClick={() => setShowNewAccount(true)}
                className="flex-1 sm:flex-none px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
              >
                New Account
              </button>
            )}
            {activeTab === 'projects' && !managingProject && (
              <button 
                onClick={() => setShowNewProject(true)}
                className="flex-1 sm:flex-none px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
              >
                New Project
              </button>
            )}
          </div>
        </header>

        {managingProject ? (
          <div className="space-y-8">
            <div className="flex items-center gap-3 md:gap-4 mb-6 md:mb-8">
              <button 
                onClick={() => setManagingProject(null)} 
                className="p-2 hover:bg-white/5 rounded-full transition-colors text-slate-400"
              >
                <ChevronRight className="w-5 h-5 md:w-6 md:h-6 rotate-180" />
              </button>
              <div className="min-w-0">
                <h3 className="text-xl md:text-2xl font-bold truncate text-white">{managingProject.title}</h3>
                <p className="text-slate-400 text-xs md:text-sm truncate">Manage documents and knowledge base for this project.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-surface-low rounded-2xl border border-white/5 overflow-hidden">
                  <div className="p-4 md:p-6 border-b border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <h4 className="font-bold text-white">Documents</h4>
                    <button 
                      onClick={() => setShowUploadModal(true)}
                      className="w-full sm:w-auto px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold shadow-sm"
                    >
                      Upload Document
                    </button>
                  </div>
                  <div className="divide-y divide-white/5">
                    {projectDocs.map(doc => (
                      <div key={doc.id} className="p-4 md:p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:bg-white/5 transition-colors">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-white/5 rounded-xl text-slate-400">
                            <FileText className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-medium text-sm md:text-base text-white">{doc.title}</p>
                            <p className="text-[10px] md:text-xs text-slate-500 uppercase tracking-wider">{doc.page_count} Pages • PDF</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                          <button 
                            onClick={() => setViewingDoc(doc)}
                            className="text-indigo-400 text-sm font-bold hover:underline"
                          >
                            View
                          </button>
                          <button 
                            onClick={() => handleDeleteDoc(doc.id)}
                            className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {projectDocs.length === 0 && (
                      <div className="p-12 text-center text-slate-400">
                        No documents uploaded yet.
                      </div>
                    )}
                  </div>
                </div>
                          <div className="space-y-6">
                <div className="bg-surface-low/40 backdrop-blur-xl p-6 md:p-8 rounded-2xl border border-white/5 shadow-sm">
                  <h4 className="font-bold mb-6 text-white">Project Details</h4>
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Description</p>
                      <p className="text-sm text-slate-400">{managingProject.description}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">AI Instructions</p>
                      <p className="text-sm text-slate-400 italic">"{managingProject.instructions}"</p>
                    </div>
                    <button 
                      onClick={() => handleEditProject(managingProject)}
                      className="w-full mt-4 py-2 border border-white/5 rounded-lg text-sm font-bold hover:bg-white/5 transition-colors text-white"
                    >
                      Edit Project Details
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : selectedAccount ? (
          <div className="space-y-8">
            <div className="flex items-center gap-4 mb-8">
              <button 
                onClick={() => setSelectedAccount(null)} 
                className="p-2 hover:bg-white/5 rounded-full transition-colors text-slate-400"
              >
                <ChevronRight className="w-6 h-6 rotate-180" />
              </button>
              <div>
                <h3 className="text-2xl font-bold text-white">{selectedAccount.name}</h3>
                <p className="text-slate-400 text-sm">Account Overview & Scoped Analytics</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-surface-low/40 backdrop-blur-xl p-6 rounded-2xl border border-white/5 shadow-sm">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Total Sessions</p>
                <h3 className="text-2xl font-bold text-white">{accountAnalytics?.totalSessions || 0}</h3>
              </div>
              <div className="bg-surface-low/40 backdrop-blur-xl p-6 rounded-2xl border border-white/5 shadow-sm">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Active Projects</p>
                <h3 className="text-2xl font-bold text-white">{accountAnalytics?.activeProjects || 0}</h3>
              </div>
              <div className="bg-surface-low/40 backdrop-blur-xl p-6 rounded-2xl border border-white/5 shadow-sm">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Avg. Accuracy</p>
                <h3 className="text-2xl font-bold text-white">{accountAnalytics?.accuracy || 0}%</h3>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-surface-low/40 backdrop-blur-xl p-8 rounded-3xl border border-white/5 shadow-sm">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-6">Sentiment Analysis</h3>
                <div className="flex items-center justify-around py-4">
                  <div className="text-center">
                    <Smile className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                    <p className="text-2xl font-bold text-white">{accountAnalytics?.sentimentTotals?.positive || 0}</p>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Positive</p>
                  </div>
                  <div className="text-center">
                    <Meh className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                    <p className="text-2xl font-bold text-white">{accountAnalytics?.sentimentTotals?.neutral || 0}</p>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Neutral</p>
                  </div>
                  <div className="text-center">
                    <Frown className="w-8 h-8 text-red-500 mx-auto mb-2" />
                    <p className="text-2xl font-bold text-white">{accountAnalytics?.sentimentTotals?.negative || 0}</p>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Negative</p>
                  </div>
                </div>
              </div>

              <div className="bg-surface-low p-8 rounded-3xl border border-white/5 shadow-sm">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-6">Account Projects</h3>
                <div className="space-y-4">
                  {projects.filter(p => p.account_id === selectedAccount.id).map(proj => (
                    <div key={proj.id} className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
                      <span className="font-bold text-slate-200">{proj.title}</span>
                      <button onClick={() => handleManageProject(proj)} className="text-indigo-400 text-xs font-bold hover:underline">Manage</button>
                    </div>
                  ))}
                  {projects.filter(p => p.account_id === selectedAccount.id).length === 0 && (
                    <p className="text-slate-500 italic text-sm">No projects assigned to this account.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-10">
            {activeTab === 'messages' && (
              <MessagesView 
                effectiveUser={effectiveUser}
                projects={projects}
                accounts={accounts}
              />
            )}
            {activeTab === 'billing' && (
              <BillingView 
                effectiveUser={effectiveUser}
                projects={projects}
                accounts={accounts}
                analytics={analytics}
              />
            )}
            {activeTab === 'overview' && effectiveUser?.role === 'admin' && (
              <>
                {/* Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-10">
                  {[
                    { label: 'Total Sessions', value: analytics?.totalSessions || '0', change: '+12%', icon: Activity },
                    { label: 'Active Kiosks', value: analytics?.activeKiosks || '0', change: 'Live', icon: Settings },
                    { label: 'Knowledge Base', value: `${analytics?.totalDocuments || 0} docs`, change: `${analytics?.totalMessages || 0} msgs`, icon: BookOpen },
                    { label: 'Avg. Accuracy', value: `${analytics?.accuracy || 0}%`, change: '+0.2%', icon: Info },
                  ].map((stat, i) => (
                    <div key={i} className="bg-surface-low p-4 md:p-6 rounded-2xl border border-white/5 shadow-sm">
                      <div className="flex justify-between items-start mb-4">
                        <div className="p-2 bg-white/5 rounded-lg text-slate-400">
                          <stat.icon className="w-5 h-5" />
                        </div>
                        <span className={`text-[10px] md:text-xs font-bold px-2 py-1 rounded-full ${stat.change.startsWith('+') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-slate-400'}`}>
                          {stat.change}
                        </span>
                      </div>
                      <p className="text-xs md:text-sm font-medium text-slate-500">{stat.label}</p>
                      <h3 className="text-xl md:text-2xl font-bold text-white">{stat.value}</h3>
                    </div>
                  ))}
                </div>

                {/* User Location Map */}
                <div className="bg-surface-low p-6 md:p-8 rounded-3xl border border-white/5 shadow-sm mb-10 overflow-hidden">
                  <h3 className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-wider mb-6 flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    User Location Map
                  </h3>
                  <div className="h-[400px] w-full rounded-2xl overflow-hidden border border-white/5">
                    <MapContainer center={[20, 0]} zoom={2} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />
                      <MarkerClusterGroup chunkedLoading iconCreateFunction={createCustomClusterIcon}>
                        {analytics?.location_points?.map((point, idx) => (
                          <Marker key={idx} position={[point.latitude, point.longitude]} icon={DefaultIcon}>
                            <Popup>
                              <div className="text-xs font-bold text-slate-900">{point.city}, {point.country}</div>
                              <div className="text-[10px] text-slate-500">{point.count} sessions</div>
                            </Popup>
                          </Marker>
                        ))}
                      </MarkerClusterGroup>
                    </MapContainer>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
                  {/* Top Countries Table */}
                  <div className="bg-surface-low p-6 md:p-8 rounded-3xl border border-white/5 shadow-sm">
                    <h3 className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-wider mb-6">Top 5 Countries</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-white/5">
                            <th className="pb-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Rank</th>
                            <th className="pb-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Country</th>
                            <th className="pb-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Count</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {analytics?.top_countries?.map((c, i) => (
                            <tr key={i} className="hover:bg-white/5 transition-colors">
                              <td className="py-4 text-sm font-bold text-slate-500">#{i + 1}</td>
                              <td className="py-4 text-sm font-bold text-slate-300">{c.country}</td>
                              <td className="py-4 text-sm font-bold text-white text-right">{c.count}</td>
                            </tr>
                          ))}
                          {(!analytics?.top_countries || analytics.top_countries.length === 0) && (
                            <tr>
                              <td colSpan={3} className="py-8 text-center text-slate-400 italic text-sm">No data available</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Device Breakdown Pie Chart */}
                  <div className="bg-surface-low p-6 md:p-8 rounded-3xl border border-white/5 shadow-sm">
                    <h3 className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-6">Device Breakdown</h3>
                    <div className="h-[250px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={[
                              { name: 'Mobile', value: analytics?.device_breakdown?.mobile || 0 },
                              { name: 'Desktop', value: analytics?.device_breakdown?.desktop || 0 }
                            ].filter(d => d.value > 0)}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            <Cell fill="#6366f1" />
                            <Cell fill="#10b981" />
                          </Pie>
                          <RechartsTooltip 
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                          />
                          <Legend verticalAlign="bottom" height={36}/>
                        </PieChart>
                      </ResponsiveContainer>
                      {(!analytics?.device_breakdown || (analytics.device_breakdown.mobile === 0 && analytics.device_breakdown.desktop === 0)) && (
                        <div className="flex items-center justify-center h-full text-slate-400 italic text-sm">No data available</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Sentiment Overview */}
                <div className="bg-surface-low p-6 md:p-8 rounded-3xl border border-white/5 shadow-sm mb-10">
                  <h3 className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-6">Global Sentiment Analysis</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-emerald-500/10 rounded-2xl">
                      <Smile className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
                      <p className="text-xl font-bold text-emerald-400">{analytics?.sentimentTotals?.positive || 0}</p>
                      <p className="text-[8px] font-bold text-emerald-400 uppercase tracking-widest">Positive</p>
                    </div>
                    <div className="text-center p-4 bg-amber-500/10 rounded-2xl">
                      <Meh className="w-6 h-6 text-amber-400 mx-auto mb-2" />
                      <p className="text-xl font-bold text-amber-400">{analytics?.sentimentTotals?.neutral || 0}</p>
                      <p className="text-[8px] font-bold text-amber-400 uppercase tracking-widest">Neutral</p>
                    </div>
                    <div className="text-center p-4 bg-red-500/10 rounded-2xl">
                      <Frown className="w-6 h-6 text-red-400 mx-auto mb-2" />
                      <p className="text-xl font-bold text-red-400">{analytics?.sentimentTotals?.negative || 0}</p>
                      <p className="text-[8px] font-bold text-red-400 uppercase tracking-widest">Negative</p>
                    </div>
                  </div>
                </div>

                {/* Projects Grid */}
                <h3 className="text-lg md:text-xl font-bold mb-6 flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-indigo-600" />
                  Active Projects
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {projects.map((proj) => (
                    <div key={proj.id} className="bg-surface-low border border-white/5 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow group text-white">
                      <div className="h-24 md:h-32 bg-slate-100 relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/20 to-purple-500/20" />
                        <div className="absolute bottom-4 left-4">
                          <span className="px-2 py-1 bg-white/90 backdrop-blur rounded text-[10px] font-bold uppercase tracking-wider text-indigo-600">Active</span>
                        </div>
                      </div>
                      <div className="p-4 md:p-6">
                        <h4 
                          onClick={() => setManagingProject(proj)}
                          className="text-lg font-bold text-slate-900 mb-2 group-hover:text-indigo-600 transition-colors cursor-pointer"
                        >
                          {proj.title}
                        </h4>
                        <p className="text-sm text-slate-500 line-clamp-2 mb-4">{proj.description}</p>
                        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{proj.account_name || 'Enterprise'}</span>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => {
                                setManagingProject(proj);
                                setActiveTab('logs');
                              }}
                              className="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-600 hover:text-white transition-all"
                            >
                              <Activity className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => onLaunchKiosk(proj)}
                              className="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-600 hover:text-white transition-all"
                            >
                              <Mic className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {activeTab === 'overview' && effectiveUser?.role !== 'admin' && accounts.length > 0 && (
              <AccountDashboard 
                account={accounts.find(a => a.id === effectiveUser?.account_id) || accounts[0]} 
                projects={projects} 
                analytics={analytics} 
              />
            )}

            {activeTab === 'accounts' && effectiveUser?.role === 'admin' && (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-sm">
                <table className="w-full text-left min-w-[600px]">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Account Name</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Projects</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Users</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Balance</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {accounts.map(acc => (
                      <tr key={acc.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 font-bold text-xs">
                              {acc.name[0]}
                            </div>
                            <span className="font-bold text-sm text-slate-900">{acc.name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-500">
                          {projects.filter(p => p.account_id === acc.id).length} Projects
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-500">
                          {users.filter(u => u.account_id === acc.id).length} Users
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-sm font-bold ${acc.balance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                            ${acc.balance?.toFixed(2) || '0.00'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end gap-3">
                            <button onClick={() => setSelectedAccount(acc)} className="text-indigo-600 font-bold text-xs hover:underline">View Dashboard</button>
                            <button onClick={() => handleEditAccount(acc)} className="text-slate-600 font-bold text-xs hover:underline">Edit</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {activeTab === 'users' && effectiveUser?.role === 'admin' && (
              <UsersView users={users} accounts={accounts} onRefresh={fetchData} onImpersonate={setImpersonatedUser} />
            )}

            {activeTab === 'projects' && (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-sm">
                <table className="w-full text-left min-w-[600px]">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 md:px-6 py-4 text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider">Project Name</th>
                      <th className="px-4 md:px-6 py-4 text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider">Description</th>
                      <th className="px-4 md:px-6 py-4 text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider">Credit Used</th>
                      <th className="px-4 md:px-6 py-4 text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider">Status</th>
                      <th className="px-4 md:px-6 py-4 text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {projects.map(proj => (
                      <tr key={proj.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 md:px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 font-bold text-xs">{proj.title[0]}</div>
                            <span className="font-bold text-xs md:text-sm text-slate-900">{proj.title}</span>
                          </div>
                        </td>
                        <td className="px-4 md:px-6 py-4 text-[10px] md:text-xs text-slate-500 max-w-[200px] truncate">{proj.description}</td>
                        <td className="px-4 md:px-6 py-4">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] font-bold text-slate-600">Voice: ${proj.voiceCreditUsedUsd?.toFixed(2) || '0.00'}</span>
                            <span className="text-[10px] font-bold text-slate-600">Text: ${proj.textCreditUsedUsd?.toFixed(2) || '0.00'}</span>
                          </div>
                        </td>
                        <td className="px-4 md:px-6 py-4">
                          <span className="px-2 py-1 bg-emerald-50 text-emerald-700 text-[8px] md:text-[10px] font-bold rounded-full uppercase tracking-wider">Active</span>
                        </td>
                        <td className="px-4 md:px-6 py-4 text-right">
                          <div className="flex justify-end gap-2 md:gap-3">
                            <button onClick={() => onLaunchKiosk(proj)} className="text-indigo-600 font-bold text-[10px] md:text-xs hover:underline">Kiosk</button>
                            <button onClick={() => handleManageProject(proj)} className="text-slate-600 font-bold text-[10px] md:text-xs hover:underline">Manage</button>
                            <button 
                              onClick={() => {
                                setManagingProject(proj);
                                setActiveTab('logs');
                              }} 
                              className="text-emerald-600 font-bold text-[10px] md:text-xs hover:underline"
                            >
                              Logs
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'users' && (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-sm">
                <table className="w-full text-left min-w-[600px]">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 md:px-6 py-4 text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider">User</th>
                      <th className="px-4 md:px-6 py-4 text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider">Email</th>
                      <th className="px-4 md:px-6 py-4 text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider">Account</th>
                      <th className="px-4 md:px-6 py-4 text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider">Role</th>
                      <th className="px-4 md:px-6 py-4 text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Last Active</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.map(user => (
                      <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 md:px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-400"><UserIcon className="w-4 h-4" /></div>
                            <span className="font-bold text-xs md:text-sm text-slate-900">{user.name}</span>
                          </div>
                        </td>
                        <td className="px-4 md:px-6 py-4 text-[10px] md:text-xs text-slate-500">{user.email}</td>
                        <td className="px-4 md:px-6 py-4 text-[10px] md:text-xs text-slate-500">{user.account_name || 'Global'}</td>
                        <td className="px-4 md:px-6 py-4">
                          <span className={`px-2 py-1 text-[8px] md:text-[10px] font-bold rounded-full uppercase tracking-wider ${user.role === 'admin' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
                            {user.role}
                          </span>
                        </td>
                        <td className="px-4 md:px-6 py-4 text-right text-[10px] md:text-xs text-slate-400">{new Date(user.last_active).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'logs' && managingProject && (
              <ProjectLogsView project={managingProject} onBack={() => {
                setManagingProject(null);
                setActiveTab('projects');
              }} />
            )}

            {activeTab === 'analytics' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                <div className="bg-white p-4 md:p-8 rounded-3xl border border-slate-200 shadow-sm">
                  <h3 className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-6">Session Volume (Last 7 Days)</h3>
                  <div className="h-48 md:h-64 flex items-end gap-1 md:gap-2">
                    {(analytics?.sessionVolume || [0, 0, 0, 0, 0, 0, 0]).map((count: number, i: number) => {
                      const max = Math.max(...(analytics?.sessionVolume || [1]), 1);
                      const h = (count / max) * 100;
                      return (
                        <div key={i} className="flex-1 bg-indigo-50 rounded-t-lg relative group">
                          <motion.div 
                            initial={{ height: 0 }} 
                            animate={{ height: `${Math.max(h, 5)}%` }} 
                            transition={{ duration: 1, delay: i * 0.1 }}
                            className="bg-indigo-600 rounded-t-lg w-full" 
                          />
                          <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                            {count} sessions
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between mt-4 text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                  </div>
                </div>
                <div className="bg-white p-4 md:p-8 rounded-3xl border border-slate-200 shadow-sm">
                  <h3 className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-6">Accuracy Distribution</h3>
                  <div className="space-y-6">
                    {[
                      { label: 'Correct Answers', value: analytics?.distribution?.correct || 94, color: 'bg-emerald-500' },
                      { label: 'Clarifications', value: analytics?.distribution?.clarifications || 4, color: 'bg-amber-500' },
                      { label: 'Unknowns', value: analytics?.distribution?.unknowns || 2, color: 'bg-red-500' },
                    ].map((item, i) => (
                      <div key={i}>
                        <div className="flex justify-between text-[10px] md:text-xs mb-2">
                          <span className="font-bold text-slate-700 uppercase tracking-wider">{item.label}</span>
                          <span className="font-bold text-slate-900">{item.value}%</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }} 
                            animate={{ width: `${item.value}%` }} 
                            transition={{ duration: 1, delay: i * 0.2 }}
                            className={`h-full ${item.color}`} 
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="max-w-2xl space-y-4 md:space-y-8">
                <div className="bg-white p-6 md:p-8 rounded-2xl border border-slate-200 shadow-sm">
                  <h4 className="font-bold mb-6 md:mb-8 text-sm md:text-base">Account Settings</h4>
                  <div className="space-y-4 md:space-y-6">
                    <div>
                      <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Organization Name</label>
                      <input type="text" defaultValue="Global Enterprise" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 text-sm md:text-base" />
                    </div>
                    <div>
                      <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Primary Contact Email</label>
                      <input type="email" defaultValue="admin@enterprise.com" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 text-sm md:text-base" />
                    </div>
                  </div>
                </div>

                {effectiveUser?.role === 'admin' && (
                  <div className="bg-white p-6 md:p-8 rounded-2xl border border-slate-200 shadow-sm">
                    <h4 className="font-bold mb-6 md:mb-8 text-sm md:text-base">Billing Rates</h4>
                    <div className="space-y-4 md:space-y-6">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div>
                          <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Voice Rate ($ / min)</label>
                          <input 
                            type="number" 
                            step="0.01"
                            value={billingVoiceRate}
                            onChange={(e) => setBillingVoiceRate(parseFloat(e.target.value))}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 text-sm md:text-base" 
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Text Rate ($ / 1k chars)</label>
                          <input 
                            type="number" 
                            step="0.01"
                            value={billingTextRate}
                            onChange={(e) => setBillingTextRate(parseFloat(e.target.value))}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 text-sm md:text-base" 
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-white p-6 md:p-8 rounded-2xl border border-slate-200 shadow-sm">
                  <h4 className="font-bold mb-6 md:mb-8 text-sm md:text-base">Kiosk Behavior</h4>
                  <div className="space-y-4 md:space-y-6">
                    <div>
                      <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Session Timeout (seconds)</label>
                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                        <input 
                          type="range" 
                          min="30" 
                          max="600" 
                          step="30"
                          value={sessionTimeout}
                          onChange={(e) => setSessionTimeout(parseInt(e.target.value))}
                          className="w-full sm:flex-1 h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                        <span className="w-16 text-center font-bold text-indigo-600 bg-indigo-50 py-1 rounded-lg text-sm md:text-base">
                          {sessionTimeout}s
                        </span>
                      </div>
                      <p className="text-[10px] md:text-xs text-slate-400 mt-2">How long to wait before prompting the user and eventually closing the session due to inactivity.</p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 px-2 md:px-0">
                  <button onClick={() => fetchData()} className="flex-1 sm:flex-none px-6 py-2 bg-white/5 text-slate-400 rounded-lg text-sm font-bold">Cancel</button>
                  <button 
                    onClick={handleSaveSettings}
                    disabled={isSavingSettings}
                    className={`flex-1 sm:flex-none px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold shadow-sm flex items-center justify-center gap-2 ${isSavingSettings ? 'opacity-50' : ''}`}
                  >
                    {isSavingSettings ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Saving...
                      </>
                    ) : 'Save Changes'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Confirm Modal */}
      <AnimatePresence>
        {confirmModal && confirmModal.show && (
          <div className="fixed inset-0 bg-surface-low/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4 md:p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-surface-low border border-white/10 w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 md:p-8 border-b border-slate-100">
                <h3 className="text-xl md:text-2xl font-bold">{confirmModal.title}</h3>
                <p className="text-slate-500 mt-2 text-sm md:text-base">{confirmModal.message}</p>
              </div>
              <div className="p-6 md:p-8 bg-slate-50 flex flex-col sm:flex-row justify-end gap-3">
                <button 
                  onClick={() => setConfirmModal(null)}
                  className="px-6 py-2 text-slate-600 font-bold text-sm md:text-base"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmModal.onConfirm}
                  className={`px-8 py-2 ${confirmModal.confirmColor || 'bg-red-600 hover:bg-red-700'} text-white rounded-xl font-bold shadow-lg transition-colors text-sm md:text-base`}
                >
                  {confirmModal.confirmLabel || 'Confirm Delete'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* New Project Modal */}
      <AnimatePresence>
        {showNewProject && (
          <div className="fixed inset-0 bg-surface-low/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 md:p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-surface-low border border-white/10 w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 md:p-8 border-b border-slate-100">
                <h3 className="text-xl md:text-2xl font-bold">{editingProject ? 'Edit Project' : 'Create New Project'}</h3>
                <p className="text-slate-500 mt-1 text-xs md:text-sm">Define your knowledge base and AI behavior.</p>
              </div>
              <div className="p-6 md:p-8 space-y-6 overflow-y-auto flex-1">
                <div>
                  <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Account Assignment</label>
                  <select 
                    value={newProject.account_id}
                    onChange={e => setNewProject({...newProject, account_id: e.target.value})}
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 text-sm md:text-base text-black"
                  >
                    {accounts.map(acc => (
                      <option key={acc.id} value={acc.id}>{acc.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Project Title</label>
                  <input 
                    type="text" 
                    value={newProject.title}
                    onChange={e => setNewProject({...newProject, title: e.target.value})}
                    placeholder="e.g. Legal & Policy Library" 
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 text-sm md:text-base text-black" 
                  />
                </div>
                <div>
                  <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Description</label>
                  <textarea 
                    value={newProject.description}
                    onChange={e => setNewProject({...newProject, description: e.target.value})}
                    placeholder="Briefly describe the purpose..." 
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 h-20 md:h-24 resize-none text-sm md:text-base text-black" 
                  />
                </div>
                <div>
                  <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">AI Instructions</label>
                  <textarea 
                    value={newProject.instructions}
                    onChange={e => setNewProject({...newProject, instructions: e.target.value})}
                    placeholder="How should the AI behave?" 
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 h-24 md:h-32 resize-none text-sm md:text-base text-black" 
                  />
                </div>
              </div>
              <div className="p-6 md:p-8 bg-slate-50 flex flex-col sm:flex-row justify-end gap-3">
                <button 
                  onClick={() => { setShowNewProject(false); setEditingProject(null); }}
                  className="px-6 py-2 text-slate-600 font-bold text-sm md:text-base"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleCreateProject}
                  className="px-8 py-2 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition-colors text-sm md:text-base"
                >
                  {editingProject ? 'Save Changes' : 'Create Project'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* New Account Modal */}
      <AnimatePresence>
        {showNewAccount && (
          <div className="fixed inset-0 bg-surface-low/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 md:p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-surface-low border border-white/10 w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 md:p-8 border-b border-slate-100">
                <h3 className="text-xl md:text-2xl font-bold">{editingAccount ? 'Edit Account' : 'Create New Account'}</h3>
                <p className="text-slate-500 mt-1 text-xs md:text-sm">Manage enterprise organization details.</p>
              </div>
              <div className="p-6 md:p-8 space-y-6 overflow-y-auto flex-1">
                <div>
                  <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Account Name</label>
                  <input 
                    type="text" 
                    value={newAccount.name}
                    onChange={e => setNewAccount({...newAccount, name: e.target.value})}
                    placeholder="e.g. Acme Corp" 
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 text-sm md:text-base text-black" 
                  />
                </div>
                <div>
                  <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Branding Config (JSON)</label>
                  <textarea 
                    value={newAccount.branding_json}
                    onChange={e => setNewAccount({...newAccount, branding_json: e.target.value})}
                    placeholder='{"primaryColor": "#4f46e5"}' 
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 h-32 resize-none text-sm md:text-base font-mono text-black" 
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Monthly Limit ($)</label>
                    <input 
                      type="number" 
                      value={newAccount.monthly_limit_usd}
                      onChange={e => setNewAccount({...newAccount, monthly_limit_usd: parseFloat(e.target.value)})}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 text-sm md:text-base" 
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Warning Threshold (%)</label>
                    <input 
                      type="number" 
                      value={newAccount.warning_threshold_percent}
                      onChange={e => setNewAccount({...newAccount, warning_threshold_percent: parseFloat(e.target.value)})}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 text-sm md:text-base" 
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl">
                  <input 
                    type="checkbox" 
                    id="hardStop"
                    checked={newAccount.hard_stop_enabled}
                    onChange={e => setNewAccount({...newAccount, hard_stop_enabled: e.target.checked})}
                    className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded"
                  />
                  <label htmlFor="hardStop" className="text-sm font-medium text-slate-700">Enable Hard Stop at Limit</label>
                </div>
              </div>
              <div className="p-6 md:p-8 bg-slate-50 flex flex-col sm:flex-row justify-end gap-3">
                <button 
                  onClick={() => { setShowNewAccount(false); setEditingAccount(null); }}
                  className="px-6 py-2 text-slate-600 font-bold text-sm md:text-base"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleCreateAccount}
                  className="px-8 py-2 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition-colors text-sm md:text-base"
                >
                  {editingAccount ? 'Save Changes' : 'Create Account'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Upload Document Modal */}
      <AnimatePresence>
        {showUploadModal && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 md:p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 md:p-8 border-b border-slate-100">
                <h3 className="text-xl md:text-2xl font-bold">Upload Document</h3>
                <p className="text-slate-500 mt-1 text-xs md:text-sm">Add a new file to the knowledge base.</p>
              </div>
              <div className="p-6 md:p-8 space-y-6 overflow-y-auto flex-1">
                <div>
                  <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Document Title (Optional if uploading PDF)</label>
                  <input 
                    type="text" 
                    value={uploadingDoc.title}
                    onChange={e => setUploadingDoc({...uploadingDoc, title: e.target.value})}
                    placeholder="e.g. Q3 Safety Report" 
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 text-sm md:text-base" 
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Upload PDF</label>
                  <div className="flex items-center justify-center w-full">
                    <label className="flex flex-col items-center justify-center w-full h-24 md:h-32 border-2 border-slate-200 border-dashed rounded-xl cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <Camera className="w-6 h-6 md:w-8 md:h-8 text-slate-400 mb-2" />
                        <p className="mb-2 text-xs md:text-sm text-slate-500">
                          <span className="font-semibold">Click to upload</span>
                        </p>
                        <p className="text-[10px] md:text-xs text-slate-400">PDF (MAX. 10MB)</p>
                      </div>
                      <input 
                        type="file" 
                        className="hidden" 
                        accept=".pdf,.doc,.docx"
                        multiple
                        onChange={e => {
                          const files = Array.from(e.target.files || []);
                          setSelectedFiles(prev => [...prev, ...files]);
                        }}
                      />
                    </label>
                  </div>
                  {selectedFiles.length > 0 && (
                    <div className="space-y-2 max-h-32 overflow-y-auto pr-2">
                      {selectedFiles.map((file, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-2 bg-indigo-50 rounded-lg border border-indigo-100">
                          <FileText className="w-4 h-4 text-indigo-600" />
                          <span className="text-xs md:text-sm font-medium text-indigo-700 truncate flex-1">{file.name}</span>
                          <button 
                            onClick={() => setSelectedFiles(prev => prev.filter((_, i) => i !== idx))} 
                            className="text-indigo-400 hover:text-indigo-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-slate-200" />
                  </div>
                  <div className="relative flex justify-center text-[10px] uppercase">
                    <span className="bg-white px-2 text-slate-400">Or Paste Text</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Content / Text</label>
                  <textarea 
                    value={uploadingDoc.content}
                    onChange={e => setUploadingDoc({...uploadingDoc, content: e.target.value})}
                    placeholder="Paste document text here..." 
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 h-24 md:h-32 resize-none text-sm md:text-base" 
                  />
                </div>
              </div>
              <div className="p-6 md:p-8 bg-slate-50 flex flex-col sm:flex-row justify-end gap-3">
                <button 
                  onClick={() => { setShowUploadModal(false); setSelectedFiles([]); }}
                  className="px-6 py-2 text-slate-600 font-bold text-sm md:text-base"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleUploadDoc}
                  disabled={isUploading}
                  className={`px-8 py-2 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 text-sm md:text-base ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isUploading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Processing...
                    </>
                  ) : 'Upload'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* View Document Modal */}
      <AnimatePresence>
        {viewingDoc && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 md:p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-surface-low/80 backdrop-blur-2xl w-full max-w-4xl max-h-[90vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col border border-white/10"
            >
              <div className="p-6 md:p-8 border-b border-white/5 flex justify-between items-center">
                <div>
                  <h3 className="text-lg md:text-2xl font-bold text-white">{viewingDoc.title}</h3>
                  <p className="text-slate-400 mt-1 text-[10px] md:text-xs uppercase tracking-wider font-bold">{viewingDoc.page_count} Pages • Knowledge Base Document</p>
                </div>
                <button 
                  onClick={() => setViewingDoc(null)}
                  className="p-2 hover:bg-white/5 rounded-full transition-colors text-slate-400"
                >
                  <LogOut className="w-5 h-5 md:w-6 md:h-6 rotate-180" />
                </button>
              </div>
              <div className="p-4 md:p-8 overflow-y-auto bg-transparent flex-1">
                <div className="bg-surface-low/40 backdrop-blur-xl p-6 md:p-10 rounded-2xl border border-white/5 shadow-sm min-h-full">
                  <pre className="whitespace-pre-wrap font-sans text-xs md:text-sm text-slate-300 leading-relaxed">
                    {viewingDoc.content}
                  </pre>
                </div>
              </div>
              <div className="p-4 md:p-6 bg-surface-low/60 backdrop-blur-xl border-t border-white/5 flex justify-end">
                <button 
                  onClick={() => setViewingDoc(null)}
                  className="w-full sm:w-auto px-8 py-2.5 bg-white/5 text-slate-300 rounded-xl font-bold hover:bg-white/10 transition-colors text-xs md:text-sm"
                >
                  Close Preview
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default function App() {
  const [mode, setMode] = useState<'kiosk' | 'admin' | 'select'>('select');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessionTimeout, setSessionTimeout] = useState(180); // Default 3 minutes
  const [billingVoiceRate, setBillingVoiceRate] = useState(0.10);
  const [billingTextRate, setBillingTextRate] = useState(0.02);

  // Check for summary page
  const path = window.location.pathname;
  const sessionMatch = path.match(/^\/session\/([^/]+)/);
  if (sessionMatch) {
    return <SummaryPage sessionId={sessionMatch[1]} />;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const summaryData = urlParams.get('summary');
  if (summaryData) {
    // Fallback for old style links if any
    try {
      const decoded = JSON.parse(atob(summaryData));
      if (decoded.sessionId) return <SummaryPage sessionId={decoded.sessionId} />;
    } catch (e) {}
  }

  useEffect(() => {
    fetch(`${API_BASE}/api/projects`).then(res => res.json()).then(setProjects);
    fetch(`${API_BASE}/api/settings`).then(res => res.json()).then(settings => {
      if (settings.session_timeout) setSessionTimeout(parseInt(settings.session_timeout));
      if (settings.billing_voice_rate_per_minute) setBillingVoiceRate(parseFloat(settings.billing_voice_rate_per_minute));
      if (settings.billing_text_rate_per_1000_chars) setBillingTextRate(parseFloat(settings.billing_text_rate_per_1000_chars));
    });
  }, []);

  if (mode === 'select') {
    return (
      <div className="min-h-screen bg-bloom bg-dots flex flex-col items-center p-4 md:p-8 relative overflow-y-auto">
        {/* Background Ambient Glows */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-indigo-600/10 rounded-full blur-[120px]" />
          <div className="absolute -top-24 -left-24 w-96 h-96 bg-blue-600/10 rounded-full blur-[100px]" />
        </div>

        <div className="w-full max-w-4xl relative z-10 flex flex-col flex-1">
          <header className="flex items-center justify-between py-6 md:py-10">
            <img src="https://caribdesigns.com/voiceit-logo.png" alt="VoiceIt" className="h-32 md:h-48 w-auto" referrerPolicy="no-referrer" />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-12 h-12 md:w-16 md:h-16 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-2xl shadow-indigo-500/20"
            >
              <Volume2 className="w-6 h-6 md:w-8 md:h-8" />
            </motion.div>
          </header>

          <div className="flex-1 flex flex-col justify-center pb-12 md:pb-20">
            <div className="text-center mb-8 md:mb-12">
              <p className="text-slate-300 font-sans font-black uppercase tracking-[0.4em] text-[10px] md:text-xs">Select Interface to Begin</p>
            </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10">
            <motion.button 
              whileHover={{ y: -8, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setMode('admin')}
              className="bg-surface-low/50 backdrop-blur-3xl p-8 md:p-12 rounded-[3rem] border border-white/5 shadow-2xl text-left group transition-all"
            >
              <div className="w-12 h-12 md:w-14 md:h-14 bg-white/5 rounded-2xl flex items-center justify-center text-slate-400 mb-6 md:mb-8 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                <LayoutDashboard className="w-6 h-6 md:w-7 md:h-7" />
              </div>
              <h3 className="text-2xl md:text-3xl font-sans font-extrabold mb-3 text-white">Admin Console</h3>
              <p className="text-slate-400 mb-8 md:mb-10 text-sm md:text-base leading-relaxed">Manage accounts, projects, and knowledge ingestion with advanced analytics.</p>
              <div className="flex items-center gap-3 text-indigo-400 font-sans font-black uppercase tracking-widest text-xs">
                Open Dashboard <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </motion.button>

            <motion.div 
              whileHover={{ y: -8, scale: 1.02 }}
              className="bg-surface-low/50 backdrop-blur-3xl p-8 md:p-12 rounded-[3rem] border border-white/5 shadow-2xl text-left group transition-all"
            >
              <div className="w-12 h-12 md:w-14 md:h-14 bg-white/5 rounded-2xl flex items-center justify-center text-slate-400 mb-6 md:mb-8 group-hover:bg-blue-600 group-hover:text-white transition-all">
                <Mic className="w-6 h-6 md:w-7 md:h-7" />
              </div>
              <h3 className="text-2xl md:text-3xl font-sans font-extrabold mb-3 text-white">Kiosk Mode</h3>
              <p className="text-slate-400 mb-6 md:mb-8 text-sm md:text-base leading-relaxed">Interactive AI assistant for privacy pods and public spaces.</p>
              
              <div className="space-y-3">
                <p className="text-[10px] font-sans font-black uppercase tracking-[0.2em] text-slate-500 mb-2">Select Project</p>
                <div className="grid grid-cols-1 gap-2">
                  {projects.map(p => (
                    <button 
                      key={p.id}
                      onClick={() => { 
                        setSelectedProject(p); 
                        setMode('kiosk');
                        if (document.documentElement.requestFullscreen) {
                          document.documentElement.requestFullscreen().catch(() => {});
                        }
                      }}
                      className="w-full p-4 bg-white/5 hover:bg-blue-600/20 rounded-2xl text-left flex justify-between items-center group/item transition-all border border-transparent hover:border-blue-500/30"
                    >
                      <span className="font-bold text-slate-200 group-hover/item:text-blue-400 text-sm md:text-base">{p.title}</span>
                      <ChevronRight className="w-4 h-4 text-slate-600 group-hover/item:text-blue-400 group-hover/item:translate-x-1 transition-all" />
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}

  if (mode === 'admin') return (
    <AdminDashboard 
      onLaunchKiosk={(p) => { 
        setSelectedProject(p); 
        setMode('kiosk');
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      }} 
      sessionTimeout={sessionTimeout}
      setSessionTimeout={setSessionTimeout}
      billingVoiceRate={billingVoiceRate}
      setBillingVoiceRate={setBillingVoiceRate}
      billingTextRate={billingTextRate}
      setBillingTextRate={setBillingTextRate}
    />
  );
  if (mode === 'kiosk' && selectedProject) return (
    <AnimatePresence mode="wait">
      <KioskMode 
        project={selectedProject} 
        sessionTimeout={sessionTimeout} 
        onExit={() => {
          if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
          }
          setMode('select');
        }} 
      />
    </AnimatePresence>
  );

  return null;
}
