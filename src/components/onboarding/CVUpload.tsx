import { useState, useCallback, useRef } from 'react';
import { Upload, FileText, Check, X, User, Briefcase, GraduationCap, Code } from 'lucide-react';
import { cn, formatFileSize } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import type { ParsedCV } from './types';

const ACCEPTED_TYPES = ['application/pdf', 'text/plain'];

interface Props {
  onUpload: (file: File) => Promise<void>;
  onConfirm: () => void;
  parsedCV: ParsedCV | undefined;
  isLoading: boolean;
  error: string | null;
}

export function CVUpload({ onUpload, onConfirm, parsedCV, isLoading, error }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    setLocalError(null);
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setLocalError('Please upload a PDF or TXT file');
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setLocalError('File must be less than 10MB');
      return;
    }
    setFile(f);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    },
    [handleFile]
  );

  const handleRemove = () => {
    setFile(null);
    setLocalError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const displayError = localError || error;

  // Show parsed CV details after successful parsing
  if (parsedCV && parsedCV.name !== 'Could not parse') {
    return (
      <div className="w-full max-w-xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-white mb-2">CV Parsed!</h1>
          <p className="text-zinc-400">Here's what we found</p>
        </div>

        <div className="border border-zinc-700 rounded-2xl p-6 bg-zinc-900/50 space-y-5">
          {/* Name & Contact */}
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <User className="w-6 h-6 text-emerald-400" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-white text-lg">{parsedCV.name}</p>
              <div className="text-sm text-zinc-400 space-y-0.5">
                {parsedCV.email && <p>{parsedCV.email}</p>}
                {parsedCV.location && <p>{parsedCV.location}</p>}
              </div>
            </div>
          </div>

          {/* Skills */}
          {parsedCV.skills.length > 0 && (
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
                <Code className="w-6 h-6 text-blue-400" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-white mb-2">Skills</p>
                <div className="flex flex-wrap gap-2">
                  {parsedCV.skills.slice(0, 8).map((skill, i) => (
                    <span
                      key={i}
                      className="px-2 py-1 bg-zinc-800 rounded-lg text-xs text-zinc-300"
                    >
                      {skill}
                    </span>
                  ))}
                  {parsedCV.skills.length > 8 && (
                    <span className="px-2 py-1 text-xs text-zinc-500">
                      +{parsedCV.skills.length - 8} more
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Experience */}
          {parsedCV.experience.length > 0 && (
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center">
                <Briefcase className="w-6 h-6 text-purple-400" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-white mb-2">Experience</p>
                <div className="space-y-2">
                  {parsedCV.experience.slice(0, 3).map((exp, i) => (
                    <div key={i} className="text-sm">
                      <p className="text-zinc-200">{exp.title}</p>
                      <p className="text-zinc-500">
                        {exp.company}
                        {exp.duration && ` · ${exp.duration}`}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Education */}
          {parsedCV.education.length > 0 && (
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
                <GraduationCap className="w-6 h-6 text-amber-400" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-white mb-2">Education</p>
                <div className="space-y-2">
                  {parsedCV.education.slice(0, 2).map((edu, i) => (
                    <div key={i} className="text-sm">
                      <p className="text-zinc-200">{edu.degree}</p>
                      <p className="text-zinc-500">
                        {edu.institution}
                        {edu.year && ` · ${edu.year}`}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="pt-4 flex justify-end">
            <Button onClick={onConfirm} size="lg">
              <Check className="w-4 h-4 mr-2" />
              Looks Good, Continue
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Let's get started</h1>
        <p className="text-zinc-400">Upload your CV to find the perfect job</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.txt"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        className="hidden"
      />

      {!file ? (
        <div
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragging(false);
          }}
          className={cn(
            'border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all',
            'hover:border-emerald-500/50 hover:bg-emerald-500/5',
            isDragging
              ? 'border-emerald-500 bg-emerald-500/10'
              : 'border-zinc-700 bg-zinc-900/50'
          )}
        >
          <div
            className={cn(
              'w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center bg-zinc-800',
              isDragging && 'bg-emerald-500/20'
            )}
          >
            <Upload
              className={cn(
                'w-8 h-8',
                isDragging ? 'text-emerald-400' : 'text-zinc-500'
              )}
            />
          </div>
          <p className="text-lg font-medium text-zinc-200 mb-1">
            Drop your CV here
          </p>
          <p className="text-sm text-zinc-500 mb-4">or click to browse</p>
          <p className="text-xs text-zinc-600">PDF or TXT (max 10MB)</p>
        </div>
      ) : (
        <div className="border border-zinc-700 rounded-2xl p-6 bg-zinc-900/50">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <FileText className="w-6 h-6 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-white truncate">{file.name}</p>
              <p className="text-sm text-zinc-500">{formatFileSize(file.size)}</p>
            </div>
            {!isLoading && (
              <button
                onClick={handleRemove}
                className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
          <div className="mt-6 flex justify-end">
            <Button onClick={() => onUpload(file)} disabled={isLoading} size="lg">
              {isLoading ? (
                'Parsing CV...'
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Upload & Parse
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {displayError && (
        <p className="mt-4 text-sm text-red-400 text-center">{displayError}</p>
      )}
    </div>
  );
}
