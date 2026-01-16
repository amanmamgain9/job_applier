// Convert file to base64 for LLM input
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix (e.g., "data:application/pdf;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function getFileContent(file: File): Promise<{ type: 'text' | 'pdf'; content: string }> {
  if (file.type === 'text/plain') {
    const text = await file.text();
    return { type: 'text', content: text };
  }

  if (file.type === 'application/pdf') {
    const base64 = await fileToBase64(file);
    return { type: 'pdf', content: base64 };
  }

  throw new Error('Unsupported file type. Please upload PDF or TXT.');
}
