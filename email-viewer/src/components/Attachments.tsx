'use client';

import { useState, useEffect } from 'react';
import { EmailAttachment } from '@/types';
import { Paperclip, FileText, Image, File, Download, Loader2 } from 'lucide-react';

interface AttachmentsProps {
  emailId: number;
  hasAttachments: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(contentType: string) {
  if (contentType.startsWith('image/')) {
    return <Image className="w-5 h-5 text-green-600" />;
  }
  if (contentType.includes('pdf') || contentType.includes('document') || contentType.includes('text')) {
    return <FileText className="w-5 h-5 text-red-600" />;
  }
  return <File className="w-5 h-5 text-outlook-blue" />;
}

function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop()?.toUpperCase() || '' : '';
}

export default function Attachments({ emailId, hasAttachments }: AttachmentsProps) {
  const [attachments, setAttachments] = useState<EmailAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (hasAttachments && isExpanded && attachments.length === 0) {
      fetchAttachments();
    }
  }, [emailId, hasAttachments, isExpanded]);

  const fetchAttachments = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/emails/${emailId}/attachments`);
      if (!response.ok) throw new Error('Failed to fetch attachments');
      const data = await response.json();
      setAttachments(data.attachments || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load attachments');
    } finally {
      setIsLoading(false);
    }
  };

  if (!hasAttachments) {
    return null;
  }

  return (
    <div className="border-t border-outlook-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-6 py-3 flex items-center justify-between hover:bg-outlook-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <Paperclip className="w-4 h-4 text-outlook-textLight" />
          <span className="text-sm font-medium text-outlook-text">Attachments</span>
          {attachments.length > 0 && (
            <span className="px-2 py-0.5 bg-outlook-lightBlue text-outlook-blue text-xs rounded-full">
              {attachments.length}
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-outlook-textLight transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="px-6 pb-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 text-outlook-blue animate-spin" />
              <span className="ml-2 text-sm text-outlook-textLight">Loading attachments...</span>
            </div>
          ) : error ? (
            <div className="text-center py-4">
              <p className="text-sm text-red-600">{error}</p>
              <button
                onClick={fetchAttachments}
                className="mt-2 text-sm text-outlook-blue hover:underline"
              >
                Try again
              </button>
            </div>
          ) : attachments.length === 0 ? (
            <p className="text-sm text-outlook-textLight py-2">No attachments found</p>
          ) : (
            <div className="grid gap-2">
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-outlook-hover transition-colors group"
                >
                  <div className="flex-shrink-0 w-10 h-10 bg-white rounded-lg border border-outlook-border flex items-center justify-center">
                    {getFileIcon(attachment.contentType)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-outlook-text truncate">
                        {attachment.name}
                      </span>
                      {attachment.isInline && (
                        <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-800 text-xs rounded">
                          Inline
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-outlook-textLight">
                      <span>{getFileExtension(attachment.name)}</span>
                      <span>•</span>
                      <span>{formatFileSize(attachment.size)}</span>
                    </div>
                  </div>
                  <button
                    className="flex-shrink-0 p-2 opacity-0 group-hover:opacity-100 hover:bg-white rounded-lg transition-all"
                    title="Download attachment"
                  >
                    <Download className="w-4 h-4 text-outlook-blue" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
