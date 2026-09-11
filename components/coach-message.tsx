'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function CoachMessage({
  content,
  animate = false,
  onComplete,
}: {
  content: string;
  animate?: boolean;
  onComplete?: () => void;
}) {
  const [visible, setVisible] = useState(animate ? '' : content);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  useEffect(() => {
    if (
      !animate ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setVisible(content);
      completeRef.current?.();
      return;
    }

    let index = 0;
    const chunkSize = Math.max(
      4,
      Math.min(14, Math.ceil(content.length / 150)),
    );
    const timer = window.setInterval(() => {
      index = Math.min(content.length, index + chunkSize);
      setVisible(content.slice(0, index));
      if (index >= content.length) {
        window.clearInterval(timer);
        completeRef.current?.();
      }
    }, 18);
    return () => window.clearInterval(timer);
  }, [animate, content]);

  const revealing = animate && visible.length < content.length;

  return (
    <div className="message-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          img: ({ alt }) => <span>[Image: {alt || 'attachment'}]</span>,
        }}
      >
        {visible}
      </ReactMarkdown>
      {revealing && <span className="response-cursor" aria-hidden="true" />}
    </div>
  );
}
