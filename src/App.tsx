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
  const [status, setStatus] = useState('Disconnected');
  const sessionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const playAudio = (base64Data: string) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
    }
    const audioContext = audioContextRef.current;
    
    // Decode base64 to binary
    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Int16Array(len / 2);
    for (let i = 0; i < len / 2; i++) {
      bytes[i] = (binaryString.charCodeAt(i * 2 + 1) << 8) | binaryString.charCodeAt(i * 2);
    }

    // Convert Int16 to Float32
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
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              console.log('Received audio, playing...');
              playAudio(base64Audio);
            }
          },
          onclose: () => {
            console.log('Live API connection closed');
            setIsConnected(false);
            setStatus('Disconnected');
          },
          onerror: (error) => {
            console.error('Live API error:', error);
            setStatus('Error');
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: "You are GIDDU, a smart, fast, and friendly AI voice assistant created by Sowjith Anumola.",
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
    setIsConnected(false);
    setIsListening(false);
    setStatus('Disconnected');
  };

  const toggleListening = async () => {
    if (isListening) {
      mediaRecorderRef.current?.stop();
      setIsListening(false);
    } else {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = async (event) => {
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Data = (reader.result as string).split(',')[1];
          if (sessionRef.current) {
            sessionRef.current.sendRealtimeInput({
              audio: { data: base64Data, mimeType: 'audio/webm' }
            });
          }
        };
        reader.readAsDataURL(event.data);
      };
      mediaRecorder.start(100);
      setIsListening(true);
    }
  };

  return (
    <div className="min-h-screen bg-[#05070a] text-white flex flex-col items-center justify-center p-6 font-sans">
      <div className="absolute top-10 right-10 px-4 py-2 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-semibold flex items-center gap-2">
        <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>
        {status}
      </div>

      <div className="relative w-80 h-80 flex items-center justify-center mb-10">
        <div className="absolute w-64 h-64 bg-blue-500 rounded-full opacity-30 blur-3xl"></div>
        <div className="w-36 h-36 bg-white/10 border border-white/30 rounded-full flex items-center justify-center shadow-inner">
          <div className="flex items-center gap-1">
            {[40, 70, 50, 90, 60, 30].map((h, i) => (
              <div key={i} className="w-1 bg-white rounded-full opacity-80" style={{ height: `${h}px` }}></div>
            ))}
          </div>
        </div>
      </div>

      <h1 className="text-4xl font-bold tracking-widest mb-10">GIDDU</h1>

      <div className="flex gap-4">
        {!isConnected ? (
          <button onClick={connect} className="bg-blue-600 hover:bg-blue-700 px-8 py-3 rounded-full font-semibold transition">Connect</button>
        ) : (
          <>
            <button onClick={toggleListening} className={`p-4 rounded-full transition ${isListening ? 'bg-red-600' : 'bg-green-600'}`}>
              {isListening ? <MicOff /> : <Mic />}
            </button>
            <button onClick={disconnect} className="bg-white/10 hover:bg-white/20 px-8 py-3 rounded-full font-semibold transition">Disconnect</button>
          </>
        )}
      </div>
    </div>
  );
}
