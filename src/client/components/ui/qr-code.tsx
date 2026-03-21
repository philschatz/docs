import { useState, useEffect } from 'preact/hooks';
import QRCode from 'qrcode';
import { showToast } from './toast';

interface QRCodeProps {
  url: string;
  size?: number;
  className?: string;
}

export function QRCodeDisplay({ url, size = 200, className }: QRCodeProps) {
  const [svg, setSvg] = useState('');

  useEffect(() => {
    QRCode.toString(url, { type: 'svg', margin: 1, width: size })
      .then(setSvg)
      .catch(() => {});
  }, [url, size]);

  if (!svg) return null;

  const handleClick = () => {
    navigator.clipboard.writeText(url).then(
      () => showToast('Link copied to clipboard'),
      () => showToast('Failed to copy link'),
    );
  };

  return (
    <div
      className={`cursor-pointer ${className ?? ''}`}
      style={{ display: 'inline-block' }}
      onClick={handleClick}
      title="Click to copy link"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
