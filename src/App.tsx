/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { Mic, MicOff } from 'lucide-react';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<AudioNode | null>(null);
  const speakingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const playAudio = (base64Data: string) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
    }
    const audioContext = audioContextRef.current;
    
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    setIsSpeaking(true);
    if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
    speakingTimeoutRef.current = setTimeout(() => setIsSpeaking(false), 1000);

    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Int16Array(len / 2);
    for (let i = 0; i < len / 2; i++) {
      bytes[i] = (binaryString.charCodeAt(i * 2 + 1) << 8) | binaryString.charCodeAt(i * 2);
    }

    const float32 = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      float32[i] = bytes[i] / 32768;
    }

    const buffer = audioContext.createBuffer(1, float32.length, 16000);
    buffer.copyToChannel(float32, 0);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start();
  };

  const connect = async () => {
    setStatus('Connecting...');
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onopen: () => {
            console.log('Live API connection opened');
            setIsConnected(true);
            setStatus('Connected');
          },
          onmessage: async (message: LiveServerMessage) => {
            console.log('Received message:', message);
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              console.log('Received audio chunk, playing...');
              playAudio(base64Audio);
            }
          },
          onclose: () => {
            console.log('Live API connection closed');
            setIsConnected(false);
            setStatus('Disconnected');
            setIsSpeaking(false);
          },
          onerror: (error) => {
            console.error('Live API error:', error);
            if (error instanceof Error) {
                console.error('Error message:', error.message);
            }
            setStatus('Error');
            setIsSpeaking(false);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: "You are GIDDU, a smart, fast, and friendly AI voice assistant created by Sowjith Anumola. Keep your responses concise and conversational.",
        },
      });
      sessionRef.current = session;
    } catch (error) {
      console.error('Connection failed:', error);
      setStatus('Connection failed');
    }
  };

  const disconnect = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    stopListening();
    setIsConnected(false);
    setIsSpeaking(false);
    setStatus('Disconnected');
  };

  const stopListening = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    setIsListening(false);
  };

  const toggleListening = async () => {
    if (isListening) {
      stopListening();
    } else {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext({ sampleRate: 16000 });
        }
        const audioContext = audioContextRef.current;
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('Audio stream acquired');
        
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        
        sourceRef.current = source;
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
          }
          
          const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
          
          if (sessionRef.current && isConnected) {
            sessionRef.current.sendRealtimeInput({
              audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
            });
          }
        };

        source.connect(processor);
        processor.connect(audioContext.destination);
        
        setIsListening(true);
      } catch (error) {
        console.error('Error accessing microphone:', error);
        setStatus('Microphone access denied');
      }
    }
  };

  const requestMicrophonePermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('Microphone permission granted');
      stream.getTracks().forEach(track => track.stop());
    } catch (error) {
      console.error('Microphone permission denied:', error);
    }
  };

  return (
    <div className="min-h-screen bg-[#05070a] text-white flex flex-col items-center justify-center p-6 font-sans overflow-hidden">
      <div className="absolute top-10 right-10 px-4 py-2 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-semibold flex items-center gap-2">
        <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`}></div>
        {status}
      </div>

      <div className="relative w-80 h-80 flex items-center justify-center mb-10">
        <div className={`absolute w-64 h-64 bg-blue-500 rounded-full blur-3xl transition-all duration-500 ${isSpeaking ? 'opacity-50 scale-110' : 'opacity-20 scale-100'}`}></div>
        <div className={`w-36 h-36 bg-white/10 border border-white/30 rounded-full flex items-center justify-center shadow-inner transition-all duration-300 ${isListening ? 'border-red-500/50 scale-105' : ''}`}>
          <div className="flex items-center gap-1">
            {[40, 70, 50, 90, 60, 30].map((h, i) => (
              <div 
                key={i} 
                className={`w-1 bg-white rounded-full transition-all duration-150 ${isSpeaking || isListening ? 'opacity-100' : 'opacity-40'}`} 
                style={{ 
                  height: isSpeaking || isListening ? `${h * (0.5 + Math.random())}px` : `${h * 0.3}px`,
                  transition: 'height 0.1s ease-in-out'
                }}
              ></div>
            ))}
          </div>
        </div>
      </div>

      <h1 className="text-4xl font-bold tracking-widest mb-10 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">GIDDU</h1>

      <div className="flex flex-col gap-6 items-center">
        {!isConnected && (
          <button onClick={requestMicrophonePermission} className="text-white/40 hover:text-white/60 text-xs transition underline underline-offset-4">
            Test Microphone Permission
          </button>
        )}
        
        <div className="flex gap-4">
          {!isConnected ? (
            <button onClick={connect} className="bg-blue-600 hover:bg-blue-700 px-10 py-4 rounded-full font-bold transition-all hover:scale-105 active:scale-95 shadow-lg shadow-blue-500/20">
              Connect to GIDDU
            </button>
          ) : (
            <>
              <button 
                onClick={toggleListening} 
                className={`p-5 rounded-full transition-all hover:scale-110 active:scale-95 shadow-lg ${isListening ? 'bg-red-600 shadow-red-500/30' : 'bg-green-600 shadow-green-500/30'}`}
              >
                {isListening ? <MicOff size={28} /> : <Mic size={28} />}
              </button>
              <button onClick={disconnect} className="bg-white/5 hover:bg-white/10 border border-white/10 px-8 py-4 rounded-full font-semibold transition-all">
                Disconnect
              </button>
            </>
          )}
        </div>
      </div>
      
      {isListening && (
        <p className="mt-8 text-red-400 text-sm font-medium animate-pulse">GIDDU is listening...</p>
      )}
      {isSpeaking && (
        <p className="mt-8 text-blue-400 text-sm font-medium animate-pulse">GIDDU is speaking...</p>
      )}
    </div>
  );
}
