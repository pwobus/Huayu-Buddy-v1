import React from 'react';
import { useConversationStore } from '../store/useConversationStore';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.entry';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export default function PDFUpload() {
  const { setVocabulary } = useConversationStore();

  const handlePDFUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const typedArray = new Uint8Array(reader.result);
      const pdf = await pdfjsLib.getDocument(typedArray).promise;

      let fullText = '';
      for (let i = 0; i < pdf.numPages; i++) {
        const page = await pdf.getPage(i + 1);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(' ');
        fullText += pageText + '\n';
      }

      const vocabList = fullText
        .split('\n')
        .map(line => (line ?? '').trim())
        .filter(line => line && /\p{Script=Han}/u.test(line))
        .map(line => {
          const parts = line.split(/\s+/);
          const hanzi = parts[0];
          const pinyin = parts.slice(1).join(' ');
          return { hanzi, pinyin };
        });

      setVocabulary(vocabList);
    };

    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="p-4 bg-white rounded shadow">
      <h2 className="text-lg font-bold mb-2">📄 Upload Vocabulary PDF</h2>
      <input type="file" accept=".pdf" onChange={handlePDFUpload} />
    </div>
  );
}