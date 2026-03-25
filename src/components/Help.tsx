import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, CircleHelp, Info, Layout, Volume2, MessageSquare, 
  Mic, MicOff, PhoneOff, Database, Settings, ChevronRight 
} from 'lucide-react';

interface HelpPopupProps {
  isOpen: boolean;
  onClose: () => void;
  projectTitle: string;
  projectDescription: string;
  isVoiceMode: boolean;
}

export const HelpPopup: React.FC<HelpPopupProps> = ({ 
  isOpen, 
  onClose, 
  projectTitle, 
  projectDescription,
  isVoiceMode
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col border border-white/20"
          >
            {/* Header */}
            <div className="p-6 md:p-8 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-indigo-50 to-white">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-200">
                  <CircleHelp size={28} />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 tracking-tight">System Help & Assistance</h2>
                  <p className="text-gray-500 text-sm font-medium">Learn how to interact with this kiosk</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-3 rounded-2xl hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-900 group"
              >
                <X size={24} className="group-hover:rotate-90 transition-transform duration-300" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-10 custom-scrollbar">
              {/* Project Info */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-indigo-600">
                  <Info size={20} />
                  <h3 className="font-bold uppercase tracking-wider text-xs">About This Project</h3>
                </div>
                <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
                  <h4 className="text-xl font-bold text-gray-900 mb-2">{projectTitle}</h4>
                  <p className="text-gray-600 leading-relaxed">
                    {projectDescription || "This interactive kiosk provides information and assistance related to this project. You can ask questions, browse documents, and interact via voice or text."}
                  </p>
                </div>
              </section>

              {/* Features Grid */}
              <section className="space-y-6">
                <div className="flex items-center gap-2 text-indigo-600">
                  <Layout size={20} />
                  <h3 className="font-bold uppercase tracking-wider text-xs">System Features</h3>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FeatureCard 
                    icon={<MessageSquare size={20} />}
                    title="Transcript / Text Mode"
                    description="View the ongoing conversation and type your questions manually."
                    voiceCommand="Switch to text mode"
                  />
                  <FeatureCard 
                    icon={<Volume2 size={20} />}
                    title="Voice Mode"
                    description="Interact naturally using your voice. The AI will listen and respond."
                    voiceCommand="Switch to voice mode"
                  />
                  <FeatureCard 
                    icon={<MicOff size={20} />}
                    title="Mute / Unmute"
                    description="Temporarily stop the AI from listening to your voice."
                    voiceCommand="Mute / Unmute"
                  />
                  <FeatureCard 
                    icon={<PhoneOff size={20} />}
                    title="End Session"
                    description="Finish your current interaction and see a summary of the session."
                    voiceCommand="End session / Finish"
                  />
                  <FeatureCard 
                    icon={<Database size={20} />}
                    title="Sources & Documents"
                    description="Browse the knowledge base used by the AI to answer your questions."
                    voiceCommand="Show all sources / Open [document name]"
                  />
                  <FeatureCard 
                    icon={<Settings size={20} />}
                    title="Settings"
                    description="Adjust volume, voice speed, and other system preferences."
                    voiceCommand="Open settings"
                  />
                </div>
              </section>

              {/* Voice Help Hints */}
              <section className="bg-indigo-600 rounded-2xl p-6 text-white shadow-xl shadow-indigo-100">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-xl bg-white/20 backdrop-blur-md">
                    <Mic size={24} />
                  </div>
                  <div>
                    <h4 className="text-lg font-bold mb-1">Voice Assistance</h4>
                    <p className="text-indigo-100 text-sm mb-4">You can always ask for help by saying:</p>
                    <div className="flex flex-wrap gap-2">
                      <span className="px-3 py-1.5 bg-white/10 rounded-lg text-sm font-medium border border-white/10 italic">"Help"</span>
                      <span className="px-3 py-1.5 bg-white/10 rounded-lg text-sm font-medium border border-white/10 italic">"Assistance"</span>
                      <span className="px-3 py-1.5 bg-white/10 rounded-lg text-sm font-medium border border-white/10 italic">"What can you do?"</span>
                      <span className="px-3 py-1.5 bg-white/10 rounded-lg text-sm font-medium border border-white/10 italic">"How do I use this?"</span>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            {/* Footer */}
            <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-center">
              <button
                onClick={onClose}
                className="px-8 py-3 bg-gray-900 text-white rounded-2xl font-bold hover:bg-gray-800 transition-all active:scale-95 shadow-lg shadow-gray-200"
              >
                Got it, thanks!
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

const FeatureCard = ({ icon, title, description, voiceCommand }: { 
  icon: React.ReactNode, 
  title: string, 
  description: string,
  voiceCommand: string
}) => (
  <div className="p-5 rounded-2xl border border-gray-100 bg-white hover:border-indigo-100 hover:shadow-md transition-all group">
    <div className="flex items-start gap-4">
      <div className="p-3 rounded-xl bg-gray-50 text-gray-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
        {icon}
      </div>
      <div className="space-y-1">
        <h4 className="font-bold text-gray-900">{title}</h4>
        <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
        <div className="pt-2 flex items-center gap-1.5 text-indigo-600 font-semibold text-[10px] uppercase tracking-wider">
          <ChevronRight size={12} />
          <span>Voice: "{voiceCommand}"</span>
        </div>
      </div>
    </div>
  </div>
);
