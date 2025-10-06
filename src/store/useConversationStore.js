// File: src/store/useConversationStore.js
import { create } from 'zustand';

export const useConversationStore = create((set) => ({
  vocabulary: [],
  setVocabulary: (words) => set({ vocabulary: Array.isArray(words) ? words : [] }),

  currentPhrase: null,
  setCurrentPhrase: (phrase) => set({ currentPhrase: phrase ?? null }),

  userResponse: '',
  setUserResponse: (response) => set({ userResponse: (response ?? '').toString() }),

  responseHistory: [],
  addToHistory: (entry) =>
    set((state) => ({ responseHistory: [...state.responseHistory, entry] })),
  clearHistory: () => set({ responseHistory: [], userResponse: '' }),
  // NEW: allow overwriting full history (for session restore)
  setHistory: (arr) => set({ responseHistory: Array.isArray(arr) ? arr : [] }),

  // Avatar speech state
  isSpeaking: false,
  setIsSpeaking: (val) => set({ isSpeaking: !!val }),
}));
