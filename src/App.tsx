/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Timer, 
  Calendar, 
  CheckCircle2, 
  BarChart3, 
  Bell, 
  Zap, 
  Clock, 
  ChevronRight, 
  Plus, 
  Trash2, 
  Play, 
  Pause, 
  RotateCcw,
  Monitor,
  Target,
  AlertCircle
} from 'lucide-react';
import { 
  format, 
  differenceInDays, 
  differenceInSeconds, 
  addDays, 
  isSameDay, 
  startOfDay,
  parseISO
} from 'date-fns';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { GoogleGenAI } from "@google/genai";

// --- Utils ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- AI Service ---
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// --- Types ---
interface Task {
  id: string;
  text: string;
  completed: boolean;
  category: 'study' | 'break' | 'review' | 'other';
  completedAt?: string; // ISO date
}

interface Reminder {
  id: string;
  text: string;
  createdAt: string;
}

interface Alarm {
  id: string;
  time: string; // HH:mm
  label: string;
  active: boolean;
}

interface StudySession {
  date: string; // ISO date
  duration: number; // in minutes
}

interface AppState {
  tasks: Task[];
  sessions: StudySession[];
  examDate: string; // ISO date
  lastPlanDate: string; // ISO date
  papers: {
    maths: number;
    physics: number;
    ict: number;
  };
  reminders: Reminder[];
  alarms: Alarm[];
}

// --- Constants ---
const DEFAULT_EXAM_DATE = addDays(new Date(), 150).toISOString(); // 5 months from now
const POMODORO_TIME = 25 * 60;
const SHORT_BREAK = 5 * 60;

