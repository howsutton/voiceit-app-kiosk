import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';

interface VoiceOrbProps {
  isSpeaking: boolean;
  isListening: boolean;
  isThinking: boolean;
  isShowingSourcePending?: boolean;
  onClick?: () => void;
}

export const VoiceOrb = ({ isSpeaking, isListening, isThinking, isShowingSourcePending, onClick }: VoiceOrbProps) => {
  // Simulate dynamic voice activity when speaking
  const [pulseScale, setPulseScale] = useState(1);
  const [glowIntensity, setGlowIntensity] = useState(1);
  
  useEffect(() => {
    let interval: any;
    if (isSpeaking) {
      interval = setInterval(() => {
        // More dynamic, speech-like pulsing
        setPulseScale(1 + Math.random() * 0.15);
        setGlowIntensity(1 + Math.random() * 0.6);
      }, 70);
    } else {
      setPulseScale(1);
      setGlowIntensity(1);
    }
    return () => clearInterval(interval);
  }, [isSpeaking]);

  return (
    <div 
      onClick={onClick}
      className={`relative w-40 h-40 md:w-[280px] md:h-[280px] flex items-center justify-center ${onClick ? 'cursor-pointer active:scale-95 transition-transform' : ''}`}
    >
      {/* Ambient Radial Glow - Bloom Effect */}
      <div 
        className={`absolute inset-0 rounded-full bg-app-accent/20 blur-[60px] md:blur-[120px] transition-all duration-700 ${isSpeaking ? 'opacity-100' : isListening ? 'scale-125 opacity-80' : 'scale-100 opacity-40'}`} 
        style={{ transform: `scale(${isSpeaking ? 1.5 * glowIntensity : 1})` }}
      />
      
      {/* Secondary Glow Layer */}
      <div 
        className={`absolute inset-0 rounded-full bg-indigo-500/10 blur-[50px] md:blur-[90px] transition-all duration-700 delay-150 ${isSpeaking ? 'opacity-90' : isListening ? 'scale-110 opacity-70' : 'scale-90 opacity-20'}`} 
        style={{ transform: `scale(${isSpeaking ? 1.25 * glowIntensity : 1})` }}
      />

      {/* Ripple Effects for Speaking and Listening */}
      {(isListening || isSpeaking) && (
        <>
          <motion.div 
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: isSpeaking ? 2.2 : 1.5, opacity: 0 }}
            transition={{ repeat: Infinity, duration: isSpeaking ? 1.5 : 2, ease: "easeOut" }}
            className={`absolute inset-0 border-2 rounded-full ${isSpeaking ? 'border-white/30' : 'border-app-accent/30'}`}
          />
          <motion.div 
            initial={{ scale: 1, opacity: 0.3 }}
            animate={{ scale: isSpeaking ? 2.5 : 1.8, opacity: 0 }}
            transition={{ repeat: Infinity, duration: isSpeaking ? 1.5 : 2, delay: 0.5, ease: "easeOut" }}
            className={`absolute inset-0 border rounded-full ${isSpeaking ? 'border-white/20' : 'border-app-accent/20'}`}
          />
        </>
      )}

      {/* Core Orb Container */}
      <motion.div
        animate={{
          scale: isSpeaking ? pulseScale : isListening ? [1, 1.03, 1] : 1,
        }}
        transition={{
          scale: isSpeaking ? { type: "spring", stiffness: 400, damping: 12 } : { repeat: Infinity, duration: 1.5, ease: "easeInOut" },
        }}
        className="relative w-40 h-40 md:w-56 md:h-56 rounded-full flex items-center justify-center overflow-hidden shadow-[0_0_100px_rgba(0,92,170,0.3)]"
      >
        {/* Smooth Gradient Fill - 135deg per Design System */}
        <div 
          className={`absolute inset-0 transition-all duration-700 ${isSpeaking ? 'brightness-150 saturate-150' : isListening ? 'brightness-110 saturate-110' : 'brightness-90 saturate-90'}`} 
          style={{ 
            background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-container) 100%)',
            filter: isSpeaking ? `contrast(1.2) brightness(${glowIntensity})` : 'none'
          }} 
        />
        
        {/* Surface Highlight / Reflection */}
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-white/20 to-transparent opacity-30" />
        
        {/* Inner Ambient Glow */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_white_0%,_transparent_70%)] opacity-10 animate-orb-inner-pulse" />
        
        {/* Glassy Overlay */}
        <div className="absolute inset-0 rounded-full border border-outline-variant bg-white/5 backdrop-blur-[2px] shadow-inner" />
        
        {/* Speaking Pulse Ring */}
        {isSpeaking && (
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 2.2, opacity: 0 }}
            transition={{ repeat: Infinity, duration: 2 }}
            className="absolute inset-0 border-2 border-white/40 rounded-full"
          />
        )}
      </motion.div>

      {/* Thinking Indicator - Integrated more elegantly */}
      {isThinking && (
        <div className="absolute bottom-4 flex gap-3 z-30">
          <motion.span animate={{ opacity: [0.3, 1, 0.3], scale: [0.9, 1.1, 0.9] }} transition={{ repeat: Infinity, duration: 1.2 }} className="w-2.5 h-2.5 bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,0.8)]" />
          <motion.span animate={{ opacity: [0.3, 1, 0.3], scale: [0.9, 1.1, 0.9] }} transition={{ repeat: Infinity, duration: 1.2, delay: 0.2 }} className="w-2.5 h-2.5 bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,0.8)]" />
          <motion.span animate={{ opacity: [0.3, 1, 0.3], scale: [0.9, 1.1, 0.9] }} transition={{ repeat: Infinity, duration: 1.2, delay: 0.4 }} className="w-2.5 h-2.5 bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,0.8)]" />
        </div>
      )}
    </div>
  );
};
