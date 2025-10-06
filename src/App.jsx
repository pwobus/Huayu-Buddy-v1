// File: src/App.jsx  (updated to include HealthCard)
import React from 'react';
import PDFUpload from './components/PDFUpload';
import Conversation from './components/Conversation';
import Avatar from './components/Avatar';
import Review from './components/Review';
import HealthCard from './components/HealthCard';
import { useConversationStore } from './store/useConversationStore';

export default function App() {
  const { vocabulary } = useConversationStore();
  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <h1 className="text-3xl font-bold mb-4">Huayu Buddy 中文对话</h1>
      <HealthCard />
      <PDFUpload />
      {vocabulary.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4 mt-6">
          <Conversation />
          <Avatar />
        </div>
      )}
      <Review />
    </div>
  );
}