export default function App() {
  // --- State ---
  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem('aether_study_state');
    const defaultState: AppState = {
      tasks: [],
      sessions: [],
      examDate: DEFAULT_EXAM_DATE,
      lastPlanDate: new Date().toISOString(),
      papers: { maths: 0, physics: 0, ict: 0 },
      reminders: [],
      alarms: []
    };
    
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...defaultState, ...parsed, papers: { ...defaultState.papers, ...parsed.papers } };
      } catch (e) {
        console.error("Failed to parse saved state", e);
      }
    }
    return defaultState;
  });

  const [activeTab, setActiveTab] = useState<'dashboard' | 'planner' | 'focus' | 'analytics' | 'ranking'>('dashboard');
  const [timer, setTimer] = useState(POMODORO_TIME);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerMode, setTimerMode] = useState<'focus' | 'break'>('focus');
  const [newTaskText, setNewTaskText] = useState('');
  const [newReminderText, setNewReminderText] = useState('');
  const [newAlarmTime, setNewAlarmTime] = useState('08:00');
  const [newAlarmLabel, setNewAlarmLabel] = useState('');
  const [notifications, setNotifications] = useState<{ id: string; message: string; type: 'info' | 'alert' }[]>([]);
  const [aiInsight, setAiInsight] = useState<string>('Initializing neural link...');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [ringingAlarmIds, setRingingAlarmIds] = useState<string[]>([]);

  // --- Refs ---
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // --- AI Logic ---
  const generateAiInsight = async () => {
    setIsAiLoading(true);
    try {
      const model = "gemini-3-flash-preview";
      const prompt = `You are the Aether Study OS AI. 
      Current Student Status:
      - Rank: ${rankingInfo.rank}
      - Total Papers: ${rankingInfo.total}/30
      - Maths: ${state.papers.maths}/10, Physics: ${state.papers.physics}/10, ICT: ${state.papers.ict}/10
      - Tasks: ${state.tasks.length} active directives.
      - Progress: ${progressPercentage}% of today's tasks done.
      
      Provide a short, futuristic, and highly motivating study tip or "system directive" (max 2 sentences). 
      Make it sound like a high-tech command center assisting a pilot.`;

      const response = await genAI.models.generateContent({
        model,
        contents: [{ parts: [{ text: prompt }] }],
      });
      
      setAiInsight(response.text || "Neural link established. Stay focused.");
    } catch (error) {
      console.error("AI Error:", error);
      setAiInsight("Neural link interrupted. Re-establishing connection...");
    } finally {
      setIsAiLoading(false);
    }
  };

  useEffect(() => {
    generateAiInsight();
  }, []);

  // --- Sound Logic ---
  const playNotificationSound = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioContextRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  };

  const playAlarmSound = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioContextRef.current;
    const playBeep = (time: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      // Use sawtooth for a more piercing, "high" sound
      osc.type = 'sawtooth';
      // Higher frequency for more urgency
      osc.frequency.setValueAtTime(880, time);
      osc.frequency.exponentialRampToValueAtTime(1760, time + 0.1);
      
      // Increased gain for "high sound"
      gain.gain.setValueAtTime(0.3, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 0.3);
    };
    
    // Trigger vibration if supported
    if ('vibrate' in navigator) {
      navigator.vibrate([200, 100, 200]);
    }
    
    for (let i = 0; i < 4; i++) {
      playBeep(ctx.currentTime + i * 0.2);
    }
  };

  // --- Persistence ---
  useEffect(() => {
    localStorage.setItem('aether_study_state', JSON.stringify(state));
  }, [state]);

  // --- Timer Logic ---
  useEffect(() => {
    if (isTimerRunning && timer > 0) {
      timerRef.current = setInterval(() => {
        setTimer(prev => prev - 1);
      }, 1000);
    } else if (timer === 0) {
      handleTimerComplete();
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isTimerRunning, timer]);

  const handleTimerComplete = () => {
    setIsTimerRunning(false);
    const message = timerMode === 'focus' ? 'Focus session complete! Take a break.' : 'Break over! Back to work.';
    addNotification(message, 'alert');
    
    if (timerMode === 'focus') {
      // Record session
      const newSession: StudySession = {
        date: new Date().toISOString(),
        duration: 25
      };
      setState(prev => ({
        ...prev,
        sessions: [...prev.sessions, newSession]
      }));
      setTimerMode('break');
      setTimer(SHORT_BREAK);
    } else {
      setTimerMode('focus');
      setTimer(POMODORO_TIME);
    }
  };

  const toggleTimer = () => setIsTimerRunning(!isTimerRunning);
  const resetTimer = () => {
    setIsTimerRunning(false);
    setTimer(timerMode === 'focus' ? POMODORO_TIME : SHORT_BREAK);
  };

  // --- Task Logic ---
  const addTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskText.trim()) return;
    const newTask: Task = {
      id: crypto.randomUUID(),
      text: newTaskText,
      completed: false,
      category: 'study'
    };
    setState(prev => ({ ...prev, tasks: [...prev.tasks, newTask] }));
    setNewTaskText('');
  };

  const toggleTask = (id: string) => {
    setState(prev => ({
      ...prev,
      tasks: prev.tasks.map(t => t.id === id ? { 
        ...t, 
        completed: !t.completed,
        completedAt: !t.completed ? new Date().toISOString() : undefined
      } : t)
    }));
  };

  const deleteTask = (id: string) => {
    setState(prev => ({
      ...prev,
      tasks: prev.tasks.filter(t => t.id !== id)
    }));
  };

  const updatePapers = (subject: keyof AppState['papers'], delta: number) => {
    setState(prev => ({
      ...prev,
      papers: {
        ...prev.papers,
        [subject]: Math.min(10, Math.max(0, prev.papers[subject] + delta))
      }
    }));
    
    if (state.papers[subject] + delta === 10 && state.papers[subject] < 10) {
      addNotification(`${subject.toUpperCase()} Mastered! Rank Up!`, 'info');
    }
  };

  // --- Notifications ---
  const addNotification = (message: string, type: 'info' | 'alert' = 'info') => {
    const id = crypto.randomUUID();
    setNotifications(prev => [...prev, { id, message, type }]);
    playNotificationSound();
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  // --- Reminder Logic ---
  const addReminder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReminderText.trim()) return;
    const newReminder: Reminder = {
      id: crypto.randomUUID(),
      text: newReminderText,
      createdAt: new Date().toISOString()
    };
    setState(prev => ({ ...prev, reminders: [newReminder, ...prev.reminders] }));
    setNewReminderText('');
    addNotification("Reminder added", 'info');
  };

  const deleteReminder = (id: string) => {
    setState(prev => ({ ...prev, reminders: prev.reminders.filter(r => r.id !== id) }));
  };

  // --- Alarm Logic ---
  const addAlarm = (e: React.FormEvent) => {
    e.preventDefault();
    const newAlarm: Alarm = {
      id: crypto.randomUUID(),
      time: newAlarmTime,
      label: newAlarmLabel || 'Alarm',
      active: true
    };
    setState(prev => ({ ...prev, alarms: [...prev.alarms, newAlarm] }));
    setNewAlarmLabel('');
    addNotification("Alarm set for " + newAlarmTime, 'info');
  };

  const deleteAlarm = (id: string) => {
    setState(prev => ({ ...prev, alarms: prev.alarms.filter(a => a.id !== id) }));
    setRingingAlarmIds(prev => prev.filter(aid => aid !== id));
  };

  const toggleAlarm = (id: string) => {
    setState(prev => ({
      ...prev,
      alarms: prev.alarms.map(a => a.id === id ? { ...a, active: !a.active } : a)
    }));
    if (ringingAlarmIds.includes(id)) {
      setRingingAlarmIds(prev => prev.filter(aid => aid !== id));
    }
  };

  const dismissAlarm = (id: string) => {
    setRingingAlarmIds(prev => prev.filter(aid => aid !== id));
  };

  // Check Alarms
  useEffect(() => {
    const checkAlarms = setInterval(() => {
      const now = format(new Date(), 'HH:mm');
      const activeAlarms = state.alarms.filter(a => a.active && a.time === now);
      
      if (activeAlarms.length > 0) {
        activeAlarms.forEach(alarm => {
          if (!ringingAlarmIds.includes(alarm.id)) {
            addNotification(`ALARM TRIGGERED: ${alarm.label}`, 'alert');
            setRingingAlarmIds(prev => [...prev, alarm.id]);
            // Automatically deactivate so it doesn't trigger again in the same minute or next day
            toggleAlarm(alarm.id);
          }
        });
      }
    }, 1000);
    return () => clearInterval(checkAlarms);
  }, [state.alarms, ringingAlarmIds]);

  // Alarm Sound Loop
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (ringingAlarmIds.length > 0) {
      playAlarmSound();
      interval = setInterval(() => {
        playAlarmSound();
      }, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [ringingAlarmIds]);

  // Periodic reminders
  useEffect(() => {
    if (isTimerRunning && timerMode === 'focus') {
      const reminderInterval = setInterval(() => {
        const messages = [
          "Stay focused on the mission.",
          "Distraction is the enemy of progress.",
          "Keep pushing, you're doing great.",
          "The future belongs to the prepared."
        ];
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        addNotification(randomMessage, 'info');
      }, 300000); // Every 5 minutes
      return () => clearInterval(reminderInterval);
    }
  }, [isTimerRunning, timerMode]);

  // --- Derived Data ---
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const countdown = useMemo(() => {
    const exam = parseISO(state.examDate);
    const diff = differenceInSeconds(exam, currentTime);
    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
    
    return {
      days: Math.floor(diff / (24 * 3600)),
      hours: Math.floor((diff % (24 * 3600)) / 3600),
      minutes: Math.floor((diff % 3600) / 60),
      seconds: Math.floor(diff % 60)
    };
  }, [state.examDate, currentTime]);

  const analyticsData = useMemo(() => {
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(new Date(), -i);
      return format(d, 'yyyy-MM-dd');
    }).reverse();

    return last7Days.map(date => {
      const daySessions = state.sessions.filter(s => s.date.startsWith(date));
      const totalMinutes = daySessions.reduce((acc, s) => acc + s.duration, 0);
      return {
        name: format(parseISO(date), 'EEE'),
        hours: parseFloat((totalMinutes / 60).toFixed(1))
      };
    });
  }, [state.sessions]);

  const progressPercentage = useMemo(() => {
    if (state.tasks.length === 0) return 0;
    const completed = state.tasks.filter(t => t.completed).length;
    return Math.round((completed / state.tasks.length) * 100);
  }, [state.tasks]);

  const rankingInfo = useMemo(() => {
    const total = state.papers.maths + state.papers.physics + state.papers.ict;
    let rank = "Recruit";
    let color = "text-slate-400";
    
    if (total >= 30) { rank = "Grandmaster"; color = "neon-text"; }
    else if (total >= 20) { rank = "Elite"; color = "text-purple-400"; }
    else if (total >= 10) { rank = "Specialist"; color = "text-blue-400"; }

    const getSubjectRank = (count: number) => {
      if (count >= 10) return { label: "Mastered", color: "text-[var(--accent)]" };
      if (count >= 5) return { label: "Advanced", color: "text-blue-400" };
      return { label: "Novice", color: "text-slate-500" };
    };

    return {
      total,
      rank,
      color,
      maths: getSubjectRank(state.papers.maths),
      physics: getSubjectRank(state.papers.physics),
      ict: getSubjectRank(state.papers.ict)
    };
  }, [state.papers]);

  // --- Render Helpers ---
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <motion.div 
      className="min-h-screen relative font-sans text-white overflow-x-hidden"
      animate={ringingAlarmIds.length > 0 ? {
        x: [-2, 2, -2, 2, 0],
        y: [-1, 1, -1, 1, 0]
      } : {}}
      transition={ringingAlarmIds.length > 0 ? {
        repeat: Infinity,
        duration: 0.1
      } : {}}
    >
      <div className="atmosphere" />
      <div className="grid-overlay" />

      {/* --- Sidebar --- */}
      <nav className="fixed left-0 top-0 h-full w-20 flex flex-col items-center py-8 glass-card rounded-none border-y-0 border-l-0 z-50">
        <div className="mb-12">
          <div className="w-12 h-12 rounded-xl bg-[var(--accent)] flex items-center justify-center shadow-[0_0_20px_rgba(0,242,255,0.4)]">
            <Zap className="text-black" size={24} />
          </div>
        </div>
        
        <div className="flex flex-col gap-8 flex-1">
          <NavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<Monitor size={24} />} label="Dashboard" />
          <NavButton active={activeTab === 'planner'} onClick={() => setActiveTab('planner')} icon={<Calendar size={24} />} label="Planner" />
          <NavButton active={activeTab === 'focus'} onClick={() => setActiveTab('focus')} icon={<Target size={24} />} label="Focus" />
          <NavButton active={activeTab === 'ranking'} onClick={() => setActiveTab('ranking')} icon={<ChevronRight size={24} />} label="Ranking" />
          <NavButton active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')} icon={<BarChart3 size={24} />} label="Stats" />
        </div>

        <div className="mt-auto">
          <div className="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center hover:border-[var(--accent)] transition-colors cursor-pointer">
            <Bell size={20} />
          </div>
        </div>
      </nav>

      {/* --- Main Content --- */}
      <main className="ml-20 p-8 lg:p-12 max-w-7xl mx-auto">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              {/* Header */}
              <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
                <div>
                  <h1 className="text-4xl font-bold tracking-tight mb-2">AETHER <span className="neon-text">STUDY OS</span></h1>
                  <p className="text-[var(--text-secondary)] font-mono text-sm uppercase tracking-widest">System Status: Optimal | {format(currentTime, 'EEEE, MMMM do')}</p>
                  
                  {/* AI Insight Panel */}
                  <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="mt-6 p-4 glass-card border-l-2 border-l-[var(--accent)] max-w-2xl group cursor-pointer"
                    onClick={generateAiInsight}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Zap size={14} className={cn("text-[var(--accent)]", isAiLoading && "animate-pulse")} />
                      <span className="text-[10px] uppercase tracking-[0.3em] text-[var(--accent)] font-bold">Neural Insight</span>
                    </div>
                    <p className={cn("text-xs italic text-[var(--text-secondary)] transition-opacity", isAiLoading ? "opacity-50" : "opacity-100")}>
                      "{aiInsight}"
                    </p>
                    <div className="mt-2 text-[8px] uppercase tracking-widest opacity-0 group-hover:opacity-30 transition-opacity">
                      Click to re-sync neural link
                    </div>
                  </motion.div>
                </div>
                <div className="text-left md:text-right">
                  <div className="text-xs text-[var(--text-secondary)] uppercase tracking-widest mb-1">Mission Deadline</div>
                  <div className="text-2xl font-mono font-bold neon-text tabular-nums">
                    {countdown.days}D {countdown.hours}H {countdown.minutes}M {countdown.seconds}S
                  </div>
                </div>
              </header>

              {/* Grid Layout */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Reminders & Alarms Card */}
                <div className="lg:col-span-2 space-y-8">
                  <div className="glass-card p-8 relative overflow-hidden group">
                    <div className="flex justify-between items-center mb-6">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Zap size={18} className="text-[var(--accent)]" />
                        Quick Reminders
                      </h3>
                    </div>
                    
                    <form onSubmit={addReminder} className="mb-6 flex gap-4">
                      <input 
                        type="text" 
                        value={newReminderText}
                        onChange={(e) => setNewReminderText(e.target.value)}
                        placeholder="Add a quick reminder..."
                        className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-[var(--accent)] transition-colors text-sm"
                      />
                      <button type="submit" className="btn-primary py-1 px-4 text-sm">Add</button>
                    </form>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[200px] overflow-y-auto pr-2">
                      <AnimatePresence>
                        {state.reminders.map(reminder => (
                          <motion.div 
                            key={reminder.id}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white/5 border border-white/10 rounded-xl p-3 flex justify-between items-center group/item"
                          >
                            <span className="text-sm">{reminder.text}</span>
                            <button 
                              onClick={() => deleteReminder(reminder.id)}
                              className="opacity-0 group-hover/item:opacity-100 p-1 text-red-400 hover:bg-red-400/10 rounded transition-all"
                            >
                              <Trash2 size={14} />
                            </button>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                      {state.reminders.length === 0 && <p className="text-xs opacity-30 italic col-span-2">No active reminders.</p>}
                    </div>
                  </div>

                  <div className="glass-card p-8 relative overflow-hidden group">
                    <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                      <Bell size={18} className="text-[var(--accent)]" />
                      Alarm System
                    </h3>
                    
                    <form onSubmit={addAlarm} className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                      <input 
                        type="time" 
                        value={newAlarmTime}
                        onChange={(e) => setNewAlarmTime(e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-[var(--accent)] transition-colors text-sm"
                      />
                      <input 
                        type="text" 
                        value={newAlarmLabel}
                        onChange={(e) => setNewAlarmLabel(e.target.value)}
                        placeholder="Alarm Label"
                        className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-[var(--accent)] transition-colors text-sm"
                      />
                      <button type="submit" className="btn-primary py-1 px-4 text-sm">Set Alarm</button>
                    </form>

                    <div className="flex flex-wrap gap-4">
                      <AnimatePresence>
                        {state.alarms.map(alarm => {
                          const isRinging = ringingAlarmIds.includes(alarm.id);
                          return (
                            <motion.div 
                              key={alarm.id}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ 
                                opacity: 1, 
                                y: 0,
                                scale: isRinging ? [1, 1.05, 1] : 1,
                                borderColor: isRinging ? 'rgba(239, 68, 68, 0.8)' : 'rgba(255, 255, 255, 0.1)'
                              }}
                              transition={isRinging ? { repeat: Infinity, duration: 1 } : {}}
                              exit={{ opacity: 0, scale: 0.9 }}
                              className={cn(
                                "border rounded-xl p-3 flex items-center gap-4 transition-all relative overflow-hidden",
                                alarm.active ? "border-[var(--accent)] bg-[var(--accent)]/5" : "border-white/10 bg-white/5 opacity-50",
                                isRinging && "bg-red-500/10 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.3)]"
                              )}
                            >
                              {isRinging && (
                                <motion.div 
                                  className="absolute inset-0 bg-red-500/5"
                                  animate={{ opacity: [0, 0.2, 0] }}
                                  transition={{ repeat: Infinity, duration: 1 }}
                                />
                              )}
                              <div className="flex flex-col relative z-10">
                                <span className="text-lg font-mono font-bold">{alarm.time}</span>
                                <span className="text-[10px] uppercase tracking-widest opacity-50">{alarm.label}</span>
                              </div>
                              <div className="flex gap-2 relative z-10">
                                {isRinging ? (
                                  <button 
                                    onClick={() => dismissAlarm(alarm.id)}
                                    className="px-3 py-1 bg-red-500 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-red-600 transition-all shadow-lg"
                                  >
                                    Stop
                                  </button>
                                ) : (
                                  <button 
                                    onClick={() => toggleAlarm(alarm.id)}
                                    className={cn(
                                      "w-8 h-8 rounded-lg flex items-center justify-center transition-all",
                                      alarm.active ? "bg-[var(--accent)] text-black" : "bg-white/10"
                                    )}
                                  >
                                    {alarm.active ? <Bell size={14} /> : <Bell size={14} className="opacity-30" />}
                                  </button>
                                )}
                                <button 
                                  onClick={() => deleteAlarm(alarm.id)}
                                  className="w-8 h-8 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center hover:bg-red-500/20 transition-all"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* Quick Stats */}
                <div className="space-y-6">
                  <div className="glass-card p-6 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                      <CheckCircle2 size={24} />
                    </div>
                    <div>
                      <div className="text-2xl font-bold">{progressPercentage}%</div>
                      <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Daily Completion</div>
                    </div>
                  </div>
                  
                  <div className="glass-card p-6 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500">
                      <Clock size={24} />
                    </div>
                    <div>
                      <div className="text-2xl font-bold">{state.sessions.length}</div>
                      <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Focus Sessions</div>
                    </div>
                  </div>

                  <div className="glass-card p-6">
                    <h4 className="text-sm font-semibold mb-4 uppercase tracking-widest text-[var(--text-secondary)]">Current Directives</h4>
                    <div className="space-y-3">
                      {state.tasks.slice(0, 3).map(task => (
                        <div key={task.id} className="flex items-center gap-3 text-sm">
                          <div className={cn("w-2 h-2 rounded-full", task.completed ? "bg-emerald-500" : "bg-[var(--accent)]")} />
                          <span className={cn(task.completed && "line-through opacity-50")}>{task.text}</span>
                        </div>
                      ))}
                      {state.tasks.length === 0 && <p className="text-xs opacity-50 italic">No active directives.</p>}
                    </div>
                  </div>

                  <div className="glass-card p-6 border-l-4 border-l-[var(--accent)]">
                    <div className="text-xs text-[var(--text-secondary)] uppercase tracking-widest mb-1">Current Rank</div>
                    <div className={cn("text-xl font-bold uppercase tracking-tighter", rankingInfo.color)}>{rankingInfo.rank}</div>
                    <div className="mt-2 h-1 w-full bg-white/5 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-[var(--accent)] transition-all duration-500" 
                        style={{ width: `${(rankingInfo.total / 30) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'planner' && (
            <motion.div 
              key="planner"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-3xl mx-auto"
            >
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-3xl font-bold">Daily <span className="neon-text">Planner</span></h2>
                <div className="text-sm font-mono opacity-50">{format(currentTime, 'yyyy.MM.dd')}</div>
              </div>

              <form onSubmit={addTask} className="mb-8 flex gap-4">
                <input 
                  type="text" 
                  value={newTaskText}
                  onChange={(e) => setNewTaskText(e.target.value)}
                  placeholder="Enter new study directive..."
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-6 py-3 focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
                <button type="submit" className="btn-primary flex items-center gap-2">
                  <Plus size={20} /> Add
                </button>
              </form>

              <div className="space-y-4">
                <AnimatePresence>
                  {state.tasks.map(task => (
                    <motion.div 
                      key={task.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="glass-card p-4 flex items-center gap-4 group"
                    >
                      <button 
                        onClick={() => toggleTask(task.id)}
                        className={cn(
                          "w-6 h-6 rounded-md border flex items-center justify-center transition-all",
                          task.completed ? "bg-emerald-500 border-emerald-500 text-black" : "border-white/20 hover:border-[var(--accent)]"
                        )}
                      >
                        {task.completed && <CheckCircle2 size={16} />}
                      </button>
                      <div className="flex-1">
                        <div className={cn("text-lg", task.completed && "line-through opacity-50")}>
                          {task.text}
                        </div>
                        {task.completed && task.completedAt && (
                          <div className="text-[10px] uppercase tracking-widest text-emerald-500 mt-1">
                            Completed: {format(parseISO(task.completedAt), 'MMM do, HH:mm')}
                          </div>
                        )}
                      </div>
                      <button 
                        onClick={() => deleteTask(task.id)}
                        className="opacity-0 group-hover:opacity-100 p-2 text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                      >
                        <Trash2 size={18} />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {state.tasks.length === 0 && (
                  <div className="text-center py-12 opacity-30">
                    <Calendar size={48} className="mx-auto mb-4" />
                    <p>No tasks planned for today.</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'focus' && (
            <motion.div 
              key="focus"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.1 }}
              className="flex flex-col items-center justify-center py-12"
            >
              <div className="relative w-80 h-80 flex items-center justify-center mb-12">
                {/* Visual Ring */}
                <svg className="absolute inset-0 w-full h-full -rotate-90">
                  <circle 
                    cx="160" cy="160" r="140" 
                    fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" 
                  />
                  <motion.circle 
                    cx="160" cy="160" r="140" 
                    fill="none" stroke="var(--accent)" strokeWidth="8" 
                    strokeDasharray="880"
                    animate={{ strokeDashoffset: 880 - (880 * (timer / (timerMode === 'focus' ? POMODORO_TIME : SHORT_BREAK))) }}
                    transition={{ duration: 1, ease: "linear" }}
                  />
                </svg>
                
                <div className="text-center z-10">
                  <div className="text-xs uppercase tracking-[0.3em] text-[var(--text-secondary)] mb-2">
                    {timerMode === 'focus' ? 'Focus Phase' : 'Recovery Phase'}
                  </div>
                  <div className="text-7xl font-mono font-bold neon-text tabular-nums">
                    {formatTime(timer)}
                  </div>
                </div>
              </div>

              <div className="flex gap-6">
                <button 
                  onClick={toggleTimer}
                  className={cn(
                    "w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-lg",
                    isTimerRunning ? "bg-red-500/20 text-red-500 border border-red-500/50" : "bg-[var(--accent)] text-black"
                  )}
                >
                  {isTimerRunning ? <Pause size={32} /> : <Play size={32} className="ml-1" />}
                </button>
                <button 
                  onClick={resetTimer}
                  className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all"
                >
                  <RotateCcw size={24} />
                </button>
              </div>

              <div className="mt-12 max-w-md text-center">
                <h3 className="text-xl font-semibold mb-2">Deep Work Protocol</h3>
                <p className="text-[var(--text-secondary)] text-sm">
                  The Pomodoro technique helps you maintain high focus levels by breaking work into 25-minute intervals separated by short breaks.
                </p>
              </div>
            </motion.div>
          )}

          {activeTab === 'analytics' && (
            <motion.div 
              key="analytics"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <h2 className="text-3xl font-bold">Study <span className="neon-text">Analytics</span></h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="glass-card p-8">
                  <h3 className="text-lg font-semibold mb-6">Weekly Distribution</h3>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={analyticsData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="name" stroke="rgba(255,255,255,0.3)" />
                        <YAxis stroke="rgba(255,255,255,0.3)" />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#141414', border: '1px solid rgba(255,255,255,0.1)' }}
                        />
                        <Line type="monotone" dataKey="hours" stroke="var(--accent)" strokeWidth={3} dot={{ fill: 'var(--accent)', r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="glass-card p-8 flex flex-col justify-center items-center text-center">
                  <div className="w-32 h-32 rounded-full border-4 border-[var(--accent)] flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(0,242,255,0.2)]">
                    <div className="text-4xl font-bold">{state.sessions.length}</div>
                  </div>
                  <h3 className="text-xl font-bold mb-2">Total Sessions</h3>
                  <p className="text-[var(--text-secondary)] max-w-xs">
                    You've completed {state.sessions.length} focus sessions. That's approximately {Math.round(state.sessions.length * 25 / 60)} hours of deep work.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'ranking' && (
            <motion.div 
              key="ranking"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="max-w-4xl mx-auto space-y-12"
            >
              <div className="text-center space-y-4">
                <h2 className="text-5xl font-bold tracking-tighter">COMBAT <span className="neon-text">RANKING</span></h2>
                <p className="text-[var(--text-secondary)] uppercase tracking-[0.4em] text-sm">Past Paper Mastery Protocol</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <SubjectPaperCard 
                  subject="Maths" 
                  count={state.papers.maths} 
                  rank={rankingInfo.maths}
                  onUpdate={(d) => updatePapers('maths', d)}
                />
                <SubjectPaperCard 
                  subject="Physics" 
                  count={state.papers.physics} 
                  rank={rankingInfo.physics}
                  onUpdate={(d) => updatePapers('physics', d)}
                />
                <SubjectPaperCard 
                  subject="ICT" 
                  count={state.papers.ict} 
                  rank={rankingInfo.ict}
                  onUpdate={(d) => updatePapers('ict', d)}
                />
              </div>

              <div className="glass-card p-12 text-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-white/5">
                  <motion.div 
                    className="h-full bg-[var(--accent)] shadow-[0_0_15px_var(--accent)]"
                    animate={{ width: `${(rankingInfo.total / 30) * 100}%` }}
                  />
                </div>
                
                <div className="relative z-10">
                  <div className="text-xs text-[var(--text-secondary)] uppercase tracking-[0.5em] mb-4">Overall Standing</div>
                  <div className={cn("text-6xl font-black italic tracking-tighter mb-4", rankingInfo.color)}>
                    {rankingInfo.rank}
                  </div>
                  <div className="text-sm text-[var(--text-secondary)]">
                    {rankingInfo.total} / 30 PAPERS COMPLETED
                  </div>
                  {rankingInfo.total === 30 && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-8 p-4 border border-[var(--accent)] bg-[var(--accent)]/10 rounded-xl text-[var(--accent)] font-bold uppercase tracking-widest"
                    >
                      Fully Ranked: Grandmaster Status Achieved
                    </motion.div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* --- Notifications Overlay --- */}
      <div className="fixed bottom-8 right-8 z-[100] space-y-4">
        <AnimatePresence>
          {notifications.map(n => (
            <motion.div 
              key={n.id}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className={cn(
                "glass-card p-4 min-w-[300px] flex items-center gap-4 border-l-4",
                n.type === 'alert' ? "border-l-red-500" : "border-l-[var(--accent)]"
              )}
            >
              {n.type === 'alert' ? <AlertCircle className="text-red-500" /> : <Bell className="text-[var(--accent)]" />}
              <div className="text-sm font-medium">{n.message}</div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// --- Sub-components ---
function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "relative group flex items-center justify-center w-12 h-12 rounded-xl transition-all duration-300",
        active ? "bg-[var(--accent)] text-black shadow-[0_0_15px_rgba(0,242,255,0.3)]" : "text-[var(--text-secondary)] hover:text-white hover:bg-white/5"
      )}
    >
      {icon}
      <div className="absolute left-full ml-4 px-2 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
        {label}
      </div>
      {active && (
        <motion.div 
          layoutId="nav-indicator"
          className="absolute -left-4 w-1 h-8 bg-[var(--accent)] rounded-r-full shadow-[0_0_10px_var(--accent)]"
        />
      )}
    </button>
  );
}

function SubjectPaperCard({ subject, count, rank, onUpdate }: { subject: string; count: number; rank: { label: string; color: string }; onUpdate: (d: number) => void }) {
  return (
    <div className="glass-card p-6 flex flex-col items-center text-center group">
      <div className="text-xs text-[var(--text-secondary)] uppercase tracking-widest mb-2">{subject}</div>
      <div className={cn("text-lg font-bold mb-4", rank.color)}>{rank.label}</div>
      
      <div className="relative w-24 h-24 flex items-center justify-center mb-6">
        <svg className="absolute inset-0 w-full h-full -rotate-90">
          <circle cx="48" cy="48" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
          <motion.circle 
            cx="48" cy="48" r="40" fill="none" stroke="currentColor" strokeWidth="4" 
            className={rank.color}
            strokeDasharray="251"
            animate={{ strokeDashoffset: 251 - (251 * (count / 10)) }}
          />
        </svg>
        <div className="text-2xl font-mono font-bold">{count}<span className="text-xs opacity-30">/10</span></div>
      </div>

      <div className="flex gap-4">
        <button 
          onClick={() => onUpdate(-1)}
          className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all"
        >
          -
        </button>
        <button 
          onClick={() => onUpdate(1)}
          className="w-8 h-8 rounded-lg bg-[var(--accent)] text-black flex items-center justify-center hover:brightness-110 transition-all"
        >
          +
        </button>
      </div>
    </div>
  );
}
